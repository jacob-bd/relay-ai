import { tool, jsonSchema, streamText, generateText } from 'ai';
import type { LanguageModel, ModelMessage } from 'ai';
import { parseToolArguments } from './proxy-shared.js';
import type { SdkCallParams } from './sdk-adapter.js';
import { formatUpstreamError } from './codex/upstream-error.js';

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
        // Some clients (e.g. Cursor) send assistant history turns with content as an array of
        // parts, same as user messages — not just a plain string. Extracting text only from the
        // string case silently dropped that text, leaving a message with empty content and no
        // tool_calls, which strict upstreams (Alibaba/qwen) reject as "content field is required".
        const assistantText = typeof msg.content === 'string'
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content.filter((p: any) => p?.type === 'text' && typeof p.text === 'string').map((p: any) => p.text).join('')
            : '';
        if (assistantText) {
          parts.push({ type: 'text', text: assistantText });
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

/**
 * The Vercel AI SDK's finishReason values (LanguageModelV2FinishReason) use hyphens
 * ('tool-calls', 'content-filter') and include 'error' / 'other' / 'unknown', none of
 * which are valid OpenAI wire values. A strict OpenAI client (e.g. Cursor) that
 * validates finish_reason against the real enum ('stop' | 'length' | 'tool_calls' |
 * 'content_filter' | 'function_call') can reject or mishandle the response otherwise —
 * this reproduced as Cursor's "Empty provider response" on every tool-calling turn.
 */
function toOpenAiFinishReason(reason: string | undefined | null): string {
  switch (reason) {
    case 'tool-calls': return 'tool_calls';
    case 'content-filter': return 'content_filter';
    case 'length': return 'length';
    case 'stop': return 'stop';
    default: return 'stop'; // 'error' | 'other' | 'unknown' | undefined — no OpenAI equivalent
  }
}

export async function generateOpenAiResponse(
  model: LanguageModel,
  params: SdkCallParams,
  responseModelId: string,
) {
  const result: any = await generateText({ model, ...(params as any) });
  const message: Record<string, any> = { role: 'assistant', content: result.text || null };
  // Reasoning models can spend their entire turn on reasoning with little/no final text
  // (e.g. a very long system prompt leaves no budget for a visible answer). Surface it via
  // the widely-adopted reasoning_content field so the client sees something rather than an
  // effectively empty message — this reproduced live as Cursor's "Empty provider response".
  if (result.reasoningText || result.reasoning) {
    message.reasoning_content = result.reasoningText ?? result.reasoning;
  }

  if (result.toolCalls?.length) {
    // Vercel AI SDK v5 puts tool-call arguments on `.input`; `.args` was the v4 field name.
    message.tool_calls = result.toolCalls.map((tc: any) => ({
      id: tc.toolCallId,
      type: 'function',
      function: { name: tc.toolName, arguments: JSON.stringify(tc.input ?? tc.args ?? {}) },
    }));
  }

  return {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: responseModelId,
    choices: [{ index: 0, message, finish_reason: toOpenAiFinishReason(result.finishReason) }],
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
  log?: (msg: () => string) => void,
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

  // toolCallId → index for tool_calls emitted via the streamed input-start/delta path, so a
  // trailing consolidated 'tool-call' part for the same id isn't re-emitted (some providers send
  // both), and so parallel tool calls each get a distinct OpenAI-wire `index`.
  const streamedToolIndex = new Map<string, number>();
  let nextToolIndex = 0;
  const seenPartTypes = new Set<string>();
  let toolCallChunksEmitted = 0;

  for await (const part of fullStream) {
    const p = part as any;
    seenPartTypes.add(p.type);
    switch (p.type) {
      case 'text-delta':
        send({ role: 'assistant', content: p.textDelta ?? p.text ?? '' });
        break;
      case 'reasoning-delta':
        // See generateOpenAiResponse: forward reasoning so a reasoning-heavy turn with
        // little/no final text still produces visible content instead of appearing empty.
        send({ role: 'assistant', reasoning_content: p.text ?? p.delta ?? '' });
        break;
      case 'tool-input-start':
      case 'tool-call-streaming-start': {
        const id = p.id ?? p.toolCallId ?? '';
        const index = nextToolIndex++;
        streamedToolIndex.set(id, index);
        send({ role: 'assistant', tool_calls: [{ index, id, type: 'function', function: { name: p.toolName, arguments: '' } }] });
        toolCallChunksEmitted++;
        break;
      }
      case 'tool-input-delta':
      case 'tool-call-delta': {
        const id = p.id ?? p.toolCallId ?? '';
        const index = streamedToolIndex.get(id) ?? 0;
        send({ tool_calls: [{ index, function: { arguments: p.delta ?? p.text ?? p.argsTextDelta ?? '' } }] });
        break;
      }
      case 'tool-call': {
        // Some providers (e.g. @ai-sdk/alibaba serving qwen) deliver the tool call as a single
        // consolidated part instead of streamed input-start/delta — the same shape generateText's
        // non-streaming result.toolCalls[] uses. Without this case, that tool call was silently
        // dropped: zero tool_calls chunks emitted, reasoning-only output, and Cursor reported
        // "Empty provider response" on every tool-calling turn.
        const id = p.toolCallId ?? '';
        if (streamedToolIndex.has(id)) break; // already emitted via input-start/delta
        const index = nextToolIndex++;
        send({
          role: 'assistant',
          tool_calls: [{ index, id, type: 'function', function: { name: p.toolName, arguments: JSON.stringify(p.input ?? {}) } }],
        });
        toolCallChunksEmitted++;
        break;
      }
      case 'finish':
        log?.(() => `openai stream parts=[${[...seenPartTypes].join(',')}] toolCallChunks=${toolCallChunksEmitted} finishReason=${p.finishReason}`);
        send({}, toOpenAiFinishReason(p.finishReason));
        break;

      case 'error': {
        // Unlike sdk-adapter.ts's writeAnthropicStream (which has an SSE 'error' event to use),
        // OpenAI's chat.completion.chunk format has no mid-stream error shape — and headers are
        // already sent by the time a stream can fail. Surface the failure as visible content
        // (same fallback philosophy as reasoning_content above) so the client sees something
        // instead of a bare, unexplained [DONE] — the exact "Empty provider response" pattern
        // this reproduced as when the upstream SDK stream ended with an 'error' part instead of
        // 'finish' and this case didn't exist to catch it.
        const errMsg = typeof p.error === 'string' ? p.error : formatUpstreamError(p.error);
        log?.(() => `openai stream error parts=[${[...seenPartTypes].join(',')}]: ${errMsg}`);
        log?.(() => {
          try {
            return `openai stream error raw: ${JSON.stringify(p.error, Object.getOwnPropertyNames(p.error ?? {})).slice(0, 3000)}`;
          } catch {
            return `openai stream error raw: (unserializable) ${String(p.error)}`;
          }
        });
        send({ role: 'assistant', content: `\n\n[relay-ai upstream error: ${errMsg}]` });
        send({}, 'stop');
        onChunk('data: [DONE]\n\n');
        return;
      }
    }
  }

  onChunk('data: [DONE]\n\n');
}
