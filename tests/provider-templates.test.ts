import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  filterTemplates,
  getTemplateById,
  listAddableTemplates,
  listSupportedTemplates,
  listVisibleOAuthTemplates,
  PROVIDER_TEMPLATES,
} from '../src/provider-templates.js';
import { fetchTemplateModels } from '../src/registry/fetch-template-models.js';

describe('provider templates', () => {
  it('includes groq in supported templates', () => {
    const ids = listSupportedTemplates().map(t => t.id);
    expect(ids).toContain('groq');
    expect(ids).toContain('mistral');
    expect(ids).toContain('kilo');
  });

  it('sorts supported templates alphabetically by display name', () => {
    const names = listSupportedTemplates().map(t => t.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('filters templates by search query', () => {
    const templates = listSupportedTemplates();
    expect(filterTemplates(templates, 'gro').map(t => t.id)).toEqual(['groq']);
    expect(filterTemplates(templates, 'together').map(t => t.id)).toEqual(['togetherai']);
    expect(filterTemplates(templates, 'opencode').map(t => t.id)).toEqual(['opencode-cloud']);
  });

  it('looks up template by id', () => {
    expect(getTemplateById('groq')?.npm).toBe('@ai-sdk/groq');
  });

  it('defines Kilo Code as anonymous-free OpenAI-compatible provider', () => {
    expect(getTemplateById('kilo')).toMatchObject({
      name: 'Kilo Code',
      npm: '@ai-sdk/openai-compatible',
      defaultBaseUrl: 'https://api.kilo.ai/api/gateway',
      modelsPath: '/models',
      apiKeyOptional: true,
      anonymousFreeModels: true,
      modelSource: 'api-list',
      supported: true,
    });
  });

  it('defines separate Qwen Cloud Token Plan and PAYG templates', () => {
    expect(getTemplateById('qwen-cloud-token-plan')).toMatchObject({
      id: 'qwen-cloud-token-plan',
      name: 'Qwen Cloud (Token Plan)',
      authType: 'api',
      npm: '@ai-sdk/alibaba',
      defaultBaseUrl: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
      signupUrl: 'https://home.qwencloud.com/api-keys',
      modelSource: 'api-list',
    });
    expect(getTemplateById('qwen-cloud-payg')).toMatchObject({
      id: 'qwen-cloud-payg',
      name: 'Qwen Cloud (Pay-As-You-Go)',
      authType: 'api',
      npm: '@ai-sdk/alibaba',
      defaultBaseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      signupUrl: 'https://home.qwencloud.com/api-keys',
      modelSource: 'api-list',
    });
    expect(getTemplateById('alibaba')).toMatchObject({
      name: 'Alibaba DashScope (China)',
      defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    });
  });

  it('keeps all three DashScope variants separately addable', () => {
    const ids = listAddableTemplates([]).map(t => t.id);
    expect(ids).toEqual(expect.arrayContaining([
      'alibaba',
      'qwen-cloud-token-plan',
      'qwen-cloud-payg',
    ]));
    expect(listAddableTemplates(['alibaba']).map(t => t.id)).toEqual(expect.arrayContaining([
      'qwen-cloud-token-plan',
      'qwen-cloud-payg',
    ]));
  });

  it('omits hidden templates from OAuth discovery surfaces', () => {
    const hiddenIds = PROVIDER_TEMPLATES.filter(t => t.hidden).map(t => t.id);
    const visibleIds = listVisibleOAuthTemplates().map(t => t.id);

    expect(hiddenIds.length).toBeGreaterThan(0);
    for (const id of hiddenIds) {
      expect(visibleIds).not.toContain(id);
    }
  });

  it('lists only visible OAuth templates for discovery surfaces', () => {
    expect(listVisibleOAuthTemplates().map(t => t.id).sort()).toEqual([
      'github-copilot',
      'openai-oauth',
      'xai-oauth',
    ]);
    expect(listVisibleOAuthTemplates(['openai-oauth']).map(t => t.id)).not.toContain('openai-oauth');
  });

  it('excludes already-configured providers from addable list', () => {
    const addable = listAddableTemplates(['groq', 'mistral']);
    expect(addable.map(t => t.id)).not.toContain('groq');
    expect(addable.map(t => t.id)).not.toContain('mistral');
    expect(addable.map(t => t.id)).toContain('togetherai');
  });

  it('offers OpenCode Zen and Go as one setup option', () => {
    expect(listAddableTemplates([]).filter(t => t.modelSource === 'zen-go-api').map(t => t.id))
      .toEqual(['opencode-cloud']);
    expect(listAddableTemplates(['zen']).map(t => t.id)).not.toContain('opencode-cloud');
    expect(listAddableTemplates(['go']).map(t => t.id)).not.toContain('opencode-cloud');
  });
});

describe('fetchTemplateModels', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses OpenAI-style model list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        data: [{ id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B' }],
      }),
    }));

    const template = getTemplateById('groq')!;
    const result = await fetchTemplateModels(template, 'test-key');
    expect(result.error).toBeUndefined();
    expect(result.models).toHaveLength(1);
    expect(result.models[0]?.id).toBe('llama-3.3-70b-versatile');
    expect(result.models[0]?.modelFormat).toBe('openai');
  });

  it('returns helpful error on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'invalid key',
    }));

    const template = getTemplateById('groq')!;
    const result = await fetchTemplateModels(template, 'bad-key');
    expect(result.models).toHaveLength(0);
    expect(result.error).toContain('rejected');
  });
});
