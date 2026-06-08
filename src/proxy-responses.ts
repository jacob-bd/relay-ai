// OpenAI Responses API translation (Anthropic ↔ /v1/responses).
// GPT-5.4+, Codex, and o-series models are not available on /v1/chat/completions.
// xAI multiagent models (grok-*-multi-agent) also require /v1/responses.

import { Readable } from 'node:stream';
import {
  attachSseLineReader,
  encodeToolUseId,
  extractSseDataPayload,
  parseToolArguments,
  serializeToolResultContent,
  splitToolUseId,
  sseChunk,
  stripToolUseIdSuffix,
} from './proxy-shared.js';
import { resolveUpstreamTools, isToolSearchTool } from './tool-search.js';
import type {
  AnthropicContentBlock,
  AnthropicMessage,
  AnthropicMessageRequest,
  AnthropicRequestContentPart,
  AnthropicRequestMessage,
} from './proxy-types.js';

/** Models that must use /v1/responses instead of /v1/chat/completions. */
const RESPONSES_ONLY_PREFIXES = [
  'gpt-5.4',
  'gpt-5.5',
  'gpt-5-codex',
  'gpt-5-pro',
  'gpt-5.2-pro',
  'o3',
  'o4',
];

export function isOpenAIChatCompletionsUrl(url: string): boolean {
  return (url.includes('api.openai.com') || url.includes('api.x.ai')) && url.includes('/chat/completions');
}

export function openAIResponsesUrl(completionsUrl: string): string {
  return completionsUrl.replace(/\/chat\/completions\/?$/, '/responses');
}

export function modelPrefersResponsesApi(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  if (RESPONSES_ONLY_PREFIXES.some(prefix => lower === prefix || lower.startsWith(`${prefix}-`))) {
    return true;
  }
  // Versioned Codex IDs (e.g. gpt-5.3-codex) don't match the gpt-5-codex prefix.
  if (lower.startsWith('gpt-') && lower.includes('-codex')) return true;
  // xAI multiagent models (e.g. grok-4.20-multi-agent, grok-4.2-multiagent).
  if (lower.startsWith('grok-') && (lower.includes('multi-agent') || lower.includes('multiagent'))) return true;
  return false;
}

function translateImagePart(part: Extract<AnthropicRequestContentPart, { type: 'image' }>): Record<string, unknown> | null {
  const src = part.source;
  if (src.type === 'url') {
    return { type: 'input_image', image_url: src.url };
  }
  if (src.type === 'base64') {
    return { type: 'input_image', image_url: `data:${src.media_type};base64,${src.data}` };
  }
  return null;
}

function userContentParts(parts: AnthropicRequestContentPart[]): unknown[] | string {
  const out: unknown[] = [];
  let text = '';

  for (const part of parts) {
    if (part.type === 'text') {
      text += (typeof part.text === 'string' ? part.text : JSON.stringify(part.text)) + '\n';
    } else if (part.type === 'image') {
      const img = translateImagePart(part);
      if (img) out.push(img);
    }
  }

  const trimmed = text.trim();
  if (out.length === 0) return trimmed;
  if (trimmed) out.unshift({ type: 'input_text', text: trimmed });
  return out;
}

function anthropicMessagesToResponsesInput(messages: AnthropicRequestMessage[] | undefined): unknown[] {
  const input: unknown[] = [];

  for (const msg of messages ?? []) {
    if (typeof msg.content === 'string') {
      if (msg.role === 'user') {
        input.push({ role: 'user', content: msg.content });
      } else {
        input.push({ role: 'assistant', content: msg.content });
      }
      continue;
    }

    if (msg.role === 'assistant') {
      let text = '';
      const toolCalls: unknown[] = [];

      for (const part of msg.content ?? []) {
        if (part.type === 'text') {
          text += (typeof part.text === 'string' ? part.text : JSON.stringify(part.text)) + '\n';
        } else if (part.type === 'tool_use') {
          const { rawId } = splitToolUseId(part.id);
          toolCalls.push({
            type: 'function_call',
            call_id: rawId,
            name: part.name,
            arguments: JSON.stringify(part.input ?? {}),
          });
        }
      }

      const trimmed = text.trim();
      if (trimmed) input.push({ role: 'assistant', content: trimmed });
      input.push(...toolCalls);
      continue;
    }

    if (msg.role === 'user') {
      const toolResults: unknown[] = [];
      const nonToolParts: AnthropicRequestContentPart[] = [];

      for (const part of msg.content ?? []) {
        if (part.type === 'tool_result') {
          toolResults.push({
            type: 'function_call_output',
            call_id: stripToolUseIdSuffix(part.tool_use_id),
            output: serializeToolResultContent(part.content),
          });
        } else {
          nonToolParts.push(part);
        }
      }

      if (nonToolParts.length > 0) {
        const content = userContentParts(nonToolParts);
        if (typeof content === 'string' ? content : (content as unknown[]).length > 0) {
          input.push({ role: 'user', content });
        }
      }
      input.push(...toolResults);
    }
  }

  return input;
}

function buildInstructions(system: AnthropicMessageRequest['system']): string | undefined {
  if (!system) return undefined;
  if (typeof system === 'string') return system;
  const text = system.map(s => s.text).filter(Boolean).join('\n\n');
  return text || undefined;
}

export function translateToResponses(body: AnthropicMessageRequest): Record<string, unknown> {
  const { model, messages, system, temperature, max_tokens, top_p, stop_sequences, tools, stream } = body;

  const data: Record<string, unknown> = {
    model,
    input: anthropicMessagesToResponsesInput(messages),
  };

  const instructions = buildInstructions(system);
  if (instructions) data.instructions = instructions;
  if (max_tokens !== undefined) data.max_output_tokens = max_tokens;
  if (temperature !== undefined) data.temperature = temperature;
  if (top_p !== undefined) data.top_p = top_p;
  if (stop_sequences?.length) data.stop = stop_sequences;
  if (stream !== undefined) data.stream = stream;

  const upstreamTools = resolveUpstreamTools(tools, messages);
  if (upstreamTools.length > 0) {
    data.tools = upstreamTools.map(tool => ({
      type: 'function',
      name: tool.name,
      description:
        typeof tool.description === 'string'
          ? tool.description
          : isToolSearchTool(tool)
            ? 'Search deferred tools by name or regex pattern'
            : undefined,
      parameters: tool.input_schema ?? { type: 'object', properties: {} },
    }));
    data.tool_choice = 'auto';
  }

  return data;
}

function extractOutputText(output: unknown[]): string {
  let text = '';
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    if (obj.type === 'message' && Array.isArray(obj.content)) {
      for (const part of obj.content) {
        if (part && typeof part === 'object' && (part as Record<string, unknown>).type === 'output_text') {
          text += String((part as Record<string, unknown>).text ?? '');
        }
      }
    }
    if (obj.type === 'output_text') {
      text += String(obj.text ?? '');
    }
  }
  return text;
}

function extractFunctionCalls(output: unknown[]): AnthropicContentBlock[] {
  const blocks: AnthropicContentBlock[] = [];
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    if (obj.type !== 'function_call') continue;
    const callId = String(obj.call_id ?? obj.id ?? `call_${Date.now()}`);
    blocks.push({
      type: 'tool_use',
      id: callId,
      name: String(obj.name ?? ''),
      input: parseToolArguments(obj.arguments),
    });
  }
  return blocks;
}

export function translateFromResponses(response: Record<string, unknown>, model: string): AnthropicMessage {
  const messageId = 'msg_' + Date.now();
  const output = Array.isArray(response.output) ? response.output : [];
  const content: AnthropicContentBlock[] = [];

  const text =
    typeof response.output_text === 'string' && response.output_text
      ? response.output_text
      : extractOutputText(output);
  if (text) content.push({ type: 'text', text });

  content.push(...extractFunctionCalls(output));

  const hasToolUse = content.some(b => b.type === 'tool_use');
  let stop_reason = 'end_turn';
  if (hasToolUse) stop_reason = 'tool_use';
  else if (response.status === 'incomplete') stop_reason = 'max_tokens';

  const usage = response.usage as Record<string, unknown> | undefined;

  return {
    id: messageId,
    type: 'message',
    role: 'assistant',
    content,
    stop_reason,
    stop_sequence: null,
    model,
    usage: {
      input_tokens: Number(usage?.input_tokens ?? 0),
      output_tokens: Number(usage?.output_tokens ?? 0),
      cache_read_input_tokens: Number(
        (usage?.input_tokens_details as Record<string, unknown> | undefined)?.cached_tokens ?? 0,
      ),
      cache_creation_input_tokens: 0,
    },
  };
}

export function translateStreamResponses(upstreamBody: NodeJS.ReadableStream, model: string): Readable {
  const messageId = 'msg_' + Date.now();
  let contentBlockIndex = -1;
  let hasStartedTextBlock = false;
  let messageStarted = false;
  let finishReason: string | null = null;
  let lastUsage: AnthropicMessage['usage'] = { input_tokens: 0, output_tokens: 0 };

  const toolState: Map<number, {
    callId: string;
    name?: string;
    blockIndex: number;
    emitted: boolean;
  }> = new Map();

  const output = new Readable({ read() {} });

  function emitSSE(eventType: string, data: unknown) {
    output.push(sseChunk(eventType, data));
  }

  function emitMessageStart() {
    if (messageStarted) return;
    emitSSE('message_start', {
      type: 'message_start',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        content: [],
        model,
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
    messageStarted = true;
  }

  function flushToolCallStart(outputIndex: number) {
    const state = toolState.get(outputIndex);
    if (!state || state.emitted) return;
    emitSSE('content_block_start', {
      type: 'content_block_start',
      index: state.blockIndex,
      content_block: { type: 'tool_use', id: state.callId, name: state.name ?? '', input: {} },
    });
    state.emitted = true;
  }

  function closeCurrentBlock() {
    if (hasStartedTextBlock) {
      emitSSE('content_block_stop', { type: 'content_block_stop', index: contentBlockIndex });
      hasStartedTextBlock = false;
    }
  }

  function processEvent(event: Record<string, unknown>) {
    const type = String(event.type ?? '');

    if (type === 'response.completed') {
      const response = event.response as Record<string, unknown> | undefined;
      const usage = response?.usage as Record<string, unknown> | undefined;
      if (usage) {
        lastUsage = {
          input_tokens: Number(usage.input_tokens ?? 0),
          output_tokens: Number(usage.output_tokens ?? 0),
          cache_read_input_tokens: Number(
            (usage.input_tokens_details as Record<string, unknown> | undefined)?.cached_tokens ?? 0,
          ),
          cache_creation_input_tokens: 0,
        };
      }
      const outputItems = Array.isArray(response?.output) ? response!.output as unknown[] : [];
      if (outputItems.some(item => item && typeof item === 'object' && (item as Record<string, unknown>).type === 'function_call')) {
        finishReason = 'tool_calls';
      } else if (response?.status === 'incomplete') {
        finishReason = 'length';
      } else {
        finishReason = 'stop';
      }
      return;
    }

    if (type === 'response.output_text.delta') {
      const delta = String(event.delta ?? '');
      if (!delta) return;
      if (!hasStartedTextBlock) {
        closeCurrentBlock();
        contentBlockIndex++;
        emitMessageStart();
        emitSSE('content_block_start', {
          type: 'content_block_start',
          index: contentBlockIndex,
          content_block: { type: 'text', text: '' },
        });
        hasStartedTextBlock = true;
      }
      emitSSE('content_block_delta', {
        type: 'content_block_delta',
        index: contentBlockIndex,
        delta: { type: 'text_delta', text: delta },
      });
      return;
    }

    if (type === 'response.output_item.added') {
      const item = event.item as Record<string, unknown> | undefined;
      if (item?.type !== 'function_call') return;
      const outputIndex = Number(event.output_index ?? 0);
      closeCurrentBlock();
      contentBlockIndex++;
      emitMessageStart();
      toolState.set(outputIndex, {
        callId: String(item.call_id ?? item.id ?? `call_${Date.now()}`),
        name: typeof item.name === 'string' ? item.name : undefined,
        blockIndex: contentBlockIndex,
        emitted: false,
      });
      return;
    }

    if (type === 'response.function_call_arguments.delta') {
      const outputIndex = Number(event.output_index ?? 0);
      flushToolCallStart(outputIndex);
      const delta = String(event.delta ?? '');
      if (delta) {
        emitSSE('content_block_delta', {
          type: 'content_block_delta',
          index: contentBlockIndex,
          delta: { type: 'input_json_delta', partial_json: delta },
        });
      }
      return;
    }

    if (type === 'response.function_call_arguments.done') {
      const outputIndex = Number(event.output_index ?? 0);
      const state = toolState.get(outputIndex);
      if (state && typeof event.name === 'string') state.name = event.name;
      flushToolCallStart(outputIndex);
    }
  }

  function processLine(line: string) {
    const data = extractSseDataPayload(line);
    if (!data) return;
    try {
      processEvent(JSON.parse(data) as Record<string, unknown>);
    } catch { /* skip malformed chunks */ }
  }

  function finish() {
    closeCurrentBlock();
    for (const [outputIndex] of toolState) flushToolCallStart(outputIndex);
    for (const state of toolState.values()) {
      if (state.emitted) {
        emitSSE('content_block_stop', { type: 'content_block_stop', index: state.blockIndex });
      }
    }
    emitMessageStart();

    let stopReason = 'end_turn';
    if (finishReason === 'tool_calls') stopReason = 'tool_use';
    else if (finishReason === 'length') stopReason = 'max_tokens';

    emitSSE('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: lastUsage,
    });
    emitSSE('message_stop', { type: 'message_stop' });
    output.push(null);
  }

  attachSseLineReader(upstreamBody, (line) => {
    if (line.trim()) processLine(line);
  }, finish);

  return output;
}
