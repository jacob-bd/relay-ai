// Route map + catalog assembly for the mid-session /model switch menu.
import { BACKENDS, MAX_MODEL_CATALOG } from './constants.js';
import { aliasModelId } from './proxy.js';
import type { ProxyRoute } from './proxy.js';
import type { FavoriteModel, LocalProvider, LocalProviderModel, ModelInfo } from './types.js';

export function localModelToRoute(lp: LocalProvider, model: LocalProviderModel): ProxyRoute | null {
  if (!model.completionsUrl && !model.baseUrl) return null;
  return {
    aliasId: aliasModelId(model.id, lp.name),
    realModelId: model.id,
    displayName: `${model.name || model.id} (${lp.name})`,
    upstreamUrl: (model.modelFormat === 'anthropic' ? model.baseUrl : model.completionsUrl) ?? '',
    apiKey: lp.apiKey,
    modelFormat: model.modelFormat,
    contextWindow: model.contextWindow,
    npm: model.npm,
    baseURL: model.apiBaseUrl,
  };
}

export function zenGoModelToRoute(model: ModelInfo, apiKey: string): ProxyRoute | null {
  if (model.modelFormat === 'unsupported') return null;
  const backend = BACKENDS[model.sourceBackend];
  const isAnthropic = model.modelFormat === 'anthropic';
  return {
    aliasId: aliasModelId(model.id, backend.name),
    realModelId: model.id,
    displayName: `${model.name} (${backend.name})`,
    upstreamUrl: isAnthropic ? backend.baseUrl : `${backend.baseUrl}/v1/chat/completions`,
    apiKey,
    modelFormat: model.modelFormat as 'anthropic' | 'openai',
    contextWindow: model.contextWindow,
    // openai-format Zen/Go models route through the SDK (openai-compatible);
    // anthropic models stay direct passthrough (no npm).
    npm: isAnthropic ? undefined : '@ai-sdk/openai-compatible',
    baseURL: isAnthropic ? undefined : `${backend.baseUrl}/v1`,
  };
}

export function makeRouteResolver(
  localProviders: LocalProvider[] | null,
  zenModels: ModelInfo[],
  goModels: ModelInfo[],
  zenGoApiKey: string | null,
): (providerId: string, modelId: string) => ProxyRoute | undefined {
  return (providerId, modelId) => {
    if (providerId === 'zen' || providerId === 'go') {
      if (!zenGoApiKey) return undefined;
      const model = (providerId === 'zen' ? zenModels : goModels).find(m => m.id === modelId);
      return model ? zenGoModelToRoute(model, zenGoApiKey) ?? undefined : undefined;
    }
    const provider = localProviders?.find(lp => lp.id === providerId);
    const model = provider?.models.find(m => m.id === modelId);
    return provider && model ? localModelToRoute(provider, model) ?? undefined : undefined;
  };
}

export function buildCatalogRoutes(
  startingRoute: ProxyRoute,
  favorites: FavoriteModel[],
  resolveRoute: (providerId: string, modelId: string) => ProxyRoute | undefined,
  max = MAX_MODEL_CATALOG,
): ProxyRoute[] {
  const tail = favorites
    .map(fav => resolveRoute(fav.providerId, fav.modelId))
    .filter((route): route is ProxyRoute => route !== undefined);
  return [
    startingRoute,
    ...tail.filter(route => route.aliasId !== startingRoute.aliasId),
  ].slice(0, max);
}
