import type { FavoriteModel, FreePoolPreferences } from '../types.js';
import type { FreeStatus } from '../free-models.js';

export type PoolTarget = 'codex' | 'claude' | 'antigravity' | 'core';
export interface PoolRouteEvidence {
  member: FavoriteModel;
  /** Changes whenever the endpoint configuration changes. Never contains credentials. */
  revision: string;
  freeStatus: FreeStatus;
  catalogVerified: boolean;
  accessVerified: boolean;
  billingSafe: boolean;
  targets: readonly PoolTarget[];
  toolsVerified: boolean;
  defaultEffortVerified: boolean;
  effortLevels: readonly string[];
  /** Result of route-specific counting of the complete translated request. */
  contextFits: boolean;
  contextVerified: boolean;
  unavailableUntil?: number;
}
export interface PoolCandidate {
  member: FavoriteModel;
  route?: PoolRouteEvidence;
  reason?: string;
}
export function poolRouteIdentity(route: Pick<PoolRouteEvidence, 'member' | 'revision'>): string {
  return JSON.stringify([route.member.providerId, route.revision, route.member.modelId]);
}

/** Returns every saved member, including ineligible ones, in user priority order. */
export function evaluatePoolMembers(
  pool: FreePoolPreferences,
  evidence: readonly PoolRouteEvidence[],
  request: { target: PoolTarget; effort?: string; tools: boolean; now: number },
): PoolCandidate[] {
  return pool.members.map(member => {
    const matches = evidence.filter(route => route.member.providerId === member.providerId && route.member.modelId === member.modelId);
    if (matches.length !== 1) return { member, reason: matches.length ? 'ambiguous-route' : 'unavailable' };
    const route = matches[0];
    const effort = request.effort ?? pool.effort;
    let reason: string | undefined;
    if (!route.revision) reason = 'unverified-endpoint';
    else if (!route.catalogVerified) reason = 'unverified-catalog';
    else if (route.freeStatus !== 'verified_free') reason = 'not-free';
    else if (!route.billingSafe) reason = 'billing-risk';
    else if (!route.accessVerified) reason = 'unverified-access';
    else if (!route.targets.includes(request.target)) reason = 'unsupported-target';
    else if (request.tools && !route.toolsVerified) reason = 'unverified-tools';
    else if (effort === 'auto' ? !route.defaultEffortVerified : !route.effortLevels.includes(effort)) reason = 'unsupported-effort';
    else if (!route.contextVerified) reason = 'unverified-context';
    else if (!route.contextFits) reason = 'context-limit';
    else if (route.unavailableUntil !== undefined && (!Number.isFinite(route.unavailableUntil) || route.unavailableUntil > request.now)) reason = 'cooldown';
    return { member, route, ...(reason ? { reason } : {}) };
  });
}
