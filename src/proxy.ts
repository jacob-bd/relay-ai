// src/proxy.ts — Local Anthropic-to-OpenAI translation proxy
// Adapted from cucoleadan/opencode-cowork-proxy (MIT)
import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import { appendFileSync, openSync, writeSync, closeSync } from 'node:fs';
import { readBody, extractApiKey, sendJson } from './http-utils.js';
import { formatAnthropicModelEntry, formatAnthropicModelList } from './server/models.js';
import { claudeCodeClientModelId, routeLookupIds, stripOneMContextSuffix } from './context-model-id.js';
import {
  getProxyDebugLogPath,
  INFERENCE_PROGRESS_INTERVAL_MS,
  redactTraceLine,
  resetTraceLog,
  writeInferenceResponseLifecycleLog,
  writeInferenceResponseErrorLog,
} from './trace-log.js';
import { fetchWithOAuthRetry, relayAnthropicMessages, UpstreamUnreachableError } from './upstream-forward.js';
import {
  CLAUDE_CODE_CLI_VERSION,
  injectClaudeCodeBillingSystemLine,
  injectClaudeIdentity,
  selectBetaFlags,
} from './oauth/claude-identity.js';
import { anthropicToCloudCode } from './antigravity/anthropic-to-cloudcode.js';
import { streamCloudCodeToAnthropic, collectCloudCodeToAnthropic } from './antigravity/cloudcode-to-anthropic.js';
import { createLanguageModel, isSdkMigratedNpm, maxToolsForNpm } from './provider-factory.js';
import { randomUUID } from 'node:crypto';
import {
  translateRequest as sdkTranslateRequest,
  streamAnthropicResponse,
  generateAnthropicResponse,
  silenceSdkWarnings,
} from './sdk-adapter.js';
import {
  anthropicErrorType,
  formatUpstreamError,
  sdkUpstreamErrorDetails,
  upstreamHttpStatus,
} from './codex/upstream-error.js';
import { anthropicMessagesEndpoint, estimateAnthropicInputTokens } from './anthropic-endpoints.js';

type ProxyLog = (message: string | (() => string)) => void;

function createTranslationLifecycle(
  logPath: string | undefined,
  requestId: string | undefined,
  modelId: string,
  provider: string,
) {
  if (!logPath || !requestId) return undefined;

  const startedAt = Date.now();
  let firstPartAt: number | undefined;
  let lastPartAt: number | undefined;
  let lastPartType: string | undefined;
  let lastOutputAt: number | undefined;
  let sdkParts = 0;
  let translatedBytes = 0;
  let translatedChunks = 0;
  let stopped = false;
  let dispatched = false;

  const write = (
    event: Parameters<typeof writeInferenceResponseLifecycleLog>[1]['event'],
    extra: Partial<Parameters<typeof writeInferenceResponseLifecycleLog>[1]> = {},
  ) => writeInferenceResponseLifecycleLog(logPath, {
    event,
    requestId,
    modelId,
    provider,
    route: 'translated',
    ...extra,
  });
  const snapshot = (now: number) => ({
    phase: !dispatched
      ? 'preparing_translation' as const
      : sdkParts === 0
        ? 'waiting_for_sdk' as const
        : 'translating' as const,
    durationMs: now - startedAt,
    sdkParts,
    ...(lastPartAt !== undefined ? { sdkIdleMs: now - lastPartAt } : {}),
    translatedBytes,
    translatedChunks,
    ...(lastOutputAt !== undefined ? { outputIdleMs: now - lastOutputAt } : {}),
    ...(lastPartType ? { lastPartType } : {}),
  });
  const timer = setInterval(() => {
    if (!stopped) write('translation_progress', snapshot(Date.now()));
  }, INFERENCE_PROGRESS_INTERVAL_MS);
  timer.unref();

  return {
    dispatched() {
      if (stopped || dispatched) return;
      dispatched = true;
      write('translation_dispatched', snapshot(Date.now()));
    },
    onPart(partType: string) {
      const now = Date.now();
      sdkParts += 1;
      lastPartAt = now;
      lastPartType = partType;
      if (firstPartAt === undefined) {
        firstPartAt = now;
        write('translation_started', {
          durationMs: now - startedAt,
          sdkParts,
          lastPartType,
        });
      }
    },
    onOutput(chunk: string) {
      translatedBytes += Buffer.byteLength(chunk);
      translatedChunks += 1;
      lastOutputAt = Date.now();
    },
    complete() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      write('translation_completed', snapshot(Date.now()));
    },
    cancel() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      write('translation_cancelled', snapshot(Date.now()));
    },
    fail(errorType: string) {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      write('translation_failed', { ...snapshot(Date.now()), errorType });
    },
  };
}

function appendSecureLog(logPath: string, line: string): void {
  const redacted = redactTraceLine(line);
  try {
    const fd = openSync(logPath, 'a', 0o600);
    try {
      writeSync(fd, `${new Date().toISOString()} ${redacted}\n`);
    } finally {
      closeSync(fd);
    }
  } catch {
    try {
      appendFileSync(logPath, `${new Date().toISOString()} ${redacted}\n`);
    } catch { /* ignore */ }
  }
}

function makeProxyLog(debug: boolean, logPath?: string): ProxyLog {
  if (!debug) return () => {};
  const path = logPath ?? getProxyDebugLogPath();
  resetTraceLog(path);
  return (message) => {
    const line = typeof message === 'function' ? message() : message;
    appendSecureLog(path, line);
  };
}

// ── HTTP server ─────────────────────────────────────────────────────

function anthropicError(res: ServerResponse, status: number, message: string) {
  sendJson(res, status, {
    type: 'error',
    error: { type: anthropicErrorType(status), message },
  });
}

export interface ProxyHandle {
  port: number;
  token: string;
  close: () => void;
}

/**
 * A single entry in a proxy catalog.
 * aliasId: the id advertised in /v1/models (must start with 'claude-' or 'anthropic-')
 * realModelId: the actual model id sent to the upstream provider
 * upstreamUrl: full chat-completions URL (openai) or base URL without /v1 (anthropic)
 * apiKey: per-route upstream key. SDK routes may intentionally be empty for
 * anonymous free providers; passthrough and Cloud Code routes still require it.
 */
export interface ProxyRoute {
  aliasId: string;
  realModelId: string;
  displayName: string;
  upstreamUrl: string;
  apiKey: string;
  modelFormat: 'anthropic' | 'openai' | 'cloud-code';
  contextWindow?: number;
  npm?: string;      // OpenCode api.npm — when SDK-migrated, routes via the adapter
  baseURL?: string;  // base URL for openai-compatible / openrouter SDK providers
  providerId?: string;
  authType?: 'api' | 'oauth' | 'none';
  oauthAccountId?: string;
  providerData?: Record<string, unknown>;
  /** Called once on upstream HTTP 401 to get a refreshed OAuth token. Retry happens only if token differs from current apiKey. */
  refreshToken?: () => Promise<string | null>;
  supportedParameters?: string[];
  reasoning?: boolean;
  interleavedReasoningField?: string;
  /** Backend capability: model requires the Responses-Lite request shape (x-openai-internal-codex-responses-lite). */
  useResponsesLite?: boolean;
  /** Backend capability: model must use the WebSocket Responses transport instead of HTTP. */
  preferWebSockets?: boolean;
  /** Static headers sent on every upstream request (e.g. a plan/auth-tracking header a custom endpoint requires). */
  headers?: Record<string, string>;
}

/**
 * Produce a gateway-discovery-safe alias for a model id.
 * Claude Code's gateway discovery only shows ids starting with 'claude' or 'anthropic'.
 * claude-* ids are returned unchanged; everything else gets an 'anthropic-{providerId}__' prefix.
 * Uses stable provider id (slug), not display name — renaming a provider does not break aliases.
 */
export function aliasModelId(realId: string, providerId: string): string {
  if (realId.startsWith('claude-')) return realId;
  const sanitized = providerId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `anthropic-${sanitized}__${realId}`;
}

/** Resolve catalog alias when Claude Code or legacy registry ids differ by prefix/suffix. */
function lookupRoute(byAlias: Map<string, ProxyRoute>, id: string): ProxyRoute | undefined {
  for (const key of routeLookupIds(id)) {
    const route = byAlias.get(key);
    if (route) return route;
  }
  return undefined;
}

/** Multi-model proxy: routes each request by body.model to the correct upstream. */
export function startProxyCatalog(
  routes: ProxyRoute[],
  defaultAliasId: string,
  debug = false,
  inferenceLogPath?: string,
): Promise<ProxyHandle> {
  const proxyToken = randomUUID();
  silenceSdkWarnings();

  if (routes.length === 0) {
    return Promise.reject(new Error('Proxy catalog requires at least one route'));
  }

  const byAlias = new Map(routes.map(r => [r.aliasId, r]));
  const defaultRoute = byAlias.get(defaultAliasId) ?? routes[0]!;

  const plog = makeProxyLog(debug);

  const onRejection = (reason: unknown) => {
    plog(() => `Unhandled Rejection: ${reason instanceof Error ? reason.stack || reason.message : String(reason)}`);
  };
  const onException = (error: Error) => {
    plog(() => `Uncaught Exception: ${error.stack || error.message}`);
  };
  process.on('unhandledRejection', onRejection);
  process.on('uncaughtException', onException);

  const modelsPayload = JSON.stringify(
    formatAnthropicModelList(
      routes.map(r => ({ id: r.aliasId, name: r.displayName, contextWindow: r.contextWindow })),
    ),
  );

  const server = createServer(async (req, res) => {
    plog(() => `${req.method} ${req.url}`);

    // HEAD / — health check ping from Claude Code
    if (req.method === 'HEAD') {
      res.writeHead(200);
      res.end();
      return;
    }

    // GET /v1/models — Claude Code validates the model on startup and populates /model picker
    if (req.method === 'GET' && req.url?.startsWith('/v1/models')) {
      const modelPathMatch = req.url.match(/^\/v1\/models\/([^?]+)/);
      if (modelPathMatch) {
        const id = decodeURIComponent(modelPathMatch[1]);
        const route = lookupRoute(byAlias, id);
        if (route) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(formatAnthropicModelEntry(route.aliasId, route.displayName, route.contextWindow)));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { type: 'not_found_error', message: `Model '${id}' not found` } }));
        }
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(modelsPayload);
      }
      return;
    }

    const messagesEndpoint = anthropicMessagesEndpoint(req.url);

    // Anthropic message creation and token counting are distinct endpoints.
    if (req.method === 'POST' && messagesEndpoint) {
      const inboundKey = extractApiKey(req);
      if (inboundKey !== proxyToken) {
        anthropicError(res, 401, 'Invalid proxy token');
        return;
      }

      const clientAbort = new AbortController();
      const abortForClientDisconnect = () => {
        if (!clientAbort.signal.aborted) clientAbort.abort(new Error('Client disconnected'));
      };
      req.once('aborted', abortForClientDisconnect);
      res.once('close', () => {
        if (!res.writableFinished) abortForClientDisconnect();
      });

      let anthropicBody: any;
      try {
        const raw = await readBody(req);
        anthropicBody = JSON.parse(raw);
      } catch {
        anthropicError(res, 400, 'Invalid JSON body');
        return;
      }

      const originalModel = anthropicBody.model;
      const clientWantsStream = Boolean(anthropicBody.stream);
      const relayRequestIdRaw = req.headers['x-relay-request-id'];
      const relayRequestId = Array.isArray(relayRequestIdRaw) ? relayRequestIdRaw[0] : relayRequestIdRaw;

      // Per-request route resolution: look up the alias, fall back to default
      const route = lookupRoute(byAlias, originalModel) ?? defaultRoute;
      const apiKey = route.apiKey;
      const upstreamUrl = route.upstreamUrl;

      plog(() =>
        `POST /v1/messages - alias=${originalModel} route=${route.realModelId} format=${route.modelFormat} key=${apiKey ? `len:${apiKey.length}` : 'MISSING'}`,
      );

      const usesSdkAdapter = isSdkMigratedNpm(route.npm);

      if (messagesEndpoint === 'count_tokens') {
        if (route.modelFormat !== 'anthropic') {
          const inputTokens = estimateAnthropicInputTokens(anthropicBody);
          plog(() => `token-count: local estimate model=${originalModel} input_tokens=${inputTokens}`);
          res.setHeader('x-relay-token-count-source', 'local-estimate');
          sendJson(res, 200, { input_tokens: inputTokens });
          return;
        }

        if (!apiKey) {
          anthropicError(res, 401, 'Missing API key');
          return;
        }

        const betaHeaderRaw = req.headers['anthropic-beta'];
        const inboundBeta = Array.isArray(betaHeaderRaw) ? betaHeaderRaw.join(',') : betaHeaderRaw;
        const forwardBody = { ...anthropicBody, model: route.realModelId };
        const targetUrl = `${upstreamUrl}/v1/messages/count_tokens`;
        const isOAuth = route.authType === 'oauth';
        try {
          await relayAnthropicMessages(res, targetUrl, forwardBody, apiKey, false, {
            inboundBeta,
            authType: isOAuth ? 'oauth' : 'api',
            log: message => plog(message),
            extraHeaders: route.headers,
            refreshToken: route.refreshToken,
            onTokenRefreshed: refreshed => { route.apiKey = refreshed; },
            signal: clientAbort.signal,
          });
        } catch (err) {
          if (clientAbort.signal.aborted) return;
          const message = err instanceof UpstreamUnreachableError ? err.message : String(err);
          plog(() => `anthropic token-count error: ${message}`);
          anthropicError(res, 502, message);
        }
        return;
      }

      if (!apiKey && !usesSdkAdapter) {
        anthropicError(res, 401, 'Missing API key');
        return;
      }

      // ── Anthropic passthrough ───────────────────────────────────────
      // Forward raw Anthropic body (with real model id) directly to the upstream.
      // No translation needed — the upstream speaks Anthropic natively.
      if (route.modelFormat === 'anthropic') {
        const betaHeaderRaw = req.headers['anthropic-beta'];
        const inboundBeta = Array.isArray(betaHeaderRaw) ? betaHeaderRaw.join(',') : betaHeaderRaw;
        const forwardBody = { ...anthropicBody, model: route.realModelId };
        const targetUrl = `${upstreamUrl}/v1/messages`;
        const isOAuth = route.authType === 'oauth';

        let effectiveBeta = inboundBeta;
        let claudeCodeSessionId: string | undefined;
        if (isOAuth) {
          // Identity injection and beta selection for Claude Code OAuth.
          const seed = route.providerId ?? route.realModelId;
          const identity = injectClaudeIdentity(forwardBody, route.providerData, seed);
          if (route.providerId === 'claude-code') injectClaudeCodeBillingSystemLine(forwardBody);
          claudeCodeSessionId = identity.sessionId;
          effectiveBeta = selectBetaFlags(forwardBody, route.realModelId, inboundBeta);
          plog(() => `anthropic-oauth: model=${route.realModelId}, beta=${effectiveBeta}`);
          plog(() => `anthropic-oauth headers: user-agent=claude-cli/${CLAUDE_CODE_CLI_VERSION} x-app=cli session-header=${claudeCodeSessionId ? 'set' : 'missing'}`);
        } else {
          plog(() => `anthropic-passthrough: model=${route.realModelId}, stream=${clientWantsStream}`);
        }

        try {
          await relayAnthropicMessages(res, targetUrl, forwardBody, apiKey, clientWantsStream, {
            inboundBeta: effectiveBeta,
            authType: isOAuth ? 'oauth' : 'api',
            log: message => plog(message),
            claudeCodeSessionId,
            extraHeaders: route.headers,
            refreshToken: route.refreshToken,
            onTokenRefreshed: refreshed => { route.apiKey = refreshed; },
            signal: clientAbort.signal,
            onUpstreamError: inferenceLogPath
              ? (statusCode, errorContent) => writeInferenceResponseErrorLog(inferenceLogPath, {
                  modelId: originalModel,
                  provider: route.providerId ?? route.aliasId.split(':')[1] ?? 'unknown',
                  route: 'passthrough',
                  statusCode,
                  errorContent,
                })
              : undefined,
          });
        } catch (err) {
          if (clientAbort.signal.aborted) return;
          const message = err instanceof UpstreamUnreachableError ? err.message : String(err);
          plog(() => `anthropic-passthrough error: ${message}`);
          anthropicError(res, 502, message);
        }
        return;
      }

      // ── SDK-backed providers (Vercel AI SDK) ────────────────────────
      // OpenCode-assigned npm packages route through the SDK, which owns wire
      // format, endpoint selection, and provider quirks.
      if (usesSdkAdapter) {
        const openAiOAuth = route.npm === '@ai-sdk/openai' && route.authType === 'oauth';
        const translationLifecycle = createTranslationLifecycle(
          inferenceLogPath,
          relayRequestId,
          originalModel,
          route.providerId ?? route.aliasId.split(':')[1] ?? 'unknown',
        );
        try {
          const params = sdkTranslateRequest(anthropicBody, route.npm!, {
            openAiOAuth,
            maxTools: maxToolsForNpm(route.npm),
            reasoningMetadata: {
              providerId: route.providerId,
              apiBaseUrl: route.baseURL,
              supportedParameters: route.supportedParameters,
              reasoning: route.reasoning,
              interleavedReasoningField: route.interleavedReasoningField,
              upstreamModelId: route.realModelId,
            },
          });
          plog(() =>
            `sdk: npm=${route.npm} model=${route.realModelId}, stream=${clientWantsStream}, ` +
            `tools=${anthropicBody.tools?.length ?? 0}, msgs=${params.messages.length}`,
          );
          const model = await createLanguageModel({
            npm: route.npm!,
            modelId: route.realModelId,
            apiKey,
            baseURL: route.baseURL,
            providerId: route.providerId ?? route.aliasId,
            authType: route.authType,
            oauthAccountId: route.oauthAccountId,
            providerData: route.providerData,
            headers: route.headers,
            useResponsesLite: route.useResponsesLite,
            preferWebSockets: route.preferWebSockets,
            onDebug: (msg: string) => plog(() => msg),
          });
          translationLifecycle?.dispatched();
          if (clientWantsStream) {
            const writeStreamChunk = (chunk: string) => {
              translationLifecycle?.onOutput(chunk);
              if (!res.headersSent) {
                res.writeHead(200, {
                  'Content-Type': 'text/event-stream',
                  'Cache-Control': 'no-cache',
                  'Connection': 'keep-alive',
                });
              }
              res.write(chunk);
            };
            await streamAnthropicResponse(
              model,
              params,
              originalModel,
              writeStreamChunk,
              plog,
              {
                onPart: partType => translationLifecycle?.onPart(partType),
                initialInputTokens: estimateAnthropicInputTokens(anthropicBody),
                abortSignal: clientAbort.signal,
              },
            );
            translationLifecycle?.complete();
            if (!res.headersSent) writeStreamChunk('');
            res.end();
          } else {
            // ChatGPT's Codex backend (OpenAI OAuth) rejects non-streaming requests
            // outright ("Stream must be set to true"), so always stream internally
            // for it and collect the result, regardless of what the client asked for.
            const anthropicResponse = await generateAnthropicResponse(
              model,
              params,
              originalModel,
              {
                forceStream: openAiOAuth,
                abortSignal: clientAbort.signal,
                onPart: partType => translationLifecycle?.onPart(partType),
              },
            );
            translationLifecycle?.onOutput(JSON.stringify(anthropicResponse));
            translationLifecycle?.complete();
            sendJson(res, 200, anthropicResponse);
          }
        } catch (err) {
          if (clientAbort.signal.aborted) {
            translationLifecycle?.cancel();
            return;
          }
          translationLifecycle?.fail(err instanceof Error ? err.name : 'UpstreamError');
          const message = formatUpstreamError(err);
          const details = sdkUpstreamErrorDetails(err);
          const upstreamStatus = details?.statusCode ?? upstreamHttpStatus(err, message);
          plog(() => `sdk error: ${message}${details?.errorContent ? ` — body: ${details.errorContent}` : ''}`);
          if (inferenceLogPath && upstreamStatus >= 400) {
            writeInferenceResponseErrorLog(inferenceLogPath, {
              ...(relayRequestId ? { requestId: relayRequestId } : {}),
              modelId: originalModel,
              provider: route.providerId ?? route.aliasId.split(':')[1] ?? 'unknown',
              route: 'translated',
              statusCode: upstreamStatus,
              errorContent: details?.errorContent ?? message,
              isRetryable: details?.isRetryable,
              attemptCount: details?.attemptCount,
            });
          }
          if (!res.headersSent) {
            anthropicError(res, upstreamStatus === 500 ? 502 : upstreamStatus, message);
          } else {
            const errorType = anthropicErrorType(upstreamStatus);
            res.write(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: errorType, message } })}\n\n`);
            res.end();
          }
        }
        return;
      }

      // ── Cloud Code Assist (Antigravity OAuth) ───────────────────────
      if (route.modelFormat === 'cloud-code') {
        const projectId = (route.providerData?.projectId as string | undefined) ?? '';
        if (!projectId) {
          anthropicError(res, 500, 'Antigravity provider missing projectId — re-authenticate with relay-ai providers auth antigravity');
          return;
        }
        const envelope = anthropicToCloudCode(anthropicBody, route.realModelId, projectId);
        const cloudContents = (envelope.request.contents as Array<{ role?: string; parts?: unknown[] }> | undefined) ?? [];
        const cloudToolResults = cloudContents.reduce((count, msg) => (
          count + ((msg.parts ?? []) as Array<Record<string, unknown>>).filter(p => p.functionResponse).length
        ), 0);
        const cloudToolCalls = cloudContents.reduce((count, msg) => (
          count + ((msg.parts ?? []) as Array<Record<string, unknown>>).filter(p => p.functionCall).length
        ), 0);
        const cloudTools = (envelope.request.tools as unknown[] | undefined)?.length ?? 0;
        const cloudMaxOutput = (envelope.request.generationConfig as Record<string, unknown> | undefined)?.maxOutputTokens;
        const baseUrl = upstreamUrl.replace(/\/+$/, '');
        const cloudCodeUrl = `${baseUrl}/v1internal:streamGenerateContent?alt=sse`;
        plog(() => `cloud-code: model=${route.realModelId}, project=${projectId.slice(0, 8)}… msgs=${cloudContents.length} toolCalls=${cloudToolCalls} toolResults=${cloudToolResults} tools=${cloudTools} maxOutput=${cloudMaxOutput ?? 'unset'} stream=${clientWantsStream}`);
        const fetchCloudCode = (token: string) =>
          fetch(cloudCodeUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
              'User-Agent': 'vscode/1.X.X (Antigravity/4.2.0)',
            },
            body: JSON.stringify(envelope),
            signal: clientAbort.signal,
          });

        try {
          const retryResult = await fetchWithOAuthRetry(apiKey, fetchCloudCode, route.refreshToken);
          const upstream = retryResult.response;
          if (retryResult.refreshed) route.apiKey = retryResult.apiKey;

          if (!upstream.ok) {
            const errBody = await upstream.text();
            plog(() => `cloud-code error ${upstream.status}: ${errBody}`);
            anthropicError(res, upstream.status >= 500 ? 502 : upstream.status, errBody);
            return;
          }
          if (clientWantsStream) {
            await streamCloudCodeToAnthropic(res, upstream, route.realModelId, plog);
          } else {
            const response = await collectCloudCodeToAnthropic(upstream, route.realModelId, plog);
            sendJson(res, 200, response);
          }
        } catch (err) {
          if (clientAbort.signal.aborted) return;
          const message = err instanceof Error ? err.message : String(err);
          plog(() => `cloud-code fetch error: ${message}`);
          if (!res.headersSent) anthropicError(res, 502, message);
          else res.end();
        }
        return;
      }

      // Non-anthropic route without a registered SDK npm — misconfigured route.
      anthropicError(res, 500, `No SDK provider configured for model ${originalModel} (npm=${route.npm ?? 'none'})`);
      return;
    }

    // Everything else → 404
    anthropicError(res, 404, `Unknown endpoint: ${req.method} ${req.url}`);
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to bind proxy'));
        return;
      }
      plog(() => `started on port ${addr.port}, catalog=${routes.length} model(s), default=${defaultRoute.aliasId}`);
      resolve({
        port: addr.port,
        token: proxyToken,
        close: () => {
          process.off('unhandledRejection', onRejection);
          process.off('uncaughtException', onException);
          server.close();
        },
      });
    });
  });
}

/** Single-model proxy — backward-compatible wrapper around startProxyCatalog. */
export function startProxy(
  completionsUrl: string,
  modelId: string,
  debug = false,
  contextWindow?: number,
  sdk?: {
    npm?: string;
    baseURL?: string;
    upstreamModelId?: string;
    providerId?: string;
    authType?: 'api' | 'oauth' | 'none';
    oauthAccountId?: string;
    providerData?: Record<string, unknown>;
    modelFormat?: 'anthropic' | 'openai' | 'cloud-code';
    supportedParameters?: string[];
    reasoning?: boolean;
    interleavedReasoningField?: string;
    useResponsesLite?: boolean;
    preferWebSockets?: boolean;
  },
  apiKey?: string,
): Promise<ProxyHandle> {
  const bareModelId = stripOneMContextSuffix(modelId);
  const clientModelId = claudeCodeClientModelId(modelId, contextWindow);
  return startProxyCatalog([{
    aliasId: clientModelId,
    realModelId: sdk?.upstreamModelId ?? bareModelId,
    displayName: bareModelId,
    upstreamUrl: completionsUrl,
    apiKey: apiKey ?? '',
    modelFormat: sdk?.modelFormat ?? 'openai',
    contextWindow,
    npm: sdk?.npm,
    baseURL: sdk?.baseURL,
    providerId: sdk?.providerId,
    authType: sdk?.authType,
    oauthAccountId: sdk?.oauthAccountId,
    providerData: sdk?.providerData,
    supportedParameters: sdk?.supportedParameters,
    reasoning: sdk?.reasoning,
    interleavedReasoningField: sdk?.interleavedReasoningField,
    useResponsesLite: sdk?.useResponsesLite,
    preferWebSockets: sdk?.preferWebSockets,
  }], clientModelId, debug);
}
