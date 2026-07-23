// tests/core-model.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANARY = 'sk-canary-oauth-token-zzz';

// OS keyring unavailable in tests → credential store falls back to secrets.json
// under the temp RELAY_AI_HOME.
vi.mock('@napi-rs/keyring', () => ({
  Entry: class {
    constructor() { throw new Error('keyring unavailable in test'); }
  },
}));

const refreshMock = vi.fn();
vi.mock('../src/oauth/refresh.js', async importOriginal => {
  const original = await importOriginal<typeof import('../src/oauth/refresh.js')>();
  return { ...original, refreshStoredOAuthCredential: refreshMock };
});

const createLanguageModelMock = vi.fn();
vi.mock('../src/provider-factory.js', async importOriginal => {
  const original = await importOriginal<typeof import('../src/provider-factory.js')>();
  return { ...original, createLanguageModel: createLanguageModelMock };
});

const { createRelayModel } = await import('../src/core/model.js');
const { isRelayCoreError } = await import('../src/core/errors.js');

function oauthCredential(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: 'oauth',
    access: `expired-access-${CANARY}`,
    refresh: 'refresh-token-123',
    expires: Date.now() - 60_000, // already expired → triggers refresh
    accountId: 'acct-123',
    providerData: { plan: 'pro' },
    ...overrides,
  });
}

function provider(overrides: Record<string, unknown> = {}) {
  return {
    id: 'groq',
    templateId: 'groq',
    name: 'Groq',
    enabled: true,
    authRef: 'keyring:provider:groq',
    authType: 'api',
    api: { npm: '@ai-sdk/groq', url: 'https://api.groq.com/openai/v1', headers: { 'x-plan': 'pro' } },
    modelsCache: {
      fetchedAt: '2026-07-23T00:00:00Z',
      models: [{
        id: 'llama-3.3-70b', name: 'Llama', upstreamModelId: 'llama-3.3-70b-versatile',
        modelFormat: 'openai', useResponsesLite: true, preferWebSockets: true,
      }],
    },
    addedAt: '2026-07-23T00:00:00Z',
    ...overrides,
  };
}

describe('createRelayModel', () => {
  let home: string;
  let prevHome: string | undefined;
  const sentinel = { __languageModel: true };

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'relay-core-model-'));
    prevHome = process.env.RELAY_AI_HOME;
    process.env.RELAY_AI_HOME = home;
    refreshMock.mockReset();
    createLanguageModelMock.mockReset();
    createLanguageModelMock.mockResolvedValue(sentinel);
    refreshMock.mockImplementation(async (providerId: string, cred: { refresh: string; accountId?: string; providerData?: Record<string, unknown> }) => ({
      type: 'oauth',
      access: `${providerId}-new-access-token`,
      refresh: cred.refresh,
      expires: Date.now() + 3_600_000,
      accountId: cred.accountId,
      providerData: cred.providerData,
    }));
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.RELAY_AI_HOME;
    else process.env.RELAY_AI_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  });

  function writeRegistry(providers: unknown[]) {
    writeFileSync(join(home, 'providers.json'), JSON.stringify({ schemaVersion: 1, providers }));
  }

  function writeSecrets(accounts: Record<string, string>) {
    writeFileSync(join(home, 'secrets.json'), JSON.stringify({ version: 1, accounts }));
  }

  async function expectCode(routeId: string, code: string) {
    let caught: unknown;
    try {
      await createRelayModel(routeId as `${string}::${string}`);
    } catch (err) {
      caught = err;
    }
    expect(isRelayCoreError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe(code);
    return caught;
  }

  it('constructs a model for an API-key provider and returns the exact LanguageModel', async () => {
    writeRegistry([provider({})]);
    writeSecrets({ 'provider:groq': 'gsk_test_key' });
    const model = await createRelayModel('groq::llama-3.3-70b');
    expect(model).toBe(sentinel);
    expect(createLanguageModelMock).toHaveBeenCalledTimes(1);
    expect(createLanguageModelMock.mock.calls[0]![0]).toEqual({
      npm: '@ai-sdk/groq',
      modelId: 'llama-3.3-70b-versatile',
      apiKey: 'gsk_test_key',
      baseURL: 'https://api.groq.com/openai/v1',
      providerId: 'groq',
      authType: 'api',
      oauthAccountId: undefined,
      providerData: undefined,
      headers: { 'x-plan': 'pro' },
      useResponsesLite: true,
      preferWebSockets: true,
    });
  });

  it('missing provider → ROUTE_NOT_FOUND', async () => {
    writeRegistry([provider({})]);
    await expectCode('nope::model', 'ROUTE_NOT_FOUND');
  });

  it('disabled provider → PROVIDER_DISABLED', async () => {
    writeRegistry([provider({ enabled: false })]);
    await expectCode('groq::llama-3.3-70b', 'PROVIDER_DISABLED');
  });

  it('missing cached model → UNSUPPORTED_MODEL', async () => {
    writeRegistry([provider({})]);
    await expectCode('groq::no-such-model', 'UNSUPPORTED_MODEL');
  });

  it('missing credential → CREDENTIAL_UNAVAILABLE', async () => {
    writeRegistry([provider({})]);
    writeSecrets({});
    const err = await expectCode('groq::llama-3.3-70b', 'CREDENTIAL_UNAVAILABLE');
    expect((err as Error).message).toContain('relay-ai ui');
  });

  it('expiring OpenAI OAuth credential travels through the refresh path before construction', async () => {
    writeRegistry([provider({
      id: 'openai-oauth', templateId: 'openai', name: 'OpenAI (ChatGPT)',
      authRef: 'keyring:oauth:provider:openai-oauth', authType: 'oauth',
      api: { npm: '@ai-sdk/openai' },
      modelsCache: {
        fetchedAt: '2026-07-23T00:00:00Z',
        models: [{ id: 'gpt-5.6', name: 'GPT-5.6', upstreamModelId: 'gpt-5.6', modelFormat: 'openai' }],
      },
    })]);
    writeSecrets({ 'oauth:provider:openai-oauth': oauthCredential() });
    const model = await createRelayModel('openai-oauth::gpt-5.6');
    expect(model).toBe(sentinel);
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(refreshMock.mock.calls[0]![0]).toBe('openai-oauth');
    const spec = createLanguageModelMock.mock.calls[0]![0];
    expect(spec.apiKey).toBe('openai-oauth-new-access-token');
    expect(spec.authType).toBe('oauth');
    expect(spec.oauthAccountId).toBe('acct-123');
    expect(spec.providerData).toEqual({ plan: 'pro' });
  });

  it('expiring xAI OAuth credential travels through the refresh path before construction', async () => {
    writeRegistry([provider({
      id: 'xai-oauth', templateId: 'xai', name: 'xAI',
      authRef: 'keyring:oauth:provider:xai-oauth', authType: 'oauth',
      api: { npm: '@ai-sdk/xai', url: undefined, headers: undefined },
      modelsCache: {
        fetchedAt: '2026-07-23T00:00:00Z',
        models: [{ id: 'grok-4.5', name: 'Grok', upstreamModelId: 'grok-4.5', modelFormat: 'openai' }],
      },
    })]);
    writeSecrets({ 'oauth:provider:xai-oauth': oauthCredential() });
    await createRelayModel('xai-oauth::grok-4.5');
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(refreshMock.mock.calls[0]![0]).toBe('xai-oauth');
    expect(createLanguageModelMock.mock.calls[0]![0].apiKey).toBe('xai-oauth-new-access-token');
  });

  it('OAuth refresh failure → OAUTH_REFRESH_FAILED, never leaking the canary', async () => {
    refreshMock.mockRejectedValue(new Error(`upstream 401: authorization: Bearer ${CANARY}`));
    writeRegistry([provider({
      id: 'openai-oauth', templateId: 'openai', name: 'OpenAI (ChatGPT)',
      authRef: 'keyring:oauth:provider:openai-oauth', authType: 'oauth',
      api: { npm: '@ai-sdk/openai' },
      modelsCache: {
        fetchedAt: '2026-07-23T00:00:00Z',
        models: [{ id: 'gpt-5.6', name: 'GPT-5.6', upstreamModelId: 'gpt-5.6', modelFormat: 'openai' }],
      },
    })]);
    writeSecrets({ 'oauth:provider:openai-oauth': oauthCredential() });
    const err = await expectCode('openai-oauth::gpt-5.6', 'OAUTH_REFRESH_FAILED');
    expect((err as Error).message).not.toContain(CANARY);
    expect(JSON.stringify(err)).not.toContain(CANARY);
    expect((err as { retryable: boolean }).retryable).toBe(true);
  });

  it('re-reads state on every call (provider disabled between calls)', async () => {
    writeRegistry([provider({})]);
    writeSecrets({ 'provider:groq': 'gsk_test_key' });
    await createRelayModel('groq::llama-3.3-70b');
    writeRegistry([provider({ enabled: false })]);
    await expectCode('groq::llama-3.3-70b', 'PROVIDER_DISABLED');
  });

  it('invalid route id → INVALID_ROUTE_ID', async () => {
    await expectCode('bare-model', 'INVALID_ROUTE_ID');
  });
});
