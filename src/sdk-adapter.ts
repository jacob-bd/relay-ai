// Anthropic /v1/messages ↔ Vercel AI SDK. One turn per request; Claude Code owns the tool loop.
import { streamText, generateText, tool, jsonSchema } from 'ai';
import type { LanguageModel, ModelMessage } from 'ai';
import {
  sseChunk,
  encodeToolUseId,
  splitToolUseId,
  serializeToolResultContent,
} from './proxy-shared.js';
import { thinkingProviderOptions } from './provider-factory.js';
import { resolveUpstreamTools } from './tool-search.js';
import type { AnthropicRequestMessage, AnthropicToolDefinition } from './proxy-types.js';

let sdkWarningsSilenced = false;

/** Keep Vercel AI SDK warnings off stderr — they bleed into Claude Code's TUI. */
export function silenceSdkWarnings(): void {
  if (sdkWarningsSilenced) return;
  sdkWarningsSilenced = true;
  (globalThis as { AI_SDK_LOG_WARNINGS?: false }).AI_SDK_LOG_WARNINGS = false;
}

// ── Anthropic request shapes (only the fields we read) ───────────────────────
interface AnthropicBlock {
  type: string;
  text?: string;
  thinking?: string;
  signature?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
  source?: { type: 'base64' | 'url'; media_type?: string; data?: string; url?: string };
  // internal: resolved tool name for a tool_result, set by annotateToolNames
  _name?: string;
}
interface AnthropicMsg { role: 'user' | 'assistant' | 'system'; content: string | AnthropicBlock[]; }
interface AnthropicTool { name: string; description?: string; input_schema: Record<string, unknown>; }
export interface AnthropicRequest {
  model: string;
  system?: string | Array<string | { text?: string }>;
  messages: AnthropicMsg[];
  tools?: AnthropicTool[];
  tool_choice?: { type: 'auto' | 'any' | 'tool'; name?: string };
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
}

export interface SdkCallParams {
  system?: string;
  messages: ModelMessage[];
  tools?: Record<string, ReturnType<typeof tool>>;
  toolChoice?: 'auto' | 'required' | { type: 'tool'; toolName: string };
  maxOutputTokens?: number;
  temperature?: number;
  providerOptions?: Record<string, Record<string, unknown>>;
}

// ── system ───────────────────────────────────────────────────────────────────
function systemToString(system: AnthropicRequest['system']): string | undefined {
  if (!system) return undefined;
  if (typeof system === 'string') return system;
  return system.map(b => (typeof b === 'string' ? b : b.text ?? '')).join('\n');
}

// Claude Code injects context (skills list, system-reminders) as role:'system'
// messages inside the messages array — fold into the system prompt so they aren't dropped.
function inlineSystemText(messages: AnthropicMsg[]): string[] {
  const parts: string[] = [];
  for (const msg of messages) {
    if (msg.role !== 'system') continue;
    const text = typeof msg.content === 'string'
      ? msg.content
      : msg.content.map(b => b.text ?? '').join('\n');
    if (text.trim()) parts.push(text.trim());
  }
  return parts;
}

// ── images ───────────────────────────────────────────────────────────────────
function imagePart(block: AnthropicBlock): { type: 'image'; image: Uint8Array | URL; mediaType?: string } | null {
  const src = block.source;
  if (!src) return null;
  if (src.type === 'base64' && src.data) {
    return { type: 'image', image: Buffer.from(src.data, 'base64'), mediaType: src.media_type };
  }
  if (src.type === 'url' && src.url) {
    return { type: 'image', image: new URL(src.url) };
  }
  return null;
}

// ── tool_result name resolution (tool messages need the tool name) ────────────
export function annotateToolNames(messages: AnthropicMsg[]): void {
  const nameById = new Map<string, string>();
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const b of msg.content) {
      if (b.type === 'tool_use' && b.id && b.name) nameById.set(splitToolUseId(b.id).rawId, b.name);
    }
  }
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const b of msg.content) {
      if (b.type === 'tool_result' && b.tool_use_id) {
        b._name = nameById.get(splitToolUseId(b.tool_use_id).rawId);
      }
    }
  }
}

function thinkingToSdkPart(
  block: AnthropicBlock,
  npm: string,
): Record<string, unknown> | null {
  if (npm !== '@ai-sdk/google' && npm !== '@ai-sdk/openai') return null;

  const text = block.thinking ?? '';
  if (npm === '@ai-sdk/openai' && !block.signature && !text.trim()) return null;

  const part: Record<string, unknown> = { type: 'reasoning', text };
  if (block.signature) {
    part.providerOptions = npm === '@ai-sdk/google'
      ? { google: { thoughtSignature: block.signature } }
      : { openai: { reasoningEncryptedContent: block.signature } };
  }
  return part;
}

// ── messages: Anthropic → SDK ModelMessage[] ─────────────────────────────────
export function translateMessages(messages: AnthropicMsg[], npm: string): ModelMessage[] {
  const isGoogle = npm === '@ai-sdk/google';
  const out: ModelMessage[] = [];

  for (const msg of messages) {
    const blocks: AnthropicBlock[] = typeof msg.content === 'string'
      ? [{ type: 'text', text: msg.content }]
      : msg.content ?? [];

    if (msg.role === 'user') {
      const toolResults = blocks.filter(b => b.type === 'tool_result');
      const parts: Array<Record<string, unknown>> = [];
      for (const b of blocks) {
        if (b.type === 'text') parts.push({ type: 'text', text: b.text ?? '' });
        else if (b.type === 'image') { const p = imagePart(b); if (p) parts.push(p); }
      }
      if (toolResults.length) {
        out.push({
          role: 'tool',
          content: toolResults.map(tr => ({
            type: 'tool-result',
            toolCallId: splitToolUseId(tr.tool_use_id ?? '').rawId,
            toolName: tr._name ?? 'unknown',
            output: { type: 'text', value: serializeToolResultContent(tr.content) },
          })),
        } as unknown as ModelMessage);
      }
      if (parts.length) out.push({ role: 'user', content: parts } as unknown as ModelMessage);
    } else if (msg.role === 'assistant') {
      const parts: Array<Record<string, unknown>> = [];
      for (const b of blocks) {
        if (b.type === 'text') {
          parts.push({ type: 'text', text: b.text ?? '' });
        } else if (b.type === 'thinking') {
          const part = thinkingToSdkPart(b, npm);
          if (part) parts.push(part);
        } else if (b.type === 'tool_use' && b.id) {
          const { rawId, thoughtSignature } = splitToolUseId(b.id);
          const part: Record<string, unknown> = {
            type: 'tool-call', toolCallId: rawId, toolName: b.name, input: b.input ?? {},
          };
          if (thoughtSignature && isGoogle) part.providerOptions = { google: { thoughtSignature } };
          parts.push(part);
        }
      }
      if (parts.length) out.push({ role: 'assistant', content: parts } as unknown as ModelMessage);
    }
  }
  return out;
}

export function translateTools(anthropicTools?: AnthropicTool[]): Record<string, ReturnType<typeof tool>> | undefined {
  if (!anthropicTools?.length) return undefined;
  const tools: Record<string, ReturnType<typeof tool>> = {};
  for (const t of anthropicTools) {
    if (!t.name || !t.input_schema) continue;
    tools[t.name] = tool({ description: t.description ?? '', inputSchema: jsonSchema(t.input_schema) });
  }
  return Object.keys(tools).length ? tools : undefined;
}

export function translateToolChoice(tc: AnthropicRequest['tool_choice']): SdkCallParams['toolChoice'] {
  if (!tc) return undefined;
  if (tc.type === 'auto') return 'auto';
  if (tc.type === 'any') return 'required';
  if (tc.type === 'tool' && tc.name) return { type: 'tool', toolName: tc.name };
  return undefined;
}

export function translateRequest(body: AnthropicRequest, npm: string): SdkCallParams {
  const messages = body.messages ?? [];
  annotateToolNames(messages);

  // Fold inline role:'system' messages (skills list, system-reminders) into the
  // system prompt so they aren't dropped.
  const baseSystem = systemToString(body.system);
  const inlineParts = inlineSystemText(messages);
  const system = [baseSystem, ...inlineParts].filter(s => s && s.trim()).join('\n\n') || undefined;

  // resolveUpstreamTools uses the shared proxy types; the adapter keeps its own
  // minimal request shapes, so cast at this boundary.
  const upstreamTools = resolveUpstreamTools(
    body.tools as unknown as AnthropicToolDefinition[] | undefined,
    messages as unknown as AnthropicRequestMessage[],
  ) as unknown as AnthropicTool[];
  return {
    system,
    messages: translateMessages(messages, npm),
    tools: translateTools(upstreamTools.length ? upstreamTools : undefined),
    toolChoice: translateToolChoice(body.tool_choice),
    maxOutputTokens: body.max_tokens,
    temperature: body.temperature,
    providerOptions: thinkingProviderOptions(npm),
  };
}

// ── response: SDK fullStream → Anthropic SSE ─────────────────────────────────
type WriteFn = (chunk: string) => void;
type FullStreamPart = {
  type: string;
  id?: string;
  text?: string;
  delta?: string;
  toolName?: string;
  toolCallId?: string;
  input?: unknown;
  finishReason?: string;
  totalUsage?: { inputTokens?: number; outputTokens?: number };
  providerMetadata?: {
    google?: { thoughtSignature?: string; thought_signature?: string };
    openai?: { reasoningEncryptedContent?: string | null };
  };
  error?: unknown;
};

/** Opaque provider blob for round-trip in Anthropic thinking.signature / tool_use id. */
function grabRoundTripSignature(part: FullStreamPart): string | undefined {
  const md = part.providerMetadata;
  return md?.google?.thoughtSignature
    ?? md?.google?.thought_signature
    ?? md?.openai?.reasoningEncryptedContent
    ?? undefined;
}

type LogFn = (msg: () => string) => void;

export async function writeAnthropicStream(
  fullStream: AsyncIterable<FullStreamPart>,
  modelId: string,
  write: WriteFn,
  log?: LogFn,
): Promise<void> {
  const messageId = 'msg_' + Date.now();
  let blockIndex = -1;
  let started = false;
  let openType: 'text' | 'thinking' | 'tool' | null = null;
  let pendingThinkingSig: string | undefined;
  const idToBlock = new Map<string, number>();
  let finishReason = 'end_turn';
  let usage = { input_tokens: 0, output_tokens: 0 };

  const emit = (event: string, data: unknown) => write(sseChunk(event, data));
  const ensureStart = () => {
    if (started) return;
    emit('message_start', {
      type: 'message_start',
      message: {
        id: messageId, type: 'message', role: 'assistant', content: [],
        model: modelId, stop_reason: null, stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
    started = true;
  };
  const closeOpen = () => {
    if (openType === 'thinking') {
      emit('content_block_delta', {
        type: 'content_block_delta', index: blockIndex,
        delta: { type: 'signature_delta', signature: pendingThinkingSig ?? '' },
      });
      pendingThinkingSig = undefined;
    }
    if (openType) emit('content_block_stop', { type: 'content_block_stop', index: blockIndex });
    openType = null;
  };
  const openBlock = (type: 'text' | 'thinking' | 'tool', contentBlock: unknown) => {
    ensureStart(); closeOpen(); blockIndex++; openType = type;
    emit('content_block_start', { type: 'content_block_start', index: blockIndex, content_block: contentBlock });
  };

  for await (const part of fullStream) {
    switch (part.type) {
      case 'start': ensureStart(); break;

      case 'reasoning-start':
        openBlock('thinking', { type: 'thinking', thinking: '', signature: '' });
        break;
      case 'reasoning-delta':
        if (openType !== 'thinking') openBlock('thinking', { type: 'thinking', thinking: '', signature: '' });
        emit('content_block_delta', {
          type: 'content_block_delta', index: blockIndex,
          delta: { type: 'thinking_delta', thinking: part.text ?? '' },
        });
        break;
      case 'reasoning-end': {
        const sig = grabRoundTripSignature(part);
        if (sig) pendingThinkingSig = sig;
        break;
      }

      case 'text-start':
        openBlock('text', { type: 'text', text: '' });
        break;
      case 'text-delta':
        if (openType !== 'text') openBlock('text', { type: 'text', text: '' });
        emit('content_block_delta', {
          type: 'content_block_delta', index: blockIndex,
          delta: { type: 'text_delta', text: part.text ?? '' },
        });
        break;
      case 'text-end': break;

      case 'tool-input-start': {
        const sig = grabRoundTripSignature(part);
        openBlock('tool', {
          type: 'tool_use', id: encodeToolUseId(part.id ?? '', sig), name: part.toolName, input: {},
        });
        idToBlock.set(part.id ?? '', blockIndex);
        break;
      }
      case 'tool-input-delta':
        emit('content_block_delta', {
          type: 'content_block_delta', index: idToBlock.get(part.id ?? '') ?? blockIndex,
          delta: { type: 'input_json_delta', partial_json: part.delta ?? part.text ?? '' },
        });
        break;
      case 'tool-input-end': break;

      case 'tool-call': {
        finishReason = 'tool_use';
        // Non-streamed tool call (no input-start/delta arrived): emit a full block.
        if (!idToBlock.has(part.toolCallId ?? '') && openType !== 'tool') {
          const sig = grabRoundTripSignature(part);
          openBlock('tool', {
            type: 'tool_use', id: encodeToolUseId(part.toolCallId ?? '', sig), name: part.toolName, input: {},
          });
          emit('content_block_delta', {
            type: 'content_block_delta', index: blockIndex,
            delta: { type: 'input_json_delta', partial_json: JSON.stringify(part.input ?? {}) },
          });
        }
        break;
      }

      case 'finish':
        if (part.totalUsage) {
          usage = {
            input_tokens: part.totalUsage.inputTokens ?? 0,
            output_tokens: part.totalUsage.outputTokens ?? 0,
          };
        }
        if (part.finishReason === 'tool-calls') finishReason = 'tool_use';
        else if (part.finishReason === 'length') finishReason = 'max_tokens';
        else if (part.finishReason === 'stop' && finishReason !== 'tool_use') finishReason = 'end_turn';
        break;

      case 'error': {
        const e = part.error as { data?: unknown } | undefined;
        log?.(() => `sdk stream error: ${JSON.stringify(e?.data ?? part.error)}`);
        closeOpen();
        ensureStart();
        emit('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage });
        emit('message_stop', { type: 'message_stop' });
        return;
      }

      default: break;
    }
  }

  closeOpen();
  ensureStart();
  emit('message_delta', { type: 'message_delta', delta: { stop_reason: finishReason, stop_sequence: null }, usage });
  emit('message_stop', { type: 'message_stop' });
}

// ── high-level entry points ──────────────────────────────────────────────────
export async function streamAnthropicResponse(
  model: LanguageModel,
  params: SdkCallParams,
  modelId: string,
  write: WriteFn,
  log?: LogFn,
): Promise<void> {
  const result = streamText({ model, ...params } as Parameters<typeof streamText>[0]);
  await writeAnthropicStream(result.fullStream as AsyncIterable<FullStreamPart>, modelId, write, log);
}

export async function generateAnthropicResponse(
  model: LanguageModel,
  params: SdkCallParams,
  modelId: string,
): Promise<Record<string, unknown>> {
  const r = await generateText({ model, ...params } as Parameters<typeof generateText>[0]);
  return {
    id: 'msg_' + Date.now(), type: 'message', role: 'assistant', model: modelId,
    content: [
      ...(r.text ? [{ type: 'text', text: r.text }] : []),
      ...r.toolCalls.map(tc => ({
        type: 'tool_use',
        id: tc.toolCallId,
        name: tc.toolName,
        input: tc.input as Record<string, unknown>,
      })),
    ],
    stop_reason: r.finishReason === 'tool-calls' ? 'tool_use' : 'end_turn',
    usage: { input_tokens: r.usage?.inputTokens ?? 0, output_tokens: r.usage?.outputTokens ?? 0 },
  };
}
