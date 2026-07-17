import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import type { Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { URL } from 'node:url';
import { anthropicMessagesEndpoint, estimateAnthropicInputTokens } from '../anthropic-endpoints.js';
import { routeLookupIds } from '../context-model-id.js';
import { startProxyCatalog, type ProxyHandle, type ProxyRoute } from '../proxy.js';
import { createHttpProxyCertificates } from './ca.js';

const ANTHROPIC_HOST = 'api.anthropic.com';
const MAX_BODY_BYTES = 50 * 1024 * 1024;
const PROXY_USERNAME = 'relay-ai';

export interface HttpProxyOptions {
  routes: ProxyRoute[];
  debug?: boolean;
  /** Test hook; production always uses https://api.anthropic.com. */
  anthropicOrigin?: string;
  /** Test hook for a self-signed Anthropic origin. */
  anthropicRejectUnauthorized?: boolean;
  /** Test hook for observing route isolation without calling a provider. */
  adapterHandle?: ProxyHandle;
}

export interface HttpProxyHandle {
  host: string;
  port: number;
  /** Credential-bearing URL. Never print or write this value to logs. */
  proxyUrl: string;
  caCertPath: string;
  modelIds: string[];
  close: () => Promise<void>;
}

function authorityParts(authority: string): { host: string; port: number } | null {
  const match = authority.match(/^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/);
  if (!match) return null;
  const host = match[1]!.replace(/^\[|\]$/g, '');
  const port = Number(match[2] ?? 443);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65_535) return null;
  return { host, port };
}

export function shouldInterceptConnect(authority: string): boolean {
  const target = authorityParts(authority);
  return Boolean(
    target
    && target.port === 443
    && target.host.replace(/\.$/, '').toLowerCase() === ANTHROPIC_HOST,
  );
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function isAuthorized(req: http.IncomingMessage, expected: string): boolean {
  const header = req.headers['proxy-authorization'];
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === 'string' && secureEqual(value, expected);
}

function rejectProxyRequest(res: http.ServerResponse): void {
  res.writeHead(407, {
    'Content-Type': 'text/plain',
    'Proxy-Authenticate': 'Basic realm="Relay AI"',
    Connection: 'close',
  });
  res.end('Proxy authentication required');
}

function rejectProxyConnect(socket: Duplex): void {
  socket.end([
    'HTTP/1.1 407 Proxy Authentication Required',
    'Proxy-Authenticate: Basic realm="Relay AI"',
    'Connection: close',
    'Content-Length: 0',
    '',
    '',
  ].join('\r\n'));
}

function readRawBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        fail(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    req.once('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.once('aborted', () => fail(new Error('Client disconnected')));
    req.once('error', fail);
  });
}

function requestHeadersWithoutProxyHeaders(req: http.IncomingMessage): string[] {
  const headers: string[] = [];
  for (let index = 0; index < req.rawHeaders.length; index += 2) {
    const name = req.rawHeaders[index]!;
    if (/^proxy-(authorization|connection)$/i.test(name)) continue;
    headers.push(name, req.rawHeaders[index + 1] ?? '');
  }
  return headers;
}

function copyResponse(upstream: http.IncomingMessage, res: http.ServerResponse): void {
  res.writeHead(upstream.statusCode ?? 502, upstream.statusMessage, upstream.rawHeaders);
  upstream.once('error', error => res.destroy(error));
  upstream.pipe(res);
}

function forwardRawRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  rawBody: Buffer,
  origin: URL,
  rejectUnauthorized: boolean,
): Promise<void> {
  return new Promise(resolve => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const transport = origin.protocol === 'https:' ? https : http;
    const upstream = transport.request({
      protocol: origin.protocol,
      hostname: origin.hostname,
      port: origin.port || undefined,
      method: req.method,
      path: req.url,
      headers: requestHeadersWithoutProxyHeaders(req),
      ...(origin.protocol === 'https:' ? { rejectUnauthorized } : {}),
    }, upstreamRes => {
      copyResponse(upstreamRes, res);
      upstreamRes.once('end', done);
      upstreamRes.once('error', done);
    });
    res.once('close', () => {
      if (!res.writableFinished) upstream.destroy(new Error('Client disconnected'));
      done();
    });
    upstream.once('error', error => {
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
      if (!res.writableEnded) res.end(`Anthropic upstream unreachable: ${error.message}`);
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
): Promise<void> {
  return new Promise(resolve => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const sessionId = req.headers['x-claude-code-session-id'];
    const upstream = http.request({
      hostname: '127.0.0.1',
      port: adapter.port,
      method: 'POST',
      path: req.url,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(rawBody.length),
        'x-api-key': adapter.token,
        ...(typeof sessionId === 'string' ? { 'x-claude-code-session-id': sessionId } : {}),
      },
    }, upstreamRes => {
      copyResponse(upstreamRes, res);
      upstreamRes.once('end', done);
      upstreamRes.once('error', done);
    });
    res.once('close', () => {
      if (!res.writableFinished) upstream.destroy(new Error('Client disconnected'));
      done();
    });
    upstream.once('error', error => {
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
      if (!res.writableEnded) res.end(`Relay adapter unreachable: ${error.message}`);
      done();
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
    res.end('HTTP proxy requests must use an absolute HTTP or HTTPS URL');
    return;
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('HTTP proxy requests must use an HTTP or HTTPS URL');
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
  res.once('close', () => {
    if (!res.writableFinished) upstream.destroy(new Error('Client disconnected'));
  });
  upstream.once('error', error => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
    if (!res.writableEnded) res.end(`Proxy upstream unreachable: ${error.message}`);
  });
  req.pipe(upstream);
}

export async function startHttpProxy(options: HttpProxyOptions): Promise<HttpProxyHandle> {
  const host = '127.0.0.1';
  const certificates = createHttpProxyCertificates();
  const routesById = new Map<string, ProxyRoute>();
  for (const route of options.routes) {
    for (const id of routeLookupIds(route.aliasId)) routesById.set(id, route);
  }
  const anthropicOrigin = new URL(options.anthropicOrigin ?? 'https://api.anthropic.com');
  if (anthropicOrigin.protocol !== 'http:' && anthropicOrigin.protocol !== 'https:') {
    certificates.cleanup();
    throw new Error('Anthropic origin must use HTTP or HTTPS');
  }

  let adapter = options.adapterHandle ?? null;
  try {
    if (options.routes.length > 0 && !adapter) {
      adapter = await startProxyCatalog(
        options.routes,
        options.routes[0]!.aliasId,
        options.debug,
      );
    }
  } catch (error) {
    certificates.cleanup();
    throw error;
  }

  const mitmServer = https.createServer({
    key: certificates.serverKey,
    cert: certificates.serverCert,
    minVersion: 'TLSv1.2',
  }, async (req, res) => {
    let rawBody: Buffer;
    try {
      rawBody = await readRawBody(req);
    } catch (error) {
      if (!res.headersSent && !res.writableEnded) {
        res.writeHead(413, { 'Content-Type': 'text/plain' });
        res.end(error instanceof Error ? error.message : String(error));
      }
      return;
    }

    const endpoint = anthropicMessagesEndpoint(req.url);
    if (req.method === 'POST' && endpoint) {
      let parsed: Record<string, unknown> | null = null;
      let route: ProxyRoute | undefined;
      try {
        parsed = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
        if (typeof parsed.model === 'string') route = routesById.get(parsed.model);
      } catch {
        // Fail closed to Anthropic passthrough when a body cannot be inspected.
      }

      if (route && adapter && parsed) {
        if (endpoint === 'count_tokens') {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'x-relay-token-count-source': 'local-estimate',
          });
          res.end(JSON.stringify({ input_tokens: estimateAnthropicInputTokens(parsed) }));
          return;
        }
        const adapterBody = parsed.model === route.aliasId
          ? rawBody
          : Buffer.from(JSON.stringify({ ...parsed, model: route.aliasId }));
        await forwardToAdapter(req, res, adapterBody, adapter);
        return;
      }
    }

    await forwardRawRequest(
      req,
      res,
      rawBody,
      anthropicOrigin,
      options.anthropicRejectUnauthorized ?? true,
    );
  });
  mitmServer.on('tlsClientError', () => {
    // The outer proxy owns error reporting for aborted/invalid CONNECT clients.
  });

  const password = randomBytes(32).toString('base64url');
  const expectedAuthorization = `Basic ${Buffer.from(`${PROXY_USERNAME}:${password}`).toString('base64')}`;
  const sockets = new Set<Socket>();
  const proxyServer = http.createServer((req, res) => {
    if (!isAuthorized(req, expectedAuthorization)) {
      rejectProxyRequest(res);
      return;
    }
    forwardPlainHttp(req, res);
  });
  proxyServer.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  proxyServer.on('connect', (req, clientSocket, head) => {
    clientSocket.on('error', () => clientSocket.destroy());
    if (!isAuthorized(req, expectedAuthorization)) {
      rejectProxyConnect(clientSocket);
      return;
    }

    if (shouldInterceptConnect(req.url ?? '')) {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) clientSocket.unshift(head);
      mitmServer.emit('connection', clientSocket);
      return;
    }

    const target = authorityParts(req.url ?? '');
    if (!target) {
      clientSocket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      return;
    }
    const upstream = net.connect(target.port, target.host);
    let established = false;
    sockets.add(upstream);
    clientSocket.once('close', () => {
      if (!upstream.destroyed) upstream.destroy();
    });
    upstream.once('close', () => {
      sockets.delete(upstream);
      if (established && !clientSocket.destroyed) clientSocket.destroy();
    });
    upstream.once('connect', () => {
      established = true;
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) upstream.write(head);
      clientSocket.pipe(upstream);
      upstream.pipe(clientSocket);
    });
    upstream.once('error', () => {
      if (clientSocket.destroyed) return;
      if (established) clientSocket.destroy();
      else clientSocket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
    });
  });

  try {
    await new Promise<void>((resolve, reject) => {
      proxyServer.once('error', reject);
      proxyServer.listen(0, host, () => {
        proxyServer.off('error', reject);
        resolve();
      });
    });
  } catch (error) {
    adapter?.close();
    certificates.cleanup();
    throw error;
  }

  const address = proxyServer.address();
  if (!address || typeof address === 'string') {
    adapter?.close();
    certificates.cleanup();
    throw new Error('HTTP proxy did not bind to a TCP port');
  }

  let closed = false;
  return {
    host,
    port: address.port,
    proxyUrl: `http://${PROXY_USERNAME}:${encodeURIComponent(password)}@${host}:${address.port}`,
    caCertPath: certificates.caCertPath,
    modelIds: options.routes.map(route => route.aliasId),
    close: async () => {
      if (closed) return;
      closed = true;
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => proxyServer.close(() => resolve()));
      try {
        mitmServer.close();
      } catch {
        // The MITM server receives authenticated sockets but never listens itself.
      }
      adapter?.close();
      certificates.cleanup();
    },
  };
}
