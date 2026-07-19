// src/registry/refresh-models.ts — user-initiated model list refresh per modelSource

import { BACKENDS } from '../constants.js';
import { getModels } from '../models.js';
import { fetchAnthropicModels } from './custom-endpoint.js';
import { fetchTemplateModels } from './fetch-template-models.js';
import { fetchClaudeCodeModels } from '../oauth/claude-code.js';
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
import {
  enrichGithubCopilotOAuthProviderData,
  readGlobalOpencodeCredential,
  resolveProviderOAuthProviderData,
} from '../env.js';
import type { CachedModel, ProviderRegistry, RegistryProvider } from './types.js';
import { buildOpenAiOAuthModels, CHATGPT_CODEX_UNSUPPORTED_MODELS } from '../data/openai-oauth-models.js';
import { buildXaiOAuthModels } from '../data/xai-oauth-models.js';
import { ANTIGRAVITY_BASE_URLS } from '../oauth/antigravity-oauth.js';
import { modelPrefersResponsesApi } from '../provider-factory.js';
import { deriveBrand } from '../models.js';
import { resolveContextWindow } from '../context-window.js';
import { getInstalledClaudeVersion } from '../launch.js';
import { shouldHideModel } from '../model-compatibility.js';
import { classifyFreeStatus, isFreeStatus } from '../free-models.js';
import {
  copilotPlanTier,
  normalizeCopilotModels,
  type CopilotPlanTier,
} from './copilot-models.js';

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
    isFree?: boolean;
    contextWindow?: number;
    cost?: CachedModel['cost'];
    sourceBackend?: string;
    freeStatus?: CachedModel['freeStatus'];
  },
  npm?: string,
  apiUrl?: string,
): CachedModel {
  const freeStatus = classifyFreeStatus({ model: m });
  return {
    id: m.id,
    name: m.name,
    upstreamModelId: m.id,
    family: m.brand,
    brand: m.brand,
    contextWindow: m.contextWindow,
    cost: m.cost,
    isFree: m.isFree,
    freeStatus,
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

async function refreshClaudeCodeOAuthModels(
  accessToken: string,
): Promise<{ models: CachedModel[]; source: 'live' }> {
  const entries = await fetchClaudeCodeModels(accessToken);
  const models: CachedModel[] = entries.map(entry => ({
    id: entry.id,
    name: entry.displayName,
    upstreamModelId: entry.id,
    family: 'claude',
    brand: 'Anthropic',
    contextWindow: entry.maxInputTokens ?? resolveContextWindow(entry.id),
    modelFormat: 'anthropic' as const,
    npm: '@ai-sdk/anthropic',
    apiUrl: 'https://api.anthropic.com',
  }));
  return { models, source: 'live' };
}

async function refreshAntigravityOAuthModels(
  accessToken: string,
): Promise<{ models: CachedModel[]; source: 'live' }> {
  // Try each base URL in order — first success wins.
  for (const base of ANTIGRAVITY_BASE_URLS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      const res = await fetch(`${base}/v1internal:fetchAvailableModels`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': 'vscode/1.X.X (Antigravity/4.2.0)',
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));

      if (!res.ok) continue;
      const body = await res.json() as Record<string, unknown>;

      // Response shape: { models: { [id]: { displayName, maxTokens, supportsThinking, ... } } }
      const raw: Array<Record<string, unknown> & { id: string }> = body.models && typeof body.models === 'object' && !Array.isArray(body.models)
        ? Object.entries(body.models as Record<string, Record<string, unknown>>).map(([id, model]) => ({ id, ...model }))
        : Array.isArray(body.models)
          ? (body.models as Array<Record<string, unknown>>).filter((m): m is Record<string, unknown> & { id: string } => typeof m.id === 'string' && m.id.length > 0)
          : [];
      if (raw.length === 0) continue;

      const models: CachedModel[] = raw
        .filter(m => typeof m.id === 'string' && m.id.length > 0)
        .map(m => {
          const id = m.id as string;
          const name = (m.displayName ?? m.name ?? id) as string;
          const isGemini = id.startsWith('gemini');
          const isClaude = id.startsWith('claude');
          const isOpenAi = id.startsWith('gpt') || id.startsWith('o');
          const maxTokens = typeof m.maxTokens === 'number' ? m.maxTokens : undefined;
          return {
            id,
            name,
            upstreamModelId: id,
            family: isGemini ? 'gemini' : id.split('-')[0] ?? id,
            brand: isGemini ? 'Google' : isClaude ? 'Anthropic' : isOpenAi ? 'OpenAI' : 'Other',
            contextWindow: maxTokens ?? resolveContextWindow(id),
            modelFormat: 'cloud-code' as const,
            reasoning: m.supportsThinking === true || id.includes('thinking') || id.includes('pro'),
          };
        });

      if (models.length > 0) return { models, source: 'live' };
    } catch {
      // try next base URL
    }
  }

  throw new Error('Antigravity live model refresh failed — Cloud Code returned no usable models');
}

interface OAuthModelRefresh {
  models: CachedModel[];
  baseUrl?: string;
  source: 'live' | 'seed';
  failureReason?: string;
  /** A conservative fallback is safer than an older, potentially paid-only cache. */
  replaceCacheOnFallback?: boolean;
}

function buildCopilotFreeFallback(): CachedModel[] {
  return normalizeCopilotModels([
    {
      id: 'gpt-4.1',
      supported_endpoints: ['/chat/completions'],
      billing: { multiplier: 0 },
    },
    {
      id: 'gpt-4o',
      supported_endpoints: ['/chat/completions'],
      billing: { multiplier: 0 },
    },
  ], 'free');
}

async function refreshGithubCopilotOAuthModels(
  accessToken: string,
  tier: CopilotPlanTier,
): Promise<OAuthModelRefresh> {
  const result = await fetchJsonWithAuth(
    'https://api.githubcopilot.com/models',
    accessToken,
    10_000,
    { 'Editor-Version': 'vscode/1.85.1' },
  );
  const body = result.body;
  const rows = Array.isArray(body)
    ? body
    : body && typeof body === 'object'
      ? (Array.isArray((body as Record<string, unknown>)['data'])
          ? (body as Record<string, unknown>)['data'] as unknown[]
          : Array.isArray((body as Record<string, unknown>)['models'])
            ? (body as Record<string, unknown>)['models'] as unknown[]
            : [])
      : [];
  const models = normalizeCopilotModels(rows, tier);
  if (models.length > 0) return { models, source: 'live' };

  return {
    models: buildCopilotFreeFallback(),
    source: 'seed',
    failureReason: result.error ?? 'GitHub Copilot returned no usable chat models',
    replaceCacheOnFallback: tier !== 'paid',
  };
}

/**
 * OAuth model refresh:
 * - OpenAI OAuth: Fetch from chatgpt.com/backend-api/models using the OAuth access token.
 *   Falls back to static seed on network failure or unexpected response format.
 *   Note: api.openai.com/v1/models rejects OAuth tokens — never call that endpoint here.
 * - xAI OAuth: SuperGrok JWT differs from xai-... API keys. Try the live api.x.ai/v1/models
 *   endpoint first; fall back to static seed on 401/403.
 * - claude-code OAuth: Live fetch from api.anthropic.com/v1/models using Bearer auth.
 *   No static fallback — throws on failure so the user sees a clear re-auth prompt.
 * - antigravity OAuth: Live fetch from Cloud Code fetchAvailableModels. No static fallback,
 *   because Antigravity slot IDs change and stale ids can 404 during inference.
 */
async function refreshOAuthProvider(
  provider: RegistryProvider,
  accessToken: string,
): Promise<OAuthModelRefresh> {
  const tpl = provider.templateId ?? provider.id;
  if (tpl === 'openai' || tpl === 'openai-oauth') return refreshOpenAiOAuthModels(accessToken);
  if (tpl === 'xai' || tpl === 'xai-oauth') return refreshXaiOAuthModels(accessToken);
  if (tpl === 'github-copilot') {
    let providerData = await resolveProviderOAuthProviderData(provider.authRef);
    if (copilotPlanTier(providerData) === 'unknown') {
      providerData = await enrichGithubCopilotOAuthProviderData(provider.authRef) ?? providerData;
    }
    return refreshGithubCopilotOAuthModels(accessToken, copilotPlanTier(providerData));
  }
  if (tpl === 'claude-code') return refreshClaudeCodeOAuthModels(accessToken);
  if (tpl === 'antigravity') return refreshAntigravityOAuthModels(accessToken);
  throw new Error(`refreshOAuthProvider: unsupported template "${tpl}"`);
}

/** A parsed model entry, including backend-reported transport capability flags. */
interface OpenAiModelEntry {
  id: string;
  name: string;
  context_window?: number;
  /** Backend flags: model needs the Responses-Lite shape / WebSocket transport. */
  useResponsesLite?: boolean;
  preferWebSockets?: boolean;
}

/** Read the Responses-Lite / WebSocket capability flags off a raw model entry. */
function readCapabilityFlags(m: Record<string, unknown>): Pick<OpenAiModelEntry, 'useResponsesLite' | 'preferWebSockets'> {
  const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);
  return {
    useResponsesLite: bool(m['use_responses_lite']),
    preferWebSockets: bool(m['prefer_websockets']),
  };
}

/** Parse model entries from OpenAI-standard or ChatGPT-internal response shapes. */
function parseOpenAiModelEntries(body: unknown): OpenAiModelEntry[] {
  if (!body || typeof body !== 'object') return [];
  const b = body as Record<string, unknown>;

  // ChatGPT backend format: { models: [{ slug, title }] }
  if (Array.isArray(b.models)) {
    return (b.models as Array<Record<string, unknown>>)
      .map(m => ({
        id: (m.slug as string) ?? '',
        name: (m.title as string) ?? (m.name as string) ?? (m.slug as string) ?? '',
        context_window: m.context_window as number | undefined,
        ...readCapabilityFlags(m),
      }))
      .filter(m => m.id.length > 0);
  }
  // Standard OpenAI format: { data: [{ id, name }] }
  if (Array.isArray(b.data)) {
    return (b.data as Array<Record<string, unknown>>)
      .map(m => ({
        id: (m.id as string) ?? '',
        name: (m.name as string) ?? (m.id as string) ?? '',
        context_window: m.context_window as number | undefined,
        ...readCapabilityFlags(m),
      }))
      .filter(m => m.id.length > 0);
  }
  return [];
}

/**
 * Build a CachedModel for a discovered OpenAI OAuth model. The live backend is
 * authoritative for capability flags: when the model is also seeded, live flags
 * are merged over the seed (seed acts as fallback if the backend omits a flag).
 */
function buildDynamicOAuthModel(entry: OpenAiModelEntry, seedById: Map<string, CachedModel>): CachedModel {
  const seed = seedById.get(entry.id);
  if (seed) {
    return {
      ...seed,
      useResponsesLite: entry.useResponsesLite ?? seed.useResponsesLite,
      preferWebSockets: entry.preferWebSockets ?? seed.preferWebSockets,
    };
  }
  const { id } = entry;
  const prefix = id.split('-')[0] ?? id;
  return {
    id,
    name: entry.name,
    upstreamModelId: id,
    family: prefix,
    brand: deriveBrand(prefix),
    contextWindow: entry.context_window ?? resolveContextWindow(id),
    modelFormat: 'openai' as const,
    npm: '@ai-sdk/openai',
    reasoning: modelPrefersResponsesApi(id),
    useResponsesLite: entry.useResponsesLite,
    preferWebSockets: entry.preferWebSockets,
  };
}

/** Fetch and parse JSON from a URL with auth and timeout, returning null on any failure. */
async function fetchJsonWithAuth(
  url: string,
  accessToken: string,
  timeoutMs: number,
  extraHeaders: Record<string, string> = {},
): Promise<{ body: unknown | null; error?: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ...extraHeaders,
      },
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    if (!response.ok) {
      const detail = await response.text().then(t => t.slice(0, 200)).catch(() => '');
      return { body: null, error: `HTTP ${response.status}${detail ? `: ${detail}` : ''}` };
    }
    return { body: await response.json() };
  } catch (err) {
    return { body: null, error: err instanceof Error ? err.message : String(err) };
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
): Promise<{ models: CachedModel[]; source: 'live' | 'seed'; failureReason?: string }> {
  const TIMEOUT_MS = 10_000;
  const seedById = new Map(buildOpenAiOAuthModels().map(m => [m.id, m]));
  const toModels = (entries: OpenAiModelEntry[]) =>
    entries.map(entry => buildDynamicOAuthModel(entry, seedById));

  const claudeVersion = getInstalledClaudeVersion();

  // Tier 1: Codex-specific model listing — source of truth for Codex availability.
  const codexResult = await fetchJsonWithAuth(
    `https://chatgpt.com/backend-api/codex/models?client_version=${claudeVersion}`,
    accessToken,
    TIMEOUT_MS,
  );
  const codexEntries = parseOpenAiModelEntries(codexResult.body);
  if (codexEntries.length > 0) {
    return { models: toModels(codexEntries), source: 'live' };
  }

  // Tier 2: General ChatGPT model list, filtered by known Codex restrictions.
  const chatGptResult = await fetchJsonWithAuth(
    'https://chatgpt.com/backend-api/models',
    accessToken,
    TIMEOUT_MS,
  );
  const chatGptEntries = parseOpenAiModelEntries(chatGptResult.body)
    .filter(({ id }) => !CHATGPT_CODEX_UNSUPPORTED_MODELS.has(id));
  if (chatGptEntries.length > 0) {
    return { models: toModels(chatGptEntries), source: 'live' };
  }

  // Tier 3: Static seed — reuse already-built map instead of calling the builder again.
  return {
    models: [...seedById.values()],
    source: 'seed',
    failureReason: chatGptResult.error ?? codexResult.error,
  };
}

/**
 * Try fetching xAI models from api.x.ai/v1/models using the OAuth JWT.
 * Falls back to static seed if rejected (SuperGrok JWT ≠ xai-... API key format).
 */
async function refreshXaiOAuthModels(
  accessToken: string,
): Promise<{ models: CachedModel[]; source: 'live' | 'seed'; failureReason?: string }> {
  const seed = buildXaiOAuthModels();
  const seedById = new Map(seed.map(m => [m.id, m]));

  const result = await fetchJsonWithAuth('https://api.x.ai/v1/models', accessToken, 8_000);
  if (result.body) {
    const entries = ((result.body as { data?: Array<{ id?: string; context_length?: number }> }).data ?? [])
      .filter((m): m is { id: string; context_length?: number } => !!m.id);
    if (entries.length > 0) {
      const live = entries.map(({ id, context_length }) => {
        const cached = seedById.get(id);
        if (cached) return cached;
        const prefix = id.split('-')[0] ?? id;
        return { id, name: id, upstreamModelId: id, family: prefix, brand: deriveBrand(prefix), contextWindow: resolveContextWindow(id, context_length), modelFormat: 'openai' as const, npm: '@ai-sdk/xai', reasoning: modelPrefersResponsesApi(id) } satisfies CachedModel;
      });
      return { models: live, source: 'live' };
    }
  }
  return { models: seed, source: 'seed', failureReason: result.error };
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
  const usableModels = !apiKey.trim() && template.anonymousFreeModels
    ? fetched.models.filter(model => isFreeStatus(classifyFreeStatus({
        model,
        providerId: provider.id,
        templateId: provider.templateId,
      })))
    : fetched.models;
  if (usableModels.length === 0) {
    return { models: [], error: 'No free models were returned for anonymous access.' };
  }

  return {
    models: usableModels.map(m => ({
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

function compatibleCachedModels(provider: RegistryProvider, models: CachedModel[]): CachedModel[] {
  if (provider.id !== 'antigravity') return models;
  return models.filter(model => !shouldHideModel({
    providerId: provider.id,
    modelId: model.id,
    agent: 'claude',
  }));
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
    let oauthFallbackReason: string | undefined;

    if (source === 'zen-go-api') {
      models = await refreshZenGoProvider(provider);
    } else if (provider.authType === 'oauth' && (['openai', 'xai', 'xai-oauth', 'github-copilot', 'claude-code', 'antigravity'].includes(provider.templateId ?? provider.id) || provider.id === 'openai-oauth' || provider.id === 'xai-oauth')) {
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
      const failureDetail = oauthResult.failureReason ? ` (${oauthResult.failureReason})` : '';
      if (oauthResult.source === 'seed' && cachedModelCount(provider) > 0 && !oauthResult.replaceCacheOnFallback) {
        // Live discovery failed — keep the existing cache (which may already include
        // models newer than the built-in fallback list) instead of overwriting it.
        return skipWithCachedModels(
          provider,
          `Live model discovery failed${failureDetail} — kept your existing cached model list instead of `
          + "overwriting it with relay-ai's built-in fallback list. Try refreshing again later.",
        );
      }
      if (oauthResult.source === 'seed') {
        oauthFallbackReason = `Live model discovery failed${failureDetail} — showing relay-ai's built-in fallback `
          + 'model list, which may not include the newest models yet. Try refreshing again later.';
      }
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
    const enriched = compatibleCachedModels(
      provider,
      enrichModelsWithPricing(models, buildPricingIndex(pricingCache), platform),
    );
    if (provider.id === 'antigravity' && enriched.length === 0) {
      return {
        id: provider.id,
        name: provider.name,
        ok: false,
        reason: 'No validated Antigravity agent models were returned — kept the existing model cache.',
      };
    }

    updateProviderCache(registry, providerId, enriched, baseUrl);
    saveRegistry(registry);
    enrichPricingAsync();

    return {
      id: provider.id,
      name: provider.name,
      ok: true,
      modelCount: enriched.length,
      previousModelCount: provider.refreshedAt ? previousModelCount : undefined,
      reason: oauthFallbackReason,
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
