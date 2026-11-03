import type { ReasoningMetadata } from '../provider-factory.js';
import {
  decodeCompactionContent,
  translateResponsesRequest,
  type CodexSdkCallParams,
  type ResponsesRequest,
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
  maxBytes: number;
  maxItems: number;
}

type Item = Record<string, unknown>;

interface State {
  scope: string;
  input: Item[];
  output: Item[];
  instructions?: string;
  source: string;
  expires: number;
  bytes: number;
}

const DEFAULT_LIMITS: ContinuationLimits = {
  ttlMs: 60_000,
  maxEntries: 32,
  maxBytes: 4 * 1024 * 1024,
  maxItems: 2_000,
};

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
  ): void {
    if (!responseId) throw new Error('response-id-required');
    if (!scope) throw new Error('real-session-and-branch-required');
    const storedInput = items(request.input);
    const storedOutput = structuredClone(output);
    if (storedInput.length + storedOutput.length > this.limits.maxItems) {
      throw new Error('continuation-history-too-large');
    }
    const state: State = {
      scope,
      input: storedInput,
      output: storedOutput,
      ...(typeof request.instructions === 'string' ? { instructions: request.instructions } : {}),
      source: poolRouteKey(source),
      expires: this.now() + this.limits.ttlMs,
      bytes: 0,
    };
    state.bytes = Buffer.byteLength(JSON.stringify(state), 'utf8');
    if (state.bytes > this.limits.maxBytes) throw new Error('continuation-history-too-large');
    this.prune();
    this.states.set(JSON.stringify([scope, responseId]), state);
    while (this.states.size > this.limits.maxEntries) {
      this.states.delete(this.states.keys().next().value!);
    }
  }

  resolve(scope: string, request: Record<string, unknown>): { body: Record<string, unknown>; source?: string } {
    const body = structuredClone(request);
    const previous = body.previous_response_id;
    if (previous === undefined || previous === null) return { body };
    if (typeof previous !== 'string' || !previous) throw new Error('unsupported-continuation: invalid response id');
    const state = this.states.get(JSON.stringify([scope, previous]));
    if (!scope || !state || state.expires <= this.now()) {
      throw new Error('unsupported-continuation: missing Relay-owned history');
    }
    body.input = [...structuredClone(state.input), ...structuredClone(state.output), ...items(body.input)];
    body.instructions ??= state.instructions;
    delete body.previous_response_id;
    return { body, source: state.source };
  }

  private prune(): void {
    const now = this.now();
    for (const [key, state] of this.states) {
      if (state.expires <= now) this.states.delete(key);
    }
  }
}

function stripRouteParts(part: Record<string, unknown>): Record<string, unknown> {
  if (part.type !== 'tool-call' && part.type !== 'tool-result') return part;
  const { providerOptions: _options, toolCallId, ...rest } = part;
  return {
    ...rest,
    ...(typeof toolCallId === 'string' ? { toolCallId: splitToolUseId(toolCallId).rawId } : {}),
  };
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
): CodexSdkCallParams {
  const fresh = structuredClone(body);
  const input = items(fresh.input);
  if (input.some(item =>
    ((item.type === 'compaction' || item.type === 'context_compaction')
      && decodeCompactionContent(item.encrypted_content as string | undefined) === null)
    || (item.type === 'reasoning' && typeof item.encrypted_content === 'string'),
  )) throw new Error('unsupported-continuation: opaque provider state requires original route');
  fresh.input = input;
  const params = translateResponsesRequest(fresh as unknown as ResponsesRequest, npm, metadata);
  if (source !== poolRouteKey(target)) {
    params.messages = params.messages.map(message => ({ ...message,
      content: Array.isArray(message.content)
        ? message.content
          .filter(part => part.type !== 'reasoning')
          .map(part => stripRouteParts(part as unknown as Record<string, unknown>) as typeof part)
        : message.content,
    })) as typeof params.messages;
  }
  return params;
}
