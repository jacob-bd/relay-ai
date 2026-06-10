// src/registry/refresh-models.ts — user-initiated model list refresh per modelSource

import { BACKENDS } from '../constants.js';
import { getModels } from '../models.js';
import { fetchAnthropicModels } from './custom-endpoint.js';
import { fetchTemplateModels } from './fetch-template-models.js';
import { loadRegistry, saveRegistry } from './io.js';
import { resolveModelSource } from './model-source.js';
import {
  effectiveProviderBaseUrl,
  resolveProviderTemplate,
  syntheticTemplate,
} from './resolve-template.js';
import {
  buildPricingIndex,
  enrichModelsWithPricing,
  enrichPricingAsync,
  loadPricingCache,
  pricingPlatformForProvider,
} from './pricing.js';
import { cachedModelCount, isLikelyPlaceholderKey, resolveRefreshCredential, skipWithCachedModels } from './refresh-credentials.js';
import type { CachedModel, ProviderRegistry, RegistryProvider } from './types.js';

export interface RefreshProviderResult {
  id: string;
  name: string;
  ok: boolean;
  modelCount?: number;
  skipped?: boolean;
  reason?: string;
}

export interface RefreshModelsResult {
  refreshed: RefreshProviderResult[];
}

function modelInfoToCached(
  m: {
    id: string;
    name: string;
    brand: string;
    modelFormat: string;
    contextWindow?: number;
    cost?: CachedModel['cost'];
    sourceBackend?: string;
  },
  npm?: string,
  apiUrl?: string,
): CachedModel {
  return {
    id: m.id,
    name: m.name,
    upstreamModelId: m.id,
    family: m.brand,
    brand: m.brand,
    contextWindow: m.contextWindow,
    cost: m.cost,
    modelFormat: m.modelFormat === 'anthropic' ? 'anthropic' : 'openai',
    sourceBackend: m.sourceBackend,
    npm,
    apiUrl,
  };
}

async function refreshZenGoProvider(provider: RegistryProvider): Promise<CachedModel[]> {
  const backendId = provider.id === 'go' || provider.templateId === 'go' ? 'go' : 'zen';
  const result = await getModels(BACKENDS[backendId]);
  return result.models
    .filter(m => m.modelFormat !== 'unsupported')
    .map(m => modelInfoToCached(m, '@ai-sdk/openai-compatible', `${BACKENDS[backendId].baseUrl}/v1`));
}

async function refreshApiListProvider(
  provider: RegistryProvider,
  apiKey: string,
): Promise<{ models: CachedModel[]; baseUrl?: string; error?: string }> {
  const npm = provider.api.npm ?? '@ai-sdk/openai-compatible';
  const catalogTemplate = resolveProviderTemplate(provider);
  const baseUrl = effectiveProviderBaseUrl(provider, catalogTemplate);
  const template = catalogTemplate ?? syntheticTemplate(provider, baseUrl);

  if (!baseUrl) {
    return { models: [], error: 'Provider has no API base URL configured.' };
  }

  if (npm === '@ai-sdk/anthropic') {
    const fetched = await fetchAnthropicModels(baseUrl, apiKey);
    if (fetched.error || fetched.models.length === 0) {
      return { models: [], error: fetched.error ?? 'No models returned.', baseUrl: fetched.baseUrl };
    }
    return {
      models: fetched.models.map(m => ({ ...m, apiUrl: fetched.baseUrl })),
      baseUrl: fetched.baseUrl,
    };
  }

  const fetched = await fetchTemplateModels(template, apiKey, baseUrl);
  if (fetched.error || fetched.models.length === 0) {
    return { models: [], error: fetched.error ?? 'No models returned.' };
  }

  return {
    models: fetched.models.map(m => ({
      ...m,
      apiUrl: fetched.baseUrl,
    })),
    baseUrl: fetched.baseUrl,
  };
}

function updateProviderCache(
  registry: ProviderRegistry,
  providerId: string,
  models: CachedModel[],
  baseUrl?: string,
): void {
  const idx = registry.providers.findIndex(p => p.id === providerId);
  if (idx < 0) return;
  const now = new Date().toISOString();
  const existing = registry.providers[idx]!;
  registry.providers[idx] = {
    ...existing,
    refreshedAt: now,
    api: baseUrl ? { ...existing.api, url: baseUrl } : existing.api,
    modelsCache: {
      fetchedAt: now,
      models,
    },
  };
}

export async function refreshProviderModels(
  providerId: string,
  apiKey: string | null,
  registry = loadRegistry(),
): Promise<RefreshProviderResult> {
  const provider = registry.providers.find(p => p.id === providerId);
  if (!provider) {
    return { id: providerId, name: providerId, ok: false, reason: 'Provider not found.' };
  }

  const source = resolveModelSource(provider);
  if (source === 'manual-only') {
    const hint =
      provider.templateId === 'google-vertex' || provider.id === 'google-vertex' || provider.api.npm === '@ai-sdk/google-vertex'
        ? 'Vertex uses gcloud credentials — re-import from OpenCode or use relay-ai server --vertex.'
        : 'Manual-only provider — model list is not refreshed automatically.';
    return {
      id: provider.id,
      name: provider.name,
      ok: true,
      skipped: true,
      reason: hint,
    };
  }

  try {
    let models: CachedModel[] = [];
    let baseUrl: string | undefined;

    if (source === 'zen-go-api') {
      models = await refreshZenGoProvider(provider);
    } else {
  if (isLikelyPlaceholderKey(apiKey)) {
        if (cachedModelCount(provider) > 0) {
          return skipWithCachedModels(
            provider,
            'OpenCode imported a placeholder API key — kept cached model list. '
            + 'Add this provider again via relay-ai providers add with a real key to refresh live.',
          );
        }
        return {
          id: provider.id,
          name: provider.name,
          ok: false,
          reason: 'No usable API key — add the provider via relay-ai providers add with a real key.',
        };
      }
      if (!apiKey) {
        return {
          id: provider.id,
          name: provider.name,
          ok: false,
          reason: 'API key not available — cannot refresh models.',
        };
      }
      const fetched = await refreshApiListProvider(provider, apiKey);
      if (fetched.error) {
        if (
          (fetched.error.includes('rejected') || fetched.error.includes('401') || fetched.error.includes('403'))
          && cachedModelCount(provider) > 0
        ) {
          return skipWithCachedModels(
            provider,
            `${fetched.error} Kept ${cachedModelCount(provider)} cached model${cachedModelCount(provider) === 1 ? '' : 's'} from import. `
            + 'Update your API key via relay-ai providers add if you need a live refresh.',
          );
        }
        return { id: provider.id, name: provider.name, ok: false, reason: fetched.error };
      }
      models = fetched.models;
      baseUrl = fetched.baseUrl;
    }

    const pricingCache = loadPricingCache();
    const platform = pricingPlatformForProvider(provider.templateId, provider.id);
    const enriched = enrichModelsWithPricing(models, buildPricingIndex(pricingCache), platform);

    updateProviderCache(registry, providerId, enriched, baseUrl);
    saveRegistry(registry);
    enrichPricingAsync();

    return {
      id: provider.id,
      name: provider.name,
      ok: true,
      modelCount: enriched.length,
    };
  } catch (err) {
    return {
      id: provider.id,
      name: provider.name,
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function refreshAllProviderModels(
  resolveKey: (provider: RegistryProvider) => Promise<string | null>,
): Promise<RefreshModelsResult> {
  const refreshed: RefreshProviderResult[] = [];
  const ids = loadRegistry().providers.filter(p => p.enabled).map(p => p.id);

  for (const id of ids) {
    const registry = loadRegistry();
    const provider = registry.providers.find(p => p.id === id);
    if (!provider) continue;
    const key = await resolveRefreshCredential(provider, resolveKey);
    refreshed.push(await refreshProviderModels(id, key, registry));
  }

  return { refreshed };
}
