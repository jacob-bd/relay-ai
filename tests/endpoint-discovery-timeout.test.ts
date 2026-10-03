import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchCustomEndpointModels } from '../src/registry/custom-endpoint.js';
import { fetchTemplateModels } from '../src/registry/fetch-template-models.js';
import { fetchAnthropicModels } from '../src/registry/fetch-anthropic-models.js';
import { refreshAllProviderModels, refreshProviderModels } from '../src/registry/refresh-models.js';
import { validateImportKey } from '../src/registry/validate-import-key.js';
import { getTemplateById } from '../src/provider-templates.js';
import type { ProviderRegistry, RegistryProvider } from '../src/registry/types.js';
import * as io from '../src/registry/io.js';

vi.mock('../src/registry/io.js', () => ({ loadRegistry: vi.fn(), saveRegistry: vi.fn() }));
vi.mock('../src/registry/pricing.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/registry/pricing.js')>(),
  loadPricingCache: vi.fn(() => ({ models: [] })),
  enrichPricingAsync: vi.fn(),
}));
vi.mock('../src/env.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/env.js')>(),
  readGlobalOpencodeCredential: vi.fn(async () => null),
}));
vi.mock('../src/registry/url-security.js', () => ({
  validateCustomEndpointUrl: vi.fn(async (url: string) => ({ ok: true, normalizedUrl: url })),
}));

const provider = (templateId = 'custom-openai', id = 'custom-slow'): RegistryProvider => ({
  id, templateId, name: id, enabled: true, authRef: `keyring:provider:${id}`,
  api: {
    npm: templateId === 'custom-anthropic' ? '@ai-sdk/anthropic' : '@ai-sdk/openai-compatible',
    url: `http://127.0.0.1:8000/${id}/v1`,
    headers: { 'X-Plan': 'coding' },
  },
  addedAt: '2026-10-03T00:00:00Z',
});
const catalog = () => new Response(JSON.stringify({ data: [{ id: 'slow-model' }] }));

function delayedCatalog(delay: number): void {
  vi.mocked(fetch).mockImplementation(async (_url, init) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(catalog()), delay);
    init?.signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('transport stopped'));
    }, { once: true });
  }));
}

describe('endpoint discovery timeouts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv('RELAY_AI_CUSTOM_ENDPOINT_MODEL_TIMEOUT_MS', undefined);
    vi.stubGlobal('fetch', vi.fn());
    vi.mocked(io.loadRegistry).mockReturnValue({ schemaVersion: 1, providers: [] });
    vi.mocked(io.saveRegistry).mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each(['openai', 'anthropic'] as const)('refreshes a %s custom gateway that takes 12 seconds', async kind => {
    delayedCatalog(12_000);
    const entry = provider(`custom-${kind}`);
    const registry: ProviderRegistry = { schemaVersion: 1, providers: [entry] };
    vi.mocked(io.loadRegistry).mockReturnValue(registry);
    const pending = refreshProviderModels(entry.id, 'sk-real-key', registry);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(await pending).toMatchObject({ ok: true, modelCount: 1 });
    expect(registry.providers[0]?.modelsCache?.models[0]?.id).toBe('slow-model');
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.headers).toMatchObject({ 'X-Plan': 'coding' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['', '   ', 'invalid', 'Infinity'])('keeps the 30-second default for override %j', async value => {
    vi.stubEnv('RELAY_AI_CUSTOM_ENDPOINT_MODEL_TIMEOUT_MS', value);
    delayedCatalog(12_000);
    const pending = fetchCustomEndpointModels({
      providerId: 'custom-slow', displayName: 'Slow', kind: 'openai',
      normalizedBaseUrl: 'https://gateway.example/v1', apiKey: 'sk-real-key',
    });
    await vi.advanceTimersByTimeAsync(12_000);
    expect((await pending).models[0]?.id).toBe('slow-model');
  });

  it.each(['ollama', 'lmstudio'])('allows 12-second discovery for local template %s', async templateId => {
    delayedCatalog(12_000);
    const pending = fetchTemplateModels(getTemplateById(templateId)!, '');
    await vi.advanceTimersByTimeAsync(12_000);
    expect((await pending).models[0]?.id).toBe('slow-model');
  });

  it('keeps remote cloud templates at 10 seconds despite the custom override', async () => {
    vi.stubEnv('RELAY_AI_CUSTOM_ENDPOINT_MODEL_TIMEOUT_MS', '60000');
    delayedCatalog(12_000);
    const pending = fetchTemplateModels(getTemplateById('groq')!, 'sk-real-key');
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await pending).error).toBe('Connection timed out after 10 seconds.');
  });

  it.each(['custom-openai', 'custom-anthropic', 'ollama'])('uses the same timeout on import for %s', async templateId => {
    delayedCatalog(12_000);
    const entry = provider(templateId);
    // Keep HTTPS so this test checks timeout policy without changing import security.
    entry.api.url = 'https://127.0.0.1:8000/v1';
    const pending = validateImportKey({ id: entry.id, name: entry.name, apiKey: 'sk-real-key', models: [] }, entry);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(await pending).toEqual({ canImport: true });
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.headers).toMatchObject({ 'X-Plan': 'coding' });
  });

  it.each(['import', 'refresh'])('allows a slow imported custom gateway with an arbitrary ID on %s', async operation => {
    delayedCatalog(12_000);
    const entry = provider('browser-gateway', 'browser-gateway');
    entry.api.url = 'https://browser-gateway.example/v1';
    const registry: ProviderRegistry = { schemaVersion: 1, providers: [entry] };
    vi.mocked(io.loadRegistry).mockReturnValue(registry);
    const pending = operation === 'import'
      ? validateImportKey({ id: entry.id, name: entry.name, apiKey: 'sk-real-key', models: [] }, entry)
      : refreshProviderModels(entry.id, 'sk-real-key', registry);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(await pending).toMatchObject(operation === 'import' ? { canImport: true } : { ok: true });
  });

  it.each(['45000', '1', '999999'])('honors and clamps custom override %s during refresh', async value => {
    vi.stubEnv('RELAY_AI_CUSTOM_ENDPOINT_MODEL_TIMEOUT_MS', value);
    delayedCatalog(200_000);
    const entry = provider();
    const ms = Math.min(120_000, Math.max(1_000, Number(value)));
    let result: Awaited<ReturnType<typeof refreshProviderModels>> | undefined;
    const pending = refreshProviderModels(entry.id, 'sk-real-key', { schemaVersion: 1, providers: [entry] })
      .then(value => { result = value; });
    await vi.advanceTimersByTimeAsync(ms - 1);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(result?.reason).toBe(`Connection timed out after ${ms / 1000} seconds.`);
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['openai', 'anthropic'] as const)('reports a timeout while reading a %s response body', async kind => {
    vi.mocked(fetch).mockImplementation(async (_url, init) => ({
      ok: true, status: 200,
      text: () => new Promise<string>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('transport stopped')), { once: true });
      }),
    } as Response));
    const pending = fetchCustomEndpointModels({
      providerId: 'custom-slow', displayName: 'Slow', kind,
      normalizedBaseUrl: 'https://gateway.example/v1', apiKey: 'sk-real-key',
    });
    await vi.advanceTimersByTimeAsync(30_000);
    expect((await pending).error).toBe('Connection timed out after 30 seconds.');
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['openai', 'anthropic'] as const)('does not label a %s connection reset as a timeout', async kind => {
    vi.mocked(fetch).mockRejectedValue(new Error('connection aborted by peer'));
    const result = kind === 'anthropic'
      ? await fetchAnthropicModels('https://gateway.example', 'sk-real-key')
      : await fetchTemplateModels(getTemplateById('groq')!, 'sk-real-key');
    expect(result.error).toMatch(/Could not reach/);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['openai', 'anthropic'] as const)('preserves %s HTTP errors when the error body resets', async kind => {
    for (const status of [401, 403, 500]) {
      vi.mocked(fetch).mockResolvedValue({
        ok: false, status,
        text: async () => { throw new Error('connection reset by peer'); },
      } as Response);
      const result = kind === 'anthropic'
        ? await fetchAnthropicModels('https://gateway.example', 'sk-real-key')
        : await fetchTemplateModels(getTemplateById('groq')!, 'sk-real-key');
      expect(result.error).toBe(status === 500
        ? (kind === 'anthropic' ? 'Could not list models (HTTP 500).' : 'Provider returned HTTP 500.')
        : 'API key was rejected.');
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it.each(['openai', 'anthropic'] as const)('keeps cached %s models when a rejected key response body stalls', async kind => {
    const entry = provider(`custom-${kind}`);
    entry.modelsCache = { fetchedAt: 'old', models: [{ id: 'old-model', name: 'Old', upstreamModelId: 'old-model', modelFormat: kind }] };
    const registry: ProviderRegistry = { schemaVersion: 1, providers: [entry] };
    vi.mocked(io.loadRegistry).mockReturnValue(registry);
    vi.mocked(fetch).mockImplementation(async (_url, init) => ({
      ok: false, status: 401,
      text: () => new Promise<string>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('transport stopped')), { once: true });
      }),
    } as Response));
    const pending = refreshProviderModels(entry.id, 'sk-real-key', registry);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await pending).toMatchObject({ ok: true, skipped: true, modelCount: 1 });
    expect(registry.providers[0]?.modelsCache?.models[0]?.id).toBe('old-model');
    expect(io.saveRegistry).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds bulk requests to three, resolves credentials serially, and preserves all caches', async () => {
    const entries = Array.from({ length: 7 }, (_, i) => provider('custom-openai', `custom-${i}`));
    entries[1]!.modelsCache = { fetchedAt: 'old', models: [{ id: 'old-model', name: 'Old', upstreamModelId: 'old-model', modelFormat: 'openai' }] };
    const registry: ProviderRegistry = { schemaVersion: 1, providers: entries };
    vi.mocked(io.loadRegistry).mockReturnValue(registry);
    let active = 0;
    let peak = 0;
    let keysActive = 0;
    let keyPeak = 0;
    vi.mocked(fetch).mockImplementation(async url => {
      active += 1;
      peak = Math.max(peak, active);
      return new Promise(resolve => setTimeout(() => {
        active -= 1;
        resolve(String(url).includes('/custom-1/') ? new Response('offline', { status: 500 }) : catalog());
      }, 12_000));
    });
    const pending = refreshAllProviderModels(async () => {
      keysActive += 1;
      keyPeak = Math.max(keyPeak, keysActive);
      await Promise.resolve();
      keysActive -= 1;
      return 'sk-real-key';
    });
    await vi.advanceTimersByTimeAsync(36_000);
    expect(peak).toBe(3);
    expect(keyPeak).toBe(1);
    const result = await pending;
    expect(result.refreshed.map(r => r.id)).toEqual(entries.map(p => p.id));
    expect(result.refreshed.filter(r => r.ok)).toHaveLength(6);
    expect(registry.providers.map(p => p.modelsCache?.models[0]?.id)).toEqual([
      'slow-model', 'old-model', 'slow-model', 'slow-model', 'slow-model', 'slow-model', 'slow-model',
    ]);
    expect(io.saveRegistry).toHaveBeenCalledTimes(6);
    expect(vi.getTimerCount()).toBe(0);
  });
});
