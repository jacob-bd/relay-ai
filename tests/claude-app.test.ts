import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { LocalProvider, LocalProviderModel } from '../src/types.js';

const state = vi.hoisted(() => ({
  providers: [] as LocalProvider[],
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
  recoverSession: vi.fn(() => ({ recovered: true, message: 'Restored Claude Desktop relay-ai config.' })),
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
  loadPreferences: vi.fn(() => ({ favoriteModels: [] })),
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
};

const helperProvider: LocalProvider = {
  id: 'openai-oauth',
  name: 'OpenAI (ChatGPT)',
  apiKey: 'oauth-token',
  authType: 'oauth',
  oauthAccountId: 'account-123',
  headers: { 'x-provider-plan': 'plus' },
  models: [helperModel],
};

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
      supportedParameters: helperModel.supportedParameters,
      reasoning: true,
      interleavedReasoningField: 'reasoning_content',
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

  it('exits 1 and leaves config alone when --restore finds another live session', async () => {
    vi.mocked(recoverSession).mockReturnValueOnce({
      recovered: false,
      liveSession: true,
      message: 'Another relay-ai claude-app session is running (pid 4242). Ctrl+C it first, then run --restore.',
    });

    const code = await runClaudeAppCommand(['--restore']);

    expect(code).toBe(1);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Another relay-ai claude-app session is running'));
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
});
