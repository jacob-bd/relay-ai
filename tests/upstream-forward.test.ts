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
