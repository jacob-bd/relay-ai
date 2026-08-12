import type { IncomingHttpHeaders } from 'node:http';
import {
  CODEX_RESPONSES_LITE_VERSION,
  CODEX_RESPONSES_LITE_WS_URL,
  CODEX_RESPONSES_WEBSOCKETS_BETA,
} from '../constants.js';

export const NATIVE_CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses';
export const NATIVE_FORWARD_HEADERS = new Set([
  'authorization',
  'chatgpt-account-id',
  'openai-beta',
  'originator',
  'session_id',
  'session-id',
  'thread_id',
  'thread-id',
  'turn_id',
  'turn-id',
  'user-agent',
  'version',
  'x-client-request-id',
  'x-codex-turn-metadata',
  'x-codex-turn-state',
  'x-codex-window-id',
  'x-codex-ws-stream-request-start-ms',
  'x-openai-internal-codex-responses-lite',
]);

const NATIVE_HEADER_NAMES: Record<string, string> = {
  'chatgpt-account-id': 'ChatGPT-Account-Id',
  'openai-beta': 'OpenAI-Beta',
};

function headerValue(headers: IncomingHttpHeaders | Record<string, string | undefined>, key: string): string | undefined {
  const found = Object.entries(headers).find(([name]) => name.toLowerCase() === key);
  const value = found?.[1];
  return Array.isArray(value) ? value[0] : value;
}

export function allowlistedNativeHeaders(
  inboundHeaders: IncomingHttpHeaders | Record<string, string | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of NATIVE_FORWARD_HEADERS) {
    const value = headerValue(inboundHeaders, key);
    if (!value) continue;
    out[NATIVE_HEADER_NAMES[key] ?? key] = value;
  }
  return out;
}

export interface NativeHttpForwardOptions {
  body: string | Uint8Array;
  inboundHeaders: IncomingHttpHeaders | Record<string, string | undefined>;
  nativeUrl?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export async function forwardNativeCodexHttp(options: NativeHttpForwardOptions): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = allowlistedNativeHeaders(options.inboundHeaders);
  headers['content-type'] = headerValue(options.inboundHeaders, 'content-type') ?? 'application/json';
  return fetchImpl(options.nativeUrl ?? NATIVE_CODEX_RESPONSES_URL, {
    method: 'POST',
    headers,
    body: options.body as BodyInit,
    signal: options.signal,
    redirect: 'manual',
  });
}

export interface NativeWebSocketOptions {
  headers: IncomingHttpHeaders | Record<string, string | undefined>;
  wsUrl?: string;
}

/** Shared target/headers for the Responses-Lite bridge. The proxy owns framing. */
export function nativeResponsesWebSocketOptions(options: NativeWebSocketOptions): { url: string; headers: Record<string, string> } {
  const headers = allowlistedNativeHeaders(options.headers);
  // The app-server's local WebSocket upgrade does not always carry the
  // upstream protocol headers. Codex's native client requires these on the
  // ChatGPT Responses WebSocket handshake; preserve inbound values when the
  // app supplies newer ones.
  if (!headers['OpenAI-Beta']) headers['OpenAI-Beta'] = CODEX_RESPONSES_WEBSOCKETS_BETA;
  if (!headers.version) headers.version = CODEX_RESPONSES_LITE_VERSION;
  if (!headers.originator) headers.originator = 'codex_cli_rs';
  return {
    url: options.wsUrl ?? CODEX_RESPONSES_LITE_WS_URL,
    headers,
  };
}
