// src/env.ts
import { CONFLICTING_ENV_VARS } from './constants.js';
import { claudeCodeClientModelId, stripOneMContextSuffix } from './context-model-id.js';
import { resolveContextWindow } from './context-window.js';
import { oauthCredentialToKeychainJson } from './registry/opencode-auth.js';
import {
  parseStoredOAuthCredential,
} from './oauth/types.js';
import { refreshStoredOAuthCredential, oauthCredentialShouldRefresh } from './oauth/refresh.js';
import type { ConflictInfo } from './types.js';

export function detectConflicts(): ConflictInfo[] {
  return CONFLICTING_ENV_VARS
    .filter(name => process.env[name] !== undefined)
    .map(name => ({ name, value: process.env[name]! }));
}

export function resolveApiKey(): string | null {
  const key = process.env['OPENCODE_API_KEY'];
  // Treat empty string as missing — happens when .zshrc auto-load line runs
  // but the Keychain entry has been deleted (security command returns nothing)
  if (!key?.trim()) return null;
  // First line only — users sometimes paste notes below the key in shell profiles
  return key.trim().split(/\r?\n/)[0]?.trim() || null;
}

/** Restore first-party-like Claude Code behavior when routing through a proxy or gateway. */
export function applyClaudeCodeThirdPartyCompat(env: NodeJS.ProcessEnv): void {
  // Custom ANTHROPIC_BASE_URL disables MCP tool search by default, loading every
  // MCP tool (100+) on every turn. Requires defer_loading on tools — do not set
  // CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS when using the local translation proxy.
  env['ENABLE_TOOL_SEARCH'] = 'true';
  // Third-party routes may enable a shorter system prompt that drops conversational
  // guardrails while hooks/plugins still inject agentic instructions.
  env['CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT'] = '0';
}

export function buildChildEnv(
  baseUrl: string,
  model: string,
  apiKey: string,
  proxyPort?: number,
  contextWindow?: number,
  enableGatewayDiscovery?: boolean,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of CONFLICTING_ENV_VARS) {
    delete env[name];
  }
  env['ANTHROPIC_BASE_URL'] = proxyPort
    ? `http://127.0.0.1:${proxyPort}`
    : baseUrl;
  env['ANTHROPIC_API_KEY'] = apiKey;
  const bareModel = stripOneMContextSuffix(model);
  env['ANTHROPIC_MODEL'] = claudeCodeClientModelId(model, contextWindow);
  // Claude Code defaults to 200K for non-api.anthropic.com base URLs; override with
  // the launch model's real window. NOTE: in switch-menu mode this is fixed at launch
  // and does NOT update on live /model switch — Claude Code's gateway model discovery
  // only carries id + display_name (no context_window), so this env var is the only
  // lever and it reflects the model you started with.
  // Third-party routes also require a `[1m]` model-id suffix for 1M+ windows in the UI.
  env['CLAUDE_CODE_MAX_CONTEXT_TOKENS'] = String(resolveContextWindow(bareModel, contextWindow));
  if (enableGatewayDiscovery) {
    env['CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY'] = '1';
  }
  applyClaudeCodeThirdPartyCompat(env);
  return env;
}

/**
 * Child env for transparent HTTP-proxy mode. Keep normal Anthropic credentials
 * intact, remove only endpoint modes that would bypass api.anthropic.com, and
 * trust the per-user Relay AI CA for this child process.
 */
export function buildHttpProxyChildEnv(proxyPort: number, caCertPath: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of CONFLICTING_ENV_VARS) {
    if (name === 'ANTHROPIC_API_KEY' || name === 'ANTHROPIC_AUTH_TOKEN' || name === 'ANTHROPIC_MODEL') continue;
    delete env[name];
  }
  const proxyUrl = `http://127.0.0.1:${proxyPort}`;
  env['HTTPS_PROXY'] = proxyUrl;
  env['HTTP_PROXY'] = proxyUrl;
  env['https_proxy'] = proxyUrl;
  env['http_proxy'] = proxyUrl;
  env['NODE_EXTRA_CA_CERTS'] = caCertPath;
  const noProxy = env['NO_PROXY'] ?? env['no_proxy'];
  if (noProxy !== undefined) {
    const filtered = noProxy
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
      .filter(value => {
        const entry = value.toLowerCase().replace(/^https?:\/\//, '');
        const host = entry.replace(/:\d+$/, '');
        if (host === '*') return false;
        const suffix = host.startsWith('*.') ? host.slice(1) : host;
        const bypassesAnthropic = suffix.startsWith('.')
          ? 'api.anthropic.com'.endsWith(suffix)
          : 'api.anthropic.com' === suffix || 'api.anthropic.com'.endsWith(`.${suffix}`);
        return !bypassesAnthropic;
      })
      .join(',');
    if (filtered) {
      env['NO_PROXY'] = filtered;
      env['no_proxy'] = filtered;
    } else {
      delete env['NO_PROXY'];
      delete env['no_proxy'];
    }
  }
  return env;
}

/** Child env for Antigravity — only CLOUD_CODE_URL, no Anthropic proxy vars. */
export function buildAntigravityChildEnv(gatewayUrl: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of CONFLICTING_ENV_VARS) {
    delete env[name];
  }
  env['CLOUD_CODE_URL'] = gatewayUrl;

  // Inject dummy API keys to bypass agy's slow keychain lookup (~500ms).
  // This prevents the race condition where loadCodeAssist fails and falls back
  // to the hardcoded, unsupported FLASH_LITE model.
  // The local Cloud Code Gateway ignores these keys, so any dummy value works.
  env['ANTIGRAVITY_API_KEY'] = 'relay-dummy-key';
  env['GEMINI_API_KEY'] = 'relay-dummy-key';
  env['GOOGLE_API_KEY'] = 'relay-dummy-key';
  env['GOOGLE_GEMINI_API_KEY'] = 'relay-dummy-key';

  return env;
}

/** Classify a keyring error into a human-readable reason (never throws). */
export function classifyKeyringError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (lower.includes('cannot find module') || lower.includes('module not found') || lower.includes('failed to load')) {
    return 'native keyring module not available on this system';
  }
  if (lower.includes('secret service') || lower.includes('dbus') || lower.includes('daemon')) {
    return 'Secret Service daemon is not running (start GNOME Keyring or KWallet)';
  }
  if (lower.includes('denied') || lower.includes('locked') || lower.includes('cancelled') || lower.includes('user refused')) {
    return 'keychain access was denied or the keychain is locked';
  }
  return `keyring error: ${msg}`;
}

const KEYRING_SERVICE = 'relay-ai';
/** @deprecated Use GLOBAL_OPENCODE_KEYRING_ACCOUNT — kept for migration reads */
const KEYRING_ACCOUNT = 'relay-ai';
// Windows Credential Manager caps a single credential blob at 2560 bytes (CredWriteW).
// keyring-rs encodes the password as UTF-16 (2 bytes/char) before that check, so the
// usable limit is 2560 / 2 = 1280 chars — long OAuth tokens (e.g. OpenAI's JWTs) exceed
// this, so secrets above the threshold are split across multiple keyring entries.
// Harmless on macOS/Linux, which have no such limit.
const KEYRING_CHUNK_PREFIX = '__relay_chunked__:';
const KEYRING_CHUNK_SIZE = 1200;
const LEGACY_KEYRING_SERVICE = 'opencode-starter';
const LEGACY_KEYRING_ACCOUNT = 'opencode-starter';

export const GLOBAL_OPENCODE_KEYRING_ACCOUNT = 'global:opencode';

export function providerKeyringAccount(providerId: string): string {
  return `provider:${providerId}`;
}

export function oauthProviderKeyringAccount(providerId: string): string {
  return `oauth:provider:${providerId}`;
}

function oauthProviderIdFromAccount(account: string): string | null {
  const prefix = 'oauth:provider:';
  return account.startsWith(prefix) ? account.slice(prefix.length) : null;
}

const oauthRefreshInflight = new Map<string, Promise<string | null>>();

export type ParsedAuthRef =
  | { kind: 'keyring'; account: string }
  | { kind: 'env'; varName: string };

/** Parse registry authRef strings like `keyring:provider:groq` or `env:OPENCODE_API_KEY`. */
export function parseAuthRef(authRef: string): ParsedAuthRef | null {
  if (authRef.startsWith('keyring:')) {
    const account = authRef.slice('keyring:'.length);
    return account ? { kind: 'keyring', account } : null;
  }
  if (authRef.startsWith('env:')) {
    const varName = authRef.slice('env:'.length);
    return varName ? { kind: 'env', varName } : null;
  }
  return null;
}

/** Env var name for relay-ai namespaced per-provider keys. */
export function relayAiKeyEnvVar(providerId: string): string {
  return `RELAY_AI_KEY_${providerId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

function readEnvCredential(varName: string): string | null {
  const raw = process.env[varName];
  if (!raw?.trim()) return null;
  return raw.trim().split(/\r?\n/)[0]?.trim() || null;
}

async function readKeyringAccount(account: string, diag?: (msg: string) => void): Promise<string | null> {
  try {
    const { Entry } = await import('@napi-rs/keyring');
    const value = new Entry(KEYRING_SERVICE, account).getPassword() ?? null;
    if (!value?.startsWith(KEYRING_CHUNK_PREFIX)) return value;
    const chunkCount = Number(value.slice(KEYRING_CHUNK_PREFIX.length));
    let combined = '';
    for (let i = 0; i < chunkCount; i++) {
      combined += new Entry(KEYRING_SERVICE, `${account}::chunk::${i}`).getPassword() ?? '';
    }
    return combined;
  } catch (err) {
    diag?.(classifyKeyringError(err));
    return null;
  }
}

async function writeKeyringAccount(
  account: string,
  key: string,
  diag?: (msg: string) => void,
): Promise<boolean> {
  try {
    const { Entry } = await import('@napi-rs/keyring');
    if (key.length <= KEYRING_CHUNK_SIZE) {
      new Entry(KEYRING_SERVICE, account).setPassword(key);
      return true;
    }
    const chunkCount = Math.ceil(key.length / KEYRING_CHUNK_SIZE);
    for (let i = 0; i < chunkCount; i++) {
      const chunk = key.slice(i * KEYRING_CHUNK_SIZE, (i + 1) * KEYRING_CHUNK_SIZE);
      new Entry(KEYRING_SERVICE, `${account}::chunk::${i}`).setPassword(chunk);
    }
    new Entry(KEYRING_SERVICE, account).setPassword(`${KEYRING_CHUNK_PREFIX}${chunkCount}`);
    return true;
  } catch (err) {
    diag?.(classifyKeyringError(err));
    return false;
  }
}

async function deleteKeyringAccount(account: string, diag?: (msg: string) => void): Promise<boolean> {
  try {
    const { Entry } = await import('@napi-rs/keyring');
    const value = new Entry(KEYRING_SERVICE, account).getPassword();
    if (value?.startsWith(KEYRING_CHUNK_PREFIX)) {
      const chunkCount = Number(value.slice(KEYRING_CHUNK_PREFIX.length));
      for (let i = 0; i < chunkCount; i++) {
        new Entry(KEYRING_SERVICE, `${account}::chunk::${i}`).deletePassword();
      }
    }
    new Entry(KEYRING_SERVICE, account).deletePassword();
    return true;
  } catch (err) {
    diag?.(classifyKeyringError(err));
    return false;
  }
}

/** Read Zen/Go API key: env → global:opencode → legacy relay-ai → opencode-starter. */
export async function readGlobalOpencodeCredential(diag?: (msg: string) => void): Promise<string | null> {
  const fromEnv = resolveApiKey();
  if (fromEnv) return fromEnv;

  const global = await readKeyringAccount(GLOBAL_OPENCODE_KEYRING_ACCOUNT, diag);
  if (global) return global;

  const current = await readKeyringAccount(KEYRING_ACCOUNT, diag);
  if (current) return current;

  try {
    const { Entry } = await import('@napi-rs/keyring');
    return new Entry(LEGACY_KEYRING_SERVICE, LEGACY_KEYRING_ACCOUNT).getPassword() ?? null;
  } catch (err) {
    diag?.(classifyKeyringError(err));
    return null;
  }
}

/**
 * Migrate legacy keychain entries to `global:opencode`.
 * Protocol: read → write → verify → delete old (only after verify succeeds).
 */
export async function migrateGlobalOpencodeCredential(diag?: (msg: string) => void): Promise<boolean> {
  const existing = await readKeyringAccount(GLOBAL_OPENCODE_KEYRING_ACCOUNT, diag);
  if (existing) return true;

  const legacy =
    (await readKeyringAccount(KEYRING_ACCOUNT, diag)) ??
    (await (async () => {
      try {
        const { Entry } = await import('@napi-rs/keyring');
        return new Entry(LEGACY_KEYRING_SERVICE, LEGACY_KEYRING_ACCOUNT).getPassword() ?? null;
      } catch (err) {
        diag?.(classifyKeyringError(err));
        return null;
      }
    })());

  if (!legacy) return false;

  const wrote = await writeKeyringAccount(GLOBAL_OPENCODE_KEYRING_ACCOUNT, legacy, diag);
  if (!wrote) return false;

  const verified = await readKeyringAccount(GLOBAL_OPENCODE_KEYRING_ACCOUNT, diag);
  if (verified !== legacy) {
    diag?.('credential migration verification failed — keeping legacy keychain entries');
    return false;
  }

  if (await readKeyringAccount(KEYRING_ACCOUNT, diag)) {
    await deleteKeyringAccount(KEYRING_ACCOUNT, diag);
  }
  try {
    const { Entry } = await import('@napi-rs/keyring');
    if (new Entry(LEGACY_KEYRING_SERVICE, LEGACY_KEYRING_ACCOUNT).getPassword()) {
      new Entry(LEGACY_KEYRING_SERVICE, LEGACY_KEYRING_ACCOUNT).deletePassword();
    }
  } catch {
    // best-effort legacy cleanup
  }
  return true;
}

/** Resolve a provider secret from authRef (env → keyring). */
export async function resolveProviderCredential(
  providerId: string,
  authRef: string,
  diag?: (msg: string) => void,
): Promise<string | null> {
  const namespaced = readEnvCredential(relayAiKeyEnvVar(providerId));
  if (namespaced) return namespaced;

  const parsed = parseAuthRef(authRef);
  if (!parsed) return null;

  if (parsed.kind === 'env') {
    return readEnvCredential(parsed.varName);
  }

  if (parsed.account === GLOBAL_OPENCODE_KEYRING_ACCOUNT) {
    return readGlobalOpencodeCredential(diag);
  }

  return readProviderSecret(parsed.account, diag);
}

/** Read OAuth metadata retained alongside the access token. */
export async function resolveProviderOAuthAccountId(
  authRef: string,
  diag?: (msg: string) => void,
): Promise<string | undefined> {
  const parsed = parseAuthRef(authRef);
  if (!parsed || parsed.kind !== 'keyring' || !oauthProviderIdFromAccount(parsed.account)) return undefined;
  const raw = await readKeyringAccount(parsed.account, diag);
  return parseStoredOAuthCredential(raw)?.accountId;
}

export async function resolveProviderOAuthProviderData(
  authRef: string,
  diag?: (msg: string) => void,
): Promise<Record<string, unknown> | undefined> {
  const parsed = parseAuthRef(authRef);
  if (!parsed || parsed.kind !== 'keyring' || !oauthProviderIdFromAccount(parsed.account)) return undefined;
  const raw = await readKeyringAccount(parsed.account, diag);
  return parseStoredOAuthCredential(raw)?.providerData;
}

function decodeProviderSecret(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return trimmed;
  const oauth = parseStoredOAuthCredential(trimmed);
  if (oauth) return oauth.access;
  try {
    const parsed = JSON.parse(trimmed) as { type?: string; access?: string; token?: string };
    if (parsed.type === 'oauth' && typeof parsed.access === 'string') return parsed.access;
    if (parsed.type === 'wellknown' && typeof parsed.token === 'string') return parsed.token;
  } catch {
    // fall through
  }
  return trimmed;
}

async function refreshOAuthKeyringAccount(
  account: string,
  providerId: string,
  raw: string,
  diag?: (msg: string) => void,
): Promise<string | null> {
  const existing = oauthRefreshInflight.get(account);
  if (existing) return existing;

  const work = (async (): Promise<string | null> => {
    const cred = parseStoredOAuthCredential(raw);
    if (!cred || !oauthCredentialShouldRefresh(cred, providerId)) {
      return decodeProviderSecret(raw);
    }
    try {
      const refreshed = await refreshStoredOAuthCredential(providerId, cred);
      const json = oauthCredentialToKeychainJson(refreshed);
      await writeKeyringAccount(account, json, diag);
      return refreshed.access;
    } catch (err) {
      diag?.(err instanceof Error ? err.message : String(err));
      if (cred.access && cred.expires > Date.now()) return cred.access;
      throw err;
    }
  })();

  oauthRefreshInflight.set(account, work);
  try {
    return await work;
  } finally {
    oauthRefreshInflight.delete(account);
  }
}

async function readProviderSecret(account: string, diag?: (msg: string) => void): Promise<string | null> {
  const raw = await readKeyringAccount(account, diag);
  if (!raw) return null;

  const oauthProviderId = oauthProviderIdFromAccount(account);
  if (oauthProviderId && raw.trim().startsWith('{')) {
    return refreshOAuthKeyringAccount(account, oauthProviderId, raw, diag);
  }
  return decodeProviderSecret(raw);
}

export async function saveProviderCredential(
  authRef: string,
  key: string,
  diag?: (msg: string) => void,
): Promise<boolean> {
  const parsed = parseAuthRef(authRef);
  if (!parsed || parsed.kind !== 'keyring') return false;
  return writeKeyringAccount(parsed.account, key, diag);
}

/** Delete a provider secret from keyring (no-op for env: refs). */
export async function deleteProviderCredential(
  authRef: string,
  diag?: (msg: string) => void,
): Promise<boolean> {
  const parsed = parseAuthRef(authRef);
  if (!parsed || parsed.kind !== 'keyring') return false;
  return deleteKeyringAccount(parsed.account, diag);
}

export async function readFromCredentialStore(diag?: (msg: string) => void): Promise<string | null> {
  return readGlobalOpencodeCredential(diag);
}

export async function saveToCredentialStore(key: string, diag?: (msg: string) => void): Promise<boolean> {
  const wrote = await writeKeyringAccount(GLOBAL_OPENCODE_KEYRING_ACCOUNT, key, diag);
  if (wrote) {
    await deleteKeyringAccount(KEYRING_ACCOUNT, diag);
  }
  return wrote;
}

export async function isSecretServiceAvailable(): Promise<boolean> {
  try {
    const { Entry } = await import('@napi-rs/keyring');
    new Entry(`${KEYRING_SERVICE}-probe`, 'probe').getPassword();
    return true;
  } catch {
    return false;
  }
}
