import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as env from '../src/env.js';
import { handleUiApiRequest } from '../src/ui/api.js';
import { createMockRequest, createMockResponse } from './helpers/ui-api-test-utils.js';

const state = vi.hoisted(() => ({
  registry: {
    schemaVersion: 1,
    providers: [{
      id: 'go',
      templateId: 'go',
      name: 'OpenCode Go',
      enabled: true,
      authRef: 'keyring:global:opencode',
      authType: 'api',
      api: {},
      addedAt: '2026-08-10T00:00:00.000Z',
    }],
  },
}));

vi.mock('../src/registry/io.js', () => ({
  loadRegistry: vi.fn(() => state.registry),
}));

vi.mock('../src/registry/refresh-models.js', () => ({
  refreshProviderModels: vi.fn(async () => ({ ok: true, modelCount: 2 })),
  refreshAllProviderModels: vi.fn(),
}));

describe('provider credential API overrides', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses a typed key for model refresh instead of resolving env/keychain state', async () => {
    const resolve = vi.spyOn(env, 'resolveProviderCredential').mockResolvedValue('old-env-key');
    const response = createMockResponse();
    handleUiApiRequest(createMockRequest('POST', '/api/providers/refresh', JSON.stringify({
      providerId: 'go',
      key: 'typed-key',
    })), response.res);

    await vi.waitFor(() => expect(response.result.data).not.toBe(''));
    expect(response.result.code).toBe(200);
    expect(resolve).not.toHaveBeenCalled();
    const { refreshProviderModels } = await import('../src/registry/refresh-models.js');
    expect(refreshProviderModels).toHaveBeenCalledWith('go', 'typed-key', state.registry);
  });
});
