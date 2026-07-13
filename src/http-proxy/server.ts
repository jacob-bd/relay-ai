import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import type { Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import type { ProxyHandle, ProxyRoute } from '../proxy.js';
import { startProxyCatalog } from '../proxy.js';
import { ensureHttpProxyCertificates } from './ca.js';
import { routeLookupIds } from '../context-model-id.js';
import { anthropicEffortFromRequest, type AnthropicRequest } from '../sdk-adapter.js';
import { anthropicMessagesEndpoint } from '../anthropic-endpoints.js';
import {
  getLatestMessagePreview,
  INFERENCE_PROGRESS_INTERVAL_MS,
  writeInferenceRequestLog,
  writeInferenceResponseLifecycleLog,
  writeInferenceResponseErrorLog,
  type InferenceResponsePhase,
} from '../trace-log.js';

const ANTHROPIC_HOST = 'api.anthropic.com';
const MAX_BODY_BYTES = 50 * 1024 * 1024;
const MAX_ERROR_BODY_BYTES = 64 * 1024;
const MAX_MESSAGE_START_SSE_BYTES = 64 * 1024;

type MessageStartUsage = {
  usageStage: 'message_start';
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
};

function numericUsage(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function messageStartUsageFromSseBlock(block: string): MessageStartUsage | undefined {
  const lines = block.split('\n');
  const event = lines.find(line => line.startsWith('event:'))?.slice('event:'.length).trim();
  if (event && event !== 'message_start') return undefined;
  const data = lines
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice('data:'.length).trimStart())
    .join('\n');
  if (!data) return undefined;

  try {
    const parsed = JSON.parse(data) as Record<string, unknown>;
    if (parsed.type !== 'message_start') return undefined;
    const message = parsed.message as Record<string, unknown> | undefined;
    const usage = message?.usage as Record<string, unknown> | undefined;
    if (!usage) return undefined;
    return {
      usageStage: 'message_start',
      inputTokens: numericUsage(usage.input_tokens),
      outputTokens: numericUsage(usage.output_tokens),
      cacheCreationInputTokens: numericUsage(usage.cache_creation_input_tokens),
      cacheReadInputTokens: numericUsage(usage.cache_read_input_tokens),
    };
  } catch {
    return undefined;
  }
}

function createMessageStartUsageCapture(
  onUsage: (usage: MessageStartUsage) => void,
  onDone?: () => void,
): (chunk: Buffer) => void {
  let buffered = '';
  let capturedBytes = 0;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    onDone?.();
  };

  return chunk => {
    if (done) return;
    const available = MAX_MESSAGE_START_SSE_BYTES - capturedBytes;
    const captured = chunk.length > available ? chunk.subarray(0, available) : chunk;
    capturedBytes += captured.length;
    buffered = (buffered + captured.toString('utf8')).replace(/\r\n/g, '\n');

    let boundary: number;
    while ((boundary = buffered.indexOf('\n\n')) >= 0) {
      const block = buffered.slice(0, boundary);
      buffered = buffered.slice(boundary + 2);
      const usage = messageStartUsageFromSseBlock(block);
      if (usage) {
        finish();
        onUsage(usage);
        return;
      }
    }

    if (capturedBytes >= MAX_MESSAGE_START_SSE_BYTES) finish();
  };
}

function observeMessageStartUsage(
  upstream: http.IncomingMessage,
  contentEncoding: string | string[] | undefined,
  onUsage: (usage: MessageStartUsage) => void,
): void {
  const encoding = (Array.isArray(contentEncoding) ? contentEncoding[0] : contentEncoding)
    ?.trim()
    .toLowerCase();
  if (!encoding || encoding === 'identity') {
    let capture!: (chunk: Buffer) => void;
    capture = createMessageStartUsageCapture(onUsage, () => upstream.off('data', capture));
    upstream.on('data', capture);
    return;
  }

  const decoder = encoding === 'gzip'
    ? createGunzip()
    : encoding === 'br'
      ? createBrotliDecompress()
      : encoding === 'deflate'
        ? createInflate()
        : undefined;
  if (!decoder) return;

  const onCompressedData = (chunk: Buffer) => {
    if (!decoder.destroyed) decoder.write(chunk);
  };
  const onCompressedEnd = () => {
    if (!decoder.destroyed) decoder.end();
  };
  const cleanup = () => {
    upstream.off('data', onCompressedData);
    upstream.off('end', onCompressedEnd);
    decoder.destroy();
  };
  const capture = createMessageStartUsageCapture(onUsage, cleanup);
  decoder.on('data', capture);
  decoder.once('error', cleanup);
  upstream.on('data', onCompressedData);
  upstream.once('end', onCompressedEnd);
}

export interface HttpProxyOptions {
  host?: string;
  port?: number;
  routes: ProxyRoute[];
  debug?: boolean;
  /** Append privacy-minimal inference routing records as JSONL. */
  inferenceLogPath?: string;
  /** Test hook; production always uses https://api.anthropic.com. */
  anthropicOrigin?: string;
  /** Test hook for a local self-signed Anthropic origin. */
  anthropicRejectUnauthorized?: boolean;
  /** Test hook for observing relay-route isolation without calling an AI provider. */
  adapterHandle?: ProxyHandle;
  /** Test hook; production emits a progress record every 30 seconds. */
  responseProgressIntervalMs?: number;
}

export interface HttpProxyHandle {
  host: string;
  port: number;
  caCertPath: string;
  modelIds: string[];
  inferenceLogPath?: string;
  close: () => Promise<void>;
}

function authorityParts(authority: string): { host: string; port: number } | null {
  try {
    const parsed = new URL(`http://${authority}`);
    return { host: parsed.hostname, port: Number(parsed.port || 443) };
  } catch {
    return null;
  }
}

export function shouldInterceptConnect(authority: string): boolean {
  const target = authorityParts(authority);
  return Boolean(target && target.port === 443 && target.host.replace(/\.$/, '').toLowerCase() === ANTHROPIC_HOST);
}

function readRawBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function copyResponse(
  upstream: http.IncomingMessage,
  res: http.ServerResponse,
  onErrorResponse?: (statusCode: number, body: string) => void,
  onMessageStartUsage?: (usage: MessageStartUsage) => void,
): void {
  const statusCode = upstream.statusCode ?? 502;
  const contentType = upstream.headers['content-type'];
  if (statusCode < 400 && onMessageStartUsage && typeof contentType === 'string' && contentType.includes('text/event-stream')) {
    observeMessageStartUsage(upstream, upstream.headers['content-encoding'], onMessageStartUsage);
  }
  const errorChunks: Buffer[] = [];
  let capturedBytes = 0;
  let truncated = false;
  let errorLogged = false;
  const logErrorResponse = (suffix = '') => {
    if (errorLogged || statusCode < 400 || !onErrorResponse) return;
    errorLogged = true;
    const body = Buffer.concat(errorChunks).toString('utf8');
    onErrorResponse(statusCode, `${body}${truncated ? ' [truncated]' : ''}${suffix}`);
  };
  if (statusCode >= 400 && onErrorResponse) {
    upstream.on('data', (chunk: Buffer) => {
      if (capturedBytes >= MAX_ERROR_BODY_BYTES) {
        truncated = true;
        return;
      }
      const available = MAX_ERROR_BODY_BYTES - capturedBytes;
      const captured = chunk.length > available ? chunk.subarray(0, available) : chunk;
      errorChunks.push(Buffer.from(captured));
      capturedBytes += captured.length;
      if (captured.length < chunk.length) truncated = true;
    });
    upstream.once('end', () => logErrorResponse());
  }
  res.writeHead(statusCode, upstream.statusMessage, upstream.rawHeaders);
  upstream.once('error', err => {
    logErrorResponse(` [stream error: ${err.message}]`);
    res.destroy();
  });
  upstream.pipe(res);
}

function requestHeadersWithoutProxyHeaders(req: http.IncomingMessage): string[] {
  const headers: string[] = [];
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const name = req.rawHeaders[i]!;
    if (/^proxy-(authorization|connection)$/i.test(name)) continue;
    headers.push(name, req.rawHeaders[i + 1] ?? '');
  }
  return headers;
}

function forwardRawAnthropicRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  rawBody: Buffer,
  origin: URL,
  rejectUnauthorized: boolean,
  onErrorResponse?: (statusCode: number, body: string) => void,
  onMessageStartUsage?: (usage: MessageStartUsage) => void,
): Promise<void> {
  return new Promise(resolve => {
    let settled = false;
    let clientDisconnected = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const upstream = https.request({
      protocol: 'https:',
      hostname: origin.hostname,
      port: origin.port || 443,
      method: req.method,
      path: req.url,
      headers: requestHeadersWithoutProxyHeaders(req),
      servername: net.isIP(origin.hostname) ? undefined : origin.hostname,
      rejectUnauthorized,
    }, upstreamRes => {
      copyResponse(upstreamRes, res, onErrorResponse, onMessageStartUsage);
      upstreamRes.once('end', done);
      upstreamRes.once('error', done);
    });
    res.once('close', () => {
      if (res.writableFinished) return;
      clientDisconnected = true;
      upstream.destroy(new Error('Client disconnected'));
      done();
    });
    upstream.once('error', err => {
      if (clientDisconnected) {
        done();
        return;
      }
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end(`Anthropic upstream unreachable: ${err.message}`);
      done();
    });
    upstream.end(rawBody);
  });
}

function forwardToAdapter(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  rawBody: Buffer,
  adapter: ProxyHandle,
  lifecycle?: {
    logPath: string;
    requestId: string;
    modelId: string;
    provider: string;
    progressIntervalMs: number;
  },
): Promise<void> {
  return new Promise(resolve => {
    const startedAt = Date.now();
    let lastActivityAt = startedAt;
    let headersReceived = false;
    let firstByteAt: number | undefined;
    let statusCode: number | undefined;
    let bytes = 0;
    let chunks = 0;
    let adapterEnded = false;
    let failed = false;
    let clientDisconnected = false;
    let adapterResponse: http.IncomingMessage | undefined;
    let upstream: http.ClientRequest | undefined;

    const writeLifecycle = (
      event: Parameters<typeof writeInferenceResponseLifecycleLog>[1]['event'],
      extra: Partial<Parameters<typeof writeInferenceResponseLifecycleLog>[1]> = {},
    ) => {
      if (!lifecycle) return;
      writeInferenceResponseLifecycleLog(lifecycle.logPath, {
        event,
        requestId: lifecycle.requestId,
        modelId: lifecycle.modelId,
        provider: lifecycle.provider,
        route: 'translated',
        ...extra,
      });
    };
    const responsePhase = (): InferenceResponsePhase => {
      if (!headersReceived) return 'waiting_for_headers';
      if (firstByteAt === undefined) return 'waiting_for_first_byte';
      return adapterEnded ? 'delivering' : 'streaming';
    };
    const progressTimer = lifecycle
      ? setInterval(() => {
          const now = Date.now();
          writeLifecycle('response_progress', {
            statusCode,
            phase: responsePhase(),
            durationMs: now - startedAt,
            ...(firstByteAt !== undefined ? { timeToFirstByteMs: firstByteAt - startedAt } : {}),
            idleMs: now - lastActivityAt,
            bytes,
            chunks,
          });
        }, lifecycle.progressIntervalMs)
      : undefined;
    progressTimer?.unref();
    const stopProgress = () => {
      if (progressTimer) clearInterval(progressTimer);
    };

    res.once('finish', () => {
      stopProgress();
      if (failed || clientDisconnected) return;
      const now = Date.now();
      writeLifecycle('response_completed', {
        statusCode,
        durationMs: now - startedAt,
        ...(firstByteAt !== undefined ? { timeToFirstByteMs: firstByteAt - startedAt } : {}),
        bytes,
        chunks,
      });
    });
    res.once('close', () => {
      stopProgress();
      if (res.writableFinished || failed) return;
      clientDisconnected = true;
      const now = Date.now();
      writeLifecycle('response_client_disconnected', {
        statusCode,
        phase: responsePhase(),
        durationMs: now - startedAt,
        ...(firstByteAt !== undefined ? { timeToFirstByteMs: firstByteAt - startedAt } : {}),
        idleMs: now - lastActivityAt,
        bytes,
        chunks,
      });
      adapterResponse?.destroy(new Error('Client disconnected'));
      upstream?.destroy(new Error('Client disconnected'));
      resolve();
    });

    const failAdapterRequest = (err: Error) => {
      if (clientDisconnected) {
        resolve();
        return;
      }
      if (headersReceived || failed) return;
      failed = true;
      stopProgress();
      const now = Date.now();
      writeLifecycle('response_failed', {
        statusCode: 502,
        phase: responsePhase(),
        durationMs: now - startedAt,
        idleMs: now - lastActivityAt,
        bytes,
        chunks,
        errorType: err.name,
      });
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end(`Relay adapter unreachable: ${err.message}`);
      resolve();
    };

    upstream = http.request({
      hostname: '127.0.0.1',
      port: adapter.port,
      method: 'POST',
      path: req.url,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(rawBody.length),
        'x-api-key': adapter.token,
        ...(lifecycle ? { 'x-relay-request-id': lifecycle.requestId } : {}),
      },
    }, upstreamRes => {
      adapterResponse = upstreamRes;
      headersReceived = true;
      statusCode = upstreamRes.statusCode ?? 502;
      lastActivityAt = Date.now();
      upstreamRes.on('data', (chunk: Buffer) => {
        const now = Date.now();
        if (firstByteAt === undefined) {
          firstByteAt = now;
          writeLifecycle('response_started', {
            statusCode,
            durationMs: now - startedAt,
            timeToFirstByteMs: now - startedAt,
          });
        }
        lastActivityAt = now;
        bytes += chunk.length;
        chunks += 1;
      });
      copyResponse(upstreamRes, res, undefined, lifecycle
        ? usage => writeLifecycle('response_usage', usage)
        : undefined);
      const failAdapterResponse = (err: Error) => {
        if (clientDisconnected) {
          resolve();
          return;
        }
        if (adapterEnded || failed) return;
        failed = true;
        stopProgress();
        const now = Date.now();
        writeLifecycle('response_failed', {
          statusCode,
          phase: responsePhase(),
          durationMs: now - startedAt,
          ...(firstByteAt !== undefined ? { timeToFirstByteMs: firstByteAt - startedAt } : {}),
          idleMs: now - lastActivityAt,
          bytes,
          chunks,
          errorType: err.name,
        });
        if (!res.writableEnded) res.destroy(err);
        resolve();
      };
      upstreamRes.once('end', () => {
        adapterEnded = true;
        lastActivityAt = Date.now();
        resolve();
      });
      upstreamRes.once('error', failAdapterResponse);
      upstreamRes.once('aborted', () => failAdapterResponse(new Error('Relay adapter response aborted')));
      upstreamRes.once('close', () => {
        if (!upstreamRes.complete) failAdapterResponse(new Error('Relay adapter response closed before completion'));
      });
    });
    upstream.once('error', failAdapterRequest);
    upstream.once('close', () => {
      if (!headersReceived && !failed) {
        failAdapterRequest(new Error('Relay adapter connection closed before a response'));
      }
    });
    upstream.end(rawBody);
  });
}

function forwardPlainHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
  let target: URL;
  try {
    target = new URL(req.url ?? '');
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('HTTP proxy requests must use an absolute URL');
    return;
  }
  const transport = target.protocol === 'https:' ? https : http;
  const upstream = transport.request({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || undefined,
    method: req.method,
    path: `${target.pathname}${target.search}`,
    headers: requestHeadersWithoutProxyHeaders(req),
  }, upstreamRes => copyResponse(upstreamRes, res));
  upstream.on('error', err => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end(`Proxy upstream unreachable: ${err.message}`);
  });
  req.pipe(upstream);
}

export async function startHttpProxy(options: HttpProxyOptions): Promise<HttpProxyHandle> {
  const certificates = ensureHttpProxyCertificates();
  const routesById = new Map<string, ProxyRoute>();
  for (const route of options.routes) {
    for (const id of routeLookupIds(route.aliasId)) routesById.set(id, route);
  }
  const anthropicOrigin = new URL(options.anthropicOrigin ?? 'https://api.anthropic.com');
  let adapter: ProxyHandle | null = options.adapterHandle ?? null;
  if (options.routes.length > 0) {
    adapter ??= await startProxyCatalog(
      options.routes,
      options.routes[0]!.aliasId,
      options.debug,
      options.inferenceLogPath,
    );
  }

  const mitmServer = https.createServer({
    key: certificates.serverKey,
    cert: certificates.serverCert,
    minVersion: 'TLSv1.2',
  }, async (req, res) => {
    let rawBody: Buffer;
    try {
      rawBody = await readRawBody(req);
    } catch (err) {
      res.writeHead(413, { 'Content-Type': 'text/plain' });
      res.end(err instanceof Error ? err.message : String(err));
      return;
    }

    const messagesEndpoint = anthropicMessagesEndpoint(req.url);
    if (req.method === 'POST' && messagesEndpoint) {
      const requestId = randomUUID();
      let parsed: AnthropicRequest | null = null;
      let route: ProxyRoute | undefined;
      try {
        parsed = JSON.parse(rawBody.toString('utf8')) as AnthropicRequest;
        if (typeof parsed.model === 'string') route = routesById.get(parsed.model);
      } catch {
        // Fail safe: an unreadable body is Anthropic traffic, never a relay route.
      }

      if (messagesEndpoint === 'messages' && options.inferenceLogPath) {
        const provider = route
          ? (route.providerId ?? route.aliasId.split(':')[1] ?? 'unknown')
          : 'anthropic';
        writeInferenceRequestLog(options.inferenceLogPath, {
          requestId,
          modelId: typeof parsed?.model === 'string' ? parsed.model : 'unknown',
          effort: parsed ? anthropicEffortFromRequest(parsed) : undefined,
          provider,
          route: route ? 'translated' : 'passthrough',
          stream: Boolean(parsed?.stream),
          requestPreview: getLatestMessagePreview(parsed?.messages, parsed?.system),
        });
      }

      if (route && adapter) {
        await forwardToAdapter(req, res, rawBody, adapter, messagesEndpoint === 'messages' && options.inferenceLogPath
          ? {
              logPath: options.inferenceLogPath,
              requestId,
              modelId: typeof parsed?.model === 'string' ? parsed.model : 'unknown',
              provider: route.providerId ?? route.aliasId.split(':')[1] ?? 'unknown',
              progressIntervalMs: options.responseProgressIntervalMs ?? INFERENCE_PROGRESS_INTERVAL_MS,
            }
          : undefined);
        return;
      }

      await forwardRawAnthropicRequest(
        req,
        res,
        rawBody,
        anthropicOrigin,
        options.anthropicRejectUnauthorized ?? true,
        messagesEndpoint === 'messages' && options.inferenceLogPath
          ? (statusCode, errorContent) => writeInferenceResponseErrorLog(options.inferenceLogPath!, {
              requestId,
              modelId: typeof parsed?.model === 'string' ? parsed.model : 'unknown',
              provider: 'anthropic',
              route: 'passthrough',
              statusCode,
              errorContent,
            })
          : undefined,
        messagesEndpoint === 'messages' && options.inferenceLogPath
          ? usage => writeInferenceResponseLifecycleLog(options.inferenceLogPath!, {
              event: 'response_usage',
              requestId,
              modelId: typeof parsed?.model === 'string' ? parsed.model : 'unknown',
              provider: 'anthropic',
              route: 'passthrough',
              ...usage,
            })
          : undefined,
      );
      return;
    }

    await forwardRawAnthropicRequest(
      req,
      res,
      rawBody,
      anthropicOrigin,
      options.anthropicRejectUnauthorized ?? true,
    );
  });

  const sockets = new Set<Socket>();
  const proxyServer = http.createServer(forwardPlainHttp);
  proxyServer.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  proxyServer.on('connect', (req, clientSocket, head) => {
    if (shouldInterceptConnect(req.url ?? '')) {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) clientSocket.unshift(head);
      mitmServer.emit('connection', clientSocket);
      return;
    }

    const target = authorityParts(req.url ?? '');
    if (!target) {
      clientSocket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    const upstream = net.connect(target.port, target.host);
    sockets.add(upstream);
    upstream.once('close', () => sockets.delete(upstream));
    upstream.once('connect', () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) upstream.write(head);
      clientSocket.pipe(upstream);
      upstream.pipe(clientSocket);
    });
    upstream.once('error', () => {
      if (!clientSocket.destroyed) clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    });
  });

  try {
    await new Promise<void>((resolve, reject) => {
      proxyServer.once('error', reject);
      proxyServer.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => {
        proxyServer.off('error', reject);
        resolve();
      });
    });
  } catch (err) {
    adapter?.close();
    throw err;
  }

  const address = proxyServer.address();
  if (!address || typeof address === 'string') {
    adapter?.close();
    throw new Error('HTTP proxy did not bind to a TCP port');
  }

  return {
    host: options.host ?? '127.0.0.1',
    port: address.port,
    caCertPath: certificates.caCertPath,
    modelIds: options.routes.map(route => route.aliasId),
    inferenceLogPath: options.inferenceLogPath,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => proxyServer.close(() => resolve()));
      mitmServer.close();
      adapter?.close();
    },
  };
}
