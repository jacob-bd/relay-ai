import { resolveProviderCredential } from '../env.js';
import { loadRegistry, saveRegistry } from './io.js';
import { contextWindowError, getProviderModels, modelIdError, supportsManualModels } from './provider-models.js';
import { validateManualModel } from './validate-manual-model.js';
import { validateCustomEndpointUrl } from './url-security.js';
import type { ManualModel, RegistryProvider } from './types.js';

export interface AddManualModelInput {
  providerId: string;
  modelId: string;
  displayName?: string;
  contextWindow?: number;
}
export interface ManualModelResult { ok: boolean; error?: string; model?: ManualModel }

function fingerprint(provider: RegistryProvider): string {
  return JSON.stringify([provider.enabled, provider.authRef, provider.authType, provider.api]);
}

export async function addManualModel(input: AddManualModelInput): Promise<ManualModelResult> {
  if (!input || typeof input !== 'object' || typeof input.providerId !== 'string') return { ok: false, error: 'Provider ID is required.' };
  const invalid = modelIdError(input.modelId) ?? contextWindowError(input.contextWindow);
  if (invalid) return { ok: false, error: invalid };
  if (input.displayName !== undefined && (typeof input.displayName !== 'string' || input.displayName.length > 200 || /[\u0000-\u001f\u007f]/u.test(input.displayName))) {
    return { ok: false, error: 'Display name must be at most 200 characters without control characters.' };
  }
  const id = input.modelId.trim();
  const registry = loadRegistry();
  const provider = registry.providers.find(p => p.id === input.providerId);
  if (!provider || !provider.enabled) return { ok: false, error: 'Provider not found or disabled.' };
  if (!supportsManualModels(provider)) return { ok: false, error: 'Manual models are supported for API-key OpenAI-compatible, Anthropic, OpenAI and OpenRouter providers.' };
  if (getProviderModels(provider).some(m => m.id === id)) return { ok: false, error: 'This model ID is already in the provider catalog.' };
  let key = '';
  try {
    if (provider.api.url) {
      const checked = await validateCustomEndpointUrl(provider.api.url, { allowInsecureLocal: true });
      if (!checked.ok) return { ok: false, error: checked.error ?? 'Invalid provider URL.' };
    }
    key = (await resolveProviderCredential(provider.id, provider.authRef)) ?? '';
    if (!key && provider.authType !== 'none') return { ok: false, error: 'No stored API key. Configure this provider before adding a model.' };
    const before = fingerprint(provider);
    await validateManualModel(provider, id, key);
    if (((await resolveProviderCredential(provider.id, provider.authRef)) ?? '') !== key) {
      return { ok: false, error: 'Provider credential changed during validation. Test again.' };
    }
    // Network tests can take time: never write a stale registry over another operation.
    const latest = loadRegistry();
    const current = latest.providers.find(p => p.id === provider.id);
    if (!current || fingerprint(current) !== before) return { ok: false, error: 'Provider settings changed during validation. Test again.' };
    if (getProviderModels(current).some(m => m.id === id)) return { ok: false, error: 'This model was added while validation was running.' };
    const model: ManualModel = {
      id, name: input.displayName?.trim() || id, upstreamModelId: id,
      modelFormat: provider.api.npm === '@ai-sdk/anthropic' ? 'anthropic' : 'openai',
      source: 'manual', validatedAt: new Date().toISOString(),
      ...(input.contextWindow === undefined ? {} : { contextWindow: input.contextWindow, contextWindowSource: 'user' }),
    };
    current.manualModels = [...(current.manualModels ?? []), model];
    saveRegistry(latest);
    return { ok: true, model };
  } catch (error) {
    let message = error instanceof Error ? error.message : String(error);
    for (const secret of [key, ...Object.values(provider.api.headers ?? {})].filter(Boolean)) message = message.split(secret).join('[REDACTED]');
    return { ok: false, error: message.slice(0, 1500) };
  }
}

export function removeManualModel(providerId: string, modelId: string): ManualModelResult {
  const registry = loadRegistry();
  const provider = registry.providers.find(p => p.id === providerId);
  if (!provider?.manualModels?.some(m => m.id === modelId)) return { ok: false, error: 'Manual model not found.' };
  provider.manualModels = provider.manualModels.filter(m => m.id !== modelId);
  saveRegistry(registry);
  return { ok: true };
}
