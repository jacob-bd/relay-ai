// Local Responses API proxy for Codex (Tier 2 registry models).
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
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
  writeResponsesRateLimitStream,
  responsesRateLimitBody,
  type CodexSdkCallParams,
} from './codex-responses-adapter.js';
import { silenceSdkWarnings } from './sdk-adapter.js';
import { formatUpstreamError } from './codex/upstream-error.js';
import { getCodexProxyDebugLogPath, makeTraceLogger } from './trace-log.js';

function estimateMessageChars(params: CodexSdkCallParams): number {
  let chars = (params.system ?? '').length;
  for (const msg of params.messages) {
    if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (!part || typeof part !== 'object') continue;
        const p = part as Record<string, unknown>;
        if (typeof p['text'] === 'string') {
          chars += p['text'].length;
        } else {
          chars += JSON.stringify(part).length;
        }
      }
    } else if (typeof msg.content === 'string') {
      chars += msg.content.length;
    }
  }
  return chars;
}

function clipTextForContext(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const edge = Math.floor(maxChars / 2);
  const omitted = text.length - (edge * 2);
  return `${text.slice(0, edge)}\n\n[... ${omitted} chars omitted from oversized context item ...]\n\n${text.slice(-edge)}`;
}

function clipLargeTextParts(params: CodexSdkCallParams, maxCharsPerPart: number): CodexSdkCallParams {
  const messages = params.messages.map(msg => {
    if (typeof msg.content === 'string') {
      return { ...msg, content: clipTextForContext(msg.content, maxCharsPerPart) };
    }
    if (!Array.isArray(msg.content)) return msg;
    return {
      ...msg,
      content: msg.content.map(part => {
        if (!part || typeof part !== 'object') return part;
        const p = part as Record<string, unknown>;
        if (typeof p.text !== 'string') return part;
        return { ...p, text: clipTextForContext(p.text, maxCharsPerPart) };
      }),
    };
  }) as CodexSdkCallParams['messages'];

  return {
    ...params,
    messages,
  };
}

function trimToContextLimit(params: CodexSdkCallParams, contextWindow: number, charLimit = Math.floor(contextWindow * 0.85) * 3): CodexSdkCallParams {
  if (estimateMessageChars(params) <= charLimit) return params;
  let messages = [...params.messages];
  while (messages.length > 1 && estimateMessageChars({ ...params, messages }) > charLimit) {
    messages = messages.slice(1);
    while (messages.length > 1 && messages[0]!.role !== 'user') {
      messages = messages.slice(1);
    }
  }
  // Drop orphaned tool-result messages whose tool_use was in a trimmed assistant message.
  // Any role:'tool' message before the first role:'assistant' is orphaned.
  const firstAssistant = messages.findIndex(m => m.role === 'assistant');
  if (firstAssistant > 0) {
    messages = messages.filter((m, i) => i >= firstAssistant || m.role !== 'tool');
  }
  // Safety floor: if trimming would gut the request to <3 messages from >=3 (e.g. a
  // compaction payload), skip and let the upstream API return a real error instead.
  if (messages.length < 3 && params.messages.length >= 3) {
    return params;
  }
  if (messages.length === 0) {
    messages = [{ role: 'user', content: [{ type: 'text', text: '' }] } as typeof messages[0]];
  }
  return { ...params, messages };
}

function isCompactionSizedRequest(body: Record<string, unknown>, params: CodexSdkCallParams, contextWindow: number): boolean {
  const inputItems = Array.isArray(body.input) ? body.input.length : (typeof body.input === 'string' ? 1 : 0);
  return inputItems > 200 && params.messages.length > 50 && estimateMessageChars(params) > contextWindow;
}

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
  contextWindow?: number;
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
      if (debug) log(`unhandled-rejection: ${formatUpstreamError(reason)}`);
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

        if (debug) {
          const prevId = body.previous_response_id ?? null;
          const inputItems = Array.isArray(body.input) ? body.input.length : (typeof body.input === 'string' ? 1 : 0);
          log(`request: model=${String(body.model ?? '')} previous_response_id=${prevId ?? '(none)'} input_items=${inputItems} body_bytes=${rawBody.length}`);
        }

        const modelId = String(body.model ?? '');
        let resolved = resolveModel(routes, models, modelId);
        if (!resolved) {
          const fallbackRoute = routes[0];
          const fallbackLm = fallbackRoute ? models.get(fallbackRoute.modelId) : undefined;
          if (fallbackRoute && fallbackLm) {
            if (debug) {
              log(`resolveModel fallback: requested="${modelId}" → ${fallbackRoute.modelId}`);
            }
            resolved = { route: fallbackRoute, languageModel: fallbackLm };
          } else {
            if (debug) {
              log(`resolveModel failed: requested="${modelId}" known=[${routes.map(r => r.modelId).join(', ')}]`);
            }
            sendJson(res, 404, { error: { message: `Unknown model: ${modelId}`, type: 'invalid_request_error' } });
            return;
          }
        }

        const { route, languageModel } = resolved;

        try {
          let params = translateResponsesRequest(
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
          if (route.contextWindow && route.contextWindow > 0) {
            const before = params.messages.length;
            let charLimit = Math.floor(route.contextWindow * 0.85) * 3;
            let estimatedChars = estimateMessageChars(params);
            if (debug) log(`context check: model=${route.modelId} window=${route.contextWindow} chars=${estimatedChars} limit=${charLimit} messages=${before}`);
            if (isCompactionSizedRequest(body, params, route.contextWindow)) {
              params = clipLargeTextParts(params, 12000);
              charLimit = route.contextWindow;
              estimatedChars = estimateMessageChars(params);
              if (debug) log(`context clip: model=${route.modelId} chars=${estimatedChars} limit=${charLimit} messages=${params.messages.length}`);
            }
            params = trimToContextLimit(params, route.contextWindow, charLimit);
            if (debug && params.messages.length < before) {
              log(`context trim: model=${route.modelId} window=${route.contextWindow} kept=${params.messages.length}/${before} messages`);
            }
          }
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
              const status = upstreamHttpStatus(err, msg);
              if (debug) log(`sdk error: ${route.modelId}: ${msg}`);
              if (status === 429) {
                writeResponsesRateLimitStream(modelId, msg, write);
              } else {
                writeResponsesErrorStream(modelId, msg, write, status);
              }
            }
            res.end();
          } else {
            try {
              const response = await generateResponsesResponse(languageModel, params, modelId);
              sendJson(res, 200, response);
            } catch (err) {
              const msg = formatUpstreamError(err);
              const status = upstreamHttpStatus(err, msg);
              if (debug) log(`sdk error: ${route.modelId}: ${msg}`);
              if (status === 429) {
                sendJson(res, 200, responsesRateLimitBody(modelId, msg));
              } else {
                sendJson(res, status, { error: { message: msg, type: 'api_error' } });
              }
            }
          }
        } catch (err) {
          const msg = formatUpstreamError(err);
          log(`handler error: ${msg}`);
          sendJson(res, 500, { error: { message: msg, type: 'api_error' } });
        }
        return;
      }

      if (req.method === 'GET' && url === '/v1/responses') {
        sendJson(res, 200, { object: 'list', data: [] });
        return;
      }

      sendJson(res, 404, { error: { message: 'Not found', type: 'invalid_request_error' } });
    });


    // ── WebSocket upgrade handler (/v1/responses) ──────────────────────────
    // Codex v2 compaction prefers a WebSocket connection. It sends one JSON
    // request frame and expects SSE-style response frames back over the socket.
    // We handle the handshake manually (node:crypto only — no ws dep) and reuse
    // the same route/translate/stream logic as the HTTP POST path.

    function wsAcceptKey(clientKey: string): string {
      return createHash('sha1')
        .update(clientKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64');
    }

    function wsDecodeFrame(buf: Buffer): { text: string; complete: boolean } | null {
      if (buf.length < 2) return null;
      const b0 = buf[0]!;
      const b1 = buf[1]!;
      const masked = (b1 & 0x80) !== 0;
      let payloadLen = b1 & 0x7f;
      let offset = 2;
      if (payloadLen === 126) {
        if (buf.length < 4) return null;
        payloadLen = buf.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (buf.length < 10) return null;
        payloadLen = Number(buf.readBigUInt64BE(2));
        offset = 10;
      }
      const maskLen = masked ? 4 : 0;
      if (buf.length < offset + maskLen + payloadLen) return null;
      const mask = masked ? buf.slice(offset, offset + 4) : null;
      offset += maskLen;
      const payload = Buffer.allocUnsafe(payloadLen);
      for (let i = 0; i < payloadLen; i++) {
        payload[i] = buf[offset + i]! ^ (mask ? mask[i % 4]! : 0);
      }
      const opcode = b0 & 0x0f;
      if (opcode !== 0x1) return null; // text frame only
      return { text: payload.toString('utf8'), complete: true };
    }

    function wsEncodeTextFrame(text: string): Buffer {
      const payload = Buffer.from(text, 'utf8');
      const len = payload.length;
      let header: Buffer;
      if (len < 126) {
        header = Buffer.from([0x81, len]);
      } else if (len < 65536) {
        header = Buffer.allocUnsafe(4);
        header[0] = 0x81; header[1] = 126;
        header.writeUInt16BE(len, 2);
      } else {
        header = Buffer.allocUnsafe(10);
        header[0] = 0x81; header[1] = 127;
        header.writeBigUInt64BE(BigInt(len), 2);
      }
      return Buffer.concat([header, payload]);
    }

    function wsCloseFrame(): Buffer {
      return Buffer.from([0x88, 0x00]); // close, no payload
    }

    server.on('upgrade', async (req: IncomingMessage, socket: Socket, head: Buffer) => {
      const upgradeUrl = req.url ?? '/';
      if (upgradeUrl !== '/v1/responses') {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }

      if (requireAuth) {
        const auth = req.headers['authorization'] ?? '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
        if (!token || token !== PROXY_PLACEHOLDER_KEY) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
      }

      const clientKey = req.headers['sec-websocket-key'];
      if (!clientKey || typeof clientKey !== 'string') {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
      }

      // Complete the WebSocket handshake (RFC 6455).
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${wsAcceptKey(clientKey)}\r\n` +
        '\r\n',
      );
      if (debug) log(`ws upgrade: /v1/responses`);

      // Accumulate incoming data until we have a complete text frame.
      let buf = head.length > 0 ? head : Buffer.alloc(0);
      let frameText: string | null = null;

      await new Promise<void>(resolveWs => {
        const onData = (chunk: Buffer) => {
          buf = Buffer.concat([buf, chunk]);
          const decoded = wsDecodeFrame(buf);
          if (!decoded) return; // need more data
          frameText = decoded.text;
          socket.off('data', onData);
          resolveWs();
        };
        socket.on('data', onData);
        socket.once('error', () => resolveWs());
        socket.once('close', () => resolveWs());
      });

      if (!frameText || socket.destroyed) return;

      let body: Record<string, unknown>;
      try {
        body = JSON.parse(frameText);
      } catch {
        socket.write(wsCloseFrame());
        socket.destroy();
        return;
      }

      if (debug) {
        const prevId = body['previous_response_id'] ?? null;
        const inputItems = Array.isArray(body['input']) ? body['input'].length : (typeof body['input'] === 'string' ? 1 : 0);
        log(`ws request: model=${String(body['model'] ?? '')} previous_response_id=${prevId ?? '(none)'} input_items=${inputItems}`);
      }

      const modelId = String(body['model'] ?? '');
      let resolved = resolveModel(routes, models, modelId);
      if (!resolved) {
        const fallbackRoute = routes[0];
        const fallbackLm = fallbackRoute ? models.get(fallbackRoute.modelId) : undefined;
        if (fallbackRoute && fallbackLm) {
          if (debug) log(`ws resolveModel fallback: requested="${modelId}" → ${fallbackRoute.modelId}`);
          resolved = { route: fallbackRoute, languageModel: fallbackLm };
        } else {
          socket.write(wsCloseFrame());
          socket.destroy();
          return;
        }
      }

      const { route, languageModel } = resolved;

      try {
        let params = translateResponsesRequest(
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
        if (route.contextWindow && route.contextWindow > 0) {
          const before = params.messages.length;
          let charLimit = Math.floor(route.contextWindow * 0.85) * 3;
          let estimatedChars = estimateMessageChars(params);
          if (debug) log(`ws context check: model=${route.modelId} window=${route.contextWindow} chars=${estimatedChars} limit=${charLimit} messages=${before}`);
          if (isCompactionSizedRequest(body, params, route.contextWindow)) {
            params = clipLargeTextParts(params, 12000);
            charLimit = route.contextWindow;
            estimatedChars = estimateMessageChars(params);
            if (debug) log(`ws context clip: model=${route.modelId} chars=${estimatedChars} limit=${charLimit} messages=${params.messages.length}`);
          }
          params = trimToContextLimit(params, route.contextWindow, charLimit);
          if (debug && params.messages.length < before) {
            log(`ws context trim: model=${route.modelId} window=${route.contextWindow} kept=${params.messages.length}/${before} messages`);
          }
        }
        if (debug) {
          const effort = (body as { reasoning?: { effort?: string } })['reasoning']?.effort;
          log(`ws model=${route.modelId} effort=${effort ?? '(none)'} providerOptions=${JSON.stringify(params.providerOptions)}`);
        }

        const write = (chunk: string) => {
          if (!socket.destroyed) socket.write(wsEncodeTextFrame(chunk));
        };
        try {
          await streamResponsesResponse(languageModel, params, modelId, write);
        } catch (err) {
          const msg = formatUpstreamError(err);
          const status = upstreamHttpStatus(err, msg);
          if (debug) log(`ws sdk error: ${route.modelId}: ${msg}`);
          if (status === 429) {
            writeResponsesRateLimitStream(modelId, msg, write);
          } else {
            writeResponsesErrorStream(modelId, msg, write, status);
          }
        }
      } catch (err) {
        if (debug) log(`ws handler error: ${formatUpstreamError(err)}`);
      }

      if (!socket.destroyed) {
        socket.write(wsCloseFrame());
        socket.end();
      }
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
