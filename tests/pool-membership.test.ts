import { describe, expect, it } from 'vitest';
import { addFreePoolMember, moveFreePoolMemberTo, parseFreePool, removeFreePoolMember } from '../src/pool/membership.js';

describe('shared free pool membership', () => {
  it('starts empty without importing favorites', () => {
    expect(parseFreePool(undefined)).toEqual({ members: [], effort: 'auto', receipts: [] });
  });
  it('persists explicit enablement independently of membership and rejects invalid values', () => {
    const pool = { members: [], effort: 'auto', receipts: [], enabled: true };
    expect(parseFreePool(pool).enabled).toBe(true);
    expect(() => parseFreePool({ ...pool, enabled: 'true' })).toThrow('enabled');
  });
  it('preserves account identity, priority and more than 50 members', () => {
    const members = Array.from({ length: 75 }, (_, i) => ({ providerId: 'groq-' + i, modelId: 'same-model' }));
    expect(parseFreePool({ members, effort: 'high', receipts: [] }).members).toEqual(members);
  });
  it('rejects duplicates and malformed state instead of silently losing members', () => {
    const member = { providerId: 'groq-2', modelId: 'model' };
    expect(() => parseFreePool({ members: [member, member], effort: 'auto', receipts: [] })).toThrow('Duplicate');
    for (const value of [null, [], {}, { members: [], effort: 'max' }, { members: [{ providerId: ' ', modelId: 'm' }], effort: 'auto', receipts: [] }]) {
      expect(() => parseFreePool(value)).toThrow();
    }
  });
  it('changes membership only by explicit exact account/model operations', () => {
    const first = { providerId: 'groq', modelId: 'm' };
    const second = { providerId: 'groq-2', modelId: 'm' };
    const original = { members: [first], effort: 'medium' as const, receipts: [] };
    const added = addFreePoolMember(original, second);
    expect(original.members).toEqual([first]);
    expect(removeFreePoolMember(added, first)).toEqual({ members: [second], effort: 'medium', receipts: [] });
  });
  it('moves a member to an absolute index without mutating the input', () => {
    const a = { providerId: 'a', modelId: 'm' };
    const b = { providerId: 'b', modelId: 'm' };
    const c = { providerId: 'c', modelId: 'm' };
    const pool = { members: [a, b, c], effort: 'auto' as const, receipts: [] };
    expect(moveFreePoolMemberTo(pool, a, 2).members).toEqual([b, c, a]);
    expect(moveFreePoolMemberTo(pool, c, 0).members).toEqual([c, a, b]);
    expect(moveFreePoolMemberTo(pool, b, 1)).toBe(pool);
    expect(pool.members).toEqual([a, b, c]);
    expect(() => moveFreePoolMemberTo(pool, a, 3)).toThrow('Invalid priority');
    expect(() => moveFreePoolMemberTo(pool, { providerId: 'x', modelId: 'm' }, 0)).toThrow('not in the pool');
  });
});
