// tests/core-antigravity-model.test.ts — embedded Core Cloud Code Assist routes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateText, stepCountIs, streamText, tool } from 'ai';
import { z } from 'zod';
import { createRelayModel } from '../src/core/model.js';
import { isRelayCoreError } from '../src/core/errors.js';
import { ANTIGRAVITY_BASE_URLS } from '../src/oauth/antigravity-oauth.js';

const ACCESS_CANARY = 'ya29.canary-access-token-zzz';
const REFRESH_CANARY = '1//canary-refresh-token-zzz';
const REFRESHED_ACCESS = 'ya29.refreshed-access-token-ok';
const PROJECT_ID = 'projects/test-cloud-code-project';
const UPSTREAM_MODEL = 'gemini-3.7-flash-high';
const TOOL_SIGNATURE = 'thought-sig-tool-abc';
const THINK_SIGNATURE = 'thought-sig-think-xyz';

vi.mock('@napi-rs/keyring', () => ({
  Entry: class {
    constructor() { throw new Error('keyring unavailable in test'); }
  },
}));

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));
vi.mock('../src/oauth/refresh.js', async importOriginal => {
  const original = await importOriginal<typeof import('../src/oauth/refresh.js')>();
  return { ...original, refreshStoredOAuthCredential: refreshMock };
});

function antigravityProvider(overrides: Record<string, unknown> = {}) {
  return {
    id: 'antigravity',
    templateId: 'antigravity',
    name: 'Antigravity',
    enabled: true,
    authRef: 'keyring:oauth:provider:antigravity',
    authType: 'oauth',
    api: { npm: '@ai-sdk/openai-compatible', url: '' },
    modelsCache: {
      fetchedAt: '2026-08-13T00:00:00Z',
      models: [{
        id: UPSTREAM_MODEL,
        name: 'Gemini 3.7 Flash High',
        upstreamModelId: UPSTREAM_MODEL,
        modelFormat: 'cloud-code',
        npm: null,
        apiUrl: null,
      }],
    },
    addedAt: '2026-08-13T00:00:00Z',
    ...overrides,
  };
}

function groqProvider() {
  return {
    id: 'groq',
    templateId: 'groq',
    name: 'Groq',
    enabled: true,
    authRef: 'keyring:provider:groq',
    authType: 'api',
    api: { npm: '@ai-sdk/groq', url: 'https://api.groq.com/openai/v1' },
    modelsCache: {
      fetchedAt: '2026-08-13T00:00:00Z',
      models: [{
        id: 'llama-3.3-70b', name: 'Llama', upstreamModelId: 'llama-3.3-70b-versatile',
        modelFormat: 'openai',
      }],
    },
    addedAt: '2026-08-13T00:00:00Z',
  };
}

function oauthCredential(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: 'oauth',
    access: ACCESS_CANARY,
    refresh: REFRESH_CANARY,
    expires: Date.now() + 3_600_000,
    accountId: 'acct-ag',
    providerData: { projectId: PROJECT_ID },
    ...overrides,
  });
}

function sseChunk(payload: unknown): string {
  return `data: ${JSON.stringify({ response: payload })}\n\n`;
}

function geminiTextPayload(text: string, extra: Record<string, unknown> = {}) {
  return {
    candidates: [{
      content: { role: 'model', parts: [{ text }] },
      finishReason: 'STOP',
    }],
    usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 3, totalTokenCount: 11 },
    ...extra,
  };
}

function geminiToolPayload() {
  return {
    candidates: [{
      content: {
        role: 'model',
        parts: [
          { text: 'checking weather', thought: true, thoughtSignature: THINK_SIGNATURE },
          {
            functionCall: { name: 'getWeather', args: { city: 'NYC' } },
            thoughtSignature: TOOL_SIGNATURE,
          },
        ],
      },
      finishReason: 'STOP',
    }],
    usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 6, totalTokenCount: 18 },
  };
}

function streamResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[i++]));
    },
  });
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function requestUrl(call: unknown[]): string {
  const input = call[0];
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (input instanceof Request) return input.url;
  return String(input);
}

function requestInit(call: unknown[]): RequestInit {
  const input = call[0];
  if (input instanceof Request) return input;
  return (call[1] as RequestInit | undefined) ?? {};
}

async function requestJson(call: unknown[]): Promise<Record<string, unknown>> {
  const init = requestInit(call);
  const body = init.body;
  if (typeof body === 'string') return JSON.parse(body) as Record<string, unknown>;
  if (body instanceof Uint8Array) return JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>;
  const req = call[0] instanceof Request ? call[0] : new Request(requestUrl(call), init);
  return await req.clone().json() as Record<string, unknown>;
}

function headerValue(call: unknown[], name: string): string | null {
  const headers = new Headers(requestInit(call).headers);
  return headers.get(name);
}

describe('createRelayModel Cloud Code Assist routes', () => {
  let home: string;
  let prevHome: string | undefined;
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'relay-core-ag-'));
    prevHome = process.env.RELAY_AI_HOME;
    process.env.RELAY_AI_HOME = home;
    refreshMock.mockReset();
    refreshMock.mockResolvedValue({
      type: 'oauth',
      access: REFRESHED_ACCESS,
      refresh: REFRESH_CANARY,
      expires: Date.now() + 3_600_000,
      accountId: 'acct-ag',
      providerData: { projectId: PROJECT_ID },
    });
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (prevHome === undefined) delete process.env.RELAY_AI_HOME;
    else process.env.RELAY_AI_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  });

  function writeRegistry(providers: unknown[]) {
    writeFileSync(join(home, 'providers.json'), JSON.stringify({ schemaVersion: 1, providers }));
  }

  function writeSecrets(accounts: Record<string, string>) {
    writeFileSync(join(home, 'secrets.json'), JSON.stringify({ version: 1, accounts }));
  }

  function seedAntigravity(providerData: Record<string, unknown> | undefined = { projectId: PROJECT_ID }) {
    writeRegistry([antigravityProvider()]);
    writeSecrets({
      'oauth:provider:antigravity': oauthCredential({
        ...(providerData === undefined ? { providerData: undefined } : { providerData }),
      }),
    });
  }

  it('routes cloud-code oauth models to a native Google LanguageModel, not openai-compatible', async () => {
    seedAntigravity();
    fetchMock.mockResolvedValue(streamResponse([sseChunk(geminiTextPayload('ok'))]));
    const model = await createRelayModel(`antigravity::${UPSTREAM_MODEL}`);
    expect(model.provider).toBe('google.generative-ai');
    expect(model.modelId).toBe(UPSTREAM_MODEL);

    await streamText({ model, prompt: 'hi', maxRetries: 0 }).text;

    const urls = fetchMock.mock.calls.map(requestUrl);
    expect(urls.some(url => url.includes('/chat/completions'))).toBe(false);
    expect(urls.some(url => url.includes('v1internal:streamGenerateContent'))).toBe(true);
  });

  it('leaves ordinary API-key providers on the generic factory path', async () => {
    writeRegistry([groqProvider()]);
    writeSecrets({ 'provider:groq': 'gsk_test_key' });
    fetchMock.mockResolvedValue(jsonResponse({
      id: 'chatcmpl-1', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));
    const model = await createRelayModel('groq::llama-3.3-70b');
    expect(model.provider).not.toBe('google.generative-ai');
  });

  it('throws CREDENTIAL_UNAVAILABLE when projectId is missing, before any network request', async () => {
    seedAntigravity({});
    let caught: unknown;
    try {
      await createRelayModel(`antigravity::${UPSTREAM_MODEL}`);
    } catch (err) {
      caught = err;
    }
    expect(isRelayCoreError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe('CREDENTIAL_UNAVAILABLE');
    expect((caught as Error).message).toMatch(/re-authenticate/i);
    expect((caught as Error).message).not.toContain(ACCESS_CANARY);
    expect((caught as Error).message).not.toContain(REFRESH_CANARY);
    expect(JSON.stringify(caught)).not.toContain(ACCESS_CANARY);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws CREDENTIAL_UNAVAILABLE when projectId is empty', async () => {
    seedAntigravity({ projectId: '   ' });
    await expect(createRelayModel(`antigravity::${UPSTREAM_MODEL}`)).rejects.toMatchObject({
      code: 'CREDENTIAL_UNAVAILABLE',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('wraps streaming Gemini requests in the Cloud Code Assist envelope', async () => {
    seedAntigravity();
    fetchMock.mockResolvedValue(streamResponse([sseChunk(geminiTextPayload('hello from cloud code'))]));
    const model = await createRelayModel(`antigravity::${UPSTREAM_MODEL}`);
    const abort = new AbortController();
    const text = await streamText({
      model,
      prompt: 'say hello',
      maxRetries: 0,
      abortSignal: abort.signal,
    }).text;

    expect(text).toContain('hello from cloud code');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = requestUrl(fetchMock.mock.calls[0]!);
    expect(url).toBe(`${ANTIGRAVITY_BASE_URLS[0]}/v1internal:streamGenerateContent?alt=sse`);
    expect(headerValue(fetchMock.mock.calls[0]!, 'Authorization')).toBe(`Bearer ${ACCESS_CANARY}`);
    expect(headerValue(fetchMock.mock.calls[0]!, 'User-Agent')).toBe('vscode/1.X.X (Antigravity/4.2.0)');
    expect(headerValue(fetchMock.mock.calls[0]!, 'Content-Type')).toBe('application/json');
    expect(requestInit(fetchMock.mock.calls[0]!).signal).toBe(abort.signal);

    const envelope = await requestJson(fetchMock.mock.calls[0]!);
    expect(envelope.project).toBe(PROJECT_ID);
    expect(envelope.model).toBe(UPSTREAM_MODEL);
    expect(envelope.requestType).toBe('agent');
    expect(envelope.enabledCreditTypes).toEqual(['GOOGLE_ONE_AI']);
    expect(envelope.userAgent).toBe('vscode/1.X.X (Antigravity/4.2.0)');
    expect(envelope.requestId).toEqual(expect.stringMatching(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    ));
    expect(envelope.request).toEqual(expect.objectContaining({
      contents: expect.any(Array),
    }));
    const snapshot = JSON.stringify({ url, envelope: { ...envelope, request: '[omitted]' } });
    expect(snapshot).not.toContain(ACCESS_CANARY);
    expect(snapshot).not.toContain(REFRESH_CANARY);
  });

  it('unwraps Cloud Code SSE wrappers across split and batched byte chunks', async () => {
    seedAntigravity();
    const eventA = sseChunk({
      candidates: [{ content: { role: 'model', parts: [{ text: 'Hel' }] } }],
    });
    const eventB = sseChunk({
      candidates: [{
        content: { role: 'model', parts: [{ text: 'lo' }] },
        finishReason: 'STOP',
      }],
      usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 2, totalTokenCount: 4 },
    });
    const combined = eventA + eventB;
    const mid = Math.floor(eventA.length / 2);
    fetchMock.mockResolvedValue(streamResponse([
      combined.slice(0, mid),
      combined.slice(mid, eventA.length + 10),
      combined.slice(eventA.length + 10),
    ]));

    const model = await createRelayModel(`antigravity::${UPSTREAM_MODEL}`);
    const result = streamText({ model, prompt: 'hi', maxRetries: 0 });
    await expect(result.text).resolves.toBe('Hello');
    await expect(result.finishReason).resolves.toBe('stop');
    const usage = await result.usage;
    expect(usage.inputTokens).toBe(2);
    expect(usage.outputTokens).toBe(2);
  });

  it('uses generateContent for non-streaming calls and unwraps the JSON wrapper', async () => {
    seedAntigravity();
    fetchMock.mockResolvedValue(jsonResponse({
      response: geminiTextPayload('unary hi'),
    }));
    const model = await createRelayModel(`antigravity::${UPSTREAM_MODEL}`);
    const result = await generateText({ model, prompt: 'hi', maxRetries: 0 });
    expect(result.text).toBe('unary hi');
    expect(requestUrl(fetchMock.mock.calls[0]!)).toBe(
      `${ANTIGRAVITY_BASE_URLS[0]}/v1internal:generateContent`,
    );
  });

  it('returns actionable non-2xx errors without credential material', async () => {
    seedAntigravity();
    fetchMock.mockResolvedValue(jsonResponse(
      { error: { code: 429, message: 'quota exceeded', status: 'RESOURCE_EXHAUSTED' } },
      429,
    ));
    const model = await createRelayModel(`antigravity::${UPSTREAM_MODEL}`);
    let caught: unknown;
    try {
      await generateText({ model, prompt: 'hi', maxRetries: 0 });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const err = caught as Error & { statusCode?: number; responseBody?: string; message: string };
    expect(`${err.message} ${err.statusCode ?? ''} ${err.responseBody ?? ''}`).toMatch(/quota exceeded|RESOURCE_EXHAUSTED|429/i);
    expect(JSON.stringify(caught)).not.toContain(ACCESS_CANARY);
    expect(JSON.stringify(caught)).not.toContain(REFRESH_CANARY);
    expect(JSON.stringify(caught)).not.toContain('Authorization');
  });

  it('refreshes exactly once on a 401 and retries with the new token', async () => {
    seedAntigravity();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'expired' } }, 401))
      .mockResolvedValueOnce(streamResponse([sseChunk(geminiTextPayload('after refresh'))]));

    const model = await createRelayModel(`antigravity::${UPSTREAM_MODEL}`);
    const text = await streamText({ model, prompt: 'hi', maxRetries: 0 }).text;
    expect(text).toContain('after refresh');
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(headerValue(fetchMock.mock.calls[0]!, 'Authorization')).toBe(`Bearer ${ACCESS_CANARY}`);
    expect(headerValue(fetchMock.mock.calls[1]!, 'Authorization')).toBe(`Bearer ${REFRESHED_ACCESS}`);
    const firstId = (await requestJson(fetchMock.mock.calls[0]!)).requestId;
    const secondId = (await requestJson(fetchMock.mock.calls[1]!)).requestId;
    expect(secondId).toBe(firstId);
  });

  it('does not refresh again when the retried request also returns 401', async () => {
    seedAntigravity();
    fetchMock.mockResolvedValue(jsonResponse({ error: { message: 'still unauthorized' } }, 401));
    const model = await createRelayModel(`antigravity::${UPSTREAM_MODEL}`);
    await expect(generateText({ model, prompt: 'hi', maxRetries: 0 })).rejects.toBeInstanceOf(Error);
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(refreshMock.mock.results)).not.toContain(ACCESS_CANARY);
  });

  it('does not refresh on non-401 failures', async () => {
    seedAntigravity();
    fetchMock.mockResolvedValue(jsonResponse({ error: { message: 'nope' } }, 403));
    const model = await createRelayModel(`antigravity::${UPSTREAM_MODEL}`);
    await expect(generateText({ model, prompt: 'hi', maxRetries: 0 })).rejects.toBeInstanceOf(Error);
    expect(refreshMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('propagates abort without refreshing or retrying', async () => {
    seedAntigravity();
    const abort = new AbortController();
    fetchMock.mockImplementation((_input: unknown, init?: RequestInit) => {
      const signal = init?.signal;
      return new Promise((_resolve, reject) => {
        if (signal?.aborted) {
          reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
          return;
        }
        signal?.addEventListener('abort', () => {
          reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
        });
      });
    });
    const model = await createRelayModel(`antigravity::${UPSTREAM_MODEL}`);
    const pending = generateText({ model, prompt: 'hi', maxRetries: 0, abortSignal: abort.signal });
    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(refreshMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('round-trips Gemini thought signatures through a tool loop', async () => {
    seedAntigravity();
    fetchMock
      .mockResolvedValueOnce(streamResponse([sseChunk(geminiToolPayload())]))
      .mockResolvedValueOnce(streamResponse([sseChunk(geminiTextPayload('72F in NYC'))]));

    const model = await createRelayModel(`antigravity::${UPSTREAM_MODEL}`);
    const result = streamText({
      model,
      prompt: 'weather in NYC?',
      maxRetries: 0,
      stopWhen: stepCountIs(2),
      tools: {
        getWeather: tool({
          description: 'Get the weather',
          inputSchema: z.object({ city: z.string() }),
          execute: async ({ city }) => ({ city, tempF: 72 }),
        }),
      },
    });

    const text = await result.text;
    expect(text).toContain('72F in NYC');
    const steps = await result.steps;
    const toolCalls = steps.flatMap(step => step.toolCalls);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toMatchObject({
      toolName: 'getWeather',
      input: { city: 'NYC' },
    });
    const signature = toolCalls[0]?.providerMetadata?.google?.thoughtSignature
      ?? toolCalls[0]?.providerMetadata?.google?.thought_signature;
    expect(signature).toBe(TOOL_SIGNATURE);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const followUp = await requestJson(fetchMock.mock.calls[1]!);
    const request = followUp.request as { contents?: Array<{ parts?: Array<Record<string, unknown>> }> };
    const parts = request.contents?.flatMap(c => c.parts ?? []) ?? [];
    const replayed = parts.find(p => p.functionCall && typeof p.functionCall === 'object');
    expect(replayed).toBeTruthy();
    expect(
      replayed?.thoughtSignature
      ?? replayed?.thought_signature
      ?? (replayed?.functionCall as Record<string, unknown> | undefined)?.thoughtSignature,
    ).toBe(TOOL_SIGNATURE);
    expect(JSON.stringify(followUp)).not.toContain(ACCESS_CANARY);
  });

  it('re-reads registry state on every createRelayModel call', async () => {
    seedAntigravity();
    fetchMock.mockResolvedValue(streamResponse([sseChunk(geminiTextPayload('ok'))]));
    await createRelayModel(`antigravity::${UPSTREAM_MODEL}`);
    writeRegistry([antigravityProvider({ enabled: false })]);
    await expect(createRelayModel(`antigravity::${UPSTREAM_MODEL}`)).rejects.toMatchObject({
      code: 'PROVIDER_DISABLED',
    });
  });
});

describe('Cloud Code SSE/JSON unwrap', () => {
  it('unwraps response wrappers, [DONE], malformed events, and split chunks', async () => {
    const {
      unwrapCloudCodeSsePayload,
      unwrapCloudCodeJsonBody,
      consumeCloudCodeSseBuffer,
      createCloudCodeSseUnwrapper,
    } = await import('../src/core/antigravity-model.js');

    expect(JSON.parse(unwrapCloudCodeSsePayload(JSON.stringify({
      response: { candidates: [{ finishReason: 'STOP' }], usageMetadata: { totalTokenCount: 3 } },
    })))).toEqual({ candidates: [{ finishReason: 'STOP' }], usageMetadata: { totalTokenCount: 3 } });
    expect(unwrapCloudCodeSsePayload('[DONE]')).toBe('[DONE]');
    expect(unwrapCloudCodeSsePayload('not-json')).toBe('not-json');
    expect(unwrapCloudCodeSsePayload(JSON.stringify({ error: { message: 'boom' } }))).toBe(
      JSON.stringify({ error: { message: 'boom' } }),
    );

    const unary = unwrapCloudCodeJsonBody(JSON.stringify({
      response: { candidates: [{ content: { parts: [{ functionCall: { name: 'x', args: { a: 1 } }, thoughtSignature: 'sig' }] } }] },
    }));
    expect(JSON.parse(unary)).toEqual({
      candidates: [{ content: { parts: [{ functionCall: { name: 'x', args: { a: 1 } }, thoughtSignature: 'sig' }] } }],
    });

    const first = 'data: {"response":{"text":"Hel';
    const second = 'lo"}}\n\ndata: {"response":{"text":"lo"}}\n\ndata: [DONE]\n\n';
    const mid = consumeCloudCodeSseBuffer(first);
    expect(mid.emitted).toBe('');
    expect(mid.rest).toBe(first);
    const done = consumeCloudCodeSseBuffer(mid.rest + second);
    expect(done.rest).toBe('');
    expect(done.emitted).toContain('data: {"text":"Hello"}');
    expect(done.emitted).toContain('data: {"text":"lo"}');
    expect(done.emitted).toContain('data: [DONE]');

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"response":{"n":1}}\n\ndata: {"response":{"n":2}}\n\n'));
        controller.close();
      },
    }).pipeThrough(createCloudCodeSseUnwrapper());
    let out = '';
    for await (const chunk of stream) out += decoder.decode(chunk, { stream: true });
    out += decoder.decode();
    expect(out).toContain('data: {"n":1}');
    expect(out).toContain('data: {"n":2}');
  });
});
