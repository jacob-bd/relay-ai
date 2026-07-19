import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadRegistryProviders } from '../src/registry/load.js';
import * as env from '../src/env.js';
import * as io from '../src/registry/io.js';
import type { CachedModel, ProviderRegistry } from '../src/registry/types.js';

vi.mock('../src/env.js', () => ({
  resolveProviderCredential: vi.fn(),
  resolveProviderOAuthAccountId: vi.fn(),
  resolveProviderOAuthProviderData: vi.fn(),
}));

vi.mock('../src/registry/io.js', () => ({
  loadRegistry: vi.fn(),
}));

function model(id: string): CachedModel {
  return {
    id,
    name: id,
    upstreamModelId: id,
    modelFormat: 'openai',
    npm: '@ai-sdk/openai-compatible',
    apiUrl: 'https://api.githubcopilot.com',
  };
}

function registry(): ProviderRegistry {
  return {
    schemaVersion: 1,
    providers: [{
      id: 'github-copilot',
      templateId: 'github-copilot',
      name: 'GitHub Copilot',
      enabled: true,
      authRef: 'keyring:oauth:provider:github-copilot',
      authType: 'oauth',
      api: {},
      addedAt: '2026-07-19T00:00:00.000Z',
      modelsCache: {
        fetchedAt: '2026-07-19T00:00:00.000Z',
        models: [model('gpt-4.1'), model('claude-sonnet-4'), model('premium-auto')],
      },
    }],
  };
}

describe('loadRegistryProviders GitHub Copilot policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(io.loadRegistry).mockReturnValue(registry());
    vi.mocked(env.resolveProviderCredential).mockResolvedValue('ghu_test');
    vi.mocked(env.resolveProviderOAuthAccountId).mockResolvedValue(undefined);
  });

  it('restricts an unverified account to the Free allowlist at launch time', async () => {
    vi.mocked(env.resolveProviderOAuthProviderData).mockResolvedValue(undefined);

    const providers = await loadRegistryProviders();

    expect(providers[0]?.models.map(model => model.id)).toEqual(['gpt-4.1']);
    expect(providers[0]?.models[0]).toMatchObject({
      isFree: true,
      freeStatus: 'verified_free',
    });
  });

  it('keeps valid paid models but still removes non-callable router entries', async () => {
    vi.mocked(env.resolveProviderOAuthProviderData).mockResolvedValue({
      copilot: { lookup_status: 'known', is_free_plan: false },
    });

    const providers = await loadRegistryProviders();

    expect(providers[0]?.models.map(model => model.id)).toEqual(['gpt-4.1', 'claude-sonnet-4']);
  });
});
