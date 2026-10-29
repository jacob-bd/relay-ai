import { startProxyCatalog, aliasModelId, type ProxyHandle, type ProxyRoute } from './proxy.js';
import { claudeCodeClientModelId } from './context-model-id.js';
import { ANTIGRAVITY_BASE_URLS } from './oauth/antigravity-oauth.js';
import { resolveProviderCredential } from './env.js';
import { oauthAuthRef } from './registry/import-build.js';
import type { LocalProviderModel } from './types.js';

export interface CloudCodeBackend {
  port: number;
  token: string;
  handle: ProxyHandle;
}

export function needsCloudCodeBackend(
  model: LocalProviderModel,
  authType?: 'api' | 'oauth' | 'none',
): boolean {
  return model.modelFormat === 'cloud-code'
    || (model.modelFormat === 'anthropic' && authType === 'oauth');
}

export interface BackendPartitionInput {
  providerId: string;
  model: LocalProviderModel;
  apiKey: string;
  providerData?: Record<string, unknown>;
}

/**
 * Build a ProxyRoute for a cloud-code model from the antigravity provider.
 * aliasId is constructed to be stable and consistent with what startProxy uses,
 * so callers can use route.aliasId as the modelId in downstream Codex/server routes.
 */
export function buildCloudCodeProxyRoute(
  model: LocalProviderModel,
  apiKey: string,
  providerData: Record<string, unknown>,
  /** The registry id of the account (`antigravity`, `antigravity-2`, …); names the alias and the token to refresh. */
  providerId = 'antigravity',
): ProxyRoute {
  const aliasId = claudeCodeClientModelId(
    aliasModelId(model.id, providerId),
    model.contextWindow,
  );
  return {
    aliasId,
    realModelId: model.upstreamModelId || model.id,
    displayName: model.name || model.id,
    upstreamUrl: ANTIGRAVITY_BASE_URLS[0]!,
    apiKey,
    modelFormat: 'cloud-code',
    contextWindow: model.contextWindow,
    providerId,
    authType: 'oauth',
    providerData,
    refreshToken: () => resolveProviderCredential(providerId, oauthAuthRef(providerId)),
  };
}

/**
 * Build a ProxyRoute for an OAuth anthropic model (e.g. claude-code provider).
 * The proxy handles Bearer auth + identity injection — downstream codex/gemini
 * proxies treat this as a regular local anthropic endpoint.
 */
export function buildOAuthAnthropicProxyRoute(
  model: LocalProviderModel,
  apiKey: string,
  providerId: string,
  providerData: Record<string, unknown>,
): ProxyRoute {
  const aliasId = claudeCodeClientModelId(
    aliasModelId(model.id, providerId),
    model.contextWindow,
  );
  return {
    aliasId,
    realModelId: model.upstreamModelId || model.id,
    displayName: model.name || model.id,
    upstreamUrl: model.baseUrl ?? 'https://api.anthropic.com',
    apiKey,
    modelFormat: 'anthropic',
    contextWindow: model.contextWindow,
    providerId,
    authType: 'oauth',
    providerData,
    refreshToken: () => resolveProviderCredential(providerId, oauthAuthRef(providerId)),
  };
}

export async function partitionAndStartCloudCodeBackend<
  TInput extends BackendPartitionInput,
  TOutput,
>(
  items: TInput[],
  toOutput: (proxyRoute: ProxyRoute, backend: CloudCodeBackend, original: TInput) => TOutput,
  trace?: boolean,
): Promise<{ backendItems: TOutput[]; backend: CloudCodeBackend | null }> {
  if (items.length === 0) return { backendItems: [], backend: null };

  const proxyRoutes = items.map(item =>
    item.model.modelFormat === 'cloud-code'
      ? buildCloudCodeProxyRoute(item.model, item.apiKey, item.providerData ?? {}, item.providerId)
      : buildOAuthAnthropicProxyRoute(item.model, item.apiKey, item.providerId, item.providerData ?? {}),
  );
  const backend = await startCloudCodeCatalogBackend(proxyRoutes, proxyRoutes[0]!.aliasId, trace);

  return {
    backend,
    backendItems: proxyRoutes.map((proxyRoute, index) => toOutput(proxyRoute, backend, items[index]!)),
  };
}

export async function buildSingleModelCloudCodeRoute(
  model: LocalProviderModel,
  apiKey: string,
  providerId: string,
  providerData: Record<string, unknown>,
  trace?: boolean,
): Promise<{ proxyRoute: ProxyRoute; backend: CloudCodeBackend }> {
  const proxyRoute = model.modelFormat === 'cloud-code'
    ? buildCloudCodeProxyRoute(model, apiKey, providerData, providerId)
    : buildOAuthAnthropicProxyRoute(model, apiKey, providerId, providerData);
  const backend = await startCloudCodeCatalogBackend([proxyRoute], proxyRoute.aliasId, trace);
  return { proxyRoute, backend };
}

/** Start a multi-model cloud-code backend proxy (one instance for all routes). */
export async function startCloudCodeCatalogBackend(
  routes: ProxyRoute[],
  startingAliasId: string,
  trace?: boolean,
): Promise<CloudCodeBackend> {
  const handle = await startProxyCatalog(routes, startingAliasId, trace ?? false);
  return { port: handle.port, token: handle.token, handle };
}
