// tests/catalog.test.ts
import { describe, it, expect } from 'vitest';
import { MAX_MODEL_CATALOG } from '../src/constants.js';
import { buildCatalogRoutes, localModelToRoute, makeRouteResolver } from '../src/catalog.js';
import type { ModelInfo } from '../src/types.js';
import type { FavoriteModel, LocalProvider } from '../src/types.js';

describe('buildCatalogRoutes', () => {
  const starting = {
    aliasId: 'claude-sonnet-4',
    realModelId: 'claude-sonnet-4',
    displayName: 'Sonnet (Groq)',
    upstreamUrl: 'https://api.groq.com',
    apiKey: 'k',
    modelFormat: 'openai' as const,
  };

  const resolve = (providerId: string, modelId: string) =>
    providerId === 'groq' && modelId === 'llama-3.3-70b'
      ? { ...starting, aliasId: 'anthropic-groq__llama-3.3-70b', realModelId: modelId }
      : undefined;

  it('dedupes starting model and caps catalog size', () => {
    const favorites: FavoriteModel[] = [
      { providerId: 'groq', modelId: 'llama-3.3-70b' },
      { providerId: 'zen', modelId: 'claude-sonnet-4' },
    ];
    const { routes, droppedFavorites } = buildCatalogRoutes(starting, favorites, resolve, MAX_MODEL_CATALOG);
    expect(routes[0]).toEqual(starting);
    expect(routes).toHaveLength(2);
    expect(droppedFavorites).toEqual([{ providerId: 'zen', modelId: 'claude-sonnet-4' }]);
  });
});

describe('makeRouteResolver zen/go routes', () => {
  const goModel: ModelInfo = {
    id: 'kimi-k2.7-code',
    name: 'Kimi K2.7 Code',
    isFree: false,
    brand: 'Kimi',
    sourceBackend: 'go',
    modelFormat: 'openai',
    contextWindow: 262144,
  };

  it('resolves OpenCode Go models via zenGoModelToRoute', () => {
    const provider = {
      id: 'go',
      name: 'OpenCode Go',
      apiKey: '',
      models: [{
        id: goModel.id,
        name: goModel.name,
        family: 'Kimi',
        brand: goModel.brand,
        modelFormat: 'openai' as const,
        upstreamModelId: goModel.id,
        contextWindow: goModel.contextWindow,
      }],
    };
    const resolveRoute = makeRouteResolver(null, [], [goModel], 'oc-key');
    expect(resolveRoute('go', goModel.id)).toMatchObject({
      realModelId: 'kimi-k2.7-code',
      apiKey: 'oc-key',
      npm: '@ai-sdk/openai-compatible',
      baseURL: 'https://opencode.ai/zen/go/v1',
    });
    expect(localModelToRoute(provider, provider.models[0]!)).toBeNull();
  });
});

describe('localModelToRoute', () => {
  it('uses upstreamModelId for SDK calls while keeping catalog id as alias', () => {
    const provider: LocalProvider = {
      id: 'openai',
      name: 'OpenAI',
      apiKey: 'sk-test',
      models: [{
        id: 'gpt-5.5-fast',
        name: 'GPT-5.5 Fast',
        family: 'gpt',
        brand: 'GPT',
        modelFormat: 'openai',
        upstreamModelId: 'gpt-5.5',
        completionsUrl: 'https://api.openai.com/v1/chat/completions',
        npm: '@ai-sdk/openai',
      }],
    };
    const route = localModelToRoute(provider, provider.models[0]!);
    expect(route).toMatchObject({
      aliasId: 'anthropic-openai__gpt-5.5-fast[1m]',
      realModelId: 'gpt-5.5',
    });
  });

  it('preserves OAuth provider data for catalog routes', () => {
    const provider: LocalProvider = {
      id: 'antigravity',
      name: 'Antigravity',
      apiKey: 'oauth-token',
      authType: 'oauth',
      providerData: { projectId: 'project-123', tier: 'free-tier' },
      models: [{
        id: 'gemini-3.5-flash-high',
        name: 'Gemini 3.5 Flash High',
        family: 'gemini',
        brand: 'Google',
        modelFormat: 'cloud-code',
        upstreamModelId: 'gemini-3.5-flash-high',
      }],
    };
    const route = localModelToRoute(provider, provider.models[0]!);
    expect(route).toMatchObject({
      aliasId: 'anthropic-antigravity__gemini-3.5-flash-high[1m]',
      modelFormat: 'cloud-code',
      upstreamUrl: 'https://daily-cloudcode-pa.googleapis.com',
      providerData: { projectId: 'project-123', tier: 'free-tier' },
    });
  });

  it('returns null when routing fields are missing for non-SDK openai models', () => {
    const provider: LocalProvider = {
      id: 'p',
      name: 'P',
      apiKey: 'k',
      models: [{
        id: 'm',
        name: 'M',
        family: '',
        brand: 'Other',
        modelFormat: 'openai',
        upstreamModelId: 'm',
      }],
    };
    expect(localModelToRoute(provider, provider.models[0]!)).toBeNull();
  });

  it('builds SDK routes without completionsUrl when npm is set', () => {
    const provider: LocalProvider = {
      id: 'cerebras',
      name: 'Cerebras',
      apiKey: 'sk-test',
      models: [{
        id: 'llama-3.3-70b',
        name: 'Llama 3.3 70B',
        family: 'llama',
        brand: 'Other',
        modelFormat: 'openai',
        upstreamModelId: 'llama-3.3-70b',
        npm: '@ai-sdk/cerebras',
      }],
    };
    const route = localModelToRoute(provider, provider.models[0]!);
    expect(route).toMatchObject({
      aliasId: 'anthropic-cerebras__llama-3.3-70b',
      realModelId: 'llama-3.3-70b',
      npm: '@ai-sdk/cerebras',
      upstreamUrl: '',
    });
  });
});
