// Codex App session: config.toml backup, restore state, lock, recovery.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import {
  atomicWriteFile,
  getRelayAiCodexDir,
  getBackupsDir,
  rotateBackups,
  STALE_SESSION_MS,
  isProcessAlive,
  sessionAgeMs,
  isConcurrentSession,
} from './session.js';
import {
  captureRestoreState,
  isAppManagedConfig,
  readCodexConfigText,
  restoreConfigFromState,
  getCodexConfigPath,
  type CodexAppRestoreState,
} from './app-config.js';

export { getCodexConfigPath };

export function getAppSessionLockPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(getRelayAiCodexDir(env), 'session-app.json');
}

export function getAppRestoreStatePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(getRelayAiCodexDir(env), 'app-restore-state.json');
}

export function getAppCatalogPath(providerId: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(getRelayAiCodexDir(env), `app-models-${providerId}.json`);
}

export interface CodexAppSessionLock {
  pid: number;
  startedAt: string;
  configPath: string;
  catalogPaths: string[];
  restoreStatePath: string;
  backupPath?: string;
  proxyPort?: number;
}

export function readAppSessionLock(env: NodeJS.ProcessEnv = process.env): CodexAppSessionLock | null {
  const path = getAppSessionLockPath(env);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as CodexAppSessionLock;
    if (typeof parsed.pid === 'number' && typeof parsed.startedAt === 'string') return parsed;
  } catch { /* ignore */ }
  return null;
}

export function writeAppSessionLock(lock: CodexAppSessionLock, env: NodeJS.ProcessEnv = process.env): void {
  atomicWriteFile(getAppSessionLockPath(env), `${JSON.stringify(lock, null, 2)}\n`);
}

export function clearAppSessionLock(env: NodeJS.ProcessEnv = process.env): void {
  const path = getAppSessionLockPath(env);
  if (existsSync(path)) rmSync(path, { force: true });
}

export function readAppRestoreState(env: NodeJS.ProcessEnv = process.env): CodexAppRestoreState | null {
  const path = getAppRestoreStatePath(env);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as CodexAppRestoreState;
  } catch {
    return null;
  }
}

export function writeAppRestoreState(state: CodexAppRestoreState, env: NodeJS.ProcessEnv = process.env): void {
  rotateBackups(getAppRestoreStatePath(env), env);
  atomicWriteFile(getAppRestoreStatePath(env), `${JSON.stringify(state, null, 2)}\n`);
}

export function clearAppRestoreState(env: NodeJS.ProcessEnv = process.env): void {
  const path = getAppRestoreStatePath(env);
  if (existsSync(path)) rmSync(path, { force: true });
}

export function backupConfigToml(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const configPath = getCodexConfigPath();
  if (!existsSync(configPath)) return undefined;
  rotateBackups(configPath, env);
  const backupsDir = getBackupsDir(env);
  mkdirSync(backupsDir, { recursive: true });
  const base = basename(configPath);
  const backupPath = join(backupsDir, `${base}.${Date.now()}.bak`);
  copyFileSync(configPath, backupPath);
  return backupPath;
}

export function saveAppRestoreStateBeforePatch(env: NodeJS.ProcessEnv = process.env): CodexAppRestoreState {
  const text = readCodexConfigText();
  const existing = readAppRestoreState(env);
  if (existing && isAppManagedConfig(text)) {
    return existing;
  }
  const state = captureRestoreState(text);
  writeAppRestoreState(state, env);
  return state;
}

export function ownedAppCatalogPaths(env: NodeJS.ProcessEnv = process.env): string[] {
  const codexDir = getRelayAiCodexDir(env);
  if (!existsSync(codexDir)) return [];
  return readdirSync(codexDir)
    .filter(n => n.startsWith('app-models-') && n.endsWith('.json'))
    .map(n => join(codexDir, n));
}

export function removeAppCatalogs(env: NodeJS.ProcessEnv = process.env): string[] {
  const removed: string[] = [];
  for (const path of ownedAppCatalogPaths(env)) {
    try {
      rmSync(path, { force: true });
      removed.push(path);
    } catch { /* ignore */ }
  }
  return removed;
}

function newestConfigBackup(env: NodeJS.ProcessEnv = process.env): string | null {
  const backupDir = getBackupsDir(env);
  if (!existsSync(backupDir)) return null;
  const configBase = basename(getCodexConfigPath());
  const candidates = readdirSync(backupDir)
    .filter(name => name.startsWith(`${configBase}.`) && name.endsWith('.bak'))
    .map(name => {
      const path = join(backupDir, name);
      try {
        return { path, mtimeMs: statSync(path).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((entry): entry is { path: string; mtimeMs: number } => entry !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.path ?? null;
}

export type RestoreAppOverlayResult = {
  restored: boolean;
  liveSession?: boolean;
  message: string;
};

export function restoreCodexAppOverlay(env: NodeJS.ProcessEnv = process.env): RestoreAppOverlayResult {
  const lock = readAppSessionLock(env);
  if (lock && lock.pid !== process.pid && isConcurrentSession(lock)) {
    return {
      restored: false,
      liveSession: true,
      message: `Another relay-ai codex-app session is running (pid ${lock.pid}). Ctrl+C it first, then run --restore.`,
    };
  }

  const text = readCodexConfigText();
  const managed = isAppManagedConfig(text);
  const restoreState = readAppRestoreState(env);
  if (!managed && !restoreState && !lock) {
    removeAppCatalogs(env);
    clearAppSessionLock(env);
    return { restored: false, message: 'Nothing to restore.' };
  }

  if (restoreState) {
    restoreConfigFromState(restoreState);
  } else if (lock?.backupPath && existsSync(lock.backupPath)) {
    copyFileSync(lock.backupPath, getCodexConfigPath());
  } else if (managed) {
    const backupPath = newestConfigBackup(env);
    if (backupPath) copyFileSync(backupPath, getCodexConfigPath());
  }

  removeAppCatalogs(env);
  clearAppRestoreState(env);
  clearAppSessionLock(env);
  return { restored: true, message: 'Restored Codex App config and removed relay-ai app files.' };
}

export type AppInterruptedRecovery = {
  recovered: boolean;
};

export function recoverInterruptedCodexAppSession(env: NodeJS.ProcessEnv = process.env): AppInterruptedRecovery {
  const lock = readAppSessionLock(env);
  const managed = isAppManagedConfig(readCodexConfigText());
  if (!lock && !managed) return { recovered: false };
  if (lock && lock.pid !== process.pid && isConcurrentSession(lock)) {
    return { recovered: false };
  }
  restoreCodexAppOverlay(env);
  return { recovered: true };
}

export type AppSessionCheckResult =
  | { ok: true }
  | { ok: false; reason: 'concurrent'; lock: CodexAppSessionLock }
  | { ok: false; reason: 'non_tty' };

export function checkAppSessionLock(isTty: boolean, env: NodeJS.ProcessEnv = process.env): AppSessionCheckResult {
  if (!isTty) return { ok: false, reason: 'non_tty' };
  const lock = readAppSessionLock(env);
  if (lock && lock.pid !== process.pid && isConcurrentSession(lock)) {
    return { ok: false, reason: 'concurrent', lock };
  }
  return { ok: true };
}

export function waitForShutdown(): Promise<'sigint' | 'sigterm' | 'sighup'> {
  return new Promise(resolve => {
    const cleanup = (): void => {
      process.removeListener('SIGINT', onSigint);
      process.removeListener('SIGTERM', onSigterm);
      process.removeListener('SIGHUP', onSighup);
    };
    const onSigint = (): void => { cleanup(); resolve('sigint'); };
    const onSigterm = (): void => { cleanup(); resolve('sigterm'); };
    const onSighup = (): void => { cleanup(); resolve('sighup'); };
    process.once('SIGINT', onSigint);
    process.once('SIGTERM', onSigterm);
    process.once('SIGHUP', onSighup);
  });
}
