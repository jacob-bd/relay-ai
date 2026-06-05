// src/launch.ts
import { execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const isWindows = process.platform === 'win32';

const FALLBACK_PATHS = isWindows
  ? [
      join(process.env['APPDATA'] ?? homedir(), 'npm', 'claude.cmd'),
      join(process.env['APPDATA'] ?? homedir(), 'npm', 'claude'),
      join(homedir(), 'AppData', 'Roaming', 'npm', 'claude.cmd'),
    ]
  : [
      join(homedir(), '.local', 'bin', 'claude'),
      join(homedir(), '.npm', 'bin', 'claude'),
      '/usr/local/bin/claude',
      '/opt/homebrew/bin/claude',
    ];

export function findClaudeBinary(): string | null {
  try {
    const result = execSync(isWindows ? 'where.exe claude' : 'which claude', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    // where.exe returns one result per line — take the first
    const path = result.trim().split('\n')[0].trim();
    if (path) return path;
  } catch {
    // command failed — try fallback paths
  }
  for (const path of FALLBACK_PATHS) {
    if (existsSync(path)) return path;
  }
  return null;
}

export function buildClaudeArgs(model: string, extraArgs: string[]): string[] {
  return ['--model', model, ...extraArgs];
}

export function launchClaude(
  env: NodeJS.ProcessEnv,
  model: string,
  extraArgs: string[],
): Promise<number> {
  return new Promise((resolve) => {
    const claudePath = findClaudeBinary()!;
    const args = buildClaudeArgs(model, extraArgs);

    const child = spawn(claudePath, args, {
      stdio: 'inherit',
      env,
      shell: isWindows,
    });

    const forward = (signal: NodeJS.Signals): void => {
      child.kill(signal);
    };

    process.once('SIGINT', () => forward('SIGINT'));
    process.once('SIGTERM', () => forward('SIGTERM'));

    child.on('exit', (code) => {
      resolve(code ?? 0);
    });
  });
}
