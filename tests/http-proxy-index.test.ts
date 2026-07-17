import { describe, expect, it, vi } from 'vitest';
import { resolveHttpProxyRoutes } from '../src/http-proxy/index.js';
import type { LocalProvider } from '../src/types.js';

function provider(id: string, modelId: string): LocalProvider {
  return {
    id,
    name: id,
    apiKey: '',
    models: [{
      id: modelId,
      upstreamModelId: modelId,
      name: modelId,
      family: 'test',
      brand: 'test',
      modelFormat: 'openai',
      npm: '@ai-sdk/openai-compatible',
      apiBaseUrl: `https://${id}.example/v1`,
    }],
  };
}

describe('transparent HTTP proxy route loading', () => {
  it('resolves credentials only for the selected model and favorites', async () => {
    const resolveCredential = vi.fn(async (item: LocalProvider) => `${item.id}-secret`);
    const result = await resolveHttpProxyRoutes(
      [
        provider('moonshot', 'kimi-k3'),
        provider('groq', 'llama'),
        provider('unselected', 'private-model'),
      ],
      [{ providerId: 'groq', modelId: 'llama' }],
      { providerId: 'moonshot', modelId: 'kimi-k3' },
      resolveCredential,
    );

    expect(resolveCredential.mock.calls.map(([item]) => item.id)).toEqual(['moonshot', 'groq']);
    expect(result.routes.map(route => route.apiKey)).toEqual(['moonshot-secret', 'groq-secret']);
    expect(result.routes.some(route => route.providerId === 'unselected')).toBe(false);
  });
});
