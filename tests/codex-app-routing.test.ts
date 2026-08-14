import { describe, it, expect, vi } from 'vitest';
import { startProxyCatalog } from '../src/proxy.js';
import { buildCodexAppProviderCatalogRoutes } from '../src/codex/app-provider-routes.js';
import { buildCodexProxyRoutesForProvider } from '../src/codex/routing.js';
import type { LocalProvider } from '../src/types.js';

vi.mock('../src/proxy.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/proxy.js')>();
  return {
    ...actual,
    startProxyCatalog: vi.fn().mockResolvedValue({
      port: 49000,
      token: 'backend-token',
      close: vi.fn(),
    }),
  };
});

describe('buildCodexProxyRoutesForProvider', () => {
  it('includes all routable models', () => {
    const provider: LocalProvider = {
      id: 'anthropic',
      name: 'Anthropic',
      apiKey: 'k',
      models: [
        {
          id: 'claude-sonnet-4-6',
          name: 'Sonnet',
          family: 'claude',
          brand: 'Anthropic',
          modelFormat: 'anthropic',
          upstreamModelId: 'claude-sonnet-4-6',
        },
        {
          id: 'claude-haiku-4-5',
          name: 'Haiku',
          family: 'claude',
          brand: 'Anthropic',
          modelFormat: 'anthropic',
          upstreamModelId: 'claude-haiku-4-5',
        },
      ],
    };
    const routes = buildCodexProxyRoutesForProvider(provider, 'sk-test');
    expect(routes).toHaveLength(2);
    expect(routes.map(r => r.modelId).sort()).toEqual(['claude-haiku-4-5', 'claude-sonnet-4-6']);
  });

  it('puts selected model first in route list', () => {
    const provider: LocalProvider = {
      id: 'anthropic',
      name: 'Anthropic',
      apiKey: 'k',
      models: [
        {
          id: 'claude-fable-5',
          name: 'Fable',
          family: 'claude',
          brand: 'Anthropic',
          modelFormat: 'anthropic',
          upstreamModelId: 'claude-fable-5',
        },
        {
          id: 'claude-haiku-4-5',
          name: 'Haiku',
          family: 'claude',
          brand: 'Anthropic',
          modelFormat: 'anthropic',
          upstreamModelId: 'claude-haiku-4-5',
        },
      ],
    };
    const routes = buildCodexProxyRoutesForProvider(provider, 'sk-test', 'claude-haiku-4-5');
    expect(routes[0]!.modelId).toBe('claude-haiku-4-5');
  });
});

describe('buildCodexAppProviderCatalogRoutes', () => {
  it('rewrites every cloud-code model in the Codex App provider catalog, not only the launch model', async () => {
    const provider: LocalProvider = {
      id: 'antigravity',
      name: 'Cloud Code Assist',
      apiKey: 'agy-token',
      authType: 'oauth',
      providerData: { projectId: 'p1' },
      models: [
        {
          id: 'gemini-3.5-flash-low',
          name: 'Launch',
          family: 'gemini',
          brand: 'Google',
          modelFormat: 'cloud-code',
          upstreamModelId: 'gemini-3.5-flash-low',
          contextWindow: 1000000,
        },
        {
          id: 'gemini-3.5-flash-extra-low',
          name: 'Switch',
          family: 'gemini',
          brand: 'Google',
          modelFormat: 'cloud-code',
          upstreamModelId: 'gemini-3.5-flash-extra-low',
          contextWindow: 1000000,
        },
      ],
    };

    const { routes, selectedRoute, backend, catalogModels } = await buildCodexAppProviderCatalogRoutes(
      provider,
      'agy-token',
      'gemini-3.5-flash-low',
      false,
    );

    expect(startProxyCatalog).toHaveBeenCalledOnce();
    expect(backend).toMatchObject({ port: 49000, token: 'backend-token' });
    expect(selectedRoute.modelId).toContain('gemini-3.5-flash-low');
    expect(routes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        modelId: expect.stringContaining('gemini-3.5-flash-low'),
        baseURL: 'http://127.0.0.1:49000',
        apiKey: 'backend-token',
        upstreamModelId: expect.stringContaining('gemini-3.5-flash-low'),
      }),
      expect.objectContaining({
        modelId: expect.stringContaining('gemini-3.5-flash-extra-low'),
        baseURL: 'http://127.0.0.1:49000',
        apiKey: 'backend-token',
        upstreamModelId: expect.stringContaining('gemini-3.5-flash-extra-low'),
      }),
    ]));
    expect(catalogModels.map(model => model.id)).toEqual([
      expect.stringContaining('gemini-3.5-flash-low'),
      expect.stringContaining('gemini-3.5-flash-extra-low'),
    ]);
    expect(catalogModels.every(model => model.id.startsWith('anthropic-antigravity__'))).toBe(true);
  });

  it('keeps selected regular models first even when backend routes are present', async () => {
    const provider: LocalProvider = {
      id: 'mixed',
      name: 'Mixed',
      apiKey: 'mixed-token',
      authType: 'api',
      models: [
        {
          id: 'cloud-model',
          name: 'Cloud',
          family: 'gemini',
          brand: 'Google',
          modelFormat: 'cloud-code',
          upstreamModelId: 'cloud-upstream',
        },
        {
          id: 'regular-model',
          name: 'Regular',
          family: 'gpt',
          brand: 'OpenAI',
          modelFormat: 'openai',
          upstreamModelId: 'regular-upstream',
          npm: '@ai-sdk/openai',
        },
      ],
    };

    const { routes, selectedRoute } = await buildCodexAppProviderCatalogRoutes(
      provider,
      'mixed-token',
      'regular-model',
      false,
    );

    expect(selectedRoute.modelId).toBe('regular-model');
    expect(routes[0]!.modelId).toBe('regular-model');
  });
});
