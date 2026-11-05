import { MAX_MODEL_CATALOG } from '../constants.js';
import { resolveLocalProviderApiKey } from '../provider-catalog.js';
import { providerRefreshToken } from '../provider-runtime.js';
import { buildFavoritesList, type ResolveContext } from '../favorites-resolver.js';
import type { FavoriteModel, LocalProvider, LocalProviderModel } from '../types.js';
import { buildAntigravityRoutes, type AntigravityEffortMode } from './catalog.js';
import { loadPreferences } from '../config.js';
import { parseFreePool } from '../pool/membership.js';
import { buildAntigravityPoolRoutes, POOL_ROW_BUDGET } from '../pool/antigravity.js';
import { receiptInForce } from '../pool/capabilities.js';
import { warnDisabledPoolMembers } from '../pool/disabled.js';
import { meetsContextFloor } from '../target-compatibility.js';
import type { AntigravityRoute } from './types.js';

export interface ResolveAntigravityLaunchRoutesOptions {
  /** The launch model. Omitted when the session starts on the free pool. */
  provider?: LocalProvider;
  model?: LocalProviderModel;
  /** Open on the Relay Free Pool: its rows come first and no other model is the launch model. */
  startOnPool?: boolean;
  allProviders: LocalProvider[];
  favorites?: FavoriteModel[];
  maxRoutes?: number;
  /** How the surface exposes effort levels: agy slider, app submenu, or IDE plain rows (default). */
  effortMode?: AntigravityEffortMode;
}

export interface ResolveAntigravityLaunchRoutesResult {
  routes: AntigravityRoute[];
  apiKey: string;
  droppedFavorites: FavoriteModel[];
  capacitySkippedFavorites: FavoriteModel[];
}

export async function resolveAntigravityLaunchRoutes(
  opts: ResolveAntigravityLaunchRoutesOptions,
): Promise<ResolveAntigravityLaunchRoutesResult | null> {
  const maxRoutes = opts.maxRoutes ?? MAX_MODEL_CATALOG;
  const launchProvider = opts.provider;
  const launchModel = opts.model;
  if (!opts.startOnPool && (!launchProvider || !launchModel)) return null;
  const apiKey = opts.startOnPool || !launchProvider ? '' : await resolveLocalProviderApiKey(launchProvider);
  if (!opts.startOnPool && !apiKey) return null;

  const starting = opts.startOnPool || !launchProvider || !launchModel ? undefined : {
    providerId: launchProvider.id,
    providerName: launchProvider.name,
    model: launchModel,
    apiKey: apiKey!,
    authType: launchProvider.authType,
    oauthAccountId: launchProvider.oauthAccountId,
    providerData: launchProvider.providerData,
    headers: launchProvider.headers,
    refreshToken: providerRefreshToken(launchProvider.id, launchProvider.authType, launchProvider.authRef),
  };
  const ctx: ResolveContext = {
    agent: 'antigravity',
    localProviders: opts.allProviders,
    findLocalModel: (providerId, modelId) => {
      const provider = opts.allProviders.find(candidate => candidate.id === providerId);
      const model = provider?.models.find(candidate => candidate.id === modelId);
      return provider && model ? { provider, model } : undefined;
    },
  };
  const { resolved, droppedFavorites, capacitySkippedFavorites } = await buildFavoritesList(
    starting,
    opts.favorites ?? [],
    ctx,
    maxRoutes,
    { dropEmptyApiKey: true, trackCapacitySkipped: true },
  );

  // Favorites below agy's context floor make it refuse to start once switched to. The
  // launch model (always first) comes from the picker, which already enforces the floor.
  const tooSmall = resolved.slice(opts.startOnPool ? 0 : 1).filter(
    entry => !meetsContextFloor('antigravity', (entry.model as LocalProviderModel).contextWindow),
  );
  const launchable = resolved.filter(entry => !tooSmall.includes(entry));

  // The pool is built first and its rows are reserved: effort variants of favorites can otherwise fill the whole
  // catalog (agy's slider lists every level of every favorite) and leave the pool no room at all.
  const poolRoutes = await buildAntigravityLaunchPoolRows(opts.allProviders, Math.min(POOL_ROW_BUDGET, maxRoutes), opts.effortMode ?? 'rows', { warn: true });

  // Effort variants can push later favorites past the cap; report those too.
  const routes = buildAntigravityRoutes(launchable, maxRoutes - poolRoutes.length, { effortMode: opts.effortMode });
  // On a pool launch its rows come first: the first route is the launch model in every surface.
  if (opts.startOnPool) routes.unshift(...poolRoutes); else routes.push(...poolRoutes);
  if (opts.startOnPool && poolRoutes.length === 0) return null;
  const routed = new Set(routes.map(route => `${route.providerId}:${route.modelId}`));
  const cutByVariants = launchable
    .filter(entry => !routed.has(`${entry.providerId}:${entry.model.id}`))
    .map(entry => ({ providerId: entry.providerId, modelId: entry.model.id }));

  return {
    routes,
    apiKey: apiKey ?? '',
    droppedFavorites: [
      ...droppedFavorites,
      ...tooSmall.map(entry => ({ providerId: entry.providerId, modelId: entry.model.id })),
    ],
    capacitySkippedFavorites: [...cutByVariants, ...capacitySkippedFavorites],
  };
}

/**
 * The pool's picker rows for this launch (empty when the pool is off or no member has evidence for Antigravity).
 * Also the availability test behind the "Relay Free Pool" launcher entry.
 */
export async function buildAntigravityLaunchPoolRows(
  allProviders: readonly LocalProvider[],
  maxRows: number,
  effortMode: AntigravityEffortMode,
  options: { warn?: boolean } = {},
): Promise<AntigravityRoute[]> {
  const freePool = parseFreePool(loadPreferences().freePool);
  const hasPoolEvidence = freePool.receipts.some(receipt =>
    receipt.targets.includes('antigravity') && receipt.billingSafe
    && receiptInForce(receipt, Date.now()));
  if (!freePool.enabled || !hasPoolEvidence || maxRows < 1) return [];
  if (options.warn) await warnDisabledPoolMembers(allProviders, freePool);
  const apiKeys = new Map<string, string>();
  for (const member of freePool.members) {
    const provider = allProviders.find(candidate => candidate.id === member.providerId);
    if (!provider) continue;
    const key = await resolveLocalProviderApiKey(provider);
    if (key) apiKeys.set(provider.id, key);
  }
  return buildAntigravityPoolRoutes({
    pool: freePool,
    providers: allProviders,
    receipts: freePool.receipts,
    apiKeys,
    effortMode,
    maxRows,
  });
}
