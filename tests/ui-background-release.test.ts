import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { releaseBackgroundUi } from '../src/ui-background.js';
import { lockFile } from '../src/ui-lock.js';

let home: string;
let prevHome: string | undefined;
const children: ChildProcess[] = [];

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sleeper = (): ChildProcess => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  children.push(child);
  return child;
};
const waitDead = async (pid: number) => {
  for (let i = 0; i < 50 && alive(pid); i += 1) await new Promise(r => setTimeout(r, 40));
};
const clientFile = (pid: number) => join(home, 'ui-clients', String(pid));
function writeLock(pid: number, background: boolean): void {
  writeFileSync(lockFile(), JSON.stringify({ pid, port: 1, mode: 'full', ...(background ? { background: true } : {}) }));
}
function addClient(pid: number): void {
  mkdirSync(join(home, 'ui-clients'), { recursive: true });
  writeFileSync(clientFile(pid), '');
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'relay-ui-release-'));
  prevHome = process.env.RELAY_AI_HOME;
  process.env.RELAY_AI_HOME = home;
});

afterEach(() => {
  for (const child of children.splice(0)) { try { child.kill('SIGKILL'); } catch {} }
  if (prevHome === undefined) delete process.env.RELAY_AI_HOME; else process.env.RELAY_AI_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

describe('releaseBackgroundUi', () => {
  it('stops a tool-started UI when the last launch ends', async () => {
    const ui = sleeper();
    writeLock(ui.pid!, true);
    addClient(process.pid);
    releaseBackgroundUi();
    await waitDead(ui.pid!);
    expect(alive(ui.pid!)).toBe(false);
    expect(existsSync(lockFile())).toBe(false);
    expect(existsSync(clientFile(process.pid))).toBe(false);
  });

  it('leaves the UI running while another launch is still using it', async () => {
    const ui = sleeper();
    const other = sleeper();
    writeLock(ui.pid!, true);
    addClient(process.pid);
    addClient(other.pid!);
    releaseBackgroundUi();
    await new Promise(r => setTimeout(r, 150));
    expect(alive(ui.pid!)).toBe(true);
    expect(existsSync(lockFile())).toBe(true);
    expect(existsSync(clientFile(process.pid))).toBe(false);
  });

  it('ignores clients whose process has died', async () => {
    const ui = sleeper();
    const dead = sleeper();
    dead.kill('SIGKILL');
    await waitDead(dead.pid!);
    writeLock(ui.pid!, true);
    addClient(process.pid);
    addClient(dead.pid!);
    releaseBackgroundUi();
    await waitDead(ui.pid!);
    expect(alive(ui.pid!)).toBe(false);
  });

  it('never stops a UI the user started themselves', async () => {
    const ui = sleeper();
    writeLock(ui.pid!, false);
    addClient(process.pid);
    releaseBackgroundUi();
    await new Promise(r => setTimeout(r, 150));
    expect(alive(ui.pid!)).toBe(true);
    expect(existsSync(lockFile())).toBe(true);
  });
});
