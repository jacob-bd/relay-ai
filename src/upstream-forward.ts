import { once } from 'node:events';
import type { ServerResponse } from 'node:http';
import { sanitizeCredential } from './server/auth.js';
import { sseChunk } from './proxy-shared.js';
import { CLAUDE_CODE_USER_AGENT } from './oauth/claude-identity.js';

export function anthropicUpstreamHeaders(
  apiKey: string,
  stream = false,
  inboundBeta?: string,
  authType?: 'api' | 'oauth',
  claudeCodeSessionId?: string,
  extraHeaders?: Record<string, string>,
): Record<string, string> {
  const key = sanitizeCredential(apiKey) ?? apiKey.trim();
  const isOAuth = authType === 'oauth';
  const headers: Record<string, string> = {
    ...extraHeaders,
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
    Authorization: `Bearer ${key}`,
    ...(isOAuth ? {} : { 'x-api-key': key }),
    ...(isOAuth ? { 'User-Agent': CLAUDE_CODE_USER_AGENT, 'x-app': 'cli' } : {}),
    ...(isOAuth && claudeCodeSessionId ? { 'X-Claude-Code-Session-Id': claudeCodeSessionId } : {}),
    ...(stream ? { Accept: 'text/event-stream' } : {}),
  };
  if (inboundBeta) {
    headers['anthropic-beta'] = inboundBeta;
  }
  return headers;
}

export class UpstreamUnreachableError extends Error {
  constructor(cause: unknown) {
    super(`Upstream unreachable: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'UpstreamUnreachableError';
  }
}

export async function fetchWithOAuthRetry<TResponse extends { status: number }>(
  apiKey: string,
  request: (apiKey: string) => Promise<TResponse>,
  refreshToken?: () => Promise<string | null>,
): Promise<{ response: TResponse; apiKey: string; refreshed: boolean }> {
  let response = await request(apiKey);
  if (response.status !== 401 || !refreshToken) {
    return { response, apiKey, refreshed: false };
  }

  const refreshed = await refreshToken().catch(() => null);
  if (!refreshed || refreshed === apiKey) {
    return { response, apiKey, refreshed: false };
  }

  response = await request(refreshed);
  return { response, apiKey: refreshed, refreshed: true };
}

/** Relay an Anthropic /v1/messages response (JSON or SSE) to the client. */
export async function relayAnthropicMessages(
  res: ServerResponse,
  messagesUrl: string,
  body: Record<string, unknown>,
  apiKey: string,
  clientWantsStream: boolean,
  inboundBeta?: string,
  authType?: 'api' | 'oauth',
  log?: (message: string) => void,
  claudeCodeSessionId?: string,
  extraHeaders?: Record<string, string>,
  refreshToken?: () => Promise<string | null>,
  onTokenRefreshed?: (token: string) => void,
  retryEmptyStream = false,
): Promise<void> {
  const doFetch = (key: string) => fetch(messagesUrl, {
    method: 'POST',
    headers: anthropicUpstreamHeaders(key, clientWantsStream, inboundBeta, authType, claudeCodeSessionId, extraHeaders),
    body: JSON.stringify(body),
  });

  let upstreamRes: Response;
  try {
    const retryResult = await fetchWithOAuthRetry(apiKey, doFetch, refreshToken);
    upstreamRes = retryResult.response;
    if (retryResult.refreshed) onTokenRefreshed?.(retryResult.apiKey);
  } catch (err) {
    throw new UpstreamUnreachableError(err);
  }

  if (!upstreamRes.ok) {
    const errBody = await upstreamRes.text();
    log?.(`anthropic upstream ${upstreamRes.status}: ${errBody}`);
    res.writeHead(upstreamRes.status, { 'Content-Type': upstreamRes.headers.get('content-type') || 'application/json' });
    res.end(errBody);
    return;
  }

  if (clientWantsStream && upstreamRes.body) {
    // Read the first chunk before committing the response: some gateways answer a
    // streaming request with 200 and an empty body (OpenCode Go's union-alpha does
    // this for roughly 4 in 10 requests), and that is only visible once the stream ends.
    const reader = upstreamRes.body.getReader();
    const first = await reader.read().catch(() => ({ done: true, value: undefined } as const));
    if (first.done) {
      reader.releaseLock();
      if (retryEmptyStream) {
        log?.('anthropic upstream returned an empty stream; retrying without streaming');
        await replayWithoutStreaming(
          res, messagesUrl, body, apiKey, inboundBeta, authType, claudeCodeSessionId, extraHeaders, log,
        );
        return;
      }
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    if (first.done) {
      res.end();
      return;
    }
    res.write(Buffer.from(first.value!));
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        if (!res.write(Buffer.from(next.value))) await once(res, 'drain');
      }
      res.end();
    } catch {
      res.destroy();
    }
    return;
  }

  if (!upstreamRes.body) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'Upstream returned empty response body' } }));
    return;
  }

  const text = await upstreamRes.text();
  try {
    JSON.parse(text);
  } catch {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'Upstream response was not valid JSON' } }));
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(text).toString(),
  });
  res.end(text);
}

/**
 * Re-send a request that came back as an empty stream, this time without
 * streaming, and replay the complete message to the client as SSE. The client
 * asked for a stream, so it must still receive one.
 */
async function replayWithoutStreaming(
  res: ServerResponse,
  messagesUrl: string,
  body: Record<string, unknown>,
  apiKey: string,
  inboundBeta: string | undefined,
  authType: 'api' | 'oauth' | undefined,
  claudeCodeSessionId: string | undefined,
  extraHeaders: Record<string, string> | undefined,
  log?: (message: string) => void,
): Promise<void> {
  let retryRes: Response;
  try {
    retryRes = await fetch(messagesUrl, {
      method: 'POST',
      headers: anthropicUpstreamHeaders(apiKey, false, inboundBeta, authType, claudeCodeSessionId, extraHeaders),
      body: JSON.stringify({ ...body, stream: false }),
    });
  } catch (err) {
    throw new UpstreamUnreachableError(err);
  }

  const text = await retryRes.text();
  if (!retryRes.ok) {
    log?.(`anthropic upstream ${retryRes.status} on empty-stream retry: ${text}`);
    res.writeHead(retryRes.status, { 'Content-Type': retryRes.headers.get('content-type') || 'application/json' });
    res.end(text);
    return;
  }

  let message: Record<string, unknown>;
  try {
    message = JSON.parse(text) as Record<string, unknown>;
  } catch {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'Upstream response was not valid JSON' } }));
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  writeMessageAsSse(res, message);
}

function writeMessageAsSse(res: ServerResponse, message: Record<string, unknown>): void {
  const content = Array.isArray(message.content) ? message.content as Array<Record<string, unknown>> : [];
  res.write(sseChunk('message_start', {
    type: 'message_start',
    message: { ...message, content: [], stop_reason: null, stop_sequence: null },
  }));

  content.forEach((block, index) => {
    const type = block.type;
    const opening = type === 'text'
      ? { type: 'text', text: '' }
      : type === 'thinking'
        ? { type: 'thinking', thinking: '', signature: '' }
        : type === 'tool_use'
          ? { type: 'tool_use', id: block.id, name: block.name, input: {} }
          : block;
    res.write(sseChunk('content_block_start', { type: 'content_block_start', index, content_block: opening }));

    if (type === 'text') {
      res.write(sseChunk('content_block_delta', {
        type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text ?? '' },
      }));
    } else if (type === 'thinking') {
      res.write(sseChunk('content_block_delta', {
        type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: block.thinking ?? '' },
      }));
      if (typeof block.signature === 'string') {
        res.write(sseChunk('content_block_delta', {
          type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: block.signature },
        }));
      }
    } else if (type === 'tool_use') {
      res.write(sseChunk('content_block_delta', {
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input ?? {}) },
      }));
    }

    res.write(sseChunk('content_block_stop', { type: 'content_block_stop', index }));
  });

  res.write(sseChunk('message_delta', {
    type: 'message_delta',
    delta: { stop_reason: message.stop_reason ?? 'end_turn', stop_sequence: message.stop_sequence ?? null },
    usage: message.usage ?? {},
  }));
  res.write(sseChunk('message_stop', { type: 'message_stop' }));
  res.end();
}
