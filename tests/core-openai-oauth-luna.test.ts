// tests/core-openai-oauth-luna.test.ts — createRelayModel('openai-oauth::gpt-5.6-luna')
// consumed by the installed AI SDK streamText(), with a fake Responses-Lite WebSocket.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stepCountIs, streamText, tool } from 'ai';
import { z } from 'zod';

const ACCESS_CANARY = 'sk-canary-openai-oauth-zzz';
const ACCOUNT_CANARY = 'acct-chatgpt-canary';

const { fakeSockets } = vi.hoisted(() => ({ fakeSockets: [] as FakeWebSocket[] }));

class FakeWebSocket extends EventEmitter {
  url: string;
  options: { headers?: Record<string, string> };
  send = vi.fn();
  close = vi.fn();
  constructor(url: string, options: { headers?: Record<string, string> }) {
    super();
    this.url = url;
    this.options = options;
    fakeSockets.push(this);
  }
}

vi.mock('ws', () => ({ WebSocket: FakeWebSocket, default: FakeWebSocket }));

vi.mock('@napi-rs/keyring', () => ({
  Entry: class {
    constructor() { throw new Error('keyring unavailable in test'); }
  },
}));

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));
vi.mock('../src/oauth/refresh.js', async importOriginal => {
  const original = await importOriginal<typeof import('../src/oauth/refresh.js')>();
  return { ...original, refreshStoredOAuthCredential: refreshMock };
});

const { createRelayModel } = await import('../src/core/model.js');

function lastSocket(): FakeWebSocket {
  return fakeSockets[fakeSockets.length - 1]!;
}

function usageBlock() {
  return { input_tokens: 24, output_tokens: 6, output_tokens_details: { reasoning_tokens: 2 } };
}

/** Frames that match production: usage arrives, required SDK fields are missing. */
function productionLikeTextFrames(text: string) {
  return [
    { type: 'response.created', response: { id: 'resp_prod', created_at: 1, model: 'gpt-5.6-luna' } },
    { type: 'response.output_text.delta', delta: text },
    { type: 'response.completed', response: { usage: usageBlock(), service_tier: 'priority' } },
  ];
}

function sdkValidTextFrames(text: string) {
  return [
    { type: 'response.created', response: { id: 'resp_ok', created_at: 1, model: 'gpt-5.6-luna' } },
    { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg_1' } },
    { type: 'response.output_text.delta', item_id: 'msg_1', delta: text },
    { type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: 'msg_1' } },
    { type: 'response.completed', response: { usage: usageBlock() } },
  ];
}

function completedOnlyTextFrames(text: string) {
  return [
    { type: 'response.created', response: { id: 'resp_buf', created_at: 1, model: 'gpt-5.6-luna' } },
    {
      type: 'response.completed',
      response: {
        usage: usageBlock(),
        output: [{
          type: 'message',
          id: 'msg_buf',
          role: 'assistant',
          content: [{ type: 'output_text', text }],
        }],
      },
    },
  ];
}

function productionLikeToolFrames() {
  return [
    { type: 'response.created', response: { id: 'resp_tool', created_at: 1, model: 'gpt-5.6-luna' } },
    {
      type: 'response.output_item.added',
      output_index: 0,
      item: { type: 'function_call', name: 'getWeather', call_id: 'call_weather' },
    },
    { type: 'response.function_call_arguments.delta', delta: '{"city":"NYC"}' },
    {
      type: 'response.completed',
      response: {
        usage: usageBlock(),
        output: [{
          type: 'function_call',
          id: 'fc_1',
          call_id: 'call_weather',
          name: 'getWeather',
          arguments: '{"city":"NYC"}',
        }],
      },
    },
  ];
}

function sdkValidToolFrames() {
  return [
    { type: 'response.created', response: { id: 'resp_tool_ok', created_at: 1, model: 'gpt-5.6-luna' } },
    {
      type: 'response.output_item.added',
      output_index: 0,
      item: {
        type: 'function_call',
        id: 'fc_1',
        call_id: 'call_weather',
        name: 'getWeather',
        arguments: '',
      },
    },
    {
      type: 'response.function_call_arguments.delta',
      item_id: 'fc_1',
      output_index: 0,
      delta: '{"city":"NYC"}',
    },
    {
      type: 'response.output_item.done',
      output_index: 0,
      item: {
        type: 'function_call',
        id: 'fc_1',
        call_id: 'call_weather',
        name: 'getWeather',
        arguments: '{"city":"NYC"}',
        status: 'completed',
      },
    },
    { type: 'response.completed', response: { usage: usageBlock() } },
  ];
}

describe('createRelayModel openai-oauth Luna via streamText', () => {
  let home: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    fakeSockets.length = 0;
    home = mkdtempSync(join(tmpdir(), 'relay-core-luna-'));
    prevHome = process.env.RELAY_AI_HOME;
    process.env.RELAY_AI_HOME = home;
    refreshMock.mockReset();
    writeFileSync(join(home, 'providers.json'), JSON.stringify({
      schemaVersion: 1,
      providers: [{
        id: 'openai-oauth',
        templateId: 'openai',
        name: 'OpenAI (ChatGPT)',
        enabled: true,
        authRef: 'keyring:oauth:provider:openai-oauth',
        authType: 'oauth',
        api: { npm: '@ai-sdk/openai', url: 'https://api.openai.com/v1' },
        modelsCache: {
          fetchedAt: '2026-08-13T00:00:00Z',
          models: [
            {
              id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', upstreamModelId: 'gpt-5.6-luna',
              modelFormat: 'openai', reasoning: true, useResponsesLite: true, preferWebSockets: true,
            },
            {
              id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', upstreamModelId: 'gpt-5.6-sol',
              modelFormat: 'openai', reasoning: true,
            },
          ],
        },
        addedAt: '2026-08-13T00:00:00Z',
      }],
    }));
    writeFileSync(join(home, 'secrets.json'), JSON.stringify({
      version: 1,
      accounts: {
        'oauth:provider:openai-oauth': JSON.stringify({
          type: 'oauth',
          access: ACCESS_CANARY,
          refresh: 'refresh-openai',
          expires: Date.now() + 3_600_000,
          accountId: ACCOUNT_CANARY,
        }),
      },
    }));
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.RELAY_AI_HOME;
    else process.env.RELAY_AI_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  });

  async function runLuna(frames: unknown[], extra: Parameters<typeof streamText>[0] = {} as never) {
    const debugLines: string[] = [];
    const model = await createRelayModel('openai-oauth::gpt-5.6-luna', {
      onDebug: msg => { debugLines.push(msg); },
    });
    expect(model.provider).toContain('openai');
    const errors: unknown[] = [];
    const result = streamText({
      model,
      prompt: 'hey',
      maxRetries: 0,
      onError: ({ error }) => { errors.push(error); },
      ...extra,
    });
    const textPromise = result.text;
    await vi.waitFor(() => expect(fakeSockets.length).toBe(1));
    const socket = lastSocket();
    socket.emit('open');
    for (const frame of frames) {
      socket.emit('message', Buffer.from(JSON.stringify(frame)));
    }
    let text = '';
    try {
      text = await textPromise;
    } catch (err) {
      errors.push(err);
    }
    let finishReason: unknown;
    let usage: unknown;
    let toolCalls: unknown[] = [];
    try {
      finishReason = await result.finishReason;
      usage = await result.usage;
      toolCalls = (await result.steps).flatMap(step => step.toolCalls);
    } catch (err) {
      errors.push(err);
    }
    const snapshot = JSON.stringify({
      text,
      finishReason,
      usage,
      toolCalls,
      errors: errors.map(err => err instanceof Error ? err.message : String(err)),
      debug: debugLines,
    });
    expect(snapshot).not.toContain(ACCESS_CANARY);
    expect(snapshot).not.toContain(ACCOUNT_CANARY);
    expect(debugLines.join('\n')).not.toContain('hey');
    return { text, result, socket, errors, snapshot, debugLines, toolCalls, usage };
  }

  it('does not treat usage-only completed frames as success when text deltas lack SDK fields', async () => {
    const { text, result, socket } = await runLuna(productionLikeTextFrames('hello-luna'));
    expect(socket.send).toHaveBeenCalled();
    const sent = JSON.parse(socket.send.mock.calls[0]![0] as string);
    expect(sent.type).toBe('response.create');
    expect(sent.model).toBe('gpt-5.6-luna');
    expect(sent.store).toBe(false);
    const usage = await result.usage;
    expect((usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)).toBeGreaterThan(0);
    expect(text).toBe('hello-luna');
  });

  it('maps Alef xhigh reasoning onto the outbound Responses-Lite request', async () => {
    const { text, socket } = await runLuna(productionLikeTextFrames('xhigh-ok'), {
      prompt: 'hey',
      providerOptions: { openai: { reasoningEffort: 'xhigh' } },
    } as Parameters<typeof streamText>[0]);
    const sent = JSON.parse(socket.send.mock.calls[0]![0] as string);
    expect(sent.reasoning).toMatchObject({ effort: 'xhigh', context: 'all_turns' });
    expect(text).toBe('xhigh-ok');
  });

  it('does not fabricate assistant text from usage-only completed frames', async () => {
    const { text } = await runLuna([
      { type: 'response.created', response: { id: 'resp_empty', created_at: 1, model: 'gpt-5.6-luna' } },
      { type: 'response.completed', response: { usage: usageBlock() } },
    ]);
    expect(text).toBe('');
  });

  it('emits text from a fully SDK-valid Responses stream', async () => {
    const { text } = await runLuna(sdkValidTextFrames('sdk-valid-text'));
    expect(text).toBe('sdk-valid-text');
  });

  it('recovers assistant text buffered only on response.completed', async () => {
    const { text } = await runLuna(completedOnlyTextFrames('buffered-final'));
    expect(text).toBe('buffered-final');
  });

  it('maps a Responses-Lite function call into an AI SDK tool call', async () => {
    const { result } = await runLuna(productionLikeToolFrames(), {
      prompt: 'weather?',
      stopWhen: stepCountIs(1),
      tools: {
        getWeather: tool({
          description: 'Get weather',
          inputSchema: z.object({ city: z.string() }),
        }),
      },
    } as Parameters<typeof streamText>[0]);
    const toolCalls = (await result.steps).flatMap(step => step.toolCalls);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toMatchObject({
      toolName: 'getWeather',
      toolCallId: 'call_weather',
      input: { city: 'NYC' },
    });
  });

  it('keeps multiple tool-call boundaries intact on a valid stream', async () => {
    const frames = [
      { type: 'response.created', response: { id: 'resp_multi', created_at: 1, model: 'gpt-5.6-luna' } },
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'function_call', id: 'fc_a', call_id: 'call_a', name: 'alpha', arguments: '' },
      },
      { type: 'response.function_call_arguments.delta', item_id: 'fc_a', output_index: 0, delta: '{"n":1}' },
      {
        type: 'response.output_item.done',
        output_index: 0,
        item: { type: 'function_call', id: 'fc_a', call_id: 'call_a', name: 'alpha', arguments: '{"n":1}', status: 'completed' },
      },
      {
        type: 'response.output_item.added',
        output_index: 1,
        item: { type: 'function_call', id: 'fc_b', call_id: 'call_b', name: 'beta', arguments: '' },
      },
      { type: 'response.function_call_arguments.delta', item_id: 'fc_b', output_index: 1, delta: '{"n":2}' },
      {
        type: 'response.output_item.done',
        output_index: 1,
        item: { type: 'function_call', id: 'fc_b', call_id: 'call_b', name: 'beta', arguments: '{"n":2}', status: 'completed' },
      },
      { type: 'response.completed', response: { usage: usageBlock() } },
    ];
    const { result } = await runLuna(frames, {
      prompt: 'multi',
      stopWhen: stepCountIs(1),
      tools: {
        alpha: tool({ description: 'A', inputSchema: z.object({ n: z.number() }) }),
        beta: tool({ description: 'B', inputSchema: z.object({ n: z.number() }) }),
      },
    } as Parameters<typeof streamText>[0]);
    const toolCalls = (await result.steps).flatMap(step => step.toolCalls);
    expect(toolCalls.map(call => [call.toolName, call.toolCallId, call.input])).toEqual([
      ['alpha', 'call_a', { n: 1 }],
      ['beta', 'call_b', { n: 2 }],
    ]);
  });

  it('propagates provider errors without leaking credentials', async () => {
    const { errors, snapshot } = await runLuna([
      { type: 'error', error: { message: 'upstream refused' } },
    ]);
    expect(errors.join(' ') + snapshot).toMatch(/upstream refused|error/i);
    expect(snapshot).not.toContain(ACCESS_CANARY);
    expect(lastSocket().close).toHaveBeenCalled();
  });

  it('forwards AbortSignal by closing the socket', async () => {
    const abort = new AbortController();
    const model = await createRelayModel('openai-oauth::gpt-5.6-luna');
    const pending = streamText({ model, prompt: 'hey', maxRetries: 0, abortSignal: abort.signal }).text;
    await vi.waitFor(() => expect(fakeSockets.length).toBe(1));
    abort.abort();
    await pending.catch(() => undefined);
    expect(lastSocket().close).toHaveBeenCalled();
  });
});

describe('createRelayModel openai-oauth Sol HTTP control', () => {
  let home: string;
  let prevHome: string | undefined;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fakeSockets.length = 0;
    home = mkdtempSync(join(tmpdir(), 'relay-core-sol-'));
    prevHome = process.env.RELAY_AI_HOME;
    process.env.RELAY_AI_HOME = home;
    writeFileSync(join(home, 'providers.json'), JSON.stringify({
      schemaVersion: 1,
      providers: [{
        id: 'openai-oauth',
        templateId: 'openai',
        name: 'OpenAI (ChatGPT)',
        enabled: true,
        authRef: 'keyring:oauth:provider:openai-oauth',
        authType: 'oauth',
        api: { npm: '@ai-sdk/openai', url: 'https://api.openai.com/v1' },
        modelsCache: {
          fetchedAt: '2026-08-13T00:00:00Z',
          models: [{
            id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', upstreamModelId: 'gpt-5.6-sol',
            modelFormat: 'openai', reasoning: true,
          }],
        },
        addedAt: '2026-08-13T00:00:00Z',
      }],
    }));
    writeFileSync(join(home, 'secrets.json'), JSON.stringify({
      version: 1,
      accounts: {
        'oauth:provider:openai-oauth': JSON.stringify({
          type: 'oauth',
          access: ACCESS_CANARY,
          refresh: 'refresh-openai',
          expires: Date.now() + 3_600_000,
          accountId: ACCOUNT_CANARY,
        }),
      },
    }));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (prevHome === undefined) delete process.env.RELAY_AI_HOME;
    else process.env.RELAY_AI_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('uses the ordinary HTTP Responses path and still emits text', async () => {
    const fetchMock = vi.fn(async () => {
      const sse = [
        `data: ${JSON.stringify({ type: 'response.created', response: { id: 'resp_sol', created_at: 1, model: 'gpt-5.6-sol' } })}`,
        `data: ${JSON.stringify({ type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg_sol' } })}`,
        `data: ${JSON.stringify({ type: 'response.output_text.delta', item_id: 'msg_sol', delta: 'sol-ok' })}`,
        `data: ${JSON.stringify({ type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: 'msg_sol' } })}`,
        `data: ${JSON.stringify({ type: 'response.completed', response: { usage: { input_tokens: 3, output_tokens: 2 } } })}`,
      ].join('\n\n') + '\n\n';
      return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    });
    globalThis.fetch = fetchMock as typeof fetch;
    const model = await createRelayModel('openai-oauth::gpt-5.6-sol');
    const text = await streamText({ model, prompt: 'hey', maxRetries: 0 }).text;
    expect(text).toBe('sol-ok');
    expect(fetchMock).toHaveBeenCalled();
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain('/responses');
    expect(url).not.toContain('wss://');
    expect(fakeSockets).toHaveLength(0);
  });
});
