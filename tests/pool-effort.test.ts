import { describe, expect, it } from 'vitest';
import { poolMemberEffort } from '../src/pool/effort.js';

describe('poolMemberEffort (shared by every tool)', () => {
  const receipt = { effortLevels: ['low', 'high'] };
  it('sends a level only when the member verified that exact rung', () => {
    expect(poolMemberEffort('high', receipt)).toBe('high');
    expect(poolMemberEffort('medium', receipt)).toBeNull();
    expect(poolMemberEffort('xhigh', receipt)).toBeNull();
  });
  it('sends nothing for auto or when the tool sent no level', () => {
    expect(poolMemberEffort('auto', receipt)).toBeNull();
    expect(poolMemberEffort(undefined, receipt)).toBeNull();
  });
});
