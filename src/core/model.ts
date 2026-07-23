// src/core/model.ts — construct a ready Vercel AI SDK LanguageModel from a route id.

import type { LanguageModel } from 'ai';
import {
  resolveProviderCredential,
  resolveProviderOAuthAccountId,
  resolveProviderOAuthProviderData,
} from '../env.js';
import { createLanguageModel, type ProviderModelSpec } from '../provider-factory.js';
import type { CachedModel, RegistryProvider } from '../registry/types.js';
import { loadCoreRegistry } from './catalog.js';
import { RelayCoreError, isRelayCoreError } from './errors.js';
import { parseRelayRouteId } from './route-id.js';
import type { RelayRouteId } from './types.js';

function findRoute(registry: ReturnType<typeof loadCoreRegistry>, providerId: string, modelId: string, routeId: RelayRouteId): { provider: RegistryProvider; model: CachedModel } {
  const provider = registry.providers.find(p => p.id === providerId);
  if (!provider) {
    throw new RelayCoreError('ROUTE_NOT_FOUND', `No provider registered with id "${providerId}".`, { providerId, routeId });
  }
  if (!provider.enabled) {
    throw new RelayCoreError('PROVIDER_DISABLED', `Provider "${provider.name}" is disabled — enable it in relay-ai ui.`, { providerId, routeId });
  }
  const model = provider.modelsCache?.models.find(m => m.id === modelId);
  if (!model) {
    throw new RelayCoreError('UNSUPPORTED_MODEL', `Provider "${provider.name}" has no cached model "${modelId}" — refresh its models in relay-ai ui.`, { providerId, routeId });
  }
  return { provider, model };
}

async function resolveCredential(provider: RegistryProvider, routeId: RelayRouteId): Promise<string> {
  try {
    const credential = await resolveProviderCredential(provider.id, provider.authRef);
    if (credential) return credential;
    if (provider.authType === 'none') return '';
    throw new RelayCoreError(
      'CREDENTIAL_UNAVAILABLE',
      `No credential available for provider "${provider.name}" — re-authenticate in relay-ai ui.`,
      { providerId: provider.id, routeId },
    );
  } catch (err) {
    if (isRelayCoreError(err)) throw err;
    if (provider.authType === 'oauth') {
      throw new RelayCoreError(
        'OAUTH_REFRESH_FAILED',
        `OAuth token refresh failed for provider "${provider.name}" — re-authenticate in relay-ai ui.`,
        { providerId: provider.id, routeId, cause: err },
      );
    }
    throw new RelayCoreError(
      'PROVIDER_LOAD_FAILED',
      `Failed to resolve the credential for provider "${provider.name}".`,
      { providerId: provider.id, routeId, cause: err },
    );
  }
}

/**
 * Build a ready Vercel AI SDK `LanguageModel` for a `provider::model` route id.
 *
 * Re-reads the registry, credentials, and OAuth state on every call — nothing is
 * cached across calls, so a provider disabled or re-authenticated after the last
 * call takes effect without restarting the consumer process. Credentials are
 * resolved (and OAuth tokens refreshed) by Relay's existing machinery; the
 * credential and the intermediate spec never leave this function.
 */
export async function createRelayModel(routeId: RelayRouteId): Promise<LanguageModel> {
  const { providerId, modelId } = parseRelayRouteId(routeId);
  const registry = loadCoreRegistry();
  const { provider, model } = findRoute(registry, providerId, modelId, routeId);

  const npm = model.npm ?? provider.api.npm;
  if (!npm) {
    throw new RelayCoreError('UNSUPPORTED_MODEL', `Model "${modelId}" has no SDK provider package — refresh the provider's models in relay-ai ui.`, { providerId, routeId });
  }

  const apiKey = await resolveCredential(provider, routeId);

  let oauthAccountId: string | undefined;
  let providerData: Record<string, unknown> | undefined;
  if (provider.authType === 'oauth') {
    oauthAccountId = await resolveProviderOAuthAccountId(provider.authRef);
    providerData = await resolveProviderOAuthProviderData(provider.authRef);
  }

  const spec: ProviderModelSpec = {
    npm,
    modelId: model.upstreamModelId ?? model.id,
    apiKey,
    baseURL: model.apiUrl ?? provider.api.url,
    providerId: provider.id,
    authType: provider.authType,
    oauthAccountId,
    providerData,
    headers: provider.api.headers,
    useResponsesLite: model.useResponsesLite,
    preferWebSockets: model.preferWebSockets,
  };

  try {
    return await createLanguageModel(spec);
  } catch (err) {
    if (isRelayCoreError(err)) throw err;
    throw new RelayCoreError(
      'PROVIDER_LOAD_FAILED',
      `Failed to construct model "${modelId}" for provider "${provider.name}".`,
      { providerId, routeId, cause: err },
    );
  }
}
