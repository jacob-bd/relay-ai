import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import * as http from 'node:http';
import * as net from 'node:net';
import * as tls from 'node:tls';
import { startHttpProxy, type HttpProxyHandle } from '../src/http-proxy/server.js';

const testHome = mkdtempSync(join(tmpdir(), 'relay-ai-http-proxy-'));
const previousRelayHome = process.env['RELAY_AI_HOME'];

async function listen(server: http.Server): Promise<number> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server did not bind');
  return address.port;
}

function proxyAuthorization(proxy: HttpProxyHandle): string {
  const parsed = new URL(proxy.proxyUrl);
  return `Basic ${Buffer.from(`${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`).toString('base64')}`;
}

async function rawConnect(proxy: HttpProxyHandle, authorized: boolean): Promise<{
  socket: net.Socket;
  response: Buffer;
}> {
  const socket = net.connect(proxy.port, proxy.host);
  await once(socket, 'connect');
  socket.write([
    'CONNECT api.anthropic.com:443 HTTP/1.1',
    'Host: api.anthropic.com:443',
    ...(authorized ? [`Proxy-Authorization: ${proxyAuthorization(proxy)}`] : []),
    '',
    '',
  ].join('\r\n'));
  let response = Buffer.alloc(0);
  while (!response.includes(Buffer.from('\r\n\r\n'))) {
    const [chunk] = await once(socket, 'data') as [Buffer];
    response = Buffer.concat([response, chunk]);
  }
  return { socket, response };
}

async function connectMitm(proxy: HttpProxyHandle): Promise<tls.TLSSocket> {
  const { socket, response } = await rawConnect(proxy, true);
  const boundary = response.indexOf('\r\n\r\n') + 4;
  expect(response.subarray(0, boundary).toString()).toContain('200 Connection Established');
  const remainder = response.subarray(boundary);
  if (remainder.length > 0) socket.unshift(remainder);
  const secure = tls.connect({
    socket,
    servername: 'api.anthropic.com',
    ca: readFileSync(proxy.caCertPath, 'utf8'),
  });
  await once(secure, 'secureConnect');
  return secure;
}

beforeAll(() => {
  process.env['RELAY_AI_HOME'] = testHome;
});

afterAll(() => {
  if (previousRelayHome === undefined) delete process.env['RELAY_AI_HOME'];
  else process.env['RELAY_AI_HOME'] = previousRelayHome;
  rmSync(testHome, { recursive: true, force: true });
});

describe('transparent HTTP proxy server', () => {
  it('requires the random per-session password for CONNECT and plain HTTP', async () => {
    const proxy = await startHttpProxy({ routes: [] });
    try {
      const unauthorizedConnect = await rawConnect(proxy, false);
      expect(unauthorizedConnect.response.toString()).toContain('407 Proxy Authentication Required');
      unauthorizedConnect.socket.destroy();

      const status = await new Promise<number | undefined>((resolve, reject) => {
        const req = http.request({
          host: proxy.host,
          port: proxy.port,
          method: 'GET',
          path: 'http://example.com/',
        }, res => {
          res.resume();
          res.once('end', () => resolve(res.statusCode));
        });
        req.once('error', reject);
        req.end();
      });
      expect(status).toBe(407);
      expect(new URL(proxy.proxyUrl).password.length).toBeGreaterThanOrEqual(32);
    } finally {
      await proxy.close();
    }
  });

  it('rejects unsupported absolute-URL protocols without crashing', async () => {
    const proxy = await startHttpProxy({ routes: [] });
    try {
      const response = await new Promise<{ status?: number; body: string }>((resolve, reject) => {
        const req = http.request({
          host: proxy.host,
          port: proxy.port,
          method: 'GET',
          path: 'ftp://example.com/private',
          headers: { 'Proxy-Authorization': proxyAuthorization(proxy) },
        }, res => {
          const chunks: Buffer[] = [];
          res.on('data', chunk => chunks.push(Buffer.from(chunk)));
          res.once('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
        });
        req.once('error', reject);
        req.end();
      });
      expect(response.status).toBe(400);
      expect(response.body).toMatch(/http or https/i);
    } finally {
      await proxy.close();
    }
  });

  it('forwards native Anthropic request bytes and auth unchanged', async () => {
    let receivedBody = Buffer.alloc(0);
    let receivedAuth: string | undefined;
    const origin = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', chunk => chunks.push(Buffer.from(chunk)));
      await once(req, 'end');
      receivedBody = Buffer.concat(chunks);
      receivedAuth = req.headers.authorization;
      res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
      res.end('{"ok":true}');
    });
    const originPort = await listen(origin);
    const proxy = await startHttpProxy({
      routes: [],
      anthropicOrigin: `http://127.0.0.1:${originPort}`,
    });
    try {
      const body = Buffer.from('{\n  "model": "claude-sonnet-4-6", "messages": []\n}\n');
      const secure = await connectMitm(proxy);
      let response = '';
      secure.on('data', chunk => { response += chunk.toString(); });
      secure.write([
        'POST /v1/messages?beta=true HTTP/1.1',
        'Host: api.anthropic.com',
        'Authorization: Bearer native-anthropic-login',
        'Content-Type: application/json',
        `Content-Length: ${body.length}`,
        'Connection: close',
        '',
        '',
      ].join('\r\n') + body.toString());
      await once(secure, 'close');

      expect(response).toContain('200 OK');
      expect(receivedAuth).toBe('Bearer native-anthropic-login');
      expect(receivedBody.equals(body)).toBe(true);
    } finally {
      await proxy.close();
      await new Promise<void>(resolve => origin.close(() => resolve()));
    }
  });

  it('does not emit an uncaught exception when a tunneled client resets', async () => {
    const uncaught: Error[] = [];
    const onUncaught = (error: Error) => uncaught.push(error);
    process.on('uncaughtExceptionMonitor', onUncaught);

    const origin = net.createServer(socket => {
      socket.on('error', () => {});
      socket.write('connected');
    });
    origin.listen(0, '127.0.0.1');
    await once(origin, 'listening');
    const originAddress = origin.address();
    if (!originAddress || typeof originAddress === 'string') throw new Error('test tunnel did not bind');
    const route = {
      aliasId: 'relay:moonshot:kimi-k3',
      realModelId: 'kimi-k3-upstream',
      displayName: 'Kimi K3 (Moonshot)',
      upstreamUrl: '',
      apiKey: 'moonshot-secret',
      modelFormat: 'openai' as const,
      npm: '@ai-sdk/openai-compatible',
      providerId: 'moonshot',
    };
    const proxy = await startHttpProxy({
      routes: [route],
    });
    try {
      const socket = net.connect(proxy.port, proxy.host);
      await once(socket, 'connect');
      socket.write([
        `CONNECT 127.0.0.1:${originAddress.port} HTTP/1.1`,
        `Host: 127.0.0.1:${originAddress.port}`,
        `Proxy-Authorization: ${proxyAuthorization(proxy)}`,
        '',
        '',
      ].join('\r\n'));
      await once(socket, 'data');
      socket.resetAndDestroy();
      await once(socket, 'close');
      await new Promise(resolve => setImmediate(resolve));

      expect(uncaught).toEqual([]);
    } finally {
      process.off('uncaughtExceptionMonitor', onUncaught);
      await proxy.close();
      await new Promise<void>(resolve => origin.close(() => resolve()));
    }
  });

  it('routes only an exact allowlisted Relay model and strips Anthropic auth', async () => {
    let adapterBody = '';
    let adapterAuth: string | undefined;
    let adapterKey: string | undefined;
    let anthropicRequests = 0;
    const origin = http.createServer((req, res) => {
      anthropicRequests += 1;
      req.resume();
      res.writeHead(200, { Connection: 'close' });
      res.end('{"native":true}');
    });
    const originPort = await listen(origin);
    const adapterServer = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', chunk => chunks.push(Buffer.from(chunk)));
      await once(req, 'end');
      adapterBody = Buffer.concat(chunks).toString();
      adapterAuth = req.headers.authorization;
      adapterKey = req.headers['x-api-key'] as string | undefined;
      res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
      res.end('{"translated":true}');
    });
    const adapterPort = await listen(adapterServer);
    const route = {
      aliasId: 'relay:moonshot:kimi-k3',
      realModelId: 'kimi-k3-upstream',
      displayName: 'Kimi K3 (Moonshot)',
      upstreamUrl: '',
      apiKey: 'moonshot-secret',
      modelFormat: 'openai' as const,
      npm: '@ai-sdk/openai-compatible',
      providerId: 'moonshot',
    };
    const proxy = await startHttpProxy({
      routes: [route],
      adapterHandle: {
        port: adapterPort,
        token: 'adapter-local-token',
        close: () => adapterServer.close(),
      },
      anthropicOrigin: `http://127.0.0.1:${originPort}`,
    });
    try {
      const body = JSON.stringify({ model: route.aliasId, messages: [], stream: false });
      const secure = await connectMitm(proxy);
      secure.resume();
      secure.write([
        'POST /v1/messages HTTP/1.1',
        'Host: api.anthropic.com',
        'Authorization: Bearer native-anthropic-login',
        'Content-Type: application/json',
        `Content-Length: ${Buffer.byteLength(body)}`,
        'Connection: close',
        '',
        '',
      ].join('\r\n') + body);
      await once(secure, 'close');

      expect(anthropicRequests).toBe(0);
      expect(adapterAuth).toBeUndefined();
      expect(adapterKey).toBe('adapter-local-token');
      expect(JSON.parse(adapterBody)).toMatchObject({ model: route.aliasId });
    } finally {
      await proxy.close();
      await new Promise<void>(resolve => origin.close(() => resolve()));
    }
  });

  it('keeps unknown Relay-looking model names on the native Anthropic path', async () => {
    let anthropicAuth: string | undefined;
    let adapterRequests = 0;
    const origin = http.createServer((req, res) => {
      anthropicAuth = req.headers.authorization;
      req.resume();
      res.writeHead(200, { Connection: 'close' });
      res.end('{"native":true}');
    });
    const adapterServer = http.createServer((req, res) => {
      adapterRequests += 1;
      req.resume();
      res.end('{"translated":true}');
    });
    const originPort = await listen(origin);
    const adapterPort = await listen(adapterServer);
    const proxy = await startHttpProxy({
      routes: [{
        aliasId: 'relay:moonshot:kimi-k3',
        realModelId: 'kimi-k3-upstream',
        displayName: 'Kimi K3 (Moonshot)',
        upstreamUrl: '',
        apiKey: 'moonshot-secret',
        modelFormat: 'openai',
        npm: '@ai-sdk/openai-compatible',
        providerId: 'moonshot',
      }],
      adapterHandle: {
        port: adapterPort,
        token: 'adapter-local-token',
        close: () => adapterServer.close(),
      },
      anthropicOrigin: `http://127.0.0.1:${originPort}`,
    });
    try {
      const body = JSON.stringify({ model: 'relay:moonshot:not-allowlisted', messages: [] });
      const secure = await connectMitm(proxy);
      secure.resume();
      secure.write([
        'POST /v1/messages HTTP/1.1',
        'Host: api.anthropic.com',
        'Authorization: Bearer native-anthropic-login',
        'Content-Type: application/json',
        `Content-Length: ${Buffer.byteLength(body)}`,
        'Connection: close',
        '',
        '',
      ].join('\r\n') + body);
      await once(secure, 'close');

      expect(adapterRequests).toBe(0);
      expect(anthropicAuth).toBe('Bearer native-anthropic-login');
    } finally {
      await proxy.close();
      await new Promise<void>(resolve => origin.close(() => resolve()));
    }
  });

  it('answers count_tokens locally for a Relay model without spending provider quota', async () => {
    let anthropicRequests = 0;
    let adapterRequests = 0;
    const origin = http.createServer((req, res) => {
      anthropicRequests += 1;
      req.resume();
      res.end('{"native":true}');
    });
    const adapterServer = http.createServer((req, res) => {
      adapterRequests += 1;
      req.resume();
      res.end('{"translated":true}');
    });
    const originPort = await listen(origin);
    const adapterPort = await listen(adapterServer);
    const route = {
      aliasId: 'relay:moonshot:kimi-k3',
      realModelId: 'kimi-k3-upstream',
      displayName: 'Kimi K3 (Moonshot)',
      upstreamUrl: '',
      apiKey: 'moonshot-secret',
      modelFormat: 'openai' as const,
      npm: '@ai-sdk/openai-compatible',
      providerId: 'moonshot',
    };
    const proxy = await startHttpProxy({
      routes: [route],
      adapterHandle: {
        port: adapterPort,
        token: 'adapter-local-token',
        close: () => adapterServer.close(),
      },
      anthropicOrigin: `http://127.0.0.1:${originPort}`,
    });
    try {
      const body = JSON.stringify({
        model: route.aliasId,
        system: 'You are helpful.',
        messages: [{ role: 'user', content: 'Count this prompt.' }],
      });
      const secure = await connectMitm(proxy);
      let response = '';
      secure.on('data', chunk => { response += chunk.toString(); });
      secure.write([
        'POST /v1/messages/count_tokens HTTP/1.1',
        'Host: api.anthropic.com',
        'Content-Type: application/json',
        `Content-Length: ${Buffer.byteLength(body)}`,
        'Connection: close',
        '',
        '',
      ].join('\r\n') + body);
      await once(secure, 'close');

      expect(response).toContain('200 OK');
      expect(response).toContain('x-relay-token-count-source: local-estimate');
      expect(response).toMatch(/"input_tokens":\d+/);
      expect(anthropicRequests).toBe(0);
      expect(adapterRequests).toBe(0);
    } finally {
      await proxy.close();
      await new Promise<void>(resolve => origin.close(() => resolve()));
    }
  });

  it('cancels the adapter request when Claude disconnects', async () => {
    let adapterReceivedResolve!: () => void;
    const adapterReceived = new Promise<void>(resolve => { adapterReceivedResolve = resolve; });
    let adapterClosedResolve!: () => void;
    const adapterClosed = new Promise<void>(resolve => { adapterClosedResolve = resolve; });
    const adapterServer = http.createServer(req => {
      req.resume();
      req.once('end', adapterReceivedResolve);
      req.socket.once('close', adapterClosedResolve);
    });
    const adapterPort = await listen(adapterServer);
    const route = {
      aliasId: 'relay:moonshot:kimi-k3',
      realModelId: 'kimi-k3-upstream',
      displayName: 'Kimi K3 (Moonshot)',
      upstreamUrl: '',
      apiKey: 'moonshot-secret',
      modelFormat: 'openai' as const,
      npm: '@ai-sdk/openai-compatible',
      providerId: 'moonshot',
    };
    const proxy = await startHttpProxy({
      routes: [route],
      adapterHandle: {
        port: adapterPort,
        token: 'adapter-local-token',
        close: () => {
          adapterServer.closeAllConnections();
          adapterServer.close();
        },
      },
    });
    try {
      const body = JSON.stringify({ model: route.aliasId, messages: [], stream: true });
      const secure = await connectMitm(proxy);
      secure.on('error', () => {});
      secure.write([
        'POST /v1/messages HTTP/1.1',
        'Host: api.anthropic.com',
        'Content-Type: application/json',
        `Content-Length: ${Buffer.byteLength(body)}`,
        '',
        '',
      ].join('\r\n') + body);
      await adapterReceived;
      secure.destroy();
      await Promise.race([
        adapterClosed,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('adapter stayed open')), 1_000)),
      ]);
    } finally {
      await proxy.close();
    }
  }, 10_000);

  it('removes the session CA when the proxy closes', async () => {
    const proxy = await startHttpProxy({ routes: [] });
    const certPath = proxy.caCertPath;
    expect(existsSync(certPath)).toBe(true);
    await proxy.close();
    expect(existsSync(certPath)).toBe(false);
  });
});
