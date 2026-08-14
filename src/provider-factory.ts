// Maps an OpenCode provider's `npm` package (the field providers.ts already
// reads) to a Vercel AI SDK LanguageModel instance. The SDK owns wire format,
// endpoint selection, and provider quirks.
import type { LanguageModel } from 'ai';
import { wrapLanguageModel, extractReasoningMiddleware } from 'ai';
import { VERTEX_ANTHROPIC_NPM, CODEX_RESPONSES_LITE_VERSION, CODEX_RESPONSES_LITE_WS_URL } from './constants.js';
import { extractOpenAiAccountId } from './oauth/openai.js';
import { createResponsesWebSocketFetch } from './oauth/responses-websocket.js';
import {
  CLAUDE_CODE_USER_AGENT,
  injectClaudeIdentity,
} from './oauth/claude-identity.js';
import {
  createClinePassOAuthFetch,
  formatClineRuntimeCredential,
  isClinePassOAuth,
} from './cline-pass.js';

/** Models that must use /v1/responses instead of /v1/chat/completions. */
const RESPONSES_ONLY_PREFIXES = [
  'gpt-5-codex',
  'gpt-5-pro',
  'gpt-5.2-pro',
  'o3',
  'o4',
];

type SdkProviderFactory = (options: {
  apiKey: string;
  baseURL?: string;
  name?: string;
  headers?: Record<string, string>;
  fetch?: typeof globalThis.fetch;
}) => {
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
  // gpt-5.4 and later minor versions require the Responses API (e.g. gpt-5.4, gpt-5.5, gpt-5.6, gpt-5.6-fast).
  const gpt5Minor = lower.match(/^gpt-5\.(\d+)(?:-|$)/);
  if (gpt5Minor && Number(gpt5Minor[1]) >= 4) return true;
  // Versioned Codex IDs (e.g. gpt-5.3-codex) don't match the gpt-5-codex prefix.
  if (lower.startsWith('gpt-') && lower.includes('-codex')) return true;
  // xAI multiagent models (e.g. grok-4.20-multi-agent, grok-4.2-multiagent).
  if (lower.startsWith('grok-') && (lower.includes('multi-agent') || lower.includes('multiagent'))) return true;
  return false;
}

/**
 * OpenAI's Responses API is a strict superset of Chat Completions for every
 * current model — there is no OpenAI model that Chat Completions can serve
 * that Responses cannot. So route every OpenAI model through Responses by
 * default, except pre-chat legacy completion models that predate both APIs
 * and are not agentic chat models at all.
 */
const OPENAI_CHAT_COMPLETIONS_ONLY = [
  'davinci-002',
  'babbage-002',
  'gpt-3.5-turbo-instruct',
];

export function shouldUseOpenAiResponsesEndpoint(modelId: string): boolean {
  return !OPENAI_CHAT_COMPLETIONS_ONLY.includes(modelId.toLowerCase());
}

export interface VertexProviderConfig {
  project: string;
  location: string;
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
  /** Registry authentication mode. OpenAI OAuth uses the ChatGPT Codex backend. */
  authType?: 'api' | 'oauth' | 'none';
  oauthAccountId?: string;
  providerData?: Record<string, unknown>;
  /** Google Vertex AI — uses Application Default Credentials, not apiKey. */
  vertex?: VertexProviderConfig;
  /** Static headers sent on every upstream request (e.g. a plan/auth-tracking header a custom endpoint requires). */
  headers?: Record<string, string>;
  /** Refresh an OAuth access token after the SDK receives one 401 response. */
  refreshToken?: () => Promise<string | null>;
  /** Persist a newly refreshed raw token for future requests. */
  onTokenRefreshed?: (token: string) => void;
  /** Backend capability: model requires the Responses-Lite request shape (x-openai-internal-codex-responses-lite). */
  useResponsesLite?: boolean;
  /** Backend capability: model must use the WebSocket Responses transport instead of HTTP. */
  preferWebSockets?: boolean;
  /** Optional debug logger (wired to the proxy trace log) for transport-level diagnostics. */
  onDebug?: (msg: string) => void;
}

/** True when this provider routes through the SDK adapter (local providers + Zen/Go openai-format). */
export function isSdkMigratedNpm(npm: string | undefined): boolean {
  return !!npm && npm !== '@ai-sdk/anthropic';
}

export function maxToolsForNpm(npm: string | undefined): number | undefined {
  return npm === '@ai-sdk/groq' ? 128 : undefined;
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
    cached.catch(() => factoryCache.delete(npm));
  }
  return cached;
}

export async function createLanguageModel(spec: ProviderModelSpec): Promise<LanguageModel> {
  const { npm, modelId, apiKey, baseURL } = spec;

  if (npm === VERTEX_ANTHROPIC_NPM) {
    if (!spec.vertex?.project) {
      throw new Error('Vertex project is required for @ai-sdk/google-vertex/anthropic');
    }
    const { createVertexAnthropic } = await import('@ai-sdk/google-vertex/anthropic');
    const vertex = createVertexAnthropic({
      project: spec.vertex.project,
      location: spec.vertex.location,
    });
    return vertex(modelId);
  }

  if (npm === '@ai-sdk/openai') {
    const { createOpenAI } = await import('@ai-sdk/openai');
    const accountId = spec.authType === 'oauth'
      ? spec.oauthAccountId ?? extractOpenAiAccountId({ access_token: apiKey })
      : undefined;
    const oauthOptions = spec.authType === 'oauth'
      ? {
          apiKey,
          baseURL: 'https://chatgpt.com/backend-api/codex',
          headers: {
            ...(accountId ? { 'ChatGPT-Account-Id': accountId } : {}),
            originator: 'relay-ai',
            // Responses-Lite models (backend prefer_websockets/use_responses_lite,
            // e.g. gpt-5.6-luna) require these on the request.
            ...(spec.useResponsesLite
              ? { version: CODEX_RESPONSES_LITE_VERSION, 'x-openai-internal-codex-responses-lite': 'true' }
              : {}),
          },
          // Models the backend flags with prefer_websockets are only served over
          // the WebSocket Responses transport, not HTTP.
          ...(spec.preferWebSockets
            ? { fetch: createResponsesWebSocketFetch(CODEX_RESPONSES_LITE_WS_URL, spec.onDebug) }
            : {}),
        }
      : { apiKey };
    const openai = createOpenAI(oauthOptions);
    return shouldUseOpenAiResponsesEndpoint(modelId) ? openai.responses(modelId) : openai.chat(modelId);
  }
  if (npm === '@ai-sdk/xai') {
    const { createXai } = await import('@ai-sdk/xai');
    const xai = createXai({ apiKey });
    return modelPrefersResponsesApi(modelId) ? xai.responses(modelId) : xai(modelId);
  }
  // @ai-sdk/google owns its native v1beta endpoint. Registry templates store the
  // OpenAI-compatible URL only for GET /v1/models discovery — passing it here
  // produces .../v1beta/openai/models/...:streamGenerateContent → 404.
  if (npm === '@ai-sdk/google') {
    const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
    const google = createGoogleGenerativeAI({ apiKey });
    return google(modelId);
  }
  // Registry stores root URL (no /v1) for GET /v1/models discovery — passing it here
  // makes the SDK call https://api.anthropic.com/messages → 404.
  if (npm === '@ai-sdk/anthropic') {
    const { createAnthropic } = await import('@ai-sdk/anthropic');
    const root = baseURL?.replace(/\/v1\/?$/, '').replace(/\/$/, '');
    const anthropicOptions: Parameters<typeof createAnthropic>[0] = spec.authType === 'oauth'
      ? {
          authToken: apiKey,
          ...(spec.providerId === 'claude-code'
            ? {
                headers: {
                  'User-Agent': CLAUDE_CODE_USER_AGENT,
                  'x-app': 'cli',
                  'X-Claude-Code-Session-Id': injectClaudeIdentity(
                    {},
                    spec.providerData,
                    spec.oauthAccountId ?? apiKey,
                  ).sessionId,
                },
              }
            : {}),
        }
      : { apiKey };
    if (spec.headers) {
      anthropicOptions.headers = { ...anthropicOptions.headers, ...spec.headers };
    }
    if (!root || root === 'https://api.anthropic.com') {
      return createAnthropic(anthropicOptions)(modelId);
    }
    const sdkBase = baseURL!.endsWith('/v1') ? baseURL : `${root}/v1`;
    return createAnthropic({ ...anthropicOptions, baseURL: sdkBase })(modelId);
  }
  let model: LanguageModel;

  if (npm === '@ai-sdk/openai-compatible') {
    const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
    const runtimeApiKey = formatClineRuntimeCredential(spec.providerId, spec.authType, apiKey);
    const options = {
      name: spec.providerId ?? 'openai-compatible',
      baseURL: baseURL ?? '',
      ...(runtimeApiKey.trim() ? { apiKey: runtimeApiKey } : {}),
      ...(spec.headers ? { headers: spec.headers } : {}),
      ...(isClinePassOAuth(spec.providerId, spec.authType) && spec.refreshToken
        ? {
            fetch: createClinePassOAuthFetch(
              runtimeApiKey,
              spec.refreshToken,
              spec.onTokenRefreshed,
            ),
          }
        : {}),
    };
    model = createOpenAICompatible({
      ...options,
    })(modelId);
  } else if (npm === '@openrouter/ai-sdk-provider') {
    const { createOpenRouter } = await import('@openrouter/ai-sdk-provider');
    model = createOpenRouter({ apiKey, baseURL, ...(spec.headers ? { headers: spec.headers } : {}) })(modelId);
  } else {
    const create = await loadSdkProviderFactory(npm);
    const provider = create({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
      ...(spec.headers ? { headers: spec.headers } : {}),
    });
    model = provider(modelId);
  }

  const isReasoning = modelId.toLowerCase().match(/deepseek-r1|think|reasoning|qwq/);
  if (isReasoning) {
    return wrapLanguageModel({
      model: model as Parameters<typeof wrapLanguageModel>[0]['model'],
      middleware: [extractReasoningMiddleware({ tagName: 'think' })],
    }) as unknown as LanguageModel;
  }

  return model;
}

export type ReasoningMode = 'none' | 'internal-only' | 'controllable';
export type ReasoningSource = 'provider-metadata' | 'provider-rule' | 'model-metadata' | 'none';
export type ReasoningConfidence = 'verified' | 'documented' | 'inferred';
export type ReasoningWireFormat =
  | { kind: 'openrouter-reasoning' }
  | { kind: 'openai-reasoning-effort' }
  | { kind: 'anthropic-thinking' }
  | { kind: 'google-thinking-config' }
  | { kind: 'mistral-reasoning-effort' }
  | { kind: 'deepseek-thinking' };

export interface ReasoningMetadata {
  providerId?: string;
  apiBaseUrl?: string;
  supportedParameters?: string[];
  reasoning?: boolean;
  interleavedReasoningField?: string;
  /**
   * Bare upstream model id (e.g. 'grok-4.5'), distinct from the request's `model`
   * field which may be a gateway alias or catalog slug (e.g. 'xai-oauth__grok-4.5').
   * Reasoning-capability id-pattern checks must match against this, not body.model.
   */
  upstreamModelId?: string;
}

export interface ReasoningCapabilities {
  levels: string[];
  defaultLevel: string;
  supportsSummaries: boolean;
  mode: ReasoningMode;
  source: ReasoningSource;
  confidence: ReasoningConfidence;
  wireFormat?: ReasoningWireFormat;
}

const ANTHROPIC_EFFORT_LEVELS = ['low', 'medium', 'high'] as const;
const OPENAI_EFFORT_LEVELS = ['low', 'medium', 'high'] as const;
const OPENAI_XHIGH_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh'] as const;
const GEMINI_EFFORT_LEVELS = ['low', 'medium', 'high'] as const;
const MISTRAL_EFFORT_LEVELS = ['high', 'off'] as const;
/**
 * xAI's accepted reasoning_effort values differ by transport, per the installed
 * adapter's own docs (`@ai-sdk/xai/docs/01-xai.mdx`): chat models take
 * `low | high`, Responses models take `low | medium | high`. Neither accepts a
 * `none`/`xhigh` value, so neither is offered.
 */
const XAI_CHAT_EFFORT_LEVELS = ['low', 'high'] as const;
const XAI_RESPONSES_EFFORT_LEVELS = ['low', 'medium', 'high'] as const;
const OPENROUTER_EFFORT_LEVELS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
/** DeepSeek V4 wire values (low/medium map to high; xhigh maps to max). */
const DEEPSEEK_EFFORT_LEVELS = ['high', 'max', 'off'] as const;
/** GLM-5.2 published efforts (OpenRouter metadata): high and xhigh, default high. */
const GLM_52_EFFORT_LEVELS = ['high', 'xhigh'] as const;

const EMPTY_REASONING: ReasoningCapabilities = {
  levels: [],
  defaultLevel: '',
  supportsSummaries: false,
  mode: 'none',
  source: 'none',
  confidence: 'inferred',
};

const EFFORT_DESCRIPTIONS: Record<string, string> = {
  off: 'Turn off extended reasoning',
  none: 'No reasoning',
  minimal: 'Minimal reasoning',
  low: 'Light reasoning',
  medium: 'Balanced reasoning',
  high: 'Deep reasoning',
  xhigh: 'Maximum reasoning',
  max: 'Maximum effort',
};

const GEMINI_25_BUDGETS: Record<string, number> = {
  low: 1024,
  medium: 4096,
  high: 8192,
  xhigh: 16384,
  max: 16384,
  minimal: 512,
  none: 0,
};

/** Claude adaptive-thinking models (opus/sonnet/haiku 4.6+, fable, mythos). */
function isClaudeReasoningModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  if (!lower.startsWith('claude-')) return false;
  if (lower.includes('fable') || lower.includes('mythos')) return true;
  const m = lower.match(/claude-(?:opus|sonnet|haiku)-(\d+)-(\d+)/);
  if (!m) return false;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  return major > 4 || (major === 4 && minor >= 6);
}

function isGeminiReasoningModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return lower.startsWith('gemini-2.5-')
    || lower.startsWith('gemini-3')
    || lower.startsWith('gemini-3.');
}

function isGemini3Model(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return lower.startsWith('gemini-3') || lower.startsWith('gemini-3.');
}

function isMistralReasoningModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return lower.startsWith('mistral-')
    || lower.startsWith('magistral-')
    || lower.startsWith('ministral-')
    || lower.includes('reasoning');
}

/**
 * xAI models that accept `reasoning_effort` on the wire (per xAI docs).
 * models.dev `reasoning: true` is broader — e.g. grok-build-0.1 reasons internally
 * but rejects reasoningEffort (HTTP 400).
 */
function isXaiReasoningEffortModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  if (lower.includes('non-reasoning')) return false;
  if (lower.startsWith('grok-build')) return false;
  if (lower.startsWith('grok-imagine')) return false;
  if (modelPrefersResponsesApi(modelId)) return true;
  if (lower === 'grok-4.3' || lower.startsWith('grok-4.3-')) return true;
  if (lower === 'grok-4.5' || lower.startsWith('grok-4.5-')) return true;
  if (lower.includes('-reasoning')) return true;
  return false;
}

/**
 * xAI's own default reasoning_effort when the param is omitted (per xAI docs).
 * Varies by model — grok-4.3 defaults to 'low', grok-4.5 defaults to 'high'.
 */
function xaiDefaultReasoningEffort(modelId: string): string {
  const lower = modelId.toLowerCase();
  if (lower === 'grok-4.5' || lower.startsWith('grok-4.5-')) return 'high';
  return 'low';
}

/** DeepSeek V4 models with thinking mode + reasoning_effort (direct API). */
function isDeepSeekReasoningModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return lower === 'deepseek-v4-flash'
    || lower === 'deepseek-v4-pro'
    || lower.startsWith('deepseek-v4-flash-')
    || lower.startsWith('deepseek-v4-pro-')
    || lower === 'deepseek-reasoner'
    || lower === 'deepseek-chat';
}

function isKimiReasoningModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return lower.startsWith('kimi-');
}

// Keep exact matching. Kimi uses prefix matching, but switching GLM to prefix
// would newly classify vendor-aliased IDs as reasoning models. That is a
// behavior change, not duplication cleanup.
function isGlm52ReasoningModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return lower === 'glm-5.2'
    || lower === 'z-ai/glm-5.2'
    || lower === 'zai/glm-5.2'
    || lower === 'zai-org/glm-5.2'
    || lower === 'zai-org/glm5.2'
    || lower === 'glm5.2';
}

function toCamelCase(str: string): string {
  return str.replace(/[-_]([a-z])/g, (_, g) => g.toUpperCase());
}

function hasSupportedParameter(metadata: ReasoningMetadata | undefined, param: string): boolean {
  return (metadata?.supportedParameters ?? []).some(p => p === param);
}

function isOpenRouterRoute(npm: string, metadata?: ReasoningMetadata): boolean {
  return npm === '@openrouter/ai-sdk-provider'
    || metadata?.providerId === 'openrouter'
    || metadata?.apiBaseUrl?.includes('openrouter.ai') === true;
}

function openRouterReasoningCapabilities(metadata?: ReasoningMetadata): ReasoningCapabilities {
  if (metadata?.supportedParameters && !hasSupportedParameter(metadata, 'reasoning')) {
    return {
      ...EMPTY_REASONING,
      source: 'provider-metadata',
      confidence: 'documented',
    };
  }
  if (hasSupportedParameter(metadata, 'reasoning')) {
    return {
      levels: [...OPENROUTER_EFFORT_LEVELS],
      defaultLevel: 'medium',
      supportsSummaries: false,
      mode: 'controllable',
      source: 'provider-metadata',
      confidence: 'documented',
      wireFormat: { kind: 'openrouter-reasoning' },
    };
  }
  if (metadata?.reasoning) {
    return {
      ...EMPTY_REASONING,
      mode: 'internal-only',
      source: 'model-metadata',
      confidence: 'inferred',
    };
  }
  return EMPTY_REASONING;
}

function mapCodexEffortToDeepSeek(effort: string): 'high' | 'max' | 'off' | undefined {
  switch (effort) {
    case 'off':
    case 'none':
      return 'off';
    case 'low':
    case 'medium':
    case 'high':
      return 'high';
    case 'xhigh':
    case 'max':
      return 'max';
    default:
      if (effort === 'high' || effort === 'max') return effort;
      return undefined;
  }
}

/** DeepSeek thinking toggle spreads via provider id keys on @ai-sdk/openai-compatible. */
function deepSeekEffortProviderOptions(
  effort: string,
): Record<string, Record<string, unknown>> | undefined {
  const mapped = mapCodexEffortToDeepSeek(effort);
  if (!mapped) return undefined;
  const thinking = { type: mapped === 'off' ? 'disabled' : 'enabled' };
  const spread = { thinking };
  if (mapped === 'off') {
    return {
      deepseek: spread,
      openaiCompatible: spread,
    };
  }
  return {
    openaiCompatible: { reasoningEffort: mapped, ...spread },
    deepseek: spread,
  };
}

function mapCodexEffortToAnthropic(effort: string): string | undefined {
  switch (effort) {
    case 'none':
    case 'minimal':
    case 'low':
      return 'low';
    case 'medium':
      return 'medium';
    case 'high':
    case 'xhigh':
    case 'max':
      return effort === 'xhigh' ? 'high' : effort === 'max' ? 'max' : 'high';
    default:
      if (ANTHROPIC_EFFORT_LEVELS.includes(effort as typeof ANTHROPIC_EFFORT_LEVELS[number])) {
        return effort;
      }
      return undefined;
  }
}

interface OpenAiReasoningProfile {
  levels: readonly string[];
  defaultLevel: string;
}

/**
 * Reasoning-effort profile per **exact** OpenAI model id.
 *
 * Sourced from developers.openai.com model pages (verified 2026-08-14) rather
 * than the installed `@ai-sdk/openai` docs, which still describe `xhigh` as
 * GPT-5.1-Codex-Max-only and are behind the API.
 *
 * Matching is deliberately exact, not prefix-based. A named descendant is a
 * different model with a different effort set — `gpt-5.5-pro` drops `none`/`low`
 * and defaults to `high`, `gpt-5.2-codex` drops `none`, and
 * `gpt-5.2-chat-latest` has no reasoning at all. Letting `gpt-5.5` classify
 * every `gpt-5.5-*` id would advertise values OpenAI rejects. The only alias
 * treated as the same model is a dated snapshot suffix.
 *
 * Unlisted reasoning models fall back to OPENAI_EFFORT_LEVELS, which
 * under-offers rather than sending a value the model may reject. Add entries
 * only with a documented source; re-check when new models ship.
 */
const OPENAI_MODEL_REASONING: Readonly<Record<string, OpenAiReasoningProfile>> = {
  'gpt-5-pro': { levels: ['high'], defaultLevel: 'high' },
  'gpt-5.1': { levels: ['none', 'low', 'medium', 'high'], defaultLevel: 'none' },
  'gpt-5.1-codex-max': { levels: ['low', 'medium', 'high', 'xhigh'], defaultLevel: 'medium' },
  'gpt-5.2': { levels: ['none', 'low', 'medium', 'high', 'xhigh'], defaultLevel: 'none' },
  'gpt-5.2-codex': { levels: ['low', 'medium', 'high', 'xhigh'], defaultLevel: 'medium' },
  'gpt-5.2-pro': { levels: ['medium', 'high', 'xhigh'], defaultLevel: 'medium' },
  'gpt-5.3-codex': { levels: ['low', 'medium', 'high', 'xhigh'], defaultLevel: 'medium' },
  'gpt-5.4': { levels: ['none', 'low', 'medium', 'high', 'xhigh'], defaultLevel: 'none' },
  'gpt-5.4-mini': { levels: ['none', 'low', 'medium', 'high', 'xhigh'], defaultLevel: 'none' },
  'gpt-5.4-nano': { levels: ['none', 'low', 'medium', 'high', 'xhigh'], defaultLevel: 'none' },
  'gpt-5.4-pro': { levels: ['medium', 'high', 'xhigh'], defaultLevel: 'medium' },
  'gpt-5.5': { levels: ['none', 'low', 'medium', 'high', 'xhigh'], defaultLevel: 'medium' },
  'gpt-5.5-pro': { levels: ['medium', 'high', 'xhigh'], defaultLevel: 'high' },
  'gpt-5.6': { levels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], defaultLevel: 'medium' },
  'gpt-5.6-luna': { levels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], defaultLevel: 'medium' },
  'gpt-5.6-sol': { levels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], defaultLevel: 'medium' },
  'gpt-5.6-terra': { levels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], defaultLevel: 'medium' },
};

/**
 * Chat-tuned ids documented as having no reasoning-effort support at all.
 *
 * This overrides `metadata.reasoning`: the bundled models.dev cache marks some
 * of these as reasoning-capable, and trusting it would advertise (and send) an
 * effort OpenAI rejects for the model.
 */
const OPENAI_NON_REASONING_MODELS = new Set([
  'chat-latest',
  'gpt-5-chat-latest',
  'gpt-5.1-chat-latest',
  'gpt-5.2-chat-latest',
  'gpt-5.3-chat-latest',
]);

/** `gpt-5.5-2026-04-23` is the same model as `gpt-5.5`; `gpt-5.5-pro` is not. */
const OPENAI_DATED_SNAPSHOT_SUFFIX = /-\d{4}-\d{2}-\d{2}$/;

/**
 * The id capabilities are decided by: what actually goes on the wire.
 *
 * Catalog ids can be aliases (`gpt-5.5-fast` → `gpt-5.5`), so classifying by
 * the local id would give an alias the wrong — or no — profile, and Codex would
 * then rewrite a valid saved `xhigh` down to the fallback default.
 */
function canonicalOpenAiModelId(modelId: string | undefined, metadata?: ReasoningMetadata): string {
  return (metadata?.upstreamModelId ?? modelId ?? '').toLowerCase();
}

/** The documented profile for a model, or undefined when it isn't listed. */
function openAiReasoningProfile(modelId: string | undefined, metadata?: ReasoningMetadata): OpenAiReasoningProfile | undefined {
  const id = canonicalOpenAiModelId(modelId, metadata);
  if (!id) return undefined;
  return OPENAI_MODEL_REASONING[id]
    ?? OPENAI_MODEL_REASONING[id.replace(OPENAI_DATED_SNAPSHOT_SUFFIX, '')];
}

/**
 * Does this OpenAI model reason at all? Shared by the capability table and the
 * request mapper so they cannot disagree — otherwise the mapper happily builds
 * a `reasoning_effort` for a chat model the catalog reports as non-reasoning.
 * Deliberately free of any call back into `getReasoningCapabilities`, which
 * filters its levels *through* the mapper.
 */
function openAiModelReasons(modelId: string, metadata?: ReasoningMetadata): boolean {
  const id = canonicalOpenAiModelId(modelId, metadata);
  if (OPENAI_NON_REASONING_MODELS.has(id.replace(OPENAI_DATED_SNAPSHOT_SUFFIX, ''))) return false;
  return !!openAiReasoningProfile(modelId, metadata) || modelPrefersResponsesApi(id) || !!metadata?.reasoning;
}

/**
 * First-party OpenAI/Azure: the value is sent verbatim when the model documents
 * it, and omitted otherwise. Never substituted — collapsing `xhigh` to `high`
 * silently sent a weaker level than the caller asked for, and sending `xhigh`
 * to a model without it is an upstream 400.
 */
function mapCodexEffortToOpenAI(effort: string, allowed: readonly string[]): string | undefined {
  return allowed.includes(effort) ? effort : undefined;
}

/** Legacy nearest-value mapping, still used by metadata-inferred routes. */
function mapCodexEffortToOpenAICompatible(effort: string): string | undefined {
  if (effort === 'xhigh') return 'high';
  const allowed = ['low', 'medium', 'high'];
  return allowed.includes(effort) ? effort : undefined;
}

function mapCodexEffortToGlm52(effort: string): 'high' | 'max' | undefined {
  switch (effort) {
    case 'high':
      return 'high';
    case 'xhigh':
    case 'max':
      return 'max';
    default:
      return undefined;
  }
}

/** `supportsMedium` is true only for the Responses transport — see XAI_*_EFFORT_LEVELS. */
function mapCodexEffortToXai(effort: string, supportsMedium: boolean): string | undefined {
  switch (effort) {
    case 'low':
      return 'low';
    case 'medium':
      // Chat has no 'medium'; returning 'low' there would be a silent downgrade.
      return supportsMedium ? 'medium' : undefined;
    case 'high':
    case 'xhigh':
    case 'max':
      return 'high';
    default:
      return undefined;   // none/minimal have no xAI equivalent
  }
}

function mapCodexEffortToGeminiLevel(effort: string): 'low' | 'medium' | 'high' | undefined {
  switch (effort) {
    case 'none':
    case 'minimal':
    case 'low':
      return 'low';
    case 'medium':
      return 'medium';
    case 'high':
    case 'xhigh':
    case 'max':
      return 'high';
    default:
      return GEMINI_EFFORT_LEVELS.includes(effort as typeof GEMINI_EFFORT_LEVELS[number])
        ? effort as 'low' | 'medium' | 'high'
        : undefined;
  }
}

function mapCodexEffortToGeminiBudget(effort: string): number | undefined {
  const direct = GEMINI_25_BUDGETS[effort];
  if (direct !== undefined) return direct > 0 ? direct : undefined;
  const level = mapCodexEffortToGeminiLevel(effort);
  if (!level) return undefined;
  return GEMINI_25_BUDGETS[level];
}

/**
 * Keep the advertised levels and the actual request mapping in lockstep.
 *
 * The capability table dispatches largely on *model id* while
 * `effortProviderOptions` dispatches on the SDK *package*, so the two used to
 * disagree — e.g. GLM/DeepSeek/Kimi ids served through `@ai-sdk/alibaba`
 * advertised levels that mapped to nothing, and xAI advertised a `none` its API
 * has no value for. Filtering the advertised list through the mapper makes that
 * class of drift impossible rather than merely fixed once.
 */
function withMappableLevels(
  caps: ReasoningCapabilities,
  npm: string,
  modelId: string,
  metadata?: ReasoningMetadata,
): ReasoningCapabilities {
  if (caps.mode !== 'controllable') return caps;
  // Keep a level only if it maps to a request at all, *and* to one no
  // lower-ranked level already produces. Two levels that send identical bytes
  // are one level with two names — offering both means the weaker-sounding
  // choice silently wins, which is the substitution this contract forbids.
  const seen = new Set<string>();
  const levels = caps.levels.filter(level => {
    const mapped = effortProviderOptions(npm, level, modelId, metadata);
    if (mapped === undefined) return false;
    const wire = JSON.stringify(mapped);
    if (seen.has(wire)) return false;
    seen.add(wire);
    return true;
  });
  if (levels.length === caps.levels.length) return caps;
  if (levels.length === 0) {
    // Reasons, but nothing about it can actually be set from here.
    return { ...caps, levels: [], defaultLevel: '', mode: 'internal-only' };
  }
  return {
    ...caps,
    levels,
    defaultLevel: levels.includes(caps.defaultLevel) ? caps.defaultLevel : levels[levels.length - 1]!,
  };
}

/** Per-model reasoning UI + wire metadata for Codex catalog and adapters. */
export function getReasoningCapabilities(
  npm: string,
  modelId: string,
  metadata?: ReasoningMetadata,
): ReasoningCapabilities {
  return withMappableLevels(resolveRawReasoningCapabilities(npm, modelId, metadata), npm, modelId, metadata);
}

function resolveRawReasoningCapabilities(
  npm: string,
  modelId: string,
  metadata?: ReasoningMetadata,
): ReasoningCapabilities {
  const id = modelId.toLowerCase();

  if (isOpenRouterRoute(npm, metadata)) {
    return openRouterReasoningCapabilities(metadata);
  }

  if (npm === '@ai-sdk/anthropic' || id.startsWith('claude-')) {
    const isClaude = isClaudeReasoningModel(modelId);
    if (isClaude || metadata?.reasoning) {
      return {
        levels: [...ANTHROPIC_EFFORT_LEVELS],
        defaultLevel: 'high',
        supportsSummaries: true,
        mode: 'controllable',
        source: isClaude ? 'provider-rule' : 'model-metadata',
        confidence: isClaude ? 'documented' : 'inferred',
        wireFormat: { kind: 'anthropic-thinking' },
      };
    }
    return EMPTY_REASONING;
  }

  if (npm === '@ai-sdk/openai' || npm === '@ai-sdk/azure') {
    // Everything below keys off the id that actually reaches OpenAI, not a
    // local catalog alias.
    const canonicalId = canonicalOpenAiModelId(modelId, metadata);
    const profile = openAiReasoningProfile(modelId, metadata);
    const prefersResponses = modelPrefersResponsesApi(canonicalId);
    // Two separate questions: does this model reason at all, and can this
    // transport carry `reasoning_effort`? Only the Responses endpoint can, and
    // that decision has to match the one the model factory actually makes.
    if (openAiModelReasons(modelId, metadata) && shouldUseOpenAiResponsesEndpoint(canonicalId)) {
      const levels = profile?.levels ?? [...OPENAI_EFFORT_LEVELS];
      return {
        levels: [...levels],
        defaultLevel: profile?.defaultLevel
          ?? (levels.includes('medium') ? 'medium' : levels[levels.length - 1]!),
        supportsSummaries: true,
        source: profile || prefersResponses ? 'provider-rule' : 'model-metadata',
        confidence: profile || prefersResponses ? 'documented' : 'inferred',
        mode: 'controllable',
        wireFormat: { kind: 'openai-reasoning-effort' },
      };
    }
    return EMPTY_REASONING;
  }

  if (npm === '@ai-sdk/google' || id.startsWith('gemini-')) {
    if (isGeminiReasoningModel(modelId)) {
      return {
        levels: [...GEMINI_EFFORT_LEVELS],
        defaultLevel: 'medium',
        supportsSummaries: true,
        mode: 'controllable',
        source: 'provider-rule',
        confidence: 'documented',
        wireFormat: { kind: 'google-thinking-config' },
      };
    }
    return EMPTY_REASONING;
  }

  if (npm === '@ai-sdk/mistral') {
    if (isMistralReasoningModel(modelId)) {
      return {
        levels: [...MISTRAL_EFFORT_LEVELS],
        defaultLevel: 'high',
        supportsSummaries: false,
        mode: 'controllable',
        source: 'provider-rule',
        confidence: 'documented',
        wireFormat: { kind: 'mistral-reasoning-effort' },
      };
    }
    return EMPTY_REASONING;
  }

  if (npm === '@ai-sdk/xai') {
    if (isXaiReasoningEffortModel(modelId)) {
      const levels = modelPrefersResponsesApi(modelId)
        ? [...XAI_RESPONSES_EFFORT_LEVELS]
        : [...XAI_CHAT_EFFORT_LEVELS];
      return {
        levels,
        defaultLevel: xaiDefaultReasoningEffort(modelId),
        supportsSummaries: true,
        mode: 'controllable',
        source: 'provider-rule',
        confidence: 'documented',
        wireFormat: { kind: 'openai-reasoning-effort' },
      };
    }
    return EMPTY_REASONING;
  }

  if (isDeepSeekReasoningModel(modelId)) {
    return {
      levels: [...DEEPSEEK_EFFORT_LEVELS],
      defaultLevel: 'high',
      supportsSummaries: true,
      mode: 'controllable',
      source: 'provider-rule',
      confidence: 'documented',
      wireFormat: { kind: 'deepseek-thinking' },
    };
  }

  if (isKimiReasoningModel(modelId)) {
    return {
      levels: [...OPENAI_EFFORT_LEVELS],
      defaultLevel: 'high',
      supportsSummaries: false,
      mode: 'controllable',
      source: 'provider-rule',
      confidence: 'documented',
      wireFormat: { kind: 'openai-reasoning-effort' },
    };
  }

  if (isGlm52ReasoningModel(modelId)) {
    return {
      levels: [...GLM_52_EFFORT_LEVELS],
      defaultLevel: 'high',
      supportsSummaries: false,
      mode: 'controllable',
      source: 'provider-rule',
      confidence: 'documented',
      wireFormat: { kind: 'openai-reasoning-effort' },
    };
  }

  if (hasSupportedParameter(metadata, 'reasoning_effort')) {
    return {
      levels: ['low', 'medium', 'high', 'xhigh'],
      defaultLevel: 'medium',
      supportsSummaries: false,
      mode: 'controllable',
      source: 'provider-metadata',
      confidence: 'documented',
      wireFormat: { kind: 'openai-reasoning-effort' },
    };
  }

  if (hasSupportedParameter(metadata, 'reasoning')) {
    return {
      levels: [...OPENROUTER_EFFORT_LEVELS],
      defaultLevel: 'medium',
      supportsSummaries: false,
      mode: 'controllable',
      source: 'provider-metadata',
      confidence: 'documented',
      wireFormat: { kind: 'openrouter-reasoning' },
    };
  }

  if (metadata?.reasoning) {
    return {
      levels: ['low', 'medium', 'high'],
      defaultLevel: 'medium',
      supportsSummaries: false,
      mode: 'controllable',
      source: 'model-metadata',
      confidence: 'inferred',
      wireFormat: { kind: 'openai-reasoning-effort' },
    };
  }

  return EMPTY_REASONING;
}

export function buildCodexReasoningLevels(
  capabilities: Pick<ReasoningCapabilities, 'levels'>,
): Array<{ effort: string; description: string }> {
  return capabilities.levels.map(effort => ({
    effort,
    description: EFFORT_DESCRIPTIONS[effort] ?? effort,
  }));
}

/** Per-provider providerOptions for user-selected reasoning effort. */
export function effortProviderOptions(
  npm: string,
  effort?: string,
  modelId?: string,
  metadata?: ReasoningMetadata,
): Record<string, Record<string, unknown>> | undefined {
  if (!effort) return undefined;

  if (isOpenRouterRoute(npm, metadata)) {
    const caps = openRouterReasoningCapabilities(metadata);
    if (caps.mode !== 'controllable') return undefined;
    const allowed = new Set(OPENROUTER_EFFORT_LEVELS);
    const mapped = allowed.has(effort as typeof OPENROUTER_EFFORT_LEVELS[number])
      ? effort
      : effort === 'max'
        ? 'xhigh'
        : undefined;
    return mapped
      ? { openrouter: { reasoning: { effort: mapped, exclude: false } } }
      : undefined;
  }

  if (npm === '@ai-sdk/openai' || npm === '@ai-sdk/azure') {
    // `reasoning_effort` only exists on the Responses transport — use the same
    // decision the model factory makes, not the narrower "prefers responses" —
    // and only for models that reason at all. Keyed on the upstream id so an
    // alias route gets its real model's levels.
    if (!modelId || !shouldUseOpenAiResponsesEndpoint(canonicalOpenAiModelId(modelId, metadata))) return undefined;
    if (!openAiModelReasons(modelId, metadata)) return undefined;
    const allowed = openAiReasoningProfile(modelId, metadata)?.levels ?? OPENAI_EFFORT_LEVELS;
    const reasoningEffort = mapCodexEffortToOpenAI(effort, allowed);
    return reasoningEffort ? { openai: { reasoningEffort } } : undefined;
  }

  if (npm === '@ai-sdk/xai') {
    if (!modelId || !isXaiReasoningEffortModel(modelId)) return undefined;
    const reasoningEffort = mapCodexEffortToXai(effort, modelPrefersResponsesApi(modelId));
    return reasoningEffort ? { xai: { reasoningEffort } } : undefined;
  }

  if (npm === '@ai-sdk/anthropic' || npm === VERTEX_ANTHROPIC_NPM) {
    if (!modelId || !isClaudeReasoningModel(modelId)) return undefined;
    const mapped = mapCodexEffortToAnthropic(effort);
    return mapped
      ? { anthropic: { thinking: { type: 'adaptive', effort: mapped } } }
      : undefined;
  }

  if (npm === '@ai-sdk/google') {
    const id = modelId ?? '';
    if (isGemini3Model(id)) {
      const thinkingLevel = mapCodexEffortToGeminiLevel(effort);
      return thinkingLevel
        ? { google: { thinkingConfig: { thinkingLevel, includeThoughts: true } } }
        : undefined;
    }
    const thinkingBudget = mapCodexEffortToGeminiBudget(effort);
    return thinkingBudget
      ? { google: { thinkingConfig: { thinkingBudget, includeThoughts: true } } }
      : undefined;
  }

  if (npm === '@ai-sdk/mistral') {
    if (!modelId || !isMistralReasoningModel(modelId)) return undefined;
    const reasoningEffort = effort === 'off' || effort === 'none' ? 'none' : 'high';
    return { mistral: { reasoningEffort } };
  }

  if (npm === '@ai-sdk/openai-compatible' || npm === '@ai-sdk/openai') {
    if (!modelId) return undefined;
    if (isDeepSeekReasoningModel(modelId)) {
      return deepSeekEffortProviderOptions(effort);
    }
    if (isKimiReasoningModel(modelId)) {
      const reasoningEffort = mapCodexEffortToOpenAICompatible(effort);
      if (reasoningEffort) {
        const key = metadata?.providerId ? toCamelCase(metadata.providerId) : 'openaiCompatible';
        return { [key]: { reasoningEffort } };
      }
      return undefined;
    }
    if (isGlm52ReasoningModel(modelId)) {
      const reasoningEffort = mapCodexEffortToGlm52(effort);
      if (reasoningEffort) {
        const key = metadata?.providerId ? toCamelCase(metadata.providerId) : 'openaiCompatible';
        return { [key]: { reasoningEffort } };
      }
      return undefined;
    }
    if (hasSupportedParameter(metadata, 'reasoning_effort')) {
      const reasoningEffort = mapCodexEffortToOpenAICompatible(effort);
      return reasoningEffort
        ? { openai: { reasoningEffort }, openaiCompatible: { reasoningEffort } }
        : undefined;
    }
    if (hasSupportedParameter(metadata, 'reasoning')) {
      const allowed = new Set(OPENROUTER_EFFORT_LEVELS);
      const mapped = allowed.has(effort as typeof OPENROUTER_EFFORT_LEVELS[number])
        ? effort
        : effort === 'max' ? 'xhigh' : undefined;
      return mapped
        ? { openrouter: { reasoning: { effort: mapped, exclude: false } } }
        : undefined;
    }
    return undefined;
  }

  return undefined;
}

export function deepMergeProviderOptions(
  a?: Record<string, Record<string, unknown>>,
  b?: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> | undefined {
  if (!a && !b) return undefined;
  if (!a) return b;
  if (!b) return a;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: Record<string, Record<string, unknown>> = {};
  for (const key of keys) {
    out[key] = { ...(a[key] ?? {}), ...(b[key] ?? {}) };
  }
  return out;
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
