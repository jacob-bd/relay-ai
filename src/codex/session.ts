// Codex overlay session: backup, restore, lock, stale cleanup.
import {
  copyFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { getAppHome } from '../paths.js';

export const CODEX_PROFILE_NAME = 'relay-ai-launch';
export const STALE_SESSION_MS = 5 * 60 * 1000;
export const MAX_BACKUPS = 5;

export interface CodexSessionLock {
  pid: number;
  startedAt: string;
  profilePath: string;
  catalogPaths: string[];
  proxyPort?: number;
}

export function getCodexHome(env: NodeJS.ProcessEnv = process.env): string {
  return env['CODEX_HOME'] || join(homedir(), '.codex');
}

export function getCodexProfilePath(): string {
  return join(getCodexHome(), `${CODEX_PROFILE_NAME}.config.toml`);
}

export function getRelayAiCodexDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(getAppHome(env), 'codex');
}

export function getSessionLockPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(getRelayAiCodexDir(env), 'session.json');
}

export function getBackupsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(getRelayAiCodexDir(env), 'backups');
}

export function getCatalogPath(providerId: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(getRelayAiCodexDir(env), `models-${providerId}.json`);
}

/** Files relay-ai owns for Codex launch — never touch ~/.codex/config.toml. */
export function ownedOverlayPaths(env: NodeJS.ProcessEnv = process.env): string[] {
  const paths = [getCodexProfilePath()];
  const codexDir = getRelayAiCodexDir(env);
  if (existsSync(codexDir)) {
    for (const name of readdirSync(codexDir)) {
      if (name.startsWith('models-') && name.endsWith('.json')) {
        paths.push(join(codexDir, name));
      }
    }
  }
  const agentsDir = join(getCodexHome(env), 'agents');
  if (existsSync(agentsDir)) {
    for (const name of readdirSync(agentsDir)) {
      if (/^relay-model-[a-z0-9-]+\.toml$/i.test(name)) {
        paths.push(join(agentsDir, name));
      }
    }
  }
  paths.push(getSessionLockPath(env));
  return paths;
}

export function atomicWriteFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, content, { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, path);
  try { chmodSync(path, 0o600); } catch { /* Windows may not expose POSIX mode bits */ }
}

export function rotateBackups(filePath: string, env: NodeJS.ProcessEnv = process.env): void {
  if (!existsSync(filePath)) return;
  const backupsDir = getBackupsDir(env);
  mkdirSync(backupsDir, { recursive: true });
  const base = basename(filePath);
  const stamp = Date.now();
  const backupPath = join(backupsDir, `${base}.${stamp}.bak`);
  copyFileSync(filePath, backupPath);
  const backups = readdirSync(backupsDir)
    .filter(n => n.startsWith(`${base}.`) && n.endsWith('.bak'))
    .map(n => ({ name: n, mtime: statSync(join(backupsDir, n)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const old of backups.slice(MAX_BACKUPS)) {
    try {
      unlinkSync(join(backupsDir, old.name));
    } catch { /* ignore */ }
  }
}

export function writeOverlayFile(path: string, content: string, env: NodeJS.ProcessEnv = process.env): void {
  rotateBackups(path, env);
  atomicWriteFile(path, content);
}

export function readSessionLock(env: NodeJS.ProcessEnv = process.env): CodexSessionLock | null {
  const path = getSessionLockPath(env);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as CodexSessionLock;
    if (typeof parsed.pid === 'number' && typeof parsed.startedAt === 'string') return parsed;
  } catch { /* ignore */ }
  return null;
}

export function writeSessionLock(lock: CodexSessionLock, env: NodeJS.ProcessEnv = process.env): void {
  const path = getSessionLockPath(env);
  mkdirSync(getRelayAiCodexDir(env), { recursive: true });
  atomicWriteFile(path, `${JSON.stringify(lock, null, 2)}\n`);
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

export function sessionAgeMs(lock: Pick<CodexSessionLock, 'startedAt'>): number {
  const started = Date.parse(lock.startedAt);
  if (Number.isNaN(started)) return Infinity;
  return Date.now() - started;
}

/** Stale only when the owning pid is no longer alive. */
export function isSessionStale(lock: CodexSessionLock): boolean {
  return !isProcessAlive(lock.pid);
}

export function isConcurrentSession(lock: Pick<CodexSessionLock, 'pid' | 'startedAt'>): boolean {
  return isProcessAlive(lock.pid);
}

export function restoreCodexOverlay(env: NodeJS.ProcessEnv = process.env): string[] {
  const removed: string[] = [];
  for (const path of ownedOverlayPaths(env)) {
    if (!existsSync(path)) continue;
    try {
      rmSync(path, { force: true });
      removed.push(path);
    } catch { /* ignore */ }
  }
  return removed;
}

export function remainingOverlayPaths(env: NodeJS.ProcessEnv = process.env): string[] {
  return ownedOverlayPaths(env).filter(p => existsSync(p));
}

export function cleanupStaleSession(env: NodeJS.ProcessEnv = process.env): boolean {
  return recoverInterruptedCodexSession(env).recovered;
}

export type InterruptedRecovery = {
  recovered: boolean;
  removedCount?: number;
  /** dead relay-ai/codex pid or orphan overlay without a live lock */
  reason?: 'dead-session' | 'orphan-files';
};

/**
 * On launch: remove overlay files left by crash, force-quit, or closed terminal.
 * Does nothing when a concurrent live session holds the lock.
 */
export function recoverInterruptedCodexSession(env: NodeJS.ProcessEnv = process.env): InterruptedRecovery {
  const before = remainingOverlayPaths(env);
  if (before.length === 0) return { recovered: false };

  const lock = readSessionLock(env);
  if (lock && isConcurrentSession(lock)) {
    return { recovered: false };
  }

  restoreCodexOverlay(env);
  return {
    recovered: true,
    removedCount: before.length,
    reason: lock ? 'dead-session' : 'orphan-files',
  };
}

export type SessionCheckResult =
  | { ok: true }
  | { ok: false; reason: 'concurrent'; lock: CodexSessionLock }
  | { ok: false; reason: 'non_tty' };

export function checkSessionLock(isTty: boolean, env: NodeJS.ProcessEnv = process.env): SessionCheckResult {
  if (!isTty) return { ok: false, reason: 'non_tty' };
  const lock = readSessionLock(env);
  if (lock && isConcurrentSession(lock)) {
    return { ok: false, reason: 'concurrent', lock };
  }
  return { ok: true };
}
