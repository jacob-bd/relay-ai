// src/registry/fetch-anthropic-models.ts — list models from an Anthropic-compatible endpoint

import { deriveBrand } from '../models.js';
import { resolveContextWindow } from '../context-window.js';
import { makeTraceLogger, getProviderDebugLogPath } from '../trace-log.js';
import type { CachedModel } from './types.js';
import { clampModelTimeoutMs, endpointModelTimeoutMs } from './endpoint-timeout.js';

/** Upper bound on follow-up pages (Anthropic pages hold 20 models by default). */
export const MAX_MODEL_PAGES = 50;

interface AnthropicModelRow { id?: string; name?: string }
interface AnthropicModelsPage {
  data?: AnthropicModelRow[];
  has_more?: boolean;
  last_id?: string;
}

function parsePage(rawBodyText: string): AnthropicModelsPage {
  try {
    if (rawBodyText.trim()) return JSON.parse(rawBodyText) as AnthropicModelsPage;
  } catch {
    // Failed to parse
  }
  return {};
}

export async function fetchAnthropicModels(
  baseUrl: string,
  apiKey: string,
  extraHeaders?: Record<string, string>,
  timeoutMs?: number,
): Promise<{ models: CachedModel[]; baseUrl: string; error?: string; hint?: string; incomplete?: string }> {
  const root = baseUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '');
  const modelsUrl = `${root}/v1/models`;
  const defaultTimeoutMs = endpointModelTimeoutMs('anthropic', root);
  const effectiveTimeoutMs = clampModelTimeoutMs(timeoutMs ?? defaultTimeoutMs, defaultTimeoutMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), effectiveTimeoutMs);

  let logTrace: ((msg: string) => void) | undefined;
  if (process.env.RELAY_AI_TRACE === '1') {
    logTrace = makeTraceLogger(getProviderDebugLogPath());
  }

  const requestPage = (url: string) => fetch(url, {
    method: 'GET',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      Accept: 'application/json',
      ...extraHeaders,
    },
    redirect: 'manual',
    signal: controller.signal,
  });

  try {
    // The first request is unchanged (no query params) so servers that reject
    // unknown parameters behave exactly as before. Only a response that sets
    // `has_more` with a `last_id` cursor triggers follow-up pages.
    let url = modelsUrl;
    let response = await requestPage(url);
    const models: CachedModel[] = [];
    const seenIds = new Set<string>();
    const seenCursors = new Set<string>();
    let incomplete: string | undefined;

    for (let page = 1; ; page++) {
      // Keep a known HTTP error even if its body breaks. Successful catalogs must
      // still propagate body-read failures so stalled bodies report the timeout.
      const rawBodyText = response.ok
        ? await response.text()
        : await response.text().catch(() => '');
      if (logTrace) {
        logTrace(`[fetchAnthropicModels] HTTP ${response.status} from ${url} (page ${page})`);
        logTrace(`[fetchAnthropicModels] Body: ${rawBodyText}`);
      }

      if (!response.ok) {
        if (page === 1) break;
        incomplete = `Page ${page} failed (HTTP ${response.status}); the model list may be missing later models.`;
        break;
      }

      const json = parsePage(rawBodyText);
      for (const row of json.data ?? []) {
        const id = row.id?.trim();
        if (!id || seenIds.has(id)) continue;
        seenIds.add(id);
        models.push({
          id,
          name: row.name?.trim() || id,
          upstreamModelId: id,
          family: id.split('-')[0] ?? id,
          brand: deriveBrand(id),
          contextWindow: resolveContextWindow(id),
          modelFormat: 'anthropic',
          npm: '@ai-sdk/anthropic',
          apiUrl: root,
        });
      }

      const cursor = typeof json.last_id === 'string' ? json.last_id.trim() : '';
      if (json.has_more !== true) break;
      if (!cursor) {
        incomplete = 'Server reported more models but gave no cursor; the model list may be incomplete.';
        break;
      }
      if (seenCursors.has(cursor)) {
        incomplete = 'Server repeated a pagination cursor; the model list may be incomplete.';
        break;
      }
      if (page >= MAX_MODEL_PAGES) {
        incomplete = `Stopped after ${MAX_MODEL_PAGES} pages; the model list may be incomplete.`;
        break;
      }
      seenCursors.add(cursor);
      url = `${modelsUrl}?after_id=${encodeURIComponent(cursor)}`;
      try {
        response = await requestPage(url);
      } catch {
        // Models from earlier pages are still valid; do not present them as the full catalog.
        incomplete = `Page ${page + 1} could not be fetched${controller.signal.aborted ? ' (timed out)' : ''}; the model list may be missing later models.`;
        break;
      }
    }

    if (models.length > 0) {
      if (incomplete && logTrace) logTrace(`[fetchAnthropicModels] incomplete: ${incomplete}`);
      return { models, baseUrl: root, ...(incomplete ? { incomplete } : {}) };
    }

    if (response.status === 401 || response.status === 403) {
      return { models: [], baseUrl: root, error: 'API key was rejected.', hint: 'Check your Anthropic-compatible API key.' };
    }

    return {
      models: [],
      baseUrl: root,
      error: `Could not list models (HTTP ${response.status}).`,
      hint: 'Verify the base URL supports Anthropic-compatible /v1/models or try the OpenAI-compatible option instead.',
    };
  } catch {
    const timedOut = controller.signal.aborted;
    return {
      models: [],
      baseUrl: root,
      error: timedOut
        ? `Connection timed out after ${Math.round(effectiveTimeoutMs / 1000)} seconds.`
        : 'Could not reach the Anthropic-compatible server.',
      hint: timedOut
        ? 'Check your network or try again.'
        : 'Check the base URL and that the server is running.',
    };
  } finally {
    clearTimeout(timer);
  }
}
