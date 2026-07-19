import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  passwords: new Map<string, string>(),
}));

vi.mock('@napi-rs/keyring', () => ({
  Entry: class Entry {
    private readonly key: string;

    constructor(service: string, account: string) {
      this.key = `${service}:${account}`;
    }

    getPassword(): string | null {
      return state.passwords.get(this.key) ?? null;
    }

    setPassword(value: string): void {
      state.passwords.set(this.key, value);
    }

    deletePassword(): void {
      state.passwords.delete(this.key);
    }
  },
}));

vi.mock('../src/oauth/github.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/oauth/github.js')>(),
  fetchCopilotAccount: vi.fn(),
}));

import { enrichGithubCopilotOAuthProviderData } from '../src/env.js';
import { fetchCopilotAccount } from '../src/oauth/github.js';

describe('Copilot OAuth metadata enrichment', () => {
  beforeEach(() => {
    state.passwords.clear();
    vi.clearAllMocks();
  });

  it('looks up an older credential by its long-lived token and persists merged metadata', async () => {
    state.passwords.set('relay-ai:oauth:provider:github-copilot', JSON.stringify({
      type: 'oauth',
      access: 'copilot-session',
      refresh: 'ghu_refresh',
      expires: Date.now() + 60_000,
      providerData: { retained: true },
    }));
    vi.mocked(fetchCopilotAccount).mockResolvedValue({
      lookup_status: 'known',
      is_free_plan: true,
      copilot_plan: 'free',
    });

    const providerData = await enrichGithubCopilotOAuthProviderData(
      'keyring:oauth:provider:github-copilot',
    );

    expect(fetchCopilotAccount).toHaveBeenCalledWith('ghu_refresh');
    expect(providerData).toEqual({
      retained: true,
      copilot: { lookup_status: 'known', is_free_plan: true, copilot_plan: 'free' },
    });
    const stored = JSON.parse(state.passwords.get('relay-ai:oauth:provider:github-copilot') ?? '{}');
    expect(stored.providerData).toEqual(providerData);
    expect(stored.access).toBe('copilot-session');
    expect(stored.refresh).toBe('ghu_refresh');
  });

  it('keeps existing metadata when the account lookup is temporarily unavailable', async () => {
    state.passwords.set('relay-ai:oauth:provider:github-copilot', JSON.stringify({
      type: 'oauth',
      access: 'copilot-session',
      refresh: 'ghu_refresh',
      expires: Date.now() + 60_000,
      providerData: { copilot: { lookup_status: 'unknown' } },
    }));
    vi.mocked(fetchCopilotAccount).mockRejectedValue(new Error('offline'));

    const providerData = await enrichGithubCopilotOAuthProviderData(
      'keyring:oauth:provider:github-copilot',
    );

    expect(providerData).toEqual({ copilot: { lookup_status: 'unknown' } });
  });
});
