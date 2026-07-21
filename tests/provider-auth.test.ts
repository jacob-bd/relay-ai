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
    bootstrap: { accountId: 'acct-123' },
  })),
  generateCliUserID: vi.fn(() => 'cli-user-id'),
}));
vi.mock('../src/env.js', () => ({
  saveProviderCredential: vi.fn(async () => false),
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

import { saveProviderCredential } from '../src/env.js';
import { saveRegistry } from '../src/registry/io.js';
import { authenticateProvider } from '../src/registry/provider-auth.js';
import { runOpencodeAuthBroker } from '../src/registry/auth-broker.js';
import { runAntigravityOAuthFlow } from '../src/oauth/antigravity-oauth.js';
import { runClaudeCodeOAuthFlow } from '../src/oauth/claude-code.js';
import * as prompts from '@clack/prompts';

describe('authenticateProvider', () => {
  beforeEach(() => {
    vi.mocked(saveProviderCredential).mockClear();
    vi.mocked(saveRegistry).mockClear();
    vi.mocked(runOpencodeAuthBroker).mockClear();
    vi.mocked(runAntigravityOAuthFlow).mockClear();
    vi.mocked(runClaudeCodeOAuthFlow).mockClear();
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

  it('launches Antigravity OAuth directly without an OpenCode submenu', async () => {
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
});
