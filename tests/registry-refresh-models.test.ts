import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { refreshProviderModels } from '../src/registry/refresh-models.js';
import * as io from '../src/registry/io.js';
import * as env from '../src/env.js';
import * as pricing from '../src/registry/pricing.js';
import type { ProviderRegistry, RegistryProvider } from '../src/registry/types.js';

vi.mock('../src/registry/io.js', () => ({
  loadRegistry: vi.fn(),
  saveRegistry: vi.fn(),
}));

vi.mock('../src/registry/pricing.js', () => ({
  loadPricingCache: vi.fn(),
  enrichModelsWithPricing: vi.fn((models) => models),
  enrichModelsForProviderPricing: vi.fn((models) => models),
  enrichPricingAsync: vi.fn(),
  pricingPlatformForProvider: vi.fn(),
  buildPricingIndex: vi.fn(),
}));

describe('registry/refresh-models', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
    vi.clearAllMocks();
    vi.spyOn(env, 'enrichGithubCopilotOAuthProviderData').mockResolvedValue(undefined);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('does not apply cached PAYG pricing when refreshing Qwen Cloud Token Plan', async () => {
    const registry: ProviderRegistry = {
      schemaVersion: 1,
      providers: [{
        id: 'qwen-cloud-token-plan',
        templateId: 'qwen-cloud-token-plan',
        name: 'Qwen Cloud (Token Plan)',
        enabled: true,
        authRef: 'keyring:provider:qwen-cloud-token-plan',
        authType: 'api',
        api: {
          npm: '@ai-sdk/alibaba',
          url: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
        },
        addedAt: '2026-07-19T00:00:00.000Z',
      }],
    };
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [{ id: 'qwen-coder', name: 'Qwen Coder' }] }),
    } as Response);

    const result = await refreshProviderModels('qwen-cloud-token-plan', 'test-key', registry);

    expect(result.ok).toBe(true);
    expect(pricing.enrichModelsWithPricing).not.toHaveBeenCalled();
    expect(pricing.enrichModelsForProviderPricing).toHaveBeenCalledWith(
      expect.any(Array),
      undefined,
      'qwen-cloud-token-plan',
      'qwen-cloud-token-plan',
    );
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

    it('Tier 3: keeps existing cached models instead of overwriting with the static seed', async () => {
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
          modelsCache: {
            models: [{
              id: 'gpt-5.6-sol',
              name: 'GPT-5.6 Sol',
              upstreamModelId: 'gpt-5.6-sol',
              family: 'gpt',
              brand: 'GPT',
              contextWindow: 1_000_000,
              modelFormat: 'openai',
              npm: '@ai-sdk/openai',
              reasoning: true,
            }],
            fetchedAt: Date.now(),
          },
        }],
      };
      vi.mocked(io.loadRegistry).mockReturnValue(mockRegistry);

      // Both live endpoints fail — would normally fall back to the static seed.
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 500,
      } as Response);

      const result = await refreshProviderModels('openai-oauth', 'mock_token', mockRegistry);

      expect(result.ok).toBe(true);
      expect(result.skipped).toBe(true);
      expect(result.modelCount).toBe(1);
      // The previously cached gpt-5.6-sol model must survive — not overwritten by the
      // older static seed list, and saveRegistry must not have been called.
      expect(io.saveRegistry).not.toHaveBeenCalled();
      expect(mockRegistry.providers[0]?.modelsCache?.models[0]?.id).toBe('gpt-5.6-sol');
    });

    it('captures use_responses_lite / prefer_websockets flags from the live Codex endpoint', async () => {
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

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [
            { slug: 'gpt-5.6-luna', title: 'GPT-5.6 Luna', use_responses_lite: true, prefer_websockets: true },
            { slug: 'gpt-5.6-sol', title: 'GPT-5.6 Sol' },
          ],
        }),
      } as Response);

      await refreshProviderModels('openai-oauth', 'mock_token', mockRegistry);

      const savedRegistry = vi.mocked(io.saveRegistry).mock.calls[0]?.[0] as ProviderRegistry;
      const models = savedRegistry.providers[0]?.modelsCache?.models ?? [];
      const luna = models.find(m => m.id === 'gpt-5.6-luna');
      const sol = models.find(m => m.id === 'gpt-5.6-sol');
      expect(luna?.useResponsesLite).toBe(true);
      expect(luna?.preferWebSockets).toBe(true);
      // A model the backend does not flag stays on the HTTP path.
      expect(sol?.useResponsesLite).toBeUndefined();
      expect(sol?.preferWebSockets).toBeUndefined();
    });

    it('Tier 3: static seed carries Luna capability flags so a discovery outage does not regress it', async () => {
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

      // Both live endpoints fail → static seed.
      vi.mocked(global.fetch).mockResolvedValue({ ok: false, status: 500 } as Response);

      await refreshProviderModels('openai-oauth', 'mock_token', mockRegistry);

      const savedRegistry = vi.mocked(io.saveRegistry).mock.calls[0]?.[0] as ProviderRegistry;
      const luna = savedRegistry.providers[0]?.modelsCache?.models.find(m => m.id === 'gpt-5.6-luna');
      expect(luna?.useResponsesLite).toBe(true);
      expect(luna?.preferWebSockets).toBe(true);
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

    it('uses the live context_length instead of the id-pattern heuristic fallback', async () => {
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

      // grok-4.5 isn't in the static seed, and the id-pattern heuristic (grok-3|grok-4)
      // would misclassify it at 131,072 if context_length weren't read from the response.
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: 'grok-4.5', context_length: 500_000 }],
        }),
      } as Response);

      await refreshProviderModels('xai-oauth', 'mock_token', mockRegistry);

      const savedRegistry = vi.mocked(io.saveRegistry).mock.calls[0]?.[0] as ProviderRegistry;
      const model = savedRegistry.providers[0]?.modelsCache?.models[0];
      expect(model?.id).toBe('grok-4.5');
      expect(model?.contextWindow).toBe(500_000);
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

  describe('refreshProviderModels (GitHub Copilot OAuth)', () => {
    function copilotRegistry(models?: RegistryProvider['modelsCache']): ProviderRegistry {
      return {
        schemaVersion: 1,
        providers: [{
          id: 'github-copilot',
          templateId: 'github-copilot',
          name: 'GitHub Copilot',
          enabled: true,
          authRef: 'keyring:oauth:provider:github-copilot',
          authType: 'oauth',
          api: {
            npm: '@ai-sdk/openai-compatible',
            url: 'https://api.githubcopilot.com',
            headers: { 'Editor-Version': 'vscode/1.85.1' },
          },
          ...(models ? { modelsCache: models } : {}),
          addedAt: '2026-07-19T00:00:00.000Z',
        }],
      };
    }

    it('uses the safe Free allowlist when Copilot plan metadata is missing', async () => {
      const registry = copilotRegistry();
      vi.spyOn(env, 'resolveProviderOAuthProviderData').mockResolvedValue(undefined);
      vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({
        data: [
          { id: 'gpt-4.1', supported_endpoints: ['/chat/completions'] },
          { id: 'gemini-premium', supported_endpoints: ['/chat/completions'] },
          { id: 'gpt-4.1-free-auto', supported_endpoints: ['/chat/completions'] },
        ],
      }), { status: 200 }));

      const result = await refreshProviderModels('github-copilot', 'copilot-session-token', registry);

      expect(result).toMatchObject({ ok: true, modelCount: 1 });
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.githubcopilot.com/models',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer copilot-session-token',
            'Editor-Version': 'vscode/1.85.1',
          }),
        }),
      );
      const saved = vi.mocked(io.saveRegistry).mock.calls[0]?.[0] as ProviderRegistry;
      expect(saved.providers[0]?.modelsCache?.models.map(model => model.id)).toEqual(['gpt-4.1']);
    });

    it('keeps the full callable catalog for a confirmed paid plan', async () => {
      const registry = copilotRegistry();
      vi.spyOn(env, 'resolveProviderOAuthProviderData').mockResolvedValue({
        copilot: { is_free_plan: false, lookup_status: 'known' },
      });
      vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({
        data: [
          { id: 'gpt-4.1', supported_endpoints: ['/chat/completions'], billing: { multiplier: 0 } },
          { id: 'claude-sonnet-4', supported_endpoints: ['/chat/completions'] },
          { id: 'premium-auto', supported_endpoints: ['/chat/completions'] },
        ],
      }), { status: 200 }));

      await refreshProviderModels('github-copilot', 'copilot-session-token', registry);

      const saved = vi.mocked(io.saveRegistry).mock.calls[0]?.[0] as ProviderRegistry;
      expect(saved.providers[0]?.modelsCache?.models.map(model => model.id)).toEqual([
        'gpt-4.1',
        'claude-sonnet-4',
      ]);
    });

    it('lazily enriches older credentials before applying the plan policy', async () => {
      const registry = copilotRegistry();
      vi.spyOn(env, 'resolveProviderOAuthProviderData').mockResolvedValue(undefined);
      vi.mocked(env.enrichGithubCopilotOAuthProviderData).mockResolvedValue({
        copilot: { lookup_status: 'known', is_free_plan: false },
      });
      vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({
        data: [
          { id: 'gpt-4.1', supported_endpoints: ['/chat/completions'] },
          { id: 'claude-sonnet-4', supported_endpoints: ['/chat/completions'] },
        ],
      }), { status: 200 }));

      const result = await refreshProviderModels('github-copilot', 'copilot-session-token', registry);

      expect(env.enrichGithubCopilotOAuthProviderData)
        .toHaveBeenCalledWith('keyring:oauth:provider:github-copilot');
      expect(result).toMatchObject({ ok: true, modelCount: 2 });
    });

    it('replaces an unsafe old cache with Free seeds when the plan is unknown and discovery fails', async () => {
      const registry = copilotRegistry({
        fetchedAt: '2026-07-18T00:00:00.000Z',
        models: [{
          id: 'gemini-premium',
          name: 'Gemini Premium',
          upstreamModelId: 'gemini-premium',
          modelFormat: 'openai',
          npm: '@ai-sdk/openai-compatible',
        }],
      });
      vi.spyOn(env, 'resolveProviderOAuthProviderData').mockResolvedValue(undefined);
      vi.mocked(global.fetch).mockResolvedValueOnce(new Response('unavailable', { status: 503 }));

      const result = await refreshProviderModels('github-copilot', 'copilot-session-token', registry);

      expect(result).toMatchObject({ ok: true, modelCount: 2 });
      const saved = vi.mocked(io.saveRegistry).mock.calls[0]?.[0] as ProviderRegistry;
      expect(saved.providers[0]?.modelsCache?.models.map(model => model.id)).toEqual(['gpt-4.1', 'gpt-4o']);
    });
  });

  describe('refreshProviderModels (Antigravity OAuth)', () => {
    it('uses the live Cloud Code model catalog object and keeps only validated agent slots', async () => {
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
      expect(result.modelCount).toBe(1);
      expect(models.map(m => m.id)).toEqual(['gemini-3.5-flash-low']);
      expect(models.map(m => m.id)).not.toContain('gemini-3.5-flash-high');
      expect(models.map(m => m.id)).not.toContain('gemini-3-flash');
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

    it('fails refresh when Cloud Code returns no validated agent slots', async () => {
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
          modelsCache: {
            fetchedAt: '2026-06-26T00:00:00.000Z',
            models: [{
              id: 'gemini-3.5-flash-low',
              name: 'Gemini 3.5 Flash (Medium)',
              modelFormat: 'cloud-code',
            }],
          },
        }],
      };
      vi.mocked(io.loadRegistry).mockReturnValue(mockRegistry);
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: {
            'gemini-2.5-pro': {
              displayName: 'Gemini 2.5 Pro',
              maxTokens: 1048576,
              supportsThinking: true,
            },
          },
        }),
      } as Response);

      const result = await refreshProviderModels('antigravity', 'mock_token', mockRegistry);

      expect(result.ok).toBe(false);
      expect(result.reason).toContain('No validated Antigravity agent models');
      expect(io.saveRegistry).not.toHaveBeenCalled();
    });
  });
});
