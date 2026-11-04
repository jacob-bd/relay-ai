import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { upstreamHttpStatus } from '../codex/upstream-error.js';
import { getLogsPath } from '../paths.js';

/** One line per pool attempt outcome. Local only; holds model names and fixed reasons, never prompts or keys. */
export interface PoolActivity {
  at: string;
  target: 'claude' | 'codex';
  /** `gave-up` closes a request that no member answered. */
  event: 'served' | 'failed' | 'gave-up';
  /** Ties the attempts of one request together (Claude Code sends several at once). */
  requestId?: string;
  providerId: string;
  modelId: string;
  /** Short fixed label (see describePoolFailure). */
  reason?: string;
  /** What the backend said, credentials redacted and capped (see poolErrorDetail). */
  detail?: string;
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
  if (raw.includes('Simulated failure (RELAY_POOL_FORCE_FAIL)')) return 'simulated failure (test switch)';
  if (raw.includes('Pool route entered cooldown')) return 'skipped: recovering from an earlier failure';
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
          && (e.event === 'served' || e.event === 'failed' || e.event === 'gave-up')) entries.push(e);
      } catch { /* skip a bad line */ }
    }
    return entries.slice(-limit).reverse();
  } catch {
    return [];
  }
}

/** One terminal line: local time, outcome, member, short reason, duration. */
export function formatPoolActivityLine(e: PoolActivity): string {
  const when = new Date(e.at);
  const time = Number.isNaN(when.getTime()) ? e.at
    : `${when.toLocaleDateString()} ${when.toLocaleTimeString([], { hour12: false })}`;
  const secs = typeof e.ms === 'number' ? ` ${(e.ms / 1000).toFixed(1)}s` : '';
  const detail = e.detail ? `\n    ↳ ${e.detail}` : '';
  return `${time}  ${e.event === 'served' ? 'answered' : 'FAILED  '}  ${e.providerId}/${e.modelId}${e.reason ? '  ' + e.reason : ''}${secs}${detail}`;
}

function parseActivityLine(line: string): PoolActivity | undefined {
  try {
    const e = JSON.parse(line) as PoolActivity;
    return e && typeof e.at === 'string' && typeof e.providerId === 'string' && typeof e.modelId === 'string'
      && (e.event === 'served' || e.event === 'failed' || e.event === 'gave-up') ? e : undefined;
  } catch { return undefined; }
}

/**
 * Calls onEntry for every line appended from now on, until the signal aborts. The log is trimmed in
 * place when it grows past its cap, so a shrinking file restarts the read from the top.
 */
export async function followPoolActivity(onEntry: (entry: PoolActivity) => void, signal: AbortSignal, pollMs = 400): Promise<void> {
  const path = poolActivityPath();
  let offset = existsSync(path) ? statSync(path).size : 0;
  let partial = '';
  while (!signal.aborted) {
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, pollMs);
      signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
    if (signal.aborted) return;
    try {
      if (!existsSync(path)) { offset = 0; partial = ''; continue; }
      const size = statSync(path).size;
      if (size < offset) { offset = 0; partial = ''; }
      if (size === offset) continue;
      const fd = openSync(path, 'r');
      try {
        const buffer = Buffer.alloc(size - offset);
        readSync(fd, buffer, 0, buffer.length, offset);
        offset = size;
        const lines = (partial + buffer.toString('utf8')).split('\n');
        partial = lines.pop() ?? '';
        for (const line of lines) {
          const entry = line ? parseActivityLine(line) : undefined;
          if (entry) onEntry(entry);
        }
      } finally { closeSync(fd); }
    } catch { /* try again on the next tick */ }
  }
}

/** One request: who answered (if anyone) and which members were tried and failed first. */
export interface PoolRequestSummary {
  at: string;
  outcome: 'answered' | 'failed';
  answeredBy?: { providerId: string; modelId: string };
  ms?: number;
  tried: Array<{ providerId: string; modelId: string; reason?: string; detail?: string }>;
}

function attemptOf(e: PoolActivity) {
  return { providerId: e.providerId, modelId: e.modelId, ...(e.reason ? { reason: e.reason } : {}), ...(e.detail ? { detail: e.detail } : {}) };
}

/** Folds attempt entries (oldest first) into one summary per finished request. Open requests are held back. */
export class PoolRequestGrouper {
  private open = new Map<string, PoolRequestSummary>();

  /** Returns the finished request this entry completes, if any. */
  add(e: PoolActivity): PoolRequestSummary | undefined {
    if (!e.requestId) {
      // Entries from before requests were tracked: one line each.
      if (e.event === 'served') return { at: e.at, outcome: 'answered', answeredBy: { providerId: e.providerId, modelId: e.modelId }, ms: e.ms, tried: [] };
      // A lone failure from before requests were tracked cannot be tied to an outcome; showing it as a failed
      // request would be wrong (another member usually answered), so it is dropped.
      return undefined;
    }
    const summary = this.open.get(e.requestId) ?? { at: e.at, outcome: 'failed' as const, tried: [] };
    this.open.set(e.requestId, summary);
    if (e.event === 'failed') { summary.tried.push(attemptOf(e)); return undefined; }
    this.open.delete(e.requestId);
    summary.at = e.at;
    summary.ms = e.ms;
    if (e.event === 'served') { summary.outcome = 'answered'; summary.answeredBy = { providerId: e.providerId, modelId: e.modelId }; }
    return summary;
  }
}

export function groupPoolActivity(entriesOldestFirst: readonly PoolActivity[]): PoolRequestSummary[] {
  const grouper = new PoolRequestGrouper();
  const out: PoolRequestSummary[] = [];
  for (const e of entriesOldestFirst) {
    const done = grouper.add(e);
    if (done) out.push(done);
  }
  return out;
}

/** "who answered" first, then what was skipped or failed before it. */
export function formatPoolRequestLines(r: PoolRequestSummary): string {
  const when = new Date(r.at);
  const time = Number.isNaN(when.getTime()) ? r.at : when.toLocaleTimeString([], { hour12: false });
  const secs = typeof r.ms === 'number' ? ` ${(r.ms / 1000).toFixed(1)}s` : '';
  const head = r.outcome === 'answered' && r.answeredBy
    ? `${time}  ✓ ${r.answeredBy.providerId}/${r.answeredBy.modelId}${secs}`
    : `${time}  ✗ NO MODEL ANSWERED`;
  const lines = [head];
  for (const t of r.tried) {
    lines.push(`      ✗ ${t.providerId}/${t.modelId} - ${t.reason ?? 'failed'}`);
    if (t.detail) lines.push(`          ↳ ${t.detail}`);
  }
  return lines.join('\n');
}

/** What the default log shows: only the moments something changed. */
export interface PoolEventBlock {
  kind: 'now-answering' | 'switched' | 'failover' | 'failed';
  request: PoolRequestSummary;
  /** Requests that went smoothly since the previous event. */
  quietBefore: number;
  /** The answering model is now a different one than before this event. */
  changed: boolean;
}

/**
 * Turns finished requests (oldest first) into events: a failed request, a failover (a member failed before
 * another answered), or a change of the answering model. Requests answered by the usual model without any
 * trouble produce nothing; they only count towards `quiet`.
 */
export class PoolEventFilter {
  current?: { providerId: string; modelId: string };
  /** Time of the first request the current model answered smoothly. */
  since?: string;
  /** Smooth requests since the last event. */
  quiet = 0;

  push(request: PoolRequestSummary): PoolEventBlock | undefined {
    const quietBefore = this.quiet;
    const same = (a?: { providerId: string; modelId: string }, b?: { providerId: string; modelId: string }) =>
      Boolean(a && b && a.providerId === b.providerId && a.modelId === b.modelId);
    if (request.outcome !== 'answered' || !request.answeredBy) {
      this.quiet = 0;
      return { kind: 'failed', request, quietBefore, changed: false };
    }
    const wasFirst = !this.current;
    const changed = !same(this.current, request.answeredBy);
    const hadTrouble = request.tried.length > 0;
    if (changed) { this.current = request.answeredBy; this.since = request.at; }
    if (hadTrouble || changed) {
      this.quiet = 0;
      return { kind: hadTrouble ? 'failover' : (wasFirst ? 'now-answering' : 'switched'), request, quietBefore, changed };
    }
    this.quiet++;
    return undefined;
  }
}

export function formatPoolEventLines(block: PoolEventBlock): string {
  const r = block.request;
  const when = new Date(r.at);
  const time = Number.isNaN(when.getTime()) ? r.at : when.toLocaleTimeString([], { hour12: false });
  const secs = typeof r.ms === 'number' ? ` ${(r.ms / 1000).toFixed(1)}s` : '';
  const who = r.answeredBy ? `${r.answeredBy.providerId}/${r.answeredBy.modelId}` : '';
  const head = block.kind === 'failed' ? `${time}  ✗ NO MODEL ANSWERED`
    : block.kind === 'failover'
      ? (block.changed
        ? `${time}  ↪ FAILOVER → now answering: ${who}${secs}`
        : `${time}  ↪ FAILOVER → answered by ${who}${secs} (still the current model)`)
    : block.kind === 'switched' ? `${time}  ● SWITCHED → now answering: ${who}`
    : `${time}  ● ANSWERING: ${who}`;
  const lines = [head];
  for (const t of r.tried) {
    lines.push(`      ✗ ${t.providerId}/${t.modelId} - ${t.reason ?? 'failed'}`);
    if (t.detail) lines.push(`          ↳ ${t.detail}`);
  }
  if (block.quietBefore > 0 && block.kind !== 'now-answering') {
    lines.push(`      (${block.quietBefore} request${block.quietBefore === 1 ? '' : 's'} went smoothly before this)`);
  }
  return lines.join('\n');
}

/** Events plus the current state, computed from finished requests (oldest first). */
export function summarizePoolEvents(requests: readonly PoolRequestSummary[]) {
  const filter = new PoolEventFilter();
  const events: PoolEventBlock[] = [];
  for (const r of requests) {
    const block = filter.push(r);
    if (block) events.push(block);
  }
  return { events, current: filter.current, since: filter.since, quiet: filter.quiet };
}

export function formatPoolCurrentLine(state: { current?: { providerId: string; modelId: string }; since?: string; quiet: number }): string {
  if (!state.current) return 'No pool requests recorded yet.';
  const when = state.since ? new Date(state.since) : undefined;
  const since = when && !Number.isNaN(when.getTime()) ? ` since ${when.toLocaleTimeString([], { hour12: false })}` : '';
  const smooth = state.quiet > 0 ? `, ${state.quiet} request${state.quiet === 1 ? '' : 's'} answered smoothly since the last event` : '';
  return `Current model: ${state.current.providerId}/${state.current.modelId}${since}${smooth}`;
}
