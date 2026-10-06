import { classifyFreeStatus, isFreeStatus } from '../free-models.js';
import { deriveBrand } from '../models.js';
import {
  CLINE_PASS_CATALOG_URL,
  CLINE_PASS_SDK_BASE_URL,
  CLINE_PASS_VALIDATION_URL,
  formatClineRuntimeCredential,
} from '../cline-pass.js';
import {getProviderDebugLogPath, writeSecureLogLine, localTimestamp } from '../trace-log.js';
import {
  filterModelsByAvailability,
  type ModelAvailabilityProbe,
  type ProbeVerdict,
} from './probe-models.js';
import type { CachedModel } from './types.js';

const REQUEST_TIMEOUT_MS = 10_000;
const PROBE_TIMEOUT_MS = 20_000;
/** Free-bucket probes run one at a time; the free channel drops concurrent calls. */
const PROBE_GAP_MS = 400;
const CLINE_PRODUCT_SURFACES_MARKER = 'only available via cline product surfaces';

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

function trace(message: string): void {
  if (process.env.RELAY_AI_TRACE !== '1') return;
  writeSecureLogLine(
    getProviderDebugLogPath(),
    `${localTimestamp()} ${message}`,
  );
}

async function responseBodyPreview(response: Response): Promise<string> {
  try {
    const clone = typeof response.clone === 'function' ? response.clone() : response;
    if (typeof clone.text !== 'function') return '';
    return (await clone.text()).slice(0, 500).trim();
  } catch {
    return '';
  }
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
  trace(`ClinePass GET ${url} authorization=${headers?.Authorization ? 'present' : 'absent'}`);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', ...headers },
      redirect: 'manual',
      signal: controller.signal,
    });
    trace(`ClinePass response status=${response.status} url=${url}`);
    return response;
  } catch (err) {
    trace(`ClinePass request failed url=${url} error=${err instanceof Error ? err.message : String(err)}`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function bodyErrorText(body: unknown): string {
  if (typeof body === 'string') return body;
  if (!body || typeof body !== 'object') return '';
  const error = (body as { error?: unknown }).error;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const nested = (error as { message?: unknown }).message;
    if (typeof nested === 'string') return nested;
  }
  const message = (body as { message?: unknown }).message;
  return typeof message === 'string' ? message : '';
}

/**
 * Free-bucket models are gated per model: Cline answers excluded ones with
 * `403 ... only available via Cline product surfaces` (their docs state free
 * models are only available in the Cline IDE extension and CLI). Account-level
 * signals — a rejected credential or a subscription problem — abort the whole
 * pass instead, so nothing is removed while the account state is suspect.
 */
export function classifyClineProbeResponse(status: number, body: unknown): ProbeVerdict {
  const message = bodyErrorText(body).toLowerCase();
  if (status === 403 && message.includes(CLINE_PRODUCT_SURFACES_MARKER)) return 'unavailable';
  if (status === 401 || status === 402) return 'abort';
  if (status === 403 && message.includes('subscription')) return 'abort';
  if (status === 403 || status === 429) return 'unknown';
  if (status < 200 || status >= 500) return 'unknown';
  return 'available';
}

export interface ClinePassProbeOptions {
  /** Raw API key or stored OAuth access token; the workos: marker is added for OAuth. */
  credential: string;
  authType: 'api' | 'oauth';
}

function buildClineFreeProbe(options: ClinePassProbeOptions): ModelAvailabilityProbe {
  const runtimeCredential = formatClineRuntimeCredential(
    'cline-pass',
    options.authType,
    options.credential.trim(),
  );
  return {
    label: 'cline-free',
    select: model => model.isFree === true,
    concurrency: 1,
    gapMs: PROBE_GAP_MS,
    trace,
    classify: classifyClineProbeResponse,
    probe: async (model) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
      try {
        const response = await fetch(`${CLINE_PASS_SDK_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // Same identification headers the provider template sends on inference.
            'HTTP-Referer': 'https://cline.bot',
            'X-Title': 'Cline',
            Authorization: `Bearer ${runtimeCredential}`,
          },
          body: JSON.stringify({
            model: model.upstreamModelId,
            max_tokens: 1,
            messages: [{ role: 'user', content: 'hi' }],
          }),
          signal: controller.signal,
        });
        const body = await response.json().catch(() => null);
        return { status: response.status, body };
      } catch {
        return { status: 0, body: null };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export async function fetchClinePassModels(probe?: ClinePassProbeOptions): Promise<CachedModel[]> {
  const response = await fetchJson(CLINE_PASS_CATALOG_URL);
  if (!response.ok) {
    const body = await responseBodyPreview(response);
    if (body) trace(`ClinePass catalog body=${body}`);
    throw new Error(`ClinePass catalog returned HTTP ${response.status}.`);
  }
  const payload = await response.json().catch(() => null);
  const models = parseClinePassModels(payload);
  trace(`ClinePass catalog parsed models=${models.length}`);
  if (models.length === 0) throw new Error('ClinePass catalog returned no usable models.');

  if (!probe?.credential.trim()) {
    trace('ClinePass free probe skipped — no credential available');
    return models;
  }

  const outcome = await filterModelsByAvailability(models, buildClineFreeProbe(probe));
  if (outcome.aborted) {
    trace(`ClinePass free probe paused (${outcome.abortDetail ?? 'account-level rejection'}) — no models removed.`);
  }
  // Never hand back an empty catalog because every free model was removed.
  return outcome.models.length > 0 ? outcome.models : models;
}

export async function validateClinePassApiKey(apiKey: string): Promise<void> {
  const response = await fetchJson(CLINE_PASS_VALIDATION_URL, {
    Authorization: `Bearer ${apiKey.trim()}`,
  });
  const body = await responseBodyPreview(response);
  if (body) trace(`ClinePass validation body=${body}`);
  if (response.status === 401 || response.status === 403) {
    throw new Error('API key was rejected.');
  }
  if (!response.ok) {
    throw new Error(`ClinePass API key validation returned HTTP ${response.status}.`);
  }
}
