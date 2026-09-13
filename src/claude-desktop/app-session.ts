import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import {
  getClaudeDesktopHome,
  getMetaJsonPath,
  getConfigLibraryPath,
  readMetaJson,
  restoreDeploymentMode,
  type DeploymentMode,
} from './app-config.js';

export interface ClaudeSessionLock {
  pid: number;
  startedAt: string;
  uuid: string;
  proxyPort: number;
  /**
   * `deploymentMode` as it was before this session forced `"3p"`, so cleanup
   * (and `--restore` after a crash) can put the user's own value back.
   * Absent when the session did not have to change it.
   */
  previousDeploymentMode?: DeploymentMode | null;
}

export function getSessionLockPath(): string {
  return join(getClaudeDesktopHome(), '.relay-ai.lock');
}

type SessionLockState =
  | { status: 'missing' }
  | { status: 'unreadable' }
  | { status: 'valid'; lock: ClaudeSessionLock };

function inspectSessionLock(): SessionLockState {
  const path = getSessionLockPath();
  if (!existsSync(path)) return { status: 'missing' };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as ClaudeSessionLock;
    if (
      typeof parsed.pid === 'number'
      && typeof parsed.startedAt === 'string'
      && typeof parsed.uuid === 'string'
      && typeof parsed.proxyPort === 'number'
    ) {
      return { status: 'valid', lock: parsed };
    }
  } catch { /* ignore */ }
  return { status: 'unreadable' };
}

export function readSessionLock(): ClaudeSessionLock | null {
  const state = inspectSessionLock();
  return state.status === 'valid' ? state.lock : null;
}

export function writeSessionLock(lock: ClaudeSessionLock): void {
  const path = getSessionLockPath();
  const tempPath = `${path}.tmp.${process.pid}`;
  mkdirSync(dirname(path), { recursive: true });
  try {
    writeFileSync(tempPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
    renameSync(tempPath, path);
  } finally {
    try { rmSync(tempPath, { force: true }); } catch { /* ignore */ }
  }
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
  if (existsSync(metaPath) && !existsSync(backupPath)) {
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

/** No-op unless this session actually forced `deploymentMode: "3p"`. */
function restoreDeploymentModeFromLock(lock: ClaudeSessionLock | null): void {
  if (!lock || !('previousDeploymentMode' in lock)) return;
  restoreDeploymentMode(lock.previousDeploymentMode ?? null);
}

/**
 * Run one cleanup step without letting its failure block the others (e.g. a
 * full disk mid-`Ctrl+C`: `_meta.json` restore throwing must not also skip
 * the `deploymentMode` restore and the lock removal that follow it). Logs
 * instead of swallowing, so a genuine failure is still visible.
 */
function safeCleanupStep(label: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    console.error(`[claude-app] ${label} failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function removeRelayAiConfig(uuid: string): void {
  const configPath = join(getConfigLibraryPath(), `${uuid}.json`);
  if (existsSync(configPath)) {
    try { rmSync(configPath, { force: true }); } catch { /* ignore */ }
  }
}

// An unreadable lock can never belong to a live session: writeSessionLock
// writes atomically (temp file + rename), so the real lock path is either a
// complete, valid write or leftover corruption/garbage with no confirmable
// owner. Treat it like a stale (dead-pid) lock — reclaimable, not live.
export function hasStaleSession(): boolean {
  const state = inspectSessionLock();
  if (state.status === 'unreadable') return true;
  return state.status === 'valid' && !isProcessAlive(state.lock.pid);
}

export function isConcurrentLiveSession(): boolean {
  const state = inspectSessionLock();
  return state.status === 'valid' && isProcessAlive(state.lock.pid);
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
  blocked?: boolean;
  liveSession?: boolean;
  message: string;
};

export function recoverSession(): RecoverSessionResult {
  const state = inspectSessionLock();
  if (state.status === 'unreadable') {
    // No pid to check liveness against, but the atomic write guarantees this
    // isn't a live session's lock (see hasStaleSession) — safe to self-heal.
    safeCleanupStep('restore _meta.json', restoreMetaJson);
    try { rmSync(getSessionLockPath(), { force: true }); } catch { /* ignore */ }
    return { recovered: true, message: 'Cleared a corrupt claude-app session lock and restored shared config.' };
  }
  const lock = state.status === 'valid' ? state.lock : null;
  if (lockHeldByAnotherLiveProcess(lock)) {
    return {
      recovered: false,
      blocked: true,
      liveSession: true,
      message: `Another relay-ai claude-app session is running (pid ${lock!.pid}). Ctrl+C it first, then run --restore.`,
    };
  }
  if (lock) {
    safeCleanupStep('restore _meta.json', restoreMetaJson);
    safeCleanupStep('restore deploymentMode', () => restoreDeploymentModeFromLock(lock));
    removeRelayAiConfig(lock.uuid);
    try { rmSync(getSessionLockPath(), { force: true }); } catch { /* ignore */ }
  } else {
    // Just in case there is no lock but the backup exists
    safeCleanupStep('restore _meta.json', restoreMetaJson);
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
  const state = inspectSessionLock();
  const lock = state.status === 'valid' ? state.lock : null;
  const sharedStateIsOwnedElsewhere = lockHeldByAnotherLiveProcess(lock);
  if (!sharedStateIsOwnedElsewhere) {
    safeCleanupStep('restore _meta.json', restoreMetaJson);
    safeCleanupStep('restore deploymentMode', () => restoreDeploymentModeFromLock(lock));
    try { rmSync(getSessionLockPath(), { force: true }); } catch { /* ignore */ }
  }
  const meta = readMetaJson();
  const configIsReferenced = meta === null
    ? existsSync(getMetaJsonPath())
    : meta.appliedId === uuid || meta.entries.some(entry => entry.id === uuid);
  if (!sharedStateIsOwnedElsewhere || !configIsReferenced) {
    removeRelayAiConfig(uuid);
  }
}

export function setupExitCleanup(uuid: string): void {
  // A step throwing (e.g. disk full mid-Ctrl+C) must not surface as an
  // uncaught exception on the 'exit' event — Node has no recovery path left
  // at that point and would print a raw stack trace instead of cleaning up
  // what it still can. cleanupSession's own steps are independently guarded
  // by safeCleanupStep; this is the last line of defense around the whole call.
  process.on('exit', () => {
    try {
      cleanupSession(uuid);
    } catch (err) {
      console.error(`[claude-app] cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}
