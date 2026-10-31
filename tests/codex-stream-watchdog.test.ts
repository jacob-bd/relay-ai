import { activityFetch } from '../src/stream-activity.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOpenAI } from '@ai-sdk/openai';
import { streamResponsesResponse } from '../src/codex-responses-adapter.js';

const params = { messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] };
afterEach(() => vi.useRealTimers());

describe('Codex stream liveness versus progress', () => {
  it('a: survives silent reasoning with upstream heartbeat bytes beyond the liveness limit', async () => {
    vi.useFakeTimers();
    const encoder = new TextEncoder();
    const model = createOpenAI({ apiKey: 'test', fetch: activityFetch(async () => new Response(new ReadableStream({
      start(controller) {
        const heartbeat = setInterval(() => controller.enqueue(encoder.encode(': heartbeat\n\n')), 20);
        setTimeout(() => {
          clearInterval(heartbeat);
          controller.enqueue(encoder.encode('data: {"id":"x","object":"chat.completion.chunk","created":0,"model":"test","choices":[{"index":0,"delta":{"content":"OK"},"finish_reason":null}]}\n\ndata: {"id":"x","object":"chat.completion.chunk","created":0,"model":"test","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));
          controller.close();
        }, 250);
      },
    }), { headers: { 'content-type': 'text/event-stream' } })) }).chat('test');
    const chunks: string[] = [];
    const done = streamResponsesResponse(model, params as never, 'test', c => chunks.push(c), undefined, undefined,
      { idleTimeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(300);
    await done;
    expect(chunks.join('')).not.toContain('response.failed');
    expect(chunks.join('')).toContain('response.completed');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('b: terminates endless contentless SDK parts at the progress limit', async () => {
    vi.useFakeTimers();
    let interval: ReturnType<typeof setInterval>;
    const model = {
      specificationVersion: 'v4', provider: 'test', modelId: 'test', supportedUrls: {},
      async doStream(options: { abortSignal: AbortSignal }) {
        return { stream: new ReadableStream({ start(controller) {
          interval = setInterval(() => controller.enqueue({ type: 'raw', rawValue: {} }), 20);
          options.abortSignal.addEventListener('abort', () => {
            clearInterval(interval); controller.error(options.abortSignal.reason);
          });
        } }) };
      },
    };
    const chunks: string[] = [];
    let settled = false;
    const done = streamResponsesResponse(model as never, { ...params, includeRawChunks: true } as never,
      'test', c => chunks.push(c), undefined, undefined,
      { idleTimeoutMs: 100, progressTimeoutMs: 300 }).then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(350);
    clearInterval(interval!);
    expect(settled).toBe(true);
    await done;
    expect(chunks.join('')).toContain('no content progress');
  });

  it('c: aborts a zero-byte dead upstream from stream start', async () => {
    vi.useFakeTimers();
    const model = {
      specificationVersion: 'v4', provider: 'test', modelId: 'test', supportedUrls: {},
      doStream(options: { abortSignal: AbortSignal }) {
        return new Promise((_resolve, reject) => options.abortSignal.addEventListener('abort', () => reject(options.abortSignal.reason)));
      },
    };
    const chunks: string[] = [];
    const done = streamResponsesResponse(model as never, params as never, 'test', c => chunks.push(c),
      undefined, undefined, { idleTimeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(150);
    await done;
    expect(chunks.join('')).toContain('response.failed');
    expect(chunks.join('')).toContain('no data received from provider');
  });
});
