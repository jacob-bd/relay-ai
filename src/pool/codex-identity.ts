import type { IncomingHttpHeaders } from 'node:http';

export interface CodexPoolIdentity { conversation: string; turn: string; }
/** Metadata is usable only behind the authenticated loopback proxy. */
export function codexPoolIdentity(headers: IncomingHttpHeaders): CodexPoolIdentity | undefined {
  const raw = headers['x-codex-turn-metadata'];
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > 8192) return undefined;
  let metadata: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    metadata = parsed as Record<string, unknown>;
  } catch { return undefined; }
  const valid = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256;
  if (!valid(metadata.session_id) || !valid(metadata.thread_id) || !valid(metadata.turn_id)) return undefined;
  const agent = metadata.agent_name;
  if (agent !== undefined && !valid(agent)) return undefined;
  const conversation = JSON.stringify([metadata.session_id, metadata.thread_id, agent ?? '']);
  return { conversation, turn: JSON.stringify([conversation, metadata.turn_id]) };
}
