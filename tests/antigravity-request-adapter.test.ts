import { describe, it, expect } from 'vitest';
import listResources from './fixtures/agy-list-resources.json';
import {
  summarizeSdkRequestForTrace,
  translateRequest,
  expandTextWithThinking,
  normalizeJsonSchema,
  type CloudCodeGenerateRequest,
  type SdkRequest,
} from '../src/antigravity/request-adapter.js';

describe('Antigravity request trace summary', () => {
  it('records tool-loop structure without logging message content, arguments, or results', () => {
    const request = {
      instructions: 'private system prompt',
      messages: [
        { role: 'user', content: 'private user prompt' },
        {
          role: 'assistant',
          content: [
            { type: 'reasoning', text: 'private reasoning' },
            {
              type: 'tool-call',
              toolCallId: 'call_123',
              toolName: 'list_dir',
              input: { DirectoryPath: 'C:\\private' },
            },
          ],
        },
        {
          role: 'tool',
          content: [{
            type: 'tool-result',
            toolCallId: 'call_123',
            toolName: 'list_dir',
            output: { type: 'text', value: 'private directory listing' },
          }],
        },
      ],
      tools: { list_dir: {} },
      toolChoice: 'auto',
    } as unknown as SdkRequest;

    const summary = summarizeSdkRequestForTrace(request);

    expect(summary).toEqual({
      systemChars: 21,
      messages: [
        { role: 'user', parts: [{ type: 'text', chars: 19 }] },
        {
          role: 'assistant',
          parts: [
            { type: 'reasoning', chars: 17 },
            { type: 'tool-call', toolName: 'list_dir', toolCallId: 'call_123' },
          ],
        },
        {
          role: 'tool',
          parts: [
            { type: 'tool-result', toolName: 'list_dir', toolCallId: 'call_123', chars: 25 },
          ],
        },
      ],
      toolNames: ['list_dir'],
      toolChoice: 'auto',
    });
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain('private');
    expect(serialized).not.toContain('DirectoryPath');
  });
});

describe('antigravity request-adapter', () => {
  it.each(['@ai-sdk/anthropic', '@ai-sdk/openai', '@ai-sdk/openai-compatible', '@ai-sdk/google'])(
    'converts the captured agy list_resources size limit for %s', npm => {
      const original = JSON.stringify(listResources);
      const result = translateRequest({ model: 'relay-model', request: {
        tools: [{ functionDeclarations: [listResources] }],
      } }, { npm });
      const schema = (result.tools!.list_resources!.inputSchema as any).jsonSchema;
      expect(schema.properties.ServerName).toEqual({
        ...listResources.parameters.properties.ServerName, type: 'string', minLength: 1,
      });
      expect(JSON.stringify(listResources)).toBe(original);
    },
  );

  it('converts size limits without changing literal data or schema property names', () => {
    const literal = { type: 'STRING', minLength: '1' };
    expect(normalizeJsonSchema({
      type: 'OBJECT', minProperties: '1', maxProperties: '20',
      properties: {
        type: { type: 'STRING', minLength: '1', maxLength: '10' },
        minLength: { type: 'ARRAY', minItems: '1', maxItems: '5', items: { type: 'STRING' } },
      },
      default: literal, const: literal, enum: [literal], examples: [literal],
    })).toEqual({
      type: 'object', minProperties: 1, maxProperties: 20,
      properties: {
        type: { type: 'string', minLength: 1, maxLength: 10 },
        minLength: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'string' } },
      },
      default: literal, const: literal, enum: [literal], examples: [literal],
    });
  });

  it.each(['', 'abc', '-1', '1.5', '9007199254740993'])(
    'does not reinterpret invalid or unsafe size limit %j', minLength => {
      expect(normalizeJsonSchema({ type: 'STRING', minLength })).toEqual({ type: 'string', minLength });
    },
  );

  it.each(['@ai-sdk/google', '@ai-sdk/openai'])(
    'applies provider-specific normalization for %s', npm => {
      const result = translateRequest({ model: 'relay-model', request: {
        tools: [{ functionDeclarations: [{ name: 'test', parameters: {
          type: 'OBJECT', properties: { values: { type: ['ARRAY', 'NULL'], items: { type: 'STRING' } } },
        } }] }],
      } }, { npm });
      const schema = (result.tools!.test!.inputSchema as any).jsonSchema;
      expect(schema.properties.values).toEqual(npm === '@ai-sdk/google'
        ? { type: 'array', nullable: true, items: { type: 'string' } }
        : { type: ['array', 'null'], items: { type: 'string' } });
    },
  );

  it('carries request-scoped headers into SDK params', () => {
    const sdkReq = translateRequest({
      model: 'relay-model',
      request: { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] },
    }, { requestHeaders: { 'x-opencode-session': 'conversation-1' } });
    expect(sdkReq.headers).toEqual({ 'x-opencode-session': 'conversation-1' });
  });

  it('translates a single user text message', () => {
    const ccReq: CloudCodeGenerateRequest = {
      model: 'relay-ai__zen__deepseek-v4-flash-free',
      request: {
        contents: [
          {
            role: 'user',
            parts: [{ text: 'Hello, how are you?' }]
          }
        ]
      }
    };

    const sdkReq = translateRequest(ccReq);
    expect(sdkReq.messages).toHaveLength(1);
    expect(sdkReq.messages[0]).toEqual({
      role: 'user',
      content: 'Hello, how are you?'
    });
  });

  it('translates multi-turn conversation history', () => {
    const ccReq: CloudCodeGenerateRequest = {
      model: 'relay-ai__zen__deepseek-v4-flash-free',
      request: {
        contents: [
          {
            role: 'user',
            parts: [{ text: 'Hello' }]
          },
          {
            role: 'model',
            parts: [{ text: 'Hi! How can I help?' }]
          },
          {
            role: 'user',
            parts: [{ text: 'What is the capital of France?' }]
          }
        ]
      }
    };

    const sdkReq = translateRequest(ccReq);
    expect(sdkReq.messages).toHaveLength(3);
    expect(sdkReq.messages[0]).toEqual({ role: 'user', content: 'Hello' });
    expect(sdkReq.messages[1]).toEqual({ role: 'assistant', content: 'Hi! How can I help?' });
    expect(sdkReq.messages[2]).toEqual({ role: 'user', content: 'What is the capital of France?' });
  });

  it('extracts system instructions and handles system role', () => {
    const ccReq: CloudCodeGenerateRequest = {
      model: 'relay-ai__zen__deepseek-v4-flash-free',
      request: {
        systemInstruction: {
          parts: [{ text: 'You are a helpful coding assistant.' }]
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: 'Hi' }]
          }
        ]
      }
    };

    const sdkReq = translateRequest(ccReq);
    expect(sdkReq.instructions).toBe('You are a helpful coding assistant.');
    expect(sdkReq.messages).toHaveLength(1);
    expect(sdkReq.messages[0]).toEqual({ role: 'user', content: 'Hi' });
  });

  it('limits Cloud Code function declarations when maxTools is set', () => {
    const ccReq: CloudCodeGenerateRequest = {
      model: 'relay-ai__groq__llama-3.3-70b',
      request: {
        contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
        tools: [{
          functionDeclarations: Array.from({ length: 130 }, (_, i) => ({
            name: `tool_${i}`,
            parameters: { type: 'OBJECT' },
          })),
        }],
      },
    };

    const sdkReq = translateRequest(ccReq, { maxTools: 128 });

    expect(Object.keys(sdkReq.tools ?? {})).toHaveLength(128);
    expect(sdkReq.tools?.tool_127).toBeDefined();
    expect(sdkReq.tools?.tool_128).toBeUndefined();
  });

  it('joins consecutive system messages and systemInstructions', () => {
    const ccReq: CloudCodeGenerateRequest = {
      model: 'relay-ai__zen__deepseek-v4-flash-free',
      request: {
        systemInstruction: {
          parts: [{ text: 'First instruction.' }]
        },
        contents: [
          {
            role: 'system',
            parts: [{ text: 'Second instruction.' }]
          },
          {
            role: 'user',
            parts: [{ text: 'Hi' }]
          }
        ]
      }
    };

    const sdkReq = translateRequest(ccReq);
    expect(sdkReq.instructions).toBe('First instruction.\n\nSecond instruction.');
    expect(sdkReq.messages).toHaveLength(1);
    expect(sdkReq.messages[0]).toEqual({ role: 'user', content: 'Hi' });
  });

  it('translates images / inline data if present', () => {
    const ccReq: CloudCodeGenerateRequest = {
      model: 'relay-ai__zen__deepseek-v4-flash-free',
      request: {
        contents: [
          {
            role: 'user',
            parts: [
              { text: 'Analyze this image:' },
              {
                inlineData: {
                  mimeType: 'image/png',
                  data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
                }
              }
            ]
          }
        ]
      }
    };

    const sdkReq = translateRequest(ccReq);
    expect(sdkReq.messages).toHaveLength(1);
    const msg = sdkReq.messages[0]!;
    expect(msg.role).toBe('user');
    expect(Array.isArray(msg.content)).toBe(true);
    const parts = msg.content as any[];
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ type: 'text', text: 'Analyze this image:' });
    expect(parts[1]).toEqual({
      type: 'file',
      data: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'),
      mediaType: 'image/png'
    });
  });

  it('does not translate audio inline data into an SDK image', () => {
    const ccReq: CloudCodeGenerateRequest = {
      model: 'relay-ai__zen__deepseek-v4-flash-free',
      request: {
        contents: [{
          role: 'user',
          parts: [{
            inlineData: {
              mimeType: 'audio/webm;codecs=opus',
              data: 'GkXfo59ChoEB',
            },
          }],
        }],
      },
    };

    const sdkReq = translateRequest(ccReq);
    const content = sdkReq.messages[0]!.content as any[];

    expect(content).toEqual([{
      type: 'text',
      text: '[Voice recording omitted because transcription is not supported by Relay AI.]',
    }]);
    expect(JSON.stringify(content)).not.toContain('GkXfo59ChoEB');
  });

  it('translates function declarations into SDK tools', () => {
    const ccReq: CloudCodeGenerateRequest = {
      model: 'relay-ai__zen__deepseek-v4-flash-free',
      request: {
        contents: [
          { role: 'user', parts: [{ text: 'Read the file' }] }
        ],
        tools: [
          {
            functionDeclarations: [
              {
                name: 'readFile',
                description: 'Read a file from disk',
                parameters: {
                  type: 'object',
                  properties: {
                    path: { type: 'string', description: 'File path' }
                  },
                  required: ['path']
                }
              },
              {
                name: 'writeFile',
                description: 'Write a file to disk',
                parameters: {
                  type: 'object',
                  properties: {
                    path: { type: 'string' },
                    content: { type: 'string' }
                  }
                }
              }
            ]
          }
        ]
      }
    };

    const sdkReq = translateRequest(ccReq);
    expect(sdkReq.tools).toBeDefined();
    expect(Object.keys(sdkReq.tools!)).toEqual(['readFile', 'writeFile']);
    expect(sdkReq.toolChoice).toBe('auto');
  });

  it('normalizes protobuf-style uppercase JSON Schema types recursively', () => {
    const ccReq: CloudCodeGenerateRequest = {
      model: 'relay-ai__deepseek__deepseek-v4-flash',
      request: {
        contents: [
          { role: 'user', parts: [{ text: 'Call the tool' }] }
        ],
        tools: [
          {
            functionDeclarations: [
              {
                name: 'call_mcp_tool',
                description: 'Call an MCP tool',
                parameters: {
                  type: 'OBJECT',
                  properties: {
                    toolName: {
                      type: 'STRING',
                      enum: ['READ_FILE']
                    },
                    arguments: {
                      type: 'OBJECT',
                      properties: {
                        count: { type: 'INTEGER' },
                        enabled: { type: 'BOOLEAN' },
                        values: {
                          type: 'ARRAY',
                          items: { type: ['NUMBER', 'NULL'] }
                        }
                      }
                    }
                  }
                }
              }
            ]
          }
        ]
      }
    };

    const sdkReq = translateRequest(ccReq);
    const schema = (sdkReq.tools!.call_mcp_tool!.inputSchema as any).jsonSchema;

    expect(schema).toEqual({
      type: 'object',
      properties: {
        toolName: {
          type: 'string',
          enum: ['READ_FILE']
        },
        arguments: {
          type: 'object',
          properties: {
            count: { type: 'integer' },
            enabled: { type: 'boolean' },
            values: {
              type: 'array',
              items: { type: ['number', 'null'] }
            }
          }
        }
      }
    });
  });

  it('translates functionCall parts into tool-call messages', () => {
    const ccReq: CloudCodeGenerateRequest = {
      model: 'relay-ai__zen__deepseek-v4-flash-free',
      request: {
        contents: [
          { role: 'user', parts: [{ text: 'Read file.txt' }] },
          {
            role: 'model',
            parts: [
              {
                functionCall: {
                  name: 'readFile',
                  args: { path: 'file.txt' }
                }
              }
            ]
          }
        ]
      }
    };

    const sdkReq = translateRequest(ccReq);
    expect(sdkReq.messages).toHaveLength(2);
    const assistantMsg = sdkReq.messages[1]!;
    expect(assistantMsg.role).toBe('assistant');
    const parts = assistantMsg.content as any[];
    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe('tool-call');
    expect(parts[0].toolName).toBe('readFile');
    expect(parts[0].input).toEqual({ path: 'file.txt' });
    expect(parts[0].toolCallId).toBeDefined();
  });

  it('translates functionResponse parts into tool-result messages', () => {
    const ccReq: CloudCodeGenerateRequest = {
      model: 'relay-ai__zen__deepseek-v4-flash-free',
      request: {
        contents: [
          { role: 'user', parts: [{ text: 'Read file.txt' }] },
          {
            role: 'model',
            parts: [
              {
                functionCall: {
                  name: 'readFile',
                  args: { path: 'file.txt' }
                }
              }
            ]
          },
          {
            role: 'user',
            parts: [
              {
                functionResponse: {
                  name: 'readFile',
                  response: { content: 'Hello world' }
                }
              }
            ]
          }
        ]
      }
    };

    const sdkReq = translateRequest(ccReq);
    expect(sdkReq.messages).toHaveLength(3);

    // The functionCall message
    const assistantMsg = sdkReq.messages[1]!;
    expect(assistantMsg.role).toBe('assistant');
    const assistantParts = assistantMsg.content as any[];
    expect(assistantParts[0].type).toBe('tool-call');
    const toolCallId = assistantParts[0].toolCallId;

    // The functionResponse message becomes a tool message
    const toolMsg = sdkReq.messages[2]!;
    expect(toolMsg.role).toBe('tool');
    const toolParts = toolMsg.content as any[];
    expect(toolParts).toHaveLength(1);
    expect(toolParts[0].type).toBe('tool-result');
    expect(toolParts[0].toolCallId).toBe(toolCallId);
    expect(toolParts[0].toolName).toBe('readFile');
  });

  it('handles mixed text and functionCall parts', () => {
    const ccReq: CloudCodeGenerateRequest = {
      model: 'relay-ai__zen__deepseek-v4-flash-free',
      request: {
        contents: [
          { role: 'user', parts: [{ text: 'List files' }] },
          {
            role: 'model',
            parts: [
              { text: 'I will read the file for you.' },
              {
                functionCall: {
                  name: 'readFile',
                  args: { path: 'main.py' }
                }
              }
            ]
          }
        ]
      }
    };

    const sdkReq = translateRequest(ccReq);
    expect(sdkReq.messages).toHaveLength(2);
    const assistantMsg = sdkReq.messages[1]!;
    const parts = assistantMsg.content as any[];
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ type: 'text', text: 'I will read the file for you.' });
    expect(parts[1].type).toBe('tool-call');
    expect(parts[1].toolName).toBe('readFile');
  });

  it('returns no tools when none declared', () => {
    const ccReq: CloudCodeGenerateRequest = {
      model: 'relay-ai__zen__deepseek-v4-flash-free',
      request: {
        contents: [
          { role: 'user', parts: [{ text: 'Hello' }] }
        ]
      }
    };

    const sdkReq = translateRequest(ccReq);
    expect(sdkReq.tools).toBeUndefined();
    expect(sdkReq.toolChoice).toBeUndefined();
  });

  it('handles toolConfig mode ANY as required', () => {
    const ccReq: CloudCodeGenerateRequest = {
      model: 'relay-ai__zen__deepseek-v4-flash-free',
      request: {
        contents: [
          { role: 'user', parts: [{ text: 'Do it' }] }
        ],
        tools: [
          {
            functionDeclarations: [
              { name: 'action', description: 'do something' }
            ]
          }
        ],
        toolConfig: {
          functionCallingConfig: { mode: 'ANY' }
        }
      }
    };

    const sdkReq = translateRequest(ccReq);
    expect(sdkReq.toolChoice).toBe('required');
  });

  it('expandTextWithThinking splits thinking tags into reasoning parts', () => {
    expect(expandTextWithThinking('plain text')).toEqual([{ type: 'text', text: 'plain text' }]);
    expect(expandTextWithThinking('<thinking>\nplan\n</thinking>\n\nanswer')).toEqual([
      { type: 'reasoning', text: '\nplan\n' },
      { type: 'text', text: '\n\nanswer' },
    ]);
  });

  it('round-trips assistant thinking before tool calls for DeepSeek', () => {
    const ccReq: CloudCodeGenerateRequest = {
      model: 'relay-ai__deepseek__deepseek-v4-flash',
      request: {
        contents: [
          { role: 'user', parts: [{ text: 'Check usage' }] },
          {
            role: 'model',
            parts: [
              { text: '<thinking>\nNeed to call pplx_usage first.\n</thinking>\n\n' },
              {
                functionCall: {
                  name: 'pplx_usage',
                  args: {},
                },
              },
            ],
          },
          {
            role: 'user',
            parts: [
              {
                functionResponse: {
                  name: 'pplx_usage',
                  response: { remaining: 10 },
                },
              },
            ],
          },
        ],
      },
    };

    const sdkReq = translateRequest(ccReq);
    const assistant = sdkReq.messages[1]!;
    expect(assistant.role).toBe('assistant');
    const parts = assistant.content as any[];
    expect(parts[0]).toEqual({ type: 'reasoning', text: '\nNeed to call pplx_usage first.\n' });
    expect(parts[1].type).toBe('tool-call');
    expect(parts[1].toolName).toBe('pplx_usage');
  });

  it('round-trips Cloud Code thought parts as SDK reasoning parts', () => {
    const ccReq: CloudCodeGenerateRequest = {
      model: 'relay-ai__deepseek__deepseek-v4-flash',
      request: {
        contents: [
          {
            role: 'model',
            parts: [
              { text: 'Need to call pplx_usage first.', thought: true },
              { text: 'I will check usage.' },
            ],
          },
        ],
      },
    };

    const sdkReq = translateRequest(ccReq);
    const assistant = sdkReq.messages[0]!;
    expect(assistant.role).toBe('assistant');
    expect(assistant.content).toEqual([
      { type: 'reasoning', text: 'Need to call pplx_usage first.' },
      { type: 'text', text: 'I will check usage.' },
    ]);
  });
});
