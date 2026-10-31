import { describe, expect, it, vi } from 'vitest';
import { activityFetch, streamActivity } from '../src/stream-activity.js';

describe('upstream byte activity', () => {
  it('keeps activity callbacks isolated between concurrent requests and preserves responses', async () => {
    const callbacks = [vi.fn(), vi.fn()];
    const upstream = vi.fn(async () => new Response(new Uint8Array([1, 2]), {
      status: 201, headers: { 'x-test': 'preserved' },
    }));
    const fetch = activityFetch(upstream);
    const responses = await Promise.all(callbacks.map(callback => streamActivity.run(callback, () => fetch('https://test.invalid'))));
    expect(callbacks[0]).toHaveBeenCalledTimes(1);
    expect(callbacks[1]).toHaveBeenCalledTimes(1);
    expect(responses[0].status).toBe(201);
    expect(responses[0].headers.get('x-test')).toBe('preserved');
    expect([...new Uint8Array(await responses[0].arrayBuffer())]).toEqual([1, 2]);
    await responses[1].arrayBuffer();
  });

  it('forwards body cancellation and read errors', async () => {
    const cancel = vi.fn();
    const fetch = activityFetch(async () => new Response(new ReadableStream({ cancel })));
    const response = await streamActivity.run(vi.fn(), () => fetch('https://test.invalid'));
    await response.body!.cancel('client left');
    expect(cancel).toHaveBeenCalledWith('client left');
    const broken = activityFetch(async () => new Response(new ReadableStream({
      pull(controller) { controller.error(new Error('connection lost')); },
    })));
    const failed = await streamActivity.run(vi.fn(), () => broken('https://test.invalid'));
    await expect(failed.text()).rejects.toThrow('connection lost');
  });
});
