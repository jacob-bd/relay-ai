import { afterEach, describe, expect, it, vi } from 'vitest';
import { NoOutputGeneratedError, simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { APICallError, type LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { generateAnthropicResponse, streamAnthropicResponse } from '../src/sdk-adapter.js';
import { CODEX_RESPONSES_LITE_VERSION } from '../src/constants.js';
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
    expect(requestHeaders?.get('version')).toBe(CODEX_RESPONSES_LITE_VERSION);
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

describe('SDK retries for transient provider errors', () => {
  const finish = {
    type: 'finish' as const,
    finishReason: { unified: 'stop' as const, raw: 'stop' },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    },
  };
  const rateLimited = () => new APICallError({
    message: 'rate limit exceeded',
    url: 'https://api.mistral.ai/v1/chat/completions',
    requestBodyValues: {},
    statusCode: 429,
    // Zero delay keeps the SDK's backoff out of the test's runtime.
    responseHeaders: { 'retry-after-ms': '0' },
  });

  function flakyModel() {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        calls += 1;
        if (calls === 1) throw rateLimited();
        return {
          content: [{ type: 'text', text: 'ok' }],
          finishReason: finish.finishReason,
          usage: finish.usage,
          warnings: [],
        };
      },
      doStream: async () => {
        calls += 1;
        if (calls === 1) throw rateLimited();
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start', warnings: [] },
              { type: 'text-start', id: 't' },
              { type: 'text-delta', id: 't', delta: 'ok' },
              { type: 'text-end', id: 't' },
              finish,
            ] as LanguageModelV4StreamPart[],
            initialDelayInMs: null,
            chunkDelayInMs: null,
          }),
        };
      },
    });
    return { model, calls: () => calls };
  }

  it('retries a 429 on the non-streaming path', async () => {
    const { model, calls } = flakyModel();
    await expect(generateAnthropicResponse(model, params, 'mistral-large'))
      .resolves.toMatchObject({ content: [{ type: 'text', text: 'ok' }] });
    expect(calls()).toBe(2);
  });

  it('retries a 429 on the forced-stream path', async () => {
    const { model, calls } = flakyModel();
    await expect(generateAnthropicResponse(model, params, 'mistral-large', { forceStream: true }))
      .resolves.toMatchObject({ content: [{ type: 'text', text: 'ok' }] });
    expect(calls()).toBe(2);
  });

  it('retries a 429 on the streaming path', async () => {
    const { model, calls } = flakyModel();
    let out = '';
    await streamAnthropicResponse(model, params, 'mistral-large', chunk => { out += chunk; });
    expect(out).toContain('"text":"ok"');
    expect(calls()).toBe(2);
  });
});
