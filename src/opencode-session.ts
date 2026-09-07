import { randomUUID } from 'node:crypto';
import { VERSION } from './constants.js';

/** OpenCode Go rejects missing conversation identity on inference requests. */
export const OPENCODE_SESSION_HEADER = 'x-opencode-session';
/** OpenCode documents a 256-character limit for client supplied session IDs. */
export const MAX_OPENCODE_SESSION_LENGTH = 256;
/** User agent sent by Relay when it acts as the OpenCode Go client. */
export const RELAY_USER_AGENT = `relay-ai/${VERSION}`;

type HeaderValue = string | string[] | undefined;
export type HeaderMap = Record<string, HeaderValue> | Headers | undefined;

const NATIVE_CONVERSATION_HEADERS = [
  'x-claude-code-session-id',
  'session_id',
  'session-id',
  'x-session-id',
  'thread_id',
  'thread-id',
  'x-thread-id',
  'conversation_id',
  'conversation-id',
  'x-conversation-id',
] as const;

/**
 * Validate an opaque conversation identifier before putting it on an upstream
 * request. Header values are deliberately treated as data: no UUID format is
 * required, but whitespace, control characters, and oversized values are
 * rejected so a client cannot inject a second header or an invalid request.
 */
export function sanitizeSessionId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_OPENCODE_SESSION_LENGTH) return undefined;
  if (/[\u0000-\u001f\u007f\r\n]/.test(normalized)) return undefined;
  return normalized;
}

function headerValue(headers: HeaderMap, name: string): string | undefined {
  if (!headers) return undefined;
  if (headers instanceof Headers) {
    return sanitizeSessionId(headers.get(name));
  }

  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== lowerName) continue;
    const first = Array.isArray(value) ? value[0] : value;
    return sanitizeSessionId(first);
  }
  return undefined;
}

function metadataSessionId(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const record = body as Record<string, unknown>;
  const metadata = record.metadata;
  if (metadata && typeof metadata === 'object') {
    const metadataRecord = metadata as Record<string, unknown>;
    const direct = sanitizeSessionId(metadataRecord.session_id ?? metadataRecord.sessionId);
    if (direct) return direct;
    const userId = metadataRecord.user_id;
    if (typeof userId === 'string') {
      try {
        const parsed = JSON.parse(userId) as Record<string, unknown>;
        const parsedId = sanitizeSessionId(parsed.session_id ?? parsed.sessionId);
        if (parsedId) return parsedId;
      } catch {
        // Claude Code's metadata is JSON encoded. Invalid metadata is ignored.
      }
    }
  }

  return sanitizeSessionId(record.session_id ?? record.sessionId ?? record.thread_id ?? record.threadId);
}

/**
 * Resolve one stable conversation ID from a client request.
 *
 * Explicit `x-opencode-session` wins, followed by native session/thread IDs,
 * then Claude Code's JSON encoded metadata. Invalid values are ignored rather
 * than forwarded upstream.
 */
export function extractConversationId(headers: HeaderMap, body: unknown): string | undefined {
  const explicit = headerValue(headers, OPENCODE_SESSION_HEADER);
  if (explicit) return explicit;

  for (const name of NATIVE_CONVERSATION_HEADERS) {
    const native = headerValue(headers, name);
    if (native) return native;
  }

  return metadataSessionId(body);
}

/**
 * Identify OpenCode Go routes without treating unrelated `/go` paths as Go.
 * Registry provider ids are authoritative; the endpoint check covers imported
 * or custom registry entries whose provider id is not `go`.
 */
export function isOpenCodeGoEndpoint(providerId?: string, endpoint?: string): boolean {
  const id = providerId?.trim().toLowerCase();
  if (id === 'go' || id === 'opencode-go') return true;
  if (!endpoint) return false;

  try {
    const url = new URL(endpoint);
    if (url.hostname.toLowerCase() !== 'opencode.ai') return false;
    return url.pathname.split('/').some(segment => segment.toLowerCase() === 'go');
  } catch {
    return false;
  }
}

/** Merge two header maps while replacing existing names case-insensitively. */
export function mergeHeaders(
  base: Record<string, string> | undefined,
  overrides: Record<string, string> | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(base ?? {})) {
    if (typeof value === 'string') result[key] = value;
  }
  for (const [key, value] of Object.entries(overrides ?? {})) {
    for (const existing of Object.keys(result)) {
      if (existing.toLowerCase() === key.toLowerCase()) delete result[existing];
    }
    result[key] = value;
  }
  return result;
}

/**
 * Build per-call headers for an OpenCode Go route. Static provider headers are
 * retained, while Relay owns the user agent and session header.
 *
 * Console Go rejects any request that lacks `x-opencode-session`, including
 * clients' pre-conversation availability probes (e.g. Claude Desktop). When the
 * caller has no conversation id, a fresh per-request id is fabricated so the
 * request is accepted. A per-request id is unique, so it never blends two
 * conversations the way a shared per-process id would.
 *
 * `generateFallbackSession` defaults to true because every call site is
 * per-request except embedded Core, which reuses the returned model across
 * conversations and therefore opts out (a baked-in id would blend histories).
 */
export function openCodeGoHeaders(
  providerId: string | undefined,
  endpoint: string | undefined,
  sessionId: unknown,
  baseHeaders?: Record<string, string>,
  options?: { generateFallbackSession?: boolean },
): Record<string, string> | undefined {
  if (!isOpenCodeGoEndpoint(providerId, endpoint)) return undefined;
  let normalizedSessionId = sanitizeSessionId(sessionId);
  if (!normalizedSessionId && (options?.generateFallbackSession ?? true)) {
    normalizedSessionId = `relay-${randomUUID()}`;
  }
  return mergeHeaders(baseHeaders, {
    'User-Agent': RELAY_USER_AGENT,
    ...(normalizedSessionId ? { [OPENCODE_SESSION_HEADER]: normalizedSessionId } : {}),
  });
}
