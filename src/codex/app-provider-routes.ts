import type { CodexProxyRoute } from '../codex-proxy.js';
import {
  needsCloudCodeBackend,
  partitionAndStartCloudCodeBackend,
  type CloudCodeBackend,
} from '../cloud-code-backend.js';
import type { LocalProvider, LocalProviderModel } from '../types.js';
import {
  resolveCodexRoute,
  routableModelsForProvider,
} from './routing.js';

export interface CodexAppProviderCatalogRoutes {
  routable: LocalProviderModel[];
  catalogModels: LocalProviderModel[];
  routes: CodexProxyRoute[];
  selectedRoute: CodexProxyRoute;
  backend: CloudCodeBackend | null;
}

function codexRouteToProxyRoute(
  provider: LocalProvider,
  model: LocalProviderModel,
  apiKey: string,
): CodexProxyRoute {
  const route = resolveCodexRoute(provider, model, apiKey);
  return {
    modelId: route.modelId,
    npm: route.npm,
    apiKey: route.apiKey,
    baseURL: route.baseURL,
    upstreamModelId: route.upstreamModelId,
    providerId: route.providerId,
    authType: route.authType,
    oauthAccountId: route.oauthAccountId,
    providerData: route.providerData,
    contextWindow: route.contextWindow,
    supportedParameters: route.supportedParameters,
    reasoning: route.reasoning,
    interleavedReasoningField: route.interleavedReasoningField,
    headers: route.headers,
    refreshToken: route.refreshToken,
  };
}

export async function buildCodexAppProviderCatalogRoutes(
  provider: LocalProvider,
  apiKey: string,
  selectedModelId: string,
  trace?: boolean,
): Promise<CodexAppProviderCatalogRoutes> {
  const routable = routableModelsForProvider(provider, 'codex-app');
  const ordered = [
    ...routable.filter(model => model.id === selectedModelId),
    ...routable.filter(model => model.id !== selectedModelId),
  ];

  const routeByModelId = new Map<string, CodexProxyRoute>();
  const catalogModelByModelId = new Map<string, LocalProviderModel>();
  const backendModels = ordered.filter(model => needsCloudCodeBackend(model, provider.authType));
  const regularModels = ordered.filter(model => !needsCloudCodeBackend(model, provider.authType));

  for (const model of regularModels) {
    routeByModelId.set(model.id, codexRouteToProxyRoute(provider, model, apiKey));
    catalogModelByModelId.set(model.id, model);
  }

  const partitioned = await partitionAndStartCloudCodeBackend(
    backendModels.map(model => ({
      providerId: provider.id,
      model,
      apiKey,
      providerData: provider.providerData,
    })),
    (proxyRoute, backend, original) => ({
      modelId: proxyRoute.aliasId,
      npm: '@ai-sdk/anthropic',
      apiKey: backend.token,
      baseURL: `http://127.0.0.1:${backend.port}`,
      upstreamModelId: proxyRoute.aliasId,
      providerId: proxyRoute.providerId ?? original.providerId,
      authType: 'oauth' as const,
      oauthAccountId: provider.oauthAccountId,
      providerData: provider.providerData,
      contextWindow: proxyRoute.contextWindow,
      supportedParameters: original.model.supportedParameters,
      reasoning: original.model.reasoning,
      interleavedReasoningField: original.model.interleavedReasoningField,
      headers: provider.headers,
    }),
    trace,
  );

  for (let index = 0; index < backendModels.length; index++) {
    const model = backendModels[index]!;
    const route = partitioned.backendItems[index]!;
    routeByModelId.set(model.id, route);
    catalogModelByModelId.set(model.id, {
      ...model,
      id: route.modelId,
      upstreamModelId: route.upstreamModelId,
      npm: route.npm,
    });
  }

  const routes = ordered
    .map(model => routeByModelId.get(model.id))
    .filter((route): route is CodexProxyRoute => route !== undefined);
  const catalogModels = ordered
    .map(model => catalogModelByModelId.get(model.id))
    .filter((model): model is LocalProviderModel => model !== undefined);
  const selectedRoute = routeByModelId.get(selectedModelId) ?? routes[0];
  if (!selectedRoute) {
    throw new Error(`No Codex App route available for selected model ${selectedModelId}`);
  }

  return {
    routable,
    catalogModels,
    routes,
    selectedRoute,
    backend: partitioned.backend,
  };
}
