import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import {
  isOpenAIChatCompletionsUrl,
  modelPrefersResponsesApi,
  openAIResponsesUrl,
  translateFromResponses,
  translateStreamResponses,
  translateToResponses,
} from '../src/proxy-responses.js';

describe('modelPrefersResponsesApi', () => {
  it('detects GPT-5.4 variants', () => {
    expect(modelPrefersResponsesApi('gpt-5.4-fast')).toBe(true);
    expect(modelPrefersResponsesApi('gpt-5.4-pro')).toBe(true);
    expect(modelPrefersResponsesApi('gpt-5.4-2026-03-05')).toBe(true);
  });

  it('detects Codex and o-series', () => {
    expect(modelPrefersResponsesApi('gpt-5-codex')).toBe(true);
    expect(modelPrefersResponsesApi('gpt-5.3-codex')).toBe(true);
    expect(modelPrefersResponsesApi('o3-mini')).toBe(true);
    expect(modelPrefersResponsesApi('o4-mini')).toBe(true);
  });

  it('detects GPT-5.5 family', () => {
    expect(modelPrefersResponsesApi('gpt-5.5-fast')).toBe(true);
    expect(modelPrefersResponsesApi('gpt-5.5')).toBe(true);
  });

  it('does not route chat-completions models', () => {
    expect(modelPrefersResponsesApi('gpt-4o')).toBe(false);
    expect(modelPrefersResponsesApi('gpt-4o-mini')).toBe(false);
    expect(modelPrefersResponsesApi('gpt-5')).toBe(false);
  });
});

describe('openAIResponsesUrl', () => {
  it('derives responses URL from chat completions URL', () => {
    expect(openAIResponsesUrl('https://api.openai.com/v1/chat/completions')).toBe(
      'https://api.openai.com/v1/responses',
    );
  });

  it('detects OpenAI chat completions URLs', () => {
    expect(isOpenAIChatCompletionsUrl('https://api.openai.com/v1/chat/completions')).toBe(true);
    expect(isOpenAIChatCompletionsUrl('https://api.x.ai/v1/chat/completions')).toBe(false);
  });
});

describe('translateToResponses', () => {
  it('maps system to instructions and user to input', () => {
    const body = translateToResponses({
      model: 'gpt-5.4-fast',
      system: 'You are helpful.',
      messages: [{ role: 'user', content: 'Yo!' }],
      max_tokens: 1024,
      stream: true,
    });

    expect(body.instructions).toBe('You are helpful.');
    expect(body.input).toEqual([{ role: 'user', content: 'Yo!' }]);
    expect(body.max_output_tokens).toBe(1024);
    expect(body.stream).toBe(true);
  });

  it('maps tool history to function_call and function_call_output items', () => {
    const body = translateToResponses({
      model: 'gpt-5.4-fast',
      messages: [
        { role: 'user', content: 'run ls' },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'call_abc', name: 'Bash', input: { command: 'ls' } }],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'call_abc', content: 'file.txt' }],
        },
      ],
      tools: [{ name: 'Bash', input_schema: { type: 'object', properties: {} } }],
    });

    const input = body.input as Array<Record<string, unknown>>;
    expect(input.some(i => i.type === 'function_call' && i.call_id === 'call_abc')).toBe(true);
    expect(input.some(i => i.type === 'function_call_output' && i.call_id === 'call_abc')).toBe(true);
    expect((body.tools as Array<{ name: string }>)[0].name).toBe('Bash');
  });
});

describe('translateFromResponses', () => {
  it('maps output_text and function_call to Anthropic blocks', () => {
    const result = translateFromResponses({
      status: 'completed',
      output_text: 'Hey there!',
      output: [
        {
          type: 'function_call',
          call_id: 'call_1',
          name: 'Bash',
          arguments: '{"command":"pwd"}',
        },
      ],
      usage: { input_tokens: 10, output_tokens: 5 },
    }, 'gpt-5.4-fast');

    expect(result.content[0]).toEqual({ type: 'text', text: 'Hey there!' });
    expect(result.content[1]).toMatchObject({
      type: 'tool_use',
      id: 'call_1',
      name: 'Bash',
      input: { command: 'pwd' },
    });
    expect(result.stop_reason).toBe('tool_use');
    expect(result.usage.input_tokens).toBe(10);
  });
});

async function collectStreamEvents(chunks: object[]): Promise<object[]> {
  const lines = chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('');
  const upstream = Readable.from([Buffer.from(lines)]);
  const out = translateStreamResponses(upstream, 'gpt-5.4-fast');
  const events: object[] = [];
  return new Promise((resolve, reject) => {
    let buf = '';
    out.on('data', (chunk: Buffer) => { buf += chunk.toString(); });
    out.on('end', () => {
      for (const line of buf.split('\n')) {
        if (line.startsWith('data: ')) {
          try { events.push(JSON.parse(line.slice(6))); } catch { /* skip */ }
        }
      }
      resolve(events);
    });
    out.on('error', reject);
  });
}

describe('translateStreamResponses', () => {
  it('emits message_start, text deltas, and message_stop', async () => {
    const events = await collectStreamEvents([
      { type: 'response.output_text.delta', delta: 'Hey' },
      { type: 'response.output_text.delta', delta: '!' },
      {
        type: 'response.completed',
        response: {
          status: 'completed',
          usage: { input_tokens: 3, output_tokens: 2 },
          output: [],
        },
      },
    ]);

    expect(events.some(e => (e as any).type === 'message_start')).toBe(true);
    expect(events.filter(e => (e as any).type === 'content_block_delta').length).toBe(2);
    expect(events.some(e => (e as any).type === 'message_stop')).toBe(true);
  });

  it('streams function_call arguments', async () => {
    const events = await collectStreamEvents([
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'function_call', call_id: 'call_9', name: 'Bash' },
      },
      { type: 'response.function_call_arguments.delta', output_index: 0, delta: '{"command":' },
      { type: 'response.function_call_arguments.delta', output_index: 0, delta: '"ls"}' },
      {
        type: 'response.completed',
        response: {
          status: 'completed',
          usage: { input_tokens: 1, output_tokens: 1 },
          output: [{ type: 'function_call', call_id: 'call_9', name: 'Bash' }],
        },
      },
    ]);

    expect(events.some(e => (e as any).content_block?.type === 'tool_use')).toBe(true);
    expect(events.some(e => (e as any).delta?.type === 'input_json_delta')).toBe(true);
  });
});
