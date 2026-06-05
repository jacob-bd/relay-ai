import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelInfo } from '../src/types.js';

const state = vi.hoisted(() => ({
  apiKey: 'real-key',
  tier: 'zen' as 'free' | 'zen' | 'go' | 'both' | null,
  cachedModels: null as ModelInfo[] | null,
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
  getCachedModels: () => state.cachedModels,
  getSavedServerPassword: () => state.savedPassword,
  getSubscriptionTier: () => state.tier,
  setCachedModels: vi.fn(),
  setSavedServerPassword: (password: string) => {
    state.savedPassword = password;
  },
}));

vi.mock('../src/models.js', () => ({
  getModels: vi.fn(async () => ({ models, fromCache: false })),
}));

vi.mock('../src/server/prompts.js', () => ({
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
    state.tier = 'zen';
    state.cachedModels = null;
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
