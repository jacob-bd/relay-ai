import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkSessionLock,
  cleanupStaleSession,
  recoverInterruptedCodexSession,
  getCodexProfilePath,
  getRelayAiCodexDir,
  getSessionLockPath,
  isConcurrentSession,
  isProcessAlive,
  isSessionStale,
  ownedOverlayPaths,
  readSessionLock,
  remainingOverlayPaths,
  restoreCodexOverlay,
  writeOverlayFile,
  writeSessionLock,
  STALE_SESSION_MS,
} from '../src/codex/session.js';

let tempHome: string;
let previousHome: string | undefined;
let previousRelayHome: string | undefined;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'relay-codex-'));
  previousHome = process.env['HOME'];
  previousRelayHome = process.env['RELAY_AI_HOME'];
  process.env['HOME'] = tempHome;
  process.env['RELAY_AI_HOME'] = join(tempHome, 'relay-ai');
});

afterEach(() => {
  rmSync(tempHome, { recursive: true, force: true });
  if (previousHome === undefined) delete process.env['HOME'];
  else process.env['HOME'] = previousHome;
  if (previousRelayHome === undefined) delete process.env['RELAY_AI_HOME'];
  else process.env['RELAY_AI_HOME'] = previousRelayHome;
});

describe('codex session', () => {
  it('writes and reads session lock', () => {
    writeSessionLock({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      profilePath: getCodexProfilePath(),
      catalogPaths: [],
    });
    const lock = readSessionLock();
    expect(lock?.pid).toBe(process.pid);
  });

  it('restore removes owned overlay files idempotently', () => {
    const profile = getCodexProfilePath();
    mkdirSync(join(profile, '..'), { recursive: true });
    writeFileSync(profile, 'test');
    writeOverlayFile(getSessionLockPath(), '{}');
    const catalog = join(getRelayAiCodexDir(), 'models-anthropic.json');
    writeOverlayFile(catalog, '{}');

    const first = restoreCodexOverlay();
    expect(first.length).toBeGreaterThan(0);
    expect(restoreCodexOverlay()).toEqual([]);
    expect(ownedOverlayPaths().every(p => !existsSync(p) || p === getCodexProfilePath())).toBe(true);
  });

  it('treats dead pid as stale', () => {
    const lock = {
      pid: 999999,
      startedAt: new Date().toISOString(),
      profilePath: '/tmp/x',
      catalogPaths: [],
    };
    expect(isProcessAlive(lock.pid)).toBe(false);
    expect(isSessionStale(lock)).toBe(true);
  });

  it('treats old alive pid as concurrent so live sessions are not cleaned', () => {
    const lock = {
      pid: process.pid,
      startedAt: new Date(Date.now() - STALE_SESSION_MS - 1000).toISOString(),
      profilePath: '/tmp/x',
      catalogPaths: [],
    };
    expect(isConcurrentSession(lock)).toBe(true);
    expect(isSessionStale(lock)).toBe(false);
  });

  it('cleanupStaleSession removes lock when stale', () => {
    writeSessionLock({
      pid: 999999,
      startedAt: new Date(Date.now() - STALE_SESSION_MS - 1000).toISOString(),
      profilePath: getCodexProfilePath(),
      catalogPaths: [],
    });
    writeOverlayFile(getCodexProfilePath(), 'profile');
    expect(cleanupStaleSession()).toBe(true);
    expect(readSessionLock()).toBeNull();
  });

  it('recoverInterruptedCodexSession cleans dead session and reports count', () => {
    writeSessionLock({
      pid: 999999,
      startedAt: new Date().toISOString(),
      profilePath: getCodexProfilePath(),
      catalogPaths: [],
    });
    writeOverlayFile(getCodexProfilePath(), 'profile');
    const result = recoverInterruptedCodexSession();
    expect(result.recovered).toBe(true);
    expect(result.reason).toBe('dead-session');
    expect(result.removedCount).toBeGreaterThan(0);
    expect(remainingOverlayPaths()).toEqual([]);
  });

  it('recoverInterruptedCodexSession skips live concurrent session', () => {
    writeSessionLock({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      profilePath: getCodexProfilePath(),
      catalogPaths: [],
    });
    writeOverlayFile(getCodexProfilePath(), 'profile');
    expect(recoverInterruptedCodexSession().recovered).toBe(false);
    expect(existsSync(getCodexProfilePath())).toBe(true);
  });

  it('recoverInterruptedCodexSession skips old live concurrent session', () => {
    writeSessionLock({
      pid: process.pid,
      startedAt: new Date(Date.now() - STALE_SESSION_MS - 1000).toISOString(),
      profilePath: getCodexProfilePath(),
      catalogPaths: [],
    });
    writeOverlayFile(getCodexProfilePath(), 'profile');
    expect(recoverInterruptedCodexSession().recovered).toBe(false);
    expect(existsSync(getCodexProfilePath())).toBe(true);
  });

  it('recoverInterruptedCodexSession cleans orphan overlay without lock', () => {
    mkdirSync(join(getCodexProfilePath(), '..'), { recursive: true });
    writeFileSync(getCodexProfilePath(), 'orphan');
    const result = recoverInterruptedCodexSession();
    expect(result.recovered).toBe(true);
    expect(result.reason).toBe('orphan-files');
  });

  it('checkSessionLock rejects non-tty', () => {
    expect(checkSessionLock(false)).toEqual({ ok: false, reason: 'non_tty' });
  });

  it('checkSessionLock detects concurrent session', () => {
    writeSessionLock({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      profilePath: getCodexProfilePath(),
      catalogPaths: [],
    });
    const result = checkSessionLock(true);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('concurrent');
  });

  it('rotate backups on overlay write', () => {
    const path = join(getRelayAiCodexDir(), 'models-test.json');
    writeOverlayFile(path, '{"v":1}');
    writeOverlayFile(path, '{"v":2}');
    expect(readFileSync(path, 'utf8')).toContain('"v":2');
  });
});
