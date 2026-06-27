// src/registry/materialize.ts — registry entries → LocalProvider runtime shape

import { shouldHideModel, type CompatibilityAgent } from '../model-compatibility.js';
import { deriveBrand } from '../models.js';
import { resolveEndpoint } from '../providers.js';
import { resolveContextWindow } from '../context-window.js';
import type { LocalProvider, LocalProviderModel } from '../types.js';
import { normalizeGoogleDisplayName, normalizeGoogleModelId } from './google-model-id.js';
import { findModelsDevModel } from './models-dev.js';
import type { CachedModel, ProviderRegistry, RegistryProvider } from './types.js';
import { isValidProviderId } from './validate.js';

export type CredentialResolver = (provider: RegistryProvider) => string | null;

export interface MaterializeOptions {
  agent?: CompatibilityAgent;
}

function cachedModelToLocal(
  cached: CachedModel,
  provider: RegistryProvider,
): LocalProviderModel | null {
  // Cloud Code models route through the cloud-code proxy — no SDK endpoint needed.
  if (cached.modelFormat === 'cloud-code') {
    const { id } = normalizeGoogleModelId(cached.id, '');
    return {
      id,
      name: cached.name,
      family: cached.family ?? '',
      brand: cached.brand ?? deriveBrand(cached.family ?? ''),
      modelFormat: 'cloud-code',
      upstreamModelId: cached.upstreamModelId ?? cached.id,
      contextWindow: cached.contextWindow ?? resolveContextWindow(id),
      reasoning: cached.reasoning,
      interleavedReasoningField: cached.interleavedReasoningField,
    };
  }

  const npm = cached.npm ?? provider.api.npm ?? '';
  const apiUrl = cached.apiUrl ?? provider.api.url ?? '';
  const endpoint = resolveEndpoint(npm, apiUrl);
  if (endpoint === null) return null;

  const modelsDev = findModelsDevModel(provider.id, cached.id);
  const { id, upstreamModelId } = normalizeGoogleModelId(cached.id, npm);
  const normalizedUpstream = normalizeGoogleModelId(cached.upstreamModelId ?? cached.id, npm).upstreamModelId;
  const family = npm === '@ai-sdk/google' ? (id.split(/[-/:]/)[0] ?? id) : (cached.family ?? '');

  return {
    id,
    name: npm === '@ai-sdk/google' ? normalizeGoogleDisplayName(cached.name, id) : cached.name,
    family,
    brand: npm === '@ai-sdk/google' ? deriveBrand(family) : (cached.brand ?? deriveBrand(cached.family ?? '')),
    modelFormat: cached.modelFormat ?? endpoint.format,
    upstreamModelId: normalizedUpstream,
    baseUrl: endpoint.baseUrl,
    completionsUrl: endpoint.completionsUrl,
    npm: npm || undefined,
    apiBaseUrl: apiUrl || undefined,
    cost: cached.cost,
    contextWindow: cached.contextWindow ?? resolveContextWindow(id),
    supportedParameters: cached.supportedParameters,
    reasoning: cached.reasoning ?? modelsDev?.reasoning,
    interleavedReasoningField: cached.interleavedReasoningField ?? modelsDev?.interleaved?.field,
  };
}

function materializeOne(
  provider: RegistryProvider,
  resolveCredential: CredentialResolver,
  agent: CompatibilityAgent,
): LocalProvider | null {
  if (!provider.enabled) return null;
  if (!isValidProviderId(provider.id)) return null;

  const models: LocalProviderModel[] = [];
  for (const cached of provider.modelsCache?.models ?? []) {
    const model = cachedModelToLocal(cached, provider);
    if (!model) continue;
    if (shouldHideModel({ providerId: provider.id, modelId: model.id, agent })) continue;
    models.push(model);
  }
  if (models.length === 0) return null;

  const apiKey = resolveCredential(provider) ?? '';
  if (!apiKey) return null;

  return {
    id: provider.id,
    name: provider.name,
    apiKey,
    authType: provider.authType,
    models,
  };
}

/** Convert enabled registry providers with credentials into launch-time LocalProvider[]. */
export function materializeRegistry(
  registry: ProviderRegistry,
  resolveCredential: CredentialResolver,
  opts?: MaterializeOptions,
): LocalProvider[] {
  const agent = opts?.agent ?? 'claude';
  const result: LocalProvider[] = [];
  for (const provider of registry.providers) {
    const local = materializeOne(provider, resolveCredential, agent);
    if (local) result.push(local);
  }
  return result;
}
