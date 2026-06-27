import { Readable } from 'node:stream';
import type { ServerResponse } from 'node:http';
import { sanitizeCredential } from './server/auth.js';
import { CLAUDE_CODE_USER_AGENT } from './oauth/claude-identity.js';

export function anthropicUpstreamHeaders(
  apiKey: string,
  stream = false,
  inboundBeta?: string,
  authType?: 'api' | 'oauth',
): Record<string, string> {
  const key = sanitizeCredential(apiKey) ?? apiKey.trim();
  const isOAuth = authType === 'oauth';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
    Authorization: `Bearer ${key}`,
    ...(isOAuth ? {} : { 'x-api-key': key }),
    ...(isOAuth ? { 'User-Agent': CLAUDE_CODE_USER_AGENT } : {}),
    ...(stream ? { Accept: 'text/event-stream' } : {}),
  };
  if (inboundBeta) {
    headers['anthropic-beta'] = inboundBeta;
  }
  return headers;
}

export async function postJsonUpstream(
  url: string,
  body: unknown,
  apiKey: string,
  inboundBeta?: string,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: anthropicUpstreamHeaders(apiKey, false, inboundBeta),
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: response.status, body: parsed };
}

export class UpstreamUnreachableError extends Error {
  constructor(cause: unknown) {
    super(`Upstream unreachable: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'UpstreamUnreachableError';
  }
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
): Promise<void> {
  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(messagesUrl, {
      method: 'POST',
      headers: anthropicUpstreamHeaders(apiKey, clientWantsStream, inboundBeta, authType),
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new UpstreamUnreachableError(err);
  }

  if (!upstreamRes.ok) {
    const errBody = await upstreamRes.text();
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
    Readable.fromWeb(upstreamRes.body as Parameters<typeof Readable.fromWeb>[0])
      .on('error', () => res.destroy())
      .pipe(res);
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
