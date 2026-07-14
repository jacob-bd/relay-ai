// responses-websocket.ts — persistent outbound WebSocket transport for OpenAI's
// ChatGPT/Codex Responses backend.
//
// The Vercel AI SDK still sees a fetch-like SSE response per model call. Behind
// that interface, relay-ai retains one sequential WebSocket chain per opaque
// Claude session/model/effort/account partition and uses previous_response_id
// only after proving the next translated conversation appends to the chain head.

import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { FetchFunction } from '@ai-sdk/provider-utils';
import type { RawData, WebSocket as WsWebSocket } from 'ws';
import { CODEX_RESPONSES_WEBSOCKETS_BETA } from '../constants.js';

const RESPONSES_LITE_HEADER = 'x-openai-internal-codex-responses-lite';
const TERMINAL_EVENT_TYPES = new Set(['response.completed', 'response.failed', 'response.incomplete']);
const FAILURE_EVENT_TYPES = new Set(['error', 'response.failed', 'response.incomplete']);

export const RESPONSES_WS_HARD_TTL_MS = 55 * 60_000;
export const RESPONSES_WS_IDLE_TTL_MS = 30 * 60_000;
export const RESPONSES_WS_NURSERY_IDLE_TTL_MS = 5 * 60_000;
export const RESPONSES_WS_MAX_CONNECTIONS = 32;
export const RESPONSES_WS_MAX_NURSERY_CONNECTIONS = 8;

export interface ResponsesWebSocketFetchOptions {
  providerId?: string;
  accountId?: string;
  /** Test overrides; production callers should leave these unset. */
  hardTtlMs?: number;
  idleTtlMs?: number;
  nurseryIdleTtlMs?: number;
  maxConnections?: number;
  maxNurseryConnections?: number;
  now?: () => number;
  /** Opt-in structured transport diagnostics; never receives conversation content. */
  onDiagnostic?: (event: ResponsesWebSocketDiagnosticEvent) => void;
}

export interface ResponsesWebSocketDiagnosticEvent extends Record<string, unknown> {
  event: string;
  requestId?: string;
}

export interface ResponsesWebSocketDiagnosticContext {
  requestId?: string;
}

const diagnosticContext = new AsyncLocalStorage<ResponsesWebSocketDiagnosticContext>();

/** Correlate a gateway/proxy request with the lower-level SDK WebSocket fetch. */
export function withResponsesWebSocketDiagnosticContext<T>(
  context: ResponsesWebSocketDiagnosticContext,
  fn: () => T,
): T {
  return diagnosticContext.run(context, fn);
}

type JsonObject = Record<string, unknown>;

interface OutputAccumulator {
  type?: string;
  itemId?: string;
  text: string;
  summaries: Map<number, string>;
  done?: JsonObject;
}

interface RequestContext {
  controller: ReadableStreamDefaultController<Uint8Array>;
  encoder: TextEncoder;
  originalPayload: JsonObject;
  sendPayload: JsonObject;
  promptFieldHashes: Record<string, string>;
  instructionsSnapshot?: string;
  continued: boolean;
  retried: boolean;
  closed: boolean;
  frameCount: number;
  responseId?: string;
  pendingEvents: unknown[];
  emittedModelData: boolean;
  outputByIndex: Map<number, OutputAccumulator>;
  outputIndexByItemId: Map<string, number>;
  emitDiagnostic?: (event: { event: string } & Record<string, unknown>) => void;
  entry?: ConnectionEntry;
  createReplacement: () => ConnectionEntry;
  abortCleanup?: () => void;
}

interface ConnectionEntry {
  debugId: number;
  key?: string;
  socket: WsWebSocket;
  persistent: boolean;
  generation: 'nursery' | 'established' | 'isolated';
  open: boolean;
  createdAt: number;
  ttlPausedMs: number;
  inFlightStartedAt?: number;
  lastUsedAt: number;
  inFlight: boolean;
  current?: RequestContext;
  promptFieldHashes?: Record<string, string>;
  instructionsSnapshot?: string;
  responseId?: string;
  requestInput?: unknown[];
  expectedAssistant?: unknown[];
  options: Required<Pick<ResponsesWebSocketFetchOptions, 'hardTtlMs' | 'idleTtlMs' | 'nurseryIdleTtlMs' | 'maxConnections' | 'now'>>;
  debug: (message: string) => void;
}

// A Claude session partition can have multiple valid conversation heads at
// once: rewinds/branches, hidden title-generation requests, and stop hooks can
// all share its model/effort/cache key. Retain each head and select by exact
// conversation prefix instead of letting the newest branch replace the rest.
// New heads live in a separately capped nursery LRU until their first reuse;
// established heads therefore never consume nursery capacity, and one-shot
// nursery traffic never consumes the established LRU's 32 reserved slots.
const connections = new Map<string, Set<ConnectionEntry>>();
let nextConnectionDebugId = 1;

function connectionEntries(key?: string): ConnectionEntry[] {
  return key ? [...(connections.get(key) ?? [])] : [...connections.values()].flatMap(entries => [...entries]);
}

function connectionCount(): number {
  let count = 0;
  for (const entries of connections.values()) count += entries.size;
  return count;
}

function connectionCountByGeneration(generation: ConnectionEntry['generation']): number {
  return connectionEntries().filter(entry => entry.generation === generation).length;
}

function registerEntry(entry: ConnectionEntry): void {
  if (!entry.key) return;
  let entries = connections.get(entry.key);
  if (!entries) {
    entries = new Set();
    connections.set(entry.key, entries);
  }
  entries.add(entry);
}

function unregisterEntry(entry: ConnectionEntry): void {
  if (!entry.key) return;
  const entries = connections.get(entry.key);
  if (!entries) return;
  entries.delete(entry);
  if (entries.size === 0) connections.delete(entry.key);
}

function debugKey(key: string | undefined): string {
  return key ? key.slice(0, 12) : 'none';
}

function emitDiagnostic(
  options: ResponsesWebSocketFetchOptions,
  event: { event: string } & Record<string, unknown>,
  correlatedRequestId = diagnosticContext.getStore()?.requestId,
): void {
  if (!options.onDiagnostic) return;
  try {
    options.onDiagnostic({ ...event, ...(correlatedRequestId ? { requestId: correlatedRequestId } : {}) });
  } catch {
    // Diagnostics must never alter inference behavior.
  }
}

/** Test-only cleanup, also useful for preventing leaked fake sockets. */
export function resetResponsesWebSocketConnectionsForTests(): void {
  for (const entry of connectionEntries()) {
    try { entry.socket.close(); } catch { /* ignore */ }
  }
  connections.clear();
  nextConnectionDebugId = 1;
}

/** Normalize the SDK's HeadersInit into a plain record for `ws`. */
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
    ([key, value]) => key.toLowerCase() === RESPONSES_LITE_HEADER && value.toLowerCase() === 'true',
  );
}

function bodyToString(body: BodyInit | null | undefined): string {
  if (body == null) return '';
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return Buffer.from(body).toString('utf8');
  if (body instanceof ArrayBuffer) return Buffer.from(new Uint8Array(body)).toString('utf8');
  return String(body);
}

function applyResponsesLiteShape(payload: JsonObject): JsonObject {
  const reasoning = payload.reasoning && typeof payload.reasoning === 'object'
    ? { ...(payload.reasoning as JsonObject) }
    : {};
  reasoning.context = 'all_turns';
  return { ...payload, reasoning, parallel_tool_calls: false, store: false };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  const out: JsonObject = {};
  for (const key of Object.keys(value as JsonObject).sort()) {
    const child = (value as JsonObject)[key];
    if (child !== undefined) out[key] = canonicalize(child);
  }
  return out;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** Fingerprint non-conversation request fields for privacy-safe diagnostics. */
export function responsesWebSocketPromptFingerprint(payload: JsonObject): string {
  const stable = { ...payload };
  delete stable.input;
  delete stable.previous_response_id;
  delete stable.stream;
  delete stable.background;
  return createHash('sha256').update(canonicalJson(stable)).digest('hex');
}

function responsesWebSocketPromptFieldHashes(payload: JsonObject): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const key of Object.keys(payload).sort()) {
    if (key === 'input' || key === 'previous_response_id' || key === 'stream' || key === 'background') continue;
    hashes[key] = createHash('sha256').update(canonicalJson(payload[key])).digest('hex').slice(0, 12);
  }
  return hashes;
}

function changedPromptFields(
  previous: Record<string, string> | undefined,
  current: Record<string, string>,
): string[] {
  if (!previous) return [];
  return [...new Set([...Object.keys(previous), ...Object.keys(current)])]
    .filter(key => previous[key] !== current[key])
    .sort();
}

function instructionsFromPayload(payload: JsonObject): string | undefined {
  return typeof payload.instructions === 'string' ? payload.instructions : undefined;
}

function instructionChangeSummary(previous: string | undefined, current: string | undefined): string | undefined {
  if (previous === undefined || current === undefined || previous === current) return undefined;
  const comparable = Math.min(previous.length, current.length);
  let prefix = 0;
  while (prefix < comparable && previous[prefix] === current[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < comparable - prefix
    && previous[previous.length - 1 - suffix] === current[current.length - 1 - suffix]
  ) suffix += 1;
  const firstDiffLine = previous.slice(0, prefix).split('\n').length;
  return `instructions changed: previous_chars=${previous.length} current_chars=${current.length} common_prefix_chars=${prefix} common_suffix_chars=${suffix} first_diff_line=${firstDiffLine}`;
}

/**
 * Opaque socket partition key. Prompt fields intentionally are not part of this
 * key: Responses accepts fresh instructions/tools on each create, and Claude can
 * change them during a normal tool loop. Exact conversation lineage is validated
 * separately before previous_response_id is used.
 */
export function responsesWebSocketPartitionKey(
  wsUrl: string,
  payload: JsonObject,
  options: Pick<ResponsesWebSocketFetchOptions, 'providerId' | 'accountId'> = {},
): string | undefined {
  const promptCacheKey = payload.prompt_cache_key;
  const model = payload.model;
  if (typeof promptCacheKey !== 'string' || !promptCacheKey || typeof model !== 'string' || !model) return undefined;
  const reasoning = payload.reasoning && typeof payload.reasoning === 'object'
    ? payload.reasoning as JsonObject
    : undefined;
  const effort = typeof reasoning?.effort === 'string' ? reasoning.effort.trim().toLowerCase() : '';
  const material = [
    wsUrl,
    options.providerId ?? 'openai',
    options.accountId ?? '',
    model,
    effort,
    promptCacheKey,
  ].join('\x1f');
  return createHash('sha256').update(material).digest('hex');
}

function inputArray(payload: JsonObject): unknown[] {
  return Array.isArray(payload.input) ? payload.input : [];
}

function normalizeToolCallJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeToolCallJson);
  if (!value || typeof value !== 'object') return value;
  const record = value as JsonObject;
  const out: JsonObject = {};
  for (const [key, child] of Object.entries(record)) out[key] = normalizeToolCallJson(child);

  // Claude parses tool_use input into an object. The OpenAI SDK later serializes
  // it again, so insignificant whitespace and object-key order can differ from
  // the model's original function-call argument string. Compare the JSON value,
  // while leaving message text and function_call_output strings exact.
  const jsonField = record.type === 'function_call'
    ? 'arguments'
    : record.type === 'custom_tool_call' ? 'input' : undefined;
  if (jsonField && typeof record[jsonField] === 'string') {
    try {
      out[jsonField] = canonicalJson(JSON.parse(record[jsonField] as string));
    } catch {
      // A malformed/non-JSON custom-tool input must still match byte-for-byte.
    }
  }
  return out;
}

function arraysEqual(left: unknown[], right: unknown[]): boolean {
  return canonicalJson(normalizeToolCallJson(left)) === canonicalJson(normalizeToolCallJson(right));
}

type ContinuationMatchMode = 'exact' | 'omitted_reasoning';

interface ContinuationMatch {
  delta: unknown[];
  mode: ContinuationMatchMode;
}

function conversationItemKind(value: unknown): string {
  if (!value || typeof value !== 'object') return typeof value;
  const record = value as JsonObject;
  if (typeof record.type === 'string') return record.type;
  if (typeof record.role === 'string') return record.role;
  return 'object';
}

function conversationItemHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(normalizeToolCallJson(value))).digest('hex').slice(0, 16);
}

function continuationMismatchDetails(entry: ConnectionEntry, payload: JsonObject): Record<string, unknown> {
  const full = inputArray(payload);
  const prefix = [...(entry.requestInput ?? []), ...(entry.expectedAssistant ?? [])];
  const comparable = Math.min(full.length, prefix.length);
  let mismatch = comparable;
  for (let index = 0; index < comparable; index += 1) {
    if (!arraysEqual([full[index]], [prefix[index]])) {
      mismatch = index;
      break;
    }
  }
  const expected = mismatch < prefix.length ? prefix[mismatch] : undefined;
  const actual = mismatch < full.length ? full[mismatch] : undefined;
  return {
    fullItems: full.length,
    expectedPrefixItems: prefix.length,
    firstMismatch: mismatch,
    expectedKind: expected === undefined ? 'none' : conversationItemKind(expected),
    actualKind: actual === undefined ? 'none' : conversationItemKind(actual),
    ...(expected !== undefined ? { expectedHash: conversationItemHash(expected) } : {}),
    ...(actual !== undefined ? { actualHash: conversationItemHash(actual) } : {}),
  };
}

function continuationMismatchSummary(entry: ConnectionEntry, payload: JsonObject): string {
  const details = continuationMismatchDetails(entry, payload);
  return `full_items=${details.fullItems} expected_prefix_items=${details.expectedPrefixItems} `
    + `first_mismatch=${details.firstMismatch} expected=${details.expectedKind} actual=${details.actualKind}`;
}

function continuationMatch(entry: ConnectionEntry, payload: JsonObject): ContinuationMatch | undefined {
  if (!entry.responseId || !entry.requestInput || !entry.expectedAssistant) return undefined;
  const full = inputArray(payload);
  const exactPrefix = [...entry.requestInput, ...entry.expectedAssistant];
  if (full.length > exactPrefix.length && arraysEqual(full.slice(0, exactPrefix.length), exactPrefix)) {
    return { delta: full.slice(exactPrefix.length), mode: 'exact' };
  }

  // Claude does not always echo an OpenAI reasoning item back into its
  // Anthropic-format history, even though it faithfully echoes the function
  // call or assistant text that followed it. The omitted reasoning already
  // belongs to previous_response_id, so it is safe to continue only when the
  // remaining response items still match exactly.
  const echoedAssistant = entry.expectedAssistant.filter(item => conversationItemKind(item) !== 'reasoning');
  if (echoedAssistant.length === entry.expectedAssistant.length) return undefined;
  const echoablePrefix = [...entry.requestInput, ...echoedAssistant];
  if (full.length <= echoablePrefix.length || !arraysEqual(full.slice(0, echoablePrefix.length), echoablePrefix)) {
    return undefined;
  }
  return { delta: full.slice(echoablePrefix.length), mode: 'omitted_reasoning' };
}

function eventType(event: unknown): string | undefined {
  return event && typeof event === 'object' && typeof (event as JsonObject).type === 'string'
    ? (event as JsonObject).type as string
    : undefined;
}

function responseErrorCode(event: unknown): string | undefined {
  if (!event || typeof event !== 'object') return undefined;
  const record = event as JsonObject;
  if (typeof record.code === 'string') return record.code;
  const error = record.error && typeof record.error === 'object' ? record.error as JsonObject : undefined;
  if (typeof error?.code === 'string') return error.code;
  const response = record.response && typeof record.response === 'object' ? record.response as JsonObject : undefined;
  const responseError = response?.error && typeof response.error === 'object' ? response.error as JsonObject : undefined;
  return typeof responseError?.code === 'string' ? responseError.code : undefined;
}

function boundedDiagnosticIdentifier(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized && /^[a-zA-Z0-9_.:/-]+$/.test(normalized)
    ? normalized.slice(0, 128)
    : undefined;
}

function diagnosticTextFingerprint(
  field: 'errorMessage' | 'closeReason',
  value: unknown,
): Record<string, unknown> {
  if (typeof value !== 'string' || value.length === 0) return {};
  return {
    [`${field}Bytes`]: Buffer.byteLength(value),
    [`${field}Hash`]: createHash('sha256').update(value).digest('hex').slice(0, 16),
  };
}

function responseFailureDetails(event: unknown): Record<string, unknown> {
  if (!event || typeof event !== 'object') return {};
  const record = event as JsonObject;
  const response = record.response && typeof record.response === 'object'
    ? record.response as JsonObject
    : undefined;
  const error = record.error && typeof record.error === 'object'
    ? record.error as JsonObject
    : response?.error && typeof response.error === 'object'
      ? response.error as JsonObject
      : undefined;
  const incomplete = response?.incomplete_details && typeof response.incomplete_details === 'object'
    ? response.incomplete_details as JsonObject
    : undefined;
  const message = typeof error?.message === 'string'
    ? error.message
    : typeof record.message === 'string' ? record.message : undefined;
  return {
    errorType: boundedDiagnosticIdentifier(error?.type ?? record.type),
    errorCode: boundedDiagnosticIdentifier(error?.code ?? record.code),
    responseStatus: boundedDiagnosticIdentifier(response?.status),
    incompleteReason: boundedDiagnosticIdentifier(incomplete?.reason),
    ...diagnosticTextFingerprint('errorMessage', message),
  };
}

function emitResponseErrorDiagnostic(
  entry: ConnectionEntry,
  ctx: RequestContext,
  details: Record<string, unknown>,
): void {
  ctx.emitDiagnostic?.({
    event: 'ws_response_error',
    connectionId: entry.debugId,
    generation: entry.generation,
    continued: ctx.continued,
    retried: ctx.retried,
    frameCount: ctx.frameCount,
    emittedModelData: ctx.emittedModelData,
    responseIdReceived: Boolean(ctx.responseId),
    inFlightMs: entry.inFlightStartedAt === undefined
      ? undefined
      : Math.max(0, entry.options.now() - entry.inFlightStartedAt),
    ...details,
  });
}

function responseIdFromEvent(event: unknown): string | undefined {
  if (!event || typeof event !== 'object') return undefined;
  const response = (event as JsonObject).response;
  if (!response || typeof response !== 'object') return undefined;
  return typeof (response as JsonObject).id === 'string' ? (response as JsonObject).id as string : undefined;
}

interface ResponseUsage {
  inputTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
}

function responseUsage(event: unknown): ResponseUsage | undefined {
  if (!event || typeof event !== 'object') return undefined;
  const response = (event as JsonObject).response;
  if (!response || typeof response !== 'object') return undefined;
  const usage = (response as JsonObject).usage;
  if (!usage || typeof usage !== 'object') return undefined;
  const usageRecord = usage as JsonObject;
  const details = usageRecord.input_tokens_details && typeof usageRecord.input_tokens_details === 'object'
    ? usageRecord.input_tokens_details as JsonObject
    : {};
  const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return {
    inputTokens: number(usageRecord.input_tokens),
    cachedTokens: number(details.cached_tokens),
    cacheWriteTokens: number(details.cache_write_tokens ?? usageRecord.cache_write_tokens),
    outputTokens: number(usageRecord.output_tokens),
  };
}

function responseUsageDebug(usage: ResponseUsage): string {
  return `usage input_tokens=${usage.inputTokens} `
    + `cached_tokens=${usage.cachedTokens} `
    + `cache_write_tokens=${usage.cacheWriteTokens} `
    + `output_tokens=${usage.outputTokens}`;
}

function outputAccumulator(ctx: RequestContext, index: number): OutputAccumulator {
  let accumulator = ctx.outputByIndex.get(index);
  if (!accumulator) {
    accumulator = { text: '', summaries: new Map() };
    ctx.outputByIndex.set(index, accumulator);
  }
  return accumulator;
}

function captureOutput(ctx: RequestContext, event: unknown): void {
  if (!event || typeof event !== 'object') return;
  const record = event as JsonObject;
  const type = eventType(event);
  if (type === 'response.created') {
    ctx.responseId = responseIdFromEvent(event) ?? ctx.responseId;
    return;
  }
  if (type === 'response.output_item.added' && typeof record.output_index === 'number') {
    const item = record.item && typeof record.item === 'object' ? record.item as JsonObject : {};
    const accumulator = outputAccumulator(ctx, record.output_index);
    accumulator.type = typeof item.type === 'string' ? item.type : accumulator.type;
    accumulator.itemId = typeof item.id === 'string' ? item.id : accumulator.itemId;
    if (accumulator.itemId) ctx.outputIndexByItemId.set(accumulator.itemId, record.output_index);
    return;
  }
  if (type === 'response.output_text.delta' && typeof record.item_id === 'string') {
    const index = ctx.outputIndexByItemId.get(record.item_id);
    if (index !== undefined && typeof record.delta === 'string') outputAccumulator(ctx, index).text += record.delta;
    return;
  }
  if (type === 'response.reasoning_summary_text.delta' && typeof record.item_id === 'string') {
    const index = ctx.outputIndexByItemId.get(record.item_id);
    if (index !== undefined && typeof record.delta === 'string') {
      const accumulator = outputAccumulator(ctx, index);
      const summaryIndex = typeof record.summary_index === 'number' ? record.summary_index : 0;
      accumulator.summaries.set(summaryIndex, (accumulator.summaries.get(summaryIndex) ?? '') + record.delta);
    }
    return;
  }
  if (type === 'response.output_item.done' && typeof record.output_index === 'number') {
    const item = record.item && typeof record.item === 'object' ? record.item as JsonObject : {};
    const accumulator = outputAccumulator(ctx, record.output_index);
    accumulator.type = typeof item.type === 'string' ? item.type : accumulator.type;
    accumulator.done = item;
    return;
  }
  if (TERMINAL_EVENT_TYPES.has(type ?? '')) {
    ctx.responseId = responseIdFromEvent(event) ?? ctx.responseId;
    const response = record.response && typeof record.response === 'object' ? record.response as JsonObject : undefined;
    if (Array.isArray(response?.output) && ctx.outputByIndex.size === 0) {
      response.output.forEach((item, index) => {
        if (item && typeof item === 'object') {
          outputAccumulator(ctx, index).done = item as JsonObject;
          outputAccumulator(ctx, index).type = typeof (item as JsonObject).type === 'string'
            ? (item as JsonObject).type as string
            : undefined;
        }
      });
    }
  }
}

function withoutEphemeralFields(item: JsonObject): JsonObject {
  const out = { ...item };
  delete out.id;
  delete out.status;
  delete out.phase;
  delete out.role;
  for (const [key, value] of Object.entries(out)) {
    if (value == null) delete out[key];
  }
  return out;
}

function expectedAssistantItems(ctx: RequestContext): unknown[] {
  const output: unknown[] = [];
  for (const [, accumulator] of [...ctx.outputByIndex.entries()].sort(([left], [right]) => left - right)) {
      const done = accumulator.done ?? {};
      const type = accumulator.type ?? (typeof done.type === 'string' ? done.type : undefined);
      if (type === 'message') {
        const doneContent = Array.isArray(done.content) ? done.content : undefined;
        const text = accumulator.text || (doneContent
          ? doneContent.filter(part => part && typeof part === 'object' && (part as JsonObject).type === 'output_text')
            .map(part => String((part as JsonObject).text ?? '')).join('')
          : '');
        output.push({ role: 'assistant', content: [{ type: 'output_text', text }] });
        continue;
      }
      if (type === 'reasoning') {
        const summary = accumulator.summaries.size
          ? [...accumulator.summaries.entries()].sort(([a], [b]) => a - b)
            .map(([, text]) => ({ type: 'summary_text', text }))
          : Array.isArray(done.summary) ? done.summary : [];
        output.push({ ...withoutEphemeralFields(done), type: 'reasoning', summary });
        continue;
      }
      if (type === 'function_call' || type === 'custom_tool_call') {
        output.push({ ...withoutEphemeralFields(done), type });
      }
  }
  return output;
}

function encodeSse(ctx: RequestContext, event: unknown): void {
  if (ctx.closed) return;
  ctx.controller.enqueue(ctx.encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
}

function flushPending(ctx: RequestContext): void {
  for (const event of ctx.pendingEvents) encodeSse(ctx, event);
  ctx.pendingEvents = [];
}

function closeContext(ctx: RequestContext): void {
  if (ctx.closed) return;
  ctx.closed = true;
  ctx.abortCleanup?.();
  try { ctx.controller.close(); } catch { /* already closed */ }
}

function deleteEntry(entry: ConnectionEntry, closeSocket = true): void {
  entry.inFlight = false;
  entry.current = undefined;
  unregisterEntry(entry);
  if (closeSocket) {
    try { entry.socket.close(); } catch { /* ignore */ }
  }
}

function failContext(
  entry: ConnectionEntry,
  ctx: RequestContext,
  message: string,
  diagnosticDetails: Record<string, unknown>,
): void {
  if (ctx.closed || entry.current !== ctx) return;
  entry.debug(`fail: ${message}`);
  emitResponseErrorDiagnostic(entry, ctx, {
    ...diagnosticDetails,
    ...diagnosticTextFingerprint('errorMessage', message),
  });
  flushPending(ctx);
  encodeSse(ctx, { type: 'error', error: { message } });
  deleteEntry(entry);
  closeContext(ctx);
}

function cleanupExpiredConnections(now: number): Array<Record<string, unknown>> {
  const evictions: Array<Record<string, unknown>> = [];
  for (const entry of connectionEntries()) {
    if (entry.inFlight) continue;
    const idleTtlMs = entry.generation === 'nursery'
      ? entry.options.nurseryIdleTtlMs
      : entry.options.idleTtlMs;
    const ttlAgeMs = Math.max(0, now - entry.createdAt - entry.ttlPausedMs);
    if (ttlAgeMs >= entry.options.hardTtlMs || now - entry.lastUsedAt >= idleTtlMs) {
      entry.debug('evicting expired idle connection');
      evictions.push({
        connectionId: entry.debugId,
        partitionKey: entry.key,
        generation: entry.generation,
        reason: ttlAgeMs >= entry.options.hardTtlMs
          ? 'hard_ttl'
          : entry.generation === 'nursery' ? 'nursery_idle_ttl' : 'idle_ttl',
      });
      deleteEntry(entry);
    }
  }
  return evictions;
}

function evictOldestIdleGeneration(
  generation: 'nursery' | 'established',
  maxConnections: number,
  reason: 'nursery_lru_cap' | 'established_lru_cap',
): Array<Record<string, unknown>> {
  const evictions: Array<Record<string, unknown>> = [];
  const idle = connectionEntries()
    .filter(entry => !entry.inFlight && entry.generation === generation)
    .sort((left, right) => left.lastUsedAt - right.lastUsedAt);
  while (connectionCountByGeneration(generation) >= maxConnections && idle.length) {
    const oldest = idle.shift();
    if (oldest) {
      evictions.push({
        connectionId: oldest.debugId,
        partitionKey: oldest.key,
        generation: oldest.generation,
        reason,
      });
      deleteEntry(oldest);
    }
  }
  return evictions;
}

function isModelDataEvent(type: string | undefined): boolean {
  return Boolean(type && (
    type.includes('.delta')
    || type === 'response.output_item.added'
    || type === 'response.output_item.done'
  ));
}

function outgoingPayload(payload: JsonObject): string {
  return JSON.stringify({ type: 'response.create', ...payload });
}

type WebSocketConstructor = new (
  url: string,
  options: { headers: Record<string, string> },
) => WsWebSocket;

function sendContext(entry: ConnectionEntry, ctx: RequestContext): void {
  const outgoing = outgoingPayload(ctx.sendPayload);
  entry.debug(
    `connection=${entry.debugId} key=${debugKey(entry.key)} sending ${outgoing.length}B payload`
    + (ctx.continued ? ' (continuation)' : ''),
  );
  entry.socket.send(outgoing);
}

function dispatchContext(entry: ConnectionEntry, ctx: RequestContext): void {
  const now = entry.options.now();
  entry.inFlight = true;
  entry.inFlightStartedAt = now;
  entry.current = ctx;
  ctx.entry = entry;
  if (entry.open) sendContext(entry, ctx);
}

function finishInFlightPeriod(entry: ConnectionEntry, now: number): void {
  if (entry.inFlightStartedAt !== undefined) {
    entry.ttlPausedMs += Math.max(0, now - entry.inFlightStartedAt);
    entry.inFlightStartedAt = undefined;
  }
}

function resetContextForRetry(ctx: RequestContext): void {
  ctx.continued = false;
  ctx.sendPayload = ctx.originalPayload;
  ctx.pendingEvents = [];
  ctx.emittedModelData = false;
  ctx.responseId = undefined;
  ctx.outputByIndex.clear();
  ctx.outputIndexByItemId.clear();
}

function handleSocketMessage(entry: ConnectionEntry, data: RawData): void {
  const ctx = entry.current;
  if (!ctx || ctx.closed) return;
  const text = Array.isArray(data) ? Buffer.concat(data).toString('utf8') : data.toString('utf8');
  ctx.frameCount += 1;
  let event: unknown;
  try {
    event = JSON.parse(text);
  } catch {
    ctx.pendingEvents.push(text.replace(/\r?\n/g, ' '));
    flushPending(ctx);
    return;
  }

  const type = eventType(event);
  captureOutput(ctx, event);
  if (type === 'response.completed') {
    const usage = responseUsage(event);
    if (usage) {
      entry.debug(responseUsageDebug(usage));
      ctx.emitDiagnostic?.({
        event: 'ws_response_usage',
        connectionId: entry.debugId,
        generation: entry.generation,
        continued: ctx.continued,
        retried: ctx.retried,
        ...usage,
      });
    }
  }
  if (isModelDataEvent(type)) ctx.emittedModelData = true;

  const previousMissing = responseErrorCode(event) === 'previous_response_not_found';
  const willRetry = previousMissing && ctx.continued && !ctx.retried && !ctx.emittedModelData;
  if (FAILURE_EVENT_TYPES.has(type ?? '')) {
    emitResponseErrorDiagnostic(entry, ctx, {
      source: 'response_event',
      upstreamEventType: type,
      willRetry,
      ...responseFailureDetails(event),
    });
  }
  if (willRetry) {
    ctx.retried = true;
    entry.debug('previous response unavailable; retrying once with full context');
    deleteEntry(entry);
    resetContextForRetry(ctx);
    const replacement = ctx.createReplacement();
    dispatchContext(replacement, ctx);
    return;
  }

  ctx.pendingEvents.push(event);
  if (isModelDataEvent(type)) flushPending(ctx);

  if (TERMINAL_EVENT_TYPES.has(type ?? '') || type === 'error') {
    flushPending(ctx);
    const failed = FAILURE_EVENT_TYPES.has(type ?? '');
    if (!failed && ctx.responseId && entry.persistent) {
      const now = entry.options.now();
      finishInFlightPeriod(entry, now);
      entry.responseId = ctx.responseId;
      entry.requestInput = inputArray(ctx.originalPayload);
      entry.expectedAssistant = expectedAssistantItems(ctx);
      entry.promptFieldHashes = ctx.promptFieldHashes;
      entry.instructionsSnapshot = ctx.instructionsSnapshot;
      entry.lastUsedAt = now;
      entry.inFlight = false;
      entry.current = undefined;
      entry.debug(`chain head updated; socket retained (${ctx.frameCount} frame(s))`);
    } else {
      deleteEntry(entry);
    }
    if (!entry.persistent) {
      try { entry.socket.close(); } catch { /* ignore */ }
    }
    closeContext(ctx);
  }
}

function createConnection(
  WebSocket: WebSocketConstructor,
  wsUrl: string,
  headers: Record<string, string>,
  persistent: boolean,
  key: string | undefined,
  options: ConnectionEntry['options'],
  debug: ConnectionEntry['debug'],
): ConnectionEntry {
  const now = options.now();
  const socket = new WebSocket(wsUrl, { headers });
  const entry: ConnectionEntry = {
    debugId: nextConnectionDebugId++,
    key: persistent ? key : undefined,
    socket,
    persistent,
    generation: persistent ? 'nursery' : 'isolated',
    open: false,
    createdAt: now,
    ttlPausedMs: 0,
    lastUsedAt: now,
    inFlight: false,
    options,
    debug,
  };
  if (persistent && key) registerEntry(entry);
  debug(
    `connection=${entry.debugId} key=${debugKey(entry.key)} created persistent=${persistent}`,
  );

  socket.on('open', () => {
    entry.open = true;
    debug(`connection=${entry.debugId} opened`);
    // Persistent cache sockets must not keep a finished relay-ai CLI process alive.
    (socket as unknown as { _socket?: { unref?: () => void } })._socket?.unref?.();
    const ctx = entry.current;
    if (ctx && !ctx.closed) sendContext(entry, ctx);
  });
  socket.on('unexpected-response', (_request, response) => {
    debug(`unexpected-response status=${response.statusCode}`);
    const ctx = entry.current;
    if (ctx && !ctx.closed) {
      emitResponseErrorDiagnostic(entry, ctx, {
        source: 'unexpected_response',
        httpStatusCode: response.statusCode,
      });
    }
  });
  socket.on('message', (data: RawData) => handleSocketMessage(entry, data));
  socket.on('error', (error: Error) => {
    const ctx = entry.current;
    if (ctx) failContext(entry, ctx, error.message, {
      source: 'socket_error',
      socketErrorName: boundedDiagnosticIdentifier(error.name),
      socketErrorCode: boundedDiagnosticIdentifier((error as NodeJS.ErrnoException).code),
    });
    else deleteEntry(entry);
  });
  socket.on('close', (code: number, reason: Buffer) => {
    entry.open = false;
    const ctx = entry.current;
    debug(`connection=${entry.debugId} closed code=${code} in_flight=${Boolean(ctx && !ctx.closed)}`);
    if (ctx && !ctx.closed) {
      const reasonText = reason?.length ? reason.toString('utf8') : '';
      const suffix = reasonText ? `: ${reasonText}` : '';
      failContext(entry, ctx, `WebSocket closed (${code})${suffix}`, {
        source: 'socket_close',
        closeCode: code,
        ...diagnosticTextFingerprint('closeReason', reasonText),
      });
    } else {
      deleteEntry(entry, false);
    }
  });
  return entry;
}

/**
 * Build a fetch transport backed by persistent, session-aware Responses sockets.
 * Each returned Response still represents exactly one AI SDK request.
 */
export function createResponsesWebSocketFetch(
  wsUrl: string,
  log?: (message: string) => void,
  options: ResponsesWebSocketFetchOptions = {},
): FetchFunction {
  const debug = (message: string) => { try { log?.(`ws: ${message}`); } catch { /* ignore */ } };
  const resolvedOptions = {
    hardTtlMs: options.hardTtlMs ?? RESPONSES_WS_HARD_TTL_MS,
    idleTtlMs: options.idleTtlMs ?? RESPONSES_WS_IDLE_TTL_MS,
    nurseryIdleTtlMs: options.nurseryIdleTtlMs
      ?? Math.min(RESPONSES_WS_NURSERY_IDLE_TTL_MS, options.idleTtlMs ?? RESPONSES_WS_IDLE_TTL_MS),
    maxConnections: options.maxConnections ?? RESPONSES_WS_MAX_CONNECTIONS,
    maxNurseryConnections: options.maxNurseryConnections ?? RESPONSES_WS_MAX_NURSERY_CONNECTIONS,
    now: options.now ?? Date.now,
  };

  return async (_input, init): Promise<Response> => {
    const { WebSocket } = await import('ws');
    const headers = toHeaderRecord(init?.headers);
    headers['OpenAI-Beta'] = CODEX_RESPONSES_WEBSOCKETS_BETA;

    let payload: JsonObject;
    try {
      payload = JSON.parse(bodyToString(init?.body)) as JsonObject;
    } catch {
      payload = {};
    }
    if (hasResponsesLiteHeader(headers)) payload = applyResponsesLiteShape(payload);

    const partitionKey = responsesWebSocketPartitionKey(wsUrl, payload, options);
    const promptFingerprint = responsesWebSocketPromptFingerprint(payload);
    const promptFieldHashes = responsesWebSocketPromptFieldHashes(payload);
    const instructionsSnapshot = instructionsFromPayload(payload);
    const diagnosticRequestId = diagnosticContext.getStore()?.requestId;
    const now = resolvedOptions.now();
    const evictions = cleanupExpiredConnections(now);

    const candidates = partitionKey ? connectionEntries(partitionKey) : [];
    const idleCandidates = candidates.filter(entry => !entry.inFlight);
    const matches = idleCandidates
      .map(entry => ({ entry, match: continuationMatch(entry, payload) }))
      .filter((candidate): candidate is { entry: ConnectionEntry; match: ContinuationMatch } => candidate.match !== undefined)
      // Prefer the longest matching history, which produces the smallest delta.
      .sort((left, right) => left.match.delta.length - right.match.delta.length
        || (left.match.mode === right.match.mode ? 0 : left.match.mode === 'exact' ? -1 : 1));
    let selected: ConnectionEntry | undefined = matches[0]?.entry;
    const selectedMatch = matches[0]?.match;
    const selectedDelta = selectedMatch?.delta;
    const diagnosticEntry = selected
      ?? [...idleCandidates].sort((left, right) => right.lastUsedAt - left.lastUsedAt)[0]
      ?? candidates[0];
    debug(
      `lookup key=${debugKey(partitionKey)} prompt=${debugKey(promptFingerprint)} hit=${candidates.length > 0} heads=${candidates.length} active_connections=${connectionCount()}`,
    );
    const promptChanges = changedPromptFields(diagnosticEntry?.promptFieldHashes, promptFieldHashes);
    if (promptChanges.length) debug(`prompt fields changed: ${promptChanges.join(',')}`);
    if (promptChanges.includes('instructions')) {
      const summary = instructionChangeSummary(diagnosticEntry?.instructionsSnapshot, instructionsSnapshot);
      if (summary) debug(summary);
    }
    let sendPayload = payload;
    let continued = false;
    let persistent = Boolean(partitionKey);
    let promotedConnectionId: number | undefined;
    let decision: 'continuation' | 'parallel_isolated' | 'history_mismatch_new_head' | 'new_partition_head' | 'unpartitioned_socket';

    if (selected && selectedDelta) {
      sendPayload = { ...payload, input: selectedDelta, previous_response_id: selected.responseId };
      continued = true;
      if (selected.generation === 'nursery') {
        evictions.push(...evictOldestIdleGeneration(
          'established',
          resolvedOptions.maxConnections,
          'established_lru_cap',
        ));
        selected.generation = 'established';
        promotedConnectionId = selected.debugId;
      }
      decision = 'continuation';
      debug(
        `continuing chain with ${selectedDelta.length} incremental input item(s)`
        + (selectedMatch.mode === 'omitted_reasoning' ? ' after accepting omitted reasoning' : ''),
      );
    } else if (candidates.some(entry => entry.inFlight)) {
      // Claude auxiliary requests can share a session id. Never multiplex or
      // queue a request whose lineage cannot yet include the active response.
      selected = undefined;
      persistent = false;
      decision = 'parallel_isolated';
      debug('parallel request using an isolated socket');
    } else if (diagnosticEntry) {
      // A rewind, branch, or hidden auxiliary inference gets its own full-context
      // head. Existing heads remain eligible for later exact-prefix matches.
      debug(
        `history mismatch starting an additional chain; retained ${candidates.length} existing head(s) `
        + `(${continuationMismatchSummary(diagnosticEntry, payload)})`,
      );
      decision = 'history_mismatch_new_head';
    } else if (partitionKey) {
      decision = 'new_partition_head';
    } else {
      decision = 'unpartitioned_socket';
    }

    if (!selected && persistent) {
      evictions.push(...evictOldestIdleGeneration(
        'nursery',
        resolvedOptions.maxNurseryConnections,
        'nursery_lru_cap',
      ));
    }

    const requestInput = inputArray(payload);
    emitDiagnostic(options, {
      event: 'ws_head_decision',
      decision,
      partitionKey,
      keyTuple: {
        wsUrl,
        providerId: options.providerId ?? 'openai',
        accountIdHash: options.accountId
          ? createHash('sha256').update(options.accountId).digest('hex').slice(0, 16)
          : '',
        model: typeof payload.model === 'string' ? payload.model : undefined,
        effort: typeof (payload.reasoning as JsonObject | undefined)?.effort === 'string'
          ? String((payload.reasoning as JsonObject).effort).trim().toLowerCase()
          : '',
        promptCacheKey: typeof payload.prompt_cache_key === 'string' ? payload.prompt_cache_key : undefined,
      },
      promptFingerprint,
      promptFieldHashes,
      promptChanges,
      input: {
        count: requestInput.length,
        kinds: requestInput.map(conversationItemKind),
        hashes: requestInput.map(conversationItemHash),
      },
      candidateCount: candidates.length,
      idleCandidateCount: idleCandidates.length,
      matchingCandidateCount: matches.length,
      activeConnectionCount: connectionCount(),
      nurseryConnectionCount: connectionCountByGeneration('nursery'),
      establishedConnectionCount: connectionCountByGeneration('established'),
      maxConnections: resolvedOptions.maxConnections,
      maxNurseryConnections: resolvedOptions.maxNurseryConnections,
      selectedConnectionId: selected?.debugId,
      selectedGeneration: selected?.generation,
      continuationMatchMode: selectedMatch?.mode,
      promotedConnectionId,
      createdConnectionId: selected ? undefined : nextConnectionDebugId,
      createdGeneration: selected ? undefined : persistent ? 'nursery' : 'isolated',
      incrementalInputItems: selectedDelta?.length,
      heads: candidates.map(entry => ({
        connectionId: entry.debugId,
        generation: entry.generation,
        inFlight: entry.inFlight,
        ageMs: Math.max(0, now - entry.createdAt - entry.ttlPausedMs),
        physicalAgeMs: Math.max(0, now - entry.createdAt),
        ttlPausedMs: entry.ttlPausedMs,
        idleMs: Math.max(0, now - entry.lastUsedAt),
        promptChanges: changedPromptFields(entry.promptFieldHashes, promptFieldHashes),
        mismatch: continuationMismatchDetails(entry, payload),
      })),
      evictions,
    }, diagnosticRequestId);

    let activeContext: RequestContext | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const ctx: RequestContext = {
          controller,
          encoder: new TextEncoder(),
          originalPayload: payload,
          sendPayload,
          promptFieldHashes,
          instructionsSnapshot,
          continued,
          retried: false,
          closed: false,
          frameCount: 0,
          pendingEvents: [],
          emittedModelData: false,
          outputByIndex: new Map(),
          outputIndexByItemId: new Map(),
          emitDiagnostic: options.onDiagnostic
            ? event => emitDiagnostic(options, event, diagnosticRequestId)
            : undefined,
          createReplacement: () => createConnection(
            WebSocket as unknown as WebSocketConstructor,
            wsUrl,
            headers,
            Boolean(partitionKey),
            partitionKey,
            resolvedOptions,
            debug,
          ),
        };
        activeContext = ctx;

        const entry = selected ?? createConnection(
          WebSocket as unknown as WebSocketConstructor,
          wsUrl,
          headers,
          persistent,
          partitionKey,
          resolvedOptions,
          debug,
        );
        dispatchContext(entry, ctx);

        const signal = init?.signal;
        if (signal) {
          const abort = () => {
            if (ctx.closed) return;
            if (ctx.entry) deleteEntry(ctx.entry);
            closeContext(ctx);
          };
          if (signal.aborted) abort();
          else {
            signal.addEventListener('abort', abort, { once: true });
            ctx.abortCleanup = () => signal.removeEventListener('abort', abort);
          }
        }
      },
      cancel() {
        // The SDK cancelling the synthetic response invalidates any in-flight
        // connection-local state; the AbortSignal path normally runs first.
        const ctx = activeContext;
        if (!ctx || ctx.closed) return;
        if (ctx.entry) deleteEntry(ctx.entry);
        closeContext(ctx);
      },
    });

    return new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    });
  };
}
