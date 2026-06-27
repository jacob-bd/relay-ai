import { describe, it, expect } from 'vitest';
import {
  buildFavoritesCodexCatalog,
  buildFavoritesAppCatalog,
  codexCliFavoritesSlug,
  defaultReasoningEffortForFavorite,
} from '../src/codex/favorites-catalog.js';
import type { ResolvedFavorite } from '../src/favorites-resolver.js';
import type { LocalProviderModel } from '../src/types.js';

const anthropicModel: LocalProviderModel = {
  id: 'claude-sonnet-4.5',
  name: 'Claude Sonnet 4.5',
  family: 'claude',
  brand: 'Anthropic',
  modelFormat: 'anthropic',
  upstreamModelId: 'claude-sonnet-4-5-20250929',
  baseUrl: 'https://api.anthropic.com',
  contextWindow: 200000,
};

const openaiModel: LocalProviderModel = {
  id: 'gpt-5.5',
  name: 'GPT-5.5',
  family: 'gpt',
  brand: 'OpenAI',
  modelFormat: 'openai',
  upstreamModelId: 'gpt-5.5',
  contextWindow: 200000,
};

describe('buildFavoritesCodexCatalog', () => {
  it('places starting first, then favorites, with cross-provider slugs', () => {
    const starting: ResolvedFavorite = {
      providerId: 'anthropic',
      providerName: 'Anthropic',
      model: anthropicModel,
      apiKey: 'k',
    };
    const resolved: ResolvedFavorite[] = [
      { providerId: 'openai', providerName: 'OpenAI', model: openaiModel, apiKey: 'k' },
    ];

    const file = buildFavoritesCodexCatalog(starting, resolved);

    expect(file.models).toHaveLength(2);
    expect(file.models[0]?.slug).toBe('anthropic__claude-sonnet-4.5');
    expect(file.models[0]?.priority).toBe(0);
    expect(file.models[0]?.display_name).toBe('Claude Sonnet 4.5');
    expect(file.models[1]?.slug).toBe('openai__gpt-5.5');
    expect(file.models[1]?.priority).toBe(1);
    expect(file.models[1]?.display_name).toBe('GPT-5.5');
  });

  it('uses CLI form of truncation_policy (tokens, limit: context)', () => {
    const starting: ResolvedFavorite = {
      providerId: 'anthropic',
      providerName: 'Anthropic',
      model: anthropicModel,
      apiKey: 'k',
    };
    const file = buildFavoritesCodexCatalog(starting, []);
    expect(file.models[0]?.truncation_policy).toEqual({ mode: 'tokens', limit: 200000 });
  });

  it('uses none effort for OpenCode models without native reasoning', () => {
    const mimo: LocalProviderModel = {
      id: 'mimo-v2.5-free',
      name: 'MiMo V2.5 Free',
      family: 'mimo',
      brand: 'MiMo',
      modelFormat: 'openai',
      contextWindow: 128000,
    };
    const starting: ResolvedFavorite = {
      providerId: 'zen',
      providerName: 'OpenCode Zen',
      model: mimo,
      apiKey: 'k',
    };
    const file = buildFavoritesCodexCatalog(starting, []);
    expect(file.models[0]?.slug).toBe('zen__mimo-v2.5-free');
    expect(file.models[0]?.supported_reasoning_levels).toEqual([
      { effort: 'none', description: 'No reasoning' },
    ]);
    expect(file.models[0]?.default_reasoning_level).toBe('none');
    expect(defaultReasoningEffortForFavorite(starting)).toBe('none');
  });

  it('exposes DeepSeek reasoning levels for Zen favorites without npm', () => {
    const deepseek: LocalProviderModel = {
      id: 'deepseek-v4-flash-free',
      name: 'DeepSeek V4 Flash Free',
      family: 'deepseek',
      brand: 'DeepSeek',
      modelFormat: 'openai',
      contextWindow: 128000,
    };
    const starting: ResolvedFavorite = {
      providerId: 'zen',
      providerName: 'OpenCode Zen',
      model: deepseek,
      apiKey: 'k',
    };
    const file = buildFavoritesCodexCatalog(starting, []);
    expect(file.models[0]?.slug).toBe('zen__deepseek-v4-flash-free');
    expect(file.models[0]?.supported_reasoning_levels.length).toBeGreaterThan(0);
    expect(file.models[0]?.default_reasoning_level).toBe('high');
    expect(defaultReasoningEffortForFavorite(starting)).toBe('high');
  });

  it('exposes GLM-5.2 reasoning levels for Go favorites', () => {
    const glm: LocalProviderModel = {
      id: 'glm-5.2',
      name: 'GLM-5.2',
      family: 'glm',
      brand: 'GLM',
      modelFormat: 'openai',
      upstreamModelId: 'glm-5.2',
      contextWindow: 1_000_000,
      npm: '@ai-sdk/openai-compatible',
      apiBaseUrl: 'https://opencode.ai/zen/go/v1',
      reasoning: true,
      interleavedReasoningField: 'reasoning_content',
    };
    const starting: ResolvedFavorite = {
      providerId: 'go',
      providerName: 'OpenCode Go',
      model: glm,
      apiKey: 'k',
    };
    const file = buildFavoritesCodexCatalog(starting, []);

    expect(file.models[0]?.slug).toBe('go__glm-5.2');
    expect(file.models[0]?.supported_reasoning_levels).toEqual([
      { effort: 'high', description: 'Deep reasoning' },
      { effort: 'xhigh', description: 'Maximum reasoning' },
    ]);
    expect(file.models[0]?.default_reasoning_level).toBe('high');
    expect(defaultReasoningEffortForFavorite(starting)).toBe('high');
  });

  it('builds stable cross-provider CLI slugs', () => {
    expect(codexCliFavoritesSlug('zen', 'mimo-v2.5-free')).toBe('zen__mimo-v2.5-free');
    expect(codexCliFavoritesSlug('go', 'qwen3.7-plus')).toBe('go__qwen3.7-plus');
  });
});

describe('buildFavoritesAppCatalog', () => {
  it('uses provider-qualified slugs and bytes truncation', () => {
    const resolved: ResolvedFavorite[] = [
      { providerId: 'anthropic', providerName: 'Anthropic', model: anthropicModel, apiKey: 'k' },
    ];
    const file = buildFavoritesAppCatalog(resolved);
    expect(file.models[0]?.slug).toBe('anthropic__claude-sonnet-4.5');
    expect(file.models[0]?.truncation_policy).toEqual({ mode: 'bytes', limit: 10_000 });
  });

  it('cross-provider favorites get unique provider-qualified slugs', () => {
    const resolved: ResolvedFavorite[] = [
      { providerId: 'anthropic', providerName: 'Anthropic', model: anthropicModel, apiKey: 'k' },
      { providerId: 'openai', providerName: 'OpenAI', model: openaiModel, apiKey: 'k' },
    ];
    const file = buildFavoritesAppCatalog(resolved);
    expect(file.models).toHaveLength(2);
    expect(file.models[0]?.slug).toBe('anthropic__claude-sonnet-4.5');
    expect(file.models[1]?.slug).toBe('openai__gpt-5.5');
  });
});
