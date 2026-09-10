// src/registry/fetch-commandcode-models.ts — Command Code Provider API catalog

import { deriveBrand } from '../models.js';
import type { CachedModel } from './types.js';

export const COMMANDCODE_BASE_URL = 'https://api.commandcode.ai/provider/v1';

const REQUEST_TIMEOUT_MS = 10_000;
const PROBE_TIMEOUT_MS = 25_000;
const PROBE_CONCURRENCY = 6;

/**
 * Command Code splits its catalog across two wire protocols on the same base
 * URL: Claude models are only accepted on `/messages` (Anthropic schema) and
 * everything else only on `/chat/completions` (OpenAI schema). Calling the
 * wrong one is a hard error from the provider, so the route is pinned per model
 * via CachedModel's `npm`/`apiUrl` overrides rather than the provider-level npm.
 * This is why Command Code is a builtin template and not a custom endpoint —
 * a custom endpoint is one protocol or the other, never both.
 */
function isAnthropicSchemaModel(id: string): boolean {
  return id.startsWith('claude-');
}

interface CommandCodeModelEntry {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
}

function positiveNumber(value: unknown): number | undefined {
  const number = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : undefined;
  return typeof number === 'number' && Number.isFinite(number) && number > 0 ? number : undefined;
}

function toCachedModel(entry: CommandCodeModelEntry, baseUrl: string): CachedModel | null {
  const id = typeof entry.id === 'string' ? entry.id.trim() : '';
  if (!id) return null;

  const anthropicSchema = isAnthropicSchemaModel(id);
  const displayName = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : id;
  const contextWindow = positiveNumber(entry.context_length);
  const family = id.split('/').pop()?.split(/[-:]/)[0] ?? id;

  return {
    id,
    name: displayName,
    upstreamModelId: id,
    family,
    brand: deriveBrand(family),
    contextWindow,
    contextWindowSource: contextWindow === undefined ? undefined : 'provider',
    modelFormat: anthropicSchema ? 'anthropic' : 'openai',
    npm: anthropicSchema ? '@ai-sdk/anthropic' : '@ai-sdk/openai-compatible',
    apiUrl: baseUrl,
  };
}

/** Parse an OpenAI-shaped `GET /models` list, pinning each model to its protocol. */
export function parseCommandCodeModels(payload: unknown, baseUrl: string): CachedModel[] {
  if (!payload || typeof payload !== 'object') return [];
  const rows = (payload as { data?: unknown }).data;
  if (!Array.isArray(rows)) return [];

  const models: CachedModel[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const model = toCachedModel(row as CommandCodeModelEntry, baseUrl);
    if (model) models.push(model);
  }
  return models;
}

export type ProbeResult = 'available' | 'not-in-plan' | 'unknown';

/**
 * Command Code gates models by plan, and the gating does not follow model
 * family: on GOAT, gpt-5.6-sol works while gpt-5.5 does not, and gemini-3.8-flash
 * works while gemini-3.5-flash does not. No endpoint reports the caller's plan
 * (every account path 404s), so availability is probed per key.
 *
 * Only an explicit MODEL_NOT_IN_PLAN rejection removes a model. A 503 means the
 * provider behind it is temporarily overloaded, and any other failure is
 * something we cannot attribute, so both keep the model listed rather than
 * silently shrinking the catalog over a transient error.
 */
export function classifyProbeResponse(status: number, body: unknown): ProbeResult {
  const message = typeof body === 'object' && body !== null
    ? String((body as { error?: { message?: unknown } }).error?.message ?? '')
    : '';
  if (status === 403 && message.includes('MODEL_NOT_IN_PLAN')) return 'not-in-plan';
  if (status >= 500) return 'unknown';
  if (status === 429) return 'unknown';
  if (status === 401 || status === 403) return 'unknown';
  if (status >= 200 && status < 500) return 'available';
  return 'unknown';
}

/** One minimal generation: a gated model is refused before it bills anything. */
async function probeModel(
  model: CachedModel,
  baseUrl: string,
  apiKey: string,
): Promise<ProbeResult> {
  const anthropicSchema = model.modelFormat === 'anthropic';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/${anthropicSchema ? 'messages' : 'chat/completions'}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(anthropicSchema
          ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
          : { Authorization: `Bearer ${apiKey}` }),
      },
      body: JSON.stringify({
        model: model.upstreamModelId,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    return classifyProbeResponse(response.status, payload);
  } catch {
    return 'unknown';
  } finally {
    clearTimeout(timer);
  }
}

/** Drop models this key's plan cannot call. Concurrency-limited to stay polite. */
export async function filterModelsByPlan(
  models: CachedModel[],
  baseUrl: string,
  apiKey: string,
): Promise<CachedModel[]> {
  if (!apiKey.trim()) return models;
  const keep: CachedModel[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(PROBE_CONCURRENCY, models.length) }, async () => {
      for (let i = next++; i < models.length; i = next++) {
        const model = models[i]!;
        if (await probeModel(model, baseUrl, apiKey) !== 'not-in-plan') keep.push(model);
      }
    }),
  );
  const order = new Map(models.map((m, i) => [m.id, i]));
  return keep.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

export async function fetchCommandCodeModels(
  baseUrl: string = COMMANDCODE_BASE_URL,
  apiKey?: string,
): Promise<CachedModel[]> {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${normalizedBaseUrl}/models`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(apiKey?.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {}),
      },
      redirect: 'manual',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error('Command Code rejected the API key.');
  }
  if (!response.ok) {
    throw new Error(`Command Code model list returned HTTP ${response.status}.`);
  }

  const payload = await response.json().catch(() => null);
  const models = parseCommandCodeModels(payload, normalizedBaseUrl);
  if (models.length === 0) throw new Error('Command Code returned no usable models.');
  if (!apiKey?.trim()) return models;

  const available = await filterModelsByPlan(models, normalizedBaseUrl, apiKey);
  // Never hand back an empty catalog because every probe happened to fail.
  return available.length > 0 ? available : models;
}
