import type { FreePoolPreferences, LocalProvider, UserPreferences } from '../types.js';
import type { CodexCatalogModel } from '../codex/catalog.js';
import { codexPoolCatalogModel } from './catalog.js';
import { CodexPoolRuntime } from './codex-runtime.js';
import { prepareCodexPoolRoutes } from './codex-prepare.js';
import { PoolHealthStore } from './health.js';
import { parseFreePool } from './membership.js';

/** Saved opt-in, tolerant of a malformed receipt so a launch never fails. */
export function additivePoolPreferences(
  prefs: Pick<UserPreferences, 'freePool'>,
): FreePoolPreferences | undefined {
  if (prefs.freePool?.enabled !== true) return undefined;
  try {
    const pool = parseFreePool(prefs.freePool);
    return pool.members.length > 0 && pool.receipts.length > 0 ? pool : undefined;
  } catch {
    return undefined;
  }
}

/**
 * One runtime per launch, shared by every transport of that proxy. The
 * advertised row uses the same verified receipts the runtime will route with.
 */
export function createAdditivePoolRuntime(
  pool: FreePoolPreferences,
  providers: readonly LocalProvider[],
  options: { appCatalog?: boolean; priority?: number } = {},
): { runtime: CodexPoolRuntime; catalog: CodexCatalogModel } | undefined {
  const catalog = codexPoolCatalogModel(pool, pool.receipts, {
    appCatalog: options.appCatalog,
    priority: options.priority ?? 1,
  });
  if (!catalog) return undefined;
  const health = new PoolHealthStore();
  const runtime = new CodexPoolRuntime(pool, (body, source, signal, sessionId) =>
    prepareCodexPoolRoutes({
      pool,
      providers,
      receipts: pool.receipts,
      body,
      source,
      signal,
      sessionId,
      health,
    }));
  return { runtime, catalog };
}
