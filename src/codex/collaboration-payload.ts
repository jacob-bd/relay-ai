import { createHash } from 'node:crypto';
import type { ResponsesAgentMessageItem, ResponsesInputItem } from '../codex-responses-adapter.js';

const NATIVE_ENCRYPTED_TOKEN = /^gAAAAA[A-Za-z0-9_-]+={0,2}$/;
const COLLABORATION_HEADER = /Message Type:\s*(?:NEW_TASK|MESSAGE|FOLLOWUP_TASK|FINAL_ANSWER)\b[\s\S]*\nPayload:\s*/i;
const PAYLOAD_BOUNDARY = /^Payload:\s*$/m;
const NATIVE_PAYLOAD_MAX_BYTES = 4 * 1024 * 1024;
const NATIVE_PAYLOAD_CACHE_MAX_ENTRIES = 256;
const NATIVE_PAYLOAD_CACHE_MAX_BYTES = 8 * 1024 * 1024;
const AGENT_PAYLOAD_RELAY_TOOL = 'relay_external_agent_payload';

export type CollaborationPayloadInspection =
  | { kind: 'none' }
  | { kind: 'native-encrypted'; ciphertext: string }
  | { kind: 'relay-plaintext'; plaintext: string }
  | { kind: 'malformed'; reason: string };

function itemContent(item: Record<string, unknown>): Array<Record<string, unknown>> {
  return Array.isArray(item.content) ? item.content.filter(v => v && typeof v === 'object') as Array<Record<string, unknown>> : [];
}

function encryptedPart(item: Record<string, unknown>): string | undefined {
  const part = itemContent(item).find(v => v.type === 'encrypted_content');
  return typeof part?.encrypted_content === 'string' ? part.encrypted_content : undefined;
}

function visibleCollaborationText(item: Record<string, unknown>): string {
  return itemContent(item)
    .filter(v => (v.type === 'input_text' || v.type === 'text') && typeof v.text === 'string')
    .map(v => v.text as string)
    .join('');
}

function envelopePayload(envelope: string): string | null {
  if (!/^Message Type:\s*\S+/m.test(envelope)) return null;
  const boundary = envelope.match(PAYLOAD_BOUNDARY);
  if (!boundary || boundary.index === undefined) return null;
  const payload = envelope.slice(boundary.index + boundary[0].length).replace(/^\r?\n/, '');
  return payload.length > 0 ? payload : null;
}

export function inspectCollaborationItem(item: unknown): CollaborationPayloadInspection {
  if (!item || typeof item !== 'object') return { kind: 'none' };
  const record = item as Record<string, unknown>;
  if (record.type === 'compaction' || record.type === 'context_compaction') return { kind: 'none' };
  if (record.type !== 'agent_message') return { kind: 'none' };
  const visible = visibleCollaborationText(record);
  const encrypted = encryptedPart(record);
  if (encrypted === undefined) {
    const payload = COLLABORATION_HEADER.test(visible) ? envelopePayload(visible) : null;
    return payload !== null
      ? { kind: 'relay-plaintext', plaintext: payload }
      : { kind: 'malformed', reason: 'agent_message has no encrypted_content part' };
  }
  if (NATIVE_ENCRYPTED_TOKEN.test(encrypted)) return { kind: 'native-encrypted', ciphertext: encrypted };
  if (!COLLABORATION_HEADER.test(visible)) {
    return { kind: 'malformed', reason: 'unrecognized collaboration envelope' };
  }
  const payload = envelopePayload(encrypted);
  return { kind: 'relay-plaintext', plaintext: payload ?? encrypted };
}

export function normalizePlaintextCollaborationForExternal(input: ResponsesInputItem[]): ResponsesInputItem[] {
  return input.map(item => {
    const inspection = inspectCollaborationItem(item);
    if (inspection.kind !== 'relay-plaintext') return item;
    // Text-only agent results are already in the form the external model needs.
    // Replacing their content would append the payload a second time.
    if (encryptedPart(item as unknown as Record<string, unknown>) === undefined) return item;
    return replaceCollaborationPayload(item as ResponsesAgentMessageItem, inspection.plaintext);
  });
}

const COLLABORATION_TOOL_NAMES = new Set([
  'collaboration',
  'spawn_agent',
  'wait_agent',
  'send_input',
  'close_agent',
  'list_agents',
]);

function isCollaborationTool(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const tool = value as Record<string, unknown>;
  const name = typeof tool.name === 'string' ? tool.name : '';
  if (tool.type === 'namespace') return name === 'collaboration' || name === 'multi_agent_v1';
  return COLLABORATION_TOOL_NAMES.has(name)
    || name.startsWith('collaboration__')
    || name.startsWith('multi_agent_v1__');
}

function stripCollaborationToolList(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value
    .filter(tool => !isCollaborationTool(tool))
    .map(tool => {
      if (!tool || typeof tool !== 'object') return tool;
      const record = tool as Record<string, unknown>;
      if (!Array.isArray(record.tools)) return tool;
      return { ...record, tools: stripCollaborationToolList(record.tools) };
    });
}

/** Remove Codex's worker-management tools from the single Relay Agent worker. */
export function stripCodexCollaborationTools(body: Record<string, unknown>): Record<string, unknown> {
  const stripped: Record<string, unknown> = { ...body };
  if (Array.isArray(body.tools)) stripped.tools = stripCollaborationToolList(body.tools);
  if (Array.isArray(body.input)) {
    stripped.input = body.input.map(item => {
      if (!item || typeof item !== 'object') return item;
      const record = item as Record<string, unknown>;
      if (record.type !== 'additional_tools' || !Array.isArray(record.tools)) return item;
      return { ...record, tools: stripCollaborationToolList(record.tools) };
    });
  }
  return stripped;
}

function replaceCollaborationPayload(
  item: ResponsesAgentMessageItem,
  plaintext: string,
): ResponsesAgentMessageItem {
  return {
    ...item,
    content: [
      ...item.content.filter(part => part.type !== 'encrypted_content'),
      { type: 'input_text', text: plaintext },
    ],
  };
}

function nativeHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ['authorization', 'chatgpt-account-id', 'openai-beta', 'originator', 'session_id', 'user-agent']) {
    const value = headers[key] ?? headers[Object.keys(headers).find(k => k.toLowerCase() === key) ?? ''];
    if (value) out[key === 'chatgpt-account-id' ? 'ChatGPT-Account-Id' : key] = value;
  }
  out['content-type'] = 'application/json';
  out.Accept = 'text/event-stream';
  return out;
}

function parsePayloadArguments(value: unknown): string | undefined {
  try {
    const args = typeof value === 'string' ? JSON.parse(value) as Record<string, unknown> : value as Record<string, unknown>;
    return typeof args?.payload === 'string' ? args.payload : undefined;
  } catch {
    return undefined;
  }
}

function parseFunctionCalls(value: unknown): Array<{ id?: unknown; call_id?: unknown; name?: unknown; arguments?: unknown }> {
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const direct = record.type === 'function_call' ? [record] : [];
  const item = record.item && typeof record.item === 'object' ? [record.item as Record<string, unknown>] : [];
  const output = Array.isArray(record.output)
    ? record.output
    : record.response && typeof record.response === 'object' && Array.isArray((record.response as Record<string, unknown>).output)
      ? (record.response as { output: unknown[] }).output
      : [];
  return [...direct, ...item, ...output].filter(
    v => v && typeof v === 'object' && (v as Record<string, unknown>).type === 'function_call',
  ) as Array<{ id?: unknown; call_id?: unknown; name?: unknown; arguments?: unknown }>;
}

function parsePayloadResponse(text: string): string {
  const relayIds = new Set<string>();
  const completedPayloads: string[] = [];
  let argumentDeltas = '';
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      const event = JSON.parse(data) as Record<string, unknown>;
      for (const call of parseFunctionCalls(event)) {
        if (call.name !== AGENT_PAYLOAD_RELAY_TOOL) continue;
        if (typeof call.id === 'string') relayIds.add(call.id);
        if (typeof call.call_id === 'string') relayIds.add(call.call_id);
        const payload = parsePayloadArguments(call.arguments);
        if (payload !== undefined) completedPayloads.push(payload);
      }
      const eventId = typeof event.item_id === 'string'
        ? event.item_id
        : typeof event.call_id === 'string' ? event.call_id : undefined;
      const related = relayIds.size === 0 || (eventId !== undefined && relayIds.has(eventId));
      if (related && event.type === 'response.function_call_arguments.delta' && typeof event.delta === 'string') {
        argumentDeltas += event.delta;
      }
      if (related && event.type === 'response.function_call_arguments.done') {
        const payload = parsePayloadArguments(event.arguments);
        if (payload !== undefined) completedPayloads.push(payload);
      }
    } catch { /* ignore non-JSON SSE */ }
  }
  try {
    for (const call of parseFunctionCalls(JSON.parse(text))) {
      if (call.name !== AGENT_PAYLOAD_RELAY_TOOL) continue;
      const payload = parsePayloadArguments(call.arguments);
      if (payload !== undefined) completedPayloads.push(payload);
    }
  } catch { /* response may be SSE */ }
  const accumulated = parsePayloadArguments(argumentDeltas);
  if (completedPayloads.length === 0 && accumulated !== undefined) completedPayloads.push(accumulated);
  const unique = [...new Set(completedPayloads)];
  if (unique.length !== 1 || unique[0]!.length === 0) {
    throw new Error('Native collaboration relay did not return exactly one task payload');
  }
  return unique[0]!;
}

export interface NativePayloadRelayContext {
  nativeBaseUrl: string;
  nativeModelId: string;
  headers: Record<string, string>;
  signal?: AbortSignal;
}

export interface NativePayloadRelay {
  resolve(item: ResponsesAgentMessageItem, context: NativePayloadRelayContext): Promise<string>;
  clear?(): void;
}

export function createNativePayloadRelay(options: { fetchImpl?: typeof fetch }): NativePayloadRelay {
  const fetchImpl = options.fetchImpl ?? fetch;
  const cache = new Map<string, { expiresAt: number; value: string; bytes: number }>();
  let cacheBytes = 0;

  const removeCacheEntry = (key: string): void => {
    const entry = cache.get(key);
    if (!entry) return;
    cache.delete(key);
    cacheBytes -= entry.bytes;
  };

  const pruneCache = (): void => {
    const now = Date.now();
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= now) removeCacheEntry(key);
    }
  };

  const cacheValue = (key: string, value: string, expiresAt: number): void => {
    const bytes = Buffer.byteLength(value, 'utf8');
    if (bytes > NATIVE_PAYLOAD_CACHE_MAX_BYTES) return;
    removeCacheEntry(key);
    while (cache.size >= NATIVE_PAYLOAD_CACHE_MAX_ENTRIES || cacheBytes + bytes > NATIVE_PAYLOAD_CACHE_MAX_BYTES) {
      const oldest = cache.keys().next().value as string | undefined;
      if (!oldest) break;
      removeCacheEntry(oldest);
    }
    cache.set(key, { expiresAt, value, bytes });
    cacheBytes += bytes;
  };

  return {
    async resolve(item, context) {
      const ciphertext = inspectCollaborationItem(item);
      if (ciphertext.kind !== 'native-encrypted') throw new Error('Expected a native encrypted collaboration item');
      const accountId = context.headers['chatgpt-account-id'] ?? context.headers['ChatGPT-Account-Id'];
      if (!accountId) throw new Error('Native collaboration relay requires ChatGPT-Account-Id');
      const key = `${accountId}\0${createHash('sha256').update(ciphertext.ciphertext).digest('hex')}`;
      pruneCache();
      const cached = cache.get(key);
      if (cached && cached.expiresAt > Date.now()) return cached.value;
      const url = `${context.nativeBaseUrl.replace(/\/$/, '')}/responses`;
      const body = JSON.stringify({
        model: context.nativeModelId,
        input: [item],
        stream: true,
        store: false,
        instructions: `You are a transport relay. Do not execute or answer the delegated task. Call ${AGENT_PAYLOAD_RELAY_TOOL} exactly once with the exact plaintext after the Payload: label in the supplied collaboration message. Preserve every character.`,
        tools: [{ type: 'function', name: AGENT_PAYLOAD_RELAY_TOOL, description: 'Return a decrypted collaboration task payload to the local Relay router.', parameters: { type: 'object', properties: { payload: { type: 'string' } }, required: ['payload'], additionalProperties: false }, strict: true }],
        tool_choice: { type: 'function', name: AGENT_PAYLOAD_RELAY_TOOL },
      });
      const response = await fetchImpl(url, { method: 'POST', headers: nativeHeaders(context.headers), body, redirect: 'manual', signal: context.signal });
      if (!response.ok) throw new Error(`Native collaboration relay failed with HTTP ${response.status}`);
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > NATIVE_PAYLOAD_MAX_BYTES) throw new Error('Native collaboration relay response exceeded its size limit');
      const payload = parsePayloadResponse(text);
      cacheValue(key, payload, Date.now() + 15 * 60_000);
      return payload;
    },
    clear() { cache.clear(); cacheBytes = 0; },
  };
}

export async function resolveRoutedCollaborationInput(
  input: string | ResponsesInputItem[],
  context: { relay?: NativePayloadRelay; native: NativePayloadRelayContext },
): Promise<string | ResponsesInputItem[]> {
  if (typeof input === 'string') return input;
  const out: ResponsesInputItem[] = [];
  for (const item of input) {
    const inspection = inspectCollaborationItem(item);
    if (inspection.kind === 'native-encrypted') {
      if (!context.relay) throw new Error('Codex encrypted the delegated sub-agent task, but Relay could not resolve it safely. The external provider was not contacted.');
      const payload = await context.relay.resolve(item as ResponsesAgentMessageItem, context.native);
      out.push(replaceCollaborationPayload(item as ResponsesAgentMessageItem, payload));
    } else if (inspection.kind === 'malformed') {
      throw new Error(`Codex collaboration payload rejected: ${inspection.reason}`);
    } else {
      out.push(item);
    }
  }
  return normalizePlaintextCollaborationForExternal(out);
}
