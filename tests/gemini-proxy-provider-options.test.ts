import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamText } from 'ai';
import { createLanguageModel } from '../src/provider-factory.js';
import { startGeminiProxy } from '../src/gemini-proxy.js';
import type { ProxyHandle, ProxyRoute } from '../src/proxy.js';

vi.mock('ai', () => ({
  streamText: vi.fn().mockImplementation(() => ({
    stream: (async function* () {
      yield { type: 'text-delta', textDelta: 'ok' };
      yield { type: 'finish', finishReason: 'stop', totalUsage: { inputTokens: 1, outputTokens: 1 } };
    })(),
  })),
  generateText: vi.fn(),
  jsonSchema: vi.fn(schema => schema),
  tool: vi.fn(def => def),
}));

vi.mock('../src/provider-factory.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/provider-factory.js')>();
  return {
    ...actual,
    createLanguageModel: vi.fn().mockResolvedValue({}),
  };
});

describe('startGeminiProxy provider options', () => {
  const handles: ProxyHandle[] = [];

  afterEach(async () => {
    vi.mocked(streamText).mockClear();
    vi.mocked(createLanguageModel).mockClear();
    await Promise.all(handles.map(handle => handle.close()));
    handles.length = 0;
  });

  it('adds Claude Code OAuth identity to Anthropic SDK requests', async () => {
    const cliUserID = 'a'.repeat(64);
    const accountUUID = '22222222-2222-4222-8222-222222222222';
    const route: ProxyRoute = {
      aliasId: 'anthropic-claude-code__claude-sonnet-4-6',
      realModelId: 'claude-sonnet-4-6',
      displayName: 'Claude Sonnet',
      upstreamUrl: 'https://api.anthropic.com',
      apiKey: 'oauth-token',
      modelFormat: 'anthropic',
      npm: '@ai-sdk/anthropic',
      providerId: 'claude-code',
      authType: 'oauth',
      oauthAccountId: '11111111-1111-4111-8111-111111111111',
      providerData: { cliUserID, accountUUID },
    };
    const handle = await startGeminiProxy([route]);
    handles.push(handle);

    const res = await fetch(`http://127.0.0.1:${handle.port}/v1beta/models/${route.aliasId}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': handle.token,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: 'You are helpful.' }] },
        tools: [{
          functionDeclarations: [{
            name: 'read_file',
            description: 'Read a file',
            parameters: { type: 'OBJECT', properties: { path: { type: 'STRING' } } },
          }],
        }],
        contents: [{ role: 'user', parts: [{ text: 'hey' }] }],
      }),
    });

    const text = await res.text();
    expect(res.status, text).toBe(200);
    expect(createLanguageModel).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'claude-code',
    }));
    const streamCall = vi.mocked(streamText).mock.calls.at(-1)![0] as any;
    expect(streamCall.instructions).toContain('x-anthropic-billing-header:');
    expect(streamCall.instructions).toContain('You are helpful.');
    expect(streamCall.providerOptions?.anthropic?.metadata?.userId).toContain(`"device_id":"${cliUserID}"`);
    expect(streamCall.providerOptions?.anthropic?.metadata?.userId).toContain(`"account_uuid":"${accountUUID}"`);
    expect(streamCall.providerOptions?.anthropic?.anthropicBeta).toContain('oauth-2025-04-20');
    // Model-specific betas require upstreamModelId (ProxyRoute.realModelId), not the gateway alias.
    expect(streamCall.providerOptions?.anthropic?.anthropicBeta).toContain('advanced-tool-use-2025-11-20');
    expect(streamCall.providerOptions?.anthropic?.anthropicBeta).toContain('effort-2025-11-24');
  });

  it('sets store false for OpenAI OAuth Responses routes', async () => {
    const route: ProxyRoute = {
      aliasId: 'openai-oauth__gpt-5.4-mini',
      realModelId: 'gpt-5.4-mini',
      displayName: 'GPT-5.4 Mini',
      upstreamUrl: 'https://chatgpt.com/backend-api/codex',
      apiKey: 'oauth-token',
      modelFormat: 'openai',
      npm: '@ai-sdk/openai',
      authType: 'oauth',
      oauthAccountId: 'acct-openai',
    };
    const handle = await startGeminiProxy([route]);
    handles.push(handle);

    const res = await fetch(`http://127.0.0.1:${handle.port}/v1beta/models/${route.aliasId}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': handle.token,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'hey' }] }],
      }),
    });

    const text = await res.text();
    expect(res.status, text).toBe(200);
    expect(text).toContain('"modelVersion":"openai-oauth__gpt-5.4-mini"');
    const streamCall = vi.mocked(streamText).mock.calls.at(-1)![0] as any;
    expect(streamCall.providerOptions?.openai).toMatchObject({
      store: false,
      include: ['reasoning.encrypted_content'],
    });
  });

  it('streams concise upstream errors instead of SDK dumps', async () => {
    vi.mocked(streamText).mockImplementationOnce(() => ({
      stream: (async function* () {
        const err = new Error('Third-party apps now draw from your extra usage, not your plan limits. Add more at claude.ai/settings/usage and keep going.') as Error & {
          statusCode?: number;
          responseBody?: string;
        };
        err.statusCode = 400;
        err.responseBody = JSON.stringify({
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message: 'Third-party apps now draw from your extra usage, not your plan limits. Add more at claude.ai/settings/usage and keep going.',
          },
        });
        throw err;
        yield { type: 'finish' };
      })(),
    }) as any);

    const route: ProxyRoute = {
      aliasId: 'claude-sonnet-5',
      realModelId: 'claude-sonnet-5',
      displayName: 'Claude Sonnet 5',
      upstreamUrl: 'http://127.0.0.1:12345',
      apiKey: 'oauth-token',
      modelFormat: 'anthropic',
      npm: '@ai-sdk/anthropic',
      authType: 'oauth',
      oauthAccountId: 'acct-claude',
    };
    const handle = await startGeminiProxy([route]);
    handles.push(handle);

    const res = await fetch(`http://127.0.0.1:${handle.port}/v1beta/models/${route.aliasId}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': handle.token,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'hey' }] }],
      }),
    });

    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).toContain('Third-party apps now draw from your extra usage');
    expect(text).toContain('HTTP 400');
    expect(text).not.toContain('APICallError');
    expect(text).not.toContain('requestBodyValues');
  });

  it('returns the switched model as modelVersion', async () => {
    const routes: ProxyRoute[] = [
      {
        aliasId: 'deepseek-v4-pro',
        realModelId: 'deepseek-v4-pro',
        displayName: 'DeepSeek V4 Pro',
        upstreamUrl: 'https://api.deepseek.com',
        apiKey: 'deepseek-key',
        modelFormat: 'openai',
        npm: '@ai-sdk/openai-compatible',
      },
      {
        aliasId: 'grok-build-0.1',
        realModelId: 'grok-build-0.1',
        displayName: 'grok-build-0.1',
        upstreamUrl: 'https://api.x.ai',
        apiKey: 'xai-key',
        modelFormat: 'openai',
        npm: '@ai-sdk/xai',
      },
    ];
    const handle = await startGeminiProxy(routes);
    handles.push(handle);

    const switchRes = await fetch(`http://127.0.0.1:${handle.port}/v1beta/models/deepseek-v4-pro:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': handle.token,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: '.model grok-build-0.1' }] }],
      }),
    });

    const switchText = await switchRes.text();
    expect(switchRes.status, switchText).toBe(200);
    expect(switchText).toContain('Switched model to grok-build-0.1');
    expect(switchText).toContain('"modelVersion":"grok-build-0.1"');

    const promptRes = await fetch(`http://127.0.0.1:${handle.port}/v1beta/models/deepseek-v4-pro:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': handle.token,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'hey' }] }],
      }),
    });

    const promptText = await promptRes.text();
    expect(promptRes.status, promptText).toBe(200);
    expect(promptText).toContain('"modelVersion":"grok-build-0.1"');
  });
});
