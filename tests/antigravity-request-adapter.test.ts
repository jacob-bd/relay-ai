import { describe, it, expect } from 'vitest';
import { translateRequest, expandTextWithThinking, type CloudCodeGenerateRequest } from '../src/antigravity/request-adapter.js';

describe('antigravity request-adapter', () => {
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
    expect(sdkReq.system).toBe('You are a helpful coding assistant.');
    expect(sdkReq.messages).toHaveLength(1);
    expect(sdkReq.messages[0]).toEqual({ role: 'user', content: 'Hi' });
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
    expect(sdkReq.system).toBe('First instruction.\n\nSecond instruction.');
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
      type: 'image',
      image: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      mimeType: 'image/png'
    });
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
