import { afterEach, describe, expect, it, vi } from 'vitest';
import { CODEX_RESPONSES_LITE_VERSION } from '../src/constants.js';
import {
  fetchNpmCodexVersion,
  maxCodexVersion,
  parseCodexVersion,
  resetCodexClientVersionCache,
  resolveCodexClientVersion,
} from '../src/codex/version.js';

afterEach(() => {
  resetCodexClientVersionCache();
  delete process.env['RELAY_AI_CODEX_VERSION'];
  vi.unstubAllGlobals();
});

describe('parseCodexVersion', () => {
  it('extracts the numeric triple from CLI output', () => {
    expect(parseCodexVersion('codex-cli 0.155.1')).toBe('0.155.1');
    expect(parseCodexVersion('0.156.1')).toBe('0.156.1');
    expect(parseCodexVersion('codex-cli 0.148.0-alpha.9')).toBe('0.148.0');
  });

  it('returns null when no version is present', () => {
    expect(parseCodexVersion('no version here')).toBeNull();
  });
});

describe('maxCodexVersion', () => {
  it('picks the highest parseable candidate', () => {
    expect(maxCodexVersion(['0.153.4', '0.155.1', '0.156.1'])).toBe('0.156.1');
    expect(maxCodexVersion([null, '0.155.1', undefined])).toBe('0.155.1');
  });

  it('never drops below the bundled fallback', () => {
    expect(maxCodexVersion([null, undefined])).toBe(CODEX_RESPONSES_LITE_VERSION);
  });
});

describe('fetchNpmCodexVersion', () => {
  it('reads the version field from the registry response', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ version: '0.156.1' }),
    ) as unknown as typeof fetch;
    await expect(fetchNpmCodexVersion(fetchImpl, 1000)).resolves.toBe('0.156.1');
  });

  it('returns null on network failure instead of throwing', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await expect(fetchNpmCodexVersion(fetchImpl, 1000)).resolves.toBeNull();
  });
});

describe('resolveCodexClientVersion', () => {
  it('honours the support override without network access', async () => {
    process.env['RELAY_AI_CODEX_VERSION'] = '0.155.1';
    const fetchImpl = vi.fn(async () => {
      throw new Error('must not be called');
    }) as unknown as typeof fetch;
    await expect(resolveCodexClientVersion({ fetchImpl })).resolves.toBe('0.155.1');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('uses the bundled fallback in unit tests', async () => {
    await expect(resolveCodexClientVersion()).resolves.toBe(CODEX_RESPONSES_LITE_VERSION);
  });
});
