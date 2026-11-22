// Disabled pool members: a member the provider has told us is gone (retired, not found, no longer free for
// this account) is switched off until the user tests it again. It stays in the pool list with the reason.
import pc from 'picocolors';
import type { FavoriteModel, FreePoolPreferences, LocalProvider, PoolCapabilityReceipt } from '../types.js';
import { poolEndpointRevision } from './capabilities.js';
import type { PoolFailure } from './errors.js';
import { PoolHealthStore, poolEndpointScope } from './health.js';

export function disabledMessage(note: string): string {
  return 'Disabled after an error: ' + note + '. Remove from the pool, or Test it again to re-enable.';
}

function revisionFor(provider: LocalProvider, modelId: string): string | undefined {
  const model = provider.models.find(item => item.id === modelId);
  if (!model?.npm) return undefined;
  return poolEndpointRevision({
    providerId: provider.id, authRef: provider.authRef, npm: model.npm,
    baseURL: model.apiBaseUrl, upstreamModelId: model.upstreamModelId, headers: provider.headers,
  });
}

export function memberEndpointRevision(
  providers: readonly LocalProvider[],
  member: FavoriteModel,
): string | undefined {
  const provider = providers.find(item => item.id === member.providerId);
  return provider ? revisionFor(provider, member.modelId) : undefined;
}

/**
 * Records a permanent or 404/410 failure discovered during explicit Test / Test Pool
 * for a saved pool member. Never throws on health-file lock/corrupt errors.
 */
export async function recordTestPoolFailure(
  member: FavoriteModel,
  providers: readonly LocalProvider[],
  failure: PoolFailure | undefined,
  store: PoolHealthStore = new PoolHealthStore(),
): Promise<{ disabled: boolean; note?: string }> {
  if (!failure || (failure.kind !== 'disabled' && failure.kind !== 'missing')) {
    return { disabled: false };
  }
  const revision = memberEndpointRevision(providers, member);
  if (!revision) return { disabled: false };
  try {
    const res = await store.record([poolEndpointScope(member.providerId, revision, member.modelId)], failure);
    return { disabled: res.disabled === true, ...(res.note ? { note: res.note } : {}) };
  } catch {
    return { disabled: false };
  }
}

/**
 * Clears persisted health/disabled entries when a member is removed from the pool
 * so 100-year disabled records never leak in health.json or haunt a re-added model.
 */
export async function clearPoolMemberHealth(
  member: FavoriteModel,
  providers: readonly LocalProvider[],
  receipts: readonly PoolCapabilityReceipt[] = [],
  store: PoolHealthStore = new PoolHealthStore(),
): Promise<void> {
  const revisions = new Set<string>();
  const current = memberEndpointRevision(providers, member);
  if (current) revisions.add(current);
  for (const receipt of receipts) {
    if (receipt.member.providerId === member.providerId && receipt.member.modelId === member.modelId) {
      revisions.add(receipt.endpointRevision);
    }
  }
  if (revisions.size === 0) return;
  try {
    await store.clear([...revisions].map(rev => poolEndpointScope(member.providerId, rev, member.modelId)));
  } catch {
    /* best effort */
  }
}

/** Members that are currently disabled, keyed `providerId/modelId`. */
export async function disabledPoolMembers(
  providers: readonly LocalProvider[],
  pool: Pick<FreePoolPreferences, 'members'>,
  store: PoolHealthStore = new PoolHealthStore(),
): Promise<Map<string, { note: string; since: number }>> {
  const disabled = new Map<string, { note: string; since: number }>();
  for (const member of pool.members) {
    const provider = providers.find(item => item.id === member.providerId);
    const revision = provider ? revisionFor(provider, member.modelId) : undefined;
    if (!revision) continue;
    try {
      const found = await store.disabledFor([poolEndpointScope(member.providerId, revision, member.modelId)]);
      if (found) disabled.set(member.providerId + '/' + member.modelId, found);
    } catch { /* an unreadable health file must not break the page or a launch */ }
  }
  return disabled;
}

/** A passing Test is the only thing that re-enables a disabled member. */
export async function clearDisabledPoolMember(
  member: FavoriteModel, endpointRevision: string, store: PoolHealthStore = new PoolHealthStore(),
): Promise<void> {
  try { await store.clear([poolEndpointScope(member.providerId, endpointRevision, member.modelId)]); } catch { /* best effort */ }
}

/** Glaring launch-time notice so a disabled member is never silently missing from the pool. */
export async function warnDisabledPoolMembers(
  providers: readonly LocalProvider[],
  pool: Pick<FreePoolPreferences, 'members'>,
  store?: PoolHealthStore,
  write: (line: string) => void = line => console.error(line),
): Promise<number> {
  const disabled = await disabledPoolMembers(providers, pool, store);
  for (const [name, info] of disabled) {
    write(pc.bold(pc.red('⛔ Free pool member disabled: ' + name)) + pc.red(' - ' + info.note + '. Test it again (relay-ai ui > Free Pool) to re-enable.'));
  }
  return disabled.size;
}
