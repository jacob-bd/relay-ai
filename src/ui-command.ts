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

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'ui', 'public');
const LOCK_FILE = join(getAppHome(), 'ui.lock');

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

function buildStaticCache(): Map<string, { content: Buffer; mime: string }> {
  const cache = new Map<string, { content: Buffer; mime: string }>();
  try {
    for (const name of readdirSync(PUBLIC_DIR)) {
      const mime = MIME[ext(name)];
      if (!mime) continue;
      const raw = readFileSync(join(PUBLIC_DIR, name));
      const content = name === 'index.html' ? Buffer.from(raw.toString('utf8').replace('{{VERSION}}', VERSION)) : raw;
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
): Promise<'close' | 'keep'> {
  if (signal !== 'SIGINT') return 'close';
  const shouldClose = await promptClose();
  if (p.isCancel(shouldClose)) return 'close';
  return shouldClose ? 'close' : 'keep';
}

export async function runUiCommand(opts: { trace?: boolean } = {}): Promise<number> {
  const existing = checkExistingServer();
  if (existing) {
    console.log(`\n  ${pc.bold('relay-ai UI')} already running at ${pc.cyan(existing)}\n`);
    return 0;
  }

  if (opts.trace) {
    process.env.RELAY_AI_TRACE = '1';
  }

  const staticCache = buildStaticCache();
  const traceLogPath = opts.trace ? getUiDebugLogPath() : undefined;
  const trace = traceLogPath ? makeTraceLogger(traceLogPath) : undefined;
  trace?.('ui server starting');

  const server = createServer((req, res) => {
    const url = req.url ?? '/';

    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (isUiApiRoute(url)) {
      handleUiApiRequest(req, res, {
        trace: opts.trace,
        traceLogPath,
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
    server.listen(0, '127.0.0.1', () => resolve());
    server.once('error', reject);
  });

  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    console.error('Failed to bind server');
    return 1;
  }

  const port = addr.port;
  const url = `http://127.0.0.1:${port}`;

  mkdirSync(getAppHome(), { recursive: true });
  writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, port }));

  const cleanup = () => {
    removeLock();
    server.close();
    process.exit(0);
  };
  let handlingSignal = false;
  const handleSignal = async (signal: NodeJS.Signals) => {
    if (handlingSignal) return;
    handlingSignal = true;
    const decision = await resolveUiShutdownDecision(signal);
    if (decision === 'keep') {
      handlingSignal = false;
      return;
    }
    cleanup();
  };
  process.on('SIGINT', () => { void handleSignal('SIGINT'); });
  process.on('SIGTERM', () => { void handleSignal('SIGTERM'); });

  console.log(`\n  ${pc.bold('relay-ai UI')}  ${pc.cyan(url)}\n  ${pc.dim('Press Ctrl+C to stop')}\n`);
  if (traceLogPath) {
    console.log(`  ${pc.dim(`Trace log: ${traceLogPath}`)}\n`);
    trace?.(`ui server listening ${url}`);
  }

  try {
    const { default: open } = await import('open');
    await open(url);
    trace?.(`browser open ${url}`);
  } catch {
    trace?.(`browser open failed ${url}`);
    // Browser couldn't open — URL already printed above
  }

  await new Promise<void>(() => {}); // keep alive until signal
  return 0;
}
