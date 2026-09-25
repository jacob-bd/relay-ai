import { MAX_MODEL_CATALOG } from '../constants.js';
import { resolveLocalProviderApiKey } from '../provider-catalog.js';
import { providerRefreshToken } from '../provider-runtime.js';
import { buildFavoritesList, type ResolveContext } from '../favorites-resolver.js';
import type { FavoriteModel, LocalProvider, LocalProviderModel } from '../types.js';
import { buildAntigravityRoutes } from './catalog.js';
import { meetsContextFloor } from '../target-compatibility.js';
import type { AntigravityRoute } from './types.js';

export interface ResolveAntigravityLaunchRoutesOptions {
  provider: LocalProvider;
  model: LocalProviderModel;
  allProviders: LocalProvider[];
  favorites?: FavoriteModel[];
  maxRoutes?: number;
  /** agy: list the levels it folds into one row with a slider (low/medium/high/max), plus XHigh. */
  effortSlider?: boolean;
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
  const apiKey = await resolveLocalProviderApiKey(opts.provider);
  if (!apiKey) return null;

  const starting = {
    providerId: opts.provider.id,
    providerName: opts.provider.name,
    model: opts.model,
    apiKey,
    authType: opts.provider.authType,
    oauthAccountId: opts.provider.oauthAccountId,
    providerData: opts.provider.providerData,
    headers: opts.provider.headers,
    refreshToken: providerRefreshToken(opts.provider.id, opts.provider.authType, opts.provider.authRef),
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
  const tooSmall = resolved.slice(1).filter(
    entry => !meetsContextFloor('antigravity', (entry.model as LocalProviderModel).contextWindow),
  );
  const launchable = resolved.filter(entry => !tooSmall.includes(entry));

  // Effort variants can push later favorites past the cap; report those too.
  const routes = buildAntigravityRoutes(launchable, maxRoutes, { effortSlider: opts.effortSlider });
  const routed = new Set(routes.map(route => `${route.providerId}:${route.modelId}`));
  const cutByVariants = launchable
    .filter(entry => !routed.has(`${entry.providerId}:${entry.model.id}`))
    .map(entry => ({ providerId: entry.providerId, modelId: entry.model.id }));

  return {
    routes,
    apiKey,
    droppedFavorites: [
      ...droppedFavorites,
      ...tooSmall.map(entry => ({ providerId: entry.providerId, modelId: entry.model.id })),
    ],
    capacitySkippedFavorites: [...cutByVariants, ...capacitySkippedFavorites],
  };
}
