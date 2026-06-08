// tests/providers.test.ts
import { describe, it, expect } from 'vitest';
import { resolveEndpoint, normalizeProviders } from '../src/providers.js';

// ---- resolveEndpoint ----

describe('resolveEndpoint', () => {
  it('returns anthropic format for @ai-sdk/anthropic', () => {
    const result = resolveEndpoint('@ai-sdk/anthropic', '');
    expect(result).toEqual({ format: 'anthropic', baseUrl: 'https://api.anthropic.com' });
  });

  it('strips /v1 from anthropic apiUrl', () => {
    const result = resolveEndpoint('@ai-sdk/anthropic', 'https://api.anthropic.com/v1');
    expect(result).toEqual({ format: 'anthropic', baseUrl: 'https://api.anthropic.com' });
  });

  it('strips trailing /v1/ from anthropic apiUrl', () => {
    const result = resolveEndpoint('@ai-sdk/anthropic', 'https://api.anthropic.com/v1/');
    expect(result).toEqual({ format: 'anthropic', baseUrl: 'https://api.anthropic.com' });
  });

  it('appends /chat/completions for @ai-sdk/openai-compatible', () => {
    const result = resolveEndpoint('@ai-sdk/openai-compatible', 'https://api.deepseek.com');
    expect(result).toEqual({
      format: 'openai',
      completionsUrl: 'https://api.deepseek.com/chat/completions',
    });
  });

  it('returns null for @ai-sdk/openai-compatible with empty apiUrl', () => {
    expect(resolveEndpoint('@ai-sdk/openai-compatible', '')).toBeNull();
  });

  it('strips trailing slash before appending /chat/completions for @ai-sdk/openai-compatible', () => {
    const result = resolveEndpoint('@ai-sdk/openai-compatible', 'https://api.deepseek.com/');
    expect(result).toEqual({
      format: 'openai',
      completionsUrl: 'https://api.deepseek.com/chat/completions',
    });
  });

  it('returns openai format for known SDK packages without hardcoded URLs', () => {
    expect(resolveEndpoint('@ai-sdk/openai', '')).toEqual({ format: 'openai' });
    expect(resolveEndpoint('@ai-sdk/google', '')).toEqual({ format: 'openai' });
    expect(resolveEndpoint('@ai-sdk/groq', '')).toEqual({ format: 'openai' });
    expect(resolveEndpoint('@openrouter/ai-sdk-provider', 'https://openrouter.ai/api/v1')).toEqual({ format: 'openai' });
  });

  it('accepts future OpenCode provider packages without code changes', () => {
    expect(resolveEndpoint('@ai-sdk/cerebras', '')).toEqual({ format: 'openai' });
    expect(resolveEndpoint('@ai-sdk/unknown-new', 'https://example.com')).toEqual({ format: 'openai' });
    expect(resolveEndpoint('gitlab-ai-provider', '')).toEqual({ format: 'openai' });
  });

  it('returns null only when npm is missing', () => {
    expect(resolveEndpoint('', '')).toBeNull();
  });
});

// ---- normalizeProviders ----

describe('normalizeProviders', () => {
  const validAnthropicModel = {
    id: 'claude-3-5-sonnet',
    name: 'Claude 3.5 Sonnet',
    family: 'claude',
    api: { npm: '@ai-sdk/anthropic', url: 'https://api.anthropic.com/v1' },
    cost: { input: 3, output: 15 },
  };

  const validOpenAIModel = {
    id: 'gpt-4o',
    name: 'GPT-4o',
    family: 'gpt',
    api: { npm: '@ai-sdk/openai', url: '' },
  };

  const unknownNpmModel = {
    id: 'mystery-model',
    name: 'Mystery',
    family: 'mystery',
    api: { npm: '@unknown/sdk', url: '' },
  };

  it('skips providers with empty key', () => {
    const result = normalizeProviders([
      { id: 'anthropic', name: 'Anthropic', key: '', models: { m: validAnthropicModel } },
    ]);
    expect(result).toHaveLength(0);
  });

  it('skips providers with no key at all (OAuth/unconfigured)', () => {
    const result = normalizeProviders([
      { id: 'anthropic', name: 'Anthropic', models: { m: validAnthropicModel } },
    ]);
    expect(result).toHaveLength(0);
  });

  it('skips the opencode provider (cloud backend)', () => {
    const result = normalizeProviders([
      { id: 'opencode', name: 'OpenCode', key: 'sk-test', models: { m: validAnthropicModel } },
    ]);
    expect(result).toHaveLength(0);
  });

  it('skips the opencode-go provider (cloud backend)', () => {
    const result = normalizeProviders([
      { id: 'opencode-go', name: 'OpenCode Go', key: 'sk-test', models: { m: validAnthropicModel } },
    ]);
    expect(result).toHaveLength(0);
  });

  it('includes models with any npm OpenCode assigns', () => {
    const result = normalizeProviders([
      {
        id: 'custom',
        name: 'Custom',
        key: 'sk-test',
        models: { m: unknownNpmModel },
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].models[0]).toMatchObject({
      id: 'mystery-model',
      modelFormat: 'openai',
      npm: '@unknown/sdk',
    });
  });

  it('maps catalog id to OpenCode api.id for upstream calls', () => {
    const result = normalizeProviders([
      {
        id: 'openai',
        name: 'OpenAI',
        key: 'sk-test',
        models: {
          m: {
            id: 'gpt-5.5-fast',
            name: 'GPT-5.5 Fast',
            family: 'gpt',
            api: { id: 'gpt-5.5', npm: '@ai-sdk/openai', url: '' },
          },
        },
      },
    ]);
    expect(result[0].models[0]).toMatchObject({
      id: 'gpt-5.5-fast',
      upstreamModelId: 'gpt-5.5',
    });
  });

  it('keeps all models OpenCode returns with a valid npm', () => {
    const result = normalizeProviders([
      {
        id: 'custom',
        name: 'Custom',
        key: 'sk-test',
        models: {
          good: validOpenAIModel,
          bad: unknownNpmModel,
        },
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].models).toHaveLength(2);
    expect(result[0].models.map(m => m.id).sort()).toEqual(['gpt-4o', 'mystery-model']);
  });

  it('normalizes a valid anthropic-format provider correctly', () => {
    const result = normalizeProviders([
      {
        id: 'anthropic',
        name: 'Anthropic',
        key: 'sk-ant-test',
        models: { m: validAnthropicModel },
      },
    ]);
    expect(result).toHaveLength(1);
    const provider = result[0];
    expect(provider.id).toBe('anthropic');
    expect(provider.apiKey).toBe('sk-ant-test');
    expect(provider.models).toHaveLength(1);

    const model = provider.models[0];
    expect(model.id).toBe('claude-3-5-sonnet');
    expect(model.modelFormat).toBe('anthropic');
    expect(model.baseUrl).toBe('https://api.anthropic.com');
    expect(model.brand).toBe('Claude');
    expect(model.cost).toEqual({ input: 3, output: 15 });
  });

  it('normalizes a valid openai-format provider correctly', () => {
    const result = normalizeProviders([
      {
        id: 'openai',
        name: 'OpenAI',
        key: 'sk-openai-test',
        models: { m: validOpenAIModel },
      },
    ]);
    expect(result).toHaveLength(1);
    const model = result[0].models[0];
    expect(model.modelFormat).toBe('openai');
    expect(model.completionsUrl).toBeUndefined();
    expect(model.npm).toBe('@ai-sdk/openai');
    expect(model.brand).toBe('GPT');
  });

  it('normalizes OpenRouter provider models', () => {
    const result = normalizeProviders([
      {
        id: 'openrouter',
        name: 'OpenRouter',
        key: 'sk-or-test',
        models: {
          m: {
            id: 'anthropic/claude-sonnet-4',
            name: 'Claude Sonnet 4',
            family: 'claude-sonnet',
            api: { npm: '@openrouter/ai-sdk-provider', url: 'https://openrouter.ai/api/v1' },
            limit: { context: 200000 },
          },
        },
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('openrouter');
    const model = result[0].models[0];
    expect(model.modelFormat).toBe('openai');
    expect(model.completionsUrl).toBeUndefined();
    expect(model.apiBaseUrl).toBe('https://openrouter.ai/api/v1');
    expect(model.contextWindow).toBe(200000);
  });

  it('uses model.id as name when name is missing', () => {
    const modelWithoutName = { id: 'some-model', api: { npm: '@ai-sdk/openai', url: '' } };
    const result = normalizeProviders([
      {
        id: 'openai',
        name: 'OpenAI',
        key: 'sk-test',
        models: { m: modelWithoutName },
      },
    ]);
    expect(result[0].models[0].name).toBe('some-model');
  });

  it('handles provider with no models field', () => {
    const result = normalizeProviders([
      { id: 'empty', name: 'Empty', key: 'sk-test' },
    ]);
    expect(result).toHaveLength(0);
  });

  it('returns empty array for empty input', () => {
    expect(normalizeProviders([])).toEqual([]);
  });
});
