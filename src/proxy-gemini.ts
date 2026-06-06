// src/proxy-gemini.ts — Anthropic ↔ Gemini Native API translation
//
// Gemini's OpenAI-compatible endpoint strips thought_signature from responses,
// creating an unresolvable loop (required on echo-back, never returned).
// The native generateContent API returns thought_signature correctly.
//
// Endpoints:
//   Non-streaming: POST /v1beta/models/{model}:generateContent
//   Streaming:     POST /v1beta/models/{model}:streamGenerateContent?alt=sse
import { Readable } from 'node:stream';

export function isGeminiUrl(url: string): boolean {
  return url.includes('generativelanguage.googleapis.com');
}

export function geminiNativeUrl(model: string, stream: boolean): string {
  const base = 'https://generativelanguage.googleapis.com/v1beta/models';
  return stream
    ? `${base}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`
    : `${base}/${encodeURIComponent(model)}:generateContent`;
}

// Build a map from Anthropic tool_use id (both full and raw) → function name.
// Used to look up function names for functionResponse when translating tool_result blocks.
function buildToolNameMap(messages: any[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const msg of messages ?? []) {
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'tool_use') {
          const rawId = part.id.split('::ts::')[0];
          map.set(part.id, part.name);
          map.set(rawId, part.name);
        }
      }
    }
  }
  return map;
}

// ── Request translation: Anthropic → Gemini native ───────────────────

// Gemini's functionDeclarations.parameters accepts only a strict subset of JSON Schema.
// Allow-list approach: pass through only known-supported fields, drop everything else.
// This is more robust than a deny-list — unknown future keywords are dropped automatically.
const GEMINI_SCHEMA_ALLOWED_KEYS = new Set([
  'type', 'description', 'title',
  'properties', 'required',
  'items', 'minItems', 'maxItems',
  'enum',
  'minimum', 'maximum',
  'minLength', 'maxLength',
  'pattern',
  'format',
  'nullable',
  'minProperties', 'maxProperties',
]);

function sanitizeSchema(schema: any): any {
  if (schema === null || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(sanitizeSchema);
  const out: any = {};
  for (const [k, v] of Object.entries(schema)) {
    if (!GEMINI_SCHEMA_ALLOWED_KEYS.has(k)) continue;
    out[k] = sanitizeSchema(v);
  }
  return out;
}

export function translateToGemini(body: any): any {
  const { messages, system, tools, temperature, max_tokens, top_p } = body;
  const toolNameMap = buildToolNameMap(messages);
  const contents: any[] = [];

  for (const msg of messages ?? []) {
    const parts: any[] = [];
    const role = msg.role === 'assistant' ? 'model' : 'user';

    if (typeof msg.content === 'string') {
      parts.push({ text: msg.content });
    } else {
      for (const part of msg.content ?? []) {
        if (part.type === 'text') {
          if (part.text?.trim()) parts.push({ text: part.text });
        } else if (part.type === 'thinking') {
          const tp: any = { thought: true, text: part.thinking };
          if (part.signature) tp.thought_signature = part.signature;
          parts.push(tp);
        } else if (part.type === 'tool_use') {
          const [rawId, ...tsParts] = part.id.split('::ts::');
          const thoughtSignature = tsParts.length > 0 ? tsParts.join('::ts::') : undefined;
          const fc: any = { name: part.name, args: part.input ?? {} };
          if (thoughtSignature) fc.thought_signature = thoughtSignature;
          parts.push({ functionCall: fc });
          void rawId;
        } else if (part.type === 'tool_result') {
          const name =
            toolNameMap.get(part.tool_use_id) ??
            toolNameMap.get(part.tool_use_id.split('::ts::')[0]) ??
            part.tool_use_id.split('::ts::')[0];
          const responseContent =
            typeof part.content === 'string' ? part.content : JSON.stringify(part.content);
          parts.push({ functionResponse: { name, response: { content: responseContent } } });
        } else if (part.type === 'image') {
          const src = part.source;
          if (src?.type === 'base64') {
            parts.push({ inlineData: { mimeType: src.media_type, data: src.data } });
          } else if (src?.type === 'url') {
            parts.push({ fileData: { fileUri: src.url } });
          }
        }
      }
    }

    if (parts.length > 0) contents.push({ role, parts });
  }

  const generationConfig: any = { thinkingConfig: { includeThoughts: true } };
  if (max_tokens !== undefined) generationConfig.maxOutputTokens = max_tokens;
  if (temperature !== undefined) generationConfig.temperature = temperature;
  if (top_p !== undefined) generationConfig.topP = top_p;

  const data: any = { contents, generationConfig };

  if (system) {
    const sysParts =
      typeof system === 'string'
        ? [{ text: system }]
        : system.map((s: any) => ({ text: s.text }));
    data.systemInstruction = { parts: sysParts };
  }

  if (tools?.length > 0) {
    data.tools = [{
      functionDeclarations: tools.map((t: any) => ({
        name: t.name,
        description: t.description,
        parameters: sanitizeSchema(t.input_schema),
      })),
    }];
  }

  return data;
}

// ── Response translation: Gemini native → Anthropic ──────────────────

function parseGeminiParts(
  parts: any[],
  messageId: string,
): { content: any[]; hasToolUse: boolean } {
  const content: any[] = [];
  let toolIndex = 0;
  let hasToolUse = false;

  for (const part of parts) {
    if (part.thought && part.text !== undefined) {
      content.push({
        type: 'thinking',
        thinking: part.text,
        signature: part.thought_signature ?? '',
      });
    } else if (part.text !== undefined && !part.thought) {
      if (part.text.trim()) content.push({ type: 'text', text: part.text });
    } else if (part.functionCall) {
      const fc = part.functionCall;
      const id = fc.thought_signature
        ? `${messageId}_tc${toolIndex}::ts::${fc.thought_signature}`
        : `${messageId}_tc${toolIndex}`;
      content.push({ type: 'tool_use', id, name: fc.name, input: fc.args ?? {} });
      hasToolUse = true;
      toolIndex++;
    }
  }

  return { content, hasToolUse };
}

export function translateFromGemini(response: any, model: string): any {
  const messageId = 'msg_' + Date.now();
  const candidate = response.candidates?.[0];
  const parts: any[] = candidate?.content?.parts ?? [];
  const { content, hasToolUse } = parseGeminiParts(parts, messageId);

  const finishReason = candidate?.finishReason;
  let stop_reason = 'end_turn';
  if (finishReason === 'MAX_TOKENS') stop_reason = 'max_tokens';
  else if (hasToolUse) stop_reason = 'tool_use';

  const usage = response.usageMetadata;
  const cached = usage?.cachedContentTokenCount ?? 0;

  return {
    id: messageId,
    type: 'message',
    role: 'assistant',
    content,
    stop_reason,
    stop_sequence: null,
    model,
    usage: {
      input_tokens: Math.max(0, (usage?.promptTokenCount ?? 0) - cached),
      output_tokens: usage?.candidatesTokenCount ?? 0,
      cache_read_input_tokens: cached,
      cache_creation_input_tokens: 0,
    },
  };
}

// ── Stream translation: Gemini native SSE → Anthropic SSE ────────────

function sseChunk(eventType: string, data: any): string {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function translateStreamGemini(
  upstreamBody: NodeJS.ReadableStream,
  model: string,
): Readable {
  const messageId = 'msg_' + Date.now();
  const output = new Readable({ read() {} });

  let contentBlockIndex = -1;
  let hasTextBlock = false;
  let hasThinkingBlock = false;
  let toolCallCount = 0;
  let lastUsage: any = null;
  let stopReason = 'end_turn';
  let messageStarted = false;
  let buffer = '';

  function emit(eventType: string, data: any) {
    output.push(sseChunk(eventType, data));
  }

  function startMessage() {
    if (messageStarted) return;
    emit('message_start', {
      type: 'message_start',
      message: {
        id: messageId, type: 'message', role: 'assistant',
        content: [], model, stop_reason: null, stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
    messageStarted = true;
  }

  function closeBlock() {
    if (hasTextBlock || hasThinkingBlock) {
      emit('content_block_stop', { type: 'content_block_stop', index: contentBlockIndex });
      hasTextBlock = false;
      hasThinkingBlock = false;
    }
  }

  function processParts(parts: any[], usage: any, fr: string | null) {
    for (const part of parts) {
      if (part.thought && part.text !== undefined) {
        if (hasTextBlock) { closeBlock(); contentBlockIndex++; }
        if (!hasThinkingBlock) {
          if (contentBlockIndex < 0) contentBlockIndex = 0; else if (!hasTextBlock) contentBlockIndex++;
          startMessage();
          emit('content_block_start', {
            type: 'content_block_start', index: contentBlockIndex,
            content_block: { type: 'thinking', thinking: '', signature: '' },
          });
          hasThinkingBlock = true;
        }
        emit('content_block_delta', {
          type: 'content_block_delta', index: contentBlockIndex,
          delta: { type: 'thinking_delta', thinking: part.text },
        });
      } else if (part.text !== undefined && !part.thought) {
        if (hasThinkingBlock) { closeBlock(); contentBlockIndex++; }
        if (!hasTextBlock) {
          if (contentBlockIndex < 0) contentBlockIndex = 0; else if (!hasThinkingBlock) contentBlockIndex++;
          startMessage();
          emit('content_block_start', {
            type: 'content_block_start', index: contentBlockIndex,
            content_block: { type: 'text', text: '' },
          });
          hasTextBlock = true;
        }
        if (part.text) {
          emit('content_block_delta', {
            type: 'content_block_delta', index: contentBlockIndex,
            delta: { type: 'text_delta', text: part.text },
          });
        }
      } else if (part.functionCall) {
        closeBlock();
        contentBlockIndex++;
        const fc = part.functionCall;
        const id = fc.thought_signature
          ? `${messageId}_tc${toolCallCount}::ts::${fc.thought_signature}`
          : `${messageId}_tc${toolCallCount}`;
        toolCallCount++;
        stopReason = 'tool_use';
        startMessage();
        emit('content_block_start', {
          type: 'content_block_start', index: contentBlockIndex,
          content_block: { type: 'tool_use', id, name: fc.name, input: {} },
        });
        emit('content_block_delta', {
          type: 'content_block_delta', index: contentBlockIndex,
          delta: { type: 'input_json_delta', partial_json: JSON.stringify(fc.args ?? {}) },
        });
        emit('content_block_stop', { type: 'content_block_stop', index: contentBlockIndex });
      }
    }

    if (fr === 'MAX_TOKENS') stopReason = 'max_tokens';

    if (usage) {
      const cached = usage.cachedContentTokenCount ?? 0;
      lastUsage = {
        input_tokens: Math.max(0, (usage.promptTokenCount ?? 0) - cached),
        output_tokens: usage.candidatesTokenCount ?? 0,
        cache_read_input_tokens: cached,
        cache_creation_input_tokens: 0,
      };
    }
  }

  function finish() {
    closeBlock();
    emit('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: lastUsage ?? { input_tokens: 0, output_tokens: 0 },
    });
    emit('message_stop', { type: 'message_stop' });
    output.push(null);
  }

  const decoder = new TextDecoder();

  upstreamBody.on('data', (chunk: Buffer) => {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (!raw || raw === '[DONE]') continue;
      try {
        const parsed = JSON.parse(raw);
        const candidate = parsed.candidates?.[0];
        const parts: any[] = candidate?.content?.parts ?? [];
        const fr: string | null = candidate?.finishReason ?? null;
        processParts(parts, parsed.usageMetadata, fr);
      } catch { /* skip malformed chunks */ }
    }
  });

  upstreamBody.on('end', () => {
    if (buffer.trim()) {
      const raw = buffer.startsWith('data: ') ? buffer.slice(6).trim() : buffer.trim();
      if (raw && raw !== '[DONE]') {
        try {
          const parsed = JSON.parse(raw);
          const candidate = parsed.candidates?.[0];
          processParts(candidate?.content?.parts ?? [], parsed.usageMetadata, candidate?.finishReason ?? null);
        } catch { /* ignore */ }
      }
    }
    finish();
  });

  upstreamBody.on('error', () => finish());

  return output;
}
