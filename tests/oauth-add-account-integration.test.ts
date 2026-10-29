import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const state = vi.hoisted(() => ({ store: new Map<string, string>() }));
vi.mock('@napi-rs/keyring', () => ({
  Entry: class {
    #a: string;
    constructor(_s: string, a: string) { this.#a = a; }
    getPassword() { return state.store.get(this.#a) ?? null; }
    setPassword(v: string) { state.store.set(this.#a, v); }
    deletePassword() { state.store.delete(this.#a); }
  },
}));
vi.mock('../src/ui.js', () => ({ printOAuthStepsPanel: vi.fn(), confirmSubscriptionOAuthRisk: vi.fn(async () => true) }));
vi.mock('../src/oauth/claude-code.js', () => ({
  runClaudeCodeOAuthFlow: vi.fn(async () => ({
    tokens: { access_token: 'NEW-access', refresh_token: 'NEW-refresh' },
    bootstrap: { accountId: 'uuid-B', email: 'b@example.com' },
  })),
  generateCliUserID: vi.fn(() => 'cli-id'),
}));
vi.mock('../src/registry/refresh-models.js', () => ({ refreshProviderModels: vi.fn(async () => ({ ok: true })) }));
vi.mock('@clack/prompts', () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), success: vi.fn() },
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  text: vi.fn(), select: vi.fn(), isCancel: vi.fn(() => false),
}));

import { authenticateProvider } from '../src/registry/provider-auth.js';
import { loadRegistry, saveRegistry } from '../src/registry/io.js';
import { invalidateKeyringReadCache } from '../src/env.js';

// Real registry + real credential store (fake keychain); only the browser sign-in is faked.
describe('adding another Claude Code account', () => {
  const prev = process.env.RELAY_AI_HOME;
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'repro-'));
    process.env.RELAY_AI_HOME = home;
    state.store.clear();
    invalidateKeyringReadCache();
  });
  afterEach(() => { process.env.RELAY_AI_HOME = prev; rmSync(home, { recursive: true, force: true }); });

  it('keeps the first and adds claude-code-2', async () => {
    saveRegistry({ schemaVersion: 1, providers: [{
      id: 'claude-code', templateId: 'claude-code', name: 'Claude Code (Anthropic subscription)', enabled: true,
      authType: 'oauth', authRef: 'keyring:oauth:provider:claude-code', api: { npm: '@ai-sdk/anthropic', url: 'https://api.anthropic.com' },
      addedAt: '2026-07-01T00:00:00.000Z',
    }] });
    const original = JSON.stringify({ type: 'oauth', access: 'OLD-access', refresh: 'OLD-refresh', expires: Date.now() + 3_600_000, accountId: 'uuid-A', providerData: { accountUUID: 'uuid-A', organizationName: "mail4jbd@gmail.com's Organization", plan: 'default_claude_ai' } });
    state.store.set('oauth:provider:claude-code', original);

    const result = await authenticateProvider('claude-code', { addAccount: true });

    expect(result.providerId).toBe('claude-code-2');
    expect(loadRegistry().providers.map(p => p.id)).toEqual(['claude-code', 'claude-code-2']);
    expect(state.store.get('oauth:provider:claude-code')).toBe(original);            // the first login is untouched
    expect(state.store.get('oauth:provider:claude-code-2')).toContain('NEW-access');  // the new one has its own item
  });

  it('refuses a sign-in that turns out to be the account already stored, and changes nothing', async () => {
    saveRegistry({ schemaVersion: 1, providers: [{
      id: 'claude-code', templateId: 'claude-code', name: 'Claude', enabled: true, authType: 'oauth',
      authRef: 'keyring:oauth:provider:claude-code', api: { npm: '@ai-sdk/anthropic', url: 'https://api.anthropic.com' }, addedAt: '2026-07-01T00:00:00.000Z',
    }] });
    const original = JSON.stringify({ type: 'oauth', access: 'OLD', refresh: 'OLD-R', expires: Date.now() + 3_600_000, accountId: 'uuid-B' });  // same uuid the sign-in returns
    state.store.set('oauth:provider:claude-code', original);

    await expect(authenticateProvider('claude-code', { addAccount: true })).rejects.toThrow(/already signed in/i);

    expect(loadRegistry().providers.map(p => p.id)).toEqual(['claude-code']);
    expect([...state.store.keys()]).toEqual(['oauth:provider:claude-code']);
    expect(state.store.get('oauth:provider:claude-code')).toBe(original);
  });
});
