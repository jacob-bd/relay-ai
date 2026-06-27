// src/antigravity/cloudcode-to-anthropic.ts — Translate Cloud Code Assist SSE stream
// into Anthropic /v1/messages SSE format for the Claude Code client.

import { randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { encodeToolUseId } from '../proxy-shared.js';

type JsonRecord = Record<string, unknown>;
type LogFn = (message: string | (() => string)) => void;

function writeEvent(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function parseCloudCodeChunk(line: string): JsonRecord | null {
  const text = line.startsWith('data: ') ? line.slice(6).trim() : line.trim();
  if (!text || text === '[DONE]') return null;
  try { return JSON.parse(text) as JsonRecord; } catch { return null; }
}

function getCandidate(chunk: JsonRecord): JsonRecord | null {
  const resp = chunk.response as JsonRecord | undefined;
  if (!resp) return null;
  const candidates = resp.candidates as JsonRecord[] | undefined;
  return candidates?.[0] ?? null;
}

function getParts(candidate: JsonRecord): JsonRecord[] {
  const content = candidate.content as JsonRecord | undefined;
  const parts = content?.parts as JsonRecord[] | undefined;
  return parts ?? [];
}

function getFinishReason(candidate: JsonRecord): string | null {
  const r = candidate.finishReason as string | undefined;
  return r ?? null;
}

function getUsage(chunk: JsonRecord): { input: number; output: number } | null {
  const resp = chunk.response as JsonRecord | undefined;
  const u = resp?.usageMetadata as JsonRecord | undefined;
  if (!u) return null;
  return {
    input: (u.promptTokenCount as number | undefined) ?? 0,
    output: (u.candidatesTokenCount as number | undefined) ?? 0,
  };
}

function partThoughtSignature(part: JsonRecord): string | undefined {
  const sig = part.thoughtSignature ?? part.thought_signature;
  if (typeof sig === 'string' && sig.length > 0) return sig;
  const fc = part.functionCall as JsonRecord | undefined;
  const nested = fc?.thoughtSignature ?? fc?.thought_signature;
  return typeof nested === 'string' && nested.length > 0 ? nested : undefined;
}

function mapStopReason(finishReason: string): string {
  if (finishReason === 'STOP') return 'end_turn';
  if (finishReason === 'MAX_TOKENS') return 'max_tokens';
  if (finishReason === 'SAFETY') return 'stop_sequence';
  return 'end_turn';
}

function summarizeParts(parts: JsonRecord[]): string {
  let textParts = 0;
  let textChars = 0;
  let thoughtParts = 0;
  let thoughtChars = 0;
  let functionCalls = 0;
  for (const part of parts) {
    if (part.thought === true && typeof part.text === 'string') {
      thoughtParts++;
      thoughtChars += part.text.length;
    } else if (typeof part.text === 'string') {
      textParts++;
      textChars += part.text.length;
    } else if (part.functionCall && typeof part.functionCall === 'object') {
      functionCalls++;
    }
  }
  return `textParts=${textParts} textChars=${textChars} thoughtParts=${thoughtParts} thoughtChars=${thoughtChars} functionCalls=${functionCalls}`;
}

interface StreamState {
  messageId: string;
  model: string;
  blockIdx: number;
  textBlockOpen: boolean;
  pendingThoughtSignature?: string;
  toolCalls: Array<{ name: string; args: JsonRecord; signature?: string }>;
  usage: { input: number; output: number };
  emittedTextChars: number;
  suppressedThoughtChars: number;
}

function openTextBlock(res: ServerResponse, state: StreamState): void {
  writeEvent(res, 'content_block_start', {
    type: 'content_block_start',
    index: state.blockIdx,
    content_block: { type: 'text', text: '' },
  });
  state.textBlockOpen = true;
}

function closeBlock(res: ServerResponse, state: StreamState): void {
  writeEvent(res, 'content_block_stop', {
    type: 'content_block_stop',
    index: state.blockIdx,
  });
  state.blockIdx++;
  state.textBlockOpen = false;
}

/**
 * Stream a Cloud Code Assist SSE response to the client as Anthropic SSE.
 * Handles text and tool calls (tool calls are accumulated and emitted at finish).
 * Cloud Code thought text is intentionally not forwarded to Claude Code because it
 * can otherwise appear as assistant-visible reasoning.
 */
export async function streamCloudCodeToAnthropic(
  res: ServerResponse,
  upstreamRes: Response,
  model: string,
  log?: LogFn,
): Promise<void> {
  const state: StreamState = {
    messageId: `msg_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
    model,
    blockIdx: 0,
    textBlockOpen: false,
    pendingThoughtSignature: undefined,
    toolCalls: [],
    usage: { input: 0, output: 0 },
    emittedTextChars: 0,
    suppressedThoughtChars: 0,
  };

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  writeEvent(res, 'message_start', {
    type: 'message_start',
    message: {
      id: state.messageId,
      type: 'message',
      role: 'assistant',
      content: [],
      model: state.model,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  });
  writeEvent(res, 'ping', { type: 'ping' });

  if (!upstreamRes.body) {
    writeEvent(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 0 } });
    writeEvent(res, 'message_stop', { type: 'message_stop' });
    res.end();
    return;
  }
  const reader = upstreamRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalStopReason = 'end_turn';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const chunk = parseCloudCodeChunk(line);
        if (!chunk) continue;

        const usage = getUsage(chunk);
        if (usage) state.usage = usage;

        const candidate = getCandidate(chunk);
        if (!candidate) continue;

        const parts = getParts(candidate);
        const finishReason = getFinishReason(candidate);

        for (const part of parts) {
          const signature = partThoughtSignature(part);
          if (signature) state.pendingThoughtSignature = signature;

          if (part.thought === true && typeof part.text === 'string') {
            state.suppressedThoughtChars += part.text.length;
            continue;
          } else if (typeof part.text === 'string' && part.text !== '') {
            // Text part
            if (!state.textBlockOpen) openTextBlock(res, state);
            state.emittedTextChars += part.text.length;
            writeEvent(res, 'content_block_delta', {
              type: 'content_block_delta',
              index: state.blockIdx,
              delta: { type: 'text_delta', text: part.text },
            });
          } else if (part.functionCall && typeof part.functionCall === 'object') {
            // Tool call — accumulate; emitted at finish
            const fc = part.functionCall as JsonRecord;
            state.toolCalls.push({
              name: (fc.name as string | undefined) ?? '',
              args: (fc.args as JsonRecord | undefined) ?? {},
              signature: signature ?? state.pendingThoughtSignature,
            });
            state.pendingThoughtSignature = undefined;
          }
        }

        if (finishReason) {
          finalStopReason = mapStopReason(finishReason);
          log?.(() => {
            const toolNames = state.toolCalls.map(tc => tc.name).filter(Boolean).join(',');
            return `cloud-code stream finish=${finishReason} mapped=${finalStopReason} ${summarizeParts(parts)} emittedTextChars=${state.emittedTextChars} suppressedThoughtChars=${state.suppressedThoughtChars} queuedToolCalls=${state.toolCalls.length} queuedToolNames=${toolNames || '-'} outputTokens=${state.usage.output}`;
          });

          // Close open text block
          if (state.textBlockOpen) {
            closeBlock(res, state);
          }

          // Emit accumulated tool use blocks
          for (const tc of state.toolCalls) {
            const rawToolId = `toolu_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
            const toolId = encodeToolUseId(rawToolId, tc.signature);
            writeEvent(res, 'content_block_start', {
              type: 'content_block_start',
              index: state.blockIdx,
              content_block: { type: 'tool_use', id: toolId, name: tc.name, input: {} },
            });
            writeEvent(res, 'content_block_delta', {
              type: 'content_block_delta',
              index: state.blockIdx,
              delta: { type: 'input_json_delta', partial_json: JSON.stringify(tc.args) },
            });
            writeEvent(res, 'content_block_stop', {
              type: 'content_block_stop',
              index: state.blockIdx,
            });
            state.blockIdx++;
          }

          // If nothing was emitted yet (e.g. empty response), open and close a text block.
          if (state.blockIdx === 0) {
            openTextBlock(res, state);
            closeBlock(res, state);
          }

          const anthropicStopReason = state.toolCalls.length > 0 ? 'tool_use' : finalStopReason;
          writeEvent(res, 'message_delta', {
            type: 'message_delta',
            delta: { stop_reason: anthropicStopReason, stop_sequence: null },
            usage: { output_tokens: state.usage.output },
          });
          writeEvent(res, 'message_stop', { type: 'message_stop' });
          res.end();
          return;
        }
      }
    }
  } catch {
    // Stream ended abruptly — close gracefully if headers were sent.
  }

  // Stream ended without a finishReason — close open blocks and finish.
  if (state.textBlockOpen) closeBlock(res, state);
  if (state.blockIdx === 0) { openTextBlock(res, state); closeBlock(res, state); }
  writeEvent(res, 'message_delta', {
    type: 'message_delta',
    delta: { stop_reason: finalStopReason, stop_sequence: null },
    usage: { output_tokens: state.usage.output },
  });
  writeEvent(res, 'message_stop', { type: 'message_stop' });
  res.end();
}

/**
 * Generate a non-streaming Anthropic response from a fully accumulated Cloud Code response.
 * Used when the client did not request streaming.
 */
export async function collectCloudCodeToAnthropic(
  upstreamRes: Response,
  model: string,
  log?: LogFn,
): Promise<JsonRecord> {
  const text = await upstreamRes.text();
  const messageId = `msg_${randomUUID().replace(/-/g, '').slice(0, 24)}`;

  const content: JsonRecord[] = [];
  let stopReason = 'end_turn';
  let inputTokens = 0;
  let outputTokens = 0;
  let pendingThoughtSignature: string | undefined;
  let suppressedThoughtChars = 0;

  for (const line of text.split('\n')) {
    const chunk = parseCloudCodeChunk(line);
    if (!chunk) continue;

    const usage = getUsage(chunk);
    if (usage) { inputTokens = usage.input; outputTokens = usage.output; }

    const candidate = getCandidate(chunk);
    if (!candidate) continue;

    for (const part of getParts(candidate)) {
      const signature = partThoughtSignature(part);
      if (signature) pendingThoughtSignature = signature;

      if (part.thought === true && typeof part.text === 'string') {
        suppressedThoughtChars += part.text.length;
        continue;
      } else if (typeof part.text === 'string' && part.text !== '') {
        const existing = content.find(b => b.type === 'text') as JsonRecord | undefined;
        if (existing) existing.text = (existing.text as string) + part.text;
        else content.push({ type: 'text', text: part.text });
      } else if (part.functionCall && typeof part.functionCall === 'object') {
        const fc = part.functionCall as JsonRecord;
        const rawToolId = `toolu_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
        content.push({
          type: 'tool_use',
          id: encodeToolUseId(rawToolId, signature ?? pendingThoughtSignature),
          name: fc.name,
          input: fc.args ?? {},
        });
        pendingThoughtSignature = undefined;
      }
    }

    const fr = getFinishReason(candidate);
    if (fr) {
      stopReason = content.some(b => b.type === 'tool_use') ? 'tool_use' : mapStopReason(fr);
      log?.(() => {
        const toolNames = content
          .filter(b => b.type === 'tool_use')
          .map(b => String(b.name ?? ''))
          .filter(Boolean)
          .join(',');
        return `cloud-code collect finish=${fr} mapped=${stopReason} ${summarizeParts(getParts(candidate))} suppressedThoughtChars=${suppressedThoughtChars} contentBlocks=${content.length} toolNames=${toolNames || '-'} outputTokens=${outputTokens}`;
      });
    }
  }

  if (content.length === 0) content.push({ type: 'text', text: '' });

  return {
    id: messageId,
    type: 'message',
    role: 'assistant',
    content,
    model,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}
