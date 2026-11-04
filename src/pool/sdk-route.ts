import type { PoolHealthStore } from './health.js';
import { poolFailure } from './errors.js';
import { streamText, type LanguageModel, type ModelMessage, type ToolSet } from 'ai';
import type { PoolEvent } from './attempt.js';
import type { DispatchRoute } from './dispatch.js';
import type { PoolRouteEvidence } from './eligibility.js';

export interface PoolSdkRequest {
  messages: ModelMessage[];
  tools?: ToolSet;
  system?: string;
  maxOutputTokens: number;
  temperature?: number;
  providerOptions?: Record<string, Record<string, unknown>>;
  headers?: Record<string, string>;
}

/** One provider call only: the coding client owns tool execution and retries. */
export function sdkPoolRoute(
  evidence: PoolRouteEvidence,
  model: LanguageModel,
  request: PoolSdkRequest,
  health?: { store: PoolHealthStore; scopes: readonly string[] },
): DispatchRoute {
  if (!Number.isSafeInteger(request.maxOutputTokens) || request.maxOutputTokens <= 0) {
    throw new Error('Pool requests require a bounded output reservation');
  }
  for (const definition of Object.values(request.tools ?? {})) {
    if (definition.execute) throw new Error('Pool tools must not execute inside Relay');
  }
  return {
    ...evidence,
    recordFailure: health ? async failure => { await health.store.record(health.scopes, failure); } : undefined,
    async open(abortSignal) {
      const decision = health ? await health.store.acquire({ id: evidence.revision, scopes: health.scopes }) : undefined;
      if (decision && !decision.ok) throw new Error('Pool route entered cooldown');
      return (async function* () {
        let success = false;
        let recorded = false;
        try {
          // streamText can throw synchronously. Constructing it inside the generator
          // keeps that failure on the attempt coordinator's stream path so it is
          // classified, reported and the recovery claim is settled.
          const result = streamText({
            model, ...request, maxRetries: 0, abortSignal, onError: () => {},
          } as Parameters<typeof streamText>[0]);
          // SDK promises can reject independently after stream cancellation.
          for (const promise of [result.text, result.toolCalls, result.toolResults, result.finishReason, result.usage, result.response]) {
            Promise.resolve(promise).catch(() => {});
          }
          const source = result.stream as AsyncIterable<PoolEvent>;
          for await (const part of source) {
            if (part.type === 'error' && !abortSignal.aborted) {
              const failure = poolFailure(part.error);
              if (health && failure.kind !== 'canceled') {
                const result = await health.store.record(health.scopes, failure);
                recorded = recorded || result.recorded;
              }
            }
            if (part.type === 'finish') success = true;
            yield part;
          }
        } catch (error) {
          if (health && decision && decision.ok && !abortSignal.aborted) {
            const failure = poolFailure(error);
            if (failure.kind !== 'canceled') {
              const result = await health.store.record(health.scopes, failure);
              recorded = recorded || result.recorded;
            }
          }
          throw error;
        } finally {
          if (health && decision && decision.ok) {
            if (success && !recorded && !abortSignal.aborted) await decision.settle(true);
            else await decision.release();
          }
        }
      })();
    },
  };
}
