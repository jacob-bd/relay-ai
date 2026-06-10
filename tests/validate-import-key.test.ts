import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isLikelyPlaceholderKey } from '../src/registry/refresh-credentials.js';
import { validateImportKey } from '../src/registry/validate-import-key.js';
import type { LocalProvider } from '../src/types.js';
import type { RegistryProvider } from '../src/registry/types.js';

vi.mock('../src/registry/fetch-template-models.js', () => ({
  fetchTemplateModels: vi.fn(),
}));
vi.mock('../src/registry/custom-endpoint.js', () => ({
  fetchAnthropicModels: vi.fn(),
}));

import { fetchTemplateModels } from '../src/registry/fetch-template-models.js';
import { fetchAnthropicModels } from '../src/registry/custom-endpoint.js';

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

  it('rejects OpenCode placeholder keys without calling API', async () => {
    const result = await validateImportKey(
      baseLocal({ id: 'anthropic', apiKey: 'anything' }),
      baseRegistry({ id: 'anthropic', templateId: 'anthropic', api: { npm: '@ai-sdk/anthropic' } }),
    );
    expect(result.shouldSaveKey).toBe(false);
    expect(result.reason).toBe('placeholder-key');
    expect(fetchAnthropicModels).not.toHaveBeenCalled();
  });

  it('skips key save for manual-only vertex', async () => {
    const result = await validateImportKey(
      baseLocal({ id: 'google-vertex', apiKey: 'a' }),
      baseRegistry({ id: 'google-vertex', templateId: 'google-vertex', api: { npm: '@ai-sdk/google-vertex' } }),
    );
    expect(result.shouldSaveKey).toBe(false);
    expect(result.reason).toBe('untested-manual');
    expect(fetchAnthropicModels).not.toHaveBeenCalled();
  });

  it('probes anthropic when key looks real', async () => {
    vi.mocked(fetchAnthropicModels).mockResolvedValue({ models: [{ id: 'claude', name: 'claude', upstreamModelId: 'claude', modelFormat: 'anthropic' }], baseUrl: 'https://api.anthropic.com' });
    const result = await validateImportKey(
      baseLocal({ id: 'anthropic', apiKey: 'sk-ant-api03-validlookingkey' }),
      baseRegistry({ id: 'anthropic', templateId: 'anthropic', api: { npm: '@ai-sdk/anthropic' } }),
    );
    expect(result.shouldSaveKey).toBe(true);
    expect(fetchAnthropicModels).toHaveBeenCalled();
  });

  it('rejects anthropic when API rejects key', async () => {
    vi.mocked(fetchAnthropicModels).mockResolvedValue({ models: [], baseUrl: 'https://api.anthropic.com', error: 'API key was rejected.' });
    const result = await validateImportKey(
      baseLocal({ id: 'anthropic', apiKey: 'sk-ant-api03-validlookingkey' }),
      baseRegistry({ id: 'anthropic', templateId: 'anthropic', api: { npm: '@ai-sdk/anthropic' } }),
    );
    expect(result.shouldSaveKey).toBe(false);
    expect(result.reason).toBe('invalid-key');
  });

  it('probes openai-compatible providers', async () => {
    vi.mocked(fetchTemplateModels).mockResolvedValue({ models: [{ id: 'm', name: 'm', upstreamModelId: 'm', modelFormat: 'openai', npm: '@ai-sdk/groq' }], baseUrl: 'https://api.groq.com/openai/v1' });
    const result = await validateImportKey(baseLocal({}), baseRegistry({}));
    expect(result.shouldSaveKey).toBe(true);
    expect(fetchTemplateModels).toHaveBeenCalled();
  });
});
