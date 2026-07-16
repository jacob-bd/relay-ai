import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'smol-toml';
import {
  estimateCodexRequestChars,
  isLikelyCodexCompactionRequest,
  isCodexV2CompactionRequest,
  protectCodexCompactionParams,
  startCodexProxy,
} from '../src/codex-proxy.js';
import type { CodexSdkCallParams } from '../src/codex-responses-adapter.js';
import { CODEX_APP_AUTO_COMPACT_RATIO } from '../src/codex/app-profile.js';

describe('startCodexProxy', () => {
  let handle: Awaited<ReturnType<typeof startCodexProxy>> | null = null;

  afterEach(() => {
    handle?.close();
    handle = null;
  });

  it('serves GET /health', async () => {
    handle = await startCodexProxy([{
      modelId: 'test-model',
      npm: '@ai-sdk/anthropic',
      apiKey: 'sk-test',
      upstreamModelId: 'claude-sonnet-4-6',
    }]);

    const res = await fetch(`http://127.0.0.1:${handle.port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('rejects POST /v1/responses without placeholder key', async () => {
    handle = await startCodexProxy([{
      modelId: 'test-model',
      npm: '@ai-sdk/anthropic',
      apiKey: 'sk-test',
      upstreamModelId: 'claude-sonnet-4-6',
    }]);

    const res = await fetch(`http://127.0.0.1:${handle.port}/v1/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong' },
      body: JSON.stringify({ model: 'test-model', input: 'hi' }),
    });
    expect(res.status).toBe(401);
  });

  it('falls back to first route for unknown model', async () => {
    handle = await startCodexProxy([
      {
        modelId: 'claude-fable-5',
        npm: '@ai-sdk/anthropic',
        apiKey: 'sk-test',
        upstreamModelId: 'claude-fable-5',
      },
      {
        modelId: 'claude-haiku-4-5',
        npm: '@ai-sdk/anthropic',
        apiKey: 'sk-test',
        upstreamModelId: 'claude-haiku-4-5',
      },
    ], { requireAuth: false });

    const res = await fetch(`http://127.0.0.1:${handle.port}/v1/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'relay-ai-launch-codex-app/unknown-model', input: 'hi', stream: false }),
    });
    // Fallback to first route — upstream rejects sk-test with 401, not a proxy-level 404
    expect(res.status).not.toBe(404);
  });

  it('resolves namespaced catalog model ids', async () => {
    const { findCodexProxyRoute } = await import('../src/codex-proxy.js');
    const routes = [
      {
        modelId: 'claude-sonnet-4-6',
        npm: '@ai-sdk/anthropic',
        apiKey: 'sk-test',
        upstreamModelId: 'claude-sonnet-4-6',
      },
    ];
    const route = findCodexProxyRoute(routes, 'relay-ai-launch-codex-app/claude-sonnet-4-6');
    expect(route?.modelId).toBe('claude-sonnet-4-6');
  });

  it('resolves double underscore namespaced model ids (CLI favorites)', async () => {
    const { findCodexProxyRoute } = await import('../src/codex-proxy.js');
    const routes = [
      {
        modelId: 'grok-4.3',
        npm: '@ai-sdk/xai',
        apiKey: 'sk-test',
        upstreamModelId: 'grok-4.3',
      },
    ];
    const route = findCodexProxyRoute(routes, 'xai__grok-4.3');
    expect(route?.modelId).toBe('grok-4.3');
  });

  it('allows POST /v1/responses without auth when requireAuth is false', async () => {
    handle = await startCodexProxy([{
      modelId: 'test-model',
      npm: '@ai-sdk/anthropic',
      apiKey: 'sk-test',
      upstreamModelId: 'claude-sonnet-4-6',
    }], { requireAuth: false });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(`http://127.0.0.1:${handle.port}/v1/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'test-model', input: 'hi', stream: false }),
        signal: controller.signal,
      });
      // Proxy accepted the request and passed it upstream.
      // The proxy's own auth rejection always uses type:'invalid_api_key';
      // upstream errors (including upstream 401s) use type:'api_error'.
      const body = await res.json() as { error?: { type?: string } };
      expect(body.error?.type).not.toBe('invalid_api_key');
    } catch (err) {
      // AbortError means the proxy accepted the request and is awaiting upstream.
      expect(err instanceof Error && err.name === 'AbortError').toBe(true);
    } finally {
      clearTimeout(timer);
    }
  });

  it('serves GET /v1/models and GET /v1/models/:id', async () => {
    handle = await startCodexProxy([
      {
        modelId: 'claude-sonnet-4.5',
        npm: '@ai-sdk/anthropic',
        apiKey: 'sk-test',
        upstreamModelId: 'claude-sonnet-4-5-20250929',
        providerId: 'anthropic',
      },
    ], { requireAuth: false });

    // 1. GET /v1/models
    const resList = await fetch(`http://127.0.0.1:${handle.port}/v1/models`);
    expect(resList.status).toBe(200);
    const listBody = await resList.json() as { object: string; data: Array<{ id: string; owned_by: string }> };
    expect(listBody.object).toBe('list');
    expect(listBody.data).toContainEqual(expect.objectContaining({
      id: 'claude-sonnet-4.5',
      owned_by: 'anthropic',
    }));
    expect(listBody.data).toContainEqual(expect.objectContaining({
      id: 'anthropic__claude-sonnet-4.5',
      owned_by: 'anthropic',
    }));

    // 2. GET /v1/models/:id (namespaced slug)
    const resModelNamespaced = await fetch(`http://127.0.0.1:${handle.port}/v1/models/anthropic__claude-sonnet-4.5`);
    expect(resModelNamespaced.status).toBe(200);
    const modelBodyNamespaced = await resModelNamespaced.json() as { id: string; owned_by: string };
    expect(modelBodyNamespaced.id).toBe('anthropic__claude-sonnet-4.5');
    expect(modelBodyNamespaced.owned_by).toBe('anthropic');

    // 3. GET /v1/models/:id (bare id)
    const resModelBare = await fetch(`http://127.0.0.1:${handle.port}/v1/models/claude-sonnet-4.5`);
    expect(resModelBare.status).toBe(200);
    const modelBodyBare = await resModelBare.json() as { id: string; owned_by: string };
    expect(modelBodyBare.id).toBe('claude-sonnet-4.5');
    expect(modelBodyBare.owned_by).toBe('anthropic');

    // 4. GET /v1/models/:id (invalid)
    const resModelInvalid = await fetch(`http://127.0.0.1:${handle.port}/v1/models/non-existent`);
    expect(resModelInvalid.status).toBe(404);
  });

});

describe('Codex compaction protection', () => {
  it('detects and shrinks oversized relay-started compaction requests before upstream', () => {
    const body = {
      model: 'relay-model',
      stream: true,
      previous_response_id: 'resp_previous',
      input: [
        ...Array.from({ length: 240 }, (_, i) => ({
          type: 'message',
          role: 'user',
          content: `turn ${i}\n${'x'.repeat(20_000)}`,
        })),
        { type: 'compaction_trigger' },
      ],
    };
    const params: CodexSdkCallParams = {
      messages: Array.from({ length: 240 }, (_, i) => ({
        role: 'user',
        content: [{ type: 'text', text: `turn ${i}\n${'x'.repeat(20_000)}` }],
      })),
    };

    expect(isLikelyCodexCompactionRequest(body)).toBe(true);

    const protectedParams = protectCodexCompactionParams(body, params, 100_000);

    expect(estimateCodexRequestChars(protectedParams)).toBeLessThanOrEqual(Math.floor(100_000 * CODEX_APP_AUTO_COMPACT_RATIO) * 3);
    expect(protectedParams.messages.length).toBeGreaterThanOrEqual(3);
    for (const message of protectedParams.messages) {
      const content = message.content;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
          expect(part.text.length).toBeLessThanOrEqual(12_000);
        }
      }
    }
  });

  it('strips tools from a detected compaction request so the model must return a text summary', () => {
    const body = {
      model: 'relay-model',
      stream: true,
      previous_response_id: 'resp_previous',
      tools: [{ type: 'function', name: 'read_file', parameters: {} }],
      input: [
        ...Array.from({ length: 240 }, (_, i) => ({
          type: 'message',
          role: 'user',
          content: `turn ${i}\n${'x'.repeat(20_000)}`,
        })),
        { type: 'compaction_trigger' },
      ],
    };
    const params: CodexSdkCallParams = {
      messages: Array.from({ length: 240 }, (_, i) => ({
        role: 'user',
        content: [{ type: 'text', text: `turn ${i}\n${'x'.repeat(20_000)}` }],
      })),
      tools: { read_file: {} } as CodexSdkCallParams['tools'],
    };

    expect(isLikelyCodexCompactionRequest(body)).toBe(true);

    const protectedParams = protectCodexCompactionParams(body, params, 100_000);

    expect(protectedParams.tools).toBeUndefined();
  });

  it('caps output tokens on a detected compaction request to bound a runaway generation', () => {
    const body = {
      model: 'relay-model',
      stream: true,
      previous_response_id: 'resp_previous',
      input: [
        ...Array.from({ length: 240 }, (_, i) => ({
          type: 'message',
          role: 'user',
          content: `turn ${i}\n${'x'.repeat(20_000)}`,
        })),
        { type: 'compaction_trigger' },
      ],
    };
    const params: CodexSdkCallParams = {
      messages: Array.from({ length: 240 }, (_, i) => ({
        role: 'user',
        content: [{ type: 'text', text: `turn ${i}\n${'x'.repeat(20_000)}` }],
      })),
    };

    const protectedParams = protectCodexCompactionParams(body, params, 100_000);

    expect(protectedParams.maxOutputTokens).toBe(4_000);
  });

  it('does not raise an already-tighter client-supplied output cap on compaction', () => {
    const body = {
      model: 'relay-model',
      stream: true,
      input: [
        ...Array.from({ length: 240 }, (_, i) => ({
          type: 'message',
          role: 'user',
          content: `turn ${i}\n${'x'.repeat(20_000)}`,
        })),
        { type: 'compaction_trigger' },
      ],
    };
    const params: CodexSdkCallParams = {
      messages: Array.from({ length: 240 }, (_, i) => ({
        role: 'user',
        content: [{ type: 'text', text: `turn ${i}\n${'x'.repeat(20_000)}` }],
      })),
      maxOutputTokens: 500,
    };

    const protectedParams = protectCodexCompactionParams(body, params, 100_000);

    expect(protectedParams.maxOutputTokens).toBe(500);
  });

  it('keeps tools on a normal (non-compaction) request', () => {
    const body = { model: 'relay-model', stream: true, input: 'hello' };
    const params: CodexSdkCallParams = {
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      tools: { read_file: {} } as CodexSdkCallParams['tools'],
    };

    expect(isLikelyCodexCompactionRequest(body)).toBe(false);

    const protectedParams = protectCodexCompactionParams(body, params, 100_000);

    expect(protectedParams.tools).toEqual({ read_file: {} });
  });

  it('does NOT classify a huge normal agentic turn as compaction (no marker)', () => {
    // Regression: observed live — a normal 29-message review turn with 131 tools and a
    // 427KB body (> 2x the 200K window) was misclassified as compaction by the old size
    // heuristic, stripping its tools mid-task.
    const body = {
      model: 'relay-model',
      stream: true,
      input: Array.from({ length: 89 }, (_, i) => ({
        type: 'message',
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `turn ${i}\n${'x'.repeat(5_000)}`,
      })),
      tools: [{ type: 'function', name: 'exec_command', parameters: {} }],
    };
    const params: CodexSdkCallParams = {
      messages: Array.from({ length: 29 }, (_, i) => ({
        role: 'user',
        content: [{ type: 'text', text: `turn ${i}\n${'x'.repeat(10_000)}` }],
      })),
      tools: { exec_command: {} } as CodexSdkCallParams['tools'],
    };

    expect(isLikelyCodexCompactionRequest(body)).toBe(false);
    const protectedParams = protectCodexCompactionParams(body, params, 100_000);
    expect(protectedParams.tools).toEqual({ exec_command: {} });
    expect(protectedParams.maxOutputTokens).toBeUndefined();
  });

  it('classifies a small request with a compaction_trigger item as compaction', () => {
    const body = {
      model: 'relay-model',
      stream: true,
      input: [
        { type: 'message', role: 'user', content: 'short conversation' },
        { type: 'compaction_trigger' },
      ],
    };
    expect(isLikelyCodexCompactionRequest(body)).toBe(true);
  });

  it('classifies a prompt-based compaction request by its checkpoint marker', () => {
    // Older Codex versions send the summarization prompt as the final user message
    // (codex-rs templates/compact/prompt.md) instead of a compaction_trigger item.
    const body = {
      model: 'relay-model',
      stream: true,
      input: [
        { type: 'message', role: 'user', content: 'earlier conversation' },
        { type: 'message', role: 'user', content: 'You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM that will resume the task.' },
      ],
    };
    expect(isLikelyCodexCompactionRequest(body)).toBe(true);
  });

  it('ignores the checkpoint marker when it appears mid-history (e.g. quoted in a diff)', () => {
    const body = {
      model: 'relay-model',
      stream: true,
      input: [
        { type: 'message', role: 'user', content: 'You are performing a CONTEXT CHECKPOINT COMPACTION — this string appears in a file we are reviewing.' },
        { type: 'message', role: 'user', content: 'now continue the code review' },
      ],
    };
    expect(isLikelyCodexCompactionRequest(body)).toBe(false);
  });

  it('isCodexV2CompactionRequest fires only for a compaction_trigger control, not v1 or durable items', () => {
    const v2 = { input: [{ type: 'message', role: 'user', content: 'x' }, { type: 'compaction_trigger' }] };
    expect(isCodexV2CompactionRequest(v2)).toBe(true);

    // v1 prompt-based path must NOT be treated as v2 (it returns a normal message).
    const v1 = { input: [{ type: 'message', role: 'user', content: 'You are performing a CONTEXT CHECKPOINT COMPACTION. Summarize.' }] };
    expect(isCodexV2CompactionRequest(v1)).toBe(false);

    // A durable compaction summary replayed in history must NOT re-trigger synthesis.
    const replay = { input: [{ type: 'compaction', encrypted_content: 'abc' }, { type: 'message', role: 'user', content: 'continue' }] };
    expect(isCodexV2CompactionRequest(replay)).toBe(false);
  });
});

describe('resolveCodexRoute', () => {
  it('routes OpenAI to tier 1 direct', async () => {
    const { resolveCodexRoute } = await import('../src/codex/routing.js');
    const route = resolveCodexRoute(
      { id: 'openai', name: 'OpenAI', apiKey: 'k', models: [] },
      { id: 'gpt-5', name: 'GPT', family: '', brand: '', modelFormat: 'openai', upstreamModelId: 'gpt-5', npm: '@ai-sdk/openai' },
      'k',
    );
    expect(route.tier).toBe('direct');
  });

  it('routes OpenAI OAuth through the proxy', async () => {
    const { resolveCodexRoute } = await import('../src/codex/routing.js');
    const route = resolveCodexRoute(
      { id: 'openai', name: 'OpenAI', apiKey: 'oauth-token', authType: 'oauth', models: [] },
      { id: 'gpt-5.5', name: 'GPT', family: '', brand: '', modelFormat: 'openai', upstreamModelId: 'gpt-5.5', npm: '@ai-sdk/openai' },
      'oauth-token',
    );
    expect(route.tier).toBe('proxy');
    expect(route.authType).toBe('oauth');
  });

  it('routes Anthropic to tier 2 proxy', async () => {
    const { resolveCodexRoute } = await import('../src/codex/routing.js');
    const route = resolveCodexRoute(
      { id: 'anthropic', name: 'Anthropic', apiKey: 'k', models: [] },
      { id: 'claude-sonnet-4-6', name: 'Sonnet', family: '', brand: '', modelFormat: 'anthropic', upstreamModelId: 'claude-sonnet-4-6', npm: '@ai-sdk/anthropic' },
      'k',
    );
    expect(route.tier).toBe('proxy');
  });

  it('routes xAI to tier 2 proxy in v1', async () => {
    const { resolveCodexRoute } = await import('../src/codex/routing.js');
    const route = resolveCodexRoute(
      { id: 'xai', name: 'xAI', apiKey: 'k', models: [] },
      { id: 'grok-3', name: 'Grok', family: '', brand: '', modelFormat: 'openai', upstreamModelId: 'grok-3', npm: '@ai-sdk/xai' },
      'k',
    );
    expect(route.tier).toBe('proxy');
  });

  it('carries custom endpoint headers through to the route', async () => {
    const { resolveCodexRoute } = await import('../src/codex/routing.js');
    const route = resolveCodexRoute(
      { id: 'custom-zai', name: 'Z.AI Coding Plan', apiKey: 'k', headers: { 'X-Plan': 'coding' }, models: [] },
      { id: 'glm-5.2', name: 'GLM', family: '', brand: '', modelFormat: 'openai', upstreamModelId: 'glm-5.2', npm: '@ai-sdk/openai-compatible', apiBaseUrl: 'https://api.z.ai/api/coding/paas/v4' },
      'k',
    );
    expect(route.tier).toBe('proxy');
    expect(route.headers).toEqual({ 'X-Plan': 'coding' });
  });
});

describe('codexCompatibleProviders', () => {
  it('includes anthropic and zen/go', async () => {
    const { codexCompatibleProviders } = await import('../src/codex/routing.js');
    const providers = [
      { id: 'zen', name: 'Zen', apiKey: 'k', models: [{ id: 'm', name: 'M', family: '', brand: '', modelFormat: 'openai' as const, upstreamModelId: 'm' }] },
      { id: 'groq', name: 'Groq', apiKey: 'k', models: [{ id: 'm', name: 'M', family: '', brand: '', modelFormat: 'openai' as const, upstreamModelId: 'm', npm: '@ai-sdk/groq' }] },
      { id: 'anthropic', name: 'A', apiKey: 'k', models: [{ id: 'm', name: 'M', family: '', brand: '', modelFormat: 'anthropic' as const, upstreamModelId: 'm' }] },
    ];
    expect(codexCompatibleProviders(providers).map(p => p.id).sort()).toEqual(['anthropic', 'groq', 'zen']);
  });
});

describe('buildCodexProfileToml', () => {
  it('writes proxy tier profile with RELAY_AI_CODEX_KEY', async () => {
    const { buildCodexProfileToml } = await import('../src/codex/profile.js');
    const toml = buildCodexProfileToml({
      route: {
        tier: 'proxy',
        npm: '@ai-sdk/anthropic',
        upstreamModelId: 'claude-sonnet-4-6',
        apiKey: 'k',
        modelId: 'claude-sonnet-4-6',
        providerId: 'anthropic',
      },
      proxyPort: 62832,
      catalogPath: '/tmp/models-anthropic.json',
    });
    expect(toml).toContain('model_provider = "relay-ai-proxy"');
    expect(toml).toContain('sandbox = "danger-full-access"');
    expect(toml).toContain('env_key = "RELAY_AI_CODEX_KEY"');
    expect(toml).toContain('wire_api = "responses"');
    expect(toml).toContain('http://127.0.0.1:62832/v1');
  });

  it('writes direct tier for OpenAI', async () => {
    const { buildCodexProfileToml } = await import('../src/codex/profile.js');
    const toml = buildCodexProfileToml({
      route: {
        tier: 'direct',
        npm: '@ai-sdk/openai',
        upstreamModelId: 'gpt-5',
        apiKey: 'k',
        modelId: 'gpt-5',
        providerId: 'openai',
        baseURL: 'https://api.openai.com/v1',
      },
      catalogPath: '/tmp/models-openai.json',
    });
    expect(toml).toContain('model_provider = "openai"');
    expect(toml).toContain('env_key = "OPENAI_API_KEY"');
  });

  it('writes favorites slug and default reasoning effort for capable models', async () => {
    const { buildCodexProfileToml } = await import('../src/codex/profile.js');
    const toml = buildCodexProfileToml({
      route: {
        tier: 'proxy',
        npm: '@ai-sdk/openai-compatible',
        upstreamModelId: 'deepseek-v4-flash-free',
        apiKey: 'k',
        modelId: 'zen__deepseek-v4-flash-free',
        providerId: 'relay-ai-proxy',
      },
      proxyPort: 62832,
      catalogPath: '/tmp/models-favorites.json',
      modelReasoningEffort: 'high',
    });
    expect(toml).toContain('model = "zen__deepseek-v4-flash-free"');
    expect(toml).toContain('model_reasoning_effort = "high"');
  });

  it('escapes Windows paths as valid TOML strings', async () => {
    const { buildCodexProfileToml } = await import('../src/codex/profile.js');
    const toml = buildCodexProfileToml({
      route: {
        tier: 'direct',
        npm: '@ai-sdk/openai',
        upstreamModelId: 'gpt-5',
        apiKey: 'k',
        modelId: 'gpt-5',
        providerId: 'openai',
        baseURL: 'https://api.openai.com/v1',
      },
      catalogPath: 'C:\\Users\\Jacob\\relay-ai\\models-openai.json',
    });
    const parsed = parse(toml) as {
      model_catalog_json?: string;
      model_providers?: Record<string, { base_url?: string }>;
    };
    expect(parsed.model_catalog_json).toBe('C:\\Users\\Jacob\\relay-ai\\models-openai.json');
    expect(parsed.model_providers?.openai?.base_url).toBe('https://api.openai.com/v1');
  });
});

describe('buildCatalogFile', () => {
  it('emits valid ModelInfo schema', async () => {
    const { buildCatalogFile, serializeCatalog } = await import('../src/codex/catalog.js');
    const catalog = buildCatalogFile([
      { id: 'claude-sonnet-4-6', name: 'Sonnet', family: 'claude', brand: '', modelFormat: 'anthropic', upstreamModelId: 'claude-sonnet-4-6', npm: '@ai-sdk/anthropic', contextWindow: 200000 },
    ], 'Anthropic');
    expect(catalog.models).toHaveLength(1);
    expect(catalog.models[0]!.slug).toBe('claude-sonnet-4-6');
    expect(catalog.models[0]!.display_name).toBe('Sonnet');
    expect(catalog.models[0]!.truncation_policy.limit).toBe(200000);
    expect(catalog.models[0]!.supported_reasoning_levels).toHaveLength(3);
    expect(catalog.models[0]!.default_reasoning_level).toBe('high');
    expect(catalog.models[0]!.supports_reasoning_summaries).toBe(true);
    expect(JSON.parse(serializeCatalog(catalog)).models[0].supported_in_api).toBe(true);
  });

  it('formats claude ids when name equals id', async () => {
    const { formatCodexModelLabel, buildAppCatalogFile } = await import('../src/codex/catalog.js');
    const haiku = { id: 'claude-haiku-4-5-20251001', name: 'claude-haiku-4-5-20251001', family: 'claude', brand: 'Claude', modelFormat: 'anthropic' as const, upstreamModelId: 'claude-haiku-4-5-20251001', contextWindow: 200000 };
    const sonnet = { id: 'claude-sonnet-4-6', name: 'claude-sonnet-4-6', family: 'claude', brand: 'Claude', modelFormat: 'anthropic' as const, upstreamModelId: 'claude-sonnet-4-6', contextWindow: 200000 };
    expect(formatCodexModelLabel(haiku)).toBe('Claude Haiku 4.5');
    const catalog = buildAppCatalogFile([sonnet, haiku], 'Anthropic', haiku.id);
    expect(catalog.models[0]!.slug).toBe('claude-haiku-4-5-20251001');
    expect(catalog.models[0]!.display_name).toBe('Claude Haiku 4.5');
    expect(catalog.models[0]!.priority).toBe(0);
    expect(catalog.models[1]!.priority).toBe(1);
  });
});
