// src/registry/convert.ts — LocalProvider ↔ RegistryProvider conversion

import type { LocalProvider, LocalProviderModel } from '../types.js';
import type { CachedModel, RegistryProvider } from './types.js';
import { isValidProviderId } from './validate.js';

function modelToCached(model: LocalProviderModel): CachedModel {
  return {
    id: model.id,
    name: model.name,
    upstreamModelId: model.upstreamModelId,
    family: model.family,
    brand: model.brand,
    contextWindow: model.contextWindow,
    cost: model.cost,
    modelFormat: model.modelFormat,
    npm: model.npm,
    apiUrl: model.apiBaseUrl,
  };
}

/** Convert a normalized OpenCode/local provider into a registry entry (no secret write). */
export function localProviderToRegistry(provider: LocalProvider, templateId?: string): RegistryProvider | null {
  if (!isValidProviderId(provider.id)) return null;
  if (provider.models.length === 0) return null;

  const first = provider.models[0]!;
  const apiUrl = (first.apiBaseUrl ?? first.baseUrl)?.trim();
  return {
    id: provider.id,
    templateId: templateId ?? provider.id,
    name: provider.name,
    enabled: true,
    authRef: `keyring:provider:${provider.id}`,
    api: {
      npm: first.npm,
      ...(apiUrl ? { url: apiUrl } : {}),
    },
    addedAt: new Date().toISOString(),
    refreshedAt: new Date().toISOString(),
    modelsCache: {
      fetchedAt: new Date().toISOString(),
      models: provider.models.map(modelToCached),
    },
  };
}
