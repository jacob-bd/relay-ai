// Maps an OpenCode provider's `npm` package (the field providers.ts already
// reads) to a Vercel AI SDK LanguageModel instance. The SDK owns wire format,
// endpoint selection, and provider quirks.
import type { LanguageModel, LanguageModelMiddleware } from 'ai';
import { wrapLanguageModel, extractReasoningMiddleware } from 'ai';
import { VERTEX_ANTHROPIC_NPM, CODEX_RESPONSES_LITE_WS_URL } from './constants.js';
import { EFFORT_RANK } from './registry/models-dev.js';
import { resolveCodexClientVersion } from './codex/version.js';
import { extractOpenAiAccountId } from './oauth/openai.js';
import { createResponsesWebSocketFetch } from './oauth/responses-websocket.js';
import {
  CLAUDE_CODE_BILLING_HEADER_PREFIX,
  CLAUDE_CODE_USER_AGENT,
  buildClaudeCodeBillingSystemLine,
  injectClaudeIdentity,
} from './oauth/claude-identity.js';
import { applyClaudeCodeOAuthIdentity, isClaudeCodeOAuthRoute, type ClaudeCodeOAuthSdkParams } from './oauth/claude-code-identity.js';
import { createOAuthRetryFetch } from './upstream-forward.js';
import {
  createClinePassOAuthFetch,
  formatClineRuntimeCredential,
  isClinePassOAuth,
} from './cline-pass.js';
import {
  classifyProtocolFailure,
  isDualProtocolGateway,
  protocolCacheKey,
  protocolCooldownActive,
  rememberProtocol,
  rememberProtocolFailure,
  rememberedProtocol,
  resolveProtocolAlternative,
  type GatewayProtocol,
} from './gateway-protocol.js';

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

/**
 * Venice's published SDK package still peers on AI SDK 6. Route it through the
 * first-party openai-compatible provider so Relay does not nest a v6 tree.
 * Existing registries that stored `venice-ai-sdk-provider` keep working.
 */
export function resolveProviderNpm(npm: string): string {
  return npm === 'venice-ai-sdk-provider' ? '@ai-sdk/openai-compatible' : npm;
}

/**
 * Codex sends a blind 65,536-token output cap. OpenRouter reserves credit for
 * that entire amount before generation, so a low-limit key can receive HTTP
 * 402 even for a tiny prompt. Keep the guard at the actual HTTP boundary as
 * well as in the Responses translator: this catches stale metadata and any
 * future call path that constructs SDK params directly.
 */
export const OPENROUTER_BLIND_MAX_OUTPUT_TOKENS = 65_536;

export function createOpenRouterFetch(
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): typeof globalThis.fetch {
  return async (input, init) => {
    if (!init || typeof init.body !== 'string') {
      return fetchImpl(input, init);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(init.body);
    } catch {
      return fetchImpl(input, init);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return fetchImpl(input, init);
    }

    const body = parsed as Record<string, unknown>;
    if (body.max_tokens !== OPENROUTER_BLIND_MAX_OUTPUT_TOKENS) {
      return fetchImpl(input, init);
    }

    const { max_tokens: _blindCap, ...withoutBlindCap } = body;
    return fetchImpl(input, {
      ...init,
      body: JSON.stringify(withoutBlindCap),
    });
  };
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

async function createLanguageModelSingle(spec: ProviderModelSpec): Promise<LanguageModel> {
  const npm = resolveProviderNpm(spec.npm);
  const { modelId, apiKey, baseURL } = spec;

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
            // e.g. gpt-5.6-luna) require these on the request. The version is
            // resolved at runtime (npm latest → installed CLI → bundled
            // fallback) so new model gates don't need a Relay release.
            ...(spec.useResponsesLite
              ? { version: await resolveCodexClientVersion(), 'x-openai-internal-codex-responses-lite': 'true' }
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
    const openRouterBearer = spec.providerId?.trim().toLowerCase() === 'openrouter'
      || root?.includes('openrouter.ai') === true;
    const anthropicOptions: Parameters<typeof createAnthropic>[0] = spec.authType === 'oauth' || openRouterBearer
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
    if (spec.authType === 'oauth' && spec.refreshToken) {
      anthropicOptions.fetch = createOAuthRetryFetch(apiKey, spec.refreshToken, spec.onTokenRefreshed);
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
    model = createOpenRouter({
      apiKey,
      baseURL,
      fetch: createOpenRouterFetch(),
      ...(spec.headers ? { headers: spec.headers } : {}),
    })(modelId);
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

function protocolForNpm(npm: string): GatewayProtocol {
  return npm === '@ai-sdk/anthropic' ? 'anthropic' : 'openai';
}

function isSemanticStreamPart(part: unknown): boolean {
  if (!part || typeof part !== 'object') return false;
  const type = (part as { type?: unknown }).type;
  return type === 'text-start'
    || type === 'text-delta'
    || type === 'reasoning-start'
    || type === 'reasoning-delta'
    || type === 'tool-input-start'
    || type === 'tool-input-delta'
    || type === 'tool-input-end'
    || type === 'tool-call'
    || type === 'tool-result'
    || type === 'tool-approval-request';
}

const MAX_PROTOCOL_PRELUDE_BYTES = 64 * 1024;
const MAX_PROTOCOL_PRELUDE_EVENTS = 256;

function streamPartBytes(part: unknown): number {
  try { return JSON.stringify(part)?.length ?? 0; } catch { return 0; }
}

function observeAlternateStream(
  result: { stream: ReadableStream<unknown>; [key: string]: unknown },
  protocol: GatewayProtocol,
  cacheKey: string,
): { stream: ReadableStream<unknown>; [key: string]: unknown } {
  const reader = result.stream.getReader();
  const stream = new ReadableStream<unknown>({
    start: controller => {
      void (async () => {
        let semantic = false;
        let finish = false;
        try {
          while (true) {
            const next = await reader.read();
            if (next.done) break;
            semantic ||= isSemanticStreamPart(next.value);
            finish ||= Boolean(next.value && typeof next.value === 'object' && (next.value as { type?: unknown }).type === 'finish');
            controller.enqueue(next.value);
          }
          if (semantic && finish) rememberProtocol(cacheKey, protocol);
          else rememberProtocolFailure(cacheKey);
          controller.close();
        } catch (error) {
          rememberProtocolFailure(cacheKey);
          controller.error(error);
        } finally {
          reader.releaseLock();
        }
      })();
    },
    cancel: reason => reader.cancel(reason),
  });
  return { ...result, stream };
}

/**
 * Wrap a dual-protocol route with one bounded alternate attempt. The stream
 * is held until the first semantic event so a failed endpoint can never leak
 * a partial Anthropic response before the alternate protocol takes over.
 */
function createProtocolFallbackMiddleware(
  primary: LanguageModel,
  alternate: LanguageModel,
  primaryProtocol: GatewayProtocol,
  alternateProtocol: GatewayProtocol,
  cacheKey: string,
  onDebug?: (msg: string) => void,
): LanguageModelMiddleware {
  const alternateModel = alternate as LanguageModel & {
    doGenerate: (params: unknown) => Promise<unknown>;
    doStream: (params: unknown) => Promise<{ stream: ReadableStream<unknown>; [key: string]: unknown }>;
  };

  const note = (message: string): void => {
    onDebug?.(`[protocol-fallback] ${message}`);
  };

  // Read on every call, not once at creation: the server reuses one wrapped
  // model for its whole lifetime, so the learned order and the failure pause
  // must be checked per request.
  const attemptOrder = (runPrimary: () => PromiseLike<unknown>, runAlternate: () => PromiseLike<unknown>) => (
    rememberedProtocol(cacheKey) === alternateProtocol
      ? { first: runAlternate, second: runPrimary, firstProtocol: alternateProtocol, secondProtocol: primaryProtocol }
      : { first: runPrimary, second: runAlternate, firstProtocol: primaryProtocol, secondProtocol: alternateProtocol }
  );

  // When the second endpoint also rejects the request as the wrong format,
  // the first endpoint's error is the real one, and keeps the SDK's retry.
  const surfacedError = (firstError: unknown, secondError: unknown): unknown => (
    classifyProtocolFailure(secondError).retryable ? firstError : secondError
  );

  return {
    specificationVersion: 'v4',
    wrapGenerate: async ({ doGenerate, params }): Promise<any> => {
      if (protocolCooldownActive(cacheKey)) return doGenerate();
      const { first, second, firstProtocol, secondProtocol } = attemptOrder(
        doGenerate,
        () => alternateModel.doGenerate(params),
      );
      try {
        const result = await first();
        rememberProtocol(cacheKey, firstProtocol);
        return result;
      } catch (error) {
        const failure = classifyProtocolFailure(error);
        if (!failure.retryable) throw error;
        note(`${firstProtocol} failed (${failure.reason}${failure.status ? `, HTTP ${failure.status}` : ''}); retrying ${secondProtocol}`);
        let result: unknown;
        try {
          result = await second();
        } catch (alternateError) {
          const alternateFailure = classifyProtocolFailure(alternateError);
          note(`${secondProtocol} failed after fallback (${alternateFailure.reason}${alternateFailure.status ? `, HTTP ${alternateFailure.status}` : ''})`);
          rememberProtocolFailure(cacheKey);
          throw surfacedError(error, alternateError);
        }
        rememberProtocol(cacheKey, secondProtocol);
        return result;
      }
    },
    wrapStream: async ({ doStream, params }): Promise<any> => {
      if (protocolCooldownActive(cacheKey)) return doStream();
      const { first, second, firstProtocol, secondProtocol } = attemptOrder(
        doStream,
        () => alternateModel.doStream(params),
      );
      let primaryResult: { stream: ReadableStream<unknown>; [key: string]: unknown };
      try {
        primaryResult = await first() as typeof primaryResult;
      } catch (error) {
        const failure = classifyProtocolFailure(error);
        if (!failure.retryable) throw error;
        note(`${firstProtocol} stream failed (${failure.reason}${failure.status ? `, HTTP ${failure.status}` : ''}); retrying ${secondProtocol}`);
        let alternateResult: { stream: ReadableStream<unknown>; [key: string]: unknown };
        try {
          alternateResult = await second() as typeof alternateResult;
        } catch (alternateError) {
          const alternateFailure = classifyProtocolFailure(alternateError);
          note(`${secondProtocol} stream failed after fallback (${alternateFailure.reason}${alternateFailure.status ? `, HTTP ${alternateFailure.status}` : ''})`);
          rememberProtocolFailure(cacheKey);
          throw surfacedError(error, alternateError);
        }
        return observeAlternateStream(alternateResult, secondProtocol, cacheKey) as never;
      }

      const primaryReader = primaryResult.stream.getReader();
      let switched = false;
      const stream = new ReadableStream<unknown>({
        start: controller => {
          void (async () => {
            const buffered: unknown[] = [];
            let bufferedBytes = 0;
            let committed = false;
            let terminal = false;

            const pipeAlternate = async (cause: unknown, force = false): Promise<void> => {
              if (switched) {
                controller.error(cause);
                return;
              }
              const failure = classifyProtocolFailure(cause);
              if (!force && !failure.retryable) {
                controller.error(cause);
                return;
              }
              switched = true;
              note(`${firstProtocol} stream failed (${failure.reason}${failure.status ? `, HTTP ${failure.status}` : ''}); retrying ${secondProtocol}`);
              try {
                await primaryReader.cancel();
              } catch {
                // best effort — the provider may already have closed the body
              }
              let alternateResult: { stream: ReadableStream<unknown>; [key: string]: unknown };
              try {
                alternateResult = await second() as typeof alternateResult;
              } catch (alternateError) {
                const alternateFailure = classifyProtocolFailure(alternateError);
                note(`${secondProtocol} stream failed after fallback (${alternateFailure.reason}${alternateFailure.status ? `, HTTP ${alternateFailure.status}` : ''})`);
                rememberProtocolFailure(cacheKey);
                throw surfacedError(cause, alternateError);
              }
              const reader = alternateResult.stream.getReader();
              let alternateSemantic = false;
              let alternateFinish = false;
              try {
                while (true) {
                  const next = await reader.read();
                  if (next.done) break;
                  if (isSemanticStreamPart(next.value)) alternateSemantic = true;
                  if (next.value && typeof next.value === 'object' && (next.value as { type?: unknown }).type === 'finish') {
                    alternateFinish = true;
                  }
                  controller.enqueue(next.value);
                }
                if (alternateSemantic && alternateFinish) rememberProtocol(cacheKey, secondProtocol);
                else rememberProtocolFailure(cacheKey);
                controller.close();
              } finally {
                reader.releaseLock();
              }
            };

            try {
              while (true) {
                const next = await primaryReader.read();
                if (next.done) {
                  if (!committed && terminal) {
                    await pipeAlternate(new Error('provider returned an empty response'), true);
                  } else if (committed && terminal) {
                    rememberProtocol(cacheKey, firstProtocol);
                    controller.close();
                  } else {
                    controller.close();
                  }
                  return;
                }
                const part = next.value;
                if (!committed && part && typeof part === 'object' && (part as { type?: unknown }).type === 'error') {
                  await pipeAlternate((part as { error?: unknown }).error ?? part);
                  return;
                }
                if (!committed) {
                  buffered.push(part);
                  bufferedBytes += streamPartBytes(part);
                  if (isSemanticStreamPart(part)
                    || buffered.length >= MAX_PROTOCOL_PRELUDE_EVENTS
                    || bufferedBytes >= MAX_PROTOCOL_PRELUDE_BYTES) {
                    committed = true;
                    for (const pending of buffered) controller.enqueue(pending);
                    buffered.length = 0;
                    bufferedBytes = 0;
                  } else if (part && typeof part === 'object' && (part as { type?: unknown }).type === 'finish') {
                    terminal = true;
                  }
                } else {
                  controller.enqueue(part);
                }
              }
            } catch (error) {
              if (!committed) await pipeAlternate(error);
              else controller.error(error);
            } finally {
              primaryReader.releaseLock();
            }
          })().catch(error => controller.error(error));
        },
        cancel: reason => primaryReader.cancel(reason),
      });

      return { ...primaryResult, stream } as never;
    },
  };
}

/** Provider requirements belong on the model so Core and every SDK launcher share them. */
export function withProviderRequestDefaults(model: LanguageModel, spec: ProviderModelSpec): LanguageModel {
  const npm = resolveProviderNpm(spec.npm);
  const defaults = thinkingProviderOptions(npm);
  const claudeOAuth = isClaudeCodeOAuthRoute(spec);
  if (!defaults && !claudeOAuth && npm !== '@ai-sdk/alibaba') return model;

  return wrapLanguageModel({
    model: model as Parameters<typeof wrapLanguageModel>[0]['model'],
    middleware: {
      specificationVersion: 'v4',
      transformParams: async ({ params }) => {
        let prompt = params.prompt;
        let providerOptions = deepMergeProviderOptions(defaults, params.providerOptions);
        if (claudeOAuth) {
          const identity = applyClaudeCodeOAuthIdentity<ClaudeCodeOAuthSdkParams>({ ...spec, upstreamModelId: spec.modelId }, {
            instructions: prompt.filter(p => p.role === 'system').map(p => p.content).join('\n\n'),
            tools: params.tools?.length
              ? Object.fromEntries(params.tools.map(t => [t.name, {}]))
              : undefined,
          });
          if (!prompt.some(p => p.role === 'system' && p.content.startsWith(CLAUDE_CODE_BILLING_HEADER_PREFIX))) {
            prompt = [{ role: 'system', content: buildClaudeCodeBillingSystemLine() }, ...prompt];
          }
          const extraBeta = providerOptions?.anthropic?.anthropicBeta;
          providerOptions = deepMergeProviderOptions(providerOptions, identity.providerOptions);
          if (Array.isArray(extraBeta)) {
            providerOptions!.anthropic.anthropicBeta = [...new Set([
              ...(identity.providerOptions!.anthropic.anthropicBeta as string[]), ...extraBeta,
            ])];
          }
        }
        // DashScope's chat template needs a user turn after tool results.
        if (npm === '@ai-sdk/alibaba' && prompt.at(-1)?.role === 'tool') {
          prompt = [...prompt, { role: 'user', content: [{ type: 'text', text: 'Continue.' }] }];
        }
        return { ...params, prompt, providerOptions: providerOptions as typeof params.providerOptions };
      },
    },
  });
}

/** Create an SDK model and, for known dual-protocol gateways, arm one safe
 * alternate-protocol retry for both generate and stream calls. */
export async function createLanguageModel(spec: ProviderModelSpec): Promise<LanguageModel> {
  const npm = resolveProviderNpm(spec.npm);
  const primary = withProviderRequestDefaults(await createLanguageModelSingle(spec), spec);

  // OAuth backends often expose a gateway URL but require provider-specific
  // request signing. Retrying those through a second SDK would be unsafe.
  if (spec.authType === 'oauth' || !spec.baseURL) return primary;

  const primaryProtocol = protocolForNpm(npm);
  const alternative = resolveProtocolAlternative({
    providerId: spec.providerId,
    modelFormat: primaryProtocol,
    npm,
    baseURL: spec.baseURL,
  });
  if (!alternative || !isDualProtocolGateway(spec.providerId, spec.baseURL)) return primary;

  const cacheKey = protocolCacheKey({
    providerId: spec.providerId,
    modelId: spec.modelId,
    protocol: primaryProtocol,
    baseURL: spec.baseURL,
    alternativeURL: alternative.upstreamUrl,
    apiKey: spec.apiKey,
    headers: spec.headers,
  });

  let alternate: LanguageModel;
  try {
    const alternateSpec = {
      ...spec,
      npm: alternative.npm,
      baseURL: alternative.baseURL,
    };
    alternate = withProviderRequestDefaults(await createLanguageModelSingle(alternateSpec), alternateSpec);
  } catch (error) {
    spec.onDebug?.(`[protocol-fallback] alternate SDK unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return primary;
  }

  return wrapLanguageModel({
    model: primary as Parameters<typeof wrapLanguageModel>[0]['model'],
    middleware: createProtocolFallbackMiddleware(
      primary,
      alternate,
      primaryProtocol,
      alternative.modelFormat,
      cacheKey,
      spec.onDebug,
    ),
  }) as unknown as LanguageModel;
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
  /** Declared effort levels from models.dev (cross-bucket). Openai-compatible route only. */
  reasoningEffortLevels?: string[];
  /** models.dev declared disjoint effort sets — suppress the effort control. */
  reasoningEffortConflict?: boolean;
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
/**
 * Mistral accepts `high` or no effort at all. Advertise `none`, not `off`:
 * Codex App's effort vocabulary has no `off` and drops it, which broke the
 * selector for this model. Both values map to the same Mistral wire value.
 */
const MISTRAL_EFFORT_LEVELS = ['high', 'none'] as const;
/**
 * xAI reasoning ladders, per docs.x.ai (model-capabilities/text/reasoning):
 * grok-4.5 and later take `low | medium | high` (default `high`, reasoning
 * cannot be disabled) and grok-4.6 and later add `xhigh`. The subset is a
 * property of the model, not the transport — since AI SDK 7 both `xai(id)` and
 * `xai.responses(id)` use the Responses API, and the adapter accepts every
 * value on either call. `none`/`minimal` have no xAI equivalent and are never
 * sent (the older transport-based `low|high` rule predates the 4.5 ladder).
 */
const XAI_BASE_EFFORT_LEVELS = ['low', 'medium', 'high'] as const;
const XAI_XHIGH_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh'] as const;
/** Wire values the xAI adapter accepts; declared levels are filtered to these. */
const XAI_WIRE_EFFORT_LEVELS = new Set<string>(['low', 'medium', 'high', 'xhigh']);
const OPENROUTER_EFFORT_LEVELS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
/**
 * DeepSeek V4 ladder for routes that take the legacy collapse (low/medium map
 * to high; `xhigh` maps to max). `xhigh`, not `max`, is the label: Codex App's
 * slider vocabulary stops at `xhigh` and silently drops `max`, and both send
 * the same wire value anyway.
 *
 * `none` (not `off`) turns thinking off: Codex App validates effort values
 * against a fixed vocabulary (`none, minimal, low, medium, high, xhigh, max,
 * ultra`) and drops `off`, which broke its effort control for this model even
 * though the wire mapping below treats the two identically.
 */
const DEEPSEEK_EFFORT_LEVELS = ['high', 'xhigh', 'none'] as const;
/**
 * OpenCode Go/Zen accept DeepSeek's native ladder, and Codex App's effort
 * slider needs the medium-anchored `low/medium/high` rungs to render at all.
 * Verified live against the gateway: all of low/medium/high/max return 200.
 *
 * `xhigh` (not `max`) is the top rung: Codex App's slider vocabulary stops at
 * `xhigh` and silently drops `max`, and both send the same wire value anyway.
 */
const DEEPSEEK_NATIVE_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'none'] as const;
/** GLM-5.2 published efforts (OpenRouter metadata): high and xhigh, default high. */
const GLM_52_EFFORT_LEVELS = ['high', 'xhigh'] as const;
/**
 * GLM-5.3 published efforts on OpenCode Go (`low, high, max` metadata) plus
 * `medium`, which the gateway also accepts live. `xhigh` is Relay's label for
 * the wire `max` value, matching the GLM-5.2 rule above.
 */
const GLM_53_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh'] as const;

/**
 * The effort vocabulary Relay's controls understand. models.dev-declared levels
 * are intersected with this — anything outside it (a novel keyword) is dropped
 * rather than guessed at. `off` is excluded: it is Relay's alias, never a
 * declared level.
 */
const GENERIC_EFFORT_VOCAB = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/**
 * The wire values each family's mapper can actually send, as advertised
 * labels. Declared levels outside a family's set are dropped there — never
 * guessed onto another value.
 */
const ANTHROPIC_WIRE_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
/** Gemini 3-class `thinkingLevel` vocabulary (SDK-typed: minimal..high). */
const GEMINI_DECLARED_EFFORT_LEVELS = ['minimal', 'low', 'medium', 'high'] as const;
/** Values the Groq/Cerebras `reasoningEffort` provider option accepts. */
const GROQ_CEREBRAS_WIRE_EFFORT_LEVELS = ['none', 'low', 'medium', 'high'] as const;
/** Values the Perplexity `reasoning_effort` provider option accepts. */
const PERPLEXITY_WIRE_EFFORT_LEVELS = ['minimal', 'low', 'medium', 'high'] as const;

/** Identity normalizer bounded by a family's wire vocabulary. */
function wireVocabulary(vocab: readonly string[]): (value: string) => string | undefined {
  const allowed = new Set<string>(vocab);
  return value => (allowed.has(value) ? value : undefined);
}

const normalizeAnthropicDeclared = wireVocabulary(ANTHROPIC_WIRE_EFFORT_LEVELS);
const normalizeGeminiDeclared = wireVocabulary(GEMINI_DECLARED_EFFORT_LEVELS);
const normalizeMistralDeclared = wireVocabulary(MISTRAL_EFFORT_LEVELS);
const normalizeGroqDeclared = wireVocabulary(GROQ_CEREBRAS_WIRE_EFFORT_LEVELS);
const normalizePerplexityDeclared = wireVocabulary(PERPLEXITY_WIRE_EFFORT_LEVELS);

/**
 * Families whose top declared rung is the wire value `max`: Relay advertises
 * it as `xhigh` (its established label for that value across surfaces) and the
 * mapper sends `max` back. Everything else in the rank vocabulary passes
 * through; unmappable values are dropped later by the wire filter.
 */
function normalizeTopRungDeclared(value: string): string | undefined {
  if (value === 'max') return 'xhigh';
  return EFFORT_RANK.includes(value) ? value : undefined;
}

/**
 * models.dev-declared effort levels for a family, normalized into Relay labels
 * and returned in canonical low→high order. A `normalize` that returns
 * undefined drops a value the family cannot express; conflicting declarations
 * suppress the set entirely (treated as undeclared, never guessed at).
 */
function declaredEffortLevels(
  metadata: ReasoningMetadata | undefined,
  normalize: (value: string) => string | undefined,
): string[] {
  if (!metadata || metadata.reasoningEffortConflict) return [];
  const declared = metadata.reasoningEffortLevels;
  if (!declared || declared.length === 0) return [];
  const labels = new Set<string>();
  for (const value of declared) {
    const label = normalize(value.trim().toLowerCase());
    if (label) labels.add(label);
  }
  return EFFORT_RANK.filter(rank => labels.has(rank));
}

/**
 * Rule-first union of a family's verified ladder and the declared levels.
 *
 * The rule ladder keeps its established order and labels. Declared levels are
 * added only when they reach the wire as bytes the rule ladder does not
 * already produce — an addition never renames an existing rung (where the
 * legacy collapse maps `low` and `high` to one wire value, `low` is dropped
 * rather than substituted), and additions are inserted at their rank position
 * so a newly surfaced `minimal` leads the ladder. `withMappableLevels` still
 * runs afterwards as the final guard.
 */
function unionEffortLevels(
  rule: readonly string[] | null,
  declared: readonly string[],
  npm: string,
  modelId: string,
  metadata?: ReasoningMetadata,
): string[] {
  const base = rule ? [...rule] : [];
  const wires = new Set<string>();
  for (const level of base) {
    const mapped = effortProviderOptions(npm, level, modelId, metadata);
    if (mapped !== undefined) wires.add(JSON.stringify(mapped));
  }
  const additions: string[] = [];
  for (const level of declared) {
    if (base.includes(level) || additions.includes(level)) continue;
    const mapped = effortProviderOptions(npm, level, modelId, metadata);
    if (mapped === undefined) continue;
    const wire = JSON.stringify(mapped);
    if (wires.has(wire)) continue;
    wires.add(wire);
    additions.push(level);
  }
  if (additions.length === 0) return base;
  const merged = [...base];
  for (const level of additions) {
    const rank = EFFORT_RANK.indexOf(level);
    const index = merged.findIndex(existing => EFFORT_RANK.indexOf(existing) > rank);
    if (index === -1) merged.push(level);
    else merged.splice(index, 0, level);
  }
  return merged;
}

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

/**
 * Claude adaptive-thinking models (opus/sonnet/haiku 4.6+, fable, mythos).
 * The minor version is optional so bare releases like `claude-opus-5` — and
 * any later major — classify without a table edit.
 */
function isClaudeReasoningModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  if (!lower.startsWith('claude-')) return false;
  if (lower.includes('fable') || lower.includes('mythos')) return true;
  const m = lower.match(/claude-(?:opus|sonnet|haiku)-(\d+)(?:-(\d+))?/);
  if (!m) return false;
  const major = Number(m[1]);
  const minor = m[2] !== undefined ? Number(m[2]) : 0;
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
 * xAI models that reject `reasoning_effort` even though they reason internally
 * (per xAI docs — grok-build-0.1 400s on the parameter).
 */
function isXaiEffortExcludedModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return lower.includes('non-reasoning')
    || lower.startsWith('grok-build')
    || lower.startsWith('grok-imagine');
}

/**
 * xAI models that accept `reasoning_effort` on the wire (per xAI docs).
 * Fallback for metadata-less paths only — {@link xaiEffortLadder} prefers
 * models.dev-declared levels, so a new model needs no edit here.
 */
function isXaiReasoningEffortModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  if (isXaiEffortExcludedModel(modelId)) return false;
  if (modelPrefersResponsesApi(modelId)) return true;
  if (lower === 'grok-4.3' || lower.startsWith('grok-4.3-')) return true;
  if (lower === 'grok-4.5' || lower.startsWith('grok-4.5-')) return true;
  if (lower === 'grok-4.6' || lower.startsWith('grok-4.6-')) return true;
  if (lower === 'grok-4.7' || lower.startsWith('grok-4.7-')) return true;
  if (lower.includes('-reasoning')) return true;
  return false;
}

/** Fallback ladder when models.dev declares nothing for an xAI model. */
function xaiFallbackEffortLevels(modelId: string): readonly string[] {
  const lower = modelId.toLowerCase();
  if (lower === 'grok-4.6' || lower.startsWith('grok-4.6-')) return XAI_XHIGH_EFFORT_LEVELS;
  if (lower === 'grok-4.7' || lower.startsWith('grok-4.7-')) return XAI_XHIGH_EFFORT_LEVELS;
  // grok-4.20-multi-agent: docs list low/medium/high/xhigh (effort = agent count).
  if (modelPrefersResponsesApi(modelId)) return XAI_XHIGH_EFFORT_LEVELS;
  if (lower === 'grok-4.3' || lower.startsWith('grok-4.3-')) return XAI_BASE_EFFORT_LEVELS;
  if (lower === 'grok-4.5' || lower.startsWith('grok-4.5-')) return XAI_BASE_EFFORT_LEVELS;
  // grok-4.20-era `-reasoning` ids keep their long-standing pair.
  if (lower.includes('-reasoning')) return ['low', 'high'];
  return XAI_BASE_EFFORT_LEVELS;
}

/**
 * The effort ladder for an xAI model: models.dev-declared levels filtered to
 * what the adapter can send, else the fallback rules. `null` = no effort
 * control (verified rejecters, or nothing declared anywhere).
 */
function xaiEffortLadder(
  modelId: string,
  metadata?: ReasoningMetadata,
): { levels: string[]; source: ReasoningSource } | null {
  if (isXaiEffortExcludedModel(modelId)) return null;
  const declared = metadata?.reasoningEffortConflict ? undefined : metadata?.reasoningEffortLevels;
  const declaredLevels = declared?.filter(level => XAI_WIRE_EFFORT_LEVELS.has(level));
  if (declaredLevels && declaredLevels.length > 0) {
    return { levels: declaredLevels, source: 'provider-metadata' };
  }
  if (isXaiReasoningEffortModel(modelId)) {
    return { levels: [...xaiFallbackEffortLevels(modelId)], source: 'provider-rule' };
  }
  return null;
}

/**
 * xAI's own default reasoning_effort when the param is omitted (per xAI docs).
 * grok-4.5 and later default to 'high'; grok-4.3 defaults to 'low'.
 */
function xaiDefaultReasoningEffort(modelId: string): string {
  const lower = modelId.toLowerCase();
  if (/^grok-4\.(?:5|6|7)(?:-|$)/.test(lower)) return 'high';
  return 'low';
}

/**
 * DeepSeek V4.x models with thinking mode + reasoning_effort (direct API and
 * OpenCode Go/Zen, which serve the same DeepSeek wire shape).
 *
 * Prefix-based so a new point release (e.g. `deepseek-v4.1-flash`) is
 * recognized without a code change — v4.1 was missing here, which silently
 * reduced its Codex catalog entry to a single `none` effort level. Snapshot
 * suffixes (`deepseek-v4-pro-0813`) and vision variants still match.
 *
 * An optional `vendor/` prefix matches Command Code ids such as
 * `deepseek/deepseek-v4.1-flash`. Without it the catalog falls back to a
 * single `none` effort and Codex App draws no slider.
 */
const DEEPSEEK_V4_REASONING_ID = /^(?:[a-z0-9-]+\/)?deepseek-v4(?:\.\d+)?-(?:flash|pro)(?:-|$)/;

function isDeepSeekReasoningModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return DEEPSEEK_V4_REASONING_ID.test(lower)
    || lower === 'deepseek-reasoner'
    || lower === 'deepseek-chat';
}

/** Optional `vendor/` prefix, same tolerance as `GLM_53_REASONING_ID`. */
const KIMI_REASONING_ID = /^(?:[a-z0-9-]+\/)?kimi-/;

function isKimiReasoningModel(modelId: string): boolean {
  return KIMI_REASONING_ID.test(modelId.toLowerCase().trim());
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

/**
 * GLM-5.3 and its `-flash`/snapshot ids. Unlike 5.2 (exact ids only), 5.3 ships
 * under several vendor prefixes and suffixes, so this matches the version
 * segment with an optional `vendor/` prefix.
 */
const GLM_53_REASONING_ID = /^(?:[a-z0-9-]+\/)?glm-?5\.3(?:-|$)/;

function isGlm53ReasoningModel(modelId: string): boolean {
  return GLM_53_REASONING_ID.test(modelId.toLowerCase().trim());
}

function toCamelCase(str: string): string {
  return str.replace(/[-_]([a-z])/g, (_, g) => g.toUpperCase());
}

/**
 * Pick the default effort: `medium` if offered, else the level closest to medium
 * by vocabulary rank, ties resolving to the higher rung. `levels` must be a
 * non-empty subset of {@link GENERIC_EFFORT_VOCAB} (ascending), which it always
 * is at the one call site.
 */
function nearestToMediumEffort(levels: string[]): string {
  if (levels.includes('medium')) return 'medium';
  const mediumIdx = GENERIC_EFFORT_VOCAB.indexOf('medium');
  return levels.reduce((best, level) => {
    const bestDist = Math.abs(GENERIC_EFFORT_VOCAB.indexOf(best) - mediumIdx);
    const dist = Math.abs(GENERIC_EFFORT_VOCAB.indexOf(level) - mediumIdx);
    // ascending input → a later level with equal distance is the higher rung.
    return dist <= bestDist ? level : best;
  }, levels[0]!);
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

/**
 * OpenCode Go/Zen serve DeepSeek's native effort vocabulary (`low`, `medium`,
 * `high`, `max`), verified live against that gateway. Command Code serves the
 * same DeepSeek wire shape, so it gets the same ladder. Other routes keep the
 * legacy collapse where low/medium were the only way to ask for `high`.
 *
 * The Codex catalog builder passes `apiBaseUrl` and not `providerId`, so the
 * host check is what actually puts the slider on a Command Code model.
 */
function deepSeekAcceptsNativeEfforts(metadata?: ReasoningMetadata): boolean {
  const providerId = metadata?.providerId?.toLowerCase();
  if (
    providerId === 'go'
    || providerId === 'zen'
    || providerId === 'opencode-go'
    || providerId === 'opencode'
    || providerId === 'commandcode'
  ) {
    return true;
  }
  const baseUrl = metadata?.apiBaseUrl;
  return baseUrl?.includes('opencode.ai') === true || baseUrl?.includes('commandcode.ai') === true;
}

function mapCodexEffortToDeepSeek(
  effort: string,
  nativeEfforts: boolean,
): 'low' | 'medium' | 'high' | 'max' | 'off' | undefined {
  switch (effort) {
    case 'off':
    case 'none':
      return 'off';
    case 'low':
      return nativeEfforts ? 'low' : 'high';
    case 'medium':
      return nativeEfforts ? 'medium' : 'high';
    case 'high':
      return 'high';
    case 'xhigh':
    case 'max':
      return 'max';
    default:
      return undefined;
  }
}

/**
 * DeepSeek thinking toggle + effort spreads via the *route's own* provider id.
 *
 * The SDK only reads `providerOptions[provider.name]` (or its camelCase form),
 * and `@ai-sdk/openai-compatible` instances are created with the registry
 * provider id as their name — `go` for OpenCode Go, `deepseek` for the direct
 * API. The old hardcoded `openaiCompatible`/`deepseek` keys matched neither the
 * Go instance nor any other openai-compatible route, so the effort was dropped
 * before the request left Relay.
 */
function deepSeekEffortProviderOptions(
  effort: string,
  metadata?: ReasoningMetadata,
): Record<string, Record<string, unknown>> | undefined {
  // A declared level wins and goes to the wire as itself; the legacy collapse
  // stays for undeclared rungs (and for `none`, whose established mapping is
  // the `off` value plus thinking disabled).
  const declared = declaredEffortLevels(metadata, normalizeTopRungDeclared);
  const mapped = declared.includes(effort) && effort !== 'none'
    ? (effort === 'xhigh' ? 'max' : effort)
    : mapCodexEffortToDeepSeek(effort, deepSeekAcceptsNativeEfforts(metadata));
  if (!mapped) return undefined;
  const key = metadata?.providerId ? toCamelCase(metadata.providerId) : 'openaiCompatible';
  const thinking = { type: mapped === 'off' ? 'disabled' : 'enabled' };
  if (mapped === 'off') {
    return { [key]: { thinking } };
  }
  return {
    [key]: { reasoningEffort: mapped, thinking },
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

/** GLM-5.3 accepts the fuller ladder (verified live on OpenCode Go). */
function mapCodexEffortToGlm53(effort: string): 'low' | 'medium' | 'high' | 'max' | undefined {
  switch (effort) {
    case 'low':
      return 'low';
    case 'medium':
      return 'medium';
    case 'high':
      return 'high';
    case 'xhigh':
    case 'max':
      return 'max';
    default:
      return undefined;
  }
}

/**
 * xAI wire mapping: the adapter's accepted values are sent verbatim. `max` is
 * not part of the xAI vocabulary; it keeps its historical `high` mapping
 * rather than inventing a value the API never documents.
 */
function mapCodexEffortToXai(effort: string): string | undefined {
  switch (effort) {
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
      return effort;
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
/**
 * Effort levels an OpenAI model accepts: the hand-written profile when there is
 * one, else models.dev's declared levels (models newer than the table), else
 * the conservative default.
 */
function openAiAllowedEffortLevels(modelId: string, metadata?: ReasoningMetadata): readonly string[] {
  const profile = openAiReasoningProfile(modelId, metadata);
  if (profile) return profile.levels;
  const declared = metadata?.reasoningEffortConflict ? undefined : metadata?.reasoningEffortLevels;
  return declared && declared.length > 0 ? declared : OPENAI_EFFORT_LEVELS;
}

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
    const declared = declaredEffortLevels(metadata, normalizeAnthropicDeclared);
    if (isClaude || metadata?.reasoning || declared.length > 0) {
      const levels = unionEffortLevels(
        isClaude ? ANTHROPIC_EFFORT_LEVELS : null,
        declared,
        npm,
        modelId,
        metadata,
      );
      if (levels.length === 0) return EMPTY_REASONING;
      return {
        levels,
        defaultLevel: levels.includes('high') ? 'high' : nearestToMediumEffort(levels),
        supportsSummaries: true,
        mode: 'controllable',
        source: declared.length > 0 ? 'provider-metadata' : isClaude ? 'provider-rule' : 'model-metadata',
        confidence: declared.length > 0 || isClaude ? 'documented' : 'inferred',
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
      const levels = openAiAllowedEffortLevels(modelId, metadata);
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
    const declared = declaredEffortLevels(metadata, normalizeGeminiDeclared);
    const isGemini = isGeminiReasoningModel(modelId);
    // Gemini 2.5 controls thinking with a token budget, not a level — a
    // declared effort row there (any reseller can add one) does not apply.
    const budgetEra = /^gemini-2[.-]5/.test(id);
    if (declared.length > 0 || isGemini) {
      // Google publishes the accepted `thinkingLevel` set per model, so a
      // declared set IS the ladder (image variants declare subsets). Otherwise
      // the name rule's ladder stands, extended with any declared rungs.
      const levels = declared.length > 0 && !budgetEra
        ? declared
        : unionEffortLevels(
          isGemini ? GEMINI_EFFORT_LEVELS : null,
          budgetEra ? [] : declared,
          npm,
          modelId,
          metadata,
        );
      if (levels.length === 0) return EMPTY_REASONING;
      return {
        levels,
        defaultLevel: levels.includes('medium') ? 'medium' : nearestToMediumEffort(levels),
        supportsSummaries: true,
        mode: 'controllable',
        source: declared.length > 0 && !budgetEra ? 'provider-metadata' : 'provider-rule',
        confidence: 'documented',
        wireFormat: { kind: 'google-thinking-config' },
      };
    }
    return EMPTY_REASONING;
  }

  if (npm === '@ai-sdk/mistral') {
    const declared = declaredEffortLevels(metadata, normalizeMistralDeclared);
    const isMistral = isMistralReasoningModel(modelId);
    if (declared.length > 0 || isMistral) {
      const levels = unionEffortLevels(
        isMistral ? MISTRAL_EFFORT_LEVELS : null,
        declared,
        npm,
        modelId,
        metadata,
      );
      if (levels.length === 0) return EMPTY_REASONING;
      return {
        levels,
        defaultLevel: levels.includes('high') ? 'high' : nearestToMediumEffort(levels),
        supportsSummaries: false,
        mode: 'controllable',
        source: declared.length > 0 ? 'provider-metadata' : 'provider-rule',
        confidence: 'documented',
        wireFormat: { kind: 'mistral-reasoning-effort' },
      };
    }
    return EMPTY_REASONING;
  }

  if (npm === '@ai-sdk/xai') {
    // Declared-first: models.dev levels (filtered to the wire set) drive the
    // control, so new models like grok-4.6/4.7 need no allowlist edit here.
    const ladder = xaiEffortLadder(modelId, metadata);
    if (!ladder) return EMPTY_REASONING;
    return {
      levels: ladder.levels,
      defaultLevel: xaiDefaultReasoningEffort(modelId),
      supportsSummaries: true,
      mode: 'controllable',
      source: ladder.source,
      confidence: 'documented',
      wireFormat: { kind: 'openai-reasoning-effort' },
    };
  }

  if (isDeepSeekReasoningModel(modelId)) {
    // Codex App's effort slider is built from a medium-anchored ladder, so a
    // `high/max/off`-only set rendered no control at all. Where the route
    // accepts the native values, offer the real ladder; declared rungs the
    // rule lacks (e.g. direct-API `low`) surface on top of it.
    const declared = declaredEffortLevels(metadata, normalizeTopRungDeclared);
    const rule = deepSeekAcceptsNativeEfforts(metadata)
      ? DEEPSEEK_NATIVE_EFFORT_LEVELS
      : DEEPSEEK_EFFORT_LEVELS;
    return {
      levels: unionEffortLevels(rule, declared, npm, modelId, metadata),
      defaultLevel: 'high',
      supportsSummaries: true,
      mode: 'controllable',
      source: declared.length > 0 ? 'provider-metadata' : 'provider-rule',
      confidence: 'documented',
      wireFormat: { kind: 'deepseek-thinking' },
    };
  }

  if (isKimiReasoningModel(modelId)) {
    const declared = declaredEffortLevels(metadata, normalizeTopRungDeclared);
    const levels = unionEffortLevels(OPENAI_EFFORT_LEVELS, declared, npm, modelId, metadata);
    return {
      levels,
      defaultLevel: levels.includes('high') ? 'high' : nearestToMediumEffort(levels),
      supportsSummaries: false,
      mode: 'controllable',
      source: declared.length > 0 ? 'provider-metadata' : 'provider-rule',
      confidence: 'documented',
      wireFormat: { kind: 'openai-reasoning-effort' },
    };
  }

  if (isGlm53ReasoningModel(modelId)) {
    const declared = declaredEffortLevels(metadata, normalizeTopRungDeclared);
    const levels = unionEffortLevels(GLM_53_EFFORT_LEVELS, declared, npm, modelId, metadata);
    return {
      levels,
      defaultLevel: levels.includes('high') ? 'high' : nearestToMediumEffort(levels),
      supportsSummaries: false,
      mode: 'controllable',
      source: declared.length > 0 ? 'provider-metadata' : 'provider-rule',
      confidence: 'documented',
      wireFormat: { kind: 'openai-reasoning-effort' },
    };
  }

  if (isGlm52ReasoningModel(modelId)) {
    const declared = declaredEffortLevels(metadata, normalizeTopRungDeclared);
    const levels = unionEffortLevels(GLM_52_EFFORT_LEVELS, declared, npm, modelId, metadata);
    return {
      levels,
      defaultLevel: levels.includes('high') ? 'high' : nearestToMediumEffort(levels),
      supportsSummaries: false,
      mode: 'controllable',
      source: declared.length > 0 ? 'provider-metadata' : 'provider-rule',
      confidence: 'documented',
      wireFormat: { kind: 'openai-reasoning-effort' },
    };
  }

  // Groq / Cerebras / Perplexity: the SDK types a `reasoningEffort` provider
  // option with a fixed vocabulary, so declared levels can be offered verbatim
  // with no per-model rule at all. Sources are listed in the SDK's own option
  // schemas (groq/cerebras: none..high; perplexity: minimal..high).
  if (npm === '@ai-sdk/groq' || npm === '@ai-sdk/cerebras' || npm === '@ai-sdk/perplexity') {
    const normalize = npm === '@ai-sdk/perplexity' ? normalizePerplexityDeclared : normalizeGroqDeclared;
    const levels = declaredEffortLevels(metadata, normalize);
    if (levels.length > 0) {
      return {
        levels,
        defaultLevel: nearestToMediumEffort(levels),
        supportsSummaries: false,
        mode: 'controllable',
        source: 'provider-metadata',
        confidence: 'documented',
        wireFormat: { kind: 'openai-reasoning-effort' },
      };
    }
  }

  // Generic models.dev-declared effort levels (openai-compatible route only —
  // Command Code's non-Claude models live here). This is additive: it fires only
  // after the verified DeepSeek/Kimi/GLM rules above, and never for the OpenAI/
  // xAI/OpenRouter/Anthropic/Google/Mistral branches. Levels are taken verbatim
  // from models.dev intersected with the vocab we can wire — an empty result is
  // terminal (no slider), never a fall-through to a guessed level.
  if (npm === '@ai-sdk/openai-compatible') {
    if (metadata?.reasoningEffortConflict) return EMPTY_REASONING;
    const declared = metadata?.reasoningEffortLevels;
    if (declared && declared.length > 0) {
      const levels = GENERIC_EFFORT_VOCAB.filter(v => declared.includes(v));
      if (levels.length === 0) return EMPTY_REASONING;
      return {
        levels,
        defaultLevel: nearestToMediumEffort(levels),
        supportsSummaries: false,
        mode: 'controllable',
        source: 'provider-metadata',
        confidence: 'documented',
        wireFormat: { kind: 'openai-reasoning-effort' },
      };
    }
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
    const reasoningEffort = mapCodexEffortToOpenAI(effort, openAiAllowedEffortLevels(modelId, metadata));
    return reasoningEffort ? { openai: { reasoningEffort } } : undefined;
  }

  if (npm === '@ai-sdk/xai') {
    if (!modelId || !xaiEffortLadder(modelId, metadata)) return undefined;
    const reasoningEffort = mapCodexEffortToXai(effort);
    return reasoningEffort ? { xai: { reasoningEffort } } : undefined;
  }

  // SDK-typed `reasoningEffort` options on three first-party packages whose
  // model ladders are declared per model (no name rules). Values go verbatim;
  // a sensitivity to values outside the SDK enum can never arise because the
  // capability side advertises exactly this set.
  if (npm === '@ai-sdk/groq' || npm === '@ai-sdk/cerebras') {
    const declared = declaredEffortLevels(metadata, normalizeGroqDeclared);
    if (!declared.includes(effort)) return undefined;
    const key = npm === '@ai-sdk/groq' ? 'groq' : 'cerebras';
    return { [key]: { reasoningEffort: effort } };
  }

  if (npm === '@ai-sdk/perplexity') {
    const declared = declaredEffortLevels(metadata, normalizePerplexityDeclared);
    if (!declared.includes(effort)) return undefined;
    return { perplexity: { reasoning_effort: effort } };
  }

  if (npm === '@ai-sdk/anthropic' || npm === VERTEX_ANTHROPIC_NPM) {
    if (!modelId) return undefined;
    // Effort rides the SDK's top-level `anthropic.effort` (which it emits as
    // `output_config.effort`). It used to be nested inside `thinking`, where
    // the provider option schema silently stripped it — the selected level
    // never reached the wire. Adaptive thinking stays as the mode request.
    const declared = declaredEffortLevels(metadata, normalizeAnthropicDeclared);
    if (declared.includes(effort)) {
      return {
        anthropic: {
          effort,
          ...(isClaudeReasoningModel(modelId) ? { thinking: { type: 'adaptive' } } : {}),
        },
      };
    }
    if (!isClaudeReasoningModel(modelId)) return undefined;
    const mapped = mapCodexEffortToAnthropic(effort);
    return mapped
      ? { anthropic: { effort: mapped, thinking: { type: 'adaptive' } } }
      : undefined;
  }

  if (npm === '@ai-sdk/google') {
    const id = modelId ?? '';
    const declared = declaredEffortLevels(metadata, normalizeGeminiDeclared);
    if (declared.length > 0 && !/^gemini-2[.-]5/.test(id.toLowerCase())) {
      if (!declared.includes(effort)) return undefined;
      return { google: { thinkingConfig: { thinkingLevel: effort, includeThoughts: true } } };
    }
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
      return deepSeekEffortProviderOptions(effort, metadata);
    }
    if (isKimiReasoningModel(modelId)) {
      // A declared top rung arrives as `max` (normalized to `xhigh`) and is
      // sent by that name; undeclared rungs keep the legacy collapse.
      const declared = declaredEffortLevels(metadata, normalizeTopRungDeclared);
      const reasoningEffort = declared.includes(effort)
        ? (effort === 'xhigh' ? 'max' : effort)
        : mapCodexEffortToOpenAICompatible(effort);
      if (reasoningEffort) {
        const key = metadata?.providerId ? toCamelCase(metadata.providerId) : 'openaiCompatible';
        return { [key]: { reasoningEffort } };
      }
      return undefined;
    }
    if (isGlm53ReasoningModel(modelId)) {
      const reasoningEffort = mapCodexEffortToGlm53(effort);
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
    // Generic models.dev-declared effort (openai-compatible route). Verbatim: an
    // undeclared/out-of-vocab level maps to nothing rather than being substituted
    // onto a legacy value, so this branch is terminal once levels are declared.
    if (npm === '@ai-sdk/openai-compatible') {
      if (metadata?.reasoningEffortConflict) return undefined;
      const declared = metadata?.reasoningEffortLevels;
      if (declared && declared.length > 0) {
        const accepted = new Set(GENERIC_EFFORT_VOCAB.filter(v => declared.includes(v)));
        if (!accepted.has(effort)) return undefined;
        const key = metadata?.providerId ? toCamelCase(metadata.providerId) : 'openaiCompatible';
        return { [key]: { reasoningEffort: effort } };
      }
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
