import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getAppHome } from '../paths.js';

/**
 * Failover test switch. Members listed here fail before any request leaves the machine (no cooldown is
 * recorded, nothing reaches the provider), so the next member must answer. Two sources:
 *  - env RELAY_POOL_FORCE_FAIL="provider/model,..." fixed when a tool starts, and
 *  - a state file written by `relay-ai pool force-fail`, read on every request so it works in a running
 *    session, and which expires on its own so it cannot be left on by accident.
 */
export const FORCE_FAIL_ENV = 'RELAY_POOL_FORCE_FAIL';
export const DEFAULT_FORCE_FAIL_MINUTES = 10;
export const MAX_FORCE_FAIL_MINUTES = 60;

export function forceFailPath(): string {
  return join(getAppHome(), 'pool-force-fail.json');
}

export interface ForceFailState { members: string[]; expiresAt: number }

export function readForceFailState(now = Date.now()): ForceFailState | undefined {
  try {
    const path = forceFailPath();
    if (!existsSync(path)) return undefined;
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<ForceFailState>;
    if (!Array.isArray(raw.members) || typeof raw.expiresAt !== 'number' || raw.expiresAt <= now) return undefined;
    const members = raw.members.filter((item): item is string => typeof item === 'string' && item.length > 0);
    return members.length > 0 ? { members, expiresAt: raw.expiresAt } : undefined;
  } catch {
    return undefined;
  }
}

export function setForceFail(members: string[], minutes = DEFAULT_FORCE_FAIL_MINUTES, now = Date.now()): ForceFailState {
  const clamped = Math.min(MAX_FORCE_FAIL_MINUTES, Math.max(1, Math.round(minutes) || DEFAULT_FORCE_FAIL_MINUTES));
  const state = { members: [...new Set(members.map(item => item.trim()).filter(Boolean))], expiresAt: now + clamped * 60_000 };
  const path = forceFailPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state) + '\n');
  return state;
}

export function clearForceFail(): void {
  try { rmSync(forceFailPath(), { force: true }); } catch { /* ignore */ }
}

/** Every member currently forced to fail ("provider/model"). */
export function forcedFailures(env: NodeJS.ProcessEnv = process.env, now = Date.now()): Set<string> {
  const fromEnv = (env[FORCE_FAIL_ENV] ?? '').split(',').map(item => item.trim()).filter(Boolean);
  return new Set([...fromEnv, ...(readForceFailState(now)?.members ?? [])]);
}
