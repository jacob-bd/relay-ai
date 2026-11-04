import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { upstreamHttpStatus } from '../codex/upstream-error.js';
import { getLogsPath } from '../paths.js';

/** One line per pool attempt outcome. Local only; holds model names and fixed reasons, never prompts or keys. */
export interface PoolActivity {
  at: string;
  target: 'claude' | 'codex';
  event: 'served' | 'failed';
  providerId: string;
  modelId: string;
  /** Fixed wording (see describePoolFailure); never raw upstream text. */
  reason?: string;
  ms?: number;
}

const MAX_BYTES = 256 * 1024;
const KEEP_LINES = 500;

export function poolActivityPath(): string {
  return join(getLogsPath(), 'pool-activity.jsonl');
}

/** Pool route ids are JSON `[providerId, revision, modelId]` (see poolRouteIdentity). */
export function poolRouteMember(routeId: string): { providerId: string; modelId: string } | undefined {
  try {
    const parsed = JSON.parse(routeId) as unknown;
    if (Array.isArray(parsed) && typeof parsed[0] === 'string' && typeof parsed[2] === 'string') {
      return { providerId: parsed[0], modelId: parsed[2] };
    }
  } catch { /* not a route id */ }
  return undefined;
}

/** A short, safe label for why an attempt failed. */
export function describePoolFailure(error: unknown): string {
  const raw = error instanceof Error ? error.message : '';
  // upstreamHttpStatus defaults to 500 for anything unrecognised; only trust a status the error carries.
  const carried = error as { statusCode?: unknown; status?: unknown; response?: { status?: unknown } } | null;
  const explicit = [carried?.statusCode, carried?.status, carried?.response?.status]
    .find((value): value is number => typeof value === 'number');
  const status = explicit ?? (/\b(4\d\d|5\d\d)\b/.test(raw) ? upstreamHttpStatus(error, raw) : undefined);
  if (status === 429) return 'rate limit (429)';
  if (status === 401 || status === 403) return `access denied (${status})`;
  if (status === 402) return 'quota or credits exhausted (402)';
  if (status === 404) return 'model not found (404)';
  if (status === 400) return 'request rejected (400)';
  if (typeof status === 'number' && status >= 500) return `provider error (${status})`;
  if (/timeout|timed out|ETIMEDOUT|abort/i.test(raw)) return 'timeout';
  if (/ECONNRESET|ENOTFOUND|fetch failed/i.test(raw)) return 'network error';
  return 'failed';
}

/** Best effort: logging must never affect a request. */
export function recordPoolActivity(entry: Omit<PoolActivity, 'at'>): void {
  try {
    const path = poolActivityPath();
    mkdirSync(getLogsPath(), { recursive: true });
    appendFileSync(path, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
    if (statSync(path).size > MAX_BYTES) {
      const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
      writeFileSync(path, lines.slice(-KEEP_LINES).join('\n') + '\n');
    }
  } catch { /* ignore */ }
}

/** Newest first. */
export function readPoolActivity(limit = 50): PoolActivity[] {
  try {
    const lines = readFileSync(poolActivityPath(), 'utf8').split('\n').filter(Boolean);
    const entries: PoolActivity[] = [];
    for (const line of lines.slice(-Math.max(limit, 1) * 2)) {
      try {
        const e = JSON.parse(line) as PoolActivity;
        if (e && typeof e.at === 'string' && typeof e.providerId === 'string' && typeof e.modelId === 'string'
          && (e.event === 'served' || e.event === 'failed')) entries.push(e);
      } catch { /* skip a bad line */ }
    }
    return entries.slice(-limit).reverse();
  } catch {
    return [];
  }
}
