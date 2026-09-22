import { describe, it, expect } from 'vitest';
import { modelToCatalogEntry } from '../src/codex/catalog.js';
import type { LocalProviderModel } from '../src/types.js';

describe('codex catalog entry generation', () => {
  it('defaults input_modalities to [text, image] when model has no modalities field', () => {
    const model: LocalProviderModel = {
      id: 'gpt-5.5',
      name: 'GPT-5.5',
      family: 'gpt',
      brand: 'OpenAI',
      modelFormat: 'openai',
      upstreamModelId: 'gpt-5.5',
      contextWindow: 200000,
    };
    const entry = modelToCatalogEntry(model, 'OpenAI');
    expect(entry.input_modalities).toEqual(['text', 'image']);
  });

  it('honors explicit text-only modalities for models that do not support images', () => {
    const model: LocalProviderModel = {
      id: 'text-model',
      name: 'Text Model',
      family: 'text',
      brand: 'OpenAI',
      modelFormat: 'openai',
      upstreamModelId: 'text-model',
      contextWindow: 200000,
      modalities: ['text'],
    } as any;
    const entry = modelToCatalogEntry(model, 'OpenAI');
    expect(entry.input_modalities).toEqual(['text']);
  });

  it('uses provider metadata to expose OpenRouter reasoning controls', () => {
    const model: LocalProviderModel = {
      id: 'z-ai/glm-5.2',
      name: 'Z.ai: GLM 5.2',
      family: 'glm',
      brand: 'GLM',
      modelFormat: 'openai',
      upstreamModelId: 'z-ai/glm-5.2',
      contextWindow: 1048576,
      npm: '@openrouter/ai-sdk-provider',
      apiBaseUrl: 'https://openrouter.ai/api/v1',
      supportedParameters: ['tools', 'reasoning', 'include_reasoning'],
    };

    const entry = modelToCatalogEntry(model, 'OpenRouter');

    expect(entry.supported_reasoning_levels).toEqual([
      { effort: 'none', description: 'No reasoning' },
      { effort: 'minimal', description: 'Minimal reasoning' },
      { effort: 'low', description: 'Light reasoning' },
      { effort: 'medium', description: 'Balanced reasoning' },
      { effort: 'high', description: 'Deep reasoning' },
      { effort: 'xhigh', description: 'Maximum reasoning' },
    ]);
    expect(entry.default_reasoning_level).toBe('medium');
    expect(entry.supports_reasoning_summaries).toBe(false);
  });

  it('gives Command Code DeepSeek the effort ladder from the base URL alone', () => {
    const model: LocalProviderModel = {
      id: 'deepseek/deepseek-v4.1-flash',
      name: 'DeepSeek V4.1 Flash',
      family: 'deepseek',
      brand: 'DeepSeek',
      modelFormat: 'openai',
      upstreamModelId: 'deepseek/deepseek-v4.1-flash',
      npm: '@ai-sdk/openai-compatible',
      apiBaseUrl: 'https://api.commandcode.ai/provider/v1',
    };
    const entry = modelToCatalogEntry(model, 'Command Code');
    expect(entry.supported_reasoning_levels.map(level => level.effort)).toEqual([
      'low', 'medium', 'high', 'xhigh', 'none',
    ]);

    const kimi: LocalProviderModel = {
      ...model,
      id: 'moonshotai/Kimi-K3',
      name: 'Kimi K3',
      upstreamModelId: 'moonshotai/Kimi-K3',
    };
    const kimiEntry = modelToCatalogEntry(kimi, 'Command Code');
    expect(kimiEntry.supported_reasoning_levels.map(level => level.effort)).toEqual([
      'low', 'medium', 'high',
    ]);
  });
});
