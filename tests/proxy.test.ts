// tests/proxy.test.ts
import { describe, it, expect } from 'vitest';
import {
  translateRequest,
  translateResponse,
  extractCachedTokens,
  extractUncachedInputTokens,
  extractOutputTokens,
} from '../src/proxy.js';

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
