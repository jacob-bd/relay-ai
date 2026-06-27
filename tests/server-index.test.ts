import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelInfo } from '../src/types.js';
import type { ServerModelInfo } from '../src/server/models.js';

const state = vi.hoisted(() => ({
  apiKey: 'real-key',
  savedPassword: null as string | null,
  listenMode: 'local' as 'local' | 'network' | null,
  serverPassword: 'typed-password' as string | null,
  savedChoice: null as 'use-saved' | 'new-password' | null,
  savePassword: false as boolean | null,
  startServerOptions: null as any,
  close: vi.fn<() => Promise<void>>(async () => undefined),
}));

const models: ModelInfo[] = [{
  id: 'claude-test',
  name: 'Claude Test',
  isFree: false,
  brand: 'Claude',
  sourceBackend: 'zen',
  modelFormat: 'anthropic',
}];

vi.mock('../src/env.js', () => ({
  resolveApiKey: () => state.apiKey,
}));

vi.mock('../src/config.js', () => ({
  getSavedServerPassword: () => state.savedPassword,
  getServerExposedProviders: () => null,
  getServerMaskGatewayIds: () => true,
  getServerFavoritesOnly: () => false,
  loadPreferences: () => ({ favoriteModels: [] }),
  setSavedServerPassword: (password: string) => {
    state.savedPassword = password;
  },
  setServerExposedProviders: vi.fn(),
  setServerMaskGatewayIds: vi.fn(),
  setServerFavoritesOnly: vi.fn(),
}));

vi.mock('../src/models.js', () => ({
  getModels: vi.fn(async () => ({ models, fromCache: false })),
}));

// Registry-only — no opencode serve subprocess in server load path.
vi.mock('../src/registry/load.js', () => ({
  loadRegistryProviders: vi.fn(async () => []),
}));

vi.mock('../src/registry/io.js', () => ({
  loadRegistry: vi.fn(() => ({ schemaVersion: 1, providers: [] })),
}));

vi.mock('../src/server/prompts.js', () => ({
  askServerStartMode: async () => 'quick',
  askListenMode: async () => state.listenMode,
  askSaveServerPassword: async () => state.savePassword,
  askServerPassword: async () => state.serverPassword,
  askUseSavedServerPassword: async () => state.savedChoice,
}));

vi.mock('../src/server/router.js', () => ({
  startServer: vi.fn(async (options: any) => {
    state.startServerOptions = options;
    return {
      host: options.host,
      port: 17645,
      url: `http://${options.host}:17645`,
      close: state.close,
    };
  }),
}));

describe('runServerCommand', () => {
  beforeEach(() => {
    state.apiKey = 'real-key';
    state.savedPassword = null;
    state.listenMode = 'local';
    state.serverPassword = 'typed-password';
    state.savedChoice = null;
    state.savePassword = false;
    state.startServerOptions = null;
    state.close.mockClear();
  });

  it('starts local mode on 127.0.0.1 without server password auth', async () => {
    const { runServerCommand } = await import('../src/server/index.js');
    const result = runServerCommand();
    await vi.waitFor(() => expect(state.startServerOptions).not.toBeNull());
    process.emit('SIGINT');

    await expect(result).resolves.toBe(0);
    expect(state.startServerOptions).toMatchObject({
      host: '127.0.0.1',
      port: 17645,
      apiKey: 'real-key',
      serverPassword: null,
    });
    expect(state.close).toHaveBeenCalledOnce();
  });

  it('starts network mode on 0.0.0.0 and saves a typed password only when requested', async () => {
    state.listenMode = 'network';
    state.savePassword = true;

    const { runServerCommand } = await import('../src/server/index.js');
    const result = runServerCommand();
    await vi.waitFor(() => expect(state.startServerOptions).not.toBeNull());
    process.emit('SIGTERM');

    await expect(result).resolves.toBe(0);
    expect(state.startServerOptions).toMatchObject({
      host: '0.0.0.0',
      serverPassword: 'typed-password',
    });
    expect(state.savedPassword).toBe('typed-password');
  });

  it('can reuse a saved server password without prompting to save it again', async () => {
    state.listenMode = 'network';
    state.savedPassword = 'saved-password';
    state.savedChoice = 'use-saved';

    const { runServerCommand } = await import('../src/server/index.js');
    const result = runServerCommand();
    await vi.waitFor(() => expect(state.startServerOptions).not.toBeNull());
    process.emit('SIGINT');

    await expect(result).resolves.toBe(0);
    expect(state.startServerOptions).toMatchObject({
      host: '0.0.0.0',
      serverPassword: 'saved-password',
    });
    expect(state.savedPassword).toBe('saved-password');
  });
});

describe('formatModelCatalogLines', () => {
  it('formats models as compact one-line rows and hides exact duplicate rows', async () => {
    const { formatModelCatalogLines } = await import('../src/server/index.js');
    const catalogModels: ServerModelInfo[] = [
      {
        id: 'deepseek-v4-flash',
        name: 'DeepSeek V4 Flash',
        isFree: false,
        brand: 'DeepSeek',
        sourceBackend: 'go',
        modelFormat: 'openai',
      },
      {
        id: 'deepseek-v4-flash',
        name: 'DeepSeek V4 Flash',
        isFree: false,
        brand: 'DeepSeek',
        sourceBackend: 'go',
        modelFormat: 'openai',
      },
      {
        id: 'glm-5.2',
        name: 'GLM-5.2',
        isFree: false,
        brand: 'GLM',
        sourceBackend: 'go',
        modelFormat: 'openai',
      },
    ];

    const lines = formatModelCatalogLines(catalogModels);

    expect(lines).toContain('  OpenCode Go (2, 1 duplicate hidden)');
    expect(lines.some(line => line.includes('#') && line.includes('Model') && line.includes('Anthropic ID') && line.includes('OpenAI ID'))).toBe(true);
    expect(lines.some(line => line.includes('DeepSeek V4 Flash') && line.includes('anthropic-go__deepseek-v4-flash') && line.includes('deepseek-v4-flash'))).toBe(true);
    expect(lines.filter(line => line.includes('DeepSeek V4 Flash'))).toHaveLength(1);
  });
});
