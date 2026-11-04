// Claude auto-inclusion for the shared free pool.
//
// The pool is opt-in (freePool.enabled). When enabled and at least one saved
// member is servable for Claude right now, Relay Free Pool is added to the
// normal Claude Relay catalog alongside the launched model and favorites. Every
// gate here mirrors prepareClaudePoolRoutes so the advertised model is one a
// request can actually route to. With no servable member this returns undefined
// and the launch is the ordinary one.

import type { FreePoolPreferences, LocalProvider, PoolCapabilityReceipt, UserPreferences } from '../types.js';
import { poolFreeStatus } from '../free-models.js';
import { poolEndpointRevision, currentPoolReceipt } from './capabilities.js';
import { poolCatalogEntry } from './catalog.js';
import { prepareClaudePoolRoutes } from './claude-prepare.js';
import { ClaudePoolRuntime } from './claude-runtime.js';
import { PoolHealthStore } from './health.js';
import { parseFreePool } from './membership.js';
import { poolRoutingProblem } from './verify.js';

export interface ClaudeAutoPool {
  pool: FreePoolPreferences;
  displayName: string;
  contextWindow: number;
  runtime: ClaudePoolRuntime;
}

/** Fresh, Claude-usable evidence for one member, using the runtime revision rule. */
function servableClaudeMember(
  pool: FreePoolPreferences,
  providers: readonly LocalProvider[],
  member: FreePoolPreferences['members'][number],
  now: number,
): PoolCapabilityReceipt | undefined {
  const provider = providers.find(item => item.id === member.providerId);
  const model = provider?.models.find(item => item.id === member.modelId);
  if (!provider || !model || !model.npm || model.modelFormat === 'cloud-code') return undefined;
  if (poolFreeStatus({ model, providerId: provider.id }) !== 'verified_free') return undefined;
  if (poolRoutingProblem(provider, model)) return undefined;
  const revision = poolEndpointRevision({
    providerId: provider.id, authRef: provider.authRef, npm: model.npm,
    baseURL: model.apiBaseUrl, upstreamModelId: model.upstreamModelId, headers: provider.headers,
  });
  const receipt = currentPoolReceipt(pool.receipts, member, revision, now);
  if (!receipt || !receipt.billingSafe || !receipt.tools || !receipt.targets.includes('claude')) return undefined;
  return receipt;
}

/**
 * Build the pool descriptor for a Claude launch, or undefined when the opt-in
 * pool cannot serve this launch. Never throws on a malformed saved value; the
 * ordinary launch must stay available.
 */
export function prepareClaudeAutoPool(
  prefs: Pick<UserPreferences, 'freePool'> | undefined,
  providers: readonly LocalProvider[],
  now = Date.now(),
): ClaudeAutoPool | undefined {
  let pool: FreePoolPreferences;
  try {
    pool = parseFreePool(prefs?.freePool);
  } catch {
    return undefined;
  }
  if (pool.enabled !== true || pool.members.length === 0) return undefined;
  const entry = poolCatalogEntry(pool, pool.receipts, 'claude', now);
  if (!entry) return undefined;
  if (!pool.members.some(member => servableClaudeMember(pool, providers, member, now))) return undefined;

  const health = new PoolHealthStore();
  const runtime = new ClaudePoolRuntime(pool, (body, signal, sessionId, onSkip) => prepareClaudePoolRoutes({
    pool, providers, receipts: pool.receipts, body, signal, sessionId, health, onSkip,
  }));
  return { pool, displayName: entry.display_name, contextWindow: entry.context_window, runtime };
}
