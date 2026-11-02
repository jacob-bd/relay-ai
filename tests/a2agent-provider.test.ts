import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateText, streamText } from 'ai';
import { addProviderFromTemplate } from '../src/registry/add-template.js';
import { refreshProviderModels } from '../src/registry/refresh-models.js';
import { loadRegistry } from '../src/registry/io.js';
import { loadRegistryProviders } from '../src/registry/load.js';
import { getTemplateById, listAddableTemplates } from '../src/provider-templates.js';
import { createLanguageModel } from '../src/provider-factory.js';
import { clearRememberedProtocols, resolveProtocolAlternative } from '../src/gateway-protocol.js';
import { invalidateKeyringReadCache } from '../src/env.js';
import { createMockRequest, createMockResponse } from './helpers/ui-api-test-utils.js';

const state = vi.hoisted(() => ({ store: new Map<string, string>() }));
vi.mock('@napi-rs/keyring', () => ({
  Entry: class {
    constructor(private service: string, private account: string) {}
    getPassword() { return state.store.get(this.account) ?? null; }
    setPassword(value: string) { state.store.set(this.account, value); }
    deletePassword() { state.store.delete(this.account); }
  },
}));
vi.mock('../src/registry/pricing.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/registry/pricing.js')>()),
  enrichPricingAsync: vi.fn(),
}));

const baseURL = 'https://api.a2agent.me/v1';
const catalog = { object: 'list', data: [{ id: 'deepseek-v4-pro' }, { id: 'MiniMax-M3' }] };

async function uiCall(method: string, url: string, body?: unknown) {
  const { handleUiApiRequest } = await import('../src/ui/api.js');
  const response = createMockResponse();
  handleUiApiRequest(createMockRequest(method, url, body === undefined ? undefined : JSON.stringify(body)), response.res);
  await vi.waitFor(() => expect(response.result.data).not.toBe(''));
  return JSON.parse(response.result.data);
}

describe('A2Agent provider', () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'relay-ai-a2agent-'));
    vi.stubEnv('RELAY_AI_HOME', home);
    state.store.clear();
    invalidateKeyringReadCache();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(catalog)));
  });
  afterEach(() => {
    clearRememberedProtocols();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  });

  it('adds through the CLI registry flow, reloads exact model IDs and refreshes another account', async () => {
    const template = getTemplateById('a2agent')!;
    expect(listAddableTemplates(new Set()).map(t => t.id)).toContain('a2agent');
    expect(await addProviderFromTemplate(template, 'test-key')).toMatchObject({ added: true, modelCount: 2 });
    expect(await addProviderFromTemplate(template, 'second-key', { addAccount: true })).toMatchObject({
      added: true, provider: { id: 'a2agent-2', templateId: 'a2agent' },
    });
    const [provider] = await loadRegistryProviders();
    expect(provider.apiKey).toBe('test-key');
    expect(provider.models.map(m => [m.id, m.modelFormat, m.baseUrl, m.completionsUrl])).toEqual([
      ['deepseek-v4-pro', 'anthropic', 'https://api.a2agent.me', undefined],
      ['MiniMax-M3', 'anthropic', 'https://api.a2agent.me', undefined],
    ]);
    const [codexProvider] = await loadRegistryProviders(undefined, { agent: 'codex' });
    expect(codexProvider!.models.map(m => [m.id, m.modelFormat, m.completionsUrl])).toEqual([
      ['deepseek-v4-pro', 'openai', `${baseURL}/chat/completions`],
      ['MiniMax-M3', 'openai', `${baseURL}/chat/completions`],
    ]);
    // A2Agent's Anthropic SSE omits the `text` field on text blocks, so the
    // SDK-driven Antigravity launch stays on Chat Completions. Claude Code
    // keeps the Anthropic passthrough covered by the default agent above.
    const [antigravityProvider] = await loadRegistryProviders(undefined, { agent: 'antigravity' });
    expect(antigravityProvider!.models.map(m => [m.id, m.modelFormat, m.completionsUrl])).toEqual([
      ['deepseek-v4-pro', 'openai', `${baseURL}/chat/completions`],
      ['MiniMax-M3', 'openai', `${baseURL}/chat/completions`],
    ]);
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ data: [{ id: 'kimi-k3' }] }));
    expect(await refreshProviderModels('a2agent-2', 'second-key')).toMatchObject({ ok: true, modelCount: 1 });
    expect(loadRegistry().providers[1].modelsCache?.models.map(m => m.id)).toEqual(['kimi-k3']);
    expect(fetch).toHaveBeenLastCalledWith(`${baseURL}/models`, expect.objectContaining({
      method: 'GET', headers: expect.objectContaining({ Authorization: 'Bearer second-key' }),
    }));
  });

  it('appears in the UI and adds through its real API', async () => {
    expect((await uiCall('GET', '/api/providers/templates')).templates).toContainEqual(expect.objectContaining({
      id: 'a2agent', name: 'A2Agent', defaultBaseUrl: baseURL,
    }));
    expect(await uiCall('POST', '/api/providers/add', { templateId: 'a2agent', key: 'ui-test-key' }))
      .toMatchObject({ ok: true, name: 'A2Agent', count: 2 });
    expect(loadRegistry().providers[0]).toMatchObject({ id: 'a2agent', api: { url: baseURL } });
  });

  it('does not save a rejected key or erase the catalog after a failed refresh', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 401 }));
    expect(await addProviderFromTemplate(getTemplateById('a2agent')!, 'bad-key')).toMatchObject({ added: false });
    expect(loadRegistry().providers).toEqual([]);
    expect(state.store.size).toBe(0);
    await addProviderFromTemplate(getTemplateById('a2agent')!, 'test-key');
    vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 503 }));
    expect(await refreshProviderModels('a2agent', 'test-key')).toMatchObject({ ok: false });
    expect(loadRegistry().providers[0].modelsCache?.models).toHaveLength(2);
  });

  it('requests streaming usage and preserves A2Agent cached tokens', async () => {
    const sse = [
      'data: {"id":"chatcmpl_a2agent","object":"chat.completion.chunk","created":1,"model":"deepseek-v4-flash","choices":[{"index":0,"delta":{"role":"assistant","content":"ok"},"finish_reason":null}]}',
      '',
      'data: {"id":"chatcmpl_a2agent","object":"chat.completion.chunk","created":1,"model":"deepseek-v4-flash","choices":[],"usage":{"prompt_tokens":101,"completion_tokens":2,"total_tokens":103,"prompt_tokens_details":{"cached_tokens":90}}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');
    vi.mocked(fetch).mockResolvedValueOnce(new Response(sse, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }));
    const model = await createLanguageModel({
      npm: '@ai-sdk/openai-compatible', modelId: 'deepseek-v4-flash', apiKey: 'test-key', providerId: 'a2agent', baseURL,
    });
    const result = streamText({ model, messages: [{ role: 'user', content: 'hello' }], maxRetries: 0 });
    for await (const _part of result.fullStream) { /* consume */ }
    const usage = await result.usage;
    expect(usage.inputTokens).toBe(101);
    expect(usage.inputTokenDetails.cacheReadTokens).toBe(90);
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body));
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  it('uses Chat Completions without a fallback when the primary protocol succeeds', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({
      id: 'chatcmpl_a2agent', object: 'chat.completion', created: 1700000000, model: 'MiniMax-M3',
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));
    const model = await createLanguageModel({
      npm: '@ai-sdk/openai-compatible', modelId: 'MiniMax-M3', apiKey: 'test-key', providerId: 'a2agent', baseURL,
    });
    expect((await generateText({ model, messages: [{ role: 'user', content: 'hello' }], maxRetries: 0 })).text).toBe('ok');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(`${baseURL}/chat/completions`, expect.objectContaining({
      body: expect.stringContaining('"model":"MiniMax-M3"'),
    }));
  });

  it.each(['a2agent', 'a2agent-2'])('routes %s through both protocols with Bearer authentication', async providerId => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      calls.push({ url, headers: new Headers(init?.headers) });
      if (url.endsWith('/chat/completions')) {
        return Response.json({ error: { message: 'Use the /messages endpoint for this request' } }, { status: 400 });
      }
      return Response.json({
        id: 'msg_a2agent', type: 'message', role: 'assistant', model: 'deepseek-v4-pro',
        content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    });
    const model = await createLanguageModel({
      npm: '@ai-sdk/openai-compatible', modelId: 'deepseek-v4-pro', apiKey: 'test-key', providerId, baseURL,
    });
    expect((await generateText({ model, messages: [{ role: 'user', content: 'hello' }], maxRetries: 0 })).text).toBe('ok');
    expect(calls.map(c => c.url)).toEqual([`${baseURL}/chat/completions`, `${baseURL}/messages`]);
    expect(calls.every(c => c.headers.get('authorization') === 'Bearer test-key')).toBe(true);
    expect(calls[1].headers.has('x-api-key')).toBe(false);
    expect(resolveProtocolAlternative({ providerId, modelFormat: 'anthropic', baseURL: 'https://api.a2agent.me' }))
      .toMatchObject({ npm: '@ai-sdk/openai-compatible', upstreamUrl: `${baseURL}/chat/completions` });
  });
});
