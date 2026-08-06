import { classifyFreeStatus, isFreeStatus } from '../free-models.js';
import { deriveBrand } from '../models.js';
import {
  CLINE_PASS_CATALOG_URL,
  CLINE_PASS_VALIDATION_URL,
} from '../cline-pass.js';
import type { CachedModel } from './types.js';

const REQUEST_TIMEOUT_MS = 10_000;

interface ClineModelEntry {
  id?: unknown;
  name?: unknown;
  context_window?: unknown;
  contextWindow?: unknown;
  context_length?: unknown;
  max_input_tokens?: unknown;
  limit?: { context?: unknown };
}

interface ClineRecommendedModelsPayload {
  clinePass?: unknown;
  free?: unknown;
}

function entries(value: unknown): ClineModelEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is ClineModelEntry => Boolean(entry && typeof entry === 'object'));
}

function positiveNumber(value: unknown): number | undefined {
  const number = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : undefined;
  return typeof number === 'number' && Number.isFinite(number) && number > 0 ? number : undefined;
}

function contextWindow(entry: ClineModelEntry): number | undefined {
  return [
    entry.context_window,
    entry.contextWindow,
    entry.context_length,
    entry.max_input_tokens,
    entry.limit?.context,
  ].map(positiveNumber).find((value): value is number => value !== undefined);
}

function toCachedModel(entry: ClineModelEntry, isFree: boolean): CachedModel | null {
  const id = typeof entry.id === 'string' ? entry.id.trim() : '';
  if (!id) return null;
  const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : id;
  const reportedContextWindow = contextWindow(entry);
  const cost = isFree ? { input: 0, output: 0 } : undefined;
  const freeStatus = classifyFreeStatus({ model: { cost, isFree } });
  const family = id.split('/').pop()?.split(/[-:]/)[0] ?? id;
  return {
    id,
    name,
    upstreamModelId: id,
    family,
    brand: deriveBrand(family),
    contextWindow: reportedContextWindow,
    contextWindowSource: reportedContextWindow === undefined ? undefined : 'provider',
    cost,
    isFree: isFreeStatus(freeStatus),
    freeStatus,
    modelFormat: 'openai',
    npm: '@ai-sdk/openai-compatible',
  };
}

/** Parse the public catalog without ever exposing the usage-billed `recommended` list. */
export function parseClinePassModels(payload: unknown): CachedModel[] {
  if (!payload || typeof payload !== 'object') return [];
  const body = payload as ClineRecommendedModelsPayload;
  const byId = new Map<string, CachedModel>();

  for (const entry of entries(body.clinePass)) {
    const model = toCachedModel(entry, false);
    if (model) byId.set(model.id, model);
  }
  for (const entry of entries(body.free)) {
    const model = toCachedModel(entry, true);
    if (model && !byId.has(model.id)) byId.set(model.id, model);
  }

  return [...byId.values()];
}

async function fetchJson(url: string, headers?: Record<string, string>): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', ...headers },
      redirect: 'manual',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchClinePassModels(): Promise<CachedModel[]> {
  const response = await fetchJson(CLINE_PASS_CATALOG_URL);
  if (!response.ok) throw new Error(`ClinePass catalog returned HTTP ${response.status}.`);
  const payload = await response.json().catch(() => null);
  const models = parseClinePassModels(payload);
  if (models.length === 0) throw new Error('ClinePass catalog returned no usable models.');
  return models;
}

export async function validateClinePassApiKey(apiKey: string): Promise<void> {
  const response = await fetchJson(CLINE_PASS_VALIDATION_URL, {
    Authorization: `Bearer ${apiKey.trim()}`,
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error('API key was rejected.');
  }
  if (!response.ok) {
    throw new Error(`ClinePass API key validation returned HTTP ${response.status}.`);
  }
}
