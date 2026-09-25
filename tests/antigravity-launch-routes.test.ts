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
        contextWindow: 200000,
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
  {
    id: 'antigravity',
    name: 'Cloud Code Assist',
    apiKey: 'cloud-code-token',
    authType: 'oauth',
    oauthAccountId: 'user@example.com',
    providerData: { projectId: 'cloud-project-123' },
    models: [
      {
        id: 'gemini-3.5-flash-extra-low',
        name: 'Gemini 3.5 Flash (Low)',
        family: 'gemini',
        brand: 'Google',
        modelFormat: 'cloud-code',
        upstreamModelId: 'gemini-3.5-flash-extra-low',
        contextWindow: 1000000,
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
      'relay-ai__zen__mimo-v2_5-free',
      'relay-ai__groq__llama-3_3-70b',
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

  it('drops favorites below the Antigravity context floor', async () => {
    const smallProvider: LocalProvider = {
      id: 'cloudflare-workers-ai',
      name: 'Cloudflare Workers AI',
      apiKey: 'cf-key',
      models: [{
        id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
        name: 'Llama 3.3 70B FP8 Fast',
        family: 'llama',
        brand: 'Meta',
        modelFormat: 'openai' as const,
        upstreamModelId: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
        npm: '@ai-sdk/openai-compatible',
        contextWindow: 24000,
      }],
    };

    const result = await resolveAntigravityLaunchRoutes({
      provider: providers[0]!,
      model: providers[0]!.models[0]!,
      allProviders: [...providers, smallProvider],
      favorites: [{
        providerId: 'cloudflare-workers-ai',
        modelId: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      }],
    });

    expect(result!.routes.map(route => route.providerId)).toEqual(['zen']);
    expect(result!.droppedFavorites).toEqual([{
      providerId: 'cloudflare-workers-ai',
      modelId: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    }]);
  });

  it('caps launch routes at the Antigravity catalog limit', async () => {
    const manyProviders: LocalProvider[] = [
      providers[0]!,
      ...Array.from({ length: 60 }, (_, i) => ({
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

    expect(result!.routes).toHaveLength(50);
    expect(result!.routes.at(-1)!.catalogId).toBe('relay-ai__provider-48__model-48');
    expect(result!.capacitySkippedFavorites).toEqual(
      Array.from({ length: 11 }, (_, i) => ({ providerId: `provider-${i + 49}`, modelId: `model-${i + 49}` })),
    );
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
      'relay-ai__zen__mimo-v2_5-free',
      'relay-ai__groq__llama-3_3-70b',
    ]);
    expect(result!.capacitySkippedFavorites).toEqual([
      { providerId: 'xai-oauth', modelId: 'grok-4.3' },
      { providerId: 'xai', modelId: 'grok-4.3' },
    ]);
  });

  it('classifies invalid favorites after the cap as dropped, not capacity-skipped', async () => {
    const invalidFavorite = { providerId: 'missing-provider', modelId: 'ghost' };

    const result = await resolveAntigravityLaunchRoutes({
      provider: providers[0]!,
      model: providers[0]!.models[0]!,
      allProviders: providers,
      favorites: [
        invalidFavorite,
        { providerId: 'groq', modelId: 'llama-3.3-70b' },
      ],
      maxRoutes: 1,
    });

    expect(result!.routes.map(route => route.catalogId)).toEqual([
      'relay-ai__zen__mimo-v2_5-free',
    ]);
    expect(result!.droppedFavorites).toContainEqual(invalidFavorite);
    expect(result!.capacitySkippedFavorites).not.toContainEqual(invalidFavorite);
    expect(result!.capacitySkippedFavorites).toContainEqual({
      providerId: 'groq',
      modelId: 'llama-3.3-70b',
    });
  });

  it('preserves auth identity for same-named OAuth and API-key favorites across effort variants', async () => {
    const result = await resolveAntigravityLaunchRoutes({
      provider: providers[3]!,
      model: providers[3]!.models[0]!,
      allProviders: providers,
      favorites: [{ providerId: 'xai', modelId: 'grok-4.3' }],
    });

    expect(result).not.toBeNull();
    expect(result!.routes).toMatchObject([
      {
        catalogId: 'relay-ai__xai-oauth__grok-4_3__effort_low',
        displayName: 'Grok 4.3 Low (Relay - xAI SuperGrok)',
        reasoningEffort: 'low',
        apiKey: 'oauth-token',
        authType: 'oauth',
        oauthAccountId: 'acct-123',
      },
      {
        catalogId: 'relay-ai__xai-oauth__grok-4_3__effort_high',
        displayName: 'Grok 4.3 High (Relay - xAI SuperGrok)',
        reasoningEffort: 'high',
        apiKey: 'oauth-token',
        authType: 'oauth',
      },
      {
        catalogId: 'relay-ai__xai__grok-4_3__effort_low',
        displayName: 'Grok 4.3 Low (Relay - xAI API)',
        reasoningEffort: 'low',
        apiKey: 'api-key',
        authType: 'api',
      },
      {
        catalogId: 'relay-ai__xai__grok-4_3__effort_high',
        displayName: 'Grok 4.3 High (Relay - xAI API)',
        reasoningEffort: 'high',
        apiKey: 'api-key',
        authType: 'api',
      },
    ]);
  });

  it('reports favorites that effort variants push past the cap', async () => {
    const gpt = (id: string) => ({
      id,
      name: id,
      family: 'gpt',
      brand: 'GPT',
      modelFormat: 'openai' as const,
      npm: '@ai-sdk/openai',
      upstreamModelId: id,
      reasoning: true,
      reasoningEffortLevels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    });
    const openai: LocalProvider = {
      id: 'openai',
      name: 'OpenAI',
      apiKey: 'sk-test',
      models: [gpt('gpt-a'), gpt('gpt-b'), gpt('gpt-c'), gpt('gpt-d')],
    };

    const result = await resolveAntigravityLaunchRoutes({
      provider: openai,
      model: openai.models[0]!,
      allProviders: [openai],
      favorites: ['gpt-b', 'gpt-c', 'gpt-d'].map(modelId => ({ providerId: 'openai', modelId })),
      maxRoutes: 10,
    });

    // 6 levels for the launch model + 3 for gpt-b + 1 of gpt-c's 3 = 10; gpt-d never fits.
    expect(result!.routes).toHaveLength(10);
    expect(result!.routes.map(route => route.modelId)).not.toContain('gpt-d');
    expect(result!.capacitySkippedFavorites).toEqual([{ providerId: 'openai', modelId: 'gpt-d' }]);
  });

  it('preserves Cloud Code Assist Cloud Code route metadata', async () => {
    const result = await resolveAntigravityLaunchRoutes({
      provider: providers[5]!,
      model: providers[5]!.models[0]!,
      allProviders: providers,
      favorites: [],
    });

    expect(result).not.toBeNull();
    expect(result!.routes[0]).toMatchObject({
      catalogId: 'relay-ai__antigravity__gemini-3_5-flash-extra-low',
      providerId: 'antigravity',
      modelFormat: 'cloud-code',
      upstreamModelId: 'gemini-3.5-flash-extra-low',
      apiKey: 'cloud-code-token',
      authType: 'oauth',
      oauthAccountId: 'user@example.com',
      providerData: { projectId: 'cloud-project-123' },
    });
  });
});
