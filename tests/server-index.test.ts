import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelInfo } from '../src/types.js';
import type { ServerModelInfo } from '../src/server/models.js';

const originalStdinIsTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
const originalSetRawMode = Object.getOwnPropertyDescriptor(process.stdin, 'setRawMode');

const state = vi.hoisted(() => ({
  apiKey: 'real-key',
  savedPassword: null as string | null,
  listenMode: 'local' as 'local' | 'network' | null,
  savedListenMode: 'local' as 'local' | 'network',
  serverPassword: 'typed-password' as string | null,
  savedChoice: null as 'use-saved' | 'new-password' | null,
  savePassword: false as boolean | null,
  favoritesOnly: false,
  maskGatewayIds: true,
  startMode: 'quick' as 'configure' | 'quick' | null,
  startServerOptions: null as any,
  close: vi.fn<() => Promise<void>>(async () => undefined),
  askServerStartMode: vi.fn(async () => 'quick' as 'configure' | 'quick' | null),
  askFavoritesOnly: vi.fn(async () => false as boolean | null),
  askMaskGatewayIds: vi.fn(async () => true as boolean | null),
  askListenMode: vi.fn(async () => 'local' as 'local' | 'network' | null),
  askServerPassword: vi.fn(async () => 'typed-password' as string | null),
  askUseSavedServerPassword: vi.fn(async () => null as 'use-saved' | 'new-password' | null),
  askSaveServerPassword: vi.fn(async () => false as boolean | null),
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

vi.mock('../src/config.js', async () => {
  const actual = await vi.importActual<typeof import('../src/config.js')>('../src/config.js');
  return {
    ...actual,
    getSavedServerPassword: () => state.savedPassword,
    getServerExposedProviders: () => null,
    getServerMaskGatewayIds: () => true,
    getServerFavoritesOnly: () => false,
    getServerFreeModelsOnly: () => false,
    getServerListenMode: () => state.savedListenMode,
    loadPreferences: () => ({ favoriteModels: [] }),
    setSavedServerPassword: (password: string) => {
      state.savedPassword = password;
    },
    setServerExposedProviders: vi.fn(),
    setServerMaskGatewayIds: vi.fn(),
    setServerFavoritesOnly: vi.fn(),
    setServerFreeModelsOnly: vi.fn(),
    setServerListenMode: vi.fn((mode: 'local' | 'network') => {
      state.savedListenMode = mode;
    }),
  };
});

vi.mock('../src/models.js', () => ({
  getModels: vi.fn(async () => ({ models, fromCache: false })),
}));

vi.mock('../src/registry/load.js', () => ({
  loadRegistryProviders: vi.fn(async () => [
    {
      id: 'zen',
      name: 'OpenCode Zen',
      apiKey: 'real-key',
      models: [
        {
          id: 'claude-test',
          name: 'Claude Test',
          family: 'claude',
          brand: 'Claude',
          modelFormat: 'anthropic' as const,
          upstreamModelId: 'claude-test',
          baseUrl: 'https://api.anthropic.com',
          contextWindow: 200000,
        },
      ],
    },
  ]),
}));

vi.mock('../src/registry/io.js', () => ({
  loadRegistry: vi.fn(() => ({ schemaVersion: 1, providers: [] })),
}));

vi.mock('../src/registry/crud.js', () => ({
  ensureOpencodeCloudProviders: vi.fn(async () => ({ seeded: false, refreshed: [] })),
}));

vi.mock('../src/server/prompts.js', () => ({
  askServerStartMode: state.askServerStartMode,
  askFavoritesOnly: state.askFavoritesOnly,
  askFreeModelsOnly: async () => false,
  askMaskGatewayIds: state.askMaskGatewayIds,
  askListenMode: state.askListenMode,
  askSaveServerPassword: state.askSaveServerPassword,
  askServerPassword: state.askServerPassword,
  askUseSavedServerPassword: state.askUseSavedServerPassword,
}));

vi.mock('../src/server/provider-select.js', () => ({
  selectServerProviders: vi.fn(async () => []),
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
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdin, 'setRawMode', { value: vi.fn(), configurable: true });
    state.apiKey = 'real-key';
    state.savedPassword = null;
    state.listenMode = 'local';
    state.savedListenMode = 'local';
    state.serverPassword = 'typed-password';
    state.savedChoice = null;
    state.savePassword = false;
    state.favoritesOnly = false;
    state.maskGatewayIds = true;
    state.startMode = 'configure';
    state.startServerOptions = null;
    state.close.mockClear();
    state.askServerStartMode.mockClear();
    state.askServerStartMode.mockImplementation(async () => state.startMode);
    state.askFavoritesOnly.mockClear();
    state.askFavoritesOnly.mockImplementation(async () => state.favoritesOnly);
    state.askMaskGatewayIds.mockClear();
    state.askMaskGatewayIds.mockImplementation(async () => state.maskGatewayIds);
    state.askListenMode.mockClear();
    state.askListenMode.mockImplementation(async () => state.listenMode);
    state.askServerPassword.mockClear();
    state.askServerPassword.mockImplementation(async () => state.serverPassword);
    state.askUseSavedServerPassword.mockClear();
    state.askUseSavedServerPassword.mockImplementation(async () => state.savedChoice);
    state.askSaveServerPassword.mockClear();
    state.askSaveServerPassword.mockImplementation(async () => state.savePassword);
  });

  afterEach(() => {
    if (originalStdinIsTTY) {
      Object.defineProperty(process.stdin, 'isTTY', originalStdinIsTTY);
    } else {
      delete (process.stdin as typeof process.stdin & { isTTY?: boolean }).isTTY;
    }
    if (originalSetRawMode) {
      Object.defineProperty(process.stdin, 'setRawMode', originalSetRawMode);
    } else {
      delete (process.stdin as typeof process.stdin & { setRawMode?: (mode: boolean) => void }).setRawMode;
    }
  });

  it('starts local mode on 127.0.0.1 without server password auth', async () => {
    const { runServerCommand } = await import('../src/server/index.js');
    const result = runServerCommand();
    await vi.waitFor(() => expect(state.startServerOptions).not.toBeNull());
    process.emit('SIGTERM');

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
    process.emit('SIGTERM');

    await expect(result).resolves.toBe(0);
    expect(state.startServerOptions).toMatchObject({
      host: '0.0.0.0',
      serverPassword: 'saved-password',
    });
    expect(state.savedPassword).toBe('saved-password');
  });

  it('quick starts from saved settings without prompting for start mode or listen mode', async () => {
    state.savedListenMode = 'local';

    const { runServerCommand } = await import('../src/server/index.js');
    const result = runServerCommand({ quick: true } as any);
    await vi.waitFor(() => expect(state.startServerOptions).not.toBeNull());
    process.emit('SIGTERM');

    await expect(result).resolves.toBe(0);
    expect(state.askServerStartMode).not.toHaveBeenCalled();
    expect(state.askListenMode).not.toHaveBeenCalled();
    expect(state.startServerOptions).toMatchObject({
      host: '127.0.0.1',
      serverPassword: null,
    });
  });

  it('quick network launch can use a one-run password flag without password prompts', async () => {
    const { runServerCommand } = await import('../src/server/index.js');
    const result = runServerCommand({ quick: true, listenMode: 'network', password: 'one-run-secret' } as any);
    await vi.waitFor(() => expect(state.startServerOptions).not.toBeNull());
    process.emit('SIGTERM');

    await expect(result).resolves.toBe(0);
    expect(state.askServerStartMode).not.toHaveBeenCalled();
    expect(state.askListenMode).not.toHaveBeenCalled();
    expect(state.askServerPassword).not.toHaveBeenCalled();
    expect(state.askUseSavedServerPassword).not.toHaveBeenCalled();
    expect(state.startServerOptions).toMatchObject({
      host: '0.0.0.0',
      serverPassword: 'one-run-secret',
    });
  });

  it('quick network launch can use RELAY_AI_SERVER_PASSWORD without password prompts', async () => {
    const previous = process.env.RELAY_AI_SERVER_PASSWORD;
    process.env.RELAY_AI_SERVER_PASSWORD = 'env-secret';
    try {
      const { runServerCommand } = await import('../src/server/index.js');
      const result = runServerCommand({ quick: true, listenMode: 'network' } as any);
      await vi.waitFor(() => expect(state.startServerOptions).not.toBeNull());
      process.emit('SIGTERM');

      await expect(result).resolves.toBe(0);
      expect(state.askServerPassword).not.toHaveBeenCalled();
      expect(state.startServerOptions).toMatchObject({
        host: '0.0.0.0',
        serverPassword: 'env-secret',
      });
    } finally {
      if (previous === undefined) delete process.env.RELAY_AI_SERVER_PASSWORD;
      else process.env.RELAY_AI_SERVER_PASSWORD = previous;
    }
  });

  it('quick network launch fails clearly when no saved or one-run password is available', async () => {
    state.listenMode = 'network';
    state.savedPassword = null;
    state.serverPassword = null;

    const { runServerCommand } = await import('../src/server/index.js');
    const result = await runServerCommand({ quick: true, listenMode: 'network' } as any);

    expect(result).toBe(1);
    expect(state.askServerStartMode).not.toHaveBeenCalled();
    expect(state.askListenMode).not.toHaveBeenCalled();
    expect(state.askServerPassword).not.toHaveBeenCalled();
    expect(state.startServerOptions).toBeNull();
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

describe('resolveServerShutdownDecision', () => {
  it('keeps the server running when Ctrl+C prompt is declined', async () => {
    const { resolveServerShutdownDecision } = await import('../src/server/index.js');
    const decision = await resolveServerShutdownDecision('SIGINT', async () => false);
    expect(decision).toBe('keep');
  });

  it('closes the server when Ctrl+C prompt is accepted', async () => {
    const { resolveServerShutdownDecision } = await import('../src/server/index.js');
    const decision = await resolveServerShutdownDecision('SIGINT', async () => true);
    expect(decision).toBe('close');
  });

  it('closes the server on SIGTERM without prompting', async () => {
    let prompted = false;
    const { resolveServerShutdownDecision } = await import('../src/server/index.js');
    const decision = await resolveServerShutdownDecision('SIGTERM', async () => {
      prompted = true;
      return false;
    });
    expect(decision).toBe('close');
    expect(prompted).toBe(false);
  });
});
