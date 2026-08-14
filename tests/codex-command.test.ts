import { describe, expect, it, vi, beforeEach } from 'vitest';
import { resolveCodexRoute } from '../src/codex/routing.js';
import type { LocalProvider, LocalProviderModel } from '../src/types.js';

const mocks = vi.hoisted(() => ({
  checkSessionLock: vi.fn(),
  recoverInterruptedCodexSession: vi.fn(() => ({ recovered: false })),
  restoreCodexOverlay: vi.fn(() => []),
  remainingOverlayPaths: vi.fn(() => []),
  writeOverlayFile: vi.fn(),
  writeSessionLock: vi.fn(),
  startCodexProxy: vi.fn(async () => ({ port: 61234, close: vi.fn() })),
  launchCodex: vi.fn(async () => 0),
  fetchProviderCatalog: vi.fn(),
  providersForPicker: vi.fn((providers: any[]) => providers),
  resolveLocalProviderApiKey: vi.fn(async (provider: any) => provider.apiKey),
  loadPreferences: vi.fn(() => ({ favoriteModels: [] })),
  recordLaunchSelection: vi.fn(),
  buildCloudCodeProxyRoute: vi.fn((model: any, apiKey: string, providerData: any) => ({
    aliasId: `anthropic-antigravity__${model.id}`,
    realModelId: model.id,
    displayName: model.name,
    upstreamUrl: 'https://cloudcode.googleapis.com',
    apiKey,
    modelFormat: 'cloud-code',
    providerId: 'antigravity',
    authType: 'oauth',
    providerData,
    contextWindow: model.contextWindow,
  })),
  buildOAuthAnthropicProxyRoute: vi.fn((model: any, apiKey: string, providerId: string, providerData: any) => ({
    aliasId: `anthropic-${providerId}__${model.id}`,
    realModelId: model.id,
    displayName: model.name,
    upstreamUrl: model.baseUrl ?? 'https://api.anthropic.com',
    apiKey,
    modelFormat: 'anthropic',
    providerId,
    authType: 'oauth',
    providerData,
    contextWindow: model.contextWindow,
  })),
  partitionAndStartCloudCodeBackend: vi.fn(async (items: any[], toOutput: any) => {
    const backend = {
      port: 59001,
      token: 'cloud-code-proxy-token',
      handle: { port: 59001, token: 'cloud-code-proxy-token', close: vi.fn() },
    };
    const backendItems = items.map(item => {
      const route = item.model.modelFormat === 'cloud-code'
        ? mocks.buildCloudCodeProxyRoute(item.model, item.apiKey, item.providerData ?? {})
        : mocks.buildOAuthAnthropicProxyRoute(item.model, item.apiKey, item.providerId, item.providerData ?? {});
      return toOutput(route, backend, item);
    });
    return { backendItems, backend };
  }),
  buildSingleModelCloudCodeRoute: vi.fn(async (model: any, apiKey: string, providerId: string, providerData: any) => {
    const proxyRoute = model.modelFormat === 'cloud-code'
      ? mocks.buildCloudCodeProxyRoute(model, apiKey, providerData)
      : mocks.buildOAuthAnthropicProxyRoute(model, apiKey, providerId, providerData);
    return {
      proxyRoute,
      backend: {
        port: 59001,
        token: 'cloud-code-proxy-token',
        handle: { port: 59001, token: 'cloud-code-proxy-token', close: vi.fn() },
      },
    };
  }),
}));

vi.mock('../src/codex/session.js', () => ({
  CODEX_PROFILE_NAME: 'relay-ai-launch',
  getCatalogPath: (providerId: string) => `/tmp/models-${providerId}.json`,
  getCodexProfilePath: () => '/tmp/relay-ai-launch.config.toml',
  getRelayAiCodexDir: () => '/tmp/relay-ai-codex',
  checkSessionLock: mocks.checkSessionLock,
  recoverInterruptedCodexSession: mocks.recoverInterruptedCodexSession,
  restoreCodexOverlay: mocks.restoreCodexOverlay,
  remainingOverlayPaths: mocks.remainingOverlayPaths,
  writeOverlayFile: mocks.writeOverlayFile,
  writeSessionLock: mocks.writeSessionLock,
}));

vi.mock('../src/cloud-code-backend.js', () => ({
  buildCloudCodeProxyRoute: mocks.buildCloudCodeProxyRoute,
  buildOAuthAnthropicProxyRoute: mocks.buildOAuthAnthropicProxyRoute,
  needsCloudCodeBackend: vi.fn((model: any, authType?: string) =>
    model.modelFormat === 'cloud-code' || (model.modelFormat === 'anthropic' && authType === 'oauth'),
  ),
  partitionAndStartCloudCodeBackend: mocks.partitionAndStartCloudCodeBackend,
  buildSingleModelCloudCodeRoute: mocks.buildSingleModelCloudCodeRoute,
  startCloudCodeCatalogBackend: vi.fn().mockResolvedValue({
    port: 59001,
    token: 'cloud-code-proxy-token',
    handle: { port: 59001, token: 'cloud-code-proxy-token', close: vi.fn() },
  }),
}));

vi.mock('../src/provider-catalog.js', () => ({
  fetchProviderCatalog: mocks.fetchProviderCatalog,
  providersForPicker: mocks.providersForPicker,
  resolveLocalProviderApiKey: mocks.resolveLocalProviderApiKey,
}));

vi.mock('../src/config.js', () => ({
  loadPreferences: mocks.loadPreferences,
  recordLaunchSelection: mocks.recordLaunchSelection,
}));

vi.mock('../src/codex/launch.js', () => ({
  findCodexBinary: vi.fn(() => '/usr/local/bin/codex'),
  buildCodexChildEnv: vi.fn(() => ({})),
  launchCodex: mocks.launchCodex,
}));

vi.mock('../src/codex-proxy.js', () => ({
  startCodexProxy: mocks.startCodexProxy,
}));

vi.mock('../src/server/vertex-config.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/server/vertex-config.js')>();
  return {
    ...actual,
    hasApplicationDefaultCredentials: vi.fn(() => true),
    buildVertexRuntimeConfig: vi.fn(() => ({
      project: 'test-project',
      location: 'global',
      models: [{ id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6' }],
    })),
  };
});

vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), step: vi.fn(), success: vi.fn() },
  select: vi.fn(),
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
}));

import { runCodexCommand } from '../src/codex.js';

const cloudCodeModel: LocalProviderModel = {
  id: 'gemini-3.5-flash-low',
  name: 'Gemini Flash',
  family: 'gemini',
  brand: 'Google',
  modelFormat: 'cloud-code',
  upstreamModelId: 'gemini-3.5-flash-low',
  contextWindow: 200000,
};

const anthropicOAuthModel: LocalProviderModel = {
  id: 'claude-sonnet-4-6',
  name: 'Claude Sonnet',
  family: 'claude',
  brand: 'Anthropic',
  modelFormat: 'anthropic',
  upstreamModelId: 'claude-sonnet-4-6',
  baseUrl: 'https://api.anthropic.com',
  contextWindow: 200000,
};

const openAiModel: LocalProviderModel = {
  id: 'gpt-5.5',
  name: 'GPT 5.5',
  family: 'gpt',
  brand: 'OpenAI',
  modelFormat: 'openai',
  upstreamModelId: 'gpt-5.5',
  npm: '@ai-sdk/openai',
};

const antigravityProvider: LocalProvider = {
  id: 'antigravity',
  name: 'Cloud Code Assist',
  apiKey: 'oauth-token',
  authType: 'oauth',
  models: [cloudCodeModel],
  providerData: { projectId: 'proj-xyz' },
};

const claudeCodeProvider: LocalProvider = {
  id: 'claude-code',
  name: 'Claude Code OAuth',
  apiKey: 'claude-token',
  authType: 'oauth',
  oauthAccountId: 'acct-1',
  models: [anthropicOAuthModel],
  providerData: { cliUserID: 'device-1' },
};

const openAiProvider: LocalProvider = {
  id: 'openai',
  name: 'OpenAI',
  apiKey: 'openai-token',
  authType: 'api',
  models: [openAiModel],
};

describe('runCodexCommand vertex', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recoverInterruptedCodexSession.mockReturnValue({ recovered: false });
    mocks.remainingOverlayPaths.mockReturnValue([]);
    mocks.launchCodex.mockResolvedValue(0);
    mocks.startCodexProxy.mockResolvedValue({ port: 61234, close: vi.fn() });
    mocks.fetchProviderCatalog.mockResolvedValue([antigravityProvider, claudeCodeProvider, openAiProvider]);
    mocks.loadPreferences.mockReturnValue({ favoriteModels: [] });
  });

  it('rejects vertex launch when a concurrent Codex session lock exists', async () => {
    mocks.checkSessionLock.mockReturnValue({
      ok: false,
      reason: 'concurrent',
      lock: { pid: 1234, startedAt: new Date().toISOString(), profilePath: '/tmp/x', catalogPaths: [] },
    });

    const code = await runCodexCommand([], false, { vertex: true });

    expect(code).toBe(1);
    expect(mocks.startCodexProxy).not.toHaveBeenCalled();
  });

  it('restores vertex overlay files after Codex exits', async () => {
    mocks.checkSessionLock.mockReturnValue({ ok: true });

    const code = await runCodexCommand([], false, { vertex: true });

    expect(code).toBe(0);
    expect(mocks.launchCodex).toHaveBeenCalled();
    expect(mocks.restoreCodexOverlay).toHaveBeenCalled();
  });
});

describe('resolveCodexRoute cloud-code tier', () => {
  it('returns tier cloud-code for cloud-code modelFormat', () => {
    const route = resolveCodexRoute(antigravityProvider, cloudCodeModel, 'oauth-token');
    expect(route.tier).toBe('cloud-code');
  });

  it('preserves provider and auth metadata in the route', () => {
    const route = resolveCodexRoute(antigravityProvider, cloudCodeModel, 'oauth-token');
    expect(route.providerId).toBe('antigravity');
    expect(route.authType).toBe('oauth');
    expect(route.modelId).toBe('gemini-3.5-flash-low');
  });
});

describe('Codex CLI cloud-code single-model path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkSessionLock.mockReturnValue({ ok: true });
    mocks.recoverInterruptedCodexSession.mockReturnValue({ recovered: false });
    mocks.remainingOverlayPaths.mockReturnValue([]);
    mocks.launchCodex.mockResolvedValue(0);
    mocks.startCodexProxy.mockResolvedValue({ port: 61234, close: vi.fn() });
    mocks.fetchProviderCatalog.mockResolvedValue([antigravityProvider, claudeCodeProvider, openAiProvider]);
    mocks.loadPreferences.mockReturnValue({ favoriteModels: [] });
  });

  it('uses the shared single-model backend helper for cloud-code launches', async () => {
    const code = await runCodexCommand([], false, {
      launchProvider: 'antigravity',
      launchModel: 'gemini-3.5-flash-low',
    });

    expect(code).toBe(0);
    expect(mocks.buildSingleModelCloudCodeRoute).toHaveBeenCalledWith(
      cloudCodeModel,
      'oauth-token',
      'antigravity',
      { projectId: 'proj-xyz' },
      false,
    );
    expect(mocks.startCodexProxy).toHaveBeenCalledWith(
      [expect.objectContaining({
        modelId: 'anthropic-antigravity__gemini-3.5-flash-low',
        npm: '@ai-sdk/anthropic',
        apiKey: 'cloud-code-proxy-token',
        baseURL: 'http://127.0.0.1:59001',
        upstreamModelId: 'anthropic-antigravity__gemini-3.5-flash-low',
        providerId: 'antigravity',
        authType: 'oauth',
      })],
      { debug: false },
    );
  });

  it('uses the shared partition helper for backend-routed favorites', async () => {
    mocks.loadPreferences.mockReturnValue({
      lastCodexProvider: 'openai',
      lastCodexModel: 'gpt-5.5',
      favoriteModels: [
        { providerId: 'antigravity', modelId: 'gemini-3.5-flash-low' },
        { providerId: 'claude-code', modelId: 'claude-sonnet-4-6' },
      ],
    });

    const code = await runCodexCommand(['--config'], false);

    expect(code).toBe(0);
    expect(mocks.partitionAndStartCloudCodeBackend).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ providerId: 'antigravity', model: cloudCodeModel, apiKey: 'oauth-token' }),
        expect.objectContaining({ providerId: 'claude-code', model: anthropicOAuthModel, apiKey: 'claude-token' }),
      ]),
      expect.any(Function),
      false,
    );
    expect(mocks.startCodexProxy).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          modelId: 'anthropic-antigravity__gemini-3.5-flash-low',
          npm: '@ai-sdk/anthropic',
          apiKey: 'cloud-code-proxy-token',
        }),
        expect.objectContaining({
          modelId: 'anthropic-claude-code__claude-sonnet-4-6',
          npm: '@ai-sdk/anthropic',
          apiKey: 'cloud-code-proxy-token',
        }),
      ]),
      { requireAuth: true, debug: false },
    );
  });
});
