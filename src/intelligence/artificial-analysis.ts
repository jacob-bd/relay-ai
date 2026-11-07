// Optional "intelligence score" from Artificial Analysis (artificialanalysis.ai).
//
// Each user brings their own free API key; Relay only fetches and displays the data (no bundling,
// no redistribution). The key lives in the OS credential store. The free tier must use the `/free`
// list and allows 100 requests per 24 hours; one refresh is a handful of page requests.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getAppHome } from '../paths.js';
import { deleteProviderCredential, readStoredProviderCredential, saveProviderCredential } from '../env.js';

export const AA_AUTH_REF = 'keyring:integration:artificial-analysis';
export const AA_FREE_MODELS_URL = 'https://artificialanalysis.ai/api/v2/language/models/free';
export const AA_SITE_URL = 'https://artificialanalysis.ai/';
/** Refresh at most once a day unless the user asks. */
export const AA_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_PAGES = 10;
const REQUEST_TIMEOUT_MS = 20_000;

export interface IntelligenceEntry { slug: string; name: string; creator?: string; score: number }
export interface IntelligenceCache { fetchedAt: string; indexVersion?: number; models: IntelligenceEntry[] }

export class IntelligenceError extends Error {
  constructor(message: string, readonly code: 'no-key' | 'rejected' | 'rate-limit' | 'network' | 'bad-response') { super(message); }
}

function cachePath(): string { return join(getAppHome(), 'intelligence.json'); }

export function loadIntelligenceCache(): IntelligenceCache | null {
  try {
    const parsed = JSON.parse(readFileSync(cachePath(), 'utf8')) as IntelligenceCache;
    return typeof parsed?.fetchedAt === 'string' && Array.isArray(parsed.models) ? parsed : null;
  } catch { return null; }
}

export function writeIntelligenceCache(cache: IntelligenceCache): void {
  const path = cachePath();
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(cache), { mode: 0o600 });
  renameSync(tmp, path);
  try { chmodSync(path, 0o600); } catch { /* best effort */ }
}

export async function hasIntelligenceKey(): Promise<boolean> {
  return Boolean(await readStoredProviderCredential(AA_AUTH_REF).catch(() => null));
}
export async function saveIntelligenceKey(key: string): Promise<boolean> { return saveProviderCredential(AA_AUTH_REF, key.trim()); }
export async function removeIntelligence(): Promise<void> {
  await deleteProviderCredential(AA_AUTH_REF).catch(() => false);
  try { writeFileSync(cachePath(), JSON.stringify({ fetchedAt: new Date(0).toISOString(), models: [] })); } catch { /* none */ }
}

export function isIntelligenceStale(cache: IntelligenceCache | null, now = Date.now()): boolean {
  if (!cache || cache.models.length === 0) return true;
  const age = now - Date.parse(cache.fetchedAt);
  return !Number.isFinite(age) || age >= AA_MAX_AGE_MS;
}

/** Download every page of the free list. Never includes the key in an error message. */
export async function fetchIntelligenceScores(key: string, fetchImpl: typeof fetch = fetch): Promise<IntelligenceCache> {
  const models: IntelligenceEntry[] = [];
  let indexVersion: number | undefined;
  for (let page = 1; page <= MAX_PAGES; page++) {
    let response: Response;
    try {
      response = await fetchImpl(`${AA_FREE_MODELS_URL}?page=${page}`, {
        headers: { 'x-api-key': key, Accept: 'application/json' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch { throw new IntelligenceError('Could not reach Artificial Analysis. Check your connection.', 'network'); }
    if (response.status === 401 || response.status === 403) throw new IntelligenceError('Artificial Analysis rejected this key. Check that you copied it correctly.', 'rejected');
    if (response.status === 429) throw new IntelligenceError('Artificial Analysis daily request limit reached. Try again tomorrow.', 'rate-limit');
    if (!response.ok) throw new IntelligenceError(`Artificial Analysis returned HTTP ${response.status}.`, 'bad-response');
    const body = await response.json().catch(() => null) as {
      intelligence_index_version?: unknown; pagination?: { has_more?: unknown };
      data?: Array<{ slug?: unknown; name?: unknown; model_creator?: { name?: unknown } | null; evaluations?: { artificial_analysis_intelligence_index?: unknown } }>;
    } | null;
    if (!body || !Array.isArray(body.data)) throw new IntelligenceError('Artificial Analysis sent an unexpected response.', 'bad-response');
    if (typeof body.intelligence_index_version === 'number') indexVersion = body.intelligence_index_version;
    for (const row of body.data) {
      const score = row.evaluations?.artificial_analysis_intelligence_index;
      if (typeof row.slug !== 'string' || typeof score !== 'number' || !Number.isFinite(score)) continue;
      models.push({
        slug: row.slug, name: typeof row.name === 'string' ? row.name : row.slug, score,
        ...(typeof row.model_creator?.name === 'string' ? { creator: row.model_creator.name } : {}),
      });
    }
    if (body.pagination?.has_more !== true) break;
  }
  return { fetchedAt: new Date().toISOString(), ...(indexVersion === undefined ? {} : { indexVersion }), models };
}

/** Fetch with the stored key and save the result. */
export async function refreshIntelligence(fetchImpl: typeof fetch = fetch): Promise<IntelligenceCache> {
  const key = await readStoredProviderCredential(AA_AUTH_REF).catch(() => null);
  if (!key) throw new IntelligenceError('Add your Artificial Analysis API key first.', 'no-key');
  const cache = await fetchIntelligenceScores(key, fetchImpl);
  writeIntelligenceCache(cache);
  return cache;
}

/** Trailing MMDD (or similar) checkpoint dates Artificial Analysis appends, e.g. `…-flash-1017`. */
const CHECKPOINT_DATE = /-\d{4}$/;

/** `cline-pass/glm-5.3`, `vendor/glm-5.3:free`, `glm-5.3-cloud`  →  `glm-5-3`, the way Artificial Analysis writes slugs. */
export function intelligenceKey(modelId: string): string {
  return modelId.toLowerCase()
    .replace(/^~/, '')
    .replace(/^.*\//, '')
    .replace(/[:_.\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/-(free|cloud|batch)$/, '');
}

/**
 * Artificial Analysis often versions a model as `name-MMDD` (and then adds effort suffixes).
 * Providers usually ship the marketing id without the date. Prefer the newest dated *default*
 * score (no `-high` / `-non-reasoning`); never invent an effort level.
 */
function datedDefaultScore(bySlug: Map<string, IntelligenceEntry>, base: string): IntelligenceEntry | undefined {
  let best: IntelligenceEntry | undefined;
  const prefix = `${base}-`;
  for (const [slug, entry] of bySlug) {
    if (!slug.startsWith(prefix)) continue;
    if (!/^\d{4}$/.test(slug.slice(prefix.length))) continue;
    if (!best || slug > best.slug) best = entry;
  }
  return best;
}

/**
 * Match by normalized slug. Also bridges provider marketing ids ↔ AA checkpoint dates
 * (`deepseek-v4.1-flash` ↔ `deepseek-v4-1-flash-1017`). Effort variants (low/high/…) are
 * only used when the model id itself names that effort — a wrong score is worse than none.
 */
export function buildIntelligenceLookup(cache: IntelligenceCache | null): (modelId: string) => IntelligenceEntry | undefined {
  const bySlug = new Map((cache?.models ?? []).map(entry => [entry.slug, entry]));
  return modelId => {
    const key = intelligenceKey(modelId);
    const exact = bySlug.get(key);
    if (exact) return exact;
    if (CHECKPOINT_DATE.test(key)) {
      const withoutDate = bySlug.get(key.replace(CHECKPOINT_DATE, ''));
      if (withoutDate) return withoutDate;
    }
    return datedDefaultScore(bySlug, key);
  };
}
