// src/core/antigravity-model.ts — native Google LanguageModel over Cloud Code Assist.
//
// Core cannot start a local proxy. Cloud Code models are not OpenAI-compatible:
// wrap @ai-sdk/google generateContent requests in the Cloud Code envelope and
// unwrap `{response: ...}` so the Google SDK sees native Gemini payloads.

import { randomUUID } from 'node:crypto';
import type { LanguageModel } from 'ai';
import {
  ANTIGRAVITY_API_VERSION,
  ANTIGRAVITY_BASE_URLS,
  ANTIGRAVITY_USER_AGENT,
} from '../oauth/antigravity-oauth.js';

export interface AntigravityCloudCodeModelOptions {
  modelId: string;
  accessToken: string;
  projectId: string;
  refreshToken?: () => Promise<string | null>;
  /**
   * Sanitized transport diagnostics. Messages carry endpoint host, attempt
   * number, status, byte counts and error *names* only — never tokens, the
   * project id, prompts, tool arguments, or any response body.
   */
  onDebug?: (message: string) => void;
}

const CLOUD_CODE_BASES = ANTIGRAVITY_BASE_URLS.map(base => base.replace(/\/+$/, ''));
const CLOUD_CODE_BASE = CLOUD_CODE_BASES[0]!;
/** Ordered fallback lists — same order as ANTIGRAVITY_BASE_URLS, first success wins. */
const STREAM_URLS = CLOUD_CODE_BASES.map(base => `${base}/${ANTIGRAVITY_API_VERSION}:streamGenerateContent?alt=sse`);
const UNARY_URLS = CLOUD_CODE_BASES.map(base => `${base}/${ANTIGRAVITY_API_VERSION}:generateContent`);
/** Syntactically valid Google SDK prefix — every request is intercepted by custom fetch. */
const SDK_BASE_URL = `${CLOUD_CODE_BASE}/v1beta`;

/**
 * Statuses that mean "this endpoint can't serve the request" rather than
 * "this request is wrong". Only these fail over — replaying a 400/401/403 across
 * every endpoint would just repeat a request the caller has to fix.
 */
const ENDPOINT_FAILOVER_STATUSES = new Set([404, 408, 429]);

function shouldTryNextEndpoint(status: number): boolean {
  return ENDPOINT_FAILOVER_STATUSES.has(status) || status >= 500;
}

/** Release a response we are abandoning, so its socket is not held open. */
function discardResponse(response: Response): void {
  try { void response.body?.cancel(); } catch { /* already released */ }
}

export function unwrapCloudCodeSsePayload(payload: string): string {
  const trimmed = payload.trim();
  if (trimmed === '' || trimmed === '[DONE]') return payload;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (isWrappedCloudCodeBody(parsed)) {
      return JSON.stringify(parsed.response);
    }
  } catch {
    // Malformed JSON / error events pass through unchanged.
  }
  return payload;
}

export function unwrapCloudCodeJsonBody(text: string): string {
  try {
    const parsed: unknown = JSON.parse(text);
    if (isWrappedCloudCodeBody(parsed)) {
      return JSON.stringify(parsed.response);
    }
  } catch {
    // keep original
  }
  return text;
}

export function consumeCloudCodeSseBuffer(buffer: string): { emitted: string; rest: string } {
  const separator = /\r?\n\r?\n/;
  let rest = buffer;
  let emitted = '';
  while (true) {
    const match = separator.exec(rest);
    if (!match || match.index === undefined) break;
    const rawEvent = rest.slice(0, match.index);
    const sep = match[0];
    rest = rest.slice(match.index + sep.length);
    emitted += transformSseEvent(rawEvent) + sep;
  }
  return { emitted, rest };
}

export function createCloudCodeSseUnwrapper(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = '';
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true });
      const { emitted, rest } = consumeCloudCodeSseBuffer(pending);
      pending = rest;
      if (emitted) controller.enqueue(encoder.encode(emitted));
    },
    flush(controller) {
      pending += decoder.decode();
      if (!pending) return;
      const { emitted, rest } = consumeCloudCodeSseBuffer(pending);
      const tail = emitted + (rest ? transformSseEvent(rest) : '');
      if (tail) controller.enqueue(encoder.encode(tail));
    },
  });
}

export function createCloudCodeFetch(
  options: AntigravityCloudCodeModelOptions,
  fetchImpl?: typeof globalThis.fetch,
): typeof globalThis.fetch {
  let accessToken = options.accessToken;
  const debug = (msg: string) => { try { options.onDebug?.(`cloud-code: ${msg}`); } catch { /* ignore */ } };

  return async (input, init) => {
    const url = requestUrl(input);
    const streaming = url.includes('streamGenerateContent');
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const geminiBody = await readJsonBody(input, init);
    const envelope = {
      project: options.projectId,
      requestId: randomUUID(),
      model: options.modelId,
      userAgent: ANTIGRAVITY_USER_AGENT,
      requestType: 'agent' as const,
      enabledCreditTypes: ['GOOGLE_ONE_AI'],
      request: geminiBody,
    };
    const body = JSON.stringify(envelope);
    // `String.length` is UTF-16 code units, not bytes — non-ASCII prompts would
    // under-report. The diagnostic claims bytes, so measure bytes.
    const bodyByteLength = Buffer.byteLength(body, 'utf8');
    const upstreamUrls = streaming ? STREAM_URLS : UNARY_URLS;
    const doFetch = fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));

    const send = async (url: string, token: string): Promise<Response> => {
      try {
        return await doFetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            'User-Agent': ANTIGRAVITY_USER_AGENT,
          },
          body,
          signal,
        });
      } catch (err) {
        if (isAbortError(err, signal)) throw abortError(signal, err);
        throw err;
      }
    };

    /**
     * Walk the ordered endpoint list. The decision to move on is made from the
     * status line alone, before the body is read — so once a response is
     * returned, its (possibly streaming) body is committed to and no later
     * endpoint is ever tried.
     */
    const sendWithFailover = async (token: string, startIndex = 0): Promise<{ response: Response; url: string; index: number }> => {
      let lastError: unknown;
      for (let i = startIndex; i < upstreamUrls.length; i += 1) {
        const url = upstreamUrls[i]!;
        const isLast = i === upstreamUrls.length - 1;
        const where = `endpoint=${i + 1}/${upstreamUrls.length} host=${endpointHost(url)}`;
        let response: Response | undefined;
        try {
          debug(`request ${where} kind=${streaming ? 'stream' : 'unary'} payloadBytes=${bodyByteLength}`);
          response = await send(url, token);
        } catch (err) {
          if (isAbortError(err, signal)) throw err;
          lastError = err;
          debug(`network failure ${where} errorName=${errorName(err)}`);
        }
        if (response) {
          if (isLast || !shouldTryNextEndpoint(response.status)) {
            debug(`response ${where} status=${response.status}`);
            return { response, url, index: i };
          }
          discardResponse(response);
          lastError = new Error(`Cloud Code Assist endpoint returned ${response.status}`);
          debug(`retryable status=${response.status} ${where} — trying next endpoint`);
        }
        // Only reached when another endpoint is still to be tried.
        if (signal?.aborted) throw abortError(signal);
      }
      throw lastError ?? new Error('All Cloud Code Assist endpoints failed');
    };

    // The token *this* request actually sent. Comparing the refresh result
    // against the shared `accessToken` instead would let whichever concurrent
    // request refreshed first suppress every other in-flight request's retry.
    const tokenUsed = accessToken;
    let { response, index: servedByIndex } = await sendWithFailover(tokenUsed);

    if (response.status === 401 && options.refreshToken && !signal?.aborted) {
      debug('status=401 — refreshing credential');
      const refreshed = await options.refreshToken().catch(() => null);
      if (refreshed && refreshed !== tokenUsed && !signal?.aborted) {
        accessToken = refreshed;
        discardResponse(response);
        // One refresh, one retry — resuming the ordered fallback *at* the
        // endpoint that issued the 401. Earlier endpoints already failed for
        // their own reasons, so they are not replayed; later ones are still the
        // documented fallback if the retried endpoint is itself down.
        ({ response } = await sendWithFailover(refreshed, servedByIndex));
        debug(`retry after refresh status=${response.status}`);
      } else {
        debug(`refresh did not yield a new credential (refreshed=${refreshed ? 'same' : 'none'})`);
      }
    }

    return adaptUpstreamResponse(response, streaming);
  };
}

export async function createAntigravityCloudCodeModel(
  options: AntigravityCloudCodeModelOptions,
): Promise<LanguageModel> {
  const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
  const google = createGoogleGenerativeAI({
    apiKey: 'relay-cloud-code',
    baseURL: SDK_BASE_URL,
    fetch: createCloudCodeFetch(options),
  });
  return google(options.modelId);
}

/** Host only — the endpoint URLs are compile-time constants, never user data. */
function endpointHost(url: string): string {
  try { return new URL(url).host; } catch { return 'unknown'; }
}

/** Error *name* only — messages can embed request URLs or upstream body text. */
function errorName(err: unknown): string {
  if (err instanceof Error) return err.name || 'Error';
  return typeof err;
}

function isWrappedCloudCodeBody(parsed: unknown): parsed is { response: object } {
  return !!parsed
    && typeof parsed === 'object'
    && !Array.isArray(parsed)
    && 'response' in parsed
    && (parsed as { response: unknown }).response !== null
    && typeof (parsed as { response: unknown }).response === 'object';
}

function transformSseEvent(event: string): string {
  return event.replace(/^(data:[ \t]*)(.*)$/gm, (_all, prefix: string, payload: string) => (
    `${prefix}${unwrapCloudCodeSsePayload(payload)}`
  ));
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

async function readJsonBody(input: RequestInfo | URL, init?: RequestInit): Promise<unknown> {
  const body = init?.body;
  if (typeof body === 'string') return JSON.parse(body);
  if (body instanceof Uint8Array) return JSON.parse(new TextDecoder().decode(body));
  if (body instanceof ArrayBuffer) return JSON.parse(new TextDecoder().decode(body));
  const request = input instanceof Request ? input.clone() : new Request(input, init);
  return request.json();
}

async function adaptUpstreamResponse(upstream: Response, streaming: boolean): Promise<Response> {
  const fallbackType = streaming ? 'text/event-stream' : 'application/json';
  const contentType = upstream.headers.get('content-type') ?? fallbackType;
  const headers = new Headers({ 'Content-Type': contentType });
  if (!upstream.ok) {
    const errBody = await upstream.text();
    return new Response(errBody, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  }
  if (streaming) {
    const body = upstream.body ? upstream.body.pipeThrough(createCloudCodeSseUnwrapper()) : null;
    return new Response(body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  }
  const text = await upstream.text();
  headers.set('Content-Type', 'application/json');
  return new Response(unwrapCloudCodeJsonBody(text), { status: 200, headers });
}

function isAbortError(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return !!err && typeof err === 'object' && (err as { name?: string }).name === 'AbortError';
}

function abortError(signal: AbortSignal | undefined, cause?: unknown): Error {
  if (signal?.reason instanceof Error) return signal.reason;
  if (cause instanceof Error) return cause;
  return new DOMException('This operation was aborted', 'AbortError');
}
