import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildClaudeCodeAuthUrl,
  exchangeClaudeCodeToken,
  refreshClaudeCodeToken,
  CLAUDE_CODE_CLI_VERSION,
} from '../src/oauth/claude-code.js';
import { CLAUDE_CODE_CLI_VERSION as IDENTITY_VERSION } from '../src/oauth/claude-identity.js';

// Mirrors what Claude Code 2.1.312 itself uses (read from its binary).
describe('Claude Code OAuth endpoints match the current Claude Code', () => {
  const originalFetch = global.fetch;
  const okResponse = () =>
    ({ ok: true, status: 200, json: async () => ({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }), text: async () => '{}' }) as Response;

  beforeEach(() => {
    global.fetch = vi.fn().mockImplementation(async () => okResponse());
  });
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('opens the sign-in page at claude.com/cai/oauth/authorize', async () => {
    const { authUrl } = await buildClaudeCodeAuthUrl();
    const url = new URL(authUrl);
    expect(`${url.origin}${url.pathname}`).toBe('https://claude.com/cai/oauth/authorize');
  });

  it('exchanges the code at platform.claude.com/v1/oauth/token', async () => {
    await exchangeClaudeCodeToken('code', 'verifier', 'https://platform.claude.com/oauth/code/callback', 'state');
    expect(vi.mocked(global.fetch).mock.calls[0]![0]).toBe('https://platform.claude.com/v1/oauth/token');
  });

  it('refreshes at platform.claude.com/v1/oauth/token without a scope (Anthropic rejects one: invalid_scope)', async () => {
    await refreshClaudeCodeToken('refresh-token');
    const [url, init] = vi.mocked(global.fetch).mock.calls[0]!;
    expect(String(url)).toBe('https://platform.claude.com/v1/oauth/token');
    const body = JSON.parse(String(init?.body));
    expect(body.grant_type).toBe('refresh_token');
    expect(body.scope).toBeUndefined();
  });

  it('presents the current Claude Code version, in one place', () => {
    expect(CLAUDE_CODE_CLI_VERSION).toBe('2.1.312');
    expect(IDENTITY_VERSION).toBe('2.1.312');
  });
});
