import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

// Fake `ws` WebSocket that records constructor args and lets tests drive events.
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

import { createResponsesWebSocketFetch, createResponsesLiteNormalizeState, normalizeResponsesLiteEvent, summarizeResponsesLiteEvent } from '../src/oauth/responses-websocket.js';

const WS_URL = 'wss://chatgpt.com/backend-api/codex/responses';

async function readAll(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let out = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

function lastSocket(): FakeWebSocket {
  return fakeSockets[fakeSockets.length - 1]!;
}

describe('createResponsesWebSocketFetch', () => {
  beforeEach(() => {
    fakeSockets.length = 0;
  });

  it('forwards request headers and adds the WebSocket beta header on the upgrade', async () => {
    const wsFetch = createResponsesWebSocketFetch(WS_URL);
    await wsFetch('https://chatgpt.com/backend-api/codex/responses', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer tok',
        'ChatGPT-Account-Id': 'acct-123',
        originator: 'relay-ai',
        version: '0.144.1',
        'x-openai-internal-codex-responses-lite': 'true',
      },
      body: JSON.stringify({ model: 'gpt-5.6-luna', input: [] }),
    });

    const headers = lastSocket().options.headers ?? {};
    expect(lastSocket().url).toBe(WS_URL);
    expect(headers['Authorization']).toBe('Bearer tok');
    expect(headers['ChatGPT-Account-Id']).toBe('acct-123');
    expect(headers['version']).toBe('0.144.1');
    expect(headers['x-openai-internal-codex-responses-lite']).toBe('true');
    expect(headers['OpenAI-Beta']).toContain('responses_websockets');
  });

  it('sends the payload as the first frame and folds in the Responses-Lite shape', async () => {
    const wsFetch = createResponsesWebSocketFetch(WS_URL);
    await wsFetch('https://x', {
      method: 'POST',
      headers: { 'x-openai-internal-codex-responses-lite': 'true' },
      body: JSON.stringify({ model: 'gpt-5.6-luna', reasoning: { effort: 'high' } }),
    });

    const socket = lastSocket();
    socket.emit('open');
    expect(socket.send).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(socket.send.mock.calls[0]![0] as string);
    // Must be a `response.create` event with the Responses fields at top level.
    expect(sent.type).toBe('response.create');
    expect(sent.model).toBe('gpt-5.6-luna');
    expect(sent.parallel_tool_calls).toBe(false);
    expect(sent.store).toBe(false);
    expect(sent.reasoning).toEqual({ effort: 'high', context: 'all_turns' });
  });

  it('does not mutate the body when the Responses-Lite header is absent', async () => {
    const wsFetch = createResponsesWebSocketFetch(WS_URL);
    await wsFetch('https://x', {
      method: 'POST',
      headers: { Authorization: 'Bearer t' },
      body: JSON.stringify({ model: 'gpt-5.6-sol' }),
    });
    const socket = lastSocket();
    socket.emit('open');
    const sent = JSON.parse(socket.send.mock.calls[0]![0] as string);
    // Still wrapped in the response.create envelope, but no Responses-Lite fields added.
    expect(sent).toEqual({ type: 'response.create', model: 'gpt-5.6-sol' });
  });

  it('collapses each frame onto a single SSE data line and closes on response.completed', async () => {
    const wsFetch = createResponsesWebSocketFetch(WS_URL);
    const res = await wsFetch('https://x', {
      method: 'POST',
      headers: {},
      body: '{}',
    });
    const socket = lastSocket();
    socket.emit('open');
    // Pretty-printed JSON frame must not become a multi-line SSE event.
    socket.emit('message', Buffer.from('{\n  "type": "response.output_text.delta",\n  "delta": "hi"\n}'));
    socket.emit('message', Buffer.from(JSON.stringify({ type: 'response.completed' })));

    const body = await readAll(res);
    const lines = body.split('\n\n').filter(Boolean);
    const parsed = lines.map(line => JSON.parse(line.slice('data: '.length)));
    expect(parsed.map(event => event.type)).toEqual([
      'response.output_item.added',
      'response.output_text.delta',
      'response.output_item.done',
      'response.completed',
    ]);
    expect(parsed[1]).toEqual({
      type: 'response.output_text.delta',
      delta: 'hi',
      item_id: 'msg_1',
    });
    expect(socket.close).toHaveBeenCalled();
  });

  it('surfaces a socket error as an SSE error event', async () => {
    const wsFetch = createResponsesWebSocketFetch(WS_URL);
    const res = await wsFetch('https://x', { method: 'POST', headers: {}, body: '{}' });
    const socket = lastSocket();
    socket.emit('error', new Error('boom'));
    const body = await readAll(res);
    expect(body).toContain('"type":"error"');
    expect(body).toContain('boom');
    expect(body).toContain('"sequence_number"');
    expect(JSON.parse(body.trim().slice('data: '.length))).toMatchObject({
      type: 'error',
      error: { message: 'boom', type: 'server_error', code: 'unknown' },
    });
  });

  it('closes the socket when the request is aborted', async () => {
    const controller = new AbortController();
    const wsFetch = createResponsesWebSocketFetch(WS_URL);
    const res = await wsFetch('https://x', { method: 'POST', headers: {}, body: '{}', signal: controller.signal });
    const socket = lastSocket();
    controller.abort();
    await readAll(res);
    expect(socket.close).toHaveBeenCalled();
  });

  it('sanitizes debug logs so frame bodies and credentials never appear', async () => {
    const lines: string[] = [];
    const wsFetch = createResponsesWebSocketFetch(WS_URL, msg => lines.push(msg));
    const res = await wsFetch('https://x', {
      method: 'POST',
      headers: { Authorization: 'Bearer secret-token-zzz', 'x-openai-internal-codex-responses-lite': 'true' },
      body: JSON.stringify({ model: 'gpt-5.6-luna', input: [{ role: 'user', content: 'secret-prompt-zzz' }] }),
    });
    const socket = lastSocket();
    socket.emit('open');
    socket.emit('message', Buffer.from(JSON.stringify({
      type: 'response.output_text.delta',
      delta: 'secret-response-zzz',
    })));
    socket.emit('message', Buffer.from(JSON.stringify({ type: 'response.completed', response: { usage: { input_tokens: 1, output_tokens: 1 } } })));
    await readAll(res);
    const joined = lines.join('\n');
    expect(joined).toContain('type=response.output_text.delta');
    expect(joined).toContain('deltaChars=19');
    expect(joined).not.toContain('secret-token-zzz');
    expect(joined).not.toContain('secret-prompt-zzz');
    expect(joined).not.toContain('secret-response-zzz');
    expect(joined).not.toContain('Bearer');
  });
});

describe('normalizeResponsesLiteEvent', () => {
  it('fills item_id on text deltas that the SDK would otherwise drop', () => {
    const state = createResponsesLiteNormalizeState();
    const events = normalizeResponsesLiteEvent({ type: 'response.output_text.delta', delta: 'hi' }, state);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: 'response.output_item.added', item: { type: 'message', id: 'msg_1' } });
    expect(events[1]).toMatchObject({ type: 'response.output_text.delta', delta: 'hi', item_id: 'msg_1' });
  });

  it('recovers text that exists only on response.completed.output', () => {
    const state = createResponsesLiteNormalizeState();
    const events = normalizeResponsesLiteEvent({
      type: 'response.completed',
      response: {
        usage: { input_tokens: 1, output_tokens: 1 },
        output: [{ type: 'message', id: 'msg_buf', role: 'assistant', content: [{ type: 'output_text', text: 'buffered' }] }],
      },
    }, state);
    expect(events.map(e => (e as { type: string }).type)).toEqual([
      'response.output_item.added',
      'response.output_text.delta',
      'response.output_item.done',
      'response.completed',
    ]);
    expect(events[1]).toMatchObject({ delta: 'buffered', item_id: 'msg_buf' });
  });

  it('does not duplicate text already forwarded as deltas', () => {
    const state = createResponsesLiteNormalizeState();
    normalizeResponsesLiteEvent({ type: 'response.output_text.delta', item_id: 'msg_1', delta: 'hello' }, state);
    const events = normalizeResponsesLiteEvent({
      type: 'response.completed',
      response: {
        usage: { input_tokens: 1, output_tokens: 1 },
        output: [{ type: 'message', id: 'msg_1', content: [{ type: 'output_text', text: 'hello' }] }],
      },
    }, state);
    expect(events.map(e => (e as { type: string }).type)).toEqual([
      'response.output_item.done',
      'response.completed',
    ]);
    expect(events[1]).toMatchObject({ type: 'response.completed' });
  });

  it('fills function_call fields and recovers a missing output_item.done', () => {
    const state = createResponsesLiteNormalizeState();
    const [added] = normalizeResponsesLiteEvent({
      type: 'response.output_item.added',
      output_index: 0,
      item: { type: 'function_call', name: 'getWeather', call_id: 'call_weather' },
    }, state);
    expect(added).toMatchObject({
      item: { id: 'fc_1', call_id: 'call_weather', name: 'getWeather', arguments: '' },
    });
    normalizeResponsesLiteEvent({ type: 'response.function_call_arguments.delta', delta: '{"city":"NYC"}' }, state);
    const completed = normalizeResponsesLiteEvent({
      type: 'response.completed',
      response: {
        usage: { input_tokens: 1, output_tokens: 1 },
        output: [{ type: 'function_call', id: 'fc_1', call_id: 'call_weather', name: 'getWeather', arguments: '{"city":"NYC"}' }],
      },
    }, state);
    expect(completed.map(e => (e as { type: string }).type)).toEqual(['response.output_item.done', 'response.completed']);
    expect(completed[0]).toMatchObject({
      item: { id: 'fc_1', call_id: 'call_weather', name: 'getWeather', arguments: '{"city":"NYC"}', status: 'completed' },
    });
  });

  it('does not treat usage-only completed frames as text', () => {
    const state = createResponsesLiteNormalizeState();
    const events = normalizeResponsesLiteEvent({
      type: 'response.completed',
      response: { usage: { input_tokens: 4, output_tokens: 2 } },
    }, state);
    expect(events).toEqual([{ type: 'response.completed', response: { usage: { input_tokens: 4, output_tokens: 2 } } }]);
  });

  it('summarizes events without copying string values', () => {
    const summary = summarizeResponsesLiteEvent({
      type: 'response.output_text.delta',
      delta: 'classified-text',
      item_id: 'msg_secret',
    });
    expect(summary).toContain('type=response.output_text.delta');
    expect(summary).toContain('deltaChars=15');
    expect(summary).not.toContain('classified-text');
    expect(summary).not.toContain('msg_secret');
  });
});
