import type { DispatchRoute } from './dispatch.js';
import type { PoolRouteEvidence } from './eligibility.js';

export type LazyPrepared<Extra extends object> = { skip: string } | { route: DispatchRoute; attach?: Partial<Extra> };

/**
 * A pool route whose expensive preparation (translating the whole request, resolving the key, building the model,
 * reading health) runs only when the coordinator is about to attempt it. Members the request never reaches, because
 * an earlier one answered or the attempt limit was hit, cost nothing beyond the cheap checks done up front.
 * Preparation happens at most once per request.
 */
export function lazyPoolRoute<Extra extends object = Record<string, never>>(
  evidence: PoolRouteEvidence,
  prepare: (signal: AbortSignal) => Promise<LazyPrepared<Extra>>,
  extra?: Extra,
): DispatchRoute & Extra {
  let built: DispatchRoute | undefined;
  const route: DispatchRoute & Extra = {
    ...evidence,
    ...(extra ?? {} as Extra),
    async admit(signal: AbortSignal) {
      if (built) return undefined;
      const prepared = await prepare(signal);
      if ('skip' in prepared) return prepared.skip;
      built = prepared.route;
      if (prepared.attach) Object.assign(route, prepared.attach);
      return undefined;
    },
    async open(signal: AbortSignal) {
      if (!built) throw new Error('Pool route used before it was admitted');
      return built.open(signal);
    },
    async recordAttemptFailure(error: unknown) { await built?.recordAttemptFailure?.(error); },
    async recordFailure(failure) { await built?.recordFailure?.(failure); },
  };
  return route;
}
