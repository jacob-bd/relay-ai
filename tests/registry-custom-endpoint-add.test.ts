import { describe, it, expect, vi, beforeEach } from 'vitest';
import { addCustomEndpointProvider } from '../src/registry/custom-endpoint.js';
import * as env from '../src/env.js';
import * as io from '../src/registry/io.js';
import * as fetchTemplate from '../src/registry/fetch-template-models.js';
import * as urlSecurity from '../src/registry/url-security.js';
import type { ProviderRegistry } from '../src/registry/types.js';

import * as fetchAnthropic from '../src/registry/fetch-anthropic-models.js';

vi.mock('../src/env.js', () => ({
  saveProviderCredential: vi.fn(),
  readStoredProviderCredential: vi.fn(),
}));
vi.mock('../src/registry/io.js', () => ({ loadRegistry: vi.fn(), saveRegistry: vi.fn() }));
vi.mock('../src/registry/fetch-template-models.js', () => ({ fetchTemplateModels: vi.fn() }));
vi.mock('../src/registry/fetch-anthropic-models.js', () => ({ fetchAnthropicModels: vi.fn() }));
vi.mock('../src/registry/url-security.js', () => ({ validateCustomEndpointUrl: vi.fn() }));

const emptyRegistry = (): ProviderRegistry => ({ schemaVersion: 1, providers: [] });

describe('registry/custom-endpoint add', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(io.loadRegistry).mockReturnValue(emptyRegistry());
    vi.mocked(env.saveProviderCredential).mockResolvedValue(true);
    vi.mocked(env.readStoredProviderCredential).mockResolvedValue(null);
    vi.mocked(urlSecurity.validateCustomEndpointUrl).mockResolvedValue({
      ok: true,
      normalizedUrl: 'https://gw.example.com/v1',
    });
    vi.mocked(fetchTemplate.fetchTemplateModels).mockResolvedValue({
      models: [{ id: 'm1', name: 'm1', upstreamModelId: 'm1', modelFormat: 'openai' }],
      baseUrl: 'https://gw.example.com/v1',
    });
  });

  it('adds an openai-kind provider with a derived id and stores its key', async () => {
    const result = await addCustomEndpointProvider({
      displayName: 'Acme Gateway',
      baseUrl: 'https://gw.example.com/v1',
      apiKey: 'sk-one',
      kind: 'openai',
    });

    expect(result.added).toBe(true);
    expect(result.provider?.id).toBe('custom-acme-gateway');
    expect(result.provider?.templateId).toBe('custom-openai');
    expect(env.saveProviderCredential).toHaveBeenCalledWith(
      'keyring:provider:custom-acme-gateway',
      'sk-one',
    );
    expect(io.saveRegistry).toHaveBeenCalled();
  });

  it('suffixes the id when the derived id is already taken', async () => {
    vi.mocked(io.loadRegistry).mockReturnValue({
      schemaVersion: 1,
      providers: [{
        id: 'custom-acme-gateway',
        templateId: 'custom-openai',
        name: 'Acme Gateway',
        enabled: true,
        authRef: 'keyring:provider:custom-acme-gateway',
        api: { npm: '@ai-sdk/openai-compatible', url: 'https://other.example.com/v1' },
        addedAt: '2026-01-01T00:00:00.000Z',
      }],
    });

    const result = await addCustomEndpointProvider({
      displayName: 'Acme Gateway',
      baseUrl: 'https://gw.example.com/v1',
      apiKey: 'sk-two',
      kind: 'openai',
    });

    expect(result.provider?.id).toBe('custom-acme-gateway-2');
  });

  it('passes headers to the fetcher and stores them on the entry', async () => {
    const result = await addCustomEndpointProvider({
      displayName: 'Acme Gateway',
      baseUrl: 'https://gw.example.com/v1',
      apiKey: 'sk-one',
      kind: 'openai',
      headers: { 'X-Plan': 'coding' },
    });

    expect(fetchTemplate.fetchTemplateModels).toHaveBeenCalledWith(
      expect.anything(),
      'sk-one',
      'https://gw.example.com/v1',
      { 'X-Plan': 'coding' },
    );
    expect(result.provider?.api.headers).toEqual({ 'X-Plan': 'coding' });
  });

  it('uses the anthropic fetcher for anthropic kind', async () => {
    vi.mocked(fetchAnthropic.fetchAnthropicModels).mockResolvedValue({
      models: [{ id: 'claude-x', name: 'claude-x', upstreamModelId: 'claude-x', modelFormat: 'anthropic' }],
      baseUrl: 'https://claude-gw.example.com',
    });
    vi.mocked(urlSecurity.validateCustomEndpointUrl).mockResolvedValue({
      ok: true,
      normalizedUrl: 'https://claude-gw.example.com',
    });

    const result = await addCustomEndpointProvider({
      displayName: 'Claude GW',
      baseUrl: 'https://claude-gw.example.com',
      apiKey: 'sk-c',
      kind: 'anthropic',
    });

    expect(result.added).toBe(true);
    expect(result.provider?.templateId).toBe('custom-anthropic');
    expect(result.provider?.api.npm).toBe('@ai-sdk/anthropic');
  });

  it('writes nothing when the fetch returns no models', async () => {
    vi.mocked(fetchTemplate.fetchTemplateModels).mockResolvedValue({
      models: [],
      baseUrl: 'https://gw.example.com/v1',
      error: 'API key was rejected.',
    });

    const result = await addCustomEndpointProvider({
      displayName: 'Acme Gateway',
      baseUrl: 'https://gw.example.com/v1',
      apiKey: 'bad',
      kind: 'openai',
    });

    expect(result.added).toBe(false);
    expect(io.saveRegistry).not.toHaveBeenCalled();
    expect(env.saveProviderCredential).not.toHaveBeenCalled();
  });

  it('writes nothing when URL validation fails', async () => {
    vi.mocked(urlSecurity.validateCustomEndpointUrl).mockResolvedValue({
      ok: false,
      error: 'Private network addresses are not allowed.',
      hint: 'Use a public HTTPS URL.',
    });

    const result = await addCustomEndpointProvider({
      displayName: 'Acme Gateway',
      baseUrl: 'http://192.168.1.5/v1',
      apiKey: 'sk-one',
      kind: 'openai',
    });

    expect(result.added).toBe(false);
    expect(io.saveRegistry).not.toHaveBeenCalled();
  });
});

describe('duplicate detection', () => {
  const existing = {
    id: 'custom-acme-gateway',
    templateId: 'custom-openai' as const,
    name: 'Acme Gateway',
    enabled: true,
    authRef: 'keyring:provider:custom-acme-gateway',
    api: {
      npm: '@ai-sdk/openai-compatible',
      url: 'https://gw.example.com/v1',
      headers: { 'X-Plan': 'coding' },
    },
    addedAt: '2026-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    vi.mocked(io.loadRegistry).mockReturnValue({ schemaVersion: 1, providers: [existing] });
    vi.mocked(env.readStoredProviderCredential).mockResolvedValue('sk-same');
    vi.mocked(env.saveProviderCredential).mockResolvedValue(true);
    vi.mocked(urlSecurity.validateCustomEndpointUrl).mockResolvedValue({
      ok: true,
      normalizedUrl: 'https://gw.example.com/v1',
    });
    vi.mocked(fetchTemplate.fetchTemplateModels).mockResolvedValue({
      models: [{ id: 'm1', name: 'm1', upstreamModelId: 'm1', modelFormat: 'openai' }],
      baseUrl: 'https://gw.example.com/v1',
    });
  });

  it('flags an exact url + key + headers match without writing', async () => {
    const result = await addCustomEndpointProvider({
      displayName: 'Acme Again',
      baseUrl: 'https://gw.example.com/v1',
      apiKey: 'sk-same',
      kind: 'openai',
      headers: { 'X-Plan': 'coding' },
    });

    expect(result.added).toBe(false);
    expect(result.duplicateOf).toBe('custom-acme-gateway');
    expect(io.saveRegistry).not.toHaveBeenCalled();
    expect(fetchTemplate.fetchTemplateModels).not.toHaveBeenCalled();
  });

  it('does not flag the same url with a different key', async () => {
    const result = await addCustomEndpointProvider({
      displayName: 'Acme Personal',
      baseUrl: 'https://gw.example.com/v1',
      apiKey: 'sk-different',
      kind: 'openai',
      headers: { 'X-Plan': 'coding' },
    });

    expect(result.duplicateOf).toBeUndefined();
    expect(result.added).toBe(true);
  });

  it('does not flag the same url with different headers', async () => {
    const result = await addCustomEndpointProvider({
      displayName: 'Acme Team B',
      baseUrl: 'https://gw.example.com/v1',
      apiKey: 'sk-same',
      kind: 'openai',
      headers: { 'X-Plan': 'max' },
    });

    expect(result.duplicateOf).toBeUndefined();
    expect(result.added).toBe(true);
  });

  it('matches an anthropic duplicate despite the stored /v1 difference', async () => {
    vi.mocked(io.loadRegistry).mockReturnValue({
      schemaVersion: 1,
      providers: [{
        ...existing,
        id: 'custom-claude-gw',
        templateId: 'custom-anthropic' as const,
        authRef: 'keyring:provider:custom-claude-gw',
        // fetchAnthropicModels strips /v1 before the entry is written
        api: { npm: '@ai-sdk/anthropic', url: 'https://claude-gw.example.com' },
      }],
    });
    vi.mocked(urlSecurity.validateCustomEndpointUrl).mockResolvedValue({
      ok: true,
      normalizedUrl: 'https://claude-gw.example.com/v1',
    });

    const result = await addCustomEndpointProvider({
      displayName: 'Claude GW Again',
      baseUrl: 'https://claude-gw.example.com/v1',
      apiKey: 'sk-same',
      kind: 'anthropic',
    });

    expect(result.duplicateOf).toBe('custom-claude-gw');
  });

  it('proceeds past an exact match when confirmDuplicate is set', async () => {
    const result = await addCustomEndpointProvider({
      displayName: 'Acme Again',
      baseUrl: 'https://gw.example.com/v1',
      apiKey: 'sk-same',
      kind: 'openai',
      headers: { 'X-Plan': 'coding' },
      confirmDuplicate: true,
    });

    expect(result.added).toBe(true);
    expect(result.provider?.id).toBe('custom-acme-again');
  });
});
