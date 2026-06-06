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

  it('strips trailing slash before appending /chat/completions for @ai-sdk/openai-compatible', () => {
    const result = resolveEndpoint('@ai-sdk/openai-compatible', 'https://api.deepseek.com/');
    expect(result).toEqual({
      format: 'openai',
      completionsUrl: 'https://api.deepseek.com/chat/completions',
    });
  });

  it('returns openai format for @ai-sdk/openai', () => {
    const result = resolveEndpoint('@ai-sdk/openai', '');
    expect(result).toEqual({
      format: 'openai',
      completionsUrl: 'https://api.openai.com/v1/chat/completions',
    });
  });

  it('returns openai format for @ai-sdk/google', () => {
    const result = resolveEndpoint('@ai-sdk/google', '');
    expect(result).toEqual({
      format: 'openai',
      completionsUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    });
  });

  it('returns openai format for @ai-sdk/groq', () => {
    const result = resolveEndpoint('@ai-sdk/groq', '');
    expect(result).toEqual({
      format: 'openai',
      completionsUrl: 'https://api.groq.com/openai/v1/chat/completions',
    });
  });

  it('returns openai format for @ai-sdk/mistral', () => {
    const result = resolveEndpoint('@ai-sdk/mistral', '');
    expect(result).toEqual({
      format: 'openai',
      completionsUrl: 'https://api.mistral.ai/v1/chat/completions',
    });
  });

  it('returns openai format for @ai-sdk/xai', () => {
    const result = resolveEndpoint('@ai-sdk/xai', '');
    expect(result).toEqual({
      format: 'openai',
      completionsUrl: 'https://api.x.ai/v1/chat/completions',
    });
  });

  it('returns null for unknown npm packages', () => {
    expect(resolveEndpoint('@ai-sdk/unknown-provider', '')).toBeNull();
    expect(resolveEndpoint('', '')).toBeNull();
    expect(resolveEndpoint('@some/other-package', 'https://example.com')).toBeNull();
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

  it('skips models with unknown npm packages', () => {
    const result = normalizeProviders([
      {
        id: 'custom',
        name: 'Custom',
        key: 'sk-test',
        models: { m: unknownNpmModel },
      },
    ]);
    // Provider has no supported models → excluded
    expect(result).toHaveLength(0);
  });

  it('keeps provider only when at least one model is supported', () => {
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
    expect(result[0].models).toHaveLength(1);
    expect(result[0].models[0].id).toBe('gpt-4o');
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
    expect(model.completionsUrl).toBe('https://api.openai.com/v1/chat/completions');
    expect(model.brand).toBe('GPT');
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
