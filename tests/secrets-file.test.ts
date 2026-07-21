import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  deleteFileAccount,
  readFileAccount,
  readSecretsFile,
  writeFileAccount,
} from '../src/secrets-file.js';

describe('secrets-file', () => {
  let home: string;
  const prevHome = process.env.RELAY_AI_HOME;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'relay-ai-secrets-'));
    process.env.RELAY_AI_HOME = home;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.RELAY_AI_HOME;
    else process.env.RELAY_AI_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('round-trips API keys and OAuth JSON blobs', () => {
    expect(writeFileAccount('provider:groq', 'sk-test')).toBe(true);
    expect(writeFileAccount('oauth:provider:github-copilot', JSON.stringify({
      type: 'oauth',
      access: 'tok',
      refresh: 'ref',
      expires: 1,
    }))).toBe(true);

    expect(readFileAccount('provider:groq')).toBe('sk-test');
    expect(JSON.parse(readFileAccount('oauth:provider:github-copilot')!)).toEqual({
      type: 'oauth',
      access: 'tok',
      refresh: 'ref',
      expires: 1,
    });

    const path = join(home, 'secrets.json');
    expect(existsSync(path)).toBe(true);
    if (process.platform !== 'win32') {
      expect(statSync(path).mode & 0o777).toBe(0o600);
    }
    expect(readSecretsFile().accounts['provider:groq']).toBe('sk-test');
  });

  it('deletes accounts and leaves other entries', () => {
    writeFileAccount('a', '1');
    writeFileAccount('b', '2');
    expect(deleteFileAccount('a')).toBe(true);
    expect(readFileAccount('a')).toBeNull();
    expect(readFileAccount('b')).toBe('2');
  });

  it('returns empty store for corrupt JSON', () => {
    const path = join(home, 'secrets.json');
    writeFileAccount('ok', 'v');
    writeFileSync(path, '{not-json', 'utf8');
    expect(readFileAccount('ok')).toBeNull();
    expect(readSecretsFile()).toEqual({ version: 1, accounts: {} });
  });
});
