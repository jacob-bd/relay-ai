// src/registry/validate-import-key.ts — verify OpenCode credentials before import

import { fetchAnthropicModels } from './fetch-anthropic-models.js';
import { fetchTemplateModels } from './fetch-template-models.js';
import { isLikelyPlaceholderKey } from './refresh-credentials.js';
import { resolveModelSource } from './model-source.js';
import { effectiveProviderBaseUrl, resolveProviderTemplate, syntheticTemplate } from './resolve-template.js';
import { validateCustomEndpointUrl } from './url-security.js';
import type { RegistryProvider } from './types.js';
import type { LocalProvider } from '../types.js';

export type ImportKeySkipReason = 'placeholder-key' | 'invalid-key' | 'untested-manual';

export interface ValidateImportKeyResult {
  /** When false, the provider must not be added to the registry. */
  canImport: boolean;
  reason?: ImportKeySkipReason;
  detail?: string;
}

function reject(
  reason: ImportKeySkipReason,
  detail: string,
): ValidateImportKeyResult {
  return { canImport: false, reason, detail };
}

export async function validateImportKey(
  lp: LocalProvider,
  entry: RegistryProvider,
): Promise<ValidateImportKeyResult> {
  if (entry.authType === 'oauth') {
    return { canImport: true };
  }

  const key = lp.apiKey?.trim() ?? '';
  if (!key) {
    return reject('invalid-key', 'No API key in OpenCode config.');
  }

  const source = resolveModelSource(entry);
  if (source === 'manual-only') {
    return reject(
      'untested-manual',
      'Provider uses gcloud/AWS/Azure auth — configure via OpenCode env auth, not API key import.',
    );
  }

  if (source === 'zen-go-api') {
    return { canImport: true };
  }

  const placeholder = isLikelyPlaceholderKey(key);
  const npm = entry.api.npm ?? lp.models[0]?.npm ?? '@ai-sdk/openai-compatible';
  const catalogTemplate = resolveProviderTemplate(entry);
  const baseUrl = effectiveProviderBaseUrl(entry, catalogTemplate);

  if (!baseUrl) {
    if (placeholder) {
      return reject(
        'placeholder-key',
        'OpenCode has a placeholder key and no API URL — provider not imported.',
      );
    }
    return reject('invalid-key', 'No API base URL — cannot verify key.');
  }

  let safeBaseUrl = baseUrl;
  const configuredUrl = entry.api.url?.trim();
  const templateDefault = catalogTemplate?.defaultBaseUrl?.trim();
  if (configuredUrl && configuredUrl !== templateDefault) {
    const urlCheck = await validateCustomEndpointUrl(baseUrl, {
      allowInsecureLocal: catalogTemplate?.apiKeyOptional === true,
    });
    if (!urlCheck.ok || !urlCheck.normalizedUrl) {
      return reject('invalid-key', `${urlCheck.error ?? 'Invalid API base URL.'} ${urlCheck.hint ?? ''}`.trim());
    }
    safeBaseUrl = urlCheck.normalizedUrl;
  }

  if (npm === '@ai-sdk/anthropic') {
    const result = await fetchAnthropicModels(safeBaseUrl, key);
    if (result.error) {
      return reject(
        placeholder ? 'placeholder-key' : 'invalid-key',
        placeholder
          ? 'OpenCode has a placeholder key — API rejected it; provider not imported.'
          : result.error,
      );
    }
    return { canImport: true };
  }

  const template = catalogTemplate ?? syntheticTemplate(entry, safeBaseUrl);
  const result = await fetchTemplateModels(template, key, safeBaseUrl);
  if (result.error) {
    return reject(
      placeholder ? 'placeholder-key' : 'invalid-key',
      placeholder
        ? 'OpenCode has a placeholder key — API rejected it; provider not imported.'
        : result.error,
    );
  }

  return { canImport: true };
}
