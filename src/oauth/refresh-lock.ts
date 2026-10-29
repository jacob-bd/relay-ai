// oauth/refresh-lock.ts — one refresh of a given OAuth account at a time, across processes
//
// Refresh tokens rotate: spending one twice (the UI and a terminal refreshing the
// same account at once) makes the provider reject the second use and may revoke the
// whole sign-in. The lock only serialises; callers must re-read the credential once
// they hold it, because another process may have refreshed while they waited.

import { closeSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { getAppHome } from '../paths.js';

const POLL_MS = 100;

export interface RefreshLockOptions {
  /** Lock directory; defaults to `<app home>/locks`. */
  dir?: string;
  /** How long to wait for another holder before going ahead anyway. */
  timeoutMs?: number;
  /** A lock older than this is considered abandoned. */
  staleMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readHolder(path: string): { pid?: number; token?: string } {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { pid?: unknown; token?: unknown };
    return {
      pid: typeof parsed.pid === 'number' ? parsed.pid : undefined,
      token: typeof parsed.token === 'string' ? parsed.token : undefined,
    };
  } catch {
    return {};
  }
}

function isStale(path: string, staleMs: number): boolean {
  try {
    const { pid } = readHolder(path);
    if (pid !== undefined && !processAlive(pid)) return true;
    return Date.now() - statSync(path).mtimeMs > staleMs;
  } catch {
    return false;
  }
}

function removeLock(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // already gone
  }
}

async function acquire(path: string, timeoutMs: number, staleMs: number): Promise<string | null> {
  const token = randomUUID();
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const fd = openSync(path, 'wx', 0o600);
      try {
        writeSync(fd, JSON.stringify({ pid: process.pid, token }));
      } finally {
        closeSync(fd);
      }
      return token;
    } catch (err) {
      // Anything other than "someone holds it" (read-only dir, …): do not block a launch on it.
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') return null;
      if (isStale(path, staleMs)) {
        removeLock(path);
        continue;
      }
      if (Date.now() >= deadline) return null;
      await sleep(POLL_MS);
    }
  }
}

/** Run `work` while holding the lock for `key`; if the lock cannot be had in time, run it anyway. */
export async function withRefreshLock<T>(
  key: string,
  work: () => Promise<T>,
  options: RefreshLockOptions = {},
): Promise<T> {
  const dir = options.dir ?? join(getAppHome(), 'locks');
  let path: string | undefined;
  let token: string | null = null;
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    path = join(dir, `oauth-${createHash('sha256').update(key).digest('hex').slice(0, 24)}.lock`);
    token = await acquire(path, options.timeoutMs ?? 20_000, options.staleMs ?? 120_000);
  } catch {
    token = null;
  }

  try {
    return await work();
  } finally {
    if (path && token && readHolder(path).token === token) removeLock(path);
  }
}
