import { describe, expect, it } from 'vitest';
import { classifyFreeStatus, poolFreeStatus } from '../src/free-models.js';

describe('poolFreeStatus', () => {
  const model = { cost: { input: 0, output: 0 } };

  it('counts Nvidia free access as verified, since the account has no billing path', () => {
    expect(classifyFreeStatus({ model, providerId: 'nvidia' })).toBe('free_provider');
    expect(poolFreeStatus({ model, providerId: 'nvidia' })).toBe('verified_free');
  });

  it('keeps other provider-granted free access unverified (overage can bill)', () => {
    expect(poolFreeStatus({ model: { cost: { input: 1, output: 1 } }, providerId: 'cloudflare', freeAccess: true }))
      .toBe('free_provider');
  });

  it('does not turn paid or unknown models into verified free', () => {
    expect(poolFreeStatus({ model: { cost: { input: 1, output: 2 } }, providerId: 'nvidia' })).toBe('free_provider');
    expect(poolFreeStatus({ model: {}, providerId: 'openai' })).toBe('unknown');
  });
});
