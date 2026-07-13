import { MAX_MODEL_CATALOG } from '../constants.js';
import { localModelToRoute } from '../catalog.js';
import { isSdkMigratedNpm } from '../provider-factory.js';
import { claudeCodeClientModelId } from '../context-model-id.js';
import type { ProxyRoute } from '../proxy.js';
import type { FavoriteModel, LocalProvider } from '../types.js';

export const HTTP_PROXY_MODEL_PREFIX = 'relay:';

export function httpProxyModelId(providerId: string, modelId: string): string {
  return `${HTTP_PROXY_MODEL_PREFIX}${providerId}:${modelId}`;
}

export interface HttpProxyRouteResult {
  routes: ProxyRoute[];
  unavailable: FavoriteModel[];
  unsupported: FavoriteModel[];
}

/** Build a positive allowlist: only favorite AI-SDK routes can leave Anthropic's path. */
export function buildHttpProxyRoutes(
  providers: LocalProvider[],
  favorites: FavoriteModel[],
  max = MAX_MODEL_CATALOG,
): HttpProxyRouteResult {
  const routes: ProxyRoute[] = [];
  const unavailable: FavoriteModel[] = [];
  const unsupported: FavoriteModel[] = [];
  const seen = new Set<string>();

  for (const favorite of favorites) {
    if (routes.length >= max) break;
    const provider = providers.find(item => item.id === favorite.providerId);
    const model = provider?.models.find(item => item.id === favorite.modelId);
    if (!provider || !model) {
      unavailable.push(favorite);
      continue;
    }
    if (model.modelFormat !== 'openai' || !isSdkMigratedNpm(model.npm)) {
      unsupported.push(favorite);
      continue;
    }
    const route = localModelToRoute(provider, model);
    if (!route || !route.apiKey.trim()) {
      unavailable.push(favorite);
      continue;
    }
    const aliasId = claudeCodeClientModelId(
      httpProxyModelId(provider.id, model.id),
      model.contextWindow,
    );
    if (seen.has(aliasId)) continue;
    seen.add(aliasId);
    routes.push({
      ...route,
      aliasId,
      displayName: `${model.name || model.id} (${provider.name})`,
    });
  }

  return { routes, unavailable, unsupported };
}
