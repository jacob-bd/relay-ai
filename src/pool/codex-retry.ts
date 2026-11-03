import { createHash } from 'node:crypto';

/**
 * In-process retry ownership for pool-served Codex requests.
 *
 * Scope is the OBSERVED client turn identity plus a hash of the complete
 * translated request. A turn id is not a history hash and must come from the
 * client (or a verified proxy identity), never from prompt content. Only hashes
 * and successful responses are retained; prompts and tool results are never
 * stored. State is process-local and is not shared across Relay processes. Active owners
 * are never expired while work may still be running: runtime deadlines and
 * cancellation must settle or release them. A process crash discards the map;
 * a stuck owner in a live process remains busy until that runtime is restarted.
 */
export interface CodexRetryLimits {
  ttlMs: number;
  maxEntries: number;
  maxResponseBytes: number;
}

export interface CodexRetryOwner {
  kind: 'owner';
  complete(response: string): void;
  fail(reason: string, postcommit?: boolean): void;
  release(): void;
}
export type CodexRetryResult =
  | CodexRetryOwner
  | { kind: 'replay'; response: string }
  | { kind: 'blocked'; reason: string }
  | { kind: 'busy' };

interface Entry {
  status: 'active' | 'succeeded' | 'failed';
  token: symbol;
  expires: number;
  reason?: string;
  response?: string;
  postcommit?: boolean;
}

const DEFAULT_LIMITS: CodexRetryLimits = {
  ttlMs: 60_000,
  maxEntries: 128,
  maxResponseBytes: 2 * 1024 * 1024,
};

/** Stable JSON used for fingerprints: object key order never changes the result. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const record = value as Record<string, unknown>;
  return '{' + Object.keys(record).sort().map(key => JSON.stringify(key) + ':' + canonical(record[key])).join(',') + '}';
}

/** Hash of the complete translated request. Never retains the request text. */
export function requestFingerprint(request: unknown): string {
  return createHash('sha256').update(canonical(request)).digest('hex');
}

function checkLimit(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid retry limit: ' + name);
}

export class CodexRetryGuard {
  private readonly entries = new Map<string, Entry>();
  private readonly limits: CodexRetryLimits;

  constructor(limits: Partial<CodexRetryLimits> = {}, private readonly now = Date.now) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    for (const [name, value] of Object.entries(this.limits)) checkLimit(name, value);
  }

  /**
   * Claims one request operation. turnId must be the observed client turn;
   * fingerprint must hash the full translated request.
   */
  acquire(turnId: string, fingerprint: string): CodexRetryResult {
    if (!turnId || !fingerprint) throw new Error('turn-id-and-fingerprint-required');
    this.prune();
    const key = JSON.stringify([turnId, fingerprint]);
    const existing = this.entries.get(key);
    if (existing) {
      if (existing.status === 'active') return { kind: 'busy' };
      if (existing.status === 'failed') return { kind: 'blocked', reason: existing.reason ?? 'previous-attempt-failed' };
      return { kind: 'replay', response: existing.response as string };
    }
    if (this.entries.size >= this.limits.maxEntries) {
      // Never evict an in-flight owner. A terminal entry could have been pruned
      // only if expired, which prune() already handled.
      return { kind: 'blocked', reason: 'retry-guard-capacity' };
    }
    const entry: Entry = { status: 'active', token: Symbol(), expires: this.now() + this.limits.ttlMs };
    this.entries.set(key, entry);
    const settle = (token: symbol) => this.entries.get(key)?.token === token;
    return {
      kind: 'owner',
      complete: (response: string) => {
        if (!settle(entry.token)) return;
        if (typeof response !== 'string' || Buffer.byteLength(response, 'utf8') > this.limits.maxResponseBytes) {
          this.entries.set(key, { status: 'failed', token: entry.token, expires: this.now() + this.limits.ttlMs, reason: 'response-too-large' });
          return;
        }
        this.entries.set(key, { status: 'succeeded', token: entry.token, expires: this.now() + this.limits.ttlMs, response });
      },
      fail: (reason: string, postcommit = false) => {
        if (!settle(entry.token)) return;
        this.entries.set(key, {
          status: 'failed', token: entry.token, expires: this.now() + this.limits.ttlMs,
          reason: reason || 'previous-attempt-failed', postcommit,
        });
      },
      release: () => {
        // Cancellation is not provider failure. Releasing permits a deliberate
        // retry; a stale owner can no longer settle the replacement entry.
        if (settle(entry.token)) this.entries.delete(key);
      },
    };
  }

  private prune(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.status !== 'active' && entry.expires <= now) this.entries.delete(key);
    }
  }
}
