// src/registry/vertex-model-check.ts — confirm the user's Vertex project can serve models
//
// Separate from vertex-anthropic.ts: that module is loaded by the registry for
// every launch and must not pull in the SDK provider factory.

import { generateText } from 'ai';
import { formatUpstreamError } from '../codex/upstream-error.js';
import { VERTEX_ANTHROPIC_NPM } from '../constants.js';
import { createLanguageModel } from '../provider-factory.js';
import {
  DEFAULT_VERTEX_MODELS,
  loadVertexModelEntries,
  resolveVertexProject,
  saveVertexModelEntries,
  type VertexModelEntry,
} from '../vertex-env.js';
import { filterModelsByAvailability, type ProbeClassification } from './probe-models.js';
import type { CachedModel } from './types.js';
import { VERTEX_ANTHROPIC_PROVIDER_ID, vertexAnthropicSetupError } from './vertex-anthropic.js';

export interface VertexModelAccess {
  ok: boolean;
  /** HTTP status of the refusal, 0 for a transport failure. */
  status?: number;
  error?: string;
}

function errorStatus(err: unknown): number {
  const rec = err as { statusCode?: number; lastError?: { statusCode?: number } } | undefined;
  return rec?.statusCode ?? rec?.lastError?.statusCode ?? 0;
}

/** One minimal request: a model that is not enabled for the project fails here, not mid-session. */
export async function checkVertexModelAccess(modelId: string): Promise<VertexModelAccess> {
  try {
    const model = await createLanguageModel({
      npm: VERTEX_ANTHROPIC_NPM, modelId, apiKey: '', providerId: VERTEX_ANTHROPIC_PROVIDER_ID,
    });
    await generateText({
      model, prompt: 'Reply with exactly OK.', maxOutputTokens: 16, maxRetries: 0,
      abortSignal: AbortSignal.timeout(60_000),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, status: errorStatus(err), error: formatUpstreamError(err) };
  }
}

/**
 * Only explicit per-model refusals remove a model: an organization policy that
 * disallows it (400 naming the policy) or Vertex reporting it unknown or not
 * enabled for the project (404). Credential and project-wide failures (401/403)
 * abort without changing anything; rate limits, outages and timeouts keep it.
 */
export function classifyVertexAccess(status: number, message: string): ProbeClassification {
  if (status === 200) return 'available';
  if (status === 404) return { verdict: 'unavailable', detail: 'not found or not enabled for your project' };
  if (status === 400 && /allowedModels|Organization Policy/i.test(message)) {
    return { verdict: 'unavailable', detail: "blocked by your organization's model policy" };
  }
  if (status === 401 || status === 403) return { verdict: 'abort', detail: message };
  return 'unknown';
}

export interface VertexAccessOutcome {
  allowed: VertexModelEntry[];
  removed: Array<{ entry: VertexModelEntry; reason: string }>;
  /** Models that answered; `allowed` also keeps ones whose check was inconclusive. */
  confirmedIds: string[];
  /** Credential or project-wide failure: nothing was removed. */
  aborted: boolean;
  abortDetail?: string;
}

export async function filterVertexModelsByAccess(
  entries: VertexModelEntry[],
  check: (modelId: string) => Promise<VertexModelAccess> = checkVertexModelAccess,
): Promise<VertexAccessOutcome> {
  const reasons = new Map<string, string>();
  const confirmed = new Set<string>();
  const candidates: CachedModel[] = entries.map(entry => ({
    id: entry.id, name: entry.display_name, upstreamModelId: entry.upstream_id ?? entry.id, modelFormat: 'openai',
  }));
  const outcome = await filterModelsByAvailability(candidates, {
    label: 'vertex-access',
    concurrency: 4,
    probe: async model => {
      const access = await check(model.upstreamModelId);
      const status = access.ok ? 200 : access.status ?? 0;
      if (access.ok) confirmed.add(model.id);
      const verdict = classifyVertexAccess(status, access.error ?? '');
      if (typeof verdict === 'object' && verdict.verdict === 'unavailable' && verdict.detail) reasons.set(model.id, verdict.detail);
      return { status, body: access.error ?? '' };
    },
    classify: (status, body) => classifyVertexAccess(status, String(body)),
  });
  if (outcome.aborted) return { allowed: entries, removed: [], confirmedIds: [], aborted: true, abortDetail: outcome.abortDetail };
  const removedIds = new Set(outcome.removedIds);
  return {
    allowed: entries.filter(entry => !removedIds.has(entry.id)),
    removed: entries
      .filter(entry => removedIds.has(entry.id))
      .map(entry => ({ entry, reason: reasons.get(entry.id) ?? 'not available to your project' })),
    confirmedIds: entries.filter(entry => confirmed.has(entry.id)).map(entry => entry.id),
    aborted: false,
  };
}

export interface VertexRefreshOutcome {
  ok: boolean;
  error?: string;
  added: VertexModelEntry[];
  removed: Array<{ entry: VertexModelEntry; reason: string }>;
  unchecked: VertexModelEntry[];
  /** Human-readable summary of added/removed models. */
  notice?: string;
  /** Warning when some existing models couldn't be confirmed (rate limit / outage). */
  warning?: string;
}

/** Place newly discovered defaults where they sit in DEFAULT_VERTEX_MODELS while keeping existing entries intact. */
function insertInDefaultOrder(kept: VertexModelEntry[], added: VertexModelEntry[]): VertexModelEntry[] {
  const rank = new Map(DEFAULT_VERTEX_MODELS.map((m, i) => [m.id, i]));
  const next = [...kept];
  for (const entry of added) {
    const entryRank = rank.get(entry.id) ?? Number.POSITIVE_INFINITY;
    const insertAt = next.findIndex(item => (rank.get(item.id) ?? Number.POSITIVE_INFINITY) > entryRank);
    if (insertAt >= 0) next.splice(insertAt, 0, entry);
    else next.push(entry);
  }
  return next;
}

/**
 * Re-probe the user's Vertex model list plus any missing built-in Claude defaults:
 * add newly allowed defaults, drop models Vertex explicitly refuses, and leave the
 * saved list untouched on auth errors, outages, or when nothing changed.
 */
export async function refreshVertexModels(
  check: (modelId: string) => Promise<VertexModelAccess> = checkVertexModelAccess,
): Promise<VertexRefreshOutcome> {
  const setupError = vertexAnthropicSetupError();
  if (setupError) {
    return {
      ok: false,
      error: `${setupError.error} ${setupError.hint}`,
      added: [],
      removed: [],
      unchecked: [],
    };
  }

  const current = loadVertexModelEntries();
  const extras = DEFAULT_VERTEX_MODELS.filter(d => !current.some(c => c.id === d.id));
  const outcome = await filterVertexModelsByAccess([...current, ...extras], check);
  if (outcome.aborted) {
    return {
      ok: false,
      error: outcome.abortDetail ?? 'Vertex AI rejected the request.',
      added: [],
      removed: [],
      unchecked: [],
    };
  }

  const currentIds = new Set(current.map(c => c.id));
  const removed = outcome.removed.filter(r => currentIds.has(r.entry.id));
  const removedIds = new Set(removed.map(r => r.entry.id));
  const kept = current.filter(c => !removedIds.has(c.id));
  const confirmedIds = new Set(outcome.confirmedIds);
  const added = extras.filter(e => confirmedIds.has(e.id));
  const unchecked = kept.filter(m => !confirmedIds.has(m.id));
  const next = insertInDefaultOrder(kept, added);

  if (next.length === 0) {
    return {
      ok: false,
      error: `None of the ${current.length + extras.length} Claude models are available to project ${resolveVertexProject() ?? '(not set)'}.`,
      added: [],
      removed,
      unchecked: [],
    };
  }

  if (added.length > 0 || removed.length > 0) {
    saveVertexModelEntries(next);
  }

  const noticeParts: string[] = [];
  if (added.length > 0) {
    noticeParts.push(`Added ${added.map(m => m.display_name).join(', ')}.`);
  }
  if (removed.length > 0) {
    noticeParts.push(`Removed ${removed.map(r => `${r.entry.display_name} (${r.reason})`).join(', ')}.`);
  }
  const warning = unchecked.length > 0
    ? `Couldn't confirm ${unchecked.map(m => m.display_name).join(', ')} right now (rate limit or outage) — kept in your list.`
    : undefined;

  return {
    ok: true,
    added,
    removed,
    unchecked,
    ...(noticeParts.length > 0 ? { notice: noticeParts.join(' ') } : {}),
    ...(warning ? { warning } : {}),
  };
}
