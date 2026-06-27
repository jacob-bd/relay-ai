import { describe, expect, it } from 'vitest';
import { resolveAntigravityLaunchRoutes } from '../src/antigravity/launch-routes.js';
import type { FavoriteModel, LocalProvider } from '../src/types.js';

const providers: LocalProvider[] = [
  {
    id: 'zen',
    name: 'OpenCode Zen',
    apiKey: 'zen-key',
    models: [
      {
        id: 'mimo-v2.5-free',
        name: 'MiMo V2.5 Free',
        family: 'mimo',
        brand: 'MiMo',
        modelFormat: 'openai',
        upstreamModelId: 'mimo-v2.5-free',
        npm: '@ai-sdk/openai-compatible',
        contextWindow: 128000,
      },
    ],
  },
  {
    id: 'groq',
    name: 'Groq',
    apiKey: 'groq-key',
    models: [
      {
        id: 'llama-3.3-70b',
        name: 'Llama 3.3 70B',
        family: 'llama',
        brand: 'Meta',
        modelFormat: 'openai',
        upstreamModelId: 'llama-3.3-70b-versatile',
        npm: '@ai-sdk/openai-compatible',
        apiBaseUrl: 'https://api.groq.com/openai/v1',
        contextWindow: 32768,
      },
    ],
  },
  {
    id: 'missing-key',
    name: 'Missing Key',
    apiKey: '',
    models: [
      {
        id: 'available-but-no-key',
        name: 'Available But No Key',
        family: 'test',
        brand: 'Test',
        modelFormat: 'openai',
        upstreamModelId: 'available-but-no-key',
      },
    ],
  },
  {
    id: 'xai-oauth',
    name: 'xAI SuperGrok',
    apiKey: 'oauth-token',
    authType: 'oauth',
    oauthAccountId: 'acct-123',
    models: [
      {
        id: 'grok-4.3',
        name: 'Grok 4.3',
        family: 'grok',
        brand: 'xAI',
        modelFormat: 'openai',
        upstreamModelId: 'grok-4.3',
        npm: '@ai-sdk/xai',
        contextWindow: 256000,
      },
    ],
  },
  {
    id: 'xai',
    name: 'xAI API',
    apiKey: 'api-key',
    authType: 'api',
    models: [
      {
        id: 'grok-4.3',
        name: 'Grok 4.3',
        family: 'grok',
        brand: 'xAI',
        modelFormat: 'openai',
        upstreamModelId: 'grok-4.3',
        npm: '@ai-sdk/xai',
        contextWindow: 256000,
      },
    ],
  },
];

describe('antigravity launch routes', () => {
  it('builds launch model plus available favorites for model switching', async () => {
    const favorites: FavoriteModel[] = [
      { providerId: 'groq', modelId: 'llama-3.3-70b' },
      { providerId: 'zen', modelId: 'mimo-v2.5-free' },
      { providerId: 'missing-provider', modelId: 'ghost' },
      { providerId: 'missing-key', modelId: 'available-but-no-key' },
    ];

    const result = await resolveAntigravityLaunchRoutes({
      provider: providers[0]!,
      model: providers[0]!.models[0]!,
      allProviders: providers,
      favorites,
    });

    expect(result).not.toBeNull();
    expect(result!.apiKey).toBe('zen-key');
    expect(result!.routes.map(route => route.catalogId)).toEqual([
      'relay-ai__zen__mimo-v2.5-free',
      'relay-ai__groq__llama-3.3-70b',
    ]);
    expect(result!.routes[1]).toMatchObject({
      upstreamModelId: 'llama-3.3-70b-versatile',
      apiKey: 'groq-key',
      baseURL: 'https://api.groq.com/openai/v1',
    });
    expect(result!.droppedFavorites).toEqual([
      { providerId: 'missing-provider', modelId: 'ghost' },
      { providerId: 'missing-key', modelId: 'available-but-no-key' },
    ]);
    expect(result!.capacitySkippedFavorites).toEqual([]);
  });

  it('caps launch routes at the Antigravity catalog limit', async () => {
    const manyProviders: LocalProvider[] = [
      providers[0]!,
      ...Array.from({ length: 25 }, (_, i) => ({
        id: `provider-${i}`,
        name: `Provider ${i}`,
        apiKey: `key-${i}`,
        models: [{
          id: `model-${i}`,
          name: `Model ${i}`,
          family: 'test',
          brand: 'Test',
          modelFormat: 'openai' as const,
          upstreamModelId: `upstream-${i}`,
        }],
      })),
    ];
    const favorites = manyProviders.slice(1).map(provider => ({
      providerId: provider.id,
      modelId: provider.models[0]!.id,
    }));

    const result = await resolveAntigravityLaunchRoutes({
      provider: manyProviders[0]!,
      model: manyProviders[0]!.models[0]!,
      allProviders: manyProviders,
      favorites,
    });

    expect(result!.routes).toHaveLength(20);
    expect(result!.routes.at(-1)!.catalogId).toBe('relay-ai__provider-18__model-18');
    expect(result!.capacitySkippedFavorites).toEqual([
      { providerId: 'provider-19', modelId: 'model-19' },
      { providerId: 'provider-20', modelId: 'model-20' },
      { providerId: 'provider-21', modelId: 'model-21' },
      { providerId: 'provider-22', modelId: 'model-22' },
      { providerId: 'provider-23', modelId: 'model-23' },
      { providerId: 'provider-24', modelId: 'model-24' },
    ]);
  });

  it('reports capacity-skipped favorites when a smaller AGY slot cap is supplied', async () => {
    const result = await resolveAntigravityLaunchRoutes({
      provider: providers[0]!,
      model: providers[0]!.models[0]!,
      allProviders: providers,
      favorites: [
        { providerId: 'groq', modelId: 'llama-3.3-70b' },
        { providerId: 'xai-oauth', modelId: 'grok-4.3' },
        { providerId: 'xai', modelId: 'grok-4.3' },
      ],
      maxRoutes: 2,
    });

    expect(result!.routes.map(route => route.catalogId)).toEqual([
      'relay-ai__zen__mimo-v2.5-free',
      'relay-ai__groq__llama-3.3-70b',
    ]);
    expect(result!.capacitySkippedFavorites).toEqual([
      { providerId: 'xai-oauth', modelId: 'grok-4.3' },
      { providerId: 'xai', modelId: 'grok-4.3' },
    ]);
  });

  it('preserves auth identity for same-named OAuth and API-key favorites', async () => {
    const result = await resolveAntigravityLaunchRoutes({
      provider: providers[3]!,
      model: providers[3]!.models[0]!,
      allProviders: providers,
      favorites: [{ providerId: 'xai', modelId: 'grok-4.3' }],
    });

    expect(result).not.toBeNull();
    expect(result!.routes).toMatchObject([
      {
        catalogId: 'relay-ai__xai-oauth__grok-4.3',
        displayName: 'Grok 4.3 (Relay - xAI SuperGrok)',
        apiKey: 'oauth-token',
        authType: 'oauth',
        oauthAccountId: 'acct-123',
      },
      {
        catalogId: 'relay-ai__xai__grok-4.3',
        displayName: 'Grok 4.3 (Relay - xAI API)',
        apiKey: 'api-key',
        authType: 'api',
      },
    ]);
  });
});
