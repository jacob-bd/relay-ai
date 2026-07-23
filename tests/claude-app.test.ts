import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { ServerModelInfo } from '../src/server/models.js';
import type { LocalProvider, LocalProviderModel, UserPreferences } from '../src/types.js';

const state = vi.hoisted(() => ({
  providers: [] as LocalProvider[],
  preferences: { favoriteModels: [] } as UserPreferences,
  startServerOptions: null as any,
}));

vi.mock('@clack/prompts', () => ({
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
  })),
  log: {
    error: vi.fn(),
    warn: vi.fn(),
  },
  confirm: vi.fn(async () => false),
  isCancel: vi.fn(() => false),
}));
vi.mock('../src/claude-desktop/app-session.js', () => ({
  readSessionLock: vi.fn(),
  recoverSession: vi.fn(),
  hasStaleSession: vi.fn(() => false),
  writeSessionLock: vi.fn(),
  setupExitCleanup: vi.fn(),
  cleanupSession: vi.fn(),
  backupMetaJson: vi.fn(),
  isConcurrentLiveSession: vi.fn(() => false),
  waitForShutdown: vi.fn(),
}));
vi.mock('../src/claude-desktop/app-launch.js', () => ({
  launchOrRestartClaudeApp: vi.fn(),
  claudeAppSupported: vi.fn(),
  isClaudeAppRunning: vi.fn(() => false),
  quitClaudeAppGracefully: vi.fn(),
}));
vi.mock('../src/claude-desktop/app-config.js', () => ({
  writeRelayAiConfig: vi.fn(() => 'test-session-uuid'),
  getClaudeDesktopHome: vi.fn(() => '/tmp/relay-ai-test-claude-home'),
}));
vi.mock('../src/registry/load.js', () => ({
  loadRegistryProviders: vi.fn(async () => state.providers),
}));
vi.mock('../src/registry/io.js', () => ({
  loadRegistry: vi.fn(() => ({ schemaVersion: 1, providers: [] })),
}));
vi.mock('../src/config.js', () => ({
  loadPreferences: vi.fn(() => state.preferences),
  savePreferences: vi.fn(),
}));
vi.mock('../src/env.js', () => ({
  resolveProviderCredential: vi.fn(async () => 'resolved-token'),
  resolveApiKey: vi.fn(() => 'resolved-token'),
  readFromCredentialStore: vi.fn(async () => null),
}));
vi.mock('../src/server/router.js', () => ({
  startServer: vi.fn(async (options: any) => {
    state.startServerOptions = options;
    return {
      host: options.host,
      port: 17646,
      url: `http://${options.host}:17646`,
      close: vi.fn(async () => undefined),
    };
  }),
}));

import { recoverSession } from '../src/claude-desktop/app-session.js';
import { modelToServerModelInfo, runClaudeAppCommand } from '../src/claude-app.js';

const helperModel: LocalProviderModel = {
  id: 'gpt-5.5',
  name: 'GPT-5.5',
  family: 'gpt-5',
  brand: 'OpenAI',
  modelFormat: 'openai',
  upstreamModelId: 'gpt-5.5',
  npm: '@ai-sdk/openai',
  apiBaseUrl: 'https://api.openai.com/v1',
  contextWindow: 400_000,
  supportedParameters: ['reasoning_effort'],
  reasoning: true,
  interleavedReasoningField: 'reasoning_content',
  useResponsesLite: true,
  preferWebSockets: true,
};

const helperProvider: LocalProvider = {
  id: 'openai-oauth',
  name: 'OpenAI (ChatGPT)',
  apiKey: 'oauth-token',
  authType: 'oauth',
  oauthAccountId: 'account-123',
  headers: { 'x-provider-plan': 'plus' },
  providerData: { accountUuid: 'account-uuid-123' },
  models: [helperModel],
};

function appModel(id: string): LocalProviderModel {
  return {
    id,
    name: id,
    family: 'test',
    brand: 'Test',
    modelFormat: 'openai',
    upstreamModelId: id,
    npm: '@ai-sdk/openai-compatible',
    apiBaseUrl: 'https://example.test/v1',
  };
}

function appProvider(id: string, models: LocalProviderModel[]): LocalProvider {
  return {
    id,
    name: id,
    apiKey: `${id}-key`,
    authType: 'api',
    models,
  };
}

describe('modelToServerModelInfo', () => {
  it('builds regular ServerModelInfo with auth and model metadata', () => {
    const info = modelToServerModelInfo(helperModel, helperProvider);

    expect(info).toMatchObject({
      id: helperModel.id,
      providerId: helperProvider.id,
      apiKey: helperProvider.apiKey,
      authType: helperProvider.authType,
      oauthAccountId: helperProvider.oauthAccountId,
      headers: helperProvider.headers,
      providerData: helperProvider.providerData,
      supportedParameters: helperModel.supportedParameters,
      reasoning: true,
      interleavedReasoningField: 'reasoning_content',
      useResponsesLite: true,
      preferWebSockets: true,
    });
  });

  it('allows cloud-code backend overrides without dropping context metadata', () => {
    const info = modelToServerModelInfo(helperModel, helperProvider, {
      modelFormat: 'anthropic',
      baseUrl: 'http://127.0.0.1:9999',
      apiKey: 'backend-token',
      completionsUrl: undefined,
      npm: undefined,
      apiBaseUrl: undefined,
    });

    expect(info).toMatchObject({
      modelFormat: 'anthropic',
      apiKey: 'backend-token',
      contextWindow: helperModel.contextWindow,
    });
  });
});

describe('runClaudeAppCommand', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  const originalIsTTY = process.stdin.isTTY;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    state.providers = [];
    state.preferences = { favoriteModels: [] };
    state.startServerOptions = null;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
  });

  afterEach(() => {
    logSpy.mockRestore();
    vi.clearAllMocks();
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
  });

  it('restores Claude Desktop config without requiring a TTY', async () => {
    const code = await runClaudeAppCommand(['--restore']);

    expect(code).toBe(0);
    expect(recoverSession).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Restored'));
  });

  it('preserves OAuth and model metadata for direct single-model launches', async () => {
    state.providers = [{
      id: 'openai-oauth',
      name: 'OpenAI (ChatGPT)',
      apiKey: 'oauth-token',
      authType: 'oauth',
      oauthAccountId: 'account-123',
      headers: { 'x-provider-plan': 'plus' },
      models: [{
        id: 'gpt-5.5',
        name: 'GPT-5.5',
        family: 'gpt-5',
        brand: 'OpenAI',
        modelFormat: 'openai',
        upstreamModelId: 'gpt-5.5',
        npm: '@ai-sdk/openai',
        apiBaseUrl: 'https://api.openai.com/v1',
        contextWindow: 400_000,
        supportedParameters: ['reasoning_effort'],
        reasoning: true,
        interleavedReasoningField: 'reasoning_content',
      }],
    }];

    const code = await runClaudeAppCommand([], {
      launchProvider: 'openai-oauth',
      launchModel: 'gpt-5.5',
    });

    expect(code).toBe(0);
    const [model] = state.startServerOptions.catalog.list();
    expect(model).toMatchObject({
      id: 'gpt-5.5',
      providerId: 'openai-oauth',
      authType: 'oauth',
      oauthAccountId: 'account-123',
      supportedParameters: ['reasoning_effort'],
      reasoning: true,
      interleavedReasoningField: 'reasoning_content',
      headers: { 'x-provider-plan': 'plus' },
    });
  });

  it('exposes the selected model followed by saved favorites', async () => {
    const selected = appProvider('selected', [appModel('selected-model')]);
    const favorite = appProvider('favorite', [appModel('favorite-model')]);
    state.providers = [selected, favorite];
    state.preferences = {
      favoriteModels: [{ providerId: favorite.id, modelId: favorite.models[0]!.id }],
    };

    const code = await runClaudeAppCommand([], {
      launchProvider: selected.id,
      launchModel: selected.models[0]!.id,
    });

    expect(code).toBe(0);
    expect(state.startServerOptions.catalog.list().map((model: ServerModelInfo) =>
      `${model.providerId}/${model.id}`,
    )).toEqual([
      'selected/selected-model',
      'favorite/favorite-model',
    ]);
  });

  it('does not duplicate the selected model when it is saved as a favorite', async () => {
    const selected = appProvider('selected', [appModel('selected-model')]);
    state.providers = [selected];
    state.preferences = {
      favoriteModels: [{ providerId: selected.id, modelId: selected.models[0]!.id }],
    };

    const code = await runClaudeAppCommand([], {
      launchProvider: selected.id,
      launchModel: selected.models[0]!.id,
    });

    expect(code).toBe(0);
    expect(state.startServerOptions.catalog.list()).toHaveLength(1);
  });

  it('caps the catalog at 20 models including the selected model', async () => {
    const selectedModel = appModel('selected-model');
    const favoriteModels = Array.from({ length: 20 }, (_, index) => appModel(`favorite-${index}`));
    const selected = appProvider('selected', [selectedModel, ...favoriteModels]);
    state.providers = [selected];
    state.preferences = {
      favoriteModels: favoriteModels.map(model => ({
        providerId: selected.id,
        modelId: model.id,
      })),
    };

    const code = await runClaudeAppCommand([], {
      launchProvider: selected.id,
      launchModel: selectedModel.id,
    });

    expect(code).toBe(0);
    const catalog = state.startServerOptions.catalog.list() as ServerModelInfo[];
    expect(catalog).toHaveLength(20);
    expect(catalog[0]?.id).toBe(selectedModel.id);
    expect(catalog.at(-1)?.id).toBe('favorite-18');
  });
});
