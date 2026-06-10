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
    expect(catalog.list().map(model => model.id)).toEqual(['claude-sonnet-test', 'deepseek-test']);
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
      ],
      has_more: false,
      first_id: 'claude-sonnet-test',
      last_id: 'deepseek-test',
    });
  });

  it('aliases non-claude ids for gateway discovery', () => {
    expect(gatewayAliasId(models[0]!)).toBe('claude-sonnet-test');
    expect(gatewayAliasId(models[1]!)).toBe('anthropic-go__deepseek-test');
    expect(formatGatewayAnthropicModels(models)).toEqual({
      data: [
        expect.objectContaining({ id: 'claude-sonnet-test', display_name: 'Claude Sonnet Test' }),
        expect.objectContaining({ id: 'anthropic-go__deepseek-test', display_name: 'DeepSeek Test' }),
      ],
      has_more: false,
      first_id: 'claude-sonnet-test',
      last_id: 'anthropic-go__deepseek-test',
    });
  });

  it('resolves gateway aliases back to catalog entries', () => {
    const catalog = createGatewayModelCatalog(models);
    expect(catalog.get('deepseek-test')).toMatchObject({ id: 'deepseek-test' });
    expect(catalog.get('anthropic-go__deepseek-test')).toMatchObject({ id: 'deepseek-test' });
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
