// src/registry/models-dev.ts — models.dev capability cache (bundled + optional user refresh)

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import bundledCache from '../data/models-dev-cache.json';
import { getAppHome } from '../paths.js';
import { normalizeModelIdCandidates } from './pricing.js';

export const MODELS_DEV_API_URL = 'https://models.dev/api.json';
const FETCH_TIMEOUT_MS = 15_000;
const FILE_MODE = 0o600;

export interface ModelsDevModalities {
  input?: string[];
  output?: string[];
}

export interface ModelsDevModel {
  id?: string;
  name?: string;
  status?: string;
  family?: string;
  provider?: { npm?: string };
  cost?: { input: number; output: number; cache_read?: number; cache_write?: number };
  limit?: { context?: number };
  tool_call?: boolean;
  chat?: boolean;
  interactions?: boolean;
  reasoning?: boolean;
  reasoning_options?: Array<{ type?: string; values?: unknown[] }>;
  interleaved?: { field?: string };
  modalities?: ModelsDevModalities;
}

export interface ModelsDevProvider {
  id?: string;
  name?: string;
  models?: Record<string, ModelsDevModel>;
}

export type ModelsDevCacheFile = Record<string, ModelsDevProvider>;

export interface ModelsDevCacheMeta {
  schema_version?: string;
  fetched_at?: string;
  source?: string;
  provider_count?: number;
}

const META_KEY = '_relay_meta';

let memoryCache: ModelsDevCacheFile | null = null;
let memoryCachePath: string | null = null;
let memoryCacheMtime = 0;

/** Registry / OpenCode provider id → models.dev top-level key */
export const REGISTRY_TO_MODELS_DEV: Record<string, string> = {
  zen: 'opencode',
  go: 'opencode-go',
  google: 'google',
  openai: 'openai',
  groq: 'groq',
  mistral: 'mistral',
  togetherai: 'together',
  cerebras: 'cerebras',
  deepinfra: 'deepinfra',
  xai: 'xai',
  'xai-oauth': 'xai',
  perplexity: 'perplexity',
  cohere: 'cohere',
  alibaba: 'alibaba',
  'qwen-cloud-token-plan': 'alibaba-token-plan',
  'qwen-cloud-payg': 'alibaba',
  openrouter: 'openrouter',
  anthropic: 'anthropic',
  nvidia: 'nvidia',
  venice: 'openrouter',
};

export function readModelsDevCacheMeta(
  cache: ModelsDevCacheFile,
): ModelsDevCacheMeta | null {
  const raw = cache[META_KEY] as unknown as ModelsDevCacheMeta | undefined;
  if (!raw || typeof raw !== 'object') return null;
  return raw;
}

export function stripModelsDevCacheMeta(cache: ModelsDevCacheFile): ModelsDevCacheFile {
  const { [META_KEY]: _meta, ...providers } = cache;
  return providers;
}

/** A models.dev cache older than this (by `_relay_meta.fetched_at`) is stale. */
export const MODELS_DEV_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/** True when the cache has no valid fetched_at timestamp, or it is older than 24h. */
export function isModelsDevCacheStale(
  cache: ModelsDevCacheFile,
  now: number = Date.now(),
): boolean {
  const fetchedAt = readModelsDevCacheMeta(cache)?.fetched_at;
  if (!fetchedAt) return true;
  const t = Date.parse(fetchedAt);
  if (Number.isNaN(t)) return true;
  return now - t > MODELS_DEV_STALE_AFTER_MS;
}

/**
 * A models.dev payload is usable only if it has ≥2 provider buckets whose
 * `.models` is a non-empty object holding ≥1 real object row. Rejects `{}`,
 * `[]`, `{error}`, empty tables, and null/array rows so a degraded fetch never
 * overwrites the good cache.
 */
export function isUsableModelsDevPayload(data: unknown): boolean {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  let usableBuckets = 0;
  for (const [key, provider] of Object.entries(data as Record<string, unknown>)) {
    if (key.startsWith('_')) continue;
    if (!provider || typeof provider !== 'object' || Array.isArray(provider)) continue;
    const models = (provider as { models?: unknown }).models;
    if (!models || typeof models !== 'object' || Array.isArray(models)) continue;
    const hasRealRow = Object.values(models as Record<string, unknown>).some(
      row => row !== null && typeof row === 'object' && !Array.isArray(row),
    );
    if (hasRealRow && ++usableBuckets >= 2) return true;
  }
  return false;
}

export function loadBundledModelsDevCache(): ModelsDevCacheFile {
  return bundledCache as unknown as ModelsDevCacheFile;
}

export function invalidateModelsDevCache(): void {
  memoryCache = null;
  memoryCachePath = null;
  memoryCacheMtime = 0;
}

function readModelsDevFile(path: string): ModelsDevCacheFile | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ModelsDevCacheFile;
  } catch {
    return null;
  }
}

function mkdirSafe(dir: string): void {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch {
    // ignore
  }
}

function attachModelsDevCacheMeta(
  providers: Record<string, ModelsDevProvider>,
): ModelsDevCacheFile {
  const providerCount = Object.keys(providers).filter(k => !k.startsWith('_')).length;
  return {
    [META_KEY]: {
      schema_version: '1',
      fetched_at: new Date().toISOString(),
      source: MODELS_DEV_API_URL,
      provider_count: providerCount,
    },
    ...providers,
  } as ModelsDevCacheFile;
}

function writeModelsDevCache(path: string, data: ModelsDevCacheFile): void {
  mkdirSafe(dirname(path));
  // Write to a temp file then rename so a crashed/partial write never eats the
  // good cache (rename is atomic on the same filesystem).
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(data)}\n`, { mode: FILE_MODE });
    renameSync(tmp, path);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // temp may not exist
    }
    throw err;
  }
  try {
    chmodSync(path, FILE_MODE);
  } catch {
    // best-effort
  }
  invalidateModelsDevCache();
}

export function getUserModelsDevCachePath(): string {
  return join(getAppHome(), 'models-dev-cache.json');
}

function rememberModelsDevCache(path: string, data: ModelsDevCacheFile): ModelsDevCacheFile {
  memoryCache = data;
  memoryCachePath = path;
  try {
    memoryCacheMtime = statSync(path).mtimeMs;
  } catch {
    memoryCacheMtime = 0;
  }
  return data;
}

export function loadModelsDevCache(): ModelsDevCacheFile {
  const userPath = getUserModelsDevCachePath();
  if (existsSync(userPath)) {
    try {
      const mtime = statSync(userPath).mtimeMs;
      if (memoryCache && memoryCachePath === userPath && memoryCacheMtime === mtime) {
        return memoryCache;
      }
      const data = readModelsDevFile(userPath);
      // A parseable-but-unusable user file (empty/error payload) must not shadow
      // the bundled snapshot — fall through to bundled instead.
      if (data && isUsableModelsDevPayload(data)) {
        return rememberModelsDevCache(userPath, data);
      }
    } catch {
      // fall through to bundled
    }
  }

  if (memoryCache && memoryCachePath === 'bundled') return memoryCache;
  return rememberModelsDevCache('bundled', loadBundledModelsDevCache());
}

export async function fetchModelsDevCache(): Promise<ModelsDevCacheFile | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(MODELS_DEV_API_URL, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as Record<string, ModelsDevProvider>;
    // Reject a degraded payload (empty/error/no real rows) before it can
    // overwrite the good user cache.
    if (!isUsableModelsDevPayload(data)) return null;
    const withMeta = attachModelsDevCacheMeta(data);
    writeModelsDevCache(getUserModelsDevCachePath(), withMeta);
    return withMeta;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function resolveModelsDevSlug(providerId: string): string {
  return REGISTRY_TO_MODELS_DEV[providerId] ?? providerId;
}

/** Fetch latest models.dev catalog in the background; falls back to bundled snapshot offline. */
export function refreshModelsDevCacheAsync(onComplete?: (updated: boolean) => void): void {
  void (async () => {
    const updated = (await fetchModelsDevCache()) !== null;
    onComplete?.(updated);
  })();
}

export function findModelsDevModel(
  providerId: string,
  modelId: string,
  cache: ModelsDevCacheFile = loadModelsDevCache(),
): ModelsDevModel | null {
  const slug = resolveModelsDevSlug(providerId);
  const models = stripModelsDevCacheMeta(cache)[slug]?.models;
  if (!models) return null;

  for (const candidate of normalizeModelIdCandidates(modelId)) {
    const entry = models[candidate];
    if (entry) return entry;
  }
  return null;
}

/** Conservative auto-hide rules — only when models.dev row exists and fields are explicit. */
export function shouldHideByModelsDevCapabilities(entry: ModelsDevModel): boolean {
  const output = entry.modalities?.output;
  if (output && output.length > 0 && !output.includes('text')) return true;
  if (entry.tool_call === false) return true;
  if (entry.interactions === true && entry.chat === false) return true;
  return false;
}

/** Canonical low→high ordering for reasoning-effort levels. */
export const EFFORT_RANK = ['off', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/** Read the declared effort levels from a models.dev row's `reasoning_options`. */
export function extractReasoningEffortLevels(
  entry: ModelsDevModel | null | undefined,
): string[] | undefined {
  if (!entry || typeof entry !== 'object') return undefined;
  const options = entry.reasoning_options;
  if (!Array.isArray(options)) return undefined;
  const effort = options.find(o => o && typeof o === 'object' && o.type === 'effort');
  if (!effort || !Array.isArray(effort.values)) return undefined;
  const values = effort.values.filter(
    (v): v is string => typeof v === 'string' && v.length > 0,
  );
  return values.length > 0 ? values : undefined;
}

export type ModelsDevEffortResult =
  | { kind: 'levels'; levels: string[] }
  | { kind: 'conflict' }
  | { kind: 'unknown' };

// Full-id → matching rows (across every bucket), built once per cache object.
const effortIndexByCache = new WeakMap<object, Map<string, ModelsDevModel[]>>();

function getEffortIndex(cache: ModelsDevCacheFile): Map<string, ModelsDevModel[]> {
  const cached = effortIndexByCache.get(cache);
  if (cached) return cached;
  const index = new Map<string, ModelsDevModel[]>();
  for (const [bucketKey, provider] of Object.entries(cache)) {
    if (bucketKey === META_KEY) continue;
    const models = provider?.models;
    if (!models || typeof models !== 'object') continue;
    for (const [modelKey, entry] of Object.entries(models)) {
      const norm = modelKey.trim().toLowerCase();
      const list = index.get(norm);
      if (list) list.push(entry);
      else index.set(norm, [entry]);
    }
  }
  effortIndexByCache.set(cache, index);
  return index;
}

/**
 * Resolve declared reasoning-effort levels for a model by matching its FULL id
 * (case-insensitive, no bare-name reduction) across every models.dev bucket and
 * intersecting the declared sets. Cross-bucket because aggregator buckets
 * (nano-gpt, kilo, openrouter, …) carry the exact proxied ids that a clean
 * vendor bucket may not. Ordered by {@link EFFORT_RANK}. Known-level overlap →
 * levels; sources genuinely disagree (empty raw intersection) → conflict; no
 * declaration, or agreement only on values outside EFFORT_RANK → unknown.
 */
export function resolveModelsDevEffort(
  modelId: string,
  cache: ModelsDevCacheFile = loadModelsDevCache(),
): ModelsDevEffortResult {
  const target = modelId.trim().toLowerCase();
  const matches = getEffortIndex(cache).get(target);
  if (!matches || matches.length === 0) return { kind: 'unknown' };

  const declaredSets = matches
    .map(entry => extractReasoningEffortLevels(entry))
    .filter((set): set is string[] => Array.isArray(set) && set.length > 0);
  if (declaredSets.length === 0) return { kind: 'unknown' };

  let intersection = new Set(declaredSets[0].map(v => v.trim().toLowerCase()));
  for (const set of declaredSets.slice(1)) {
    const other = new Set(set.map(v => v.trim().toLowerCase()));
    intersection = new Set([...intersection].filter(v => other.has(v)));
  }
  // An empty RAW intersection means ≥2 sources genuinely disagree → conflict
  // (suppress). A non-empty intersection whose values are all outside our known
  // vocab is not a disagreement — we just can't offer those levels, so treat it
  // as unknown and let the caller's legacy heuristics apply instead.
  if (intersection.size === 0) return { kind: 'conflict' };
  const levels = EFFORT_RANK.filter(rank => intersection.has(rank));
  if (levels.length === 0) return { kind: 'unknown' };
  return { kind: 'levels', levels };
}

export interface ModelReasoningMetadata {
  reasoning?: boolean;
  interleavedReasoningField?: string;
  reasoningEffortLevels?: string[];
  reasoningEffortConflict?: boolean;
}

/**
 * Single source of truth for a model's reasoning metadata, shared by the Codex
 * materializer and Core so the two can't diverge. Reasoning/interleaved come
 * from the provider bucket (via {@link findModelsDevModel}); effort levels come
 * from the cross-bucket {@link resolveModelsDevEffort}. `overrides` (a cached
 * model's own values) win over models.dev, matching the prior inline behavior.
 */
export function resolveModelReasoningMetadata(
  providerId: string,
  modelId: string,
  overrides: { reasoning?: boolean; interleavedField?: string } = {},
  cache: ModelsDevCacheFile = loadModelsDevCache(),
): ModelReasoningMetadata {
  const entry = findModelsDevModel(providerId, modelId, cache);
  const result: ModelReasoningMetadata = {};

  const reasoning = overrides.reasoning ?? entry?.reasoning;
  if (reasoning !== undefined) result.reasoning = reasoning;

  const interleaved = overrides.interleavedField ?? entry?.interleaved?.field;
  if (interleaved) result.interleavedReasoningField = interleaved;

  const effort = resolveModelsDevEffort(modelId, cache);
  if (effort.kind === 'levels') result.reasoningEffortLevels = effort.levels;
  else if (effort.kind === 'conflict') result.reasoningEffortConflict = true;

  return result;
}
