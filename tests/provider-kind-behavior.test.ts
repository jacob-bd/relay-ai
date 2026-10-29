import { describe, it, expect, vi, afterEach } from 'vitest';
import { oauthCredentialShouldRefresh, refreshStoredOAuthCredential } from '../src/oauth/refresh.js';
import { isClaudeCodeOAuthRoute } from '../src/oauth/claude-code-identity.js';
import { isClinePassOAuth } from '../src/cline-pass.js';
import { isOpenCodeGoEndpoint } from '../src/opencode-session.js';
import { resolveModelsDevSlug } from '../src/registry/models-dev.js';
import { favoriteProviderDisplayName } from '../src/favorite-provider-display.js';
import { isZenFreeTierModel } from '../src/model-compatibility.js';
import { resolveLocalProviderApiKey } from '../src/provider-catalog.js';
import { materializeRegistry } from '../src/registry/materialize.js';
import { resolveModelSource } from '../src/registry/model-source.js';
import type { RegistryProvider } from '../src/registry/types.js';
import { CLINE_PASS_LEGACY_DEFAULT_CONTEXT_WINDOW } from '../src/cline-pass.js';

// A numbered account (`<kind>-2`) must behave exactly like the first one of its kind.

describe('numbered accounts: OAuth', () => {
  afterEach(() => vi.restoreAllMocks());

  it('refresh dispatches on the kind, not the raw id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      expires_in: 3600,
    }), { status: 200 })));
    const cred = await refreshStoredOAuthCredential('xai-oauth-2', { type: 'oauth', access: 'old', refresh: 'rt', expires: 0 });
    expect(cred.access).toBe('new-access');
  });

  it('still refuses to refresh an unknown provider', async () => {
    await expect(
      refreshStoredOAuthCredential('mystery-2', { type: 'oauth', access: 'a', refresh: 'r', expires: 0 }),
    ).rejects.toThrow(/not implemented/i);
  });

  it('proactively refreshes an expiring token for numbered accounts', () => {
    const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 10 })).toString('base64url');
    const cred = { type: 'oauth' as const, access: `h.${payload}.s`, refresh: 'r', expires: Date.now() + 3_600_000 };
    expect(oauthCredentialShouldRefresh(cred, 'openai-oauth-2')).toBe(true);
    expect(oauthCredentialShouldRefresh(cred, 'mystery-2')).toBe(false);
  });

  it('keeps Claude Code and ClinePass request handling for numbered accounts', () => {
    expect(isClaudeCodeOAuthRoute({ providerId: 'claude-code-2', authType: 'oauth', apiKey: 'k' })).toBe(true);
    expect(isClaudeCodeOAuthRoute({ providerId: 'groq-2', authType: 'oauth', apiKey: 'k' })).toBe(false);
    expect(isClinePassOAuth('cline-pass-2', 'oauth')).toBe(true);
    expect(isClinePassOAuth('cline-pass-2', 'api')).toBe(false);
  });
});

describe('numbered accounts: lookups and labels', () => {
  it('models.dev bucket follows the kind', () => {
    expect(resolveModelsDevSlug('groq-2')).toBe('groq');
    expect(resolveModelsDevSlug('openai-oauth-2')).toBe('openai');
    expect(resolveModelsDevSlug('qwen-cloud-payg-2')).toBe('alibaba');
  });

  it('stock OAuth wording follows the kind', () => {
    expect(favoriteProviderDisplayName({ id: 'openai-oauth-2', name: 'OpenAI (ChatGPT)', authType: 'oauth' }))
      .toBe('OpenAI OAuth (ChatGPT)');
  });

  it('a numbered Go account is still OpenCode Go', () => {
    expect(isOpenCodeGoEndpoint('go-2')).toBe(true);
  });
});

function registryProvider(over: Partial<RegistryProvider>): RegistryProvider {
  return {
    id: 'x',
    templateId: 'x',
    name: 'X',
    enabled: true,
    authRef: 'keyring:provider:x',
    api: { npm: '@ai-sdk/openai-compatible', url: 'https://example.com/v1' },
    addedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('numbered accounts: registry', () => {
  const materialize = (provider: RegistryProvider) =>
    materializeRegistry({ schemaVersion: 1, providers: [provider] }, () => 'key')[0]!.models[0]!;

  it('ClinePass context handling follows the kind', () => {
    for (const id of ['cline-pass', 'cline-pass-2']) {
      const model = materialize(registryProvider({
        id,
        templateId: 'cline-pass',
        authType: 'oauth',
        modelsCache: {
          fetchedAt: '2026-01-01T00:00:00.000Z',
          models: [{
            id: 'm1', name: 'M1', upstreamModelId: 'm1', modelFormat: 'openai',
            npm: '@ai-sdk/openai-compatible', contextWindow: CLINE_PASS_LEGACY_DEFAULT_CONTEXT_WINDOW,
          }],
        },
      }));
      expect(model.contextWindow, id).toBeUndefined();
    }
  });

  it('Zen/Go model sources follow the kind', () => {
    expect(resolveModelSource(registryProvider({ id: 'go-2', templateId: 'go', api: {} }))).toBe('zen-go-api');
    expect(resolveModelSource(registryProvider({ id: 'zen-3', templateId: 'zen', api: {} }))).toBe('zen-go-api');
  });
});

describe('numbered accounts: policy and credentials', () => {
  it('the Zen free-tier rule applies to a numbered Zen account, not to Go', () => {
    expect(isZenFreeTierModel('zen', 'deepseek-free')).toBe(true);
    expect(isZenFreeTierModel('zen-2', 'deepseek-free')).toBe(true);
    expect(isZenFreeTierModel('go-2', 'deepseek-free')).toBe(false);
  });

  it('an anonymous-capable provider stays anonymous when numbered', async () => {
    const make = (id: string) => ({ id, name: 'Kilo', apiKey: '', models: [] });
    expect(await resolveLocalProviderApiKey(make('kilo'))).toBe('anonymous');
    expect(await resolveLocalProviderApiKey(make('kilo-2'))).toBe('anonymous');
  });
});
