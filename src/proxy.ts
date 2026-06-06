// src/proxy.ts — Local Anthropic-to-OpenAI translation proxy
// Adapted from cucoleadan/opencode-cowork-proxy (MIT)
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { appendFileSync } from 'node:fs';

// ── Cache / hash utilities ──────────────────────────────────────────

function hashSystemPrompt(system: string | any[] | undefined): string | null {
  if (!system) return null;
  const text = typeof system === 'string'
    ? system
    : system.map((s: any) => s.text || '').join('\n');
  if (!text.trim()) return null;
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash) + text.charCodeAt(i);
    hash = hash & hash;
  }
  return 'cache-' + Math.abs(hash).toString(36);
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

export function translateRequest(body: any): any {
  const { model, messages, system, temperature, max_tokens, top_p, stop_sequences, tools, stream } = body;

  const openAIMessages = Array.isArray(messages)
    ? messages.flatMap((msg: any) => {
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
              toolCalls.push({
                id: part.id,
                type: 'function',
                function: { name: part.name, arguments: JSON.stringify(part.input) },
              });
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
                tool_call_id: part.tool_use_id,
                content: typeof part.content === 'string' ? part.content : JSON.stringify(part.content),
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

  const data: any = { model, messages: [...systemMessages, ...openAIMessages] };
  if (max_tokens !== undefined) data.max_tokens = max_tokens;
  if (temperature !== undefined) data.temperature = temperature;
  if (top_p !== undefined) data.top_p = top_p;
  if (stream !== undefined) data.stream = stream;
  if (stream) data.stream_options = { include_usage: true };
  if (stop_sequences) data.stop = stop_sequences;

  if (tools) {
    data.tools = tools.map((item: any) => ({
      type: 'function',
      function: {
        name: item.name,
        description: item.description,
        parameters: item.input_schema,
      },
    }));
  }

  return data;
}

// ── Response translation: OpenAI → Anthropic ────────────────────────

function parseToolArguments(value: string | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function translateResponse(completion: any, model: string): any {
  const messageId = 'msg_' + Date.now();
  const content: any[] = [];
  const message = completion.choices?.[0]?.message;

  if (message?.reasoning_content) {
    content.push({ type: 'thinking', thinking: message.reasoning_content, signature: '' });
  }
  if (message?.content) {
    content.push({ text: message.content, type: 'text' });
  }
  if (message?.tool_calls) {
    content.push(...message.tool_calls.map((item: any) => ({
      type: 'tool_use',
      id: item.id,
      name: item.function?.name,
      input: parseToolArguments(item.function?.arguments),
    })));
  }

  const finishReason = completion.choices?.[0]?.finish_reason;
  let stopReason = 'end_turn';
  if (finishReason === 'tool_calls') stopReason = 'tool_use';
  else if (finishReason === 'length') stopReason = 'max_tokens';

  const result: any = {
    id: messageId,
    type: 'message',
    role: 'assistant',
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    model,
  };

  if (completion.usage) {
    result.usage = {
      input_tokens: extractUncachedInputTokens(completion.usage),
      output_tokens: extractOutputTokens(completion.usage),
      cache_read_input_tokens: extractCachedTokens(completion.usage),
      cache_creation_input_tokens: 0,
    };
  }

  return result;
}

// ── Stream translation: OpenAI SSE → Anthropic SSE ──────────────────

function sseChunk(eventType: string, data: any): string {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function translateStream(upstreamBody: NodeJS.ReadableStream, model: string): Readable {
  const messageId = 'msg_' + Date.now();
  let contentBlockIndex = -1;
  let hasStartedTextBlock = false;
  let hasStartedThinkingBlock = false;
  let isToolUse = false;
  let currentToolCallId: string | null = null;
  let lastUsage: any = null;
  let finishReason: string | null = null;
  let messageStarted = false;
  let buffer = '';

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

  function closeCurrentBlock() {
    if (isToolUse || hasStartedTextBlock || hasStartedThinkingBlock) {
      emitSSE('content_block_stop', { type: 'content_block_stop', index: contentBlockIndex });
    }
  }

  function processDelta(delta: any, parsed: any) {
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

    // Tool calls
    if (delta.tool_calls?.length > 0) {
      for (const toolCall of delta.tool_calls) {
        if (toolCall.id && toolCall.id !== currentToolCallId) {
          closeCurrentBlock();
          isToolUse = true;
          hasStartedTextBlock = false;
          hasStartedThinkingBlock = false;
          currentToolCallId = toolCall.id;
          contentBlockIndex++;

          emitMessageStart();
          emitSSE('content_block_start', {
            type: 'content_block_start', index: contentBlockIndex,
            content_block: { type: 'tool_use', id: toolCall.id, name: toolCall.function?.name, input: {} },
          });
        }

        if (toolCall.function?.arguments) {
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
    if (!line.startsWith('data: ')) return;
    const data = line.slice(6).trim();
    if (data === '[DONE]') return;
    try {
      const parsed = JSON.parse(data);
      const delta = parsed.choices?.[0]?.delta;
      if (delta) processDelta(delta, parsed);
    } catch { /* skip malformed chunks */ }
  }

  function finish() {
    closeCurrentBlock();

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

  const decoder = new TextDecoder();
  upstreamBody.on('data', (chunk: Buffer) => {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.trim()) processLine(line);
    }
  });

  upstreamBody.on('end', () => {
    if (buffer.trim()) processLine(buffer);
    finish();
  });

  upstreamBody.on('error', () => {
    finish();
  });

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

export interface ProxyHandle {
  port: number;
  close: () => void;
}

export function startProxy(completionsUrl: string, modelId: string, debug = false): Promise<ProxyHandle> {
  const upstreamUrl = completionsUrl;
  const LOG = '/tmp/opencode-proxy-debug.log';
  const plog = debug
    ? (msg: string) => { try { appendFileSync(LOG, `${new Date().toISOString()} ${msg}\n`); } catch { /* ignore */ } }
    : (_msg: string) => {};

  // Synthetic Anthropic-format models response so Claude Code can validate the model.
  const modelsResponse = JSON.stringify({
    data: [{ id: modelId, type: 'model', display_name: modelId, created_at: '2025-01-01T00:00:00Z' }],
    has_more: false,
    first_id: modelId,
    last_id: modelId,
  });

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
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(modelsResponse);
      return;
    }

    // POST /v1/messages — the main translation path (Claude Code appends ?beta=true or similar)
    if (req.method === 'POST' && req.url?.startsWith('/v1/messages')) {
      const apiKey = extractApiKey(req);
      plog(`POST /v1/messages - key=${apiKey ? `len:${apiKey.length}` : 'MISSING'}, headers=${Object.keys(req.headers).join(',')}`);
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
      const openaiBody = translateRequest(anthropicBody);

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

      // Streaming response
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

      // Non-streaming response
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
