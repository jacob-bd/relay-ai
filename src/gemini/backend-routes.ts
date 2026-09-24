import {
  needsCloudCodeBackend,
  partitionAndStartCloudCodeBackend,
  type BackendPartitionInput,
  type CloudCodeBackend,
} from '../cloud-code-backend.js';
import type { ProxyRoute } from '../proxy.js';
import type { LocalProviderModel } from '../types.js';

interface GeminiBackendInput extends BackendPartitionInput {
  originalAliasId: string;
}

interface GeminiBackendRoute {
  originalAliasId: string;
  aliasId: string;
  backendUrl: string;
  apiKey: string;
}

export interface GeminiBackendRoutesResult {
  routes: ProxyRoute[];
  launchModelId: string;
  backend: CloudCodeBackend | null;
}

function routeToModel(route: ProxyRoute): LocalProviderModel {
  return {
    id: route.realModelId,
    name: route.displayName,
    upstreamModelId: route.realModelId,
    family: '',
    brand: '',
    modelFormat: route.modelFormat,
    baseUrl: route.modelFormat === 'anthropic' ? route.upstreamUrl : undefined,
    npm: route.npm,
    apiBaseUrl: route.baseURL,
    contextWindow: route.contextWindow,
    supportedParameters: route.supportedParameters,
    reasoning: route.reasoning,
    interleavedReasoningField: route.interleavedReasoningField,
    reasoningEffortLevels: route.reasoningEffortLevels,
    reasoningEffortConflict: route.reasoningEffortConflict,
  };
}

function routeNeedsBackend(route: ProxyRoute): boolean {
  return needsCloudCodeBackend(routeToModel(route), route.authType);
}

export async function rewriteGeminiBackendRoutes(
  routes: ProxyRoute[],
  launchModelId: string,
  trace?: boolean,
): Promise<GeminiBackendRoutesResult> {
  const backendInputs: GeminiBackendInput[] = routes
    .filter(routeNeedsBackend)
    .map(route => ({
      originalAliasId: route.aliasId,
      providerId: route.providerId ?? '',
      model: routeToModel(route),
      apiKey: route.apiKey,
      providerData: route.providerData,
    }));

  const partitioned = await partitionAndStartCloudCodeBackend(
    backendInputs,
    (proxyRoute, backend, original): GeminiBackendRoute => ({
      originalAliasId: original.originalAliasId,
      aliasId: proxyRoute.aliasId,
      backendUrl: `http://127.0.0.1:${backend.port}`,
      apiKey: backend.token,
    }),
    trace,
  );

  if (!partitioned.backend) {
    return { routes, launchModelId, backend: null };
  }

  const backendAliasMap = new Map(
    partitioned.backendItems.map(item => [item.originalAliasId, item]),
  );

  return {
    backend: partitioned.backend,
    launchModelId: backendAliasMap.get(launchModelId)?.aliasId ?? launchModelId,
    routes: routes.map(route => {
      const backendRoute = backendAliasMap.get(route.aliasId);
      if (!backendRoute) return route;

      return {
        ...route,
        aliasId: backendRoute.aliasId,
        realModelId: backendRoute.aliasId,
        upstreamUrl: backendRoute.backendUrl,
        apiKey: backendRoute.apiKey,
        modelFormat: 'anthropic',
        npm: '@ai-sdk/anthropic',
        baseURL: backendRoute.backendUrl,
        authType: undefined,
      };
    }),
  };
}
