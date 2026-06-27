import { describe, expect, it } from 'vitest';
import { anthropicToCloudCode } from '../src/antigravity/anthropic-to-cloudcode.js';
import { collectCloudCodeToAnthropic } from '../src/antigravity/cloudcode-to-anthropic.js';

describe('anthropicToCloudCode', () => {
  it('floors maxOutputTokens so Gemini hidden thoughts do not consume the full budget', () => {
    const envelope = anthropicToCloudCode({
      max_tokens: 64,
      messages: [{ role: 'user', content: 'hello' }],
    }, 'gemini-3-flash', 'project-id');

    expect((envelope.request as any).generationConfig.maxOutputTokens).toBe(1024);
  });

  it('disables Cloud Code thought output so Claude Code receives visible turns', () => {
    const envelope = anthropicToCloudCode({
      max_tokens: 32000,
      output_config: { effort: 'xhigh' },
      messages: [{ role: 'user', content: 'count notebooks' }],
    }, 'gemini-3-flash-extra-low', 'project-id');

    expect((envelope.request as any).generationConfig.thinkingConfig).toEqual({
      thinkingBudget: 0,
      includeThoughts: false,
    });
  });

  it('strips JSON Schema validation keywords rejected by Cloud Code tools', () => {
    const envelope = anthropicToCloudCode({
      max_tokens: 64,
      messages: [{ role: 'user', content: 'use the tool' }],
      tools: [{
        name: 'set_limit',
        description: 'Set a numeric limit',
        input_schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            value: {
              type: 'number',
              description: 'Limit value',
              exclusiveMinimum: 0,
              maximum: 10,
              default: 1,
            },
            mode: {
              type: 'string',
              enum: ['fast', 'safe'],
              pattern: '^[a-z]+$',
            },
          },
          required: ['value', 'mode', 'removed'],
        },
      }],
    }, 'gemini-3-flash', 'project-id');

    const request = envelope.request as any;
    const parameters = request.tools[0].functionDeclarations[0].parameters;

    expect(parameters).toEqual({
      type: 'object',
      properties: {
        value: {
          type: 'number',
          description: 'Limit value',
        },
        mode: {
          type: 'string',
          enum: ['fast', 'safe'],
        },
      },
      required: ['value', 'mode'],
    });
    expect(JSON.stringify(parameters)).not.toContain('exclusiveMinimum');
  });

  it('round-trips Cloud Code thought signatures on historical tool calls', async () => {
    const upstream = new Response([
      'data: ',
      JSON.stringify({
        response: {
          candidates: [{
            content: {
              role: 'model',
              parts: [{
                thoughtSignature: 'sig-123',
                functionCall: { name: 'default_api:Skill', args: { skill: 'superpowers:using-superpowers' } },
              }],
            },
            finishReason: 'STOP',
          }],
        },
      }),
      '\n\n',
    ].join(''), {
      headers: { 'Content-Type': 'text/event-stream' },
    });

    const assistant = await collectCloudCodeToAnthropic(upstream, 'gemini-3-flash');
    const toolUse = (assistant.content as any[]).find(block => block.type === 'tool_use');

    expect(toolUse.id).toContain('__ts__');

    const nextEnvelope = anthropicToCloudCode({
      max_tokens: 64,
      messages: [
        { role: 'user', content: 'hey' },
        { role: 'assistant', content: [toolUse] },
        {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: 'Loaded',
          }],
        },
      ],
    }, 'gemini-3-flash', 'project-id');

    const request = nextEnvelope.request as any;
    const replayedFunctionCall = request.contents[1].parts[0];

    expect(replayedFunctionCall).toMatchObject({
      thoughtSignature: 'sig-123',
      functionCall: {
        name: 'default_api:Skill',
        args: { skill: 'superpowers:using-superpowers' },
      },
    });
  });

  it('keeps large Cloud Code thought signatures out of Claude-visible tool ids', async () => {
    const largeSignature = 'sig-'.repeat(512);
    const upstream = new Response([
      'data: ',
      JSON.stringify({
        response: {
          candidates: [{
            content: {
              role: 'model',
              parts: [{
                thoughtSignature: largeSignature,
                functionCall: { name: 'mcp__notebooklm-mcp__notebook_list', args: { max_results: 100 } },
              }],
            },
            finishReason: 'STOP',
          }],
        },
      }),
      '\n\n',
    ].join(''), {
      headers: { 'Content-Type': 'text/event-stream' },
    });

    const assistant = await collectCloudCodeToAnthropic(upstream, 'gemini-3-flash');
    const toolUse = (assistant.content as any[]).find(block => block.type === 'tool_use');

    expect(toolUse.id).not.toContain('__ts__');
    expect(toolUse.id.length).toBeLessThan(32);

    const nextEnvelope = anthropicToCloudCode({
      max_tokens: 64,
      messages: [
        { role: 'assistant', content: [toolUse] },
        {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: '[]',
          }],
        },
      ],
    }, 'gemini-3-flash', 'project-id');

    const request = nextEnvelope.request as any;
    expect(request.contents[0].parts[0]).toMatchObject({
      thoughtSignature: largeSignature,
      functionCall: {
        name: 'mcp__notebooklm-mcp__notebook_list',
        args: { max_results: 100 },
      },
    });
  });

  it('does not expose Cloud Code thought text as assistant content', async () => {
    const upstream = new Response([
      'data: ',
      JSON.stringify({
        response: {
          candidates: [{
            content: {
              role: 'model',
              parts: [
                { thought: true, text: 'Wait, check the hidden checklist first.' },
                { text: 'You have 131 NotebookLM notebooks.' },
              ],
            },
            finishReason: 'STOP',
          }],
        },
      }),
      '\n\n',
    ].join(''), {
      headers: { 'Content-Type': 'text/event-stream' },
    });

    const assistant = await collectCloudCodeToAnthropic(upstream, 'gemini-3-flash');

    expect(JSON.stringify(assistant.content)).not.toContain('hidden checklist');
    expect(assistant.content).toEqual([
      { type: 'text', text: 'You have 131 NotebookLM notebooks.' },
    ]);
  });
  it('merges consecutive same-role messages to satisfy Gemini strict alternation', () => {
    // Claude Code Skill tool inserts two consecutive user-role messages after a tool result.
    // Cloud Code (Gemini) requires strict user/model alternation and returns empty responses
    // when consecutive same-role messages are present.
    const envelope = anthropicToCloudCode({
      max_tokens: 1024,
      messages: [
        { role: 'user', content: 'How many notebooks?' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_abc', name: 'Skill', input: { name: 'nlm-skill' } }] },
        // Skill tool returns 2 consecutive user-role messages
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_abc', content: 'Skill loaded.' }] },
        { role: 'user', content: 'Now count your notebooks using the MCP.' },
      ],
    }, 'gemini-3-flash', 'project-id');

    const contents = (envelope.request as any).contents as Array<{ role: string; parts: unknown[] }>;

    // Must never have two consecutive messages with the same role
    for (let i = 1; i < contents.length; i++) {
      expect(contents[i].role).not.toBe(contents[i - 1].role);
    }

    // The two consecutive user messages should be merged into one
    const userMsgs = contents.filter(c => c.role === 'user');
    const modelMsgs = contents.filter(c => c.role === 'model');
    expect(userMsgs.length).toBe(2);   // first user + merged (tool_result + continuation)
    expect(modelMsgs.length).toBe(1);  // the Skill tool_use
  });

});
