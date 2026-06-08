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
import { modelPrefersResponsesApi } from './proxy-responses.js';

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
  return undefined;
}
