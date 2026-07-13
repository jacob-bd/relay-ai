// tests/gemini-proxy.test.ts
import { describe, it, expect } from 'vitest';
import { 
  translateGeminiRequest, 
  sanitizeModelSwitchTurns, 
  parseModelCommand 
} from '../src/gemini-proxy.js';

describe('translateGeminiRequest', () => {
  it('maps basic user and assistant turns', () => {
    const body = {
      contents: [
        { role: 'user', parts: [{ text: 'Hello' }] },
        { role: 'model', parts: [{ text: 'Hi there' }] },
        { role: 'user', parts: [{ text: 'How are you?' }] },
      ],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 256,
      },
    };

    const params = translateGeminiRequest(body);
    expect(params.instructions).toBeUndefined();
    expect(params.temperature).toBe(0.7);
    expect(params.maxOutputTokens).toBe(256);
    expect(params.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Hi there' }] },
      { role: 'user', content: [{ type: 'text', text: 'How are you?' }] },
    ]);
  });

  it('extracts system instructions', () => {
    const body = {
      systemInstruction: {
        parts: [{ text: 'You are a helpful assistant' }],
      },
      contents: [
        { role: 'user', parts: [{ text: 'Hi' }] },
      ],
    };

    const params = translateGeminiRequest(body);
    expect(params.instructions).toBe('You are a helpful assistant');
    expect(params.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Hi' }] },
    ]);
  });

  it('merges consecutive messages of the same role (especially user)', () => {
    const body = {
      contents: [
        { role: 'user', parts: [{ text: 'Message 1' }] },
        { role: 'user', parts: [{ text: 'Message 2' }] },
        { role: 'model', parts: [{ text: 'Response 1' }] },
        { role: 'model', parts: [{ text: 'Response 2' }] },
      ],
    };

    const params = translateGeminiRequest(body);
    expect(params.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Message 1' },
          { type: 'text', text: 'Message 2' },
        ],
      },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Response 1' },
          { type: 'text', text: 'Response 2' },
        ],
      },
    ]);
  });

  it('maps tool declarations', () => {
    const body = {
      contents: [{ role: 'user', parts: [{ text: 'Run tool' }] }],
      tools: [
        {
          functionDeclarations: [
            {
              name: 'getWeather',
              description: 'Get weather for city',
              parameters: {
                type: 'OBJECT',
                properties: {
                  city: { type: 'STRING' },
                },
                required: ['city'],
              },
            },
          ],
        },
      ],
    };

    const params = translateGeminiRequest(body);
    expect(params.tools).toBeDefined();
    expect(Object.keys(params.tools)).toEqual(['getWeather']);
    expect(params.tools.getWeather.description).toBe('Get weather for city');
  });

  it('limits Gemini function declarations when maxTools is set', () => {
    const body = {
      contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
      tools: [{
        functionDeclarations: Array.from({ length: 130 }, (_, i) => ({
          name: `tool_${i}`,
          parameters: { type: 'OBJECT' },
        })),
      }],
    };

    const params = translateGeminiRequest(body, { maxTools: 128 });

    expect(Object.keys(params.tools ?? {})).toHaveLength(128);
    expect(params.tools?.tool_127).toBeDefined();
    expect(params.tools?.tool_128).toBeUndefined();
  });

  it('translates function response to tool-result and groups consecutive tool turns', () => {
    const body = {
      contents: [
        {
          role: 'user',
          parts: [{ text: 'What is the weather?' }],
        },
        {
          role: 'model',
          parts: [
            {
              functionCall: {
                name: 'getWeather',
                args: { city: 'Paris' },
              },
            },
          ],
        },
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: 'getWeather',
                response: { temp: '22C' },
              },
            },
          ],
        },
      ],
    };

    const params = translateGeminiRequest(body);
    
    // We expect 3 messages: user prompt, assistant tool-call, and tool result
    expect(params.messages).toHaveLength(3);
    
    expect(params.messages[0]).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'What is the weather?' }],
    });

    expect(params.messages[1].role).toBe('assistant');
    expect(params.messages[1].content[0].type).toBe('tool-call');
    expect(params.messages[1].content[0].toolName).toBe('getWeather');
    expect(params.messages[1].content[0].input).toEqual({ city: 'Paris' });
    const toolCallId = params.messages[1].content[0].toolCallId;
    expect(toolCallId).toBeDefined();

    expect(params.messages[2]).toEqual({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId,
          toolName: 'getWeather',
          output: {
            type: 'text',
            value: '{"temp":"22C"}',
          },
        },
      ],
    });
  });

  it('supports JSON response format configuration', () => {
    const body = {
      contents: [{ role: 'user', parts: [{ text: 'Give JSON' }] }],
      generationConfig: {
        responseMimeType: 'application/json',
      },
    };

    const params = translateGeminiRequest(body);
    expect(params.responseFormat).toEqual({ type: 'json' });
  });
});

describe('sanitizeModelSwitchTurns', () => {
  it('removes .model commands and paired mock responses', () => {
    const history = [
      { role: 'user', parts: [{ text: 'Normal prompt' }] },
      { role: 'model', parts: [{ text: 'Normal response' }] },
      { role: 'user', parts: [{ text: '.model claude-3-sonnet' }] },
      { role: 'model', parts: [{ text: '✅ Switched model to...' }] },
      { role: 'user', parts: [{ text: 'Another prompt' }] }
    ];

    const cleaned = sanitizeModelSwitchTurns(history);
    expect(cleaned).toEqual([
      { role: 'user', parts: [{ text: 'Normal prompt' }] },
      { role: 'model', parts: [{ text: 'Normal response' }] },
      { role: 'user', parts: [{ text: 'Another prompt' }] }
    ]);
  });

  it('handles consecutive .model commands correctly', () => {
    const history = [
      { role: 'user', parts: [{ text: '.model abc' }] },
      { role: 'model', parts: [{ text: '✅ Switched to abc' }] },
      { role: 'user', parts: [{ text: '.model xyz' }] },
      { role: 'model', parts: [{ text: '✅ Switched to xyz' }] },
      { role: 'user', parts: [{ text: 'Real prompt' }] }
    ];

    const cleaned = sanitizeModelSwitchTurns(history);
    expect(cleaned).toEqual([
      { role: 'user', parts: [{ text: 'Real prompt' }] }
    ]);
  });

  it('preserves history without .model commands', () => {
    const history = [
      { role: 'user', parts: [{ text: 'Hello' }] },
      { role: 'model', parts: [{ text: 'Hi' }] }
    ];
    const cleaned = sanitizeModelSwitchTurns(history);
    expect(cleaned).toEqual(history);
  });
});

describe('parseModelCommand', () => {
  it('returns model ID for valid commands', () => {
    expect(parseModelCommand({ role: 'user', parts: [{ text: '.model deepseek' }] })).toBe('deepseek');
    expect(parseModelCommand({ role: 'user', parts: [{ text: '  .model    deepseek-v4  ' }] })).toBe('deepseek-v4');
  });

  it('returns empty string for bare .model', () => {
    expect(parseModelCommand({ role: 'user', parts: [{ text: '.model' }] })).toBe('');
    expect(parseModelCommand({ role: 'user', parts: [{ text: ' .model ' }] })).toBe('');
  });

  it('returns null for non-commands', () => {
    expect(parseModelCommand({ role: 'user', parts: [{ text: 'hello' }] })).toBeNull();
    expect(parseModelCommand({ role: 'user', parts: [{ text: 'I want to .model it' }] })).toBeNull();
    expect(parseModelCommand({ role: 'user', parts: [{ text: '.modelfoo' }] })).toBeNull();
    expect(parseModelCommand({ role: 'model', parts: [{ text: '.model xyz' }] })).toBeNull();
  });
});
