// src/oauth/claude-identity.ts — Request identity simulation for Claude Code OAuth.
// Anthropic validates that OAuth requests match the claude-cli fingerprint.

import { createHash, randomUUID } from 'node:crypto';

export const CLAUDE_CODE_CLI_VERSION = '2.1.187';
export const CLAUDE_CODE_USER_AGENT = `claude-cli/${CLAUDE_CODE_CLI_VERSION} (external, cli)`;

// Per-process session IDs keyed by seed — same value emitted for X-Claude-Code-Session-Id
// and metadata.user_id.session_id.
const sessionCache = new Map<string, string>();

function getOrCreateSessionId(seed: string): string {
  let id = sessionCache.get(seed);
  if (!id) { id = randomUUID(); sessionCache.set(seed, id); }
  return id;
}

// Deterministic UUIDv4 from a SHA-256 hash — used as fallback when bootstrap hasn't run.
function uuidFromHash(input: string): string {
  const h = createHash('sha256').update(input).digest('hex');
  return [h.slice(0,8), h.slice(8,12), '4'+h.slice(13,16),
    ((parseInt(h[16]!,16)&3)|8).toString(16)+h.slice(17,20), h.slice(20,32)].join('-');
}

const HEX64_RE = /^[a-f0-9]{64}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolve cliUserID (device_id) from stored providerData, falling back to a hash. */
export function resolveCliUserID(
  providerData: Record<string, unknown> | undefined,
  seed: string,
): string {
  const v = providerData?.cliUserID;
  if (typeof v === 'string' && HEX64_RE.test(v)) return v;
  return createHash('sha256').update(`cliUserID:${seed}`).digest('hex');
}

/** Resolve accountUUID from stored providerData, falling back to a deterministic UUID. */
export function resolveAccountUUID(
  providerData: Record<string, unknown> | undefined,
  seed: string,
): string {
  const v = providerData?.accountUUID;
  if (typeof v === 'string' && UUID_RE.test(v)) return v;
  return uuidFromHash(`account:${seed}`);
}

export function buildUserIdJson(deviceId: string, accountUUID: string, sessionId: string): string {
  return JSON.stringify({ device_id: deviceId, account_uuid: accountUUID, session_id: sessionId });
}

// ── Beta flag selection ────────────────────────────────────────────────────
// Anthropic validates the anthropic-beta set matches the request shape.

const ALWAYS: string[] = [
  'oauth-2025-04-20',
  'context-management-2025-06-27',
  'prompt-caching-scope-2026-01-05',
];
const AGENT: string[] = [
  'claude-code-20250219',
  'extended-cache-ttl-2025-04-11',
  'cache-diagnosis-2026-04-07',
  'advisor-tool-2026-03-01',
];
const THINKING: string[] = [
  'interleaved-thinking-2025-05-14',
  'redact-thinking-2026-02-12',
  'thinking-token-count-2026-05-13',
];
const HEAVY: string[] = ['advanced-tool-use-2025-11-20', 'effort-2025-11-24'];
const OPUS_ONLY: string[] = ['context-1m-2025-08-07', 'mid-conversation-system-2026-04-07'];

/**
 * Select anthropic-beta flags matching the request shape.
 * clientBeta: the inbound anthropic-beta header from the client — respected to avoid
 * forcing betas the client never requested (can cause malformed tool_use streams).
 */
export function selectBetaFlags(
  body: Record<string, unknown>,
  model?: string | null,
  clientBeta?: string | null,
): string {
  const hasSystem = !!body.system &&
    (typeof body.system === 'string' || (Array.isArray(body.system) && body.system.length > 0));
  const tools = body.tools as unknown[] | undefined;
  const isFullAgent = hasSystem && Array.isArray(tools) && tools.length > 0;
  const m = (model ?? (typeof body.model === 'string' ? body.model : '')).toLowerCase();
  const isOpus = m.includes('opus');
  const isSonnetOrOpus = isOpus || m.includes('sonnet');

  const clientSet = clientBeta
    ? new Set(clientBeta.split(',').map(s => s.trim()).filter(Boolean))
    : null;
  const allowThinking = !clientSet || clientSet.has('interleaved-thinking-2025-05-14');
  const allowHeavy = !clientSet
    || clientSet.has('advanced-tool-use-2025-11-20')
    || clientSet.has('effort-2025-11-24');

  const flags = [...ALWAYS];
  if (isFullAgent) flags.push(...AGENT);
  if (isOpus) flags.push(...OPUS_ONLY);
  if (allowThinking) flags.push(...THINKING);
  if (isFullAgent && isSonnetOrOpus && allowHeavy) flags.push(...HEAVY);

  return flags.join(',');
}

/**
 * Inject Claude Code identity metadata into an Anthropic request body in-place.
 * Must be called before forwarding the request to api.anthropic.com.
 */
export function injectClaudeIdentity(
  body: Record<string, unknown>,
  providerData: Record<string, unknown> | undefined,
  seed: string,
): void {
  const deviceId = resolveCliUserID(providerData, seed);
  const accountUUID = resolveAccountUUID(providerData, seed);
  const sessionId = getOrCreateSessionId(seed);
  const userId = buildUserIdJson(deviceId, accountUUID, sessionId);
  const existing = body.metadata as Record<string, unknown> | undefined;
  body.metadata = { ...(existing ?? {}), user_id: userId };
}
