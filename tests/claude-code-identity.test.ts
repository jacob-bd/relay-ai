import { describe, expect, it } from 'vitest';
import { applyClaudeCodeOAuthIdentity, isClaudeCodeOAuthRoute } from '../src/oauth/claude-code-identity.js';

describe('claude-code OAuth identity', () => {
  it('uses real providerData for Claude Code OAuth user metadata', () => {
    const cliUserID = 'a'.repeat(64);
    const accountUUID = '22222222-2222-4222-8222-222222222222';

    const params = applyClaudeCodeOAuthIdentity({
      providerId: 'claude-code',
      authType: 'oauth',
      apiKey: 'token',
      oauthAccountId: '11111111-1111-4111-8111-111111111111',
      providerData: { cliUserID, accountUUID },
      upstreamModelId: 'claude-sonnet-4-6',
    }, {
      instructions: 'hello',
      tools: { read_file: {} },
    });

    expect(params.instructions).toContain('x-anthropic-billing-header:');
    expect(params.instructions).toContain('hello');
    expect(params.providerOptions?.anthropic?.metadata?.userId).toContain(`"device_id":"${cliUserID}"`);
    expect(params.providerOptions?.anthropic?.metadata?.userId).toContain(`"account_uuid":"${accountUUID}"`);
    expect(params.providerOptions?.anthropic?.anthropicBeta).toContain('oauth-2025-04-20');
    expect(params.providerOptions?.anthropic?.anthropicBeta).toContain('claude-code-20250219');
    expect(params.providerOptions?.anthropic?.anthropicBeta).toContain('advanced-tool-use-2025-11-20');
    expect(params.providerOptions?.anthropic?.anthropicBeta).toContain('effort-2025-11-24');
  });

  it('does nothing for non-Claude-Code OAuth routes', () => {
    const original = { instructions: 'hello' };
    const params = applyClaudeCodeOAuthIdentity({
      providerId: 'anthropic',
      authType: 'oauth',
      apiKey: 'token',
    }, original);

    expect(params).toBe(original);
    expect(isClaudeCodeOAuthRoute({
      providerId: 'anthropic',
      authType: 'oauth',
      apiKey: 'token',
    })).toBe(false);
  });
});
