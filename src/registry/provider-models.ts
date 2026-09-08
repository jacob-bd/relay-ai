import type { CachedModel, ManualModel, RegistryProvider } from './types.js';

const MANUAL_MODEL_PACKAGES = new Set([
  '@ai-sdk/openai-compatible', '@ai-sdk/openai', '@ai-sdk/anthropic', '@openrouter/ai-sdk-provider',
]);

export function supportsManualModels(provider: RegistryProvider): boolean {
  return provider.authType !== 'oauth'
    && !['zen', 'go', 'antigravity'].includes(provider.templateId)
    && MANUAL_MODEL_PACKAGES.has(provider.api.npm ?? '');
}

/** Refresh owns modelsCache; the user's entries win collisions without duplicating IDs. */
export function getProviderModels(provider: RegistryProvider): CachedModel[] {
  const models = new Map((provider.modelsCache?.models ?? []).map(model => [model.id, model]));
  if (supportsManualModels(provider)) {
    for (const model of provider.manualModels ?? []) {
      models.set(model.id, { ...model, modelFormat: provider.api.npm === '@ai-sdk/anthropic' ? 'anthropic' : 'openai' });
    }
  }
  return [...models.values()];
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
