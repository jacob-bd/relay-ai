// src/launch.ts
import { execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const FALLBACK_PATHS = [
  join(homedir(), '.local', 'bin', 'claude'),
  join(homedir(), '.npm', 'bin', 'claude'),
  '/usr/local/bin/claude',
  '/opt/homebrew/bin/claude',
];

export function findClaudeBinary(): string | null {
  try {
    const result = execSync('which claude', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const path = result.trim();
    if (path) return path;
  } catch {
    // `which` failed — try fallback paths
  }
  for (const path of FALLBACK_PATHS) {
    if (existsSync(path)) return path;
  }
  return null;
}

export function launchClaude(
  env: NodeJS.ProcessEnv,
  model: string,
  extraArgs: string[],
): Promise<number> {
  return new Promise((resolve) => {
    const claudePath = findClaudeBinary()!;
    const args = ['--model', model, ...extraArgs];

    const child = spawn(claudePath, args, {
      stdio: 'inherit',
      env,
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
