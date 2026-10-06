// src/registry/convert.ts — LocalProvider ↔ RegistryProvider conversion

import type { LocalProvider, LocalProviderModel } from '../types.js';
import { localIsoTimestamp } from '../trace-log.js';
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
    isFree: model.isFree,
    freeStatus: model.freeStatus,
    modelFormat: model.modelFormat,
    npm: model.npm,
    apiUrl: model.apiBaseUrl,
    supportedParameters: model.supportedParameters,
    reasoning: model.reasoning,
    interleavedReasoningField: model.interleavedReasoningField,
    useResponsesLite: model.useResponsesLite,
    preferWebSockets: model.preferWebSockets,
  };
}

/** Convert a normalized OpenCode/local provider into a registry entry (no secret write). */
export function localProviderToRegistry(
  provider: LocalProvider,
  opts?: { templateId?: string; authType?: 'api' | 'oauth'; authRef?: string },
): RegistryProvider | null {
  if (!isValidProviderId(provider.id)) return null;
  if (provider.models.length === 0) return null;

  const first = provider.models[0]!;
  const apiUrl = (first.apiBaseUrl ?? first.baseUrl)?.trim();
  const authType = opts?.authType ?? 'api';
  return {
    id: provider.id,
    templateId: opts?.templateId ?? provider.id,
    name: provider.name,
    enabled: true,
    authRef: opts?.authRef ?? `keyring:provider:${provider.id}`,
    authType,
    api: {
      npm: first.npm,
      ...(apiUrl ? { url: apiUrl } : {}),
    },
    addedAt: localIsoTimestamp(),
    modelsCache: {
      fetchedAt: localIsoTimestamp(),
      models: provider.models.map(modelToCached),
    },
  };
}
