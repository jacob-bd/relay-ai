// src/registry/fetch-template-models.ts — test connection and list models for template providers

import { deriveBrand } from '../models.js';
import { resolveContextWindow } from '../context-window.js';
import type { ProviderTemplate } from '../provider-templates.js';
import type { CachedModel } from './types.js';

const TEST_TIMEOUT_MS = 10_000;

interface OpenAiModelListResponse {
  data?: Array<{ id?: string; name?: string }>;
  models?: Array<{ id?: string; name?: string }>;
}

function modelFormatForNpm(npm: string): 'anthropic' | 'openai' {
  return npm === '@ai-sdk/anthropic' ? 'anthropic' : 'openai';
}

function modelsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, '');
  if (trimmed.endsWith('/v1')) return `${trimmed}/models`;
  return `${trimmed}/v1/models`;
}

function parseModelList(body: OpenAiModelListResponse, npm: string): CachedModel[] {
  const rows = body.data ?? body.models ?? [];
  const format = modelFormatForNpm(npm);
  const models: CachedModel[] = [];

  for (const row of rows) {
    const id = row.id?.trim();
    if (!id) continue;
    const family = id.split(/[-/:]/)[0] ?? id;
    models.push({
      id,
      name: row.name?.trim() || id,
      upstreamModelId: id,
      family,
      brand: deriveBrand(family),
      contextWindow: resolveContextWindow(id),
      modelFormat: format,
      npm,
    });
  }

  return models;
}

export interface FetchTemplateModelsResult {
  models: CachedModel[];
  baseUrl: string;
  error?: string;
  hint?: string;
}

/** Probe provider API with API key; returns models on success. */
export async function fetchTemplateModels(
  template: ProviderTemplate,
  apiKey: string,
  baseUrlOverride?: string,
): Promise<FetchTemplateModelsResult> {
  const trimmedOverride = baseUrlOverride?.trim();
  const baseUrl = (trimmedOverride || template.defaultBaseUrl)?.replace(/\/$/, '');
  if (!baseUrl) {
    return {
      models: [],
      baseUrl: '',
      error: 'This provider needs a base URL.',
      hint: 'Use relay-ai providers import from OpenCode for advanced setups.',
    };
  }

  const url = modelsUrl(baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      redirect: 'manual',
      signal: controller.signal,
    });

    if (response.status >= 300 && response.status < 400) {
      return {
        models: [],
        baseUrl,
        error: 'Provider redirected the connection test.',
        hint: 'Check the base URL — redirects are blocked for security.',
      };
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const detail = body.slice(0, 200).trim();
      if (response.status === 401 || response.status === 403) {
        return {
          models: [],
          baseUrl,
          error: 'API key was rejected.',
          hint: template.signupUrl
            ? `Get or verify your key at ${template.signupUrl}`
            : 'Double-check the key you pasted.',
        };
      }
      return {
        models: [],
        baseUrl,
        error: `Provider returned HTTP ${response.status}.`,
        hint: detail || 'Check your API key and try again.',
      };
    }

    const json = (await response.json()) as OpenAiModelListResponse;
    const models = parseModelList(json, template.npm);
    if (models.length === 0) {
      return {
        models: [],
        baseUrl,
        error: 'Connected but no models were returned.',
        hint: 'The API key may be valid but model listing is unavailable for this provider.',
      };
    }

    return { models, baseUrl };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const timedOut = message.includes('abort') || message.includes('Abort');
    return {
      models: [],
      baseUrl,
      error: timedOut ? 'Connection timed out after 10 seconds.' : 'Could not reach the provider.',
      hint: timedOut
        ? 'Check your network or try again.'
        : 'Verify the provider is online and your API key is correct.',
    };
  } finally {
    clearTimeout(timer);
  }
}
