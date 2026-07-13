import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerModelInfo } from '../src/server/models.js';
import type { FavoriteModel } from '../src/types.js';
import { createMockRequest, createMockResponse } from './helpers/ui-api-test-utils.js';

const testModel: ServerModelInfo = {
  id: 'test-model',
  name: 'Test Model',
  isFree: false,
  brand: 'Test',
  sourceBackend: 'zen',
  modelFormat: 'anthropic',
  providerId: 'zen',
  providerLabel: 'OpenCode Zen',
};

const state = vi.hoisted(() => ({
  apiKey: 'test-key' as string | null,
  models: [] as ServerModelInfo[],
  failNextStartWithPortConflict: false,
  close: vi.fn<() => Promise<void>>(async () => undefined),
  proxyClose: vi.fn<() => Promise<void>>(async () => undefined),
  failNextProxyStartWithPortConflict: false,
  savedPassword: null as string | null,
  exposedProviders: null as string[] | null,
  maskGatewayIds: true,
  favoritesOnly: false,
  freeModelsOnly: false,
  savedListenMode: 'local' as 'local' | 'network',
  favorites: [] as FavoriteModel[],
}));

vi.mock('../src/http-proxy/index.js', () => ({
  startConfiguredHttpProxy: vi.fn(async () => {
    if (state.failNextProxyStartWithPortConflict) {
      state.failNextProxyStartWithPortConflict = false;
      const err: NodeJS.ErrnoException = new Error('address in use');
      err.code = 'EADDRINUSE';
      throw err;
    }
    return {
      handle: {
        host: '127.0.0.1',
        port: 17645,
        caCertPath: '/tmp/relay-ai/http-proxy/relay-ai-ca.pem',
        inferenceLogPath: '/tmp/relay-ai/logs/inference-requests.jsonl',
        modelIds: ['relay:openai:gpt-test[1m]'],
        close: state.proxyClose,
      },
      loaded: {
        favoriteCount: 2,
        routes: [{
          aliasId: 'relay:openai:gpt-test[1m]',
          realModelId: 'gpt-test',
          displayName: 'GPT Test (OpenAI)',
          upstreamUrl: '',
          apiKey: 'provider-key',
          modelFormat: 'openai',
          npm: '@ai-sdk/openai',
        }],
        unavailable: [{ providerId: 'missing', modelId: 'gone' }],
        unsupported: [],
      },
    };
  }),
}));

vi.mock('../src/server/index.js', async () => {
  const actual = await vi.importActual<typeof import('../src/server/index.js')>('../src/server/index.js');
  return {
    ...actual,
    loadServerModels: vi.fn(async () => state.models),
    resolveServerUpstreamApiKey: vi.fn(async () => state.apiKey),
    getLocalIps: vi.fn(() => [{ name: 'en0', address: '192.168.1.50' }]),
  };
});

// Server password lives in the OS keychain, keyed globally (not per RELAY_AI_HOME) — mock
// it out so tests don't read/write the real machine keychain, matching server-index.test.ts.
vi.mock('../src/config.js', async () => {
  const actual = await vi.importActual<typeof import('../src/config.js')>('../src/config.js');
  return {
    ...actual,
    getSavedServerPassword: vi.fn(async () => state.savedPassword),
    setSavedServerPassword: vi.fn(async (password: string) => { state.savedPassword = password; }),
    getServerExposedProviders: vi.fn(() => state.exposedProviders),
    setServerExposedProviders: vi.fn((ids: string[]) => { state.exposedProviders = ids; }),
    getServerMaskGatewayIds: vi.fn(() => state.maskGatewayIds),
    setServerMaskGatewayIds: vi.fn((v: boolean) => { state.maskGatewayIds = v; }),
    getServerFavoritesOnly: vi.fn(() => state.favoritesOnly),
    setServerFavoritesOnly: vi.fn((v: boolean) => { state.favoritesOnly = v; }),
    getServerFreeModelsOnly: vi.fn(() => state.freeModelsOnly),
    setServerFreeModelsOnly: vi.fn((v: boolean) => { state.freeModelsOnly = v; }),
    getServerListenMode: vi.fn(() => state.savedListenMode),
    setServerListenMode: vi.fn((mode: 'local' | 'network') => { state.savedListenMode = mode; }),
    loadPreferences: vi.fn(() => ({ favoriteModels: state.favorites })),
  };
});

vi.mock('../src/server/router.js', () => ({
  startServer: vi.fn(async (options: any) => {
    if (state.failNextStartWithPortConflict) {
      state.failNextStartWithPortConflict = false;
      const err: NodeJS.ErrnoException = new Error('address in use');
      err.code = 'EADDRINUSE';
      throw err;
    }
    return {
      host: options.host,
      port: 17645,
      url: `http://${options.host}:17645`,
      server: {} as any,
      inferenceLogPath: options.inferenceLogPath,
      close: state.close,
    };
  }),
}));

async function call(method: string, url: string, body?: unknown) {
  const { handleUiApiRequest } = await import('../src/ui/api.js');
  const req = createMockRequest(method, url, body !== undefined ? JSON.stringify(body) : undefined);
  const mockRes = createMockResponse();
  handleUiApiRequest(req, mockRes.res);
  await new Promise(resolve => setTimeout(resolve, 50));
  return { code: mockRes.result.code, body: JSON.parse(mockRes.result.data) };
}

describe('UI API Server endpoints', () => {
  let tempHome: string;
  let previousRelayHome: string | undefined;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'relay-ai-ui-api-server-test-'));
    previousRelayHome = process.env['RELAY_AI_HOME'];
    process.env['RELAY_AI_HOME'] = join(tempHome, 'relay-home');
    state.apiKey = 'test-key';
    state.models = [testModel];
    state.failNextStartWithPortConflict = false;
    state.failNextProxyStartWithPortConflict = false;
    state.close.mockClear();
    state.proxyClose.mockClear();
    state.savedPassword = null;
    state.exposedProviders = null;
    state.maskGatewayIds = true;
    state.favoritesOnly = false;
    state.freeModelsOnly = false;
    state.savedListenMode = 'local';
    state.favorites = [];
  });

  afterEach(async () => {
    // Best-effort cleanup — stop any server left running by a test.
    await call('POST', '/api/server/stop');
    rmSync(tempHome, { recursive: true, force: true });
    if (previousRelayHome === undefined) delete process.env['RELAY_AI_HOME'];
    else process.env['RELAY_AI_HOME'] = previousRelayHome;
  });

  it('reports not running before anything is started', async () => {
    const { code, body } = await call('GET', '/api/server/status');
    expect(code).toBe(200);
    expect(body.running).toBe(false);
    expect(body.saved).toMatchObject({ favoritesOnly: false, freeModelsOnly: false, maskGatewayIds: true, listenMode: 'local', hasSavedPassword: false });
  });

  it('rejects starting when no providers are configured', async () => {
    state.apiKey = null;
    const { body } = await call('POST', '/api/server/start', {
      favoritesOnly: false,
      freeModelsOnly: false,
      exposedProviders: null,
      maskGatewayIds: true,
      listenMode: 'local',
    });
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/No providers configured/);
  });

  it('surfaces a clear error when the gateway port is already taken', async () => {
    state.failNextStartWithPortConflict = true;
    const { body } = await call('POST', '/api/server/start', {
      favoritesOnly: false,
      freeModelsOnly: false,
      exposedProviders: null,
      maskGatewayIds: true,
      listenMode: 'local',
    });
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/Port 17645 is already in use/);
  });

  it('starts in local mode and reports URLs + models, then blocks a second start', async () => {
    const startResult = await call('POST', '/api/server/start', {
      mode: 'gateway',
      favoritesOnly: false,
      freeModelsOnly: false,
      exposedProviders: null,
      maskGatewayIds: false,
      listenMode: 'local',
    });
    expect(startResult.body.ok).toBe(true);
    expect(startResult.body.status.running).toBe(true);
    expect(startResult.body.status.anthropicUrl).toBe('http://127.0.0.1:17645/anthropic');
    expect(startResult.body.status.openaiUrl).toBe('http://127.0.0.1:17645/openai/v1');
    expect(startResult.body.status.apiKey).toBe('any non-empty value');
    expect(startResult.body.status.requestLogPath).toMatch(/inference-requests\.jsonl$/);
    expect(startResult.body.status.models).toEqual([
      { providerLabel: 'OpenCode Zen', name: 'Test Model', anthropicId: 'anthropic-zen__test-model', openaiId: 'test-model' },
    ]);

    const statusResult = await call('GET', '/api/server/status');
    expect(statusResult.body.running).toBe(true);

    const secondStart = await call('POST', '/api/server/start', {
      favoritesOnly: false,
      freeModelsOnly: false,
      exposedProviders: null,
      maskGatewayIds: false,
      listenMode: 'local',
    });
    expect(secondStart.body.ok).toBe(false);
    expect(secondStart.body.error).toMatch(/already running/);
  });

  it('starts HTTP proxy mode and reports env values plus relay model names', async () => {
    const started = await call('POST', '/api/server/start', { mode: 'http-proxy' });

    expect(started.body.ok).toBe(true);
    expect(started.body.status).toMatchObject({
      running: true,
      mode: 'http-proxy',
      proxyUrl: 'http://127.0.0.1:17645',
      caCertPath: '/tmp/relay-ai/http-proxy/relay-ai-ca.pem',
      requestLogPath: '/tmp/relay-ai/logs/inference-requests.jsonl',
      unavailableFavorites: 1,
      unsupportedFavorites: 0,
      proxyModels: [{ id: 'relay:openai:gpt-test[1m]', displayName: 'GPT Test (OpenAI)' }],
    });
    expect(started.body.status.anthropicUrl).toBeUndefined();
    expect(started.body.status.apiKey).toBeUndefined();

    const stopped = await call('POST', '/api/server/stop');
    expect(stopped.body.ok).toBe(true);
    expect(state.proxyClose).toHaveBeenCalledOnce();
  });

  it('surfaces an HTTP proxy port conflict clearly', async () => {
    state.failNextProxyStartWithPortConflict = true;
    const { body } = await call('POST', '/api/server/start', { mode: 'http-proxy' });
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/Port 17645 is already in use/);
  });

  it('starts with free-models-only filter and reports only free/free-access models', async () => {
    state.models = [
      {
        ...testModel,
        id: 'hy3',
        name: 'Hy3',
        providerId: 'kilo',
        providerLabel: 'Kilo Code',
        isFree: true,
        freeStatus: 'verified_free',
      },
      {
        ...testModel,
        id: 'paid-model',
        name: 'Paid Model',
        providerId: 'openai',
        providerLabel: 'OpenAI',
        isFree: false,
        freeStatus: 'paid',
      },
    ];

    const started = await call('POST', '/api/server/start', {
      favoritesOnly: false,
      freeModelsOnly: true,
      exposedProviders: null,
      maskGatewayIds: false,
      listenMode: 'local',
    });

    expect(started.body.ok).toBe(true);
    expect(started.body.status.freeModelsOnly).toBe(true);
    expect(started.body.status.models.map((m: { openaiId: string }) => m.openaiId)).toEqual(['hy3']);
  });

  it('requires a password in network mode and returns it back on status', async () => {
    const missingPassword = await call('POST', '/api/server/start', {
      favoritesOnly: false,
      freeModelsOnly: false,
      exposedProviders: null,
      maskGatewayIds: false,
      listenMode: 'network',
      passwordMode: 'new',
      password: '   ',
    });
    expect(missingPassword.body.ok).toBe(false);
    expect(missingPassword.body.error).toMatch(/password is required/);

    const started = await call('POST', '/api/server/start', {
      favoritesOnly: false,
      freeModelsOnly: false,
      exposedProviders: null,
      maskGatewayIds: false,
      listenMode: 'network',
      passwordMode: 'new',
      password: 'hunter2',
      savePassword: true,
    });
    expect(started.body.ok).toBe(true);
    expect(state.savedListenMode).toBe('network');
    expect(started.body.status.apiKey).toBe('hunter2');
    expect(started.body.status.networkUrls).toEqual([
      { name: 'en0', anthropicUrl: 'http://192.168.1.50:17645/anthropic', openaiUrl: 'http://192.168.1.50:17645/openai/v1' },
    ]);

    const status = await call('GET', '/api/server/status');
    expect(status.body.saved.hasSavedPassword).toBe(true);
  });

  it('returns no favorites configured error in favorites-only mode with no favorites saved', async () => {
    const { body } = await call('POST', '/api/server/start', {
      favoritesOnly: true,
      freeModelsOnly: false,
      exposedProviders: null,
      maskGatewayIds: true,
      listenMode: 'local',
    });
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/No favorite models configured/);
  });

  it('stops a running server and flips status back', async () => {
    await call('POST', '/api/server/start', {
      favoritesOnly: false,
      freeModelsOnly: false,
      exposedProviders: null,
      maskGatewayIds: true,
      listenMode: 'local',
    });
    const stopResult = await call('POST', '/api/server/stop');
    expect(stopResult.body.ok).toBe(true);
    expect(state.close).toHaveBeenCalledOnce();

    const status = await call('GET', '/api/server/status');
    expect(status.body.running).toBe(false);
  });
});
