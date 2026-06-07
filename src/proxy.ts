// src/proxy.ts — Local Anthropic-to-OpenAI translation proxy
// Adapted from cucoleadan/opencode-cowork-proxy (MIT)
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { appendFileSync } from 'node:fs';
import { isGeminiUrl, geminiNativeUrl, translateToGemini, translateFromGemini, translateStreamGemini, GEMINI_SKIP_THOUGHT_SIGNATURE } from './proxy-gemini.js';
import {
  isOpenAIChatCompletionsUrl,
  modelPrefersResponsesApi,
  openAIResponsesUrl,
  translateFromResponses,
  translateStreamResponses,
  translateToResponses,
} from './proxy-responses.js';
import { formatAnthropicModelEntry } from './server/models.js';
import { parseToolArguments, sseChunk, stripToolUseIdSuffix, splitToolUseId, encodeToolUseId, serializeToolResultContent, attachSseLineReader, extractSseDataPayload } from './proxy-shared.js';
import type { AnthropicContentBlock, AnthropicMessage, AnthropicMessageRequest, AnthropicRequestContentPart, OpenAIChatCompletion, OpenAIStreamChunk, OpenAIStreamDelta } from './proxy-types.js';
import { resolveUpstreamTools } from './tool-search.js';
import { isMistralUpstream, normalizeMistralMessages, type MistralNormalizeResult } from './mistral-messages.js';

export interface TranslateRequestOptions {
  completionsUrl?: string;
  mistralNormalize?: MistralNormalizeResult;
}

function tokenCount(...values: any[]): number {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return 0;
}

export function extractCachedTokens(usage: any): number {
  return tokenCount(
    usage?.prompt_tokens_details?.cached_tokens,
    usage?.input_tokens_details?.cached_tokens,
    usage?.cache_read_input_tokens,
  );
}

function extractInputTokens(usage: any): number {
  return tokenCount(
    usage?.prompt_tokens,
    usage?.input_tokens,
    usage?.promptTokens,
    usage?.inputTokens,
  );
}

export function extractUncachedInputTokens(usage: any): number {
  return Math.max(0, extractInputTokens(usage) - extractCachedTokens(usage));
}

export function extractOutputTokens(usage: any): number {
  return tokenCount(
    usage?.completion_tokens,
    usage?.output_tokens,
    usage?.completionTokens,
    usage?.outputTokens,
  );
}

// ── Request translation: Anthropic → OpenAI ─────────────────────────

function translateImageBlock(part: any): any {
  const src = part.source;
  if (!src) return null;
  if (src.type === 'url') {
    return { type: 'image_url', image_url: { url: src.url } };
  }
  if (src.type === 'base64') {
    return { type: 'image_url', image_url: { url: `data:${src.media_type};base64,${src.data}` } };
  }
  return null;
}

export function translateRequest(
  body: AnthropicMessageRequest,
  options: TranslateRequestOptions = {},
): Record<string, unknown> {
  const { model, messages, system, temperature, max_tokens, top_p, stop_sequences, tools, stream } = body;
  const inlineSystemParts: string[] = [];

  const openAIMessages = Array.isArray(messages)
    ? messages.flatMap((msg: any) => {
        if (msg.role === 'system') {
          const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? '');
          if (text.trim()) inlineSystemParts.push(text.trim());
          return [];
        }

        if (typeof msg.content === 'string') {
          return [{ role: msg.role, content: msg.content }];
        }
        if (!Array.isArray(msg.content)) return [];
        const result: any[] = [];

        if (msg.role === 'assistant') {
          const assistantMsg: any = { role: 'assistant', content: null };
          let text = '';
          let reasoningContent = '';
          const toolCalls: any[] = [];

          for (const part of msg.content) {
            if (part.type === 'text') {
              text += (typeof part.text === 'string' ? part.text : JSON.stringify(part.text)) + '\n';
            } else if (part.type === 'thinking') {
              reasoningContent += (typeof part.thinking === 'string' ? part.thinking : JSON.stringify(part.thinking)) + '\n';
            } else if (part.type === 'tool_use') {
              const { rawId, thoughtSignature } = splitToolUseId(part.id);
              const toolCall: any = {
                id: rawId,
                type: 'function',
                function: { name: part.name, arguments: JSON.stringify(part.input) },
              };
              if (thoughtSignature) toolCall.thought_signature = thoughtSignature;
              toolCalls.push(toolCall);
            }
          }

          const trimmed = text.trim();
          const trimmedReasoning = reasoningContent.trim();
          if (trimmed) assistantMsg.content = trimmed;
          if (trimmedReasoning) assistantMsg.reasoning_content = trimmedReasoning;
          if (toolCalls.length > 0) assistantMsg.tool_calls = toolCalls;
          if (assistantMsg.content || assistantMsg.reasoning_content || assistantMsg.tool_calls) result.push(assistantMsg);
        }

        if (msg.role === 'user') {
          let userText = '';
          const contentParts: any[] = [];
          const toolResults: any[] = [];

          for (const part of msg.content) {
            if (part.type === 'text') {
              userText += (typeof part.text === 'string' ? part.text : JSON.stringify(part.text)) + '\n';
            } else if (part.type === 'image') {
              const translated = translateImageBlock(part);
              if (translated) contentParts.push(translated);
            } else if (part.type === 'tool_result') {
              toolResults.push({
                role: 'tool',
                tool_call_id: stripToolUseIdSuffix(part.tool_use_id),
                content: serializeToolResultContent(part.content),
              });
            }
          }

          const trimmed = userText.trim();
          result.push(...toolResults);
          if (contentParts.length > 0) {
            if (trimmed) contentParts.unshift({ type: 'text', text: trimmed });
            result.push({ role: 'user', content: contentParts });
          } else if (trimmed) {
            result.push({ role: 'user', content: trimmed });
          }
        }

        return result;
      })
    : [];

  const systemMessages = Array.isArray(system)
    ? system.map((item: any) => ({ role: 'system', content: item.text }))
    : system ? [{ role: 'system', content: system }] : [];

  if (inlineSystemParts.length > 0) {
    const mergedInline = inlineSystemParts.join('\n\n');
    if (systemMessages.length > 0) {
      systemMessages[0].content = `${systemMessages[0].content}\n\n${mergedInline}`;
    } else {
      systemMessages.push({ role: 'system', content: mergedInline });
    }
  }

  const data: any = { model, messages: [...systemMessages, ...openAIMessages] };
  if (max_tokens !== undefined) data.max_tokens = max_tokens;
  if (temperature !== undefined) data.temperature = temperature;
  if (top_p !== undefined) data.top_p = top_p;
  if (stream !== undefined) data.stream = stream;
  if (stream) data.stream_options = { include_usage: true };
  if (stop_sequences) data.stop = stop_sequences;

  const upstreamTools = resolveUpstreamTools(tools, messages);
  if (upstreamTools.length > 0) {
    data.tools = upstreamTools.map((item: any) => ({
      type: 'function',
      function: {
        name: item.name,
        description: item.description,
        parameters: item.input_schema,
      },
    }));
  }

  if (isMistralUpstream(options.completionsUrl, model)) {
    const normalized = normalizeMistralMessages(data.messages);
    data.messages = normalized.messages;
    options.mistralNormalize = normalized;
  }

  return data;
}

// ── Response translation: OpenAI → Anthropic ────────────────────────

export function translateResponse(completion: OpenAIChatCompletion, model: string): AnthropicMessage {
  const messageId = 'msg_' + Date.now();
  const content: AnthropicContentBlock[] = [];
  const message = completion.choices?.[0]?.message;

  if (message?.reasoning_content) {
    content.push({ type: 'thinking', thinking: message.reasoning_content, signature: '' });
  }
  if (message?.content) {
    content.push({ text: message.content, type: 'text' });
  }
  if (message?.tool_calls) {
    content.push(...message.tool_calls.map((item) => {
      const id = encodeToolUseId(item.id ?? '', item.thought_signature);
      return {
        type: 'tool_use' as const,
        id,
        name: item.function?.name ?? '',
        input: parseToolArguments(item.function?.arguments),
      };
    }));
  }

  const finishReason = completion.choices?.[0]?.finish_reason;
  let stopReason = 'end_turn';
  if (finishReason === 'tool_calls') stopReason = 'tool_use';
  else if (finishReason === 'length') stopReason = 'max_tokens';

  const result: AnthropicMessage = {
    id: messageId,
    type: 'message',
    role: 'assistant',
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    model,
    usage: completion.usage
      ? {
          input_tokens: extractUncachedInputTokens(completion.usage),
          output_tokens: extractOutputTokens(completion.usage),
          cache_read_input_tokens: extractCachedTokens(completion.usage),
          cache_creation_input_tokens: 0,
        }
      : { input_tokens: 0, output_tokens: 0 },
  };

  return result;
}

// ── Stream translation: OpenAI SSE → Anthropic SSE ──────────────────

export function translateStream(upstreamBody: NodeJS.ReadableStream, model: string): Readable {
  const messageId = 'msg_' + Date.now();
  let contentBlockIndex = -1;
  let hasStartedTextBlock = false;
  let hasStartedThinkingBlock = false;
  let isToolUse = false;
  let currentToolCallId: string | null = null;
  let currentToolCallStreamIndex = -1;
  let lastUsage: any = null;
  let finishReason: string | null = null;
  let messageStarted = false;

  // Track per-tool-call state by streaming index to capture thought_signature
  // even when it arrives in a separate chunk from the id.
  const toolCallState: Map<number, {
    id: string;
    name?: string;
    thoughtSignature?: string;
    blockIndex: number;
    emitted: boolean;
  }> = new Map();

  const output = new Readable({ read() {} });

  function emitSSE(eventType: string, data: any) {
    output.push(sseChunk(eventType, data));
  }

  function emitMessageStart() {
    if (messageStarted) return;
    emitSSE('message_start', {
      type: 'message_start',
      message: {
        id: messageId, type: 'message', role: 'assistant',
        content: [], model, stop_reason: null, stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
    messageStarted = true;
  }

  function flushToolCallStart(streamIndex: number) {
    const state = toolCallState.get(streamIndex);
    if (!state || state.emitted) return;
    const encodedId = encodeToolUseId(state.id, state.thoughtSignature);
    emitSSE('content_block_start', {
      type: 'content_block_start', index: state.blockIndex,
      content_block: { type: 'tool_use', id: encodedId, name: state.name, input: {} },
    });
    state.emitted = true;
  }

  function closeCurrentBlock() {
    if (currentToolCallStreamIndex >= 0) {
      flushToolCallStart(currentToolCallStreamIndex);
    }
    if (hasStartedThinkingBlock) {
      emitSSE('content_block_delta', {
        type: 'content_block_delta', index: contentBlockIndex,
        delta: { type: 'signature_delta', signature: GEMINI_SKIP_THOUGHT_SIGNATURE },
      });
    }
    if (isToolUse || hasStartedTextBlock || hasStartedThinkingBlock) {
      emitSSE('content_block_stop', { type: 'content_block_stop', index: contentBlockIndex });
    }
  }

  function processDelta(delta: OpenAIStreamDelta, parsed: OpenAIStreamChunk) {
    if (parsed.usage) {
      lastUsage = {
        input_tokens: extractUncachedInputTokens(parsed.usage),
        output_tokens: extractOutputTokens(parsed.usage),
        cache_read_input_tokens: extractCachedTokens(parsed.usage),
        cache_creation_input_tokens: 0,
      };
    }
    if (parsed.choices?.[0]?.finish_reason) {
      finishReason = parsed.choices[0].finish_reason;
    }

    // Tool calls — defer content_block_start until first argument arrives so
    // thought_signature has a chance to appear (it may come in a later chunk).
    if (delta.tool_calls && delta.tool_calls.length > 0) {
      for (const toolCall of delta.tool_calls) {
        const streamIndex = toolCall.index ?? 0;

        if (toolCall.id && toolCall.id !== currentToolCallId) {
          closeCurrentBlock();
          isToolUse = true;
          hasStartedTextBlock = false;
          hasStartedThinkingBlock = false;
          currentToolCallId = toolCall.id;
          currentToolCallStreamIndex = streamIndex;
          contentBlockIndex++;

          emitMessageStart();

          toolCallState.set(streamIndex, {
            id: toolCall.id,
            name: toolCall.function?.name,
            thoughtSignature: toolCall.thought_signature,
            blockIndex: contentBlockIndex,
            emitted: false,
          });
        } else {
          const existing = toolCallState.get(streamIndex);
          if (existing) {
            if (toolCall.thought_signature) existing.thoughtSignature = toolCall.thought_signature;
            if (toolCall.function?.name && !existing.name) existing.name = toolCall.function.name;
          }
        }

        if (toolCall.function?.arguments) {
          flushToolCallStart(streamIndex);
          emitSSE('content_block_delta', {
            type: 'content_block_delta', index: contentBlockIndex,
            delta: { type: 'input_json_delta', partial_json: toolCall.function.arguments },
          });
        }
      }
      return;
    }

    // Reasoning / thinking
    if (delta.reasoning_content) {
      if (isToolUse || hasStartedTextBlock) {
        closeCurrentBlock();
        isToolUse = false;
        hasStartedTextBlock = false;
        currentToolCallId = null;
        contentBlockIndex++;
      }
      if (!hasStartedThinkingBlock) {
        if (contentBlockIndex < 0) contentBlockIndex = 0;
        emitMessageStart();
        emitSSE('content_block_start', {
          type: 'content_block_start', index: contentBlockIndex,
          content_block: { type: 'thinking', thinking: '', signature: '' },
        });
        hasStartedThinkingBlock = true;
      }
      emitSSE('content_block_delta', {
        type: 'content_block_delta', index: contentBlockIndex,
        delta: { type: 'thinking_delta', thinking: delta.reasoning_content },
      });
      return;
    }

    // Text content
    if (delta.content) {
      if (isToolUse || hasStartedThinkingBlock) {
        closeCurrentBlock();
        isToolUse = false;
        hasStartedThinkingBlock = false;
        currentToolCallId = null;
        contentBlockIndex++;
      }
      if (!hasStartedTextBlock) {
        if (contentBlockIndex < 0) contentBlockIndex = 0;
        emitMessageStart();
        emitSSE('content_block_start', {
          type: 'content_block_start', index: contentBlockIndex,
          content_block: { type: 'text', text: '' },
        });
        hasStartedTextBlock = true;
      }
      emitSSE('content_block_delta', {
        type: 'content_block_delta', index: contentBlockIndex,
        delta: { type: 'text_delta', text: delta.content },
      });
    }
  }

  function processLine(line: string) {
    const data = extractSseDataPayload(line);
    if (!data) return;
    try {
      const parsed = JSON.parse(data);
      const delta = parsed.choices?.[0]?.delta;
      if (delta) processDelta(delta, parsed);
    } catch { /* skip malformed chunks */ }
  }

  function finish() {
    closeCurrentBlock();
    emitMessageStart();

    let stopReason = 'end_turn';
    if (finishReason === 'tool_calls') stopReason = 'tool_use';
    else if (finishReason === 'length') stopReason = 'max_tokens';

    emitSSE('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: lastUsage || { input_tokens: 0, output_tokens: 0 },
    });
    emitSSE('message_stop', { type: 'message_stop' });
    output.push(null);
  }

  attachSseLineReader(upstreamBody, (line) => {
    if (line.trim()) processLine(line);
  }, finish);

  return output;
}

// ── HTTP server ─────────────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function extractApiKey(req: IncomingMessage): string | null {
  const xApiKey = req.headers['x-api-key'];
  if (typeof xApiKey === 'string') return xApiKey;
  const auth = req.headers['authorization'];
  if (typeof auth === 'string') return auth.replace('Bearer ', '').trim();
  return null;
}

function sendJson(res: ServerResponse, status: number, body: any) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(json);
}

function anthropicError(res: ServerResponse, status: number, message: string) {
  sendJson(res, status, {
    type: 'error',
    error: { type: 'api_error', message },
  });
}

// Emit a fully-translated Anthropic response as SSE events.
// Used when we made a non-streaming upstream request but Claude Code expects streaming.
function sendAnthropicAsSSE(res: ServerResponse, anthropicResponse: any) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  res.write(sseChunk('message_start', {
    type: 'message_start',
    message: {
      id: anthropicResponse.id, type: 'message', role: 'assistant',
      content: [], model: anthropicResponse.model,
      stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  }));

  const blocks: any[] = anthropicResponse.content ?? [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];

    if (block.type === 'text') {
      res.write(sseChunk('content_block_start', {
        type: 'content_block_start', index: i,
        content_block: { type: 'text', text: '' },
      }));
      res.write(sseChunk('content_block_delta', {
        type: 'content_block_delta', index: i,
        delta: { type: 'text_delta', text: block.text },
      }));
    } else if (block.type === 'thinking') {
      res.write(sseChunk('content_block_start', {
        type: 'content_block_start', index: i,
        content_block: { type: 'thinking', thinking: '', signature: '' },
      }));
      res.write(sseChunk('content_block_delta', {
        type: 'content_block_delta', index: i,
        delta: { type: 'thinking_delta', thinking: block.thinking ?? '' },
      }));
      res.write(sseChunk('content_block_delta', {
        type: 'content_block_delta', index: i,
        delta: {
          type: 'signature_delta',
          signature: block.signature || GEMINI_SKIP_THOUGHT_SIGNATURE,
        },
      }));
    } else if (block.type === 'tool_use') {
      res.write(sseChunk('content_block_start', {
        type: 'content_block_start', index: i,
        content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} },
      }));
      res.write(sseChunk('content_block_delta', {
        type: 'content_block_delta', index: i,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input ?? {}) },
      }));
    }

    res.write(sseChunk('content_block_stop', { type: 'content_block_stop', index: i }));
  }

  res.write(sseChunk('message_delta', {
    type: 'message_delta',
    delta: { stop_reason: anthropicResponse.stop_reason, stop_sequence: null },
    usage: anthropicResponse.usage ?? { input_tokens: 0, output_tokens: 0 },
  }));
  res.write(sseChunk('message_stop', { type: 'message_stop' }));
  res.end();
}

export interface ProxyHandle {
  port: number;
  close: () => void;
}

export function startProxy(
  completionsUrl: string,
  modelId: string,
  debug = false,
  contextWindow?: number,
): Promise<ProxyHandle> {
  const upstreamUrl = completionsUrl;
  const LOG = '/tmp/opencode-proxy-debug.log';
  const plog = debug
    ? (msg: string) => { try { appendFileSync(LOG, `${new Date().toISOString()} ${msg}\n`); } catch { /* ignore */ } }
    : (_msg: string) => {};

  // Synthetic Anthropic-format models response so Claude Code can validate the model
  // and display the correct context window in the status bar.
  const modelEntry = formatAnthropicModelEntry(modelId, modelId, contextWindow);
  const modelsResponse = JSON.stringify({
    data: [modelEntry],
    has_more: false,
    first_id: modelId,
    last_id: modelId,
  });
  const singleModelResponse = JSON.stringify(modelEntry);

  const server = createServer(async (req, res) => {
    plog(`${req.method} ${req.url}`);

    // HEAD / — health check ping from Claude Code
    if (req.method === 'HEAD') {
      res.writeHead(200);
      res.end();
      return;
    }

    // GET /v1/models — Claude Code validates the model on startup
    if (req.method === 'GET' && req.url?.startsWith('/v1/models')) {
      const modelPathMatch = req.url.match(/^\/v1\/models\/([^?]+)/);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(modelPathMatch ? singleModelResponse : modelsResponse);
      return;
    }

    // POST /v1/messages — the main translation path (Claude Code appends ?beta=true or similar)
    if (req.method === 'POST' && req.url?.startsWith('/v1/messages')) {
      const apiKey = extractApiKey(req);
      plog(`POST /v1/messages - key=${apiKey ? `len:${apiKey.length}` : 'MISSING'}`);
      if (!apiKey) {
        anthropicError(res, 401, 'Missing API key');
        return;
      }

      let anthropicBody: any;
      try {
        const raw = await readBody(req);
        anthropicBody = JSON.parse(raw);
      } catch {
        anthropicError(res, 400, 'Invalid JSON body');
        return;
      }

      const originalModel = anthropicBody.model;
      const clientWantsStream = Boolean(anthropicBody.stream);

      // ── Gemini native path ──────────────────────────────────────────
      // Use Gemini's generateContent API instead of the OpenAI-compatible endpoint.
      // The OpenAI-compatible endpoint strips thought_signature from tool_call responses,
      // making it impossible to echo back — breaking multi-turn tool use and thinking.
      if (isGeminiUrl(upstreamUrl)) {
        const nativeUrl = geminiNativeUrl(originalModel, clientWantsStream);
        const geminiBody = translateToGemini(anthropicBody);
        const geminiTools = geminiBody.tools as Array<{ functionDeclarations?: unknown[] }> | undefined;
        const geminiContents = geminiBody.contents as unknown[] | undefined;
        const totalTools = anthropicBody.tools?.length ?? 0;
        const upstreamCount = geminiTools?.[0]?.functionDeclarations?.length ?? 0;
        plog(`gemini-native: model=${originalModel}, stream=${clientWantsStream}, tools=${upstreamCount}/${totalTools}, msgs=${geminiContents?.length ?? 0}`);

        let upstreamRes: Response;
        try {
          upstreamRes = await fetch(nativeUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': apiKey,
            },
            body: JSON.stringify(geminiBody),
          });
        } catch (err) {
          plog(`gemini upstream error: ${err instanceof Error ? err.message : String(err)}`);
          anthropicError(res, 502, `Upstream unreachable: ${err instanceof Error ? err.message : String(err)}`);
          return;
        }

        plog(`gemini upstream ${upstreamRes.status}`);

        if (!upstreamRes.ok) {
          const errBody = await upstreamRes.text();
          plog(`gemini error body: ${errBody.slice(0, 500)}`);
          res.writeHead(upstreamRes.status, { 'Content-Type': upstreamRes.headers.get('content-type') || 'application/json' });
          res.end(errBody);
          return;
        }

        if (clientWantsStream && upstreamRes.body) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });
          const nodeStream = Readable.fromWeb(upstreamRes.body as any);
          const translated = translateStreamGemini(nodeStream, originalModel);
          translated.pipe(res);
          return;
        }

        const geminiData = await upstreamRes.json();
        const anthropicResponse = translateFromGemini(geminiData, originalModel);
        if (clientWantsStream) {
          sendAnthropicAsSSE(res, anthropicResponse);
        } else {
          sendJson(res, 200, anthropicResponse);
        }
        return;
      }

      // ── OpenAI Responses API path (GPT-5.4+, Codex, o-series) ───────
      if (isOpenAIChatCompletionsUrl(upstreamUrl) && modelPrefersResponsesApi(originalModel)) {
        const responsesUrl = openAIResponsesUrl(upstreamUrl);
        const responsesBody = translateToResponses(anthropicBody);
        const responsesInput = responsesBody.input as unknown[] | undefined;
        const responsesTools = responsesBody.tools as unknown[] | undefined;
        const totalTools = anthropicBody.tools?.length ?? 0;
        plog(
          `openai-responses: model=${originalModel}, stream=${clientWantsStream}, ` +
          `tools=${responsesTools?.length ?? 0}/${totalTools}, msgs=${responsesInput?.length ?? 0}`,
        );

        let upstreamRes: Response;
        try {
          upstreamRes = await fetch(responsesUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': clientWantsStream ? 'text/event-stream' : 'application/json',
              'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify(responsesBody),
          });
        } catch (err) {
          plog(`openai-responses upstream error: ${err instanceof Error ? err.message : String(err)}`);
          anthropicError(res, 502, `Upstream unreachable: ${err instanceof Error ? err.message : String(err)}`);
          return;
        }

        plog(`openai-responses upstream ${upstreamRes.status} from ${responsesUrl}`);

        if (!upstreamRes.ok) {
          const errBody = await upstreamRes.text();
          plog(`openai-responses error body: ${errBody.slice(0, 500)}`);
          res.writeHead(upstreamRes.status, { 'Content-Type': upstreamRes.headers.get('content-type') || 'application/json' });
          res.end(errBody);
          return;
        }

        if (clientWantsStream && upstreamRes.body) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });
          const nodeStream = Readable.fromWeb(upstreamRes.body as any);
          translateStreamResponses(nodeStream, originalModel).pipe(res);
          return;
        }

        const responsesData = await upstreamRes.json() as Record<string, unknown>;
        const anthropicResponse = translateFromResponses(responsesData, originalModel);
        if (clientWantsStream) {
          sendAnthropicAsSSE(res, anthropicResponse);
        } else {
          sendJson(res, 200, anthropicResponse);
        }
        return;
      }

      // ── OpenAI-compatible path ──────────────────────────────────────
      const translateOpts: TranslateRequestOptions = { completionsUrl: upstreamUrl };
      const openaiBody = translateRequest(anthropicBody, translateOpts);
      if (translateOpts.mistralNormalize) {
        const n = translateOpts.mistralNormalize;
        plog(
          `mistral-normalize: hoisted ${n.hoistedSystemBlocks} system block(s), ` +
          `inserted ${n.insertedAssistantFillers} assistant filler(s)`,
        );
      }
      const openaiTools = openaiBody.tools as unknown[] | undefined;
      const openaiMessages = openaiBody.messages as unknown[] | undefined;
      const totalTools = anthropicBody.tools?.length ?? 0;
      plog(`openai: tools=${openaiTools?.length ?? 0}/${totalTools}, stream=${openaiBody.stream ?? false}, msgs=${openaiMessages?.length ?? 0}`);

      let upstreamRes: Response;
      try {
        upstreamRes = await fetch(upstreamUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify(openaiBody),
        });
      } catch (err) {
        plog(`upstream error: ${err instanceof Error ? err.message : String(err)}`);
        anthropicError(res, 502, `Upstream unreachable: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }

      plog(`upstream ${upstreamRes.status} from ${upstreamUrl}`);

      if (!upstreamRes.ok) {
        const errBody = await upstreamRes.text();
        plog(`upstream error body: ${errBody.slice(0, 500)}`);
        res.writeHead(upstreamRes.status, { 'Content-Type': upstreamRes.headers.get('content-type') || 'application/json' });
        res.end(errBody);
        return;
      }

      if (openaiBody.stream && upstreamRes.body) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });
        const nodeStream = Readable.fromWeb(upstreamRes.body as any);
        const translated = translateStream(nodeStream, originalModel);
        translated.pipe(res);
        return;
      }

      const openaiData = await upstreamRes.json();
      const anthropicResponse = translateResponse(openaiData, originalModel);
      sendJson(res, 200, anthropicResponse);
      return;
    }

    // Everything else → 404
    anthropicError(res, 404, `Unknown endpoint: ${req.method} ${req.url}`);
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to bind proxy'));
        return;
      }
      plog(`started on port ${addr.port}, forwarding to ${upstreamUrl}`);
      resolve({
        port: addr.port,
        close: () => server.close(),
      });
    });
  });
}
