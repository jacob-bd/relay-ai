import type { CachedModel, ManualModel, RegistryProvider } from './types.js';
import { isVertexAnthropicProvider, vertexAnthropicCachedModels } from './vertex-anthropic.js';
import { isLocalEndpointUrl, isOllamaCloudModelId } from '../free-models.js';
import { providerKind } from './provider-kind.js';
import { shouldHideModel } from '../model-compatibility.js';

const MANUAL_MODEL_PACKAGES = new Set([
  '@ai-sdk/openai-compatible', '@ai-sdk/openai', '@ai-sdk/anthropic', '@openrouter/ai-sdk-provider',
]);

export function supportsManualModels(provider: RegistryProvider): boolean {
  return provider.authType !== 'oauth'
    && !['zen', 'go', 'antigravity'].includes(provider.templateId)
    && MANUAL_MODEL_PACKAGES.has(provider.api.npm ?? '');
}

/** Smallest and largest context size Relay accepts from a user or a server. */
export const MIN_CONTEXT_WINDOW_OVERRIDE = 1_000;
export const MAX_CONTEXT_WINDOW_OVERRIDE = 100_000_000;

export function isValidContextWindow(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
    && value >= MIN_CONTEXT_WINDOW_OVERRIDE && value <= MAX_CONTEXT_WINDOW_OVERRIDE;
}

/** A typed or measured size replaces the catalog's size everywhere the model is read. */
function applyContextWindowOverrides(provider: RegistryProvider, models: CachedModel[]): CachedModel[] {
  const overrides = provider.contextWindowOverrides;
  if (!overrides) return models;
  return models.map(model => {
    const override = overrides[model.id];
    if (!override) return model;
    return {
      ...model,
      contextWindow: override.contextWindow,
      contextWindowSource: override.source === 'user' ? 'user' : 'provider',
    };
  });
}

/** The user's own free declaration; set here so every reader of provider models sees it. */
function applyFreeMarks(provider: RegistryProvider, models: CachedModel[]): CachedModel[] {
  const ids = new Set(provider.freeModelIds ?? []);
  return models.map(model => {
    const local = isLocalEndpointUrl(model.apiUrl ?? provider.api.url)
      && !(providerKind(provider.id) === 'ollama' && isOllamaCloudModelId(model.id));
    if (!local && !ids.has(model.id)) return model;
    return { ...model, ...(ids.has(model.id) ? { userMarkedFree: true } : {}), ...(local ? { localEndpoint: true } : {}) };
  });
}

/** Refresh owns modelsCache; the user's entries win collisions without duplicating IDs. */
export function getProviderModels(provider: RegistryProvider): CachedModel[] {
  if (isVertexAnthropicProvider(provider)) return applyFreeMarks(provider, applyContextWindowOverrides(provider, vertexAnthropicCachedModels()));
  const models = new Map((provider.modelsCache?.models ?? []).map(model => [model.id, model]));
  if (supportsManualModels(provider)) {
    for (const model of provider.manualModels ?? []) {
      models.set(model.id, { ...model, modelFormat: provider.api.npm === '@ai-sdk/anthropic' ? 'anthropic' : 'openai' });
    }
  }
  return applyFreeMarks(provider, applyContextWindowOverrides(provider, [...models.values()]));
}

/** Keep the raw discovery cache; agent browsing/counts exclude non-chat and blocked models. */
export function getAgentProviderModels(provider: RegistryProvider): CachedModel[] {
  return getProviderModels(provider).filter(model => !shouldHideModel({
    providerId: provider.id, modelId: model.id, agent: 'claude',
  }));
}

export function modelIdError(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return 'Model ID is required.';
  if (value.trim().length > 512 || /[\s\u0000-\u001f\u007f]/u.test(value.trim())) {
    return 'Model ID must be at most 512 characters with no whitespace or control characters.';
  }
}

export function contextWindowError(value: unknown): string | undefined {
  if (value !== undefined && (!Number.isSafeInteger(value) || Number(value) <= 0)) {
    return 'Context size must be a positive whole number of tokens, or left blank.';
  }
}

/** Explicitly pick stored fields: a manual entry cannot smuggle routing or credentials. */
export function parseManualModel(raw: unknown): ManualModel | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const m = raw as Record<string, unknown>;
  if (modelIdError(m.id) || typeof m.name !== 'string' || !m.name.trim()
    || m.name.length > 200 || m.source !== 'manual'
    || typeof m.validatedAt !== 'string' || !Number.isFinite(Date.parse(m.validatedAt))
    || contextWindowError(m.contextWindow)
    || (m.modelFormat !== 'openai' && m.modelFormat !== 'anthropic')) return undefined;
  return {
    id: (m.id as string).trim(), name: m.name.trim(), upstreamModelId: (m.id as string).trim(),
    modelFormat: m.modelFormat, source: 'manual', validatedAt: m.validatedAt,
    ...(m.contextWindow === undefined ? {} : { contextWindow: m.contextWindow as number, contextWindowSource: 'user' }),
  };
}
