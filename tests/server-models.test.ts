import { describe, expect, it } from 'vitest';
import {
  createModelCatalog,
  formatAnthropicModels,
  formatOpenAIModels,
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
        },
        {
          id: 'deepseek-test',
          type: 'model',
          display_name: 'DeepSeek Test',
          created_at: '2025-01-01T00:00:00Z',
        },
      ],
      has_more: false,
      first_id: 'claude-sonnet-test',
      last_id: 'deepseek-test',
    });
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
});
