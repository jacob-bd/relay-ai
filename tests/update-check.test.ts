import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  UPDATE_CHECK_TTL_MS,
  checkForUpdates,
  formatUpdateNotification,
  isNewerVersion,
} from '../src/update-check.js';

describe('version comparison', () => {
  it('compares stable and prerelease semantic versions', () => {
    expect(isNewerVersion('0.4.3', '0.4.4')).toBe(true);
    expect(isNewerVersion('0.4.3', '0.4.3')).toBe(false);
    expect(isNewerVersion('0.5.0', '0.4.9')).toBe(false);
    expect(isNewerVersion('1.0.0-beta.1', '1.0.0')).toBe(true);
    expect(isNewerVersion('1.0.0', '1.0.0-beta.1')).toBe(false);
    expect(isNewerVersion('invalid', '1.0.0')).toBe(false);
  });

  it('formats the npm update instruction', () => {
    expect(formatUpdateNotification('0.4.3', '0.4.4')).toBe(
      '🔔 Update available: 0.4.3 → 0.4.4. Run npm install -g @jacobbd/relay-ai@latest to update.',
    );
  });
});

describe('update checks', () => {
  let tempHome: string;
  let previousRelayHome: string | undefined;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'relay-ai-update-check-'));
    previousRelayHome = process.env['RELAY_AI_HOME'];
    process.env['RELAY_AI_HOME'] = tempHome;
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
    if (previousRelayHome === undefined) delete process.env['RELAY_AI_HOME'];
    else process.env['RELAY_AI_HOME'] = previousRelayHome;
    vi.restoreAllMocks();
  });

  it('fetches npm latest metadata and caches a successful result', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ version: '9.0.0' }), { status: 200 }));
    const now = 1_783_960_000_000;

    const first = await checkForUpdates({ fetchImpl, now });
    const second = await checkForUpdates({
      fetchImpl: vi.fn(async () => { throw new Error('cache should be used'); }),
      now: now + UPDATE_CHECK_TTL_MS - 1,
    });

    expect(first).toMatchObject({ latestVersion: '9.0.0', updateAvailable: true });
    expect(second).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const cache = JSON.parse(readFileSync(join(tempHome, 'update-check.json'), 'utf8'));
    expect(cache).toEqual({ latestVersion: '9.0.0', checkedAt: now });
  });

  it('refreshes an expired cache entry', async () => {
    const now = 1_783_960_000_000;
    const firstFetch = vi.fn(async () => new Response(JSON.stringify({ version: '0.4.3' }), { status: 200 }));
    await checkForUpdates({ fetchImpl: firstFetch, now });

    const refreshFetch = vi.fn(async () => new Response(JSON.stringify({ version: '9.0.0' }), { status: 200 }));
    const result = await checkForUpdates({ fetchImpl: refreshFetch, now: now + UPDATE_CHECK_TTL_MS });

    expect(result.latestVersion).toBe('9.0.0');
    expect(refreshFetch).toHaveBeenCalledOnce();
  });

  it('fails silently and does not cache registry errors or malformed versions', async () => {
    const offline = await checkForUpdates({
      fetchImpl: vi.fn(async () => { throw new Error('offline'); }),
      now: 1,
    });
    expect(offline).toMatchObject({ latestVersion: null, updateAvailable: false });
    expect(existsSync(join(tempHome, 'update-check.json'))).toBe(false);

    const malformed = await checkForUpdates({
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ version: 'latest' }), { status: 200 })),
      now: 2,
    });
    expect(malformed).toMatchObject({ latestVersion: null, updateAvailable: false });
    expect(existsSync(join(tempHome, 'update-check.json'))).toBe(false);
  });

  it('aborts a slow registry request', async () => {
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));

    const result = await checkForUpdates({ fetchImpl, now: 1, timeoutMs: 5 });

    expect(result).toMatchObject({ latestVersion: null, updateAvailable: false });
    expect(existsSync(join(tempHome, 'update-check.json'))).toBe(false);
  });
});
