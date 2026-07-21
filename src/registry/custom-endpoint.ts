// src/registry/custom-endpoint.ts — add custom OpenAI/Anthropic-compatible providers

import { saveProviderCredential } from '../env.js';
import { deriveBrand } from '../models.js';
import { resolveContextWindow } from '../context-window.js';
import { fetchTemplateModels } from './fetch-template-models.js';
import { loadRegistry, saveRegistry } from './io.js';
import type { CachedModel, RegistryProvider } from './types.js';
import { customProviderId, isValidProviderId, slugifyProviderId } from './validate.js';
import { validateCustomEndpointUrl } from './url-security.js';
import { makeTraceLogger, getProviderDebugLogPath } from '../trace-log.js';

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

export async function fetchAnthropicModels(
  baseUrl: string,
  apiKey: string,
  extraHeaders?: Record<string, string>,
): Promise<{ models: CachedModel[]; baseUrl: string; error?: string; hint?: string }> {
  const root = baseUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '');
  const modelsUrl = `${root}/v1/models`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(modelsUrl, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        Accept: 'application/json',
        ...extraHeaders,
      },
      redirect: 'manual',
      signal: controller.signal,
    });

    let logTrace: ((msg: string) => void) | undefined;
    if (process.env.RELAY_AI_TRACE === '1') {
      logTrace = makeTraceLogger(getProviderDebugLogPath());
    }

    const rawBodyText = await response.text().catch(() => '');
    if (logTrace) {
      logTrace(`[fetchAnthropicModels] HTTP ${response.status} from ${modelsUrl}`);
      logTrace(`[fetchAnthropicModels] Body: ${rawBodyText}`);
    }

    if (response.ok) {
      let json: { data?: Array<{ id?: string; name?: string }> } = {};
      try {
        if (rawBodyText.trim()) {
          json = JSON.parse(rawBodyText) as { data?: Array<{ id?: string; name?: string }> };
        }
      } catch {
        // Failed to parse
      }

      const models: CachedModel[] = [];
      for (const row of json.data ?? []) {
        const id = row.id?.trim();
        if (!id) continue;
        models.push({
          id,
          name: row.name?.trim() || id,
          upstreamModelId: id,
          family: id.split('-')[0] ?? id,
          brand: deriveBrand(id),
          contextWindow: resolveContextWindow(id),
          modelFormat: 'anthropic',
          npm: '@ai-sdk/anthropic',
          apiUrl: root,
        });
      }
      if (models.length > 0) return { models, baseUrl: root };
    }

    if (response.status === 401 || response.status === 403) {
      return { models: [], baseUrl: root, error: 'API key was rejected.', hint: 'Check your Anthropic-compatible API key.' };
    }

    return {
      models: [],
      baseUrl: root,
      error: `Could not list models (HTTP ${response.status}).`,
      hint: 'Verify the base URL supports Anthropic-compatible /v1/models or try the OpenAI-compatible option instead.',
    };
  } catch {
    return {
      models: [],
      baseUrl: root,
      error: 'Could not reach the Anthropic-compatible server.',
      hint: 'Check the base URL and that the server is running.',
    };
  } finally {
    clearTimeout(timer);
  }
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

  let fetched: { models: CachedModel[]; baseUrl: string; error?: string; hint?: string };
  if (input.kind === 'anthropic') {
    fetched = await fetchAnthropicModels(urlCheck.normalizedUrl, apiKey, headers);
  } else {
    fetched = await fetchTemplateModels(
      {
        id: providerId,
        name: input.displayName,
        authType: apiKey === 'local' ? 'none' : 'api',
        npm,
        defaultBaseUrl: urlCheck.normalizedUrl,
        modelSource: 'api-list',
        supported: true,
      },
      apiKey,
      urlCheck.normalizedUrl,
      headers,
    );
  }

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
