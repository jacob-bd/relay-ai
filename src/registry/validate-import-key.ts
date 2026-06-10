// src/registry/validate-import-key.ts — verify OpenCode keys before Keychain save

import { fetchAnthropicModels } from './custom-endpoint.js';
import { fetchTemplateModels } from './fetch-template-models.js';
import { isLikelyPlaceholderKey } from './refresh-credentials.js';
import { resolveModelSource } from './model-source.js';
import { effectiveProviderBaseUrl, resolveProviderTemplate, syntheticTemplate } from './resolve-template.js';
import type { RegistryProvider } from './types.js';
import type { LocalProvider } from '../types.js';

export type ImportKeySkipReason = 'placeholder-key' | 'invalid-key' | 'untested-manual';

export interface ValidateImportKeyResult {
  shouldSaveKey: boolean;
  reason?: ImportKeySkipReason;
  detail?: string;
}

export async function validateImportKey(
  lp: LocalProvider,
  entry: RegistryProvider,
): Promise<ValidateImportKeyResult> {
  const key = lp.apiKey?.trim() ?? '';
  if (!key) {
    return { shouldSaveKey: false, reason: 'invalid-key', detail: 'No API key in OpenCode config.' };
  }

  const source = resolveModelSource(entry);
  if (source === 'manual-only') {
    return {
      shouldSaveKey: false,
      reason: 'untested-manual',
      detail: 'Provider uses gcloud/AWS/Azure auth — API key not stored by relay-ai.',
    };
  }

  if (isLikelyPlaceholderKey(key)) {
    return {
      shouldSaveKey: false,
      reason: 'placeholder-key',
      detail: 'OpenCode has a placeholder key (e.g. "anything") — not saved to Keychain.',
    };
  }

  if (source === 'zen-go-api') {
    return { shouldSaveKey: true };
  }

  const npm = entry.api.npm ?? lp.models[0]?.npm ?? '@ai-sdk/openai-compatible';
  const catalogTemplate = resolveProviderTemplate(entry);
  const baseUrl = effectiveProviderBaseUrl(entry, catalogTemplate);
  if (!baseUrl) {
    return {
      shouldSaveKey: false,
      reason: 'invalid-key',
      detail: 'No API base URL — cannot verify key.',
    };
  }

  if (npm === '@ai-sdk/anthropic') {
    const result = await fetchAnthropicModels(baseUrl, key);
    if (result.error) {
      return {
        shouldSaveKey: false,
        reason: 'invalid-key',
        detail: result.error,
      };
    }
    return { shouldSaveKey: true };
  }

  const template = catalogTemplate ?? syntheticTemplate(entry, baseUrl);
  const result = await fetchTemplateModels(template, key, baseUrl);
  if (result.error) {
    return {
      shouldSaveKey: false,
      reason: 'invalid-key',
      detail: result.error,
    };
  }
  return { shouldSaveKey: true };
}
