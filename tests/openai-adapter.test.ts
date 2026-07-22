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

// Regression: a reasoning-heavy turn (e.g. a very long system prompt like Cursor's, which can
// leave a reasoning model no budget for a visible answer) produced zero forwarded content on
// the OpenAI-format path, because openai-adapter.ts's switch had no case for the SDK's
// 'reasoning-delta' stream part (or generateText's `reasoning`/`reasoningText` result field) —
// unlike the Anthropic-format path (sdk-adapter.ts), which already mapped it to a thinking
// block. This reproduced live as Cursor's "Empty provider response" while the exact same model
// worked fine through relay-ai claude/codex/antigravity (all Anthropic-format).
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
