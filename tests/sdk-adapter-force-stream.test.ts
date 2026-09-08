import { afterEach, describe, expect, it, vi } from 'vitest';
import { NoOutputGeneratedError, simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { generateAnthropicResponse } from '../src/sdk-adapter.js';
import { createLanguageModel } from '../src/provider-factory.js';
import { upstreamHttpStatus } from '../src/codex/upstream-error.js';

const params = { messages: [{ role: 'user' as const, content: 'Hello' }] };

function streamingModel(chunks: LanguageModelV4StreamPart[]) {
  return new MockLanguageModelV4({
    doStream: {
      stream: simulateReadableStream({ chunks, initialDelayInMs: null, chunkDelayInMs: null }),
    },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('generateAnthropicResponse with the real SDK stream collector', () => {
  it('preserves the first stream error and its code/status when result promises reject without output', async () => {
    const original = Object.assign(new Error('gpt-6-astra requires a newer version of Codex'), {
      code: 'invalid_request_error',
      statusCode: 400,
    });
    const model = streamingModel([
      { type: 'stream-start', warnings: [] },
      { type: 'error', error: original },
      { type: 'error', error: new NoOutputGeneratedError({ message: 'No output generated. Check the stream for errors.' }) },
    ]);

    await expect(generateAnthropicResponse(model, params, 'gpt-6-astra', { forceStream: true }))
      .rejects.toBe(original);
    // Let sibling result promises settle; Vitest reports any unhandled rejection.
    await new Promise<void>(resolve => setImmediate(resolve));
  });

  it('preserves a real OpenAI SDK HTTP error and sends the Astra-compatible Codex version header', async () => {
    let requestHeaders: Headers | undefined;
    const message = 'gpt-6-astra requires a newer version of Codex';
    vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => {
      requestHeaders = new Headers(init.headers);
      return Response.json({ error: { message, type: 'invalid_request_error', code: 'invalid_request_error' } }, {
        status: 400,
      });
    });
    const model = await createLanguageModel({
      npm: '@ai-sdk/openai',
      modelId: 'gpt-6-astra',
      apiKey: 'test-token',
      authType: 'oauth',
      useResponsesLite: true,
    });
    const error = await generateAnthropicResponse(model, params, 'gpt-6-astra', { forceStream: true })
      .catch((error: unknown) => error);

    expect(error).toMatchObject({ name: 'AI_APICallError', statusCode: 400, message });
    expect(upstreamHttpStatus(error, message)).toBe(400);
    expect(requestHeaders?.get('version')).toBe('0.153.4');
    await new Promise<void>(resolve => setImmediate(resolve));
  });

  it('keeps the SDK no-output error for an empty upstream stream', async () => {
    await expect(generateAnthropicResponse(streamingModel([]), params, 'gpt-6-astra', { forceStream: true }))
      .rejects.toMatchObject({ name: 'AI_NoOutputGeneratedError' });
  });

  it('collects successful text chunks and usage into an Anthropic response', async () => {
    const model = streamingModel([
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: 'text-1' },
      { type: 'text-delta', id: 'text-1', delta: 'Hello' },
      { type: 'text-delta', id: 'text-1', delta: ' Astra' },
      { type: 'text-end', id: 'text-1' },
      {
        type: 'finish',
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 4, text: 4, reasoning: 0 },
        },
      },
    ]);

    await expect(generateAnthropicResponse(model, params, 'gpt-6-astra', { forceStream: true }))
      .resolves.toMatchObject({
        type: 'message',
        role: 'assistant',
        model: 'gpt-6-astra',
        content: [{ type: 'text', text: 'Hello Astra' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 3, output_tokens: 4 },
      });
  });
});
