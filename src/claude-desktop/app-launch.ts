import { execSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as p from '@clack/prompts';

const CLAUDE_BUNDLE_ID = 'com.anthropic.claudefordesktop';

export function claudeAppSupported(): void {
  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    throw new Error('Claude Desktop launch is supported on macOS and Windows only.');
  }
}

function run(cmd: string, encoding: BufferEncoding = 'utf8'): string {
  return execSync(cmd, { encoding, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function runPowerShell(script: string): string {
  return run(`powershell.exe -NoProfile -Command ${JSON.stringify(script)}`);
}

function darwinAppCandidates(): string[] {
  return [
    '/Applications/Claude.app',
    join(homedir(), 'Applications', 'Claude.app'),
  ];
}

function winLocalAppData(): string {
  return process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
}

function winClaudeExeCandidates(): string[] {
  const local = winLocalAppData();
  const bases = [
    join(local, 'Programs', 'Claude'),
    join(local, 'Claude'),
  ];
  const out: string[] = [];
  for (const base of bases) {
    out.push(join(base, 'Claude.exe'));
    try {
      if (existsSync(base)) {
        for (const name of readdirSync(base)) {
          if (name.startsWith('app-')) {
            out.push(join(base, name, 'Claude.exe'));
          }
        }
      }
    } catch { /* ignore */ }
  }
  return out;
}

function mdfindClaudeApp(): string | null {
  try {
    const out = run(`mdfind "kMDItemCFBundleIdentifier == '${CLAUDE_BUNDLE_ID}'"`);
    const first = out.split('\n').map(l => l.trim()).find(Boolean);
    return first && existsSync(first) ? first : null;
  } catch {
    return null;
  }
}

export function findClaudeApp(): string | null {
  if (process.platform === 'darwin') {
    for (const path of darwinAppCandidates()) {
      if (existsSync(path)) return path;
    }
    return mdfindClaudeApp();
  }
  if (process.platform === 'win32') {
    for (const path of winClaudeExeCandidates()) {
      try {
        if (existsSync(path) && statSync(path).isFile()) return path;
      } catch { /* ignore */ }
    }
    try {
      const appId = runPowerShell(
        "(Get-StartApps Claude | Where-Object { $_.Name -eq 'Claude' -or $_.Name -like 'Claude*' } | Select-Object -First 1 -ExpandProperty AppID)",
      );
      if (appId) return `shell:AppsFolder\\${appId}`;
    } catch { /* ignore */ }
  }
  return null;
}

function darwinIsRunning(): boolean {
  try {
    const out = run(`osascript -e 'tell application "System Events" to exists process "Claude"'`);
    return out.toLowerCase() === 'true';
  } catch {
    return false;
  }
}

function winMatchingPids(): number[] {
  try {
    const script = `$current = ${process.pid}; Get-CimInstance Win32_Process -Filter "Name = 'Claude.exe' OR Name = 'claude.exe'" | Where-Object { $_.ProcessId -ne $current } | Select-Object -ExpandProperty ProcessId`;
    const out = runPowerShell(script);
    return out.split(/\s+/).map(s => Number.parseInt(s, 10)).filter(n => Number.isFinite(n) && n > 0);
  } catch {
    return [];
  }
}

function winHasWindow(): boolean {
  try {
    const out = runPowerShell(
      "(Get-Process Claude -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1).Id",
    );
    return out.length > 0 && Number.isFinite(Number.parseInt(out, 10));
  } catch {
    return false;
  }
}

export function isClaudeAppRunning(): boolean {
  if (process.platform === 'darwin') return darwinIsRunning();
  if (process.platform === 'win32') return winMatchingPids().length > 0 || winHasWindow();
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForQuit(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (process.platform === 'win32') {
      if (!winHasWindow()) return true;
    } else if (!darwinIsRunning()) {
      return true;
    }
    await sleep(200);
  }
  return process.platform === 'win32' ? !winHasWindow() : !darwinIsRunning();
}

function openClaudeAppAt(path: string): void {
  if (process.platform === 'darwin') {
    if (path.endsWith('.app')) {
      execSync(`open ${JSON.stringify(path)}`, { stdio: 'inherit' });
    } else {
      execSync(`open -b ${CLAUDE_BUNDLE_ID}`, { stdio: 'inherit' });
    }
    return;
  }
  if (process.platform === 'win32') {
    if (path.startsWith('shell:AppsFolder\\')) {
      runPowerShell(`Start-Process '${path.replace(/'/g, "''")}'`);
    } else {
      runPowerShell(`Start-Process -FilePath '${path.replace(/'/g, "''")}'`);
    }
  }
}

export function openClaudeApp(): void {
  const path = findClaudeApp();
  if (!path) {
    throw new Error(
      'Claude Desktop App not found. Please install it first.',
    );
  }
  openClaudeAppAt(path);
}

function darwinQuit(): void {
  try {
    execSync('osascript -e \'tell application "Claude" to quit\'', { stdio: 'pipe' });
  } catch {
    execSync(`osascript -e 'tell application id "${CLAUDE_BUNDLE_ID}" to quit'`, { stdio: 'pipe' });
  }
}

function winQuitGraceful(): void {
  runPowerShell(
    'Get-Process Claude -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object { [void]$_.CloseMainWindow() }',
  );
}

export function quitClaudeAppGracefully(): void {
  if (process.platform === 'darwin') darwinQuit();
  else if (process.platform === 'win32') winQuitGraceful();
}

function winForceQuit(): void {
  const pids = winMatchingPids();
  if (pids.length === 0) return;
  runPowerShell(`Stop-Process -Id ${pids.join(',')} -Force -ErrorAction SilentlyContinue`);
}

export async function launchOrRestartClaudeApp(
  prompt = 'Restart Claude Desktop to apply relay-ai settings?',
): Promise<void> {
  const appPath = findClaudeApp();
  if (!isClaudeAppRunning()) {
    if (!appPath) {
      throw new Error('Claude Desktop App not found. Please install it first.');
    }
    openClaudeAppAt(appPath);
    return;
  }

  const restart = await p.confirm({ message: prompt, initialValue: true });
  if (p.isCancel(restart) || !restart) {
    p.log.info('Quit and reopen Claude Desktop when you are ready for the new model to take effect.');
    return;
  }

  if (process.platform === 'darwin') darwinQuit();
  else winQuitGraceful();

  if (!(await waitForQuit(5000))) {
    if (process.platform === 'win32') winForceQuit();
    await waitForQuit(5000);
  }

  if (appPath) openClaudeAppAt(appPath);
  else openClaudeApp();
}
