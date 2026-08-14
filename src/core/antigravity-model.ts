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
}

const CLOUD_CODE_BASE = ANTIGRAVITY_BASE_URLS[0]!.replace(/\/+$/, '');
const STREAM_URL = `${CLOUD_CODE_BASE}/${ANTIGRAVITY_API_VERSION}:streamGenerateContent?alt=sse`;
const UNARY_URL = `${CLOUD_CODE_BASE}/${ANTIGRAVITY_API_VERSION}:generateContent`;
/** Syntactically valid Google SDK prefix — every request is intercepted by custom fetch. */
const SDK_BASE_URL = `${CLOUD_CODE_BASE}/v1beta`;

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
    const upstreamUrl = streaming ? STREAM_URL : UNARY_URL;
    const doFetch = fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));

    const send = (token: string) => doFetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'User-Agent': ANTIGRAVITY_USER_AGENT,
      },
      body,
      signal,
    });

    let response: Response;
    try {
      response = await send(accessToken);
    } catch (err) {
      if (isAbortError(err, signal)) throw abortError(signal, err);
      throw err;
    }

    if (response.status === 401 && options.refreshToken && !signal?.aborted) {
      const refreshed = await options.refreshToken().catch(() => null);
      if (refreshed && refreshed !== accessToken && !signal?.aborted) {
        accessToken = refreshed;
        try {
          response = await send(accessToken);
        } catch (err) {
          if (isAbortError(err, signal)) throw abortError(signal, err);
          throw err;
        }
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
