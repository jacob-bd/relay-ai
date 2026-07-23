// tests/core-route-id.test.ts
import { describe, it, expect } from 'vitest';
import { toRelayRouteId, parseRelayRouteId } from '../src/core/route-id.js';
import { RelayCoreError, isRelayCoreError } from '../src/core/errors.js';

describe('toRelayRouteId', () => {
  it('joins provider and model with ::', () => {
    expect(toRelayRouteId('openai-oauth', 'gpt-5.6')).toBe('openai-oauth::gpt-5.6');
  });

  it('preserves / and : inside the model id', () => {
    expect(toRelayRouteId('openrouter', 'vendor/model:free')).toBe('openrouter::vendor/model:free');
  });

  it('rejects an invalid provider id', () => {
    expect(() => toRelayRouteId('bad::provider', 'model'))
      .toThrowError(expect.objectContaining({ code: 'INVALID_ROUTE_ID' }));
    expect(() => toRelayRouteId('Bad_Provider', 'model'))
      .toThrowError(expect.objectContaining({ code: 'INVALID_ROUTE_ID' }));
    expect(() => toRelayRouteId('', 'model'))
      .toThrowError(expect.objectContaining({ code: 'INVALID_ROUTE_ID' }));
  });

  it('rejects an empty model id', () => {
    expect(() => toRelayRouteId('openai', ''))
      .toThrowError(expect.objectContaining({ code: 'INVALID_ROUTE_ID' }));
  });

  it('round-trips through parseRelayRouteId', () => {
    const id = toRelayRouteId('xai-oauth', 'grok-4.5');
    expect(parseRelayRouteId(id)).toEqual({ providerId: 'xai-oauth', modelId: 'grok-4.5' });
  });
});

describe('parseRelayRouteId', () => {
  it('splits on the first :: only', () => {
    expect(parseRelayRouteId('openrouter::vendor/model:free'))
      .toEqual({ providerId: 'openrouter', modelId: 'vendor/model:free' });
  });

  it('rejects a bare model id', () => {
    expect(() => parseRelayRouteId('gpt-5.6'))
      .toThrowError(expect.objectContaining({ code: 'INVALID_ROUTE_ID' }));
  });

  it('rejects empty segments', () => {
    expect(() => parseRelayRouteId('::gpt-5.6'))
      .toThrowError(expect.objectContaining({ code: 'INVALID_ROUTE_ID' }));
    expect(() => parseRelayRouteId('openai::'))
      .toThrowError(expect.objectContaining({ code: 'INVALID_ROUTE_ID' }));
  });
});

describe('RelayCoreError', () => {
  it('exposes code, retryable, providerId, routeId', () => {
    const err = new RelayCoreError('ROUTE_NOT_FOUND', 'no such route', {
      providerId: 'openai',
      routeId: 'openai::gpt-5.6',
    });
    expect(err.code).toBe('ROUTE_NOT_FOUND');
    expect(err.retryable).toBe(false);
    expect(err.providerId).toBe('openai');
    expect(err.routeId).toBe('openai::gpt-5.6');
    expect(err).toBeInstanceOf(Error);
  });

  it('defaults retryable per code and allows override', () => {
    expect(new RelayCoreError('OAUTH_REFRESH_FAILED', 'x').retryable).toBe(true);
    expect(new RelayCoreError('PROVIDER_LOAD_FAILED', 'x').retryable).toBe(true);
    expect(new RelayCoreError('CREDENTIAL_UNAVAILABLE', 'x').retryable).toBe(false);
    expect(new RelayCoreError('OAUTH_REFRESH_FAILED', 'x', { retryable: false }).retryable).toBe(false);
  });

  it('retains cause for debugging but omits it from JSON', () => {
    const err = new RelayCoreError('PROVIDER_LOAD_FAILED', 'safe message', { cause: new Error('internal detail') });
    expect(err.cause).toBeInstanceOf(Error);
    const json = JSON.parse(JSON.stringify(err));
    expect(json).not.toHaveProperty('cause');
    expect(json.code).toBe('PROVIDER_LOAD_FAILED');
  });

  it('never leaks an injected secret into message or JSON', () => {
    const SECRET = 'sk-canary-9f8e7d6c5b4a';
    const err = new RelayCoreError('CREDENTIAL_UNAVAILABLE', 'Re-authenticate this provider in relay-ai ui', {
      providerId: 'openai',
      cause: new Error(`upstream said: authorization: Bearer ${SECRET}`),
    });
    expect(err.message).not.toContain(SECRET);
    expect(JSON.stringify(err)).not.toContain(SECRET);
  });

  it('isRelayCoreError type-guards and rejects ordinary Errors', () => {
    expect(isRelayCoreError(new RelayCoreError('INVALID_ROUTE_ID', 'x'))).toBe(true);
    expect(isRelayCoreError(new Error('x'))).toBe(false);
    expect(isRelayCoreError({ code: 'INVALID_ROUTE_ID' })).toBe(false);
    expect(isRelayCoreError(null)).toBe(false);
  });
});
