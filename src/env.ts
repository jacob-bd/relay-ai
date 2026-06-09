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
const KEYRING_ACCOUNT = 'relay-ai';
const LEGACY_KEYRING_SERVICE = 'opencode-starter';
const LEGACY_KEYRING_ACCOUNT = 'opencode-starter';

export async function readFromCredentialStore(diag?: (msg: string) => void): Promise<string | null> {
  try {
    const { Entry } = await import('@napi-rs/keyring');
    const current = new Entry(KEYRING_SERVICE, KEYRING_ACCOUNT).getPassword();
    if (current) return current;
    return new Entry(LEGACY_KEYRING_SERVICE, LEGACY_KEYRING_ACCOUNT).getPassword() ?? null;
  } catch (err) {
    diag?.(classifyKeyringError(err));
    return null;
  }
}

export async function saveToCredentialStore(key: string, diag?: (msg: string) => void): Promise<boolean> {
  try {
    const { Entry } = await import('@napi-rs/keyring');
    new Entry(KEYRING_SERVICE, KEYRING_ACCOUNT).setPassword(key);
    return true;
  } catch (err) {
    diag?.(classifyKeyringError(err));
    return false;
  }
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

