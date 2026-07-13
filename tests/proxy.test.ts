// tests/proxy.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import http from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aliasModelId, startProxyCatalog, type ProxyRoute } from '../src/proxy.js';
import { getProxyDebugLogPath } from '../src/trace-log.js';
import { anthropicMessagesEndpoint, estimateAnthropicInputTokens } from '../src/anthropic-endpoints.js';

/** POST JSON to a local proxy via node:http (avoids vi.stubGlobal('fetch') interception). */
function postToProxy(
  port: number,
  token: string,
  body: unknown,
  relayRequestId?: string,
  path = '/v1/messages',
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(payload),
          ...(relayRequestId ? { 'x-relay-request-id': relayRequestId } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

describe('Anthropic endpoint routing', () => {
  it('matches messages and count_tokens exactly, including query strings', () => {
    expect(anthropicMessagesEndpoint('/v1/messages?beta=true')).toBe('messages');
    expect(anthropicMessagesEndpoint('/v1/messages/count_tokens?beta=true')).toBe('count_tokens');
    expect(anthropicMessagesEndpoint('/v1/messages/batches')).toBeNull();
    expect(anthropicMessagesEndpoint('/v1/messages-not-real')).toBeNull();
  });

  it('estimates only input-context fields', () => {
    const base = estimateAnthropicInputTokens({
      model: 'relay:test:model',
      messages: [{ role: 'user', content: 'hello world' }],
    });
    expect(base).toBeGreaterThan(0);
    expect(estimateAnthropicInputTokens({
      model: 'a-different-model',
      stream: true,
      max_tokens: 128_000,
      messages: [{ role: 'user', content: 'hello world' }],
    })).toBe(base);
  });
});

describe('aliasModelId', () => {
  it('returns claude-* ids unchanged', () => {
    expect(aliasModelId('claude-sonnet-4', 'Anthropic')).toBe('claude-sonnet-4');
  });

  it('prefixes non-claude ids with anthropic-{providerId}__', () => {
    expect(aliasModelId('grok-4.3', 'xai')).toBe('anthropic-xai__grok-4.3');
  });

  it('uses stable provider id slug in alias', () => {
    expect(aliasModelId('deepseek-v4', 'go')).toBe('anthropic-go__deepseek-v4');
  });
});

describe('cloud-code handler 401 retry', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('retries with refreshed token on upstream 401 and succeeds', async () => {
    const refreshToken = vi.fn().mockResolvedValue('refreshed-token');
    const route: ProxyRoute = {
      aliasId: 'claude-sonnet-4-6',
      realModelId: 'claude-sonnet-4-6',
      displayName: 'Claude Sonnet',
      upstreamUrl: 'https://cloudcode.googleapis.com',
      apiKey: 'original-token',
      modelFormat: 'cloud-code',
      providerId: 'antigravity',
      authType: 'oauth',
      providerData: { projectId: 'proj-123' },
      refreshToken,
    };

    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url: string, opts: RequestInit) => {
      callCount++;
      const auth = (opts.headers as Record<string, string>)['Authorization'];
      if (auth === 'Bearer original-token') {
        return { ok: false, status: 401, text: async () => 'token expired' };
      }
      // second call with refreshed token
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'text/event-stream' },
        body: { getReader: () => ({ read: vi.fn().mockResolvedValue({ done: true }) }) },
      };
    }));

    const handle = await startProxyCatalog([route], route.aliasId, false);
    const res = await postToProxy(handle.port, handle.token, {
      model: 'claude-sonnet-4-6',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hi' }],
      stream: false,
    });

    handle.close();
    expect(refreshToken).toHaveBeenCalledOnce();
    expect(callCount).toBe(2); // original + retry
    expect(res.status).not.toBe(401);
  });

  it('does not retry when refreshToken is not set', async () => {
    const route: ProxyRoute = {
      aliasId: 'claude-sonnet-4-6',
      realModelId: 'claude-sonnet-4-6',
      displayName: 'Claude Sonnet',
      upstreamUrl: 'https://cloudcode.googleapis.com',
      apiKey: 'original-token',
      modelFormat: 'cloud-code',
      providerId: 'antigravity',
      authType: 'oauth',
      providerData: { projectId: 'proj-123' },
      // no refreshToken
    };

    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      callCount++;
      return { ok: false, status: 401, text: async () => 'token expired' };
    }));

    const handle = await startProxyCatalog([route], route.aliasId, false);
    await postToProxy(handle.port, handle.token, {
      model: 'claude-sonnet-4-6',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hi' }],
      stream: false,
    });

    handle.close();
    expect(callCount).toBe(1); // no retry
  });
});

describe('SDK anonymous route handling', () => {
  it('does not reject empty upstream keys before SDK routing', async () => {
    const route: ProxyRoute = {
      aliasId: 'anthropic-kilo__tencent/hy3:free',
      realModelId: 'tencent/hy3:free',
      displayName: 'Tencent Hy3',
      upstreamUrl: '',
      apiKey: '',
      modelFormat: 'openai',
      npm: 'missing-sdk-provider-for-test',
      baseURL: 'https://api.kilo.ai/api/gateway',
      providerId: 'kilo',
    };

    const handle = await startProxyCatalog([route], route.aliasId, false);
    const res = await postToProxy(handle.port, handle.token, {
      model: route.aliasId,
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hi' }],
      stream: false,
    });

    handle.close();
    expect(res.status).toBe(502);
    expect(res.body).not.toContain('Missing API key');
  });
});

describe('token counting', () => {
  it('returns a local estimate for translated routes without loading or invoking the provider', async () => {
    const route: ProxyRoute = {
      aliasId: 'relay:test:translated-model',
      realModelId: 'translated-model',
      displayName: 'Translated Model',
      upstreamUrl: '',
      apiKey: '',
      modelFormat: 'openai',
      npm: 'missing-sdk-provider-that-must-not-load',
      providerId: 'test-provider',
    };
    const handle = await startProxyCatalog([route], route.aliasId, false);

    try {
      const res = await postToProxy(handle.port, handle.token, {
        model: route.aliasId,
        messages: [{ role: 'user', content: 'count this context locally' }],
      }, undefined, '/v1/messages/count_tokens?beta=true');

      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ input_tokens: expect.any(Number) });
      expect(JSON.parse(res.body).input_tokens).toBeGreaterThan(0);
    } finally {
      handle.close();
    }
  });

  it('forwards native Anthropic token counts with the real upstream model id', async () => {
    const fetchMock = vi.fn(async () => new Response('{"input_tokens":17}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const route: ProxyRoute = {
      aliasId: 'relay:anthropic:sonnet',
      realModelId: 'claude-sonnet-4-6',
      displayName: 'Claude Sonnet',
      upstreamUrl: 'https://api.anthropic.com',
      apiKey: 'provider-key',
      modelFormat: 'anthropic',
      providerId: 'anthropic',
    };
    const handle = await startProxyCatalog([route], route.aliasId, false);

    try {
      const res = await postToProxy(handle.port, handle.token, {
        model: route.aliasId,
        messages: [{ role: 'user', content: 'count upstream' }],
      }, undefined, '/v1/messages/count_tokens');

      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ input_tokens: 17 });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.anthropic.com/v1/messages/count_tokens',
        expect.objectContaining({
          body: expect.stringContaining('"model":"claude-sonnet-4-6"'),
        }),
      );
    } finally {
      handle.close();
      vi.unstubAllGlobals();
    }
  });
});

describe('translated request cancellation', () => {
  it('aborts the SDK provider request and records translation cancellation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-ai-sdk-cancel-'));
    const inferenceLogPath = join(dir, 'inference.jsonl');
    let upstreamReceivedResolve!: () => void;
    const upstreamReceived = new Promise<void>(resolve => { upstreamReceivedResolve = resolve; });
    let upstreamClosedResolve!: () => void;
    const upstreamClosed = new Promise<void>(resolve => { upstreamClosedResolve = resolve; });
    const upstream = http.createServer((req, res) => {
      req.resume();
      req.once('end', () => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.flushHeaders();
        upstreamReceivedResolve();
      });
      req.socket.once('close', upstreamClosedResolve);
    });
    await new Promise<void>((resolve, reject) => {
      upstream.once('error', reject);
      upstream.listen(0, '127.0.0.1', () => resolve());
    });
    const address = upstream.address();
    if (!address || typeof address === 'string') throw new Error('test upstream did not bind');

    const route: ProxyRoute = {
      aliasId: 'relay:test:translated-model',
      realModelId: 'translated-model',
      displayName: 'Translated Model',
      upstreamUrl: '',
      apiKey: 'provider-key',
      modelFormat: 'openai',
      npm: '@ai-sdk/openai-compatible',
      baseURL: `http://127.0.0.1:${address.port}/v1`,
      providerId: 'test-provider',
    };
    const handle = await startProxyCatalog([route], route.aliasId, false, inferenceLogPath);

    try {
      const payload = JSON.stringify({
        model: route.aliasId,
        max_tokens: 100,
        messages: [{ role: 'user', content: 'cancel this request' }],
        stream: true,
      });
      const request = http.request({
        hostname: '127.0.0.1',
        port: handle.port,
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${handle.token}`,
          'Content-Length': Buffer.byteLength(payload),
          'x-relay-request-id': 'req-cancel-1',
        },
      });
      request.on('error', () => {});
      request.end(payload);
      await upstreamReceived;
      request.destroy();
      await upstreamClosed;

      await vi.waitFor(() => {
        const entries = readFileSync(inferenceLogPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
        expect(entries).toContainEqual(expect.objectContaining({
          event: 'translation_cancelled',
          requestId: 'req-cancel-1',
          phase: 'translating',
        }));
      });
    } finally {
      handle.close();
      upstream.closeAllConnections();
      await new Promise<void>(resolve => upstream.close(() => resolve()));
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);
});

describe('SDK translated error logging', () => {
  it('returns an HTTP error when request translation throws instead of leaving the client pending', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-ai-sdk-translation-error-'));
    const inferenceLogPath = join(dir, 'inference.jsonl');
    const route: ProxyRoute = {
      aliasId: 'relay:test:translated-model',
      realModelId: 'translated-model',
      displayName: 'Translated Model',
      upstreamUrl: '',
      apiKey: 'provider-key',
      modelFormat: 'openai',
      npm: '@ai-sdk/openai-compatible',
      baseURL: 'http://127.0.0.1:1/v1',
      providerId: 'test-provider',
    };
    const handle = await startProxyCatalog([route], route.aliasId, false, inferenceLogPath);

    try {
      const res = await postToProxy(handle.port, handle.token, {
        model: route.aliasId,
        max_tokens: 100,
        messages: {},
        stream: true,
      }, 'req-translate-error');

      expect(res.status).toBe(502);
      expect(res.body).toContain('error');
      const entries = readFileSync(inferenceLogPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      expect(entries).toContainEqual(expect.objectContaining({
        event: 'translation_failed',
        requestId: 'req-translate-error',
        phase: 'preparing_translation',
        sdkParts: 0,
        translatedBytes: 0,
      }));
    } finally {
      handle.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('preserves a pre-stream HTTP failure and logs the AI SDK response body', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-ai-sdk-error-'));
    const inferenceLogPath = join(dir, 'inference.jsonl');
    const previousRequestPreview = process.env['RELAY_AI_LOG_REQUEST_PREVIEW'];
    process.env['RELAY_AI_LOG_REQUEST_PREVIEW'] = '1';
    const upstream = http.createServer((req, res) => {
      req.resume();
      res.writeHead(400, { 'Content-Type': 'application/json', 'Connection': 'close' });
      res.end(JSON.stringify({ error: { message: 'translated request rejected', type: 'invalid_request_error' } }));
    });
    await new Promise<void>((resolve, reject) => {
      upstream.once('error', reject);
      upstream.listen(0, '127.0.0.1', () => resolve());
    });
    const address = upstream.address();
    if (!address || typeof address === 'string') throw new Error('test upstream did not bind');

    const route: ProxyRoute = {
      aliasId: 'relay:test:translated-model',
      realModelId: 'translated-model',
      displayName: 'Translated Model',
      upstreamUrl: '',
      apiKey: 'provider-key',
      modelFormat: 'openai',
      npm: '@ai-sdk/openai-compatible',
      baseURL: `http://127.0.0.1:${address.port}/v1`,
      providerId: 'test-provider',
    };
    const handle = await startProxyCatalog([route], route.aliasId, false, inferenceLogPath);

    try {
      const res = await postToProxy(handle.port, handle.token, {
        model: route.aliasId,
        max_tokens: 100,
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      }, 'req-error-1');

      expect(res.status).toBe(400);
      expect(res.body).toContain('translated request rejected');
      const entries = readFileSync(inferenceLogPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      const errorEntry = entries.find(entry => entry.event === 'upstream_error');
      expect(errorEntry).toMatchObject({
        event: 'upstream_error',
        requestId: 'req-error-1',
        modelId: route.aliasId,
        provider: 'test-provider',
        route: 'translated',
        statusCode: 400,
        isRetryable: false,
        attemptCount: 1,
      });
      expect(errorEntry.errorContent).toContain('translated request rejected');
      expect(entries).toContainEqual(expect.objectContaining({
        event: 'translation_dispatched',
        requestId: 'req-error-1',
        phase: 'waiting_for_sdk',
      }));
      expect(entries).toContainEqual(expect.objectContaining({
        event: 'translation_started',
        requestId: 'req-error-1',
        lastPartType: 'start',
      }));
      expect(entries).toContainEqual(expect.objectContaining({
        event: 'translation_failed',
        requestId: 'req-error-1',
        lastPartType: 'error',
      }));
    } finally {
      if (previousRequestPreview === undefined) delete process.env['RELAY_AI_LOG_REQUEST_PREVIEW'];
      else process.env['RELAY_AI_LOG_REQUEST_PREVIEW'] = previousRequestPreview;
      handle.close();
      await new Promise<void>(resolve => upstream.close(() => resolve()));
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);

  it('logs SDK input and translated output through successful stream completion', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-ai-sdk-success-'));
    const inferenceLogPath = join(dir, 'inference.jsonl');
    const upstream = http.createServer((req, res) => {
      req.resume();
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Connection': 'close' });
      res.end([
        'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"translated-model","choices":[{"index":0,"delta":{"role":"assistant","content":"hello"},"finish_reason":null}]}',
        '',
        'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"translated-model","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
        '',
        'data: [DONE]',
        '',
      ].join('\n'));
    });
    await new Promise<void>((resolve, reject) => {
      upstream.once('error', reject);
      upstream.listen(0, '127.0.0.1', () => resolve());
    });
    const address = upstream.address();
    if (!address || typeof address === 'string') throw new Error('test upstream did not bind');

    const route: ProxyRoute = {
      aliasId: 'relay:test:translated-model',
      realModelId: 'translated-model',
      displayName: 'Translated Model',
      upstreamUrl: '',
      apiKey: 'provider-key',
      modelFormat: 'openai',
      npm: '@ai-sdk/openai-compatible',
      baseURL: `http://127.0.0.1:${address.port}/v1`,
      providerId: 'test-provider',
    };
    const handle = await startProxyCatalog([route], route.aliasId, false, inferenceLogPath);

    try {
      const requestBody = {
        model: route.aliasId,
        max_tokens: 100,
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      };
      const countResponse = await postToProxy(
        handle.port,
        handle.token,
        requestBody,
        undefined,
        '/v1/messages/count_tokens',
      );
      const expectedInputTokens = JSON.parse(countResponse.body).input_tokens;
      const res = await postToProxy(handle.port, handle.token, requestBody, 'req-success-1');

      expect(res.status).toBe(200);
      expect(res.body).toContain('event: message_stop');
      const messageStartBlock = res.body
        .split('\n\n')
        .find(block => block.startsWith('event: message_start'))!;
      const messageStart = JSON.parse(messageStartBlock.split('\n')[1]!.replace('data: ', ''));
      expect(messageStart.message.usage).toEqual({
        input_tokens: expectedInputTokens,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      });
      const entries = readFileSync(inferenceLogPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      expect(entries).toContainEqual(expect.objectContaining({
        event: 'translation_dispatched',
        requestId: 'req-success-1',
        phase: 'waiting_for_sdk',
      }));
      expect(entries).toContainEqual(expect.objectContaining({
        event: 'translation_started',
        requestId: 'req-success-1',
      }));
      expect(entries).toContainEqual(expect.objectContaining({
        event: 'translation_completed',
        requestId: 'req-success-1',
        lastPartType: 'finish',
      }));
      const completed = entries.find(entry => entry.event === 'translation_completed');
      expect(completed.sdkParts).toBeGreaterThan(0);
      expect(completed.translatedBytes).toBeGreaterThan(0);
      expect(completed.translatedChunks).toBeGreaterThan(0);
    } finally {
      handle.close();
      await new Promise<void>(resolve => upstream.close(() => resolve()));
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);

  it('logs dispatch and completion for a non-streaming translated request', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-ai-sdk-nonstream-'));
    const inferenceLogPath = join(dir, 'inference.jsonl');
    const upstream = http.createServer((req, res) => {
      req.resume();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Connection': 'close' });
      res.end(JSON.stringify({
        id: 'chatcmpl-nonstream',
        object: 'chat.completion',
        created: 1,
        model: 'translated-model',
        choices: [{ index: 0, message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      }));
    });
    await new Promise<void>((resolve, reject) => {
      upstream.once('error', reject);
      upstream.listen(0, '127.0.0.1', () => resolve());
    });
    const address = upstream.address();
    if (!address || typeof address === 'string') throw new Error('test upstream did not bind');
    const route: ProxyRoute = {
      aliasId: 'relay:test:translated-model',
      realModelId: 'translated-model',
      displayName: 'Translated Model',
      upstreamUrl: '',
      apiKey: 'provider-key',
      modelFormat: 'openai',
      npm: '@ai-sdk/openai-compatible',
      baseURL: `http://127.0.0.1:${address.port}/v1`,
      providerId: 'test-provider',
    };
    const handle = await startProxyCatalog([route], route.aliasId, false, inferenceLogPath);

    try {
      const res = await postToProxy(handle.port, handle.token, {
        model: route.aliasId,
        max_tokens: 100,
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
      }, 'req-nonstream-1');

      expect(res.status).toBe(200);
      const entries = readFileSync(inferenceLogPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      expect(entries).toContainEqual(expect.objectContaining({
        event: 'translation_dispatched',
        requestId: 'req-nonstream-1',
        phase: 'waiting_for_sdk',
      }));
      expect(entries).toContainEqual(expect.objectContaining({
        event: 'translation_completed',
        requestId: 'req-nonstream-1',
        phase: 'waiting_for_sdk',
      }));
    } finally {
      handle.close();
      await new Promise<void>(resolve => upstream.close(() => resolve()));
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);
});

describe('anthropic passthrough debug logging', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('logs upstream non-OK status and body', async () => {
    const route: ProxyRoute = {
      aliasId: 'claude-sonnet-4-6',
      realModelId: 'claude-sonnet-4-6',
      displayName: 'Claude Sonnet',
      upstreamUrl: 'https://api.anthropic.com',
      apiKey: 'oauth-token',
      modelFormat: 'anthropic',
      providerId: 'claude-code',
      authType: 'oauth',
      providerData: {},
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ error: { type: 'rate_limit_error', message: 'rate limit exceeded' } }),
    }));

    const handle = await startProxyCatalog([route], route.aliasId, true);
    const res = await postToProxy(handle.port, handle.token, {
      model: 'claude-sonnet-4-6',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    });

    handle.close();
    expect(res.status).toBe(429);
    const log = readFileSync(getProxyDebugLogPath(), 'utf8');
    expect(log).toContain('anthropic upstream 429');
    expect(log).toContain('rate limit exceeded');
  });

  it('forwards matching Claude Code OAuth session id in body metadata and header', async () => {
    const route: ProxyRoute = {
      aliasId: 'claude-sonnet-4-6',
      realModelId: 'claude-sonnet-4-6',
      displayName: 'Claude Sonnet',
      upstreamUrl: 'https://api.anthropic.com',
      apiKey: 'oauth-token',
      modelFormat: 'anthropic',
      providerId: 'claude-code',
      authType: 'oauth',
      providerData: {
        cliUserID: 'a'.repeat(64),
        accountUUID: '11111111-1111-4111-8111-111111111111',
      },
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ error: { type: 'rate_limit_error', message: 'rate limit exceeded' } }),
    }));

    const handle = await startProxyCatalog([route], route.aliasId, true);
    await postToProxy(handle.port, handle.token, {
      model: 'claude-sonnet-4-6',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    });

    handle.close();
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const headers = init?.headers as Record<string, string>;
    const body = JSON.parse(String(init?.body)) as { metadata?: { user_id?: string } };
    const userId = JSON.parse(body.metadata!.user_id!) as { session_id: string };
    expect(headers['X-Claude-Code-Session-Id']).toBe(userId.session_id);
  });

  it('prepends Claude Code OAuth billing line to upstream system prompt', async () => {
    const route: ProxyRoute = {
      aliasId: 'claude-sonnet-4-6',
      realModelId: 'claude-sonnet-4-6',
      displayName: 'Claude Sonnet',
      upstreamUrl: 'https://api.anthropic.com',
      apiKey: 'oauth-token',
      modelFormat: 'anthropic',
      providerId: 'claude-code',
      authType: 'oauth',
      providerData: {
        cliUserID: 'a'.repeat(64),
        accountUUID: '11111111-1111-4111-8111-111111111111',
      },
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ type: 'message', content: [] }),
      text: async () => JSON.stringify({ type: 'message', content: [] }),
    }));

    const handle = await startProxyCatalog([route], route.aliasId, false);
    await postToProxy(handle.port, handle.token, {
      model: 'claude-sonnet-4-6',
      max_tokens: 100,
      system: [{ type: 'text', text: 'You are helpful.' }],
      messages: [{ role: 'user', content: 'hi' }],
      stream: false,
    });

    handle.close();
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse(String(init?.body)) as { system?: Array<{ type: string; text: string }> };
    expect(body.system?.[0]?.text).toBe('x-anthropic-billing-header: cc_version=2.1.195.0; cc_entrypoint=cli;');
    expect(body.system?.[1]?.text).toBe('You are helpful.');
  });
});
