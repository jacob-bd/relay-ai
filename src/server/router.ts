import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { isAuthorized } from './auth.js';
import {
  formatGatewayAnthropicModels,
  formatOpenAIModels,
  type GatewayModelOptions,
  type ModelCatalog,
  type ServerBackendId,
  type ServerModelInfo,
  upstreamModelId,
} from './models.js';
import { postJsonUpstream } from '../upstream-forward.js';
import { createLanguageModel, isSdkMigratedNpm } from '../provider-factory.js';
import {
  translateRequest as sdkTranslateRequest,
  streamAnthropicResponse,
  generateAnthropicResponse,
  silenceSdkWarnings,
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
}

export interface ServerHandle {
  host: string;
  port: number;
  url: string;
  server: Server;
  close: () => Promise<void>;
}

type JsonBody = Record<string, any>;

export async function startServer(options: ServerOptions): Promise<ServerHandle> {
  silenceSdkWarnings();

  const server = createServer((req, res) => {
    void routeRequest(req, res, options);
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
    close: () => new Promise<void>((resolve, reject) => {
      server.close(err => (err ? reject(err) : resolve()));
    }),
  };
}

async function routeRequest(req: IncomingMessage, res: ServerResponse, options: ServerOptions): Promise<void> {
  try {
    const pathname = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`).pathname;

    if (req.method === 'GET' && pathname === '/health') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (!isAuthorized(toRequest(req), options.serverPassword)) {
      sendJson(res, 401, { error: { message: 'Unauthorized' } });
      return;
    }

    if (req.method === 'GET' && pathname === '/models') {
      sendJson(res, 200, { models: options.catalog.list().map(({ apiKey: _apiKey, ...rest }) => rest) });
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
      await handleAnthropicMessages(req, res, options);
      return;
    }

    if (req.method === 'POST' && pathname === '/openai/v1/chat/completions') {
      await handleOpenAIChatCompletions(req, res, options);
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
): Promise<void> {
  const body = await readJson(req);
  if (!body) {
    sendJson(res, 400, { error: { message: 'Invalid JSON body' } });
    return;
  }

  const model = lookupModel(res, options.catalog, body.model);
  if (!model) return;

  if (model.modelFormat === 'anthropic') {
    if (model.baseUrl && !/^https?:\/\//i.test(model.baseUrl)) {
      sendJson(res, 400, { error: { message: `Invalid provider baseUrl: must be http:// or https://` } });
      return;
    }
    const messagesUrl = model.baseUrl
      ? `${model.baseUrl}/v1/messages`
      : `${backendFor(options, model).baseUrl}/v1/messages`;
    const apiKey = model.apiKey ?? options.apiKey;
    await forwardJson(res, messagesUrl, { ...body, model: upstreamModelId(model) }, apiKey);
    return;
  }

  if (model.modelFormat === 'openai') {
    if (!isSdkMigratedNpm(model.npm)) {
      sendJson(res, 400, { error: { message: `No SDK provider for model: ${model.id}` } });
      return;
    }
    const apiKey = model.apiKey ?? options.apiKey;
    const languageModel = await createLanguageModel({
      npm: model.npm!,
      modelId: upstreamModelId(model),
      apiKey,
      baseURL: model.apiBaseUrl,
      providerId: model.sourceBackend,
      vertex: options.vertex,
    });
    const params = sdkTranslateRequest(body as unknown as AnthropicRequest, model.npm!);
    const clientWantsStream = Boolean(body.stream);

    try {
      if (clientWantsStream) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });
        const clientModel = typeof body.model === 'string' ? body.model : model.id;
        await streamAnthropicResponse(languageModel, params, clientModel, chunk => res.write(chunk));
        res.end();
      } else {
        const clientModel = typeof body.model === 'string' ? body.model : model.id;
        const anthropicResponse = await generateAnthropicResponse(languageModel, params, clientModel);
        sendJson(res, 200, anthropicResponse);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) sendJson(res, 502, { error: { message } });
      else res.end();
    }
    return;
  }

  sendJson(res, 400, { error: { message: `Unsupported model format: ${model.modelFormat}` } });
}

async function handleOpenAIChatCompletions(
  req: IncomingMessage,
  res: ServerResponse,
  options: ServerOptions,
): Promise<void> {
  const body = await readJson(req);
  if (!body) {
    sendJson(res, 400, { error: { message: 'Invalid JSON body' } });
    return;
  }

  const model = lookupModel(res, options.catalog, body.model);
  if (!model) return;

  if (model.modelFormat === 'openai') {
    if (model.completionsUrl && !/^https?:\/\//i.test(model.completionsUrl)) {
      sendJson(res, 400, { error: { message: `Invalid provider completionsUrl: must be http:// or https://` } });
      return;
    }
    const completionsUrl = model.completionsUrl
      ? model.completionsUrl
      : `${backendFor(options, model).baseUrl}/v1/chat/completions`;
    const apiKey = model.apiKey ?? options.apiKey;
    await forwardJson(res, completionsUrl, body, apiKey);
    return;
  }

  if (model.modelFormat === 'anthropic') {
    sendJson(res, 400, { error: { message: 'OpenAI to Anthropic reverse translation is not supported yet' } });
    return;
  }

  sendJson(res, 400, { error: { message: `Unsupported model format: ${model.modelFormat}` } });
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
  return options.backends[model.sourceBackend];
}

async function forwardJson(res: ServerResponse, url: string, body: JsonBody, apiKey: string): Promise<void> {
  const upstream = await postJsonUpstream(url, body, apiKey);
  sendJson(res, upstream.status, upstream.body);
}

async function readJson(req: IncomingMessage): Promise<JsonBody | null> {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString();
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

function sendJson(res: ServerResponse, status: number, body: any): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
