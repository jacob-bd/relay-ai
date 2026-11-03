import { describe, expect, it } from 'vitest';
import { evaluatePoolMembers, poolRouteIdentity, type PoolRouteEvidence } from '../src/pool/eligibility.js';
const member = { providerId: 'groq-2', modelId: 'model' };
const pool = { members: [member], effort: 'high' as const, receipts: [] };
const request = { target: 'codex' as const, tools: true, now: 100 };
const route: PoolRouteEvidence = {
  member, revision: 'rev1', freeStatus: 'verified_free', catalogVerified: true,
  accessVerified: true, billingSafe: true, targets: ['codex'], toolsVerified: true,
  defaultEffortVerified: true, effortLevels: ['high'], contextFits: true, contextVerified: true,
};
describe('free pool admission', () => {
  it('admits only matching accounts and preserves unavailable membership', () => {
    expect(evaluatePoolMembers(pool, [route], request)[0].reason).toBeUndefined();
    expect(evaluatePoolMembers(pool, [{ ...route, member: { ...member, providerId: 'groq' } }], request)[0].reason).toBe('unavailable');
    expect(pool.members).toEqual([member]);
  });
  it.each([
    [{ revision: '' }, 'unverified-endpoint'],
    [{ catalogVerified: false }, 'unverified-catalog'],
    [{ freeStatus: 'paid' }, 'not-free'],
    [{ freeStatus: 'free_provider' }, 'not-free'],
    [{ freeStatus: 'unknown' }, 'not-free'],
    [{ billingSafe: false }, 'billing-risk'],
    [{ accessVerified: false }, 'unverified-access'],
    [{ targets: ['claude'] }, 'unsupported-target'],
    [{ toolsVerified: false }, 'unverified-tools'],
    [{ effortLevels: ['medium'] }, 'unsupported-effort'],
    [{ contextVerified: false }, 'unverified-context'],
    [{ contextFits: false }, 'context-limit'],
    [{ unavailableUntil: 101 }, 'cooldown'],
  ])('refuses unsafe evidence %j', (patch, reason) => {
    expect(evaluatePoolMembers(pool, [{ ...route, ...patch } as PoolRouteEvidence], request)[0].reason).toBe(reason);
  });
  it('lets explicit effort override the saved preference without weakening it', () => {
    expect(evaluatePoolMembers(pool, [route], { ...request, effort: 'medium', receipts: [] })[0].reason).toBe('unsupported-effort');
    expect(evaluatePoolMembers({ ...pool, effort: 'auto', receipts: [] }, [{ ...route, defaultEffortVerified: false }], request)[0].reason).toBe('unsupported-effort');
  });
  it('does not silently choose among conflicting endpoint revisions', () => {
    expect(evaluatePoolMembers(pool, [route, { ...route, revision: 'rev2' }], request)[0].reason).toBe('ambiguous-route');
    expect(poolRouteIdentity(route)).not.toBe(poolRouteIdentity({ ...route, revision: 'rev2' }));
    expect(poolRouteIdentity(route)).not.toBe(poolRouteIdentity({ ...route, member: { ...member, providerId: 'groq' } }));
  });
});
