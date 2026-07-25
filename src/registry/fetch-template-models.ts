// src/registry/fetch-template-models.ts — test connection and list models for template providers

import { deriveBrand } from '../models.js';
import { resolveContextWindow } from '../context-window.js';
import type { ProviderTemplate } from '../provider-templates.js';
import { normalizeGoogleDisplayName, normalizeGoogleModelId } from './google-model-id.js';
import type { CachedModel } from './types.js';
import { makeTraceLogger, getProviderDebugLogPath } from '../trace-log.js';
import { classifyFreeStatus, isFreeStatus } from '../free-models.js';

const TEST_TIMEOUT_MS = 10_000;

interface OpenAiModelListResponse {
  data?: ProviderModelListRow[];
  models?: ProviderModelListRow[];
  result?: ProviderModelListRow[];
}

interface ProviderModelListRowProperty {
  property_id?: string;
  value?: string;
}

interface ProviderModelListRow {
  id?: string;
  name?: string;
  supported_parameters?: string[];
  context_length?: number;
  contextWindow?: number;
  context_window?: number;
  isFree?: boolean;
  pricing?: Record<string, string | number | undefined>;
  properties?: ProviderModelListRowProperty[];
  use_responses_lite?: boolean;
  prefer_websockets?: boolean;
}

function modelFormatForNpm(npm: string): 'anthropic' | 'openai' {
  return npm === '@ai-sdk/anthropic' ? 'anthropic' : 'openai';
}

function modelsUrl(baseUrl: string, template: ProviderTemplate): string {
  let trimmed = baseUrl.replace(/\/$/, '');
  if (template.modelsPath) {
    if (trimmed.endsWith('/v1') && (template.modelsPath.startsWith('/models') || template.modelsPath.startsWith('/ai/models'))) {
      trimmed = trimmed.slice(0, -3);
    }
    const path = template.modelsPath.startsWith('/') ? template.modelsPath : `/${template.modelsPath}`;
    return `${trimmed}${path}`;
  }
  
  // Note: the 'openai' token matches path segments like /v1/openai (DeepInfra
  // pattern) and custom proxies like /proxy/openai — both get /models appended
  // directly, not /v1/models. This is the intended heuristic.
  if (/\/(v\d+[a-z]*|openai|beta)$/.test(trimmed)) {
    return `${trimmed}/models`;
  }
  return `${trimmed}/v1/models`;
}

function toNumber(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function perMillion(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  return Number((value * 1_000_000).toPrecision(12));
}

function parseNativePricing(pricing: ProviderModelListRow['pricing']): CachedModel['cost'] | undefined {
  if (!pricing) return undefined;

  const inputPerToken =
    toNumber(pricing.prompt) ??
    toNumber(pricing.input) ??
    toNumber(pricing.input_cost_per_token) ??
    toNumber(pricing.inputCostPerToken);
  const outputPerToken =
    toNumber(pricing.completion) ??
    toNumber(pricing.output) ??
    toNumber(pricing.output_cost_per_token) ??
    toNumber(pricing.outputCostPerToken);

  const inputPerMillion =
    toNumber(pricing.input_per_1m_tokens) ??
    toNumber(pricing.inputPer1MTokens);
  const outputPerMillion =
    toNumber(pricing.output_per_1m_tokens) ??
    toNumber(pricing.outputPer1MTokens);

  const input = perMillion(inputPerToken) ?? inputPerMillion;
  const output = perMillion(outputPerToken) ?? outputPerMillion;
  if (input === undefined && output === undefined) return undefined;

  const cost: CachedModel['cost'] = {
    input: input ?? 0,
    output: output ?? 0,
  };

  const cacheRead = perMillion(toNumber(pricing.input_cache_read) ?? toNumber(pricing.cache_read));
  const cacheWrite = perMillion(toNumber(pricing.input_cache_write) ?? toNumber(pricing.cache_write));
  if (cacheRead !== undefined) cost.cache_read = cacheRead;
  if (cacheWrite !== undefined) cost.cache_write = cacheWrite;

  return cost;
}

function parseCloudflarePricing(priceValue: unknown): CachedModel['cost'] | undefined {
  if (!Array.isArray(priceValue)) return undefined;
  let input: number | undefined;
  let output: number | undefined;
  for (const item of priceValue) {
    if (typeof item !== 'object' || !item) continue;
    const row = item as Record<string, unknown>;
    const unit = String(row.unit || '').toLowerCase();
    const price = Number(row.price);
    if (!Number.isFinite(price)) continue;
    if (unit.includes('input')) input = price;
    else if (unit.includes('output')) output = price;
  }
  if (input === undefined && output === undefined) return undefined;
  return { input: input ?? 0, output: output ?? 0 };
}

/** Legacy Cloudflare models that reject function-calling schemas. */
const LEGACY_NON_TOOL_MODELS = new Set([
  '@cf/google/gemma-2b-it-lora',
  '@cf/google/gemma-7b-it-lora',
  '@cf/meta-llama/llama-2-7b-chat-hf-lora',
  '@cf/mistral/mistral-7b-instruct-v0.2-lora',
]);

function parseModelList(body: OpenAiModelListResponse, npm: string): CachedModel[] {
  const rows = body.data ?? body.models ?? body.result ?? [];
  const format = modelFormatForNpm(npm);
  const models: CachedModel[] = [];

  for (const row of rows) {
    const rawId = (row.name?.startsWith('@cf/') || row.name?.startsWith('@hf/') ? row.name : row.id)?.trim();
    if (!rawId) continue;

    let contextWindowFromProps: number | undefined;
    let isFreeFromProps: boolean | undefined;
    let costFromProps: CachedModel['cost'] | undefined;
    if (Array.isArray(row.properties)) {
      if (LEGACY_NON_TOOL_MODELS.has(rawId)) continue;

      const cwProp = row.properties.find(p => p.property_id === 'context_window');
      if (cwProp?.value) contextWindowFromProps = toNumber(cwProp.value as string | number);
      const priceProp = row.properties.find(p => p.property_id === 'price');
      const isRestrictedPaidPlan = rawId.includes('/glm-') || rawId.includes('/kimi-');
      if (isRestrictedPaidPlan) {
        costFromProps = parseCloudflarePricing(priceProp?.value);
        isFreeFromProps = false;
      } else {
        // Cloudflare provides 10,000 free Neurons per day for all standard models
        isFreeFromProps = true;
        if (priceProp?.value) {
          costFromProps = parseCloudflarePricing(priceProp.value);
        }
      }
    }

    const { id, upstreamModelId } = normalizeGoogleModelId(rawId, npm);
    const family = id.replace(/^@[a-z0-9_-]+\//i, '').split(/[-/:]/)[0] ?? id;
    const cost = costFromProps ?? parseNativePricing(row.pricing);
    const freeStatus = classifyFreeStatus({
      model: { cost, isFree: row.isFree },
      // Cloudflare standard models carry a list price but are covered by the free
      // daily Neuron allowance, so free access is a provider rule, not a price.
      freeAccess: isFreeFromProps === true,
    });
    const contextWindow =
      contextWindowFromProps ??
      row.context_length ??
      row.contextWindow ??
      row.context_window ??
      resolveContextWindow(id);
    models.push({
      id,
      name: normalizeGoogleDisplayName(row.name, id),
      upstreamModelId,
      family,
      brand: deriveBrand(family),
      contextWindow,
      cost,
      isFree: isFreeStatus(freeStatus),
      freeStatus,
      modelFormat: format,
      npm,
      supportedParameters: Array.isArray(row.supported_parameters) ? row.supported_parameters : undefined,
      useResponsesLite: typeof row.use_responses_lite === 'boolean' ? row.use_responses_lite : undefined,
      preferWebSockets: typeof row.prefer_websockets === 'boolean' ? row.prefer_websockets : undefined,
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
  extraHeaders?: Record<string, string>,
): Promise<FetchTemplateModelsResult> {
  const trimmedOverride = baseUrlOverride?.trim();
  const baseUrl = (trimmedOverride || template.defaultBaseUrl)?.replace(/\/$/, '');
  if (!baseUrl) {
    return {
      models: [],
      baseUrl: '',
      error: 'This provider needs a base URL.',
      hint: template.urlPrompt
        ? 'Enter the API base URL when adding this provider.'
        : 'This template is missing a default base URL — report a bug.',
    };
  }

  if (template.modelSource === 'static-seed') {
    const models: CachedModel[] = (template.staticModels || []).map(sm => {
      const family = sm.id.split(/[-/:]/)[0] ?? sm.id;
      return {
        id: sm.id,
        name: sm.name,
        upstreamModelId: sm.id,
        family,
        brand: deriveBrand(family),
        contextWindow: resolveContextWindow(sm.id),
        modelFormat: modelFormatForNpm(template.npm),
        npm: template.npm,
      };
    });
    return { models, baseUrl };
  }

  const url = modelsUrl(baseUrl, template);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

  const headers: Record<string, string> = { Accept: 'application/json' };
  const trimmedApiKey = apiKey.trim();
  if (template.npm === '@ai-sdk/anthropic') {
    if (trimmedApiKey) headers['x-api-key'] = trimmedApiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else if (trimmedApiKey) {
    headers['Authorization'] = `Bearer ${trimmedApiKey}`;
  }
  if (template.headers) Object.assign(headers, template.headers);
  if (extraHeaders) Object.assign(headers, extraHeaders);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
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

    let logTrace: ((msg: string) => void) | undefined;
    if (process.env.RELAY_AI_TRACE === '1') {
      logTrace = makeTraceLogger(getProviderDebugLogPath());
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      if (logTrace) {
        logTrace(`[fetchTemplateModels] HTTP ${response.status} from ${url}`);
        logTrace(`[fetchTemplateModels] Body: ${body}`);
      }
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

    const rawBodyText = await response.text().catch(() => '');
    if (logTrace) {
      logTrace(`[fetchTemplateModels] HTTP ${response.status} from ${url}`);
      logTrace(`[fetchTemplateModels] Body: ${rawBodyText}`);
    }

    let json: OpenAiModelListResponse = {};
    try {
      if (rawBodyText.trim()) {
        json = JSON.parse(rawBodyText) as OpenAiModelListResponse;
      }
    } catch {
      // Failed to parse, use empty object
    }

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
