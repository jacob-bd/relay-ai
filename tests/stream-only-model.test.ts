import { describe, expect, it } from 'vitest';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';
import {
  generateTextStreamingIfRequired,
  isStreamOnlyModel,
  markStreamOnlyModel,
} from '../src/stream-only-model.js';
import { createLanguageModel } from '../src/provider-factory.js';
import { generateOpenAiResponse } from '../src/openai-adapter.js';
import { generateResponsesResponse } from '../src/codex-responses-adapter.js';

// ChatGPT login (chatgpt.com/backend-api/codex) answers non-streaming requests with
// HTTP 400 {"detail":"Stream must be set to true"}. These models must never reach
// doGenerate; everything else must keep using it.
const STREAM_ONLY_REJECTION = Object.assign(new Error('Bad Request'), {
  statusCode: 400,
  responseBody: '{"detail":"Stream must be set to true"}',
});

const finish: LanguageModelV4StreamPart = {
  type: 'finish',
  finishReason: { unified: 'stop', raw: 'stop' },
  usage: { inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 2, text: 2, reasoning: 0 } },
};

function streamOnlyModel(chunks: LanguageModelV4StreamPart[]) {
  return markStreamOnlyModel(new MockLanguageModelV4({
    doGenerate: async () => { throw STREAM_ONLY_REJECTION; },
    doStream: { stream: simulateReadableStream({ chunks, initialDelayInMs: null, chunkDelayInMs: null }) },
  }));
}

const textChunks = (text: string): LanguageModelV4StreamPart[] => [
  { type: 'stream-start', warnings: [] },
  { type: 'text-start', id: 't' },
  { type: 'text-delta', id: 't', delta: text },
  { type: 'text-end', id: 't' },
  finish,
];

const messages = [{ role: 'user' as const, content: 'hi' }];

describe('generateTextStreamingIfRequired', () => {
  it('streams for a stream-only model and returns the generateText fields', async () => {
    const model = streamOnlyModel(textChunks('hello'));
    const r = await generateTextStreamingIfRequired({ model, messages });
    expect(r.text).toBe('hello');
    expect(r.finishReason).toBe('stop');
    expect(r.usage.inputTokens).toBe(3);
    expect(r.toolCalls).toEqual([]);
  });

  it('collects tool calls from the stream', async () => {
    const model = streamOnlyModel([
      { type: 'stream-start', warnings: [] },
      { type: 'tool-call', toolCallId: 'c1', toolName: 'read', input: '{"path":"a"}' },
      { ...finish, finishReason: { unified: 'tool-calls', raw: 'tool_calls' } } as LanguageModelV4StreamPart,
    ]);
    const r = await generateTextStreamingIfRequired({ model, messages });
    expect(r.toolCalls.map(tc => [tc.toolCallId, tc.toolName, tc.input])).toEqual([['c1', 'read', { path: 'a' }]]);
  });

  it('keeps calling generateText for other models', async () => {
    let streamed = false;
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: 'text', text: 'plain' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: (finish as { usage: never }).usage,
        warnings: [],
      }),
      doStream: async () => { streamed = true; throw new Error('should not stream'); },
    });
    const r = await generateTextStreamingIfRequired({ model, messages });
    expect(r.text).toBe('plain');
    expect(streamed).toBe(false);
  });

  it('rethrows the original upstream error when the stream fails', async () => {
    const upstream = Object.assign(new Error('limit'), { statusCode: 429 });
    const model = streamOnlyModel([{ type: 'stream-start', warnings: [] }, { type: 'error', error: upstream }]);
    await expect(generateTextStreamingIfRequired({ model, messages })).rejects.toBe(upstream);
    await new Promise<void>(resolve => setImmediate(resolve));
  });
});

describe('createLanguageModel marks ChatGPT-login models as stream-only', () => {
  it('marks @ai-sdk/openai with OAuth auth', async () => {
    const model = await createLanguageModel({ npm: '@ai-sdk/openai', modelId: 'gpt-6.1-sol', apiKey: 'x', providerId: 'openai-oauth-2', authType: 'oauth' });
    expect(isStreamOnlyModel(model)).toBe(true);
  });

  it('does not mark an OpenAI API-key model', async () => {
    const model = await createLanguageModel({ npm: '@ai-sdk/openai', modelId: 'gpt-6.1-sol', apiKey: 'sk-x', providerId: 'openai', authType: 'api' });
    expect(isStreamOnlyModel(model)).toBe(false);
  });
});

describe('non-streaming call sites stream for a stream-only model', () => {
  it('server OpenAI-compatible generateOpenAiResponse', async () => {
    const body = await generateOpenAiResponse(streamOnlyModel(textChunks('from server')), { messages } as never, 'm');
    expect((body.choices[0]!.message as { content: string }).content).toBe('from server');
  });

  it('Codex generateResponsesResponse (stream: false requests)', async () => {
    const body = await generateResponsesResponse(streamOnlyModel(textChunks('from codex')), { messages } as never, 'm');
    expect(JSON.stringify(body.output)).toContain('from codex');
  });
});
