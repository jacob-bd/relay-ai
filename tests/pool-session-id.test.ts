import { describe, expect, it } from 'vitest';
import { poolSessionId } from '../src/pool/session-id.js';

describe('poolSessionId', () => {
  it('keeps a supplied id and only invents one for OpenCode Go/Zen accounts', () => {
    expect(poolSessionId('go', 'abc')).toBe('abc');
    expect(poolSessionId('go', undefined)).toMatch(/^relay-pool-/);
    expect(poolSessionId('go-2', undefined)).toMatch(/^relay-pool-/);
    expect(poolSessionId('zen', undefined)).toMatch(/^relay-pool-/);
    expect(poolSessionId('kilo', undefined)).toBeUndefined();
    expect(poolSessionId('openai-oauth', undefined)).toBeUndefined();
  });
});
