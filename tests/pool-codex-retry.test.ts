import { describe, expect, it } from 'vitest';
import { CodexRetryGuard, requestFingerprint } from '../src/pool/codex-retry.js';

const request = { model: 'pool', messages: [{ role: 'user', content: 'SECRET_PROMPT' }], tools: [{ name: 'read' }] };
const fp = requestFingerprint(request);

describe('Codex retry guard', () => {
  it('returns busy for an in-flight duplicate and only the owner can settle it', () => {
    const guard = new CodexRetryGuard();
    const owner = guard.acquire('turn-1', fp);
    expect(owner.kind).toBe('owner');
    expect(guard.acquire('turn-1', fp)).toEqual({ kind: 'busy' });
    if (owner.kind !== 'owner') throw new Error('unreachable');
    owner.complete('ANSWER');
    expect(guard.acquire('turn-1', fp)).toEqual({ kind: 'replay', response: 'ANSWER' });
  });

  it('replays only an identical full-request fingerprint', () => {
    const guard = new CodexRetryGuard();
    const owner = guard.acquire('turn-1', fp);
    if (owner.kind !== 'owner') throw new Error('unreachable');
    owner.complete('ANSWER');
    const changed = requestFingerprint({ ...request, messages: [...request.messages, { role: 'tool', content: 'NEW RESULT' }] });
    expect(changed).not.toBe(fp);
    expect(guard.acquire('turn-1', changed).kind).toBe('owner');
    expect(guard.acquire('turn-2', fp).kind).toBe('owner');
  });

  it('treats a changed tool result as a new operation on the same observed turn', () => {
    const guard = new CodexRetryGuard();
    const first = requestFingerprint({ ...request, messages: [{ role: 'tool', toolCallId: 'c1', content: 'result-1' }] });
    const second = requestFingerprint({ ...request, messages: [{ role: 'tool', toolCallId: 'c1', content: 'result-2' }] });
    guard.acquire('turn-1', first);
    expect(guard.acquire('turn-1', second).kind).toBe('owner');
  });

  it('blocks repeated identical requests after failure, including postcommit failure', () => {
    const guard = new CodexRetryGuard();
    const owner = guard.acquire('turn-1', fp);
    if (owner.kind !== 'owner') throw new Error('unreachable');
    owner.fail('postcommit', true);
    expect(guard.acquire('turn-1', fp)).toEqual({ kind: 'blocked', reason: 'postcommit' });
    expect(guard.acquire('turn-1', requestFingerprint({ ...request, model: 'other' })).kind).toBe('owner');
  });

  it('release permits a deliberate retry while a stale owner cannot settle the replacement', () => {
    const guard = new CodexRetryGuard();
    const first = guard.acquire('turn-1', fp);
    if (first.kind !== 'owner') throw new Error('unreachable');
    first.release();
    const second = guard.acquire('turn-1', fp);
    expect(second.kind).toBe('owner');
    first.complete('STALE');
    expect(guard.acquire('turn-1', fp)).toEqual({ kind: 'busy' });
  });

  it('never evicts active owners at capacity and prunes only expired terminal state', () => {
    let now = 0;
    const guard = new CodexRetryGuard({ maxEntries: 1, ttlMs: 10 }, () => now);
    expect(guard.acquire('turn-1', fp).kind).toBe('owner');
    expect(guard.acquire('turn-2', fp)).toEqual({ kind: 'blocked', reason: 'retry-guard-capacity' });
    expect(guard.acquire('turn-1', fp)).toEqual({ kind: 'busy' });
    // Active entries never expire or get evicted; settle the first owner first.
    const original = new CodexRetryGuard({ maxEntries: 1, ttlMs: 10 }, () => now);
    const held = original.acquire('turn-1', fp);
    if (held.kind !== 'owner') throw new Error('unreachable');
    held.complete('OK');
    now = 11;
    expect(original.acquire('turn-2', fp).kind).toBe('owner');
  });

  it('bounds cached responses and refuses replay of one too large to cache', () => {
    const guard = new CodexRetryGuard({ maxResponseBytes: 8 });
    const owner = guard.acquire('turn-1', fp);
    if (owner.kind !== 'owner') throw new Error('unreachable');
    owner.complete('123456789');
    expect(guard.acquire('turn-1', fp)).toEqual({ kind: 'blocked', reason: 'response-too-large' });
  });

  it('hashes canonically and refuses malformed identity or limits', () => {
    expect(requestFingerprint({ b: 2, a: 1 })).toBe(requestFingerprint({ a: 1, b: 2 }));
    expect(requestFingerprint({ a: [1, 2] })).not.toBe(requestFingerprint({ a: [2, 1] }));
    expect(fp).not.toContain('SECRET_PROMPT');
    expect(() => new CodexRetryGuard().acquire('', fp)).toThrow('turn-id-and-fingerprint-required');
    expect(() => new CodexRetryGuard({ ttlMs: 0 })).toThrow('Invalid retry limit');
  });
});
