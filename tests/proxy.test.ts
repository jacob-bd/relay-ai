// tests/proxy.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import {
  aliasModelId,
  buildProxySubagentModelRouting,
  startProxyCatalog,
  type ProxyRoute,
} from '../src/proxy.js';
import { getProxyDebugLogPath } from '../src/trace-log.js';
import { translateRequest } from '../src/sdk-adapter.js';

vi.mock('../src/sdk-adapter.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/sdk-adapter.js')>();
  return {
    ...actual,
    translateRequest: vi.fn(actual.translateRequest),
  };
});

/** POST JSON to a local proxy via node:http (avoids vi.stubGlobal('fetch') interception). */
function postToProxy(port: number, token: string, body: unknown): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

describe('aliasModelId', () => {
  it('returns claude-* ids unchanged', () => {
    expect(aliasModelId('claude-sonnet-4', 'Anthropic')).toBe('claude-sonnet-4');
  });

  it('prefixes non-claude ids with anthropic-{providerId}__', () => {
    expect(aliasModelId('grok-4.3', 'xai')).toBe('anthropic-xai__grok-4.3');
  });

  it('uses stable provider id slug in alias', () => {
    expect(aliasModelId('deepseek-v4', 'go')).toBe('anthropic-go__deepseek-v4');
  });
});

describe('buildProxySubagentModelRouting', () => {
  it('uses the transparent public gateway id instead of an internal relay alias', () => {
    const partner: ProxyRoute = {
      aliasId: 'relay:qwen:3',
      gatewayAliasId: 'anthropic-relay__qwen-3',
      realModelId: 'qwen-3',
      displayName: 'Qwen 3',
      upstreamUrl: '',
      apiKey: 'key',
      modelFormat: 'openai',
      providerId: 'relay',
    };
    const native: ProxyRoute = {
      aliasId: 'claude-sonnet-4-6',
      realModelId: 'claude-sonnet-4-6',
      displayName: 'Claude Sonnet 4.6',
      upstreamUrl: '',
      apiKey: 'key',
      modelFormat: 'anthropic',
      providerId: 'claude',
    };

    const result = buildProxySubagentModelRouting([partner, native], partner);

    expect(result.parentModelId).toBe('anthropic-relay__qwen-3');
    expect(result.parentModelId).not.toContain('relay:');
    expect(result.models[0]?.compatibilityIds).toContain('relay:qwen:3');
    expect(result.models[0]?.compatibilityIds).toContain('anthropic-relay__qwen-3[1m]');
    expect(result.models.map(option => option.family)).toEqual([undefined, 'sonnet']);
  });

  it('falls back to aliasId when no transparent gateway id exists', () => {
    const route: ProxyRoute = {
      aliasId: 'anthropic-go__grok-4',
      realModelId: 'grok-4',
      displayName: 'Grok 4',
      upstreamUrl: '',
      apiKey: 'key',
      modelFormat: 'openai',
      providerId: 'go',
    };
    expect(buildProxySubagentModelRouting([route], route).parentModelId).toBe(route.aliasId);
  });
});

describe('cloud-code handler 401 retry', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('retries with refreshed token on upstream 401 and succeeds', async () => {
    const refreshToken = vi.fn().mockResolvedValue('refreshed-token');
    const route: ProxyRoute = {
      aliasId: 'claude-sonnet-4-6',
      realModelId: 'claude-sonnet-4-6',
      displayName: 'Claude Sonnet',
      upstreamUrl: 'https://cloudcode.googleapis.com',
      apiKey: 'original-token',
      modelFormat: 'cloud-code',
      providerId: 'antigravity',
      authType: 'oauth',
      providerData: { projectId: 'proj-123' },
      refreshToken,
    };

    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url: string, opts: RequestInit) => {
      callCount++;
      const auth = (opts.headers as Record<string, string>)['Authorization'];
      if (auth === 'Bearer original-token') {
        return { ok: false, status: 401, text: async () => 'token expired' };
      }
      // second call with refreshed token
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'text/event-stream' },
        body: { getReader: () => ({ read: vi.fn().mockResolvedValue({ done: true }) }) },
      };
    }));

    const handle = await startProxyCatalog([route], route.aliasId, false);
    const res = await postToProxy(handle.port, handle.token, {
      model: 'claude-sonnet-4-6',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hi' }],
      stream: false,
    });

    handle.close();
    expect(refreshToken).toHaveBeenCalledOnce();
    expect(callCount).toBe(2); // original + retry
    expect(res.status).not.toBe(401);
  });

  it('does not retry when refreshToken is not set', async () => {
    const route: ProxyRoute = {
      aliasId: 'claude-sonnet-4-6',
      realModelId: 'claude-sonnet-4-6',
      displayName: 'Claude Sonnet',
      upstreamUrl: 'https://cloudcode.googleapis.com',
      apiKey: 'original-token',
      modelFormat: 'cloud-code',
      providerId: 'antigravity',
      authType: 'oauth',
      providerData: { projectId: 'proj-123' },
      // no refreshToken
    };

    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      callCount++;
      return { ok: false, status: 401, text: async () => 'token expired' };
    }));

    const handle = await startProxyCatalog([route], route.aliasId, false);
    await postToProxy(handle.port, handle.token, {
      model: 'claude-sonnet-4-6',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hi' }],
      stream: false,
    });

    handle.close();
    expect(callCount).toBe(1); // no retry
  });
});

describe('SDK anonymous route handling', () => {
  it('does not reject empty upstream keys before SDK routing', async () => {
    const route: ProxyRoute = {
      aliasId: 'anthropic-kilo__tencent/hy3:free',
      realModelId: 'tencent/hy3:free',
      displayName: 'Tencent Hy3',
      upstreamUrl: '',
      apiKey: '',
      modelFormat: 'openai',
      npm: 'missing-sdk-provider-for-test',
      baseURL: 'https://api.kilo.ai/api/gateway',
      providerId: 'kilo',
    };

    const handle = await startProxyCatalog([route], route.aliasId, false);
    const res = await postToProxy(handle.port, handle.token, {
      model: route.aliasId,
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hi' }],
      stream: false,
    });

    handle.close();
    expect(res.status).toBe(502);
    expect(res.body).not.toContain('Missing API key');
  });

  it('passes routing for the route actually selected by the request', async () => {
    vi.mocked(translateRequest).mockClear();
    const qwen: ProxyRoute = {
      aliasId: 'relay:qwen',
      gatewayAliasId: 'anthropic-relay__qwen-3',
      realModelId: 'qwen-3',
      displayName: 'Qwen 3',
      upstreamUrl: '',
      apiKey: '',
      modelFormat: 'openai',
      npm: 'missing-sdk-provider-for-test',
      providerId: 'relay',
    };
    const grok: ProxyRoute = {
      aliasId: 'relay:grok',
      gatewayAliasId: 'anthropic-relay__grok-4',
      realModelId: 'grok-4',
      displayName: 'Grok 4',
      upstreamUrl: '',
      apiKey: '',
      modelFormat: 'openai',
      npm: 'missing-sdk-provider-for-test',
      providerId: 'relay',
    };
    const handle = await startProxyCatalog([qwen, grok], qwen.aliasId, false);

    await postToProxy(handle.port, handle.token, {
      model: grok.aliasId,
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hi' }],
      tools: [claudeAgentDefinition()],
      stream: false,
    });
    handle.close();

    const options = vi.mocked(translateRequest).mock.calls.at(-1)?.[2] as any;
    expect(options.subagentRouting.parentModelId).toBe(grok.gatewayAliasId);
    expect(options.subagentRouting.models.map((item: any) => item.id)).toEqual([
      qwen.gatewayAliasId,
      grok.gatewayAliasId,
    ]);
  });
});

function claudeAgentDefinition() {
  return {
    name: 'Agent',
    description: 'Launch an agent',
    input_schema: {
      type: 'object',
      properties: {
        description: { type: 'string' },
        prompt: { type: 'string' },
        subagent_type: { type: 'string' },
        model: { type: 'string' },
      },
    },
  };
}

describe('anthropic passthrough debug logging', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('logs upstream non-OK status and body', async () => {
    const route: ProxyRoute = {
      aliasId: 'claude-sonnet-4-6',
      realModelId: 'claude-sonnet-4-6',
      displayName: 'Claude Sonnet',
      upstreamUrl: 'https://api.anthropic.com',
      apiKey: 'oauth-token',
      modelFormat: 'anthropic',
      providerId: 'claude-code',
      authType: 'oauth',
      providerData: {},
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ error: { type: 'rate_limit_error', message: 'rate limit exceeded' } }),
    }));

    const handle = await startProxyCatalog([route], route.aliasId, true);
    const res = await postToProxy(handle.port, handle.token, {
      model: 'claude-sonnet-4-6',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    });

    handle.close();
    expect(res.status).toBe(429);
    const log = readFileSync(getProxyDebugLogPath(), 'utf8');
    expect(log).toContain('anthropic upstream 429');
    expect(log).toContain('rate limit exceeded');
  });

  it('forwards matching Claude Code OAuth session id in body metadata and header', async () => {
    const route: ProxyRoute = {
      aliasId: 'claude-sonnet-4-6',
      realModelId: 'claude-sonnet-4-6',
      displayName: 'Claude Sonnet',
      upstreamUrl: 'https://api.anthropic.com',
      apiKey: 'oauth-token',
      modelFormat: 'anthropic',
      providerId: 'claude-code',
      authType: 'oauth',
      providerData: {
        cliUserID: 'a'.repeat(64),
        accountUUID: '11111111-1111-4111-8111-111111111111',
      },
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ error: { type: 'rate_limit_error', message: 'rate limit exceeded' } }),
    }));

    const handle = await startProxyCatalog([route], route.aliasId, true);
    await postToProxy(handle.port, handle.token, {
      model: 'claude-sonnet-4-6',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    });

    handle.close();
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const headers = init?.headers as Record<string, string>;
    const body = JSON.parse(String(init?.body)) as { metadata?: { user_id?: string } };
    const userId = JSON.parse(body.metadata!.user_id!) as { session_id: string };
    expect(headers['X-Claude-Code-Session-Id']).toBe(userId.session_id);
  });

  it('prepends Claude Code OAuth billing line to upstream system prompt', async () => {
    const route: ProxyRoute = {
      aliasId: 'claude-sonnet-4-6',
      realModelId: 'claude-sonnet-4-6',
      displayName: 'Claude Sonnet',
      upstreamUrl: 'https://api.anthropic.com',
      apiKey: 'oauth-token',
      modelFormat: 'anthropic',
      providerId: 'claude-code',
      authType: 'oauth',
      providerData: {
        cliUserID: 'a'.repeat(64),
        accountUUID: '11111111-1111-4111-8111-111111111111',
      },
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ type: 'message', content: [] }),
      text: async () => JSON.stringify({ type: 'message', content: [] }),
    }));

    const handle = await startProxyCatalog([route], route.aliasId, false);
    await postToProxy(handle.port, handle.token, {
      model: 'claude-sonnet-4-6',
      max_tokens: 100,
      system: [{ type: 'text', text: 'You are helpful.' }],
      messages: [{ role: 'user', content: 'hi' }],
      stream: false,
    });

    handle.close();
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse(String(init?.body)) as { system?: Array<{ type: string; text: string }> };
    expect(body.system?.[0]?.text).toBe('x-anthropic-billing-header: cc_version=2.1.195.0; cc_entrypoint=cli;');
    expect(body.system?.[1]?.text).toBe('You are helpful.');
  });
});
