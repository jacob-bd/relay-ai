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
import { getClaudeDesktopHome, getMetaJsonPath, getConfigLibraryPath, readMetaJson } from './app-config.js';

export interface ClaudeSessionLock {
  pid: number;
  startedAt: string;
  uuid: string;
  proxyPort: number;
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

export function removeRelayAiConfig(uuid: string): void {
  const configPath = join(getConfigLibraryPath(), `${uuid}.json`);
  if (existsSync(configPath)) {
    try { rmSync(configPath, { force: true }); } catch { /* ignore */ }
  }
}

export function hasStaleSession(): boolean {
  const state = inspectSessionLock();
  return state.status === 'valid' && !isProcessAlive(state.lock.pid);
}

export function isConcurrentLiveSession(): boolean {
  const state = inspectSessionLock();
  if (state.status === 'unreadable') return true;
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
    return {
      recovered: false,
      blocked: true,
      message: 'The relay-ai claude-app session lock is unreadable. Refusing to restore shared config while another session may be running.',
    };
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
  const state = inspectSessionLock();
  const lock = state.status === 'valid' ? state.lock : null;
  const sharedStateIsOwnedElsewhere = state.status === 'unreadable' || lockHeldByAnotherLiveProcess(lock);
  if (!sharedStateIsOwnedElsewhere) {
    restoreMetaJson();
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
  process.on('exit', () => cleanupSession(uuid));
}
