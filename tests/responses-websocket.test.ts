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

  // Synthetic fixture reproducing the reported production symptom (no captured
  // production frames): `added`, `delta` and `done` each omit fields the SDK
  // requires, and only `response.completed.output` is authoritative. v0.9.2
  // minted a fresh id per frame, dropped the accumulated arguments, and then
  // suppressed recovery because the call_id was already marked done —
  // producing one tool call with empty arguments.
  it('retains function-call identity and arguments across incomplete added/delta/done frames', () => {
    const state = createResponsesLiteNormalizeState();

    const added = normalizeResponsesLiteEvent({
      type: 'response.output_item.added',
      output_index: 0,
      item: { type: 'function_call', name: 'getWeather', call_id: 'call_weather' },
    }, state) as Array<{ item: Record<string, unknown> }>;
    const itemId = added[0]!.item.id;
    expect(typeof itemId).toBe('string');

    const delta = normalizeResponsesLiteEvent({
      type: 'response.function_call_arguments.delta',
      delta: '{"city":"NYC"}',
    }, state) as Array<Record<string, unknown>>;
    expect(delta[0]!.item_id).toBe(itemId);

    const done = normalizeResponsesLiteEvent({
      type: 'response.output_item.done',
      output_index: 0,
      item: { type: 'function_call', name: 'getWeather', call_id: 'call_weather' },
    }, state);

    const completed = normalizeResponsesLiteEvent({
      type: 'response.completed',
      response: {
        usage: { input_tokens: 1, output_tokens: 1 },
        output: [{
          type: 'function_call',
          id: 'fc_upstream',
          call_id: 'call_weather',
          name: 'getWeather',
          status: 'completed',
          arguments: '{"city":"NYC"}',
        }],
      },
    }, state);

    const emitted = [...done, ...completed] as Array<{ type: string; item?: Record<string, unknown> }>;
    const dones = emitted.filter(e => e.type === 'response.output_item.done');
    expect(dones).toHaveLength(1);
    expect(dones[0]!.item).toMatchObject({
      type: 'function_call',
      id: itemId,
      call_id: 'call_weather',
      name: 'getWeather',
      arguments: '{"city":"NYC"}',
      status: 'completed',
    });
    // No second `added` for the same call — that would duplicate the tool call.
    expect(emitted.filter(e => e.type === 'response.output_item.added')).toHaveLength(0);
  });

  it('keeps two incomplete function calls from leaking identity or arguments into each other', () => {
    const state = createResponsesLiteNormalizeState();
    const emitted: Array<{ type: string; item?: Record<string, unknown> }> = [];
    const push = (event: unknown) => {
      emitted.push(...normalizeResponsesLiteEvent(event, state) as Array<{ type: string; item?: Record<string, unknown> }>);
    };

    push({ type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', name: 'alpha', call_id: 'call_a' } });
    push({ type: 'response.function_call_arguments.delta', delta: '{"n":1}' });
    push({ type: 'response.output_item.done', output_index: 0, item: { type: 'function_call', name: 'alpha', call_id: 'call_a' } });
    push({ type: 'response.output_item.added', output_index: 1, item: { type: 'function_call', name: 'beta', call_id: 'call_b' } });
    push({ type: 'response.function_call_arguments.delta', delta: '{"n":2}' });
    push({ type: 'response.output_item.done', output_index: 1, item: { type: 'function_call', name: 'beta', call_id: 'call_b' } });
    push({
      type: 'response.completed',
      response: {
        usage: { input_tokens: 1, output_tokens: 1 },
        output: [
          { type: 'function_call', id: 'fc_a', call_id: 'call_a', name: 'alpha', status: 'completed', arguments: '{"n":1}' },
          { type: 'function_call', id: 'fc_b', call_id: 'call_b', name: 'beta', status: 'completed', arguments: '{"n":2}' },
        ],
      },
    });

    const dones = emitted.filter(e => e.type === 'response.output_item.done');
    expect(dones.map(e => [e.item?.call_id, e.item?.name, e.item?.arguments])).toEqual([
      ['call_a', 'alpha', '{"n":1}'],
      ['call_b', 'beta', '{"n":2}'],
    ]);
    const addeds = emitted.filter(e => e.type === 'response.output_item.added');
    expect(addeds.map(e => e.item?.call_id)).toEqual(['call_a', 'call_b']);
    // Each call keeps one stable item id from `added` through `done`.
    expect(dones[0]!.item?.id).toBe(addeds[0]!.item?.id);
    expect(dones[1]!.item?.id).toBe(addeds[1]!.item?.id);
    expect(dones[0]!.item?.id).not.toBe(dones[1]!.item?.id);
  });

  it('defers completion when a done frame has neither upstream nor accumulated arguments', () => {
    const state = createResponsesLiteNormalizeState();
    normalizeResponsesLiteEvent({
      type: 'response.output_item.added',
      output_index: 0,
      item: { type: 'function_call', name: 'getWeather', call_id: 'call_weather' },
    }, state);
    const done = normalizeResponsesLiteEvent({
      type: 'response.output_item.done',
      output_index: 0,
      item: { type: 'function_call', name: 'getWeather', call_id: 'call_weather' },
    }, state) as Array<{ type: string }>;
    // Nothing fabricated here — recovery from response.completed stays available.
    expect(done.filter(e => e.type === 'response.output_item.done')).toHaveLength(0);

    const completed = normalizeResponsesLiteEvent({
      type: 'response.completed',
      response: {
        usage: { input_tokens: 1, output_tokens: 1 },
        output: [{
          type: 'function_call', id: 'fc_upstream', call_id: 'call_weather',
          name: 'getWeather', status: 'completed', arguments: '{"city":"NYC"}',
        }],
      },
    }, state) as Array<{ type: string; item?: Record<string, unknown> }>;
    const dones = completed.filter(e => e.type === 'response.output_item.done');
    expect(dones).toHaveLength(1);
    expect(dones[0]!.item).toMatchObject({ call_id: 'call_weather', arguments: '{"city":"NYC"}', status: 'completed' });
  });

  // Some backends restart `output_index` per call rather than incrementing it.
  // Matching purely on output_index would merge two distinct calls into one.
  it('keeps calls separate when upstream reuses the same output_index', () => {
    const state = createResponsesLiteNormalizeState();
    const emitted: Array<{ type: string; item?: Record<string, unknown> }> = [];
    const push = (event: unknown) => {
      emitted.push(...normalizeResponsesLiteEvent(event, state) as Array<{ type: string; item?: Record<string, unknown> }>);
    };

    push({ type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', name: 'alpha', call_id: 'call_a' } });
    push({ type: 'response.function_call_arguments.delta', delta: '{"n":1}' });
    push({ type: 'response.output_item.done', output_index: 0, item: { type: 'function_call', name: 'alpha', call_id: 'call_a' } });
    push({ type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', name: 'beta', call_id: 'call_b' } });
    push({ type: 'response.function_call_arguments.delta', delta: '{"n":2}' });
    push({ type: 'response.output_item.done', output_index: 0, item: { type: 'function_call', name: 'beta', call_id: 'call_b' } });

    const dones = emitted.filter(e => e.type === 'response.output_item.done');
    expect(dones.map(e => [e.item?.call_id, e.item?.name, e.item?.arguments])).toEqual([
      ['call_a', 'alpha', '{"n":1}'],
      ['call_b', 'beta', '{"n":2}'],
    ]);
  });

  // Same index reuse, but the deltas *do* carry `output_index` while still
  // omitting `item_id`. Matching the oldest entry at that index sends the
  // second call's arguments to the first, and completes the second with "".
  it('routes an indexed delta to the active call when output_index is reused', () => {
    const state = createResponsesLiteNormalizeState();
    const emitted: Array<{ type: string; item?: Record<string, unknown> }> = [];
    const push = (event: unknown) => {
      emitted.push(...normalizeResponsesLiteEvent(event, state) as Array<{ type: string; item?: Record<string, unknown> }>);
    };

    push({ type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', name: 'alpha', call_id: 'call_a' } });
    push({ type: 'response.function_call_arguments.delta', output_index: 0, delta: '{"n":1}' });
    push({ type: 'response.output_item.done', output_index: 0, item: { type: 'function_call', name: 'alpha', call_id: 'call_a' } });
    push({ type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', name: 'beta', call_id: 'call_b' } });
    push({ type: 'response.function_call_arguments.delta', output_index: 0, delta: '{"n":2}' });
    push({ type: 'response.output_item.done', output_index: 0, item: { type: 'function_call', name: 'beta', call_id: 'call_b' } });
    push({ type: 'response.completed', response: { usage: { input_tokens: 1, output_tokens: 1 } } });

    const dones = emitted.filter(e => e.type === 'response.output_item.done');
    expect(dones.map(e => [e.item?.call_id, e.item?.name, e.item?.arguments])).toEqual([
      ['call_a', 'alpha', '{"n":1}'],
      ['call_b', 'beta', '{"n":2}'],
    ]);
  });

  // Two calls can be open at the same index at once: the first deferred (its
  // done frame carried no arguments), the second freshly added. A bare indexed
  // delta belongs to the newest one.
  it('routes an indexed delta to the newest open call when two share an index', () => {
    const state = createResponsesLiteNormalizeState();
    const emitted: Array<{ type: string; item?: Record<string, unknown> }> = [];
    const push = (event: unknown) => {
      emitted.push(...normalizeResponsesLiteEvent(event, state) as Array<{ type: string; item?: Record<string, unknown> }>);
    };

    push({ type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', name: 'alpha', call_id: 'call_a' } });
    push({ type: 'response.output_item.done', output_index: 0, item: { type: 'function_call', name: 'alpha', call_id: 'call_a' } });
    push({ type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', name: 'beta', call_id: 'call_b' } });
    push({ type: 'response.function_call_arguments.delta', output_index: 0, delta: '{"n":2}' });
    push({ type: 'response.output_item.done', output_index: 0, item: { type: 'function_call', name: 'beta', call_id: 'call_b' } });

    const dones = emitted.filter(e => e.type === 'response.output_item.done');
    expect(dones.map(e => [e.item?.call_id, e.item?.arguments])).toEqual([
      ['call_b', '{"n":2}'],
    ]);
  });

  // Out-of-order completion: the newer call at the index finishes first, so a
  // later bare delta belongs to the older call that is still open.
  it('never appends an indexed delta to a call that already completed', () => {
    const state = createResponsesLiteNormalizeState();
    const emitted: Array<{ type: string; item?: Record<string, unknown> }> = [];
    const push = (event: unknown) => {
      emitted.push(...normalizeResponsesLiteEvent(event, state) as Array<{ type: string; item?: Record<string, unknown> }>);
    };

    push({ type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', name: 'alpha', call_id: 'call_a' } });
    push({ type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', name: 'beta', call_id: 'call_b' } });
    push({ type: 'response.output_item.done', output_index: 0, item: { type: 'function_call', name: 'beta', call_id: 'call_b', arguments: '{"n":2}' } });
    push({ type: 'response.function_call_arguments.delta', output_index: 0, delta: '{"n":1}' });
    push({ type: 'response.output_item.done', output_index: 0, item: { type: 'function_call', name: 'alpha', call_id: 'call_a' } });

    const dones = emitted.filter(e => e.type === 'response.output_item.done');
    expect(dones.map(e => [e.item?.call_id, e.item?.arguments])).toEqual([
      ['call_b', '{"n":2}'],
      ['call_a', '{"n":1}'],
    ]);
  });

  it('routes an indexed delta to a still-open call before a completed one at the same index', () => {
    const state = createResponsesLiteNormalizeState();
    const emitted: Array<{ type: string; item?: Record<string, unknown> }> = [];
    const push = (event: unknown) => {
      emitted.push(...normalizeResponsesLiteEvent(event, state) as Array<{ type: string; item?: Record<string, unknown> }>);
    };
    // Interleaved: alpha completes at index 0, beta opens at index 0, then a
    // late no-identity delta must belong to beta — the only open call.
    push({ type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', name: 'alpha', call_id: 'call_a', arguments: '' } });
    push({ type: 'response.output_item.done', output_index: 0, item: { type: 'function_call', name: 'alpha', call_id: 'call_a', arguments: '{"n":1}' } });
    push({ type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', name: 'beta', call_id: 'call_b' } });
    push({ type: 'response.function_call_arguments.delta', output_index: 0, delta: '{"n":2}' });
    push({ type: 'response.output_item.done', output_index: 0, item: { type: 'function_call', name: 'beta', call_id: 'call_b' } });

    const dones = emitted.filter(e => e.type === 'response.output_item.done');
    expect(dones.map(e => [e.item?.call_id, e.item?.arguments])).toEqual([
      ['call_a', '{"n":1}'],
      ['call_b', '{"n":2}'],
    ]);
  });

  // The accumulated deltas are the *only* argument source here: `done` omits
  // `arguments` and `response.completed` carries no authoritative output at all.
  it('completes a call from accumulated deltas when done omits arguments', () => {
    const state = createResponsesLiteNormalizeState();
    normalizeResponsesLiteEvent({
      type: 'response.output_item.added',
      output_index: 0,
      item: { type: 'function_call', name: 'getWeather', call_id: 'call_weather' },
    }, state);
    normalizeResponsesLiteEvent({ type: 'response.function_call_arguments.delta', delta: '{"city":' }, state);
    normalizeResponsesLiteEvent({ type: 'response.function_call_arguments.delta', delta: '"NYC"}' }, state);
    const done = normalizeResponsesLiteEvent({
      type: 'response.output_item.done',
      output_index: 0,
      item: { type: 'function_call', name: 'getWeather', call_id: 'call_weather' },
    }, state) as Array<{ type: string; item?: Record<string, unknown> }>;
    const completed = normalizeResponsesLiteEvent({
      type: 'response.completed',
      response: { usage: { input_tokens: 1, output_tokens: 1 } },
    }, state) as Array<{ type: string; item?: Record<string, unknown> }>;

    const dones = [...done, ...completed].filter(e => e.type === 'response.output_item.done');
    expect(dones).toHaveLength(1);
    // Deltas appended in arrival order, not reversed or partially retained.
    expect(dones[0]!.item).toMatchObject({
      call_id: 'call_weather', name: 'getWeather', arguments: '{"city":"NYC"}', status: 'completed',
    });
  });

  // When neither deltas nor authoritative output ever supply arguments, there
  // is no honest way to complete the call — `arguments: ""` is not valid JSON
  // and is exactly the failure this release claims to remove. Surface the
  // malformed stream instead of manufacturing a tool call.
  it('surfaces malformed provider output instead of completing a call with empty arguments', () => {
    const state = createResponsesLiteNormalizeState();
    normalizeResponsesLiteEvent({
      type: 'response.output_item.added',
      output_index: 0,
      item: { type: 'function_call', name: 'ping', call_id: 'call_ping' },
    }, state);
    normalizeResponsesLiteEvent({
      type: 'response.output_item.done',
      output_index: 0,
      item: { type: 'function_call', name: 'ping', call_id: 'call_ping' },
    }, state);
    const completed = normalizeResponsesLiteEvent({
      type: 'response.completed',
      response: { usage: { input_tokens: 1, output_tokens: 1 } },
    }, state) as Array<{ type: string; item?: Record<string, unknown>; error?: Record<string, unknown> }>;

    expect(completed.filter(e => e.type === 'response.output_item.done')).toHaveLength(0);
    const errors = completed.filter(e => e.type === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.error).toMatchObject({ code: 'incomplete_function_call' });
    // Names the call so it is debuggable, but never invents an argument string.
    expect(JSON.stringify(errors[0])).toContain('call_ping');
    expect(JSON.stringify(completed)).not.toContain('"arguments":""');
  });

  // `response.completed.output` is authoritative for identity but can still omit
  // `arguments`. Recovering from it must not invent an empty argument string —
  // that is the same fabrication, just reached through the recovery path.
  it('surfaces malformed output when completed.output repeats a call with no arguments', () => {
    const state = createResponsesLiteNormalizeState();
    normalizeResponsesLiteEvent({
      type: 'response.output_item.added',
      output_index: 0,
      item: { type: 'function_call', name: 'ping', call_id: 'call_ping' },
    }, state);
    normalizeResponsesLiteEvent({
      type: 'response.output_item.done',
      output_index: 0,
      item: { type: 'function_call', name: 'ping', call_id: 'call_ping' },
    }, state);
    const completed = normalizeResponsesLiteEvent({
      type: 'response.completed',
      response: {
        usage: { input_tokens: 1, output_tokens: 1 },
        output: [{ type: 'function_call', id: 'fc_x', call_id: 'call_ping', name: 'ping', status: 'completed' }],
      },
    }, state) as Array<{ type: string; error?: Record<string, unknown> }>;

    expect(completed.filter(e => e.type === 'response.output_item.done')).toHaveLength(0);
    const errors = completed.filter(e => e.type === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.error).toMatchObject({ code: 'incomplete_function_call' });
    expect(JSON.stringify(completed)).not.toContain('"arguments":""');
  });

  it('reports a call that only ever appears in completed.output with no arguments', () => {
    const state = createResponsesLiteNormalizeState();
    const completed = normalizeResponsesLiteEvent({
      type: 'response.completed',
      response: {
        usage: { input_tokens: 1, output_tokens: 1 },
        output: [{ type: 'function_call', id: 'fc_y', call_id: 'call_solo', name: 'solo' }],
      },
    }, state) as Array<{ type: string; error?: Record<string, unknown> }>;
    expect(completed.filter(e => e.type === 'response.output_item.done')).toHaveLength(0);
    expect(completed.filter(e => e.type === 'error')).toHaveLength(1);
  });

  it('still completes a deferred call from accumulated deltas when completed adds nothing', () => {
    const state = createResponsesLiteNormalizeState();
    normalizeResponsesLiteEvent({
      type: 'response.output_item.added',
      output_index: 0,
      item: { type: 'function_call', name: 'ping', call_id: 'call_ping' },
    }, state);
    normalizeResponsesLiteEvent({ type: 'response.function_call_arguments.delta', delta: '{}' }, state);
    const done = normalizeResponsesLiteEvent({
      type: 'response.output_item.done',
      output_index: 0,
      item: { type: 'function_call', name: 'ping', call_id: 'call_ping' },
    }, state) as Array<{ type: string; item?: Record<string, unknown> }>;
    const dones = done.filter(e => e.type === 'response.output_item.done');
    expect(dones).toHaveLength(1);
    expect(dones[0]!.item).toMatchObject({ call_id: 'call_ping', arguments: '{}', status: 'completed' });
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
