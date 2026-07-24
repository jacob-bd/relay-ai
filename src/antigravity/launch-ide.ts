import { execFileSync, execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { prepareIdeProfile } from './ide-profile.js';
import { getAppPathOverride } from '../config.js';

type ProcessListOptions = {
  processList?: () => string;
};

// Fixed profile dirs the orchestrator (antigravity.ts) launches under, mirrored
// here so the graceful-quit helpers (which take no profileDir arg) can scope the
// Linux kill to exactly the relay-managed instance and never the user's own.
const LINUX_APP_PROFILE_DIR = join(homedir(), '.relay-ai', 'antigravity', 'app-profile');
const LINUX_IDE_PROFILE_DIR = join(homedir(), '.relay-ai', 'antigravity', 'profile');

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * On Linux, Antigravity ships as a single VS Code-fork Electron binary. The app
 * and IDE commands both launch it; they are disambiguated only by --user-data-dir.
 * We launch this binary directly (matching the .desktop Exec=) rather than the
 * /usr/bin/antigravity CLI wrapper, which would open a different process.
 */
function linuxAntigravityBinary(): string | null {
  const candidates = [
    '/usr/share/antigravity/antigravity',
    '/opt/antigravity/antigravity',
    join(homedir(), '.local', 'share', 'antigravity', 'antigravity'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Signal every process whose command line carries our managed --user-data-dir.
 * Scoping by profile dir (not binary name) is what keeps this from touching the
 * user's own Antigravity — the relay app/IDE profile dirs are distinct constants.
 */
function linuxKillByProfile(profileDir: string, signal: NodeJS.Signals): void {
  const output = defaultProcessList();
  for (const line of output.split('\n')) {
    if (!line.includes(`--user-data-dir=${profileDir}`)) continue;
    const pid = Number.parseInt(line.trim().split(/\s+/)[0] ?? '', 10);
    if (Number.isFinite(pid) && pid > 0) {
      try {
        process.kill(pid, signal);
      } catch {
        /* already gone */
      }
    }
  }
}

function runPowerShell(script: string): string {
  return execSync(`powershell.exe -NoProfile -Command ${JSON.stringify(script)}`, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

function winIsProcessRunningForProfile(exeName: string, profileDir: string): boolean {
  try {
    const escapedDir = profileDir.replace(/'/g, "''");
    const out = runPowerShell(
      `Get-CimInstance Win32_Process -Filter "Name='${exeName}'" | Where-Object { $_.CommandLine -like '*--user-data-dir=${escapedDir}*' } | Select-Object -ExpandProperty ProcessId`,
    );
    return out.length > 0;
  } catch {
    return false;
  }
}

function winQuitProcess(exeName: string): void {
  try {
    runPowerShell(
      `Get-Process -Name '${exeName.replace(/\.exe$/i, '')}' -ErrorAction SilentlyContinue | ForEach-Object { [void]$_.CloseMainWindow() }`,
    );
  } catch { /* ignore */ }
}

/**
 * Force-kill any still-running instance for this profile. Needed because
 * CloseMainWindow() only asks nicely — apps that minimize to the tray
 * instead of exiting on window-close will otherwise keep running with
 * the old config loaded, so a "restart" silently does nothing.
 */
function winForceQuitProcess(exeName: string, profileDir: string): void {
  try {
    const escapedDir = profileDir.replace(/'/g, "''");
    runPowerShell(
      `Get-CimInstance Win32_Process -Filter "Name='${exeName}'" | Where-Object { $_.CommandLine -like '*--user-data-dir=${escapedDir}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
    );
  } catch { /* ignore */ }
}

function defaultProcessList(): string {
  const psArgs = process.platform === 'linux'
    ? ['-eo', 'pid=,args=']   // Linux ps: -e (all), args= (full command line, no header)
    : ['-axo', 'pid=,command='];
  if (process.platform !== 'darwin' && process.platform !== 'linux') return '';
  try {
    return execFileSync('ps', psArgs, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 1024 * 1024 * 4,
    });
  } catch {
    return '';
  }
}

export function isAntigravityIdeRunning(profileDir: string, processList = defaultProcessList): boolean {
  if (process.platform === 'win32') return winIsProcessRunningForProfile('Antigravity IDE.exe', profileDir);
  const output = processList();
  if (process.platform === 'linux') {
    // Single shared binary on Linux — the profile dir is the only discriminator.
    return output.split('\n').some(line => line.includes(`--user-data-dir=${profileDir}`));
  }
  return output
    .split('\n')
    .some(line => line.includes('Antigravity IDE.app') && line.includes(`--user-data-dir=${profileDir}`));
}

export function isAntigravityAppRunning(profileDir: string, processList = defaultProcessList): boolean {
  if (process.platform === 'win32') return winIsProcessRunningForProfile('Antigravity.exe', profileDir);
  const output = processList();
  if (process.platform === 'linux') {
    // Single shared binary on Linux — the profile dir is the only discriminator.
    return output.split('\n').some(line => line.includes(`--user-data-dir=${profileDir}`));
  }
  return output
    .split('\n')
    .some(line => line.includes('Antigravity.app') && line.includes(`--user-data-dir=${profileDir}`));
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

export async function waitForAntigravityAppQuit(
  profileDir: string,
  options: ProcessListOptions & { timeoutMs?: number; pollIntervalMs?: number } = {},
): Promise<boolean> {
  const processList = options.processList ?? defaultProcessList;
  const deadline = Date.now() + (options.timeoutMs ?? 5_000);
  const pollIntervalMs = options.pollIntervalMs ?? 200;
  while (Date.now() < deadline) {
    if (!isAntigravityAppRunning(profileDir, processList)) return true;
    await sleep(pollIntervalMs);
  }
  return !isAntigravityAppRunning(profileDir, processList);
}

/** Force-kill a still-running managed Antigravity IDE process (Windows + Linux). No-op on macOS. */
export function forceQuitAntigravityIde(profileDir: string): void {
  if (process.platform === 'win32') winForceQuitProcess('Antigravity IDE.exe', profileDir);
  else if (process.platform === 'linux') linuxKillByProfile(profileDir, 'SIGKILL');
}

/** Force-kill a still-running managed standalone Antigravity process (Windows + Linux). No-op on macOS. */
export function forceQuitAntigravityApp(profileDir: string): void {
  if (process.platform === 'win32') winForceQuitProcess('Antigravity.exe', profileDir);
  else if (process.platform === 'linux') linuxKillByProfile(profileDir, 'SIGKILL');
}

export function quitAntigravityIdeGracefully(): void {
  if (process.platform === 'win32') { winQuitProcess('Antigravity IDE.exe'); return; }
  if (process.platform === 'linux') { linuxKillByProfile(LINUX_IDE_PROFILE_DIR, 'SIGTERM'); return; }
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

export function quitAntigravityAppGracefully(): void {
  if (process.platform === 'win32') { winQuitProcess('Antigravity.exe'); return; }
  if (process.platform === 'linux') { linuxKillByProfile(LINUX_APP_PROFILE_DIR, 'SIGTERM'); return; }
  if (process.platform !== 'darwin') return;
  try {
    execFileSync('osascript', ['-e', 'tell application "Antigravity" to quit'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    execFileSync('osascript', ['-e', 'tell application id "com.google.antigravity" to quit'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }
}

/**
 * Locate the standalone Antigravity app binary path (macOS + Windows + Linux).
 * Returns null if not installed or the platform is unsupported.
 */
export function findAntigravityAppBinary(): string | null {
  const override = getAppPathOverride('antigravity');
  if (override) return existsSync(override) ? override : null;

  if (process.platform === 'win32') {
    const localAppData = process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local');
    const winPath = join(localAppData, 'Programs', 'Antigravity', 'Antigravity.exe');
    return existsSync(winPath) ? winPath : null;
  }

  if (process.platform === 'linux') return linuxAntigravityBinary();

  if (process.platform !== 'darwin') return null;

  const defaultPath = '/Applications/Antigravity.app/Contents/MacOS/Antigravity';
  if (existsSync(defaultPath)) return defaultPath;

  const homePath = join(homedir(), 'Applications', 'Antigravity.app', 'Contents', 'MacOS', 'Antigravity');
  if (existsSync(homePath)) return homePath;

  return null;
}

/**
 * Locate the Antigravity IDE binary path (macOS + Windows + Linux).
 *
 * On Linux, Antigravity is a single VS Code-fork binary shared by the app and IDE
 * commands (distinguished only by --user-data-dir), so this resolves the same path.
 * Returns null if the app is not installed or the platform is unsupported.
 */
export function findAntigravityIdeBinary(): string | null {
  const override = getAppPathOverride('antigravity-ide');
  if (override) return existsSync(override) ? override : null;

  if (process.platform === 'win32') {
    const localAppData = process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local');
    const winPath = join(localAppData, 'Programs', 'Antigravity IDE', 'Antigravity IDE.exe');
    return existsSync(winPath) ? winPath : null;
  }

  if (process.platform === 'linux') return linuxAntigravityBinary();

  if (process.platform !== 'darwin') return null;

  const defaultPath = '/Applications/Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide';
  if (existsSync(defaultPath)) return defaultPath;

  const homePath = join(homedir(), 'Applications', 'Antigravity IDE.app', 'Contents', 'Resources', 'app', 'bin', 'antigravity-ide');
  if (existsSync(homePath)) return homePath;

  return null;
}

export function launchAntigravityApp(
  env: NodeJS.ProcessEnv,
  profileDir: string,
  gatewayUrl: string,
  extraArgs: string[],
): Promise<number> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (code: number): void => {
      if (settled) return;
      settled = true;
      resolve(code);
    };
    const binaryPath = findAntigravityAppBinary();
    if (!binaryPath) {
      console.error('Antigravity app not found.');
      console.error('Please make sure Antigravity is installed.');
      settle(127);
      return;
    }

    prepareIdeProfile(profileDir, gatewayUrl);

    const args = [
      `--user-data-dir=${profileDir}`,
      ...extraArgs,
    ];

    const child = spawn(binaryPath, args, {
      // GUI app: don't inherit the terminal's stdio (its Electron logs would
      // corrupt relay's interactive prompts) and detach into its own process
      // group so a Ctrl+C meant for the relay gateway doesn't also kill the app
      // mid-render. Mirrors the Claude Desktop launcher.
      stdio: 'ignore',
      detached: true,
      env,
    });

    child.on('spawn', () => {
      settle(0);
    });

    child.on('exit', (code) => {
      settle(code ?? 1);
    });

    child.on('error', (err) => {
      console.error(`Failed to launch Antigravity: ${err.message}`);
      settle(1);
    });
  });
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
      console.error('Antigravity IDE not found.');
      console.error('Please make sure Antigravity IDE is installed.');
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
      // GUI app: don't inherit the terminal's stdio (its Electron logs would
      // corrupt relay's interactive prompts) and detach into its own process
      // group so a Ctrl+C meant for the relay gateway doesn't also kill the app
      // mid-render. Mirrors the Claude Desktop launcher.
      stdio: 'ignore',
      detached: true,
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
