// tests/upstream-forward.test.ts
import { describe, it, expect, vi } from 'vitest';
import { anthropicUpstreamHeaders, fetchWithOAuthRetry } from '../src/upstream-forward.js';
import { createClinePassOAuthFetch } from '../src/cline-pass.js';

describe('anthropicUpstreamHeaders', () => {
  it('includes bearer and x-api-key', () => {
    expect(anthropicUpstreamHeaders('secret-key')).toMatchObject({
      Authorization: 'Bearer secret-key',
      'x-api-key': 'secret-key',
      'anthropic-version': '2023-06-01',
    });
  });

  it('adds stream accept header when requested', () => {
    expect(anthropicUpstreamHeaders('secret-key', true).Accept).toBe('text/event-stream');
  });

  it('adds Claude Code session header for OAuth requests', () => {
    expect(anthropicUpstreamHeaders(
      'oauth-token',
      true,
      'oauth-2025-04-20',
      'oauth',
      'session-123',
    )).toMatchObject({
      Authorization: 'Bearer oauth-token',
      'User-Agent': 'claude-cli/2.1.195 (external, cli)',
      'x-app': 'cli',
      'X-Claude-Code-Session-Id': 'session-123',
    });
  });

  it('preserves OpenCode Go session and Relay user-agent headers for API requests', () => {
    expect(anthropicUpstreamHeaders(
      'go-key',
      false,
      undefined,
      'api',
      undefined,
      {
        'x-opencode-session': 'conversation-1',
        'User-Agent': 'relay-ai/0.0.0-test',
      },
    )).toMatchObject({
      'x-opencode-session': 'conversation-1',
      'User-Agent': 'relay-ai/0.0.0-test',
      'x-api-key': 'go-key',
    });
  });
});

describe('fetchWithOAuthRetry', () => {
  it('refreshes once on 401 and retries with the refreshed token', async () => {
    const refreshToken = vi.fn(async () => 'new-token');
    const request = vi.fn()
      .mockResolvedValueOnce({ status: 401 })
      .mockResolvedValueOnce({ status: 200 });

    const result = await fetchWithOAuthRetry('old-token', request, refreshToken);

    expect(result.response.status).toBe(200);
    expect(result.apiKey).toBe('new-token');
    expect(result.refreshed).toBe(true);
    expect(request).toHaveBeenNthCalledWith(1, 'old-token');
    expect(request).toHaveBeenNthCalledWith(2, 'new-token');
  });
});

describe('createClinePassOAuthFetch', () => {
  it('retries once with a runtime-prefixed refreshed token and preserves headers', async () => {
    const refreshToken = vi.fn(async () => 'new-token');
    const onTokenRefreshed = vi.fn();
    const request = vi.fn()
      .mockResolvedValueOnce(new Response('expired', { status: 401 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const fetch = createClinePassOAuthFetch(
      'workos:old-token',
      refreshToken,
      onTokenRefreshed,
      request,
    );

    const response = await fetch('https://api.cline.bot/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'X-Request-Id': 'req-123' },
      body: '{}',
    });

    expect(response.status).toBe(200);
    expect(refreshToken).toHaveBeenCalledOnce();
    expect(onTokenRefreshed).toHaveBeenCalledWith('new-token');
    expect(request).toHaveBeenCalledTimes(2);
    const firstHeaders = request.mock.calls[0]?.[1]?.headers as Headers;
    const secondHeaders = request.mock.calls[1]?.[1]?.headers as Headers;
    expect(firstHeaders).toBeInstanceOf(Headers);
    expect(firstHeaders.get('Authorization')).toBe('Bearer workos:old-token');
    expect(firstHeaders.get('X-Request-Id')).toBe('req-123');
    expect(secondHeaders.get('Authorization')).toBe('Bearer workos:new-token');
    expect(secondHeaders.get('X-Request-Id')).toBe('req-123');
  });

  it('does not loop when the refreshed request is also unauthorized', async () => {
    const refreshToken = vi.fn(async () => 'new-token');
    const request = vi.fn()
      .mockResolvedValueOnce(new Response('expired', { status: 401 }))
      .mockResolvedValueOnce(new Response('still expired', { status: 401 }));
    const fetch = createClinePassOAuthFetch('workos:old-token', refreshToken, undefined, request);

    const response = await fetch('https://api.cline.bot/api/v1/chat/completions');

    expect(response.status).toBe(401);
    expect(refreshToken).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledTimes(2);
  });
});

describe('relayAnthropicMessages empty-stream recovery', () => {
  function fakeRes() {
    const chunks: string[] = [];
    return {
      chunks,
      status: 0,
      headers: {} as Record<string, string>,
      writeHead(status: number, headers: Record<string, string>) { this.status = status; this.headers = headers; },
      write(chunk: unknown) { chunks.push(String(chunk)); return true; },
      end(chunk?: unknown) { if (chunk !== undefined) chunks.push(String(chunk)); },
      destroy() { /* no-op */ },
    };
  }

  const message = {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'union-alpha',
    content: [
      { type: 'text', text: 'PONG' },
      { type: 'tool_use', id: 'tu_1', name: 'get_time', input: { tz: 'UTC' } },
    ],
    stop_reason: 'tool_use',
    usage: { input_tokens: 5, output_tokens: 7 },
  };

  function sseStream(text: string) {
    return new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode(text)); controller.close(); },
    });
  }

  it('retries without streaming when the gateway returns an empty stream', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      if (bodies.length === 1) {
        return new Response(new ReadableStream({ start: c => c.close() }), {
          status: 200, headers: { 'content-type': 'text/event-stream' },
        });
      }
      return new Response(JSON.stringify(message), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const res = fakeRes();
    const { relayAnthropicMessages } = await import('../src/upstream-forward.js');
    await relayAnthropicMessages(
      res as never, 'https://opencode.ai/zen/go/v1/messages',
      { model: 'union-alpha', stream: true }, 'key', true,
      undefined, 'api', undefined, undefined, undefined, undefined, undefined, true,
    );
    vi.unstubAllGlobals();

    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toMatchObject({ stream: false });
    const out = res.chunks.join('');
    expect(res.headers['Content-Type']).toBe('text/event-stream');
    expect(out).toContain('event: message_start');
    expect(out).toContain('"text_delta"');
    expect(out).toContain('PONG');
    expect(out).toContain('"input_json_delta"');
    expect(out).toContain('{\\"tz\\":\\"UTC\\"}');
    expect(out).toContain('event: message_stop');
  });

  it('passes a working stream straight through without a second request', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(String(url));
      return new Response(sseStream('event: message_start\ndata: {}\n\nevent: message_stop\ndata: {}\n\n'), {
        status: 200, headers: { 'content-type': 'text/event-stream' },
      });
    }));
    const res = fakeRes();
    const { relayAnthropicMessages } = await import('../src/upstream-forward.js');
    await relayAnthropicMessages(
      res as never, 'https://opencode.ai/zen/go/v1/messages',
      { model: 'union-alpha', stream: true }, 'key', true,
      undefined, 'api', undefined, undefined, undefined, undefined, undefined, true,
    );
    vi.unstubAllGlobals();

    expect(calls).toHaveLength(1);
    expect(res.chunks.join('')).toContain('event: message_start');
    expect(res.chunks.join('')).toContain('event: message_stop');
  });

  it('leaves an empty stream alone when recovery is not requested', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(String(url));
      return new Response(new ReadableStream({ start: c => c.close() }), {
        status: 200, headers: { 'content-type': 'text/event-stream' },
      });
    }));
    const res = fakeRes();
    const { relayAnthropicMessages } = await import('../src/upstream-forward.js');
    await relayAnthropicMessages(
      res as never, 'https://opencode.ai/zen/go/v1/messages',
      { model: 'union-alpha', stream: true }, 'key', true,
    );
    vi.unstubAllGlobals();
    expect(calls).toHaveLength(1);
  });
});
