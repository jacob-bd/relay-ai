import { describe, expect, it } from 'vitest';
import {
  buildGlobalFavoriteIndex,
  filterGlobalFavoriteIndex,
  globalFavoritePickKey,
  globalFavoriteSelectOption,
} from '../src/favorites-picker.js';
import type { LocalProvider } from '../src/types.js';

const providers: LocalProvider[] = [
  {
    id: 'zen',
    name: 'OpenCode Zen',
    apiKey: '',
    models: [{
      id: 'deepseek-v4-flash-free',
      name: 'DeepSeek V4 Flash Free',
      family: 'DeepSeek',
      brand: 'DeepSeek',
      modelFormat: 'openai',
      upstreamModelId: 'deepseek-v4-flash-free',
      isFree: true,
    }],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    apiKey: 'k',
    models: [{
      id: 'deepseek-v4-flash',
      name: 'DeepSeek V4 Flash',
      family: 'DeepSeek',
      brand: 'DeepSeek',
      modelFormat: 'openai',
      upstreamModelId: 'deepseek-v4-flash',
    }],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    apiKey: 'k',
    models: [{
      id: 'deepseek/deepseek-v4-flash',
      name: 'DeepSeek V4 Flash',
      family: 'DeepSeek',
      brand: 'DeepSeek',
      modelFormat: 'openai',
      upstreamModelId: 'deepseek/deepseek-v4-flash',
    }],
  },
];

describe('buildGlobalFavoriteIndex', () => {
  it('includes every provider model with stable composite keys', () => {
    const index = buildGlobalFavoriteIndex(providers);
    expect(index).toHaveLength(3);
    expect(globalFavoritePickKey(index[0]!)).toBe('deepseek::deepseek-v4-flash');
    expect(globalFavoritePickKey(index[1]!)).toBe('zen::deepseek-v4-flash-free');
    expect(globalFavoritePickKey(index[2]!)).toBe('openrouter::deepseek/deepseek-v4-flash');
  });
});

describe('filterGlobalFavoriteIndex', () => {
  const index = buildGlobalFavoriteIndex(providers);

  it('matches model id, name, brand, and provider name', () => {
    expect(filterGlobalFavoriteIndex(index, 'deepseek').map(globalFavoritePickKey)).toEqual([
      'deepseek::deepseek-v4-flash',
      'zen::deepseek-v4-flash-free',
      'openrouter::deepseek/deepseek-v4-flash',
    ]);
    expect(filterGlobalFavoriteIndex(index, 'openrouter').map(e => e.providerId)).toEqual(['openrouter']);
    expect(filterGlobalFavoriteIndex(index, 'zen').map(e => e.providerId)).toEqual(['zen']);
  });

  it('returns empty for blank query', () => {
    expect(filterGlobalFavoriteIndex(index, '')).toEqual([]);
  });

  it('can browse free models with a blank free-only query', () => {
    expect(filterGlobalFavoriteIndex(index, '', { freeOnly: true }).map(globalFavoritePickKey)).toEqual([
      'zen::deepseek-v4-flash-free',
    ]);
  });

  it('filters search results to free models when requested', () => {
    expect(filterGlobalFavoriteIndex(index, 'deepseek', { freeOnly: true }).map(globalFavoritePickKey)).toEqual([
      'zen::deepseek-v4-flash-free',
    ]);
  });

  it('normalizes punctuation and ranks exact model names before provider aliases', () => {
    const glmProviders: LocalProvider[] = [
      {
        id: 'openrouter',
        name: 'OpenRouter',
        apiKey: 'k',
        models: [{
          id: 'z-ai/glm-5.2',
          name: 'z.ai: GLM 5.2',
          family: 'glm',
          brand: 'Z.ai',
          modelFormat: 'openai',
          upstreamModelId: 'z-ai/glm-5.2',
        }],
      },
      {
        id: 'go',
        name: 'OpenCode Go',
        apiKey: 'k',
        models: [{
          id: 'glm-5.2',
          name: 'GLM-5.2',
          family: 'glm',
          brand: 'Z.ai',
          modelFormat: 'openai',
          upstreamModelId: 'glm-5.2',
        }],
      },
      {
        id: 'zen',
        name: 'OpenCode Zen',
        apiKey: 'k',
        models: [{
          id: 'glm-5',
          name: 'GLM-5',
          family: 'glm',
          brand: 'Z.ai',
          modelFormat: 'openai',
          upstreamModelId: 'glm-5',
        }],
      },
    ];

    const result = filterGlobalFavoriteIndex(buildGlobalFavoriteIndex(glmProviders), 'glm 5.2');
    expect(result.map(globalFavoritePickKey)).toEqual([
      'go::glm-5.2',
      'openrouter::z-ai/glm-5.2',
    ]);
  });

  it('matches compact punctuation-free queries against separated model ids', () => {
    const result = filterGlobalFavoriteIndex(index, 'deepseek v4');
    expect(result.map(globalFavoritePickKey)).toEqual([
      'deepseek::deepseek-v4-flash',
      'zen::deepseek-v4-flash-free',
      'openrouter::deepseek/deepseek-v4-flash',
    ]);
  });
});

describe('globalFavoriteSelectOption', () => {
  const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '');

  it('puts a bright bracketed provider tag on the label', () => {
    const index = buildGlobalFavoriteIndex(providers);
    const zen = index.find(e => e.providerId === 'zen')!;
    const opt = globalFavoriteSelectOption(zen, []);
    expect(stripAnsi(opt.label)).toContain('(OpenCode Zen · free)');
    expect(opt.hint).toBe('');

    const deepseek = index.find(e => e.providerId === 'deepseek')!;
    expect(stripAnsi(globalFavoriteSelectOption(deepseek, []).label)).toContain('(DeepSeek)');
  });

  it('marks existing favorites in the hint', () => {
    const index = buildGlobalFavoriteIndex(providers);
    const zen = index.find(e => e.providerId === 'zen')!;
    const favorited = globalFavoriteSelectOption(zen, [{ providerId: 'zen', modelId: zen.model.id }]);
    expect(favorited.hint).toContain('already in favorites');
  });

  it('uses the Codex Sub-agents label when rendering that catalog', () => {
    const index = buildGlobalFavoriteIndex(providers);
    const zen = index.find(e => e.providerId === 'zen')!;
    const option = globalFavoriteSelectOption(zen, [{ providerId: 'zen', modelId: zen.model.id }], {
      listLabel: 'Codex Sub-agents',
    });
    expect(option.hint).toContain('already in Codex Sub-agents');
  });

  it('labels OAuth subscription providers explicitly in favorites search', () => {
    const oauthProviders: LocalProvider[] = [{
      id: 'antigravity',
      name: 'Cloud Code Assist OAuth (Google)',
      apiKey: 'tok',
      authType: 'oauth',
      models: [{
        id: 'gemini-3.5-flash-low',
        name: 'Gemini 3.5 Flash',
        family: 'gemini',
        brand: 'Google',
        modelFormat: 'cloud-code',
        upstreamModelId: 'gemini-3.5-flash-low',
      }],
    }, {
      id: 'claude-code',
      name: 'Claude Code (Anthropic subscription)',
      apiKey: 'tok',
      authType: 'oauth',
      models: [{
        id: 'claude-sonnet-4-6',
        name: 'Claude Sonnet 4.6',
        family: 'claude',
        brand: 'Anthropic',
        modelFormat: 'anthropic',
        upstreamModelId: 'claude-sonnet-4-6',
      }],
    }];

    const index = buildGlobalFavoriteIndex(oauthProviders);
    expect(index.map(e => e.providerName)).toEqual([
      'Claude Code OAuth (Anthropic subscription)',
      'Cloud Code Assist OAuth (Google)',
    ]);
    expect(filterGlobalFavoriteIndex(index, 'oauth').map(globalFavoritePickKey)).toEqual([
      'claude-code::claude-sonnet-4-6',
      'antigravity::gemini-3.5-flash-low',
    ]);
  });
});
