// Route map + catalog assembly for the mid-session /model switch menu.
import { BACKENDS, MAX_MODEL_CATALOG } from './constants.js';
import { claudeCodeClientModelId } from './context-model-id.js';
import { ANTIGRAVITY_BASE_URLS } from './oauth/antigravity-oauth.js';
import { isSdkMigratedNpm } from './provider-factory.js';
import { aliasModelId } from './proxy.js';
import type { ProxyRoute } from './proxy.js';
import type { FavoriteModel, LocalProvider, LocalProviderModel, ModelInfo } from './types.js';

export function localModelToRoute(lp: LocalProvider, model: LocalProviderModel): ProxyRoute | null {
  if (model.modelFormat === 'anthropic' && !model.baseUrl) return null;
  if (model.modelFormat === 'openai' && !isSdkMigratedNpm(model.npm) && !model.completionsUrl) return null;
  const upstreamUrl = model.modelFormat === 'cloud-code'
    ? (model.baseUrl ?? ANTIGRAVITY_BASE_URLS[0])
    : (model.modelFormat === 'anthropic' ? model.baseUrl : model.completionsUrl);
  return {
    aliasId: claudeCodeClientModelId(aliasModelId(model.id, lp.id), model.contextWindow),
    realModelId: model.upstreamModelId,
    displayName: `${model.name || model.id} (${lp.name})`,
    upstreamUrl: upstreamUrl ?? '',
    apiKey: lp.apiKey,
    modelFormat: model.modelFormat,
    contextWindow: model.contextWindow,
    npm: model.npm,
    baseURL: model.apiBaseUrl,
    providerId: lp.id,
    authType: lp.authType,
    oauthAccountId: lp.oauthAccountId,
    providerData: lp.providerData,
    supportedParameters: model.supportedParameters,
    reasoning: model.reasoning,
    interleavedReasoningField: model.interleavedReasoningField,
  };
}

export function zenGoModelToRoute(model: ModelInfo, apiKey: string): ProxyRoute | null {
  if (model.modelFormat === 'unsupported') return null;
  const backend = BACKENDS[model.sourceBackend];
  const isAnthropic = model.modelFormat === 'anthropic';
  return {
    aliasId: claudeCodeClientModelId(aliasModelId(model.id, model.sourceBackend), model.contextWindow),
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
    providerId: model.sourceBackend,
    reasoning: model.reasoning,
    interleavedReasoningField: model.interleavedReasoningField,
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

/**
 * Claude-specific catalog builder. Takes a `resolveRoute` function (not a
 * ResolveContext) and returns built ProxyRoute[] — does NOT delegate to
 * `buildFavoritesList` in `./favorites-resolver.ts` because the input/output
 * shapes are different (closure-based lookup vs. ResolveContext, ProxyRoute
 * vs. ResolvedFavorite). The dedup+cap pattern is duplicated here on purpose;
 * cross-surface shared resolution lives in `favorites-resolver.ts` and is
 * intended to be consumed by other call sites (Codex, Server) that need a
 * route-shape-agnostic intermediate result.
 */
export function buildCatalogRoutes(
  startingRoute: ProxyRoute,
  favorites: FavoriteModel[],
  resolveRoute: (providerId: string, modelId: string) => ProxyRoute | undefined,
  max = MAX_MODEL_CATALOG,
): { routes: ProxyRoute[]; droppedFavorites: FavoriteModel[] } {
  const droppedFavorites: FavoriteModel[] = [];
  const tail = favorites
    .map(fav => {
      const route = resolveRoute(fav.providerId, fav.modelId);
      if (!route) droppedFavorites.push(fav);
      return route;
    })
    .filter((route): route is ProxyRoute => route !== undefined);
  const routes = [
    startingRoute,
    ...tail.filter(route => route.aliasId !== startingRoute.aliasId),
  ].slice(0, max);
  return { routes, droppedFavorites };
}
