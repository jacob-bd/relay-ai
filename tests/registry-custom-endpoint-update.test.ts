import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateCustomEndpointProvider } from '../src/registry/custom-endpoint.js';
import * as env from '../src/env.js';
import * as io from '../src/registry/io.js';
import * as fetchTemplate from '../src/registry/fetch-template-models.js';
import * as fetchAnthropic from '../src/registry/fetch-anthropic-models.js';
import * as urlSecurity from '../src/registry/url-security.js';
import type { ProviderRegistry, RegistryProvider } from '../src/registry/types.js';

vi.mock('../src/env.js', () => ({
  saveProviderCredential: vi.fn(),
  readStoredProviderCredential: vi.fn(),
}));
vi.mock('../src/registry/io.js', () => ({ loadRegistry: vi.fn(), saveRegistry: vi.fn() }));
vi.mock('../src/registry/fetch-template-models.js', () => ({ fetchTemplateModels: vi.fn() }));
vi.mock('../src/registry/fetch-anthropic-models.js', () => ({ fetchAnthropicModels: vi.fn() }));
vi.mock('../src/registry/url-security.js', () => ({ validateCustomEndpointUrl: vi.fn() }));

function customProvider(over: Partial<RegistryProvider> = {}): RegistryProvider {
  return {
    id: 'custom-acme',
    templateId: 'custom-openai',
    name: 'Acme Gateway',
    enabled: true,
    authRef: 'keyring:provider:custom-acme',
    api: { npm: '@ai-sdk/openai-compatible', url: 'https://gw.example.com/v1' },
    addedAt: '2026-01-01T00:00:00.000Z',
    refreshedAt: '2026-01-01T00:00:00.000Z',
    modelsCache: {
      fetchedAt: '2026-01-01T00:00:00.000Z',
      models: [{ id: 'old', name: 'old', upstreamModelId: 'old', modelFormat: 'openai' }],
    },
    ...over,
  };
}

function registryWith(provider: RegistryProvider): ProviderRegistry {
  return { schemaVersion: 1, providers: [provider] };
}

describe('registry/custom-endpoint update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(env.saveProviderCredential).mockResolvedValue(true);
    vi.mocked(env.readStoredProviderCredential).mockResolvedValue('sk-stored');
    vi.mocked(urlSecurity.validateCustomEndpointUrl).mockImplementation(
      async (url: string) => ({ ok: true, normalizedUrl: url.replace(/\/$/, '') }),
    );
    vi.mocked(fetchTemplate.fetchTemplateModels).mockResolvedValue({
      models: [
        { id: 'new1', name: 'new1', upstreamModelId: 'new1', modelFormat: 'openai' },
        { id: 'new2', name: 'new2', upstreamModelId: 'new2', modelFormat: 'openai' },
      ],
      baseUrl: 'https://new.example.com/v1',
    });
  });

  it('renames without making any network call', async () => {
    const provider = customProvider();
    vi.mocked(io.loadRegistry).mockReturnValue(registryWith(provider));

    const result = await updateCustomEndpointProvider({
      providerId: 'custom-acme',
      displayName: 'Acme Prod',
    });

    expect(result.updated).toBe(true);
    expect(result.provider?.name).toBe('Acme Prod');
    expect(result.provider?.id).toBe('custom-acme');
    expect(fetchTemplate.fetchTemplateModels).not.toHaveBeenCalled();
    expect(fetchAnthropic.fetchAnthropicModels).not.toHaveBeenCalled();
    expect(env.saveProviderCredential).not.toHaveBeenCalled();
    expect(io.saveRegistry).toHaveBeenCalled();
  });

  it('treats a resubmitted identical URL as a name-only change', async () => {
    const provider = customProvider();
    vi.mocked(io.loadRegistry).mockReturnValue(registryWith(provider));

    await updateCustomEndpointProvider({
      providerId: 'custom-acme',
      displayName: 'Acme Prod',
      baseUrl: 'https://gw.example.com/v1',
    });

    expect(fetchTemplate.fetchTemplateModels).not.toHaveBeenCalled();
  });

  it('updates the URL and refreshes the model cache, keeping the id', async () => {
    const provider = customProvider();
    vi.mocked(io.loadRegistry).mockReturnValue(registryWith(provider));

    const result = await updateCustomEndpointProvider({
      providerId: 'custom-acme',
      baseUrl: 'https://new.example.com/v1',
    });

    expect(result.updated).toBe(true);
    expect(result.provider?.id).toBe('custom-acme');
    expect(result.provider?.api.url).toBe('https://new.example.com/v1');
    expect(result.provider?.modelsCache?.models.map(m => m.id)).toEqual(['new1', 'new2']);
    expect(result.modelCount).toBe(2);
    expect(result.modelsStale).toBeUndefined();
  });

  it('uses the stored key when no new key is supplied', async () => {
    vi.mocked(io.loadRegistry).mockReturnValue(registryWith(customProvider()));

    await updateCustomEndpointProvider({
      providerId: 'custom-acme',
      baseUrl: 'https://new.example.com/v1',
    });

    expect(fetchTemplate.fetchTemplateModels).toHaveBeenCalledWith(
      expect.anything(),
      'sk-stored',
      'https://new.example.com/v1',
      undefined,
    );
    expect(env.saveProviderCredential).not.toHaveBeenCalled();
  });

  it('saves a new key when one is supplied', async () => {
    vi.mocked(io.loadRegistry).mockReturnValue(registryWith(customProvider()));

    await updateCustomEndpointProvider({ providerId: 'custom-acme', apiKey: 'sk-new' });

    expect(env.saveProviderCredential).toHaveBeenCalledWith(
      'keyring:provider:custom-acme',
      'sk-new',
    );
  });

  it('replaces the whole header set and removes all headers on an empty set', async () => {
    const provider = customProvider({
      api: {
        npm: '@ai-sdk/openai-compatible',
        url: 'https://gw.example.com/v1',
        headers: { 'X-Plan': 'coding', 'X-Team': 'core' },
      },
    });
    vi.mocked(io.loadRegistry).mockReturnValue(registryWith(provider));

    const result = await updateCustomEndpointProvider({
      providerId: 'custom-acme',
      headers: {},
    });

    expect(result.updated).toBe(true);
    expect(result.provider?.api.headers).toBeUndefined();
  });

  it('forwards new headers to the fetcher', async () => {
    vi.mocked(io.loadRegistry).mockReturnValue(registryWith(customProvider()));

    await updateCustomEndpointProvider({
      providerId: 'custom-acme',
      headers: { 'X-Plan': 'max' },
    });

    expect(fetchTemplate.fetchTemplateModels).toHaveBeenCalledWith(
      expect.anything(),
      'sk-stored',
      'https://gw.example.com/v1',
      { 'X-Plan': 'max' },
    );
  });

  it('writes nothing when the connection test fails', async () => {
    vi.mocked(io.loadRegistry).mockReturnValue(registryWith(customProvider()));
    vi.mocked(fetchTemplate.fetchTemplateModels).mockResolvedValue({
      models: [],
      baseUrl: 'https://new.example.com/v1',
      error: 'API key was rejected.',
      hint: 'Check your key.',
    });

    const result = await updateCustomEndpointProvider({
      providerId: 'custom-acme',
      baseUrl: 'https://new.example.com/v1',
      apiKey: 'sk-bad',
    });

    expect(result.updated).toBe(false);
    expect(result.error).toBe('API key was rejected.');
    expect(result.hint).toBe('Check your key.');
    expect(result.canSaveAnyway).toBe(true);
    expect(io.saveRegistry).not.toHaveBeenCalled();
    expect(env.saveProviderCredential).not.toHaveBeenCalled();
  });

  it('never offers save-anyway for a refusal', async () => {
    const groq = customProvider({ id: 'groq', templateId: 'groq', name: 'Groq' });
    vi.mocked(io.loadRegistry).mockReturnValue(registryWith(groq));
    const refused = await updateCustomEndpointProvider({
      providerId: 'groq',
      displayName: 'Groq Fast',
    });
    expect(refused.canSaveAnyway).toBeUndefined();

    vi.mocked(io.loadRegistry).mockReturnValue(registryWith(customProvider()));
    vi.mocked(urlSecurity.validateCustomEndpointUrl).mockResolvedValue({
      ok: false,
      error: 'Private network addresses are not allowed.',
    });
    const blocked = await updateCustomEndpointProvider({
      providerId: 'custom-acme',
      baseUrl: 'http://192.168.1.5/v1',
    });
    expect(blocked.canSaveAnyway).toBeUndefined();
  });

  it('saveAnyway writes the config but preserves the old model cache', async () => {
    vi.mocked(io.loadRegistry).mockReturnValue(registryWith(customProvider()));
    vi.mocked(fetchTemplate.fetchTemplateModels).mockResolvedValue({
      models: [],
      baseUrl: 'https://new.example.com/v1',
      error: 'Could not reach the server.',
    });

    const result = await updateCustomEndpointProvider({
      providerId: 'custom-acme',
      baseUrl: 'https://new.example.com/v1',
      saveAnyway: true,
    });

    expect(result.updated).toBe(true);
    expect(result.modelsStale).toBe(true);
    expect(result.provider?.api.url).toBe('https://new.example.com/v1');
    expect(result.provider?.modelsCache?.models.map(m => m.id)).toEqual(['old']);
    expect(io.saveRegistry).toHaveBeenCalled();
  });

  it('saveAnyway repoints every cached model apiUrl at the new base URL', async () => {
    const provider = customProvider({
      modelsCache: {
        fetchedAt: '2026-01-01T00:00:00.000Z',
        models: [{
          id: 'old',
          name: 'old',
          upstreamModelId: 'old',
          modelFormat: 'openai',
          apiUrl: 'https://gw.example.com/v1',
        }],
      },
    });
    vi.mocked(io.loadRegistry).mockReturnValue(registryWith(provider));
    vi.mocked(fetchTemplate.fetchTemplateModels).mockResolvedValue({
      models: [],
      baseUrl: 'https://new.example.com/v1',
      error: 'Could not reach the server.',
    });

    const result = await updateCustomEndpointProvider({
      providerId: 'custom-acme',
      baseUrl: 'https://new.example.com/v1',
      saveAnyway: true,
    });

    // materialize.ts reads `cached.apiUrl ?? provider.api.url` — the per-model
    // value wins, so a stale one silently routes live traffic to the old host.
    expect(result.provider?.modelsCache?.models[0]?.apiUrl).toBe('https://new.example.com/v1');
  });

  it('strips /v1 from an anthropic base URL on the saveAnyway path', async () => {
    const provider = customProvider({
      templateId: 'custom-anthropic',
      api: { npm: '@ai-sdk/anthropic', url: 'https://claude-gw.example.com' },
    });
    vi.mocked(io.loadRegistry).mockReturnValue(registryWith(provider));
    vi.mocked(fetchAnthropic.fetchAnthropicModels).mockResolvedValue({
      models: [],
      baseUrl: 'https://claude-2.example.com',
      error: 'Could not reach the server.',
    });

    const result = await updateCustomEndpointProvider({
      providerId: 'custom-acme',
      baseUrl: 'https://claude-2.example.com/v1',
      saveAnyway: true,
    });

    // Storing the /v1 suffix makes the Anthropic SDK request /v1/v1/messages.
    expect(result.provider?.api.url).toBe('https://claude-2.example.com');
  });

  it('aborts before the registry write when the credential store fails', async () => {
    vi.mocked(io.loadRegistry).mockReturnValue(registryWith(customProvider()));
    vi.mocked(env.saveProviderCredential).mockResolvedValue(false);

    const result = await updateCustomEndpointProvider({
      providerId: 'custom-acme',
      apiKey: 'sk-new',
    });

    expect(result.updated).toBe(false);
    expect(io.saveRegistry).not.toHaveBeenCalled();
  });

  it('refuses a provider that is not a custom backend', async () => {
    const groq = customProvider({ id: 'groq', templateId: 'groq', name: 'Groq' });
    vi.mocked(io.loadRegistry).mockReturnValue(registryWith(groq));

    const result = await updateCustomEndpointProvider({
      providerId: 'groq',
      displayName: 'Groq Fast',
    });

    expect(result.updated).toBe(false);
    expect(result.error).toMatch(/only available for custom backends/i);
    expect(io.saveRegistry).not.toHaveBeenCalled();
  });

  it('refuses an unknown provider id', async () => {
    vi.mocked(io.loadRegistry).mockReturnValue(registryWith(customProvider()));

    const result = await updateCustomEndpointProvider({
      providerId: 'custom-nope',
      displayName: 'Nope',
    });

    expect(result.updated).toBe(false);
    expect(io.saveRegistry).not.toHaveBeenCalled();
  });

  it('writes nothing when the new URL fails validation', async () => {
    vi.mocked(io.loadRegistry).mockReturnValue(registryWith(customProvider()));
    vi.mocked(urlSecurity.validateCustomEndpointUrl).mockResolvedValue({
      ok: false,
      error: 'Private network addresses are not allowed.',
      hint: 'Use a public HTTPS URL.',
    });

    const result = await updateCustomEndpointProvider({
      providerId: 'custom-acme',
      baseUrl: 'http://192.168.1.5/v1',
    });

    expect(result.updated).toBe(false);
    expect(io.saveRegistry).not.toHaveBeenCalled();
  });

  it('uses the anthropic fetcher for an anthropic-kind backend', async () => {
    const provider = customProvider({
      templateId: 'custom-anthropic',
      api: { npm: '@ai-sdk/anthropic', url: 'https://claude-gw.example.com' },
    });
    vi.mocked(io.loadRegistry).mockReturnValue(registryWith(provider));
    vi.mocked(fetchAnthropic.fetchAnthropicModels).mockResolvedValue({
      models: [{ id: 'claude-x', name: 'claude-x', upstreamModelId: 'claude-x', modelFormat: 'anthropic' }],
      baseUrl: 'https://claude-2.example.com',
    });

    const result = await updateCustomEndpointProvider({
      providerId: 'custom-acme',
      baseUrl: 'https://claude-2.example.com',
    });

    expect(result.updated).toBe(true);
    expect(fetchAnthropic.fetchAnthropicModels).toHaveBeenCalled();
    expect(result.provider?.modelsCache?.models[0]?.modelFormat).toBe('anthropic');
  });

  it('reports an error when nothing was actually changed', async () => {
    vi.mocked(io.loadRegistry).mockReturnValue(registryWith(customProvider()));

    const result = await updateCustomEndpointProvider({ providerId: 'custom-acme' });

    expect(result.updated).toBe(false);
    expect(result.error).toMatch(/nothing to change/i);
    expect(io.saveRegistry).not.toHaveBeenCalled();
  });
});
