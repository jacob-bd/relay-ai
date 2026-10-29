import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockRequest, createMockResponse } from './helpers/ui-api-test-utils.js';

const oauth = vi.hoisted(() => ({
  build: vi.fn(),
  exchange: vi.fn(),
  save: vi.fn(),
}));

vi.mock('../src/oauth/antigravity-oauth.js', () => ({
  buildAntigravityAuthUrl: oauth.build,
  completeAntigravityExchange: oauth.exchange,
}));
vi.mock('../src/registry/provider-auth.js', () => ({ saveNativeOAuthCredential: oauth.save }));
vi.mock('../src/registry/io.js', () => ({ loadRegistry: vi.fn(() => ({ schemaVersion: 1, providers: [] })) }));
vi.mock('../src/provider-catalog.js', () => ({ fetchProviderCatalog: vi.fn(async () => []) }));
vi.mock('../src/registry/refresh-models.js', () => ({
  refreshProviderModels: vi.fn(async () => ({ ok: true, modelCount: 1 })),
  refreshAllProviderModels: vi.fn(async () => ({ refreshed: [] })),
}));
vi.mock('../src/env.js', () => ({
  resolveProviderCredential: vi.fn(async () => null),
  saveProviderCredential: vi.fn(async () => true),
}));

async function call(method: string, url: string, body?: unknown, opts?: { uiMode?: 'full' | 'server' }) {
  const { handleUiApiRequest } = await import('../src/ui/api.js');
  const req = createMockRequest(method, url, body === undefined ? undefined : JSON.stringify(body));
  const response = createMockResponse();
  handleUiApiRequest(req, response.res, opts);
  await vi.waitFor(() => expect(response.result.data).not.toBe(''));
  const text = response.result.data;
  return { code: response.result.code, text, body: text.startsWith('{') ? JSON.parse(text) : undefined };
}

describe('UI sign-in for Antigravity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    oauth.build.mockResolvedValue({ authUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=S1', codeVerifier: 'v', oauthState: 'S1', redirectUri: 'r' });
    oauth.exchange.mockResolvedValue({
      tokens: { access_token: 'a', refresh_token: 'r' },
      userInfo: { email: 'g@example.com' },
      projectId: 'p1',
      tierId: 'free-tier',
    });
    oauth.save.mockResolvedValue(undefined);
  });

  it('asks for the account-risk confirmation first and starts nothing', async () => {
    const result = await call('POST', '/api/providers/oauth/start', { providerId: 'antigravity' });

    expect(result.code).toBe(200);
    expect(result.body.needsConfirmation).toBe(true);
    expect(result.body.risk.title).toMatch(/Antigravity/);
    expect(result.body.risk.lines.join(' ')).toMatch(/ban/i);
    expect(oauth.build).not.toHaveBeenCalled();
  });

  it('only a literal acceptRisk: true counts as confirmation', async () => {
    for (const acceptRisk of ['true', 1, 'yes']) {
      const result = await call('POST', '/api/providers/oauth/start', { providerId: 'antigravity', acceptRisk });
      expect(result.body.needsConfirmation).toBe(true);
    }
    expect(oauth.build).not.toHaveBeenCalled();
  });

  it('starts the browser sign-in once the risk is accepted', async () => {
    const result = await call('POST', '/api/providers/oauth/start', { providerId: 'antigravity', acceptRisk: true });

    expect(result.code).toBe(200);
    expect(result.body).toMatchObject({ pkce: true, authUrl: expect.stringContaining('accounts.google.com') });
    expect(result.body.sessionId).toEqual(expect.any(String));
    expect(oauth.build).toHaveBeenCalledWith(expect.stringMatching(/\/oauth\/callback$/));
  });

  it('adding a second Antigravity account needs the same risk confirmation, then saves it as a new account', async () => {
    const first = await call('POST', '/api/providers/oauth/start', { providerId: 'antigravity', addAccount: true });
    expect(first.body.needsConfirmation).toBe(true);
    expect(oauth.build).not.toHaveBeenCalled();

    oauth.build.mockResolvedValueOnce({ authUrl: 'https://accounts.google.com/auth?state=S-add', codeVerifier: 'v', oauthState: 'S-add', redirectUri: 'r' });
    const start = await call('POST', '/api/providers/oauth/start', { providerId: 'antigravity', addAccount: true, acceptRisk: true });
    expect(start.body.pkce).toBe(true);
    await call('GET', '/oauth/callback?code=good&state=S-add');
    await vi.waitFor(async () => {
      expect((await call('GET', `/api/providers/oauth/status?sessionId=${start.body.sessionId}`)).body.status).toBe('done');
    });
    expect(oauth.save).toHaveBeenLastCalledWith('antigravity', expect.anything(), 'g@example.com', expect.anything(), { addAccount: true });
  });

  it('is not available in the server admin UI (device code only)', async () => {
    const result = await call('POST', '/api/providers/oauth/start', { providerId: 'antigravity', acceptRisk: true }, { uiMode: 'server' });

    expect(result.code).toBe(400);
    expect(oauth.build).not.toHaveBeenCalled();
  });

  it('tells Claude Code users to sign in from the terminal', async () => {
    const result = await call('POST', '/api/providers/oauth/start', { providerId: 'claude-code', acceptRisk: true });

    expect(result.code).toBe(400);
    expect(result.body.error).toContain('relay-ai providers auth claude-code');
  });

  it('still rejects unknown providers', async () => {
    const result = await call('POST', '/api/providers/oauth/start', { providerId: 'mystery' });
    expect(result.code).toBe(400);
    expect(result.body.error).toMatch(/unsupported/i);
  });

  it('rejects a callback with an unknown state', async () => {
    await call('POST', '/api/providers/oauth/start', { providerId: 'antigravity', acceptRisk: true });
    const result = await call('GET', '/oauth/callback?code=c&state=WRONG');

    expect(result.code).toBe(400);
    expect(oauth.exchange).not.toHaveBeenCalled();
  });

  it('completes the sign-in on a matching callback and saves the account', async () => {
    // A state of its own: sessions from earlier tests live on in the module.
    oauth.build.mockResolvedValueOnce({ authUrl: 'https://accounts.google.com/auth?state=S-final', codeVerifier: 'v', oauthState: 'S-final', redirectUri: 'r' });
    const start = await call('POST', '/api/providers/oauth/start', { providerId: 'antigravity', acceptRisk: true });
    const callback = await call('GET', '/oauth/callback?code=good&state=S-final');
    expect(callback.code).toBe(200);

    await vi.waitFor(async () => {
      const status = await call('GET', `/api/providers/oauth/status?sessionId=${start.body.sessionId}`);
      expect(status.body.status).toBe('done');
    });
    expect(oauth.exchange).toHaveBeenCalledWith('good', 'v', expect.stringMatching(/\/oauth\/callback$/));
    expect(oauth.save).toHaveBeenCalledWith(
      'antigravity',
      { access_token: 'a', refresh_token: 'r' },
      'g@example.com',
      { projectId: 'p1', tier: 'free-tier' },
      { addAccount: false },
    );
  });
});
