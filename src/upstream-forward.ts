import { Readable } from 'node:stream';
import type { ServerResponse } from 'node:http';
import { sanitizeCredential } from './server/auth.js';
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
export interface RelayAnthropicOptions {
  inboundBeta?: string;
  authType?: 'api' | 'oauth';
  log?: (message: string) => void;
  claudeCodeSessionId?: string;
  extraHeaders?: Record<string, string>;
  refreshToken?: () => Promise<string | null>;
  onTokenRefreshed?: (token: string) => void;
  onUpstreamError?: (statusCode: number, body: string) => void;
  signal?: AbortSignal;
}

export async function relayAnthropicMessages(
  res: ServerResponse,
  messagesUrl: string,
  body: Record<string, unknown>,
  apiKey: string,
  clientWantsStream: boolean,
  options: RelayAnthropicOptions = {},
): Promise<void> {
  const doFetch = (key: string) => fetch(messagesUrl, {
    method: 'POST',
    headers: anthropicUpstreamHeaders(
      key,
      clientWantsStream,
      options.inboundBeta,
      options.authType,
      options.claudeCodeSessionId,
      options.extraHeaders,
    ),
    body: JSON.stringify(body),
    signal: options.signal,
  });

  let upstreamRes: Response;
  try {
    const retryResult = await fetchWithOAuthRetry(apiKey, doFetch, options.refreshToken);
    upstreamRes = retryResult.response;
    if (retryResult.refreshed) options.onTokenRefreshed?.(retryResult.apiKey);
  } catch (err) {
    throw new UpstreamUnreachableError(err);
  }

  if (!upstreamRes.ok) {
    const errBody = await upstreamRes.text();
    options.log?.(`anthropic upstream ${upstreamRes.status}: ${errBody}`);
    options.onUpstreamError?.(upstreamRes.status, errBody);
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
