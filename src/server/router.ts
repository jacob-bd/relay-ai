import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { isAuthorized } from './auth.js';
import {
  formatGatewayAnthropicModels,
  formatOpenAIModels,
  gatewayDisplayName,
  supportsDirectOpenAIChatCompletions,
  type GatewayModelOptions,
  type ModelCatalog,
  type ServerBackendId,
  type ServerModelInfo,
  upstreamModelId,
} from './models.js';
import {
  translateOpenAiRequest,
  generateOpenAiResponse,
  streamOpenAiResponse,
  type OpenAiRequest,
} from '../openai-adapter.js';
import { sendJson, readBody } from '../http-utils.js';
import { relayAnthropicMessages } from '../upstream-forward.js';
import { estimateAnthropicInputTokens } from '../anthropic-endpoints.js';
import { resolveProviderCredential } from '../env.js';
import { oauthAuthRef } from '../registry/import-build.js';
import {
  injectClaudeCodeBillingSystemLine,
  injectClaudeIdentity,
  selectBetaFlags,
} from '../oauth/claude-identity.js';
import {
  getLatestMessagePreview,
  writeInferenceRequestLog,
  writeInferenceResponseErrorLog,
  writeSecureLogLine,
  resetTraceLog,
  type InferenceRequestLogEntry,
} from '../trace-log.js';
import type { LanguageModel } from 'ai';
import { createLanguageModel, isSdkMigratedNpm, maxToolsForNpm } from '../provider-factory.js';
import {
  anthropicErrorType,
  formatUpstreamError,
  sdkUpstreamErrorDetails,
  upstreamHttpStatus,
} from '../codex/upstream-error.js';
import {
  translateRequest as sdkTranslateRequest,
  streamAnthropicResponse,
  generateAnthropicResponse,
  silenceSdkWarnings,
  anthropicEffortFromRequest,
  type AnthropicRequest,
} from '../sdk-adapter.js';

export interface ServerBackend {
  baseUrl: string;
}

export interface VertexServerConfig {
  project: string;
  location: string;
}

export interface ServerOptions {
  host: string;
  port: number;
  apiKey: string;
  serverPassword: string | null;
  catalog: ModelCatalog;
  backends: Record<ServerBackendId, ServerBackend>;
  gateway?: GatewayModelOptions;
  vertex?: VertexServerConfig;
  /** When set, append structured debug lines to this file path. */
  debugLogPath?: string;
  /** When set, append privacy-minimal inference routing records as JSONL. */
  inferenceLogPath?: string;
}

export interface ServerHandle {
  host: string;
  port: number;
  url: string;
  server: Server;
  inferenceLogPath?: string;
  close: () => Promise<void>;
}

type JsonBody = Record<string, any>;

type PLog = (msg: string | (() => string)) => void;

function makeServerLog(debugLogPath: string | undefined): PLog {
  if (!debugLogPath) return () => {};
  resetTraceLog(debugLogPath);
  return (msg) => writeSecureLogLine(debugLogPath, typeof msg === 'function' ? msg() : msg);
}

function auditInference(options: ServerOptions, entry: InferenceRequestLogEntry): void {
  if (options.inferenceLogPath) writeInferenceRequestLog(options.inferenceLogPath, entry);
}

function inferenceProvider(model: ServerModelInfo): string {
  return model.providerId ?? String(model.sourceBackend);
}

function auditSdkError(
  options: ServerOptions,
  requestedModelId: string,
  model: ServerModelInfo,
  err: unknown,
  message: string,
): number {
  const details = sdkUpstreamErrorDetails(err);
  const statusCode = details?.statusCode ?? upstreamHttpStatus(err, message);
  if (options.inferenceLogPath && statusCode >= 400) {
    writeInferenceResponseErrorLog(options.inferenceLogPath, {
      modelId: requestedModelId,
      provider: inferenceProvider(model),
      route: 'translated',
      statusCode,
      errorContent: details?.errorContent ?? message,
      isRetryable: details?.isRetryable,
      attemptCount: details?.attemptCount,
    });
  }
  return statusCode;
}

function openAiEffort(body: JsonBody): string | undefined {
  if (typeof body.reasoning_effort === 'string' && body.reasoning_effort.trim()) {
    return body.reasoning_effort.trim();
  }
  const reasoning = body.reasoning;
  if (reasoning && typeof reasoning === 'object' && typeof reasoning.effort === 'string' && reasoning.effort.trim()) {
    return reasoning.effort.trim();
  }
  return undefined;
}

export async function startServer(options: ServerOptions): Promise<ServerHandle> {
  silenceSdkWarnings();
  const languageModelCache = new Map<string, LanguageModel>();
  const plog = makeServerLog(options.debugLogPath);

  const server = createServer((req, res) => {
    void routeRequest(req, res, options, languageModelCache, plog);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Server did not bind to a TCP port');
  }

  return {
    host: options.host,
    port: address.port,
    url: `http://${options.host}:${address.port}`,
    server,
    inferenceLogPath: options.inferenceLogPath,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(err => (err ? reject(err) : resolve()));
    }),
  };
}

async function routeRequest(req: IncomingMessage, res: ServerResponse, options: ServerOptions, modelCache: Map<string, LanguageModel>, plog: PLog): Promise<void> {
  try {
    const pathname = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`).pathname;
    plog(`${req.method} ${pathname}`);

    if (req.method === 'GET' && pathname === '/health') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (!isAuthorized(toRequest(req), options.serverPassword)) {
      sendJson(res, 401, { error: { message: 'Unauthorized' } });
      return;
    }

    if (req.method === 'GET' && pathname === '/models') {
      sendJson(res, 200, { models: options.catalog.list().map(({ apiKey: _apiKey, headers: _headers, ...rest }) => rest) });
      return;
    }

    if (req.method === 'GET' && pathname === '/anthropic/v1/models') {
      sendJson(res, 200, formatGatewayAnthropicModels(options.catalog.list(), options.gateway));
      return;
    }

    if (req.method === 'GET' && pathname === '/openai/v1/models') {
      sendJson(res, 200, formatOpenAIModels(options.catalog.list()));
      return;
    }

    if (req.method === 'POST' && pathname === '/anthropic/v1/messages') {
      await handleAnthropicMessages(req, res, options, modelCache, plog);
      return;
    }

    if (req.method === 'POST' && pathname === '/openai/v1/chat/completions') {
      await handleOpenAIChatCompletions(req, res, options, modelCache, plog);
      return;
    }

    sendJson(res, 404, { error: { message: 'Not found' } });
  } catch (err) {
    sendJson(res, 500, { error: { message: err instanceof Error ? err.message : String(err) } });
  }
}

async function handleAnthropicMessages(
  req: IncomingMessage,
  res: ServerResponse,
  options: ServerOptions,
  modelCache: Map<string, LanguageModel>,
  plog: PLog,
): Promise<void> {
  const body = await readJson(req);
  if (!body) {
    sendJson(res, 400, { error: { message: 'Invalid JSON body' } });
    return;
  }

  const model = lookupModel(res, options.catalog, body.model);
  if (!model) {
    plog(`model not found: ${body.model}`);
    return;
  }

  plog(() => `anthropic-messages model=${body.model} format=${model.modelFormat} npm=${model.npm ?? 'none'} stream=${body.stream}`);

  if (model.modelFormat === 'anthropic') {
    if (model.baseUrl && !/^https?:\/\//i.test(model.baseUrl)) {
      sendJson(res, 400, { error: { message: `Invalid provider baseUrl: must be http:// or https://` } });
      return;
    }
    const messagesUrl = model.baseUrl
      ? `${model.baseUrl}/v1/messages`
      : `${backendFor(options, model).baseUrl}/v1/messages`;
    const apiKey = model.apiKey ?? options.apiKey;
    const betaHeaderRaw = req.headers['anthropic-beta'];
    const inboundBeta = Array.isArray(betaHeaderRaw) ? betaHeaderRaw.join(',') : betaHeaderRaw;
    const clientWantsStream = Boolean(body.stream);
    const forwardBody: Record<string, unknown> = { ...body, model: upstreamModelId(model) };
    const isOAuth = model.authType === 'oauth';

    auditInference(options, {
      modelId: body.model,
      effort: anthropicEffortFromRequest(body as AnthropicRequest) ?? model.defaultEffort,
      provider: inferenceProvider(model),
      route: 'passthrough',
      requestPreview: getLatestMessagePreview(body.messages, body.system),
    });

    let effectiveBeta = inboundBeta;
    let claudeCodeSessionId: string | undefined;
    if (isOAuth) {
      const seed = model.providerId ?? upstreamModelId(model);
      const identity = injectClaudeIdentity(forwardBody, model.providerData, seed);
      if (model.providerId === 'claude-code') injectClaudeCodeBillingSystemLine(forwardBody);
      claudeCodeSessionId = identity.sessionId;
      effectiveBeta = selectBetaFlags(forwardBody, upstreamModelId(model), inboundBeta);
    }

    const refreshToken = isOAuth && model.providerId
      ? () => resolveProviderCredential(model.providerId!, oauthAuthRef(model.providerId!))
      : undefined;

    plog(() => `anthropic-passthrough → ${messagesUrl} oauth=${isOAuth} stream=${clientWantsStream}`);
    await relayAnthropicMessages(res, messagesUrl, forwardBody, apiKey, clientWantsStream, {
      inboundBeta: effectiveBeta,
      authType: isOAuth ? 'oauth' : 'api',
      log: message => plog(message),
      claudeCodeSessionId,
      extraHeaders: model.headers,
      refreshToken,
      onTokenRefreshed: refreshed => { model.apiKey = refreshed; },
      onUpstreamError: options.inferenceLogPath
        ? (statusCode, errorContent) => writeInferenceResponseErrorLog(options.inferenceLogPath!, {
            modelId: body.model,
            provider: inferenceProvider(model),
            route: 'passthrough',
            statusCode,
            errorContent,
          })
        : undefined,
    });
    return;
  }

  if (model.modelFormat === 'openai') {
    if (!isSdkMigratedNpm(model.npm)) {
      sendJson(res, 400, { error: { message: `No SDK provider for model: ${model.id}` } });
      return;
    }
    const apiKey = model.apiKey ?? options.apiKey;
    auditInference(options, {
      modelId: body.model,
      effort: anthropicEffortFromRequest(body as AnthropicRequest) ?? model.defaultEffort,
      provider: inferenceProvider(model),
      route: 'translated',
      requestPreview: getLatestMessagePreview(body.messages, body.system),
    });
    const languageModel = await getOrInitLanguageModel(modelCache, model, model.npm!, model.apiBaseUrl, apiKey, options.vertex);
    const npmMaxTools = maxToolsForNpm(model.npm);
    const toolCount = Array.isArray((body as Record<string, unknown>).tools) ? ((body as Record<string, unknown>).tools as unknown[]).length : 0;
    if (npmMaxTools !== undefined && toolCount > npmMaxTools) {
      plog(`tools truncated: ${toolCount} → ${npmMaxTools} (provider limit)`);
    }
    const params = sdkTranslateRequest(body as unknown as AnthropicRequest, model.npm!, {
      defaultEffort: anthropicEffortFromRequest(body as AnthropicRequest) ? undefined : model.defaultEffort,
      openAiOAuth: model.npm === '@ai-sdk/openai' && model.authType === 'oauth',
      reasoningMetadata: {
        providerId: model.providerId,
        apiBaseUrl: model.apiBaseUrl,
        supportedParameters: model.supportedParameters,
        reasoning: model.reasoning,
        interleavedReasoningField: model.interleavedReasoningField,
        upstreamModelId: upstreamModelId(model),
      },
      maxTools: npmMaxTools,
    });
    const clientWantsStream = Boolean(body.stream);
    // Use the display name in the response model field when masking is on — Claude
    // Desktop shows the response model field in its status bar chip, so this surfaces
    // human-readable names ("Grok 4.3 (xAI)") instead of the reversed gateway IDs.
    const responseModelId = getResponseModelId(body.model, model, options);

    plog(() => `sdk npm=${model.npm} upstream=${upstreamModelId(model)} responseModel=${responseModelId} stream=${clientWantsStream}`);

    try {
      if (clientWantsStream) {
        const writeStreamChunk = (chunk: string) => {
          if (!res.headersSent) {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
            });
          }
          res.write(chunk);
        };
        await streamAnthropicResponse(languageModel, params, responseModelId, writeStreamChunk, undefined, {
          initialInputTokens: estimateAnthropicInputTokens(body),
        });
        if (!res.headersSent) writeStreamChunk('');
        res.end();
      } else {
        const anthropicResponse = await generateAnthropicResponse(languageModel, params, responseModelId);
        sendJson(res, 200, anthropicResponse);
      }
    } catch (err) {
      const message = formatUpstreamError(err);
      const status = auditSdkError(options, body.model, model, err, message);
      plog(`sdk error npm=${model.npm} upstream=${upstreamModelId(model)}: ${message}`);
      if (!res.headersSent) {
        sendJson(res, status === 500 ? 502 : status, { error: { message } });
      } else {
        const errorType = anthropicErrorType(status);
        res.write(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: errorType, message } })}\n\n`);
        res.end();
      }
    }
    return;
  }

  sendJson(res, 400, { error: { message: `Unsupported model format: ${model.modelFormat}` } });
}

async function handleOpenAIChatCompletions(
  req: IncomingMessage,
  res: ServerResponse,
  options: ServerOptions,
  modelCache: Map<string, LanguageModel>,
  plog: PLog,
): Promise<void> {
  const body = await readJson(req);
  if (!body) {
    sendJson(res, 400, { error: { message: 'Invalid JSON body' } });
    return;
  }

  const model = lookupModel(res, options.catalog, body.model);
  if (!model) return;

  if (supportsDirectOpenAIChatCompletions(model)) {
    if (model.completionsUrl && !/^https?:\/\//i.test(model.completionsUrl)) {
      sendJson(res, 400, { error: { message: `Invalid provider completionsUrl: must be http:// or https://` } });
      return;
    }
    const completionsUrl = model.completionsUrl
      ? model.completionsUrl
      : `${backendFor(options, model).baseUrl}/v1/chat/completions`;
    const apiKey = model.apiKey ?? options.apiKey;
    auditInference(options, {
      modelId: body.model,
      effort: openAiEffort(body),
      provider: inferenceProvider(model),
      route: 'passthrough',
      requestPreview: getLatestMessagePreview(body.messages, body.system),
    });
    await relayAnthropicMessages(res, completionsUrl, body, apiKey, Boolean(body.stream), {
      onUpstreamError: options.inferenceLogPath
        ? (statusCode, errorContent) => writeInferenceResponseErrorLog(options.inferenceLogPath!, {
            modelId: body.model,
            provider: inferenceProvider(model),
            route: 'passthrough',
            statusCode,
            errorContent,
          })
        : undefined,
    });
    return;
  }

  // SDK Translation Path
  const npm = model.npm || (model.modelFormat === 'anthropic' ? '@ai-sdk/anthropic' : undefined);
  if (!npm) {
    sendJson(res, 400, { error: { message: `No SDK provider for model: ${model.id}` } });
    return;
  }

  const apiKey = model.apiKey ?? options.apiKey;
  auditInference(options, {
    modelId: body.model,
    effort: openAiEffort(body),
    provider: inferenceProvider(model),
    route: 'translated',
    requestPreview: getLatestMessagePreview(body.messages, body.system),
  });
  const baseURL = model.modelFormat === 'anthropic' ? model.baseUrl : model.apiBaseUrl;
  const languageModel = await getOrInitLanguageModel(modelCache, model, npm, baseURL, apiKey, options.vertex);
  const params = translateOpenAiRequest(body as unknown as OpenAiRequest);
  const clientWantsStream = Boolean(body.stream);
  const responseModelId = getResponseModelId(body.model, model, options);

  plog(() => `sdk-openai npm=${npm} upstream=${upstreamModelId(model)} responseModel=${responseModelId} stream=${clientWantsStream}`);

  try {
    if (clientWantsStream) {
      const writeStreamChunk = (chunk: string) => {
        if (!res.headersSent) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });
        }
        res.write(chunk);
      };
      await streamOpenAiResponse(languageModel, params, responseModelId, writeStreamChunk);
      if (!res.headersSent) writeStreamChunk('');
      res.end();
    } else {
      const response = await generateOpenAiResponse(languageModel, params, responseModelId);
      sendJson(res, 200, response);
    }
  } catch (err) {
    const message = formatUpstreamError(err);
    const status = auditSdkError(options, body.model, model, err, message);
    plog(`sdk error npm=${model.npm} upstream=${upstreamModelId(model)}: ${message}`);
    if (!res.headersSent) {
      sendJson(res, status === 500 ? 502 : status, { error: { message } });
    } else {
      res.write(`data: ${JSON.stringify({ error: { message, type: 'upstream_error', code: status } })}\n\n`);
      res.end();
    }
  }
}

function lookupModel(res: ServerResponse, catalog: ModelCatalog, modelId: unknown): ServerModelInfo | null {
  if (typeof modelId !== 'string') {
    sendJson(res, 400, { error: { message: 'Request body must include a model string' } });
    return null;
  }

  const model = catalog.get(modelId);
  if (!model) {
    sendJson(res, 400, { error: { message: `Unknown model: ${modelId}` } });
    return null;
  }

  return model;
}

function backendFor(options: ServerOptions, model: ServerModelInfo): ServerBackend {
  if (model.sourceBackend === 'vertex') {
    throw new Error(`Vertex models route through the SDK adapter, not cloud backends: ${model.id}`);
  }
  if (model.sourceBackend === 'zen') return options.backends.zen;
  if (model.sourceBackend === 'go') return options.backends.go;
  throw new Error(`Provider ${model.sourceBackend} is not a cloud backend — model must set baseUrl/completionsUrl`);
}

async function getOrInitLanguageModel(
  modelCache: Map<string, LanguageModel>,
  model: ServerModelInfo,
  npm: string,
  baseURL: string | undefined,
  apiKey: string,
  vertex: VertexServerConfig | undefined,
): Promise<LanguageModel> {
  const cacheKey = [
    model.providerId ?? model.sourceBackend,
    model.id,
    upstreamModelId(model),
    npm,
    baseURL ?? '',
  ].join('\x1f');
  let languageModel = modelCache.get(cacheKey);
  if (!languageModel) {
    languageModel = await createLanguageModel({
      npm,
      modelId: upstreamModelId(model),
      apiKey,
      baseURL,
      providerId: model.providerId ?? model.sourceBackend,
      authType: model.authType,
      oauthAccountId: model.oauthAccountId,
      vertex,
      headers: model.headers,
      useResponsesLite: model.useResponsesLite,
      preferWebSockets: model.preferWebSockets,
    });
    modelCache.set(cacheKey, languageModel);
  }
  return languageModel;
}

function getResponseModelId(bodyModel: unknown, model: ServerModelInfo, options: ServerOptions): string {
  return options.gateway?.maskGatewayIds
    ? gatewayDisplayName(model, options.gateway)
    : (typeof bodyModel === 'string' ? bodyModel : model.id);
}

async function readJson(req: IncomingMessage): Promise<JsonBody | null> {
  try {
    const raw = await readBody(req);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return null;
  }
}

function toRequest(req: IncomingMessage): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, sanitizeIncomingHeaderValue(item));
    } else if (value !== undefined) {
      headers.set(name, sanitizeIncomingHeaderValue(value));
    }
  }

  return new Request('http://localhost/', { headers });
}

/** HTTP headers cannot contain CR/LF — common when a multi-line secret is pasted into a client. */
function sanitizeIncomingHeaderValue(value: string): string {
  return value.replace(/\r?\n/g, ' ').trim();
}
