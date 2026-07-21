import { createServer } from 'node:http';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import pc from 'picocolors';
import * as p from '@clack/prompts';
import { getAppHome } from './paths.js';
import { handleUiApiRequest, type UiServerLifecycleEvent } from './ui/api.js';
import { getUiDebugLogPath, makeTraceLogger } from './trace-log.js';
import { VERSION } from './constants.js';
import { ensureOpencodeCloudProviders } from './registry/crud.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'ui', 'public');
const LOCK_FILE = join(getAppHome(), 'ui.lock');
const DEFAULT_SERVER_UI_PORT = 8787;

export type UiMode = 'full' | 'server';

export interface UiCommandOptions {
  trace?: boolean;
  /** Admin UI without app launch — for Docker / always-on gateway boxes. */
  serverMode?: boolean;
  /** Override listen port (server mode defaults to 8787). */
  port?: number;
}

export interface UiRuntimeConfig {
  mode: UiMode;
  host: string;
  port: number;
  openBrowser: boolean;
  confirmShutdownOnSigint: boolean;
}

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
      openBrowser: false,
      confirmShutdownOnSigint: false,
    };
  }
  return {
    mode,
    host: '127.0.0.1',
    port: opts.port ?? 0,
    openBrowser: true,
    confirmShutdownOnSigint: true,
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

function removeLock(): void {
  try { unlinkSync(LOCK_FILE); } catch {}
}

function checkExistingServer(): string | null {
  if (!existsSync(LOCK_FILE)) return null;
  try {
    const { pid, port } = JSON.parse(readFileSync(LOCK_FILE, 'utf8'));
    process.kill(pid, 0);
    return `http://127.0.0.1:${port}`;
  } catch {
    removeLock();
    return null;
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

export async function runUiCommand(opts: UiCommandOptions = {}): Promise<number> {
  const runtime = resolveUiRuntimeConfig(opts);

  // Docker / empty RELAY_AI_HOME: seed Zen/Go once at UI boot (not on every catalog load).
  await ensureOpencodeCloudProviders();

  const existing = checkExistingServer();
  if (existing) {
    console.log(`\n  ${pc.bold('relay-ai UI')} already running at ${pc.cyan(existing)}\n`);
    return 0;
  }

  if (opts.trace) {
    process.env.RELAY_AI_TRACE = '1';
  }

  const staticCache = buildStaticCache(runtime.mode);
  const traceLogPath = opts.trace ? getUiDebugLogPath() : undefined;
  const trace = traceLogPath ? makeTraceLogger(traceLogPath) : undefined;
  trace?.(`ui server starting mode=${runtime.mode}`);

  const server = createServer((req, res) => {
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

  await new Promise<void>((resolve, reject) => {
    server.listen(runtime.port, runtime.host, () => resolve());
    server.once('error', reject);
  });

  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    console.error('Failed to bind server');
    return 1;
  }

  const port = addr.port;
  const displayHost = runtime.host === '0.0.0.0' ? '127.0.0.1' : runtime.host;
  const url = `http://${displayHost}:${port}`;

  mkdirSync(getAppHome(), { recursive: true });
  writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, port, mode: runtime.mode }));

  const cleanup = () => {
    removeLock();
    server.close();
    process.exit(0);
  };
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

  const modeLabel = runtime.mode === 'server' ? ' (server admin)' : '';
  console.log(`\n  ${pc.bold('relay-ai UI')}${modeLabel}  ${pc.cyan(url)}\n  ${pc.dim('Press Ctrl+C to stop')}\n`);
  if (runtime.mode === 'server') {
    console.log(`  ${pc.dim('Gateway API (when started from Server tab): http://127.0.0.1:17645')}\n`);
  }
  if (traceLogPath) {
    console.log(`  ${pc.dim(`Trace log: ${traceLogPath}`)}\n`);
    trace?.(`ui server listening ${url}`);
  }

  if (runtime.openBrowser) {
    try {
      const { default: open } = await import('open');
      await open(url);
      trace?.(`browser open ${url}`);
    } catch {
      trace?.(`browser open failed ${url}`);
    }
  }

  await new Promise<void>(() => {}); // keep alive until signal
  return 0;
}
