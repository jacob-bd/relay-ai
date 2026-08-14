// src/registry/custom-endpoint.ts — add custom OpenAI/Anthropic-compatible providers

import { saveProviderCredential } from '../env.js';
import { fetchTemplateModels } from './fetch-template-models.js';
import { fetchAnthropicModels } from './fetch-anthropic-models.js';
import { loadRegistry, saveRegistry } from './io.js';
import type { CachedModel, RegistryProvider } from './types.js';
import { customProviderId, isValidProviderId, slugifyProviderId } from './validate.js';
import { validateCustomEndpointUrl } from './url-security.js';

export type CustomEndpointKind = 'openai' | 'anthropic';

export interface AddCustomEndpointInput {
  displayName: string;
  baseUrl: string;
  apiKey: string;
  kind: CustomEndpointKind;
  allowInsecureLocal?: boolean;
  /** Static headers this endpoint requires on every request (e.g. a plan/auth-tracking header). */
  headers?: Record<string, string>;
}

export interface AddCustomEndpointResult {
  added: boolean;
  provider?: RegistryProvider;
  modelCount?: number;
  error?: string;
  hint?: string;
}

function npmForKind(kind: CustomEndpointKind): string {
  return kind === 'anthropic' ? '@ai-sdk/anthropic' : '@ai-sdk/openai-compatible';
}

function modelFormatForKind(kind: CustomEndpointKind): 'anthropic' | 'openai' {
  return kind === 'anthropic' ? 'anthropic' : 'openai';
}

function uniqueProviderId(displayName: string, registry: { providers: RegistryProvider[] }): string {
  let base = customProviderId(displayName);
  if (!base.startsWith('custom-')) base = `custom-${slugifyProviderId(displayName)}`;
  if (!isValidProviderId(base)) base = 'custom-provider';

  if (!registry.providers.some(p => p.id === base)) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}-${i}`;
    if (isValidProviderId(candidate) && !registry.providers.some(p => p.id === candidate)) {
      return candidate;
    }
  }
  return `${base}-${Date.now()}`;
}

export interface FetchCustomEndpointModelsInput {
  providerId: string;
  displayName: string;
  kind: CustomEndpointKind;
  /** Already run through validateCustomEndpointUrl. */
  normalizedBaseUrl: string;
  apiKey: string;
  headers?: Record<string, string>;
}

export async function fetchCustomEndpointModels(
  input: FetchCustomEndpointModelsInput,
): Promise<{ models: CachedModel[]; baseUrl: string; error?: string; hint?: string }> {
  if (input.kind === 'anthropic') {
    return fetchAnthropicModels(input.normalizedBaseUrl, input.apiKey, input.headers);
  }
  return fetchTemplateModels(
    {
      id: input.providerId,
      name: input.displayName,
      authType: input.apiKey === 'local' ? 'none' : 'api',
      npm: npmForKind(input.kind),
      defaultBaseUrl: input.normalizedBaseUrl,
      modelSource: 'api-list',
      supported: true,
    },
    input.apiKey,
    input.normalizedBaseUrl,
    input.headers,
  );
}

export async function addCustomEndpointProvider(input: AddCustomEndpointInput): Promise<AddCustomEndpointResult> {
  const urlCheck = await validateCustomEndpointUrl(input.baseUrl, {
    allowInsecureLocal: input.allowInsecureLocal,
  });
  if (!urlCheck.ok || !urlCheck.normalizedUrl) {
    return { added: false, error: urlCheck.error, hint: urlCheck.hint };
  }

  const registry = loadRegistry();
  const providerId = uniqueProviderId(input.displayName.trim(), registry);
  const npm = npmForKind(input.kind);
  const apiKey = input.apiKey.trim() || 'local';

  const headers = input.headers && Object.keys(input.headers).length > 0 ? input.headers : undefined;

  const fetched = await fetchCustomEndpointModels({
    providerId,
    displayName: input.displayName,
    kind: input.kind,
    normalizedBaseUrl: urlCheck.normalizedUrl,
    apiKey,
    headers,
  });

  if (fetched.error || fetched.models.length === 0) {
    return { added: false, error: fetched.error ?? 'No models returned.', hint: fetched.hint };
  }

  if (apiKey !== 'local') {
    const saved = await saveProviderCredential(`keyring:provider:${providerId}`, apiKey);
    if (!saved) {
      return { added: false, error: 'Could not save API key to credential store.', hint: 'Grant Keychain access, or ensure RELAY_AI_HOME is writable (file fallback).' };
    }
  }

  const now = new Date().toISOString();
  const entry: RegistryProvider = {
    id: providerId,
    templateId: input.kind === 'anthropic' ? 'custom-anthropic' : 'custom-openai',
    name: input.displayName.trim(),
    enabled: true,
    authRef: apiKey === 'local' ? `keyring:provider:${providerId}` : `keyring:provider:${providerId}`,
    api: { npm, url: fetched.baseUrl, ...(headers ? { headers } : {}) },
    addedAt: now,
    refreshedAt: now,
    modelsCache: {
      fetchedAt: now,
      models: fetched.models.map(m => ({
        ...m,
        modelFormat: modelFormatForKind(input.kind),
        npm,
        apiUrl: fetched.baseUrl,
      })),
    },
  };

  if (apiKey === 'local') {
    await saveProviderCredential(entry.authRef, 'local');
  }

  registry.providers.push(entry);
  saveRegistry(registry);

  return { added: true, provider: entry, modelCount: fetched.models.length };
}
