import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isLikelyPlaceholderKey } from '../src/registry/refresh-credentials.js';
import { validateImportKey } from '../src/registry/validate-import-key.js';
import type { LocalProvider } from '../src/types.js';
import type { RegistryProvider } from '../src/registry/types.js';

vi.mock('../src/registry/fetch-template-models.js', () => ({
  fetchTemplateModels: vi.fn(),
}));
vi.mock('../src/registry/fetch-anthropic-models.js', () => ({
  fetchAnthropicModels: vi.fn(),
}));

import { fetchTemplateModels } from '../src/registry/fetch-template-models.js';
import { fetchAnthropicModels } from '../src/registry/fetch-anthropic-models.js';

const baseRegistry = (over: Partial<RegistryProvider>): RegistryProvider => ({
  id: 'groq',
  templateId: 'groq',
  name: 'Groq',
  enabled: true,
  authRef: 'keyring:provider:groq',
  api: { npm: '@ai-sdk/groq', url: 'https://api.groq.com/openai/v1' },
  addedAt: '2026-06-09T00:00:00.000Z',
  ...over,
});

const baseLocal = (over: Partial<LocalProvider>): LocalProvider => ({
  id: 'groq',
  name: 'Groq',
  apiKey: 'gsk_real_key_1234567890',
  models: [{
    id: 'llama',
    name: 'llama',
    family: 'llama',
    brand: 'Other',
    modelFormat: 'openai',
    upstreamModelId: 'llama',
    npm: '@ai-sdk/groq',
  }],
  ...over,
});

describe('isLikelyPlaceholderKey', () => {
  it('flags anything and single-char keys', () => {
    expect(isLikelyPlaceholderKey('anything')).toBe(true);
    expect(isLikelyPlaceholderKey('a')).toBe(true);
  });
});

describe('validateImportKey', () => {
  beforeEach(() => {
    vi.mocked(fetchTemplateModels).mockReset();
    vi.mocked(fetchAnthropicModels).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects OpenCode placeholder keys when API rejects them', async () => {
    vi.mocked(fetchAnthropicModels).mockResolvedValue({
      models: [],
      baseUrl: 'https://api.anthropic.com',
      error: 'API key was rejected.',
    });
    const result = await validateImportKey(
      baseLocal({ id: 'anthropic', apiKey: 'anything' }),
      baseRegistry({ id: 'anthropic', templateId: 'anthropic', api: { npm: '@ai-sdk/anthropic' } }),
    );
    expect(result.canImport).toBe(false);
    expect(result.reason).toBe('placeholder-key');
    expect(fetchAnthropicModels).toHaveBeenCalled();
  });

  it('does not import manual-only vertex', async () => {
    const result = await validateImportKey(
      baseLocal({ id: 'google-vertex', apiKey: 'a' }),
      baseRegistry({ id: 'google-vertex', templateId: 'google-vertex', api: { npm: '@ai-sdk/google-vertex' } }),
    );
    expect(result.canImport).toBe(false);
    expect(result.reason).toBe('untested-manual');
    expect(fetchAnthropicModels).not.toHaveBeenCalled();
    expect(fetchTemplateModels).not.toHaveBeenCalled();
  });

  it('imports anthropic when key probes successfully', async () => {
    vi.mocked(fetchAnthropicModels).mockResolvedValue({
      models: [{ id: 'claude', name: 'claude', upstreamModelId: 'claude', modelFormat: 'anthropic' }],
      baseUrl: 'https://api.anthropic.com',
    });
    const result = await validateImportKey(
      baseLocal({ id: 'anthropic', apiKey: 'sk-ant-api03-validlookingkey' }),
      baseRegistry({ id: 'anthropic', templateId: 'anthropic', api: { npm: '@ai-sdk/anthropic' } }),
    );
    expect(result.canImport).toBe(true);
    expect(fetchAnthropicModels).toHaveBeenCalled();
  });

  it('rejects anthropic when API rejects key', async () => {
    vi.mocked(fetchAnthropicModels).mockResolvedValue({
      models: [],
      baseUrl: 'https://api.anthropic.com',
      error: 'API key was rejected.',
    });
    const result = await validateImportKey(
      baseLocal({ id: 'anthropic', apiKey: 'sk-ant-api03-validlookingkey' }),
      baseRegistry({ id: 'anthropic', templateId: 'anthropic', api: { npm: '@ai-sdk/anthropic' } }),
    );
    expect(result.canImport).toBe(false);
    expect(result.reason).toBe('invalid-key');
  });

  it('imports openai-compatible providers when probe succeeds', async () => {
    vi.mocked(fetchTemplateModels).mockResolvedValue({
      models: [{ id: 'm', name: 'm', upstreamModelId: 'm', modelFormat: 'openai', npm: '@ai-sdk/groq' }],
      baseUrl: 'https://api.groq.com/openai/v1',
    });
    const result = await validateImportKey(baseLocal({}), baseRegistry({}));
    expect(result.canImport).toBe(true);
    expect(fetchTemplateModels).toHaveBeenCalled();
  });

  it('rejects restricted imported API URLs before probing provider APIs', async () => {
    const result = await validateImportKey(
      baseLocal({
        models: [{
          id: 'm',
          name: 'm',
          family: 'm',
          brand: 'Other',
          modelFormat: 'openai',
          upstreamModelId: 'm',
          npm: '@ai-sdk/openai-compatible',
          apiBaseUrl: 'https://169.254.169.254/v1',
        }],
      }),
      baseRegistry({
        api: { npm: '@ai-sdk/openai-compatible', url: 'https://169.254.169.254/v1' },
      }),
    );
    expect(result.canImport).toBe(false);
    expect(result.reason).toBe('invalid-key');
    expect(result.detail).toMatch(/restricted|private|blocked/i);
    expect(fetchTemplateModels).not.toHaveBeenCalled();
  });

  it('imports local servers when placeholder key still probes successfully', async () => {
    vi.mocked(fetchTemplateModels).mockResolvedValue({
      models: [{ id: 'llama3', name: 'llama3', upstreamModelId: 'llama3', modelFormat: 'openai', npm: '@ai-sdk/openai-compatible' }],
      baseUrl: 'http://127.0.0.1:11434/v1',
    });
    const result = await validateImportKey(
      baseLocal({
        id: 'ollama',
        apiKey: 'ollama',
        models: [{
          id: 'llama3',
          name: 'llama3',
          family: 'llama',
          brand: 'Other',
          modelFormat: 'openai',
          upstreamModelId: 'llama3',
          npm: '@ai-sdk/openai-compatible',
          apiBaseUrl: 'http://127.0.0.1:11434/v1',
        }],
      }),
      baseRegistry({
        id: 'ollama',
        templateId: 'ollama',
        api: { npm: '@ai-sdk/openai-compatible', url: 'http://127.0.0.1:11434/v1' },
      }),
    );
    expect(result.canImport).toBe(true);
    expect(fetchTemplateModels).toHaveBeenCalled();
  });

  it('allows OAuth providers without API probe', async () => {
    const result = await validateImportKey(
      baseLocal({ id: 'xai', apiKey: '' }),
      baseRegistry({ id: 'xai', templateId: 'xai', authType: 'oauth', authRef: 'keyring:oauth:provider:xai' }),
    );
    expect(result.canImport).toBe(true);
  });
});
