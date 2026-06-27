// tests/models.test.ts
import { describe, it, expect } from 'vitest';
import {
  deriveBrand,
  mergeModels,
  groupModels,
} from '../src/models.js';
import { classifyModelFormat } from '../src/constants.js';
import type { ModelInfo } from '../src/types.js';

describe('deriveBrand', () => {
  it.each([
    ['claude-opus', 'Claude'],
    ['claude-sonnet', 'Claude'],
    ['gpt', 'GPT'],
    ['gpt-codex', 'GPT'],
    ['gpt-mini', 'GPT'],
    ['gemini-pro', 'Gemini'],
    ['gemini-flash', 'Gemini'],
    ['deepseek-flash', 'DeepSeek'],
    ['qwen', 'Qwen'],
    ['qwen-free', 'Qwen'],
    ['minimax', 'MiniMax'],
    ['minimax-m3-free', 'MiniMax'],
    ['kimi', 'Kimi'],
    ['kimi-free', 'Kimi'],
    ['glm', 'GLM'],
    ['glm-free', 'GLM'],
    ['mimo-flash-free', 'MiMo'],
    ['grok', 'Grok'],
    ['nemotron-free', 'Nemotron'],
    ['big-pickle', 'Other'],
    ['ring-1t-free', 'Other'],
  ])('deriveBrand("%s") === "%s"', (family, expected) => {
    expect(deriveBrand(family)).toBe(expected);
  });
});

describe('classifyModelFormat', () => {
  // Provider npm takes precedence
  it('returns anthropic for @ai-sdk/anthropic provider', () => {
    expect(classifyModelFormat('claude-sonnet-4-6', '@ai-sdk/anthropic')).toBe('anthropic');
  });

  it('returns unsupported for @ai-sdk/openai provider', () => {
    expect(classifyModelFormat('gpt-5.4', '@ai-sdk/openai')).toBe('unsupported');
  });

  it('returns unsupported for @ai-sdk/google provider', () => {
    expect(classifyModelFormat('gemini-3-flash', '@ai-sdk/google')).toBe('unsupported');
  });

  it('returns openai for models without provider npm', () => {
    expect(classifyModelFormat('deepseek-v4-flash', undefined)).toBe('openai');
  });

  // ID-prefix fallback when no provider npm
  it('returns anthropic for claude-* without cache', () => {
    expect(classifyModelFormat('claude-opus-4-8', undefined)).toBe('anthropic');
  });

  it('returns unsupported for gpt-* without cache', () => {
    expect(classifyModelFormat('gpt-5.5', undefined)).toBe('unsupported');
  });

  it('returns unsupported for gemini-* without cache', () => {
    expect(classifyModelFormat('gemini-3.1-pro', undefined)).toBe('unsupported');
  });

  it('returns openai for unknown models (default)', () => {
    expect(classifyModelFormat('big-pickle', undefined)).toBe('openai');
  });

  it('returns openai for kimi without cache', () => {
    expect(classifyModelFormat('kimi-k2.6', undefined)).toBe('openai');
  });
});

describe('mergeModels', () => {
  it('returns ModelInfo with format classification when cache is null', () => {
    const result = mergeModels(['claude-opus-4-8'], null, 'zen');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'claude-opus-4-8',
      name: 'claude-opus-4-8',
      isFree: false,
      brand: 'Other',
      modelFormat: 'anthropic',
      sourceBackend: 'zen',
    });
  });

  it('classifies uncached non-claude models as openai', () => {
    const result = mergeModels(['deepseek-v4-flash'], null, 'zen');
    expect(result[0]).toMatchObject({ modelFormat: 'openai' });
  });

  it('uses backendId for sourceBackend when no cache entry', () => {
    const result = mergeModels(['unknown-model'], null, 'go');
    expect(result[0]!.sourceBackend).toBe('go');
  });

  it('enriches models with cache data when available', () => {
    const cache = new Map<string, ModelInfo>([
      ['claude-sonnet-4-6', {
        id: 'claude-sonnet-4-6',
        name: 'Claude Sonnet 4.6',
        isFree: false,
        brand: 'Claude',
        sourceBackend: 'zen' as const,
        modelFormat: 'anthropic' as const,
        cost: { input: 3, output: 15 },
      }],
    ]);
    const result = mergeModels(['claude-sonnet-4-6'], cache, 'zen');
    expect(result[0]).toMatchObject({
      id: 'claude-sonnet-4-6',
      name: 'Claude Sonnet 4.6',
      modelFormat: 'anthropic',
      brand: 'Claude',
      sourceBackend: 'zen',
    });
  });

  it('preserves reasoning metadata from cache entries', () => {
    const cache = new Map<string, ModelInfo>([
      ['glm-5.2', {
        id: 'glm-5.2',
        name: 'GLM-5.2',
        isFree: false,
        brand: 'GLM',
        sourceBackend: 'go' as const,
        modelFormat: 'openai' as const,
        reasoning: true,
        interleavedReasoningField: 'reasoning_content',
      }],
    ]);
    const result = mergeModels(['glm-5.2'], cache, 'go');
    expect(result[0]).toMatchObject({
      id: 'glm-5.2',
      reasoning: true,
      interleavedReasoningField: 'reasoning_content',
    });
  });

  it('marks non-Anthropic models correctly from cache', () => {
    const cache = new Map<string, ModelInfo>([
      ['deepseek-v4-flash-free', {
        id: 'deepseek-v4-flash-free',
        name: 'DeepSeek V4 Flash Free',
        isFree: true,
        brand: 'DeepSeek',
        sourceBackend: 'zen' as const,
        modelFormat: 'openai' as const,
        cost: { input: 0, output: 0 },
      }],
    ]);
    const result = mergeModels(['deepseek-v4-flash-free'], cache, 'zen');
    expect(result[0]).toMatchObject({
      isFree: true,
      modelFormat: 'openai',
      sourceBackend: 'zen',
    });
  });

  it('filters out stale free models', () => {
    const result = mergeModels(['qwen3.6-plus-free', 'big-pickle'], null, 'zen');
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('big-pickle');
  });

  it('clamps anthropic format to openai for Go backend models', () => {
    const cache = new Map<string, ModelInfo>([
      ['minimax-m3', {
        id: 'minimax-m3', name: 'MiniMax M3', isFree: false, brand: 'MiniMax',
        sourceBackend: 'go' as const, modelFormat: 'anthropic' as const,
      }],
    ]);
    const result = mergeModels(['minimax-m3'], cache, 'go');
    expect(result[0]).toMatchObject({ id: 'minimax-m3', modelFormat: 'openai', sourceBackend: 'go' });
  });

  it('preserves anthropic format for Zen backend claude models', () => {
    const cache = new Map<string, ModelInfo>([
      ['claude-sonnet-4-6', {
        id: 'claude-sonnet-4-6', name: 'Claude Sonnet', isFree: false, brand: 'Claude',
        sourceBackend: 'zen' as const, modelFormat: 'anthropic' as const,
      }],
    ]);
    const result = mergeModels(['claude-sonnet-4-6'], cache, 'zen');
    expect(result[0]).toMatchObject({ modelFormat: 'anthropic', sourceBackend: 'zen' });
  });

  it('skips cache entries for models not in API list', () => {
    const cache = new Map<string, ModelInfo>([
      ['model-in-cache', {
        id: 'model-in-cache', name: 'X', isFree: false, brand: 'Other',
        sourceBackend: 'zen' as const, modelFormat: 'openai' as const,
      }],
    ]);
    const result = mergeModels(['model-from-api'], cache, 'zen');
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('model-from-api');
  });
});

describe('groupModels', () => {
  const makeModel = (
    id: string, isFree: boolean, brand: string,
    modelFormat: ModelInfo['modelFormat'] = 'openai', sourceBackend: 'zen' | 'go' = 'zen',
  ): ModelInfo => ({
    id, name: id, isFree, brand, sourceBackend, modelFormat,
  });

  it('separates free models from paid models', () => {
    const models = [
      makeModel('claude-sonnet', false, 'Claude', 'anthropic'),
      makeModel('deepseek-free', true, 'DeepSeek', 'openai'),
    ];
    const { free, byBrand } = groupModels(models);
    expect(free).toHaveLength(1);
    expect(free[0]!.id).toBe('deepseek-free');
    expect([...byBrand.keys()]).toContain('Claude');
    expect(byBrand.get('Claude')!).toHaveLength(1);
  });

  it('sorts free models alphabetically by id', () => {
    const models = [
      makeModel('z-free', true, 'Other'),
      makeModel('a-free', true, 'Other'),
      makeModel('m-free', true, 'Other'),
    ];
    const { free } = groupModels(models);
    expect(free.map(m => m.id)).toEqual(['a-free', 'm-free', 'z-free']);
  });

  it('sorts paid models alphabetically by id within each brand', () => {
    const models = [
      makeModel('claude-z', false, 'Claude', 'anthropic'),
      makeModel('claude-a', false, 'Claude', 'anthropic'),
    ];
    const { byBrand } = groupModels(models);
    const claudeModels = byBrand.get('Claude')!;
    expect(claudeModels.map(m => m.id)).toEqual(['claude-a', 'claude-z']);
  });

  it('returns empty free array and empty map when all models are paid', () => {
    const models = [makeModel('claude-opus', false, 'Claude', 'anthropic')];
    const { free, byBrand } = groupModels(models);
    expect(free).toHaveLength(0);
    expect(byBrand.size).toBe(1);
  });
});
