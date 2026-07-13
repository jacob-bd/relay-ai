import { describe, expect, it, vi } from 'vitest';
import {
  translateResponsesInput,
  translateResponsesRequest,
  translateResponsesTools,
  responsesErrorBody,
} from '../src/codex-responses-adapter.js';

describe('translateResponsesRequest', () => {
  it('maps string input to user message', () => {
    const params = translateResponsesRequest({
      model: 'claude-sonnet-4-6',
      input: 'hello',
      instructions: 'be helpful',
    }, '@ai-sdk/anthropic');
    expect(params.instructions).toBe('be helpful');
    expect(params.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'hello' }] }]);
  });

  it('merges developer role and instructions into system', () => {
    const params = translateResponsesRequest({
      model: 'm',
      input: [
        { role: 'developer', content: 'dev rules' },
        { role: 'user', content: 'hi' },
      ],
      instructions: 'extra',
    }, '@ai-sdk/anthropic');
    expect(params.instructions).toBe('dev rules\nextra');
    expect(params.messages).toHaveLength(1);
    expect(params.messages[0]!.role).toBe('user');
  });

  it('prepends user placeholder when first message is assistant', () => {
    const params = translateResponsesInput([
      { role: 'assistant', content: 'prior' },
    ], undefined, '@ai-sdk/anthropic');
    expect(params.messages[0]!.role).toBe('user');
    expect(params.messages[1]!.role).toBe('assistant');
  });

  it('maps function_call and function_call_output for tool round-trip', () => {
    const params = translateResponsesInput([
      { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'Read', arguments: '{"path":"a"}' },
      { type: 'function_call_output', call_id: 'call_1', output: 'file body' },
    ], undefined, '@ai-sdk/xai');
    expect(params.messages).toHaveLength(3);
    expect(params.messages[0]!.role).toBe('user');
    const assistant = params.messages[1] as { role: string; content: unknown[] };
    expect(assistant.role).toBe('assistant');
    expect(assistant.content[0]).toMatchObject({ type: 'tool-call', toolCallId: 'call_1', toolName: 'Read' });
    const toolMsg = params.messages[2] as { role: string; content: unknown[] };
    expect(toolMsg.role).toBe('tool');
    expect(toolMsg.content[0]).toMatchObject({ type: 'tool-result', toolCallId: 'call_1' });
  });

  it('decodes thought signature from call_id for Google', () => {
    const params = translateResponsesInput([
      { type: 'function_call_output', call_id: 'call_1__ts__U0lH', output: 'ok' },
    ], undefined, '@ai-sdk/google');
    // name unknown without prior call — still parses call_id
    expect(params.messages[0]).toMatchObject({ role: 'tool' });
  });

  it('maps reasoning item before function_call for DeepSeek round-trip', () => {
    const params = translateResponsesInput([
      {
        type: 'reasoning',
        id: 'rs_1',
        summary: [{ type: 'summary_text', text: 'planning tool use' }],
      },
      { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'Read', arguments: '{}' },
      { type: 'function_call_output', call_id: 'call_1', output: 'ok' },
    ], undefined, '@ai-sdk/openai-compatible');
    const assistant = params.messages[1] as { role: string; content: unknown[] };
    expect(assistant.role).toBe('assistant');
    expect(assistant.content[0]).toMatchObject({ type: 'reasoning', text: 'planning tool use' });
    expect(assistant.content[1]).toMatchObject({ type: 'tool-call', toolCallId: 'call_1' });
  });

  it('forwards max_output_tokens', () => {
    const params = translateResponsesRequest({
      model: 'm',
      input: 'x',
      max_output_tokens: 8192,
    }, '@ai-sdk/anthropic');
    expect(params.maxOutputTokens).toBe(8192);
  });

  it('limits translated Codex tools when maxTools is set', () => {
    const tools = Array.from({ length: 130 }, (_, i) => ({
      type: 'function' as const,
      name: `tool_${i}`,
      parameters: { type: 'object', properties: {} },
    }));

    const params = translateResponsesRequest(
      { model: 'm', input: 'hi', tools },
      '@ai-sdk/groq',
      undefined,
      { maxTools: 128 },
    );

    expect(Object.keys(params.tools ?? {})).toHaveLength(128);
    expect(params.tools?.tool_127).toBeDefined();
    expect(params.tools?.tool_128).toBeUndefined();
  });

  it('merges OpenAI effort with encrypted reasoning options', () => {
    const params = translateResponsesRequest({
      model: 'gpt-5.5',
      input: 'x',
      reasoning: { effort: 'high' },
    }, '@ai-sdk/openai');
    expect(params.providerOptions?.openai).toMatchObject({
      store: false,
      include: ['reasoning.encrypted_content'],
      reasoningEffort: 'high',
    });
  });

  it('merges Google effort with includeThoughts', () => {
    const params = translateResponsesRequest({
      model: 'gemini-2.5-pro',
      input: 'x',
      reasoning: { effort: 'high' },
    }, '@ai-sdk/google');
    expect(params.providerOptions?.google?.thinkingConfig).toMatchObject({
      includeThoughts: true,
      thinkingBudget: 8192,
    });
  });

  it('maps OpenRouter effort through provider metadata', () => {
    const params = translateResponsesRequest({
      model: 'z-ai/glm-5.2',
      input: 'x',
      reasoning: { effort: 'high' },
    }, '@openrouter/ai-sdk-provider', {
      providerId: 'openrouter',
      supportedParameters: ['reasoning'],
    });
    expect(params.providerOptions?.openrouter).toEqual({
      reasoning: {
        effort: 'high',
        exclude: false,
      },
    });
  });

  it('applies reasoning effort using upstreamModelId, not the gateway/catalog slug in body.model', () => {
    const params = translateResponsesRequest({
      model: 'xai-oauth__grok-4.5',
      input: 'x',
      reasoning: { effort: 'high' },
    }, '@ai-sdk/xai', { upstreamModelId: 'grok-4.5' });
    expect(params.providerOptions?.xai).toMatchObject({ reasoningEffort: 'high' });
  });

  it('does not apply reasoning effort when only the prefixed slug is available (regression guard)', () => {
    const params = translateResponsesRequest({
      model: 'xai-oauth__grok-4.5',
      input: 'x',
      reasoning: { effort: 'high' },
    }, '@ai-sdk/xai');
    expect(params.providerOptions?.xai).toBeUndefined();
  });

  it('leaves providerOptions unchanged when reasoning is absent', () => {
    const params = translateResponsesRequest({
      model: 'gpt-5.5',
      input: 'x',
    }, '@ai-sdk/openai');
    expect(params.providerOptions).toEqual({
      openai: { store: false, include: ['reasoning.encrypted_content'] },
    });
  });

  it('builds tools from Responses format', () => {
    const tools = translateResponsesTools([
      { type: 'function', name: 'Bash', description: 'run', parameters: { type: 'object', properties: {} } },
    ]);
    expect(tools && Object.keys(tools)).toEqual(['Bash']);
  });

  it('flattens Codex App\'s proprietary namespace-wrapped MCP tools into callable function tools', () => {
    // Codex App wraps MCP server tools in a non-standard {type:"namespace", tools:[...]}
    // envelope. Only the real ChatGPT backend unwraps this server-side; custom Responses
    // API providers must flatten it themselves or the model never sees a callable tool.
    const tools = translateResponsesTools([
      {
        type: 'namespace',
        name: 'mcp__context7',
        description: 'Use this server to fetch current documentation...',
        tools: [
          { type: 'function', name: 'resolve_library_id', description: 'Resolves a library id', parameters: { type: 'object', properties: {} } },
          { type: 'function', name: 'query_docs', description: 'Query docs', parameters: { type: 'object', properties: { libraryId: { type: 'string' } } } },
        ],
      },
      { type: 'function', name: 'Bash', description: 'run', parameters: { type: 'object', properties: {} } },
    ]);
    expect(tools && Object.keys(tools)).toEqual([
      'mcp__context7__resolve_library_id',
      'mcp__context7__query_docs',
      'Bash',
    ]);
  });
});

describe('responsesErrorBody', () => {
  it('returns failed status with error field', () => {
    const body = responsesErrorBody('m', 'Unauthorized', 401);
    expect(body.status).toBe('failed');
    expect(body.created_at).toEqual(expect.any(Number));
    expect(body.error).toMatchObject({ message: 'Unauthorized' });
  });
});

describe('writeResponsesStream', () => {
  it('emits full text SSE sequence', async () => {
    const { writeResponsesStream } = await import('../src/codex-responses-adapter.js');
    const chunks: string[] = [];
    const write = (c: string) => chunks.push(c);

    async function* stream() {
      yield { type: 'text-start' };
      yield { type: 'text-delta', text: 'Hello' };
      yield { type: 'text-delta', text: ' world' };
      yield { type: 'finish', totalUsage: { inputTokens: 1, outputTokens: 2 } };
    }

    await writeResponsesStream(stream(), 'test-model', write);
    const joined = chunks.join('');
    expect(joined).toContain('response.created');
    expect(joined).toContain('response.output_text.delta');
    expect(joined).toContain('response.output_text.done');
    expect(joined).toContain('response.content_part.done');
    expect(joined).toContain('response.output_item.done');
    expect(joined).toContain('response.completed');
    expect(joined).toContain('Hello world');
  });

  it('emits function call SSE sequence with arguments.done', async () => {
    const { writeResponsesStream } = await import('../src/codex-responses-adapter.js');
    const chunks: string[] = [];
    const write = (c: string) => chunks.push(c);

    async function* stream() {
      yield { type: 'tool-input-start', id: 'fc_1', toolName: 'Bash' };
      yield { type: 'tool-input-delta', delta: '{"cmd":' };
      yield { type: 'tool-input-delta', delta: '"ls"}' };
      yield { type: 'finish', totalUsage: { inputTokens: 1, outputTokens: 2 } };
    }

    await writeResponsesStream(stream(), 'test-model', write);
    const joined = chunks.join('');
    expect(joined).toContain('response.function_call_arguments.delta');
    expect(joined).toContain('response.function_call_arguments.done');
    expect(joined).toContain('function_call');
    expect(joined).toContain('\\"cmd\\":\\"ls\\"');
  });

  it('reports periodic progress during a long-running stream, so a stuck/looping generation is visible before it finishes', async () => {
    const { writeResponsesStream } = await import('../src/codex-responses-adapter.js');
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const chunks: string[] = [];
      const write = (c: string) => chunks.push(c);
      const progressCalls: Array<{ elapsedMs: number; reasoningChars: number; reasoningTail: string }> = [];

      async function* stream() {
        yield { type: 'reasoning-start' };
        yield { type: 'reasoning-delta', text: 'thinking one ' };
        vi.setSystemTime(3500);
        yield { type: 'reasoning-delta', text: 'thinking two ' };
        vi.setSystemTime(7000);
        yield { type: 'reasoning-delta', text: 'thinking three ' };
        yield { type: 'finish', totalUsage: { inputTokens: 1, outputTokens: 2 } };
      }

      await writeResponsesStream(stream(), 'test-model', write, undefined, p => progressCalls.push(p));

      expect(progressCalls).toHaveLength(2);
      expect(progressCalls[0]!.elapsedMs).toBe(3500);
      expect(progressCalls[1]!.elapsedMs).toBe(7000);
      expect(progressCalls[1]!.reasoningChars).toBe('thinking one thinking two thinking three '.length);
      expect(progressCalls[1]!.reasoningTail).toContain('thinking three');
    } finally {
      vi.useRealTimers();
    }
  });

  it('detects a stuck text-repetition loop and stops the generation instead of streaming forever', async () => {
    const { writeResponsesStream } = await import('../src/codex-responses-adapter.js');
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const chunks: string[] = [];
      const write = (c: string) => chunks.push(c);
      let yielded = 0;
      // > REPEAT_TAIL_CHARS (200) so each repeat produces an identical trailing tail.
      const repeatedBlock = `The user wants me to summarize this. ${'x'.repeat(180)}`;

      async function* stream() {
        yield { type: 'text-start' };
        for (let i = 0; i < 20; i++) {
          yielded++;
          vi.setSystemTime((i + 1) * 3000);
          yield { type: 'text-delta', text: repeatedBlock };
        }
        yield { type: 'finish', totalUsage: { inputTokens: 1, outputTokens: 2 } };
      }

      const summaries: Array<{ loopDetected?: string }> = [];
      const forceStops: string[] = [];
      await writeResponsesStream(stream(), 'test-model', write, s => summaries.push(s), undefined, {
        onForceStop: reason => forceStops.push(reason),
      });

      expect(summaries[0]?.loopDetected).toBe('text');
      expect(yielded).toBeLessThan(20);
      expect(chunks.join('')).toContain('generation stopped after detecting a repetition loop');
      // Breaking out of stream does NOT cancel the SDK's upstream request (it
      // keeps consuming internally to settle its promises) — the caller must abort.
      expect(forceStops).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not flag naturally short, non-repeating output as a loop', async () => {
    const { writeResponsesStream } = await import('../src/codex-responses-adapter.js');
    const chunks: string[] = [];
    const write = (c: string) => chunks.push(c);

    async function* stream() {
      yield { type: 'text-start' };
      yield { type: 'text-delta', text: 'A short, normal, non-repeating summary of the changes.' };
      yield { type: 'finish', totalUsage: { inputTokens: 1, outputTokens: 2 } };
    }

    const summaries: Array<{ loopDetected?: string }> = [];
    const forceStops: string[] = [];
    await writeResponsesStream(stream(), 'test-model', write, s => summaries.push(s), undefined, {
      onForceStop: reason => forceStops.push(reason),
    });

    expect(summaries[0]?.loopDetected).toBeUndefined();
    expect(chunks.join('')).not.toContain('generation stopped after detecting a repetition loop');
    expect(forceStops).toHaveLength(0);
  });

  it('recovers leaked DeepSeek DSML tool-call markup into real function_call output', async () => {
    const { writeResponsesStream } = await import('../src/codex-responses-adapter.js');
    const chunks: string[] = [];
    const write = (c: string) => chunks.push(c);

    async function* stream() {
      yield { type: 'text-start' };
      yield {
        type: 'text-delta',
        text: '<｜DSML｜tool_calls><｜DSML｜invoke name="exec_command">'
          + '<｜DSML｜parameter name="cmd" string="true">cat src/foo.ts | sed -n \'1,10p\'</｜DSML｜parameter>'
          + '</｜DSML｜invoke></｜DSML｜tool_calls>',
      };
      yield { type: 'finish', totalUsage: { inputTokens: 1, outputTokens: 2 } };
    }

    const summaries: Array<{ dsmlToolCallsRecovered?: number }> = [];
    await writeResponsesStream(stream(), 'test-model', write, s => summaries.push(s));

    expect(summaries[0]?.dsmlToolCallsRecovered).toBe(1);

    // The client still saw the raw markup stream live (we can't know it's a tool call
    // until the closing tag arrives) - but the final completed response, which is what
    // Codex actually acts on, must carry a real function_call, not the garbled text.
    const events = parseSseEvents(chunks.join(''));
    const completed = events.find(e => e.event === 'response.completed')!.data.response;
    expect(completed.output).toEqual([
      expect.objectContaining({
        type: 'function_call',
        name: 'exec_command',
        arguments: JSON.stringify({ cmd: "cat src/foo.ts | sed -n '1,10p'" }),
      }),
    ]);
    expect(completed.output.some((item: { type: string }) => item.type === 'message')).toBe(false);
  });

  it('keeps streaming Responses call_id native-safe when provider signatures exist', async () => {
    const { writeResponsesStream } = await import('../src/codex-responses-adapter.js');
    const chunks: string[] = [];
    const write = (c: string) => chunks.push(c);

    async function* stream() {
      yield {
        type: 'tool-input-start',
        id: 'call_1',
        toolName: 'Read',
        providerMetadata: { google: { thoughtSignature: 'SIG' } },
      };
      yield { type: 'tool-input-delta', id: 'call_1', delta: '{"path":"a"}' };
      yield { type: 'finish', totalUsage: { inputTokens: 1, outputTokens: 2 } };
    }

    await writeResponsesStream(stream(), 'gemini-2.5-pro', write);
    const toolCall = parseSseEvents(chunks.join(''))
      .map(event => event.data.item)
      .find(item => item?.type === 'function_call');

    expect(toolCall.call_id).toBe('call_1');
    expect(toolCall.call_id.length).toBeLessThanOrEqual(64);
  });

  it('emits each parallel function call instead of overwriting the first one', async () => {
    const { writeResponsesStream } = await import('../src/codex-responses-adapter.js');
    const chunks: string[] = [];
    const write = (c: string) => chunks.push(c);

    async function* stream() {
      yield { type: 'tool-input-start', id: 'fc_1', toolName: 'Read' };
      yield { type: 'tool-input-delta', id: 'fc_1', delta: '{"path":"a"}' };
      yield { type: 'tool-input-start', id: 'fc_2', toolName: 'Grep' };
      yield { type: 'tool-input-delta', id: 'fc_2', delta: '{"pattern":"x"}' };
      yield { type: 'finish', totalUsage: { inputTokens: 1, outputTokens: 2 } };
    }

    await writeResponsesStream(stream(), 'test-model', write);
    const outputDone = parseSseEvents(chunks.join(''))
      .filter(event => event.event === 'response.output_item.done')
      .map(event => event.data.item);

    expect(outputDone).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'function_call', id: 'fc_1', name: 'Read', arguments: '{"path":"a"}' }),
      expect.objectContaining({ type: 'function_call', id: 'fc_2', name: 'Grep', arguments: '{"pattern":"x"}' }),
    ]));
  });

  it('emits reasoning output item for tool-loop round-trip', async () => {
    const { writeResponsesStream } = await import('../src/codex-responses-adapter.js');
    const chunks: string[] = [];
    const write = (c: string) => chunks.push(c);

    async function* stream() {
      yield { type: 'reasoning-start', id: 'r1' };
      yield { type: 'reasoning-delta', id: 'r1', text: 'think step' };
      yield { type: 'tool-input-start', id: 'fc_1', toolName: 'Bash' };
      yield { type: 'tool-input-delta', delta: '{}' };
      yield { type: 'finish', totalUsage: { inputTokens: 1, outputTokens: 2 } };
    }

    await writeResponsesStream(stream(), 'deepseek-v4-flash-free', write);
    const joined = chunks.join('');
    expect(joined).toContain('"type":"reasoning"');
    expect(joined).toContain('think step');
    expect(joined).toContain('function_call');
  });

  it('reports stream errors through onDone so they reach the trace log', async () => {
    const { writeResponsesStream } = await import('../src/codex-responses-adapter.js');
    const chunks: string[] = [];
    const write = (c: string) => chunks.push(c);
    const summaries: any[] = [];

    async function* stream() {
      yield { type: 'reasoning-delta', text: 'thinking' };
      yield { type: 'error', error: new Error('personal-team-blocked:spending-limit (HTTP 403)') };
    }

    await writeResponsesStream(stream(), 'grok-4.5', write, s => summaries.push(s));
    expect(summaries).toHaveLength(1);
    expect(summaries[0].errorMessage).toContain('spending-limit');
    expect(summaries[0].reasoningChars).toBe(8);
  });

  it('emits a failed response.completed when the stream is aborted (idle timeout)', async () => {
    const { writeResponsesStream } = await import('../src/codex-responses-adapter.js');
    const chunks: string[] = [];
    const write = (c: string) => chunks.push(c);

    async function* stream() {
      yield { type: 'start' };
      yield { type: 'abort', reason: 'The operation was aborted due to timeout' };
    }

    await writeResponsesStream(stream(), 'test-model', write);
    const completed = parseSseEvents(chunks.join(''))
      .filter(event => event.event === 'response.completed')
      .map(event => event.data.response);
    expect(completed).toHaveLength(1);
    expect(completed[0].status).toBe('failed');
    expect(completed[0].error.message).toContain('abort');
  });
});

describe('streamResponsesResponse idle timeout', () => {
  it('aborts a stream whose upstream never sends a single part', async () => {
    const { streamResponsesResponse } = await import('../src/codex-responses-adapter.js');
    const chunks: string[] = [];
    const write = (c: string) => chunks.push(c);

    // Fake LanguageModelV3 whose doStream hangs forever unless aborted —
    // simulates an upstream gateway silently dropping the connection before
    // sending a single byte (observed live with OpenCode Zen).
    const hangingModel = {
      specificationVersion: 'v3' as const,
      provider: 'test',
      modelId: 'test-model',
      supportedUrls: {},
      async doStream(options: { abortSignal?: AbortSignal }) {
        return new Promise((_resolve, reject) => {
          options.abortSignal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      },
      async doGenerate(): Promise<never> {
        throw new Error('not used');
      },
    };

    await streamResponsesResponse(
      hangingModel as never,
      { messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] as never },
      'test-model',
      write,
      undefined,
      undefined,
      { idleTimeoutMs: 100 },
    );

    const completed = parseSseEvents(chunks.join(''))
      .filter(event => event.event === 'response.completed')
      .map(event => event.data.response);
    expect(completed).toHaveLength(1);
    expect(completed[0].status).toBe('failed');
  }, 10_000);
});

describe('generateResponsesResponse', () => {
  it('keeps Responses call_id native-safe while preserving Gemini signatures in memory', async () => {
    vi.resetModules();
    vi.doMock('ai', () => ({
      generateText: vi.fn(async () => ({
        text: '',
        reasoningText: '',
        toolCalls: [{
          toolCallId: 'call_1',
          toolName: 'Read',
          input: { path: 'a' },
          providerMetadata: { google: { thoughtSignature: 'SIG' } },
        }],
        usage: { inputTokens: 1, outputTokens: 2 },
      })),
      streamText: vi.fn(),
      tool: vi.fn((spec: unknown) => spec),
      jsonSchema: vi.fn((schema: unknown) => schema),
    }));

    const { generateResponsesResponse } = await import('../src/codex-responses-adapter.js');
    const body = await generateResponsesResponse({} as never, { messages: [] }, 'gemini-2.5-pro');
    const toolCall = (body.output as any[]).find(item => item.type === 'function_call');
    expect(toolCall.call_id).toBe('call_1');
    expect(toolCall.call_id.length).toBeLessThanOrEqual(64);

    const { translateResponsesInput } = await import('../src/codex-responses-adapter.js');
    const params = translateResponsesInput([
      { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'Read', arguments: '{}' },
    ], undefined, '@ai-sdk/google');
    const assistant = params.messages[1] as { role: string; content: Array<{ providerOptions?: unknown }> };
    expect(assistant.content[0]?.providerOptions).toEqual({ google: { thoughtSignature: 'SIG' } });

    vi.doUnmock('ai');
    vi.resetModules();
  });
});

function parseSseEvents(raw: string): Array<{ event: string; data: any }> {
  return raw.split('\n\n').filter(Boolean).map(block => {
    const lines = block.split('\n');
    const event = lines.find(line => line.startsWith('event: '))?.slice('event: '.length) ?? '';
    const data = lines.find(line => line.startsWith('data: '))?.slice('data: '.length) ?? '{}';
    return { event, data: JSON.parse(data) };
  });
}
