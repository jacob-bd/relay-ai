import { createHash } from 'node:crypto';
import type { FavoriteModel, PoolCapabilityReceipt } from '../types.js';

export type { PoolCapabilityReceipt };

/**
 * A receipt never lapses with time, so its saved `expiresAt` is this fixed "never" value instead of a date
 * (the field is kept only because saved data and the receipt type require it). Older saved receipts carry a
 * real-looking date from when one was written; it is ignored and replaced with this on load.
 */
export const NO_RECEIPT_EXPIRY = Number.MAX_SAFE_INTEGER;

export function poolEndpointRevision(config: {
  providerId: string; authRef?: string; npm: string; baseURL?: string;
  upstreamModelId: string; headers?: Record<string, string>;
}): string {
  const headers = Object.entries(config.headers ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return createHash('sha256').update(JSON.stringify([
    config.providerId, config.authRef, config.npm, config.baseURL, config.upstreamModelId, headers,
  ])).digest('hex');
}
/**
 * A receipt is the record of the Test a member passed when it was added. It stays in force until the member's
 * endpoint changes (the revision is part of the match) or the member is removed; it never lapses with time.
 * `expiresAt` is kept in saved data for compatibility and is not enforced.
 */
export function receiptInForce(receipt: Pick<PoolCapabilityReceipt, 'verifiedAt'>, now: number): boolean {
  return Number.isFinite(receipt.verifiedAt) && receipt.verifiedAt <= now;
}
export function currentPoolReceipt(
  receipts: readonly PoolCapabilityReceipt[], member: FavoriteModel, revision: string, now: number,
): PoolCapabilityReceipt | undefined {
  const matching = receipts.filter(receipt => receipt.member.providerId === member.providerId
    && receipt.member.modelId === member.modelId && receipt.endpointRevision === revision
    && receiptInForce(receipt, now));
  if (matching.length !== 1) return undefined;
  const receipt = matching[0];
  if (!Number.isSafeInteger(receipt.maxOutputTokens) || receipt.maxOutputTokens <= 0
    || !Number.isSafeInteger(receipt.contextWindow) || receipt.contextWindow <= 0
    || !Array.isArray(receipt.effortLevels)
    || (receipt.contextSource !== 'attested' && receipt.contextSource !== 'observed' && receipt.contextSource !== 'provider')) return undefined;
  if (new Set(receipt.effortLevels).size !== receipt.effortLevels.length
    || receipt.effortLevels.some(level => typeof level !== 'string' || !level || level !== level.trim())) return undefined;
  // A named default is optional diagnostic evidence, never a prerequisite for Auto.
  if (receipt.defaultEffort !== undefined
    && (typeof receipt.defaultEffort !== 'string' || !receipt.defaultEffort.trim()
      || receipt.defaultEffort !== receipt.defaultEffort.trim())) return undefined;
  return receipt;
}

/** Strict receipt parsing. A receipt is cache, never authority. */
export function parsePoolReceipt(value: unknown): PoolCapabilityReceipt | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const r = value as Record<string, unknown>;
  const member = r.member as FavoriteModel | undefined;
  if (!member || typeof member.providerId !== 'string' || !member.providerId
    || typeof member.modelId !== 'string' || !member.modelId) return undefined;
  const revision = r.endpointRevision;
  if (typeof revision !== 'string' || !/^[0-9a-f]{64}$/.test(revision)) return undefined;
  const int = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
  if (!int(r.verifiedAt) || !int(r.expiresAt)) return undefined;
  if (!Array.isArray(r.targets) || r.targets.length === 0) return undefined;
  const targets = r.targets.filter((t): t is 'codex' | 'claude' | 'antigravity' | 'core' =>
    t === 'codex' || t === 'claude' || t === 'antigravity' || t === 'core');
  if (targets.length !== r.targets.length || new Set(targets).size !== targets.length) return undefined;
  if (typeof r.tools !== 'boolean') return undefined;
  if (!int(r.maxOutputTokens) || r.maxOutputTokens <= 0) return undefined;
  if (!int(r.contextWindow) || r.contextWindow <= 0) return undefined;
  if (r.contextSource !== 'attested' && r.contextSource !== 'observed' && r.contextSource !== 'provider') return undefined;
  if (r.reasoningAccounting !== 'inside-output' && r.reasoningAccounting !== 'separate') return undefined;
  if (r.defaultEffort !== undefined && (typeof r.defaultEffort !== 'string' || !r.defaultEffort.trim())) return undefined;
  if (!Array.isArray(r.effortLevels)) return undefined;
  const levels = r.effortLevels.filter((l): l is string => typeof l === 'string' && l.length > 0 && l === l.trim());
  if (levels.length !== r.effortLevels.length || new Set(levels).size !== levels.length) return undefined;
  if (typeof r.billingSafe !== 'boolean') return undefined;
  return {
    member: { providerId: member.providerId, modelId: member.modelId },
    endpointRevision: revision,
    verifiedAt: r.verifiedAt,
    expiresAt: NO_RECEIPT_EXPIRY,
    // A member that passed the text and tool Test can serve every target (Antigravity's Auto row needs
    // nothing more), so saved receipts from before that target existed stay usable without a re-test.
    // Surfaces added after a Test was saved need no re-test: the request path they use is the same SDK one.
    targets: (['antigravity', 'core'] as const).reduce<typeof targets>((all, extra) => all.includes(extra) ? all : [...all, extra], targets),
    tools: r.tools,
    maxOutputTokens: r.maxOutputTokens,
    contextWindow: r.contextWindow,
    contextSource: r.contextSource,
    reasoningAccounting: r.reasoningAccounting,
    ...(r.defaultEffort === undefined ? {} : { defaultEffort: r.defaultEffort as string }),
    effortLevels: levels,
    billingSafe: r.billingSafe,
  };
}
