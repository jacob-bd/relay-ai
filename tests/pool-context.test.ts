import { describe, expect, it } from 'vitest';
import { estimatePoolRequestTokens, poolRequestFitsWindow } from '../src/pool/context.js';

describe('production pool context guard', () => {
  it('counts complete JSON including non-ASCII text and tool schemas with the conservative heuristic', () => {
    const request = { instructions: 'Be brief', messages: [{ text: '你好🙌' }], tools: [{ schema: { type: 'object' } }] };
    expect(estimatePoolRequestTokens(request)).toBe(Math.ceil(Buffer.byteLength(JSON.stringify(request), 'utf8') / 2));
    expect(estimatePoolRequestTokens(request)).toBeGreaterThan(estimatePoolRequestTokens({ messages: [] }));
  });
  it('admits the boundary and refuses overflow without rewriting the request', () => {
    const request = { text: 'x'.repeat(10000) };
    const original = JSON.stringify(request);
    const required = estimatePoolRequestTokens(request) + 4096 + 4096;
    expect(poolRequestFitsWindow(request, required, 4096)).toEqual({ fits: true, required });
    expect(poolRequestFitsWindow(request, required - 1, 4096)).toEqual({ fits: false, required });
    expect(JSON.stringify(request)).toBe(original);
  });
  it('reserves ten percent of larger provider windows in addition to output', () => {
    const request = { input: 'hello' };
    expect(poolRequestFitsWindow(request, 128000, 4096).required).toBe(estimatePoolRequestTokens(request) + 12800 + 4096);
  });
  it('refuses unknown or invalid window and output budgets', () => {
    for (const invalid of [0, -1, NaN, Infinity, 1.5]) {
      expect(poolRequestFitsWindow({}, invalid, 4096).fits).toBe(false);
      expect(poolRequestFitsWindow({}, 128000, invalid).fits).toBe(false);
    }
  });
});

it('reserves vision tokens for SDK images without counting base64 or Buffer JSON as text', async () => {
  const { translateRequest } = await import('../src/sdk-adapter.js');
  const { preparePoolHistory } = await import('../src/pool/continuation.js');
  const image = Buffer.alloc(150_000, 123).toString('base64');
  const claude = translateRequest({ model: 'claude-pool', max_tokens: 32000, messages: [{
    role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: image } }],
  }] } as never, '@ai-sdk/openai-compatible');
  const codex = preparePoolHistory({ input: [{ role: 'user', content: [{ type: 'input_image', image_url: 'data:image/png;base64,' + image }] }] },
    undefined, { account: 'a', endpointRevision: 'r', model: 'm' }, '@ai-sdk/openai-compatible');
  for (const messages of [claude.messages, codex.messages]) {
    const snapshot = JSON.stringify(messages);
    expect(poolRequestFitsWindow({ messages }, 128000, 32000).fits).toBe(true);
    expect(estimatePoolRequestTokens({ messages })).toBeGreaterThanOrEqual(4096);
    expect(estimatePoolRequestTokens({ messages })).toBeLessThan(5000);
    expect(JSON.stringify(messages) === snapshot).toBe(true);
  }
});

it('reserves vision tokens for an image a tool returned, and sizes other binary by its bytes', async () => {
  const { translateRequest } = await import('../src/sdk-adapter.js');
  const image = Buffer.alloc(150_000, 7).toString('base64');
  const build = (content: unknown[]) => translateRequest({ model: 'claude-pool', max_tokens: 32000, messages: [
    { role: 'user', content: 'look at it' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content }] },
  ] } as never, '@ai-sdk/openai-compatible');
  const withImage = build([{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: image } }]);
  const textOnly = build([{ type: 'text', text: 'ok' }]);
  const snapshot = JSON.stringify(withImage.messages);
  const gap = estimatePoolRequestTokens({ messages: withImage.messages }) - estimatePoolRequestTokens({ messages: textOnly.messages });
  expect(gap).toBeGreaterThan(4000);
  expect(gap).toBeLessThan(5000);
  expect(poolRequestFitsWindow({ messages: withImage.messages }, 128000, 32000).fits).toBe(true);
  expect(JSON.stringify(withImage.messages) === snapshot).toBe(true);
  // A PDF is not an image: counted by size, but never as four JSON bytes per byte.
  const pdf = { messages: [{ role: 'user', content: [{ type: 'file', mediaType: 'application/pdf', data: Buffer.alloc(100_000, 1) }] }] };
  expect(estimatePoolRequestTokens(pdf)).toBeLessThan(55_000);
  expect(estimatePoolRequestTokens(pdf)).toBeGreaterThanOrEqual(50_000);
});
