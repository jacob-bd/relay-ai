import { describe, expect, it, vi } from 'vitest';
import { streamText } from 'ai';
import { streamOpenAiResponse } from '../src/openai-adapter.js';

vi.mock('ai', () => ({
  streamText: vi.fn(),
  generateText: vi.fn(),
  tool: vi.fn((spec: unknown) => spec),
  jsonSchema: vi.fn((schema: unknown) => schema),
}));

describe('streamOpenAiResponse', () => {
  it('propagates an SDK error instead of completing a failed stream', async () => {
    const upstreamError = { statusCode: 429, message: 'rate limited' };
    async function* fullStream() {
      yield { type: 'text-delta', text: 'partial' };
      yield { type: 'error', error: upstreamError };
    }
    vi.mocked(streamText).mockReturnValue({ fullStream: fullStream() } as never);
    let output = '';

    await expect(streamOpenAiResponse(
      {} as never,
      { messages: [] },
      'gpt-test',
      chunk => { output += chunk; },
    )).rejects.toBe(upstreamError);

    expect(output).toContain('partial');
    expect(output).not.toContain('[DONE]');
  });
});
