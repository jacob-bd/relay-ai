// src/registry/materialize.ts — registry entries → LocalProvider runtime shape

import { shouldHideModel, type CompatibilityAgent } from '../model-compatibility.js';
import { CLINE_PASS_LEGACY_DEFAULT_CONTEXT_WINDOW } from '../cline-pass.js';
import { deriveBrand } from '../models.js';
import { BACKENDS, classifyModelFormat } from '../constants.js';
import { resolveEndpoint } from '../providers.js';
import { resolveContextWindow } from '../context-window.js';
import type { LocalProvider, LocalProviderModel } from '../types.js';
import { normalizeGoogleDisplayName, normalizeGoogleModelId } from './google-model-id.js';
import { findModelsDevModel, loadModelsDevCache, resolveModelReasoningMetadata } from './models-dev.js';
import type { ModelsDevCacheFile } from './models-dev.js';
import type { CachedModel, ProviderRegistry, RegistryProvider } from './types.js';
import { isValidProviderId } from './validate.js';
import { getTemplateById } from '../provider-templates.js';
import { classifyFreeStatus, isFreeStatus } from '../free-models.js';
import { getProviderModels } from './provider-models.js';
import { reconcileCachedModelProtocol } from './model-protocol.js';

export type CredentialResolver = (provider: RegistryProvider) => string | null;

export interface MaterializeOptions {
  agent?: CompatibilityAgent;
}

export function cachedModelToLocal(
  cached: CachedModel,
  provider: RegistryProvider,
  metadata: ModelsDevCacheFile = loadModelsDevCache(),
): LocalProviderModel | null {
  const reconciled = reconcileCachedModelProtocol(cached, provider, metadata);
  cached = reconciled;
  const freeStatus = classifyFreeStatus({
    model: cached,
    providerId: provider.id,
    templateId: provider.templateId,
  });

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
      isFree: isFreeStatus(freeStatus),
      freeStatus,
      reasoning: cached.reasoning,
      interleavedReasoningField: cached.interleavedReasoningField,
    };
  }

  const modelsDev = findModelsDevModel(provider.id, cached.id, metadata);
  const isZenGo = provider.id === 'zen' || provider.id === 'go'
    || provider.templateId === 'zen' || provider.templateId === 'go';
  // A registry cache can outlive the metadata snapshot that originally
  // classified it. Prefer the current models.dev provider package for the
  // built-in OpenCode backends, while retaining manual/custom overrides.
  const metadataNpm = !cached.source && isZenGo ? modelsDev?.provider?.npm : undefined;
  const npm = cached.npm ?? provider.api.npm ?? '';
  const apiUrl = cached.apiUrl ?? provider.api.url
    ?? (isZenGo ? BACKENDS[provider.id === 'go' || provider.templateId === 'go' ? 'go' : 'zen'].baseUrl : '');
  const endpoint = resolveEndpoint(npm, apiUrl);
  if (endpoint === null) return null;

  const { id, upstreamModelId } = normalizeGoogleModelId(cached.id, npm);
  const normalizedUpstream = normalizeGoogleModelId(cached.upstreamModelId ?? cached.id, npm).upstreamModelId;
  const family = npm === '@ai-sdk/google' ? (id.split(/[-/:]/)[0] ?? id) : (cached.family ?? '');
  const classifiedFormat = classifyModelFormat(cached.id, npm);
  const resolvedFormat = classifiedFormat === 'anthropic' ? classifiedFormat : 'openai';

  return {
    id,
    name: npm === '@ai-sdk/google' ? normalizeGoogleDisplayName(cached.name, id) : cached.name,
    family,
    brand: npm === '@ai-sdk/google' ? deriveBrand(family) : (cached.brand ?? deriveBrand(cached.family ?? '')),
    modelFormat: metadataNpm ? resolvedFormat : cached.modelFormat ?? endpoint.format,
    upstreamModelId: normalizedUpstream,
    baseUrl: endpoint.baseUrl,
    completionsUrl: endpoint.completionsUrl,
    npm: npm || undefined,
    apiBaseUrl: apiUrl || undefined,
    cost: cached.cost,
    isFree: isFreeStatus(freeStatus),
    freeStatus,
    // ClinePass's public catalog does not currently report per-model context
    // limits. Preserve that unknown state for the picker instead of displaying
    // a heuristic as if it were provider metadata. Launch-time callers still
    // resolve their required safety fallback when they build the child env or
    // proxy catalog.
    contextWindow: cached.source === 'manual' ? cached.contextWindow : provider.id === 'cline-pass' &&
      cached.contextWindow === CLINE_PASS_LEGACY_DEFAULT_CONTEXT_WINDOW &&
      cached.contextWindowSource !== 'provider'
      ? undefined
      : cached.contextWindow ?? (provider.id === 'cline-pass' ? undefined : resolveContextWindow(id)),
    supportedParameters: cached.supportedParameters,
    ...resolveModelReasoningMetadata(
      provider.id,
      cached.id,
      {
        // ChatGPT-login models that aren't in the seed list were saved with a name-based
        // reasoning guess; models.dev (OpenAI's own entry) is the better source.
        reasoning: provider.id === 'openai-oauth'
          ? findModelsDevModel(provider.id, cached.id, metadata)?.reasoning ?? cached.reasoning
          : cached.reasoning,
        interleavedField: cached.interleavedReasoningField,
      },
      metadata,
    ),
    useResponsesLite: cached.useResponsesLite,
    preferWebSockets: cached.preferWebSockets,
  };
}

function providerAllowsAnonymousFreeModels(provider: RegistryProvider): boolean {
  const template = getTemplateById(provider.templateId) ?? getTemplateById(provider.id);
  return template?.anonymousFreeModels === true;
}

function materializeOne(
  provider: RegistryProvider,
  resolveCredential: CredentialResolver,
  agent: CompatibilityAgent,
): LocalProvider | null {
  if (!provider.enabled) return null;
  if (!isValidProviderId(provider.id)) return null;

  const freeOnly = provider.subscriptionFilter === 'free';
  const apiKey = resolveCredential(provider) ?? '';
  const anonymousFreeOnly = !apiKey.trim() && providerAllowsAnonymousFreeModels(provider);
  const models: LocalProviderModel[] = [];
  for (const cached of getProviderModels(provider)) {
    const freeStatus = classifyFreeStatus({
      model: cached,
      providerId: provider.id,
      templateId: provider.templateId,
    });
    if ((freeOnly || anonymousFreeOnly) && !isFreeStatus(freeStatus)) continue;
    const model = cachedModelToLocal(cached, provider);
    if (!model) continue;
    if (shouldHideModel({ providerId: provider.id, modelId: model.id, agent })) continue;
    models.push(model);
  }
  if (models.length === 0) return null;

  if (!apiKey.trim() && !anonymousFreeOnly) return null;

  return {
    id: provider.id,
    name: provider.name,
    apiKey,
    authRef: provider.authRef,
    authType: provider.authType,
    headers: provider.api.headers,
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
