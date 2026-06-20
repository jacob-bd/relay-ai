// src/registry/refresh-models.ts — user-initiated model list refresh per modelSource

import { BACKENDS } from '../constants.js';
import { getModels } from '../models.js';
import { fetchAnthropicModels } from './custom-endpoint.js';
import { fetchTemplateModels } from './fetch-template-models.js';
import { loadRegistry, saveRegistry } from './io.js';
import { resolveModelSource } from './model-source.js';
import { validateCustomEndpointUrl } from './url-security.js';
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
import { readGlobalOpencodeCredential } from '../env.js';
import type { CachedModel, ProviderRegistry, RegistryProvider } from './types.js';
import { buildOpenAiOAuthModels, CHATGPT_CODEX_UNSUPPORTED_MODELS } from '../data/openai-oauth-models.js';
import { buildXaiOAuthModels } from '../data/xai-oauth-models.js';
import { modelPrefersResponsesApi } from '../provider-factory.js';
import { deriveBrand } from '../models.js';
import { resolveContextWindow } from '../context-window.js';

export interface RefreshProviderResult {
  id: string;
  name: string;
  ok: boolean;
  modelCount?: number;
  previousModelCount?: number;
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
    .map(m => {
      const isAnthropic = m.modelFormat === 'anthropic';
      const npm = isAnthropic ? '@ai-sdk/anthropic' : '@ai-sdk/openai-compatible';
      const apiUrl = isAnthropic ? BACKENDS[backendId].baseUrl : `${BACKENDS[backendId].baseUrl}/v1`;
      return modelInfoToCached(m, npm, apiUrl);
    });
}

/**
 * OAuth model refresh:
 * - OpenAI OAuth: Fetch from chatgpt.com/backend-api/models using the OAuth access token.
 *   Falls back to static seed on network failure or unexpected response format.
 *   Note: api.openai.com/v1/models rejects OAuth tokens — never call that endpoint here.
 * - xAI OAuth: SuperGrok JWT differs from xai-... API keys. Try the live api.x.ai/v1/models
 *   endpoint first; fall back to static seed on 401/403.
 */
async function refreshOAuthProvider(
  provider: RegistryProvider,
  accessToken: string,
): Promise<{ models: CachedModel[]; baseUrl?: string; source: 'live' | 'seed' }> {
  const tpl = provider.templateId ?? provider.id;
  if (tpl === 'openai') return refreshOpenAiOAuthModels(accessToken);
  if (tpl === 'xai') return refreshXaiOAuthModels(accessToken);
  throw new Error(`refreshOAuthProvider: unsupported template "${tpl}"`);
}

/** Parse model entries from OpenAI-standard or ChatGPT-internal response shapes. */
function parseOpenAiModelEntries(
  body: unknown,
): Array<{ id: string; name: string }> {
  if (!body || typeof body !== 'object') return [];
  const b = body as Record<string, unknown>;

  // ChatGPT backend format: { models: [{ slug, title }] }
  if (Array.isArray(b.models)) {
    return (b.models as Array<{ slug?: string; title?: string; name?: string }>)
      .map(m => ({ id: m.slug ?? '', name: m.title ?? m.name ?? m.slug ?? '' }))
      .filter(m => m.id.length > 0);
  }
  // Standard OpenAI format: { data: [{ id, name }] }
  if (Array.isArray(b.data)) {
    return (b.data as Array<{ id?: string; name?: string }>)
      .map(m => ({ id: m.id ?? '', name: m.name ?? m.id ?? '' }))
      .filter(m => m.id.length > 0);
  }
  return [];
}

/** Build a CachedModel for a dynamically discovered OpenAI OAuth model. */
function buildDynamicOAuthModel(id: string, name: string, seedById: Map<string, CachedModel>): CachedModel {
  if (seedById.has(id)) return seedById.get(id)!;
  const prefix = id.split('-')[0] ?? id;
  return {
    id,
    name,
    upstreamModelId: id,
    family: prefix,
    brand: deriveBrand(prefix),
    contextWindow: resolveContextWindow(id),
    modelFormat: 'openai' as const,
    npm: '@ai-sdk/openai',
    reasoning: modelPrefersResponsesApi(id),
  };
}

/** Fetch and parse JSON from a URL with auth and timeout, returning null on any failure. */
async function fetchJsonWithAuth(
  url: string,
  accessToken: string,
  timeoutMs: number,
): Promise<unknown | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Fetch OpenAI OAuth (ChatGPT) models using a 3-tier strategy:
 *
 * 1. chatgpt.com/backend-api/codex/models — Codex-specific endpoint.
 *    If it exists, it returns ONLY models the Codex API actually supports,
 *    so no filtering is needed. Self-updating as OpenAI changes Codex availability.
 *
 * 2. chatgpt.com/backend-api/models — all ChatGPT models, filtered by the
 *    confirmed-bad set. Used when the Codex endpoint doesn't exist or returns nothing.
 *
 * 3. Static seed — emergency fallback with no network dependency.
 */
async function refreshOpenAiOAuthModels(
  accessToken: string,
): Promise<{ models: CachedModel[]; source: 'live' | 'seed' }> {
  const TIMEOUT_MS = 10_000;
  const seedById = new Map(buildOpenAiOAuthModels().map(m => [m.id, m]));
  const toModels = (entries: Array<{ id: string; name: string }>) =>
    entries.map(({ id, name }) => buildDynamicOAuthModel(id, name, seedById));

  // Tier 1: Codex-specific model listing — source of truth for Codex availability.
  const codexBody = await fetchJsonWithAuth(
    'https://chatgpt.com/backend-api/codex/models',
    accessToken,
    TIMEOUT_MS,
  );
  const codexEntries = parseOpenAiModelEntries(codexBody);
  if (codexEntries.length > 0) {
    return { models: toModels(codexEntries), source: 'live' };
  }

  // Tier 2: General ChatGPT model list, filtered by known Codex restrictions.
  const chatGptBody = await fetchJsonWithAuth(
    'https://chatgpt.com/backend-api/models',
    accessToken,
    TIMEOUT_MS,
  );
  const chatGptEntries = parseOpenAiModelEntries(chatGptBody)
    .filter(({ id }) => !CHATGPT_CODEX_UNSUPPORTED_MODELS.has(id));
  if (chatGptEntries.length > 0) {
    return { models: toModels(chatGptEntries), source: 'live' };
  }

  // Tier 3: Static seed — reuse already-built map instead of calling the builder again.
  return { models: [...seedById.values()], source: 'seed' };
}

/**
 * Try fetching xAI models from api.x.ai/v1/models using the OAuth JWT.
 * Falls back to static seed if rejected (SuperGrok JWT ≠ xai-... API key format).
 */
async function refreshXaiOAuthModels(
  accessToken: string,
): Promise<{ models: CachedModel[]; source: 'live' | 'seed' }> {
  const seed = buildXaiOAuthModels();
  const seedById = new Map(seed.map(m => [m.id, m]));

  const body = await fetchJsonWithAuth('https://api.x.ai/v1/models', accessToken, 8_000);
  if (body) {
    const ids = ((body as { data?: Array<{ id?: string }> }).data ?? [])
      .map(m => m.id)
      .filter((id): id is string => !!id);
    if (ids.length > 0) {
      const live = ids.map(id => {
        const cached = seedById.get(id);
        if (cached) return cached;
        const prefix = id.split('-')[0] ?? id;
        return { id, name: id, upstreamModelId: id, family: prefix, brand: deriveBrand(prefix), contextWindow: resolveContextWindow(id), modelFormat: 'openai' as const, npm: '@ai-sdk/xai', reasoning: modelPrefersResponsesApi(id) } satisfies CachedModel;
      });
      return { models: live, source: 'live' };
    }
  }
  return { models: seed, source: 'seed' };
}


async function refreshApiListProvider(
  provider: RegistryProvider,
  apiKey: string,
): Promise<{ models: CachedModel[]; baseUrl?: string; error?: string }> {
  const npm = provider.api.npm ?? '@ai-sdk/openai-compatible';
  const catalogTemplate = resolveProviderTemplate(provider);
  const baseUrl = effectiveProviderBaseUrl(provider, catalogTemplate);

  if (!baseUrl) {
    return { models: [], error: 'Provider has no API base URL configured.' };
  }

  let safeBaseUrl = baseUrl;
  const configuredUrl = provider.api.url?.trim();
  const templateDefault = catalogTemplate?.defaultBaseUrl?.trim();
  if (configuredUrl && configuredUrl !== templateDefault) {
    const urlCheck = await validateCustomEndpointUrl(baseUrl, {
      allowInsecureLocal: catalogTemplate?.apiKeyOptional === true,
    });
    if (!urlCheck.ok || !urlCheck.normalizedUrl) {
      return { models: [], error: `${urlCheck.error ?? 'Invalid API base URL.'} ${urlCheck.hint ?? ''}`.trim() };
    }
    safeBaseUrl = urlCheck.normalizedUrl;
  }

  const template = catalogTemplate ?? syntheticTemplate(provider, safeBaseUrl);

  if (npm === '@ai-sdk/anthropic') {
    const fetched = await fetchAnthropicModels(safeBaseUrl, apiKey);
    if (fetched.error || fetched.models.length === 0) {
      return { models: [], error: fetched.error ?? 'No models returned.', baseUrl: fetched.baseUrl };
    }
    return {
      models: fetched.models.map(m => ({ ...m, apiUrl: fetched.baseUrl })),
      baseUrl: fetched.baseUrl,
    };
  }

  const fetched = await fetchTemplateModels(template, apiKey, safeBaseUrl);
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
        ? 'Vertex uses gcloud credentials — re-import from OpenCode or configure env auth.'
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
    const previousModelCount = provider.modelsCache?.models.length ?? 0;
    let models: CachedModel[] = [];
    let baseUrl: string | undefined;

    if (source === 'zen-go-api') {
      models = await refreshZenGoProvider(provider);
    } else if (provider.authType === 'oauth' && (['openai', 'xai'].includes(provider.templateId ?? provider.id) || provider.id === 'openai-oauth')) {
      // OAuth tokens are not valid API keys for the developer endpoints.
      // OpenAI: ChatGPT JWT rejected by api.openai.com; no /v1/models on ChatGPT backend.
      // xAI: SuperGrok JWT rejected by api.x.ai; falls back to static seed.
      if (!apiKey) {
        return {
          id: provider.id,
          name: provider.name,
          ok: false,
          reason: 'OAuth token not available — try signing in again with relay-ai providers auth.',
        };
      }
      const oauthResult = await refreshOAuthProvider(provider, apiKey);
      models = oauthResult.models;
      if (models.length === 0) {
        return {
          id: provider.id,
          name: provider.name,
          ok: false,
          reason: 'No models available for this OAuth provider — try signing in again.',
        };
      }
    } else {
      const template = resolveProviderTemplate(provider);
      const keyOptional = template?.apiKeyOptional === true;
      const effectiveKey = keyOptional && isLikelyPlaceholderKey(apiKey) ? '' : apiKey;
      if (!keyOptional && isLikelyPlaceholderKey(effectiveKey)) {
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
      if (!keyOptional && !effectiveKey) {
        return {
          id: provider.id,
          name: provider.name,
          ok: false,
          reason: 'API key not available — cannot refresh models.',
        };
      }
      const fetched = await refreshApiListProvider(provider, effectiveKey ?? '');
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
      previousModelCount: provider.refreshedAt ? previousModelCount : undefined,
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
  const registry = loadRegistry();

  const opencodeKey = await readGlobalOpencodeCredential();

  if (opencodeKey) {
    let changed = false;
    if (!registry.providers.some(p => p.id === 'zen')) {
      registry.providers.push({
        id: 'zen',
        templateId: 'zen',
        name: 'OpenCode Zen',
        enabled: true,
        authRef: 'keyring:global:opencode',
        authType: 'none',
        subscriptionFilter: 'free',
        api: {},
        addedAt: new Date().toISOString(),
      });
      changed = true;
    }
    if (!registry.providers.some(p => p.id === 'go')) {
      registry.providers.push({
        id: 'go',
        templateId: 'go',
        name: 'OpenCode Go',
        enabled: true,
        authRef: 'keyring:global:opencode',
        authType: 'none',
        subscriptionFilter: 'go',
        api: {},
        addedAt: new Date().toISOString(),
      });
      changed = true;
    }
    if (changed) {
      saveRegistry(registry);
    }
  }

  const enabledProviders = registry.providers.filter(p => p.enabled);

  for (const provider of enabledProviders) {
    const key = await resolveRefreshCredential(provider, resolveKey);
    refreshed.push(await refreshProviderModels(provider.id, key, registry));
  }

  return { refreshed };
}
