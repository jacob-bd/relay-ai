import { describe, expect, it } from 'vitest';
import {
  createGatewayModelCatalog,
  createModelCatalog,
  formatAnthropicModels,
  formatGatewayAnthropicModels,
  formatOpenAIModels,
  gatewayAliasId,
  upstreamModelId,
  type ServerModelInfo,
} from '../src/server/models.js';

const models: ServerModelInfo[] = [
  {
    id: 'claude-sonnet-test',
    name: 'Claude Sonnet Test',
    isFree: false,
    brand: 'Claude',
    sourceBackend: 'zen',
    modelFormat: 'anthropic',
  },
  {
    id: 'deepseek-test',
    name: 'DeepSeek Test',
    isFree: true,
    brand: 'DeepSeek',
    providerLabel: 'OpenCode Go',
    providerId: 'go',
    sourceBackend: 'go',
    modelFormat: 'openai',
  },
  {
    id: 'gpt-5',
    name: 'GPT-5',
    isFree: false,
    brand: 'OpenAI',
    providerLabel: 'OpenAI',
    providerId: 'openai',
    sourceBackend: 'openai',
    modelFormat: 'openai',
    npm: '@ai-sdk/openai',
    apiBaseUrl: 'https://api.openai.com/v1',
    // Explicit so this test doesn't depend on the models-dev cache / heuristic
    // fallback in src/context-window.ts, which can differ by machine.
    contextWindow: 400_000,
  },
];

describe('server model catalog', () => {
  it('maps model ids to model info objects', () => {
    const catalog = createModelCatalog(models);

    expect(catalog.get('claude-sonnet-test')).toMatchObject({
      id: 'claude-sonnet-test',
      modelFormat: 'anthropic',
      sourceBackend: 'zen',
    });
    expect(catalog.get('missing')).toBeUndefined();
    expect(catalog.list().map(model => model.id)).toEqual(['claude-sonnet-test', 'deepseek-test', 'gpt-5']);
  });

  it('formats Anthropic model list responses', () => {
    expect(formatAnthropicModels(models)).toEqual({
      data: [
        {
          id: 'claude-sonnet-test',
          type: 'model',
          display_name: 'Claude Sonnet Test',
          created_at: '2025-01-01T00:00:00Z',
          context_window: 200_000,
          max_input_tokens: 200_000,
        },
        {
          id: 'deepseek-test',
          type: 'model',
          display_name: 'DeepSeek Test',
          created_at: '2025-01-01T00:00:00Z',
          context_window: 64_000,
          max_input_tokens: 64_000,
        },
        {
          id: 'gpt-5',
          type: 'model',
          display_name: 'GPT-5',
          created_at: '2025-01-01T00:00:00Z',
          context_window: 400_000,
          max_input_tokens: 400_000,
        },
      ],
      has_more: false,
      first_id: 'claude-sonnet-test',
      last_id: 'gpt-5',
    });
  });

  it('aliases non-claude ids for gateway discovery', () => {
    expect(gatewayAliasId(models[0]!)).toBe('claude-sonnet-test');
    expect(gatewayAliasId(models[1]!)).toBe('anthropic-go__deepseek-test');
    expect(formatGatewayAnthropicModels(models)).toEqual({
      data: [
        expect.objectContaining({ id: 'claude-sonnet-test', display_name: 'Claude Sonnet Test' }),
        expect.objectContaining({ id: 'anthropic-go__deepseek-test', display_name: 'DeepSeek Test' }),
        expect.objectContaining({ id: 'anthropic-openai__gpt-5', display_name: 'GPT-5' }),
      ],
      has_more: false,
      first_id: 'claude-sonnet-test',
      last_id: 'anthropic-openai__gpt-5',
    });
  });

  it('resolves gateway aliases back to catalog entries', () => {
    const catalog = createGatewayModelCatalog(models);
    expect(catalog.get('deepseek-test')).toMatchObject({ id: 'deepseek-test' });
    expect(catalog.get('anthropic-go__deepseek-test')).toMatchObject({ id: 'deepseek-test' });
  });

  it('exposes one context-accurate entry per model in Claude App mode', () => {
    const contextModels: ServerModelInfo[] = [
      { ...models[1]!, id: 'ctx-200k', name: 'Context 200K', contextWindow: 200_000 },
      { ...models[1]!, id: 'ctx-256k', name: 'Context 256K', contextWindow: 256_000 },
      { ...models[1]!, id: 'ctx-under-1m', name: 'Context Under 1M', contextWindow: 999_999 },
      { ...models[1]!, id: 'ctx-1m', name: 'Context Exact 1M', contextWindow: 1_000_000 },
      { ...models[1]!, id: 'ctx-1048576', name: 'Context 1048576', contextWindow: 1_048_576 },
    ];
    const options = { longContextDisplay: 'single-1m' as const };

    const listed = formatGatewayAnthropicModels(contextModels, options);

    expect(listed.data.map(entry => ({
      id: entry.id,
      name: entry.display_name,
      context: entry.max_input_tokens,
      supportsOneM: entry.supports_1m,
    }))).toEqual([
      { id: 'anthropic-go__ctx-200k', name: 'Context 200K', context: 200_000, supportsOneM: undefined },
      { id: 'anthropic-go__ctx-256k', name: 'Context 256K', context: 256_000, supportsOneM: undefined },
      { id: 'anthropic-go__ctx-under-1m', name: 'Context Under 1M', context: 999_999, supportsOneM: undefined },
      { id: 'anthropic-go__ctx-1m[1m]', name: 'Context Exact 1M', context: 1_000_000, supportsOneM: false },
      { id: 'anthropic-go__ctx-1048576[1m]', name: 'Context 1048576 1M', context: 1_048_576, supportsOneM: false },
    ]);
  });

  it('routes both canonical and compatibility aliases for a single 1M entry', () => {
    const oneMillion = {
      ...models[1]!,
      id: 'ctx-1m',
      name: 'Context Exact 1M',
      contextWindow: 1_000_000,
    };
    const options = { longContextDisplay: 'single-1m' as const };
    const catalog = createGatewayModelCatalog([oneMillion], options);

    expect(catalog.get('anthropic-go__ctx-1m[1m]')?.id).toBe('ctx-1m');
    expect(catalog.get('anthropic-go__ctx-1m')?.id).toBe('ctx-1m');
    expect(catalog.get('ctx-1m')?.id).toBe('ctx-1m');
  });

  it('does not double-suffix an already canonical 1M model id', () => {
    const alreadyCanonical = {
      ...models[1]!,
      id: 'ctx-1m[1m]',
      name: 'Context Exact 1M',
      contextWindow: 1_000_000,
    };

    const listed = formatGatewayAnthropicModels(
      [alreadyCanonical],
      { longContextDisplay: 'single-1m' },
    );

    expect(listed.data[0]?.id).toBe('anthropic-go__ctx-1m[1m]');
    expect(listed.data[0]?.id).not.toContain('[1m][1m]');
  });

  it('keeps default server discovery behavior unchanged for 1M models', () => {
    const oneMillion = {
      ...models[1]!,
      id: 'ctx-1m',
      name: 'Context Exact 1M',
      contextWindow: 1_000_000,
    };

    const listed = formatGatewayAnthropicModels([oneMillion]);

    expect(listed.data[0]).toMatchObject({
      id: 'anthropic-go__ctx-1m',
      display_name: 'Context Exact 1M',
      max_input_tokens: 1_000_000,
    });
    expect(listed.data[0]).not.toHaveProperty('supports_1m');
  });

  it('formats OpenAI model list responses', () => {
    expect(formatOpenAIModels(models)).toEqual({
      object: 'list',
      data: [
        {
          id: 'claude-sonnet-test',
          object: 'model',
          created: 1735689600,
          owned_by: 'zen',
        },
        {
          id: 'deepseek-test',
          object: 'model',
          created: 1735689600,
          owned_by: 'go',
        },
        {
          id: 'gpt-5',
          object: 'model',
          created: 1735689600,
          owned_by: 'openai',
        },
      ],
    });
  });

  it('strips [1m] suffix for upstream Vertex model ids', () => {
    expect(upstreamModelId({
      ...models[0]!,
      id: 'claude-sonnet-4-6[1m]',
      upstreamModelId: 'claude-sonnet-4-6[1m]',
    })).toBe('claude-sonnet-4-6');
  });
});
