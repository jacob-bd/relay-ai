// src/registry/custom-endpoint.ts — add custom OpenAI/Anthropic-compatible providers

import { readStoredProviderCredential, saveProviderCredential } from '../env.js';
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
  /** Skip the exact-duplicate guard after the user confirmed. */
  confirmDuplicate?: boolean;
}

export interface AddCustomEndpointResult {
  added: boolean;
  provider?: RegistryProvider;
  modelCount?: number;
  error?: string;
  hint?: string;
  /** Set when an existing provider has the same url + key + headers. */
  duplicateOf?: string;
}

function npmForKind(kind: CustomEndpointKind): string {
  return kind === 'anthropic' ? '@ai-sdk/anthropic' : '@ai-sdk/openai-compatible';
}

function modelFormatForKind(kind: CustomEndpointKind): 'anthropic' | 'openai' {
  return kind === 'anthropic' ? 'anthropic' : 'openai';
}

export function customEndpointKind(provider: RegistryProvider): CustomEndpointKind | null {
  if (provider.templateId === 'custom-anthropic') return 'anthropic';
  if (provider.templateId === 'custom-openai') return 'openai';
  return null;
}

function sameHeaders(a?: Record<string, string>, b?: Record<string, string>): boolean {
  const norm = (h?: Record<string, string>) =>
    JSON.stringify(Object.entries(h ?? {}).sort(([x], [y]) => x.localeCompare(y)));
  return norm(a) === norm(b);
}

/**
 * Anthropic entries are stored with /v1 stripped (fetchAnthropicModels does it),
 * OpenAI entries keep theirs. Compare on a common form or an anthropic duplicate
 * never matches: stored "https://gw.example.com" vs typed "https://gw.example.com/v1".
 */
function compareableUrl(url: string): string {
  return url.replace(/\/v1\/?$/, '').replace(/\/$/, '');
}

async function findDuplicateCustomProvider(
  registry: { providers: RegistryProvider[] },
  normalizedUrl: string,
  apiKey: string,
  headers?: Record<string, string>,
): Promise<string | null> {
  const target = compareableUrl(normalizedUrl);
  for (const existing of registry.providers) {
    if (!customEndpointKind(existing)) continue;
    if (compareableUrl(existing.api.url ?? '') !== target) continue;
    if (!sameHeaders(existing.api.headers, headers)) continue;
    const storedKey = await readStoredProviderCredential(existing.authRef);
    if ((storedKey ?? '') === apiKey) return existing.id;
  }
  return null;
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
  const apiKey = input.apiKey.trim() || 'local';
  const headers = input.headers && Object.keys(input.headers).length > 0 ? input.headers : undefined;

  if (!input.confirmDuplicate) {
    const duplicateOf = await findDuplicateCustomProvider(
      registry,
      urlCheck.normalizedUrl,
      apiKey,
      headers,
    );
    if (duplicateOf) {
      return {
        added: false,
        duplicateOf,
        error: `A backend with the same URL, key and headers already exists (${duplicateOf}).`,
        hint: 'Add it anyway to keep both, or cancel.',
      };
    }
  }

  const providerId = uniqueProviderId(input.displayName.trim(), registry);
  const npm = npmForKind(input.kind);

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

export interface UpdateCustomEndpointInput {
  providerId: string;
  displayName?: string;
  baseUrl?: string;
  /** Blank or omitted keeps the stored key. */
  apiKey?: string;
  /** Present replaces the whole set; an empty object removes all headers. */
  headers?: Record<string, string>;
  allowInsecureLocal?: boolean;
  /** Write the config even when the connection test fails. */
  saveAnyway?: boolean;
}

export interface UpdateCustomEndpointResult {
  updated: boolean;
  provider?: RegistryProvider;
  modelCount?: number;
  /** True when saved via saveAnyway — the model list was not refreshed. */
  modelsStale?: boolean;
  /**
   * Only set when the failure was a connection test, i.e. the settings are
   * storable but unverified. Refusals (unknown id, non-custom provider, blocked
   * URL, missing key, credential store failure) never set it, so a caller must
   * never offer "save anyway" for something that can never be saved.
   */
  canSaveAnyway?: boolean;
  error?: string;
  hint?: string;
}

export async function updateCustomEndpointProvider(
  input: UpdateCustomEndpointInput,
): Promise<UpdateCustomEndpointResult> {
  const registry = loadRegistry();
  const provider = registry.providers.find(pr => pr.id === input.providerId);
  if (!provider) {
    return { updated: false, error: `Provider not found: ${input.providerId}` };
  }

  const kind = customEndpointKind(provider);
  if (!kind) {
    return {
      updated: false,
      error: 'Edit is only available for custom backends.',
      hint: 'Template providers can only change their API key.',
    };
  }

  const nextName = input.displayName?.trim();

  let nextBaseUrl = provider.api.url ?? '';
  let urlChanged = false;
  const requestedUrl = input.baseUrl?.trim();
  if (requestedUrl) {
    const urlCheck = await validateCustomEndpointUrl(requestedUrl, {
      allowInsecureLocal: input.allowInsecureLocal,
    });
    if (!urlCheck.ok || !urlCheck.normalizedUrl) {
      return { updated: false, error: urlCheck.error, hint: urlCheck.hint };
    }
    urlChanged = urlCheck.normalizedUrl !== nextBaseUrl;
    nextBaseUrl = urlCheck.normalizedUrl;
  }

  const newKey = input.apiKey?.trim();
  const headersChanged =
    input.headers !== undefined && !sameHeaders(input.headers, provider.api.headers);
  const nextHeaders = input.headers !== undefined
    ? (Object.keys(input.headers).length > 0 ? input.headers : undefined)
    : provider.api.headers;

  const nameChanged = Boolean(nextName) && nextName !== provider.name;
  const needsTest = urlChanged || Boolean(newKey) || headersChanged;

  if (!needsTest) {
    if (!nameChanged) return { updated: false, error: 'Nothing to change.' };
    provider.name = nextName as string;
    saveRegistry(registry);
    return {
      updated: true,
      provider,
      modelCount: provider.modelsCache?.models.length ?? 0,
    };
  }

  const apiKey = newKey || (await readStoredProviderCredential(provider.authRef)) || '';
  if (!apiKey) {
    return {
      updated: false,
      error: 'No stored API key was found for this backend.',
      hint: 'Enter an API key to continue.',
    };
  }

  const fetched = await fetchCustomEndpointModels({
    providerId: provider.id,
    displayName: nextName || provider.name,
    kind,
    normalizedBaseUrl: nextBaseUrl,
    apiKey,
    headers: nextHeaders,
  });

  const testFailed = Boolean(fetched.error) || fetched.models.length === 0;
  if (testFailed && !input.saveAnyway) {
    // The only failure a caller may offer to override — the settings are
    // storable, just unverified. Every earlier return is a hard refusal.
    return {
      updated: false,
      error: fetched.error ?? 'No models returned.',
      hint: fetched.hint,
      canSaveAnyway: true,
    };
  }

  // Credential first: a failed keychain write must never leave the registry
  // pointing at a key that was not stored.
  if (newKey) {
    const saved = await saveProviderCredential(provider.authRef, newKey);
    if (!saved) {
      return {
        updated: false,
        error: 'Could not save API key to credential store.',
        hint: 'Grant Keychain access, or ensure RELAY_AI_HOME is writable (file fallback).',
      };
    }
  }

  const now = new Date().toISOString();
  if (nameChanged) provider.name = nextName as string;

  // An Anthropic base URL must NOT keep a trailing /v1 — the Anthropic SDK
  // appends /v1/messages itself, so storing .../v1 yields .../v1/v1/messages
  // and a 404. fetchAnthropicModels already strips it on the success path;
  // the saveAnyway path never called it, so strip here too.
  const storedBaseUrl = kind === 'anthropic'
    ? nextBaseUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '')
    : nextBaseUrl;

  provider.api.url = testFailed ? storedBaseUrl : (fetched.baseUrl || storedBaseUrl);
  if (nextHeaders) provider.api.headers = nextHeaders;
  else delete provider.api.headers;

  if (!testFailed) {
    provider.modelsCache = {
      fetchedAt: now,
      models: fetched.models.map(m => ({
        ...m,
        modelFormat: modelFormatForKind(kind),
        npm: npmForKind(kind),
        apiUrl: fetched.baseUrl || storedBaseUrl,
      })),
    };
    provider.refreshedAt = now;
  } else if (provider.modelsCache) {
    // Each cached model carries its own apiUrl, and materialize.ts:51 reads
    // `cached.apiUrl ?? provider.api.url` — the per-model value WINS. Leaving
    // the stale one here would keep sending live traffic to the OLD endpoint
    // even though the provider now shows the new URL.
    provider.modelsCache = {
      ...provider.modelsCache,
      models: provider.modelsCache.models.map(m => ({ ...m, apiUrl: storedBaseUrl })),
    };
  }

  saveRegistry(registry);

  return {
    updated: true,
    provider,
    modelCount: provider.modelsCache?.models.length ?? 0,
    ...(testFailed ? { modelsStale: true } : {}),
  };
}
