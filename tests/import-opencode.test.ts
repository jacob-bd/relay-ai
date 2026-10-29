import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LocalProvider } from '../src/types.js';
import type { RegistryProvider } from '../src/registry/types.js';

vi.mock('../src/opencode-serve.js', () => ({
  fetchRawOpencodeProviders: vi.fn(),
}));
vi.mock('../src/registry/io.js', () => ({
  loadRegistry: vi.fn(),
  saveRegistry: vi.fn(),
}));
vi.mock('../src/env.js', () => ({
  resolveProviderCredential: vi.fn(),
  saveProviderCredential: vi.fn(),
}));
vi.mock('../src/registry/opencode-auth.js', () => ({
  readOpencodeAuthFile: vi.fn(() => ({ entries: {} })),
  oauthCredentialToKeychainJson: vi.fn(),
}));
vi.mock('../src/registry/validate-import-key.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/registry/validate-import-key.js')>();
  return {
    ...actual,
    validateImportKey: vi.fn(),
  };
});

import { fetchRawOpencodeProviders } from '../src/opencode-serve.js';
import { loadRegistry, saveRegistry } from '../src/registry/io.js';
import { saveProviderCredential } from '../src/env.js';
import { importFromOpencode } from '../src/registry/import-opencode.js';
import { validateImportKey } from '../src/registry/validate-import-key.js';
import { goRegistryStub, zenRegistryStub } from '../src/registry/builtins.js';

const groqLocal: LocalProvider = {
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
    apiBaseUrl: 'https://api.groq.com/openai/v1',
  }],
};

describe('importFromOpencode', () => {
  beforeEach(() => {
    vi.mocked(loadRegistry).mockReturnValue({ version: 1, providers: [] });
    vi.mocked(saveRegistry).mockImplementation(() => {});
    vi.mocked(saveProviderCredential).mockResolvedValue(true);
    vi.mocked(fetchRawOpencodeProviders).mockResolvedValue([{
      id: 'groq',
      name: 'Groq',
      key: 'gsk_real_key_1234567890',
      models: {
        llama: {
          id: 'llama',
          name: 'llama',
          api: { npm: '@ai-sdk/groq', url: 'https://api.groq.com/openai/v1' },
        },
      },
    }]);
  });

  it('does not add provider when key validation fails', async () => {
    vi.mocked(validateImportKey).mockResolvedValue({
      canImport: false,
      reason: 'placeholder-key',
      detail: 'OpenCode has a placeholder key — API rejected it; provider not imported.',
    });

    const result = await importFromOpencode();

    expect(result.imported).toHaveLength(0);
    expect(result.skipped).toEqual([{
      id: 'groq',
      name: 'Groq',
      reason: 'placeholder-key',
    }]);
    expect(saveProviderCredential).not.toHaveBeenCalled();
    expect(saveRegistry).toHaveBeenCalledWith({ version: 1, providers: [], importedAt: expect.any(String) });
  });

  it('imports provider and saves key when validation passes', async () => {
    vi.mocked(validateImportKey).mockResolvedValue({ canImport: true });

    const result = await importFromOpencode();

    expect(result.imported).toHaveLength(1);
    expect(result.imported[0]?.id).toBe('groq');
    expect(result.keysSaved).toBe(1);
    expect(saveProviderCredential).toHaveBeenCalled();
    expect(saveRegistry).toHaveBeenCalledWith(expect.objectContaining({
      providers: expect.arrayContaining([
        expect.objectContaining({ id: 'groq' }) as RegistryProvider,
      ]),
    }));
  });

  it('keeps a user-renamed provider name when the import replaces it', async () => {
    vi.mocked(validateImportKey).mockResolvedValue({ canImport: true });
    vi.mocked(loadRegistry).mockReturnValue({
      version: 1,
      providers: [{
        id: 'groq',
        templateId: 'groq',
        name: 'Work Groq',
        nameCustomized: true,
        enabled: true,
        authRef: 'keyring:provider:groq',
        api: { npm: '@ai-sdk/groq' },
        addedAt: '2026-01-01T00:00:00.000Z',
      }],
    });

    await importFromOpencode({ resolveConflict: async () => 'replace' });

    const saved = vi.mocked(saveRegistry).mock.calls.at(-1)?.[0] as { providers: RegistryProvider[] };
    expect(saved.providers).toHaveLength(1);
    expect(saved.providers[0]?.name).toBe('Work Groq');
    expect(saved.providers[0]?.nameCustomized).toBe(true);
  });

  it('numbers an imported name that another provider already uses', async () => {
    vi.mocked(validateImportKey).mockResolvedValue({ canImport: true });
    vi.mocked(loadRegistry).mockReturnValue({
      version: 1,
      providers: [{
        id: 'custom-mine',
        templateId: 'custom-openai',
        name: 'groq',
        enabled: true,
        authRef: 'keyring:provider:custom-mine',
        api: { npm: '@ai-sdk/openai-compatible', url: 'https://x.example.com/v1' },
        addedAt: '2026-01-01T00:00:00.000Z',
      }],
    });

    const result = await importFromOpencode();

    expect(result.imported[0]?.name).toBe('Groq 2');
    expect(result.imported[0]?.nameCustomized).toBe(true);
  });

  it('does not add provider when credential persistence fails', async () => {
    vi.mocked(validateImportKey).mockResolvedValue({ canImport: true });
    vi.mocked(saveProviderCredential).mockResolvedValue(false);

    const result = await importFromOpencode();

    expect(result.imported).toHaveLength(0);
    expect(result.keysSaved).toBe(0);
    expect(result.skipped).toEqual([{
      id: 'groq',
      name: 'Groq',
      reason: 'credential-save-failed',
    }]);
    expect(saveRegistry).toHaveBeenCalledWith({ version: 1, providers: [], importedAt: expect.any(String) });
  });

  it('compares imported OpenCode cloud providers with existing zen and go entries', async () => {
    vi.mocked(saveProviderCredential).mockClear();
    vi.mocked(saveRegistry).mockClear();
    const zen = zenRegistryStub();
    const go = goRegistryStub();
    const duplicateZen: RegistryProvider = {
      ...zen,
      id: 'opencode',
      templateId: 'opencode',
      name: 'OpenCode',
      authRef: 'keyring:provider:opencode',
    };
    const duplicateGo: RegistryProvider = {
      ...go,
      id: 'opencode-go',
      templateId: 'opencode-go',
      authRef: 'keyring:provider:opencode-go',
    };
    vi.mocked(loadRegistry).mockReturnValue({
      version: 1,
      providers: [zen, duplicateZen, go, duplicateGo],
    });
    vi.mocked(fetchRawOpencodeProviders).mockResolvedValue([{
      id: 'opencode',
      name: 'OpenCode',
      key: 'shared-opencode-key',
      models: {
        zen: {
          id: 'zen-model',
          name: 'Zen model',
          api: { npm: '@ai-sdk/openai-compatible', url: 'https://opencode.ai/zen/v1' },
        },
      },
    }, {
      id: 'opencode-go',
      name: 'OpenCode Go',
      key: 'shared-opencode-key',
      models: {
        go: {
          id: 'go-model',
          name: 'Go model',
          api: { npm: '@ai-sdk/openai-compatible', url: 'https://opencode.ai/go/v1' },
        },
      },
    }]);
    vi.mocked(validateImportKey).mockResolvedValue({ canImport: true });
    const resolveConflict = vi.fn().mockResolvedValue('keep');

    const result = await importFromOpencode({ resolveConflict });

    expect(resolveConflict).toHaveBeenCalledTimes(2);
    expect(resolveConflict.mock.calls.map(([ctx]) => [ctx.existing.id, ctx.incoming.id]))
      .toEqual([['zen', 'zen'], ['go', 'go']]);
    expect(result.imported).toHaveLength(0);
    expect(result.skipped).toEqual([
      { id: 'zen', name: 'OpenCode Zen', reason: 'conflict-kept' },
      { id: 'go', name: 'OpenCode Go', reason: 'conflict-kept' },
    ]);
    expect(saveProviderCredential).not.toHaveBeenCalled();
    expect(saveRegistry).toHaveBeenLastCalledWith(expect.objectContaining({
      providers: [zen, go],
    }));
  });
});
