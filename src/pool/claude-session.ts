import { randomUUID } from 'node:crypto';
import {
  closeSync, linkSync, mkdirSync, openSync, readFileSync, rmSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { getAppHome } from '../paths.js';
import { processAlive } from './process-alive.js';

interface ClaudePoolSessionLock {
  pid: number;
  token: string;
  startedAt: string;
}

export type ClaudePoolSessionLockResult =
  | { ok: true; release(): void }
  | { ok: false; reason: 'concurrent'; pid: number }
  | { ok: false; reason: 'unreadable' };

export function getClaudePoolSessionLockPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(getAppHome(env), 'claude', 'pool-session.json');
}

type LockFileState =
  | { status: 'missing' }
  | { status: 'unreadable' }
  | { status: 'valid'; lock: ClaudePoolSessionLock };

function readLock(path: string): LockFileState {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? { status: 'missing' }
      : { status: 'unreadable' };
  }
  try {
    const value = JSON.parse(raw) as Partial<ClaudePoolSessionLock>;
    if (Number.isSafeInteger(value.pid) && (value.pid as number) > 0
      && typeof value.token === 'string' && typeof value.startedAt === 'string') {
      return { status: 'valid', lock: value as ClaudePoolSessionLock };
    }
  } catch { /* invalid JSON */ }
  return { status: 'unreadable' };
}

/**
 * One Claude pool launch per Relay home. Claude Code owns its gateway-discovery
 * cache, so overlapping pool sessions could otherwise rewrite shared state with
 * two different catalogs. Only a valid lock whose positive pid is dead is
 * reclaimed; unreadable locks fail closed for manual inspection.
 */
export function acquireClaudePoolSessionLock(
  env: NodeJS.ProcessEnv = process.env,
): ClaudePoolSessionLockResult {
  const path = getClaudePoolSessionLockPath(env);
  const lock: ClaudePoolSessionLock = {
    pid: process.pid,
    token: randomUUID(),
    startedAt: new Date().toISOString(),
  };
  const tempPath = `${path}.${process.pid}.${lock.token}.tmp`;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(tempPath, `${JSON.stringify(lock)}\n`, { mode: 0o600, flag: 'wx' });

  const publish = (): void => { linkSync(tempPath, path); };
  try {
    let published = false;
    for (let attempt = 0; attempt < 3 && !published; attempt++) {
      try {
        publish();
        published = true;
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }

      const existing = readLock(path);
      // A concurrent release can remove the file between link and read. Retry
      // publishing against the now-free path rather than treating it as corrupt.
      if (existing.status === 'missing') continue;
      if (existing.status === 'unreadable') return { ok: false, reason: 'unreadable' };
      if (processAlive(existing.lock.pid)) {
        return { ok: false, reason: 'concurrent', pid: existing.lock.pid };
      }

      // Serialize stale-lock reclamation so two new launches cannot both remove
      // the old file and then publish over each other.
      const guardPath = `${path}.reclaim`;
      let guard: number;
      try {
        guard = openSync(guardPath, 'wx', 0o600);
      } catch (guardError) {
        const current = readLock(path);
        if (current.status === 'unreadable') return { ok: false, reason: 'unreadable' };
        if (current.status === 'valid' && processAlive(current.lock.pid)) {
          return { ok: false, reason: 'concurrent', pid: current.lock.pid };
        }
        throw new Error('Another Claude pool launch is reclaiming a stale lock.', { cause: guardError });
      }
      try {
        const current = readLock(path);
        if (current.status === 'unreadable') return { ok: false, reason: 'unreadable' };
        if (current.status === 'valid' && processAlive(current.lock.pid)) {
          return { ok: false, reason: 'concurrent', pid: current.lock.pid };
        }
        rmSync(path, { force: true });
        publish();
        published = true;
      } finally {
        closeSync(guard);
        rmSync(guardPath, { force: true });
      }
    }
    if (!published) throw new Error('Claude pool lock kept changing during acquisition.');
  } finally {
    rmSync(tempPath, { force: true });
  }

  return {
    ok: true,
    release: () => {
      const current = readLock(path);
      if (current.status !== 'valid' || current.lock.token !== lock.token) return;
      try { unlinkSync(path); } catch { /* already removed */ }
    },
  };
}
