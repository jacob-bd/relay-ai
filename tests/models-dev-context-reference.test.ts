import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyModelsDevContextWindows, modelsDevCrossVendorContextWindow, type ModelsDevCacheFile } from '../src/registry/models-dev.js';
import { refreshProviderModels } from '../src/registry/refresh-models.js';
import type { ProviderRegistry, RegistryProvider } from '../src/registry/types.js';
import * as io from '../src/registry/io.js';

vi.mock('../src/registry/io.js', () => ({ loadRegistry: vi.fn(), saveRegistry: vi.fn() }));
vi.mock('../src/registry/pricing.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/registry/pricing.js')>(),
  loadPricingCache: vi.fn(() => ({ models: [] })),
  enrichPricingAsync: vi.fn(),
}));
vi.mock('../src/registry/url-security.js', () => ({
  validateCustomEndpointUrl: vi.fn(async (url: string) => ({ ok: true, normalizedUrl: url })),
}));

const cache = {
  alibaba: { id: 'alibaba', models: { 'qwen3-14b': { id: 'qwen3-14b', limit: { context: 131_072 } } } },
  reseller: { id: 'reseller', models: { 'qwen3-14b': { id: 'qwen3-14b', limit: { context: 131_072 } }, 'split-model': { id: 'split-model', limit: { context: 64_000 } } } },
  other: { id: 'other', models: { 'split-model': { id: 'split-model', limit: { context: 128_000 } }, 'claude-haiku-4-5': { id: 'claude-haiku-4-5', limit: { context: 200_000 } } } },
} as unknown as ModelsDevCacheFile;

describe('models.dev reference for custom endpoints', () => {
  it('finds a model by id across vendors, ignoring case and dotted versions', () => {
    expect(modelsDevCrossVendorContextWindow('Qwen3-14B', cache)).toBe(131_072);
    expect(modelsDevCrossVendorContextWindow('claude-haiku-4.5', cache)).toBe(200_000);
    expect(modelsDevCrossVendorContextWindow('unknown-model', cache)).toBeUndefined();
  });

  it('picks the smaller size when vendors split evenly', () => {
    expect(modelsDevCrossVendorContextWindow('split-model', cache)).toBe(64_000);
  });

  it('replaces only name guesses, and marks them as models.dev', () => {
    const out = applyModelsDevContextWindows([
      { id: 'Qwen3-14B', contextWindow: 262_144 },
      { id: 'claude-haiku-4.5', contextWindow: 300_000, contextWindowSource: 'provider' },
      { id: 'unknown-model', contextWindow: 200_000 },
    ], cache);
    expect(out).toEqual([
      { id: 'Qwen3-14B', contextWindow: 131_072, contextWindowSource: 'models.dev' },
      { id: 'claude-haiku-4.5', contextWindow: 300_000, contextWindowSource: 'provider' },
      { id: 'unknown-model', contextWindow: 200_000 },
    ]);
  });
});

describe('only custom endpoints get the models.dev reference on refresh', () => {
  afterEach(() => vi.unstubAllGlobals());

  const entry = (templateId: string, id: string): RegistryProvider => ({
    id, templateId, name: id, enabled: true, authRef: `keyring:provider:${id}`,
    api: { npm: '@ai-sdk/openai-compatible', url: `https://${id}.example.com/v1` },
    addedAt: '2026-11-03T00:00:00Z',
  });

  async function refreshed(provider: RegistryProvider) {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'gpt-oss-120b' }] }))));
    const registry: ProviderRegistry = { schemaVersion: 1, providers: [provider] };
    vi.mocked(io.loadRegistry).mockReturnValue(registry);
    const result = await refreshProviderModels(provider.id, 'sk-real-key', registry);
    if (!result.ok) throw new Error(JSON.stringify(result));
    return registry.providers[0]!.modelsCache!.models[0]!;
  }

  it('custom endpoint: uses the models.dev figure', async () => {
    const model = await refreshed(entry('custom-openai', 'custom-gw'));
    expect(model.contextWindowSource).toBe('models.dev');
    expect(model.contextWindow).toBe(modelsDevCrossVendorContextWindow('gpt-oss-120b'));
  });

  it('built-in provider: unchanged (no models.dev lookup)', async () => {
    const model = await refreshed(entry('nvidia', 'nvidia'));
    expect(model.contextWindowSource).toBeUndefined();
  });
});
