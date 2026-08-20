// Local Responses API proxy for Codex (Tier 2 registry models).
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { WebSocket } from 'ws';
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
import { classifyCodexDispatch, parseMixedProxyPath } from './codex/routing.js';
import { forwardNativeCodexHttp, allowlistedNativeHeaders, nativeResponsesWebSocketOptions, prepareNativeCodexBody, NATIVE_CODEX_RESPONSES_URL } from './codex/native-forward.js';
import {
  createNativePayloadRelay,
  resolveRoutedCollaborationInput,
  stripCodexCollaborationTools,
} from './codex/collaboration-payload.js';
import { appendCodexRouteAudit } from './codex/route-audit.js';

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
  /** Provider-facing model id recorded in the metadata-only route audit. */
  auditUpstreamModelId?: string;
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
  /** Refresh an OAuth access token after one upstream 401. */
  refreshToken?: () => Promise<string | null>;
}

export interface CodexProxyHandle {
  port: number;
  close: () => void;
}

const PROXY_PLACEHOLDER_KEY = 'proxy-local';
export const MAX_CODEX_REQUEST_BYTES = 4 * 1024 * 1024;

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
  const bareRequestedModel = parseCodexAppModelSlug(requestedModel);
  const providerSeparator = bareRequestedModel.indexOf('__');
  if (providerSeparator > 0) {
    const requestedProvider = bareRequestedModel.slice(0, providerSeparator);
    const requestedIds = codexRouteLookupIds(bareRequestedModel.slice(providerSeparator + 2));
    const providerRoute = routes.find(route => {
      if (route.providerId !== requestedProvider) return false;
      const routeIds = codexRouteLookupIds(route.modelId);
      return requestedIds.some(id => routeIds.includes(id));
    });
    if (providerRoute) return providerRoute;
  }

  const ids = codexRouteLookupIds(requestedModel);
  for (const id of ids) {
    const route = routes.find(r =>
      r.modelId === id || codexAppModelSlug(r.modelId) === id,
    );
    if (route) return route;
  }
  return undefined;
}

type CodexRequestHeaders = Record<string, string | string[] | undefined>;

function requestHeaderValue(headers: CodexRequestHeaders | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const key = Object.keys(headers).find(candidate => candidate.toLowerCase() === name);
  if (!key) return undefined;
  const value = headers[key];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Codex child sessions can arrive with the parent's native model id. The
 * marker is carried in client_metadata on current runtimes and in the
 * x-openai-subagent header on older/native transport variants.
 */
export function isCodexSubagentRequest(
  body: Record<string, unknown>,
  headers?: CodexRequestHeaders,
): boolean {
  const metadata = body.client_metadata;
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const record = metadata as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(record, 'x-openai-subagent')) return true;
    if (Object.prototype.hasOwnProperty.call(record, 'x_openai_subagent')) return true;
  }
  return requestHeaderValue(headers, 'x-openai-subagent') !== undefined;
}

/**
 * Resolve a marked Codex child to the launcher's one configured Sub-agent route.
 * The incoming child model never changes that explicit Relay choice. Unmarked
 * native parent requests never enter this path.
 */
export function resolveCodexSubagentRoute(
  routes: readonly CodexProxyRoute[],
  configuredModelId: string | undefined,
  body: Record<string, unknown>,
  headers?: CodexRequestHeaders,
): CodexProxyRoute | undefined {
  if (!isCodexSubagentRequest(body, headers)) return undefined;
  if (!configuredModelId) return undefined;
  return routes.find(route => route.modelId === configuredModelId);
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
  /** Metadata-only request routing receipt. Never records prompts, headers, tools, or credentials. */
  routeAuditPath?: string;
  mixedNative?: {
    nativeModelIds: ReadonlySet<string>;
    subagentRouteModelId?: string;
    nativeBaseUrl?: string;
    capability: string;
    nativePayloadRelayModel?: string;
    nativeFetchImpl?: typeof fetch;
  };
}

async function prepareExternalCodexBody(
  body: Record<string, unknown>,
  context: {
    relay: ReturnType<typeof createNativePayloadRelay> | undefined;
    mixedNative: CodexProxyOptions['mixedNative'];
    headers: CodexRequestHeaders;
  },
): Promise<Record<string, unknown>> {
  const externalBody = isCodexSubagentRequest(body, context.headers)
    ? stripCodexCollaborationTools(body)
    : body;
  if (!Array.isArray(externalBody.input)) return externalBody;
  const resolvedInput = await resolveRoutedCollaborationInput(
    externalBody.input as import('./codex-responses-adapter.js').ResponsesInputItem[],
    {
      relay: context.relay,
      native: {
        nativeBaseUrl: context.mixedNative?.nativeBaseUrl ?? 'https://chatgpt.com/backend-api/codex',
        nativeModelId: context.mixedNative?.nativePayloadRelayModel ?? 'gpt-5.5',
        headers: Object.fromEntries(Object.entries(context.headers).flatMap(([key, value]) => [
          [key, Array.isArray(value) ? value[0] : value ?? ''],
        ])),
      },
    },
  );
  return { ...externalBody, input: resolvedInput };
}

/**
 * Codex's developer context describes the host application, tools, and agent
 * role. External models must retain those operating instructions, but must not
 * infer from them that their own model is Codex, GPT, or OpenAI-hosted. Bind the
 * selected Relay route explicitly at the final provider boundary so this stays
 * correct for Gemini, Claude, OSS, and future dynamically discovered models.
 */
export function applyExternalCodexRuntimeIdentity(
  params: CodexSdkCallParams,
  route: Pick<CodexProxyRoute, 'modelId' | 'providerId' | 'upstreamModelId' | 'auditUpstreamModelId'>,
): CodexSdkCallParams {
  const selectedModel = route.auditUpstreamModelId ?? route.upstreamModelId ?? route.modelId;
  const provider = route.providerId ?? 'relay';
  const identity = [
    '<external-model-identity>',
    `The selected model for this turn is ${JSON.stringify(selectedModel)} through provider ${JSON.stringify(provider)}.`,
    'Codex is the host application and agent environment, not the model identity.',
    'Follow Codex host and tool instructions normally, but do not infer that you are an OpenAI or GPT model from host names, tool names, documentation, or conversation context.',
    'If asked what model you are, report the selected model and provider above; do not use self-identification as evidence of the network route.',
    '</external-model-identity>',
  ].join('\n');
  return {
    ...params,
    system: params.system?.trim() ? `${identity}\n\n${params.system}` : identity,
  };
}

export async function startCodexProxy(
  routes: CodexProxyRoute[],
  options: CodexProxyOptions | boolean = {},
): Promise<CodexProxyHandle> {
  const opts: CodexProxyOptions = typeof options === 'boolean' ? { debug: options } : options;
  const debug = opts.debug ?? false;
  const requireAuth = opts.requireAuth ?? true;
  const mixedNative = opts.mixedNative;
  const audit = (event: Parameters<typeof appendCodexRouteAudit>[1]) => {
    if (opts.routeAuditPath) appendCodexRouteAudit(opts.routeAuditPath, event);
  };
  const nativePayloadRelay = mixedNative ? createNativePayloadRelay({}) : undefined;
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
      refreshToken: route.refreshToken,
      onTokenRefreshed: refreshed => { route.apiKey = refreshed; },
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
      const parsedUrl = new URL(url, 'http://127.0.0.1');
      const mixedPath = mixedNative ? parseMixedProxyPath(parsedUrl.pathname, mixedNative.capability) : null;
      if (mixedNative && !mixedPath) {
        sendJson(res, 404, { error: { message: 'Not found', type: 'invalid_request_error' } });
        return;
      }
      if (mixedNative && mixedPath && mixedPath.suffix === '/health' && req.method === 'GET') {
        sendJson(res, 200, { ok: true });
        return;
      }
      const effectivePath = mixedPath?.suffix ?? url;

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

      if (req.method === 'GET' && effectivePath === '/health') {
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === 'GET' && effectivePath === '/v1/models') {
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

        if (mixedNative) {
          for (const nativeModelId of mixedNative.nativeModelIds) addModel(nativeModelId, 'openai');
        }

        sendJson(res, 200, {
          object: 'list',
          data,
        });
        return;
      }

      if (req.method === 'GET' && effectivePath.startsWith('/v1/models/')) {
        const id = effectivePath.slice('/v1/models/'.length);
        if (mixedNative && mixedNative.nativeModelIds.has(id)) {
          sendJson(res, 200, { id, object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'openai' });
          return;
        }
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

      if (req.method === 'POST' && effectivePath === '/v1/responses') {
        if (requireAuth && !mixedPath) {
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
        const markedSubagent = Boolean(mixedNative && isCodexSubagentRequest(body, req.headers));
        const subagentRoute = mixedNative && markedSubagent
          ? resolveCodexSubagentRoute(routes, mixedNative.subagentRouteModelId, body, req.headers)
          : undefined;
        if (debug && markedSubagent) {
          log(`subagent dispatch: requested=${modelId} route=${subagentRoute?.modelId ?? '(none)'}`);
        }
        if (mixedNative && markedSubagent && !subagentRoute) {
          audit({ transport: 'http', requestedModel: modelId, dispatch: 'relay-subagent', phase: 'complete', outcome: 'error', status: 503 });
          sendJson(res, 503, {
            error: {
              message: 'Codex marked this request as a Sub-agent, but no configured Codex Sub-agent route is available.',
              type: 'service_unavailable',
            },
          });
          return;
        }
        if (mixedNative) {
          if (!markedSubagent) {
            const dispatch = classifyCodexDispatch(modelId, routes, mixedNative.nativeModelIds);
            if (dispatch.kind === 'unknown') {
              audit({ transport: 'http', requestedModel: modelId, dispatch: 'unknown', phase: 'complete', outcome: 'error', status: 404 });
              sendJson(res, 404, { error: { message: `Unknown model: ${modelId}`, type: 'invalid_request_error' } });
              return;
            }
            if (dispatch.kind === 'native') {
              audit({
                transport: 'http', requestedModel: modelId, dispatch: 'native', phase: 'dispatch',
                provider: 'openai-native', routeModel: modelId, upstreamModel: modelId,
              });
              const controller = new AbortController();
              req.once('aborted', () => controller.abort());
              try {
                const nativeResponse = await forwardNativeCodexHttp({
                  body: rawBody,
                  inboundHeaders: req.headers,
                  nativeUrl: mixedNative.nativeBaseUrl
                    ? `${mixedNative.nativeBaseUrl.replace(/\/$/, '')}/responses`
                    : NATIVE_CODEX_RESPONSES_URL,
                  signal: controller.signal,
                  fetchImpl: mixedNative.nativeFetchImpl,
                });
                const contentType = nativeResponse.headers.get('content-type');
                res.writeHead(nativeResponse.status, contentType ? { 'content-type': contentType } : undefined);
                res.end(Buffer.from(await nativeResponse.arrayBuffer()));
                audit({
                  transport: 'http', requestedModel: modelId, dispatch: 'native', phase: 'complete',
                  provider: 'openai-native', routeModel: modelId, upstreamModel: modelId,
                  outcome: nativeResponse.ok ? 'ok' : 'error', status: nativeResponse.status,
                });
              } catch (err) {
                audit({
                  transport: 'http', requestedModel: modelId, dispatch: 'native', phase: 'complete',
                  provider: 'openai-native', routeModel: modelId, upstreamModel: modelId,
                  outcome: 'error', status: 'forward-failed',
                });
                if (!res.writableEnded) sendJson(res, 502, { error: { message: 'Native Codex request failed', type: 'upstream_error' } });
              }
              return;
            }
          }
        }
        let resolved = subagentRoute
          ? resolveModel(routes, models, subagentRoute.modelId)
          : resolveModel(routes, models, modelId);
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
        const relayDispatch = markedSubagent ? 'relay-subagent' as const : 'relay' as const;
        audit({
          transport: 'http', requestedModel: modelId, dispatch: relayDispatch, phase: 'dispatch',
          provider: route.providerId ?? 'relay', routeModel: route.modelId,
          upstreamModel: route.auditUpstreamModelId ?? route.upstreamModelId,
        });

        try {
          const routedBody = await prepareExternalCodexBody(body, {
            relay: nativePayloadRelay,
            mixedNative,
            headers: req.headers,
          });
          let params = applyClaudeCodeOAuthIdentity(route, applyExternalCodexRuntimeIdentity(translateResponsesRequest(
            routedBody as unknown as import('./codex-responses-adapter.js').ResponsesRequest,
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
          ), route));
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
              audit({
                transport: 'http', requestedModel: modelId, dispatch: relayDispatch, phase: 'complete',
                provider: route.providerId ?? 'relay', routeModel: route.modelId,
                upstreamModel: route.auditUpstreamModelId ?? route.upstreamModelId, outcome: 'ok', status: 200,
              });
            } catch (err) {
              const msg = formatUpstreamError(err);
              const status = upstreamHttpStatus(err, msg);
              audit({
                transport: 'http', requestedModel: modelId, dispatch: relayDispatch, phase: 'complete',
                provider: route.providerId ?? 'relay', routeModel: route.modelId,
                upstreamModel: route.auditUpstreamModelId ?? route.upstreamModelId, outcome: 'error', status,
              });
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
              audit({
                transport: 'http', requestedModel: modelId, dispatch: relayDispatch, phase: 'complete',
                provider: route.providerId ?? 'relay', routeModel: route.modelId,
                upstreamModel: route.auditUpstreamModelId ?? route.upstreamModelId, outcome: 'ok', status: 200,
              });
            } catch (err) {
              const msg = formatUpstreamError(err);
              const status = upstreamHttpStatus(err, msg);
              audit({
                transport: 'http', requestedModel: modelId, dispatch: relayDispatch, phase: 'complete',
                provider: route.providerId ?? 'relay', routeModel: route.modelId,
                upstreamModel: route.auditUpstreamModelId ?? route.upstreamModelId, outcome: 'error', status,
              });
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

    function wsDecodeFrame(buf: Buffer): { text: string; complete: boolean; opcode: number } | null {
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
        const declaredLength = buf.readBigUInt64BE(2);
        if (declaredLength > BigInt(MAX_CODEX_REQUEST_BYTES)) return { text: '', complete: true, opcode: -1 };
        payloadLen = Number(declaredLength);
        offset = 10;
      }
      if (payloadLen > MAX_CODEX_REQUEST_BYTES) return { text: '', complete: true, opcode: -1 };
      const maskLen = masked ? 4 : 0;
      if (buf.length < offset + maskLen + payloadLen) return null;
      const mask = masked ? buf.slice(offset, offset + 4) : null;
      offset += maskLen;
      const payload = Buffer.allocUnsafe(payloadLen);
      for (let i = 0; i < payloadLen; i++) {
        payload[i] = buf[offset + i]! ^ (mask ? mask[i % 4]! : 0);
      }
      const opcode = b0 & 0x0f;
      if (![0x1, 0x8, 0x9, 0xa].includes(opcode)) return { text: '', complete: true, opcode };
      return { text: payload.toString('utf8'), complete: true, opcode };
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

    function wsCloseFrame(code = 1000): Buffer {
      const payload = Buffer.alloc(2);
      payload.writeUInt16BE(code, 0);
      return Buffer.concat([Buffer.from([0x88, 0x02]), payload]);
    }

    function wsPingFrame(): Buffer {
      return Buffer.from([0x89, 0x00]); // ping, no payload
    }

    function wsPongFrame(payload = ''): Buffer {
      const bytes = Buffer.from(payload, 'utf8');
      if (bytes.length > 125) return Buffer.from([0x8a, 0x00]);
      return Buffer.concat([Buffer.from([0x8a, bytes.length]), bytes]);
    }

    server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
      if (mixedNative) {
        const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
        const mixedPath = parseMixedProxyPath(pathname, mixedNative.capability);
        if (!mixedPath || mixedPath.suffix !== '/v1/responses') {
          socket.write('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
          socket.destroy();
          return;
        }
      } else if (req.url !== '/v1/responses') {
        socket.write('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
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
      let externalActive = false;
      let nativeActive = false;
      let nativeUpstream: WebSocket | undefined;
      let socketClosing = false;
      // Set once the request body is parsed, below — sendWsEvent is defined before
      // that point but needs the model id for its own debug dump.
      let currentRequestModel = '';

      const closeSocket = (code = 1000) => {
        if (socketClosing || socket.destroyed) return;
        socketClosing = true;
        socket.write(wsCloseFrame(code));
        socket.end();
      };

      const sendWsEvent = (sseChunk: string) => {
        if (socketClosing || socket.destroyed) return;
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
        const frame = wsDecodeFrame(frameBuf);
        if (!frame) return;
        frameBuf = Buffer.alloc(0);
        if (frame.opcode === 0x9) {
          socket.write(wsPongFrame(frame.text));
          return;
        }
        if (frame.opcode === 0x8) {
          closeSocket();
          return;
        }
        if (frame.opcode === -1) {
          socket.write(wsCloseFrame(1009));
          socket.end();
          return;
        }
        if (frame.opcode !== 0x1) {
          socket.write(wsCloseFrame(1003));
          socket.end();
          return;
        }
        if (externalActive) {
          // The external SDK stream cannot safely multiplex turns. Closing with
          // policy violation makes the client fail closed instead of starting a
          // second provider request that could be retried or double-billed.
          closeSocket(1008);
          return;
        }

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
            const reasoning = body.reasoning && typeof body.reasoning === 'object'
              ? Object.keys(body.reasoning as Record<string, unknown>).join(',')
              : typeof body.reasoning;
            const clientMetadata = body.client_metadata && typeof body.client_metadata === 'object'
              ? Object.keys(body.client_metadata as Record<string, unknown>).join(',')
              : typeof body.client_metadata;
            log(`WS request shape: stream=${String(body.stream)} store=${String(body.store)} generate=${String(body.generate)} parallel_tool_calls=${String(body.parallel_tool_calls)} reasoning_keys=[${reasoning || 'none'}] include=${Array.isArray(body.include) ? body.include.join(',') : String(body.include)} client_metadata_keys=[${clientMetadata || 'none'}]`);
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
          const markedSubagent = Boolean(mixedNative && isCodexSubagentRequest(body, req.headers));
          const subagentRoute = mixedNative && markedSubagent
            ? resolveCodexSubagentRoute(routes, mixedNative.subagentRouteModelId, body, req.headers)
            : undefined;
          if (debug && markedSubagent) {
            log(`WS subagent dispatch: requested=${modelId} route=${subagentRoute?.modelId ?? '(none)'}`);
          }
          if (mixedNative && markedSubagent && !subagentRoute) {
            audit({ transport: 'ws', requestedModel: modelId, dispatch: 'relay-subagent', phase: 'complete', outcome: 'error', status: 503 });
            sendWsEvent(`event: error\ndata: ${JSON.stringify({ error: {
              message: 'Codex marked this request as a Sub-agent, but no configured Codex Sub-agent route is available.',
              type: 'service_unavailable',
            } })}\n\n`);
            closeSocket();
            return;
          }
          if (mixedNative) {
            if (!markedSubagent) {
              const dispatch = classifyCodexDispatch(modelId, routes, mixedNative.nativeModelIds);
              if (dispatch.kind === 'unknown') {
                audit({ transport: 'ws', requestedModel: modelId, dispatch: 'unknown', phase: 'complete', outcome: 'error', status: 404 });
                sendWsEvent(`event: error\ndata: ${JSON.stringify({ error: { message: `Unknown model: ${modelId}`, type: 'invalid_request_error' } })}\n\n`);
                closeSocket();
                return;
              }
              if (dispatch.kind === 'native') {
                audit({
                  transport: 'ws', requestedModel: modelId, dispatch: 'native', phase: 'dispatch',
                  provider: 'openai-native', routeModel: modelId, upstreamModel: modelId,
                });
                const nativeBody = prepareNativeCodexBody(body);
                if (debug && nativeBody !== body) {
                  log(`WS native history normalized: model=${modelId} converted Relay compaction for native verification`);
                }
                if (nativeActive && nativeUpstream) {
                  if (nativeUpstream.readyState === WebSocket.OPEN) {
                    if (debug) log(`WS native forwarding next turn: model=${modelId}`);
                    nativeUpstream.send(JSON.stringify({ type: 'response.create', ...nativeBody }));
                  } else if (debug) {
                    log(`WS native cannot forward next turn: upstream_state=${nativeUpstream.readyState}`);
                  }
                  return;
                }
                const wsTarget = mixedNative.nativeBaseUrl
                  ? `${mixedNative.nativeBaseUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:').replace(/\/$/, '')}/responses`
                  : undefined;
                const target = nativeResponsesWebSocketOptions({ headers: req.headers, wsUrl: wsTarget });
                let upstream: WebSocket | undefined;
                let nativeOpened = false;
                let nativeCompleted = false;
                let nativeFrameCount = 0;
                let finished = false;
                let connectTimer: NodeJS.Timeout | undefined;
                let firstFrameTimer: NodeJS.Timeout | undefined;
                const clearTimers = () => {
                  if (connectTimer) clearTimeout(connectTimer);
                  if (firstFrameTimer) clearTimeout(firstFrameTimer);
                };
                const sendNativeError = (message: string) => {
                  if (socket.destroyed) return;
                  socket.write(wsEncodeTextFrame(JSON.stringify({
                    type: 'error',
                    error: { type: 'upstream_error', message },
                  })));
                };
                const closeBoth = (message?: string, closeCode = 1011) => {
                  if (finished) return;
                  finished = true;
                  nativeActive = false;
                  if (nativeUpstream === upstream) nativeUpstream = undefined;
                  clearTimers();
                  if (debug && message) {
                    log(`WS native upstream failed: model=${modelId} opened=${nativeOpened} frames=${nativeFrameCount} message=${message}`);
                  }
                  if (message && !nativeCompleted) {
                    audit({
                      transport: 'ws', requestedModel: modelId, dispatch: 'native', phase: 'complete',
                      provider: 'openai-native', routeModel: modelId, upstreamModel: modelId,
                      outcome: 'error', status: 'upstream-failed',
                    });
                  }
                  if (message && !nativeCompleted) sendNativeError(message);
                  try { upstream?.close(); } catch { /* ignore */ }
                  closeSocket(closeCode);
                };
                try {
                  if (debug) {
                    log(`WS native connecting: model=${modelId} url=${target.url} headers=[${Object.keys(target.headers).join(',')}]`);
                  }
                  upstream = new WebSocket(target.url, { headers: target.headers });
                  nativeUpstream = upstream;
                  nativeActive = true;
                  connectTimer = setTimeout(() => closeBoth('Native Codex WebSocket connection timed out'), 15_000);
                  upstream.once('open', () => {
                    nativeOpened = true;
                    if (connectTimer) clearTimeout(connectTimer);
                    if (debug) log(`WS native upstream open: model=${modelId}`);
                    upstream?.send(JSON.stringify({ type: 'response.create', ...nativeBody }));
                    firstFrameTimer = setTimeout(() => closeBoth('Native Codex WebSocket response timed out'), 60_000);
                  });
                  upstream.once('unexpected-response', (_request, response) => {
                    if (debug) log(`WS native upstream HTTP rejection: model=${modelId} status=${response.statusCode}`);
                    response.resume();
                    closeBoth(`Native Codex WebSocket rejected (${response.statusCode})`);
                  });
                  upstream.on('message', data => {
                    if (socket.destroyed) return;
                    nativeFrameCount += 1;
                    if (firstFrameTimer) clearTimeout(firstFrameTimer);
                    const text = Array.isArray(data)
                      ? Buffer.concat(data).toString('utf8')
                      : data.toString('utf8');
                    let eventType = 'non-json';
                    try {
                      const parsed = JSON.parse(text) as { type?: unknown };
                      if (typeof parsed.type === 'string') eventType = parsed.type;
                      if (eventType === 'response.completed' || eventType === 'response.failed' || eventType === 'response.incomplete') {
                        nativeCompleted = true;
                        audit({
                          transport: 'ws', requestedModel: modelId, dispatch: 'native', phase: 'complete',
                          provider: 'openai-native', routeModel: modelId, upstreamModel: modelId,
                          outcome: eventType === 'response.completed' ? 'ok' : 'error', status: eventType,
                        });
                      }
                    } catch { /* forward the native frame unchanged */ }
                    if (debug && (nativeFrameCount <= 3 || nativeCompleted || eventType === 'error' || nativeFrameCount % 25 === 0)) {
                      log(`WS native frame#${nativeFrameCount}: model=${modelId} type=${eventType} bytes=${text.length}`);
                    }
                    socket.write(wsEncodeTextFrame(text));
                  });
                  upstream.once('error', (err: Error) => closeBoth(`Native Codex WebSocket error: ${err.message}`));
                  upstream.once('close', (code: number, reason: Buffer) => {
                    const detail = reason?.length ? ` reason=${reason.toString('utf8').slice(0, 200)}` : '';
                    if (debug) log(`WS native upstream close: model=${modelId} code=${code}${detail} frames=${nativeFrameCount}`);
                    if (nativeUpstream === upstream) nativeUpstream = undefined;
                    nativeActive = false;
                    if (!finished) closeBoth(nativeCompleted ? undefined : `Native Codex WebSocket closed before completion (${code})`);
                  });
                  socket.once('close', () => {
                    if (debug) log(`WS native downstream close: model=${modelId} frames=${nativeFrameCount} completed=${nativeCompleted}`);
                    finished = true;
                    nativeActive = false;
                    if (nativeUpstream === upstream) nativeUpstream = undefined;
                    clearTimers();
                    try { upstream?.close(); } catch { /* ignore */ }
                  });
                } catch (err) {
                  closeBoth(`Native Codex WebSocket setup failed: ${err instanceof Error ? err.message : String(err)}`);
                }
                return;
              }
            }
          }
          externalActive = true;
          let resolved = subagentRoute
            ? resolveModel(routes, models, subagentRoute.modelId)
            : resolveModel(routes, models, modelId);
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
          const relayDispatch = markedSubagent ? 'relay-subagent' as const : 'relay' as const;
          audit({
            transport: 'ws', requestedModel: modelId, dispatch: relayDispatch, phase: 'dispatch',
            provider: route.providerId ?? 'relay', routeModel: route.modelId,
            upstreamModel: route.auditUpstreamModelId ?? route.upstreamModelId,
          });
          try {
            const routedBody = await prepareExternalCodexBody(body, {
              relay: nativePayloadRelay,
              mixedNative,
              headers: req.headers,
            });
            let params = applyClaudeCodeOAuthIdentity(route, applyExternalCodexRuntimeIdentity(translateResponsesRequest(
              routedBody as unknown as import('./codex-responses-adapter.js').ResponsesRequest,
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
            ), route));
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
            audit({
              transport: 'ws', requestedModel: modelId, dispatch: relayDispatch, phase: 'complete',
              provider: route.providerId ?? 'relay', routeModel: route.modelId,
              upstreamModel: route.auditUpstreamModelId ?? route.upstreamModelId, outcome: 'ok', status: 'response.completed',
            });
          } catch (err) {
            const msg = formatUpstreamError(err);
            const status = upstreamHttpStatus(err, msg);
            audit({
              transport: 'ws', requestedModel: modelId, dispatch: relayDispatch, phase: 'complete',
              provider: route.providerId ?? 'relay', routeModel: route.modelId,
              upstreamModel: route.auditUpstreamModelId ?? route.upstreamModelId, outcome: 'error', status,
            });
            if (debug) log(`WS sdk error: ${route.modelId}: ${msg}`);
            if (status === 429) {
              writeResponsesRateLimitStream(modelId, msg, sendWsEvent);
            } else {
              writeResponsesErrorStream(modelId, msg, sendWsEvent, status);
            }
          }
          externalActive = false;
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
