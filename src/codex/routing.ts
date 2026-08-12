// Codex routing: tier 1 (direct OpenAI) vs tier 2 (Responses proxy).
import { randomBytes } from 'node:crypto';
import type { CodexProxyRoute } from '../codex-proxy.js';
import { BACKENDS } from '../constants.js';
import {
  isTargetCompatibleModel,
  providersForTarget,
  routableModelsForTarget,
  type RelayLaunchTarget,
} from '../target-compatibility.js';
import type { LocalProvider, LocalProviderModel } from '../types.js';
import { providerRefreshToken } from '../provider-runtime.js';

export type CodexDispatch =
  | { kind: 'relay'; route: CodexProxyRoute }
  | { kind: 'native'; modelId: string }
  | { kind: 'unknown'; modelId: string };

/** Mixed mode deliberately does not use the legacy fuzzy route resolver. */
export function classifyCodexDispatch(
  modelId: string,
  relayRoutes: readonly CodexProxyRoute[],
  nativeModelIds: ReadonlySet<string>,
): CodexDispatch {
  if (nativeModelIds.has(modelId)) return { kind: 'native', modelId };
  const route = relayRoutes.find(candidate => candidate.modelId === modelId);
  if (route) return { kind: 'relay', route };
  return { kind: 'unknown', modelId };
}

export function createMixedProxyCapability(): string {
  return randomBytes(32).toString('base64url');
}

export function mixedProxyBaseUrl(port: number, capability: string): string {
  return `http://127.0.0.1:${port}/_relay-codex/${capability}`;
}

export function parseMixedProxyPath(
  pathname: string,
  capability: string,
): { capability: string; suffix: '/v1/models' | '/v1/responses' | '/health' } | null {
  const prefix = `/_relay-codex/${capability}`;
  if (!pathname.startsWith(prefix)) return null;
  const suffix = pathname.slice(prefix.length);
  if (suffix !== '/v1/models' && suffix !== '/v1/responses' && suffix !== '/health') return null;
  return { capability, suffix };
}

export interface CodexRoute {
  tier: 'direct' | 'proxy' | 'cloud-code';
  npm: string;
  baseURL?: string;
  upstreamModelId: string;
  apiKey: string;
  contextWindow?: number;
  modelId: string;
  providerId: string;
  authType?: 'api' | 'oauth' | 'none';
  oauthAccountId?: string;
  providerData?: Record<string, unknown>;
  supportedParameters?: string[];
  reasoning?: boolean;
  interleavedReasoningField?: string;
  /** Static headers sent on every upstream request (e.g. a plan/auth-tracking header a custom endpoint requires). */
  headers?: Record<string, string>;
  refreshToken?: () => Promise<string | null>;
}

export function isRoutableModel(
  model: LocalProviderModel,
  providerId: string,
  agent: RelayLaunchTarget = 'codex',
  authType?: LocalProvider['authType'],
): boolean {
  return isTargetCompatibleModel({ target: agent, providerId, authType, model }).compatible;
}

/** Registry providers with at least one routable model (includes Anthropic). */
export function codexCompatibleProviders(
  providers: LocalProvider[],
  agent: RelayLaunchTarget = 'codex',
): LocalProvider[] {
  return providersForTarget(providers, agent);
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
    providerData: provider.providerData,
    supportedParameters: model.supportedParameters,
    reasoning: model.reasoning,
    interleavedReasoningField: model.interleavedReasoningField,
    headers: provider.headers,
    refreshToken: providerRefreshToken(provider.id, provider.authType, provider.authRef),
  };

  if (model.modelFormat === 'cloud-code') {
    return {
      tier: 'cloud-code',
      npm: '@ai-sdk/anthropic',
      baseURL: '',
      upstreamModelId: model.upstreamModelId || model.id,
      apiKey,
      contextWindow: model.contextWindow,
      modelId: model.id,
      providerId: provider.id,
      authType: provider.authType,
      oauthAccountId: provider.oauthAccountId,
      providerData: provider.providerData,
      supportedParameters: model.supportedParameters,
      reasoning: model.reasoning,
      interleavedReasoningField: model.interleavedReasoningField,
      headers: provider.headers,
      refreshToken: providerRefreshToken(provider.id, provider.authType, provider.authRef),
    };
  }

  if (model.npm === '@ai-sdk/openai' && provider.authType !== 'oauth' && model.modelFormat === 'openai') {
    return { tier: 'direct', ...base };
  }

  return { tier: 'proxy', ...base };
}

export function routableModelsForProvider(
  provider: LocalProvider,
  agent: RelayLaunchTarget = 'codex',
): LocalProviderModel[] {
  return routableModelsForTarget(provider, agent);
}

export function buildCodexProxyRoutesForProvider(
  provider: LocalProvider,
  apiKey: string,
  selectedModelId?: string,
  agent: RelayLaunchTarget = 'codex',
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
      providerData: route.providerData,
      supportedParameters: route.supportedParameters,
      reasoning: route.reasoning,
      interleavedReasoningField: route.interleavedReasoningField,
      contextWindow: route.contextWindow,
      headers: route.headers,
      refreshToken: route.refreshToken,
    };
  });
}

export function codexProviderEnvKey(providerId: string): string {
  const known: Record<string, string> = {
    openai: 'OPENAI_API_KEY',
    xai: 'XAI_API_KEY',
    'xai-oauth': 'XAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    google: 'GEMINI_API_KEY',
  };
  return known[providerId] ?? `${providerId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`;
}
