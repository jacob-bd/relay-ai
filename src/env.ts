// src/env.ts
import { CONFLICTING_ENV_VARS } from './constants.js';
import { resolveContextWindow } from './context-window.js';
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
  env['ANTHROPIC_MODEL'] = model;
  // Claude Code defaults to 200K for non-api.anthropic.com base URLs; override with
  // the launch model's real window. NOTE: in switch-menu mode this is fixed at launch
  // and does NOT update on live /model switch — Claude Code's gateway model discovery
  // only carries id + display_name (no context_window), so this env var is the only
  // lever and it reflects the model you started with.
  env['CLAUDE_CODE_MAX_CONTEXT_TOKENS'] = String(resolveContextWindow(model, contextWindow));
  if (enableGatewayDiscovery) {
    env['CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY'] = '1';
  }
  applyClaudeCodeThirdPartyCompat(env);
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
const LEGACY_KEYRING_SERVICE = 'opencode-starter';
const LEGACY_KEYRING_ACCOUNT = 'opencode-starter';

export const GLOBAL_OPENCODE_KEYRING_ACCOUNT = 'global:opencode';

export function providerKeyringAccount(providerId: string): string {
  return `provider:${providerId}`;
}

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
    return new Entry(KEYRING_SERVICE, account).getPassword() ?? null;
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
    new Entry(KEYRING_SERVICE, account).setPassword(key);
    return true;
  } catch (err) {
    diag?.(classifyKeyringError(err));
    return false;
  }
}

async function deleteKeyringAccount(account: string, diag?: (msg: string) => void): Promise<boolean> {
  try {
    const { Entry } = await import('@napi-rs/keyring');
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

  return readKeyringAccount(parsed.account, diag);
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

