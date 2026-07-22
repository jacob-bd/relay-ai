import { afterEach, describe, expect, it, vi } from 'vitest';

// Regression: the Vercel AI SDK's finishReason values use hyphens ('tool-calls',
// 'content-filter') and include non-OpenAI values ('error', 'other', 'unknown').
// A strict OpenAI client (Cursor) validating finish_reason against the real enum
// ('stop' | 'length' | 'tool_calls' | 'content_filter') can reject the response
// otherwise — reproduced live as Cursor's "Empty provider response" on every
// tool-calling turn against a model routed through the SDK adapter.

afterEach(() => {
  vi.doUnmock('ai');
  vi.resetModules();
});

// Regression: translateOpenAiRequest's 'assistant' case only extracted text when msg.content was
// a string. Cursor sends assistant history turns with content as an array of parts
// ([{type:'text', text:'...'}]), same as it does for user messages (which this function already
// forwards correctly). For an array-content assistant message with no tool_calls, the string-only
// check silently dropped the real text, parts stayed empty, and the code fell back to
// content: '' — an assistant message with genuinely empty content and no tool_calls, which
// Alibaba's OpenAI-compatible API (serving qwen3.8-max-preview) rejected with HTTP 400
// "The content field is a required field." This reproduced live as Cursor's "Empty provider
// response" / "Bad Request" on any multi-turn conversation, discovered only after the earlier
// consolidated-tool-call and stream-error-visibility fixes made the underlying failure legible.
describe('translateOpenAiRequest assistant array content', () => {
  it('preserves text from an array-content assistant message with no tool_calls', async () => {
    const { translateOpenAiRequest } = await import('../src/openai-adapter.js');
    const params = translateOpenAiRequest({
      model: 'qwen3.8-max-preview',
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: [{ type: 'text', text: 'Hey Jacob! What can I help you with today?' }] },
      ],
    });
    const assistantMsg = params.messages.find((m: any) => m.role === 'assistant') as any;
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg.content).not.toBe('');
    expect(JSON.stringify(assistantMsg.content)).toContain('Hey Jacob! What can I help you with today?');
  });
});

describe('generateOpenAiResponse finish_reason mapping', () => {
  it('maps the SDK\'s hyphenated tool-calls to the OpenAI wire value tool_calls', async () => {
    vi.doMock('ai', () => ({
      generateText: vi.fn(async () => ({
        text: '',
        toolCalls: [{ toolCallId: 'call_1', toolName: 'list_dir', args: { path: '.' } }],
        finishReason: 'tool-calls',
        usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
      })),
      streamText: vi.fn(),
    }));

    const { generateOpenAiResponse } = await import('../src/openai-adapter.js');
    const response = await generateOpenAiResponse({} as never, { messages: [] } as never, 'qwen3.8-max-preview');
    expect(response.choices[0]?.finish_reason).toBe('tool_calls');
  });

  it('maps content-filter to content_filter and passes stop/length through unchanged', async () => {
    for (const [sdkValue, openAiValue] of [['content-filter', 'content_filter'], ['stop', 'stop'], ['length', 'length']] as const) {
      vi.doMock('ai', () => ({
        generateText: vi.fn(async () => ({ text: 'hi', finishReason: sdkValue, usage: {} })),
        streamText: vi.fn(),
      }));
      const { generateOpenAiResponse } = await import('../src/openai-adapter.js');
      const response = await generateOpenAiResponse({} as never, { messages: [] } as never, 'model');
      expect(response.choices[0]?.finish_reason).toBe(openAiValue);
      vi.doUnmock('ai');
      vi.resetModules();
    }
  });

  it('falls back to stop for SDK values with no OpenAI equivalent (error, other, unknown)', async () => {
    for (const sdkValue of ['error', 'other', 'unknown', undefined]) {
      vi.doMock('ai', () => ({
        generateText: vi.fn(async () => ({ text: 'hi', finishReason: sdkValue, usage: {} })),
        streamText: vi.fn(),
      }));
      const { generateOpenAiResponse } = await import('../src/openai-adapter.js');
      const response = await generateOpenAiResponse({} as never, { messages: [] } as never, 'model');
      expect(response.choices[0]?.finish_reason).toBe('stop');
      vi.doUnmock('ai');
      vi.resetModules();
    }
  });
});

describe('streamOpenAiResponse finish_reason mapping', () => {
  it('emits tool_calls (not tool-calls) in the final SSE chunk', async () => {
    vi.doMock('ai', () => ({
      generateText: vi.fn(),
      streamText: vi.fn(() => ({
        fullStream: (async function* () {
          yield { type: 'text-delta', textDelta: 'hi' };
          yield { type: 'finish', finishReason: 'tool-calls' };
        })(),
      })),
    }));

    const { streamOpenAiResponse } = await import('../src/openai-adapter.js');
    const chunks: string[] = [];
    await streamOpenAiResponse({} as never, { messages: [] } as never, 'model', chunk => chunks.push(chunk));

    const finishChunk = chunks.find(c => c.includes('"finish_reason"') && !c.includes('"finish_reason":null'));
    expect(finishChunk).toContain('"finish_reason":"tool_calls"');
    expect(finishChunk).not.toContain('tool-calls');
  });
});

// Regression: streamOpenAiResponse only handled streamed 'tool-input-start'/'tool-input-delta'
// parts. Some providers (e.g. @ai-sdk/alibaba serving qwen3.8-max-preview) instead deliver the
// tool call as a single consolidated 'tool-call' part with no preceding input-start/delta —
// exactly like generateText's non-streaming result.toolCalls[], and exactly what the proven
// Anthropic-format streamer (sdk-adapter.ts::writeAnthropicStream) already has a fallback case
// for. Without a matching case here, zero tool_calls chunks were emitted, reasoning went out as
// reasoning_content only, and Cursor (a strict OpenAI client) reported "Empty provider response"
// on every tool-calling turn — even though the exact same request worked fine non-streaming
// (generateText collects toolCalls regardless of how the provider delivered them) and fine
// through the Anthropic path (which has the fallback).
describe('streamOpenAiResponse consolidated tool-call handling', () => {
  it('emits a tool_calls chunk for a consolidated tool-call part with no prior input-start/delta', async () => {
    vi.doMock('ai', () => ({
      generateText: vi.fn(),
      streamText: vi.fn(() => ({
        fullStream: (async function* () {
          yield { type: 'reasoning-delta', text: 'thinking...' };
          yield { type: 'tool-call', toolCallId: 'call_1', toolName: 'read_file', input: { path: 'x' } };
          yield { type: 'finish', finishReason: 'tool-calls' };
        })(),
      })),
    }));

    const { streamOpenAiResponse } = await import('../src/openai-adapter.js');
    const chunks: string[] = [];
    await streamOpenAiResponse({} as never, { messages: [] } as never, 'model', chunk => chunks.push(chunk));

    const toolChunk = chunks.find(c => c.includes('"tool_calls"') && c.includes('read_file'));
    expect(toolChunk).toBeDefined();
    expect(toolChunk).toContain('"id":"call_1"');
    expect(toolChunk).toContain('"name":"read_file"');
    expect(toolChunk).toContain('"arguments":"{\\"path\\":\\"x\\"}"');
  });

  it('assigns distinct indices to parallel consolidated tool calls', async () => {
    vi.doMock('ai', () => ({
      generateText: vi.fn(),
      streamText: vi.fn(() => ({
        fullStream: (async function* () {
          yield { type: 'tool-call', toolCallId: 'call_1', toolName: 'read_file', input: {} };
          yield { type: 'tool-call', toolCallId: 'call_2', toolName: 'list_dir', input: {} };
          yield { type: 'finish', finishReason: 'tool-calls' };
        })(),
      })),
    }));

    const { streamOpenAiResponse } = await import('../src/openai-adapter.js');
    const chunks: string[] = [];
    await streamOpenAiResponse({} as never, { messages: [] } as never, 'model', chunk => chunks.push(chunk));

    const chunk1 = chunks.find(c => c.includes('call_1'));
    const chunk2 = chunks.find(c => c.includes('call_2'));
    expect(chunk1).toContain('"index":0');
    expect(chunk2).toContain('"index":1');
  });

  it('does not double-emit a tool call streamed via tool-input-start/delta then followed by tool-call', async () => {
    vi.doMock('ai', () => ({
      generateText: vi.fn(),
      streamText: vi.fn(() => ({
        fullStream: (async function* () {
          yield { type: 'tool-input-start', id: 'call_1', toolName: 'read_file' };
          yield { type: 'tool-input-delta', id: 'call_1', delta: '{"path":"x"}' };
          yield { type: 'tool-call', toolCallId: 'call_1', toolName: 'read_file', input: { path: 'x' } };
          yield { type: 'finish', finishReason: 'tool-calls' };
        })(),
      })),
    }));

    const { streamOpenAiResponse } = await import('../src/openai-adapter.js');
    const chunks: string[] = [];
    await streamOpenAiResponse({} as never, { messages: [] } as never, 'model', chunk => chunks.push(chunk));

    const nameChunks = chunks.filter(c => c.includes('"name":"read_file"'));
    expect(nameChunks).toHaveLength(1);
  });
});

// Regression: a reasoning-heavy turn (e.g. a very long system prompt like Cursor's, which can
// leave a reasoning model no budget for a visible answer) produced zero forwarded content on
// the OpenAI-format path, because openai-adapter.ts's switch had no case for the SDK's
// 'reasoning-delta' stream part (or generateText's `reasoning`/`reasoningText` result field) —
// unlike the Anthropic-format path (sdk-adapter.ts), which already mapped it to a thinking
// block. This reproduced live as Cursor's "Empty provider response" while the exact same model
// worked fine through relay-ai claude/codex/antigravity (all Anthropic-format).
// Regression: generateOpenAiResponse read tc.args, the Vercel AI SDK v4 result field. The SDK
// version this codebase runs (v5) puts tool-call arguments on toolCalls[].input instead (as
// sdk-adapter.ts's generateAnthropicResponse already reads correctly) — so tc.args was always
// undefined, and JSON.stringify(undefined) serializes to the string "undefined", corrupting the
// arguments sent back to the client on every non-streaming tool call.
describe('generateOpenAiResponse tool call arguments field', () => {
  it('reads arguments from the v5 .input field, not the v4 .args field', async () => {
    vi.doMock('ai', () => ({
      generateText: vi.fn(async () => ({
        text: '',
        toolCalls: [{ toolCallId: 'call_1', toolName: 'read_file', input: { path: 'x' } }],
        finishReason: 'tool-calls',
        usage: {},
      })),
      streamText: vi.fn(),
    }));

    const { generateOpenAiResponse } = await import('../src/openai-adapter.js');
    const response = await generateOpenAiResponse({} as never, { messages: [] } as never, 'model');
    expect(response.choices[0]?.message.tool_calls?.[0]?.function.arguments).toBe('{"path":"x"}');
  });
});

// Regression: unlike sdk-adapter.ts's writeAnthropicStream (which has an explicit 'error' case
// that logs and surfaces the upstream failure), streamOpenAiResponse's switch had no case for
// the SDK's 'error' fullStream part at all. If the upstream provider fails mid-stream (seen live
// with qwen3.8-max-preview on a harder query — reasoning proceeded, then the stream ended with an
// unhandled error part instead of a 'finish'), the error was silently dropped: the loop ended,
// only a bare [DONE] was ever sent, and Cursor reported "Empty provider response" with zero
// visibility into what actually failed upstream.
describe('streamOpenAiResponse surfaces stream errors instead of dropping them', () => {
  it('logs the error and emits visible content + a finish_reason instead of a silent [DONE]', async () => {
    vi.doMock('ai', () => ({
      generateText: vi.fn(),
      streamText: vi.fn(() => ({
        fullStream: (async function* () {
          yield { type: 'reasoning-delta', text: 'thinking...' };
          yield { type: 'error', error: { message: 'upstream connection reset' } };
        })(),
      })),
    }));

    const { streamOpenAiResponse } = await import('../src/openai-adapter.js');
    const chunks: string[] = [];
    const logged: string[] = [];
    await streamOpenAiResponse(
      {} as never, { messages: [] } as never, 'model',
      chunk => chunks.push(chunk),
      msg => logged.push(msg()),
    );

    expect(logged.some(l => l.includes('upstream connection reset'))).toBe(true);
    const contentChunk = chunks.find(c => c.includes('"content"') && c.includes('upstream connection reset'));
    expect(contentChunk).toBeDefined();
    const finishChunk = chunks.find(c => c.includes('"finish_reason"') && !c.includes('"finish_reason":null'));
    expect(finishChunk).toBeDefined();
    expect(chunks.at(-1)).toBe('data: [DONE]\n\n');
  });
});

describe('reasoning content surfaced instead of dropped', () => {
  it('generateOpenAiResponse includes reasoning_content when the model produced no visible text', async () => {
    vi.doMock('ai', () => ({
      generateText: vi.fn(async () => ({
        text: '',
        reasoningText: 'thinking through the huge system prompt...',
        finishReason: 'stop',
        usage: {},
      })),
      streamText: vi.fn(),
    }));

    const { generateOpenAiResponse } = await import('../src/openai-adapter.js');
    const response = await generateOpenAiResponse({} as never, { messages: [] } as never, 'qwen3.8-max-preview');
    expect(response.choices[0]?.message.reasoning_content).toBe('thinking through the huge system prompt...');
  });

  it('streamOpenAiResponse forwards reasoning-delta parts as reasoning_content chunks', async () => {
    vi.doMock('ai', () => ({
      generateText: vi.fn(),
      streamText: vi.fn(() => ({
        fullStream: (async function* () {
          yield { type: 'reasoning-delta', text: 'reasoning about the task' };
          yield { type: 'finish', finishReason: 'stop' };
        })(),
      })),
    }));

    const { streamOpenAiResponse } = await import('../src/openai-adapter.js');
    const chunks: string[] = [];
    await streamOpenAiResponse({} as never, { messages: [] } as never, 'model', chunk => chunks.push(chunk));

    const reasoningChunk = chunks.find(c => c.includes('reasoning_content'));
    expect(reasoningChunk).toBeDefined();
    expect(reasoningChunk).toContain('"reasoning_content":"reasoning about the task"');
  });
});
