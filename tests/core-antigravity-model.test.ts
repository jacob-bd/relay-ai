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
    // A fresh Response per call: 429 is an endpoint-failover status, so every
    // base URL is tried before the error surfaces.
    fetchMock.mockImplementation(async () => jsonResponse(
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

  // The catalog classified cloud-code routes by the provider's registry npm
  // (openai-compatible) while Core builds them with @ai-sdk/google, so the
  // descriptor reported "fixed" for levels Core actually accepts.
  it('reports Cloud Code reasoning capabilities that match what Core accepts', async () => {
    seedAntigravity();
    const { listRelayModels } = await import('../src/core/catalog.js');
    const descriptor = listRelayModels().find(m => m.routeId === `antigravity::${UPSTREAM_MODEL}`)!;
    expect(descriptor.capabilities.reasoning).toBe('adjustable');
    expect(descriptor.capabilities.reasoningLevels).toEqual(['low', 'medium', 'high']);

    // Every advertised level must actually construct.
    for (const level of descriptor.capabilities.reasoningLevels ?? []) {
      fetchMock.mockResolvedValue(streamResponse([sseChunk(geminiTextPayload('ok'))]));
      await expect(createRelayModel(`antigravity::${UPSTREAM_MODEL}`, { reasoning: level })).resolves.toBeTruthy();
    }
  });

  it('maps a Core reasoning level onto the Cloud Code route in Gemini terms', async () => {
    seedAntigravity();
    fetchMock.mockResolvedValue(streamResponse([sseChunk(geminiTextPayload('ok'))]));
    const model = await createRelayModel(`antigravity::${UPSTREAM_MODEL}`, { reasoning: 'high' });
    await streamText({ model, prompt: 'hi', maxRetries: 0 }).text;

    const envelope = await requestJson(fetchMock.mock.calls[0]!);
    const request = envelope.request as { generationConfig?: Record<string, unknown> };
    // Provider-specific shape stays inside Relay Core — the caller only said 'high'.
    expect(request.generationConfig?.thinkingConfig).toBeTruthy();
  });

  it('fails clearly when a Cloud Code route is asked for an unsupported level', async () => {
    seedAntigravity();
    await expect(createRelayModel(`antigravity::${UPSTREAM_MODEL}`, { reasoning: 'banana' as never }))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_REASONING_LEVEL' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Gemini exposes low/medium/high. The shared CLI mapper substitutes the
  // nearest value for none/minimal/xhigh; Core must refuse instead, or it would
  // report a level it never sent.
  it.each(['none', 'minimal', 'xhigh'] as const)(
    'refuses reasoning level %s on a Gemini-backed route instead of substituting',
    async level => {
      seedAntigravity();
      let caught: unknown;
      try {
        await createRelayModel(`antigravity::${UPSTREAM_MODEL}`, { reasoning: level });
      } catch (err) {
        caught = err;
      }
      expect(isRelayCoreError(caught)).toBe(true);
      expect((caught as { code: string }).code).toBe('UNSUPPORTED_REASONING_LEVEL');
      // The message points at the levels the route really has.
      expect((caught as Error).message).toMatch(/low.*medium.*high/);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('forwards sanitized transport diagnostics through the Cloud Code route', async () => {
    seedAntigravity();
    const PROMPT_CANARY = 'what-is-the-weather-canary-zzz';
    const debugLines: string[] = [];
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'endpoint down' } }, 503))
      .mockResolvedValueOnce(streamResponse([sseChunk(geminiToolPayload())]));

    const model = await createRelayModel(`antigravity::${UPSTREAM_MODEL}`, {
      onDebug: msg => debugLines.push(msg),
    });
    const result = streamText({
      model,
      prompt: PROMPT_CANARY,
      maxRetries: 0,
      stopWhen: stepCountIs(1),
      tools: {
        getWeather: tool({ description: 'Get the weather', inputSchema: z.object({ city: z.string() }) }),
      },
    });
    await result.steps;

    // The hook is documented as a Core transport diagnostics hook — it has to
    // actually produce something on this route.
    expect(debugLines.length).toBeGreaterThan(0);
    const joined = debugLines.join('\n');
    expect(joined).not.toContain(ACCESS_CANARY);
    expect(joined).not.toContain(REFRESH_CANARY);
    expect(joined).not.toContain(REFRESHED_ACCESS);
    expect(joined).not.toContain('Bearer');
    expect(joined).not.toContain(PROMPT_CANARY);
    expect(joined).not.toContain(PROJECT_ID);
    expect(joined).not.toContain('NYC');               // tool-call arguments
    expect(joined).not.toContain('checking weather');  // response body text
    expect(joined).not.toContain(TOOL_SIGNATURE);
    expect(joined).not.toContain(THINK_SIGNATURE);
    // Still useful: the endpoint failover is visible.
    expect(joined).toMatch(/503/);
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

describe('Cloud Code ordered endpoint failover', () => {
  const TOKEN = 'ya29.failover-token-canary-zzz';

  const streamUrls = ANTIGRAVITY_BASE_URLS.map(b => `${b}/v1internal:streamGenerateContent?alt=sse`);
  const unaryUrls = ANTIGRAVITY_BASE_URLS.map(b => `${b}/v1internal:generateContent`);

  /** Drive one request through `createCloudCodeFetch` with a scripted upstream. */
  async function run(
    handler: (url: string, init: RequestInit | undefined, attempt: number) => Promise<Response>,
    opts: { streaming?: boolean; signal?: AbortSignal; refreshToken?: () => Promise<string | null> } = {},
  ) {
    const urls: string[] = [];
    let attempt = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      urls.push(url);
      attempt += 1;
      return handler(url, init, attempt);
    });
    const { createCloudCodeFetch } = await import('../src/core/antigravity-model.js');
    const cloudFetch = createCloudCodeFetch({
      modelId: UPSTREAM_MODEL,
      accessToken: TOKEN,
      projectId: PROJECT_ID,
      ...(opts.refreshToken ? { refreshToken: opts.refreshToken } : {}),
    }, fetchImpl as unknown as typeof globalThis.fetch);

    const requestUrlIn = opts.streaming
      ? 'https://sdk.local/v1beta/models/m:streamGenerateContent?alt=sse'
      : 'https://sdk.local/v1beta/models/m:generateContent';
    const response = await cloudFetch(requestUrlIn, {
      method: 'POST',
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] }),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    return { response, urls, fetchImpl };
  }

  it('exposes more than one base URL, so failover is meaningful', () => {
    expect(ANTIGRAVITY_BASE_URLS.length).toBeGreaterThan(1);
  });

  it('falls back to the next endpoint after a network failure (streaming)', async () => {
    const { response, urls } = await run(async (_url, _init, attempt) => {
      if (attempt === 1) throw new TypeError('fetch failed');
      return streamResponse([sseChunk(geminiTextPayload('second endpoint'))]);
    }, { streaming: true });
    expect(response.status).toBe(200);
    expect(urls).toEqual([streamUrls[0], streamUrls[1]]);
    expect(await response.text()).toContain('second endpoint');
  });

  it('falls back to the next endpoint after a network failure (unary)', async () => {
    const { response, urls } = await run(async (_url, _init, attempt) => {
      if (attempt === 1) throw new TypeError('fetch failed');
      return jsonResponse({ response: geminiTextPayload('second endpoint') });
    });
    expect(response.status).toBe(200);
    expect(urls).toEqual([unaryUrls[0], unaryUrls[1]]);
  });

  it.each([404, 408, 429, 500, 503])('falls back on a retryable %i and keeps endpoint order', async status => {
    const { response, urls } = await run(async (_url, _init, attempt) => (
      attempt === 1
        ? jsonResponse({ error: { message: 'endpoint down' } }, status)
        : jsonResponse({ response: geminiTextPayload('recovered') })
    ));
    expect(response.status).toBe(200);
    expect(urls).toEqual([unaryUrls[0], unaryUrls[1]]);
  });

  it('does not call a second endpoint when the first succeeds', async () => {
    const { response, urls, fetchImpl } = await run(async () => (
      jsonResponse({ response: geminiTextPayload('first endpoint') })
    ));
    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(urls).toEqual([unaryUrls[0]]);
  });

  it.each([400, 401, 403, 422])('does not replay a non-retryable %i across endpoints', async status => {
    const { response, fetchImpl } = await run(async () => (
      jsonResponse({ error: { message: 'client error' } }, status)
    ));
    expect(response.status).toBe(status);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns the last endpoint response when every endpoint is retryable-failing', async () => {
    const { response, fetchImpl } = await run(async () => (
      jsonResponse({ error: { message: 'down' } }, 503)
    ));
    expect(response.status).toBe(503);
    expect(fetchImpl).toHaveBeenCalledTimes(ANTIGRAVITY_BASE_URLS.length);
  });

  it('throws when every endpoint has a network failure', async () => {
    await expect(run(async () => { throw new TypeError('fetch failed'); }))
      .rejects.toThrow(/fetch failed/);
  });

  it('stops attempting further endpoints once aborted', async () => {
    const abort = new AbortController();
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      abort.abort();
      throw new DOMException('This operation was aborted', 'AbortError');
    });
    const { createCloudCodeFetch } = await import('../src/core/antigravity-model.js');
    const cloudFetch = createCloudCodeFetch({
      modelId: UPSTREAM_MODEL,
      accessToken: TOKEN,
      projectId: PROJECT_ID,
    }, fetchImpl as unknown as typeof globalThis.fetch);

    await expect(cloudFetch('https://sdk.local/v1beta/models/m:generateContent', {
      method: 'POST',
      body: JSON.stringify({ contents: [] }),
      signal: abort.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
    // Aborted on the first endpoint — the remaining endpoints are never tried.
    expect(calls).toEqual([unaryUrls[0]]);
  });

  it('keeps upstream error text out of failover diagnostics', async () => {
    const BODY_CANARY = 'upstream-error-text-canary-zzz';
    const debugLines: string[] = [];
    const fetchImpl = vi.fn(async () => { throw new TypeError(`fetch failed: ${BODY_CANARY}`); });
    const { createCloudCodeFetch } = await import('../src/core/antigravity-model.js');
    const cloudFetch = createCloudCodeFetch({
      modelId: UPSTREAM_MODEL,
      accessToken: TOKEN,
      projectId: PROJECT_ID,
      onDebug: msg => debugLines.push(msg),
    }, fetchImpl as unknown as typeof globalThis.fetch);

    await expect(cloudFetch('https://sdk.local/v1beta/models/m:generateContent', {
      method: 'POST',
      body: JSON.stringify({ contents: [] }),
    })).rejects.toThrow();

    const joined = debugLines.join('\n');
    expect(joined).toContain('errorName=TypeError');
    expect(joined).not.toContain(BODY_CANARY);
    expect(joined).not.toContain(TOKEN);
  });

  it('does not advance to the next endpoint when abort lands between attempts', async () => {
    const abort = new AbortController();
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      // Endpoint 1 is retryable-failing, but the caller gives up before we
      // would have moved on to endpoint 2.
      abort.abort();
      return jsonResponse({ error: { message: 'down' } }, 503);
    });
    const { createCloudCodeFetch } = await import('../src/core/antigravity-model.js');
    const cloudFetch = createCloudCodeFetch({
      modelId: UPSTREAM_MODEL,
      accessToken: TOKEN,
      projectId: PROJECT_ID,
    }, fetchImpl as unknown as typeof globalThis.fetch);

    await expect(cloudFetch('https://sdk.local/v1beta/models/m:generateContent', {
      method: 'POST',
      body: JSON.stringify({ contents: [] }),
      signal: abort.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toEqual([unaryUrls[0]]);
  });

  it('does not switch endpoints after a streaming response has begun', async () => {
    const { response, fetchImpl } = await run(async () => (
      streamResponse([sseChunk(geminiTextPayload('streamed'))])
    ), { streaming: true });
    const text = await response.text();
    expect(text).toContain('streamed');
    // The body was only consumed after the endpoint was committed to.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  // A refresh must not cancel failover: if the retried endpoint is itself down,
  // the remaining endpoints are still the documented fallback.
  it('resumes endpoint failover when the post-refresh retry hits a dead endpoint', async () => {
    let refreshCalls = 0;
    const { response, urls } = await run(async (url, init) => {
      const auth = new Headers(init?.headers).get('Authorization') ?? '';
      if (url === unaryUrls[0]) {
        return auth === `Bearer ${TOKEN}`
          ? jsonResponse({ error: { message: 'expired' } }, 401)
          : jsonResponse({ error: { message: 'down' } }, 503);
      }
      return jsonResponse({ response: geminiTextPayload('second endpoint after refresh') });
    }, {
      refreshToken: async () => { refreshCalls += 1; return 'ya29.refreshed-failover-zzz'; },
    });
    expect(response.status).toBe(200);
    expect(refreshCalls).toBe(1);
    // endpoint1 (401) -> refresh -> endpoint1 retry (503) -> endpoint2 (200)
    expect(urls).toEqual([unaryUrls[0], unaryUrls[0], unaryUrls[1]]);
  });

  it('does not replay endpoints that already failed before the 401', async () => {
    const { response, urls } = await run(async (url, init) => {
      const auth = new Headers(init?.headers).get('Authorization') ?? '';
      if (url === unaryUrls[0]) return jsonResponse({ error: { message: 'down' } }, 503);
      if (url === unaryUrls[1]) {
        return auth === `Bearer ${TOKEN}`
          ? jsonResponse({ error: { message: 'expired' } }, 401)
          : jsonResponse({ error: { message: 'down' } }, 503);
      }
      return jsonResponse({ response: geminiTextPayload('third endpoint') });
    }, { refreshToken: async () => 'ya29.refreshed-failover-zzz' });
    expect(response.status).toBe(200);
    // endpoint1 is never retried after the refresh — it failed for its own reason.
    expect(urls).toEqual([unaryUrls[0], unaryUrls[1], unaryUrls[1], unaryUrls[2]]);
  });

  it('refreshes once and retries only the endpoint that issued the 401', async () => {
    let refreshCalls = 0;
    const { response, urls } = await run(async (url, init) => {
      const auth = new Headers(init?.headers).get('Authorization') ?? '';
      if (url === unaryUrls[0]) return jsonResponse({ error: { message: 'down' } }, 503);
      if (auth === `Bearer ${TOKEN}`) return jsonResponse({ error: { message: 'expired' } }, 401);
      return jsonResponse({ response: geminiTextPayload('after refresh') });
    }, {
      refreshToken: async () => { refreshCalls += 1; return 'ya29.refreshed-failover-zzz'; },
    });
    expect(response.status).toBe(200);
    expect(refreshCalls).toBe(1);
    // First endpoint 503 → second endpoint 401 → refresh → retry the *second*.
    expect(urls).toEqual([unaryUrls[0], unaryUrls[1], unaryUrls[1]]);
  });
});

describe('Cloud Code concurrent 401 refresh', () => {
  const OLD_TOKEN = 'ya29.old-token-canary-zzz';
  const NEW_TOKEN = 'ya29.new-token-canary-zzz';

  function unaryUrl(): string {
    return 'https://generativelanguage.example/v1beta/models/m:generateContent';
  }

  /**
   * Two requests share one model (one `createCloudCodeFetch` closure), both send
   * the same expired token, and both 401 before either refresh resolves. The
   * refresh path is deduplicated — one in-flight promise handed to both callers.
   */
  async function runConcurrentPair(overrides: { streaming?: boolean } = {}) {
    const authHeaders: string[] = [];
    let refreshCalls = 0;
    let refreshPromise: Promise<string | null> | undefined;

    let releaseFirstPair!: () => void;
    const firstPairIssued = new Promise<void>(resolve => { releaseFirstPair = resolve; });
    let oldTokenRequests = 0;

    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get('Authorization') ?? '';
      authHeaders.push(auth);
      if (auth === `Bearer ${OLD_TOKEN}`) {
        oldTokenRequests += 1;
        if (oldTokenRequests === 2) releaseFirstPair();
        // Hold both 401s open so neither refresh can resolve first.
        await firstPairIssued;
        return jsonResponse({ error: { message: 'expired' } }, 401);
      }
      return overrides.streaming
        ? streamResponse([sseChunk(geminiTextPayload('after refresh'))])
        : jsonResponse({ response: geminiTextPayload('after refresh') });
    });

    const { createCloudCodeFetch } = await import('../src/core/antigravity-model.js');
    const cloudFetch = createCloudCodeFetch({
      modelId: UPSTREAM_MODEL,
      accessToken: OLD_TOKEN,
      projectId: PROJECT_ID,
      refreshToken: () => {
        refreshCalls += 1;
        refreshPromise ??= new Promise<string | null>(resolve => setTimeout(() => resolve(NEW_TOKEN), 5));
        return refreshPromise;
      },
    }, fetchImpl as unknown as typeof globalThis.fetch);

    const url = overrides.streaming
      ? 'https://generativelanguage.example/v1beta/models/m:streamGenerateContent?alt=sse'
      : unaryUrl();
    const request = () => cloudFetch(url, {
      method: 'POST',
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] }),
    });

    const responses = await Promise.all([request(), request()]);
    return { responses, authHeaders, fetchImpl, refreshCalls };
  }

  it('lets both concurrent 401s retry with the refreshed token (unary)', async () => {
    const { responses, authHeaders, fetchImpl } = await runConcurrentPair();
    expect(responses.map(r => r.status)).toEqual([200, 200]);
    expect(authHeaders.filter(h => h === `Bearer ${OLD_TOKEN}`)).toHaveLength(2);
    expect(authHeaders.filter(h => h === `Bearer ${NEW_TOKEN}`)).toHaveLength(2);
    // Exactly one retry each — no infinite retry loop.
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('lets both concurrent 401s retry with the refreshed token (streaming)', async () => {
    const { responses, authHeaders, fetchImpl } = await runConcurrentPair({ streaming: true });
    expect(responses.map(r => r.status)).toEqual([200, 200]);
    expect(authHeaders.filter(h => h === `Bearer ${NEW_TOKEN}`)).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('does not retry a concurrent 401 after the request is aborted', async () => {
    const abort = new AbortController();
    const authHeaders: string[] = [];
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      authHeaders.push(new Headers(init?.headers).get('Authorization') ?? '');
      abort.abort();
      return jsonResponse({ error: { message: 'expired' } }, 401);
    });
    const { createCloudCodeFetch } = await import('../src/core/antigravity-model.js');
    const cloudFetch = createCloudCodeFetch({
      modelId: UPSTREAM_MODEL,
      accessToken: OLD_TOKEN,
      projectId: PROJECT_ID,
      refreshToken: async () => NEW_TOKEN,
    }, fetchImpl as unknown as typeof globalThis.fetch);

    const res = await cloudFetch(unaryUrl(), {
      method: 'POST',
      body: JSON.stringify({ contents: [] }),
      signal: abort.signal,
    });
    expect(res.status).toBe(401);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(authHeaders).toEqual([`Bearer ${OLD_TOKEN}`]);
  });

  it('keeps tokens out of diagnostics for the concurrent refresh path', async () => {
    const debugLines: string[] = [];
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get('Authorization') ?? '';
      return auth === `Bearer ${OLD_TOKEN}`
        ? jsonResponse({ error: { message: 'expired' } }, 401)
        : jsonResponse({ response: geminiTextPayload('ok') });
    });
    const { createCloudCodeFetch } = await import('../src/core/antigravity-model.js');
    const cloudFetch = createCloudCodeFetch({
      modelId: UPSTREAM_MODEL,
      accessToken: OLD_TOKEN,
      projectId: PROJECT_ID,
      refreshToken: async () => NEW_TOKEN,
      onDebug: msg => debugLines.push(msg),
    }, fetchImpl as unknown as typeof globalThis.fetch);

    await cloudFetch(unaryUrl(), { method: 'POST', body: JSON.stringify({ contents: [] }) });
    expect(debugLines.length).toBeGreaterThan(0);
    const joined = debugLines.join('\n');
    expect(joined).not.toContain(OLD_TOKEN);
    expect(joined).not.toContain(NEW_TOKEN);
    expect(joined).not.toContain('Bearer');
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
