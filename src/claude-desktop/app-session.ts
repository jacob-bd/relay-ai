import { existsSync, readFileSync, rmSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { getClaudeDesktopHome, getMetaJsonPath, getConfigLibraryPath } from './app-config.js';

export interface ClaudeSessionLock {
  pid: number;
  startedAt: string;
  uuid: string;
  proxyPort: number;
}

export function getSessionLockPath(): string {
  return join(getClaudeDesktopHome(), '.relay-ai.lock');
}

export function readSessionLock(): ClaudeSessionLock | null {
  const path = getSessionLockPath();
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as ClaudeSessionLock;
    if (typeof parsed.pid === 'number' && typeof parsed.startedAt === 'string') return parsed;
  } catch { /* ignore */ }
  return null;
}

export function writeSessionLock(lock: ClaudeSessionLock): void {
  const path = getSessionLockPath();
  writeFileSync(path, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
}

export function isProcessAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function backupMetaJson(): void {
  const metaPath = getMetaJsonPath();
  const backupPath = `${metaPath}.bak`;
  if (existsSync(metaPath)) {
    copyFileSync(metaPath, backupPath);
  }
}

export function restoreMetaJson(): void {
  const metaPath = getMetaJsonPath();
  const backupPath = `${metaPath}.bak`;
  if (existsSync(backupPath)) {
    copyFileSync(backupPath, metaPath);
    unlinkSync(backupPath);
  }
}

export function removeRelayAiConfig(uuid: string): void {
  const configPath = join(getConfigLibraryPath(), `${uuid}.json`);
  if (existsSync(configPath)) {
    try { rmSync(configPath, { force: true }); } catch { /* ignore */ }
  }
}

export function hasStaleSession(): boolean {
  const lock = readSessionLock();
  if (!lock) return false;
  if (!isProcessAlive(lock.pid)) {
    return true;
  }
  return false;
}

export function isConcurrentLiveSession(): boolean {
  const lock = readSessionLock();
  if (!lock) return false;
  return isProcessAlive(lock.pid);
}

// True when the on-disk lock belongs to a different, still-running relay-ai
// process. cleanupSession/recoverSession must not touch shared state
// (_meta.json, the lock file) in that case — a second claude-app launch may
// have taken over the lock, and restoring/deleting it here would corrupt
// that live session instead of our own.
function lockHeldByAnotherLiveProcess(lock: ClaudeSessionLock | null): boolean {
  return lock !== null && lock.pid !== process.pid && isProcessAlive(lock.pid);
}

export type RecoverSessionResult = {
  recovered: boolean;
  liveSession?: boolean;
  message: string;
};

export function recoverSession(): RecoverSessionResult {
  const lock = readSessionLock();
  if (lockHeldByAnotherLiveProcess(lock)) {
    return {
      recovered: false,
      liveSession: true,
      message: `Another relay-ai claude-app session is running (pid ${lock!.pid}). Ctrl+C it first, then run --restore.`,
    };
  }
  if (lock) {
    restoreMetaJson();
    removeRelayAiConfig(lock.uuid);
    try { rmSync(getSessionLockPath(), { force: true }); } catch { /* ignore */ }
  } else {
    // Just in case there is no lock but the backup exists
    restoreMetaJson();
  }
  return { recovered: true, message: 'Restored Claude Desktop relay-ai config.' };
}

export function waitForShutdown(): Promise<'sigint' | 'sigterm'> {
  return new Promise(resolve => {
    const cleanup = (): void => {
      process.removeListener('SIGINT', onSigint);
      process.removeListener('SIGTERM', onSigterm);
    };
    const onSigint = (): void => {
      cleanup();
      resolve('sigint');
    };
    const onSigterm = (): void => {
      cleanup();
      resolve('sigterm');
    };
    process.once('SIGINT', onSigint);
    process.once('SIGTERM', onSigterm);
  });
}

export function cleanupSession(uuid: string): void {
  const lock = readSessionLock();
  if (!lockHeldByAnotherLiveProcess(lock)) {
    restoreMetaJson();
    try { rmSync(getSessionLockPath(), { force: true }); } catch { /* ignore */ }
  }
  removeRelayAiConfig(uuid);
}

export function setupExitCleanup(uuid: string): void {
  process.on('exit', () => cleanupSession(uuid));
}
