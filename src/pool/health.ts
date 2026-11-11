// Persistent, cross-process free-pool health: rate-limit cooldowns and recovery claims.
//
// Safety rules encoded here:
// - A lock or recovery claim held by a LIVE pid is never taken over, however old it is.
//   Only a pid that no longer exists is recoverable. The cost of that rule is a route
//   that stays blocked until its owner exits; clear() is the explicit human escape.
// - Corrupt state fails closed. Losing a cooldown would silently re-enter a quota, so
//   an unreadable file raises PoolHealthStateCorruptError and is never rewritten.
// - There is NO automatic stale-lock reaping. POSIX has no conditional unlink, so a
//   reaper could remove a lock published microseconds earlier by a live process. A lock
//   left by a crashed process therefore blocks the pool until a human clears it with
//   clear(scopes, { forceUnlock: true }). Failing closed beats risking two writers.
// - Only rate limits are persisted. Access, context, invalid, transient and cancelled
//   failures have no certified persistent policy and are never written.
// The file never contains prompts, responses, headers or credentials.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { getAppHome } from '../paths.js';
import type { PoolFailure, PoolFailureKind } from './errors.js';
import { processAlive } from './process-alive.js';

export interface PoolHealthRoute {
  id: string;
  scopes: readonly string[];
}

export interface PoolHealthBlocked {
  ok: false;
  reason: 'cooldown' | 'recovery-in-flight';
  /** Known end of a cooldown. Absent while another live process owns the recovery. */
  retryAt?: number;
  details: string[];
}

export interface PoolHealthReady {
  ok: true;
  mode: 'normal' | 'recovery';
  /** Report the outcome of the attempt that held this decision. Idempotent. */
  settle(success: boolean): Promise<void>;
  /** Drop a recovery claim without recording a provider failure (cancellation). */
  release(): Promise<void>;
}

export type PoolHealthDecision = PoolHealthBlocked | PoolHealthReady;

export class PoolHealthLockTimeoutError extends Error {
  readonly ownerPid?: number;
  readonly ownerSince?: number;
  constructor(lockPath: string, owner?: { pid: number; createdAt: number }) {
    const holder = owner?.pid
      ? 'pid ' + owner.pid + (owner.createdAt ? ' since ' + new Date(owner.createdAt).toISOString() : '')
      : 'an unreadable owner file';
    super('Pool health lock is held by ' + holder + ' (' + lockPath + '); it is not taken over automatically. '
      + 'If that process is gone, a human can clear it with '
      + 'PoolHealthStore.clear(scopes, { forceUnlock: true }).');
    this.name = 'PoolHealthLockTimeoutError';
    this.ownerPid = owner?.pid;
    this.ownerSince = owner?.createdAt;
  }
}

export class PoolHealthStateCorruptError extends Error {
  constructor(path: string) {
    super('Pool health state is unreadable (' + path + '); refusing to route without cooldown knowledge');
    this.name = 'PoolHealthStateCorruptError';
  }
}

export class PoolHealthForceUnlockRefusedError extends Error {
  readonly ownerPid?: number;
  constructor(lockPath: string, reason: string, ownerPid?: number) {
    super('Refusing to force-unlock the pool health lock (' + lockPath + '): ' + reason);
    this.name = 'PoolHealthForceUnlockRefusedError';
    this.ownerPid = ownerPid;
  }
}

/**
 * Short cooldowns so a member that just failed is not first in line for the next request. Rate limits keep
 * their own (longer) ladder above; a rejected request (400/422) or an oversized one says nothing about the
 * member, and a cancellation is the caller leaving, so those never cool anything down.
 */
export const FAILURE_COOLDOWN_BASE_MS = { transient: 60_000, access: 300_000, unknown: 30_000 } as const;
export const FAILURE_COOLDOWN_MAX_MS = 600_000;

/** Agreed ladder for a rate limit with no authoritative reset. */
export const UNKNOWN_RATE_LIMIT_LADDER_MS = [120_000, 600_000, 3_600_000, 21_600_000, 86_400_000] as const;

const MAX_ENTRIES = 512;
const MAX_LABEL_CHARS = 200;
/** Remember a failed rung long enough that the ladder does not restart at 2 minutes. */
const RETENTION_MS = 86_400_000;
const LOCK_POLL_MS = 10;
const DEFAULT_LOCK_TIMEOUT_MS = 5_000;

/** Account-wide bucket: every model on this provider account. */
export function poolAccountScope(providerId: string): string {
  return 'account:' + providerId;
}
/** One model on one account. Sibling models stay eligible. */
export function poolModelScope(providerId: string, modelId: string): string {
  return 'model:' + providerId + '/' + modelId;
}
/** One model on one endpoint revision; a config change is a different bucket. */
export function poolEndpointScope(providerId: string, endpointRevision: string, modelId: string): string {
  return 'endpoint:' + providerId + '/' + endpointRevision + '/' + modelId;
}

function hashScope(scope: string): string {
  return createHash('sha256').update(scope).digest('hex');
}

const SECRET_PART = /^(?:sk|gsk|xai|nvapi|AIza|hf|ghp)[-_A-Za-z0-9]*$/;

/**
 * Keep the readable structure of a scope while removing credential-shaped parts.
 * Scopes are built from provider/account/model ids; this is defence in depth.
 */
export function sanitizePoolScopeLabel(scope: string): string {
  const label = scope.split(/([:/])/).map(part => {
    if (part === ':' || part === '/') return part;
    if (SECRET_PART.test(part) || part.length >= 32) return '<redacted:' + hashScope(part).slice(0, 10) + '>';
    return part.replace(/[^A-Za-z0-9._-]/g, '_');
  }).join('');
  return label.length > MAX_LABEL_CHARS ? label.slice(0, MAX_LABEL_CHARS) + '~' : label;
}

interface StoredClaim { token: string; pid: number; startedAt: number; superseded?: boolean }
interface StoredEntry {
  label: string;
  failures: number;
  until: number;
  reason: PoolFailureKind;
  updatedAt: number;
  /** Short fixed label: why a member is disabled, or the marker of an unconfirmed 404/410. Never upstream text. */
  note?: string;
  recovery?: StoredClaim;
}

/** A disabled member stays out until a Test clears it; this is the (far) end its entry carries. */
const DISABLED_FOR_MS = 100 * 365 * 86_400_000;
const MISSING_NOTE = 'missing';
const MAX_NOTE_CHARS = 120;
interface StoreFile { version: 1; entries: Record<string, StoredEntry> }

interface OwnerRecord { token: string; pid: number; createdAt: number }

function emptyStore(): StoreFile {
  return { version: 1, entries: {} };
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeEntry(raw: unknown): StoredEntry {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid entry');
  const value = raw as Record<string, unknown>;
  const label = value['label'];
  const failures = value['failures'];
  const until = value['until'];
  const reason = value['reason'];
  const updatedAt = value['updatedAt'];
  if (typeof label !== 'string' || !label || label.length > MAX_LABEL_CHARS + 1) throw new Error('invalid label');
  if (typeof failures !== 'number' || !Number.isSafeInteger(failures) || failures < 1 || failures > 100) throw new Error('invalid failures');
  if (typeof until !== 'number' || !Number.isFinite(until)) throw new Error('invalid until');
  if (reason !== 'rate-limit' && reason !== 'quota' && reason !== 'disabled' && !(typeof reason === 'string' && reason in FAILURE_COOLDOWN_BASE_MS)) throw new Error('unsupported reason');
  const note = value['note'];
  if (note !== undefined && (typeof note !== 'string' || note.length > MAX_NOTE_CHARS)) throw new Error('invalid note');
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) throw new Error('invalid updatedAt');
  let recovery: StoredClaim | undefined;
  const rawClaim = value['recovery'];
  if (rawClaim !== undefined) {
    if (!rawClaim || typeof rawClaim !== 'object' || Array.isArray(rawClaim)) throw new Error('invalid claim');
    const claim = rawClaim as Record<string, unknown>;
    if (typeof claim['token'] !== 'string' || claim['token'].length < 16) throw new Error('invalid claim token');
    if (typeof claim['pid'] !== 'number' || !Number.isSafeInteger(claim['pid'])) throw new Error('invalid claim pid');
    if (typeof claim['startedAt'] !== 'number' || !Number.isFinite(claim['startedAt'])) throw new Error('invalid claim start');
    if (claim['superseded'] !== undefined && typeof claim['superseded'] !== 'boolean') throw new Error('invalid claim superseded');
    recovery = { token: claim['token'] as string, pid: claim['pid'] as number, startedAt: claim['startedAt'] as number, ...(claim['superseded'] === true ? { superseded: true } : {}) };
  }
  return {
    label,
    failures,
    until,
    reason: reason as PoolFailureKind,
    updatedAt,
    ...(typeof note === 'string' ? { note } : {}),
    ...(recovery ? { recovery } : {}),
  };
}

/** Strict: any malformed entry means the file is untrustworthy, not partially valid. */
function normalizeStore(raw: unknown): StoreFile {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid root');
  const value = raw as Record<string, unknown>;
  if (value['version'] !== 1) throw new Error('unsupported version');
  const entries = value['entries'];
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new Error('invalid entries');
  const state = emptyStore();
  for (const [key, entry] of Object.entries(entries as Record<string, unknown>)) {
    if (!/^[0-9a-f]{64}$/.test(key)) throw new Error('invalid scope key');
    state.entries[key] = normalizeEntry(entry);
  }
  return state;
}

function parseOwner(raw: string): OwnerRecord | undefined {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const value = parsed as Record<string, unknown>;
    const token = value['token'];
    const pid = value['pid'];
    const createdAt = value['createdAt'];
    if (typeof token !== 'string' || !token) return undefined;
    if (typeof pid !== 'number' || !Number.isSafeInteger(pid)) return undefined;
    return { token, pid, createdAt: typeof createdAt === 'number' ? createdAt : 0 };
  } catch {
    return undefined;
  }
}

async function readOwner(lockPath: string): Promise<OwnerRecord | undefined> {
  try {
    return parseOwner(await readFile(lockPath, 'utf8'));
  } catch {
    return undefined;
  }
}

/**
 * Remove the owner file only when its content still equals the payload this process
 * created. Only this process knows its random token, so another process's lock cannot
 * match. WARNING: unlink is not conditional (POSIX has none). A force-unlock or a new
 * owner publishing between the content read and the unlink can still let this unlink
 * remove a newer file. The check narrows that window; it does not eliminate it.
 */
async function removeOwnerIfContentMatches(lockPath: string, expected: string): Promise<boolean> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(lockPath, 'r');
    const content = await handle.readFile('utf8');
    if (content !== expected) return false;
    await unlink(lockPath);
    return true;
  } catch {
    // Already gone: the lock is free either way.
    return true;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function acquireLock(lockPath: string, timeoutMs: number): Promise<{ token: string; payload: string }> {
  const token = randomUUID();
  const payload = JSON.stringify({ token, pid: process.pid, createdAt: Date.now() });
  await mkdir(join(lockPath, '..'), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + Math.max(1, timeoutMs);
  for (;;) {
    try {
      // O_EXCL publish: exactly one contender can create the file.
      await writeFile(lockPath, payload, { flag: 'wx', mode: 0o600 });
      return { token, payload };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw error;
    }
    if (Date.now() >= deadline) throw await lockTimeout(lockPath);
    await delay(LOCK_POLL_MS + Math.floor(Math.random() * LOCK_POLL_MS));
  }
}

/** Release by exact content: another process's lock can never match this payload. */
async function releaseLock(lockPath: string, payload: string): Promise<void> {
  await removeOwnerIfContentMatches(lockPath, payload);
}

/** Fail closed with the current holder named, so a human can decide. Never removes it. */
async function lockTimeout(lockPath: string): Promise<PoolHealthLockTimeoutError> {
  const owner = await readOwner(lockPath).catch(() => undefined);
  return new PoolHealthLockTimeoutError(lockPath, owner);
}

function prune(state: StoreFile, now: number): void {
  for (const [key, entry] of Object.entries(state.entries)) {
    if (!entry.recovery && entry.until <= now - RETENTION_MS) delete state.entries[key];
  }
  const keys = Object.keys(state.entries);
  if (keys.length <= MAX_ENTRIES) return;
  keys.sort((a, b) => (state.entries[a]?.until ?? 0) - (state.entries[b]?.until ?? 0));
  for (const key of keys) {
    if (Object.keys(state.entries).length <= MAX_ENTRIES) break;
    if (!state.entries[key]?.recovery) delete state.entries[key];
  }
}

export interface PoolHealthOptions {
  /** Defaults to <RELAY_AI_HOME>/pool. */
  root?: string;
  now?: () => number;
  ladderMs?: readonly number[];
  lockTimeoutMs?: number;
}

export class PoolHealthStore {
  private readonly root: string;
  private readonly now: () => number;
  private readonly ladder: readonly number[];
  private readonly lockTimeoutMs: number;

  constructor(options: PoolHealthOptions = {}) {
    this.root = options.root ?? join(getAppHome(), 'pool');
    this.now = options.now ?? Date.now;
    this.ladder = options.ladderMs ?? UNKNOWN_RATE_LIMIT_LADDER_MS;
    this.lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
    if (!this.ladder.length || this.ladder.some(step => !Number.isSafeInteger(step) || step <= 0)) {
      throw new Error('Invalid rate-limit ladder');
    }
  }

  get statePath(): string {
    return join(this.root, 'health.json');
  }
  get lockPath(): string {
    return join(this.root, 'health.lock');
  }

  /** Throws PoolHealthStateCorruptError; the file is left exactly as found. */
  private async readState(): Promise<StoreFile> {
    let raw: string;
    try {
      raw = await readFile(this.statePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyStore();
      throw new PoolHealthStateCorruptError(this.statePath);
    }
    try {
      return normalizeStore(JSON.parse(raw) as unknown);
    } catch {
      throw new PoolHealthStateCorruptError(this.statePath);
    }
  }

  private async writeState(state: StoreFile): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const temp = this.statePath + '.tmp-' + randomUUID();
    await writeFile(temp, JSON.stringify(state), { mode: 0o600 });
    await rename(temp, this.statePath);
  }

  private async mutate<T>(work: (state: StoreFile, touch: () => void) => Promise<T> | T): Promise<T> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const { payload } = await acquireLock(this.lockPath, this.lockTimeoutMs);
    try {
      const state = await this.readState();
      let dirty = false;
      const result = await work(state, () => { dirty = true; });
      if (dirty) await this.writeState(state);
      return result;
    } finally {
      await releaseLock(this.lockPath, payload);
    }
  }

  /** A claim is live while its owner pid exists. Age alone never releases it. */
  private claimLive(claim: StoredClaim | undefined): boolean {
    if (!claim) return false;
    return claim.pid === process.pid || processAlive(claim.pid);
  }

  /**
   * Persist a provider failure. Rate limits use the long ladder; transient, access and unknown failures get a
   * short escalating cooldown (FAILURE_COOLDOWN_BASE_MS); cancellation, context and invalid failures are never written.
   * Throws PoolHealthLockTimeoutError when a live process holds the lock.
   */
  async record(
    scopes: readonly string[],
    failure: PoolFailure,
  ): Promise<{ recorded: boolean; reason?: string; until?: number; disabled?: boolean; note?: string }> {
    // A bare 404/410 is cooled like an access failure and confirmed once more before it disables the member.
    const cooled = failure.kind === 'missing' ? 'access' : failure.kind;
    const shortBase = cooled in FAILURE_COOLDOWN_BASE_MS
      ? FAILURE_COOLDOWN_BASE_MS[cooled as keyof typeof FAILURE_COOLDOWN_BASE_MS] : undefined;
    if (failure.kind !== 'rate-limit' && failure.kind !== 'quota' && failure.kind !== 'disabled' && shortBase === undefined) return { recorded: false, reason: failure.kind };
    const unique = [...new Set(scopes.filter(scope => typeof scope === 'string' && scope.trim().length > 0))];
    if (!unique.length) return { recorded: false, reason: 'no-scopes' };
    const now = this.now();
    return this.mutate((state, touch) => {
      let until = 0;
      let disabledNote: string | undefined;
      for (const scope of unique) {
        const key = hashScope(scope);
        const previous = state.entries[key];
        // Disabled is final until a Test clears it: nothing recorded afterwards may soften it.
        if (previous?.reason === 'disabled') {
          until = Math.max(until, previous.until);
          disabledNote = previous.note;
          continue;
        }
        // Confirmation must come from the recovery probe, after the first 404's cooldown ended. A parallel request
        // that was already in flight when the first one failed is the same outage, not a second opinion.
        const confirmedMissing = failure.kind === 'missing' && previous?.note === MISSING_NOTE && previous.until <= now;
        if (failure.kind === 'disabled' || confirmedMissing) {
          const note = failure.kind === 'disabled' ? failure.note ?? 'disabled after an error' : 'model not found (404)';
          state.entries[key] = {
            label: sanitizePoolScopeLabel(scope),
            failures: Math.min((previous?.failures ?? 0) + 1, 100),
            until: now + DISABLED_FOR_MS,
            reason: 'disabled',
            updatedAt: now,
            note: note.slice(0, MAX_NOTE_CHARS),
          };
          until = Math.max(until, now + DISABLED_FOR_MS);
          disabledNote = state.entries[key]!.note;
          continue;
        }
        const failures = Math.min((previous?.failures ?? 0) + 1, 100);
        const step = shortBase !== undefined
          ? Math.min(shortBase * 2 ** Math.min(failures - 1, 10), FAILURE_COOLDOWN_MAX_MS)
          : this.ladder[Math.min(failures - 1, this.ladder.length - 1)]!;
        // An authoritative reset always wins and is never capped. A concurrent failure must never
        // shorten a deadline that is still in force: only a later, longer reset may replace it.
        const proposedUntil = failure.retryAt !== undefined ? Math.max(failure.retryAt, now) : now + step;
        const entryUntil = previous && previous.until > now
          ? Math.max(previous.until, proposedUntil)
          : proposedUntil;
        state.entries[key] = {
          // A rate-limit can arrive while this process's recovery is in flight.
          // Keep the claim so another process cannot start a second provider call.
          ...(previous?.recovery ? { recovery: { ...previous.recovery, superseded: true } } : {}),
          label: sanitizePoolScopeLabel(scope),
          failures,
          until: entryUntil,
          reason: cooled,
          updatedAt: now,
          ...(failure.kind === 'missing' ? { note: MISSING_NOTE } : {}),
        };
        until = Math.max(until, entryUntil);
      }
      prune(state, now);
      touch();
      return { recorded: true, until, ...(disabledNote ? { disabled: true, note: disabledNote } : {}) };
    });
  }

  /** Forget a route's failure history after a genuine success (resets the ladder). */
  async markHealthy(scopes: readonly string[]): Promise<void> {
    const unique = [...new Set(scopes.filter(scope => typeof scope === 'string' && scope.trim().length > 0))];
    if (!unique.length) return;
    await this.mutate((state, touch) => {
      for (const scope of unique) {
        const key = hashScope(scope);
        if (state.entries[key] && state.entries[key]!.reason !== 'disabled') {
          delete state.entries[key];
          touch();
        }
      }
    });
  }

  /**
   * Explicit human escape hatch. forceUnlock removes the lock only when its owner pid
   * is provably dead. A live or unreadable owner is refused so a live process's lock
   * is never taken over. Nothing in this module reaps locks on its own.
   */
  async clear(scopes: readonly string[], options: { forceUnlock?: boolean } = {}): Promise<number> {
    const unique = [...new Set(scopes.filter(scope => typeof scope === 'string' && scope.trim().length > 0))];
    if (options.forceUnlock) {
      let raw: string | undefined;
      try {
        raw = await readFile(this.lockPath, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw new PoolHealthForceUnlockRefusedError(this.lockPath, 'the owner file is unreadable');
        }
      }
      if (raw !== undefined) {
        const owner = parseOwner(raw);
        if (!owner) throw new PoolHealthForceUnlockRefusedError(this.lockPath, 'the owner file is unreadable');
        if (processAlive(owner.pid)) {
          throw new PoolHealthForceUnlockRefusedError(this.lockPath, 'owner pid ' + owner.pid + ' is still alive', owner.pid);
        }
        if (!await removeOwnerIfContentMatches(this.lockPath, raw)) {
          throw new PoolHealthForceUnlockRefusedError(this.lockPath, 'the lock changed while it was being cleared', owner.pid);
        }
      }
    }
    if (!unique.length) return 0;
    return this.mutate((state, touch) => {
      let removed = 0;
      for (const scope of unique) {
        const key = hashScope(scope);
        if (state.entries[key]) {
          delete state.entries[key];
          removed += 1;
          touch();
        }
      }
      return removed;
    });
  }

  /** Why a member is disabled, if it is. Cleared only by a passing Test. */
  async disabledFor(scopes: readonly string[]): Promise<{ note: string; since: number } | undefined> {
    const state = await this.readState();
    for (const scope of scopes) {
      const entry = state.entries[hashScope(scope)];
      if (entry?.reason === 'disabled') return { note: entry.note ?? 'disabled after an error', since: entry.updatedAt };
    }
    return undefined;
  }

  /** Highest active cooldown for a route, if any (does not claim recovery). */
  async cooldownFor(route: PoolHealthRoute): Promise<number | undefined> {
    const now = this.now();
    const state = await this.readState();
    const active = route.scopes
      .map(scope => state.entries[hashScope(scope)])
      .filter((entry): entry is StoredEntry => Boolean(entry) && entry!.until > now);
    return active.length ? Math.max(...active.map(entry => entry.until)) : undefined;
  }

  /**
   * Decide whether this route may be attempted. A cooled-down or already-recovering
   * route is blocked; an expired cooldown grants exactly one cross-process recovery.
   */
  async acquire(route: PoolHealthRoute): Promise<PoolHealthDecision> {
    const now = this.now();
    const scopes = [...new Set(route.scopes.filter(scope => typeof scope === 'string' && scope.trim().length > 0))];
    const outcome = await this.mutate((state, touch) => {
      const relevant = scopes
        .map(scope => [scope, state.entries[hashScope(scope)]] as const)
        .filter((entry): entry is readonly [string, StoredEntry] => Boolean(entry[1]));
      const active = relevant.filter(([, entry]) => entry.until > now);
      if (active.length) {
        return {
          blocked: {
            ok: false as const,
            reason: 'cooldown' as const,
            retryAt: Math.max(...active.map(([, entry]) => entry.until)),
            details: active.map(([, entry]) => entry.label + ': ' + entry.reason),
          },
        };
      }
      const inFlight = relevant.filter(([, entry]) => this.claimLive(entry.recovery));
      if (inFlight.length) {
        return {
          blocked: {
            ok: false as const,
            reason: 'recovery-in-flight' as const,
            details: inFlight.map(([, entry]) => entry.label + ': recovery-in-flight (pid ' + entry.recovery!.pid + ')'),
          },
        };
      }
      const stale = relevant.filter(([, entry]) => entry.recovery);
      const expiredCooldown = relevant.filter(([, entry]) => entry.until <= now);
      if (!stale.length && !expiredCooldown.length) return {};
      const token = randomUUID();
      for (const [scope] of relevant) {
        const entry = state.entries[hashScope(scope)];
        if (!entry) continue;
        entry.recovery = { token, pid: process.pid, startedAt: now };
        touch();
      }
      return { token };
    });
    if (outcome.blocked) return outcome.blocked;
    if (!outcome.token) {
      return { ok: true, mode: 'normal', settle: async () => {}, release: async () => {} };
    }
    const token = outcome.token;
    let settled = false;
    const settleClaim = async (success: boolean): Promise<void> => {
      const at = this.now();
      await this.mutate((state, touch) => {
        for (const scope of scopes) {
          const key = hashScope(scope);
          const entry = state.entries[key];
          if (!entry?.recovery || entry.recovery.token !== token) continue;
          if (success && entry.recovery.superseded) {
            // A later request recorded a failure while this probe was running.
            // A success only releases the old claim; the newer cooldown survives.
            delete entry.recovery;
          } else if (success) {
            delete state.entries[key];
          } else {
            const failures = Math.min(entry.failures + 1, 100);
            const step = this.ladder[Math.min(failures - 1, this.ladder.length - 1)]!;
            // The claim ends with the attempt; only the cooldown survives.
            const { recovery: _consumed, ...rest } = entry;
            state.entries[key] = { ...rest, failures, until: Math.max(entry.until, at + step), updatedAt: at };
          }
          touch();
        }
      });
    };
    return {
      ok: true,
      mode: 'recovery',
      settle: async success => {
        if (settled) return;
        settled = true;
        await settleClaim(success);
      },
      release: async () => {
        if (settled) return;
        settled = true;
        // A cancellation is not a provider failure: drop the claim, keep the rung.
        await this.mutate((state, touch) => {
          for (const scope of scopes) {
            const key = hashScope(scope);
            const entry = state.entries[key];
            if (!entry?.recovery || entry.recovery.token !== token) continue;
            delete entry.recovery;
            touch();
          }
        });
      },
    };
  }

  /** Sanitized view for diagnostics and the UI; contains no prompts or credentials. */
  async inspect(route: PoolHealthRoute): Promise<Array<{ scope: string; reason: PoolFailureKind; until: number; failures: number; recovering: boolean; claimPid?: number }>> {
    const state = await this.readState();
    return route.scopes.flatMap(scope => {
      const entry = state.entries[hashScope(scope)];
      if (!entry) return [];
      return [{
        scope: entry.label,
        reason: entry.reason,
        until: entry.until,
        failures: entry.failures,
        recovering: this.claimLive(entry.recovery),
        ...(entry.recovery ? { claimPid: entry.recovery.pid } : {}),
      }];
    });
  }

  /** Retained entry count; bounded by MAX_ENTRIES. */
  async size(): Promise<number> {
    return Object.keys((await this.readState()).entries).length;
  }
}
