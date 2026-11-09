// src/ui-lock.ts — find the running Relay UI through its lock file (no UI server imports).

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pc from 'picocolors';
import { getAppHome } from './paths.js';

export const DEFAULT_SERVER_UI_PORT = 8787;

export function lockFile(): string {
  return join(getAppHome(), 'ui.lock');
}

export function removeLock(): void {
  try { unlinkSync(lockFile()); } catch {}
}

export function readUiLock(): { pid: number; port: number; mode: string; background?: boolean } | null {
  try {
    return JSON.parse(readFileSync(lockFile(), 'utf8'));
  } catch {
    return null;
  }
}

/** `background` marks a UI a tool launch started, which closes with the last tool launch that uses it. */
export function writeUiLock(port: number, mode: string, background = false): void {
  mkdirSync(getAppHome(), { recursive: true });
  writeFileSync(lockFile(), JSON.stringify({ pid: process.pid, port, mode, ...(background ? { background: true } : {}) }));
}

/** Remove the lock only while it still names this process, so a second UI never deletes the live one's lock. */
export function removeOwnUiLock(): void {
  try {
    const { pid } = JSON.parse(readFileSync(lockFile(), 'utf8'));
    if (pid === process.pid) unlinkSync(lockFile());
  } catch {}
}

export async function probeServerHealth(port: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 500);
    const res = await fetch(`http://127.0.0.1:${port}/api/config`, { signal: controller.signal });
    clearTimeout(timer);
    if (res.status === 200) {
      const data = await res.json().catch(() => null);
      if (data && typeof data === 'object') return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function checkExistingServer(): Promise<string | null> {
  if (!existsSync(lockFile())) return null;
  try {
    const { pid, port } = JSON.parse(readFileSync(lockFile(), 'utf8'));
    if (pid === process.pid) {
      removeLock();
      return null;
    }
    process.kill(pid, 0);

    const isAlive = await probeServerHealth(port ?? DEFAULT_SERVER_UI_PORT);
    if (!isAlive) {
      removeLock();
      return null;
    }

    return `http://127.0.0.1:${port}`;
  } catch {
    removeLock();
    return null;
  }
}

export function formatUiAvailableLine(url: string): string {
  return `  ${pc.bold('Server available at')} ${pc.cyan(url)}`;
}
