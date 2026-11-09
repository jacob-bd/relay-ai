import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { poolFailure } from './errors.js';
import { upstreamHttpStatus } from '../codex/upstream-error.js';
import { getLogsPath } from '../paths.js';
import pc from 'picocolors';

/** One line per pool attempt outcome. Local only; holds model names and fixed reasons, never prompts or keys. */
export interface PoolActivity {
  at: string;
  target: 'claude' | 'codex' | 'antigravity' | 'core';
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
  const verdict = poolFailure(error);
  if (verdict.kind === 'disabled') return 'DISABLED: ' + (verdict.note ?? 'disabled after an error') + ' (run Test to re-enable)';
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

/** Clears the pool activity log file. */
export function clearPoolActivity(): void {
  try {
    const path = poolActivityPath();
    if (existsSync(path)) writeFileSync(path, '');
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
  return `${time}  ${e.event === 'served' ? 'answered' : /^(skipped: )?DISABLED/.test(e.reason ?? '') ? 'DISABLED' : 'FAILED  '}  ${e.providerId}/${e.modelId}${e.reason ? '  ' + e.reason : ''}${secs}${detail}`;
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

function clockTime(at: string): string {
  const when = new Date(at);
  return Number.isNaN(when.getTime()) ? at : when.toLocaleTimeString([], { hour12: false });
}

function durationText(ms?: number): string {
  return typeof ms === 'number' ? ` in ${(ms / 1000).toFixed(1)}s` : '';
}

/** What was passed over or failed before the answer: red for a failure, yellow for a member that was skipped. */
function attemptLines(tried: PoolRequestSummary['tried']): string[] {
  const lines: string[] = [];
  for (const t of tried) {
    const name = `${t.providerId}/${t.modelId}`;
    const reason = t.reason ?? 'failed';
    if (/^(skipped: )?DISABLED/.test(reason)) lines.push(pc.bold(pc.red(`      ⛔ ${name} ${reason.replace(/^skipped:\s*/, '')}`)));
    else if (reason.startsWith('skipped')) lines.push(pc.yellow(`      – ${name} skipped: ${reason.replace(/^skipped:\s*/, '')}`));
    else lines.push(pc.red(`      ✗ ${name} failed: ${reason}`));
    if (t.detail) lines.push(pc.dim(`          ${t.detail}`));
  }
  return lines;
}

/** One request: green when a model answered, red when none did, then what failed or was skipped first. */
export function formatPoolRequestLines(r: PoolRequestSummary): string {
  const time = pc.dim(clockTime(r.at));
  const head = r.outcome === 'answered' && r.answeredBy
    ? `${time}  ${pc.green(`✓ ${r.answeredBy.providerId}/${r.answeredBy.modelId} answered${durationText(r.ms)}`)}`
    : `${time}  ${pc.bold(pc.red('✗ nobody answered'))}`;
  return [head, ...attemptLines(r.tried)].join('\n');
}

/** What the default log shows: only the moments something changed. */
export interface PoolEventBlock {
  kind: 'now-answering' | 'switched' | 'failover' | 'failed';
  request: PoolRequestSummary;
  /** Requests that went smoothly since the previous event. */
  quietBefore: number;
  /** The answering model is now a different one than before this event. */
  changed: boolean;
  /** The model that was answering before a change. */
  previous?: { providerId: string; modelId: string };
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
    const previous = this.current;
    const changed = !same(this.current, request.answeredBy);
    const hadTrouble = request.tried.length > 0;
    if (changed) { this.current = request.answeredBy; this.since = request.at; }
    if (hadTrouble || changed) {
      this.quiet = 0;
      return { kind: hadTrouble ? 'failover' : (wasFirst ? 'now-answering' : 'switched'), request, quietBefore, changed, ...(previous ? { previous } : {}) };
    }
    this.quiet++;
    return undefined;
  }
}

export function formatPoolEventLines(block: PoolEventBlock): string {
  const r = block.request;
  const time = pc.dim(clockTime(r.at));
  if (block.kind === 'failed' || !r.answeredBy) {
    const lines = [`${time}  ${pc.bold(pc.red('✗ nobody answered'))}`, ...attemptLines(r.tried)];
    if (block.quietBefore > 0) lines.push(pc.dim(`      (${block.quietBefore} earlier request${block.quietBefore === 1 ? '' : 's'} answered normally)`));
    return lines.join('\n');
  }
  const who = `${r.answeredBy.providerId}/${r.answeredBy.modelId}`;
  const from = block.previous ? `${block.previous.providerId}/${block.previous.modelId}` : undefined;
  const note = block.changed ? pc.dim(from ? `  · switched from ${from}` : '  · first model seen') : '';
  const lines = [`${time}  ${pc.green(`✓ ${who} answered${durationText(r.ms)}`)}${note}`, ...attemptLines(r.tried)];
  if (block.quietBefore > 0 && block.kind !== 'now-answering') {
    lines.push(pc.dim(`      (${block.quietBefore} earlier request${block.quietBefore === 1 ? '' : 's'} answered normally)`));
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
  const smooth = state.quiet > 0 ? `, ${state.quiet} request${state.quiet === 1 ? '' : 's'} answered normally since` : '';
  return `Current model: ${pc.green(`${state.current.providerId}/${state.current.modelId}`)}${pc.dim(since + smooth)}`;
}
