import { describe, expect, it } from 'vitest';
import { isAuthorized } from '../src/server/auth.js';

function request(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/test', { headers });
}

describe('server auth', () => {
  it('accepts every request when serverPassword is null', () => {
    expect(isAuthorized(request(), null)).toBe(true);
    expect(isAuthorized(request({ authorization: 'Bearer wrong' }), null)).toBe(true);
  });

  it('accepts a matching bearer token', () => {
    expect(isAuthorized(request({ authorization: 'Bearer secret' }), 'secret')).toBe(true);
  });

  it('accepts a matching x-api-key header', () => {
    expect(isAuthorized(request({ 'x-api-key': 'secret' }), 'secret')).toBe(true);
  });

  it('rejects missing and wrong passwords', () => {
    expect(isAuthorized(request(), 'secret')).toBe(false);
    expect(isAuthorized(request({ authorization: 'Bearer wrong' }), 'secret')).toBe(false);
    expect(isAuthorized(request({ 'x-api-key': 'wrong' }), 'secret')).toBe(false);
  });
});
