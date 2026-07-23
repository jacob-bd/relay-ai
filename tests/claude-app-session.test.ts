import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  cleanupSession,
  getSessionLockPath,
  readSessionLock,
  recoverSession,
  writeSessionLock,
} from '../src/claude-desktop/app-session.js';
import { getConfigLibraryPath, getMetaJsonPath } from '../src/claude-desktop/app-config.js';

// Two concurrent `claude-app` launches share one Claude-3p home: one
// _meta.json, one .relay-ai.lock, one .bak. If a second launch takes over
// the lock, the first process's eventual cleanup/--restore must leave that
// shared state alone instead of clobbering the still-live session.
describe('claude-app session ownership', () => {
  let home: string;
  let prevLocalAppData: string | undefined;
  let prevHome: string | undefined;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'relay-claude-app-session-'));
    prevLocalAppData = process.env.LOCALAPPDATA;
    prevHome = process.env.HOME;
    process.env.LOCALAPPDATA = home;
    process.env.HOME = home;
    mkdirSync(getConfigLibraryPath(), { recursive: true });
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    if (prevLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = prevLocalAppData;
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
  });

  it('allows the owning process to clean up its own session', () => {
    writeFileSync(getMetaJsonPath(), JSON.stringify({ appliedId: 'our-uuid', entries: [{ id: 'our-uuid', name: 'Relay AI Gateway' }] }));
    writeFileSync(`${getMetaJsonPath()}.bak`, JSON.stringify({ appliedId: '', entries: [] }));
    writeFileSync(join(getConfigLibraryPath(), 'our-uuid.json'), '{}');
    writeSessionLock({ pid: process.pid, startedAt: new Date().toISOString(), uuid: 'our-uuid', proxyPort: 11111 });

    cleanupSession('our-uuid');

    expect(JSON.parse(readFileSync(getMetaJsonPath(), 'utf8'))).toEqual({ appliedId: '', entries: [] });
    expect(existsSync(getSessionLockPath())).toBe(false);
    expect(existsSync(join(getConfigLibraryPath(), 'our-uuid.json'))).toBe(false);
  });

  it('does not restore shared state when another live process holds the lock', () => {
    // Our own (now-orphaned) config from an earlier launch.
    writeFileSync(`${getMetaJsonPath()}.bak`, JSON.stringify({ appliedId: '', entries: [] }));
    writeFileSync(join(getConfigLibraryPath(), 'our-uuid.json'), '{}');

    // A second, still-running relay-ai process has since taken over: it
    // wrote its own config/lock and its appliedId is what Desktop is using
    // right now. process.ppid stands in for "a genuinely different live pid".
    const otherLiveState = { appliedId: 'other-uuid', entries: [{ id: 'other-uuid', name: 'Relay AI Gateway' }] };
    writeFileSync(getMetaJsonPath(), JSON.stringify(otherLiveState));
    writeFileSync(join(getConfigLibraryPath(), 'other-uuid.json'), '{}');
    writeSessionLock({ pid: process.ppid, startedAt: new Date().toISOString(), uuid: 'other-uuid', proxyPort: 22222 });

    cleanupSession('our-uuid');

    // Shared state belongs to the other live session — must be untouched.
    expect(JSON.parse(readFileSync(getMetaJsonPath(), 'utf8'))).toEqual(otherLiveState);
    expect(readSessionLock()).toMatchObject({ pid: process.ppid, uuid: 'other-uuid' });
    expect(existsSync(join(getConfigLibraryPath(), 'other-uuid.json'))).toBe(true);
    // Our own orphaned config is still safe to remove.
    expect(existsSync(join(getConfigLibraryPath(), 'our-uuid.json'))).toBe(false);
  });

  it('--restore refuses to clobber another live session', () => {
    const otherLiveState = { appliedId: 'other-uuid', entries: [{ id: 'other-uuid', name: 'Relay AI Gateway' }] };
    writeFileSync(getMetaJsonPath(), JSON.stringify(otherLiveState));
    writeFileSync(`${getMetaJsonPath()}.bak`, JSON.stringify({ appliedId: '', entries: [] }));
    writeSessionLock({ pid: process.ppid, startedAt: new Date().toISOString(), uuid: 'other-uuid', proxyPort: 22222 });

    const result = recoverSession();

    expect(result).toMatchObject({ recovered: false, liveSession: true });
    expect(result.message).toContain(String(process.ppid));
    expect(JSON.parse(readFileSync(getMetaJsonPath(), 'utf8'))).toEqual(otherLiveState);
    expect(readSessionLock()).toMatchObject({ pid: process.ppid, uuid: 'other-uuid' });
  });
});
