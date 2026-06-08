// Maps an OpenCode provider's `npm` package (the field providers.ts already
// reads) to a Vercel AI SDK LanguageModel instance. This replaces the per-
// provider URL/endpoint hand-wiring in resolveEndpoint + the translation
// proxies: the SDK owns wire format, endpoint selection, and provider quirks.
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import { createMistral } from '@ai-sdk/mistral';
import { createXai } from '@ai-sdk/xai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { LanguageModel } from 'ai';

/** Models that must use /v1/responses instead of /v1/chat/completions. */
const RESPONSES_ONLY_PREFIXES = [
  'gpt-5.4',
  'gpt-5.5',
  'gpt-5-codex',
  'gpt-5-pro',
  'gpt-5.2-pro',
  'o3',
  'o4',
];

/**
 * True when a model id must use the OpenAI/xAI Responses API instead of
 * chat/completions. The SDK reflects this by selecting `provider.responses(id)`.
 */
export function modelPrefersResponsesApi(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  if (RESPONSES_ONLY_PREFIXES.some(prefix => lower === prefix || lower.startsWith(`${prefix}-`))) {
    return true;
  }
  // Versioned Codex IDs (e.g. gpt-5.3-codex) don't match the gpt-5-codex prefix.
  if (lower.startsWith('gpt-') && lower.includes('-codex')) return true;
  // xAI multiagent models (e.g. grok-4.20-multi-agent, grok-4.2-multiagent).
  if (lower.startsWith('grok-') && (lower.includes('multi-agent') || lower.includes('multiagent'))) return true;
  return false;
}

export interface ProviderModelSpec {
  /** OpenCode `api.npm` package, e.g. `@ai-sdk/xai`. */
  npm: string;
  modelId: string;
  apiKey: string;
  /** Base URL for openai-compatible / openrouter providers (no trailing path). */
  baseURL?: string;
  /** Provider id for naming openai-compatible instances (diagnostics only). */
  providerId?: string;
}

/** True when this provider routes through the SDK adapter (local providers + Zen/Go openai-format). */
export function isSdkMigratedNpm(npm: string | undefined): boolean {
  return !!npm && SDK_NPM_PACKAGES.has(npm);
}

const SDK_NPM_PACKAGES = new Set([
  '@ai-sdk/openai',
  '@ai-sdk/google',
  '@ai-sdk/groq',
  '@ai-sdk/mistral',
  '@ai-sdk/xai',
  '@ai-sdk/openai-compatible',
  '@openrouter/ai-sdk-provider',
]);

export function createLanguageModel(spec: ProviderModelSpec): LanguageModel {
  const { npm, modelId, apiKey, baseURL } = spec;
  switch (npm) {
    case '@ai-sdk/openai': {
      const openai = createOpenAI({ apiKey });
      return modelPrefersResponsesApi(modelId) ? openai.responses(modelId) : openai.chat(modelId);
    }
    case '@ai-sdk/xai': {
      const xai = createXai({ apiKey });
      return modelPrefersResponsesApi(modelId) ? xai.responses(modelId) : xai(modelId);
    }
    case '@ai-sdk/google':
      return createGoogleGenerativeAI({ apiKey })(modelId);
    case '@ai-sdk/groq':
      return createGroq({ apiKey })(modelId);
    case '@ai-sdk/mistral':
      return createMistral({ apiKey })(modelId);
    case '@ai-sdk/openai-compatible':
      return createOpenAICompatible({
        name: spec.providerId ?? 'openai-compatible',
        apiKey,
        baseURL: baseURL ?? '',
      })(modelId);
    case '@openrouter/ai-sdk-provider':
      return createOpenRouter({ apiKey, baseURL })(modelId);
    default:
      throw new Error(`No SDK provider for npm package: ${npm}`);
  }
}

/** Per-provider providerOptions to request reasoning/thinking output. */
export function thinkingProviderOptions(npm: string): Record<string, Record<string, unknown>> | undefined {
  if (npm === '@ai-sdk/google') {
    return { google: { thinkingConfig: { includeThoughts: true } } };
  }
  // Responses API: request encrypted reasoning blobs for multi-turn round-trip
  // (proxy owns conversation state — store:false + echo via thinking.signature).
  if (npm === '@ai-sdk/openai') {
    return {
      openai: {
        store: false,
        include: ['reasoning.encrypted_content'],
      },
    };
  }
  return undefined;
}
