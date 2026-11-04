import type { IncomingHttpHeaders } from 'node:http';

export interface CodexPoolIdentity { conversation: string; turn: string; }

const MAX_METADATA_BYTES = 8192;

function objectMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function parseMetadata(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'string' || Buffer.byteLength(value) > MAX_METADATA_BYTES) return undefined;
  try {
    return objectMetadata(JSON.parse(value) as unknown);
  } catch {
    return undefined;
  }
}

function identityFrom(metadata: Record<string, unknown> | undefined): CodexPoolIdentity | undefined {
  if (!metadata) return undefined;
  const valid = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256;
  if (!valid(metadata.session_id) || !valid(metadata.thread_id) || !valid(metadata.turn_id)) return undefined;
  const agent = metadata.agent_name;
  if (agent !== undefined && !valid(agent)) return undefined;
  const conversation = JSON.stringify([metadata.session_id, metadata.thread_id, agent ?? '']);
  return { conversation, turn: JSON.stringify([conversation, metadata.turn_id]) };
}

/**
 * Metadata is usable only behind the Relay-owned loopback proxy.
 *
 * HTTP sends it as a per-request header. WebSocket sets headers once at the
 * upgrade, so the turn identity for every later frame is carried in the request
 * body's client_metadata (session_id, thread_id, turn_id, plus an embedded
 * x-codex-turn-metadata copy on current Codex builds). Prefer the body when it
 * is present so a long-lived socket is keyed by the frame's turn, not the
 * handshake's.
 */
export function codexPoolIdentity(
  headers: IncomingHttpHeaders,
  body?: Record<string, unknown>,
): CodexPoolIdentity | undefined {
  const header = parseMetadata(headers['x-codex-turn-metadata']);
  const client = objectMetadata(body?.client_metadata);
  const embedded = parseMetadata(client?.['x-codex-turn-metadata']);
  for (const candidate of [embedded, client, header]) {
    const identity = identityFrom(candidate);
    if (identity) return identity;
  }
  return undefined;
}
