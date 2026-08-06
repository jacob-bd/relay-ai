// Route map + catalog assembly for the mid-session /model switch menu.
import { BACKENDS, MAX_MODEL_CATALOG } from './constants.js';
import { claudeCodeClientModelId } from './context-model-id.js';
import { ANTIGRAVITY_BASE_URLS } from './oauth/antigravity-oauth.js';
import { isSdkMigratedNpm } from './provider-factory.js';
import { aliasModelId } from './proxy.js';
import { providerRefreshToken } from './provider-runtime.js';
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
    refreshToken: providerRefreshToken(lp.id, lp.authType, lp.authRef),
    headers: lp.headers,
    supportedParameters: model.supportedParameters,
    reasoning: model.reasoning,
    interleavedReasoningField: model.interleavedReasoningField,
    useResponsesLite: model.useResponsesLite,
    preferWebSockets: model.preferWebSockets,
  };
}

export function makeRouteResolver(
  localProviders: LocalProvider[] | null,
): (providerId: string, modelId: string) => ProxyRoute | undefined {
  return (providerId, modelId) => {
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
