import { describe, it, expect, afterEach, vi } from 'vitest';
import { generateText, streamText } from 'ai';
import { createLanguageModel } from '../src/provider-factory.js';
import { startCloudCodeGateway, type CloudCodeGatewayHandle } from '../src/antigravity/cloud-code-gateway.js';
import type { AntigravityRoute } from '../src/antigravity/types.js';

vi.mock('ai', () => {
  return {
    streamText: vi.fn().mockImplementation(() => ({
      fullStream: (async function* () {
        yield { type: 'text-delta', textDelta: 'Mocked ' };
        yield { type: 'text-delta', textDelta: 'response' };
        yield { type: 'finish', finishReason: 'stop', totalUsage: { inputTokens: 10, outputTokens: 20 } };
      })(),
    })),
    generateText: vi.fn().mockResolvedValue({
      text: 'Mocked unary response',
      toolCalls: [],
      finishReason: 'stop',
      usage: { inputTokens: 5, outputTokens: 10 },
    }),
  };
});

vi.mock('../src/provider-factory.js', () => {
  return {
    createLanguageModel: vi.fn().mockResolvedValue({}),
    effortProviderOptions: vi.fn().mockReturnValue(undefined),
  };
});

const testRoutes: AntigravityRoute[] = [
  {
    catalogId: 'relay-ai__zen__deepseek-v4-flash-free',
    providerId: 'zen',
    providerName: 'OpenCode Zen',
    modelId: 'deepseek-v4-flash-free',
    upstreamModelId: 'deepseek-v4-flash-free',
    displayName: 'DeepSeek V4 Flash (Relay)',
    npm: '@ai-sdk/openai-compatible',
    apiKey: 'test-key',
    baseURL: 'https://api.example.com',
    contextWindow: 128000,
  },
  {
    catalogId: 'relay-ai__groq__llama-3.3-70b',
    providerId: 'groq',
    providerName: 'Groq',
    modelId: 'llama-3.3-70b',
    upstreamModelId: 'llama-3.3-70b',
    displayName: 'Llama 3.3 70B (Relay)',
    npm: '@ai-sdk/openai-compatible',
    apiKey: 'groq-key',
    authType: 'api',
    baseURL: 'https://api.groq.com',
    contextWindow: 32768,
  },
];

async function fetchGateway(handle: CloudCodeGatewayHandle, path: string, opts: RequestInit = {}): Promise<Response> {
  return fetch(`http://127.0.0.1:${handle.port}${path}`, opts);
}

async function postJson(handle: CloudCodeGatewayHandle, path: string, body: unknown): Promise<Response> {
  return fetchGateway(handle, path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('cloud-code-gateway', () => {
  let handles: CloudCodeGatewayHandle[] = [];

  afterEach(async () => {
    await Promise.all(handles.map(h => h.close()));
    handles = [];
  });

  async function start(
    routes: AntigravityRoute[] = testRoutes,
    opts: { trackActiveRoute?: boolean } = {},
  ): Promise<CloudCodeGatewayHandle> {
    const handle = await startCloudCodeGateway(routes, {
      templateKey: 'gemini-3.5-flash-low',
      ...opts,
    });
    handles.push(handle);
    return handle;
  }

  it('binds to 127.0.0.1 on a random port', async () => {
    const handle = await start();
    expect(handle.port).toBeGreaterThan(0);
    expect(handle.url).toBe(`http://127.0.0.1:${handle.port}`);
  });

  // --- loadCodeAssist ---

  it('serves loadCodeAssist from the local fixture (REST path)', async () => {
    const handle = await start();
    const res = await postJson(handle, '/v1internal:loadCodeAssist', { metadata: {} });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.cloudaicompanionProject).toBeDefined();
    expect(data.currentTier).toBeDefined();
    expect(data.currentTier.privacyNotice.showNotice).toBe(false);
    expect(data).not.toHaveProperty('cascadeModelConfigData');
  });

  it('serves loadCodeAssist from Connect-style path (capital L)', async () => {
    const handle = await start();
    const res = await postJson(handle, '/google.internal.cloud.code.v1internal.CloudCode/LoadCodeAssist', {});
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.cloudaicompanionProject).toBeDefined();
  });

  // --- fetchAvailableModels ---

  it('serves fetchAvailableModels with injected relay models', async () => {
    const handle = await start();
    const res = await postJson(handle, '/v1internal:fetchAvailableModels', {});
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.models['relay-ai__zen__deepseek-v4-flash-free']).toBeDefined();
    expect(data.models['relay-ai__groq__llama-3.3-70b']).toBeDefined();
    expect(data.models['relay-ai__zen__deepseek-v4-flash-free'].displayName).toBe('DeepSeek V4 Flash (Relay)');
    expect(data.defaultAgentModelId).toBe('gemini-3.5-flash-low');
    expect(data.models[data.defaultAgentModelId].displayName).toBe('DeepSeek V4 Flash (Relay)');
    expect(data.models['gemini-3.5-flash-extra-low'].displayName).toBe('Llama 3.3 70B (Relay)');
    expect(data.agentModelSorts[0].groups[0].modelIds).toEqual([
      'gemini-3.5-flash-low',
      'gemini-3.5-flash-extra-low',
    ]);
  });

  it('serves FetchAvailableModels from Connect-style path', async () => {
    const handle = await start();
    const res = await postJson(handle, '/google.internal.cloud.code.v1internal.PredictionService/FetchAvailableModels', {});
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.models['relay-ai__zen__deepseek-v4-flash-free']).toBeDefined();
  });

  it('serves GetAvailableModels from LanguageServerService path', async () => {
    const handle = await start();
    const res = await postJson(handle, '/exa.language_server_pb.LanguageServerService/GetAvailableModels', {});
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.models['relay-ai__zen__deepseek-v4-flash-free']).toBeDefined();
  });

  // --- listModelConfigs ---

  it('returns 200 for listModelConfigs with native picker slot ids', async () => {
    const handle = await start();
    const res = await postJson(handle, '/v1internal:listModelConfigs', { domain: 'DOMAIN_AGENT' });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.defaultAgentModelConfig.requestedModelId).toBe('gemini-3.5-flash-low');
    expect(data.defaultAgentModelConfig.planModel).toBe('MODEL_PLACEHOLDER_M132');
    expect(data.allowedModelConfigs[0].requestedModelId).toBe('gemini-3.5-flash-low');
    expect(data.allowedModelConfigs[1].requestedModelId).toBe('gemini-3.5-flash-extra-low');
    expect(data.clientModelConfigs.map((config: any) => config.label)).toEqual([
      'DeepSeek V4 Flash (Relay)',
      'Llama 3.3 70B (Relay)',
    ]);
    expect(data.clientModelConfigs[1].modelOrAlias.alias).toBe('gemini-3.5-flash-extra-low');
    expect(data.clientModelSorts[0].groups[0].modelLabels).toEqual([
      'DeepSeek V4 Flash (Relay)',
      'Llama 3.3 70B (Relay)',
    ]);
  });

  it('matches GetCascadeModelConfigs path', async () => {
    const handle = await start();
    const res = await postJson(handle, '/exa.language_server_pb.LanguageServerService/GetCascadeModelConfigs', {});
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.defaultAgentModelConfig).toBeDefined();
  });

  // --- listExperiments ---

  it('returns listExperiments with numeric experimentIds', async () => {
    const handle = await start();
    const res = await postJson(handle, '/v1internal:listExperiments', {});
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).not.toHaveProperty('experiments');
    expect(data.experimentIds.length).toBeGreaterThan(50);
    expect(data.experimentIds.every((id: unknown) => Number.isInteger(id))).toBe(true);
    expect(data.experimentIds).toContain(105979552);
    expect(data.experimentIds).toContain(106121604);
  });

  // --- Other endpoints ---

  it('returns 200 for fetchAdminControls (empty)', async () => {
    const handle = await start();
    const res = await postJson(handle, '/v1internal:fetchAdminControls', {});
    expect(res.status).toBe(200);
  });

  it('returns 200 for retrieveUserQuotaSummary (unlimited)', async () => {
    const handle = await start();
    const res = await postJson(handle, '/v1internal:retrieveUserQuotaSummary', {});
    expect(res.status).toBe(200);
  });

  it('returns 200 for fetchUserInfo (minimal)', async () => {
    const handle = await start();
    const res = await postJson(handle, '/v1internal:fetchUserInfo', {});
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.userSettings).toEqual({
      telemetryEnabled: false,
      userDataCollectionForceDisabled: true,
      marketingEmailsEnabled: false,
    });
    expect(data.regionCode).toBe('US');
  });

  it('returns 200 for setUserSettings (accepted)', async () => {
    const handle = await start();
    const res = await postJson(handle, '/v1internal:setUserSettings', { userSettings: {} });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.userSettings).toEqual({
      telemetryEnabled: false,
      userDataCollectionForceDisabled: true,
      marketingEmailsEnabled: false,
    });
  });

  it('returns 200 for onboardUser (success)', async () => {
    const handle = await start();
    const res = await postJson(handle, '/v1internal:onboardUser', { tierId: 'free-tier' });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe('operations/cmpf.DONE_OPERATION');
    expect(data.done).toBe(true);
    expect(data.response['@type']).toBe('type.googleapis.com/google.internal.cloud.code.v1internal.OnboardUserResponse');
    expect(data.response.cloudaicompanionProject.id).toBe('relay-ai-local-project');
    expect(data.response.status.statusCode).toBe('NOTICE');
  });

  it('returns 200 for recordCodeAssistMetrics (discarded)', async () => {
    const handle = await start();
    const res = await postJson(handle, '/v1internal:recordCodeAssistMetrics', {});
    expect(res.status).toBe(200);
  });

  it('returns cascadeNuxes in the shape Antigravity expects', async () => {
    const handle = await start();
    const res = await fetchGateway(handle, '/v1internal/cascadeNuxes');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ cascadeNuxes: [] });
  });

  it('returns 200 for unknown endpoints (permissive)', async () => {
    const handle = await start();
    const res = await postJson(handle, '/v1internal:somethingNew', {});
    expect(res.status).toBe(200);
  });

  // --- Streaming GenerateContent ---

  it('rejects generation for non-relay models with 403', async () => {
    vi.mocked(createLanguageModel).mockClear();
    const handle = await start();
    const res = await postJson(handle, '/v1internal:streamGenerateContent?alt=sse', {
      model: 'unrecognized-google-model',
      request: { contents: [{ role: 'user', parts: [{ text: 'hello' }] }] },
    });
    expect(res.status).toBe(403);
    expect(createLanguageModel).not.toHaveBeenCalled();
  });

  it('routes the hidden Flash Lite planner model through the launch route', async () => {
    const handle = await start();
    const res = await postJson(handle, '/v1internal:streamGenerateContent?alt=sse', {
      model: 'gemini-2.5-flash-lite',
      request: { contents: [{ role: 'user', parts: [{ text: 'plan this task' }] }] },
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('Mocked ');
    expect(text).toContain('response');
  });

  it('routes the hidden Flash intent model through the launch route', async () => {
    const handle = await start();
    const res = await postJson(handle, '/v1internal:generateContent', {
      model: 'gemini-2.5-flash',
      request: { contents: [{ role: 'user', parts: [{ text: 'classify this request' }] }] },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Mocked unary response');
  });

  it('routes the hidden Flash agent model through the launch route', async () => {
    const handle = await start();
    const res = await postJson(handle, '/v1internal:streamGenerateContent?alt=sse', {
      model: 'gemini-3-flash-agent',
      request: { contents: [{ role: 'user', parts: [{ text: 'plan this task' }] }] },
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('Mocked ');
    expect(text).toContain('response');
  });

  it('routes the checkpoint helper model through the launch route', async () => {
    const handle = await start();
    const res = await postJson(handle, '/v1internal:streamGenerateContent?alt=sse', {
      model: 'gemini-3.1-flash-lite',
      request: { contents: [{ role: 'user', parts: [{ text: 'checkpoint this task' }] }] },
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('Mocked ');
    expect(text).toContain('response');
  });

  it('rejects command-only native models instead of silently using launch route', async () => {
    vi.mocked(createLanguageModel).mockClear();
    const handle = await start();
    const res = await postJson(handle, '/v1internal:streamGenerateContent?alt=sse', {
      model: 'gemini-3-flash',
      request: { contents: [{ role: 'user', parts: [{ text: 'slash command' }] }] },
    });
    expect(res.status).toBe(403);
    expect(createLanguageModel).not.toHaveBeenCalled();
  });

  it('routes the hidden Flash low anchor through the launch route', async () => {
    const handle = await start();
    const res = await postJson(handle, '/v1internal:streamGenerateContent?alt=sse', {
      model: 'gemini-3.5-flash-low',
      request: { contents: [{ role: 'user', parts: [{ text: 'continue this task' }] }] },
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('Mocked ');
    expect(text).toContain('response');
  });

  it('handles relay model streaming requests via fullStream', async () => {
    const handle = await start();
    const res = await postJson(handle, '/v1internal:streamGenerateContent?alt=sse', {
      model: 'relay-ai__zen__deepseek-v4-flash-free',
      request: { contents: [{ role: 'user', parts: [{ text: 'say ORBIT' }] }] },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    const text = await res.text();
    expect(text).toContain('data: ');
    expect(text).toContain('finishReason');
    expect(text).toContain('Mocked');
    expect(text).toContain('response');
  });

  it('routes switched model requests through the selected catalog route', async () => {
    vi.mocked(createLanguageModel).mockClear();
    const handle = await start();
    const res = await postJson(handle, '/v1internal:streamGenerateContent?alt=sse', {
      model: 'gemini-3.5-flash-extra-low',
      request: { contents: [{ role: 'user', parts: [{ text: 'say SWITCHED' }] }] },
    });

    expect(res.status).toBe(200);
    await res.text();
    expect(createLanguageModel).toHaveBeenCalledWith({
      npm: '@ai-sdk/openai-compatible',
      modelId: 'llama-3.3-70b',
      apiKey: 'groq-key',
      baseURL: 'https://api.groq.com',
      providerId: 'groq',
      authType: 'api',
      oauthAccountId: undefined,
    });
  });

  it('keeps relay catalog ids routable for compatibility', async () => {
    vi.mocked(createLanguageModel).mockClear();
    const handle = await start();
    const res = await postJson(handle, '/v1internal:streamGenerateContent?alt=sse', {
      model: 'relay-ai__groq__llama-3.3-70b',
      request: { contents: [{ role: 'user', parts: [{ text: 'say DIRECT' }] }] },
    });

    expect(res.status).toBe(200);
    await res.text();
    expect(createLanguageModel).toHaveBeenCalledWith({
      npm: '@ai-sdk/openai-compatible',
      modelId: 'llama-3.3-70b',
      apiKey: 'groq-key',
      baseURL: 'https://api.groq.com',
      providerId: 'groq',
      authType: 'api',
      oauthAccountId: undefined,
    });
  });

  it('passes provider auth identity into createLanguageModel', async () => {
    vi.mocked(createLanguageModel).mockClear();
    const handle = await start([
      {
        ...testRoutes[0]!,
        providerId: 'xai-oauth',
        providerName: 'xAI SuperGrok',
        upstreamModelId: 'grok-4.3',
        npm: '@ai-sdk/xai',
        apiKey: 'oauth-token',
        authType: 'oauth',
        oauthAccountId: 'acct-123',
      },
    ]);
    const res = await postJson(handle, '/v1internal:streamGenerateContent?alt=sse', {
      model: 'gemini-3.5-flash-low',
      request: { contents: [{ role: 'user', parts: [{ text: 'say AUTH' }] }] },
    });

    expect(res.status).toBe(200);
    await res.text();
    expect(createLanguageModel).toHaveBeenCalledWith({
      npm: '@ai-sdk/xai',
      modelId: 'grok-4.3',
      apiKey: 'oauth-token',
      baseURL: 'https://api.example.com',
      providerId: 'xai-oauth',
      authType: 'oauth',
      oauthAccountId: 'acct-123',
    });
  });

  it('keeps intent helper requests on launch route when active-route tracking is disabled', async () => {
    vi.mocked(createLanguageModel).mockClear();
    const handle = await start();
    await postJson(handle, '/v1internal:streamGenerateContent?alt=sse', {
      model: 'gemini-3.5-flash-extra-low',
      requestId: 'agent/turn-1',
      request: { contents: [{ role: 'user', parts: [{ text: 'switch to route two' }] }] },
    }).then(res => res.text());

    const helperRes = await postJson(handle, '/v1internal:generateContent', {
      model: 'gemini-2.5-flash',
      requestId: 'title/turn-1',
      request: { contents: [{ role: 'user', parts: [{ text: 'title' }] }] },
    });

    expect(helperRes.status).toBe(200);
    await helperRes.text();
    const lastCall = vi.mocked(createLanguageModel).mock.calls.at(-1)![0] as any;
    expect(lastCall.modelId).toBe('deepseek-v4-flash-free');
  });

  it('routes intent helpers to the active route only after tracked user-turn slot requests', async () => {
    vi.mocked(createLanguageModel).mockClear();
    const handle = await start(testRoutes, { trackActiveRoute: true });

    const beforeActive = await postJson(handle, '/v1internal:generateContent', {
      model: 'gemini-2.5-flash',
      requestId: 'title/before',
      request: { contents: [{ role: 'user', parts: [{ text: 'title' }] }] },
    });
    expect(beforeActive.status).toBe(200);
    await beforeActive.text();
    expect((vi.mocked(createLanguageModel).mock.calls.at(-1)![0] as any).modelId)
      .toBe('deepseek-v4-flash-free');

    await postJson(handle, '/v1internal:streamGenerateContent?alt=sse', {
      model: 'gemini-3.5-flash-extra-low',
      requestId: 'agent/turn-2',
      request: { contents: [{ role: 'user', parts: [{ text: 'route two user turn' }] }] },
    }).then(res => res.text());

    const afterActive = await postJson(handle, '/v1internal:generateContent', {
      model: 'gemini-2.5-flash',
      requestId: 'title/after',
      request: { contents: [{ role: 'user', parts: [{ text: 'title' }] }] },
    });
    expect(afterActive.status).toBe(200);
    await afterActive.text();
    expect((vi.mocked(createLanguageModel).mock.calls.at(-1)![0] as any).modelId)
      .toBe('llama-3.3-70b');
  });

  it('forwards current AI SDK text-delta fields', async () => {
    vi.mocked(streamText).mockImplementationOnce(() => ({
      fullStream: (async function* () {
        yield { type: 'text-start', id: 'text-1' };
        yield { type: 'text-delta', id: 'text-1', text: 'actual output' };
        yield { type: 'finish', finishReason: 'stop', totalUsage: {} };
      })(),
    }) as any);
    const handle = await start();

    const res = await postJson(handle, '/v1internal:streamGenerateContent?alt=sse', {
      model: 'relay-ai__zen__deepseek-v4-flash-free',
      request: { contents: [{ role: 'user', parts: [{ text: 'test' }] }] },
    });

    expect(await res.text()).toContain('actual output');
  });

  it('separates streaming reasoning from visible response text', async () => {
    vi.mocked(streamText).mockImplementationOnce(() => ({
      fullStream: (async function* () {
        yield { type: 'reasoning-start', id: 'reasoning-1' };
        yield { type: 'reasoning-delta', id: 'reasoning-1', text: 'hidden plan' };
        yield { type: 'reasoning-end', id: 'reasoning-1' };
        yield { type: 'text-delta', id: 'text-1', text: 'visible answer' };
        yield { type: 'finish', finishReason: 'stop', totalUsage: {} };
      })(),
    }) as any);
    const handle = await start();

    const res = await postJson(handle, '/v1internal:streamGenerateContent?alt=sse', {
      model: 'relay-ai__zen__deepseek-v4-flash-free',
      request: { contents: [{ role: 'user', parts: [{ text: 'test' }] }] },
    });
    const text = await res.text();

    expect(text).not.toContain('<thinking>');
    expect(text).not.toContain('</thinking>');
    expect(text).toContain('"thought":true');
    expect(text).toContain('hidden plan');
    expect(text).toContain('visible answer');
  });

  it('buffers current AI SDK incremental tool input by id', async () => {
    vi.mocked(streamText).mockImplementationOnce(() => ({
      fullStream: (async function* () {
        yield { type: 'tool-input-start', id: 'call-1', toolName: 'readFile' };
        yield { type: 'tool-input-delta', id: 'call-1', delta: '{"path":"a.ts"}' };
        yield { type: 'tool-call', toolCallId: 'call-1', toolName: 'readFile', input: {} };
        yield { type: 'finish', finishReason: 'tool-calls', totalUsage: {} };
      })(),
    }) as any);
    const handle = await start();

    const res = await postJson(handle, '/v1internal:streamGenerateContent?alt=sse', {
      model: 'relay-ai__zen__deepseek-v4-flash-free',
      request: { contents: [{ role: 'user', parts: [{ text: 'test' }] }] },
    });
    const text = await res.text();

    expect(text).toContain('"name":"readFile"');
    expect(text).toContain('"path":"a.ts"');
  });

  it('returns provider stream errors instead of an empty successful response', async () => {
    vi.mocked(streamText).mockImplementationOnce(() => ({
      fullStream: (async function* () {
        yield { type: 'error', error: new Error('provider rejected request') };
      })(),
    }) as any);
    const logs: string[] = [];
    const handle = await startCloudCodeGateway(testRoutes, {
      templateKey: 'gemini-3.5-flash-low',
      trace: true,
      logFn: line => logs.push(line),
    });
    handles.push(handle);

    const res = await postJson(handle, '/v1internal:streamGenerateContent?alt=sse', {
      model: 'relay-ai__zen__deepseek-v4-flash-free',
      request: { contents: [{ role: 'user', parts: [{ text: 'test' }] }] },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(await res.text()).toContain('provider rejected request');
    expect(logs.some(line => line.includes('provider rejected request'))).toBe(true);
  });

  it('sanitizes provider stream errors before sending them to the IDE', async () => {
    vi.mocked(streamText).mockImplementationOnce(() => ({
      fullStream: (async function* () {
        yield {
          type: 'error',
          error: {
            message: 'APICallError [AI_APICallError]: Error from provider\n    at file:///secret/node_modules/ai/dist/index.mjs:1:1',
            statusCode: 400,
            data: { error: { message: 'DeepSeek requires reasoning_content' } },
          },
        };
      })(),
    }) as any);
    const handle = await start();

    const res = await postJson(handle, '/v1internal:streamGenerateContent?alt=sse', {
      model: 'relay-ai__zen__deepseek-v4-flash-free',
      request: { contents: [{ role: 'user', parts: [{ text: 'test' }] }] },
    });
    const text = await res.text();

    expect(text).toContain('DeepSeek requires reasoning_content (HTTP 400)');
    expect(text).not.toContain('APICallError');
    expect(text).not.toContain('file://');
    expect(text).not.toContain('node_modules');
  });

  it('echoes DeepSeek reasoning back when Antigravity replays a tool-call turn without thought parts', async () => {
    let secondRequestArgs: any;
    vi.mocked(streamText)
      .mockImplementationOnce(() => ({
        fullStream: (async function* () {
          yield { type: 'reasoning-start', id: 'reasoning-1' };
          yield { type: 'reasoning-delta', id: 'reasoning-1', text: 'hidden DeepSeek plan' };
          yield { type: 'reasoning-end', id: 'reasoning-1' };
          yield { type: 'tool-call', toolCallId: 'call-1', toolName: 'Read', input: { path: 'package.json' } };
          yield { type: 'finish', finishReason: 'tool-calls', totalUsage: {} };
        })(),
      }) as any)
      .mockImplementationOnce((args: any) => {
        secondRequestArgs = args;
        return {
          fullStream: (async function* () {
            yield { type: 'text-delta', id: 'text-1', text: 'done' };
            yield { type: 'finish', finishReason: 'stop', totalUsage: {} };
          })(),
        } as any;
      });
    const handle = await start();

    await postJson(handle, '/v1internal:streamGenerateContent?alt=sse', {
      model: 'relay-ai__zen__deepseek-v4-flash-free',
      requestId: 'agent/session-1/turn-1',
      request: { contents: [{ role: 'user', parts: [{ text: 'read package' }] }] },
    }).then(res => res.text());

    await postJson(handle, '/v1internal:streamGenerateContent?alt=sse', {
      model: 'relay-ai__zen__deepseek-v4-flash-free',
      requestId: 'agent/session-1/turn-2',
      request: {
        contents: [
          { role: 'model', parts: [{ functionCall: { name: 'Read', args: { path: 'package.json' } } }] },
          { role: 'user', parts: [{ functionResponse: { name: 'Read', response: { content: '{}' } } }] },
          { role: 'user', parts: [{ text: 'continue' }] },
        ],
      },
    }).then(res => res.text());

    const assistantWithToolCall = secondRequestArgs.messages.find((msg: any) => {
      return msg.role === 'assistant' && Array.isArray(msg.content)
        && msg.content.some((part: any) => part.type === 'tool-call');
    });
    expect(assistantWithToolCall.content[0]).toEqual({
      type: 'reasoning',
      text: 'hidden DeepSeek plan',
    });
  });

  it('handles Connect-style StreamGenerateContent path', async () => {
    const handle = await start();
    const res = await postJson(handle, '/google.internal.cloud.code.v1internal.PredictionService/StreamGenerateContent', {
      model: 'relay-ai__zen__deepseek-v4-flash-free',
      request: { contents: [{ role: 'user', parts: [{ text: 'test' }] }] },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
  });

  // --- Unary GenerateContent ---

  it('handles unary (non-streaming) GenerateContent', async () => {
    const handle = await start();
    const res = await postJson(handle, '/v1internal:generateContent', {
      model: 'relay-ai__zen__deepseek-v4-flash-free',
      request: { contents: [{ role: 'user', parts: [{ text: 'hello' }] }] },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    const data = await res.json();
    expect(data.response.candidates[0].content.parts[0].text).toBe('Mocked unary response');
    expect(data.response.candidates[0].finishReason).toBe('STOP');
  });

  it('separates unary reasoning from visible response text', async () => {
    vi.mocked(generateText).mockResolvedValueOnce({
      reasoning: 'hidden plan',
      text: 'visible answer',
      toolCalls: [],
      finishReason: 'stop',
      usage: { inputTokens: 5, outputTokens: 10 },
    } as any);
    const handle = await start();

    const res = await postJson(handle, '/v1internal:generateContent', {
      model: 'relay-ai__zen__deepseek-v4-flash-free',
      request: { contents: [{ role: 'user', parts: [{ text: 'hello' }] }] },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    const parts = data.response.candidates[0].content.parts;
    expect(JSON.stringify(parts)).not.toContain('<thinking>');
    expect(parts).toEqual([
      { text: 'hidden plan', thought: true },
      { text: 'visible answer' },
    ]);
  });

  it('preserves alt=sse query parameter', async () => {
    const handle = await start();
    const res = await postJson(handle, '/v1internal:streamGenerateContent?alt=sse', {
      model: 'relay-ai__zen__deepseek-v4-flash-free',
      request: { contents: [] },
    });
    expect(res.status).toBe(200);
  });

  // --- Connect protocol headers ---

  it('includes grpc-status header on success', async () => {
    const handle = await start();
    const res = await postJson(handle, '/v1internal:loadCodeAssist', {});
    expect(res.headers.get('grpc-status')).toBe('0');
  });

  it('includes grpc-status header on error', async () => {
    const handle = await start();
    const res = await postJson(handle, '/v1internal:streamGenerateContent', {
      model: 'nonexistent-model',
      request: { contents: [] },
    });
    expect(res.status).toBe(403);
    expect(res.headers.get('grpc-status')).toBe('13');
  });

  // --- Protobuf rejection ---

  it('rejects protobuf content-type with 415', async () => {
    const handle = await start();
    const res = await fetchGateway(handle, '/v1internal:loadCodeAssist', {
      method: 'POST',
      headers: { 'content-type': 'application/connect+proto' },
      body: Buffer.from([0, 0, 0, 0, 10]),
    });
    expect(res.status).toBe(415);
  });

  // --- Health & Close ---

  it('serves GET health check', async () => {
    const handle = await start();
    const res = await fetchGateway(handle, '/');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
  });

  it('closes cleanly', async () => {
    const handle = await start();
    await handle.close();
    await expect(
      fetchGateway(handle, '/').catch(() => { throw new Error('connection refused'); })
    ).rejects.toThrow();
  });
});
