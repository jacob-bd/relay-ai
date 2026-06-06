// tests/proxy.test.ts
import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import {
  translateRequest,
  translateResponse,
  translateStream,
  extractCachedTokens,
  extractUncachedInputTokens,
  extractOutputTokens,
} from '../src/proxy.js';

// Helper: run translateStream on a sequence of SSE chunks and collect all emitted SSE events
async function runStream(chunks: object[]): Promise<object[]> {
  const lines = chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
  const upstream = Readable.from([Buffer.from(lines)]);
  const out = translateStream(upstream, 'test-model');
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

describe('translateRequest', () => {
  it('converts system string to system message', () => {
    const result = translateRequest({
      model: 'deepseek-v4-flash',
      messages: [{ role: 'user', content: 'hi' }],
      system: 'You are helpful.',
    });
    expect(result.messages[0]).toEqual({ role: 'system', content: 'You are helpful.' });
  });

  it('converts system array to system messages', () => {
    const result = translateRequest({
      model: 'test',
      messages: [],
      system: [{ text: 'Part one' }, { text: 'Part two' }],
    });
    expect(result.messages).toEqual([
      { role: 'system', content: 'Part one' },
      { role: 'system', content: 'Part two' },
    ]);
  });

  it('converts user text messages', () => {
    const result = translateRequest({
      model: 'test',
      messages: [{ role: 'user', content: 'Hello' }],
    });
    expect(result.messages).toEqual([{ role: 'user', content: 'Hello' }]);
  });

  it('converts user content array with text', () => {
    const result = translateRequest({
      model: 'test',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
    });
    expect(result.messages).toEqual([{ role: 'user', content: 'Hello' }]);
  });

  it('converts tool_result to tool messages', () => {
    const result = translateRequest({
      model: 'test',
      messages: [{
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'result text' }],
      }],
    });
    expect(result.messages).toEqual([
      { role: 'tool', tool_call_id: 'call_1', content: 'result text' },
    ]);
  });

  it('converts assistant tool_use to tool_calls', () => {
    const result = translateRequest({
      model: 'test',
      messages: [{
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'call_1',
          name: 'read_file',
          input: { path: '/tmp/test' },
        }],
      }],
    });
    expect(result.messages[0].tool_calls).toEqual([{
      id: 'call_1',
      type: 'function',
      function: { name: 'read_file', arguments: '{"path":"/tmp/test"}' },
    }]);
  });

  it('decodes thought_signature from encoded tool_use id into tool_call', () => {
    const result = translateRequest({
      model: 'gemini-2.5-flash',
      messages: [{
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'call_gemini_1::ts::abc123sigXYZ',
          name: 'search',
          input: { query: 'test' },
        }],
      }],
    });
    const toolCall = result.messages[0].tool_calls[0];
    expect(toolCall.id).toBe('call_gemini_1');
    expect(toolCall.thought_signature).toBe('abc123sigXYZ');
    expect(toolCall.function.name).toBe('search');
  });

  it('strips thought_signature from tool_call_id in tool_result messages', () => {
    const result = translateRequest({
      model: 'gemini-2.5-flash',
      messages: [{
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'call_gemini_1::ts::abc123sigXYZ',
          content: 'search results',
        }],
      }],
    });
    expect(result.messages[0].tool_call_id).toBe('call_gemini_1');
  });

  it('converts assistant thinking to reasoning_content', () => {
    const result = translateRequest({
      model: 'test',
      messages: [{
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Let me think...' },
          { type: 'text', text: 'The answer is 42.' },
        ],
      }],
    });
    expect(result.messages[0].reasoning_content).toBe('Let me think...');
    expect(result.messages[0].content).toBe('The answer is 42.');
  });

  it('converts tools with input_schema to function parameters', () => {
    const result = translateRequest({
      model: 'test',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{
        name: 'read_file',
        description: 'Read a file',
        input_schema: { type: 'object', properties: { path: { type: 'string' } } },
      }],
    });
    expect(result.tools).toEqual([{
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read a file',
        parameters: { type: 'object', properties: { path: { type: 'string' } } },
      },
    }]);
  });

  it('sets stream_options when stream is true', () => {
    const result = translateRequest({
      model: 'test', messages: [], stream: true,
    });
    expect(result.stream).toBe(true);
    expect(result.stream_options).toEqual({ include_usage: true });
  });

  it('passes through max_tokens, temperature, top_p', () => {
    const result = translateRequest({
      model: 'test', messages: [],
      max_tokens: 1024, temperature: 0.7, top_p: 0.9,
    });
    expect(result.max_tokens).toBe(1024);
    expect(result.temperature).toBe(0.7);
    expect(result.top_p).toBe(0.9);
  });

  it('converts stop_sequences to stop', () => {
    const result = translateRequest({
      model: 'test', messages: [], stop_sequences: ['\n\n'],
    });
    expect(result.stop).toEqual(['\n\n']);
  });

  it('does not inject prompt_cache_key (non-standard field rejected by most providers)', () => {
    const result = translateRequest({
      model: 'test', messages: [], system: 'You are helpful.',
    });
    expect(result.prompt_cache_key).toBeUndefined();
  });

  it('converts base64 image to data URL', () => {
    const result = translateRequest({
      model: 'test',
      messages: [{
        role: 'user',
        content: [{
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: 'abc123' },
        }],
      }],
    });
    expect(result.messages[0].content[0]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,abc123' },
    });
  });
});

describe('translateResponse', () => {
  it('converts text content to text block', () => {
    const result = translateResponse({
      choices: [{ message: { content: 'Hello!' }, finish_reason: 'stop' }],
    }, 'test-model');
    expect(result.content).toEqual([{ text: 'Hello!', type: 'text' }]);
    expect(result.model).toBe('test-model');
  });

  it('converts reasoning_content to thinking block', () => {
    const result = translateResponse({
      choices: [{
        message: { reasoning_content: 'Thinking...', content: 'Answer.' },
        finish_reason: 'stop',
      }],
    }, 'test');
    expect(result.content[0]).toEqual({ type: 'thinking', thinking: 'Thinking...', signature: '' });
    expect(result.content[1]).toEqual({ text: 'Answer.', type: 'text' });
  });

  it('converts tool_calls to tool_use blocks', () => {
    const result = translateResponse({
      choices: [{
        message: {
          tool_calls: [{
            id: 'call_1',
            function: { name: 'read_file', arguments: '{"path":"/tmp"}' },
          }],
        },
        finish_reason: 'tool_calls',
      }],
    }, 'test');
    expect(result.content).toEqual([{
      type: 'tool_use', id: 'call_1', name: 'read_file', input: { path: '/tmp' },
    }]);
    expect(result.stop_reason).toBe('tool_use');
  });

  it('encodes thought_signature into tool_use id when present', () => {
    const result = translateResponse({
      choices: [{
        message: {
          tool_calls: [{
            id: 'call_gemini_1',
            thought_signature: 'abc123sigXYZ',
            function: { name: 'search', arguments: '{"query":"test"}' },
          }],
        },
        finish_reason: 'tool_calls',
      }],
    }, 'gemini-2.5-flash');
    expect(result.content[0].id).toBe('call_gemini_1::ts::abc123sigXYZ');
    expect(result.content[0].name).toBe('search');
    expect(result.content[0].input).toEqual({ query: 'test' });
  });

  it('does not modify tool_use id when thought_signature is absent', () => {
    const result = translateResponse({
      choices: [{
        message: {
          tool_calls: [{
            id: 'call_plain',
            function: { name: 'list_files', arguments: '{}' },
          }],
        },
        finish_reason: 'tool_calls',
      }],
    }, 'test');
    expect(result.content[0].id).toBe('call_plain');
  });

  it('maps finish_reason stop to end_turn', () => {
    const result = translateResponse({
      choices: [{ message: { content: 'x' }, finish_reason: 'stop' }],
    }, 'test');
    expect(result.stop_reason).toBe('end_turn');
  });

  it('maps finish_reason length to max_tokens', () => {
    const result = translateResponse({
      choices: [{ message: { content: 'x' }, finish_reason: 'length' }],
    }, 'test');
    expect(result.stop_reason).toBe('max_tokens');
  });

  it('extracts usage with cache tokens', () => {
    const result = translateResponse({
      choices: [{ message: { content: 'x' }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        prompt_tokens_details: { cached_tokens: 30 },
      },
    }, 'test');
    expect(result.usage).toEqual({
      input_tokens: 70,
      output_tokens: 50,
      cache_read_input_tokens: 30,
      cache_creation_input_tokens: 0,
    });
  });
});

describe('thought_signature round-trip', () => {
  it('translateResponse encodes signature, translateRequest re-injects it and strips from tool_call_id', () => {
    // Step 1: Gemini returns a tool_call with thought_signature
    const openaiCompletion = {
      choices: [{
        message: {
          tool_calls: [{
            id: 'gemini_call_42',
            thought_signature: 'sig_ABCDEF',
            function: { name: 'get_weather', arguments: '{"city":"London"}' },
          }],
        },
        finish_reason: 'tool_calls',
      }],
    };

    const anthropicResponse = translateResponse(openaiCompletion, 'gemini-2.5-flash');
    const toolUseBlock = anthropicResponse.content[0];

    // The id must encode the signature
    expect(toolUseBlock.id).toBe('gemini_call_42::ts::sig_ABCDEF');

    // Step 2: Claude Code echoes this back in the next request
    const anthropicRequest = {
      model: 'gemini-2.5-flash',
      messages: [
        {
          role: 'assistant',
          content: [toolUseBlock],
        },
        {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: toolUseBlock.id,
            content: 'Sunny, 22°C',
          }],
        },
      ],
    };

    const translated = translateRequest(anthropicRequest);

    // Assistant tool_call must have raw id + thought_signature re-injected
    const assistantMsg = translated.messages.find((m: any) => m.role === 'assistant');
    expect(assistantMsg.tool_calls[0].id).toBe('gemini_call_42');
    expect(assistantMsg.tool_calls[0].thought_signature).toBe('sig_ABCDEF');

    // Tool result message must have bare tool_call_id (no ::ts:: suffix)
    const toolMsg = translated.messages.find((m: any) => m.role === 'tool');
    expect(toolMsg.tool_call_id).toBe('gemini_call_42');
  });
});

describe('translateStream thought_signature', () => {
  it('encodes thought_signature when it arrives in the same chunk as the id', async () => {
    const events = await runStream([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', thought_signature: 'sig_XYZ', type: 'function', function: { name: 'bash', arguments: '' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"cmd":"ls"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ]);
    const start = events.find((e: any) => e.type === 'content_block_start') as any;
    expect(start?.content_block?.id).toBe('call_1::ts::sig_XYZ');
  });

  it('encodes thought_signature when it arrives in a later chunk (deferred start)', async () => {
    const events = await runStream([
      // id chunk has no thought_signature yet
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_2', type: 'function', function: { name: 'bash', arguments: '' } }] } }] },
      // thought_signature arrives separately
      { choices: [{ delta: { tool_calls: [{ index: 0, thought_signature: 'sig_late' }] } }] },
      // then arguments start
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"cmd":"pwd"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ]);
    const start = events.find((e: any) => e.type === 'content_block_start') as any;
    expect(start?.content_block?.id).toBe('call_2::ts::sig_late');
  });

  it('uses bare id when no thought_signature arrives at all', async () => {
    const events = await runStream([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_plain', type: 'function', function: { name: 'bash', arguments: '' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ]);
    const start = events.find((e: any) => e.type === 'content_block_start') as any;
    expect(start?.content_block?.id).toBe('call_plain');
  });
});

describe('token extraction', () => {
  it('extracts cached tokens from prompt_tokens_details', () => {
    expect(extractCachedTokens({ prompt_tokens_details: { cached_tokens: 42 } })).toBe(42);
  });

  it('extracts cached tokens from cache_read_input_tokens', () => {
    expect(extractCachedTokens({ cache_read_input_tokens: 10 })).toBe(10);
  });

  it('returns 0 when no cache info', () => {
    expect(extractCachedTokens({})).toBe(0);
  });

  it('subtracts cached from total for uncached input', () => {
    expect(extractUncachedInputTokens({
      prompt_tokens: 100,
      prompt_tokens_details: { cached_tokens: 30 },
    })).toBe(70);
  });

  it('extracts output tokens from completion_tokens', () => {
    expect(extractOutputTokens({ completion_tokens: 50 })).toBe(50);
  });

  it('extracts output tokens from output_tokens', () => {
    expect(extractOutputTokens({ output_tokens: 25 })).toBe(25);
  });
});
