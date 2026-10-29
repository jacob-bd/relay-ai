// A rotating refresh token can only be spent once. If another process refreshed
// while we waited, we must use ITS result (or its newer refresh token), never ours.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const state = vi.hoisted(() => ({
  store: new Map<string, string>(),
  gets: 0,
  /** Swapped in right after the first read, simulating another process writing the keychain. */
  afterFirstRead: undefined as { account: string; value: string } | undefined,
  refreshCalls: [] as Array<{ providerId: string; refresh: string }>,
}));

vi.mock('@napi-rs/keyring', () => ({
  Entry: class {
    #account: string;
    constructor(_service: string, account: string) { this.#account = account; }
    getPassword(): string | null {
      state.gets += 1;
      const value = state.store.get(this.#account) ?? null;
      if (state.gets === 1 && state.afterFirstRead) state.store.set(state.afterFirstRead.account, state.afterFirstRead.value);
      return value;
    }
    setPassword(value: string): void { state.store.set(this.#account, value); }
    deletePassword(): void { state.store.delete(this.#account); }
  },
}));

vi.mock('../src/oauth/refresh.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/oauth/refresh.js')>()),
  refreshStoredOAuthCredential: vi.fn(async (providerId: string, cred: { refresh: string }) => {
    state.refreshCalls.push({ providerId, refresh: cred.refresh });
    return { type: 'oauth', access: 'REFRESHED', refresh: 'R-NEXT', expires: Date.now() + 3_600_000 };
  }),
}));

import { forceRefreshProviderCredential, invalidateKeyringReadCache, resolveProviderCredential } from '../src/env.js';

const ACCOUNT = 'oauth:provider:openai-oauth';
const AUTH_REF = `keyring:${ACCOUNT}`;
const cred = (access: string, refresh: string, expiresInMs: number) =>
  JSON.stringify({ type: 'oauth', access, refresh, expires: Date.now() + expiresInMs });

describe('OAuth refresh across processes', () => {
  const prevHome = process.env.RELAY_AI_HOME;
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'relay-ai-race-'));
    process.env.RELAY_AI_HOME = home;
    state.store.clear();
    state.gets = 0;
    state.afterFirstRead = undefined;
    state.refreshCalls = [];
    invalidateKeyringReadCache();
    delete process.env['RELAY_AI_KEY_OPENAI_OAUTH'];
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.RELAY_AI_HOME;
    else process.env.RELAY_AI_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('uses the token another process just refreshed instead of spending the old refresh token', async () => {
    state.store.set(ACCOUNT, cred('A1', 'R1', -10_000));
    state.afterFirstRead = { account: ACCOUNT, value: cred('A2', 'R2', 3_600_000) };

    expect(await resolveProviderCredential('openai-oauth', AUTH_REF)).toBe('A2');
    expect(state.refreshCalls).toEqual([]);
  });

  it('refreshes with the NEWEST refresh token when the other process left an expired one', async () => {
    state.store.set(ACCOUNT, cred('A1', 'R1', -10_000));
    state.afterFirstRead = { account: ACCOUNT, value: cred('A2', 'R2', -5_000) };

    expect(await resolveProviderCredential('openai-oauth', AUTH_REF)).toBe('REFRESHED');
    expect(state.refreshCalls).toEqual([{ providerId: 'openai-oauth', refresh: 'R2' }]);
  });

  it('after an upstream 401, reuses a token another process already replaced', async () => {
    state.store.set(ACCOUNT, cred('A1', 'R1', 3_600_000));
    state.afterFirstRead = { account: ACCOUNT, value: cred('A2', 'R2', 3_600_000) };

    expect(await forceRefreshProviderCredential('openai-oauth', AUTH_REF)).toBe('A2');
    expect(state.refreshCalls).toEqual([]);
  });

  it('still force-refreshes when nobody else did', async () => {
    state.store.set(ACCOUNT, cred('A1', 'R1', 3_600_000));
    expect(await forceRefreshProviderCredential('openai-oauth', AUTH_REF)).toBe('REFRESHED');
    expect(state.refreshCalls).toEqual([{ providerId: 'openai-oauth', refresh: 'R1' }]);
  });

  it('leaves the normal path alone: a valid token needs no lock and no extra keychain read', async () => {
    state.store.set(ACCOUNT, cred('A1', 'R1', 3_600_000));
    expect(await resolveProviderCredential('openai-oauth', AUTH_REF)).toBe('A1');
    expect(state.gets).toBe(1);
    expect(state.refreshCalls).toEqual([]);
  });

  it('releases its lock when done', async () => {
    state.store.set(ACCOUNT, cred('A1', 'R1', -10_000));
    await resolveProviderCredential('openai-oauth', AUTH_REF);
    expect(readdirSync(join(home, 'locks'))).toEqual([]);
  });

  it('numbered accounts get their own lock and refresh through their kind', async () => {
    const account = 'oauth:provider:openai-oauth-2';
    state.store.set(account, cred('B1', 'S1', -10_000));
    expect(await resolveProviderCredential('openai-oauth-2', `keyring:${account}`)).toBe('REFRESHED');
    expect(state.refreshCalls).toEqual([{ providerId: 'openai-oauth-2', refresh: 'S1' }]);
  });
});
