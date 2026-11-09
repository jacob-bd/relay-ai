// src/gemini/launch.ts
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { getAppPathOverride } from '../config.js';
import { findBinaryOnPath } from '../binary-lookup.js';
import { printUiUrlLast } from '../ui-background.js';

const isWindows = process.platform === 'win32';
const GEMINI_API_KEY_AUTH_TYPE = 'gemini-api-key';

const GEMINI_FALLBACK_PATHS = isWindows
  ? [
      join(process.env['APPDATA'] ?? homedir(), 'npm', 'gemini.cmd'),
      join(process.env['APPDATA'] ?? homedir(), 'npm', 'gemini'),
    ]
  : [
      join(homedir(), '.local', 'bin', 'gemini'),
      join(homedir(), '.npm', 'bin', 'gemini'),
      '/usr/local/bin/gemini',
      '/opt/homebrew/bin/gemini',
    ];

export function findGeminiBinary(): string | null {
  const override = getAppPathOverride('gemini');
  if (override) return existsSync(override) ? override : null;

  return findBinaryOnPath('gemini', GEMINI_FALLBACK_PATHS);
}

export function buildGeminiChildEnv(proxyPort: number, proxyToken: string): NodeJS.ProcessEnv {
  const env = { ...process.env };

  // Isolate by removing any conflicting/existing credentials
  delete env['GOOGLE_GEMINI_BASE_URL'];
  delete env['GEMINI_API_KEY'];
  delete env['GOOGLE_API_KEY'];
  delete env['GOOGLE_GENAI_API_KEY'];

  // Route to the local proxy
  env['GOOGLE_GEMINI_BASE_URL'] = `http://127.0.0.1:${proxyPort}`;
  env['GEMINI_API_KEY'] = proxyToken;
  env['GEMINI_DEFAULT_AUTH_TYPE'] = GEMINI_API_KEY_AUTH_TYPE;

  return env;
}

export interface PreparedGeminiChildEnv {
  env: NodeJS.ProcessEnv;
  cleanup: () => void;
}

export function createGeminiCliHomeOverlay(): string {
  const cliHome = mkdtempSync(join(tmpdir(), 'relay-ai-gemini-'));
  const settings = {
    security: {
      auth: {
        selectedType: GEMINI_API_KEY_AUTH_TYPE,
      },
    },
  };
  // GEMINI_CLI_HOME replaces os.homedir() inside Gemini CLI, so it reads
  // settings from $GEMINI_CLI_HOME/.gemini/settings.json — the overlay file
  // must live inside a .gemini subdirectory or it is silently ignored and
  // the CLI shows its first-run auth picker.
  const geminiDir = join(cliHome, '.gemini');
  mkdirSync(geminiDir);
  writeFileSync(join(geminiDir, 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  return cliHome;
}

export function prepareGeminiChildEnv(proxyPort: number, proxyToken: string): PreparedGeminiChildEnv {
  const cliHome = createGeminiCliHomeOverlay();
  const env = buildGeminiChildEnv(proxyPort, proxyToken);
  env['GEMINI_CLI_HOME'] = cliHome;

  return {
    env,
    cleanup: () => {
      try {
        rmSync(cliHome, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup; the temp overlay contains no real credentials.
      }
    },
  };
}

export function launchGemini(
  geminiPath: string,
  modelId: string,
  env: NodeJS.ProcessEnv,
  extraArgs: string[],
): Promise<number> {
  printUiUrlLast();
  return new Promise((resolve) => {
    // Instruct the Gemini CLI to use the chosen model via -m flag
    const args = ['-m', modelId, ...extraArgs];
    const child = spawn(geminiPath, args, {
      stdio: 'inherit',
      env,
      shell: isWindows,
    });

    const onSigInt = () => child.kill('SIGINT');
    const onSigTerm = () => child.kill('SIGTERM');
    process.once('SIGINT', onSigInt);
    process.once('SIGTERM', onSigTerm);

    const done = (code: number) => {
      process.off('SIGINT', onSigInt);
      process.off('SIGTERM', onSigTerm);
      resolve(code);
    };

    child.on('error', () => done(1));
    child.on('exit', (code) => done(code ?? 0));
  });
}
