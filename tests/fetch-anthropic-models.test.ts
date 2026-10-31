import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAnthropicModels, MAX_MODEL_PAGES } from '../src/registry/fetch-anthropic-models.js';

const BASE = 'https://gateway.example.test';

function page(ids: string[], extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ data: ids.map(id => ({ id })), ...extra }), { status: 200 });
}

function stubFetch(handler: (url: string, call: number) => Response | Promise<Response>) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    return handler(url, calls.length);
  }));
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchAnthropicModels pagination', () => {
  it('makes one parameter-free request when the server does not paginate', async () => {
    const calls = stubFetch(() => page(['m-a', 'm-b']));
    const result = await fetchAnthropicModels(BASE, 'key');
    expect(calls).toEqual([`${BASE}/v1/models`]);
    expect(result.models.map(m => m.id)).toEqual(['m-a', 'm-b']);
    expect(result.incomplete).toBeUndefined();
  });

  it('follows the returned cursor and dedupes ids repeated across pages', async () => {
    const calls = stubFetch((url) => url.includes('after_id=m-b')
      ? page(['m-b', 'm-c'], { has_more: false, last_id: 'm-c' })
      : page(['m-a', 'm-b'], { has_more: true, last_id: 'm-b' }));
    const result = await fetchAnthropicModels(BASE, 'key');
    expect(calls).toEqual([`${BASE}/v1/models`, `${BASE}/v1/models?after_id=m-b`]);
    expect(result.models.map(m => m.id)).toEqual(['m-a', 'm-b', 'm-c']);
    expect(result.incomplete).toBeUndefined();
  });

  it('URL-encodes the cursor', async () => {
    const calls = stubFetch((url) => url.includes('after_id=')
      ? page(['z'])
      : page(['a'], { has_more: true, last_id: 'a/b c' }));
    await fetchAnthropicModels(BASE, 'key');
    expect(calls[1]).toBe(`${BASE}/v1/models?after_id=a%2Fb%20c`);
  });

  it('stops on a repeated cursor and marks the catalog incomplete', async () => {
    const calls = stubFetch(() => page(['m-a'], { has_more: true, last_id: 'same' }));
    const result = await fetchAnthropicModels(BASE, 'key');
    expect(calls).toHaveLength(2);
    expect(result.models.map(m => m.id)).toEqual(['m-a']);
    expect(result.incomplete).toMatch(/repeated a pagination cursor/);
  });

  it('marks the catalog incomplete when has_more arrives without a cursor', async () => {
    const calls = stubFetch(() => page(['m-a'], { has_more: true }));
    const result = await fetchAnthropicModels(BASE, 'key');
    expect(calls).toHaveLength(1);
    expect(result.incomplete).toMatch(/no cursor/);
  });

  it('keeps earlier pages but flags the catalog when a later page fails', async () => {
    stubFetch((url) => url.includes('after_id=')
      ? new Response('boom', { status: 500 })
      : page(['m-a', 'm-b'], { has_more: true, last_id: 'm-b' }));
    const result = await fetchAnthropicModels(BASE, 'key');
    expect(result.error).toBeUndefined();
    expect(result.models.map(m => m.id)).toEqual(['m-a', 'm-b']);
    expect(result.incomplete).toMatch(/Page 2 failed \(HTTP 500\)/);
  });

  it('keeps earlier pages but flags the catalog when a later page cannot be fetched', async () => {
    stubFetch((url) => {
      if (url.includes('after_id=')) throw new TypeError('network down');
      return page(['m-a'], { has_more: true, last_id: 'm-a' });
    });
    const result = await fetchAnthropicModels(BASE, 'key');
    expect(result.models.map(m => m.id)).toEqual(['m-a']);
    expect(result.incomplete).toMatch(/Page 2 could not be fetched/);
  });

  it('caps the number of pages', async () => {
    let n = 0;
    const calls = stubFetch(() => page([`m-${++n}`], { has_more: true, last_id: `c-${n}` }));
    const result = await fetchAnthropicModels(BASE, 'key');
    expect(calls).toHaveLength(MAX_MODEL_PAGES);
    expect(result.models).toHaveLength(MAX_MODEL_PAGES);
    expect(result.incomplete).toMatch(new RegExp(`Stopped after ${MAX_MODEL_PAGES} pages`));
  });

  it('still reports a rejected key on the first page', async () => {
    stubFetch(() => new Response('no', { status: 401 }));
    const result = await fetchAnthropicModels(BASE, 'key');
    expect(result.models).toEqual([]);
    expect(result.error).toBe('API key was rejected.');
  });
});
