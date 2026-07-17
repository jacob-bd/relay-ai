import { describe, expect, it } from 'vitest';
import {
  buildHttpProxyRoutes,
  httpProxyModelId,
  supportsClaudeTransparentMode,
} from '../src/http-proxy/routes.js';
import type { LocalProvider } from '../src/types.js';

const providers: LocalProvider[] = [
  {
    id: 'moonshot',
    name: 'Moonshot',
    apiKey: 'moonshot-secret',
    models: [{
      id: 'kimi-k3',
      upstreamModelId: 'kimi-k3-upstream',
      name: 'Kimi K3',
      family: 'kimi',
      brand: 'Kimi',
      modelFormat: 'openai',
      npm: '@ai-sdk/openai-compatible',
      baseUrl: 'https://api.moonshot.example/v1',
      contextWindow: 1_000_000,
    }],
  },
  {
    id: 'groq',
    name: 'Groq',
    apiKey: 'groq-secret',
    models: [{
      id: 'llama-3.3-70b',
      upstreamModelId: 'llama-3.3-70b-versatile',
      name: 'Llama 3.3 70B',
      family: 'llama',
      brand: 'Meta',
      modelFormat: 'openai',
      npm: '@ai-sdk/groq',
    }],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    apiKey: 'anthropic-secret',
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

describe('transparent HTTP proxy routes', () => {
  it('adds a one-time selected model even when it is not a favorite', () => {
    const result = buildHttpProxyRoutes(
      providers,
      [{ providerId: 'groq', modelId: 'llama-3.3-70b' }],
      { providerId: 'moonshot', modelId: 'kimi-k3' },
    );

    expect(result.routes.map(route => route.aliasId)).toEqual([
      'relay:moonshot:kimi-k3[1m]',
      'relay:groq:llama-3.3-70b',
    ]);
    expect(result.routes[0]).toMatchObject({
      realModelId: 'kimi-k3-upstream',
      apiKey: 'moonshot-secret',
      providerId: 'moonshot',
    });
  });

  it('deduplicates the selected model when it is already a favorite', () => {
    const selected = { providerId: 'moonshot', modelId: 'kimi-k3' };
    const result = buildHttpProxyRoutes(providers, [selected], selected);
    expect(result.routes).toHaveLength(1);
  });

  it('never exposes unsupported, missing, or credential-less routes', () => {
    const withoutGroqKey = providers.map(provider =>
      provider.id === 'groq' ? { ...provider, apiKey: '' } : provider,
    );
    const result = buildHttpProxyRoutes(withoutGroqKey, [
      { providerId: 'anthropic', modelId: 'claude-sonnet-4-6' },
      { providerId: 'groq', modelId: 'llama-3.3-70b' },
      { providerId: 'missing', modelId: 'gone' },
    ]);

    expect(result.routes).toEqual([]);
    expect(result.unsupported).toEqual([
      { providerId: 'anthropic', modelId: 'claude-sonnet-4-6' },
    ]);
    expect(result.unavailable).toEqual([
      { providerId: 'groq', modelId: 'llama-3.3-70b' },
      { providerId: 'missing', modelId: 'gone' },
    ]);
  });

  it('creates an unambiguous provider-qualified Claude model name', () => {
    expect(httpProxyModelId('openrouter', 'deepseek/deepseek-v3'))
      .toBe('relay:openrouter:deepseek/deepseek-v3');
  });

  it('offers transparent mode only for SDK-translated models', () => {
    expect(supportsClaudeTransparentMode(providers[0]!.models[0]!)).toBe(true);
    expect(supportsClaudeTransparentMode(providers[2]!.models[0]!)).toBe(false);
  });
});
