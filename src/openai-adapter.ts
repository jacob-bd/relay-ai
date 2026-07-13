import { tool, jsonSchema, streamText, generateText } from 'ai';
import type { LanguageModel, ModelMessage } from 'ai';
import { parseToolArguments } from './proxy-shared.js';
import type { SdkCallParams } from './sdk-adapter.js';

// ── OpenAI request shapes ───────────────────────────────────────────────────

export interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null | Array<any>;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export interface OpenAiRequest {
  model: string;
  messages: OpenAiMessage[];
  tools?: Array<{
    type: 'function';
    function: { name: string; description?: string; parameters?: Record<string, unknown> };
  }>;
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  temperature?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  stream?: boolean;
}

// ── Translation: OpenAI Request → SDK Call Params ───────────────────────────

export function translateOpenAiRequest(body: OpenAiRequest): SdkCallParams {
  // Pre-scan to map tool_call_id → function name so tool result messages can reference it.
  const toolNameById = new Map<string, string>();
  for (const msg of body.messages) {
    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const tc of msg.tool_calls) toolNameById.set(tc.id, tc.function.name);
    }
  }

  let system: string | undefined;
  const messages: ModelMessage[] = [];

  for (const msg of body.messages) {
    switch (msg.role) {
      case 'system':
        system = typeof msg.content === 'string' ? msg.content : undefined;
        break;

      case 'user':
        messages.push({ role: 'user', content: msg.content as any } as ModelMessage);
        break;

      case 'assistant': {
        const parts: any[] = [];
        if (typeof msg.content === 'string' && msg.content) {
          parts.push({ type: 'text', text: msg.content });
        }
        for (const tc of msg.tool_calls ?? []) {
          parts.push({
            type: 'tool-call',
            toolCallId: tc.id,
            toolName: tc.function.name,
            input: parseToolArguments(tc.function.arguments),
          });
        }
        messages.push({ role: 'assistant', content: parts.length > 0 ? parts : '' } as ModelMessage);
        break;
      }

      case 'tool': {
        const resultPart = {
          type: 'tool-result',
          toolCallId: msg.tool_call_id ?? '',
          toolName: toolNameById.get(msg.tool_call_id ?? '') ?? 'unknown',
          output: {
            type: 'text',
            value: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? ''),
          },
        };
        const lastMsg = messages[messages.length - 1];
        if (lastMsg?.role === 'tool' && Array.isArray(lastMsg.content)) {
          lastMsg.content.push(resultPart as any);
        } else {
          messages.push({ role: 'tool', content: [resultPart] } as unknown as ModelMessage);
        }
        break;
      }
    }
  }

  let sdkToolChoice: SdkCallParams['toolChoice'];
  if (body.tool_choice === 'auto' || body.tool_choice === 'required') {
    sdkToolChoice = body.tool_choice;
  } else if (typeof body.tool_choice === 'object' && body.tool_choice?.type === 'function') {
    sdkToolChoice = { type: 'tool', toolName: body.tool_choice.function.name };
  }

  let tools: SdkCallParams['tools'];
  if (body.tools?.length) {
    tools = {} as any;
    for (const t of body.tools) {
      if (t.type === 'function' && t.function.name) {
        const schema = t.function.parameters ? jsonSchema(t.function.parameters) : undefined;
        (tools as any)[t.function.name] = tool({
          description: t.function.description ?? '',
          inputSchema: (schema ?? jsonSchema({ type: 'object', properties: {} })) as any,
        });
      }
    }
  }

  return {
    system,
    messages,
    tools,
    toolChoice: sdkToolChoice,
    temperature: body.temperature,
    maxOutputTokens: body.max_completion_tokens ?? body.max_tokens,
  };
}

// ── Translation: SDK Response → OpenAI JSON / SSE ───────────────────────────

export async function generateOpenAiResponse(
  model: LanguageModel,
  params: SdkCallParams,
  responseModelId: string,
) {
  const result: any = await generateText({ model, ...(params as any) });
  const message: Record<string, any> = { role: 'assistant', content: result.text || null };

  if (result.toolCalls?.length) {
    message.tool_calls = result.toolCalls.map((tc: any) => ({
      id: tc.toolCallId,
      type: 'function',
      function: { name: tc.toolName, arguments: JSON.stringify(tc.args) },
    }));
  }

  return {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: responseModelId,
    choices: [{ index: 0, message, finish_reason: result.finishReason || 'stop' }],
    usage: {
      prompt_tokens: result.usage?.promptTokens ?? 0,
      completion_tokens: result.usage?.completionTokens ?? 0,
      total_tokens: result.usage?.totalTokens ?? 0,
    },
  };
}

export async function streamOpenAiResponse(
  model: LanguageModel,
  params: SdkCallParams,
  responseModelId: string,
  onChunk: (chunk: string) => void,
): Promise<void> {
  const { fullStream } = streamText({ model, ...(params as any) });
  const baseData = {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: responseModelId,
  };

  const send = (delta: Record<string, any>, finish_reason: string | null = null) =>
    onChunk(`data: ${JSON.stringify({ ...baseData, choices: [{ index: 0, delta, finish_reason }] })}\n\n`);

  for await (const part of fullStream) {
    const p = part as any;
    switch (p.type) {
      case 'text-delta':
        send({ role: 'assistant', content: p.textDelta ?? p.text ?? '' });
        break;
      case 'tool-input-start':
      case 'tool-call-streaming-start':
        send({ role: 'assistant', tool_calls: [{ index: 0, id: p.id ?? p.toolCallId, type: 'function', function: { name: p.toolName, arguments: '' } }] });
        break;
      case 'tool-input-delta':
      case 'tool-call-delta':
        send({ tool_calls: [{ index: 0, function: { arguments: p.delta ?? p.text ?? p.argsTextDelta ?? '' } }] });
        break;
      case 'finish':
        send({}, p.finishReason || 'stop');
        break;
      case 'error':
        throw p.error instanceof Error || (p.error && typeof p.error === 'object')
          ? p.error
          : new Error(typeof p.error === 'string' ? p.error : 'Upstream stream failed');
    }
  }

  onChunk('data: [DONE]\n\n');
}
