// responses-websocket.ts — outbound WebSocket transport for OpenAI's Codex
// "Responses-Lite" protocol (wss://chatgpt.com/backend-api/codex/responses).
//
// Some ChatGPT Codex models (flagged by the backend with prefer_websockets,
// e.g. gpt-5.6-luna) are only served over a WebSocket Responses transport, not
// the HTTP Responses endpoint. This module returns a `fetch` implementation that
// the Vercel AI SDK's OpenAI provider uses transparently: the SDK still calls
// `fetch(url, init)` once per request, but instead of an HTTP POST we open one
// WebSocket per request, send the Responses payload as the first message, and
// stream the JSON event frames back as Server-Sent Events the SDK already parses.
//
// One socket per request → responses are never crossed between concurrent
// requests (e.g. Claude Code's parallel title-generation + main inference).

import type { FetchFunction } from '@ai-sdk/provider-utils';
import type { RawData, WebSocket as WsWebSocket } from 'ws';
import { CODEX_RESPONSES_WEBSOCKETS_BETA } from '../constants.js';

const RESPONSES_LITE_HEADER = 'x-openai-internal-codex-responses-lite';
// Responses event types after which the stream is complete and the socket closes.
const TERMINAL_EVENT_TYPES = new Set(['response.completed', 'response.failed', 'response.incomplete', 'error']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function recordKeys(value: unknown): string {
  return isRecord(value) ? Object.keys(value).sort().join(',') : '';
}

/** Sanitized one-line summary: types, keys, counts, lengths — never field values. */
export function summarizeResponsesLiteEvent(event: unknown): string {
  if (!isRecord(event)) return `kind=${event == null ? 'null' : typeof event}`;
  const parts = [`type=${typeof event.type === 'string' ? event.type : 'unknown'}`, `keys=${recordKeys(event)}`];
  if (typeof event.delta === 'string') parts.push(`deltaChars=${event.delta.length}`);
  if (typeof event.output_index === 'number') parts.push(`hasOutputIndex=1`);
  if (typeof event.item_id === 'string') parts.push(`hasItemId=1`);
  if (isRecord(event.item)) {
    parts.push(`itemType=${typeof event.item.type === 'string' ? event.item.type : 'unknown'}`);
    parts.push(`itemKeys=${recordKeys(event.item)}`);
    if (typeof event.item.arguments === 'string') parts.push(`argumentsChars=${event.item.arguments.length}`);
  }
  if (isRecord(event.response)) {
    parts.push(`responseKeys=${recordKeys(event.response)}`);
    if (Array.isArray(event.response.output)) {
      parts.push(`outputCount=${event.response.output.length}`);
      parts.push(`outputTypes=${event.response.output.map(item => (isRecord(item) && typeof item.type === 'string' ? item.type : 'unknown')).join(',')}`);
    }
    if (isRecord(event.response.usage)) parts.push(`usageKeys=${recordKeys(event.response.usage)}`);
    if (typeof event.response.status === 'string') parts.push(`status=${event.response.status}`);
  }
  if (isRecord(event.error)) {
    parts.push(`errorKeys=${recordKeys(event.error)}`);
    if (typeof event.error.message === 'string') parts.push(`messageChars=${event.error.message.length}`);
  }
  return parts.join(' ');
}

export interface ResponsesLiteNormalizeState {
  nextId: number;
  lastMessageItemId?: string;
  lastFunctionItemId?: string;
  lastOutputIndex: number;
  textDeltaForwarded: boolean;
  messageAddedIds: Set<string>;
  messageDoneIds: Set<string>;
  functionAddedIndexes: Set<number>;
  functionDeltaIndexes: Set<number>;
  functionDoneCallIds: Set<string>;
}

export function createResponsesLiteNormalizeState(): ResponsesLiteNormalizeState {
  return {
    nextId: 1,
    lastOutputIndex: 0,
    textDeltaForwarded: false,
    messageAddedIds: new Set(),
    messageDoneIds: new Set(),
    functionAddedIndexes: new Set(),
    functionDeltaIndexes: new Set(),
    functionDoneCallIds: new Set(),
  };
}

function nextId(state: ResponsesLiteNormalizeState, prefix: string): string {
  const id = `${prefix}_${state.nextId}`;
  state.nextId += 1;
  return id;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function normalizeErrorEvent(event: Record<string, unknown>): Record<string, unknown> {
  const raw = isRecord(event.error) ? event.error : { message: typeof event.error === 'string' ? event.error : 'upstream error' };
  return {
    type: 'error',
    sequence_number: typeof event.sequence_number === 'number' ? event.sequence_number : 0,
    error: {
      type: asString(raw.type) ?? 'server_error',
      code: asString(raw.code) ?? 'unknown',
      message: asString(raw.message) ?? 'upstream error',
      ...(raw.param == null ? {} : { param: raw.param }),
    },
  };
}

function normalizeFunctionItem(item: Record<string, unknown>, state: ResponsesLiteNormalizeState, forDone = false): Record<string, unknown> {
  const callId = asString(item.call_id) ?? asString(item.id) ?? nextId(state, 'call');
  const id = asString(item.id) ?? nextId(state, 'fc');
  state.lastFunctionItemId = id;
  return {
    ...item,
    type: 'function_call',
    id,
    call_id: callId,
    name: asString(item.name) ?? '',
    arguments: typeof item.arguments === 'string' ? item.arguments : '',
    ...(forDone ? { status: 'completed' } : {}),
  };
}

function messageText(item: Record<string, unknown>): string {
  if (typeof item.text === 'string') return item.text;
  if (!Array.isArray(item.content)) return '';
  let out = '';
  for (const part of item.content) {
    if (isRecord(part) && typeof part.text === 'string' && (part.type === 'output_text' || part.type === 'text')) {
      out += part.text;
    }
  }
  return out;
}

function synthesizeMessage(item: Record<string, unknown>, outputIndex: number, state: ResponsesLiteNormalizeState): unknown[] {
  const text = messageText(item);
  if (!text) return [];
  const id = asString(item.id) ?? nextId(state, 'msg');
  state.lastMessageItemId = id;
  state.textDeltaForwarded = true;
  state.messageAddedIds.add(id);
  state.messageDoneIds.add(id);
  return [
    { type: 'response.output_item.added', output_index: outputIndex, item: { type: 'message', id } },
    { type: 'response.output_text.delta', item_id: id, delta: text },
    { type: 'response.output_item.done', output_index: outputIndex, item: { type: 'message', id } },
  ];
}

function synthesizeFunctionCall(item: Record<string, unknown>, outputIndex: number, state: ResponsesLiteNormalizeState): unknown[] {
  const normalized = normalizeFunctionItem(item, state);
  const callId = String(normalized.call_id);
  if (state.functionDoneCallIds.has(callId)) return [];
  const events: unknown[] = [];
  if (!state.functionAddedIndexes.has(outputIndex)) {
    events.push({
      type: 'response.output_item.added',
      output_index: outputIndex,
      item: { ...normalized, arguments: '' },
    });
    state.functionAddedIndexes.add(outputIndex);
  }
  if (!state.functionDeltaIndexes.has(outputIndex) && typeof normalized.arguments === 'string' && normalized.arguments.length > 0) {
    events.push({
      type: 'response.function_call_arguments.delta',
      item_id: normalized.id,
      output_index: outputIndex,
      delta: normalized.arguments,
    });
    state.functionDeltaIndexes.add(outputIndex);
  }
  events.push({
    type: 'response.output_item.done',
    output_index: outputIndex,
    item: { ...normalized, status: 'completed' },
  });
  state.functionDoneCallIds.add(callId);
  state.lastOutputIndex = outputIndex;
  return events;
}

function recoverFromCompletedOutput(response: Record<string, unknown>, state: ResponsesLiteNormalizeState): unknown[] {
  if (!Array.isArray(response.output)) return [];
  const recovered: unknown[] = [];
  response.output.forEach((item, index) => {
    if (!isRecord(item) || typeof item.type !== 'string') return;
    if (item.type === 'message' && !state.textDeltaForwarded) {
      recovered.push(...synthesizeMessage(item, index, state));
    } else if (item.type === 'function_call') {
      recovered.push(...synthesizeFunctionCall(item, index, state));
    }
  });
  return recovered;
}

/**
 * Fill fields `@ai-sdk/openai` requires and recover final output that only
 * exists on `response.completed`. Incomplete frames otherwise become
 * `unknown_chunk` and are dropped while usage still parses — the production
 * "empty response after N calls" shape.
 */
export function normalizeResponsesLiteEvent(event: unknown, state: ResponsesLiteNormalizeState): unknown[] {
  if (!isRecord(event) || typeof event.type !== 'string') return [event];

  if (event.type === 'error') return [normalizeErrorEvent(event)];

  if (event.type === 'response.output_item.added' && isRecord(event.item)) {
    const outputIndex = typeof event.output_index === 'number' ? event.output_index : state.lastOutputIndex;
    state.lastOutputIndex = outputIndex;
    if (event.item.type === 'message') {
      const id = asString(event.item.id) ?? nextId(state, 'msg');
      state.lastMessageItemId = id;
      state.messageAddedIds.add(id);
      return [{ ...event, output_index: outputIndex, item: { ...event.item, id } }];
    }
    if (event.item.type === 'function_call') {
      const item = normalizeFunctionItem(event.item, state);
      state.functionAddedIndexes.add(outputIndex);
      return [{ ...event, output_index: outputIndex, item }];
    }
    return [{ ...event, output_index: outputIndex }];
  }

  if (event.type === 'response.output_item.done' && isRecord(event.item)) {
    const outputIndex = typeof event.output_index === 'number' ? event.output_index : state.lastOutputIndex;
    if (event.item.type === 'function_call') {
      const item = normalizeFunctionItem(event.item, state, true);
      const callId = String(item.call_id);
      state.functionDoneCallIds.add(callId);
      return [{ ...event, output_index: outputIndex, item }];
    }
    if (event.item.type === 'message') {
      const id = asString(event.item.id) ?? state.lastMessageItemId ?? nextId(state, 'msg');
      state.lastMessageItemId = id;
      state.messageDoneIds.add(id);
      return [{ ...event, output_index: outputIndex, item: { ...event.item, id } }];
    }
    return [{ ...event, output_index: outputIndex }];
  }

  if (event.type === 'response.output_text.delta') {
    const itemId = asString(event.item_id) ?? state.lastMessageItemId ?? nextId(state, 'msg');
    state.lastMessageItemId = itemId;
    state.textDeltaForwarded = true;
    const events: unknown[] = [];
    if (!state.messageAddedIds.has(itemId)) {
      events.push({
        type: 'response.output_item.added',
        output_index: state.lastOutputIndex,
        item: { type: 'message', id: itemId },
      });
      state.messageAddedIds.add(itemId);
    }
    events.push({ ...event, item_id: itemId, delta: typeof event.delta === 'string' ? event.delta : '' });
    return events;
  }

  if (event.type === 'response.function_call_arguments.delta') {
    const itemId = asString(event.item_id) ?? state.lastFunctionItemId ?? nextId(state, 'fc');
    const outputIndex = typeof event.output_index === 'number' ? event.output_index : state.lastOutputIndex;
    state.lastFunctionItemId = itemId;
    state.lastOutputIndex = outputIndex;
    state.functionDeltaIndexes.add(outputIndex);
    return [{ ...event, item_id: itemId, output_index: outputIndex, delta: typeof event.delta === 'string' ? event.delta : '' }];
  }

  if (event.type === 'response.completed' || event.type === 'response.incomplete') {
    const response = isRecord(event.response) ? event.response : {};
    const recovered = recoverFromCompletedOutput(response, state);
    if (state.lastMessageItemId && state.textDeltaForwarded && !state.messageDoneIds.has(state.lastMessageItemId)) {
      recovered.push({
        type: 'response.output_item.done',
        output_index: state.lastOutputIndex,
        item: { type: 'message', id: state.lastMessageItemId },
      });
      state.messageDoneIds.add(state.lastMessageItemId);
    }
    return [...recovered, event];
  }

  return [event];
}

/** Normalize the SDK's HeadersInit into a plain lowercased-key record for `ws`. */
function toHeaderRecord(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  if (headers instanceof Headers) {
    headers.forEach((value, key) => { out[key] = value; });
  } else if (Array.isArray(headers)) {
    for (const [key, value] of headers) out[key] = value;
  } else {
    for (const [key, value] of Object.entries(headers)) out[key] = String(value);
  }
  return out;
}

function hasResponsesLiteHeader(headers: Record<string, string>): boolean {
  return Object.entries(headers).some(
    ([k, v]) => k.toLowerCase() === RESPONSES_LITE_HEADER && v.toLowerCase() === 'true',
  );
}

/** Extract the request body as a string (the SDK sends a JSON string). */
function bodyToString(body: BodyInit | null | undefined): string {
  if (body == null) return '';
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return Buffer.from(body).toString('utf8');
  if (body instanceof ArrayBuffer) return Buffer.from(new Uint8Array(body)).toString('utf8');
  return String(body);
}

/**
 * Apply the Responses-Lite request shape to the outgoing payload. These fields
 * are set on the wire (not via SDK providerOptions) so the transport fully owns
 * the Luna request shape. Adjust here if live traffic shows different field names.
 */
function applyResponsesLiteShape(payload: Record<string, unknown>): Record<string, unknown> {
  const reasoning = (payload.reasoning && typeof payload.reasoning === 'object')
    ? { ...(payload.reasoning as Record<string, unknown>) }
    : {};
  reasoning.context = 'all_turns';
  return {
    ...payload,
    reasoning,
    parallel_tool_calls: false,
    store: false,
  };
}

/**
 * Build a `fetch` that speaks the Codex Responses-Lite WebSocket protocol.
 * @param wsUrl e.g. wss://chatgpt.com/backend-api/codex/responses
 * @param log optional debug logger (wired to the proxy trace log under --trace)
 */
export function createResponsesWebSocketFetch(wsUrl: string, log?: (msg: string) => void): FetchFunction {
  const debug = (msg: string) => { try { log?.(`ws: ${msg}`); } catch { /* ignore */ } };
  return async (_input, init): Promise<Response> => {
    const { WebSocket } = await import('ws');

    const headers = toHeaderRecord(init?.headers);
    headers['OpenAI-Beta'] = CODEX_RESPONSES_WEBSOCKETS_BETA;
    debug(`connecting ${wsUrl} headers=[${Object.keys(headers).join(', ')}]`);

    // Parse the SDK-built Responses body and, when this is a Responses-Lite
    // model, fold in the transport-specific request fields.
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(bodyToString(init?.body)) as Record<string, unknown>;
    } catch {
      payload = {};
    }
    if (hasResponsesLiteHeader(headers)) {
      payload = applyResponsesLiteShape(payload);
    }
    debug(
      `request type=response.create keys=${Object.keys(payload).sort().join(',')} `
      + `toolCount=${Array.isArray(payload.tools) ? payload.tools.length : 0} `
      + `store=${String(payload.store)} parallelToolCalls=${String(payload.parallel_tool_calls)} `
      + `reasoningKeys=${recordKeys(payload.reasoning)}`,
    );
    // The Codex WS Responses protocol is internally tagged: the first (and only)
    // client message must be a `response.create` event carrying the Responses
    // body fields at the top level, alongside the type tag — not the raw body.
    // (See openai/codex `ResponsesWsRequest`, `#[serde(tag = "type")]`.)
    const outgoing = JSON.stringify({ type: 'response.create', ...payload });

    const encoder = new TextEncoder();
    let socket: WsWebSocket;
    let frameCount = 0;
    const normalizeState = createResponsesLiteNormalizeState();

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        const close = () => {
          if (closed) return;
          closed = true;
          try { controller.close(); } catch { /* already closed */ }
          try { socket.close(); } catch { /* ignore */ }
        };
        const fail = (message: string) => {
          if (closed) return;
          debug(`fail messageChars=${message.length}`);
          // Surface as an SSE error event the SDK's responses parser understands.
          try {
            const [errorEvent] = normalizeResponsesLiteEvent({ type: 'error', error: { message } }, normalizeState);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`));
          } catch { /* ignore */ }
          close();
        };

        socket = new WebSocket(wsUrl, { headers });

        socket.on('open', () => {
          debug(`open — sending ${outgoing.length}B payload`);
          socket.send(outgoing);
        });
        socket.on('unexpected-response', (_req, res) => {
          debug(`unexpected-response status=${res.statusCode}`);
        });

        socket.on('message', (data: RawData) => {
          const text = Array.isArray(data)
            ? Buffer.concat(data).toString('utf8')
            : data.toString('utf8');
          frameCount += 1;
          let event: unknown;
          try {
            event = JSON.parse(text);
          } catch {
            debug(`frame#${frameCount} non-json chars=${text.length}`);
            controller.enqueue(encoder.encode(`data: ${text.replace(/\r?\n/g, ' ')}\n\n`));
            return;
          }
          if (frameCount <= 8) debug(`frame#${frameCount} ${summarizeResponsesLiteEvent(event)}`);
          for (const next of normalizeResponsesLiteEvent(event, normalizeState)) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(next)}\n\n`));
          }
          const type = isRecord(event) && typeof event.type === 'string' ? event.type : undefined;
          if (type && TERMINAL_EVENT_TYPES.has(type)) {
            debug(`terminal event: ${type} (after ${frameCount} frames)`);
            close();
          }
        });

        socket.on('error', (err: Error) => fail(err.message));
        socket.on('close', (code: number, reason: Buffer) => {
          debug(`close code=${code} frames=${frameCount}${reason?.length ? ` reasonChars=${reason.length}` : ''}`);
          if (closed) return;
          if (code === 1000 || code === 1005) { close(); return; }
          fail(`WebSocket closed (${code})${reason?.length ? `: ${reason.toString('utf8')}` : ''}`);
        });

        const signal = init?.signal;
        if (signal) {
          if (signal.aborted) { close(); return; }
          signal.addEventListener('abort', close, { once: true });
        }
      },
      cancel() {
        try { socket?.close(); } catch { /* ignore */ }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    });
  };
}
