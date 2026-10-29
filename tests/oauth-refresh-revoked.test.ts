import { describe, it, expect, vi, afterEach } from 'vitest';
import { OAuthRefreshRevokedError, postOAuthRefresh } from '../src/oauth/refresh-http.js';

const opts = { contentType: 'form' as const, errorPrefix: 'OpenAI token refresh failed', includeStatus: true };
const respond = (status: number, body: string) => vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status })));

describe('postOAuthRefresh: permanent sign-in failures', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['OpenAI nested code', 400, '{"error":{"code":"refresh_token_reused","message":"used"}}'],
    ['expired token', 401, '{"error":{"code":"refresh_token_expired"}}'],
    ['invalidated token', 400, '{"error":{"code":"refresh_token_invalidated"}}'],
    ['standard invalid_grant', 400, '{"error":"invalid_grant"}'],
  ])('%s is reported as a revoked sign-in', async (_name, status, body) => {
    respond(status, body);
    const err = await postOAuthRefresh('https://x/token', new URLSearchParams(), opts).catch(e => e);
    expect(err).toBeInstanceOf(OAuthRefreshRevokedError);
    expect(err.message).toContain('OpenAI token refresh failed');
    expect(err.message).toMatch(/no longer valid/i);
  });

  it('other failures stay ordinary errors with the old message', async () => {
    for (const [status, body] of [[400, '{"error":"invalid_request"}'], [500, '{"error":"invalid_grant"}'], [400, 'not json'], [503, '']] as const) {
      respond(status, body);
      const err = await postOAuthRefresh('https://x/token', new URLSearchParams(), opts).catch(e => e);
      expect(err).not.toBeInstanceOf(OAuthRefreshRevokedError);
      expect(err.message).toBe(`OpenAI token refresh failed (${status})`);
    }
  });

  it('still returns the tokens on success', async () => {
    respond(200, '{"access_token":"a","refresh_token":"r"}');
    await expect(postOAuthRefresh('https://x/token', new URLSearchParams(), opts)).resolves.toEqual({ access_token: 'a', refresh_token: 'r' });
  });
});
