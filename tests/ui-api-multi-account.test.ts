import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockRequest, createMockResponse } from './helpers/ui-api-test-utils.js';

const state = vi.hoisted(() => ({
  catalog: [] as any[],
  registry: { schemaVersion: 1, providers: [] as any[] },
  save: vi.fn(),
  refresh: vi.fn(),
  poll: vi.fn(),
}));

vi.mock('../src/provider-catalog.js', () => ({ fetchProviderCatalog: vi.fn(async () => state.catalog) }));
vi.mock('../src/registry/io.js', () => ({ loadRegistry: vi.fn(() => state.registry) }));
vi.mock('../src/env.js', () => ({
  resolveProviderCredential: vi.fn(async () => 'token'),
  saveProviderCredential: vi.fn(async () => true),
}));
vi.mock('../src/registry/provider-auth.js', () => ({ saveNativeOAuthCredential: state.save }));
vi.mock('../src/registry/refresh-models.js', () => ({
  refreshProviderModels: state.refresh,
  refreshAllProviderModels: vi.fn(async () => ({ refreshed: [] })),
}));
vi.mock('../src/oauth/openai.js', () => ({
  requestOpenAiDeviceCode: vi.fn(async () => ({ device_auth_id: 'secret', user_code: 'OAI-1234', interval: '5' })),
  pollOpenAiDeviceCodeToken: state.poll,
  openAiDeviceCodeUrl: vi.fn(() => 'https://auth.openai.com/codex/device'),
}));

async function call(method: string, url: string, body?: unknown) {
  const { handleUiApiRequest } = await import('../src/ui/api.js');
  const req = createMockRequest(method, url, body === undefined ? undefined : JSON.stringify(body));
  const response = createMockResponse();
  handleUiApiRequest(req, response.res);
  await vi.waitFor(() => expect(response.result.data).not.toBe(''));
  return { code: response.result.code, body: JSON.parse(response.result.data) };
}

async function finished(sessionId: string) {
  let last: any;
  await vi.waitFor(async () => {
    last = (await call('GET', `/api/providers/oauth/status?sessionId=${sessionId}`)).body;
    expect(last.status).not.toBe('pending');
  });
  return last;
}

const oauthEntry = (id: string, modelCount = 1) => ({
  id, templateId: 'openai', name: id, enabled: true, authType: 'oauth', authRef: `keyring:oauth:provider:${id}`, api: {},
  modelsCache: { fetchedAt: '2026-01-01T00:00:00.000Z', models: new Array(modelCount).fill({}) },
});

describe('UI: several OAuth accounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.catalog = [];
    state.registry = { schemaVersion: 1, providers: [] };
    state.poll.mockResolvedValue({ tokens: { access_token: 'a', refresh_token: 'r' }, accountId: 'ws-1' });
    state.save.mockResolvedValue('openai-oauth-2');
    state.refresh.mockResolvedValue({ ok: true, modelCount: 1 });
  });

  it('adds another ChatGPT account and refreshes the models of the NEW account', async () => {
    // Saving creates the new entry; the refresh then looks it up by the id the save returned.
    state.registry = { schemaVersion: 1, providers: [oauthEntry('openai-oauth'), oauthEntry('openai-oauth-2')] };
    const start = await call('POST', '/api/providers/oauth/start', { providerId: 'openai-oauth', addAccount: true });
    expect(start.code).toBe(200);

    expect((await finished(start.body.sessionId)).status).toBe('done');
    expect(state.save).toHaveBeenCalledWith('openai-oauth', { access_token: 'a', refresh_token: 'r' }, 'ws-1', undefined, { addAccount: true });
    expect(state.refresh).toHaveBeenCalledWith('openai-oauth-2', expect.anything(), expect.anything());
  });

  it('signing in again on a numbered account replaces that account, not a new one', async () => {
    state.registry = { schemaVersion: 1, providers: [oauthEntry('openai-oauth'), oauthEntry('openai-oauth-2')] };
    state.save.mockResolvedValue('openai-oauth-2');

    const start = await call('POST', '/api/providers/oauth/start', { providerId: 'openai-oauth-2' });
    expect(start.code).toBe(200);
    await finished(start.body.sessionId);

    expect(state.save).toHaveBeenCalledWith('openai-oauth-2', expect.anything(), 'ws-1', undefined, { addAccount: false });
  });

  it('shows the reason when the same person is added twice (no "Error:" prefix)', async () => {
    state.save.mockRejectedValue(new Error('This account (me@example.com) is already signed in as "Work". Use "Sign in again" on that provider instead of adding it twice.'));

    const start = await call('POST', '/api/providers/oauth/start', { providerId: 'openai-oauth', addAccount: true });
    const result = await finished(start.body.sessionId);

    expect(result.status).toBe('error');
    expect(result.error).toMatch(/^This account/);
    expect(result.error).toContain('already signed in');
  });

  it('Claude Code accounts are added from the terminal, with a clear message', async () => {
    const result = await call('POST', '/api/providers/oauth/start', { providerId: 'claude-code', addAccount: true, acceptRisk: true });
    expect(result.code).toBe(400);
    expect(result.body.error).toContain('relay-ai providers auth claude-code --new');
  });

  it('flags which OAuth cards can add another account, including numbered ones', async () => {
    const model = { id: 'm', name: 'M', brand: 'X', family: 'x', modelFormat: 'openai', upstreamModelId: 'm' };
    state.catalog = [
      { id: 'openai-oauth', name: 'A', authType: 'oauth', apiKey: 't', models: [model] },
      { id: 'openai-oauth-2', name: 'B', authType: 'oauth', apiKey: 't', models: [model] },
      { id: 'antigravity', name: 'C', authType: 'oauth', apiKey: 't', models: [model] },
      { id: 'claude-code', name: 'E', authType: 'oauth', apiKey: 't', models: [model] },
      { id: 'groq', name: 'D', authType: 'api', apiKey: 'k', models: [model] },
    ];
    const byId = Object.fromEntries((await call('GET', '/api/models')).body.providers.map((p: any) => [p.id, p]));

    expect(byId['openai-oauth'].canAddAccount).toBe(true);
    expect(byId['openai-oauth-2'].canAddAccount).toBe(true);
    expect(byId['antigravity'].canAddAccount).toBe(true);
    expect(byId['claude-code'].canAddAccount).toBeUndefined();   // its sign-in is terminal-only
    expect(byId['groq'].canAddAccount).toBeUndefined();
  });

  it('keeps a numbered OAuth account on the Providers page even before its models load', async () => {
    state.registry = { schemaVersion: 1, providers: [oauthEntry('openai-oauth-2', 0)] };
    state.catalog = [];
    const ids = (await call('GET', '/api/models')).body.providers.map((p: any) => p.id);
    expect(ids).toContain('openai-oauth-2');
  });
});
