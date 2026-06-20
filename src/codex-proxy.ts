// Local Responses API proxy for Codex (Tier 2 registry models).
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { LanguageModel } from 'ai';
import { readBody, extractApiKey, sendJson } from './http-utils.js';
import { routeLookupIds } from './context-model-id.js';
import { parseCodexAppModelSlug, codexAppModelSlug } from './codex/app-profile.js';
import { createLanguageModel, type VertexProviderConfig } from './provider-factory.js';
import {
  translateResponsesRequest,
  streamResponsesResponse,
  generateResponsesResponse,
  writeResponsesErrorStream,
} from './codex-responses-adapter.js';
import { silenceSdkWarnings } from './sdk-adapter.js';
import { formatUpstreamError } from './codex/upstream-error.js';
import { getCodexProxyDebugLogPath, makeTraceLogger } from './trace-log.js';

export interface CodexProxyRoute {
  modelId: string;
  npm: string;
  apiKey: string;
  baseURL?: string;
  upstreamModelId: string;
  providerId?: string;
  authType?: 'api' | 'oauth' | 'none';
  oauthAccountId?: string;
  supportedParameters?: string[];
  reasoning?: boolean;
  interleavedReasoningField?: string;
  vertex?: VertexProviderConfig;
}

export interface CodexProxyHandle {
  port: number;
  close: () => void;
}

const PROXY_PLACEHOLDER_KEY = 'proxy-local';

function codexRouteLookupIds(requestedModel: string): string[] {
  const ids = routeLookupIds(requestedModel);
  const bare = parseCodexAppModelSlug(requestedModel);
  if (bare !== requestedModel) {
    ids.push(bare, ...routeLookupIds(bare));
  }
  const slash = requestedModel.indexOf('/');
  if (slash >= 0) {
    const afterProvider = requestedModel.slice(slash + 1);
    ids.push(afterProvider, ...routeLookupIds(afterProvider));
  }
  const doubleUnderscore = requestedModel.indexOf('__');
  if (doubleUnderscore >= 0) {
    const afterProvider = requestedModel.slice(doubleUnderscore + 2);
    ids.push(afterProvider, ...routeLookupIds(afterProvider));
  }
  return [...new Set(ids)];
}

export function findCodexProxyRoute(
  routes: CodexProxyRoute[],
  requestedModel: string,
): CodexProxyRoute | undefined {
  const ids = codexRouteLookupIds(requestedModel);
  for (const id of ids) {
    const route = routes.find(r =>
      r.modelId === id || codexAppModelSlug(r.modelId) === id,
    );
    if (route) return route;
  }
  return undefined;
}

function upstreamHttpStatus(err: unknown, msg: string): number {
  if (err && typeof err === 'object' && 'statusCode' in err) {
    const code = (err as { statusCode?: number }).statusCode;
    if (code === 400 || code === 401 || code === 403 || code === 404 || code === 429) return code;
  }
  if (msg.includes('HTTP 429') || msg.includes('429')) return 429;
  if (msg.includes('HTTP 400')) return 400;
  return 500;
}

function logUpstreamError(err: unknown, modelId?: string): void {
  const msg = formatUpstreamError(err);
  const prefix = modelId ? `[relay-ai codex-proxy] ${modelId}: ` : '[relay-ai codex-proxy] ';
  console.error(`${prefix}${msg}`);
}

function resolveModel(
  routes: CodexProxyRoute[],
  models: Map<string, LanguageModel>,
  requestedModel: string,
): { route: CodexProxyRoute; languageModel: LanguageModel } | undefined {
  const route = findCodexProxyRoute(routes, requestedModel);
  if (!route) return undefined;
  const languageModel = models.get(route.modelId);
  if (!languageModel) return undefined;
  return { route, languageModel };
}

export interface CodexProxyOptions {
  debug?: boolean;
  /** Default true. App mode passes false — GUI cannot inherit RELAY_AI_CODEX_KEY. */
  requireAuth?: boolean;
}

export async function startCodexProxy(
  routes: CodexProxyRoute[],
  options: CodexProxyOptions | boolean = {},
): Promise<CodexProxyHandle> {
  const opts: CodexProxyOptions = typeof options === 'boolean' ? { debug: options } : options;
  const debug = opts.debug ?? false;
  const requireAuth = opts.requireAuth ?? true;
  silenceSdkWarnings();

  const models = new Map<string, LanguageModel>();
  for (const route of routes) {
    models.set(route.modelId, await createLanguageModel({
      npm: route.npm,
      modelId: route.upstreamModelId,
      apiKey: route.apiKey,
      baseURL: route.baseURL,
      providerId: route.modelId,
      authType: route.authType,
      oauthAccountId: route.oauthAccountId,
      vertex: route.vertex,
    }));
  }

  return new Promise((resolve, reject) => {
    const log = debug
      ? makeTraceLogger(getCodexProxyDebugLogPath())
      : () => {};
    const onRejection = (reason: unknown) => {
      logUpstreamError(reason);
      if (debug) log(formatUpstreamError(reason));
    };
    process.on('unhandledRejection', onRejection);

    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const url = req.url ?? '/';

      if (debug) {
        log(`-> ${req.method} ${url} content-type=${req.headers['content-type'] ?? '(none)'} content-encoding=${req.headers['content-encoding'] ?? '(none)'} content-length=${req.headers['content-length'] ?? '(none)'}`);
      }

      if (!requireAuth && req.method === 'POST') {
        const origin = req.headers.origin;
        const referer = req.headers.referer;
        const isValidLoopback = (uStr?: string | string[]) => {
          if (!uStr) return true;
          try {
            const parsed = new URL(Array.isArray(uStr) ? uStr[0]! : uStr);
            const h = parsed.hostname;
            return h === '127.0.0.1' || h === 'localhost' || h === '::1';
          } catch {
            return false;
          }
        };
        if (!isValidLoopback(origin) || !isValidLoopback(referer)) {
          sendJson(res, 403, { error: { message: 'Forbidden origin', type: 'invalid_request_error' } });
          return;
        }
      }

      if (req.method === 'GET' && url === '/health') {
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === 'GET' && url === '/v1/models') {
        const data: Array<{ id: string; object: string; created: number; owned_by: string }> = [];
        const seenIds = new Set<string>();
        const addModel = (id: string, providerId?: string) => {
          if (seenIds.has(id)) return;
          seenIds.add(id);
          data.push({
            id,
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: providerId || 'relay-ai',
          });
        };

        for (const route of routes) {
          addModel(route.modelId, route.providerId);
          addModel(codexAppModelSlug(route.modelId), route.providerId);
          if (route.providerId) {
            addModel(`${route.providerId}__${route.modelId}`, route.providerId);
          }
        }

        sendJson(res, 200, {
          object: 'list',
          data,
        });
        return;
      }

      if (req.method === 'GET' && url.startsWith('/v1/models/')) {
        const id = url.slice('/v1/models/'.length);
        const route = findCodexProxyRoute(routes, id);
        if (!route) {
          sendJson(res, 404, { error: { message: `Model not found: ${id}`, type: 'invalid_request_error' } });
          return;
        }
        sendJson(res, 200, {
          id,
          object: 'model',
          created: Math.floor(Date.now() / 1000),
          owned_by: route.providerId || 'relay-ai',
        });
        return;
      }

      if (req.method === 'POST' && url === '/v1/responses') {
        if (requireAuth) {
          const inboundKey = extractApiKey(req);
          if (!inboundKey || inboundKey !== PROXY_PLACEHOLDER_KEY) {
            sendJson(res, 401, { error: { message: 'Unauthorized', type: 'invalid_api_key' } });
            return;
          }
        }

        let rawBody: string;
        try {
          rawBody = await readBody(req);
        } catch (err) {
          if (debug) {
            log(`Error: failed to read/decode request body on POST ${url}: ${formatUpstreamError(err)} content-encoding=${req.headers['content-encoding'] ?? '(none)'}`);
          }
          sendJson(res, 400, { error: { message: 'Invalid request body', type: 'invalid_request_error' } });
          return;
        }

        let body: Record<string, unknown>;
        try {
          body = JSON.parse(rawBody);
        } catch (err) {
          if (debug) {
            const headers = JSON.stringify(req.headers);
            log(`Error: Invalid JSON body on POST ${url}: ${formatUpstreamError(err)} headers=${headers} rawBody=${JSON.stringify(rawBody.slice(0, 2000))}`);
          }
          sendJson(res, 400, { error: { message: 'Invalid JSON body', type: 'invalid_request_error' } });
          return;
        }

        const modelId = String(body.model ?? '');
        const resolved = resolveModel(routes, models, modelId);
        if (!resolved) {
          sendJson(res, 404, { error: { message: `Unknown model: ${modelId}`, type: 'invalid_request_error' } });
          return;
        }

        const { route, languageModel } = resolved;

        try {
          const params = translateResponsesRequest(
            body as unknown as import('./codex-responses-adapter.js').ResponsesRequest,
            route.npm,
            {
              providerId: route.providerId,
              apiBaseUrl: route.baseURL,
              supportedParameters: route.supportedParameters,
              reasoning: route.reasoning,
              interleavedReasoningField: route.interleavedReasoningField,
            },
          );
          if (debug) {
            const effort = (body as { reasoning?: { effort?: string } }).reasoning?.effort;
            log(`model=${route.modelId} effort=${effort ?? '(none)'} providerOptions=${JSON.stringify(params.providerOptions)}`);
          }

          if (body.stream) {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
            });
            const write = (chunk: string) => res.write(chunk);
            try {
              await streamResponsesResponse(languageModel, params, modelId, write);
            } catch (err) {
              const msg = formatUpstreamError(err);
              logUpstreamError(err, route.modelId);
              writeResponsesErrorStream(modelId, msg, write, upstreamHttpStatus(err, msg));
            }
            res.end();
          } else {
            try {
              const response = await generateResponsesResponse(languageModel, params, modelId);
              sendJson(res, 200, response);
            } catch (err) {
              const msg = formatUpstreamError(err);
              logUpstreamError(err, route.modelId);
              const status = upstreamHttpStatus(err, msg);
              sendJson(res, status, { error: { message: msg, type: status === 429 ? 'rate_limit_error' : 'api_error' } });
            }
          }
        } catch (err) {
          const msg = formatUpstreamError(err);
          log(`handler error: ${msg}`);
          sendJson(res, 500, { error: { message: msg, type: 'api_error' } });
        }
        return;
      }

      sendJson(res, 404, { error: { message: 'Not found', type: 'invalid_request_error' } });
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to bind codex proxy'));
        return;
      }
      resolve({
        port: addr.port,
        close: () => {
          process.off('unhandledRejection', onRejection);
          server.close();
        },
      });
    });
  });
}

export { PROXY_PLACEHOLDER_KEY };
