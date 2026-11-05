// Disabled pool members: a member the provider has told us is gone (retired, not found, no longer free for
// this account) is switched off until the user tests it again. It stays in the pool list with the reason.
import pc from 'picocolors';
import type { FavoriteModel, FreePoolPreferences, LocalProvider } from '../types.js';
import { poolEndpointRevision } from './capabilities.js';
import { PoolHealthStore, poolEndpointScope } from './health.js';

export function disabledMessage(note: string): string {
  return 'Disabled after an error: ' + note + '. Test it again to re-enable.';
}

function revisionFor(provider: LocalProvider, modelId: string): string | undefined {
  const model = provider.models.find(item => item.id === modelId);
  if (!model?.npm) return undefined;
  return poolEndpointRevision({
    providerId: provider.id, authRef: provider.authRef, npm: model.npm,
    baseURL: model.apiBaseUrl, upstreamModelId: model.upstreamModelId, headers: provider.headers,
  });
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
