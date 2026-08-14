import { describe, expect, it, vi, beforeEach } from 'vitest';
import { refreshProviderModels } from '../src/registry/refresh-models.js';
import type { ProviderRegistry } from '../src/registry/types.js';

vi.mock('../src/registry/fetch-template-models.js', () => ({
  fetchTemplateModels: vi.fn(),
}));
vi.mock('../src/registry/fetch-anthropic-models.js', () => ({
  fetchAnthropicModels: vi.fn(),
}));
vi.mock('../src/registry/io.js', () => ({
  loadRegistry: vi.fn(() => ({ version: 1, providers: [] })),
  saveRegistry: vi.fn(),
}));

import { fetchTemplateModels } from '../src/registry/fetch-template-models.js';
import { fetchAnthropicModels } from '../src/registry/fetch-anthropic-models.js';
import { saveRegistry } from '../src/registry/io.js';
import * as urlSecurity from '../src/registry/url-security.js';

describe('refreshProviderModels', () => {
  beforeEach(() => {
    vi.mocked(fetchTemplateModels).mockReset();
    vi.mocked(saveRegistry).mockClear();
  });

  it('rejects restricted provider API URLs before refreshing models', async () => {
    const registry: ProviderRegistry = {
      version: 1,
      providers: [{
        id: 'bad',
        templateId: 'custom-openai',
        name: 'Bad',
        enabled: true,
        authRef: 'keyring:provider:bad',
        authType: 'api',
        api: { npm: '@ai-sdk/openai-compatible', url: 'https://169.254.169.254/v1' },
        addedAt: '2026-06-17T00:00:00.000Z',
      }],
    };

    const result = await refreshProviderModels('bad', 'sk-real-key', registry);

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/restricted|private|blocked/i);
    expect(fetchTemplateModels).not.toHaveBeenCalled();
    expect(saveRegistry).not.toHaveBeenCalled();
  });

  it('does not report an imported snapshot as a model-count change on first live refresh', async () => {
    const registry: ProviderRegistry = {
      version: 1,
      providers: [{
        id: 'groq',
        templateId: 'groq',
        name: 'Groq',
        enabled: true,
        authRef: 'keyring:provider:groq',
        authType: 'api',
        api: { npm: '@ai-sdk/groq', url: 'https://api.groq.com/openai/v1' },
        addedAt: '2026-06-18T00:00:00.000Z',
        modelsCache: {
          fetchedAt: '2026-06-18T00:00:00.000Z',
          models: [{
            id: 'imported-model',
            name: 'Imported model',
            upstreamModelId: 'imported-model',
            modelFormat: 'openai',
          }],
        },
      }],
    };
    vi.mocked(fetchTemplateModels).mockResolvedValue({
      baseUrl: 'https://api.groq.com/openai/v1',
      models: [{
        id: 'live-a',
        name: 'Live A',
        upstreamModelId: 'live-a',
        modelFormat: 'openai',
      }, {
        id: 'live-b',
        name: 'Live B',
        upstreamModelId: 'live-b',
        modelFormat: 'openai',
      }],
    });

    const first = await refreshProviderModels('groq', 'gsk-real-key', registry);
    const second = await refreshProviderModels('groq', 'gsk-real-key', registry);

    expect(first).toMatchObject({ ok: true, modelCount: 2 });
    expect(first.previousModelCount).toBeUndefined();
    expect(second).toMatchObject({ ok: true, modelCount: 2, previousModelCount: 2 });
  });

  it('refreshes a custom backend served over local http', async () => {
    // The user approved insecure HTTP when adding the backend, but that grant was
    // never persisted, so refresh re-validated with allowInsecureLocal:false and
    // every local custom backend failed with "Only HTTPS URLs are allowed".
    const spy = vi.spyOn(urlSecurity, 'validateCustomEndpointUrl');
    const registry: ProviderRegistry = {
      version: 1,
      providers: [{
        id: 'custom-olmx',
        templateId: 'custom-openai',
        name: 'olmx',
        enabled: true,
        authRef: 'keyring:provider:custom-olmx',
        authType: 'api',
        api: { npm: '@ai-sdk/openai-compatible', url: 'http://127.0.0.1:8000/v1' },
        addedAt: '2026-01-01T00:00:00.000Z',
      }],
    };
    vi.mocked(fetchTemplateModels).mockResolvedValue({
      models: [{ id: 'm1', name: 'm1', upstreamModelId: 'm1', modelFormat: 'openai' }],
      baseUrl: 'http://127.0.0.1:8000/v1',
    });

    const result = await refreshProviderModels('custom-olmx', 'sk-test', registry);

    expect(spy).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/v1',
      expect.objectContaining({ allowInsecureLocal: true }),
    );
    expect(result).toMatchObject({ ok: true, modelCount: 1 });
  });

  it('does not grant insecure http to a non-custom provider', async () => {
    const spy = vi.spyOn(urlSecurity, 'validateCustomEndpointUrl');
    const registry: ProviderRegistry = {
      version: 1,
      providers: [{
        id: 'groq',
        templateId: 'groq',
        name: 'Groq',
        enabled: true,
        authRef: 'keyring:provider:groq',
        authType: 'api',
        api: { npm: '@ai-sdk/openai-compatible', url: 'http://sneaky.internal/v1' },
        addedAt: '2026-01-01T00:00:00.000Z',
      }],
    };

    await refreshProviderModels('groq', 'sk-test', registry);

    expect(spy).toHaveBeenCalledWith(
      'http://sneaky.internal/v1',
      expect.objectContaining({ allowInsecureLocal: false }),
    );
  });

  it('forwards custom headers to fetchTemplateModels for an openai-kind custom backend', async () => {
    vi.spyOn(urlSecurity, 'validateCustomEndpointUrl').mockResolvedValue({
      ok: true,
      normalizedUrl: 'https://gw.example.com/v1',
    });
    const registry: ProviderRegistry = {
      version: 1,
      providers: [{
        id: 'custom-acme',
        templateId: 'custom-openai',
        name: 'Acme',
        enabled: true,
        authRef: 'keyring:provider:custom-acme',
        authType: 'api',
        api: {
          npm: '@ai-sdk/openai-compatible',
          url: 'https://gw.example.com/v1',
          headers: { 'X-Plan': 'coding' },
        },
        addedAt: '2026-01-01T00:00:00.000Z',
      }],
    };
    vi.mocked(fetchTemplateModels).mockResolvedValue({
      models: [{ id: 'm1', name: 'm1', upstreamModelId: 'm1', modelFormat: 'openai' }],
      baseUrl: 'https://gw.example.com/v1',
    });

    await refreshProviderModels('custom-acme', 'sk-test', registry);

    expect(fetchTemplateModels).toHaveBeenCalledWith(
      expect.anything(),
      'sk-test',
      'https://gw.example.com/v1',
      { 'X-Plan': 'coding' },
    );
  });

  it('forwards custom headers to fetchAnthropicModels for an anthropic-kind custom backend', async () => {
    vi.spyOn(urlSecurity, 'validateCustomEndpointUrl').mockResolvedValue({
      ok: true,
      normalizedUrl: 'https://claude-gw.example.com',
    });
    const registry: ProviderRegistry = {
      version: 1,
      providers: [{
        id: 'custom-claude-gw',
        templateId: 'custom-anthropic',
        name: 'Claude GW',
        enabled: true,
        authRef: 'keyring:provider:custom-claude-gw',
        authType: 'api',
        api: {
          npm: '@ai-sdk/anthropic',
          url: 'https://claude-gw.example.com',
          headers: { 'X-Plan': 'coding' },
        },
        addedAt: '2026-01-01T00:00:00.000Z',
      }],
    };
    vi.mocked(fetchAnthropicModels).mockResolvedValue({
      models: [{ id: 'claude-x', name: 'claude-x', upstreamModelId: 'claude-x', modelFormat: 'anthropic' }],
      baseUrl: 'https://claude-gw.example.com',
    });

    await refreshProviderModels('custom-claude-gw', 'sk-test', registry);

    expect(fetchAnthropicModels).toHaveBeenCalledWith(
      'https://claude-gw.example.com',
      'sk-test',
      { 'X-Plan': 'coding' },
    );
  });
});
