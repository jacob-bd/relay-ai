// tests/env-keyring-cache.test.ts — API-key caching and fresh OAuth credential resolutions.
//
// macOS prompts for every keychain read unless the calling binary holds an
// "Always Allow" ACL on that item, and a single credential resolution reads
// the same account up to three times (access token, account id, provider
// data). These tests pin the memo, local write/delete invalidation, and external OAuth refresh visibility.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const state = vi.hoisted(() => ({ store: new Map<string, string>(), gets: 0, sets: 0, deletes: 0 }));

vi.mock('@napi-rs/keyring', () => ({
  Entry: class {
    #account: string;
    constructor(_service: string, account: string) {
      this.#account = account;
    }
    getPassword(): string | null {
      state.gets += 1;
      return state.store.get(this.#account) ?? null;
    }
    setPassword(value: string): void {
      state.sets += 1;
      state.store.set(this.#account, value);
    }
    deletePassword(): void {
      state.deletes += 1;
      state.store.delete(this.#account);
    }
  },
}));

import {
  deleteProviderCredential,
  forceRefreshProviderCredential,
  invalidateKeyringReadCache,
  resolveProviderCredential,
  resolveProviderOAuthAccountId,
  resolveProviderOAuthProviderData,
  saveProviderCredential,
} from '../src/env.js';

describe('keyring read cache', () => {
  beforeEach(() => {
    state.store.clear();
    state.gets = 0;
    state.sets = 0;
    state.deletes = 0;
    invalidateKeyringReadCache();
    delete process.env['RELAY_AI_KEY_GROQ'];
  });

  it('reads one account once per process', async () => {
    state.store.set('provider:groq', 'gsk-1');
    expect(await resolveProviderCredential('groq', 'keyring:provider:groq')).toBe('gsk-1');
    expect(await resolveProviderCredential('groq', 'keyring:provider:groq')).toBe('gsk-1');
    expect(state.gets).toBe(1);
  });

  it('collapses the OAuth triple-read (token, account id, provider data) into one read', async () => {
    const blob = JSON.stringify({
      type: 'oauth',
      access: 'tok',
      refresh: 'ref',
      expires: Date.now() + 3_600_000,
      accountId: 'acct',
      providerData: { plan: 'x' },
    });
    state.store.set('oauth:provider:openai-oauth', blob);
    const authRef = 'keyring:oauth:provider:openai-oauth';
    expect(await resolveProviderCredential('openai-oauth', authRef)).toBe('tok');
    expect(await resolveProviderOAuthAccountId(authRef)).toBe('acct');
    expect(await resolveProviderOAuthProviderData(authRef)).toEqual({ plan: 'x' });
    expect(state.gets).toBe(1);
  });

  it('picks up OAuth replaced by another process on the next resolution', async () => {
    const authRef = 'keyring:oauth:provider:claude-code';
    const credential = (access: string, accountId: string) => JSON.stringify({
      type: 'oauth', access, refresh: 'ref', expires: Date.now() + 3_600_000,
      accountId, providerData: { account: accountId },
    });
    state.store.set('oauth:provider:claude-code', credential('old-token', 'old-account'));
    expect(await resolveProviderCredential('claude-code', authRef)).toBe('old-token');
    // A CLI in another process cannot invalidate this process's cache.
    state.store.set('oauth:provider:claude-code', credential('new-token', 'new-account'));
    expect(await resolveProviderCredential('claude-code', authRef)).toBe('new-token');
    expect(await resolveProviderOAuthAccountId(authRef)).toBe('new-account');
    expect(await resolveProviderOAuthProviderData(authRef)).toEqual({ account: 'new-account' });
    expect(state.gets).toBe(2);
  });

  it('picks up an OAuth credential added after a cached miss', async () => {
    const authRef = 'keyring:oauth:provider:claude-code';
    expect(await resolveProviderCredential('claude-code', authRef)).toBeNull();
    state.store.set('oauth:provider:claude-code', JSON.stringify({
      type: 'oauth', access: 'new-token', refresh: 'ref', expires: Date.now() + 3_600_000,
    }));
    expect(await resolveProviderCredential('claude-code', authRef)).toBe('new-token');
  });

  it('re-reads Keychain before a forced refresh instead of using the cached secret', async () => {
    const authRef = 'keyring:oauth:provider:claude-code';
    state.store.set('oauth:provider:claude-code', 'old-token');
    await resolveProviderCredential('claude-code', authRef);
    state.store.set('oauth:provider:claude-code', 'new-token');
    expect(await forceRefreshProviderCredential('claude-code', authRef)).toBe('new-token');
    expect(state.gets).toBe(2);
  });

  it('serves a newly saved key immediately (write invalidates)', async () => {
    state.store.set('provider:groq', 'gsk-1');
    await resolveProviderCredential('groq', 'keyring:provider:groq');
    await saveProviderCredential('keyring:provider:groq', 'gsk-2');
    expect(await resolveProviderCredential('groq', 'keyring:provider:groq')).toBe('gsk-2');
  });

  it('serves a deleted key as absent immediately (delete invalidates)', async () => {
    state.store.set('provider:groq', 'gsk-1');
    await resolveProviderCredential('groq', 'keyring:provider:groq');
    await deleteProviderCredential('keyring:provider:groq');
    expect(await resolveProviderCredential('groq', 'keyring:provider:groq')).toBeNull();
  });

  it('prefers a namespaced env key without touching the keychain', async () => {
    process.env['RELAY_AI_KEY_GROQ'] = 'env-key';
    expect(await resolveProviderCredential('groq', 'keyring:provider:groq')).toBe('env-key');
    expect(state.gets).toBe(0);
  });
});
