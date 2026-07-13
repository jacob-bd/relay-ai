// src/launch.ts
import { execSync, spawn } from 'node:child_process';
import { existsSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getAppPathOverride } from './config.js';
import { findBinaryOnPath } from './binary-lookup.js';

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
  const override = getAppPathOverride('claude');
  if (override) return existsSync(override) ? override : null;

  return findBinaryOnPath('claude', FALLBACK_PATHS);
}

export function getInstalledClaudeVersion(): string {
  try {
    const claudePath = findClaudeBinary();
    if (!claudePath) return '2.1.183';
    const result = execSync(`${isWindows ? `"${claudePath}"` : claudePath} --version`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const match = result.match(/(\d+\.\d+\.\d+)/);
    if (match) return match[1];
  } catch {
    // fallback
  }
  return '2.1.183'; // default fallback version known to work
}

export function buildClaudeArgs(model: string | undefined, extraArgs: string[]): string[] {
  return model ? ['--model', model, ...extraArgs] : [...extraArgs];
}

export function launchClaude(
  env: NodeJS.ProcessEnv,
  model: string | undefined,
  extraArgs: string[],
): Promise<number> {
  return new Promise((resolve) => {
    const claudePath = findClaudeBinary()!;
    const args = buildClaudeArgs(model, extraArgs);

    const debugFileIdx = extraArgs.indexOf('--debug-file');
    const debugLogPath = debugFileIdx !== -1 && extraArgs[debugFileIdx + 1] ? extraArgs[debugFileIdx + 1] : undefined;

    const originalStdoutWrite = process.stdout.write;
    const originalStderrWrite = process.stderr.write;

    const muteWrite = (chunk: string | Uint8Array, encoding?: any, callback?: any) => {
      if (typeof encoding === 'function') {
        callback = encoding;
      }
      if (debugLogPath) {
        try {
          const str = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
          appendFileSync(debugLogPath, `[parent] ${str}`);
        } catch {
          // ignore
        }
      }
      if (callback) callback();
      return true;
    };

    process.stdout.write = muteWrite as any;
    process.stderr.write = muteWrite as any;

    const restore = () => {
      process.stdout.write = originalStdoutWrite;
      process.stderr.write = originalStderrWrite;
    };

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
      restore();
      resolve(code ?? 0);
    });

    child.on('error', (err) => {
      restore();
      resolve(1);
    });
  });
}
