import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { refreshProviderModels } from '../src/registry/refresh-models.js';
import * as io from '../src/registry/io.js';
import type { ProviderRegistry } from '../src/registry/types.js';

vi.mock('../src/registry/io.js', () => ({
  loadRegistry: vi.fn(),
  saveRegistry: vi.fn(),
}));

vi.mock('../src/registry/pricing.js', () => ({
  loadPricingCache: vi.fn(),
  enrichModelsWithPricing: vi.fn((models) => models),
  enrichPricingAsync: vi.fn(),
  pricingPlatformForProvider: vi.fn(),
  buildPricingIndex: vi.fn(),
}));

describe('registry/refresh-models', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('refreshProviderModels (OpenAI OAuth 3-tier fetch)', () => {
    it('Tier 1: uses Codex endpoint if available', async () => {
      const mockRegistry: ProviderRegistry = {
        version: 1,
        providers: [{
          id: 'openai-oauth',
          templateId: 'openai',
          name: 'OpenAI (ChatGPT)',
          enabled: true,
          authRef: 'keyring',
          authType: 'oauth',
          api: {},
        }],
      };
      vi.mocked(io.loadRegistry).mockReturnValue(mockRegistry);

      // Codex endpoint returns valid models
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [{ slug: 'gpt-4', title: 'GPT-4' }]
        }),
      } as Response);

      const result = await refreshProviderModels('openai-oauth', 'mock_token', mockRegistry);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('https://chatgpt.com/backend-api/codex/models?client_version='), expect.anything());
      
      expect(result.ok).toBe(true);
      expect(result.modelCount).toBe(1);
      
      const savedRegistry = vi.mocked(io.saveRegistry).mock.calls[0]?.[0] as ProviderRegistry;
      const models = savedRegistry.providers[0]?.modelsCache?.models;
      expect(models?.[0]?.id).toBe('gpt-4');
    });

    it('Tier 2: falls back to general endpoint and filters unsupported if Codex fails', async () => {
      const mockRegistry: ProviderRegistry = {
        version: 1,
        providers: [{
          id: 'openai-oauth',
          templateId: 'openai', // legacy template id, same logic
          name: 'OpenAI',
          enabled: true,
          authRef: 'keyring',
          authType: 'oauth',
          api: {},
        }],
      };
      vi.mocked(io.loadRegistry).mockReturnValue(mockRegistry);

      // 1. Codex endpoint 404s
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 404,
      } as Response);

      // 2. General endpoint returns models, including unsupported ones
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [
            { slug: 'gpt-4', title: 'GPT-4' },
            { slug: 'gpt-5.5-fast', title: 'GPT-5.5-fast' } // unsupported
          ]
        }),
      } as Response);

      const result = await refreshProviderModels('openai-oauth', 'mock_token', mockRegistry);

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(global.fetch).toHaveBeenNthCalledWith(2, 'https://chatgpt.com/backend-api/models', expect.anything());
      const savedRegistry = vi.mocked(io.saveRegistry).mock.calls[0]?.[0] as ProviderRegistry;
      const models = savedRegistry.providers[0]?.modelsCache?.models;
      console.log('MODELS RETURNED:', models);
      
      expect(result.ok).toBe(true);
      expect(result.modelCount).toBe(1); // the gizmo model is filtered out
      expect(models?.length).toBe(1);
      expect(models?.[0]?.id).toBe('gpt-4');
    });

    it('Tier 3: falls back to static seed if both endpoints fail', async () => {
      const mockRegistry: ProviderRegistry = {
        version: 1,
        providers: [{
          id: 'openai-oauth',
          templateId: 'openai',
          name: 'OpenAI',
          enabled: true,
          authRef: 'keyring',
          authType: 'oauth',
          api: {},
        }],
      };
      vi.mocked(io.loadRegistry).mockReturnValue(mockRegistry);

      // Both endpoints fail
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 500,
      } as Response);

      const result = await refreshProviderModels('openai-oauth', 'mock_token', mockRegistry);

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(result.ok).toBe(true);
      expect(result.modelCount).toBeGreaterThan(0); // static seed models
    });

    it('returns error if OAuth token is missing', async () => {
      const mockRegistry: ProviderRegistry = {
        version: 1,
        providers: [{
          id: 'openai-oauth',
          templateId: 'openai-oauth',
          name: 'OpenAI',
          enabled: true,
          authRef: 'keyring',
          authType: 'oauth',
          api: {},
        }],
      };

      const result = await refreshProviderModels('openai-oauth', null, mockRegistry);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('OAuth token not available');
    });
  });

  describe('refreshProviderModels (xAI OAuth)', () => {
    it('uses live xAI models if available', async () => {
      const mockRegistry: ProviderRegistry = {
        version: 1,
        providers: [{
          id: 'xai-oauth',
          templateId: 'xai',
          name: 'xAI',
          enabled: true,
          authRef: 'keyring',
          authType: 'oauth',
          api: {},
        }],
      };
      
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: 'grok-4-live' }]
        }),
      } as Response);

      const result = await refreshProviderModels('xai-oauth', 'mock_token', mockRegistry);
      expect(result.ok).toBe(true);
      expect(result.modelCount).toBe(1);

      const savedRegistry = vi.mocked(io.saveRegistry).mock.calls[0]?.[0] as ProviderRegistry;
      expect(savedRegistry.providers[0]?.modelsCache?.models[0]?.id).toBe('grok-4-live');
    });

    it('falls back to static seed if xAI endpoint rejects OAuth token', async () => {
      const mockRegistry: ProviderRegistry = {
        version: 1,
        providers: [{
          id: 'xai-oauth',
          templateId: 'xai',
          name: 'xAI',
          enabled: true,
          authRef: 'keyring',
          authType: 'oauth',
          api: {},
        }],
      };
      
      // 401 unauthorized (e.g. SuperGrok JWT rejected)
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 401,
      } as Response);

      const result = await refreshProviderModels('xai-oauth', 'mock_token', mockRegistry);
      expect(result.ok).toBe(true);
      expect(result.modelCount).toBeGreaterThan(0); // grok-3/grok-4 from seed
    });
  });

  describe('refreshProviderModels (Antigravity OAuth)', () => {
    it('uses the live Cloud Code model catalog object and does not invent static ids', async () => {
      const mockRegistry: ProviderRegistry = {
        version: 1,
        providers: [{
          id: 'antigravity',
          templateId: 'antigravity',
          name: 'Antigravity',
          enabled: true,
          authRef: 'keyring',
          authType: 'oauth',
          api: {},
        }],
      };
      vi.mocked(io.loadRegistry).mockReturnValue(mockRegistry);
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: {
            'gemini-3.5-flash-low': {
              displayName: 'Gemini 3.5 Flash (Medium)',
              maxTokens: 1048576,
              supportsThinking: true,
            },
            'gemini-3-flash': {
              displayName: 'Gemini 3 Flash',
              maxTokens: 1048576,
              supportsThinking: true,
            },
          },
        }),
      } as Response);

      const result = await refreshProviderModels('antigravity', 'mock_token', mockRegistry);

      expect(result.ok).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels',
        expect.objectContaining({ method: 'POST' }),
      );
      const savedRegistry = vi.mocked(io.saveRegistry).mock.calls[0]?.[0] as ProviderRegistry;
      const models = savedRegistry.providers[0]?.modelsCache?.models ?? [];
      expect(models.map(m => m.id)).toEqual(['gemini-3.5-flash-low', 'gemini-3-flash']);
      expect(models.map(m => m.id)).not.toContain('gemini-3.5-flash-high');
      expect(models[0]).toMatchObject({
        id: 'gemini-3.5-flash-low',
        name: 'Gemini 3.5 Flash (Medium)',
        contextWindow: 1048576,
        modelFormat: 'cloud-code',
        reasoning: true,
      });
    });

    it('fails refresh instead of falling back to static Antigravity model names', async () => {
      const mockRegistry: ProviderRegistry = {
        version: 1,
        providers: [{
          id: 'antigravity',
          templateId: 'antigravity',
          name: 'Antigravity',
          enabled: true,
          authRef: 'keyring',
          authType: 'oauth',
          api: {},
        }],
      };
      vi.mocked(io.loadRegistry).mockReturnValue(mockRegistry);
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 404,
      } as Response);

      const result = await refreshProviderModels('antigravity', 'mock_token', mockRegistry);

      expect(result.ok).toBe(false);
      expect(result.reason).toContain('Antigravity live model refresh failed');
      expect(io.saveRegistry).not.toHaveBeenCalled();
    });
  });
});
