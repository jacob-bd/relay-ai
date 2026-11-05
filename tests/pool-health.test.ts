import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PoolHealthForceUnlockRefusedError,
  PoolHealthLockTimeoutError,
  PoolHealthStateCorruptError,
  PoolHealthStore,
  UNKNOWN_RATE_LIMIT_LADDER_MS,
  poolAccountScope,
  poolModelScope,
  sanitizePoolScopeLabel,
} from '../src/pool/health.js';
import { poolFailure } from '../src/pool/errors.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
let root: string;
let clock: number;
const now = () => clock;
const store = (extra: { lockTimeoutMs?: number; ladderMs?: number[] } = {}) =>
  new PoolHealthStore({ root, now, ...extra });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'relay-pool-health-'));
  clock = 1_800_000_000_000;
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
});

/** A pid that existed and is now gone. */
function deadPid(): number {
  return Number(execFileSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))']).toString());
}

const RATE_LIMIT = poolFailure(Object.assign(new Error('rate limited'), { statusCode: 429 }), 0);
const route = (providerId = 'acct', modelId = 'm') => ({ id: providerId + '/' + modelId, scopes: [poolModelScope(providerId, modelId)] });
const entryKey = (scope: string) => createHash('sha256').update(scope).digest('hex');

describe('pool health cooldown policy', () => {
  it('persists the agreed unknown ladder and caps at 24 hours', async () => {
    const target = route();
    expect(UNKNOWN_RATE_LIMIT_LADDER_MS).toEqual([2 * MINUTE, 10 * MINUTE, 60 * MINUTE, 6 * 60 * MINUTE, 24 * 60 * MINUTE]);
    for (let step = 0; step < 5; step++) {
      const result = await store().record(target.scopes, RATE_LIMIT);
      expect(result.until).toBe(clock + UNKNOWN_RATE_LIMIT_LADDER_MS[step]);
      await expect(store().acquire(target)).resolves.toMatchObject({ ok: false, reason: 'cooldown' });
      clock += UNKNOWN_RATE_LIMIT_LADDER_MS[step];
    }
    expect((await store().record(target.scopes, RATE_LIMIT)).until).toBe(clock + 24 * 60 * MINUTE);
  });

  it('honours an authoritative Retry-After and never caps it', async () => {
    const target = route('a2', 'm2');
    const sevenDays = 7 * 86_400;
    const failure = poolFailure(Object.assign(new Error('slow down'), {
      statusCode: 429,
      responseHeaders: { 'Retry-After': String(sevenDays) },
    }), clock);
    expect(failure.retryAt).toBe(clock + sevenDays * 1000);
    expect((await store().record(target.scopes, failure)).until).toBe(clock + sevenDays * 1000);
    expect(await store().cooldownFor(target)).toBe(clock + sevenDays * 1000);

    const dated = poolFailure(Object.assign(new Error('429'), {
      statusCode: 429, responseHeaders: { 'retry-after': new Date(clock + 5 * MINUTE).toUTCString() },
    }), clock);
    expect(dated.retryAt).toBe(clock + 5 * MINUTE);
  });

  it('scopes an account-wide limit to the account and a model limit to one model', async () => {
    await store().record([poolAccountScope('same-account')], RATE_LIMIT);
    expect(await store().cooldownFor({ id: 'x', scopes: [poolModelScope('same-account', 'other'), poolAccountScope('same-account')] }))
      .toBe(clock + 2 * MINUTE);
    expect(await store().cooldownFor(route('other-account', 'm'))).toBeUndefined();

    clock += 2 * MINUTE;
    await store().record([poolModelScope('other-account', 'm')], RATE_LIMIT);
    expect(await store().cooldownFor(route('other-account', 'sibling'))).toBeUndefined();
    expect(await store().cooldownFor(route('other-account', 'm'))).toBe(clock + 2 * MINUTE);
  });

  it('never records a cancellation as a provider failure', async () => {
    const target = route();
    for (const error of [Object.assign(new Error('x'), { name: 'AbortError' }), Object.assign(new Error('x'), { code: 'ABORT_ERR' })]) {
      const failure = poolFailure(error, clock);
      expect(failure.kind).toBe('canceled');
      await expect(store().record(target.scopes, failure)).resolves.toEqual({ recorded: false, reason: 'canceled' });
    }
    expect(await store().size()).toBe(0);
  });

  it('never cools a member down for a rejected request, an oversized one or a cancellation', async () => {
    const scopes = [poolModelScope('acct', 'm')];
    for (const failure of [
      poolFailure(Object.assign(new Error('e'), { statusCode: 400 }), clock),
      poolFailure(Object.assign(new Error('context length exceeded'), { statusCode: 400 }), clock),
      poolFailure({ name: 'AbortError' }, clock),
    ]) expect((await store().record(scopes, failure)).recorded).toBe(false);
    expect(await store().size()).toBe(0);
  });

  it('demotes a member briefly after a server error or access failure, escalating up to a cap', async () => {
    const scopes = [poolModelScope('acct', 'm')];
    const server = poolFailure(Object.assign(new Error('e'), { statusCode: 500 }), clock);
    expect(server.kind).toBe('transient');
    const first = await store().record(scopes, server);
    expect(first).toMatchObject({ recorded: true, until: clock + 60_000 });
    const second = await store().record(scopes, server);
    expect(second.until).toBe(clock + 120_000);
    for (let i = 0; i < 12; i++) await store().record(scopes, server);
    expect((await store().record(scopes, server)).until).toBe(clock + 600_000);

    const other = [poolModelScope('acct', 'denied')];
    const access = poolFailure(Object.assign(new Error('e'), { statusCode: 401 }), clock);
    expect(access.kind).toBe('access');
    expect(await store().record(other, access)).toMatchObject({ recorded: true, until: clock + 300_000 });
  });

  it('keeps the longer rate-limit ladder for a rate limit', async () => {
    const scopes = [poolModelScope('acct', 'limited')];
    expect(await store().record(scopes, RATE_LIMIT)).toMatchObject({ recorded: true, until: clock + 2 * MINUTE });
  });
});

describe('cross-process recovery claims', () => {
  it('grants exactly one recovery and clears the cooldown only on success', async () => {
    const target = route();
    await store().record(target.scopes, RATE_LIMIT);
    clock += 2 * MINUTE;

    const first = await store().acquire(target);
    expect(first).toMatchObject({ ok: true, mode: 'recovery' });
    const second = await store().acquire(target);
    expect(second).toMatchObject({ ok: false, reason: 'recovery-in-flight' });
    // No invented retry time while another live process owns the recovery.
    expect(second.ok ? undefined : second.retryAt).toBeUndefined();

    if (!first.ok) throw new Error('unreachable');
    await first.settle(true);
    expect(await store().size()).toBe(0);
    await expect(store().acquire(target)).resolves.toMatchObject({ ok: true, mode: 'normal' });
    await first.settle(false); // idempotent: no new rung
    expect(await store().cooldownFor(target)).toBeUndefined();
  });

  it('consumes the next rung when the recovery attempt fails', async () => {
    const target = route();
    await store().record(target.scopes, RATE_LIMIT);
    clock += 2 * MINUTE;
    const recovered = await store().acquire(target);
    if (!recovered.ok) throw new Error('expected recovery');
    await recovered.settle(false);

    expect(await store().cooldownFor(target)).toBe(clock + 10 * MINUTE);
    clock += 10 * MINUTE;
    // A later claim is granted immediately: the settled claim was removed, not expired.
    await expect(store().acquire(target)).resolves.toMatchObject({ ok: true, mode: 'recovery' });
  });

  it('releases a claim after cancellation without consuming a rung', async () => {
    const target = route();
    await store().record(target.scopes, RATE_LIMIT);
    clock += 2 * MINUTE;
    const claimed = await store().acquire(target);
    if (!claimed.ok) throw new Error('expected recovery');
    await claimed.release();

    const retry = await store().acquire(target);
    if (!retry.ok) throw new Error('expected recovery');
    await retry.settle(false);
    expect(await store().cooldownFor(target)).toBe(clock + 10 * MINUTE);
  });

  it('keeps an in-flight recovery claim when a rate limit is recorded', async () => {
    const target = route();
    await store().record(target.scopes, RATE_LIMIT);
    clock += 2 * MINUTE;
    const claimed = await store().acquire(target);
    if (!claimed.ok) throw new Error('expected recovery');

    await store().record(target.scopes, RATE_LIMIT);
    await expect(store().acquire(target)).resolves.toMatchObject({
      ok: false,
      reason: 'cooldown',
    });

    // Once the recorded cooldown expires, the preserved claim still blocks a
    // second provider call while the first recovery is running.
    clock += 10 * MINUTE;
    await expect(store().acquire(target)).resolves.toMatchObject({
      ok: false,
      reason: 'recovery-in-flight',
    });

    await claimed.settle(false);
    // The rate-limit record and the failed recovery both advance the ladder.
    expect(await store().cooldownFor(target)).toBe(clock + UNKNOWN_RATE_LIMIT_LADDER_MS[2]);
  });

  it('reclaims a claim from a dead pid immediately', async () => {
    const target = route();
    await store().record(target.scopes, RATE_LIMIT);
    clock += 2 * MINUTE;
    const path = join(root, 'health.json');
    const state = JSON.parse(readFileSync(path, 'utf8')) as { entries: Record<string, Record<string, unknown>> };
    state.entries[entryKey(target.scopes[0])]!['recovery'] = { token: '11111111-1111-4111-8111-111111111111', pid: deadPid(), startedAt: clock };
    writeFileSync(path, JSON.stringify(state));

    await expect(store().acquire(target)).resolves.toMatchObject({ ok: true, mode: 'recovery' });
  });

  it('never expires a recovery held by a live pid, however old it is', async () => {
    const target = route();
    await store().record(target.scopes, RATE_LIMIT);
    clock += 2 * MINUTE;
    const path = join(root, 'health.json');
    const state = JSON.parse(readFileSync(path, 'utf8')) as { entries: Record<string, Record<string, unknown>> };
    state.entries[entryKey(target.scopes[0])]!['recovery'] = {
      token: '22222222-2222-4222-8222-222222222222', pid: process.pid, startedAt: clock - 30 * DAY,
    };
    writeFileSync(path, JSON.stringify(state));
    clock += 30 * DAY;

    for (let attempt = 0; attempt < 3; attempt++) {
      const decision = await store().acquire(target);
      expect(decision).toMatchObject({ ok: false, reason: 'recovery-in-flight' });
      clock += 90 * DAY;
    }
  });
});

describe('lock safety', () => {
  const writeLock = (pid: number, createdAt: number, token = 'held-by-someone') => {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'health.lock'), JSON.stringify({ token, pid, createdAt }), { mode: 0o600 });
  };

  it('never reaps a dead owner automatically and names the holder', async () => {
    const dead = deadPid();
    writeLock(dead, clock);
    const stuck = store({ lockTimeoutMs: 150 });
    const failure = await stuck.record(route().scopes, RATE_LIMIT).catch(error => error);
    expect(failure).toBeInstanceOf(PoolHealthLockTimeoutError);
    expect(failure.ownerPid).toBe(dead);
    expect(failure.message).toContain('not taken over automatically');
    // The lock survives untouched: no conditional unlink exists, so nothing is stolen.
    expect(JSON.parse(readFileSync(join(root, 'health.lock'), 'utf8'))).toMatchObject({ token: 'held-by-someone' });
  });

  it('never steals a live-pid lock, even one that is ancient', async () => {
    // Far in the past: an age-based rule would take this lock. It must not.
    writeLock(process.pid, clock - 365 * DAY);
    const stuck = store({ lockTimeoutMs: 150 });
    await expect(stuck.record(route().scopes, RATE_LIMIT)).rejects.toBeInstanceOf(PoolHealthLockTimeoutError);
    await expect(stuck.markHealthy(route().scopes)).rejects.toBeInstanceOf(PoolHealthLockTimeoutError);
    const owner = JSON.parse(readFileSync(join(root, 'health.lock'), 'utf8')) as { token: string; pid: number };
    expect(owner).toMatchObject({ token: 'held-by-someone', pid: process.pid });
    expect(() => statSync(join(root, 'health.json'))).toThrow();
  });

  it('refuses force unlock while the owner process is alive', async () => {
    writeLock(process.pid, clock);
    const stuck = store({ lockTimeoutMs: 150 });

    const failure = await stuck.clear([], { forceUnlock: true }).catch(error => error);
    expect(failure).toBeInstanceOf(PoolHealthForceUnlockRefusedError);
    expect(failure.ownerPid).toBe(process.pid);
    expect(failure.message).toContain('still alive');
    expect(JSON.parse(readFileSync(join(root, 'health.lock'), 'utf8'))).toMatchObject({
      token: 'held-by-someone',
      pid: process.pid,
    });
  });

  it('refuses force unlock when the owner cannot be verified', async () => {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'health.lock'), '{not json', { mode: 0o600 });

    await expect(store().clear([], { forceUnlock: true }))
      .rejects.toBeInstanceOf(PoolHealthForceUnlockRefusedError);
    expect(readFileSync(join(root, 'health.lock'), 'utf8')).toBe('{not json');
  });

  it('recovers only through an explicit force unlock', async () => {
    writeLock(deadPid(), clock);
    const stuck = store({ lockTimeoutMs: 150 });
    await expect(stuck.record(route().scopes, RATE_LIMIT)).rejects.toBeInstanceOf(PoolHealthLockTimeoutError);

    // Manual recovery for a lock whose owner is gone.
    expect(await stuck.clear([], { forceUnlock: true })).toBe(0);
    await expect(stuck.record(route().scopes, RATE_LIMIT)).resolves.toMatchObject({ recorded: true });
    // Removing the record is separate from unlocking.
    expect(await stuck.clear([route().scopes[0]])).toBe(1);
    expect(await stuck.size()).toBe(0);
  });
});

describe('state safety', () => {
  it('fails closed on a corrupt state file and leaves it untouched', async () => {
    const path = join(root, 'health.json');
    mkdirSync(root, { recursive: true });
    writeFileSync(path, '{not json');
    const target = route();
    for (const operation of [
      () => store().cooldownFor(target),
      () => store().acquire(target),
      () => store().record(target.scopes, RATE_LIMIT),
      () => store().markHealthy(target.scopes),
      () => store().inspect(target),
      () => store().size(),
    ]) {
      await expect(operation()).rejects.toBeInstanceOf(PoolHealthStateCorruptError);
    }
    expect(readFileSync(path, 'utf8')).toBe('{not json');
  });

  it('fails closed when a single stored entry is invalid', async () => {
    const target = route();
    await store().record(target.scopes, RATE_LIMIT);
    const path = join(root, 'health.json');
    const state = JSON.parse(readFileSync(path, 'utf8')) as { entries: Record<string, Record<string, unknown>> };
    state.entries[entryKey(target.scopes[0])]!['failures'] = 'many';
    writeFileSync(path, JSON.stringify(state));

    await expect(store().acquire(target)).rejects.toBeInstanceOf(PoolHealthStateCorruptError);
    await expect(store().record(target.scopes, RATE_LIMIT)).rejects.toBeInstanceOf(PoolHealthStateCorruptError);
  });

  it('writes only sanitized, private state with no credentials or provider text', async () => {
    const secret = 'sk-ant-api03-DEADBEEFDEADBEEFDEADBEEFDEADBEEF';
    const scopes = ['account:' + secret, poolModelScope('groq-2', 'nvidia/nemotron-3.5-super-vl:free')];
    const failure = poolFailure(Object.assign(new Error('rate limited for key ' + secret), {
      statusCode: 429,
      responseBody: JSON.stringify({ error: { message: 'quota exhausted for ' + secret } }),
    }), clock);

    await store().record(scopes, failure);
    const path = join(root, 'health.json');
    const raw = readFileSync(path, 'utf8');
    expect(raw).not.toContain(secret);
    expect(raw).not.toContain('DEADBEEF');
    expect(raw).not.toContain('quota exhausted');
    expect(raw).toContain('nvidia/nemotron-3.5-super-vl:free');
    expect(sanitizePoolScopeLabel('account:' + secret)).toMatch(/^account:<redacted:[0-9a-f]{10}>$/);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('bounds retained entries while keeping live cooldowns', async () => {
    const scopes = Array.from({ length: 700 }, (_, index) => poolModelScope('acct-' + index, 'm'));
    await store().record(scopes, RATE_LIMIT);
    expect(await store().size()).toBeLessThanOrEqual(512);
    clock += 25 * 60 * MINUTE;
    await store().record([poolModelScope('fresh', 'm')], RATE_LIMIT);
    expect(await store().size()).toBe(1);
  });

  it('defaults to RELAY_AI_HOME/pool', async () => {
    const previous = process.env.RELAY_AI_HOME;
    const home = mkdtempSync(join(tmpdir(), 'relay-pool-home-'));
    process.env.RELAY_AI_HOME = home;
    try {
      const fallback = new PoolHealthStore({ now });
      expect(fallback.statePath).toBe(join(home, 'pool', 'health.json'));
      await fallback.record([poolModelScope('acct', 'm')], RATE_LIMIT);
      expect(await fallback.size()).toBe(1);
    } finally {
      if (previous === undefined) delete process.env.RELAY_AI_HOME;
      else process.env.RELAY_AI_HOME = previous;
      rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
    }
  });
});

describe('persisted demotions', () => {
  it('survive a reload from disk (a transient cooldown must not make the state unreadable)', async () => {
    const scopes = [poolModelScope('acct', 'reload')];
    await store().record(scopes, poolFailure(Object.assign(new Error('e'), { statusCode: 503 }), clock));
    expect(await store().size()).toBe(1);
    expect((await store().cooldownFor({ id: 'rev', scopes }))).toBe(clock + 60_000);
  });
});


it.each([true, false])('preserves a newer authoritative cooldown when an older recovery settles %s', async success => {
  const target = route();
  await store().record(target.scopes, RATE_LIMIT);
  clock += 2 * MINUTE;
  const recovery = await store().acquire(target);
  if (!recovery.ok) throw new Error('expected recovery');
  const retryAt = clock + 7 * 24 * 60 * MINUTE;
  await store().record(target.scopes, { kind: 'rate-limit', retryAt });
  await recovery.settle(success);
  expect(await store().cooldownFor(target)).toBe(retryAt);
  expect((await store().inspect(target))[0]?.recovering).toBe(false);
});
