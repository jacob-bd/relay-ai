import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const openMock = vi.fn(async () => undefined);
vi.mock('open', () => ({ default: openMock }));

const spawnMock = vi.fn();
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: (...args: unknown[]) => spawnMock(...args) };
});

const { checkExistingServer, removeOwnUiLock, writeUiLock, formatUiAvailableLine } = await import('../src/ui-lock.js');
const { ensureBackgroundUi, shouldEnsureBackgroundUi, announceBackgroundUi, printUiUrlLast } = await import('../src/ui-background.js');
const { runUiCommand, resolveUiRuntimeConfig } = await import('../src/ui-command.js');
const { parseArgs, isToolLaunch } = await import('../src/cli.js');

const lockPath = () => join(process.env['RELAY_AI_HOME']!, 'ui.lock');
const stripAnsi = (s: string) => s.replace(/\u001B\[[0-9;]*m/g, '');

/** A stand-in "running UI": answers /api/config like the real server. */
async function startFakeUi(): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    if (req.url === '/api/config') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no port');
  return { server, port: addr.port };
}

/** Lock naming another live process (the test runner's parent), as a second UI process would see it. */
function writeForeignLock(port: number): void {
  writeFileSync(lockPath(), JSON.stringify({ pid: process.ppid, port, mode: 'full' }));
}

let fake: { server: Server; port: number } | undefined;
let logs: string[];

beforeEach(() => {
  openMock.mockClear();
  spawnMock.mockReset();
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { logs.push(args.join(' ')); });
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (fake) await new Promise<void>(resolve => fake!.server.close(() => resolve()));
  fake = undefined;
  rmSync(lockPath(), { force: true });
});

describe('UI lock discovery', () => {
  it('finds a running UI from its lock file', async () => {
    fake = await startFakeUi();
    writeForeignLock(fake.port);
    expect(await checkExistingServer()).toBe(`http://127.0.0.1:${fake.port}`);
  });

  it('clears a stale lock whose server no longer answers', async () => {
    fake = await startFakeUi();
    const deadPort = fake.port;
    await new Promise<void>(resolve => fake!.server.close(() => resolve()));
    fake = undefined;
    writeForeignLock(deadPort);
    expect(await checkExistingServer()).toBeNull();
    expect(existsSync(lockPath())).toBe(false);
  });

  it('never removes a lock that belongs to another UI process', () => {
    writeForeignLock(4321);
    removeOwnUiLock();
    expect(JSON.parse(readFileSync(lockPath(), 'utf8')).port).toBe(4321);
    writeUiLock(1234, 'full');
    removeOwnUiLock();
    expect(existsSync(lockPath())).toBe(false);
  });

  it('formats the server address with its port', () => {
    expect(stripAnsi(formatUiAvailableLine('http://127.0.0.1:56617')))
      .toBe('  Server available at http://127.0.0.1:56617');
  });
});

describe('background UI for tool launches', () => {
  it('only runs in an interactive terminal, outside dry runs, unless opted out', () => {
    expect(shouldEnsureBackgroundUi({ interactive: true, env: {} })).toBe(true);
    expect(shouldEnsureBackgroundUi({ interactive: false, env: {} })).toBe(false);
    expect(shouldEnsureBackgroundUi({ interactive: true, dryRun: true, env: {} })).toBe(false);
    expect(shouldEnsureBackgroundUi({ interactive: true, env: { RELAY_AI_NO_UI: '1' } })).toBe(false);
    expect(shouldEnsureBackgroundUi({ interactive: true, env: { RELAY_AI_UI_MODE: 'server' } })).toBe(false);
  });

  it('reuses a running UI without starting another', async () => {
    fake = await startFakeUi();
    writeForeignLock(fake.port);
    expect(await ensureBackgroundUi()).toBe(`http://127.0.0.1:${fake.port}`);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('starts a detached `ui --background` process when none is running, and never opens a browser', async () => {
    const started = await startFakeUi();
    spawnMock.mockImplementation(() => {
      fake = started;
      writeForeignLock(started.port);
      return { on: vi.fn(), unref: vi.fn() };
    });
    expect(await ensureBackgroundUi()).toBe(`http://127.0.0.1:${started.port}`);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [, args, options] = spawnMock.mock.calls[0]!;
    expect((args as string[]).slice(-2)).toEqual(['ui', '--background']);
    expect(options).toMatchObject({ detached: true, stdio: 'ignore' });
    expect(openMock).not.toHaveBeenCalled();
  });

  it('background UI config opens no browser and asks nothing on Ctrl+C', () => {
    expect(resolveUiRuntimeConfig({ background: true }, {})).toMatchObject({
      openBrowser: false,
      confirmShutdownOnSigint: false,
    });
    expect(resolveUiRuntimeConfig({}, {})).toMatchObject({ openBrowser: true, confirmShutdownOnSigint: true });
  });

  it('treats real tool launches, not help or restore, as launches', () => {
    expect(isToolLaunch(parseArgs(['codex']))).toBe(true);
    expect(isToolLaunch(parseArgs(['claude']))).toBe(true);
    expect(isToolLaunch(parseArgs(['codex', '--help']))).toBe(false);
    expect(isToolLaunch(parseArgs(['codex', '--restore']))).toBe(false);
    expect(isToolLaunch(parseArgs(['ui']))).toBe(false);
    expect(parseArgs(['ui', '--background']).uiBackground).toBe(true);
  });
});

describe('`relay-ai ui` with a UI already running', () => {
  it('connects to it: opens the browser there and ends with the server address', async () => {
    fake = await startFakeUi();
    writeForeignLock(fake.port);
    const url = `http://127.0.0.1:${fake.port}`;

    expect(await runUiCommand()).toBe(0);

    expect(openMock).toHaveBeenCalledWith(url);
    expect(stripAnsi(logs.at(-2)!).trim()).toBe(`Server available at ${url}`);
    expect(stripAnsi(logs.at(-1)!).trim()).toBe('To shut it down, run: relay-ai ui stop');
    expect(JSON.parse(readFileSync(lockPath(), 'utf8')).port).toBe(fake.port);
  });

  it('a background start defers to the running UI silently', async () => {
    fake = await startFakeUi();
    writeForeignLock(fake.port);
    expect(await runUiCommand({ background: true })).toBe(0);
    expect(openMock).not.toHaveBeenCalled();
    expect(logs).toEqual([]);
  });
});

describe('`relay-ai ui` with no UI running', () => {
  it('starts a new server, opens the browser, and ends with its address and port', async () => {
    void runUiCommand();
    await vi.waitFor(() => {
      expect(logs.some(line => stripAnsi(line).includes('Server available at'))).toBe(true);
    }, { timeout: 15_000 });

    const lock = JSON.parse(readFileSync(lockPath(), 'utf8'));
    expect(lock.pid).toBe(process.pid);
    const url = `http://127.0.0.1:${lock.port}`;
    expect(openMock).toHaveBeenCalledWith(url);
    expect(stripAnsi(logs.at(-1)!).trim()).toBe(`Server available at ${url}`);
    const res = await fetch(`${url}/api/config`);
    expect(res.status).toBe(200);
  }, 20_000);
});

describe('server URL is printed last, once', () => {
  it('announce prints nothing; printUiUrlLast prints the URL line a single time', async () => {
    fake = await startFakeUi();
    writeForeignLock(fake.port);
    await announceBackgroundUi();
    expect(logs).toEqual([]);
    printUiUrlLast();
    printUiUrlLast();
    const out = stripAnsi(logs.join('\n'));
    expect(out).toContain(`Server available at http://127.0.0.1:${fake.port}`);
    expect(out.match(/Server available at/g)).toHaveLength(1);
  });
});
