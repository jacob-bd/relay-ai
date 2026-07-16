// Local Responses API proxy for Codex (Tier 2 registry models).
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import type { LanguageModel } from 'ai';
import { readBody, extractApiKey, sendJson } from './http-utils.js';
import { routeLookupIds } from './context-model-id.js';
import {
  CODEX_APP_AUTO_COMPACT_RATIO,
  parseCodexAppModelSlug,
  codexAppModelSlug,
} from './codex/app-profile.js';
import { createLanguageModel, maxToolsForNpm, type VertexProviderConfig } from './provider-factory.js';
import { applyClaudeCodeOAuthIdentity } from './oauth/claude-code-identity.js';
import {
  translateResponsesRequest,
  streamResponsesResponse,
  generateResponsesResponse,
  writeResponsesErrorStream,
  writeResponsesRateLimitStream,
  responsesRateLimitBody,
  appendCompactionInstruction,
  streamCompactionResponse,
  generateCompactionResponse,
  type CodexSdkCallParams,
} from './codex-responses-adapter.js';
import { silenceSdkWarnings } from './sdk-adapter.js';
import { formatUpstreamError, upstreamHttpStatus } from './codex/upstream-error.js';
import { getCodexProxyDebugLogPath, makeTraceLogger, resetCodexBodyDumpLog, appendCodexBodyDump } from './trace-log.js';

/**
 * Pull the full `response` object out of a single SSE event chunk if it's the
 * terminal `response.completed` event. Each write()/sendWsEvent() call in the
 * streaming path carries exactly one complete "event: X\ndata: {...}\n\n" chunk
 * (see codex-responses-adapter.ts's `emit`/`sseChunk`), so no cross-call buffering
 * is needed here.
 */
function captureCompletedResponse(sseText: string): unknown | undefined {
  if (!sseText.includes('response.completed')) return undefined;
  const dataLine = sseText.split('\n').find(l => l.startsWith('data:'));
  if (!dataLine) return undefined;
  try {
    const obj = JSON.parse(dataLine.slice(5).trim()) as { type?: string; response?: unknown };
    if (obj && obj.type === 'response.completed') return obj.response;
  } catch {
    // ignore — not our event to parse
  }
  return undefined;
}

export function estimateCodexRequestChars(params: CodexSdkCallParams): number {
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
  const marker = `\n\n[... ${text.length} chars clipped from oversized context item ...]\n\n`;
  const edge = Math.max(1, Math.floor((maxChars - marker.length) / 2));
  return `${text.slice(0, edge)}${marker}${text.slice(-edge)}`;
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
  if (estimateCodexRequestChars(params) <= charLimit) return params;
  let messages = [...params.messages];
  while (messages.length > 1 && estimateCodexRequestChars({ ...params, messages }) > charLimit) {
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
  // compaction payload), don't drop messages further — but still clip oversized text
  // parts so an unbounded payload isn't sent upstream untouched.
  if (messages.length < 3 && params.messages.length >= 3) {
    return clipLargeTextParts(params, 12_000);
  }
  if (messages.length === 0) {
    messages = [{ role: 'user', content: [{ type: 'text', text: '' }] } as typeof messages[0]];
  }
  return { ...params, messages };
}

/** Prompt-based compaction (codex-rs templates/compact/prompt.md) opens with this
 *  sentence, sent as the final user message of the compaction turn. */
const COMPACTION_PROMPT_MARKER = 'You are performing a CONTEXT CHECKPOINT COMPACTION';

function inputItemText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map(p => (p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string' ? (p as { text: string }).text : ''))
    .join('');
}

/**
 * Codex marks compaction requests explicitly, so detect the markers instead of
 * guessing from size. Size heuristics misclassified large normal agentic turns
 * (observed live: a 29-message review turn with 131 tools crossed the old
 * bodyBytes threshold and had its tools stripped mid-task, priming the model
 * to free-run). Remote compaction v2 appends a `compaction_trigger` input item
 * — a request control that never appears in durable history; the older
 * prompt-based path sends the checkpoint prompt as the final user message.
 */
export function isLikelyCodexCompactionRequest(body: Record<string, unknown>): boolean {
  if (!Array.isArray(body.input)) return false;
  const items = body.input as Array<Record<string, unknown> | null>;
  if (items.some(item => item && typeof item === 'object' && item.type === 'compaction_trigger')) {
    return true;
  }
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (!item || typeof item !== 'object' || !('role' in item)) continue;
    // Only the LAST message counts — the marker quoted mid-history (e.g. in a
    // reviewed diff) must not classify a normal turn as compaction.
    return inputItemText(item.content).trimStart().startsWith(COMPACTION_PROMPT_MARKER);
  }
  return false;
}

/**
 * True only for remote compaction v2 (a `compaction_trigger` control item) — NOT the
 * v1 prompt-based path (which already works via a normal message reply) and NOT the
 * durable `compaction`/`context_compaction` history items that appear on every
 * post-compaction turn. v2 needs a synthesized single `compaction` output item
 * (see codex-responses-adapter's compaction path); the v1 path must stay untouched.
 */
export function isCodexV2CompactionRequest(body: Record<string, unknown>): boolean {
  if (!Array.isArray(body.input)) return false;
  return (body.input as Array<Record<string, unknown> | null>).some(
    item => item && typeof item === 'object' && item.type === 'compaction_trigger',
  );
}

/**
 * A compaction summary is a short paragraph, never a long document. Observed live:
 * grok-4.5 given a stripped-tools compaction request can free-run into a text
 * repetition loop (same ~200-char tail regenerated forever, no finish) instead of
 * producing a short summary and stopping. Capping output bounds that failure to a
 * fixed, short delay instead of an indefinite hang the user has to kill by hand.
 */
const COMPACTION_MAX_OUTPUT_TOKENS = 4_000;

export function protectCodexCompactionParams(
  body: Record<string, unknown>,
  params: CodexSdkCallParams,
  contextWindow: number,
): CodexSdkCallParams {
  if (!isLikelyCodexCompactionRequest(body)) {
    return trimToContextLimit(params, contextWindow);
  }
  const clipped = clipLargeTextParts(params, 12_000);
  const compactCharLimit = Math.floor(contextWindow * CODEX_APP_AUTO_COMPACT_RATIO) * 3;
  const trimmed = trimToContextLimit(clipped, contextWindow, compactCharLimit);
  // Codex's remote compaction v2 expects exactly one plain-text summary item back.
  // Leaving tools available invites an agentic model to keep calling them instead
  // of summarizing (e.g. resuming tool calls it had queued up before compaction
  // fired), which Codex rejects outright as a fatal error. Compaction never needs
  // tool access, so drop it entirely for this call.
  return {
    ...trimmed,
    tools: undefined,
    maxOutputTokens: trimmed.maxOutputTokens
      ? Math.min(trimmed.maxOutputTokens, COMPACTION_MAX_OUTPUT_TOKENS)
      : COMPACTION_MAX_OUTPUT_TOKENS,
  };
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
  providerData?: Record<string, unknown>;
  supportedParameters?: string[];
  reasoning?: boolean;
  interleavedReasoningField?: string;
  vertex?: VertexProviderConfig;
  contextWindow?: number;
  /** Static headers sent on every upstream request (e.g. a plan/auth-tracking header a custom endpoint requires). */
  headers?: Record<string, string>;
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
      providerId: route.providerId ?? route.modelId,
      authType: route.authType,
      oauthAccountId: route.oauthAccountId,
      providerData: route.providerData,
      vertex: route.vertex,
      headers: route.headers,
    }));
  }

  return new Promise((resolve, reject) => {
    const log = debug
      ? makeTraceLogger(getCodexProxyDebugLogPath())
      : () => {};
    if (debug) resetCodexBodyDumpLog();
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
          const tools = Array.isArray(body.tools) ? body.tools : [];
          const toolNames = tools.map((t: unknown) => (t && typeof t === 'object' && 'name' in t ? (t as { name: unknown }).name : '?')).join(',');
          log(`request: model=${String(body.model ?? '')} previous_response_id=${prevId ?? '(none)'} input_items=${inputItems} body_bytes=${rawBody.length} tools=[${toolNames || 'none'}]`);
          appendCodexBodyDump({
            ts: new Date().toISOString(),
            transport: 'http',
            direction: 'request',
            model: String(body.model ?? ''),
            previous_response_id: prevId,
            tools: body.tools,
            input: body.input,
          });
          const mcpTools = tools.filter((t: unknown) => t && typeof t === 'object' && 'name' in t && String((t as { name: unknown }).name).startsWith('mcp__'));
          for (const t of mcpTools) {
            const mt = t as { name: unknown; type?: unknown; description?: unknown; parameters?: unknown; tools?: unknown[] };
            const subTools = mt.type === 'namespace' && Array.isArray(mt.tools) ? ` subTools=[${mt.tools.length}]` : '';
            log(`  mcp-tool: name=${mt.name} type=${mt.type} desc=${JSON.stringify(String(mt.description ?? '')).slice(0, 120)}${subTools}`);
          }
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
          let params = applyClaudeCodeOAuthIdentity(route, translateResponsesRequest(
            body as unknown as import('./codex-responses-adapter.js').ResponsesRequest,
            route.npm,
            {
              providerId: route.providerId,
              apiBaseUrl: route.baseURL,
              supportedParameters: route.supportedParameters,
              reasoning: route.reasoning,
              interleavedReasoningField: route.interleavedReasoningField,
              upstreamModelId: route.upstreamModelId,
            },
            { maxTools: maxToolsForNpm(route.npm) },
          ));
          if (route.contextWindow && route.contextWindow > 0) {
            const before = params.messages.length;
            const estimatedChars = estimateCodexRequestChars(params);
            const compaction = isLikelyCodexCompactionRequest(body);
            if (debug) log(`context check: model=${route.modelId} window=${route.contextWindow} chars=${estimatedChars} compaction=${compaction ? 'yes' : 'no'} messages=${before}`);
            params = protectCodexCompactionParams(body, params, route.contextWindow);
            if (debug && params.messages.length < before) {
              log(`context trim: model=${route.modelId} window=${route.contextWindow} kept=${params.messages.length}/${before} messages`);
            }
          }
          // remote compaction v2: the trigger carries no prompt, so ask the model for a
          // summary and return it as the single `compaction` item Codex requires.
          const v2Compaction = isCodexV2CompactionRequest(body);
          if (v2Compaction) {
            params = appendCompactionInstruction(params);
            if (debug) log(`compaction v2: synthesizing single compaction item for model=${route.modelId}`);
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
            const write = (chunk: string) => {
              res.write(chunk);
              if (debug) {
                const completed = captureCompletedResponse(chunk);
                if (completed) {
                  appendCodexBodyDump({
                    ts: new Date().toISOString(),
                    transport: 'http',
                    direction: 'response',
                    model: route.modelId,
                    response: completed,
                  });
                }
              }
            };
            try {
              if (v2Compaction) {
                await streamCompactionResponse(languageModel, params, modelId, write);
              } else
              await streamResponsesResponse(languageModel, params, modelId, write, summary => {
                if (debug) {
                  const failure = `${summary.aborted ? ' aborted=yes' : ''}${summary.errorMessage ? ` error=${JSON.stringify(summary.errorMessage)}` : ''}`;
                  log(`response done: model=${route.modelId} reasoningChars=${summary.reasoningChars} textChars=${summary.textChars} toolCalls=${summary.toolCallCount} toolNames=[${summary.toolNames.join(',')}] loopDetected=${summary.loopDetected ?? 'no'} dsmlRecovered=${summary.dsmlToolCallsRecovered ?? 0}${failure} reasoningPreview=${JSON.stringify(summary.reasoningPreview)}`);
                }
              }, progress => {
                if (debug) {
                  log(`response progress: model=${route.modelId} elapsedMs=${progress.elapsedMs} reasoningChars=${progress.reasoningChars} textChars=${progress.textChars} toolCalls=${progress.toolCallCount} reasoningTail=${JSON.stringify(progress.reasoningTail)}`);
                }
              });
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
              const response = v2Compaction
                ? await generateCompactionResponse(languageModel, params, modelId)
                : await generateResponsesResponse(languageModel, params, modelId);
              if (debug) {
                appendCodexBodyDump({
                  ts: new Date().toISOString(),
                  transport: 'http',
                  direction: 'response',
                  model: route.modelId,
                  response,
                });
              }
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
    // Fully implement WS streaming: accept upgrade, read request frame, stream
    // response events as WS text frames, close cleanly.
    //
    // History: we previously rejected with 503 (older Codex fell back to HTTP POST),
    // then tried close-1013 (same reconnect noise in newer Codex). Neither stops the
    // "Stream error / Reconnecting 5/5" UI — the only fix is proper WS support.
    //
    // Slow model concern: Codex has a ~15s timeout on "time to first content" via WS.
    // For fast providers (Groq, Z.AI) this isn't an issue. For slow reasoning models,
    // the timeout may still trigger — but the agent loop recovers and the net latency
    // is the same as before (HTTP fallback also takes the full model time).

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

    function wsPingFrame(): Buffer {
      return Buffer.from([0x89, 0x00]); // ping, no payload
    }

    server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
      // Accept the WS upgrade and stream the response as WS text frames.
      // Rejecting (503) or immediately closing (1013) causes Codex App to show
      // "Stream error / Reconnecting 5/5" regardless — proper WS support avoids it.
      if (requireAuth) {
        const inboundKey = extractApiKey(req);
        if (!inboundKey || inboundKey !== PROXY_PLACEHOLDER_KEY) {
          socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
          socket.destroy();
          return;
        }
      }

      const clientKey = req.headers['sec-websocket-key'];
      if (!clientKey) {
        socket.write('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }

      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${wsAcceptKey(clientKey)}\r\n` +
        '\r\n',
      );

      let frameBuf = Buffer.alloc(0);
      let handled = false;
      // Set once the request body is parsed, below — sendWsEvent is defined before
      // that point but needs the model id for its own debug dump.
      let currentRequestModel = '';

      const closeSocket = () => {
        if (!socket.destroyed) { socket.write(wsCloseFrame()); socket.end(); }
      };

      const sendWsEvent = (sseChunk: string) => {
        if (socket.destroyed) return;
        if (debug) {
          const completed = captureCompletedResponse(sseChunk);
          if (completed) {
            appendCodexBodyDump({
              ts: new Date().toISOString(),
              transport: 'ws',
              direction: 'response',
              model: currentRequestModel,
              response: completed,
            });
          }
        }
        // SSE: "event: TYPE\ndata: {JSON}\n\n" → WS text frame: "{JSON}"
        for (const line of sseChunk.split('\n')) {
          if (line.startsWith('data: ')) {
            socket.write(wsEncodeTextFrame(line.slice(6)));
          }
        }
      };

      const onData = (chunk: Buffer) => {
        frameBuf = Buffer.concat([frameBuf, chunk]);
        if (handled) return;
        const frame = wsDecodeFrame(frameBuf);
        if (!frame) return;
        frameBuf = Buffer.alloc(0);
        handled = true;

        void (async () => {
          let body: Record<string, unknown>;
          try { body = JSON.parse(frame.text); } catch {
            if (debug) log(`WS Error: Invalid JSON body: rawBody=${JSON.stringify(frame.text.slice(0, 2000))}`);
            sendWsEvent(`event: error\ndata: ${JSON.stringify({ error: { message: 'Invalid JSON', type: 'invalid_request_error' } })}\n\n`);
            closeSocket(); return;
          }

          if (debug) {
            const prevId = body.previous_response_id ?? null;
            const inputItems = Array.isArray(body.input) ? body.input.length : (typeof body.input === 'string' ? 1 : 0);
            const tools = Array.isArray(body.tools) ? body.tools : [];
            const toolNames = tools.map((t: unknown) => (t && typeof t === 'object' && 'name' in t ? (t as { name: unknown }).name : '?')).join(',');
            log(`WS request: model=${String(body.model ?? '')} previous_response_id=${prevId ?? '(none)'} input_items=${inputItems} body_bytes=${frame.text.length} tools=[${toolNames || 'none'}]`);
            appendCodexBodyDump({
              ts: new Date().toISOString(),
              transport: 'ws',
              direction: 'request',
              model: String(body.model ?? ''),
              previous_response_id: prevId,
              tools: body.tools,
              input: body.input,
            });
          }

          const modelId = String(body.model ?? '');
          currentRequestModel = modelId;
          let resolved = resolveModel(routes, models, modelId);
          if (!resolved) {
            const fb = routes[0];
            const fbLm = fb ? models.get(fb.modelId) : undefined;
            if (fb && fbLm) {
              if (debug) log(`WS resolveModel fallback: requested="${modelId}" → ${fb.modelId}`);
              resolved = { route: fb, languageModel: fbLm };
            } else {
              if (debug) log(`WS resolveModel failed: requested="${modelId}" known=[${routes.map(r => r.modelId).join(', ')}]`);
              sendWsEvent(`event: error\ndata: ${JSON.stringify({ error: { message: `Unknown model: ${modelId}` } })}\n\n`); closeSocket(); return;
            }
          }

          const { route, languageModel } = resolved;
          try {
            let params = applyClaudeCodeOAuthIdentity(route, translateResponsesRequest(
              body as unknown as import('./codex-responses-adapter.js').ResponsesRequest,
              route.npm,
              {
                providerId: route.providerId,
                apiBaseUrl: route.baseURL,
                supportedParameters: route.supportedParameters,
                reasoning: route.reasoning,
                interleavedReasoningField: route.interleavedReasoningField,
                upstreamModelId: route.upstreamModelId,
              },
              { maxTools: maxToolsForNpm(route.npm) },
            ));
            if (route.contextWindow && route.contextWindow > 0) {
              const before = params.messages.length;
              const estimatedChars = estimateCodexRequestChars(params);
              const compaction = isLikelyCodexCompactionRequest(body);
              if (debug) log(`WS context check: model=${route.modelId} window=${route.contextWindow} chars=${estimatedChars} compaction=${compaction ? 'yes' : 'no'} messages=${before} tools=${params.tools ? Object.keys(params.tools).length : 0}`);
              params = protectCodexCompactionParams(body, params, route.contextWindow);
              if (debug && params.messages.length < before) {
                log(`WS context trim: model=${route.modelId} window=${route.contextWindow} kept=${params.messages.length}/${before} messages tools=${params.tools ? Object.keys(params.tools).length : 0}`);
              }
            }
            const v2Compaction = isCodexV2CompactionRequest(body);
            if (v2Compaction) {
              params = appendCompactionInstruction(params);
              if (debug) log(`WS compaction v2: synthesizing single compaction item for model=${route.modelId}`);
            }
            if (debug) {
              const effort = (body as { reasoning?: { effort?: string } }).reasoning?.effort;
              log(`WS model=${route.modelId} effort=${effort ?? '(none)'} providerOptions=${JSON.stringify(params.providerOptions)}`);
            }
            if (v2Compaction) {
              await streamCompactionResponse(languageModel, params, modelId, sendWsEvent);
            } else
            await streamResponsesResponse(languageModel, params, modelId, sendWsEvent, summary => {
              if (debug) {
                const failure = `${summary.aborted ? ' aborted=yes' : ''}${summary.errorMessage ? ` error=${JSON.stringify(summary.errorMessage)}` : ''}`;
                log(`WS response done: model=${route.modelId} reasoningChars=${summary.reasoningChars} textChars=${summary.textChars} toolCalls=${summary.toolCallCount} toolNames=[${summary.toolNames.join(',')}] loopDetected=${summary.loopDetected ?? 'no'} dsmlRecovered=${summary.dsmlToolCallsRecovered ?? 0}${failure} reasoningPreview=${JSON.stringify(summary.reasoningPreview)}`);
              }
            }, progress => {
              if (debug) {
                log(`WS response progress: model=${route.modelId} elapsedMs=${progress.elapsedMs} reasoningChars=${progress.reasoningChars} textChars=${progress.textChars} toolCalls=${progress.toolCallCount} reasoningTail=${JSON.stringify(progress.reasoningTail)}`);
              }
            });
          } catch (err) {
            const msg = formatUpstreamError(err);
            const status = upstreamHttpStatus(err, msg);
            if (debug) log(`WS sdk error: ${route.modelId}: ${msg}`);
            if (status === 429) {
              writeResponsesRateLimitStream(modelId, msg, sendWsEvent);
            } else {
              writeResponsesErrorStream(modelId, msg, sendWsEvent, status);
            }
          }
          closeSocket();
        })();
      };

      socket.on('error', () => socket.destroy());
      socket.on('data', onData);
      onData(head);
    });

    // Prevent Node's default 5s keepAlive timeout from closing idle connections
    // while a slow/reasoning model (Grok, o3, etc.) is thinking before first token.
    server.keepAliveTimeout = 0;
    server.headersTimeout = 0;

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
