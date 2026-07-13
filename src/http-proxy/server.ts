import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import type { Socket } from 'node:net';
import { URL } from 'node:url';
import type { ProxyHandle, ProxyRoute } from '../proxy.js';
import { startProxyCatalog } from '../proxy.js';
import { ensureHttpProxyCertificates } from './ca.js';
import { routeLookupIds } from '../context-model-id.js';
import { anthropicEffortFromRequest, type AnthropicRequest } from '../sdk-adapter.js';
import { writeInferenceRequestLog } from '../trace-log.js';

const ANTHROPIC_HOST = 'api.anthropic.com';
const MAX_BODY_BYTES = 50 * 1024 * 1024;

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

function copyResponse(upstream: http.IncomingMessage, res: http.ServerResponse): void {
  res.writeHead(upstream.statusCode ?? 502, upstream.statusMessage, upstream.rawHeaders);
  upstream.once('error', () => res.destroy());
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
): Promise<void> {
  return new Promise(resolve => {
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
      copyResponse(upstreamRes, res);
      upstreamRes.once('end', resolve);
      upstreamRes.once('error', resolve);
    });
    upstream.once('error', err => {
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end(`Anthropic upstream unreachable: ${err.message}`);
      resolve();
    });
    upstream.end(rawBody);
  });
}

function forwardToAdapter(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  rawBody: Buffer,
  adapter: ProxyHandle,
): Promise<void> {
  return new Promise(resolve => {
    const upstream = http.request({
      hostname: '127.0.0.1',
      port: adapter.port,
      method: 'POST',
      path: req.url,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(rawBody.length),
        'x-api-key': adapter.token,
      },
    }, upstreamRes => {
      copyResponse(upstreamRes, res);
      upstreamRes.once('end', resolve);
      upstreamRes.once('error', resolve);
    });
    upstream.once('error', err => {
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end(`Relay adapter unreachable: ${err.message}`);
      resolve();
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
    adapter ??= await startProxyCatalog(options.routes, options.routes[0]!.aliasId, options.debug);
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

    if (req.method === 'POST' && req.url?.startsWith('/v1/messages')) {
      let parsed: AnthropicRequest | null = null;
      let route: ProxyRoute | undefined;
      try {
        parsed = JSON.parse(rawBody.toString('utf8')) as AnthropicRequest;
        if (typeof parsed.model === 'string') route = routesById.get(parsed.model);
      } catch {
        // Fail safe: an unreadable body is Anthropic traffic, never a relay route.
      }

      if (options.inferenceLogPath) {
        const provider = route
          ? (route.providerId ?? route.aliasId.split(':')[1] ?? 'unknown')
          : 'anthropic';
        writeInferenceRequestLog(options.inferenceLogPath, {
          modelId: typeof parsed?.model === 'string' ? parsed.model : 'unknown',
          effort: parsed ? anthropicEffortFromRequest(parsed) : undefined,
          provider,
          route: route ? 'translated' : 'passthrough',
        });
      }

      if (route && adapter) {
        await forwardToAdapter(req, res, rawBody, adapter);
        return;
      }
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
