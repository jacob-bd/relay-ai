import { describe, it, expect, vi } from 'vitest';
import {
  annotateToolNames,
  anthropicEffortFromRequest,
  translateMessages,
  translateTools,
  translateToolChoice,
  translateRequest,
  writeAnthropicStream,
} from '../src/sdk-adapter.js';
import { MAX_MODEL_CATALOG } from '../src/constants.js';
import type { SubagentModelRouting } from '../src/subagent-model-routing.js';

const subagentRouting: SubagentModelRouting = {
  parentModelId: 'anthropic-relay__qwen-3',
  models: [
    {
      id: 'anthropic-relay__qwen-3',
      compatibilityIds: ['relay:qwen'],
      displayName: 'Qwen 3',
    },
    {
      id: 'anthropic-relay__grok-4',
      compatibilityIds: ['relay:grok'],
      displayName: 'Grok 4',
    },
  ],
};

function claudeAgentTool() {
  return {
    name: 'Agent',
    description: 'Launch an agent',
    input_schema: {
      type: 'object',
      properties: {
        description: { type: 'string' },
        prompt: { type: 'string' },
        subagent_type: { type: 'string' },
        model: { type: 'string', enum: ['sonnet', 'opus', 'haiku', 'fable'] },
      },
    },
  };
}

describe('translateTools', () => {
  it('builds client-side tools (no execute) keyed by name', () => {
    const tools = translateTools([
      { name: 'Read', description: 'read a file', input_schema: { type: 'object', properties: { path: { type: 'string' } } } },
    ]);
    expect(tools && Object.keys(tools)).toEqual(['Read']);
    expect(tools!.Read.execute).toBeUndefined();
  });
  it('returns undefined for empty/missing tools', () => {
    expect(translateTools(undefined)).toBeUndefined();
    expect(translateTools([])).toBeUndefined();
  });
});

describe('annotateToolNames', () => {
  it('resolves tool_result names from prior tool_use ids', () => {
    const messages = [
      { role: 'assistant' as const, content: [{ type: 'tool_use', id: 'call_1', name: 'Read', input: {} }] },
      { role: 'user' as const, content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'hi' }] },
    ];
    annotateToolNames(messages);
    expect((messages[1].content as any[])[0]._name).toBe('Read');
  });
  it('resolves names even when the id carries an encoded thought signature', () => {
    const messages = [
      { role: 'assistant' as const, content: [{ type: 'tool_use', id: 'call_1__ts__U0lH', name: 'Read', input: {} }] },
      { role: 'user' as const, content: [{ type: 'tool_result', tool_use_id: 'call_1__ts__U0lH', content: 'hi' }] },
    ];
    annotateToolNames(messages);
    expect((messages[1].content as any[])[0]._name).toBe('Read');
  });
});

describe('translateMessages', () => {
  it('maps user text and assistant text', () => {
    const out = translateMessages([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: [{ type: 'text', text: 'hi there' }] },
    ], '@ai-sdk/xai');
    expect(out).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'hi there' }] },
    ]);
  });

  it('maps tool_use → tool-call and tool_result → tool message', () => {
    const messages = [
      { role: 'assistant' as const, content: [{ type: 'tool_use', id: 'call_1', name: 'Read', input: { path: 'a' } }] },
      { role: 'user' as const, content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'file body' }] },
    ];
    annotateToolNames(messages);
    const out = translateMessages(messages, '@ai-sdk/xai') as any[];
    expect(out[0]).toEqual({ role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'call_1', toolName: 'Read', input: { path: 'a' } }] });
    expect(out[1]).toEqual({ role: 'tool', content: [{ type: 'tool-result', toolCallId: 'call_1', toolName: 'Read', output: { type: 'text', value: 'file body' } }] });
  });

  it('decodes thought_signature into providerOptions for Google only', () => {
    const msg = [{ role: 'assistant' as const, content: [
      { type: 'thinking', thinking: 'hmm', signature: 'SIG' },
      { type: 'tool_use', id: 'call_1__ts__VFNJRw', name: 'Read', input: {} },
    ] }];
    const google = translateMessages(msg, '@ai-sdk/google') as any[];
    expect(google[0].content[0].providerOptions).toEqual({ google: { thoughtSignature: 'SIG' } });
    expect(google[0].content[1].providerOptions).toEqual({ google: { thoughtSignature: 'TSIG' } });
    // xAI: thinking is kept as a reasoning part; tool id suffix stripped
    const xai = translateMessages(msg, '@ai-sdk/xai') as any[];
    expect(xai[0].content).toHaveLength(2);
    expect(xai[0].content[0]).toEqual({ type: 'reasoning', text: 'hmm' });
    expect(xai[0].content[1]).toEqual({ type: 'tool-call', toolCallId: 'call_1', toolName: 'Read', input: {} });
  });

  it('round-trips OpenAI reasoningEncryptedContent via thinking.signature', () => {
    const msg = [{ role: 'assistant' as const, content: [
      { type: 'thinking', thinking: 'chain...', signature: 'enc_blob_abc' },
    ] }];
    const openai = translateMessages(msg, '@ai-sdk/openai') as any[];
    expect(openai[0].content[0]).toEqual({
      type: 'reasoning',
      text: 'chain...',
      providerOptions: { openai: { reasoningEncryptedContent: 'enc_blob_abc' } },
    });
  });

  it('drops empty OpenAI thinking blocks without encrypted content', () => {
    const msg = [{ role: 'assistant' as const, content: [
      { type: 'thinking', thinking: '', signature: '' },
      { type: 'text', text: 'hello' },
    ] }];
    const openai = translateMessages(msg, '@ai-sdk/openai') as any[];
    expect(openai[0].content).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('maps base64 image blocks to SDK image parts', () => {
    const out = translateMessages([
      { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGk=' } }] },
    ], '@ai-sdk/google') as any[];
    expect(out[0].content[0].type).toBe('image');
    expect(out[0].content[0].mediaType).toBe('image/png');
    expect(Buffer.isBuffer(out[0].content[0].image)).toBe(true);
  });

  it('logs via onDebug when a user turn has only unrecognized block types (would otherwise silently vanish)', () => {
    const onDebug = vi.fn();
    const out = translateMessages([
      { role: 'user', content: [{ type: 'redacted_thinking' } as any] },
    ], '@ai-sdk/xai', onDebug);
    expect(out).toEqual([]);
    expect(onDebug).toHaveBeenCalledWith(
      expect.stringContaining('dropped user turn with unrecognized block types'),
    );
    expect(onDebug).toHaveBeenCalledWith(expect.stringContaining('redacted_thinking'));
  });

  it('does not log when a user turn has real content or tool results', () => {
    const onDebug = vi.fn();
    translateMessages([{ role: 'user', content: 'hello' }], '@ai-sdk/xai', onDebug);
    translateMessages([
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'ok' }] },
    ], '@ai-sdk/xai', onDebug);
    expect(onDebug).not.toHaveBeenCalled();
  });

  it('appends a continuation nudge for qwen/alibaba when the request ends on a tool result', () => {
    const messages = [
      { role: 'assistant' as const, content: [{ type: 'tool_use', id: 'call_1', name: 'Read', input: {} }] },
      { role: 'user' as const, content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'file body' }] },
    ];
    annotateToolNames(messages);
    const out = translateMessages(messages, '@ai-sdk/alibaba') as any[];
    expect(out).toHaveLength(3);
    expect(out[1].role).toBe('tool');
    expect(out[2]).toEqual({ role: 'user', content: [{ type: 'text', text: 'Continue.' }] });
  });

  it('does NOT append the nudge for non-alibaba providers ending on a tool result', () => {
    const messages = [
      { role: 'assistant' as const, content: [{ type: 'tool_use', id: 'call_1', name: 'Read', input: {} }] },
      { role: 'user' as const, content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'file body' }] },
    ];
    annotateToolNames(messages);
    const out = translateMessages(messages, '@ai-sdk/xai') as any[];
    expect(out).toHaveLength(2);
    expect(out[out.length - 1].role).toBe('tool');
  });

  it('does NOT append the nudge for alibaba when the conversation ends on a normal turn', () => {
    const out = translateMessages([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
    ], '@ai-sdk/alibaba') as any[];
    expect(out).toHaveLength(2);
    expect(out[out.length - 1].role).toBe('assistant');
  });
});

describe('translateRequest', () => {
  it('assembles SDK params and adds Google thinking options', () => {
    const params = translateRequest({
      model: 'gemini-3-flash-preview',
      system: 'be brief',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 256,
      temperature: 0.5,
    }, '@ai-sdk/google');
    expect(params.system).toBe('be brief');
    expect(params.maxOutputTokens).toBe(256);
    expect(params.temperature).toBe(0.5);
    expect(params.providerOptions).toEqual({ google: { thinkingConfig: { includeThoughts: true } } });
  });

  it('requests OpenAI encrypted reasoning for Responses API round-trip', () => {
    const params = translateRequest({
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'hi' }],
    }, '@ai-sdk/openai');
    expect(params.providerOptions).toEqual({
      openai: { store: false, include: ['reasoning.encrypted_content'] },
    });
  });

  it('sends instructions via providerOptions and omits system/max_tokens for OpenAI OAuth', () => {
    const params = translateRequest({
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 32000,
    }, '@ai-sdk/openai', { openAiOAuth: true });

    expect(params.system).toBeUndefined();
    expect(params.providerOptions?.openai?.instructions).toBe('You are a coding assistant.');
    expect(params.maxOutputTokens).toBeUndefined();
  });

  it('maps output_config.effort to Google thinking budget without dropping includeThoughts', () => {
    const params = translateRequest({
      model: 'gemini-2.5-pro',
      output_config: { effort: 'high' },
      messages: [{ role: 'user', content: 'hi' }],
    }, '@ai-sdk/google');
    expect(params.providerOptions?.google?.thinkingConfig).toMatchObject({
      includeThoughts: true,
      thinkingBudget: 8192,
    });
  });

  it('maps output_config.effort to OpenAI reasoningEffort without dropping store/include', () => {
    const params = translateRequest({
      model: 'gpt-5.5',
      output_config: { effort: 'high' },
      messages: [{ role: 'user', content: 'hi' }],
    }, '@ai-sdk/openai');
    expect(params.providerOptions?.openai).toMatchObject({
      store: false,
      include: ['reasoning.encrypted_content'],
      reasoningEffort: 'high',
    });
  });

  it('maps output_config.effort to OpenRouter reasoning when provider metadata allows it', () => {
    const params = translateRequest({
      model: 'z-ai/glm-5.2',
      output_config: { effort: 'high' },
      messages: [{ role: 'user', content: 'hi' }],
    }, '@openrouter/ai-sdk-provider', {
      reasoningMetadata: {
        providerId: 'openrouter',
        supportedParameters: ['reasoning'],
      },
    });
    expect(params.providerOptions?.openrouter).toEqual({
      reasoning: {
        effort: 'high',
        exclude: false,
      },
    });
  });

  it('uses defaultEffort when the client omits output_config.effort', () => {
    const params = translateRequest({
      model: 'gemini-2.5-pro',
      messages: [{ role: 'user', content: 'hi' }],
    }, '@ai-sdk/google', { defaultEffort: 'medium' });
    expect(params.providerOptions?.google?.thinkingConfig).toMatchObject({
      thinkingBudget: 4096,
    });
  });

  it('applies reasoning effort using reasoningMetadata.upstreamModelId, not the gateway-aliased body.model', () => {
    const params = translateRequest({
      model: 'anthropic-xai__grok-4.3',
      output_config: { effort: 'high' },
      messages: [{ role: 'user', content: 'hi' }],
    }, '@ai-sdk/xai', { reasoningMetadata: { upstreamModelId: 'grok-4.3' } });
    expect(params.providerOptions?.xai).toMatchObject({ reasoningEffort: 'high' });
  });

  it('does not apply reasoning effort when only the gateway-aliased model id is available (regression guard)', () => {
    const params = translateRequest({
      model: 'anthropic-xai__grok-4.3',
      output_config: { effort: 'high' },
      messages: [{ role: 'user', content: 'hi' }],
    }, '@ai-sdk/xai');
    expect(params.providerOptions?.xai).toBeUndefined();
  });

  it('reads effort from output_config via anthropicEffortFromRequest', () => {
    expect(anthropicEffortFromRequest({ model: 'm', messages: [], output_config: { effort: 'high' } })).toBe('high');
    expect(anthropicEffortFromRequest({ model: 'm', messages: [] })).toBeUndefined();
  });

  it('maps output_config.effort to DeepSeek reasoning_effort via openai-compatible', () => {
    const params = translateRequest({
      model: 'deepseek-v4-flash',
      output_config: { effort: 'max' },
      messages: [{ role: 'user', content: 'hi' }],
    }, '@ai-sdk/openai-compatible');
    expect(params.providerOptions?.openaiCompatible).toMatchObject({ reasoningEffort: 'max' });
    expect(params.providerOptions?.deepseek).toMatchObject({ thinking: { type: 'enabled' } });
  });
  it('flattens array system prompts', () => {
    const params = translateRequest({
      model: 'grok-4.3', system: [{ text: 'a' }, { text: 'b' }], messages: [],
    }, '@ai-sdk/xai');
    expect(params.system).toBe('a\nb');
  });

  it('folds inline role:system messages into the system prompt (skills list)', () => {
    const params = translateRequest({
      model: 'grok-4.3',
      system: 'base prompt',
      messages: [
        { role: 'user', content: 'hi' },
        // Claude Code injects the skills list / system-reminders as a system message
        { role: 'system', content: '<system-reminder>available skills: nlm-skill</system-reminder>' } as any,
      ],
    }, '@ai-sdk/xai');
    expect(params.system).toContain('base prompt');
    expect(params.system).toContain('nlm-skill');
    // the system message must NOT survive as a regular message
    expect(params.messages).toHaveLength(1);
    expect((params.messages[0] as any).role).toBe('user');
  });

  it('still produces system text when there is no top-level system, only inline', () => {
    const params = translateRequest({
      model: 'grok-4.3',
      messages: [{ role: 'system', content: 'only inline context' } as any],
    }, '@ai-sdk/xai');
    expect(params.system).toBe('only inline context');
  });

  it('omits defer_loading tools until referenced in messages', () => {
    const params = translateRequest({
      model: 'grok-4.3',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [
        { name: 'Read', input_schema: { type: 'object' } },
        { name: 'McpTool', input_schema: { type: 'object' }, defer_loading: true },
      ],
    }, '@ai-sdk/xai');
    expect(params.tools && Object.keys(params.tools)).toEqual(['Read']);
  });

  it('augments a retained Claude Agent schema and carries request-scoped routing metadata', () => {
    const source = claudeAgentTool();
    const original = structuredClone(source);
    const params = translateRequest({
      model: subagentRouting.parentModelId,
      messages: [{ role: 'user', content: 'delegate' }],
      tools: [source],
    }, '@ai-sdk/xai', { subagentRouting } as any);
    const translated = (params.tools!.Agent as any).inputSchema.jsonSchema;

    expect(translated.properties.model.enum).toContain('anthropic-relay__grok-4');
    expect((params.tools!.Agent as any).description).toContain(`default: ${subagentRouting.parentModelId}`);
    expect((params as any).subagentRouting).toBe(subagentRouting);
    expect(source).toEqual(original);
  });

  it('does not enable normalization for an unrelated name-only Agent tool', () => {
    const params = translateRequest({
      model: subagentRouting.parentModelId,
      messages: [{ role: 'user', content: 'delegate' }],
      tools: [{
        name: 'Agent',
        description: 'Application agent',
        input_schema: { type: 'object', properties: { prompt: { type: 'string' } } },
      }],
    }, '@ai-sdk/xai', { subagentRouting } as any);

    expect((params as any).subagentRouting).toBeUndefined();
    expect((params.tools!.Agent as any).description).toBe('Application agent');
  });

  it('detects Agent only after provider maxTools truncation', () => {
    const params = translateRequest({
      model: subagentRouting.parentModelId,
      messages: [{ role: 'user', content: 'delegate' }],
      tools: [
        { name: 'Read', input_schema: { type: 'object', properties: {} } },
        claudeAgentTool(),
      ],
    }, '@ai-sdk/xai', { subagentRouting, maxTools: 1 } as any);

    expect(Object.keys(params.tools!)).toEqual(['Read']);
    expect((params as any).subagentRouting).toBeUndefined();
  });

  it('keeps large-catalog Agent guidance bounded', () => {
    const largeRouting: SubagentModelRouting = {
      parentModelId: 'model-0',
      models: Array.from({ length: MAX_MODEL_CATALOG + 1 }, (_, index) => ({
        id: `model-${index}`,
        compatibilityIds: [],
        displayName: `Model ${index}`,
      })),
    };
    const params = translateRequest({
      model: largeRouting.parentModelId,
      messages: [{ role: 'user', content: 'delegate' }],
      tools: [claudeAgentTool()],
    }, '@ai-sdk/xai', { subagentRouting: largeRouting } as any);
    const translatedTool = params.tools!.Agent as any;

    expect(translatedTool.inputSchema.jsonSchema.properties.model.enum).toBeUndefined();
    expect(translatedTool.description).toContain('default: model-0');
    expect(translatedTool.description).not.toContain('model-20');
  });
});

describe('generateAnthropicResponse', () => {
  it('encodes non-streaming tool-call provider signatures for Gemini round-trip', async () => {
    vi.resetModules();
    vi.doMock('ai', () => ({
      generateText: vi.fn(async () => ({
        text: '',
        toolCalls: [{
          toolCallId: 'call_1',
          toolName: 'Read',
          input: { path: 'a' },
          providerMetadata: { google: { thoughtSignature: 'SIG' } },
        }],
        finishReason: 'tool-calls',
        usage: { inputTokens: 1, outputTokens: 2 },
      })),
      streamText: vi.fn(),
      tool: vi.fn((spec: unknown) => spec),
      jsonSchema: vi.fn((schema: unknown) => schema),
    }));

    const { generateAnthropicResponse } = await import('../src/sdk-adapter.js');
    const body = await generateAnthropicResponse({} as never, { messages: [] }, 'gemini-2.5-pro');
    const toolUse = (body.content as any[]).find(item => item.type === 'tool_use');
    expect(toolUse.id).toBe('call_1__ts__U0lH');

    vi.doUnmock('ai');
    vi.resetModules();
  });

  it('forceStream collects a real stream into one response instead of calling generateText', async () => {
    vi.resetModules();
    const generateText = vi.fn();
    vi.doMock('ai', () => ({
      generateText,
      streamText: vi.fn(() => ({
        text: Promise.resolve('hello'),
        toolCalls: Promise.resolve([]),
        toolResults: Promise.resolve([]),
        finishReason: Promise.resolve('stop'),
        usage: Promise.resolve({ inputTokens: 3, outputTokens: 4 }),
      })),
      tool: vi.fn((spec: unknown) => spec),
      jsonSchema: vi.fn((schema: unknown) => schema),
    }));

    const { generateAnthropicResponse } = await import('../src/sdk-adapter.js');
    const body = await generateAnthropicResponse({} as never, { messages: [] }, 'gpt-5.6-sol', { forceStream: true });

    expect(generateText).not.toHaveBeenCalled();
    expect((body.content as any[])[0]).toEqual({ type: 'text', text: 'hello' });
    expect(body.usage).toEqual({ input_tokens: 3, output_tokens: 4 });

    vi.doUnmock('ai');
    vi.resetModules();
  });
});

// ── streaming translation ────────────────────────────────────────────────────
async function collect(parts: any[], model = 'm'): Promise<{ events: Array<{ event: string; data: any }>; raw: string }> {
  let raw = '';
  async function* gen() { for (const p of parts) yield p; }
  await writeAnthropicStream(gen() as any, model, (c) => { raw += c; });
  const events = raw.split('\n\n').filter(Boolean).map(block => {
    const [evLine, dataLine] = block.split('\n');
    return { event: evLine.replace('event: ', ''), data: JSON.parse(dataLine.replace('data: ', '')) };
  });
  return { events, raw };
}

describe('writeAnthropicStream', () => {
  it('emits a well-formed text turn', async () => {
    const { events } = await collect([
      { type: 'start' },
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', text: 'Hello' },
      { type: 'text-delta', id: 't1', text: ' world' },
      { type: 'text-end', id: 't1' },
      { type: 'finish', finishReason: 'stop', totalUsage: { inputTokens: 5, outputTokens: 2 } },
    ]);
    const types = events.map(e => e.event);
    expect(types).toEqual([
      'message_start', 'content_block_start', 'content_block_delta', 'content_block_delta',
      'content_block_stop', 'message_delta', 'message_stop',
    ]);
    const delta = events.find(e => e.event === 'message_delta')!;
    expect(delta.data.delta.stop_reason).toBe('end_turn');
    expect(delta.data.usage).toEqual({ input_tokens: 5, output_tokens: 2 });
  });

  it('maps a mid-stream 401 to a non-retryable authentication_error instead of a generic api_error', async () => {
    const { events } = await collect([
      { type: 'start' },
      { type: 'error', error: { statusCode: 401, message: 'Unauthorized' } },
    ]);
    const errorEvent = events.find(e => e.event === 'error')!;
    expect(errorEvent.data.error).toEqual({ type: 'authentication_error', message: 'Unauthorized' });
  });

  it('falls back to a generic api_error for an unrecognized upstream failure', async () => {
    const { events } = await collect([
      { type: 'start' },
      { type: 'error', error: { message: 'Something went wrong' } },
    ]);
    const errorEvent = events.find(e => e.event === 'error')!;
    expect(errorEvent.data.error).toEqual({ type: 'api_error', message: 'Something went wrong' });
  });

  it('encodes thought_signature into the tool_use id and reports tool_use stop', async () => {
    const { events } = await collect([
      { type: 'start' },
      { type: 'tool-input-start', id: 'call_9', toolName: 'Read', providerMetadata: { google: { thoughtSignature: 'SIG9' } } },
      { type: 'tool-input-delta', id: 'call_9', delta: '{"path":"x"}' },
      { type: 'tool-input-end', id: 'call_9' },
      { type: 'tool-call', toolCallId: 'call_9', toolName: 'Read', input: { path: 'x' } },
      { type: 'finish', finishReason: 'tool-calls' },
    ]);
    const start = events.find(e => e.event === 'content_block_start')!;
    expect(start.data.content_block.type).toBe('tool_use');
    expect(start.data.content_block.id).toBe('call_9__ts__U0lHOQ');
    expect(events.find(e => e.event === 'message_delta')!.data.delta.stop_reason).toBe('tool_use');
  });

  it('emits thinking block with a signature_delta close (Google SDK)', async () => {
    const { events } = await collect([
      { type: 'start' },
      { type: 'reasoning-start', id: 'r1' },
      { type: 'reasoning-delta', id: 'r1', text: 'thinking...' },
      { type: 'reasoning-end', id: 'r1', providerMetadata: { google: { thoughtSignature: 'RSIG' } } },
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', text: 'done' },
      { type: 'finish', finishReason: 'stop' },
    ]);
    const thinkStart = events.find(e => e.event === 'content_block_start')!;
    expect(thinkStart.data.content_block.type).toBe('thinking');
    const sigDelta = events.find(e => e.event === 'content_block_delta' && e.data.delta.type === 'signature_delta')!;
    expect(sigDelta.data.delta.signature).toBe('RSIG');
  });

  it('emits thinking block with OpenAI reasoningEncryptedContent in signature_delta', async () => {
    const { events } = await collect([
      { type: 'start' },
      { type: 'reasoning-start', id: 'r1' },
      { type: 'reasoning-delta', id: 'r1', text: 'thinking...' },
      { type: 'reasoning-end', id: 'r1', providerMetadata: { openai: { reasoningEncryptedContent: 'enc_xyz' } } },
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', text: 'done' },
      { type: 'finish', finishReason: 'stop' },
    ]);
    const sigDelta = events.find(e => e.event === 'content_block_delta' && e.data.delta.type === 'signature_delta')!;
    expect(sigDelta.data.delta.signature).toBe('enc_xyz');
  });
});
