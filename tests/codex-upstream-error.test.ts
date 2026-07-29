import { describe, it, expect } from 'vitest';
import {
  formatUpstreamError,
  formatUpstreamErrorTrace,
  upstreamHttpStatus,
  anthropicErrorType,
} from '../src/codex/upstream-error.js';

describe('formatUpstreamErrorTrace', () => {
  it('keeps provider diagnostics while excluding request bodies, headers, and credentials', () => {
    const detail = formatUpstreamErrorTrace({
      name: 'APICallError',
      message: 'Upstream request failed',
      statusCode: 400,
      responseBody: '{"error":{"message":"invalid tool result id"}}',
      data: { error: { type: 'invalid_request_error', message: 'invalid tool result id' } },
      requestBodyValues: { messages: [{ content: 'private prompt' }] },
      requestHeaders: { authorization: 'Bearer secret-token' },
      apiKey: 'sk-private',
    });

    expect(JSON.parse(detail)).toEqual({
      name: 'APICallError',
      message: 'Upstream request failed',
      statusCode: 400,
      responseBody: '{"error":{"message":"invalid tool result id"}}',
      data: { error: { type: 'invalid_request_error', message: 'invalid tool result id' } },
    });
    expect(detail).not.toContain('private prompt');
    expect(detail).not.toContain('secret-token');
    expect(detail).not.toContain('sk-private');
  });
});

describe('formatUpstreamError', () => {
  it('uses lastError message and status without stack', () => {
    const msg = formatUpstreamError({
      message: 'RetryError [AI_RetryError]: Failed after 2 attempts',
      lastError: { message: 'Not Found', statusCode: 404 },
    });
    expect(msg).toBe('Not Found (HTTP 404)');
  });

  it('sanitizes RetryError-only messages', () => {
    const msg = formatUpstreamError({
      message: 'RetryError [AI_RetryError]: Failed after 2 attempts with non-retryable error',
    });
    expect(msg).toBe('Upstream model request failed after retries.');
  });

  it('extracts Anthropic quota message from AI_APICallError shape', () => {
    const msg = formatUpstreamError({
      message: 'APICallError [AI_APICallError]: You have reached your specified API usage limits.',
      statusCode: 400,
      data: {
        error: {
          type: 'invalid_request_error',
          message: 'You have reached your specified API usage limits. You will regain access on 2026-07-01 at 00:00 UTC.',
        },
      },
    });
    expect(msg).toContain('API usage limits');
    expect(msg).toContain('HTTP 400');
  });
});

describe('upstreamHttpStatus', () => {
  it('reads a known status code off the error object', () => {
    expect(upstreamHttpStatus({ statusCode: 401 }, '')).toBe(401);
    expect(upstreamHttpStatus({ statusCode: 403 }, '')).toBe(403);
  });

  it('falls back to sniffing the formatted message', () => {
    expect(upstreamHttpStatus({}, 'Provider returned HTTP 429.')).toBe(429);
    expect(upstreamHttpStatus(undefined, 'Provider returned HTTP 400.')).toBe(400);
  });

  it('defaults to 500 for unrecognized errors', () => {
    expect(upstreamHttpStatus({ statusCode: 418 }, 'teapot')).toBe(500);
    expect(upstreamHttpStatus(null, 'boom')).toBe(500);
  });
});

describe('anthropicErrorType', () => {
  it('maps terminal client errors to non-retryable Anthropic error types', () => {
    expect(anthropicErrorType(401)).toBe('authentication_error');
    expect(anthropicErrorType(403)).toBe('permission_error');
    expect(anthropicErrorType(400)).toBe('invalid_request_error');
    expect(anthropicErrorType(404)).toBe('not_found_error');
  });

  it('maps 429 to rate_limit_error and everything else to api_error', () => {
    expect(anthropicErrorType(429)).toBe('rate_limit_error');
    expect(anthropicErrorType(500)).toBe('api_error');
    expect(anthropicErrorType(502)).toBe('api_error');
  });
});
