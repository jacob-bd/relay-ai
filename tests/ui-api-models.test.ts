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

async function call(method: string, url: string) {
  const { handleUiApiRequest } = await import('../src/ui/api.js');
  const req = createMockRequest(method, url);
  const response = createMockResponse();
  handleUiApiRequest(req, response.res);
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
