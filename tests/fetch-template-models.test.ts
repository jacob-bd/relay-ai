import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchTemplateModels } from '../src/registry/fetch-template-models.js';
import { PROVIDER_TEMPLATES } from '../src/provider-templates.js';

describe('fetchTemplateModels', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses x-api-key for Anthropic, not Bearer auth', async () => {
    const anthropic = PROVIDER_TEMPLATES.find(t => t.id === 'anthropic')!;
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        data: [{ id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' }],
      }),
    } as Response);

    const result = await fetchTemplateModels(anthropic, 'sk-ant-test-key');
    expect(result.error).toBeUndefined();
    expect(result.models.map(m => m.id)).toEqual(['claude-sonnet-4-6']);

    expect(fetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-api-key': 'sk-ant-test-key',
          'anthropic-version': '2023-06-01',
        }),
      }),
    );
    const call = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    expect((call.headers as Record<string, string>)['Authorization']).toBeUndefined();
  });

  it('uses Bearer auth for OpenAI-compatible providers', async () => {
    const groq = PROVIDER_TEMPLATES.find(t => t.id === 'groq')!;
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [{ id: 'llama', name: 'llama' }] }),
    } as Response);

    await fetchTemplateModels(groq, 'gsk-test-key');

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer gsk-test-key',
        }),
      }),
    );
  });

  it.each([
    ['qwen-cloud-token-plan', 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/models'],
    ['qwen-cloud-payg', 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models'],
  ])('fetches %s models with Bearer auth at its exact endpoint', async (templateId, url) => {
    const template = PROVIDER_TEMPLATES.find(t => t.id === templateId)!;
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [{ id: 'qwen-coder', name: 'Qwen Coder' }] }),
    } as Response);

    await fetchTemplateModels(template, 'test-key');

    expect(fetch).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
      }),
    );
  });

  it('merges extra headers for custom endpoints needing plan/auth-tracking headers', async () => {
    const groq = PROVIDER_TEMPLATES.find(t => t.id === 'groq')!;
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [{ id: 'llama', name: 'llama' }] }),
    } as Response);

    await fetchTemplateModels(groq, 'gsk-test-key', undefined, { 'X-Plan': 'coding' });

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer gsk-test-key',
          'X-Plan': 'coding',
        }),
      }),
    );
  });

  it('preserves provider-supported request parameters from model list rows', async () => {
    const openrouter = PROVIDER_TEMPLATES.find(t => t.id === 'openrouter')!;
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        data: [{
          id: 'z-ai/glm-5.2',
          name: 'Z.ai: GLM 5.2',
          supported_parameters: ['tools', 'reasoning', 'include_reasoning'],
        }],
      }),
    } as Response);

    const result = await fetchTemplateModels(openrouter, 'sk-or-test');

    expect(result.error).toBeUndefined();
    expect(result.models[0]).toMatchObject({
      id: 'z-ai/glm-5.2',
      supportedParameters: ['tools', 'reasoning', 'include_reasoning'],
    });
  });

  it('uses provider-specific modelsPath and omits Authorization for anonymous Kilo fetches', async () => {
    const kilo = PROVIDER_TEMPLATES.find(t => t.id === 'kilo')!;
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        data: [{
          id: 'tencent/hy3:free',
          name: 'Tencent: Hy3 (free)',
          isFree: true,
          context_length: 262144,
          pricing: { prompt: '0', completion: '0', input_cache_read: '0' },
        }],
      }),
    } as Response);

    const result = await fetchTemplateModels(kilo, '');

    expect(result.error).toBeUndefined();
    expect(result.models[0]).toMatchObject({
      id: 'tencent/hy3:free',
      isFree: true,
      freeStatus: 'verified_free',
      contextWindow: 262144,
      cost: { input: 0, output: 0, cache_read: 0 },
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://api.kilo.ai/api/gateway/models',
      expect.objectContaining({
        headers: expect.not.objectContaining({
          Authorization: expect.any(String),
        }),
      }),
    );
  });

  it('derives verified free status from zero pricing even when provider flag is false', async () => {
    const openrouter = PROVIDER_TEMPLATES.find(t => t.id === 'openrouter')!;
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        data: [{
          id: 'google/lyria-3-pro-preview',
          name: 'Google: Lyria 3 Pro Preview',
          isFree: false,
          context_length: 1048576,
          pricing: { prompt: '0', completion: '0' },
        }],
      }),
    } as Response);

    const result = await fetchTemplateModels(openrouter, 'sk-or-test');

    expect(result.models[0]).toMatchObject({
      id: 'google/lyria-3-pro-preview',
      isFree: true,
      freeStatus: 'verified_free',
      cost: { input: 0, output: 0 },
    });
  });
});
