import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { prepareIdeProfile } from './ide-profile.js';

type ProcessListOptions = {
  processList?: () => string;
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function defaultProcessList(): string {
  if (process.platform !== 'darwin') return '';
  return execFileSync('ps', ['-axo', 'pid=,command='], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 1024 * 1024 * 4,
  });
}

export function isAntigravityIdeRunning(profileDir: string, processList = defaultProcessList): boolean {
  const output = processList();
  return output
    .split('\n')
    .some(line => line.includes('Antigravity IDE.app') && line.includes(`--user-data-dir=${profileDir}`));
}

export async function waitForAntigravityIdeQuit(
  profileDir: string,
  options: ProcessListOptions & { timeoutMs?: number; pollIntervalMs?: number } = {},
): Promise<boolean> {
  const processList = options.processList ?? defaultProcessList;
  const deadline = Date.now() + (options.timeoutMs ?? 5_000);
  const pollIntervalMs = options.pollIntervalMs ?? 200;
  while (Date.now() < deadline) {
    if (!isAntigravityIdeRunning(profileDir, processList)) return true;
    await sleep(pollIntervalMs);
  }
  return !isAntigravityIdeRunning(profileDir, processList);
}

export function quitAntigravityIdeGracefully(): void {
  if (process.platform !== 'darwin') return;
  try {
    execFileSync('osascript', ['-e', 'tell application "Antigravity IDE" to quit'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    execFileSync('osascript', ['-e', 'tell application id "com.google.antigravity-ide" to quit'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }
}

/**
 * Locate the Antigravity IDE binary path.
 *
 * Currently support macOS (/Applications/Antigravity IDE.app) with fallbacks.
 * Returns null if not on macOS or if the app is not installed.
 */
export function findAntigravityIdeBinary(): string | null {
  if (process.platform !== 'darwin') return null;

  const defaultPath = '/Applications/Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide';
  if (existsSync(defaultPath)) return defaultPath;

  const homePath = join(homedir(), 'Applications', 'Antigravity IDE.app', 'Contents', 'Resources', 'app', 'bin', 'antigravity-ide');
  if (existsSync(homePath)) return homePath;

  return null;
}

/**
 * Launch the Antigravity IDE under an isolated Relay-managed profile.
 *
 * It prepares the isolated user data directory, configures the local Cloud Code gateway URL
 * both in env and profile settings, and spawns the IDE with correct args.
 *
 * @param env Child process environment variables
 * @param profileDir Absolute path to the isolated profile directory
 * @param gatewayUrl Local gateway URL
 * @param extraArgs Passthrough args from the user
 */
export function launchAntigravityIde(
  env: NodeJS.ProcessEnv,
  profileDir: string,
  gatewayUrl: string,
  extraArgs: string[],
): Promise<number> {
  return new Promise((resolve) => {
    const binaryPath = findAntigravityIdeBinary();
    if (!binaryPath) {
      console.error('Antigravity IDE app bundle not found at "/Applications/Antigravity IDE.app".');
      console.error('Please make sure Antigravity IDE is installed on your Mac.');
      resolve(127);
      return;
    }

    // 1. Prepare the isolated profile and set jetski.cloudCodeUrl
    prepareIdeProfile(profileDir, gatewayUrl);

    // 2. Build VS Code arguments
    // Keep Relay's Antigravity profile fully isolated from the normal IDE profile.
    const relayExtensionsDir = join(homedir(), '.relay-ai', 'antigravity', 'extensions');
    const args = [
      `--user-data-dir=${profileDir}`,
      `--extensions-dir=${relayExtensionsDir}`,
      ...extraArgs,
    ];

    const child = spawn(binaryPath, args, {
      stdio: 'inherit',
      env,
    });

    child.on('exit', (code) => {
      resolve(code ?? 1);
    });

    child.on('error', (err) => {
      console.error(`Failed to launch Antigravity IDE: ${err.message}`);
      resolve(1);
    });
  });
}
