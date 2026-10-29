import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../src/opencode-serve.js', () => ({
  findOpencodeBinary: vi.fn(() => null),
  fetchRawOpencodeProviders: vi.fn(async () => null),
}));
vi.mock('../src/registry/auth-broker.js', () => ({
  runOpencodeAuthBroker: vi.fn(async () => {
    throw new Error('broker should not be called');
  }),
}));
vi.mock('../src/ui.js', () => ({
  printOAuthStepsPanel: vi.fn(),
  confirmSubscriptionOAuthRisk: vi.fn(async () => true),
}));
vi.mock('../src/oauth/antigravity-oauth.js', () => ({
  runAntigravityOAuthFlow: vi.fn(async () => ({
    tokens: { access_token: 'antigravity-access', refresh_token: 'antigravity-refresh' },
    userInfo: { email: 'jacob@example.com' },
  })),
}));
vi.mock('../src/oauth/claude-code.js', () => ({
  runClaudeCodeOAuthFlow: vi.fn(async () => ({
    tokens: { access_token: 'claude-access', refresh_token: 'claude-refresh' },
    bootstrap: { accountId: 'acct-123', email: 'claude@example.com' },
  })),
  generateCliUserID: vi.fn(() => 'cli-user-id'),
}));
vi.mock('../src/oauth/cline-pass.js', () => ({
  runClinePassDeviceCodeFlow: vi.fn(async () => ({
    tokens: {
      access_token: 'cline-access',
      refresh_token: 'cline-refresh',
      expires_in: 3600,
    },
    accountId: 'cline-user',
    providerData: { email: 'jacob@example.com' },
  })),
}));
vi.mock('../src/oauth/openai.js', () => ({
  runOpenAiDeviceCodeFlow: vi.fn(),
}));
vi.mock('../src/env.js', () => ({
  saveProviderCredential: vi.fn(async () => false),
  deleteProviderCredential: vi.fn(async () => true),
  readStoredOAuthCredential: vi.fn(async () => undefined),
}));
vi.mock('../src/registry/io.js', () => ({
  loadRegistry: vi.fn(() => ({ version: 1, providers: [] })),
  saveRegistry: vi.fn(),
}));
vi.mock('../src/registry/refresh-models.js', () => ({
  refreshProviderModels: vi.fn(),
}));
vi.mock('@clack/prompts', () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), success: vi.fn() },
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  select: vi.fn(),
  isCancel: vi.fn(() => false),
}));

import { readStoredOAuthCredential, saveProviderCredential } from '../src/env.js';
import { runOpenAiDeviceCodeFlow } from '../src/oauth/openai.js';
import { deleteProviderCredential } from '../src/env.js';
import { loadRegistry, saveRegistry } from '../src/registry/io.js';
import { refreshProviderModels } from '../src/registry/refresh-models.js';
import { authenticateProvider } from '../src/registry/provider-auth.js';
import { runOpencodeAuthBroker } from '../src/registry/auth-broker.js';
import { runAntigravityOAuthFlow } from '../src/oauth/antigravity-oauth.js';
import { runClaudeCodeOAuthFlow } from '../src/oauth/claude-code.js';
import { runClinePassDeviceCodeFlow } from '../src/oauth/cline-pass.js';
import * as prompts from '@clack/prompts';

describe('authenticateProvider', () => {
  beforeEach(() => {
    vi.mocked(saveProviderCredential).mockClear();
    vi.mocked(deleteProviderCredential).mockClear();
    vi.mocked(saveRegistry).mockClear();
    vi.mocked(loadRegistry).mockReturnValue({ version: 1, providers: [] });
    vi.mocked(runOpencodeAuthBroker).mockClear();
    vi.mocked(runAntigravityOAuthFlow).mockClear();
    vi.mocked(runClaudeCodeOAuthFlow).mockClear();
    vi.mocked(runClinePassDeviceCodeFlow).mockClear();
    vi.mocked(prompts.select).mockClear();
  });

  it('rejects unsupported OAuth without calling the OpenCode broker', async () => {
    await expect(authenticateProvider('gitlab')).rejects.toThrow(/not built into relay-ai/i);
    expect(runOpencodeAuthBroker).not.toHaveBeenCalled();
    expect(prompts.select).not.toHaveBeenCalled();
  });

  it('rejects --broker and points users at native auth or providers import', async () => {
    await expect(authenticateProvider('xai-oauth', { method: 'broker' })).rejects.toThrow(/no longer used/i);
    expect(runOpencodeAuthBroker).not.toHaveBeenCalled();
  });

  it('launches Cloud Code Assist directly without an OpenCode submenu', async () => {
    const result = await authenticateProvider('antigravity');

    expect(prompts.select).not.toHaveBeenCalled();
    expect(runOpencodeAuthBroker).not.toHaveBeenCalled();
    expect(runAntigravityOAuthFlow).toHaveBeenCalled();
    expect(result.providerId).toBe('antigravity');
  });

  it('launches Claude Code OAuth directly without an OpenCode submenu', async () => {
    const result = await authenticateProvider('claude-code');

    expect(prompts.select).not.toHaveBeenCalled();
    expect(runOpencodeAuthBroker).not.toHaveBeenCalled();
    expect(runClaudeCodeOAuthFlow).toHaveBeenCalled();
    expect(result.providerId).toBe('claude-code');
  });

  it('keeps the Claude account email so the account can be shown later', async () => {
    vi.mocked(saveProviderCredential).mockResolvedValue(true);
    const result = await authenticateProvider('claude-code');

    expect(result.credential.providerData?.identity).toEqual({ email: 'claude@example.com' });
  });

  it('launches the ClinePass device flow instead of falling through to OpenAI', async () => {
    vi.mocked(saveProviderCredential).mockResolvedValue(true);
    const result = await authenticateProvider('cline-pass');

    expect(runClinePassDeviceCodeFlow).toHaveBeenCalled();
    expect(result.providerId).toBe('cline-pass');
    expect(saveProviderCredential).toHaveBeenCalledWith(
      'keyring:oauth:provider:cline-pass',
      expect.stringContaining('cline-access'),
      expect.any(Function),
    );
  });

  it('deletes an old API-key secret after ClinePass OAuth replacement succeeds', async () => {
    vi.mocked(saveProviderCredential).mockResolvedValue(true);
    vi.mocked(loadRegistry).mockReturnValue({
      version: 1,
      providers: [{
        id: 'cline-pass',
        templateId: 'cline-pass',
        name: 'ClinePass',
        enabled: true,
        authType: 'api',
        authRef: 'keyring:provider:cline-pass',
        api: { npm: '@ai-sdk/openai-compatible', url: 'https://api.cline.bot/api/v1' },
        addedAt: '2026-08-06T00:00:00.000Z',
      }],
    });

    await authenticateProvider('cline-pass');

    expect(deleteProviderCredential).toHaveBeenCalledWith('keyring:provider:cline-pass');
  });

  const clineEntry = (over: Record<string, unknown> = {}) => ({
    id: 'cline-pass',
    templateId: 'cline-pass',
    name: 'ClinePass',
    enabled: true,
    authType: 'oauth' as const,
    authRef: 'keyring:oauth:provider:cline-pass',
    api: { npm: '@ai-sdk/openai-compatible', url: 'https://api.cline.bot/api/v1' },
    addedAt: '2026-08-06T00:00:00.000Z',
    ...over,
  });

  it('keeps the user-chosen name when signing in again', async () => {
    vi.mocked(saveProviderCredential).mockResolvedValue(true);
    vi.mocked(loadRegistry).mockReturnValue({
      version: 1,
      providers: [clineEntry({ name: 'Work Cline', nameCustomized: true })],
    });

    await authenticateProvider('cline-pass');

    const saved = vi.mocked(saveRegistry).mock.calls.at(-1)?.[0] as { providers: Array<{ name: string; nameCustomized?: boolean }> };
    expect(saved.providers[0]?.name).toBe('Work Cline');
    expect(saved.providers[0]?.nameCustomized).toBe(true);
  });

  it('numbers a new sign-in whose stock name is already taken by another provider', async () => {
    vi.mocked(saveProviderCredential).mockResolvedValue(true);
    vi.mocked(loadRegistry).mockReturnValue({
      version: 1,
      providers: [clineEntry({ id: 'custom-x', templateId: 'custom-openai', name: 'clinepass', authRef: 'keyring:provider:custom-x' })],
    });

    await authenticateProvider('cline-pass');

    const saved = vi.mocked(saveRegistry).mock.calls.at(-1)?.[0] as { providers: Array<{ id: string; name: string; nameCustomized?: boolean }> };
    const added = saved.providers.find(p => p.id === 'cline-pass');
    expect(added?.name).toBe('ClinePass 2');
    expect(added?.nameCustomized).toBe(true);
  });
});

describe('authenticateProvider: several accounts of one provider', () => {
  const jwt = (claims: Record<string, unknown>) => {
    const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${enc({ alg: 'none' })}.${enc(claims)}.sig`;
  };
  const openAiLogin = (email: string, userId = `user-${email}`) => ({
    tokens: {
      access_token: 'opaque-access',
      refresh_token: 'refresh',
      id_token: jwt({ email, 'https://api.openai.com/auth': { chatgpt_user_id: userId, chatgpt_plan_type: 'plus' } }),
    },
    accountId: 'workspace-1',
  });
  const chatgpt = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    templateId: 'openai',
    name: id === 'openai-oauth' ? 'OpenAI (ChatGPT)' : `ChatGPT ${id}`,
    enabled: true,
    authType: 'oauth' as const,
    authRef: `keyring:oauth:provider:${id}`,
    api: { npm: '@ai-sdk/openai', url: '' },
    addedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  });
  const stored = new Map<string, unknown>();
  const savedRegistry = () => vi.mocked(saveRegistry).mock.calls.at(-1)?.[0] as { providers: Array<Record<string, any>> };

  beforeEach(() => {
    stored.clear();
    vi.mocked(saveProviderCredential).mockReset().mockResolvedValue(true);
    vi.mocked(deleteProviderCredential).mockClear();
    vi.mocked(saveRegistry).mockClear();
    vi.mocked(refreshProviderModels).mockReset();
    vi.mocked(readStoredOAuthCredential).mockReset().mockImplementation(async (authRef: string) => stored.get(authRef) as any);
    vi.mocked(runOpenAiDeviceCodeFlow).mockReset().mockResolvedValue(openAiLogin('personal@example.com') as any);
  });

  const withRegistry = (...providers: Array<ReturnType<typeof chatgpt>>) =>
    vi.mocked(loadRegistry).mockReturnValue({ version: 1, providers } as any);
  const storedLogin = (id: string, email: string) => stored.set(`keyring:oauth:provider:${id}`, {
    type: 'oauth', access: 'x', refresh: 'r', expires: Date.now() + 1000, providerData: { identity: { email } },
  });

  it('adds a second account under its own id, keychain item and numbered name', async () => {
    withRegistry(chatgpt('openai-oauth'));
    storedLogin('openai-oauth', 'work@example.com');

    const result = await authenticateProvider('openai-oauth', { addAccount: true });

    expect(result.providerId).toBe('openai-oauth-2');
    expect(saveProviderCredential).toHaveBeenCalledWith('keyring:oauth:provider:openai-oauth-2', expect.any(String), expect.any(Function));
    const added = savedRegistry().providers.find(p => p.id === 'openai-oauth-2');
    expect(added).toMatchObject({ templateId: 'openai', authType: 'oauth', authRef: 'keyring:oauth:provider:openai-oauth-2', name: 'OpenAI (ChatGPT) 2', nameCustomized: true });
    expect(savedRegistry().providers.find(p => p.id === 'openai-oauth')?.name).toBe('OpenAI (ChatGPT)');
    expect(refreshProviderModels).toHaveBeenCalledWith('openai-oauth-2', 'opaque-access');
  });

  it('takes the next free number', async () => {
    withRegistry(chatgpt('openai-oauth'), chatgpt('openai-oauth-2'));
    storedLogin('openai-oauth', 'a@example.com');
    storedLogin('openai-oauth-2', 'b@example.com');
    expect((await authenticateProvider('openai-oauth', { addAccount: true })).providerId).toBe('openai-oauth-3');
  });

  it('adding with nothing configured yet uses the normal first slot', async () => {
    withRegistry();
    expect((await authenticateProvider('openai-oauth', { addAccount: true })).providerId).toBe('openai-oauth');
  });

  it('refuses the same person twice and saves nothing', async () => {
    withRegistry(chatgpt('openai-oauth'));
    storedLogin('openai-oauth', 'Personal@Example.com');

    await expect(authenticateProvider('openai-oauth', { addAccount: true })).rejects.toThrow(/already signed in/i);

    expect(saveProviderCredential).not.toHaveBeenCalled();
    expect(saveRegistry).not.toHaveBeenCalled();
  });

  it('names the provider that already holds the account', async () => {
    withRegistry(chatgpt('openai-oauth', { name: 'Work ChatGPT' }));
    storedLogin('openai-oauth', 'personal@example.com');
    await expect(authenticateProvider('openai-oauth', { addAccount: true })).rejects.toThrow(/Work ChatGPT/);
  });

  it('signing in again as the same person replaces that account', async () => {
    withRegistry(chatgpt('openai-oauth-2', { name: 'My Personal' , nameCustomized: true } as any));
    storedLogin('openai-oauth-2', 'personal@example.com');

    const result = await authenticateProvider('openai-oauth-2');

    expect(result.providerId).toBe('openai-oauth-2');
    expect(saveProviderCredential).toHaveBeenCalledWith('keyring:oauth:provider:openai-oauth-2', expect.any(String), expect.any(Function));
    expect(savedRegistry().providers).toHaveLength(1);
    expect(savedRegistry().providers[0]?.name).toBe('My Personal');
  });

  it('refuses to sign an account in again as someone who is already another account', async () => {
    withRegistry(chatgpt('openai-oauth'), chatgpt('openai-oauth-2'));
    storedLogin('openai-oauth', 'work@example.com');
    storedLogin('openai-oauth-2', 'personal@example.com');   // the new login is this person

    await expect(authenticateProvider('openai-oauth')).rejects.toThrow(/already signed in/i);
    expect(saveProviderCredential).not.toHaveBeenCalled();
  });

  it('without --new, signing in to a kind that exists replaces it, as before', async () => {
    withRegistry(chatgpt('openai-oauth'));
    storedLogin('openai-oauth', 'old@example.com');

    const result = await authenticateProvider('openai-oauth');

    expect(result.providerId).toBe('openai-oauth');
    expect(savedRegistry().providers).toHaveLength(1);
  });

  it('rejects an unknown account id', async () => {
    withRegistry(chatgpt('openai-oauth'));
    await expect(authenticateProvider('openai-oauth-7')).rejects.toThrow(/not found/i);
    expect(runOpenAiDeviceCodeFlow).not.toHaveBeenCalled();
  });

  it('a second Claude Code or Antigravity account is not available yet', async () => {
    await expect(authenticateProvider('antigravity', { addAccount: true })).rejects.toThrow(/not available yet/i);
    await expect(authenticateProvider('claude-code', { addAccount: true })).rejects.toThrow(/not available yet/i);
    expect(runAntigravityOAuthFlow).not.toHaveBeenCalled();
  });
});
