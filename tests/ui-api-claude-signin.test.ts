import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockRequest, createMockResponse } from './helpers/ui-api-test-utils.js';

const claude = vi.hoisted(() => ({ build: vi.fn(), exchange: vi.fn(), save: vi.fn() }));

vi.mock('../src/oauth/claude-code.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/oauth/claude-code.js')>()),
  buildClaudeCodeAuthUrl: claude.build,
  completeClaudeCodeExchange: claude.exchange,
}));
vi.mock('../src/registry/provider-auth.js', () => ({ saveNativeOAuthCredential: claude.save }));
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
  return { code: response.result.code, body: JSON.parse(response.result.data) };
}
const start = (extra: Record<string, unknown> = {}) =>
  call('POST', '/api/providers/oauth/start', { providerId: 'claude-code', acceptRisk: true, ...extra });
const finished = async (sessionId: string) => {
  let last: any;
  await vi.waitFor(async () => {
    last = (await call('GET', `/api/providers/oauth/status?sessionId=${sessionId}`)).body;
    expect(last.status).not.toBe('pending');
  });
  return last;
};

describe('UI sign-in for Claude Code (paste the code Anthropic shows)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let n = 0;
    claude.build.mockImplementation(async () => {
      n += 1;
      return { authUrl: `https://claude.com/cai/oauth/authorize?state=S${n}`, codeVerifier: `v${n}`, oauthState: `S${n}`, redirectUri: 'https://platform.claude.com/oauth/code/callback' };
    });
    claude.exchange.mockResolvedValue({
      tokens: { access_token: 'a', refresh_token: 'r' },
      bootstrap: { accountId: 'uuid-1', email: 'me@example.com', organizationName: 'Org', plan: 'max_5x' },
    });
    claude.save.mockResolvedValue('claude-code');
  });

  it('asks for the account-risk confirmation first and starts nothing', async () => {
    const result = await call('POST', '/api/providers/oauth/start', { providerId: 'claude-code' });
    expect(result.body.needsConfirmation).toBe(true);
    expect(result.body.risk.title).toMatch(/Claude Code/);
    expect(claude.build).not.toHaveBeenCalled();
  });

  it('starts the sign-in and says a code is expected', async () => {
    const result = await start();
    expect(result.code).toBe(200);
    expect(result.body).toMatchObject({ pkce: true, needsCode: true, authUrl: expect.stringContaining('claude.com') });
    expect(result.body.sessionId).toEqual(expect.any(String));
  });

  it('exchanges the pasted code and saves the account the same way the terminal does', async () => {
    const started = await start();
    const submitted = await call('POST', '/api/providers/oauth/code', { sessionId: started.body.sessionId, code: 'the-code#S1' });
    expect(submitted.body).toEqual({ ok: true });

    expect((await finished(started.body.sessionId)).status).toBe('done');
    expect(claude.exchange).toHaveBeenCalledWith('the-code#S1', 'v1', 'S1', 'https://platform.claude.com/oauth/code/callback');
    const [providerId, tokens, accountId, providerData, options] = claude.save.mock.calls[0]!;
    expect(providerId).toBe('claude-code');
    expect(tokens).toEqual({ access_token: 'a', refresh_token: 'r' });
    expect(accountId).toBe('uuid-1');
    expect(providerData).toMatchObject({ accountUUID: 'uuid-1', organizationName: 'Org', plan: 'max_5x', identity: { email: 'me@example.com' } });
    expect(providerData.cliUserID).toMatch(/^[0-9a-f]{64}$/);
    expect(options).toEqual({ addAccount: false });
  });

  it('adds another Claude account when asked to', async () => {
    const started = await start({ addAccount: true });
    await call('POST', '/api/providers/oauth/code', { sessionId: started.body.sessionId, code: 'c' });
    await finished(started.body.sessionId);
    expect(claude.save.mock.calls[0]![4]).toEqual({ addAccount: true });
  });

  it('reports why a code failed (for example a state mismatch or a rejected code)', async () => {
    claude.exchange.mockRejectedValue(new Error('Anthropic returned an unexpected state — start the sign-in again'));
    const started = await start();
    await call('POST', '/api/providers/oauth/code', { sessionId: started.body.sessionId, code: 'bad#other' });
    const result = await finished(started.body.sessionId);
    expect(result.status).toBe('error');
    expect(result.error).toMatch(/^Anthropic returned an unexpected state/);
    expect(claude.save).not.toHaveBeenCalled();
  });

  it('takes a code only once, from a known session that is waiting for one', async () => {
    const started = await start();
    const id = started.body.sessionId;
    expect((await call('POST', '/api/providers/oauth/code', { sessionId: id, code: 'c' })).code).toBe(200);
    expect((await call('POST', '/api/providers/oauth/code', { sessionId: id, code: 'again' })).code).toBe(400);
    expect((await call('POST', '/api/providers/oauth/code', { sessionId: 'nope', code: 'c' })).code).toBe(404);
  });

  it('rejects empty, missing or oversized input', async () => {
    const started = await start();
    const id = started.body.sessionId;
    expect((await call('POST', '/api/providers/oauth/code', { sessionId: id, code: '   ' })).code).toBe(400);
    expect((await call('POST', '/api/providers/oauth/code', { code: 'c' })).code).toBe(400);
    expect((await call('POST', '/api/providers/oauth/code', { sessionId: id, code: 'x'.repeat(5000) })).code).toBe(400);
    expect(claude.exchange).not.toHaveBeenCalled();
  });

  it('is not available in the server admin UI', async () => {
    const result = await call('POST', '/api/providers/oauth/start', { providerId: 'claude-code', acceptRisk: true }, { uiMode: 'server' });
    expect(result.code).toBe(400);
    expect(claude.build).not.toHaveBeenCalled();
  });
});
