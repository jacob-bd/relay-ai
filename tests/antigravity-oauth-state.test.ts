import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const callback = vi.hoisted(() => ({
  respond: (() => ({ code: 'c', state: '' })) as (authUrl: string) => { code: string; state: string; error?: string },
  authUrl: '',
}));

vi.mock('open', () => ({ default: vi.fn(async () => undefined) }));
vi.mock('../src/oauth/callback-server.js', () => ({
  startCallbackServer: vi.fn(async () => ({
    port: 1,
    redirectUri: 'http://127.0.0.1:1/callback',
    waitForCallback: async () => callback.respond(callback.authUrl),
    close: vi.fn(),
  })),
}));

import { runAntigravityOAuthFlow } from '../src/oauth/antigravity-oauth.js';

describe('runAntigravityOAuthFlow state check', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    callback.authUrl = '';
    fetchMock.mockResolvedValue(new Response('nope', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const run = () => runAntigravityOAuthFlow(url => { callback.authUrl = url; });

  it('rejects a callback whose state does not match, before any token exchange', async () => {
    callback.respond = () => ({ code: 'stolen-code', state: 'attacker-state' });
    await expect(run()).rejects.toThrow(/state/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a callback with no state', async () => {
    callback.respond = () => ({ code: 'c', state: '' });
    await expect(run()).rejects.toThrow(/state/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces an authorization error from Google', async () => {
    callback.respond = url => ({ code: '', state: new URL(url).searchParams.get('state') ?? '', error: 'access_denied' });
    await expect(run()).rejects.toThrow(/access_denied/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('proceeds to the token exchange when state matches', async () => {
    callback.respond = url => ({ code: 'good-code', state: new URL(url).searchParams.get('state') ?? '' });
    await expect(run()).rejects.toThrow();   // exchange is mocked to fail; what matters is that it ran
    expect(fetchMock).toHaveBeenCalled();
  });
});
