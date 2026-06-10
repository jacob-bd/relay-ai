// src/registry/materialize.ts — registry entries → LocalProvider runtime shape

import { deriveBrand } from '../models.js';
import { resolveEndpoint } from '../providers.js';
import { resolveContextWindow } from '../context-window.js';
import type { LocalProvider, LocalProviderModel } from '../types.js';
import type { CachedModel, ProviderRegistry, RegistryProvider } from './types.js';
import { isValidProviderId } from './validate.js';

export type CredentialResolver = (provider: RegistryProvider) => string | null;

function cachedModelToLocal(
  cached: CachedModel,
  provider: RegistryProvider,
): LocalProviderModel | null {
  const npm = cached.npm ?? provider.api.npm ?? '';
  const apiUrl = cached.apiUrl ?? provider.api.url ?? '';
  const endpoint = resolveEndpoint(npm, apiUrl);
  if (endpoint === null) return null;

  return {
    id: cached.id,
    name: cached.name,
    family: cached.family ?? '',
    brand: cached.brand ?? deriveBrand(cached.family ?? ''),
    modelFormat: cached.modelFormat ?? endpoint.format,
    upstreamModelId: cached.upstreamModelId,
    baseUrl: endpoint.baseUrl,
    completionsUrl: endpoint.completionsUrl,
    npm: npm || undefined,
    apiBaseUrl: apiUrl || undefined,
    cost: cached.cost,
    contextWindow: cached.contextWindow ?? resolveContextWindow(cached.id),
  };
}

function materializeOne(
  provider: RegistryProvider,
  resolveCredential: CredentialResolver,
): LocalProvider | null {
  if (!provider.enabled) return null;
  if (!isValidProviderId(provider.id)) return null;

  const models: LocalProviderModel[] = [];
  for (const cached of provider.modelsCache?.models ?? []) {
    const model = cachedModelToLocal(cached, provider);
    if (model) models.push(model);
  }
  if (models.length === 0) return null;

  const apiKey = resolveCredential(provider) ?? '';
  if (!apiKey) return null;

  return {
    id: provider.id,
    name: provider.name,
    apiKey,
    models,
  };
}

/** Convert enabled registry providers with credentials into launch-time LocalProvider[]. */
export function materializeRegistry(
  registry: ProviderRegistry,
  resolveCredential: CredentialResolver,
): LocalProvider[] {
  const result: LocalProvider[] = [];
  for (const provider of registry.providers) {
    const local = materializeOne(provider, resolveCredential);
    if (local) result.push(local);
  }
  return result;
}
