import type { PoolHealthStore } from './health.js';
import { poolFailure, type PoolFailure } from './errors.js';
import { streamText, type LanguageModel, type ModelMessage, type ToolSet } from 'ai';
import { validPoolFinish, type PoolEvent } from './attempt.js';
import type { DispatchRoute } from './dispatch.js';
import type { PoolRouteEvidence } from './eligibility.js';

export interface PoolSdkRequest {
  messages: ModelMessage[];
  tools?: ToolSet;
  system?: string;
  maxOutputTokens: number;
  temperature?: number;
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'tool'; toolName: string };
  providerOptions?: Record<string, Record<string, unknown>>;
  headers?: Record<string, string>;
}

/** One provider call only: the coding client owns tool execution and retries. */
export function sdkPoolRoute(
  evidence: PoolRouteEvidence,
  model: LanguageModel,
  request: PoolSdkRequest,
  /** `scopes` = this model; `accountScopes` = the whole provider account, cooled by a rate limit or exhausted credit. */
  health?: { store: PoolHealthStore; scopes: readonly string[]; accountScopes?: readonly string[] },
): DispatchRoute {
  if (!Number.isSafeInteger(request.maxOutputTokens) || request.maxOutputTokens <= 0) {
    throw new Error('Pool requests require a bounded output reservation');
  }
  for (const definition of Object.values(request.tools ?? {})) {
    if (definition.execute) throw new Error('Pool tools must not execute inside Relay');
  }
  // Free-tier rate limits apply to the provider account, so every model on it must wait; any other
  // failure (a bad model, a server error) says nothing about its siblings.
  const scopesFor = (failure: PoolFailure): readonly string[] => health
    ? (failure.kind === 'rate-limit' || failure.kind === 'quota' ? [...health.scopes, ...(health.accountScopes ?? [])] : health.scopes)
    : [];
  return {
    ...evidence,
    recordFailure: health ? async failure => { await health.store.record(scopesFor(failure), failure); } : undefined,
    recordAttemptFailure: health ? async error => {
      const failure = poolFailure(error);
      await health.store.record(scopesFor(failure), failure);
    } : undefined,
    async open(abortSignal) {
      const decision = health ? await health.store.acquire({ id: evidence.revision, scopes: [...health.scopes, ...(health.accountScopes ?? [])] }) : undefined;
      if (decision && !decision.ok) throw new Error('Pool route entered cooldown');
      // Cancellation can win while acquire waits on the health lock. The generator
      // never starts in that case, so release the late-granted claim here and on
      // an abort between this check and the caller starting the generator.
      const releaseLateClaim = () => {
        if (decision?.ok) void decision.release().catch(() => {});
      };
      if (decision?.ok) {
        if (abortSignal.aborted) {
          await decision.release();
          throw abortSignal.reason ?? new Error('Pool attempt aborted');
        }
        abortSignal.addEventListener('abort', releaseLateClaim, { once: true });
      }
      return (async function* () {
        abortSignal.removeEventListener('abort', releaseLateClaim);
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
                const result = await health.store.record(scopesFor(failure), failure);
                recorded = recorded || result.recorded;
              }
            }
            if (validPoolFinish(part)) success = true;
            yield part;
          }
        } catch (error) {
          if (health && decision && decision.ok && !abortSignal.aborted) {
            const failure = poolFailure(error);
            if (failure.kind !== 'canceled') {
              const result = await health.store.record(scopesFor(failure), failure);
              recorded = recorded || result.recorded;
            }
          }
          throw error;
        } finally {
          if (health && decision && decision.ok) {
            // The finish event is the proof of success. The attempt loop aborts its own signal as it cleans up
            // right after, so checking `aborted` here made every successful probe look cancelled and the
            // member stayed half-open forever (concurrent requests were then turned away as "cooling down").
            if (success && !recorded) await decision.settle(true);
            else await decision.release();
          }
        }
      })();
    },
  };
}
