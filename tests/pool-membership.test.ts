import { describe, expect, it } from 'vitest';
import { addFreePoolMember, parseFreePool, removeFreePoolMember } from '../src/pool/membership.js';

describe('shared free pool membership', () => {
  it('starts empty without importing favorites', () => {
    expect(parseFreePool(undefined)).toEqual({ members: [], effort: 'auto', receipts: [] });
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
});
