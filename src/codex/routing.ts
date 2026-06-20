// Codex routing: tier 1 (direct OpenAI) vs tier 2 (Responses proxy).
import type { CodexProxyRoute } from '../codex-proxy.js';
import { shouldHideModel, type CompatibilityAgent } from '../model-compatibility.js';
import { BACKENDS } from '../constants.js';
import type { LocalProvider, LocalProviderModel } from '../types.js';

export interface CodexRoute {
  tier: 'direct' | 'proxy';
  npm: string;
  baseURL?: string;
  upstreamModelId: string;
  apiKey: string;
  contextWindow?: number;
  modelId: string;
  providerId: string;
  authType?: 'api' | 'oauth' | 'none';
  oauthAccountId?: string;
  supportedParameters?: string[];
  reasoning?: boolean;
  interleavedReasoningField?: string;
}

export function isRoutableModel(
  model: LocalProviderModel,
  providerId: string,
  agent: CompatibilityAgent = 'codex',
): boolean {
  if (shouldHideModel({ providerId, modelId: model.id, agent })) return false;
  if (model.modelFormat === 'anthropic') return true;
  if (model.modelFormat === 'openai') {
    if (providerId === 'zen' || providerId === 'go') return true;
    if (model.npm) return true;
  }
  return false;
}

/** Registry providers with at least one routable model (includes Anthropic). */
export function codexCompatibleProviders(
  providers: LocalProvider[],
  agent: CompatibilityAgent = 'codex',
): LocalProvider[] {
  return providers.filter(lp =>
    lp.models.some(m => isRoutableModel(m, lp.id, agent)),
  );
}

function resolveBaseURL(model: LocalProviderModel, provider: LocalProvider): string | undefined {
  if (provider.id === 'zen' || provider.id === 'go') {
    const isAnthropic = model.modelFormat === 'anthropic';
    const baseUrl = BACKENDS[provider.id].baseUrl;
    return isAnthropic ? baseUrl : `${baseUrl}/v1`;
  }
  return model.apiBaseUrl
    ?? model.completionsUrl?.replace(/\/chat\/completions$/, '')
    ?? model.baseUrl;
}

/** Tier 1 = OpenAI API keys only. OAuth needs the proxy for Codex endpoint headers. */
export function resolveCodexRoute(
  provider: LocalProvider,
  model: LocalProviderModel,
  apiKey: string,
): CodexRoute {
  const upstreamModelId = model.upstreamModelId || model.id;
  const inferredNpm = model.modelFormat === 'anthropic' ? '@ai-sdk/anthropic' : '@ai-sdk/openai-compatible';
  // For zen/go cloud backends the registry modelsCache npm is unreliable — the
  // OpenCode models cache (via modelFormat) is authoritative for endpoint format.
  const isZenGo = provider.id === 'zen' || provider.id === 'go';
  const base = {
    npm: isZenGo ? inferredNpm : (model.npm ?? inferredNpm),
    baseURL: resolveBaseURL(model, provider),
    upstreamModelId,
    apiKey,
    contextWindow: model.contextWindow,
    modelId: model.id,
    providerId: provider.id,
    authType: provider.authType,
    oauthAccountId: provider.oauthAccountId,
    supportedParameters: model.supportedParameters,
    reasoning: model.reasoning,
    interleavedReasoningField: model.interleavedReasoningField,
  };

  if (model.npm === '@ai-sdk/openai' && provider.authType !== 'oauth' && model.modelFormat === 'openai') {
    return { tier: 'direct', ...base };
  }

  return { tier: 'proxy', ...base };
}

export function routableModelsForProvider(
  provider: LocalProvider,
  agent: CompatibilityAgent = 'codex',
): LocalProviderModel[] {
  return provider.models.filter(m => isRoutableModel(m, provider.id, agent));
}

export function buildCodexProxyRoutesForProvider(
  provider: LocalProvider,
  apiKey: string,
  selectedModelId?: string,
  agent: CompatibilityAgent = 'codex',
): CodexProxyRoute[] {
  const routable = routableModelsForProvider(provider, agent);
  const ordered = selectedModelId
    ? [
      ...routable.filter(m => m.id === selectedModelId),
      ...routable.filter(m => m.id !== selectedModelId),
    ]
    : routable;
  return ordered.map(model => {
    const route = resolveCodexRoute(provider, model, apiKey);
    return {
      modelId: route.modelId,
      npm: route.npm,
      apiKey: route.apiKey,
      baseURL: route.baseURL,
      upstreamModelId: route.upstreamModelId,
      providerId: route.providerId,
      authType: route.authType,
      oauthAccountId: route.oauthAccountId,
      supportedParameters: route.supportedParameters,
      reasoning: route.reasoning,
      interleavedReasoningField: route.interleavedReasoningField,
    };
  });
}

export function codexProviderEnvKey(providerId: string): string {
  const known: Record<string, string> = {
    openai: 'OPENAI_API_KEY',
    xai: 'XAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    google: 'GEMINI_API_KEY',
  };
  return known[providerId] ?? `${providerId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`;
}
