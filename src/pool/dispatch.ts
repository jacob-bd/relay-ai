import { PoolSessionRoutes } from './session.js';
import { forcedFailures } from './force-fail.js';
import type { PoolFailure } from './errors.js';
import type { FreePoolPreferences } from '../types.js';
import { evaluatePoolMembers, poolRouteIdentity, type PoolRouteEvidence, type PoolTarget } from './eligibility.js';
import { PoolAttemptError, runPoolAttempts, type PoolEvent, type PoolLimits, type PoolRoute } from './attempt.js';

const SIMULATED_COOLDOWN_MS = 60_000;
export const SIMULATED_FAILURE_MESSAGE = 'Simulated failure (RELAY_POOL_FORCE_FAIL)';

export interface DispatchRoute extends PoolRouteEvidence {
  open: PoolRoute['open'];
  recordAttemptFailure?: PoolRoute['recordAttemptFailure'];
  /** Lazy preparation hook (see PoolRoute.admit). */
  admit?: PoolRoute['admit'];
  /** Persist a failure for this member (cooldown). Absent on routes without a health store. */
  recordFailure?: (failure: PoolFailure) => Promise<void>;
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
    /** A route passed over by its own admission check (too large, cooling down, no credential, ...). */
    onSkip?(id: string, reason: string): void;
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
      ? async () => {
        // Behave like a real failure, including the cooldown, but only for a minute so a test cannot linger.
        await route.recordFailure?.({ kind: 'transient', retryAt: Date.now() + SIMULATED_COOLDOWN_MS });
        throw Object.assign(new Error(SIMULATED_FAILURE_MESSAGE), { statusCode: 429 });
      }
      : route.open;
    return { id: poolRouteIdentity(route), open, recordAttemptFailure: route.recordAttemptFailure, admit: route.admit };
  });
  const session = policy.sessions?.begin(request.conversationScope, attempts);
  let activeRoute: string | undefined;
  const passedOver: string[] = [];
  try {
    yield* runPoolAttempts(session?.routes ?? attempts, request.signal, policy.limits, policy.retryable, id => {
      activeRoute = id;
      policy.onAttempt?.(id);
    }, policy.onFailure, (id, reason) => {
      const member = routes.find(item => poolRouteIdentity(item) === id)?.member;
      if (member) passedOver.push(member.providerId + '/' + member.modelId + ': ' + reason);
      policy.onSkip?.(id, reason);
    });
  } catch (error) {
    // Every member passed the cheap checks but none was admitted: say why, as an empty pool always did.
    if (error instanceof PoolAttemptError && error.code === 'no-admitted-route') {
      throw new Error('No eligible free pool members: ' + [
        ...candidates.filter(candidate => candidate.reason).map(candidate => candidate.member.providerId + '/' + candidate.member.modelId + ': ' + candidate.reason),
        ...passedOver,
      ].join('; '));
    }
    throw error;
  }
  if (activeRoute) session?.succeed(activeRoute);
}
