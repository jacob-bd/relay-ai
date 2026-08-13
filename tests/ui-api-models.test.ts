import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockRequest, createMockResponse } from './helpers/ui-api-test-utils.js';

const state = vi.hoisted(() => ({
  catalog: [] as any[],
  registry: { schemaVersion: 1, providers: [] as any[] },
}));

vi.mock('../src/provider-catalog.js', () => ({
  fetchProviderCatalog: vi.fn(async () => state.catalog),
}));

vi.mock('../src/registry/io.js', () => ({
  loadRegistry: vi.fn(() => state.registry),
}));

async function call(method: string, url: string, opts?: { uiMode?: 'full' | 'server' }) {
  const { handleUiApiRequest } = await import('../src/ui/api.js');
  const req = createMockRequest(method, url);
  const response = createMockResponse();
  handleUiApiRequest(req, response.res, opts);
  await vi.waitFor(() => expect(response.result.data).not.toBe(''));
  return { code: response.result.code, body: JSON.parse(response.result.data) };
}

describe('GET /api/models appId filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.registry = { schemaVersion: 1, providers: [] };
    state.catalog = [{
      id: 'cloudflare-workers-ai',
      name: 'Cloudflare Workers AI',
      authType: 'api',
      apiKey: 'cf-key',
      models: [
        {
          id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
          name: 'Llama 3.3 70B FP8 Fast',
          modelFormat: 'openai',
          upstreamModelId: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
          npm: '@ai-sdk/openai-compatible',
          contextWindow: 24000,
        },
        {
          id: '@cf/google/gemma-4-26b-a4b-it',
          name: 'Gemma 4 26B',
          modelFormat: 'openai',
          upstreamModelId: '@cf/google/gemma-4-26b-a4b-it',
          npm: '@ai-sdk/openai-compatible',
          contextWindow: 256000,
        },
      ],
    }];
  });

  it('returns every model when no appId is given', async () => {
    const result = await call('GET', '/api/models');
    expect(result.body.providers[0].models).toHaveLength(2);
  });

  it('drops models below the context floor for a known app id', async () => {
    const result = await call('GET', '/api/models?appId=claude');
    const ids = result.body.providers[0].models.map((m: any) => m.id);
    expect(ids).toEqual(['@cf/google/gemma-4-26b-a4b-it']);
  });

  it('applies the stricter Antigravity floor for agy/antigravity app ids', async () => {
    for (const appId of ['agy', 'antigravity', 'antigravity-ide']) {
      const result = await call('GET', `/api/models?appId=${appId}`);
      const ids = result.body.providers[0].models.map((m: any) => m.id);
      expect(ids, appId).toEqual(['@cf/google/gemma-4-26b-a4b-it']);
    }
  });

  it('ignores an unknown appId and returns the unfiltered catalog', async () => {
    const result = await call('GET', '/api/models?appId=not-a-real-app');
    expect(result.body.providers[0].models).toHaveLength(2);
  });
});

describe('GET /api/models Antigravity OAuth visibility', () => {
  const antigravity = {
    id: 'antigravity',
    name: 'Antigravity (Google Cloud Code Assist)',
    authType: 'oauth' as const,
    apiKey: 'agy-token',
    models: [{
      id: 'gemini-3.6-flash-low',
      name: 'Gemini 3.6 Flash (Low)',
      modelFormat: 'cloud-code',
      upstreamModelId: 'gemini-3.6-flash-low',
      contextWindow: 1048576,
    }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    state.catalog = [antigravity];
    state.registry = {
      schemaVersion: 1,
      providers: [{
        id: 'antigravity',
        templateId: 'antigravity',
        name: antigravity.name,
        enabled: true,
        authRef: 'keyring:oauth:provider:antigravity',
        authType: 'oauth',
        api: {},
        modelsCache: { fetchedAt: '2026-08-13T00:00:00.000Z', models: antigravity.models },
      }],
    };
  });

  it('shows a configured Antigravity OAuth provider in the local UI catalog', async () => {
    const result = await call('GET', '/api/models');
    expect(result.body.providers.map((p: { id: string }) => p.id)).toContain('antigravity');
    expect(result.body.providers.find((p: { id: string }) => p.id === 'antigravity').models.map((m: { id: string }) => m.id))
      .toEqual(['gemini-3.6-flash-low']);
  });

  it('keeps Antigravity OAuth off the Docker/server admin UI catalog', async () => {
    const result = await call('GET', '/api/models', { uiMode: 'server' });
    expect(result.body.providers.map((p: { id: string }) => p.id)).not.toContain('antigravity');
  });
});
