import { MAX_MODEL_CATALOG } from '../constants.js';
import { resolveLocalProviderApiKey } from '../provider-catalog.js';
import { shouldHideModel } from '../model-compatibility.js';
import type { FavoriteModel, LocalProvider, LocalProviderModel } from '../types.js';
import { buildAntigravityRoutes } from './catalog.js';
import type { AntigravityRoute } from './types.js';

export interface ResolveAntigravityLaunchRoutesOptions {
  provider: LocalProvider;
  model: LocalProviderModel;
  allProviders: LocalProvider[];
  favorites?: FavoriteModel[];
  maxRoutes?: number;
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

  const droppedFavorites: FavoriteModel[] = [];
  const capacitySkippedFavorites: FavoriteModel[] = [];
  const seen = new Set<string>([`${opts.provider.id}::${opts.model.id}`]);
  const resolved = [{
    providerId: opts.provider.id,
    providerName: opts.provider.name,
    model: opts.model,
    apiKey,
    authType: opts.provider.authType,
    oauthAccountId: opts.provider.oauthAccountId,
  }];

  for (const favorite of opts.favorites ?? []) {
    const key = `${favorite.providerId}::${favorite.modelId}`;
    if (seen.has(key)) continue;

    if (resolved.length >= maxRoutes) {
      capacitySkippedFavorites.push(favorite);
      continue;
    }

    const favoriteProvider = opts.allProviders.find(provider => provider.id === favorite.providerId);
    const favoriteModel = favoriteProvider?.models.find(model => model.id === favorite.modelId);
    if (
      !favoriteProvider
      || !favoriteModel
      || shouldHideModel({
        providerId: favorite.providerId,
        modelId: favorite.modelId,
        agent: 'antigravity',
      })
    ) {
      droppedFavorites.push(favorite);
      continue;
    }

    const favoriteApiKey = await resolveLocalProviderApiKey(favoriteProvider);
    if (!favoriteApiKey) {
      droppedFavorites.push(favorite);
      continue;
    }

    seen.add(key);
    resolved.push({
      providerId: favoriteProvider.id,
      providerName: favoriteProvider.name,
      model: favoriteModel,
      apiKey: favoriteApiKey,
      authType: favoriteProvider.authType,
      oauthAccountId: favoriteProvider.oauthAccountId,
    });
  }

  return {
    routes: buildAntigravityRoutes(resolved, maxRoutes),
    apiKey,
    droppedFavorites,
    capacitySkippedFavorites,
  };
}
