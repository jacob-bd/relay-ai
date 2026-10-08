import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateText, isStepCount, jsonSchema, streamText, tool } from 'ai';
import { createRelayModel } from '../src/core/model.js';
import { applyClaudeCodeOAuthIdentity } from '../src/oauth/claude-code-identity.js';

vi.mock('@napi-rs/keyring', () => ({
  Entry: class { constructor() { throw new Error('isolated test keyring'); } },
}));

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));
vi.mock('../src/oauth/refresh.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/oauth/refresh.js')>(),
  refreshStoredOAuthCredential: refreshMock,
}));

const providerData = {
  cliUserID: 'a'.repeat(64),
  accountUUID: '22222222-2222-4222-8222-222222222222',
};
const credential = {
  type: 'oauth', access: 'test-access', refresh: 'test-refresh',
  expires: Date.now() + 3_600_000, accountId: 'test-account', providerData,
};
const originalFetch = globalThis.fetch;

function configure(id: string, npm: string, model: string, oauth = false) {
  const home = process.env.RELAY_AI_HOME!;
  const account = `${oauth ? 'oauth:' : ''}provider:${id}`;
  writeFileSync(join(home, 'providers.json'), JSON.stringify({
    schemaVersion: 1,
    providers: [{
      id, templateId: id, name: id, enabled: true,
      authRef: `keyring:${account}`, authType: oauth ? 'oauth' : 'api',
      api: { npm, url: 'https://provider.test/v1' },
      modelsCache: { fetchedAt: new Date().toISOString(), models: [{ id: model, name: model }] },
      addedAt: new Date().toISOString(),
    }],
  }));
  writeFileSync(join(home, 'secrets.json'), JSON.stringify({
    version: 1, accounts: { [account]: oauth ? JSON.stringify(credential) : 'test-key' },
  }));
  return `${id}::${model}` as const;
}

function anthropicResponse(content: unknown[] = [{ type: 'text', text: 'OK' }], stopReason = 'end_turn') {
  return Response.json({
    id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-haiku-5-5',
    content, stop_reason: stopReason, stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 2 },
  });
}

function anthropicStream() {
  const events = [
    { type: 'message_start', message: { id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [], usage: { input_tokens: 10, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'OK' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } },
    { type: 'message_stop' },
  ];
  return new Response(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('Core provider request parity', () => {
  let requests: Array<{ body: Record<string, any>; headers: Headers }>;

  beforeEach(() => {
    requests = [];
    refreshMock.mockReset();
  });
  afterEach(() => { globalThis.fetch = originalFetch; });

  function capture(response: (index: number) => Response) {
    globalThis.fetch = vi.fn(async (input, init) => {
      const request = new Request(input, init);
      requests.push({ body: await request.json(), headers: request.headers });
      return response(requests.length - 1);
    });
  }

  it.each(['generate', 'stream'] as const)('sends Claude OAuth identity through real Core + SDK %s', async mode => {
    const route = configure('claude-code', '@ai-sdk/anthropic', 'claude-haiku-5-5', true);
    capture(() => mode === 'stream' ? anthropicStream() : anthropicResponse());
    const model = await createRelayModel(route);
    const params = { model, instructions: 'Keep this instruction.', prompt: 'hello', maxRetries: 0 };
    const result = mode === 'stream' ? streamText(params) : await generateText(params);
    expect(await result.text).toBe('OK');

    const { body, headers } = requests[0];
    expect(body.system[0].text).toMatch(/^x-anthropic-billing-header:/);
    expect(body.system.some((b: { text: string }) => b.text === 'Keep this instruction.')).toBe(true);
    const identity = JSON.parse(body.metadata.user_id);
    expect(identity.device_id).toBe(providerData.cliUserID);
    expect(identity.account_uuid).toBe(providerData.accountUUID);
    expect(identity.session_id).toBe(headers.get('x-claude-code-session-id'));
    expect(headers.get('anthropic-beta')).toContain('oauth-2025-04-20');
    expect(headers.get('authorization')).toBe('Bearer test-access');
  });

  it.each([false, true])('matches launcher identity across tool turns with pre-applied identity=%s', async preApplied => {
    const route = configure('claude-code', '@ai-sdk/anthropic', 'claude-haiku-5-5', true);
    capture(i => i === 0
      ? anthropicResponse([{ type: 'tool_use', id: 'call_1', name: 'calculate', input: {} }], 'tool_use')
      : anthropicResponse());
    const launcher = applyClaudeCodeOAuthIdentity({
      providerId: 'claude-code', authType: 'oauth', apiKey: credential.access,
      oauthAccountId: credential.accountId, providerData, upstreamModelId: 'claude-haiku-5-5',
    }, { instructions: 'Original instruction.', tools: { calculate: {} } });
    await generateText({
      model: await createRelayModel(route),
      ...(preApplied ? launcher : { instructions: 'Original instruction.' }), prompt: 'calculate',
      tools: { calculate: tool({ inputSchema: jsonSchema({ type: 'object', properties: {} }), execute: async () => 42 }) },
      stopWhen: isStepCount(2), maxRetries: 0,
    });
    expect(requests).toHaveLength(2);
    for (const { body, headers } of requests) {
      expect(JSON.stringify(body.system).match(/x-anthropic-billing-header:/g)).toHaveLength(1);
      expect(body.metadata.user_id).toBe(launcher.providerOptions!.anthropic.metadata.userId);
      expect(headers.get('anthropic-beta')).toContain('claude-code-20250219');
    }
  });

  it('leaves Anthropic API-key requests free of subscription identity', async () => {
    capture(() => anthropicResponse());
    await generateText({ model: await createRelayModel(configure('anthropic', '@ai-sdk/anthropic', 'claude-haiku-5-5')), prompt: 'hello' });
    expect(requests[0].body.system).toBeUndefined();
    expect(requests[0].body.metadata).toBeUndefined();
    expect(requests[0].headers.get('x-api-key')).toBe('test-key');
  });

  it('preserves cache controls and custom beta flags on Claude system instructions', async () => {
    const route = configure('claude-code', '@ai-sdk/anthropic', 'claude-haiku-5-5', true);
    capture(() => anthropicResponse());
    await generateText({
      model: await createRelayModel(route), prompt: 'hello', maxOutputTokens: 32,
      instructions: {
        role: 'system', content: 'Cached instruction.',
        providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
      },
      providerOptions: { anthropic: { anthropicBeta: ['custom-beta'] } },
    });
    expect(requests[0].body.system).toContainEqual({
      type: 'text', text: 'Cached instruction.', cache_control: { type: 'ephemeral' },
    });
    expect(requests[0].headers.get('anthropic-beta')).toContain('custom-beta');
    expect(requests[0].headers.get('anthropic-beta')).toContain('oauth-2025-04-20');
  });

  it.each([false, true])('applies OpenAI stateless reasoning defaults and preserves explicit overrides=%s', async override => {
    const route = configure('openai-oauth', '@ai-sdk/openai', 'gpt-5.6-sol', true);
    capture(() => Response.json({
      id: 'resp_test', created_at: 1, model: 'gpt-5.6-sol', status: 'completed',
      output: [{ id: 'msg_test', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'OK', annotations: [] }] }],
      usage: { input_tokens: 10, output_tokens: 2 },
    }));
    await generateText({
      model: await createRelayModel(route), prompt: 'hello', maxRetries: 0,
      ...(override ? { providerOptions: { openai: { store: true, include: ['message.output_text.logprobs'] } } } : {}),
    });
    expect(requests[0].body.store).toBe(override);
    expect(requests[0].body.include).toEqual(override ? ['message.output_text.logprobs'] : ['reasoning.encrypted_content']);
  });

  it.each([undefined, false])('applies Google thought summaries with explicit includeThoughts=%s', async includeThoughts => {
    capture(() => Response.json({
      candidates: [{ index: 0, content: { role: 'model', parts: [{ text: 'OK' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 },
    }));
    await generateText({
      model: await createRelayModel(configure('google', '@ai-sdk/google', 'gemini-3-flash-preview')),
      prompt: 'hello', maxRetries: 0,
      ...(includeThoughts === undefined ? {} : { providerOptions: { google: { thinkingConfig: { includeThoughts } } } }),
    });
    expect(requests[0].body.generationConfig.thinkingConfig.includeThoughts).toBe(includeThoughts ?? true);
  });

  it('adds the Alibaba continuation after a tool result at the shared model boundary', async () => {
    const route = configure('alibaba', '@ai-sdk/alibaba', 'qwen-plus');
    capture(() => Response.json({
      id: 'chat_test', object: 'chat.completion', created: 1, model: 'qwen-plus',
      choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    }));
    await generateText({
      model: await createRelayModel(route), maxRetries: 0,
      messages: [
        { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'call_1', toolName: 'read', input: {} }] },
        { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'call_1', toolName: 'read', output: { type: 'text', value: 'file body' } }] },
      ],
    });
    expect(requests[0].body.messages.at(-1)).toEqual({
      role: 'user', content: [{ type: 'text', text: 'Continue.' }],
    });
  });

  it('refreshes Claude OAuth after one 401 and uses the new token on later calls', async () => {
    const route = configure('claude-code', '@ai-sdk/anthropic', 'claude-haiku-5-5', true);
    refreshMock.mockResolvedValue({ ...credential, access: 'new-test-access' });
    capture(i => i === 0
      ? Response.json({ type: 'error', error: { type: 'authentication_error', message: 'expired' } }, { status: 401 })
      : anthropicResponse());
    const model = await createRelayModel(route);
    await generateText({ model, prompt: 'hello', maxRetries: 0 });
    await generateText({ model, prompt: 'again', maxRetries: 0 });
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(requests.map(r => r.headers.get('authorization'))).toEqual([
      'Bearer test-access', 'Bearer new-test-access', 'Bearer new-test-access',
    ]);
    expect(requests[1].body).toEqual(requests[0].body);
    const saved = JSON.parse(readFileSync(join(process.env.RELAY_AI_HOME!, 'secrets.json'), 'utf8'));
    expect(JSON.parse(saved.accounts['oauth:provider:claude-code']).access).toBe('new-test-access');
  });

  it('does not loop when a refreshed Claude credential is also rejected', async () => {
    const route = configure('claude-code', '@ai-sdk/anthropic', 'claude-haiku-5-5', true);
    refreshMock.mockResolvedValue({ ...credential, access: 'new-test-access' });
    capture(() => Response.json({ type: 'error', error: { type: 'authentication_error', message: 'expired' } }, { status: 401 }));
    await expect(generateText({ model: await createRelayModel(route), prompt: 'hello', maxRetries: 0 })).rejects.toThrow();
    expect(requests).toHaveLength(2);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it.each([403, 429, 500])('does not refresh Claude credentials on HTTP %s', async status => {
    const route = configure('claude-code', '@ai-sdk/anthropic', 'claude-haiku-5-5', true);
    capture(() => Response.json({ type: 'error', error: { type: 'api_error', message: 'refused' } }, { status }));
    await expect(generateText({ model: await createRelayModel(route), prompt: 'hello', maxRetries: 0 })).rejects.toThrow();
    expect(requests).toHaveLength(1);
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
