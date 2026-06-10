// opencode-serve.ts — import-only OpenCode binary discovery + ephemeral `opencode serve`

import { execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { LocalProvider } from './types.js';
import { normalizeProviders, type RawProvider } from './providers.js';

const isWindows = process.platform === 'win32';

const OPENCODE_FALLBACK_PATHS = isWindows
  ? [
      join(process.env['APPDATA'] ?? homedir(), 'npm', 'opencode.cmd'),
      join(process.env['APPDATA'] ?? homedir(), 'npm', 'opencode'),
      join(homedir(), 'AppData', 'Roaming', 'npm', 'opencode.cmd'),
    ]
  : [
      join(homedir(), '.opencode', 'bin', 'opencode'),
      join(homedir(), '.local', 'bin', 'opencode'),
      join(homedir(), '.npm', 'bin', 'opencode'),
      '/usr/local/bin/opencode',
      '/opt/homebrew/bin/opencode',
    ];

export function findOpencodeBinary(): string | null {
  try {
    const result = execSync(isWindows ? 'where.exe opencode' : 'which opencode', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const path = result.trim().split('\n')[0].trim();
    if (path) return path;
  } catch {
    // command failed — try fallback paths
  }
  for (const path of OPENCODE_FALLBACK_PATHS) {
    if (existsSync(path)) return path;
  }
  return null;
}

/** Spawn ephemeral `opencode serve`, fetch /config/providers, normalize. Import path only. */
export async function fetchLocalProviders(): Promise<LocalProvider[] | null> {
  const binary = findOpencodeBinary();
  if (!binary) return null;

  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn> | null = null;
    let settled = false;
    const TIMEOUT_MS = 10_000;

    const finish = (value: LocalProvider[] | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child?.kill();
      } catch {
        // ignore
      }
      resolve(value);
    };

    const timer = setTimeout(() => {
      finish(null);
    }, TIMEOUT_MS);

    try {
      child = spawn(binary, ['serve', '--port', '0'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      finish(null);
      return;
    }

    const portRegex = /opencode server listening on http:\/\/127\.0\.0\.1:(\d+)/;
    let portFound = false;
    let stdoutBuf = '';

    const onData = (chunk: Buffer): void => {
      if (portFound) return;
      stdoutBuf += chunk.toString();
      const match = portRegex.exec(stdoutBuf);
      if (!match) return;
      portFound = true;
      const port = match[1];

      fetch(`http://127.0.0.1:${port}/config/providers`)
        .then((res) => res.json())
        .then((data: unknown) => {
          const raw = (data as { providers?: RawProvider[] }).providers;
          if (!Array.isArray(raw)) { finish(null); return; }
          const providers = normalizeProviders(raw);
          finish(providers);
        })
        .catch(() => {
          finish(null);
        });
    };

    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);

    child.on('error', () => {
      finish(null);
    });

    child.on('exit', () => {
      if (!settled) finish(null);
    });
  });
}
