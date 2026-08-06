import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { addProviderFromTemplate } from '../src/registry/add-template.js';
import * as env from '../src/env.js';
import * as providerFactory from '../src/provider-factory.js';
import * as fetchTemplate from '../src/registry/fetch-template-models.js';
import * as fetchClinePass from '../src/registry/fetch-cline-pass-models.js';
import * as io from '../src/registry/io.js';
import * as pricing from '../src/registry/pricing.js';
import { getTemplateById } from '../src/provider-templates.js';
import type { ProviderTemplate } from '../src/provider-templates.js';
import type { ProviderRegistry } from '../src/registry/types.js';

vi.mock('../src/env.js', () => ({ saveProviderCredential: vi.fn(), deleteProviderCredential: vi.fn() }));
vi.mock('../src/provider-factory.js', () => ({ isSdkMigratedNpm: vi.fn() }));
vi.mock('../src/registry/fetch-template-models.js', () => ({ fetchTemplateModels: vi.fn() }));
vi.mock('../src/registry/fetch-cline-pass-models.js', () => ({
  fetchClinePassModels: vi.fn(),
  validateClinePassApiKey: vi.fn(),
}));
vi.mock('../src/registry/io.js', () => ({ loadRegistry: vi.fn(), saveRegistry: vi.fn() }));
vi.mock('../src/registry/pricing.js', () => ({
  loadPricingCache: vi.fn(),
  enrichModelsWithPricing: vi.fn(),
  enrichModelsForProviderPricing: vi.fn((models) => models),
  enrichPricingAsync: vi.fn(),
  pricingPlatformForProvider: vi.fn(),
  buildPricingIndex: vi.fn(),
}));

describe('registry/add-template', () => {
  const dummyTemplate: ProviderTemplate = {
    id: 'test-template',
    name: 'Test Provider',
    supported: true,
    npm: '@ai-sdk/openai-compatible',
    docsUrl: '',
    authInstructions: '',
  };

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(providerFactory.isSdkMigratedNpm).mockReturnValue(true);
    vi.mocked(env.saveProviderCredential).mockResolvedValue(true);
    
    vi.mocked(io.loadRegistry).mockReturnValue({
      version: 1,
      providers: [],
    });
    
    vi.mocked(fetchTemplate.fetchTemplateModels).mockResolvedValue({
      models: [{ id: 'model-1', name: 'Model 1', upstreamModelId: 'model-1', family: 'fam', brand: 'brand', modelFormat: 'openai' }],
      baseUrl: 'https://api.example.com',
    });
    vi.mocked(fetchClinePass.fetchClinePassModels).mockResolvedValue([
      { id: 'cline-pass/qwen3.8-max', name: 'Qwen 3.8 Max', upstreamModelId: 'cline-pass/qwen3.8-max', family: 'qwen3.8', brand: 'Qwen', modelFormat: 'openai' },
    ]);
    vi.mocked(fetchClinePass.validateClinePassApiKey).mockResolvedValue(undefined);

    vi.mocked(pricing.enrichModelsWithPricing).mockImplementation((models) => models);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fails if template is not supported', async () => {
    const tpl = { ...dummyTemplate, supported: false, unsupportedReason: 'Coming soon' };
    const res = await addProviderFromTemplate(tpl, 'key');
    expect(res.added).toBe(false);
    expect(res.error).toBe('Coming soon');
  });

  it('fails if npm is not available', async () => {
    vi.mocked(providerFactory.isSdkMigratedNpm).mockReturnValue(false);
    const res = await addProviderFromTemplate(dummyTemplate, 'key');
    expect(res.added).toBe(false);
    expect(res.error).toContain('is not available in relay-ai');
  });

  it('fails on empty API key', async () => {
    const res = await addProviderFromTemplate(dummyTemplate, '   ');
    expect(res.added).toBe(false);
    expect(res.error).toBe('API key cannot be empty.');
  });

  it('fails if provider already exists and replaceExisting is not set', async () => {
    vi.mocked(io.loadRegistry).mockReturnValue({
      version: 1,
      providers: [{ id: 'test-template', templateId: 'test-template', name: 'Existing', enabled: true, authType: 'keyring', authRef: 'k', api: {} }],
    });

    const res = await addProviderFromTemplate(dummyTemplate, 'key');
    expect(res.added).toBe(false);
    expect(res.error).toContain('is already configured');
  });

  it('fails if fetching models returns an error', async () => {
    vi.mocked(fetchTemplate.fetchTemplateModels).mockResolvedValue({
      models: [],
      error: 'Network failure',
    });

    const res = await addProviderFromTemplate(dummyTemplate, 'key');
    expect(res.added).toBe(false);
    expect(res.error).toBe('Network failure');
  });

  it('fails if credential cannot be saved', async () => {
    vi.mocked(env.saveProviderCredential).mockResolvedValue(false);

    const res = await addProviderFromTemplate(dummyTemplate, 'key');
    expect(res.added).toBe(false);
    expect(res.error).toContain('Could not save API key');
  });

  it('successfully adds provider', async () => {
    const res = await addProviderFromTemplate(dummyTemplate, 'key_123');

    expect(res.added).toBe(true);
    expect(res.provider?.id).toBe('test-template');
    expect(res.provider?.name).toBe('Test Provider');
    expect(res.provider?.modelsCache?.models).toHaveLength(1);
    expect(res.modelCount).toBe(1);

    expect(env.saveProviderCredential).toHaveBeenCalledWith('keyring:provider:test-template', 'key_123');
    expect(io.saveRegistry).toHaveBeenCalled();
  });

  it('validates and adds ClinePass using its public catalog and isolated API-key ref', async () => {
    const res = await addProviderFromTemplate(getTemplateById('cline-pass')!, 'cline-api-key');

    expect(res.added).toBe(true);
    expect(fetchClinePass.validateClinePassApiKey).toHaveBeenCalledWith('cline-api-key');
    expect(fetchClinePass.fetchClinePassModels).toHaveBeenCalled();
    expect(env.saveProviderCredential).toHaveBeenCalledWith('keyring:provider:cline-pass', 'cline-api-key');
    expect(res.provider?.api.url).toBe('https://api.cline.bot/api/v1');
    expect(res.provider?.api.headers).toEqual({ 'HTTP-Referer': 'https://cline.bot', 'X-Title': 'Cline' });
  });

  it('deletes the superseded OAuth secret after replacing ClinePass with an API key', async () => {
    vi.mocked(io.loadRegistry).mockReturnValue({
      version: 1,
      providers: [{
        id: 'cline-pass',
        templateId: 'cline-pass',
        name: 'ClinePass',
        enabled: true,
        authType: 'oauth',
        authRef: 'keyring:oauth:provider:cline-pass',
        api: { npm: '@ai-sdk/openai-compatible', url: 'https://api.cline.bot/api/v1' },
        modelsCache: { fetchedAt: '2026-08-06T00:00:00.000Z', models: [{ id: 'old', name: 'Old', upstreamModelId: 'old', modelFormat: 'openai' }] },
        addedAt: '2026-08-06T00:00:00.000Z',
      }],
    });

    const res = await addProviderFromTemplate(getTemplateById('cline-pass')!, 'cline-api-key', { replaceExisting: true });

    expect(res.added).toBe(true);
    expect(env.deleteProviderCredential).toHaveBeenCalledWith('keyring:oauth:provider:cline-pass');
    expect(res.provider?.authType).toBe('api');
  });

  it('adds the three separate DashScope variants with independent credential refs', async () => {
    const registry: ProviderRegistry = { schemaVersion: 1, providers: [] };
    vi.mocked(io.loadRegistry).mockReturnValue(registry);

    for (const id of ['alibaba', 'qwen-cloud-token-plan', 'qwen-cloud-payg']) {
      const result = await addProviderFromTemplate(getTemplateById(id)!, 'test-key');
      expect(result.added).toBe(true);
    }

    expect(registry.providers.map(provider => provider.id)).toEqual([
      'alibaba',
      'qwen-cloud-token-plan',
      'qwen-cloud-payg',
    ]);
    expect(env.saveProviderCredential).toHaveBeenCalledWith('keyring:provider:alibaba', 'test-key');
    expect(env.saveProviderCredential).toHaveBeenCalledWith('keyring:provider:qwen-cloud-token-plan', 'test-key');
    expect(env.saveProviderCredential).toHaveBeenCalledWith('keyring:provider:qwen-cloud-payg', 'test-key');
  });

  it('does not apply cached PAYG pricing when adding Qwen Cloud Token Plan', async () => {
    await addProviderFromTemplate(getTemplateById('qwen-cloud-token-plan')!, 'test-key');

    expect(pricing.enrichModelsWithPricing).not.toHaveBeenCalled();
    expect(pricing.enrichModelsForProviderPricing).toHaveBeenCalledWith(
      expect.any(Array),
      undefined,
      'qwen-cloud-token-plan',
      'qwen-cloud-token-plan',
    );
  });

  it('replaces existing provider if replaceExisting is true', async () => {
    vi.mocked(io.loadRegistry).mockReturnValue({
      version: 1,
      providers: [{ id: 'test-template', templateId: 'test-template', name: 'Existing', enabled: true, authType: 'keyring', authRef: 'k', api: {} }],
    });

    const res = await addProviderFromTemplate(dummyTemplate, 'key_123', { replaceExisting: true });

    expect(res.added).toBe(true);
    
    const savedRegistry = vi.mocked(io.saveRegistry).mock.calls[0]?.[0] as ProviderRegistry;
    expect(savedRegistry.providers).toHaveLength(1); // Replaced, not duplicated
    expect(savedRegistry.providers[0]?.name).toBe('Test Provider');
  });
});
