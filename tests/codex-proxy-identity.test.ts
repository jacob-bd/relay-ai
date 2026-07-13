import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLanguageModel } from '../src/provider-factory.js';
import { generateResponsesResponse } from '../src/codex-responses-adapter.js';
import { startCodexProxy, type CodexProxyHandle } from '../src/codex-proxy.js';

vi.mock('../src/provider-factory.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/provider-factory.js')>();
  return {
    ...actual,
    createLanguageModel: vi.fn().mockResolvedValue({}),
  };
});

vi.mock('../src/codex-responses-adapter.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/codex-responses-adapter.js')>();
  return {
    ...actual,
    generateResponsesResponse: vi.fn().mockResolvedValue({
      id: 'resp_mock',
      object: 'response',
      output: [],
    }),
  };
});

describe('Codex proxy Claude Code OAuth identity', () => {
  let handle: CodexProxyHandle | undefined;

  afterEach(() => {
    handle?.close();
    handle = undefined;
    vi.mocked(createLanguageModel).mockClear();
    vi.mocked(generateResponsesResponse).mockClear();
  });

  it('passes the stable provider id into the SDK provider factory', async () => {
    handle = await startCodexProxy([{
      modelId: 'claude-code__claude-sonnet-4-6',
      npm: '@ai-sdk/anthropic',
      apiKey: 'oauth-token',
      upstreamModelId: 'claude-sonnet-4-6',
      providerId: 'claude-code',
      authType: 'oauth',
      oauthAccountId: '11111111-1111-4111-8111-111111111111',
    }], { requireAuth: false });

    expect(createLanguageModel).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'claude-code',
    }));
  });

  it('adds Claude Code OAuth billing and user metadata per request', async () => {
    const cliUserID = 'a'.repeat(64);
    const accountUUID = '22222222-2222-4222-8222-222222222222';

    handle = await startCodexProxy([{
      modelId: 'claude-code__claude-sonnet-4-6',
      npm: '@ai-sdk/anthropic',
      apiKey: 'oauth-token',
      upstreamModelId: 'claude-sonnet-4-6',
      providerId: 'claude-code',
      authType: 'oauth',
      oauthAccountId: '11111111-1111-4111-8111-111111111111',
      providerData: { cliUserID, accountUUID },
    }], { requireAuth: false });

    const res = await fetch(`http://127.0.0.1:${handle.port}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-code__claude-sonnet-4-6',
        input: 'hello',
        instructions: 'You are helpful.',
        stream: false,
      }),
    });

    expect(res.status, await res.text()).toBe(200);
    const params = vi.mocked(generateResponsesResponse).mock.calls.at(-1)![1] as any;
    expect(params.instructions).toContain('x-anthropic-billing-header:');
    expect(params.instructions).toContain('You are helpful.');
    expect(params.providerOptions?.anthropic?.metadata?.userId).toContain(`"device_id":"${cliUserID}"`);
    expect(params.providerOptions?.anthropic?.metadata?.userId).toContain(`"account_uuid":"${accountUUID}"`);
    expect(params.providerOptions?.anthropic?.anthropicBeta).toContain('oauth-2025-04-20');
  });
});
