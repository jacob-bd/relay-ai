import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  formatUiServerLifecycleMessage,
  isUiApiRoute,
  resolveUiMode,
  resolveUiRuntimeConfig,
  resolveUiShutdownDecision,
  stopUiServer,
} from '../src/ui-command.js';
import { lockFile, readUiLock, writeUiLock } from '../src/ui-lock.js';

describe('ui command routing', () => {
  it('routes API and OAuth callback requests to the API handler', () => {
    expect(isUiApiRoute('/api/providers/oauth/start')).toBe(true);
    expect(isUiApiRoute('/oauth/callback?state=abc&code=123')).toBe(true);
  });

  it('leaves static UI paths on the static file handler', () => {
    expect(isUiApiRoute('/')).toBe(false);
    expect(isUiApiRoute('/index.html')).toBe(false);
    expect(isUiApiRoute('/app.js')).toBe(false);
  });

  it('keeps the UI running when Ctrl+C prompt is declined', async () => {
    const decision = await resolveUiShutdownDecision('SIGINT', async () => false);

    expect(decision).toBe('keep');
  });

  it('closes the UI when Ctrl+C prompt is accepted', async () => {
    const decision = await resolveUiShutdownDecision('SIGINT', async () => true);

    expect(decision).toBe('close');
  });

  it('closes the UI on non-interactive termination signals without prompting', async () => {
    let prompted = false;
    const decision = await resolveUiShutdownDecision('SIGTERM', async () => {
      prompted = true;
      return false;
    });

    expect(decision).toBe('close');
    expect(prompted).toBe(false);
  });

  it('skips Ctrl+C confirm in server admin mode', async () => {
    let prompted = false;
    const decision = await resolveUiShutdownDecision(
      'SIGINT',
      async () => {
        prompted = true;
        return false;
      },
      { confirmOnSigint: false },
    );
    expect(decision).toBe('close');
    expect(prompted).toBe(false);
  });
});

describe('UI server admin mode', () => {
  it('resolves server mode from opts or RELAY_AI_UI_MODE', () => {
    expect(resolveUiMode({ serverMode: true })).toBe('server');
    expect(resolveUiMode({}, { RELAY_AI_UI_MODE: 'server' })).toBe('server');
    expect(resolveUiMode({}, {})).toBe('full');
  });

  it('binds 0.0.0.0:8787 without browser open in server mode', () => {
    const runtime = resolveUiRuntimeConfig({ serverMode: true }, {});
    expect(runtime).toMatchObject({
      mode: 'server',
      host: '0.0.0.0',
      port: 8787,
      openBrowser: false,
      confirmShutdownOnSigint: false,
    });
  });
});

describe('UI full-mode port', () => {
  it('defaults to a stable port that may fall back to a random one', () => {
    expect(resolveUiRuntimeConfig({}, {})).toMatchObject({ host: '127.0.0.1', port: 17646, fallbackToRandomPort: true });
  });

  it('treats --port and RELAY_AI_UI_PORT as exact requests', () => {
    expect(resolveUiRuntimeConfig({ port: 9000 }, {})).toMatchObject({ port: 9000, fallbackToRandomPort: false });
    expect(resolveUiRuntimeConfig({}, { RELAY_AI_UI_PORT: '9100' })).toMatchObject({ port: 9100, fallbackToRandomPort: false });
    expect(resolveUiRuntimeConfig({}, { RELAY_AI_UI_PORT: 'junk' })).toMatchObject({ port: 17646, fallbackToRandomPort: true });
  });
});

describe('UI Server Gateway lifecycle messages', () => {
  it('formats local and network start messages with exposed model counts', () => {
    expect(formatUiServerLifecycleMessage({ type: 'started', listenMode: 'local', modelCount: 1 }))
      .toBe('◆ Server Gateway started · Local mode · 1 model exposed');
    expect(formatUiServerLifecycleMessage({ type: 'started', listenMode: 'network', modelCount: 17 }))
      .toBe('◆ Server Gateway started · Network mode · 17 models exposed');
  });

  it('formats the stop message', () => {
    expect(formatUiServerLifecycleMessage({ type: 'stopped' }))
      .toBe('◇ Server Gateway stopped');
  });
});

describe('stopUiServer', () => {
  let tempHome: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'relay-stop-ui-'));
    prevHome = process.env.RELAY_AI_HOME;
    process.env.RELAY_AI_HOME = tempHome;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.RELAY_AI_HOME;
    else process.env.RELAY_AI_HOME = prevHome;
    rmSync(tempHome, { recursive: true, force: true });
  });

  it('returns false when no server or lock is found', async () => {
    const res = await stopUiServer();
    expect(res).toEqual({ stopped: false, message: 'Relay UI is not running.' });
  });

  it('stops server, terminates pid, and removes lock file when running', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
    let shutdownCalled = false;
    const server = createServer((req, res) => {
      if (req.url === '/api/config') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } else if (req.url === '/api/ui/shutdown') {
        shutdownCalled = true;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } else {
        res.writeHead(404).end();
      }
    });

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as any).port;

    writeFileSync(lockFile(), JSON.stringify({ pid: child.pid, port, mode: 'full' }));
    expect(readUiLock()).not.toBeNull();

    try {
      const res = await stopUiServer();
      expect(res).toEqual({ stopped: true, message: `Relay UI stopped (port ${port}).` });
      expect(shutdownCalled).toBe(true);
      expect(readUiLock()).toBeNull();
    } finally {
      server.close();
      try { child.kill('SIGKILL'); } catch {}
    }
  });
});
