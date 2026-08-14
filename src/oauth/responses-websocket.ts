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

/**
 * Durable per-function-call state. Responses-Lite frames routinely omit `id`,
 * `arguments` and `status`, and can omit `item_id`/`output_index` on deltas —
 * so identity and accumulated arguments have to live here rather than being
 * re-derived from each frame in isolation.
 */
interface FunctionCallState {
  /** Stable item id reused across added → delta → done for this one call. */
  itemId: string;
  callId: string;
  name: string;
  /** Argument deltas appended in arrival order. */
  args: string;
  /** `arguments` as sent on an authoritative (done / completed.output) frame. */
  upstreamArgs?: string;
  /** Complete upstream item fields, merged across every frame that carried them. */
  upstream: Record<string, unknown>;
  outputIndex: number;
  /** An `output_item.added` has been emitted downstream for this call. */
  added: boolean;
  /** An argument delta has been forwarded downstream for this call. */
  deltaForwarded: boolean;
  /** Upstream sent an `output_item.done` for this call (even an incomplete one). */
  doneSeen: boolean;
  /** An authoritative `output_item.done` has been emitted downstream. */
  done: boolean;
}

export interface ResponsesLiteNormalizeState {
  nextId: number;
  lastMessageItemId?: string;
  lastOutputIndex: number;
  textDeltaForwarded: boolean;
  messageAddedIds: Set<string>;
  messageDoneIds: Set<string>;
  functionCalls: FunctionCallState[];
  /** Last function call touched — the only anchor a delta with no identity has. */
  lastFunctionCall?: FunctionCallState;
}

export function createResponsesLiteNormalizeState(): ResponsesLiteNormalizeState {
  return {
    nextId: 1,
    lastOutputIndex: 0,
    textDeltaForwarded: false,
    messageAddedIds: new Set(),
    messageDoneIds: new Set(),
    functionCalls: [],
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

interface FunctionCallHint {
  itemId?: string;
  callId?: string;
  outputIndex?: number;
}

/**
 * Find the call a frame belongs to, or start tracking a new one.
 *
 * Identity is checked strongest-first (`call_id`, then item id, then output
 * index). A frame carrying no identity at all belongs to the most recently
 * touched call. An output-index match is rejected when both sides know a
 * *different* `call_id`, so two calls can never merge.
 */
function resolveFunctionCall(state: ResponsesLiteNormalizeState, hint: FunctionCallHint): FunctionCallState {
  if (hint.callId) {
    const byCallId = state.functionCalls.find(entry => entry.callId === hint.callId);
    if (byCallId) return byCallId;
  }
  if (hint.itemId) {
    const byItemId = state.functionCalls.find(entry => entry.itemId === hint.itemId);
    if (byItemId) return byItemId;
  }
  if (hint.outputIndex !== undefined) {
    // An index can be reused across sequential calls, so it identifies at most
    // the call *currently open* at that index. Search newest-first and prefer a
    // call that has not completed — matching the oldest entry would send a
    // second call's argument deltas to the first one.
    const open = [...state.functionCalls].reverse().find(entry => (
      entry.outputIndex === hint.outputIndex
      && !entry.done
      && !(hint.callId && entry.callId !== hint.callId)
    ));
    if (open) return open;
  }
  if (hint.callId === undefined && hint.itemId === undefined && hint.outputIndex === undefined && state.lastFunctionCall) {
    return state.lastFunctionCall;
  }
  const entry: FunctionCallState = {
    itemId: hint.itemId ?? nextId(state, 'fc'),
    callId: hint.callId ?? hint.itemId ?? nextId(state, 'call'),
    name: '',
    args: '',
    upstream: {},
    outputIndex: hint.outputIndex ?? state.lastOutputIndex,
    added: false,
    deltaForwarded: false,
    doneSeen: false,
    done: false,
  };
  state.functionCalls.push(entry);
  return entry;
}

/** Fold whatever this frame's item did carry into the call's durable state. */
function absorbFunctionItem(entry: FunctionCallState, item: Record<string, unknown>, authoritative: boolean): void {
  entry.upstream = { ...entry.upstream, ...item };
  const name = asString(item.name);
  if (name) entry.name = name;
  const callId = asString(item.call_id);
  if (callId) entry.callId = callId;
  // `added` carries `arguments: ''` as a placeholder — only done/completed items
  // are authoritative about the final argument string.
  if (authoritative && typeof item.arguments === 'string') entry.upstreamArgs = item.arguments;
}

/** The argument string to complete this call with, or undefined if unknowable. */
function resolveFunctionArgs(entry: FunctionCallState): string | undefined {
  if (entry.upstreamArgs) return entry.upstreamArgs;
  if (entry.args) return entry.args;
  return entry.upstreamArgs;
}

function functionItemPayload(entry: FunctionCallState, extra: Record<string, unknown>): Record<string, unknown> {
  return {
    ...entry.upstream,
    type: 'function_call',
    id: entry.itemId,
    call_id: entry.callId,
    name: entry.name,
    ...extra,
  };
}

function functionAddedEvent(entry: FunctionCallState): Record<string, unknown> {
  entry.added = true;
  return {
    type: 'response.output_item.added',
    output_index: entry.outputIndex,
    item: functionItemPayload(entry, { arguments: '' }),
  };
}

function functionDoneEvent(entry: FunctionCallState, args: string): Record<string, unknown> {
  entry.done = true;
  return {
    type: 'response.output_item.done',
    output_index: entry.outputIndex,
    item: functionItemPayload(entry, { arguments: args, status: 'completed' }),
  };
}

/**
 * Emit the added/delta/done triplet a call still owes, using its retained
 * identity and arguments. Returns nothing when the call is already complete —
 * that is what keeps `response.completed` recovery from duplicating a tool call.
 */
function completeFunctionCall(entry: FunctionCallState, args: string): unknown[] {
  if (entry.done) return [];
  const events: unknown[] = [];
  if (!entry.added) events.push(functionAddedEvent(entry));
  if (!entry.deltaForwarded && args.length > 0) {
    entry.deltaForwarded = true;
    events.push({
      type: 'response.function_call_arguments.delta',
      item_id: entry.itemId,
      output_index: entry.outputIndex,
      delta: args,
    });
  }
  events.push(functionDoneEvent(entry, args));
  return events;
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
  const entry = resolveFunctionCall(state, {
    itemId: asString(item.id),
    callId: asString(item.call_id),
    outputIndex,
  });
  absorbFunctionItem(entry, item, true);
  state.lastFunctionCall = entry;
  state.lastOutputIndex = entry.outputIndex;
  const args = resolveFunctionArgs(entry);
  if (args === undefined) {
    // `completed.output` is authoritative for identity but still omitted the
    // arguments. Defaulting to `""` here would fabricate the very call the
    // deferral path exists to avoid — mark it seen so it is reported instead.
    entry.doneSeen = true;
    return [];
  }
  return completeFunctionCall(entry, args);
}

function recoverFromCompletedOutput(response: Record<string, unknown>, state: ResponsesLiteNormalizeState): unknown[] {
  const recovered: unknown[] = [];
  if (Array.isArray(response.output)) {
    response.output.forEach((item, index) => {
      if (!isRecord(item) || typeof item.type !== 'string') return;
      if (item.type === 'message' && !state.textDeltaForwarded) {
        recovered.push(...synthesizeMessage(item, index, state));
      } else if (item.type === 'function_call') {
        recovered.push(...synthesizeFunctionCall(item, index, state));
      }
    });
  }
  // Upstream said these calls were done but never supplied arguments, and
  // `response.completed` did not repeat them either. There is no honest
  // completion available: `arguments: ""` is not valid JSON and would recreate
  // the empty-argument tool call this normalization exists to prevent. Report
  // the malformed stream instead of inventing one.
  for (const entry of state.functionCalls) {
    if (entry.done || !entry.doneSeen) continue;
    recovered.push(normalizeErrorEvent({
      error: {
        type: 'invalid_response',
        code: 'incomplete_function_call',
        message: `Provider ended the response without arguments for function call "${entry.callId}"`
          + `${entry.name ? ` (${entry.name})` : ''}.`,
      },
    }));
  }
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
      const entry = resolveFunctionCall(state, {
        itemId: asString(event.item.id),
        callId: asString(event.item.call_id),
        outputIndex,
      });
      absorbFunctionItem(entry, event.item, false);
      entry.outputIndex = outputIndex;
      entry.added = true;
      state.lastFunctionCall = entry;
      return [{ ...event, output_index: outputIndex, item: functionItemPayload(entry, { arguments: '' }) }];
    }
    return [{ ...event, output_index: outputIndex }];
  }

  if (event.type === 'response.output_item.done' && isRecord(event.item)) {
    const outputIndex = typeof event.output_index === 'number' ? event.output_index : state.lastOutputIndex;
    if (event.item.type === 'function_call') {
      const entry = resolveFunctionCall(state, {
        itemId: asString(event.item.id),
        callId: asString(event.item.call_id),
        outputIndex,
      });
      absorbFunctionItem(entry, event.item, true);
      entry.outputIndex = outputIndex;
      entry.doneSeen = true;
      state.lastFunctionCall = entry;
      state.lastOutputIndex = outputIndex;
      const args = resolveFunctionArgs(entry);
      // Nothing to complete with, and no name to complete under: defer to the
      // authoritative `response.completed.output` instead of fabricating a call.
      if (args === undefined || !entry.name) return [];
      if (entry.done) return [];
      const events: unknown[] = [];
      if (!entry.added) events.push(functionAddedEvent(entry));
      events.push({ ...event, output_index: outputIndex, item: functionItemPayload(entry, { arguments: args, status: 'completed' }) });
      entry.done = true;
      return events;
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
    const entry = resolveFunctionCall(state, {
      itemId: asString(event.item_id),
      outputIndex: typeof event.output_index === 'number' ? event.output_index : undefined,
    });
    const delta = typeof event.delta === 'string' ? event.delta : '';
    entry.args += delta;
    entry.deltaForwarded = true;
    state.lastFunctionCall = entry;
    state.lastOutputIndex = entry.outputIndex;
    return [{ ...event, item_id: entry.itemId, output_index: entry.outputIndex, delta }];
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
