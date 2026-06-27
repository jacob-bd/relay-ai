import { createServer } from 'node:http';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import pc from 'picocolors';
import { getAppHome } from './paths.js';
import { handleUiApiRequest } from './ui/api.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'ui', 'public');
const LOCK_FILE = join(getAppHome(), 'ui.lock');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
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
      if (mime) cache.set(`/${name}`, { content: readFileSync(join(PUBLIC_DIR, name)), mime });
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

export async function runUiCommand(): Promise<number> {
  const existing = checkExistingServer();
  if (existing) {
    console.log(`\n  ${pc.bold('relay-ai UI')} already running at ${pc.cyan(existing)}\n`);
    return 0;
  }

  const staticCache = buildStaticCache();

  const server = createServer((req, res) => {
    const url = req.url ?? '/';

    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (url.startsWith('/api/')) {
      handleUiApiRequest(req, res);
      return;
    }

    const key = url === '/' ? '/index.html' : url.split('?')[0];
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
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  console.log(`\n  ${pc.bold('relay-ai UI')}  ${pc.cyan(url)}\n  ${pc.dim('Press Ctrl+C to stop')}\n`);

  try {
    const { default: open } = await import('open');
    await open(url);
  } catch {
    // Browser couldn't open — URL already printed above
  }

  await new Promise<void>(() => {}); // keep alive until signal
  return 0;
}
