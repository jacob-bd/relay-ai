import { describe, it, expect } from 'vitest';
import { isMistralUpstream, normalizeMistralMessages } from '../src/mistral-messages.js';
import { translateRequest } from '../src/proxy.js';

describe('isMistralUpstream', () => {
  it('detects direct Mistral API URL', () => {
    expect(isMistralUpstream('https://api.mistral.ai/v1/chat/completions', 'some-model')).toBe(true);
  });

  it('detects Mistral-family model IDs on OpenRouter', () => {
    expect(isMistralUpstream('https://openrouter.ai/api/v1/chat/completions', 'mistralai/ministral-8b')).toBe(true);
    expect(isMistralUpstream(undefined, 'ministral-8b-latest')).toBe(true);
  });

  it('does not match DeepSeek', () => {
    expect(isMistralUpstream('https://api.deepseek.com/chat/completions', 'deepseek-chat')).toBe(false);
  });
});

describe('normalizeMistralMessages', () => {
  it('hoists inline system after tool to the front', () => {
    const input = [
      { role: 'system', content: 'Base prompt' },
      { role: 'user', content: 'hey' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'Bash', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: 'nlm version 0.7.1' },
      { role: 'system', content: 'Skill instructions injected mid-turn' },
      { role: 'user', content: 'continue' },
    ];

    const { messages, hoistedSystemBlocks, insertedAssistantFillers } = normalizeMistralMessages(input);

    expect(hoistedSystemBlocks).toBe(2);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('Base prompt');
    expect(messages[0].content).toContain('Skill instructions injected mid-turn');
    expect(messages.slice(1).some(m => m.role === 'system')).toBe(false);

    const toolIdx = messages.findIndex(m => m.role === 'tool');
    expect(messages[toolIdx + 1].role).toBe('assistant');
    expect(messages[toolIdx + 2].role).toBe('user');
    expect(insertedAssistantFillers).toBe(1);
  });

  it('inserts assistant filler between tool and user only when needed', () => {
    const input = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'Bash', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: 'ok' },
      { role: 'user', content: 'next' },
    ];

    const { messages, insertedAssistantFillers } = normalizeMistralMessages(input);
    expect(insertedAssistantFillers).toBe(1);
    expect(messages.map(m => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant', 'user']);
  });
});

describe('translateRequest Mistral integration', () => {
  it('collects inline system messages and normalizes for Mistral upstream', () => {
    const result = translateRequest(
      {
        model: 'ministral-8b-latest',
        system: 'Top-level system',
        messages: [
          { role: 'user', content: 'use skill' },
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'call_1', name: 'Skill', input: { skill: 'nlm-skill' } }],
          },
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'loaded' }] },
          { role: 'system', content: 'Skill tool injected system block' },
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'call_2', name: 'Bash', input: { command: 'nlm --version' } }],
          },
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_2', content: '0.7.1' }] },
        ],
      },
      { completionsUrl: 'https://api.mistral.ai/v1/chat/completions' },
    );

    const msgs = result.messages as Array<{ role: string; content?: string }>;
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain('Top-level system');
    expect(msgs[0].content).toContain('Skill tool injected system block');

    const toolIdx = msgs.findIndex(m => m.role === 'tool');
    expect(toolIdx).toBeGreaterThan(-1);
    for (let i = toolIdx + 1; i < msgs.length; i++) {
      expect(msgs[i].role).not.toBe('system');
    }
  });

  it('does not normalize for DeepSeek upstream', () => {
    const body = {
      model: 'deepseek-chat',
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'system', content: 'inline system' },
      ],
    };
    const opts = { completionsUrl: 'https://api.deepseek.com/chat/completions' };
    const result = translateRequest(body, opts);
    expect(opts.mistralNormalize).toBeUndefined();
    const msgs = result.messages as Array<{ role: string }>;
    expect(msgs.filter(m => m.role === 'system').length).toBe(1);
    expect(msgs[0].content).toContain('inline system');
  });
});
