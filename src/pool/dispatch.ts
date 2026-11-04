import { PoolSessionRoutes } from './session.js';
import { forcedFailures } from './force-fail.js';
import type { FreePoolPreferences } from '../types.js';
import { evaluatePoolMembers, poolRouteIdentity, type PoolRouteEvidence, type PoolTarget } from './eligibility.js';
import { runPoolAttempts, type PoolEvent, type PoolLimits, type PoolRoute } from './attempt.js';

export const SIMULATED_FAILURE_MESSAGE = 'Simulated failure (RELAY_POOL_FORCE_FAIL)';

export interface DispatchRoute extends PoolRouteEvidence {
  open: PoolRoute['open'];
}
export interface PoolDispatchRequest {
  target: PoolTarget;
  effort?: string;
  tools: boolean;
  signal: AbortSignal;
  conversationScope?: string;
}
/** Adapters must supply complete, current eligibility evidence before any provider opens. */
export async function* dispatchFreePool(
  pool: FreePoolPreferences,
  routes: readonly DispatchRoute[],
  request: PoolDispatchRequest,
  policy: {
    limits: PoolLimits;
    sessions?: PoolSessionRoutes;
    retryable(error: unknown): boolean;
    onAttempt?(id: string): void;
    onFailure?(id: string, error: unknown, committed: boolean): void | Promise<void>;
  },
): AsyncGenerator<PoolEvent> {
  const candidates = evaluatePoolMembers(pool, routes, { ...request, now: Date.now() });
  const eligible = candidates.filter(candidate => !candidate.reason && candidate.route);
  if (!eligible.length) {
    throw new Error('No eligible free pool members: ' + candidates.map(candidate =>
      candidate.member.providerId + '/' + candidate.member.modelId + ': ' + candidate.reason).join('; '));
  }
  const attempts = eligible.map(candidate => {
    const route = routes.find(item => candidate.route && poolRouteIdentity(item) === poolRouteIdentity(candidate.route));
    if (!route) throw new Error('Pool route changed during admission');
    const forced = forcedFailures().has(route.member.providerId + '/' + route.member.modelId);
    const open: PoolRoute['open'] = forced
      ? async () => { throw Object.assign(new Error(SIMULATED_FAILURE_MESSAGE), { statusCode: 429 }); }
      : route.open;
    return { id: poolRouteIdentity(route), open };
  });
  const session = policy.sessions?.begin(request.conversationScope, attempts);
  let activeRoute: string | undefined;
  yield* runPoolAttempts(session?.routes ?? attempts, request.signal, policy.limits, policy.retryable, id => {
    activeRoute = id;
    policy.onAttempt?.(id);
  }, policy.onFailure);
  if (activeRoute) session?.succeed(activeRoute);
}
