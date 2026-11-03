import type { FreePoolPreferences, PoolCapabilityReceipt } from '../types.js';
import type { PoolTarget } from './eligibility.js';
import { FREE_POOL_MODEL_ID } from './codex-runtime.js';

const ALIASES: Record<PoolTarget, string> = {
  codex: FREE_POOL_MODEL_ID,
  claude: 'claude-pool',
  antigravity: 'free-pool',
};

/** Same servability predicate the runtime uses, minus provider-specific checks. */
function servable(receipt: PoolCapabilityReceipt | undefined, target: PoolTarget, now: number): receipt is PoolCapabilityReceipt {
  return Boolean(receipt
    && Number.isFinite(receipt.verifiedAt) && receipt.verifiedAt <= now
    && Number.isFinite(receipt.expiresAt) && receipt.expiresAt > now
    && receipt.targets.includes(target)
    && receipt.billingSafe
    && Number.isSafeInteger(receipt.contextWindow) && receipt.contextWindow > 0);
}

/**
 * One catalog entry for the pool on a given target. Health never changes the
 * advertised window. A stale member does not hide the pool while another verified
 * member remains; the minimum verified window (minus the admission margin) is shown.
 */
export function poolCatalogEntry(
  pool: FreePoolPreferences,
  receipts: readonly PoolCapabilityReceipt[],
  target: PoolTarget,
  now = Date.now(),
) {
  const verified = pool.members
    .map(member => receipts.find(receipt => receipt.member.providerId === member.providerId
      && receipt.member.modelId === member.modelId))
    .filter(receipt => servable(receipt, target, now)) as PoolCapabilityReceipt[];
  if (!verified.length) return undefined;
  const window = Math.min(...verified.map(receipt => receipt.contextWindow));
  const reserve = Math.max(4096, Math.ceil(window * 0.1));
  const levels = verified[0]!.effortLevels.filter(level =>
    verified.every(receipt => receipt.effortLevels.includes(level)));
  return {
    id: ALIASES[target],
    display_name: 'Free model pool',
    context_window: Math.max(1024, window - reserve),
    supported_reasoning_levels: levels.map(level => ({ effort: level, description: level })),
  };
}

export function codexPoolCatalogEntry(
  pool: FreePoolPreferences,
  receipts: readonly PoolCapabilityReceipt[],
  now = Date.now(),
) {
  return poolCatalogEntry(pool, receipts, 'codex', now);
}
