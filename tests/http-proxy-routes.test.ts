import { describe, expect, it } from 'vitest';
import { buildHttpProxyRoutes, httpProxyModelId } from '../src/http-proxy/routes.js';
import type { LocalProvider } from '../src/types.js';

const providers: LocalProvider[] = [
  {
    id: 'groq',
    name: 'Groq Cloud',
    apiKey: 'groq-key',
    models: [{
      id: 'llama-3.3-70b',
      upstreamModelId: 'llama-3.3-70b-versatile',
      name: 'Llama 3.3 70B',
      family: 'llama',
      brand: 'Meta',
      modelFormat: 'openai',
      npm: '@ai-sdk/groq',
      contextWindow: 1_000_000,
    }],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    apiKey: 'anthropic-key',
    models: [{
      id: 'claude-sonnet-4-6',
      upstreamModelId: 'claude-sonnet-4-6',
      name: 'Claude Sonnet 4.6',
      family: 'claude',
      brand: 'Claude',
      modelFormat: 'anthropic',
      npm: '@ai-sdk/anthropic',
      baseUrl: 'https://api.anthropic.com',
    }],
  },
];

describe('HTTP proxy routes', () => {
  it('uses stable provider-prefixed names and includes only AI SDK favorites', () => {
    const result = buildHttpProxyRoutes(providers, [
      { providerId: 'groq', modelId: 'llama-3.3-70b' },
      { providerId: 'anthropic', modelId: 'claude-sonnet-4-6' },
      { providerId: 'missing', modelId: 'gone' },
    ]);

    expect(result.routes).toHaveLength(1);
    expect(result.routes[0]).toMatchObject({
      aliasId: 'relay:groq:llama-3.3-70b[1m]',
      realModelId: 'llama-3.3-70b-versatile',
      npm: '@ai-sdk/groq',
      apiKey: 'groq-key',
    });
    expect(result.unsupported).toEqual([{ providerId: 'anthropic', modelId: 'claude-sonnet-4-6' }]);
    expect(result.unavailable).toEqual([{ providerId: 'missing', modelId: 'gone' }]);
  });

  it('does not create a route when the provider credential is empty', () => {
    const noKey = [{ ...providers[0]!, apiKey: '' }];
    const result = buildHttpProxyRoutes(noKey, [{ providerId: 'groq', modelId: 'llama-3.3-70b' }]);
    expect(result.routes).toEqual([]);
    expect(result.unavailable).toHaveLength(1);
  });

  it('formats the exact freeform Claude model id', () => {
    expect(httpProxyModelId('openrouter', 'deepseek/deepseek-v3')).toBe('relay:openrouter:deepseek/deepseek-v3');
  });
});
