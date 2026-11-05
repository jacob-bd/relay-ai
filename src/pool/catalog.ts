
import type { FreePoolPreferences, LocalProviderModel, PoolCapabilityReceipt } from '../types.js';
import type { PoolTarget } from './eligibility.js';
import { FREE_POOL_MODEL_ID } from './codex-runtime.js';
import { receiptInForce } from './capabilities.js';
import { catalogEntryFromModel, type CodexCatalogModel } from '../codex/catalog.js';

const ALIASES: Record<PoolTarget, string> = {
  codex: FREE_POOL_MODEL_ID,
  claude: 'claude-pool',
  antigravity: 'free-pool',
};

/** Same servability predicate the runtime uses, minus provider-specific checks. */
function servable(receipt: PoolCapabilityReceipt | undefined, target: PoolTarget, now: number): receipt is PoolCapabilityReceipt {
  return Boolean(receipt
    && receiptInForce(receipt, now)
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
    display_name: 'Relay Free Pool',
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

/**
 * Full model_catalog_json entry for the pool. The lightweight catalog row is
 * not enough: Codex reads the window and effort ladder from this file, and a
 * missing level makes the picker lie about what the pool can honor.
 */
export function codexPoolCatalogModel(
  pool: FreePoolPreferences,
  receipts: readonly PoolCapabilityReceipt[],
  options: { appCatalog?: boolean; priority?: number; now?: number } = {},
): CodexCatalogModel | undefined {
  const entry = poolCatalogEntry(pool, receipts, 'codex', options.now);
  if (!entry) return undefined;
  const model: LocalProviderModel = {
    id: FREE_POOL_MODEL_ID,
    name: entry.display_name,
    family: '',
    brand: '',
    modelFormat: 'openai',
    npm: '@ai-sdk/openai-compatible',
    upstreamModelId: FREE_POOL_MODEL_ID,
    contextWindow: entry.context_window,
  };
  const base = catalogEntryFromModel(
    model, entry.display_name, options.priority ?? 1, options.appCatalog === true, FREE_POOL_MODEL_ID,
  );
  const levels = entry.supported_reasoning_levels.length > 0
    ? entry.supported_reasoning_levels
    : [{ effort: 'none', description: 'none' }];
  return {
    ...base,
    supported_reasoning_levels: levels,
    default_reasoning_level: levels[0]!.effort,
    default_reasoning_summary: 'none',
    supports_reasoning_summaries: false,
    support_verbosity: false,
    default_verbosity: null,
    context_window: entry.context_window,
    max_context_window: entry.context_window,
    truncation_policy: options.appCatalog === true
      ? base.truncation_policy
      : { mode: 'tokens', limit: entry.context_window },
  };
}
