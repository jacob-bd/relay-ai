// Antigravity adapter for the shared free pool.
//
// The pool is ONE picker model in Antigravity. Because Antigravity has no effort
// control of its own, the pool exposes one row per effort rung, and a rung may
// only be offered when EVERY eligible member can honor that exact rung. Cross
// family mapping, effort downgrades and Auto are never invented here.
//
// Rows reuse the existing catalog semantics: levels come from
// getReasoningCapabilities (the same resolver buildAntigravityRoutes uses), the
// offered subset comes from favoriteEffortLevels, labels come from effortLabel,
// and ordering comes from EFFORT_RANK. Tool-call normalization is untouched: the
// routes produced here are ordinary AntigravityRoute values, so the existing
// gateway formatter still owns them.

import type { AntigravityRoute } from '../antigravity/types.js';
import { effortLabel, favoriteEffortLevels } from '../antigravity/catalog.js';
import { EFFORT_RANK } from '../registry/models-dev.js';
import { getReasoningCapabilities, type ReasoningMetadata } from '../provider-factory.js';
import { buildAntigravityRoutes, type AntigravityEffortMode } from '../antigravity/catalog.js';
import { meetsContextFloor } from '../target-compatibility.js';
import { poolFreeStatus } from '../free-models.js';
import type { FreePoolPreferences, LocalProvider, PoolCapabilityReceipt } from '../types.js';
import { currentPoolReceipt, poolEndpointRevision } from './capabilities.js';

/**
 * The pool may spend at most one picker model plus this many effort rows. A long
 * membership list never buys more rows and is never truncated by the row budget.
 */
export const POOL_MODEL_ROWS = 1;
export const POOL_VARIANT_ROWS = 3;
/** Shared curation anchor: the planning and launch paths must offer one rung set. */
const POOL_EFFORT_ANCHOR = 'medium';

/** Mirrors the private slider-fold set in antigravity/catalog.ts (agy 1.2.11). */
const SLIDER_LEVELS = ['low', 'medium', 'high', 'max'];

/** How each Antigravity surface folds effort rows; kept aligned with the catalog. */
export type PoolEffortMode = 'rows' | 'slider' | 'submenu';

export interface PoolAntigravityMember {
  /** Concrete route produced by the existing Antigravity catalog pipeline. */
  route: AntigravityRoute;
  /** Shared pool eligibility verdict for this member/target. */
  eligible: boolean;
  /** Required when eligible is false; the member stays saved and is reported. */
  reason?: string;
}

export interface PoolAntigravityPlan {
  poolName: string;
  /** One row per offered rung, in ascending effort order. */
  routes: AntigravityRoute[];
  /** Rungs every eligible member can honor exactly. */
  commonEffortLevels: string[];
  /** Rungs actually offered after the favorite-style 3-level curation. */
  offeredLevels: string[];
  /** Saved members that cannot serve the pool, with the reason. */
  excluded: Array<{ providerId: string; modelId: string; reason: string }>;
  /** Catalog cost: the pool counts as one model, not one row per member. */
  slotCost: { modelRows: number; variantRows: number };
  /** Set when the pool cannot appear at all. */
  unavailableReason?: 'no-eligible-members' | 'no-common-effort' | 'no-row-budget';
}

function uniqueness(route: AntigravityRoute): string {
  return [route.providerId, route.modelId, route.npm, route.baseURL ?? ''].join('\u0000');
}

function reasoningMetadata(route: AntigravityRoute): ReasoningMetadata {
  return route.reasoningMetadata ?? {
    providerId: route.providerId,
    upstreamModelId: route.upstreamModelId,
    ...(route.baseURL ? { apiBaseUrl: route.baseURL } : {}),
  };
}

/** Hyphen-only ID: the IDE hides picker entries whose ID contains underscores. */
function poolSlug(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return slug || 'free-pool';
}

function poolRowLabel(
  poolName: string,
  level: string,
  mode: PoolEffortMode,
  sliderRowLevel: string | undefined,
): string {
  const label = effortLabel(level);
  if (mode === 'submenu') return poolName + ' (Relay) (' + label + ')';
  // agy names the folded slider row after its lowest folded entry, which
  // therefore carries no level suffix.
  if (mode === 'slider' && level === sliderRowLevel) return poolName + ' (Relay)';
  return poolName + ' ' + label + ' (Relay)';
}

/**
 * Convert resolved members into Antigravity picker rows for the pool.
 *
 * Deterministic and side-effect free: no provider call, no credential read, and
 * no mutation of the member routes it copies from.
 */
export function planPoolAntigravity(
  members: readonly PoolAntigravityMember[],
  opts: {
    poolName?: string;
    effortMode?: PoolEffortMode;
    /** Row budget for this pool only (its own model plus variants). */
    maxRows?: number;
  } = {},
): PoolAntigravityPlan {
  const poolName = opts.poolName?.trim() || 'Free Pool';
  const effortMode = opts.effortMode ?? 'rows';
  const maxRows = Math.min(opts.maxRows ?? POOL_VARIANT_ROWS, POOL_VARIANT_ROWS);
  const excluded: PoolAntigravityPlan['excluded'] = [];
  const eligible: Array<{ route: AntigravityRoute; levels: string[] }> = [];
  const seen = new Set<string>();

  for (const member of members) {
    const route = member.route;
    const key = uniqueness(route);
    if (!member.eligible) {
      excluded.push({
        providerId: route.providerId,
        modelId: route.modelId,
        reason: member.reason?.trim() || 'ineligible',
      });
      continue;
    }
    if (seen.has(key)) {
      excluded.push({ providerId: route.providerId, modelId: route.modelId, reason: 'duplicate-route' });
      continue;
    }
    seen.add(key);
    const caps = getReasoningCapabilities(route.npm, route.upstreamModelId, reasoningMetadata(route));
    if (caps.mode !== 'controllable' || caps.levels.length < 2) {
      // A fixed model cannot honor a concrete pool rung, and Antigravity always
      // sends one. It is reported, never dropped from saved membership.
      excluded.push({
        providerId: route.providerId,
        modelId: route.modelId,
        reason: caps.mode === 'controllable' ? 'insufficient-verified-levels' : 'no-verified-effort-control',
      });
      continue;
    }
    eligible.push({ route, levels: caps.levels });
  }

  const commonEffortLevels = eligible.length === 0
    ? []
    : EFFORT_RANK.filter(level => eligible.every(member => member.levels.includes(level)));
  const offeredLevels = commonEffortLevels.length === 0
    ? []
    : favoriteEffortLevels(commonEffortLevels, POOL_EFFORT_ANCHOR);

  if (eligible.length === 0) {
    return emptyPlan(poolName, commonEffortLevels, offeredLevels, excluded, 'no-eligible-members', maxRows);
  }
  if (commonEffortLevels.length === 0) {
    return emptyPlan(poolName, commonEffortLevels, offeredLevels, excluded, 'no-common-effort', maxRows);
  }
  if (maxRows < 1) {
    return emptyPlan(poolName, commonEffortLevels, offeredLevels, excluded, 'no-row-budget', maxRows);
  }

  const template = eligible[0]!.route;
  const baseId = 'relay-pool-' + poolSlug(poolName);
  const sliderRowLevel = offeredLevels.find(level => SLIDER_LEVELS.includes(level));
  const routes = offeredLevels.slice(0, maxRows).map((level): AntigravityRoute => ({
    ...template,
    catalogId: baseId + '-' + poolSlug(level),
    displayName: poolRowLabel(poolName, level, effortMode, sliderRowLevel),
    reasoningEffort: level,
    reasoningMetadata: reasoningMetadata(template),
  }));

  return {
    poolName,
    routes,
    commonEffortLevels,
    offeredLevels,
    excluded,
    slotCost: { modelRows: POOL_MODEL_ROWS, variantRows: routes.length },
  };
}

function emptyPlan(
  poolName: string,
  commonEffortLevels: string[],
  offeredLevels: string[],
  excluded: PoolAntigravityPlan['excluded'],
  unavailableReason: NonNullable<PoolAntigravityPlan['unavailableReason']>,
  maxRows: number,
): PoolAntigravityPlan {
  return {
    poolName,
    routes: [],
    commonEffortLevels,
    offeredLevels,
    excluded,
    slotCost: { modelRows: maxRows < 1 ? 0 : POOL_MODEL_ROWS, variantRows: 0 },
    unavailableReason,
  };
}

/** Rows the pool may occupy in one catalog: it is one model, never one row per member. */
export const POOL_ROW_BUDGET = POOL_VARIANT_ROWS;

export interface AntigravityPoolLaunchOptions {
  pool: FreePoolPreferences;
  providers: readonly LocalProvider[];
  receipts: readonly PoolCapabilityReceipt[];
  apiKeys: ReadonlyMap<string, string>;
  effortMode: AntigravityEffortMode;
  maxRows: number;
  now?: number;
}

/**
 * Builds one picker row per verified common effort rung. Each row carries the
 * concrete same-effort member routes, so the gateway can fail over at request
 * time while the picker still shows a single pool model.
 */
export function buildAntigravityPoolRoutes(opts: AntigravityPoolLaunchOptions): AntigravityRoute[] {
  const now = opts.now ?? Date.now();
  const routesByMember = new Map<string, Map<string, AntigravityRoute>>();
  for (const member of opts.pool.members) {
    const provider = opts.providers.find(item => item.id === member.providerId);
    const model = provider?.models.find(item => item.id === member.modelId);
    if (!provider || !model || !model.npm || model.modelFormat === 'cloud-code') continue;
    const apiKey = opts.apiKeys.get(provider.id);
    if (!apiKey) continue;
    const freeStatus = poolFreeStatus({ model, providerId: provider.id });
    if (freeStatus !== 'verified_free') continue;
    // Enrollment only mints a receipt for a known provider-declared window.
    // Never substitute a presumed floor for an unknown one.
    if (!Number.isSafeInteger(model.contextWindow) || !meetsContextFloor('antigravity', model.contextWindow)) continue;
    const revision = poolEndpointRevision({
      providerId: provider.id, authRef: provider.authRef, npm: model.npm,
      baseURL: model.apiBaseUrl, upstreamModelId: model.upstreamModelId, headers: provider.headers,
    });
    const receipt = currentPoolReceipt(opts.receipts, member, revision, now);
    if (!receipt || !receipt.billingSafe || !receipt.targets.includes('antigravity')) continue;
    const concrete = buildAntigravityRoutes([{
      providerId: provider.id,
      providerName: provider.name,
      model,
      apiKey,
      authType: provider.authType,
      oauthAccountId: provider.oauthAccountId,
      providerData: provider.providerData,
      headers: provider.headers,
    }], 10, { effortMode: opts.effortMode });
    const byLevel = new Map<string, AntigravityRoute>();
    for (const route of concrete) {
      if (!route.reasoningEffort || !receipt.effortLevels.includes(route.reasoningEffort)) continue;
      if (!byLevel.has(route.reasoningEffort)) {
        byLevel.set(route.reasoningEffort, { ...route, contextWindow: model.contextWindow });
      }
    }
    if (byLevel.size > 0) routesByMember.set(provider.id + ':' + model.id, byLevel);
  }
  if (routesByMember.size === 0) return [];
  const common = [...routesByMember.values()][0]!.keys();
  const levels = [...common].filter(level => [...routesByMember.values()].every(map => map.has(level)))
    .sort((a, b) => EFFORT_RANK.indexOf(a) - EFFORT_RANK.indexOf(b));
  if (levels.length === 0) return [];
  const offered = favoriteEffortLevels(levels, POOL_EFFORT_ANCHOR).slice(0, Math.max(0, opts.maxRows));
  return offered.map(level => {
    const members = [...routesByMember.values()].map(map => map.get(level)!);
    const representative = members[0]!;
    return {
      ...representative,
      catalogId: 'relay-free-pool-' + level,
      providerId: 'relay-free-pool',
      providerName: 'Relay Free Pool',
      modelId: 'free-pool-' + level,
      displayName: 'Relay Free Pool ' + effortLabel(level),
      apiKey: '',
      reasoningEffort: level,
      contextWindow: Math.min(...members.map(member => member.contextWindow!).filter(
        window => Number.isSafeInteger(window) && window > 0)),
      poolMembers: members,
    };
  });
}
