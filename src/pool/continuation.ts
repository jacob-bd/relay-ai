import type { ReasoningMetadata } from '../provider-factory.js';
import {
  decodeCompactionContent,
  translateResponsesRequest,
  type CodexSdkCallParams,
  type ResponsesRequest,
  type TranslateToolOptions,
} from '../codex-responses-adapter.js';
import { splitToolUseId } from '../proxy-shared.js';

export interface PoolRouteIdentity {
  account: string;
  endpointRevision: string;
  model: string;
}

export function poolRouteKey(route: PoolRouteIdentity): string {
  return JSON.stringify([route.account, route.endpointRevision, route.model]);
}

export interface ContinuationLimits {
  ttlMs: number;
  maxEntries: number;
  /** Largest single snapshot. */
  maxBytes: number;
  /** Most items in a single snapshot. */
  maxItems: number;
  /**
   * Memory bound across every retained snapshot, least recently used first. Each snapshot holds its whole
   * history, so this must be far above one snapshot: sessions that run side by side have to coexist.
   */
  maxTotalBytes: number;
}

type Item = Record<string, unknown>;

const CALL_ID_TYPES = new Set([
  'function_call', 'function_call_output', 'custom_tool_call', 'custom_tool_call_output',
  'tool_search_call', 'tool_search_output',
]);

/** Raw call id -> route key that produced it. */
export type CallOrigins = Record<string, string>;

export function poolHistoryOrigins(body: object): CallOrigins | undefined {
  return bodyOrigins.get(body);
}

/** Resolved bodies carry provenance to prepare/remember without changing their wire shape. */
const bodyOrigins = new WeakMap<object, CallOrigins>();

interface State {
  scope: string;
  input: Item[];
  output: Item[];
  instructions?: string;
  source: string;
  origins: CallOrigins;
  expires: number;
  bytes: number;
}

const DEFAULT_LIMITS: ContinuationLimits = {
  ttlMs: 3_600_000,
  maxEntries: 2_000,
  maxBytes: 4 * 1024 * 1024,
  maxItems: 2_000,
  maxTotalBytes: 128 * 1024 * 1024,
};

function withoutImageData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutImageData);
  if (value === null || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  if (record.type === 'input_image' && typeof record.image_url === 'string') {
    return { ...record, image_url: '[image]' };
  }
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, withoutImageData(item)]));
}

function items(input: unknown): Item[] {
  if (typeof input === 'string') return [{ type: 'message', role: 'user', content: input }];
  if (!Array.isArray(input)) throw new Error('unsupported-input');
  return structuredClone(input) as Item[];
}

function checkLimit(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid continuation limit: ' + name);
}

/**
 * Relay-owned Responses history, scoped by a caller-supplied session and branch.
 * A previous_response_id without owned history is refused rather than reconstructed
 * from whatever items the client happened to send.
 */
export class PoolContinuationStore {
  private readonly states = new Map<string, State>();
  private readonly limits: ContinuationLimits;

  constructor(limits: Partial<ContinuationLimits> = {}, private readonly now = Date.now) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    for (const [name, value] of Object.entries(this.limits)) checkLimit(name, value);
  }

  remember(
    responseId: string,
    scope: string,
    request: Record<string, unknown>,
    output: Item[],
    source: PoolRouteIdentity,
    origins?: CallOrigins,
  ): void {
    if (!responseId) throw new Error('response-id-required');
    if (!scope) throw new Error('real-session-and-branch-required');
    const storedInput = items(request.input);
    const storedOutput = structuredClone(output);
    const inherited = origins ?? bodyOrigins.get(request);
    const owners = withOutputOrigins(inherited ? { ...inherited } : withInputOrigins({}, storedInput, source), storedOutput, source);
    if (storedInput.length + storedOutput.length > this.limits.maxItems) {
      throw new Error('continuation-history-too-large');
    }
    const state: State = {
      scope,
      input: storedInput,
      output: storedOutput,
      ...(typeof request.instructions === 'string' ? { instructions: request.instructions } : {}),
      source: poolRouteKey(source),
      origins: owners,
      expires: this.now() + this.limits.ttlMs,
      bytes: 0,
    };
    state.bytes = Buffer.byteLength(JSON.stringify(withoutImageData(state)), 'utf8');
    if (state.bytes > this.limits.maxBytes) throw new Error('continuation-history-too-large');
    this.prune();
    const key = JSON.stringify([scope, responseId]);
    this.states.delete(key);
    this.states.set(key, state);
    let total = 0;
    for (const entry of this.states.values()) total += entry.bytes;
    // The snapshot just stored is never the one evicted.
    while (this.states.size > 1 && (this.states.size > this.limits.maxEntries || total > this.limits.maxTotalBytes)) {
      const oldest = this.states.keys().next().value!;
      total -= this.states.get(oldest)!.bytes;
      this.states.delete(oldest);
    }
  }

  resolve(scope: string, request: Record<string, unknown>): { body: Record<string, unknown>; source?: string; origins?: CallOrigins } {
    const body = structuredClone(request);
    const previous = body.previous_response_id;
    if (previous === undefined || previous === null) return { body };
    if (typeof previous !== 'string' || !previous) throw new Error('unsupported-continuation: invalid response id');
    const state = this.states.get(JSON.stringify([scope, previous]));
    if (!scope || !state || state.expires <= this.now()) {
      throw new Error('unsupported-continuation: missing Relay-owned history');
    }
    // Retain recently used branches ahead of idle snapshots when capacity is reached.
    const key = JSON.stringify([scope, previous]);
    this.states.delete(key);
    this.states.set(key, state);
    body.input = [...structuredClone(state.input), ...structuredClone(state.output), ...items(body.input)];
    body.instructions ??= state.instructions;
    delete body.previous_response_id;
    const origins = { ...state.origins };
    bodyOrigins.set(body, origins);
    return { body, source: state.source, origins };
  }

  private prune(): void {
    const now = this.now();
    for (const [key, state] of this.states) {
      if (state.expires <= now) this.states.delete(key);
    }
  }
}

/** Seed provenance for history supplied before Relay owned a response id. */
function withInputOrigins(origins: CallOrigins, input: Item[], source: PoolRouteIdentity): CallOrigins {
  const next = { ...origins };
  for (const item of input) {
    if (CALL_ID_TYPES.has(String(item.type)) && typeof item.call_id === 'string') {
      const rawId = splitToolUseId(item.call_id).rawId;
      if (!next[rawId]) next[rawId] = poolRouteKey(source);
    }
  }
  return next;
}

function withOutputOrigins(origins: CallOrigins, output: Item[], source: PoolRouteIdentity): CallOrigins {
  const next = { ...origins };
  for (const item of output) {
    if (CALL_ID_TYPES.has(String(item.type)) && typeof item.call_id === 'string') {
      next[splitToolUseId(item.call_id).rawId] = poolRouteKey(source);
    }
  }
  return next;
}

function stripRouteParts(
  part: Record<string, unknown>,
  target: string,
  source: string | undefined,
  origins: CallOrigins,
): Record<string, unknown> {
  if (part.type !== 'tool-call' && part.type !== 'tool-result') return part;
  const rawId = typeof part.toolCallId === 'string' ? splitToolUseId(part.toolCallId).rawId : undefined;
  const owner = rawId ? origins[rawId] : undefined;
  // Unknown provenance keeps the old turn-level fallback.
  const foreign = owner !== undefined ? owner !== target : source !== target;
  if (!foreign) return { ...part, ...(rawId ? { toolCallId: rawId } : {}) };
  const { providerOptions: _options, toolCallId: _id, ...rest } = part;
  return { ...rest, ...(rawId ? { toolCallId: rawId } : {}) };
}

function isOpaqueCompaction(item: Item): boolean {
  return (item.type === 'compaction' || item.type === 'context_compaction')
    && decodeCompactionContent(item.encrypted_content as string | undefined) === null;
}

function hasReasoningSummary(item: Item): boolean {
  return Array.isArray(item.summary) && item.summary.some(part =>
    part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string'
    && ((part as { text: string }).text).trim().length > 0);
}

/**
 * Translates reconstructed Responses history for one attempt. Switching routes
 * keeps human-visible history and removes route-bound signatures and reasoning.
 */
export function preparePoolHistory(
  body: Record<string, unknown>,
  source: string | undefined,
  target: PoolRouteIdentity,
  npm: string,
  metadata?: ReasoningMetadata,
  options?: TranslateToolOptions,
  origins?: CallOrigins,
): CodexSdkCallParams {
  const fresh = structuredClone(body);
  const rawInput = items(fresh.input);
  const hadOpaque = rawInput.some(item =>
    isOpaqueCompaction(item) || (item.type === 'reasoning' && typeof item.encrypted_content === 'string'));
  const input = rawInput
    .filter(item => !isOpaqueCompaction(item))
    .map(item => {
      if (item.type !== 'reasoning' || typeof item.encrypted_content !== 'string') return item;
      const { encrypted_content: _encrypted, ...rest } = item;
      return rest;
    });
  const hasReadableHistory = input.some(item => item.type !== 'reasoning' || hasReasoningSummary(item));
  if (hadOpaque && !hasReadableHistory) {
    throw new Error('unsupported-continuation: opaque provider state requires original route');
  }
  fresh.input = input;
  const params = translateResponsesRequest(fresh as unknown as ResponsesRequest, npm, metadata, options);
  const targetKey = poolRouteKey(target);
  const owners = origins ?? bodyOrigins.get(body) ?? {};
  params.messages = params.messages.map(message => ({ ...message,
    content: Array.isArray(message.content)
      ? message.content
        .filter(part => !(source !== targetKey && part.type === 'reasoning'))
        .map(part => stripRouteParts(part as unknown as Record<string, unknown>, targetKey, source, owners) as typeof part)
      : message.content,
  })) as typeof params.messages;
  return params;
}
