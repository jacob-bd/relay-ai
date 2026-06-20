// src/proxy.ts — Local Anthropic-to-OpenAI translation proxy
// Adapted from cucoleadan/opencode-cowork-proxy (MIT)
import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import { appendFileSync, openSync, writeSync, closeSync } from 'node:fs';
import { readBody, extractApiKey, sendJson } from './http-utils.js';
import { formatAnthropicModelEntry, formatAnthropicModelList } from './server/models.js';
import { claudeCodeClientModelId, routeLookupIds, stripOneMContextSuffix } from './context-model-id.js';
import { getProxyDebugLogPath, redactTraceLine, resetTraceLog } from './trace-log.js';
import { relayAnthropicMessages, UpstreamUnreachableError } from './upstream-forward.js';
import { createLanguageModel, isSdkMigratedNpm } from './provider-factory.js';
import { randomUUID } from 'node:crypto';
import {
  translateRequest as sdkTranslateRequest,
  streamAnthropicResponse,
  generateAnthropicResponse,
  silenceSdkWarnings,
} from './sdk-adapter.js';

type ProxyLog = (message: string | (() => string)) => void;

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
    error: { type: 'api_error', message },
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
 * apiKey: per-route key; must be non-empty — proxy returns 401 for routes with empty key
 */
export interface ProxyRoute {
  aliasId: string;
  realModelId: string;
  displayName: string;
  upstreamUrl: string;
  apiKey: string;
  modelFormat: 'anthropic' | 'openai';
  contextWindow?: number;
  npm?: string;      // OpenCode api.npm — when SDK-migrated, routes via the adapter
  baseURL?: string;  // base URL for openai-compatible / openrouter SDK providers
  providerId?: string;
  authType?: 'api' | 'oauth' | 'none';
  oauthAccountId?: string;
  supportedParameters?: string[];
  reasoning?: boolean;
  interleavedReasoningField?: string;
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

    // POST /v1/messages — the main translation path (Claude Code appends ?beta=true or similar)
    if (req.method === 'POST' && req.url?.startsWith('/v1/messages')) {
      const inboundKey = extractApiKey(req);
      if (inboundKey !== proxyToken) {
        anthropicError(res, 401, 'Invalid proxy token');
        return;
      }

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

      // Per-request route resolution: look up the alias, fall back to default
      const route = lookupRoute(byAlias, originalModel) ?? defaultRoute;
      const apiKey = route.apiKey;
      const upstreamUrl = route.upstreamUrl;

      plog(() =>
        `POST /v1/messages - alias=${originalModel} route=${route.realModelId} format=${route.modelFormat} key=${apiKey ? `len:${apiKey.length}` : 'MISSING'}`,
      );

      if (!apiKey) {
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
        plog(() => `anthropic-passthrough: model=${route.realModelId}, stream=${clientWantsStream}`);
        try {
          await relayAnthropicMessages(res, targetUrl, forwardBody, apiKey, clientWantsStream, inboundBeta);
        } catch (err) {
          const message = err instanceof UpstreamUnreachableError ? err.message : String(err);
          plog(() => `anthropic-passthrough error: ${message}`);
          anthropicError(res, 502, message);
        }
        return;
      }

      // ── SDK-backed providers (Vercel AI SDK) ────────────────────────
      // OpenCode-assigned npm packages route through the SDK, which owns wire
      // format, endpoint selection, and provider quirks.
      if (isSdkMigratedNpm(route.npm)) {
        const params = sdkTranslateRequest(anthropicBody, route.npm!, {
          openAiOAuth: route.npm === '@ai-sdk/openai' && route.authType === 'oauth',
          reasoningMetadata: {
            providerId: route.providerId,
            apiBaseUrl: route.baseURL,
            supportedParameters: route.supportedParameters,
            reasoning: route.reasoning,
            interleavedReasoningField: route.interleavedReasoningField,
          },
        });
        plog(() =>
          `sdk: npm=${route.npm} model=${route.realModelId}, stream=${clientWantsStream}, ` +
          `tools=${anthropicBody.tools?.length ?? 0}, msgs=${params.messages.length}`,
        );
        try {
          const model = await createLanguageModel({
            npm: route.npm!,
            modelId: route.realModelId,
            apiKey,
            baseURL: route.baseURL,
            providerId: route.aliasId,
            authType: route.authType,
            oauthAccountId: route.oauthAccountId,
          });
          if (clientWantsStream) {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
            });
            await streamAnthropicResponse(model, params, originalModel, (c) => res.write(c), plog);
            res.end();
          } else {
            const anthropicResponse = await generateAnthropicResponse(model, params, originalModel);
            sendJson(res, 200, anthropicResponse);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const body = err && typeof err === 'object' && 'responseBody' in err
            ? (err as { responseBody?: string }).responseBody
            : undefined;
          plog(() => `sdk error: ${message}${body ? ` — body: ${body}` : ''}`);
          if (!res.headersSent) {
            anthropicError(res, 502, message);
          } else {
            res.write(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: 'api_error', message } })}\n\n`);
            res.end();
          }
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
    supportedParameters?: string[];
    reasoning?: boolean;
    interleavedReasoningField?: string;
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
    modelFormat: 'openai',
    contextWindow,
    npm: sdk?.npm,
    baseURL: sdk?.baseURL,
    providerId: sdk?.providerId,
    authType: sdk?.authType,
    oauthAccountId: sdk?.oauthAccountId,
    supportedParameters: sdk?.supportedParameters,
    reasoning: sdk?.reasoning,
    interleavedReasoningField: sdk?.interleavedReasoningField,
  }], clientModelId, debug);
}
