import { localModelToRoute } from '../catalog.js';
import { MAX_MODEL_CATALOG } from '../constants.js';
import { claudeCodeClientModelId } from '../context-model-id.js';
import { isSdkMigratedNpm } from '../provider-factory.js';
import type { ProxyRoute } from '../proxy.js';
import type { FavoriteModel, LocalProvider, LocalProviderModel } from '../types.js';

export const HTTP_PROXY_MODEL_PREFIX = 'relay:';

export function httpProxyModelId(providerId: string, modelId: string): string {
  return `${HTTP_PROXY_MODEL_PREFIX}${providerId}:${modelId}`;
}

export interface HttpProxyRouteResult {
  routes: ProxyRoute[];
  unavailable: FavoriteModel[];
  unsupported: FavoriteModel[];
}

export function supportsClaudeTransparentMode(model: LocalProviderModel): boolean {
  return model.modelFormat === 'openai' && isSdkMigratedNpm(model.npm);
}

/**
 * Build the positive allowlist for a transparent Claude Code session.
 * Only the one-time launch selection and saved favorites can reach Relay providers.
 */
export function buildHttpProxyRoutes(
  providers: LocalProvider[],
  favorites: FavoriteModel[],
  selected?: FavoriteModel,
  max = MAX_MODEL_CATALOG,
): HttpProxyRouteResult {
  const routes: ProxyRoute[] = [];
  const unavailable: FavoriteModel[] = [];
  const unsupported: FavoriteModel[] = [];
  const seen = new Set<string>();
  const requested = selected ? [selected, ...favorites] : favorites;

  for (const item of requested) {
    const requestKey = `${item.providerId}\0${item.modelId}`;
    if (seen.has(requestKey)) continue;
    seen.add(requestKey);
    if (routes.length >= max) break;

    const provider = providers.find(candidate => candidate.id === item.providerId);
    const model = provider?.models.find(candidate => candidate.id === item.modelId);
    if (!provider || !model) {
      unavailable.push(item);
      continue;
    }
    if (!supportsClaudeTransparentMode(model)) {
      unsupported.push(item);
      continue;
    }

    const route = localModelToRoute(provider, model);
    if (!route || !route.apiKey.trim()) {
      unavailable.push(item);
      continue;
    }
    routes.push({
      ...route,
      aliasId: claudeCodeClientModelId(
        httpProxyModelId(provider.id, model.id),
        model.contextWindow,
      ),
      displayName: `${model.name || model.id} (${provider.name})`,
    });
  }

  return { routes, unavailable, unsupported };
}
