import { chmodSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getAppPathOverride } from './config.js';
import { findBinaryOnPath } from './binary-lookup.js';
import { findClaudeApp } from './claude-desktop/app-launch.js';
import { findCodexApp } from './codex/app-launch.js';

const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';

export interface AppInfo {
  id: string;
  name: string;
  type: 'cli' | 'app';
  installed: boolean;
  path: string | null;
  pathSource: 'auto' | 'override' | null;
  relayCommand: string;
  launchCommand: string | null;
}

export interface RelayLaunchOptions {
  providerId?: string;
  modelId?: string;
  favorites?: boolean;
  cwd?: string;
  trace?: boolean;
  httpProxy?: boolean;
}

interface SupportedAppDefinition {
  id: string;
  name: string;
  type: 'cli' | 'app';
  detectId: string;
  relayCommand: string;
}

const SUPPORTED_APPS: SupportedAppDefinition[] = [
  { id: 'claude', name: 'Claude Code CLI', type: 'cli', detectId: 'claude', relayCommand: 'claude' },
  { id: 'codex', name: 'Codex CLI', type: 'cli', detectId: 'codex', relayCommand: 'codex' },
  { id: 'gemini', name: 'Gemini CLI', type: 'cli', detectId: 'gemini', relayCommand: 'gemini' },
  { id: 'agy', name: 'Antigravity CLI', type: 'cli', detectId: 'agy', relayCommand: 'agy' },
  {
    id: 'antigravity',
    name: 'Antigravity (App)',
    type: 'app',
    detectId: 'antigravity',
    relayCommand: 'antigravity',
  },
  {
    id: 'antigravity-ide',
    name: 'Antigravity IDE (App)',
    type: 'app',
    detectId: 'antigravity-ide',
    relayCommand: 'antigravity-ide',
  },
  {
    id: 'claude-app',
    name: 'Claude Code Desktop',
    type: 'app',
    detectId: 'claude-app',
    relayCommand: 'claude-app',
  },
  {
    id: 'codex-app',
    name: 'ChatGPT Desktop (Codex)',
    type: 'app',
    detectId: 'codex-app',
    relayCommand: 'codex-app',
  },
];

export function fallbackPathsForApp(id: string, platform: NodeJS.Platform = process.platform): string[] {
  const windows = platform === 'win32';
  const mac = platform === 'darwin';
  const appData = process.env['APPDATA'] ?? homedir();
  const localAppData = process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local');

  switch (id) {
    case 'claude':
      return windows
        ? [
            join(appData, 'npm', 'claude.cmd'),
            join(appData, 'npm', 'claude'),
          ]
        : [
            join(homedir(), '.local', 'bin', 'claude'),
            join(homedir(), '.npm', 'bin', 'claude'),
            '/usr/local/bin/claude',
            '/opt/homebrew/bin/claude',
          ];
    case 'codex':
      return windows
        ? [
            join(appData, 'npm', 'codex.cmd'),
            join(appData, 'npm', 'codex'),
          ]
        : [
            join(homedir(), '.local', 'bin', 'codex'),
            join(homedir(), '.npm', 'bin', 'codex'),
            '/usr/local/bin/codex',
            '/opt/homebrew/bin/codex',
          ];
    case 'gemini':
      return windows
        ? [
            join(appData, 'npm', 'gemini.cmd'),
            join(appData, 'npm', 'gemini'),
          ]
        : [
            join(homedir(), '.local', 'bin', 'gemini'),
            join(homedir(), '.npm', 'bin', 'gemini'),
            '/usr/local/bin/gemini',
            '/opt/homebrew/bin/gemini',
          ];
    case 'agy':
      return windows
        ? [
            join(appData, 'npm', 'agy.cmd'),
            join(appData, 'npm', 'agy'),
            join(localAppData, 'Antigravity', 'agy.exe'),
          ]
        : [
            join(homedir(), '.local', 'bin', 'agy'),
            join(homedir(), '.npm', 'bin', 'agy'),
            '/usr/local/bin/agy',
            '/opt/homebrew/bin/agy',
          ];
    case 'antigravity-ide':
      if (mac) {
        return [
          '/Applications/Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide',
          join(homedir(), 'Applications', 'Antigravity IDE.app', 'Contents', 'Resources', 'app', 'bin', 'antigravity-ide'),
        ];
      }
      if (windows) {
        return [
          join(localAppData, 'Programs', 'Antigravity IDE', 'Antigravity IDE.exe'),
          join(localAppData, 'Programs', 'antigravity-ide', 'Antigravity IDE.exe'),
          join(localAppData, 'Programs', 'Antigravity', 'Antigravity IDE.exe'),
        ];
      }
      return ['/opt/antigravity-ide/Antigravity-IDE'];
    case 'antigravity':
      if (mac) {
        return [
          '/Applications/Antigravity.app/Contents/MacOS/Antigravity',
          join(homedir(), 'Applications', 'Antigravity.app', 'Contents', 'MacOS', 'Antigravity'),
        ];
      }
      if (windows) {
        return [
          join(localAppData, 'Programs', 'Antigravity', 'Antigravity.exe'),
        ];
      }
      return [
        '/opt/antigravity/antigravity',
        '/usr/local/bin/antigravity',
        '/usr/bin/antigravity',
      ];
    case 'claude-app':
      if (mac) {
        return [
          '/Applications/Claude.app/Contents/MacOS/Claude',
          join(homedir(), 'Applications', 'Claude.app', 'Contents', 'MacOS', 'Claude'),
        ];
      }
      return windows
        ? [join(localAppData, 'Programs', 'claude', 'Claude.exe')]
        : [];
    case 'codex-app':
      if (mac) {
        // OpenAI merged the Codex desktop app into the ChatGPT desktop app
        // (2026-07-09) — it's now named "ChatGPT.app" on disk. Codex.app is
        // kept as a fallback for installs that haven't updated yet.
        return [
          '/Applications/ChatGPT.app',
          join(homedir(), 'Applications', 'ChatGPT.app'),
          '/Applications/Codex.app',
          join(homedir(), 'Applications', 'Codex.app'),
        ];
      }
      // Windows exe/folder naming after the rename is unverified against a
      // real install (see src/codex/app-launch.ts) — best-effort guess
      // mirroring the confirmed macOS convention, with Codex.exe kept as
      // a fallback for installs that haven't updated yet.
      return windows
        ? [
            join(localAppData, 'Programs', 'ChatGPT', 'ChatGPT.exe'),
            join(localAppData, 'Programs', 'OpenAI ChatGPT', 'ChatGPT.exe'),
            join(localAppData, 'openai-chatgpt-electron', 'ChatGPT.exe'),
            join(localAppData, 'Programs', 'Codex', 'Codex.exe'),
            join(localAppData, 'Programs', 'OpenAI Codex', 'Codex.exe'),
            join(localAppData, 'openai-codex-electron', 'Codex.exe'),
          ]
        : [];
    default:
      return [];
  }
}

const FALLBACKS: Record<string, string[]> = Object.fromEntries(
  SUPPORTED_APPS.map(app => [app.detectId, fallbackPathsForApp(app.detectId)]),
);

export function getSupportedApp(id: string): SupportedAppDefinition | undefined {
  return SUPPORTED_APPS.find(app => app.id === id);
}

// Check if a specific binary/app is installed
export function detectApp(id: string): { installed: boolean; path: string | null; pathSource: 'auto' | 'override' | null } {
  const override = getAppPathOverride(id);
  if (override) {
    return existsSync(override)
      ? { installed: true, path: override, pathSource: 'override' }
      : { installed: false, path: override, pathSource: 'override' };
  }

  const resolvedPath = findBinaryOnPath(id, FALLBACKS[id] ?? [], { verifyWhichResult: true });
  if (resolvedPath) {
    return { installed: true, path: resolvedPath, pathSource: 'auto' };
  }

  // Microsoft Store (MSIX) installs live under version-stamped WindowsApps
  // paths the static fallback lists can't cover — the app-launch finders
  // handle them via Get-StartApps (returning a shell:AppsFolder moniker).
  const appFinder = id === 'claude-app' ? findClaudeApp : id === 'codex-app' ? findCodexApp : null;
  if (appFinder) {
    const appPath = appFinder();
    if (appPath) return { installed: true, path: appPath, pathSource: 'auto' };
  }

  return { installed: false, path: null, pathSource: null };
}

// Generate the shell command to open a new native terminal running the chosen tool/args
export function getTerminalLaunchCommand(
  binPath: string,
  args: string[],
  opts: { cwd?: string; displayCommand?: string } = {},
): string {
  const fullCmd = [binPath, ...args]
    .map(arg => {
      // Whitelist: alphanumeric, dash, underscore, dot, slash (for paths).
      // Anything else is rejected outright rather than escaped — the values
      // here (relay-ai binary path, provider/model ids) are always simple
      // identifiers, and there is no single escaping scheme that is safe for
      // all three downstream shells (macOS sh, Linux sh, Windows cmd.exe).
      if (!/^[a-zA-Z0-9\-_./:]+$/.test(arg)) {
        throw new Error(`Unsafe launch argument: ${JSON.stringify(arg)}`);
      }
      return arg;
    })
    .join(' ');
  const cwdPrefix = opts.cwd ? `cd ${quoteShellArg(opts.cwd)} && ` : '';
  const runCmd = `${cwdPrefix}${fullCmd}`;

  if (isMac) {
    const dir = mkdtempSync(join(tmpdir(), 'relay-ai-launch-'));
    const scriptPath = join(dir, 'launch.command');
    const displayCommand = opts.displayCommand ?? [binPath, ...args].join(' ');
    writeFileSync(scriptPath, [
      '#!/bin/sh',
      'trap \'rm -f "$0"; rmdir "$(dirname "$0")" 2>/dev/null\' EXIT',
      'clear',
      opts.cwd ? `cd ${quoteShellArg(opts.cwd)} || exit 1` : '',
      `printf '%s\\n\\n' ${quoteShellArg(`$ ${displayCommand}`)}`,
      fullCmd,
      'status=$?',
      'printf "\\nRelay AI session exited with code %s. Press Return to close this window. " "$status"',
      'read _',
      'exit "$status"',
      '',
    ].join('\n'), { encoding: 'utf8', mode: 0o700 });
    chmodSync(scriptPath, 0o700);
    return `open -a Terminal ${quoteShellArg(scriptPath)}`;
  }

  if (isWindows) {
    // Windows Start command: launches in cmd.exe in a new window.
    // First parameter to start is the window title; /d sets the working
    // directory — cwd must NOT be passed as a `cd '...'` prefix because
    // cmd.exe does not understand the POSIX single-quoting used by
    // quoteShellArg ("The filename, directory name, or volume label
    // syntax is incorrect").
    const dirFlag = opts.cwd ? `/d "${opts.cwd}" ` : '';
    return `start "Relay AI Terminal" ${dirFlag}cmd.exe /k "${fullCmd}"`;
  }

  // Linux: probe terminal emulators (fallback to generic execution)
  // Write runCmd to a script file rather than embedding it inline — runCmd may
  // itself contain single-quoted segments (from quoteShellArg), which breaks
  // nested single-quoting if interpolated directly into `sh -c '...'`.
  const dir = mkdtempSync(join(tmpdir(), 'relay-ai-launch-'));
  const scriptPath = join(dir, 'launch.sh');
  writeFileSync(scriptPath, [
    '#!/bin/sh',
    runCmd,
    'exec sh',
    '',
  ].join('\n'), { encoding: 'utf8', mode: 0o700 });
  chmodSync(scriptPath, 0o700);
  const scriptArg = quoteShellArg(scriptPath);
  return `x-terminal-emulator -e sh ${scriptArg} || gnome-terminal -- sh ${scriptArg} || xterm -e sh ${scriptArg}`;
}

function quoteShellArg(value: string): string {
  if (/^[a-zA-Z0-9\-_./]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function relayCliPath(): string {
  return 'relay-ai';
}

export function getRelayLaunchCommand(appId: string, options: RelayLaunchOptions = {}): string {
  const app = getSupportedApp(appId);
  if (!app) throw new Error(`Unsupported app: ${appId}`);

  const args = [app.relayCommand];
  if (options.trace) {
    args.push('--trace');
  }
  if (options.httpProxy) {
    if (app.id !== 'claude') {
      throw new Error('Transparent proxy mode is available only for Claude Code CLI.');
    }
    args.push('--http-proxy');
  }
  if (options.providerId && options.modelId) {
    args.push('--provider', options.providerId, '--model', options.modelId);
  } else if (options.providerId || options.modelId) {
    throw new Error('Both providerId and modelId are required for an explicit Relay launch.');
  }

  return getTerminalLaunchCommand(relayCliPath(), args, {
    cwd: options.cwd,
    displayCommand: ['relay-ai', ...args].join(' '),
  });
}

// Get lists of all supported apps and status
export function getSupportedApps(): AppInfo[] {
  return SUPPORTED_APPS.map(app => {
    const { installed, path, pathSource } = detectApp(app.detectId);
    return {
      id: app.id,
      name: app.name,
      type: app.type,
      installed,
      path,
      pathSource,
      relayCommand: app.relayCommand,
      launchCommand: installed ? getRelayLaunchCommand(app.id) : null,
    };
  });
}
