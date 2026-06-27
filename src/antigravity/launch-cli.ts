import { execFileSync, execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const isWindows = process.platform === 'win32';

const FALLBACK_PATHS = isWindows
  ? [
      join(process.env['APPDATA'] ?? homedir(), 'npm', 'agy.cmd'),
      join(process.env['APPDATA'] ?? homedir(), 'npm', 'agy'),
      join(homedir(), 'AppData', 'Roaming', 'npm', 'agy.cmd'),
    ]
  : [
      join(homedir(), '.local', 'bin', 'agy'),
      join(homedir(), '.npm', 'bin', 'agy'),
      '/usr/local/bin/agy',
      '/opt/homebrew/bin/agy',
    ];

export function findAntigravityCliBinary(): string | null {
  try {
    const result = execSync(isWindows ? 'where.exe agy' : 'which agy', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const path = result.trim().split('\n')[0]?.trim();
    if (path) return path;
  } catch {
    // command failed — try fallback paths
  }
  for (const path of FALLBACK_PATHS) {
    if (existsSync(path)) return path;
  }
  return null;
}

export interface AntigravityCliVersionResult {
  version: string | null;
  raw?: string;
  error?: string;
}

export function readAntigravityCliVersion(binaryPath = findAntigravityCliBinary() ?? undefined): AntigravityCliVersionResult {
  if (!binaryPath) {
    return { version: null, error: 'Antigravity CLI binary "agy" not found' };
  }

  try {
    const raw = execFileSync(binaryPath, ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    const version = raw.match(/\d+\.\d+\.\d+/)?.[0] ?? null;
    return version
      ? { version, raw }
      : { version: null, raw, error: `Unexpected agy --version output: ${raw}` };
  } catch (err) {
    return {
      version: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function launchAntigravityCli(
  env: NodeJS.ProcessEnv,
  extraArgs: string[],
): Promise<number> {
  return new Promise((resolve) => {
    const binaryPath = findAntigravityCliBinary();
    if (!binaryPath) {
      console.error('Antigravity CLI binary "agy" not found.');
      resolve(127);
      return;
    }

    const child = spawn(binaryPath, extraArgs, {
      stdio: 'inherit',
      env,
      shell: isWindows,
    });

    const forward = (signal: NodeJS.Signals): void => {
      child.kill(signal);
    };

    const handleSIGINT = (): void => forward('SIGINT');
    const handleSIGTERM = (): void => forward('SIGTERM');
    const cleanup = (): void => {
      process.removeListener('SIGINT', handleSIGINT);
      process.removeListener('SIGTERM', handleSIGTERM);
    };
    process.once('SIGINT', handleSIGINT);
    process.once('SIGTERM', handleSIGTERM);

    child.on('exit', (code) => {
      cleanup();
      resolve(code ?? 1);
    });

    child.on('error', (err) => {
      cleanup();
      console.error(`Failed to launch Antigravity CLI: ${err.message}`);
      resolve(1);
    });
  });
}
