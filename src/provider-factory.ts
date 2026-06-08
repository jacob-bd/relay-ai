// Maps an OpenCode provider's `npm` package (the field providers.ts already
// reads) to a Vercel AI SDK LanguageModel instance. The SDK owns wire format,
// endpoint selection, and provider quirks.
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

type SdkProviderFactory = (options: { apiKey: string; baseURL?: string; name?: string }) => {
  (modelId: string): LanguageModel;
  chat: (modelId: string) => LanguageModel;
  responses: (modelId: string) => LanguageModel;
};

const factoryCache = new Map<string, Promise<SdkProviderFactory>>();

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
  return !!npm && npm !== '@ai-sdk/anthropic';
}

function findCreateFactory(mod: Record<string, unknown>): SdkProviderFactory {
  for (const value of Object.values(mod)) {
    if (typeof value === 'function' && value.name.startsWith('create')) {
      return value as SdkProviderFactory;
    }
  }
  throw new Error('No create* factory export found in provider package');
}

async function loadSdkProviderFactory(npm: string): Promise<SdkProviderFactory> {
  let cached = factoryCache.get(npm);
  if (!cached) {
    cached = (async () => {
      try {
        const mod = await import(npm);
        return findCreateFactory(mod as Record<string, unknown>);
      } catch (err) {
        const code = err && typeof err === 'object' && 'code' in err ? err.code : undefined;
        if (code === 'ERR_MODULE_NOT_FOUND') {
          throw new Error(`SDK provider package not installed: ${npm}. Run: npm install ${npm}`);
        }
        throw err;
      }
    })();
    factoryCache.set(npm, cached);
  }
  return cached;
}

export async function createLanguageModel(spec: ProviderModelSpec): Promise<LanguageModel> {
  const { npm, modelId, apiKey, baseURL } = spec;

  if (npm === '@ai-sdk/openai') {
    const { createOpenAI } = await import('@ai-sdk/openai');
    const openai = createOpenAI({ apiKey });
    return modelPrefersResponsesApi(modelId) ? openai.responses(modelId) : openai.chat(modelId);
  }
  if (npm === '@ai-sdk/xai') {
    const { createXai } = await import('@ai-sdk/xai');
    const xai = createXai({ apiKey });
    return modelPrefersResponsesApi(modelId) ? xai.responses(modelId) : xai(modelId);
  }
  if (npm === '@ai-sdk/openai-compatible') {
    const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
    return createOpenAICompatible({
      name: spec.providerId ?? 'openai-compatible',
      apiKey,
      baseURL: baseURL ?? '',
    })(modelId);
  }
  if (npm === '@openrouter/ai-sdk-provider') {
    const { createOpenRouter } = await import('@openrouter/ai-sdk-provider');
    return createOpenRouter({ apiKey, baseURL })(modelId);
  }

  const create = await loadSdkProviderFactory(npm);
  const provider = create(baseURL ? { apiKey, baseURL } : { apiKey });
  return provider(modelId);
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
