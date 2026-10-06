import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  detectAuthTierInBody,
  isEnterpriseAuthTier,
  readAgyOnboardingAuthMethod,
} from '../src/antigravity/account-guardrail.js';

describe('isEnterpriseAuthTier', () => {
  it('flags Gemini Enterprise tiers', () => {
    expect(isEnterpriseAuthTier('gcp-ge-plus-tier')).toBe(true);
    expect(isEnterpriseAuthTier('enterprise')).toBe(true);
  });

  it('does not flag consumer tiers or empty values', () => {
    expect(isEnterpriseAuthTier('free-tier')).toBe(false);
    expect(isEnterpriseAuthTier('g1-pro-tier')).toBe(false);
    expect(isEnterpriseAuthTier(undefined)).toBe(false);
    expect(isEnterpriseAuthTier('')).toBe(false);
  });
});

describe('detectAuthTierInBody', () => {
  it('extracts userTier and project from an entitlement body', () => {
    expect(detectAuthTierInBody({
      project: 'gemini-ent-532633',
      entitlement: { userTier: 'gcp-ge-plus-tier' },
      location: 'global',
    })).toEqual({ userTier: 'gcp-ge-plus-tier', project: 'gemini-ent-532633' });
  });

  it('returns the tier without a project when none is present', () => {
    expect(detectAuthTierInBody({ entitlement: { userTier: 'free-tier' } }))
      .toEqual({ userTier: 'free-tier' });
  });

  it('returns null for bodies without a tier', () => {
    expect(detectAuthTierInBody({ project: 'x' })).toBeNull();
    expect(detectAuthTierInBody({ entitlement: {} })).toBeNull();
    expect(detectAuthTierInBody('not-an-object')).toBeNull();
    expect(detectAuthTierInBody(null)).toBeNull();
  });
});

describe('readAgyOnboardingAuthMethod', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'relay-agy-onboarding-'));
    mkdirSync(join(dir, 'cache'), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeCache(content: string): void {
    writeFileSync(join(dir, 'cache', 'onboarding.json'), content);
  }

  it('reports gcp for enterprise sign-ins', () => {
    writeCache(JSON.stringify({ previousAuthMethod: 'gcp' }));
    expect(readAgyOnboardingAuthMethod(dir)).toBe('gcp');
  });

  it('reports consumer for any other recorded method', () => {
    writeCache(JSON.stringify({ previousAuthMethod: 'consumer' }));
    expect(readAgyOnboardingAuthMethod(dir)).toBe('consumer');
  });

  it('reports unknown for missing, malformed, or empty caches', () => {
    expect(readAgyOnboardingAuthMethod(dir)).toBe('unknown');
    writeCache('not json');
    expect(readAgyOnboardingAuthMethod(dir)).toBe('unknown');
    writeCache(JSON.stringify({}));
    expect(readAgyOnboardingAuthMethod(dir)).toBe('unknown');
  });
});
