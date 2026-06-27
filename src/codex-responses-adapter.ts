// OpenAI Responses API (/v1/responses) ↔ Vercel AI SDK. One turn per request; Codex owns the tool loop.
import { streamText, generateText, tool, jsonSchema } from 'ai';
import type { LanguageModel, ModelMessage } from 'ai';
import {
  sseChunk,
  encodeToolUseId,
  splitToolUseId,
  serializeToolResultContent,
  parseToolArguments,
  silenceSdkWarnings,
  grabRoundTripSignature,
  type FullStreamPart,
} from './proxy-shared.js';
import {
  deepMergeProviderOptions,
  effortProviderOptions,
  thinkingProviderOptions,
  type ReasoningMetadata,
} from './provider-factory.js';
import { formatUpstreamError } from './codex/upstream-error.js';

export { silenceSdkWarnings };

// ── Responses request shapes ─────────────────────────────────────────────────

export interface ResponsesFunctionCallItem {
  type: 'function_call';
  id?: string;
  call_id: string;
  name: string;
  arguments?: string;
}

export interface ResponsesFunctionCallOutputItem {
  type: 'function_call_output';
  call_id: string;
  output: string | unknown;
}

export interface ResponsesMessageItem {
  type?: 'message';
  role: 'user' | 'assistant' | 'developer';
  content: string | Array<{ type: string; text?: string }>;
}

export interface ResponsesReasoningItem {
  type: 'reasoning';
  id?: string;
  summary?: Array<{ type: string; text?: string }>;
}

export type ResponsesInputItem =
  | ResponsesMessageItem
  | ResponsesFunctionCallItem
  | ResponsesFunctionCallOutputItem
  | ResponsesReasoningItem;

export interface ResponsesTool {
  type: 'function';
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface ResponsesRequest {
  model: string;
  input: string | ResponsesInputItem[];
  stream?: boolean;
  tools?: ResponsesTool[];
  instructions?: string;
  max_output_tokens?: number;
  temperature?: number;
  previous_response_id?: string;
  reasoning?: { effort?: string; summary?: string };
}

export interface CodexSdkCallParams {
  system?: string;
  messages: ModelMessage[];
  tools?: Record<string, ReturnType<typeof tool>>;
  maxOutputTokens?: number;
  temperature?: number;
  providerOptions?: Record<string, Record<string, unknown>>;
}

type WriteFn = (chunk: string) => void;

function messageText(content: ResponsesMessageItem['content']): string {
  if (typeof content === 'string') return content;
  return (content ?? [])
    .map(p => (p.type === 'output_text' || p.type === 'input_text' || p.type === 'text' ? p.text ?? '' : ''))
    .join('');
}

function extractDeveloperAndInstructions(
  items: ResponsesInputItem[],
  instructions?: string,
): { system?: string; remaining: ResponsesInputItem[] } {
  const developerParts: string[] = [];
  const remaining: ResponsesInputItem[] = [];
  for (const item of items) {
    if ('role' in item && item.role === 'developer') {
      const text = messageText(item.content);
      if (text.trim()) developerParts.push(text.trim());
    } else {
      remaining.push(item);
    }
  }
  const parts = [...developerParts];
  if (instructions?.trim()) parts.push(instructions.trim());
  const system = parts.length ? parts.join('\n') : undefined;
  return { system, remaining };
}

function annotateToolNamesFromCalls(items: ResponsesInputItem[]): Map<string, string> {
  const nameByCallId = new Map<string, string>();
  for (const item of items) {
    if (item.type === 'function_call') {
      const { rawId } = splitToolUseId(item.call_id);
      nameByCallId.set(rawId, item.name);
    }
  }
  return nameByCallId;
}

function mergeConsecutiveMessages(messages: ModelMessage[]): ModelMessage[] {
  if (messages.length <= 1) return messages;
  const out: ModelMessage[] = [];
  for (const msg of messages) {
    const prev = out[out.length - 1];
    if (prev && prev.role === msg.role) {
      const prevContent = Array.isArray(prev.content) ? prev.content : [{ type: 'text', text: String(prev.content ?? '') }];
      const msgContent = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: String(msg.content ?? '') }];
      prev.content = [...prevContent, ...msgContent] as typeof prev.content;
    } else {
      out.push(msg);
    }
  }
  return out;
}

function ensureUserFirst(messages: ModelMessage[]): ModelMessage[] {
  if (messages.length === 0) return [{ role: 'user', content: [{ type: 'text', text: '(empty input)' }] } as ModelMessage];
  if (messages[0]!.role === 'assistant') {
    return [{ role: 'user', content: [{ type: 'text', text: '(conversation continued)' }] } as ModelMessage, ...messages];
  }
  return messages;
}

function reasoningSummaryText(item: ResponsesReasoningItem): string {
  return (item.summary ?? [])
    .map(part => (part.type === 'summary_text' ? part.text ?? '' : ''))
    .join('');
}

function makeReasoningOutputItem(id: string, text: string): ResponsesReasoningItem {
  return {
    id,
    type: 'reasoning',
    summary: text.trim() ? [{ type: 'summary_text', text }] : [],
  };
}

export function translateResponsesInput(
  input: string | ResponsesInputItem[],
  instructions: string | undefined,
  npm: string,
): { system?: string; messages: ModelMessage[] } {
  if (typeof input === 'string') {
    return {
      system: instructions?.trim() || undefined,
      messages: [{ role: 'user', content: [{ type: 'text', text: input }] } as ModelMessage],
    };
  }

  const { system, remaining } = extractDeveloperAndInstructions(input, instructions);
  const toolNames = annotateToolNamesFromCalls(remaining);
  const messages: ModelMessage[] = [];
  let pendingReasoning = '';

  for (const item of remaining) {
    if (item.type === 'reasoning') {
      pendingReasoning += reasoningSummaryText(item as ResponsesReasoningItem);
      continue;
    }
    if (item.type === 'function_call') {
      const { rawId, thoughtSignature } = splitToolUseId(item.call_id);
      const parts: Record<string, unknown>[] = [];
      if (pendingReasoning.trim()) {
        parts.push({ type: 'reasoning', text: pendingReasoning });
        pendingReasoning = '';
      }
      const toolPart: Record<string, unknown> = {
        type: 'tool-call',
        toolCallId: rawId,
        toolName: item.name,
        input: parseToolArguments(item.arguments),
      };
      if (thoughtSignature && npm === '@ai-sdk/google') {
        toolPart.providerOptions = { google: { thoughtSignature } };
      }
      parts.push(toolPart);
      messages.push({ role: 'assistant', content: parts } as ModelMessage);
    } else if (item.type === 'function_call_output') {
      const { rawId } = splitToolUseId(item.call_id);
      messages.push({
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: rawId,
          toolName: toolNames.get(rawId) ?? 'unknown',
          output: { type: 'text', value: serializeToolResultContent(item.output) },
        }],
      } as ModelMessage);
    } else if ('role' in item) {
      const role = item.role === 'assistant' ? 'assistant' : 'user';
      const text = messageText(item.content);
      messages.push({ role, content: [{ type: 'text', text }] } as ModelMessage);
    }
  }

  return {
    system,
    messages: ensureUserFirst(mergeConsecutiveMessages(messages)),
  };
}

export function translateResponsesTools(tools?: ResponsesTool[]): CodexSdkCallParams['tools'] {
  if (!tools?.length) return undefined;
  const out: Record<string, ReturnType<typeof tool>> = {};
  for (const t of tools) {
    if (t.type !== 'function' || !t.name) continue;
    out[t.name] = tool({
      description: t.description ?? '',
      inputSchema: jsonSchema(t.parameters ?? { type: 'object', properties: {} }),
    });
  }
  return Object.keys(out).length ? out : undefined;
}

export function translateResponsesRequest(
  body: ResponsesRequest,
  npm: string,
  metadata?: ReasoningMetadata,
): CodexSdkCallParams {
  const { system, messages } = translateResponsesInput(body.input, body.instructions, npm);
  const effort = body.reasoning?.effort;
  const providerOptions = deepMergeProviderOptions(
    thinkingProviderOptions(npm),
    effortProviderOptions(npm, effort, body.model, metadata),
  );
  return {
    system,
    messages,
    tools: translateResponsesTools(body.tools),
    maxOutputTokens: body.max_output_tokens,
    temperature: body.temperature,
    providerOptions,
  };
}

function newResponseId(): string {
  return `resp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function newItemId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function usageFromPart(part: FullStreamPart): { input_tokens: number; output_tokens: number; total_tokens: number } {
  const input = part.totalUsage?.inputTokens ?? 0;
  const output = part.totalUsage?.outputTokens ?? 0;
  return { input_tokens: input, output_tokens: output, total_tokens: input + output };
}

interface StreamingToolState {
  itemId: string;
  callId: string;
  name: string;
  outputIndex: number;
  args: string;
}

export async function writeResponsesStream(
  fullStream: AsyncIterable<FullStreamPart>,
  modelId: string,
  write: WriteFn,
): Promise<void> {
  const emit = (type: string, data: unknown) => write(sseChunk(type, data));
  const responseId = newResponseId();
  const createdAt = Math.floor(Date.now() / 1000);
  let usage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

  emit('response.created', {
    type: 'response.created',
    response: {
      id: responseId,
      object: 'response',
      model: modelId,
      created_at: createdAt,
      status: 'in_progress',
      output: [],
    },
  });

  let outputIndex = 0;
  let textItemId: string | null = null;
  let textOutputIndex = 0;
  let textFull = '';
  const toolStates: StreamingToolState[] = [];
  const toolStatesById = new Map<string, StreamingToolState>();
  let currentToolState: StreamingToolState | null = null;
  let reasoningItemId: string | null = null;
  let reasoningText = '';
  let reasoningOutputIndex = 0;
  const outputItems: unknown[] = [];

  const ensureTextItem = (): string => {
    if (!textItemId) {
      textItemId = newItemId('msg');
      textOutputIndex = outputIndex;
      outputIndex++;
      emit('response.output_item.added', {
        type: 'response.output_item.added',
        output_index: textOutputIndex,
        item: { id: textItemId, type: 'message', role: 'assistant', status: 'in_progress', content: [] },
      });
      emit('response.content_part.added', {
        type: 'response.content_part.added',
        item_id: textItemId,
        output_index: textOutputIndex,
        content_index: 0,
        part: { type: 'output_text', text: '' },
      });
    }
    return textItemId;
  };

  const rememberToolState = (state: StreamingToolState): StreamingToolState => {
    toolStates.push(state);
    toolStatesById.set(state.itemId, state);
    toolStatesById.set(state.callId, state);
    currentToolState = state;
    return state;
  };

  const createToolState = (
    rawId: string | undefined,
    name: string | undefined,
    signature: string | undefined,
  ): StreamingToolState => {
    const itemId = rawId ?? newItemId('fc');
    const state = rememberToolState({
      itemId,
      callId: encodeToolUseId(itemId, signature),
      name: name ?? 'unknown',
      outputIndex: outputIndex++,
      args: '',
    });
    emit('response.output_item.added', {
      type: 'response.output_item.added',
      output_index: state.outputIndex,
      item: {
        type: 'function_call',
        id: state.itemId,
        call_id: state.callId,
        name: state.name,
        arguments: '',
        status: 'in_progress',
      },
    });
    return state;
  };

  const findToolState = (part: FullStreamPart): StreamingToolState | null => {
    const key = part.id ?? part.toolCallId;
    if (key) return toolStatesById.get(key) ?? currentToolState;
    return currentToolState;
  };

  const appendToolArgs = (state: StreamingToolState, delta: string): void => {
    if (!delta) return;
    state.args += delta;
    emit('response.function_call_arguments.delta', {
      type: 'response.function_call_arguments.delta',
      item_id: state.itemId,
      output_index: state.outputIndex,
      delta,
    });
  };

  for await (const part of fullStream) {
    switch (part.type) {
      case 'reasoning-start':
        reasoningText = '';
        reasoningItemId = newItemId('rs');
        reasoningOutputIndex = outputIndex++;
        emit('response.output_item.added', {
          type: 'response.output_item.added',
          output_index: reasoningOutputIndex,
          item: { id: reasoningItemId, type: 'reasoning', summary: [] },
        });
        break;

      case 'reasoning-delta':
        if (!reasoningItemId) {
          reasoningItemId = newItemId('rs');
          reasoningOutputIndex = outputIndex++;
          emit('response.output_item.added', {
            type: 'response.output_item.added',
            output_index: reasoningOutputIndex,
            item: { id: reasoningItemId, type: 'reasoning', summary: [] },
          });
        }
        reasoningText += part.text ?? '';
        break;

      case 'reasoning-end':
        break;

      case 'text-start':
        textFull = '';
        ensureTextItem();
        break;

      case 'text-delta':
        ensureTextItem();
        textFull += part.text ?? '';
        emit('response.output_text.delta', {
          type: 'response.output_text.delta',
          item_id: textItemId,
          output_index: textOutputIndex,
          content_index: 0,
          delta: part.text ?? '',
        });
        break;

      case 'tool-input-start': {
        const sig = grabRoundTripSignature(part);
        createToolState(part.id ?? part.toolCallId, part.toolName, sig);
        break;
      }

      case 'tool-input-delta': {
        const state = findToolState(part);
        if (state) appendToolArgs(state, part.delta ?? part.text ?? '');
        break;
      }

      case 'tool-call': {
        const sig = grabRoundTripSignature(part);
        const key = part.toolCallId ?? part.id;
        const state = (key ? toolStatesById.get(key) : undefined)
          ?? createToolState(key, part.toolName, sig);
        if (!state.args) {
          appendToolArgs(state, JSON.stringify(part.input ?? {}));
        }
        break;
      }

      case 'finish':
        if (part.totalUsage) usage = usageFromPart(part);
        break;

      case 'error': {
        const msg = formatUpstreamError(part.error);
        const is429 = msg.includes('429') ||
          (part.error && typeof part.error === 'object' &&
            ((part.error as { statusCode?: number }).statusCode === 429 ||
             (part.error as { lastError?: { statusCode?: number } }).lastError?.statusCode === 429));
        process.stderr.write(`[relay-ai] ${modelId}: ${msg}\n`);
        writeResponsesRateLimitStream(modelId, is429 ? msg : '(conversation context was too large to summarize)', write);
        return;
      }

      default:
        break;
    }
  }

  if (textItemId) {
    emit('response.output_text.done', {
      type: 'response.output_text.done',
      item_id: textItemId,
      output_index: textOutputIndex,
      content_index: 0,
      text: textFull,
    });
    emit('response.content_part.done', {
      type: 'response.content_part.done',
      item_id: textItemId,
      output_index: textOutputIndex,
      content_index: 0,
      part: { type: 'output_text', text: textFull },
    });
    const textItem = {
      id: textItemId,
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: textFull }],
    };
    emit('response.output_item.done', {
      type: 'response.output_item.done',
      output_index: textOutputIndex,
      item: textItem,
    });
    outputItems.push(textItem);
  }

  if (reasoningItemId) {
    const reasoningItem = makeReasoningOutputItem(reasoningItemId, reasoningText);
    emit('response.output_item.done', {
      type: 'response.output_item.done',
      output_index: reasoningOutputIndex,
      item: reasoningItem,
    });
    outputItems.unshift(reasoningItem);
  }

  for (const tool of toolStates) {
    emit('response.function_call_arguments.done', {
      type: 'response.function_call_arguments.done',
      item_id: tool.itemId,
      output_index: tool.outputIndex,
      arguments: tool.args,
    });
    const fcItem = {
      type: 'function_call',
      id: tool.itemId,
      call_id: tool.callId,
      name: tool.name,
      arguments: tool.args,
      status: 'completed',
    };
    emit('response.output_item.done', {
      type: 'response.output_item.done',
      output_index: tool.outputIndex,
      item: fcItem,
    });
    outputItems.push(fcItem);
  }

  if (outputItems.length === 0) {
    outputItems.push({ id: newItemId('msg'), type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '(conversation context was too large to summarize)' }] });
  }

  emit('response.completed', {
    type: 'response.completed',
    response: {
      id: responseId,
      object: 'response',
      model: modelId,
      created_at: createdAt,
      status: 'completed',
      output: outputItems,
      usage,
    },
  });
}

export async function streamResponsesResponse(
  model: LanguageModel,
  params: CodexSdkCallParams,
  modelId: string,
  write: WriteFn,
): Promise<void> {
  const result = streamText({ model, ...params, onError: () => {} } as Parameters<typeof streamText>[0]);
  // Prevent unhandled promise rejections on stream properties:
  Promise.resolve(result.text).catch(() => {});
  Promise.resolve(result.toolCalls).catch(() => {});
  Promise.resolve(result.toolResults).catch(() => {});
  Promise.resolve(result.finishReason).catch(() => {});
  Promise.resolve(result.usage).catch(() => {});
  Promise.resolve(result.response).catch(() => {});

  await writeResponsesStream(result.fullStream as AsyncIterable<FullStreamPart>, modelId, write);
}

export async function generateResponsesResponse(
  model: LanguageModel,
  params: CodexSdkCallParams,
  modelId: string,
): Promise<Record<string, unknown>> {
  let r: Awaited<ReturnType<typeof generateText>>;
  try {
    r = await generateText({ model, ...params } as Parameters<typeof generateText>[0]);
  } catch {
    return {
      id: newResponseId(), object: 'response', model: modelId,
      created_at: Math.floor(Date.now() / 1000), status: 'completed',
      output: [{ id: newItemId('msg'), type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '(conversation context was too large to summarize)' }] }],
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    };
  }
  const createdAt = Math.floor(Date.now() / 1000);
  const responseId = newResponseId();
  const output: unknown[] = [];

  if (r.reasoningText?.trim()) {
    output.push(makeReasoningOutputItem(newItemId('rs'), r.reasoningText));
  }

  if (r.text !== null && r.text !== undefined) {
    output.push({
      id: newItemId('msg'),
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: r.text }],
    });
  }

  for (const tc of r.toolCalls) {
    const encodedId = encodeToolUseId(tc.toolCallId, grabRoundTripSignature(tc as FullStreamPart));
    output.push({
      type: 'function_call',
      id: tc.toolCallId,
      call_id: encodedId,
      name: tc.toolName,
      arguments: JSON.stringify(tc.input ?? {}),
      status: 'completed',
    });
  }

  if (output.length === 0) {
    output.push({ id: newItemId('msg'), type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '(conversation context was too large to summarize)' }] });
  }

  const inputTokens = r.usage?.inputTokens ?? 0;
  const outputTokens = r.usage?.outputTokens ?? 0;

  return {
    id: responseId,
    object: 'response',
    model: modelId,
    created_at: createdAt,
    status: 'completed',
    output,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    },
  };
}

export function responsesErrorBody(
  modelId: string,
  message: string,
  statusCode = 401,
): Record<string, unknown> {
  return {
    id: newResponseId(),
    object: 'response',
    model: modelId,
    created_at: Math.floor(Date.now() / 1000),
    status: 'failed',
    output: [{ id: newItemId('msg'), type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '(conversation context was too large to summarize)' }] }],
    error: { message, type: statusCode === 429 ? 'rate_limit_error' : 'api_error', code: String(statusCode) },
  };
}

export function writeResponsesErrorStream(modelId: string, _message: string, write: WriteFn, _statusCode = 401): void {
  writeResponsesRateLimitStream(modelId, '(conversation context was too large to summarize)', write);
}

export function writeResponsesRateLimitStream(modelId: string, message: string, write: WriteFn): void {
  const responseId = newResponseId();
  const itemId = newItemId('msg');
  const createdAt = Math.floor(Date.now() / 1000);
  const content = [{ type: 'output_text', text: message }];
  write(sseChunk('response.output_item.added', {
    type: 'response.output_item.added',
    output_index: 0,
    item: { id: itemId, type: 'message', role: 'assistant', status: 'in_progress', content: [] },
  }));
  write(sseChunk('response.content_part.added', {
    type: 'response.content_part.added',
    item_id: itemId, output_index: 0, content_index: 0,
    part: { type: 'output_text', text: '' },
  }));
  write(sseChunk('response.output_text.delta', {
    type: 'response.output_text.delta',
    item_id: itemId, output_index: 0, content_index: 0,
    delta: message,
  }));
  write(sseChunk('response.output_text.done', {
    type: 'response.output_text.done',
    item_id: itemId, output_index: 0, content_index: 0,
    text: message,
  }));
  write(sseChunk('response.content_part.done', {
    type: 'response.content_part.done',
    item_id: itemId, output_index: 0, content_index: 0,
    part: { type: 'output_text', text: message },
  }));
  write(sseChunk('response.output_item.done', {
    type: 'response.output_item.done',
    output_index: 0,
    item: { id: itemId, type: 'message', role: 'assistant', status: 'completed', content },
  }));
  write(sseChunk('response.completed', {
    type: 'response.completed',
    response: {
      id: responseId, object: 'response', model: modelId, created_at: createdAt,
      status: 'completed',
      output: [{ id: itemId, type: 'message', role: 'assistant', status: 'completed', content }],
    },
  }));
}

export function responsesRateLimitBody(modelId: string, message: string): Record<string, unknown> {
  const itemId = newItemId('msg');
  const content = [{ type: 'output_text', text: message }];
  return {
    id: newResponseId(),
    object: 'response',
    model: modelId,
    created_at: Math.floor(Date.now() / 1000),
    status: 'completed',
    output: [{ id: itemId, type: 'message', role: 'assistant', status: 'completed', content }],
  };
}
