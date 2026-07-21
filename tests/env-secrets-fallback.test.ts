import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('@napi-rs/keyring', () => ({
  Entry: class Entry {
    getPassword(): string | null {
      throw new Error('Secret Service error: no daemon running');
    }
    setPassword(): void {
      throw new Error('Secret Service error: no daemon running');
    }
    deletePassword(): void {
      throw new Error('Secret Service error: no daemon running');
    }
  },
}));

import {
  deleteProviderCredential,
  resolveProviderCredential,
  saveProviderCredential,
} from '../src/env.js';
import { readFileAccount } from '../src/secrets-file.js';

describe('credential file fallback when keyring fails', () => {
  let home: string;
  const prevHome = process.env.RELAY_AI_HOME;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'relay-ai-cred-fallback-'));
    process.env.RELAY_AI_HOME = home;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.RELAY_AI_HOME;
    else process.env.RELAY_AI_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('saves and reads API keys via secrets.json', async () => {
    const authRef = 'keyring:provider:groq';
    expect(await saveProviderCredential(authRef, 'sk-from-ui')).toBe(true);
    expect(readFileAccount('provider:groq')).toBe('sk-from-ui');
    expect(await resolveProviderCredential('groq', authRef)).toBe('sk-from-ui');
    const raw = JSON.parse(readFileSync(join(home, 'secrets.json'), 'utf8'));
    expect(raw.accounts['provider:groq']).toBe('sk-from-ui');
  });

  it('saves and reads OAuth token JSON via secrets.json', async () => {
    const authRef = 'keyring:oauth:provider:github-copilot';
    const blob = JSON.stringify({
      type: 'oauth',
      access: 'session',
      refresh: 'ghu_x',
      expires: Date.now() + 60_000,
    });
    expect(await saveProviderCredential(authRef, blob)).toBe(true);
    expect(await resolveProviderCredential('github-copilot', authRef)).toBe('session');
    expect(readFileAccount('oauth:provider:github-copilot')).toBe(blob);
  });

  it('deletes file-backed credentials', async () => {
    const authRef = 'keyring:provider:mistral';
    await saveProviderCredential(authRef, 'mk-1');
    expect(await deleteProviderCredential(authRef)).toBe(true);
    expect(await resolveProviderCredential('mistral', authRef)).toBeNull();
    expect(readFileAccount('provider:mistral')).toBeNull();
  });
});
