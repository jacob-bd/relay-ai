import http from 'node:http';
import { streamText, generateText } from 'ai';
import { createLanguageModel, effortProviderOptions } from '../provider-factory.js';
import { silenceSdkWarnings } from '../sdk-adapter.js';
import { formatUpstreamError } from '../codex/upstream-error.js';
import { readBody } from '../http-utils.js';
import { translateRequest, type TranslateRequestOptions } from './request-adapter.js';
import { formatCloudCodeChunk, mapFinishReason } from './response-adapter.js';
import type { AntigravityRoute, CatalogFixture } from './types.js';
import {
  injectRelayModels,
  resolveRelayCatalogSlots,
  buildListModelConfigsResponse,
  buildListExperimentsResponse,
} from './catalog.js';
import loadCodeAssistFixture from './fixtures/loadCodeAssist.json' with { type: 'json' };
import catalogFixtureRaw from './fixtures/fetchAvailableModels.json' with { type: 'json' };

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
}

type HelperRoutePolicy = 'launch' | 'launch-or-active';

const HELPER_ROUTE_POLICIES = new Map<string, HelperRoutePolicy>([
  ['gemini-2.5-flash', 'launch-or-active'],
  ['gemini-2.5-flash-lite', 'launch'],
  ['gemini-3-flash-agent', 'launch'],
  ['gemini-3.1-flash-lite', 'launch'],
]);

const MAX_REASONING_ECHOES_PER_CONVERSATION = 20;

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

  const catalogFixture = catalogFixtureRaw as unknown as CatalogFixture;
  const injectedCatalog = injectRelayModels(catalogFixture, routes, templateKey);

  const selectedSlotRoutes = resolveRelayCatalogSlots(injectedCatalog, routes, templateKey);
  const selectedSlotIds = new Set<string>();
  const routeMap = new Map<string, AntigravityRoute>();
  const reasoningEchoesByConversation = new Map<string, string[]>();
  for (const { slotId, route } of selectedSlotRoutes) {
    selectedSlotIds.add(slotId);
    routeMap.set(slotId, route);
    routeMap.set(route.catalogId, route);
  }

  let activeRoute: AntigravityRoute | undefined;
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
    providerOptionsCache.set(route.catalogId, effortProviderOptions(route.npm, 'high', route.upstreamModelId));
  }


  // Pre-compute invariant endpoint responses (routes don't change after startup)
  const experimentsResponse = buildListExperimentsResponse();
  const modelConfigsResponse = buildListModelConfigsResponse(routes, injectedCatalog, templateKey);
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

      let parsed: Record<string, unknown> | undefined;
      try { parsed = JSON.parse(bodyStr) as Record<string, unknown>; } catch {}

      if (trace && parsed) {
        const preview = JSON.stringify(parsed).slice(0, 500);
        log(`[gateway]   body-preview: ${preview}`);
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
          if (trackActiveRoute && selectedSlotIds.has(model ?? '') && isUserTurnRequest(parsed)) {
            activeRoute = route;
            if (trace) log(`[gateway]   active route: ${route.catalogId} via ${model}`);
          }
          const providerOptions = providerOptionsCache.get(route.catalogId);
          const isStream = lowerUrl.includes('stream');
          const conversationKey = conversationKeyFromRequest(parsed);
          const requestOptions = reasoningEchoOptionsForRoute(route, parsed, reasoningEchoesByConversation);
          const rememberReasoning = (reasoning: string) => {
            if (!shouldEchoReasoningForRoute(route)) return;
            rememberReasoningEcho(reasoningEchoesByConversation, conversationKey, reasoning);
          };

          if (isStream) {
            handleStreamingRequest(res, route, providerOptions, parsed as any, log, {
              requestOptions,
              onReasoningWithToolCall: rememberReasoning,
            }).catch(err => {
              log(`[gateway] stream error: ${err instanceof Error ? err.stack || err.message : String(err)}`);
              if (!res.headersSent) {
                respondJson(res, 500, { error: { code: 500, message: formatUpstreamError(err) } });
              } else if (!res.writableEnded) {
                res.end();
              }
            });
          } else {
            handleUnaryRequest(res, route, providerOptions, parsed as any, log, {
              requestOptions,
              onReasoningWithToolCall: rememberReasoning,
            }).catch(err => {
              log(`[gateway] unary error: ${err instanceof Error ? err.stack || err.message : String(err)}`);
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
  return /deepseek/i.test(routeIdentity);
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

interface RequestHandlerOptions {
  requestOptions?: TranslateRequestOptions;
  onReasoningWithToolCall?: (reasoning: string) => void;
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

/**
 * Handle a streaming GenerateContent request.
 * Uses fullStream to support text deltas, tool call events, and finish.
 */
async function handleStreamingRequest(
  res: http.ServerResponse,
  route: AntigravityRoute,
  providerOptions: any,
  parsed: any,
  log: (msg: string) => void,
  options: RequestHandlerOptions = {},
): Promise<void> {
  const sdkParams = translateRequest(parsed, options.requestOptions);
  const langModel = await createLanguageModel({
    npm: route.npm,
    modelId: route.upstreamModelId,
    apiKey: route.apiKey,
    baseURL: route.baseURL,
    providerId: route.providerId,
    authType: route.authType,
    oauthAccountId: route.oauthAccountId,
  });
  const responseId = `relay-${Date.now()}`;

  const { fullStream } = streamText({
    model: langModel,
    system: sdkParams.system,
    messages: sdkParams.messages,
    tools: sdkParams.tools,
    toolChoice: sdkParams.toolChoice,
    providerOptions,
  });

  const startSse = () => {
    if (res.headersSent) return;
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'grpc-status': '0',
    });
  };

  const toolCallBuffers = new Map<string, { name: string; json: string }>();
  let responseReasoning = '';
  let sawToolCall = false;
  for await (const part of fullStream) {
    const p = part as any;

    if (p.type === 'reasoning-delta' || p.type === 'reasoning') {
      const reasoning = reasoningDeltaText(p);
      responseReasoning += reasoning;
      emitThinkingDelta(res, route, responseId, reasoning, startSse);
      continue;
    }

    if (p.type === 'text-delta') {
      const text = reasoningDeltaText(p);
      log(`[gateway] text-delta: ${JSON.stringify(text.slice(0, 500))}`);
      startSse();
      const chunk = formatCloudCodeChunk({
        text,
        modelVersion: route.catalogId,
        responseId,
      });
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
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
        functionCall: { name, args },
        modelVersion: route.catalogId,
        responseId,
      });
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    } else if (p.type === 'finish') {
      log(`[gateway] finish: ${p.finishReason ?? 'unknown'}`);
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
      emitStreamError(res, route, responseId, message, startSse);
      break;
    } else if (p.type === 'reasoning-start' || p.type === 'reasoning-end') {
      log(`[gateway] ${p.type}`);
    }
  }
  if (!res.headersSent) {
    throw new Error('Provider returned an empty stream');
  }
  if (sawToolCall && responseReasoning.trim()) {
    options.onReasoningWithToolCall?.(responseReasoning);
  }
  res.end();
}

/**
 * Handle a non-streaming (unary) GenerateContent request.
 */
async function handleUnaryRequest(
  res: http.ServerResponse,
  route: AntigravityRoute,
  providerOptions: any,
  parsed: any,
  _log: (msg: string) => void,
  options: RequestHandlerOptions = {},
): Promise<void> {
  const sdkParams = translateRequest(parsed, options.requestOptions);
  const langModel = await createLanguageModel({
    npm: route.npm,
    modelId: route.upstreamModelId,
    apiKey: route.apiKey,
    baseURL: route.baseURL,
    providerId: route.providerId,
    authType: route.authType,
    oauthAccountId: route.oauthAccountId,
  });
  const responseId = `relay-${Date.now()}`;

  const result = await generateText({
    model: langModel,
    system: sdkParams.system,
    messages: sdkParams.messages,
    tools: sdkParams.tools,
    toolChoice: sdkParams.toolChoice,
    providerOptions,
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
        functionCall: { name: tc.toolName, args: (tc as any).args },
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
