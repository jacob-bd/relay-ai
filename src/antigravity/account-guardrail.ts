// src/antigravity/account-guardrail.ts — detect work/enterprise Google accounts
// used with Antigravity surfaces so relay can warn before a policy surprise.
//
// Two independent signals, neither of which reads credentials:
//  - the client's own onboarding cache records how the last sign-in authenticated
//    (`"gcp"` = the enterprise/GCP path, consumer sign-ins record otherwise), and
//    is available *before* launch;
//  - gateway request bodies carry `entitlement.userTier` (the session's tier,
//    e.g. `gcp-ge-plus-tier`), which is definitive but only arrives once the
//    client is running.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Tier values matching this pattern indicate a Gemini Enterprise (work) seat. */
const ENTERPRISE_TIER_PATTERN = /gcp-ge|enterprise/i;

/** True when a Gemini `entitlement.userTier` marks a work/enterprise seat. */
export function isEnterpriseAuthTier(tier: string | undefined): boolean {
  return typeof tier === 'string' && ENTERPRISE_TIER_PATTERN.test(tier);
}

export interface DetectedAuthTier {
  userTier: string;
  project?: string;
}

/**
 * Find `entitlement.userTier` in a parsed request body. Returns the tier and the
 * project id when present, or null when the body carries no tier.
 */
export function detectAuthTierInBody(parsed: unknown): DetectedAuthTier | null {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const body = parsed as Record<string, unknown>;
  const entitlement = body['entitlement'];
  const userTier = entitlement && typeof entitlement === 'object' && !Array.isArray(entitlement)
    ? (entitlement as Record<string, unknown>)['userTier']
    : undefined;
  if (typeof userTier !== 'string' || userTier.length === 0) return null;
  const project = typeof body['project'] === 'string' && body['project'].length > 0
    ? body['project']
    : undefined;
  return project ? { userTier, project } : { userTier };
}

export type AgyOnboardingAuthMethod = 'gcp' | 'consumer' | 'unknown';

/**
 * Read the Antigravity CLI onboarding cache's `previousAuthMethod`.
 *
 * `"gcp"` means the last sign-in used the GCP/enterprise auth path; anything
 * else (or a missing/unreadable cache) is reported as `'consumer'`/`'unknown'`
 * so callers can decide how much to trust it. Never reads tokens.
 */
export function readAgyOnboardingAuthMethod(
  cliDir: string = join(homedir(), '.gemini', 'antigravity-cli'),
): AgyOnboardingAuthMethod {
  try {
    const raw = readFileSync(join(cliDir, 'cache', 'onboarding.json'), 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const method = parsed['previousAuthMethod'];
    if (method === 'gcp') return 'gcp';
    if (typeof method === 'string' && method.length > 0) return 'consumer';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}
