import { claudeCodeClientModelId } from '../context-model-id.js';
import { resolveLocalProviderApiKey } from '../provider-catalog.js';
import type { FavoriteModel, LocalProvider } from '../types.js';
import { createHttpProxyCaBundle } from './ca.js';
import {
  buildHttpProxyRoutes,
  httpProxyModelId,
  type HttpProxyRouteResult,
} from './routes.js';
import { startHttpProxy, type HttpProxyHandle } from './server.js';

type CredentialResolver = (provider: LocalProvider) => Promise<string | null>;

/** Resolve credentials only for providers explicitly allowlisted for this launch. */
export async function resolveHttpProxyRoutes(
  providers: LocalProvider[],
  favorites: FavoriteModel[],
  selected?: FavoriteModel,
  resolveCredential: CredentialResolver = resolveLocalProviderApiKey,
): Promise<HttpProxyRouteResult> {
  const requestedProviderIds = new Set<string>();
  if (selected) requestedProviderIds.add(selected.providerId);
  for (const favorite of favorites) requestedProviderIds.add(favorite.providerId);

  const allowedProviders: LocalProvider[] = [];
  for (const providerId of requestedProviderIds) {
    const provider = providers.find(candidate => candidate.id === providerId);
    if (!provider) continue;
    allowedProviders.push({
      ...provider,
      apiKey: (await resolveCredential(provider)) ?? '',
    });
  }
  return buildHttpProxyRoutes(allowedProviders, favorites, selected);
}

export interface ConfiguredHttpProxy {
  handle: HttpProxyHandle;
  loaded: HttpProxyRouteResult;
  startingModel?: string;
}

export async function startConfiguredHttpProxy(options: {
  providers: LocalProvider[];
  favorites: FavoriteModel[];
  selected?: FavoriteModel;
  debug?: boolean;
  additionalCaCertPath?: string;
}): Promise<ConfiguredHttpProxy> {
  const loaded = await resolveHttpProxyRoutes(
    options.providers,
    options.favorites,
    options.selected,
  );
  const handle = await startHttpProxy({ routes: loaded.routes, debug: options.debug });
  try {
    handle.caCertPath = createHttpProxyCaBundle(
      handle.caCertPath,
      options.additionalCaCertPath,
    );
  } catch (error) {
    await handle.close();
    throw error;
  }

  let startingModel: string | undefined;
  if (options.selected) {
    const selectedModel = options.providers
      .find(provider => provider.id === options.selected!.providerId)
      ?.models.find(model => model.id === options.selected!.modelId);
    const expectedId = selectedModel
      ? claudeCodeClientModelId(
          httpProxyModelId(options.selected.providerId, options.selected.modelId),
          selectedModel.contextWindow,
        )
      : undefined;
    startingModel = loaded.routes.find(route => route.aliasId === expectedId)?.aliasId;
  }
  return { handle, loaded, startingModel };
}
