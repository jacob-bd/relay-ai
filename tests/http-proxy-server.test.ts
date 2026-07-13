import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as https from 'node:https';
import * as http from 'node:http';
import * as net from 'node:net';
import * as tls from 'node:tls';
import { once } from 'node:events';
import { gzipSync } from 'node:zlib';
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
    const previousRequestPreview = process.env['RELAY_AI_LOG_REQUEST_PREVIEW'];
    process.env['RELAY_AI_LOG_REQUEST_PREVIEW'] = '1';
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
      const sse = [
        'event: message_start',
        'data: {"type":"message_start","message":{"usage":{"input_tokens":321,"output_tokens":1,"cache_creation_input_tokens":12,"cache_read_input_tokens":210}}}',
        '',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"private response text"}}',
        '',
        '',
      ].join('\n');
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Content-Encoding': 'gzip',
      });
      res.end(gzipSync(sse));
    });
    const originPort = await listen(origin);
    const proxy = await startHttpProxy({
      routes: [],
      inferenceLogPath,
      anthropicOrigin: `https://127.0.0.1:${originPort}`,
      anthropicRejectUnauthorized: false,
    });

    try {
      const body = Buffer.from('{\n  "model" : "claude-sonnet-4-6",\n  "output_config":{"effort":"high"},\n  "messages":[{"role":"user","content":[{"type":"image","source":{"type":"base64","data":"private-image-data"}},{"type":"text","text":"identify this Sonnet request"}]}],\n  "stream":true\n}\n');
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
      const inferenceLog = readFileSync(inferenceLogPath, 'utf8');
      const entries = inferenceLog.trim().split('\n').map(line => JSON.parse(line));
      expect(entries[0]).toMatchObject({
        modelId: 'claude-sonnet-4-6',
        effort: 'high',
        provider: 'anthropic',
        route: 'passthrough',
        requestPreview: 'user: identify this Sonnet request',
      });
      expect(entries[1]).toMatchObject({
        event: 'response_usage',
        requestId: entries[0].requestId,
        modelId: 'claude-sonnet-4-6',
        provider: 'anthropic',
        route: 'passthrough',
        usageStage: 'message_start',
        inputTokens: 321,
        outputTokens: 1,
        cacheCreationInputTokens: 12,
        cacheReadInputTokens: 210,
      });
      expect(inferenceLog).not.toContain('private-image-data');
      expect(inferenceLog).not.toContain('private response text');
    } finally {
      if (previousRequestPreview === undefined) delete process.env['RELAY_AI_LOG_REQUEST_PREVIEW'];
      else process.env['RELAY_AI_LOG_REQUEST_PREVIEW'] = previousRequestPreview;
      await proxy.close();
      await new Promise<void>(resolve => origin.close(() => resolve()));
    }
  }, 20_000);

  it('logs Haiku passthrough status, error body, and system fallback preview', async () => {
    const certificates = ensureHttpProxyCertificates();
    const inferenceLogPath = join(testHome, 'haiku-error-inference.jsonl');
    const previousRequestPreview = process.env['RELAY_AI_LOG_REQUEST_PREVIEW'];
    process.env['RELAY_AI_LOG_REQUEST_PREVIEW'] = '1';
    const origin = https.createServer({
      key: certificates.serverKey,
      cert: certificates.serverCert,
    }, async (req, res) => {
      const ended = once(req, 'end');
      req.resume();
      await ended;
      res.writeHead(529, { 'Content-Type': 'application/json', 'Connection': 'close' });
      res.end(JSON.stringify({
        type: 'error',
        error: { type: 'overloaded_error', message: 'Haiku overloaded for Bearer sk-secret123456789' },
      }));
    });
    const originPort = await listen(origin);
    const proxy = await startHttpProxy({
      routes: [],
      inferenceLogPath,
      anthropicOrigin: `https://127.0.0.1:${originPort}`,
      anthropicRejectUnauthorized: false,
    });

    try {
      const body = JSON.stringify({
        model: 'claude-haiku-4-5',
        system: [{ type: 'text', text: 'Generate a concise title for this Claude Code session.' }],
        messages: [{ role: 'user', content: [{ type: 'tool_result', content: 'private tool output' }] }],
        stream: true,
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

      expect(response).toContain('529');
      const entries = readFileSync(inferenceLogPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      expect(entries[0]).toMatchObject({
        modelId: 'claude-haiku-4-5',
        provider: 'anthropic',
        route: 'passthrough',
        requestPreview: 'user: [tool_result] | system: Generate a concise title for this Claude Code session.',
      });
      expect(entries[1]).toMatchObject({
        event: 'upstream_error',
        modelId: 'claude-haiku-4-5',
        provider: 'anthropic',
        route: 'passthrough',
        statusCode: 529,
      });
      expect(entries[1].errorContent).toContain('Haiku overloaded');
      expect(entries[1].errorContent).toContain('[REDACTED]');
      expect(readFileSync(inferenceLogPath, 'utf8')).not.toContain('private tool output');
    } finally {
      if (previousRequestPreview === undefined) delete process.env['RELAY_AI_LOG_REQUEST_PREVIEW'];
      else process.env['RELAY_AI_LOG_REQUEST_PREVIEW'] = previousRequestPreview;
      await proxy.close();
      await new Promise<void>(resolve => origin.close(() => resolve()));
    }
  }, 20_000);

  it('logs a partial upstream error body when the origin resets before end', async () => {
    const certificates = ensureHttpProxyCertificates();
    const inferenceLogPath = join(testHome, 'partial-error-inference.jsonl');
    const previousRequestPreview = process.env['RELAY_AI_LOG_REQUEST_PREVIEW'];
    process.env['RELAY_AI_LOG_REQUEST_PREVIEW'] = '1';
    const origin = https.createServer({
      key: certificates.serverKey,
      cert: certificates.serverCert,
    }, async (req, res) => {
      const ended = once(req, 'end');
      req.resume();
      await ended;
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.flushHeaders();
      res.write('{"error":{"message":"partial outage');
      setImmediate(() => res.destroy(new Error('origin reset')));
    });
    const originPort = await listen(origin);
    const proxy = await startHttpProxy({
      routes: [],
      inferenceLogPath,
      anthropicOrigin: `https://127.0.0.1:${originPort}`,
      anthropicRejectUnauthorized: false,
    });

    try {
      const body = JSON.stringify({
        model: 'claude-haiku-4-5',
        messages: [{ role: 'user', content: 'test partial error logging' }],
        stream: true,
      });
      const secure = await connectMitm(proxy.port, certificates.caCert);
      secure.resume();
      secure.write([
        'POST /v1/messages HTTP/1.1',
        'Host: api.anthropic.com',
        'Content-Type: application/json',
        `Content-Length: ${Buffer.byteLength(body)}`,
        'Connection: close',
        '',
        '',
      ].join('\r\n') + body);
      await new Promise<void>(resolve => {
        secure.once('close', () => resolve());
        secure.once('error', () => resolve());
      });

      const entries = readFileSync(inferenceLogPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      expect(entries[1]).toMatchObject({
        event: 'upstream_error',
        modelId: 'claude-haiku-4-5',
        statusCode: 503,
      });
      expect(entries[1].errorContent).toContain('partial outage');
      expect(entries[1].errorContent).toContain('stream error');
    } finally {
      if (previousRequestPreview === undefined) delete process.env['RELAY_AI_LOG_REQUEST_PREVIEW'];
      else process.env['RELAY_AI_LOG_REQUEST_PREVIEW'] = previousRequestPreview;
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
      await new Promise(resolve => setTimeout(resolve, 35));
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Connection': 'close' });
      res.end([
        'event: message_start',
        'data: {"type":"message_start","message":{"usage":{"input_tokens":0,"output_tokens":0}}}',
        '',
        'event: message_stop',
        'data: {"type":"message_stop"}',
        '',
        '',
      ].join('\n'));
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
      responseProgressIntervalMs: 10,
    });

    try {
      const body = JSON.stringify({
        model: 'relay:groq:llama-3.3-70b',
        output_config: { effort: 'medium' },
        messages: [],
        stream: true,
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
      const relayEntries = readFileSync(inferenceLogPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      const requestEntry = relayEntries.find(entry => !entry.event);
      expect(requestEntry).toMatchObject({
        modelId: 'relay:groq:llama-3.3-70b',
        effort: 'medium',
        provider: 'groq',
        route: 'translated',
        stream: true,
      });
      expect(requestEntry.requestId).toEqual(expect.any(String));
      expect(relayEntries).toContainEqual(expect.objectContaining({
        event: 'response_progress',
        requestId: requestEntry.requestId,
        phase: 'waiting_for_headers',
        bytes: 0,
        chunks: 0,
      }));
      expect(relayEntries).toContainEqual(expect.objectContaining({
        event: 'response_started',
        requestId: requestEntry.requestId,
        statusCode: 200,
      }));
      expect(relayEntries).toContainEqual(expect.objectContaining({
        event: 'response_usage',
        requestId: requestEntry.requestId,
        modelId: 'relay:groq:llama-3.3-70b',
        provider: 'groq',
        route: 'translated',
        usageStage: 'message_start',
        inputTokens: 0,
        outputTokens: 0,
      }));
      expect(relayEntries).toContainEqual(expect.objectContaining({
        event: 'response_completed',
        requestId: requestEntry.requestId,
        statusCode: 200,
      }));

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
      expect(inferenceEntries.find(entry => !entry.event && entry.modelId === 'relay:groq:typo')).toMatchObject({
        modelId: 'relay:groq:typo',
        provider: 'anthropic',
        route: 'passthrough',
      });
    } finally {
      await proxy.close();
      await new Promise<void>(resolve => origin.close(() => resolve()));
    }
  }, 20_000);

  it('routes count_tokens to the adapter without recording it as inference', async () => {
    const certificates = ensureHttpProxyCertificates();
    const inferenceLogPath = join(testHome, 'count-tokens-inference.jsonl');
    let adapterPath: string | undefined;
    let anthropicRequests = 0;

    const origin = https.createServer({
      key: certificates.serverKey,
      cert: certificates.serverCert,
    }, (req, res) => {
      anthropicRequests += 1;
      req.resume();
      res.end('{"unexpected":true}');
    });
    const originPort = await listen(origin);
    const adapterServer = http.createServer(async (req, res) => {
      adapterPath = req.url;
      const ended = once(req, 'end');
      req.resume();
      await ended;
      res.writeHead(200, { 'Content-Type': 'application/json', 'Connection': 'close' });
      res.end('{"input_tokens":42}');
    });
    const adapterPort = await listen(adapterServer);
    const route = {
      aliasId: 'relay:test:translated-model',
      realModelId: 'translated-model',
      displayName: 'Translated Model',
      upstreamUrl: '',
      apiKey: 'provider-key',
      modelFormat: 'openai' as const,
      npm: '@ai-sdk/openai-compatible',
      providerId: 'test-provider',
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
      anthropicOrigin: `https://127.0.0.1:${originPort}`,
      anthropicRejectUnauthorized: false,
      inferenceLogPath,
    });

    try {
      const body = JSON.stringify({
        model: route.aliasId,
        messages: [{ role: 'user', content: 'count this' }],
      });
      const secure = await connectMitm(proxy.port, certificates.caCert);
      let response = '';
      secure.on('data', chunk => { response += chunk.toString(); });
      secure.write([
        'POST /v1/messages/count_tokens?beta=true HTTP/1.1',
        'Host: api.anthropic.com',
        'Content-Type: application/json',
        `Content-Length: ${Buffer.byteLength(body)}`,
        'Connection: close',
        '',
        '',
      ].join('\r\n') + body);
      await once(secure, 'close');

      expect(response).toContain('200 OK');
      expect(response).toContain('{"input_tokens":42}');
      expect(adapterPath).toBe('/v1/messages/count_tokens?beta=true');
      expect(anthropicRequests).toBe(0);
      expect(existsSync(inferenceLogPath)).toBe(false);
    } finally {
      await proxy.close();
      await new Promise<void>(resolve => origin.close(() => resolve()));
    }
  }, 20_000);

  it('closes the adapter request and logs a terminal client disconnect', async () => {
    const certificates = ensureHttpProxyCertificates();
    const inferenceLogPath = join(testHome, 'client-disconnect-inference.jsonl');
    let adapterReceivedResolve!: () => void;
    const adapterReceived = new Promise<void>(resolve => { adapterReceivedResolve = resolve; });
    let adapterClosedResolve!: () => void;
    const adapterClosed = new Promise<void>(resolve => { adapterClosedResolve = resolve; });
    const adapterServer = http.createServer((req) => {
      req.resume();
      req.once('end', adapterReceivedResolve);
      req.socket.once('close', adapterClosedResolve);
    });
    const adapterPort = await listen(adapterServer);
    const route = {
      aliasId: 'relay:test:translated-model',
      realModelId: 'translated-model',
      displayName: 'Translated Model',
      upstreamUrl: '',
      apiKey: 'provider-key',
      modelFormat: 'openai' as const,
      npm: '@ai-sdk/openai-compatible',
      providerId: 'test-provider',
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
      inferenceLogPath,
    });

    try {
      const body = JSON.stringify({
        model: route.aliasId,
        messages: [{ role: 'user', content: 'wait forever' }],
        stream: false,
      });
      const secure = await connectMitm(proxy.port, certificates.caCert);
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
      await adapterClosed;
      await new Promise(resolve => setImmediate(resolve));

      const entries = readFileSync(inferenceLogPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      const requestEntry = entries.find(entry => !entry.event);
      expect(entries).toContainEqual(expect.objectContaining({
        event: 'response_client_disconnected',
        requestId: requestEntry.requestId,
        phase: 'waiting_for_headers',
      }));
      expect(entries.some(entry => entry.event === 'response_completed')).toBe(false);
      expect(entries.some(entry => entry.event === 'response_failed')).toBe(false);
    } finally {
      await proxy.close();
    }
  }, 20_000);

  it('terminates and logs a translated response when the adapter closes before end', async () => {
    const certificates = ensureHttpProxyCertificates();
    const inferenceLogPath = join(testHome, 'adapter-abort-inference.jsonl');
    const adapterServer = http.createServer(async (req, res) => {
      const ended = once(req, 'end');
      req.resume();
      await ended;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('event: message_start\ndata: {"type":"message_start"}\n\n');
      setImmediate(() => res.destroy(new Error('adapter reset')));
    });
    const adapterPort = await listen(adapterServer);
    const route = {
      aliasId: 'relay:test:translated-model',
      realModelId: 'translated-model',
      displayName: 'Translated Model',
      upstreamUrl: '',
      apiKey: 'provider-key',
      modelFormat: 'openai' as const,
      npm: '@ai-sdk/openai-compatible',
      providerId: 'test-provider',
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
      inferenceLogPath,
    });

    try {
      const body = JSON.stringify({
        model: route.aliasId,
        messages: [{ role: 'user', content: 'test adapter reset' }],
        stream: true,
      });
      const secure = await connectMitm(proxy.port, certificates.caCert);
      secure.resume();
      secure.write([
        'POST /v1/messages HTTP/1.1',
        'Host: api.anthropic.com',
        'Content-Type: application/json',
        `Content-Length: ${Buffer.byteLength(body)}`,
        'Connection: close',
        '',
        '',
      ].join('\r\n') + body);
      await new Promise<void>(resolve => {
        secure.once('close', () => resolve());
        secure.once('error', () => resolve());
      });

      const entries = readFileSync(inferenceLogPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      const requestEntry = entries.find(entry => !entry.event);
      expect(entries).toContainEqual(expect.objectContaining({
        event: 'response_started',
        requestId: requestEntry.requestId,
        statusCode: 200,
      }));
      expect(entries).toContainEqual(expect.objectContaining({
        event: 'response_failed',
        requestId: requestEntry.requestId,
        statusCode: 200,
        phase: 'streaming',
      }));
      expect(entries.some(entry => entry.event === 'response_completed')).toBe(false);
    } finally {
      await proxy.close();
    }
  }, 20_000);
});
