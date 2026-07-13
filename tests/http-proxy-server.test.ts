import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as https from 'node:https';
import * as http from 'node:http';
import * as net from 'node:net';
import * as tls from 'node:tls';
import { once } from 'node:events';
import { ensureHttpProxyCaBundle, ensureHttpProxyCertificates } from '../src/http-proxy/ca.js';
import { shouldInterceptConnect, startHttpProxy } from '../src/http-proxy/server.js';

const testHome = mkdtempSync(join(tmpdir(), 'relay-ai-http-proxy-'));
const previousRelayHome = process.env['RELAY_AI_HOME'];

async function listen(server: http.Server | https.Server): Promise<number> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server did not bind');
  return address.port;
}

async function connectMitm(proxyPort: number, ca: string): Promise<tls.TLSSocket> {
  const socket = net.connect(proxyPort, '127.0.0.1');
  await once(socket, 'connect');
  socket.write('CONNECT api.anthropic.com:443 HTTP/1.1\r\nHost: api.anthropic.com:443\r\n\r\n');

  let response = Buffer.alloc(0);
  while (!response.includes(Buffer.from('\r\n\r\n'))) {
    const [chunk] = await once(socket, 'data') as [Buffer];
    response = Buffer.concat([response, chunk]);
  }
  const boundary = response.indexOf('\r\n\r\n') + 4;
  expect(response.subarray(0, boundary).toString()).toContain('200 Connection Established');
  const remainder = response.subarray(boundary);
  if (remainder.length > 0) socket.unshift(remainder);

  const secure = tls.connect({ socket, servername: 'api.anthropic.com', ca });
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

describe('selective HTTP proxy', () => {
  it('preserves an existing custom CA in the child trust bundle', () => {
    const certificates = ensureHttpProxyCertificates();
    const extraPath = join(testHome, 'corporate-ca.pem');
    writeFileSync(extraPath, '-----BEGIN CERTIFICATE-----\ncorporate-test\n-----END CERTIFICATE-----\n');
    const combinedPath = ensureHttpProxyCaBundle(certificates.caCertPath, extraPath);
    const combined = readFileSync(combinedPath, 'utf8');
    expect(combinedPath).not.toBe(certificates.caCertPath);
    expect(combined).toContain(certificates.caCert.trim());
    expect(combined).toContain('corporate-test');
  });

  it('intercepts only api.anthropic.com on port 443', () => {
    expect(shouldInterceptConnect('api.anthropic.com:443')).toBe(true);
    expect(shouldInterceptConnect('API.ANTHROPIC.COM.:443')).toBe(true);
    expect(shouldInterceptConnect('api.anthropic.com:8443')).toBe(false);
    expect(shouldInterceptConnect('statsig.anthropic.com:443')).toBe(false);
    expect(shouldInterceptConnect('example.com:443')).toBe(false);
  });

  it('forwards first-party request bytes and auth unchanged', async () => {
    const certificates = ensureHttpProxyCertificates();
    const inferenceLogPath = join(testHome, 'anthropic-inference.jsonl');
    let receivedBody = Buffer.alloc(0);
    let receivedAuth: string | undefined;
    let receivedPath: string | undefined;
    const origin = https.createServer({
      key: certificates.serverKey,
      cert: certificates.serverCert,
    }, async (req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', chunk => chunks.push(Buffer.from(chunk)));
      await once(req, 'end');
      receivedBody = Buffer.concat(chunks);
      receivedAuth = req.headers.authorization;
      receivedPath = req.url;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
    const originPort = await listen(origin);
    const proxy = await startHttpProxy({
      routes: [],
      inferenceLogPath,
      anthropicOrigin: `https://127.0.0.1:${originPort}`,
      anthropicRejectUnauthorized: false,
    });

    try {
      const body = Buffer.from('{\n  "model" : "claude-sonnet-4-6",\n  "output_config":{"effort":"high"},\n  "messages":[]\n}\n');
      const secure = await connectMitm(proxy.port, certificates.caCert);
      let response = '';
      secure.on('data', chunk => { response += chunk.toString(); });
      secure.write([
        'POST /v1/messages?beta=true HTTP/1.1',
        'Host: api.anthropic.com',
        'Authorization: Bearer subscription-oauth-token',
        'Content-Type: application/json',
        `Content-Length: ${body.length}`,
        'Connection: close',
        '',
        '',
      ].join('\r\n') + body.toString());
      await once(secure, 'close');

      expect(response).toContain('200 OK');
      expect(receivedPath).toBe('/v1/messages?beta=true');
      expect(receivedAuth).toBe('Bearer subscription-oauth-token');
      expect(receivedBody.equals(body)).toBe(true);
      expect(JSON.parse(readFileSync(inferenceLogPath, 'utf8').trim())).toMatchObject({
        modelId: 'claude-sonnet-4-6',
        effort: 'high',
        provider: 'anthropic',
        route: 'passthrough',
      });
    } finally {
      await proxy.close();
      await new Promise<void>(resolve => origin.close(() => resolve()));
    }
  }, 20_000);

  it('routes only an exact relay model and strips Anthropic auth from the adapter hop', async () => {
    const certificates = ensureHttpProxyCertificates();
    const inferenceLogPath = join(testHome, 'relay-inference.jsonl');
    let adapterAuth: string | undefined;
    let adapterApiKey: string | undefined;
    let adapterBody = '';
    let anthropicRequests = 0;
    let fallbackAuth: string | undefined;

    const origin = https.createServer({
      key: certificates.serverKey,
      cert: certificates.serverCert,
    }, async (req, res) => {
      anthropicRequests += 1;
      fallbackAuth = req.headers.authorization;
      const ended = once(req, 'end');
      req.resume();
      await ended;
      res.setHeader('Connection', 'close');
      res.end('{"unexpected":true}');
    });
    const originPort = await listen(origin);

    const adapterServer = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', chunk => chunks.push(Buffer.from(chunk)));
      await once(req, 'end');
      adapterAuth = req.headers.authorization;
      adapterApiKey = req.headers['x-api-key'] as string | undefined;
      adapterBody = Buffer.concat(chunks).toString();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Connection': 'close' });
      res.end('{"type":"message","content":[]}');
    });
    const adapterPort = await listen(adapterServer);
    const proxy = await startHttpProxy({
      routes: [{
        aliasId: 'relay:groq:llama-3.3-70b',
        realModelId: 'llama-3.3-70b-versatile',
        displayName: 'Llama 3.3 70B (Groq)',
        upstreamUrl: '',
        apiKey: 'provider-key',
        modelFormat: 'openai',
        npm: '@ai-sdk/groq',
        providerId: 'groq',
      }],
      adapterHandle: {
        port: adapterPort,
        token: 'adapter-local-token',
        close: () => {
          adapterServer.closeAllConnections();
          adapterServer.close();
        },
      },
      anthropicOrigin: `https://127.0.0.1:${originPort}`,
      anthropicRejectUnauthorized: false,
      inferenceLogPath,
    });

    try {
      const body = JSON.stringify({
        model: 'relay:groq:llama-3.3-70b',
        output_config: { effort: 'medium' },
        messages: [],
      });
      const secure = await connectMitm(proxy.port, certificates.caCert);
      let response = '';
      secure.on('data', chunk => { response += chunk.toString(); });
      secure.write([
        'POST /v1/messages HTTP/1.1',
        'Host: api.anthropic.com',
        'Authorization: Bearer subscription-oauth-token',
        'Content-Type: application/json',
        `Content-Length: ${Buffer.byteLength(body)}`,
        'Connection: close',
        '',
        '',
      ].join('\r\n') + body);
      await once(secure, 'close');

      expect(response).toContain('200 OK');
      expect(anthropicRequests).toBe(0);
      expect(adapterAuth).toBeUndefined();
      expect(adapterApiKey).toBe('adapter-local-token');
      expect(adapterBody).toBe(body);
      expect(JSON.parse(readFileSync(inferenceLogPath, 'utf8').trim())).toMatchObject({
        modelId: 'relay:groq:llama-3.3-70b',
        effort: 'medium',
        provider: 'groq',
        route: 'translated',
      });

      const typoBody = JSON.stringify({ model: 'relay:groq:typo', messages: [] });
      const typoSocket = await connectMitm(proxy.port, certificates.caCert);
      typoSocket.resume();
      typoSocket.write([
        'POST /v1/messages HTTP/1.1',
        'Host: api.anthropic.com',
        'Authorization: Bearer subscription-oauth-token',
        'Content-Type: application/json',
        `Content-Length: ${Buffer.byteLength(typoBody)}`,
        'Connection: close',
        '',
        '',
      ].join('\r\n') + typoBody);
      await once(typoSocket, 'close');
      expect(anthropicRequests).toBe(1);
      expect(fallbackAuth).toBe('Bearer subscription-oauth-token');
      const inferenceEntries = readFileSync(inferenceLogPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      expect(inferenceEntries[1]).toMatchObject({
        modelId: 'relay:groq:typo',
        provider: 'anthropic',
        route: 'passthrough',
      });
    } finally {
      await proxy.close();
      await new Promise<void>(resolve => origin.close(() => resolve()));
    }
  }, 20_000);
});
