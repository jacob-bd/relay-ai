// src/registry/pricing.ts — async pricing enrich from ai-model-pricing.com + bundled fallback
//
// Schema mapping:
//   ai-model-pricing.com entries use dollars per 1M tokens (input_per_1m_tokens, output_per_1m_tokens).
//   CachedModel.cost stores the same units as OpenCode models.json ({ input, output } per 1M tokens).
//   Multi-tier rows: prefer tier=standard + modality=text for the provider platform; else first text row.
//
// Model ID normalization (lookup order):
//   1. Exact id / upstreamModelId
//   2. Platform alias from pricing entry (aliases[platform])
//   3. Lowercase id, strip openrouter/ and provider/ prefixes

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import bundledPricing from '../data/pricing-cache.json';
import { getAppHome } from '../paths.js';
import { localIsoTimestamp } from '../trace-log.js';
import type { CachedModel } from './types.js';
import { loadRegistry, saveRegistry } from './io.js';
import { classifyFreeStatus, isFreeStatus } from '../free-models.js';
import { loadModelsDevCache, resolveModelsDevSlug, type ModelsDevCacheFile } from './models-dev.js';
import { providerKind } from './provider-kind.js';

export const PRICING_API_URL = 'https://ai-model-pricing.com/api/v1/pricing.json';
const FETCH_TIMEOUT_MS = 15_000;
const FILE_MODE = 0o600;

export interface PricingTierRow {
  platform?: string;
  tier?: string;
  modality?: string;
  input_per_1m_tokens?: number;
  output_per_1m_tokens?: number;
  cached_input_per_1m_tokens?: number;
}

export interface PricingModelEntry {
  provider?: string;
  model_id?: string;
  aliases?: Record<string, string>;
  pricing?: PricingTierRow[];
}

export interface PricingCacheFile {
  schema_version?: string;
  generated_at?: string;
  models?: PricingModelEntry[];
}

/** Registry template id → ai-model-pricing platform slug */
export const TEMPLATE_TO_PRICING_PLATFORM: Record<string, string> = {
  groq: 'groq',
  mistral: 'mistral',
  togetherai: 'together',
  cerebras: 'cerebras',
  deepinfra: 'deepinfra',
  xai: 'xai',
  'xai-oauth': 'xai',
  perplexity: 'perplexity',
  cohere: 'cohere',
  openai: 'openai',
  google: 'google_ai_studio',
  alibaba: 'alibaba',
  'qwen-cloud-payg': 'alibaba',
  openrouter: 'openrouter',
  anthropic: 'anthropic',
  nvidia: 'nvidia',
  venice: 'openrouter',
};

const PRICING_OPT_OUT_TEMPLATE_IDS = new Set([
  'qwen-cloud-token-plan',
]);

export function loadBundledPricingCache(): PricingCacheFile {
  return bundledPricing as unknown as PricingCacheFile;
}

function readPricingFile(path: string): PricingCacheFile | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as PricingCacheFile;
  } catch {
    return null;
  }
}

function writePricingCache(path: string, data: PricingCacheFile): void {
  mkdirSafe(dirname(path));
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, { mode: FILE_MODE });
  try {
    chmodSync(path, FILE_MODE);
  } catch {
    // best-effort
  }
}

function mkdirSafe(dir: string): void {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch {
    // ignore
  }
}

export function getUserPricingCachePath(): string {
  return join(getAppHome(), 'pricing-cache.json');
}

export function loadPricingCache(): PricingCacheFile {
  return readPricingFile(getUserPricingCachePath()) ?? loadBundledPricingCache();
}

export async function fetchPricingCache(): Promise<PricingCacheFile | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(PRICING_API_URL, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as PricingCacheFile;
    if (!Array.isArray(data.models)) return null;
    writePricingCache(getUserPricingCachePath(), data);
    return data;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function pickPricingRow(rows: PricingTierRow[], platform?: string): PricingTierRow | null {
  const textRows = rows.filter(r => !r.modality || r.modality === 'text');
  const pool = textRows.length > 0 ? textRows : rows;
  if (platform) {
    const platformStandard = pool.find(r => r.platform === platform && r.tier === 'standard');
    if (platformStandard) return platformStandard;
    const platformAny = pool.find(r => r.platform === platform);
    if (platformAny) return platformAny;
  }
  const standard = pool.find(r => r.tier === 'standard');
  if (standard) return standard;
  return pool[0] ?? null;
}

function rowToCost(row: PricingTierRow): CachedModel['cost'] | undefined {
  if (row.input_per_1m_tokens === undefined && row.output_per_1m_tokens === undefined) return undefined;
  return {
    input: row.input_per_1m_tokens ?? 0,
    output: row.output_per_1m_tokens ?? 0,
  };
}

export function normalizeModelIdCandidates(id: string): string[] {
  const trimmed = id.trim();
  const lower = trimmed.toLowerCase();
  const candidates = new Set<string>([trimmed, lower]);
  for (const prefix of ['openrouter/', 'moonshotai/', 'anthropic/', 'openai/']) {
    if (lower.startsWith(prefix)) {
      candidates.add(lower.slice(prefix.length));
      candidates.add(trimmed.slice(prefix.length));
    }
  }
  const slash = lower.indexOf('/');
  if (slash > 0) {
    candidates.add(lower.slice(slash + 1));
  }
  return [...candidates];
}

export interface PricingIndex {
  byId: Map<string, PricingModelEntry>;
}

export function buildPricingIndex(cache: PricingCacheFile): PricingIndex {
  const byId = new Map<string, PricingModelEntry>();
  for (const entry of cache.models ?? []) {
    if (!entry.model_id) continue;
    for (const candidate of normalizeModelIdCandidates(entry.model_id)) {
      byId.set(candidate, entry);
    }
    if (entry.aliases) {
      for (const alias of Object.values(entry.aliases)) {
        for (const candidate of normalizeModelIdCandidates(alias)) {
          byId.set(candidate, entry);
        }
      }
    }
  }
  return { byId };
}

export function lookupModelCost(
  index: PricingIndex,
  modelId: string,
  platform?: string,
): CachedModel['cost'] | undefined {
  for (const candidate of normalizeModelIdCandidates(modelId)) {
    const entry = index.byId.get(candidate);
    if (!entry?.pricing?.length) continue;
    const row = pickPricingRow(entry.pricing, platform);
    const cost = row ? rowToCost(row) : undefined;
    if (cost) return cost;
  }
  return undefined;
}

export function enrichModelsWithPricing(
  models: CachedModel[],
  index: PricingIndex,
  platform?: string,
): CachedModel[] {
  return models.map(model => {
    const cost =
      lookupModelCost(index, model.id, platform) ??
      lookupModelCost(index, model.upstreamModelId ?? model.id, platform);
    if (!cost) return model;
    const freeStatus = classifyFreeStatus({
      model: { ...model, cost },
      // Keep provider-granted free access (e.g. Cloudflare's daily allowance) when
      // real pricing resolves later.
      freeAccess: model.freeStatus === 'free_provider',
    });
    return { ...model, cost, isFree: isFreeStatus(freeStatus), freeStatus };
  });
}

/**
 * Apply cached pricing for a specific registry provider. Token Plan credits are
 * not PAYG prices, so remove any cached pricing metadata rather than allowing
 * the generic fallback to select an unrelated standard row.
 */
export function enrichModelsForProviderPricing(
  models: CachedModel[],
  index: PricingIndex,
  templateId: string,
  providerId: string,
  metadata: ModelsDevCacheFile = loadModelsDevCache(),
): CachedModel[] {
  if (PRICING_OPT_OUT_TEMPLATE_IDS.has(templateId) || PRICING_OPT_OUT_TEMPLATE_IDS.has(providerId)) {
    return models.map(({ cost: _cost, costSource: _source, referencePrice: _reference, isFree: _isFree, freeStatus: _freeStatus, ...model }) => model);
  }
  return models.map(model => resolveProviderPrice(model, index, templateId, providerId, metadata));
}

// Match names conservatively: preserve dates, versions and variant suffixes.
function priceKey(id: string): string {
  return id.trim().toLowerCase().split('/').pop()!;
}

function validCost(cost: CachedModel['cost']): cost is NonNullable<CachedModel['cost']> {
  return !!cost && Number.isFinite(cost.input) && Number.isFinite(cost.output)
    && cost.input >= 0 && cost.output >= 0;
}

const metadataPriceIndexes = new WeakMap<ModelsDevCacheFile, Map<string, Map<string, NonNullable<CachedModel['cost']>>>>();
function metadataPriceIndex(metadata: ModelsDevCacheFile) {
  let index = metadataPriceIndexes.get(metadata);
  if (index) return index;
  index = new Map();
  for (const [bucket, provider] of Object.entries(metadata)) {
    const models = new Map<string, NonNullable<CachedModel['cost']>>();
    for (const [id, row] of Object.entries(provider.models ?? {})) {
      if (validCost(row.cost)) models.set(priceKey(id), row.cost);
    }
    index.set(bucket, models);
  }
  metadataPriceIndexes.set(metadata, index);
  return index;
}

function resolveProviderPrice(
  model: CachedModel, index: PricingIndex, templateId: string, providerId: string, metadata: ModelsDevCacheFile,
): CachedModel {
  const keys = new Set([priceKey(model.id), priceKey(model.upstreamModelId ?? model.id)]);
  const slug = resolveModelsDevSlug(templateId || providerId);
  const prices = metadataPriceIndex(metadata);
  const matches = (bucket: string) => [...keys].flatMap(key => {
    const cost = prices.get(bucket)?.get(key);
    return cost ? [cost] : [];
  });
  const own = matches(slug)[0];
  const platform = pricingPlatformForProvider(templateId, providerId) ?? providerKind(templateId || providerId);
  let feedCost: CachedModel['cost'];
  for (const id of [model.id, model.upstreamModelId ?? model.id]) {
    for (const key of normalizeModelIdCandidates(id)) {
      const rows = index.byId.get(key)?.pricing ?? [];
      const row = rows.find(r => r.platform === platform && r.tier === 'standard' && (!r.modality || r.modality === 'text'))
        ?? rows.find(r => r.platform === platform && (!r.modality || r.modality === 'text'));
      const cost = row && rowToCost(row);
      if (validCost(cost)) { feedCost = cost; break; }
    }
    if (feedCost) break;
  }
  // Old generic enrichment did not record its source. Recognize its exact value
  // so it can be demoted without treating arbitrary provider prices as generic.
  const legacy = lookupModelCost(index, model.id, platform) ?? lookupModelCost(index, model.upstreamModelId ?? model.id, platform);
  const legacyGeneric = !model.costSource && model.cost && legacy
    && model.cost.input === legacy.input && model.cost.output === legacy.output;
  const providerCost = model.costSource === 'provider' || (model.cost && !model.costSource && !legacyGeneric)
    ? model.cost : undefined;
  const cost = providerCost ?? own ?? feedCost;
  const { cost: _old, costSource: _source, referencePrice: _reference, ...base } = model;
  if (validCost(cost)) {
    const freeStatus = classifyFreeStatus({
      model: { cost }, providerId, templateId, freeAccess: model.freeStatus === 'free_provider',
    });
    return { ...base, cost, costSource: providerCost ? 'provider' : own ? 'models.dev' : 'pricing-feed',
      isFree: isFreeStatus(freeStatus), freeStatus };
  }
  // Reference estimates never participate in free-model classification. Prefer
  // the model vendor, then OpenRouter, then a deterministic paid listing.
  const vendor = /^minimax/i.test(model.id) ? 'minimax' : /^qwen/i.test(model.id) ? 'alibaba'
    : /^deepseek/i.test(model.id) ? 'deepseek' : /^glm/i.test(model.id) ? 'zhipuai'
    : /^kimi/i.test(model.id) ? 'moonshotai' : '';
  const buckets = [...new Set([vendor, 'openrouter', ...Object.keys(metadata).sort()])];
  let referencePrice: CachedModel['referencePrice'];
  for (const bucket of buckets) {
    if (!bucket || bucket === slug || /plan/.test(bucket)) continue;
    const cost = matches(bucket).find(cost => cost.input > 0 || cost.output > 0);
    if (cost) { referencePrice = { cost, provider: bucket, source: 'models.dev' }; break; }
  }
  if (!referencePrice && validCost(legacy) && (legacy.input > 0 || legacy.output > 0)) {
    referencePrice = { cost: legacy, provider: 'other provider', source: 'pricing-feed' };
  }
  // Retain explicit provider access rules, but clear free flags derived from old generic prices.
  const freeStatus = classifyFreeStatus({
    model: legacyGeneric || model.costSource ? {} : base, providerId, templateId,
    freeAccess: model.freeStatus === 'free_provider',
  });
  return { ...base, ...(referencePrice ? { referencePrice } : {}), freeStatus, isFree: isFreeStatus(freeStatus) };
}

export function applyPricingToRegistryProviders(
  registry: import('./types.js').ProviderRegistry,
  cache: PricingCacheFile,
): boolean {
  const index = buildPricingIndex(cache);
  let changed = false;
  for (const provider of registry.providers) {
    if (!provider.modelsCache?.models.length) continue;
    const enriched = enrichModelsForProviderPricing(
      provider.modelsCache.models,
      index,
      provider.templateId,
      provider.id,
    );
    if (JSON.stringify(enriched) !== JSON.stringify(provider.modelsCache.models)) {
      provider.modelsCache = { ...provider.modelsCache, models: enriched };
      changed = true;
    }
  }
  if (changed) {
    registry.pricingCacheAt = cache.generated_at ?? localIsoTimestamp();
  }
  return changed;
}

/** Apply bundled or on-disk pricing cache synchronously (non-blocking enrich baseline). */
export function applyCachedPricing(): boolean {
  const registry = loadRegistry();
  const cache = loadPricingCache();
  const changed = applyPricingToRegistryProviders(registry, cache);
  if (changed) saveRegistry(registry);
  return changed;
}

/** Fetch latest pricing in the background; updates registry when complete. */
export function enrichPricingAsync(onComplete?: (updated: boolean) => void): void {
  void (async () => {
    const fetched = await fetchPricingCache();
    const cache = fetched ?? loadPricingCache();
    const registry = loadRegistry();
    const changed = applyPricingToRegistryProviders(registry, cache);
    if (changed) saveRegistry(registry);
    onComplete?.(changed);
  })();
}

export function pricingPlatformForProvider(templateId: string, providerId: string): string | undefined {
  return TEMPLATE_TO_PRICING_PLATFORM[templateId] ?? TEMPLATE_TO_PRICING_PLATFORM[providerId];
}
