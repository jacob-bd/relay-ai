// OpenAI Responses API (/v1/responses) ↔ Vercel AI SDK. One turn per request; Codex owns the tool loop.
import { streamText, generateText, tool, jsonSchema } from 'ai';
import type { LanguageModel, ModelMessage, ToolSet } from 'ai';
import {
  sseChunk,
  encodeToolUseId,
  splitToolUseId,
  serializeToolResultContent,
  parseToolArguments,
  silenceSdkWarnings,
  grabRoundTripSignature,
  parseDsmlToolCalls,
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

export interface ResponsesFunctionTool {
  type: 'function';
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

/**
 * Codex App's proprietary wrapper for MCP server tools. The real ChatGPT backend
 * unwraps this server-side before the model ever sees it; custom Responses-API
 * providers (us) receive it as-is and must flatten it themselves, or the model
 * never sees any usable MCP tools. See translateResponsesTools.
 */
export interface ResponsesNamespaceTool {
  type: 'namespace';
  name: string;
  description?: string;
  tools: ResponsesFunctionTool[];
}

export type ResponsesTool = ResponsesFunctionTool | ResponsesNamespaceTool;

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
  instructions?: string;
  messages: ModelMessage[];
  tools?: ToolSet;
  maxOutputTokens?: number;
  temperature?: number;
  providerOptions?: Record<string, Record<string, unknown>>;
}

export interface TranslateToolOptions {
  maxTools?: number;
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
): { instructions?: string; messages: ModelMessage[] } {
  if (typeof input === 'string') {
    return {
      instructions: instructions?.trim() || undefined,
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
    instructions: system,
    messages: ensureUserFirst(mergeConsecutiveMessages(messages)),
  };
}

export function translateResponsesTools(
  tools?: ResponsesTool[],
  options: TranslateToolOptions = {},
): CodexSdkCallParams['tools'] {
  if (!tools?.length) return undefined;
  const out: Record<string, ReturnType<typeof tool>> = {};
  let toolCount = 0;
  const addTool = (name: string, definition: ResponsesFunctionTool): void => {
    if (options.maxTools !== undefined && toolCount >= options.maxTools) return;
    out[name] = tool({
      description: definition.description ?? '',
      inputSchema: jsonSchema(definition.parameters ?? { type: 'object', properties: {} }),
    });
    toolCount++;
  };

  for (const t of tools) {
    if (t.type === 'namespace') {
      // Flatten "mcp__<server>" + nested "query_docs" -> "mcp__<server>__query_docs",
      // matching Codex's own flattened-name convention so the model's tool_call name
      // round-trips back to Codex's dispatcher unchanged.
      for (const nested of t.tools ?? []) {
        if (nested.type !== 'function' || !nested.name) continue;
        addTool(`${t.name}__${nested.name}`, nested);
      }
      continue;
    }
    if (t.type !== 'function' || !t.name) continue;
    addTool(t.name, t);
  }
  return Object.keys(out).length ? out : undefined;
}

export function translateResponsesRequest(
  body: ResponsesRequest,
  npm: string,
  metadata?: ReasoningMetadata,
  options: TranslateToolOptions = {},
): CodexSdkCallParams {
  const { instructions, messages } = translateResponsesInput(body.input, body.instructions, npm);
  const effort = body.reasoning?.effort;
  const providerOptions = deepMergeProviderOptions(
    thinkingProviderOptions(npm),
    effortProviderOptions(npm, effort, metadata?.upstreamModelId ?? body.model, metadata),
  );
  const tools = translateResponsesTools(body.tools, options);
  return {
    instructions,
    messages,
    tools,
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

export interface ResponsesStreamSummary {
  reasoningChars: number;
  reasoningPreview: string;
  textChars: number;
  toolCallCount: number;
  toolNames: string[];
  /** Set when writeResponsesStream force-stopped the generation early — see REPEAT_TAIL_CHARS. */
  loopDetected?: 'reasoning' | 'text';
  /** Set when leaked DeepSeek DSML tool-call markup was recovered into real function calls. */
  dsmlToolCallsRecovered?: number;
  /** Set when the stream was aborted (idle timeout — upstream stopped sending data). */
  aborted?: boolean;
  /** Set when the stream ended with an upstream error part (e.g. HTTP 4xx/5xx). */
  errorMessage?: string;
}

export interface ResponsesStreamProgress {
  reasoningChars: number;
  reasoningTail: string;
  textChars: number;
  toolCallCount: number;
  elapsedMs: number;
}

/** Minimum time between onProgress calls, so a genuinely runaway/looping generation is
 *  still visible in the trace log before (or instead of) a final onDone summary. */
const PROGRESS_INTERVAL_MS = 3_000;

/**
 * Observed live: xAI grok-4.5 given a large, tools-stripped compaction request can finish
 * reasoning normally, then free-run regenerating an identical block of text forever instead
 * of reaching `finish` (same trailing 200 chars unchanged across dozens of progress checks
 * while textChars kept climbing). Checked on the same cadence as onProgress, independent of
 * whether tracing is enabled — this is a safety mechanism, not a debug feature.
 */
const REPEAT_TAIL_CHARS = 200;
/** Consecutive stale-tail checks (each PROGRESS_INTERVAL_MS apart) before concluding the
 *  model is looping rather than coincidentally producing similar output between checks. */
const REPEAT_STREAK_LIMIT = 3;
const LOOP_NOTICE = '\n\n[relay-ai: generation stopped after detecting a repetition loop]';

interface RepeatTracker {
  tail: string;
  len: number;
  streak: number;
}

const INITIAL_REPEAT_TRACKER: RepeatTracker = { tail: '', len: 0, streak: 0 };

/** Stale tail + substantial continued growth = regenerating the same content, not just
 *  naturally ending on similar words. Requiring both avoids false positives on a stream
 *  that briefly stalls with no new output at all. */
function trackRepetition(current: string, prev: RepeatTracker): RepeatTracker {
  const tail = current.length >= REPEAT_TAIL_CHARS ? current.slice(-REPEAT_TAIL_CHARS) : current;
  const grew = current.length - prev.len >= REPEAT_TAIL_CHARS;
  const stale = tail.length === REPEAT_TAIL_CHARS && tail === prev.tail && grew;
  return { tail, len: current.length, streak: stale ? prev.streak + 1 : 0 };
}

export interface WriteResponsesStreamOptions {
  /** Called when the stream is force-stopped (repetition loop) BEFORE breaking out of
   *  stream. Breaking alone does not cancel the SDK's upstream request — the SDK
   *  keeps consuming internally to settle its own promises — so the caller must abort. */
  onForceStop?: (reason: string) => void;
}

export async function writeResponsesStream(
  stream: AsyncIterable<FullStreamPart>,
  modelId: string,
  write: WriteFn,
  onDone?: (summary: ResponsesStreamSummary) => void,
  onProgress?: (progress: ResponsesStreamProgress) => void,
  options?: WriteResponsesStreamOptions,
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
  const streamStartedAt = Date.now();
  let lastProgressAt = streamStartedAt;
  let reasoningItemId: string | null = null;
  let reasoningText = '';
  let reasoningOutputIndex = 0;
  const outputItems: unknown[] = [];
  let reasoningRepeat = INITIAL_REPEAT_TRACKER;
  let textRepeat = INITIAL_REPEAT_TRACKER;
  let loopDetected: 'reasoning' | 'text' | undefined;

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
      callId: encodeToolUseId(itemId, signature, false),
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

  for await (const part of stream) {
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

      case 'abort': {
        // The SDK ends the stream cleanly after an abort (no throw), so without
        // this case a timed-out request would finalize as status:"completed" and
        // Codex would treat dead-connection silence as a valid empty answer.
        const msg = `stream aborted: ${part.reason ?? 'no data received from provider'}`;
        process.stderr.write(`[relay-ai] ${modelId}: ${msg}\n`);
        onDone?.({
          reasoningChars: reasoningText.length,
          reasoningPreview: reasoningText.slice(0, 200),
          textChars: textFull.length,
          toolCallCount: toolStates.length,
          toolNames: toolStates.map(t => t.name),
          loopDetected,
          aborted: true,
        });
        emit('response.completed', {
          type: 'response.completed',
          response: {
            id: responseId,
            object: 'response',
            model: modelId,
            created_at: createdAt,
            status: 'failed',
            output: [],
            error: { message: msg, type: 'api_error' },
          },
        });
        return;
      }

      case 'error': {
        const msg = formatUpstreamError(part.error);
        const is429 = msg.includes('429') ||
          (part.error && typeof part.error === 'object' &&
            ((part.error as { statusCode?: number }).statusCode === 429 ||
             (part.error as { lastError?: { statusCode?: number } }).lastError?.statusCode === 429));
        process.stderr.write(`[relay-ai] ${modelId}: ${msg}\n`);
        onDone?.({
          reasoningChars: reasoningText.length,
          reasoningPreview: reasoningText.slice(0, 200),
          textChars: textFull.length,
          toolCallCount: toolStates.length,
          toolNames: toolStates.map(t => t.name),
          loopDetected,
          errorMessage: msg,
        });
        if (is429) {
          writeResponsesRateLimitStream(modelId, msg, write);
        } else {
          emit('response.completed', {
            type: 'response.completed',
            response: {
              id: responseId,
              object: 'response',
              model: modelId,
              created_at: createdAt,
              status: 'failed',
              output: [],
              error: { message: msg, type: 'api_error' },
            },
          });
        }
        return;
      }

      default:
        break;
    }

    const now = Date.now();
    if (now - lastProgressAt >= PROGRESS_INTERVAL_MS) {
      lastProgressAt = now;
      reasoningRepeat = trackRepetition(reasoningText, reasoningRepeat);
      textRepeat = trackRepetition(textFull, textRepeat);
      if (reasoningRepeat.streak >= REPEAT_STREAK_LIMIT) loopDetected = 'reasoning';
      else if (textRepeat.streak >= REPEAT_STREAK_LIMIT) loopDetected = 'text';

      if (onProgress) {
        onProgress({
          reasoningChars: reasoningText.length,
          reasoningTail: reasoningText.slice(-200),
          textChars: textFull.length,
          toolCallCount: toolStates.length,
          elapsedMs: now - streamStartedAt,
        });
      }

      if (loopDetected) {
        options?.onForceStop?.(`repetition loop detected (${loopDetected})`);
        break;
      }
    }
  }

  if (loopDetected) {
    ensureTextItem();
    textFull += LOOP_NOTICE;
    emit('response.output_text.delta', {
      type: 'response.output_text.delta',
      item_id: textItemId,
      output_index: textOutputIndex,
      content_index: 0,
      delta: LOOP_NOTICE,
    });
  }

  const dsml = loopDetected ? null : parseDsmlToolCalls(textFull);

  if (dsml) {
    // The client already streamed the raw DSML markup live as ordinary text-delta events
    // (we don't know it's a tool-call block until the closing tag arrives) - but the
    // *final* output is what Codex actually acts on, so replace the garbled text item
    // with the real function calls the model intended, matching a normal tool-call turn.
    if (dsml.leadingText && textItemId) {
      emit('response.output_text.done', {
        type: 'response.output_text.done',
        item_id: textItemId,
        output_index: textOutputIndex,
        content_index: 0,
        text: dsml.leadingText,
      });
      emit('response.content_part.done', {
        type: 'response.content_part.done',
        item_id: textItemId,
        output_index: textOutputIndex,
        content_index: 0,
        part: { type: 'output_text', text: dsml.leadingText },
      });
      const textItem = {
        id: textItemId,
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: dsml.leadingText }],
      };
      emit('response.output_item.done', {
        type: 'response.output_item.done',
        output_index: textOutputIndex,
        item: textItem,
      });
      outputItems.push(textItem);
    }
    for (const call of dsml.calls) {
      const itemId = newItemId('fc');
      const callId = encodeToolUseId(itemId, undefined, false);
      const idx = outputIndex++;
      const args = JSON.stringify(call.args);
      emit('response.output_item.added', {
        type: 'response.output_item.added',
        output_index: idx,
        item: { type: 'function_call', id: itemId, call_id: callId, name: call.name, arguments: '', status: 'in_progress' },
      });
      emit('response.function_call_arguments.done', {
        type: 'response.function_call_arguments.done',
        item_id: itemId,
        output_index: idx,
        arguments: args,
      });
      const fcItem = { type: 'function_call', id: itemId, call_id: callId, name: call.name, arguments: args, status: 'completed' };
      emit('response.output_item.done', { type: 'response.output_item.done', output_index: idx, item: fcItem });
      outputItems.push(fcItem);
    }
  } else if (textItemId) {
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

  onDone?.({
    reasoningChars: reasoningText.length,
    reasoningPreview: reasoningText.slice(0, 200),
    textChars: textFull.length,
    toolCallCount: toolStates.length,
    toolNames: toolStates.map(t => t.name),
    loopDetected,
    dsmlToolCallsRecovered: dsml?.calls.length,
  });

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

/**
 * Observed live: OpenCode Zen silently dropped an upstream connection before sending a
 * single byte — no HTTP error, no stream error, no TCP reset our fetch could see. With
 * no timeout anywhere in this path, the `for await` over the SDK stream waited forever and
 * every safety mechanism (progress logging, repetition detector) was invisible because
 * they only run when a part arrives. This watchdog is armed immediately (unlike the
 * SDK's `timeout.chunkMs`, which only arms after the first chunk) and reset on every
 * part, so it bounds both zero-byte hangs and mid-stream connection death.
 */
const STREAM_IDLE_TIMEOUT_MS = 120_000;

export interface StreamResponsesOptions {
  idleTimeoutMs?: number;
}

export async function streamResponsesResponse(
  model: LanguageModel,
  params: CodexSdkCallParams,
  modelId: string,
  write: WriteFn,
  onDone?: (summary: ResponsesStreamSummary) => void,
  onProgress?: (progress: ResponsesStreamProgress) => void,
  options?: StreamResponsesOptions,
): Promise<void> {
  const idleTimeoutMs = options?.idleTimeoutMs ?? STREAM_IDLE_TIMEOUT_MS;
  const abort = new AbortController();
  let idleTimer = setTimeout(
    () => abort.abort(new Error(`no data received from provider for ${Math.round(idleTimeoutMs / 1000)}s`)),
    idleTimeoutMs,
  );

  const result = streamText({ model, ...params, abortSignal: abort.signal, onError: () => {} } as Parameters<typeof streamText>[0]);
  // Prevent unhandled promise rejections on stream properties:
  Promise.resolve(result.text).catch(() => {});
  Promise.resolve(result.toolCalls).catch(() => {});
  Promise.resolve(result.toolResults).catch(() => {});
  Promise.resolve(result.finishReason).catch(() => {});
  Promise.resolve(result.usage).catch(() => {});
  Promise.resolve(result.response).catch(() => {});

  const watchedStream = (async function* () {
    try {
      for await (const part of result.stream as AsyncIterable<FullStreamPart>) {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(
          () => abort.abort(new Error(`no data received from provider for ${Math.round(idleTimeoutMs / 1000)}s`)),
          idleTimeoutMs,
        );
        yield part;
      }
    } finally {
      clearTimeout(idleTimer);
    }
  })();

  await writeResponsesStream(watchedStream, modelId, write, onDone, onProgress, {
    onForceStop: reason => abort.abort(new Error(reason)),
  });
}

export async function generateResponsesResponse(
  model: LanguageModel,
  params: CodexSdkCallParams,
  modelId: string,
): Promise<Record<string, unknown>> {
  const r = await generateText({ model, ...params } as Parameters<typeof generateText>[0]);
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
    const encodedId = encodeToolUseId(tc.toolCallId, grabRoundTripSignature(tc as FullStreamPart), false);
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
    output: [],
    error: { message, type: statusCode === 429 ? 'rate_limit_error' : 'api_error', code: String(statusCode) },
  };
}

export function writeResponsesErrorStream(modelId: string, message: string, write: WriteFn, statusCode = 401): void {
  write(sseChunk('response.completed', {
    type: 'response.completed',
    response: responsesErrorBody(modelId, message, statusCode),
  }));
}

export function writeResponsesRateLimitStream(modelId: string, message: string, write: WriteFn): void {
  const responseId = newResponseId();
  const itemId = newItemId('msg');
  const createdAt = Math.floor(Date.now() / 1000);
  const content = [{ type: 'output_text', text: message }];
  write(sseChunk('response.created', {
    type: 'response.created',
    response: {
      id: responseId,
      object: 'response',
      model: modelId,
      created_at: createdAt,
      status: 'in_progress',
      output: [],
    },
  }));
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
