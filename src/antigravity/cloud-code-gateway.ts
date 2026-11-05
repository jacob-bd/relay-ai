import { PoolHealthStore } from '../pool/health.js';
import { dispatchFreePool } from '../pool/dispatch.js';
import { PoolAttemptError, type PoolLimits } from '../pool/attempt.js';
import { retryPoolFailure } from '../pool/errors.js';
import { DEFAULT_POOL_LIMITS } from '../pool/codex-runtime.js';
import { POOL_MAX_TOOLS } from '../pool/codex-prepare.js';
import { describePoolFailure, poolRouteMember, recordPoolActivity } from '../pool/activity.js';
import { poolErrorDetail } from '../pool/diagnostic.js';
import { antigravityPoolPreferences, prepareAntigravityPoolRoutes } from '../pool/antigravity-runtime.js';
import { randomUUID } from 'node:crypto';
import { isProviderKind } from '../registry/provider-kind.js';
import http from 'node:http';
import { streamText } from 'ai';
import {
  createLanguageModel,
  deepMergeProviderOptions,
  effortProviderOptions,
  maxToolsForNpm,
  thinkingProviderOptions,
} from '../provider-factory.js';
import { silenceSdkWarnings } from '../sdk-adapter.js';
import { formatUpstreamError, formatUpstreamErrorTrace } from '../codex/upstream-error.js';
import { readBody } from '../http-utils.js';
import {
  sanitizeUnsupportedInlineData,
  summarizeSdkRequestForTrace,
  translateRequest,
  UNSUPPORTED_VOICE_MESSAGE,
  type CloudCodeGenerateRequest,
  type TranslateRequestOptions,
} from './request-adapter.js';
import { formatCloudCodeChunk, mapFinishReason, normalizeFunctionCallArgs } from './response-adapter.js';
import { applyClaudeCodeOAuthIdentity } from '../oauth/claude-code-identity.js';
import { ANTIGRAVITY_BASE_URLS, ANTIGRAVITY_USER_AGENT } from '../oauth/antigravity-oauth.js';
import type { AntigravityRoute, CatalogFixture } from './types.js';
import {
  injectRelayModels,
  resolveRelayCatalogSlots,
  buildListModelConfigsResponse,
  buildListExperimentsResponse,
} from './catalog.js';
import { extractConversationId, openCodeGoHeaders } from '../opencode-session.js';
import { detectAuthTierInBody, type DetectedAuthTier } from './account-guardrail.js';
import loadCodeAssistFixture from './fixtures/loadCodeAssist.json' with { type: 'json' };
import catalogFixtureRaw from './fixtures/fetchAvailableModels.json' with { type: 'json' };
import { generateTextStreamingIfRequired } from '../stream-only-model.js';

export interface CloudCodeGatewayHandle {
  port: number;
  url: string;
  close: () => Promise<void>;
}

export interface GatewayOptions {
  templateKey?: string;
  trace?: boolean;
  /** Experimental: route intent helpers to the last observed selected user-turn slot. */
  trackActiveRoute?: boolean;
  /** When trace is enabled, all gateway log lines are written here instead of stdout/stderr. */
  logFn?: (msg: string) => void;
  /** Put the first routes on native slots (default true; agy passes false — see RelaySlotOptions). */
  nativeSlots?: boolean;
  /**
   * Called once, with the first request that carries a Gemini auth tier
   * (`entitlement.userTier`), so launch surfaces can warn about work accounts.
   */
  onAuthTierDetected?: (info: DetectedAuthTier) => void;
  /** Shared pool health (cooldowns). Defaults to the same store the Codex and Claude pools use. */
  poolHealth?: PoolHealthStore;
  /** Pool attempt limits. Defaults to the Codex and Claude pool limits. */
  poolLimits?: PoolLimits;
}

type HelperRoutePolicy = 'launch' | 'launch-or-active';

const HELPER_ROUTE_POLICIES = new Map<string, HelperRoutePolicy>([
  ['gemini-2.5-flash', 'launch-or-active'],
  ['gemini-2.5-flash-lite', 'launch'],
  ['gemini-3-flash-agent', 'launch'],
  ['gemini-3.1-flash-lite', 'launch'],
]);

const MAX_REASONING_ECHOES_PER_CONVERSATION = 20;

function isCloudCodeOAuthRoute(route: AntigravityRoute): boolean {
  return isProviderKind(route.providerId, 'antigravity') && route.authType === 'oauth' && route.modelFormat === 'cloud-code';
}

async function createRouteLanguageModel(route: AntigravityRoute, sessionId?: string) {
  const spec: Parameters<typeof createLanguageModel>[0] = {
    npm: route.npm,
    modelId: route.upstreamModelId,
    apiKey: route.apiKey,
    baseURL: route.baseURL,
    providerId: route.providerId,
    authType: route.authType,
    oauthAccountId: route.oauthAccountId,
    providerData: route.providerData,
    ...(sessionId ? { sessionId } : {}),
  };
  if (route.headers !== undefined) spec.headers = route.headers;
  if (route.refreshToken) {
    spec.refreshToken = route.refreshToken;
    spec.onTokenRefreshed = refreshed => { route.apiKey = refreshed; };
  }
  return createLanguageModel(spec);
}

function isUserTurnRequest(parsed: Record<string, unknown> | undefined): boolean {
  return typeof parsed?.requestId === 'string' && parsed.requestId.startsWith('agent/');
}

/**
 * Start a local Cloud Code gateway on 127.0.0.1 with a random port.
 *
 * Serves:
 * - loadCodeAssist → from local fixture (no Google contact)
 * - fetchAvailableModels → local catalog with injected relay models
 * - streamGenerateContent (relay models) → translated via Vercel AI SDK (streaming)
 * - generateContent (relay models) → translated via Vercel AI SDK (unary)
 * - Non-relay model requests → 403 rejected
 * - Other endpoints → empty 200 (permissive)
 *
 * URL matching is case-insensitive to support both REST-style paths
 * (/v1internal:loadCodeAssist) and Connect-style paths
 * (/google.internal.cloud.code.v1internal.CloudCode/LoadCodeAssist).
 */
export async function startCloudCodeGateway(
  routes: AntigravityRoute[],
  opts: GatewayOptions = {},
): Promise<CloudCodeGatewayHandle> {
  silenceSdkWarnings();
  const templateKey = opts.templateKey ?? 'gemini-3.5-flash-low';
  const trace = opts.trace ?? false;
  const trackActiveRoute = opts.trackActiveRoute ?? false;
  const log = opts.logFn ?? (() => {});
  let sharedPoolHealth = opts.poolHealth;
  const poolDeps = { health: () => (sharedPoolHealth ??= new PoolHealthStore()), limits: opts.poolLimits ?? DEFAULT_POOL_LIMITS, lastSkip: new Map<string, string>() };

  const catalogFixture = catalogFixtureRaw as unknown as CatalogFixture;
  const slotOptions = { nativeSlots: opts.nativeSlots ?? true };
  const injectedCatalog = injectRelayModels(catalogFixture, routes, templateKey, slotOptions);

  const selectedSlotRoutes = resolveRelayCatalogSlots(injectedCatalog, routes, templateKey, slotOptions);
  const selectedSlotIds = new Set<string>();
  const routeMap = new Map<string, AntigravityRoute>();
  const reasoningEchoesByConversation = new Map<string, string[]>();
  for (const { slotId, route } of selectedSlotRoutes) {
    selectedSlotIds.add(slotId);
    routeMap.set(slotId, route);
    routeMap.set(route.catalogId, route);
  }

  let activeRoute: AntigravityRoute | undefined;
  let authTierReported = false;
  const launchRoute = selectedSlotRoutes[0]?.route ?? routes[0];
  const resolveRouteForModel = (model: string | undefined): AntigravityRoute | undefined => {
    if (!model) return undefined;
    const directRoute = routeMap.get(model);
    if (directRoute) return directRoute;
    const helperPolicy = HELPER_ROUTE_POLICIES.get(model);
    if (!helperPolicy || !launchRoute) return undefined;
    if (helperPolicy === 'launch-or-active' && trackActiveRoute && activeRoute) {
      return activeRoute;
    }
    return launchRoute;
  };

  // Pre-compute provider options per route (cheap, stateless; createLanguageModel called per-request
  // so credentials are always fresh — required for short-lived OAuth tokens)
  const providerOptionsCache = new Map<string, any>();
  for (const route of routes) {
    providerOptionsCache.set(
      route.catalogId,
      deepMergeProviderOptions(
        thinkingProviderOptions(route.npm),
        effortProviderOptions(route.npm, route.reasoningEffort ?? 'high', route.upstreamModelId, route.reasoningMetadata),
      ),
    );
  }


  // Pre-compute invariant endpoint responses (routes don't change after startup)
  const experimentsResponse = buildListExperimentsResponse();
  const modelConfigsResponse = buildListModelConfigsResponse(routes, injectedCatalog, templateKey, slotOptions);
  const userSettings = {
    telemetryEnabled: false,
    userDataCollectionForceDisabled: true,
    marketingEmailsEnabled: false,
  };

  const server = http.createServer((req, res) => {
    readBody(req).then((bodyStr) => {
      const url = req.url || '';
      const method = req.method || 'GET';
      const contentType = (req.headers['content-type'] ?? '').toLowerCase();
      const lowerUrl = url.toLowerCase();

      let parsed: Record<string, unknown> | undefined;
      try { parsed = JSON.parse(bodyStr) as Record<string, unknown>; } catch {}

      // Work-account guardrail: report the session's Gemini auth tier once.
      if (!authTierReported && parsed) {
        const authTier = detectAuthTierInBody(parsed);
        if (authTier) {
          authTierReported = true;
          try {
            opts.onAuthTierDetected?.(authTier);
          } catch {
            // A warning callback must never break the gateway.
          }
        }
      }

      if (trace) {
        log(`[gateway] ${method} ${url}`);
        log(`[gateway]   content-type: ${contentType}`);
        log(`[gateway]   body-size: ${bodyStr.length}`);
      }

      // --- Reject protobuf/grpc binary content types early ---
      if (contentType.includes('proto') || (contentType.includes('grpc') && !contentType.includes('json'))) {
        log(`[gateway] UNSUPPORTED content-type: ${contentType}`);
        respondJson(res, 415, {
          error: {
            code: 415,
            message: `Gateway only supports JSON. Received: ${contentType}`,
          },
        });
        return;
      }

      if (trace && parsed) {
        const preview = JSON.stringify(parsed, function (key, value) {
          if (
            key === 'data'
            && typeof value === 'string'
            && this
            && typeof this === 'object'
            && typeof (this as { mimeType?: unknown }).mimeType === 'string'
          ) {
            return `[${value.length} media chars]`;
          }
          return value;
        }).slice(0, 500);
        log(`[gateway]   body-preview: ${preview}`);
        const declaredTools = (parsed as {
          request?: { tools?: Array<{ functionDeclarations?: Array<{ name?: string }> }> };
        }).request?.tools;
        if (declaredTools) {
          const toolNames = declaredTools
            .flatMap(group => group.functionDeclarations ?? [])
            .map(decl => decl.name)
            .filter((name): name is string => typeof name === 'string');
          log(`[gateway]   declared tools (${toolNames.length}): ${toolNames.join(', ')}`);
        }
        // Everything but the conversation, system prompt and tools — where the
        // client's own settings (e.g. generationConfig) live, cut off by the preview.
        const request = (parsed as { request?: unknown }).request;
        if (request && typeof request === 'object') {
          const { contents: _c, systemInstruction: _s, tools: _t, ...settings } = request as Record<string, unknown>;
          log(`[gateway]   request-settings: ${JSON.stringify({ model: (parsed as { model?: unknown }).model, ...settings })}`);
        }
      }

      // --- loadCodeAssist ---
      if (lowerUrl.includes('loadcodeassist')) {
        if (trace) log('[gateway] → loadCodeAssist');
        // No cascadeModelConfigData — the real Google API doesn't return it here.
        // The LS resolves cascade config internally from model registry + experiments.
        respondJson(res, 200, loadCodeAssistFixture);
        return;
      }

      // --- fetchAvailableModels / GetAvailableModels ---
      if (lowerUrl.includes('fetchavailablemodels') || lowerUrl.includes('getavailablemodels')) {
        if (trace) log('[gateway] → fetchAvailableModels');
        respondJson(res, 200, injectedCatalog);
        return;
      }

      // --- listModelConfigs / GetCascadeModelConfigs / GetCommandModelConfigs ---
      if (lowerUrl.includes('modelconfigs')) {
        if (trace) log('[gateway] → listModelConfigs');
        respondJson(res, 200, modelConfigsResponse);
        return;
      }

      // --- GenerateContent / GenerateChat (streaming and unary) ---
      if (lowerUrl.includes('generatecontent') || lowerUrl.includes('generatechat')) {
        const model = parsed?.model as string | undefined;
        if (trace) log(`[gateway]   extracted model: ${model ?? 'N/A'}`);

        const route = resolveRouteForModel(model);
        if (route) {
          if (trace) {
            log(
              `[gateway]   resolved route: ${route.catalogId}`
              + ` (${route.providerId}/${route.upstreamModelId} via ${model})`,
            );
          }
          const media = sanitizeUnsupportedInlineData(parsed as unknown as CloudCodeGenerateRequest);
          parsed = media.request as unknown as Record<string, unknown>;
          if (media.latestUserTurnHasUnsupportedMedia) {
            if (trace) log('[gateway] unsupported media in current user turn; provider call skipped');
            respondUnsupportedMedia(res, route, lowerUrl.includes('stream'));
            return;
          }
          if (trackActiveRoute && selectedSlotIds.has(model ?? '') && isUserTurnRequest(parsed)) {
            activeRoute = route;
            if (trace) log(`[gateway]   active route: ${route.catalogId} via ${model}`);
          }
          if (isCloudCodeOAuthRoute(route)) {
            handleCloudCodeForwardRequest(res, route, parsed as Record<string, unknown>, lowerUrl, log).catch(err => {
              log(`[gateway] cloud-code forward error: ${err instanceof Error ? err.stack || err.message : String(err)}`);
              if (!res.headersSent) {
                respondJson(res, 500, { error: { code: 500, message: formatUpstreamError(err) } });
              } else if (!res.writableEnded) {
                res.end();
              }
            });
            return;
          }
          const baseProviderOptions = providerOptionsCache.get(route.catalogId);
          if (trace) log(`[gateway]   provider options: ${JSON.stringify(baseProviderOptions ?? {})}`);
          const isStream = lowerUrl.includes('stream');
          const conversationKey = conversationKeyFromRequest(parsed);
          const conversationSessionId = antigravityConversationId(parsed, req.headers);
          const optionsFor = (target: AntigravityRoute): TranslateRequestOptions => {
            const requestHeaders = openCodeGoHeaders(
              target.providerId,
              target.baseURL,
              conversationSessionId,
              target.headers,
            );
            return {
              ...reasoningEchoOptionsForRoute(target, parsed, reasoningEchoesByConversation),
              ...(requestHeaders ? { requestHeaders } : {}),
            };
          };
          const requestOptions = optionsFor(route);
          const rememberReasoning = (reasoning: string, answeredBy?: AntigravityRoute) => {
            if (!shouldEchoReasoningForRoute(answeredBy ?? route)) return;
            rememberReasoningEcho(reasoningEchoesByConversation, conversationKey, reasoning);
          };

          if (isStream) {
            handleStreamingRequest(res, route, baseProviderOptions, parsed as any, log, {
              requestOptions,
              optionsFor,
              pool: poolDeps,
              sessionId: conversationSessionId,
              onReasoningWithToolCall: rememberReasoning,
              trace,
            }).catch(err => {
              log(`[gateway] stream error: ${formatUpstreamError(err)}`);
              if (trace) log(`[gateway] stream error detail: ${formatUpstreamErrorTrace(err)}`);
              if (!res.headersSent) {
                respondJson(res, 500, { error: { code: 500, message: formatUpstreamError(err) } });
              } else if (!res.writableEnded) {
                res.end();
              }
            });
          } else {
            handleUnaryRequest(res, route, baseProviderOptions, parsed as any, log, {
              requestOptions,
              optionsFor,
              pool: poolDeps,
              sessionId: conversationSessionId,
              onReasoningWithToolCall: rememberReasoning,
              trace,
            }).catch(err => {
              log(`[gateway] unary error: ${formatUpstreamError(err)}`);
              if (trace) log(`[gateway] unary error detail: ${formatUpstreamErrorTrace(err)}`);
              if (!res.headersSent) {
                respondJson(res, 500, { error: { code: 500, message: formatUpstreamError(err) } });
              }
            });
          }
          return;
        }

        respondJson(res, 403, {
          error: {
            code: 403,
            message: `Non-Relay model "${model ?? 'unknown'}" rejected in privacy mode`,
          },
        });
        return;
      }

      // --- Known endpoints with minimal local responses ---
      if (lowerUrl.includes('fetchadmincontrols')) {
        // Google returns an empty object for a normal consumer account. AGY's
        // "admin controls not applicable" log line also appears on native
        // sessions, so it is benign: MCP availability comes from the
        // listExperiments feature flags, not from this response.
        respondJson(res, 200, {});
        return;
      }
      if (lowerUrl.includes('userquota')) {
        respondJson(res, 200, { quotaSummary: { remainingQueries: 9999, totalQueries: 9999, quotaType: 'RELAY_UNLIMITED' } });
        return;
      }
      if (lowerUrl.includes('userinfo')) {
        respondJson(res, 200, {
          userSettings,
          regionCode: 'US',
        });
        return;
      }
      if (lowerUrl.includes('usersettings')) {
        respondJson(res, 200, { userSettings });
        return;
      }
      if (lowerUrl.includes('experiments') || lowerUrl.includes('experimentstatus')) {
        respondJson(res, 200, experimentsResponse);
        return;
      }
      if (lowerUrl.includes('onboarduser')) {
        respondJson(res, 200, {
          name: 'operations/cmpf.DONE_OPERATION',
          done: true,
          response: {
            '@type': 'type.googleapis.com/google.internal.cloud.code.v1internal.OnboardUserResponse',
            cloudaicompanionProject: {
              id: 'relay-ai-local-project',
              name: 'relay-ai-local-project',
              projectNumber: '0',
            },
            status: {
              statusCode: 'NOTICE',
              displayMessage: "You've successfully connected your Google Account and can now get started with Gemini Code Assist",
              messageTitle: 'Welcome to Gemini Code Assist',
            },
          },
        });
        return;
      }
      if (lowerUrl.includes('record') || lowerUrl.includes('feedback') || lowerUrl.includes('metrics')) {
        respondJson(res, 200, {});
        return;
      }
      if (lowerUrl.includes('snippet')) {
        respondJson(res, 200, { snippets: [] });
        return;
      }
      if (lowerUrl.includes('cascadenux') || lowerUrl.includes('listcascade')) {
        respondJson(res, 200, { cascadeNuxes: [] });
        return;
      }
      if (lowerUrl.includes('denylist') || lowerUrl.includes('checkurl')) {
        respondJson(res, 200, { denied: false });
        return;
      }
      if (lowerUrl.includes('plugin')) {
        respondJson(res, 200, { plugins: [] });
        return;
      }
      if (lowerUrl.includes('counttokens')) {
        respondJson(res, 200, { tokenCount: 0, totalTokens: 0 });
        return;
      }
      if (lowerUrl.includes('listremote') || lowerUrl.includes('listcloudai') || lowerUrl.includes('companionproject')) {
        respondJson(res, 200, { projects: [] });
        return;
      }
      if (lowerUrl.includes('migrate')) {
        respondJson(res, 200, {});
        return;
      }

      // --- Health check ---
      if (url === '/' || lowerUrl.includes('health')) {
        respondJson(res, 200, { status: 'ok' });
        return;
      }

      // --- Unknown endpoints — permissive empty 200 ---
      if (trace) {
        log(`[gateway] unknown endpoint: ${url}`);
      }
      respondJson(res, 200, {});
    }).catch(err => {
      respondJson(res, 400, { error: { code: 400, message: `Failed to read request: ${err instanceof Error ? err.message : String(err)}` } });
    });
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        resolve({
          port,
          url: `http://127.0.0.1:${port}`,
          close: () => new Promise<void>((res, rej) => {
            server.closeAllConnections();
            server.close(err => { const code = (err as any)?.code; if (err && code !== "ERR_SERVER_NOT_RUNNING") { rej(err); } else { res(); } });
          }),
        });
      } else {
        reject(new Error('Failed to get server address'));
      }
    });
  });
}



function reasoningDeltaText(part: Record<string, unknown>): string {
  return String(part.text ?? part.textDelta ?? part.delta ?? '');
}

function reasoningOutputText(reasoning: unknown): string {
  if (typeof reasoning === 'string') return reasoning;
  if (Array.isArray(reasoning)) {
    return reasoning.map(item => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object' && 'text' in item) {
        return String((item as { text?: unknown }).text ?? '');
      }
      return '';
    }).filter(Boolean).join('');
  }
  if (reasoning && typeof reasoning === 'object' && 'text' in reasoning) {
    return String((reasoning as { text?: unknown }).text ?? '');
  }
  return '';
}

function conversationKeyFromRequest(parsed: Record<string, unknown> | undefined): string {
  const requestId = typeof parsed?.requestId === 'string' ? parsed.requestId : '';
  const segments = requestId.split('/');
  if (segments.length >= 2 && segments[0] && segments[1]) {
    return `${segments[0]}/${segments[1]}`;
  }
  return 'global';
}

/** Cloud Code requestId is `agent/<conversation>/<turn>`; only the stable
 * conversation prefix is suitable for OpenCode's conversation header. */
function antigravityConversationId(
  parsed: Record<string, unknown> | undefined,
  headers?: Record<string, string | string[] | undefined>,
): string | undefined {
  const explicit = extractConversationId(headers, parsed);
  if (explicit) return explicit;
  const requestId = typeof parsed?.requestId === 'string' ? parsed.requestId : '';
  const segments = requestId.split('/');
  if (segments.length >= 2 && segments[0] && segments[1]) return `${segments[0]}/${segments[1]}`;
  return undefined;
}

function shouldEchoReasoningForRoute(route: AntigravityRoute): boolean {
  if (route.npm !== '@ai-sdk/openai-compatible') return false;
  const routeIdentity = [
    route.providerId,
    route.providerName,
    route.catalogId,
    route.modelId,
    route.upstreamModelId,
    route.displayName,
    route.baseURL,
  ].join(' ');
  return /deepseek|big[\s_-]?pickle|\bglm[\s_-]/i.test(routeIdentity);
}

function reasoningEchoOptionsForRoute(
  route: AntigravityRoute,
  parsed: Record<string, unknown> | undefined,
  cache: Map<string, string[]>,
): TranslateRequestOptions {
  if (!shouldEchoReasoningForRoute(route)) return {};
  const existing = cache.get(conversationKeyFromRequest(parsed));
  return existing?.length ? { fallbackAssistantReasoning: existing } : {};
}

function rememberReasoningEcho(cache: Map<string, string[]>, key: string, reasoning: string): void {
  const normalized = reasoning.trim();
  if (!normalized) return;
  const existing = cache.get(key) ?? [];
  existing.push(normalized);
  cache.set(key, existing.slice(-MAX_REASONING_ECHOES_PER_CONVERSATION));
}

async function handleCloudCodeForwardRequest(
  res: http.ServerResponse,
  route: AntigravityRoute,
  parsed: Record<string, unknown>,
  lowerUrl: string,
  log: (msg: string) => void,
): Promise<void> {
  const projectId = typeof route.providerData?.projectId === 'string' ? route.providerData.projectId : '';
  if (!projectId) {
    respondJson(res, 500, {
      error: {
        code: 500,
        message: 'Antigravity provider missing projectId — re-authenticate with relay-ai providers auth antigravity',
      },
    });
    return;
  }

  const upstreamBody = {
    ...parsed,
    project: projectId,
    model: route.upstreamModelId,
  };
  const baseUrl = (route.baseURL || ANTIGRAVITY_BASE_URLS[0]!).replace(/\/+$/, '');
  const endpoint = lowerUrl.includes('stream')
    ? `${baseUrl}/v1internal:streamGenerateContent?alt=sse`
    : `${baseUrl}/v1internal:generateContent`;

  const upstream = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${route.apiKey}`,
      'User-Agent': ANTIGRAVITY_USER_AGENT,
    },
    body: JSON.stringify(upstreamBody),
  });

  if (!upstream.ok) {
    const errBody = await upstream.text();
    log(`[gateway] cloud-code upstream error ${upstream.status}: ${errBody}`);
    respondJson(res, upstream.status >= 500 ? 502 : upstream.status, {
      error: { code: upstream.status, message: errBody || upstream.statusText },
    });
    return;
  }

  if (lowerUrl.includes('stream')) {
    res.writeHead(200, {
      'content-type': upstream.headers.get('content-type') ?? 'text/event-stream',
      'cache-control': 'no-cache',
      'grpc-status': '0',
    });
    if (!upstream.body) {
      res.end();
      return;
    }
    for await (const chunk of upstream.body as any) {
      res.write(chunk);
    }
    res.end();
    return;
  }

  const body = await upstream.text();
  res.writeHead(200, {
    'content-type': upstream.headers.get('content-type') ?? 'application/json',
    'content-length': String(Buffer.byteLength(body)),
    'grpc-status': '0',
  });
  res.end(body);
}

interface RequestHandlerOptions {
  requestOptions?: TranslateRequestOptions;
  sessionId?: string;
  onReasoningWithToolCall?: (reasoning: string, answeredBy?: AntigravityRoute) => void;
  /** Request options for one concrete route (pool members each get their own). */
  optionsFor?: (route: AntigravityRoute) => TranslateRequestOptions;
  /** Free pool dependencies. */
  pool?: { health(): PoolHealthStore; limits: PoolLimits; lastSkip: Map<string, string> };
  trace?: boolean;
}

function emitThinkingDelta(
  res: http.ServerResponse,
  route: AntigravityRoute,
  responseId: string,
  text: string,
  startSse: () => void,
): void {
  if (!text) return;
  startSse();
  const chunk = formatCloudCodeChunk({
    thought: text,
    modelVersion: route.catalogId,
    responseId,
  });
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
}

/** Returns the length of the longest suffix of `text` that is also a prefix of `tag`. */
function trailingPartial(text: string, tag: string): number {
  for (let len = Math.min(tag.length - 1, text.length); len > 0; len--) {
    if (text.endsWith(tag.slice(0, len))) return len;
  }
  return 0;
}

/**
 * Creates a per-request filter that extracts inline `<think>...</think>` blocks
 * from streamed text deltas (e.g. NVidia-hosted Kimi K2.6) and routes them as
 * thought content. Handles `<think>`/`</think>` tags split across chunk boundaries.
 */
function createThinkFilter(): (chunk: string) => { thought: string; text: string } {
  let state: 'scanning' | 'inside' | 'passthrough' = 'scanning';
  let partial = '';
  return function processChunk(chunk: string): { thought: string; text: string } {
    if (state === 'passthrough') return { thought: '', text: chunk };
    let src = partial + chunk;
    partial = '';
    let thought = '';
    let text = '';
    while (src.length > 0) {
      if (state === 'scanning') {
        const idx = src.indexOf('<think>');
        if (idx === -1) {
          const len = trailingPartial(src, '<think>');
          text += src.slice(0, src.length - len);
          if (len > 0) { partial = src.slice(src.length - len); } else { state = 'passthrough'; }
          break;
        }
        text += src.slice(0, idx);
        src = src.slice(idx + 7);
        state = 'inside';
      } else {
        const idx = src.indexOf('</think>');
        if (idx === -1) {
          const len = trailingPartial(src, '</think>');
          thought += src.slice(0, src.length - len);
          if (len > 0) partial = src.slice(src.length - len);
          break;
        }
        thought += src.slice(0, idx);
        src = src.slice(idx + 8);
        if (src.startsWith('\n')) src = src.slice(1);
        state = 'passthrough';
      }
    }
    return { thought, text };
  };
}

function emitStreamError(
  res: http.ServerResponse,
  route: AntigravityRoute,
  responseId: string,
  message: string,
  startSse: () => void,
): void {
  startSse();
  const chunk = formatCloudCodeChunk({
    text: `\n\n⚠ ${message}\n`,
    modelVersion: route.catalogId,
    responseId,
    finishReason: 'OTHER',
  });
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
}

function respondJson(res: http.ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(body)),
    'grpc-status': status < 400 ? '0' : '13',
  });
  res.end(body);
}

function respondUnsupportedMedia(
  res: http.ServerResponse,
  route: AntigravityRoute,
  streaming: boolean,
): void {
  const responseId = `relay-${Date.now()}`;
  if (streaming) {
    const chunk = formatCloudCodeChunk({
      text: UNSUPPORTED_VOICE_MESSAGE,
      modelVersion: route.catalogId,
      responseId,
      finishReason: 'STOP',
    });
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'grpc-status': '0',
    });
    res.end(`data: ${JSON.stringify(chunk)}\n\n`);
    return;
  }

  respondJson(res, 200, {
    response: {
      candidates: [{
        content: {
          role: 'model',
          parts: [{ text: UNSUPPORTED_VOICE_MESSAGE }],
        },
        finishReason: 'STOP',
      }],
      modelVersion: route.catalogId,
      responseId,
    },
    traceId: 'relay-trace',
    metadata: {},
  });
}

/**
 * Some models emit a tool call as plain JSON text instead of a real tool-call part.
 * `knownToolNames` is required to tell that apart from a model legitimately answering
 * with JSON — without it, a reply like `{"name":"Alice"}` would be run as a tool.
 */
export function parsePseudoToolCall(
  text: string,
  knownToolNames: ReadonlySet<string>,
): { name: string; args: Record<string, unknown> } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  try {
    const obj = JSON.parse(trimmed);
    if (obj && typeof obj === 'object') {
      const name = obj.name || (obj.type === 'function' && typeof obj.function === 'object' && obj.function?.name) || obj.function_name;
      if (typeof name === 'string' && knownToolNames.has(name)) {
        const args = obj.parameters || obj.arguments || obj.args || (typeof obj.function === 'object' && obj.function?.parameters) || {};
        return { name, args: typeof args === 'object' && args ? args : {} };
      }
    }
  } catch {}
  return null;
}

/**
 * Handle a streaming GenerateContent request.
 * Uses the SDK event stream to support text deltas, tool call events, and finish.
 */
function providerOptionsForRoute(route: AntigravityRoute) {
  return deepMergeProviderOptions(
    thinkingProviderOptions(route.npm),
    effortProviderOptions(route.npm, route.reasoningEffort ?? 'high', route.upstreamModelId, route.reasoningMetadata),
  );
}

async function handleStreamingRequest(
  res: http.ServerResponse,
  route: AntigravityRoute,
  providerOptions: any,
  parsed: any,
  log: (msg: string) => void,
  options: RequestHandlerOptions = {},
): Promise<void> {
  if (route.poolMembers?.length) {
    await handlePoolRequest(res, route, parsed, log, options, true);
    return;
  }
  const sdkParams = applyClaudeCodeOAuthIdentity(route, translateRequest(parsed, {
    ...options.requestOptions,
    npm: route.npm,
    maxTools: maxToolsForNpm(route.npm),
  }));
  if (options.trace) {
    log(`[gateway]   sdk request: ${JSON.stringify(summarizeSdkRequestForTrace(sdkParams))}`);
  }
  const effectiveProviderOptions = deepMergeProviderOptions(
    providerOptions,
    sdkParams.providerOptions,
  );
  const langModel = await createRouteLanguageModel(route, options.sessionId);

  const { stream } = streamText({
    model: langModel,
    instructions: sdkParams.instructions,
    messages: sdkParams.messages,
    tools: sdkParams.tools,
    toolChoice: sdkParams.toolChoice,
    providerOptions: effectiveProviderOptions as any,
    headers: sdkParams.headers,
  });

  await writeCloudCodeStream(stream, res, route, { log, options, toolNames: new Set(Object.keys(sdkParams.tools ?? {})) });
}

function clientMaxOutputTokens(parsed: any): number | undefined {
  const value = parsed?.request?.generationConfig?.maxOutputTokens;
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/** Free pool row: one request through the shared coordinator (bounded attempts, timeouts, cooldowns, cancellation). */
async function handlePoolRequest(
  res: http.ServerResponse,
  row: AntigravityRoute,
  parsed: any,
  log: (msg: string) => void,
  options: RequestHandlerOptions,
  stream: boolean,
): Promise<void> {
  const deps = options.pool;
  const members = row.poolMembers ?? [];
  const requestId = randomUUID().slice(0, 8);
  if (!deps) {
    respondJson(res, 502, { error: { code: 502, message: 'Free pool is not available in this gateway' } });
    return;
  }
  // A client that goes away must cancel the attempt and release any recovery claim.
  const abort = new AbortController();
  const onClose = () => { if (!res.writableFinished) abort.abort(new Error('client disconnected')); };
  res.on('close', onClose);
  const started = { at: Date.now() };
  let answering: AntigravityRoute | undefined;
  const toolNames = new Set<string>();
  const requestHasTools = ((parsed?.request?.tools ?? []) as Array<{ functionDeclarations?: unknown[] }>)
    .some(group => (group.functionDeclarations?.length ?? 0) > 0);
  const failed = new Set<string>();
  const skips: Array<{ member: AntigravityRoute; reason: string }> = [];
  const requestStart = Date.now();
  const memberKey = (member: { providerId: string; modelId: string }) => member.providerId + '/' + member.modelId;
  // A non-streaming reply is collected before anything is sent, so a member that dies mid-answer can still
  // be replaced by the next one. A streaming reply cannot: once bytes reached the client, the request ends.
  try {
    for (let round = 0; ; round += 1) {
      const eligible = members.filter(member => !failed.has(memberKey(member)));
      if (round > 0 && eligible.length === 0) throw new PoolAttemptError('attempt-budget-exhausted', false);
      try {
        const { routes } = await prepareAntigravityPoolRoutes({
          members: eligible,
          health: deps.health(),
          onSkip: (member, reason) => {
            log('[gateway] pool member skipped: ' + member.providerId + '/' + member.modelId + ': ' + reason);
            if (round === 0) skips.push({ member, reason });
          },
          onBuilt: (_member, built) => { for (const name of Object.keys(built.tools ?? {})) toolNames.add(name); },
          build: async member => {
            const sdkParams = applyClaudeCodeOAuthIdentity(member, translateRequest(parsed, {
              ...(options.optionsFor?.(member) ?? options.requestOptions),
              npm: member.npm,
              maxTools: Math.min(maxToolsForNpm(member.npm) ?? POOL_MAX_TOOLS, POOL_MAX_TOOLS),
            }));
            const model = await createRouteLanguageModel(member, options.sessionId);
            return {
              model,
              messages: sdkParams.messages,
              tools: sdkParams.tools,
              system: sdkParams.instructions,
              toolChoice: sdkParams.toolChoice,
              providerOptions: deepMergeProviderOptions(
                // An effort level is sent only when the pool row names one the member verified; Auto sends none.
                member.reasoningEffort ? providerOptionsForRoute(member) : thinkingProviderOptions(member.npm),
                sdkParams.providerOptions) as never,
              headers: sdkParams.headers,
              maxOutputTokens: clientMaxOutputTokens(parsed),
            };
          },
        });
        const remaining = Math.max(1, deps.limits.totalMs - (Date.now() - requestStart));
        const events = dispatchFreePool(antigravityPoolPreferences(eligible, row.reasoningEffort), routes, {
          target: 'antigravity', tools: requestHasTools, effort: row.reasoningEffort, signal: abort.signal,
        }, {
          limits: { ...deps.limits, totalMs: remaining },
          retryable: retryPoolFailure,
          onAttempt: id => {
            const member = poolRouteMember(id);
            answering = members.find(item => item.providerId === member?.providerId && item.modelId === member?.modelId);
            started.at = Date.now();
            if (member) log('[gateway] pool attempt: ' + member.providerId + '/' + member.modelId);
          },
          onFailure: (id, error) => {
            const member = poolRouteMember(id);
            if (!member) return;
            failed.add(memberKey(member));
            const reason = describePoolFailure(error);
            const detail = reason.startsWith('simulated') ? undefined : poolErrorDetail(error);
            recordPoolActivity({ target: 'antigravity', event: 'failed', ...member, requestId, reason, ...(detail ? { detail } : {}), ms: Date.now() - started.at });
            log('[gateway] pool member failed: ' + member.providerId + '/' + member.modelId + ' (' + reason + ')' + (detail ? ': ' + detail : ''));
          },
        });
        const noteServed = () => {
          const member = answering;
          if (!member) return;
          // Why a preferred member was passed over: shown when it starts or changes (not on every request, and
          // not for a cooldown, which already has its own failure entry), and only for members ahead of the answerer.
          const order = members.indexOf(member);
          const seen = new Set<string>();
          for (const item of skips) {
            const key = memberKey(item.member);
            seen.add(key);
            if (item.reason.startsWith('cooling down')) continue;
            const fresh = deps.lastSkip.get(key) !== item.reason;
            deps.lastSkip.set(key, item.reason);
            if (fresh && members.indexOf(item.member) < order) {
              recordPoolActivity({ target: 'antigravity', event: 'failed', providerId: item.member.providerId, modelId: item.member.modelId, requestId, reason: 'skipped: ' + item.reason });
            }
          }
          for (const key of [...deps.lastSkip.keys()]) if (!seen.has(key)) deps.lastSkip.delete(key);
          recordPoolActivity({ target: 'antigravity', event: 'served', providerId: member.providerId, modelId: member.modelId, requestId, ms: Date.now() - started.at });
        };
        const poolOptions: RequestHandlerOptions = {
          ...options,
          onReasoningWithToolCall: reasoning => options.onReasoningWithToolCall?.(reasoning, answering),
        };
        if (stream) {
          const completed = await writeCloudCodeStream(events, res, row, { log, options: poolOptions, toolNames, pool: true, cancelled: () => abort.signal.aborted });
          if (completed) noteServed();
          else if (!abort.signal.aborted) recordPoolActivity({ target: 'antigravity', event: 'gave-up', providerId: 'relay-free-pool', modelId: row.modelId, requestId });
        } else {
          const response = await collectCloudCodeResponse(events, row, poolOptions);
          noteServed();
          respondJson(res, 200, { response, traceId: 'relay-trace', metadata: {} });
        }
        return;
      } catch (error) {
        const replaceable = !stream && !abort.signal.aborted && error instanceof PoolAttemptError
          && error.committed && members.some(member => !failed.has(memberKey(member)))
        && Date.now() - requestStart < deps.limits.totalMs;
        if (!replaceable) throw error;
      }
    }
  } catch (error) {
    if (abort.signal.aborted) {
      if (!res.writableEnded) res.end();
      return;
    }
    const gaveUp = error instanceof PoolAttemptError || (error instanceof Error && error.message.startsWith('No eligible free pool members'));
    log('[gateway] pool request failed: ' + formatUpstreamError((error as { cause?: unknown }).cause ?? error));
    if (gaveUp) recordPoolActivity({ target: 'antigravity', event: 'gave-up', providerId: 'relay-free-pool', modelId: row.modelId, requestId });
    if (!res.headersSent) {
      const message = error instanceof Error && error.message.startsWith('No eligible free pool members')
        ? error.message : 'All free pool members failed';
      respondJson(res, 502, { error: { code: 502, message } });
    } else if (!res.writableEnded) {
      res.end();
    }
  } finally {
    res.off('close', onClose);
  }
}

/** Collects a validated pool stream into one Cloud Code unary response. */
async function collectCloudCodeResponse(
  events: AsyncIterable<unknown>,
  route: AntigravityRoute,
  options: RequestHandlerOptions,
): Promise<Record<string, unknown>> {
  let text = '';
  let reasoning = '';
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const toolBuffers = new Map<string, { name: string; json: string }>();
  let finish = '';
  let usage: { inputTokens?: number; outputTokens?: number } | undefined;
  for await (const part of events) {
    const p = part as any;
    if (p.type === 'reasoning-delta' || p.type === 'reasoning') reasoning += reasoningDeltaText(p);
    else if (p.type === 'text-delta') text += reasoningDeltaText(p);
    else if (p.type === 'tool-input-start') toolBuffers.set(p.id ?? p.toolCallId, { name: p.toolName, json: '' });
    else if (p.type === 'tool-input-delta') { const buf = toolBuffers.get(p.id ?? p.toolCallId); if (buf) buf.json += p.delta; }
    else if (p.type === 'tool-call') {
      const buf = toolBuffers.get(p.toolCallId ?? p.id);
      calls.push({ name: p.toolName ?? buf?.name, args: normalizeFunctionCallArgs((p.input ?? {}) as Record<string, unknown>) });
    } else if (p.type === 'finish') { finish = p.finishReason ?? ''; usage = p.totalUsage; }
  }
  const parts: any[] = [];
  if (reasoning) parts.push({ text: reasoning, thought: true });
  if (text) parts.push({ text });
  for (const call of calls) parts.push({ functionCall: { name: call.name, args: call.args } });
  if (reasoning && calls.length) options.onReasoningWithToolCall?.(reasoning);
  if (parts.length === 0) parts.push({ text: '' });
  return {
    candidates: [{ content: { role: 'model', parts }, finishReason: mapFinishReason(finish) }],
    usageMetadata: {
      promptTokenCount: usage?.inputTokens || 0,
      candidatesTokenCount: usage?.outputTokens || 0,
      totalTokenCount: (usage?.inputTokens || 0) + (usage?.outputTokens || 0),
    },
    modelVersion: route.catalogId,
    responseId: `relay-${Date.now()}`,
  };
}

/** Formats an SDK part stream as Cloud Code SSE. Shared by concrete routes and the free pool. */
async function writeCloudCodeStream(
  stream: AsyncIterable<unknown>,
  res: http.ServerResponse,
  route: AntigravityRoute,
  ctx: { log: (msg: string) => void; options: RequestHandlerOptions; toolNames: ReadonlySet<string>; pool?: boolean; cancelled?: () => boolean },
): Promise<boolean> {
  const { log, options } = ctx;
  let streamFailed = false;
  const responseId = `relay-${Date.now()}`;
  const startSse = () => {
    if (res.headersSent) return;
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'grpc-status': '0',
    });
  };

  const thinkFilter = createThinkFilter();

  const toolCallBuffers = new Map<string, { name: string; json: string }>();
  const knownToolNames = ctx.toolNames;
  let responseReasoning = '';
  let sawToolCall = false;
  let textBuffer = '';
  let bufferingJsonText = false;

  const flushBufferedText = () => {
    if (!textBuffer) return;
    startSse();
    const chunk = formatCloudCodeChunk({
      text: textBuffer,
      modelVersion: route.catalogId,
      responseId,
    });
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    textBuffer = '';
    bufferingJsonText = false;
  };

  const emitPseudoToolCall = (pseudoTool: { name: string; args: Record<string, unknown> }) => {
    sawToolCall = true;
    startSse();
    const chunk = formatCloudCodeChunk({
      functionCall: { name: pseudoTool.name, args: normalizeFunctionCallArgs(pseudoTool.args) },
      modelVersion: route.catalogId,
      responseId,
    });
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    textBuffer = '';
    bufferingJsonText = false;
  };

  try {
    for await (const part of stream) {
      const p = part as any;

      if (p.type === 'reasoning-delta' || p.type === 'reasoning') {
        const reasoning = reasoningDeltaText(p);
        responseReasoning += reasoning;
        emitThinkingDelta(res, route, responseId, reasoning, startSse);
        continue;
      }

      if (p.type === 'text-delta') {
        const { thought, text } = thinkFilter(reasoningDeltaText(p));
        if (thought) {
          responseReasoning += thought;
          emitThinkingDelta(res, route, responseId, thought, startSse);
        }
        if (text) {
          log(`[gateway] text-delta: ${JSON.stringify(text.slice(0, 500))}`);
          if (!bufferingJsonText && (textBuffer + text).trimStart().startsWith('{')) {
            bufferingJsonText = true;
          }
          if (bufferingJsonText) {
            textBuffer += text;
            // Only attempt a parse once the buffer could close an object — otherwise every
            // delta re-parses the whole growing buffer.
            const pseudoTool = textBuffer.trimEnd().endsWith('}')
              ? parsePseudoToolCall(textBuffer, knownToolNames)
              : null;
            if (pseudoTool) {
              log(`[gateway] parsed pseudo tool-call from text: ${pseudoTool.name}`);
              emitPseudoToolCall(pseudoTool);
            }
          } else {
            startSse();
            const chunk = formatCloudCodeChunk({
              text,
              modelVersion: route.catalogId,
              responseId,
            });
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          }
        }
      } else if (p.type === 'tool-input-start') {
        const id = p.id ?? p.toolCallId;
        toolCallBuffers.set(id, { name: p.toolName, json: '' });
      } else if (p.type === 'tool-input-delta') {
        const id = p.id ?? p.toolCallId;
        const buf = toolCallBuffers.get(id);
        if (buf) buf.json += p.delta;
      } else if (p.type === 'tool-call') {
        sawToolCall = true;
        const id = p.toolCallId ?? p.id;
        const buf = toolCallBuffers.get(id);
        let args: Record<string, unknown> = {};
        try { args = buf ? JSON.parse(buf.json || '{}') : (p.input || {}); } catch { args = p.input || {}; }
        const name = buf ? buf.name : p.toolName;
        log(`[gateway] tool-call: ${name}`);
        startSse();
        const chunk = formatCloudCodeChunk({
          functionCall: { name, args: normalizeFunctionCallArgs(args) },
          modelVersion: route.catalogId,
          responseId,
        });
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      } else if (p.type === 'finish') {
        log(`[gateway] finish: ${p.finishReason ?? 'unknown'}`);
        if (textBuffer) {
          const pseudoTool = parsePseudoToolCall(textBuffer, knownToolNames);
          if (pseudoTool) {
            log(`[gateway] parsed pseudo tool-call on finish: ${pseudoTool.name}`);
            emitPseudoToolCall(pseudoTool);
          } else {
            flushBufferedText();
          }
        }
        startSse();
        const reason = mapFinishReason(p.finishReason ?? '');
        const chunk = formatCloudCodeChunk({
          modelVersion: route.catalogId,
          responseId,
          finishReason: reason,
          usage: {
            promptTokens: p.totalUsage?.inputTokens || 0,
            completionTokens: p.totalUsage?.outputTokens || 0,
          },
        });
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      } else if (p.type === 'error') {
        const message = formatUpstreamError(p.error);
        log(`[gateway] stream provider error: ${message}`);
        if (options.trace) {
          log(`[gateway] stream provider error detail: ${formatUpstreamErrorTrace(p.error)}`);
        }
        // Buffered JSON-shaped text is real output — don't lose it to the error.
        flushBufferedText();
        emitStreamError(res, route, responseId, message, startSse);
        break;
      } else if (p.type === 'reasoning-start' || p.type === 'reasoning-end') {
        log(`[gateway] ${p.type}`);
      }
    }
  } catch (error) {
    // Pool attempts end by throwing (timeout, bad finish, provider error). Nothing sent yet: the caller
    // answers with a status. Content already sent: close the stream with the visible error line.
    if (!ctx.pool || !res.headersSent) throw error;
    // The client leaving is not a failure to report, and there is nobody to write to.
    if (!ctx.cancelled?.()) {
      flushBufferedText();
      emitStreamError(res, route, responseId, formatUpstreamError((error as { cause?: unknown }).cause ?? error), startSse);
    }
    streamFailed = true;
  }
  if (!res.headersSent) {
    throw new Error('Provider returned an empty stream');
  }
  // Reasoning from an answer that failed midway is not worth echoing back.
  if (!streamFailed && sawToolCall && responseReasoning.trim()) {
    options.onReasoningWithToolCall?.(responseReasoning);
  }
  res.end();
  return !streamFailed;
}


/**
 * Handle a non-streaming (unary) GenerateContent request.
 */
async function handleUnaryRequest(
  res: http.ServerResponse,
  route: AntigravityRoute,
  providerOptions: any,
  parsed: any,
  log: (msg: string) => void,
  options: RequestHandlerOptions = {},
): Promise<void> {
  if (route.poolMembers?.length) {
    await handlePoolRequest(res, route, parsed, log, options, false);
    return;
  }
  const sdkParams = applyClaudeCodeOAuthIdentity(route, translateRequest(parsed, {
    ...options.requestOptions,
    npm: route.npm,
    maxTools: maxToolsForNpm(route.npm),
  }));
  if (options.trace) {
    log(`[gateway]   sdk request: ${JSON.stringify(summarizeSdkRequestForTrace(sdkParams))}`);
  }
  const effectiveProviderOptions = deepMergeProviderOptions(
    providerOptions,
    sdkParams.providerOptions,
  );
  const langModel = await createRouteLanguageModel(route, options.sessionId);
  const responseId = `relay-${Date.now()}`;

  const result = await generateTextStreamingIfRequired({
    model: langModel,
    instructions: sdkParams.instructions,
    messages: sdkParams.messages,
    tools: sdkParams.tools,
    toolChoice: sdkParams.toolChoice,
    providerOptions: effectiveProviderOptions as any,
    headers: sdkParams.headers,
  });

  const parts: any[] = [];
  const reasoning = reasoningOutputText(result.reasoning);
  if (reasoning) {
    parts.push({ text: reasoning, thought: true });
  }
  if (result.text) {
    parts.push({ text: result.text });
  }
  if (result.toolCalls?.length) {
    for (const tc of result.toolCalls) {
      parts.push({
        functionCall: { name: tc.toolName, args: normalizeFunctionCallArgs(tc.input as Record<string, unknown>) },
      });
    }
  }
  if (reasoning && result.toolCalls?.length) {
    options.onReasoningWithToolCall?.(reasoning);
  }
  if (parts.length === 0) {
    parts.push({ text: '' });
  }

  const response = {
    candidates: [{
      content: { role: 'model', parts },
      finishReason: mapFinishReason(result.finishReason ?? ''),
    }],
    usageMetadata: {
      promptTokenCount: result.usage?.inputTokens || 0,
      candidatesTokenCount: result.usage?.outputTokens || 0,
      totalTokenCount: (result.usage?.inputTokens || 0) + (result.usage?.outputTokens || 0),
    },
    modelVersion: route.catalogId,
    responseId,
  };

  respondJson(res, 200, { response, traceId: 'relay-trace', metadata: {} });
}
