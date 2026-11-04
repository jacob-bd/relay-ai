import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearForceFail, forcedFailures, readForceFailState, setForceFail } from '../src/pool/force-fail.js';

describe('force-fail switch', () => {
  beforeEach(() => { process.env['RELAY_AI_HOME'] = mkdtempSync(join(tmpdir(), 'relay-force-fail-')); delete process.env['RELAY_POOL_FORCE_FAIL']; });

  it('applies to a running session via the state file, then expires on its own', () => {
    const now = 1_000_000;
    setForceFail(['kilo/reflection/beam-free'], 10, now);
    expect([...forcedFailures({}, now + 60_000)]).toEqual(['kilo/reflection/beam-free']);
    expect(readForceFailState(now + 9 * 60_000)?.members).toEqual(['kilo/reflection/beam-free']);
    expect(readForceFailState(now + 10 * 60_000)).toBeUndefined();
    expect(forcedFailures({}, now + 11 * 60_000).size).toBe(0);
  });

  it('can be cleared, combines with the env list, and caps the duration', () => {
    setForceFail(['a/b'], 10);
    clearForceFail();
    expect(readForceFailState()).toBeUndefined();
    setForceFail(['a/b'], 10_000, 0);
    expect(readForceFailState(1)!.expiresAt).toBe(60 * 60_000);
    expect([...forcedFailures({ RELAY_POOL_FORCE_FAIL: 'c/d, e/f' }, 1)].sort()).toEqual(['a/b', 'c/d', 'e/f']);
  });
});
