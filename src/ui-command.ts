import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import pc from 'picocolors';
import * as p from '@clack/prompts';
import {
  DEFAULT_SERVER_UI_PORT, checkExistingServer, formatUiAvailableLine, readUiLock, removeLock, removeOwnUiLock, writeUiLock,
} from './ui-lock.js';
import { handleUiApiRequest, type UiServerLifecycleEvent } from './ui/api.js';
import { getUiDebugLogPath, makeTraceLogger } from './trace-log.js';
import { VERSION } from './constants.js';
import { ensureOpencodeCloudProviders } from './registry/crud.js';
import { resolveServerAutostart } from './config.js';
import { startGatewayServerFromSavedConfig } from './ui/server-control.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'ui', 'public');

export { checkExistingServer, probeServerHealth } from './ui-lock.js';

export type UiMode = 'full' | 'server';

export interface UiCommandOptions {
  trace?: boolean;
  /** Admin UI without app launch — for Docker / always-on gateway boxes. */
  serverMode?: boolean;
  /** Override listen port (server mode defaults to 8787). */
  port?: number;
  /** Detached UI started next to a tool launch: no browser, no terminal prompts. */
  background?: boolean;
}

export interface UiRuntimeConfig {
  mode: UiMode;
  host: string;
  port: number;
  /** Use a random free port when `port` is taken. False when the user asked for that exact port. */
  fallbackToRandomPort: boolean;
  openBrowser: boolean;
  confirmShutdownOnSigint: boolean;
}

/** Stable default for the full UI so the browser origin (bookmarks, saved logins) survives restarts. */
export const DEFAULT_FULL_UI_PORT = 17646;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

function ext(path: string): string {
  const i = path.lastIndexOf('.');
  return i >= 0 ? path.slice(i) : '';
}

/** Resolve UI mode from opts + env (`RELAY_AI_UI_MODE=server`). */
export function resolveUiMode(opts: UiCommandOptions = {}, env: NodeJS.ProcessEnv = process.env): UiMode {
  if (opts.serverMode) return 'server';
  return env.RELAY_AI_UI_MODE === 'server' ? 'server' : 'full';
}

function resolveServerUiPort(opts: UiCommandOptions, env: NodeJS.ProcessEnv): number {
  if (opts.port != null) return opts.port;
  const envPort = Number(env.RELAY_AI_UI_PORT);
  return Number.isFinite(envPort) && envPort > 0 ? envPort : DEFAULT_SERVER_UI_PORT;
}

export function resolveUiRuntimeConfig(
  opts: UiCommandOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): UiRuntimeConfig {
  const mode = resolveUiMode(opts, env);
  if (mode === 'server') {
    return {
      mode,
      host: '0.0.0.0',
      port: resolveServerUiPort(opts, env),
      fallbackToRandomPort: false,
      openBrowser: false,
      confirmShutdownOnSigint: false,
    };
  }
  const envPort = Number(env.RELAY_AI_UI_PORT);
  const requested = opts.port ?? (Number.isInteger(envPort) && envPort > 0 && envPort < 65536 ? envPort : undefined);
  return {
    mode,
    host: '127.0.0.1',
    port: requested ?? DEFAULT_FULL_UI_PORT,
    fallbackToRandomPort: requested === undefined,
    openBrowser: !opts.background,
    confirmShutdownOnSigint: !opts.background,
  };
}

function buildStaticCache(mode: UiMode): Map<string, { content: Buffer; mime: string }> {
  const cache = new Map<string, { content: Buffer; mime: string }>();
  try {
    for (const name of readdirSync(PUBLIC_DIR)) {
      const mime = MIME[ext(name)];
      if (!mime) continue;
      const raw = readFileSync(join(PUBLIC_DIR, name));
      let content = raw;
      if (name === 'index.html') {
        content = Buffer.from(
          raw.toString('utf8')
            .replaceAll('{{VERSION}}', VERSION)
            .replaceAll('{{UI_MODE}}', mode),
        );
      }
      cache.set(`/${name}`, { content, mime });
    }
  } catch {}
  return cache;
}

export async function openUiInBrowser(url: string): Promise<boolean> {
  try {
    const { default: open } = await import('open');
    await open(url);
    return true;
  } catch {
    return false;
  }
}

export function isUiApiRoute(url: string): boolean {
  return url.startsWith('/api/') || url.startsWith('/oauth/callback');
}

export function formatUiServerLifecycleMessage(event: UiServerLifecycleEvent): string {
  if (event.type === 'stopped') return '◇ Server Gateway stopped';
  const mode = event.listenMode === 'network' ? 'Network' : 'Local';
  const modelLabel = event.modelCount === 1 ? 'model' : 'models';
  return `◆ Server Gateway started · ${mode} mode · ${event.modelCount} ${modelLabel} exposed`;
}

export async function resolveUiShutdownDecision(
  signal: NodeJS.Signals,
  promptClose: () => Promise<boolean | symbol> = () => p.confirm({
    message: 'Relay-AI UI is still running. Close it?',
    initialValue: true,
  }),
  opts?: { confirmOnSigint?: boolean },
): Promise<'close' | 'keep'> {
  const confirmOnSigint = opts?.confirmOnSigint !== false;
  if (signal !== 'SIGINT' || !confirmOnSigint) return 'close';
  const shouldClose = await promptClose();
  if (p.isCancel(shouldClose)) return 'close';
  return shouldClose ? 'close' : 'keep';
}

export async function stopUiServer(): Promise<{ stopped: boolean; message: string }> {
  const lock = readUiLock();
  let pidAlive = false;
  if (typeof lock?.pid === 'number' && lock.pid !== process.pid) {
    try {
      process.kill(lock.pid, 0);
      pidAlive = true;
    } catch {}
  }

  const existing = await checkExistingServer();
  if (!existing && !pidAlive) {
    removeLock();
    return { stopped: false, message: 'Relay UI is not running.' };
  }

  const port = lock?.port;
  const pid = lock?.pid;

  if (existing) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 800);
      await fetch(`${existing}/api/ui/shutdown`, { method: 'POST', signal: controller.signal });
      clearTimeout(timer);
    } catch {}
  }

  if (pidAlive && typeof pid === 'number') {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {}
  }

  removeLock();
  return { stopped: true, message: `Relay UI stopped${port ? ` (port ${port})` : ''}.` };
}

export async function runUiCommand(opts: UiCommandOptions = {}): Promise<number> {
  const runtime = resolveUiRuntimeConfig(opts);

  // Docker / empty RELAY_AI_HOME: seed Zen/Go once at UI boot (not on every catalog load).
  await ensureOpencodeCloudProviders();

  const existing = await checkExistingServer();
  if (existing) {
    if (opts.background) return 0;
    if (runtime.openBrowser) await openUiInBrowser(existing);
    console.log(`\n  ${pc.dim('Relay UI is already running — connected to it.')}`);
    console.log(`${formatUiAvailableLine(existing)}`);
    console.log(`  ${pc.dim('To shut it down, run: relay-ai ui stop')}\n`);
    return 0;
  }

  if (opts.trace) {
    process.env.RELAY_AI_TRACE = '1';
  }

  const staticCache = buildStaticCache(runtime.mode);
  const traceLogPath = opts.trace ? getUiDebugLogPath() : undefined;
  const trace = traceLogPath ? makeTraceLogger(traceLogPath) : undefined;
  trace?.(`ui server starting mode=${runtime.mode}`);

  let server: ReturnType<typeof createServer> | null = null;
  const cleanup = () => {
    removeOwnUiLock();
    server?.close();
    process.exit(0);
  };

  server = createServer((req, res) => {
    const url = req.url ?? '/';

    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (isUiApiRoute(url)) {
      handleUiApiRequest(req, res, {
        trace: opts.trace,
        traceLogPath,
        uiMode: runtime.mode,
        onServerLifecycle: event => {
          console.log(`\n  ${formatUiServerLifecycleMessage(event)}\n`);
        },
        onShutdown: cleanup,
      });
      return;
    }

    const key = url === '/' ? '/index.html' : url.split('?')[0];
    trace?.(`static ${req.method ?? 'GET'} ${url} -> ${key}`);
    const cached = staticCache.get(key);
    if (cached) {
      res.writeHead(200, { 'Content-Type': cached.mime });
      res.end(cached.content);
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  const listenOn = (port: number) => new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, runtime.host, () => { server.off('error', reject); resolve(); });
  });
  try {
    await listenOn(runtime.port);
  } catch (err) {
    // Preferred port taken by something else: keep working on a random one rather than failing.
    if (!runtime.fallbackToRandomPort || (err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err;
    trace?.(`ui port ${runtime.port} in use, falling back to a random port`);
    await listenOn(0);
  }

  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    console.error('Failed to bind server');
    return 1;
  }

  const port = addr.port;
  const displayHost = runtime.host === '0.0.0.0' ? '127.0.0.1' : runtime.host;
  const url = `http://${displayHost}:${port}`;

  writeUiLock(port, runtime.mode, opts.background === true);

  if (resolveServerAutostart()) {
    startGatewayServerFromSavedConfig().catch(err => {
      trace?.(`gateway autostart error: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  let handlingSignal = false;
  const handleSignal = async (signal: NodeJS.Signals) => {
    if (handlingSignal) return;
    handlingSignal = true;
    const decision = await resolveUiShutdownDecision(
      signal,
      undefined,
      { confirmOnSigint: runtime.confirmShutdownOnSigint },
    );
    if (decision === 'keep') {
      handlingSignal = false;
      return;
    }
    cleanup();
  };
  process.on('SIGINT', () => { void handleSignal('SIGINT'); });
  process.on('SIGTERM', () => { void handleSignal('SIGTERM'); });

  if (runtime.openBrowser) {
    const opened = await openUiInBrowser(url);
    trace?.(`browser open ${opened ? '' : 'failed '}${url}`);
  }

  const modeLabel = runtime.mode === 'server' ? 'Server admin UI · ' : '';
  console.log(`\n  ${pc.dim(`${modeLabel}Press Ctrl+C to stop`)}`);
  if (runtime.mode === 'server') {
    console.log(`  ${pc.dim('Gateway API (when started from Server tab): http://127.0.0.1:17645')}`);
  }
  if (traceLogPath) {
    console.log(`  ${pc.dim(`Trace log: ${traceLogPath}`)}`);
    trace?.(`ui server listening ${url}`);
  }
  console.log(`${formatUiAvailableLine(url)}\n`);

  await new Promise<void>(() => {}); // keep alive until signal
  return 0;
}
