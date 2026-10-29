// Uses the REAL credential reader over a fake keychain: reading an OAuth account through the
// normal secret path returns only the access token, which is how the CLI once lost the account line.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const state = vi.hoisted(() => ({ store: new Map<string, string>() }));

vi.mock('@napi-rs/keyring', () => ({
  Entry: class {
    #account: string;
    constructor(_service: string, account: string) { this.#account = account; }
    getPassword(): string | null { return state.store.get(this.#account) ?? null; }
    setPassword(value: string): void { state.store.set(this.#account, value); }
    deletePassword(): void { state.store.delete(this.#account); }
  },
}));

import { invalidateKeyringReadCache } from '../src/env.js';
import { readOAuthAccountLabel } from '../src/registry/oauth-account.js';

const blob = (extra: Record<string, unknown>) => JSON.stringify({
  type: 'oauth', access: 'opaque-access', refresh: 'r', expires: Date.now() + 3_600_000, ...extra,
});

describe('readOAuthAccountLabel', () => {
  const prevHome = process.env.RELAY_AI_HOME;
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'relay-ai-account-'));
    process.env.RELAY_AI_HOME = home;
    state.store.clear();
    invalidateKeyringReadCache();
  });
  afterEach(() => {
    if (prevHome === undefined) delete process.env.RELAY_AI_HOME;
    else process.env.RELAY_AI_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('Antigravity: shows the Google email and tier from the stored sign-in', async () => {
    state.store.set('oauth:provider:antigravity', blob({ accountId: 'g@example.com', providerData: { tier: 'free-tier' } }));
    expect(await readOAuthAccountLabel({ id: 'antigravity', authRef: 'keyring:oauth:provider:antigravity', authType: 'oauth' }))
      .toBe('g@example.com · free-tier');
  });

  it('ClinePass: email from stored user info', async () => {
    state.store.set('oauth:provider:cline-pass', blob({ providerData: { email: 'c@example.com' } }));
    expect(await readOAuthAccountLabel({ id: 'cline-pass', authRef: 'keyring:oauth:provider:cline-pass', authType: 'oauth' }))
      .toBe('c@example.com');
  });

  it('a numbered account reads its own keychain item', async () => {
    state.store.set('oauth:provider:antigravity', blob({ accountId: 'first@example.com' }));
    state.store.set('oauth:provider:antigravity-2', blob({ accountId: 'second@example.com' }));
    expect(await readOAuthAccountLabel({ id: 'antigravity-2', authRef: 'keyring:oauth:provider:antigravity-2', authType: 'oauth' }))
      .toBe('second@example.com');
  });

  it('does not refresh or rewrite the stored sign-in while reading it', async () => {
    const expired = JSON.stringify({ type: 'oauth', access: 'a', refresh: 'r', expires: Date.now() - 10_000, accountId: 'g@example.com' });
    state.store.set('oauth:provider:antigravity', expired);
    await readOAuthAccountLabel({ id: 'antigravity', authRef: 'keyring:oauth:provider:antigravity', authType: 'oauth' });
    expect(state.store.get('oauth:provider:antigravity')).toBe(expired);
  });

  it('is undefined for non-OAuth providers, missing or unreadable credentials', async () => {
    expect(await readOAuthAccountLabel({ id: 'groq', authRef: 'keyring:provider:groq', authType: 'api' })).toBeUndefined();
    expect(await readOAuthAccountLabel({ id: 'antigravity', authRef: 'keyring:oauth:provider:antigravity', authType: 'oauth' })).toBeUndefined();
    state.store.set('oauth:provider:antigravity', 'not-json');
    expect(await readOAuthAccountLabel({ id: 'antigravity', authRef: 'keyring:oauth:provider:antigravity', authType: 'oauth' })).toBeUndefined();
  });
});
