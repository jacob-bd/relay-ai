import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acquireClaudePoolSessionLock,
  getClaudePoolSessionLockPath,
} from '../src/pool/claude-session.js';

let home: string;
let env: NodeJS.ProcessEnv;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'relay-claude-pool-session-'));
  env = { ...process.env, RELAY_AI_HOME: home };
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('Claude pool launch lock', () => {
  it('allows one live launch and releases only its own lock', () => {
    const first = acquireClaudePoolSessionLock(env);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const path = getClaudePoolSessionLockPath(env);
    expect(existsSync(path)).toBe(true);

    expect(acquireClaudePoolSessionLock(env)).toEqual({ ok: false, reason: 'concurrent', pid: process.pid });
    first.release();
    expect(existsSync(path)).toBe(false);
  });

  it('reclaims a lock whose owner is no longer running', () => {
    const path = getClaudePoolSessionLockPath(env);
    mkdirSync(join(home, 'claude'), { recursive: true });
    writeFileSync(path, JSON.stringify({ pid: 99999999, token: 'dead', startedAt: new Date().toISOString() }));

    const acquired = acquireClaudePoolSessionLock(env);
    expect(acquired.ok).toBe(true);
    if (acquired.ok) {
      expect(JSON.parse(readFileSync(path, 'utf8')).pid).toBe(process.pid);
      acquired.release();
    }
  });

  it.each([
    ['corrupt JSON', '{ nope'],
    ['invalid pid', JSON.stringify({ pid: 0, token: 'unknown', startedAt: new Date().toISOString() })],
  ])('fails closed and preserves an unreadable lock with %s', (_label, contents) => {
    const path = getClaudePoolSessionLockPath(env);
    mkdirSync(join(home, 'claude'), { recursive: true });
    writeFileSync(path, contents);
    expect(acquireClaudePoolSessionLock(env)).toEqual({ ok: false, reason: 'unreadable' });
    expect(readFileSync(path, 'utf8')).toBe(contents);
  });

  it('does not let an older release remove a newer owner', () => {
    const first = acquireClaudePoolSessionLock(env);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const path = getClaudePoolSessionLockPath(env);
    const newer = { pid: process.pid, token: 'newer-owner', startedAt: new Date().toISOString() };
    writeFileSync(path, JSON.stringify(newer));
    first.release();
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(newer);
    rmSync(path, { force: true });
  });
});
