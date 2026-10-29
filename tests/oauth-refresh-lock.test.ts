import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { withRefreshLock } from '../src/oauth/refresh-lock.js';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('withRefreshLock', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'relay-ai-lock-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const lockPath = (key: string) => join(dir, `oauth-${createHash('sha256').update(key).digest('hex').slice(0, 24)}.lock`);

  it('runs holders for the same key one at a time', async () => {
    const order: string[] = [];
    const hold = (name: string) => withRefreshLock('acct', async () => {
      order.push(`${name}:start`);
      await sleep(40);
      order.push(`${name}:end`);
    }, { dir });
    await Promise.all([hold('a'), hold('b')]);
    expect(order).toHaveLength(4);
    expect(order[1]).toMatch(/:end$/);   // first holder finishes before the second starts
  });

  it('lets different keys run at the same time', async () => {
    let active = 0;
    let peak = 0;
    const hold = (key: string) => withRefreshLock(key, async () => {
      active += 1; peak = Math.max(peak, active);
      await sleep(40);
      active -= 1;
    }, { dir });
    await Promise.all([hold('one'), hold('two')]);
    expect(peak).toBe(2);
  });

  it('releases the lock when the work throws', async () => {
    await expect(withRefreshLock('acct', async () => { throw new Error('boom'); }, { dir })).rejects.toThrow('boom');
    expect(readdirSync(dir)).toEqual([]);
  });

  it('breaks a lock left by a dead process', async () => {
    writeFileSync(lockPath('acct'), JSON.stringify({ pid: 2 ** 22 + 12345, token: 'x' }));
    const result = await withRefreshLock('acct', async () => 'ran', { dir, timeoutMs: 2000 });
    expect(result).toBe('ran');
  });

  it('breaks a stale lock even if its pid looks alive', async () => {
    const path = lockPath('acct');
    writeFileSync(path, JSON.stringify({ pid: process.pid, token: 'old' }));
    const old = new Date(Date.now() - 10 * 60_000);
    utimesSync(path, old, old);
    const result = await withRefreshLock('acct', async () => 'ran', { dir, staleMs: 60_000, timeoutMs: 2000 });
    expect(result).toBe('ran');
  });

  it('still runs the work after the wait times out (never deadlocks a launch)', async () => {
    writeFileSync(lockPath('acct'), JSON.stringify({ pid: process.pid, token: 'live' }));
    const start = Date.now();
    const result = await withRefreshLock('acct', async () => 'ran', { dir, timeoutMs: 150, staleMs: 600_000 });
    expect(result).toBe('ran');
    expect(Date.now() - start).toBeGreaterThanOrEqual(140);
    expect(existsSync(lockPath('acct'))).toBe(true);   // the live holder's lock is left alone
  });
});
