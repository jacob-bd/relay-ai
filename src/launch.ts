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

/**
 * Node's child_process.spawn does NOT escape arguments when { shell: true } is
 * used (documented Node behavior) — cmd.exe re-tokenizes the command line on
 * whitespace, so any multi-word argument (e.g. a -p prompt) silently gets cut
 * down to its first word. .cmd/.bat launchers (claude.cmd on Windows) require
 * shell: true to spawn at all, so args must be pre-quoted for cmd.exe here.
 * Quotes only when needed; doubles embedded double-quotes (cmd.exe's escaping
 * rule), matching the common case — not a full CommandLineToArgvW-equivalent
 * parser for every edge case (e.g. trailing backslashes before a quote).
 */
export function quoteForWindowsShell(arg: string): string {
  if (arg === '') return '""';
  if (!/[\s"^&|<>()]/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '""')}"`;
}

export function launchClaude(
  env: NodeJS.ProcessEnv,
  model: string | undefined,
  extraArgs: string[],
): Promise<number> {
  return new Promise((resolve) => {
    const claudePath = findClaudeBinary()!;
    const rawArgs = buildClaudeArgs(model, extraArgs);
    const args = isWindows ? rawArgs.map(quoteForWindowsShell) : rawArgs;

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

    const onSigint = () => forward('SIGINT');
    const onSigterm = () => forward('SIGTERM');
    const onSighup = () => forward('SIGHUP');
    const cleanup = () => {
      restore();
      process.off('SIGINT', onSigint);
      process.off('SIGTERM', onSigterm);
      process.off('SIGHUP', onSighup);
    };

    process.once('SIGINT', onSigint);
    process.once('SIGTERM', onSigterm);
    process.once('SIGHUP', onSighup);

    child.on('exit', (code) => {
      cleanup();
      resolve(code ?? 0);
    });

    child.on('error', (err) => {
      cleanup();
      resolve(1);
    });
  });
}
