// src/registry/fetch-anthropic-models.ts — list models from an Anthropic-compatible endpoint

import { deriveBrand } from '../models.js';
import { resolveContextWindow } from '../context-window.js';
import { makeTraceLogger, getProviderDebugLogPath } from '../trace-log.js';
import type { CachedModel } from './types.js';

export async function fetchAnthropicModels(
  baseUrl: string,
  apiKey: string,
  extraHeaders?: Record<string, string>,
): Promise<{ models: CachedModel[]; baseUrl: string; error?: string; hint?: string }> {
  const root = baseUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '');
  const modelsUrl = `${root}/v1/models`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(modelsUrl, {
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

    let logTrace: ((msg: string) => void) | undefined;
    if (process.env.RELAY_AI_TRACE === '1') {
      logTrace = makeTraceLogger(getProviderDebugLogPath());
    }

    const rawBodyText = await response.text().catch(() => '');
    if (logTrace) {
      logTrace(`[fetchAnthropicModels] HTTP ${response.status} from ${modelsUrl}`);
      logTrace(`[fetchAnthropicModels] Body: ${rawBodyText}`);
    }

    if (response.ok) {
      let json: { data?: Array<{ id?: string; name?: string }> } = {};
      try {
        if (rawBodyText.trim()) {
          json = JSON.parse(rawBodyText) as { data?: Array<{ id?: string; name?: string }> };
        }
      } catch {
        // Failed to parse
      }

      const models: CachedModel[] = [];
      for (const row of json.data ?? []) {
        const id = row.id?.trim();
        if (!id) continue;
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
      if (models.length > 0) return { models, baseUrl: root };
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
    return {
      models: [],
      baseUrl: root,
      error: 'Could not reach the Anthropic-compatible server.',
      hint: 'Check the base URL and that the server is running.',
    };
  } finally {
    clearTimeout(timer);
  }
}
