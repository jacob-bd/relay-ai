import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../src/proxy.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/proxy.js')>();
  return {
    ...actual,
    startProxyCatalog: vi.fn().mockResolvedValue({ port: 49999, token: 'proxy-token-xyz', close: vi.fn() }),
  };
});

vi.mock('../src/env.js', () => ({
  resolveProviderCredential: vi.fn().mockResolvedValue('fresh-token'),
}));

vi.mock('../src/registry/import-build.js', () => ({
  oauthAuthRef: vi.fn((id: string) => `keyring:oauth:provider:${id}`),
}));

import {
  buildCloudCodeProxyRoute,
  buildSingleModelCloudCodeRoute,
  needsCloudCodeBackend,
  partitionAndStartCloudCodeBackend,
  startCloudCodeCatalogBackend,
} from '../src/cloud-code-backend.js';
import { startProxyCatalog } from '../src/proxy.js';
import type { LocalProviderModel } from '../src/types.js';

const model: LocalProviderModel = {
  id: 'gemini-3.5-flash-low',
  name: 'Gemini 3.5 Flash',
  family: 'gemini',
  brand: 'Google',
  modelFormat: 'cloud-code',
  upstreamModelId: 'gemini-3.5-flash-low',
  contextWindow: 200000,
};

const claudeModel: LocalProviderModel = {
  id: 'claude-sonnet-4-6',
  name: 'Claude Sonnet',
  family: 'claude',
  brand: 'Anthropic',
  modelFormat: 'cloud-code',
  upstreamModelId: 'claude-sonnet-4-6',
};

const anthropicOAuthModel: LocalProviderModel = {
  id: 'claude-opus-4-1',
  name: 'Claude Opus',
  family: 'claude',
  brand: 'Anthropic',
  modelFormat: 'anthropic',
  upstreamModelId: 'claude-opus-4-1',
  baseUrl: 'https://api.anthropic.com',
  contextWindow: 200000,
};

describe('needsCloudCodeBackend', () => {
  it('selects cloud-code models and OAuth Anthropic models only', () => {
    expect(needsCloudCodeBackend({ ...model, modelFormat: 'cloud-code' }, 'oauth')).toBe(true);
    expect(needsCloudCodeBackend({ ...anthropicOAuthModel, modelFormat: 'anthropic' }, 'oauth')).toBe(true);
    expect(needsCloudCodeBackend({ ...anthropicOAuthModel, modelFormat: 'anthropic' }, 'api')).toBe(false);
    expect(needsCloudCodeBackend({ ...model, modelFormat: 'openai' }, 'oauth')).toBe(false);
  });
});

describe('partitionAndStartCloudCodeBackend', () => {
  afterEach(() => vi.clearAllMocks());

  it('returns no backend when there are no backend items', async () => {
    const result = await partitionAndStartCloudCodeBackend([], () => 'unused', false);
    expect(result).toEqual({ backendItems: [], backend: null });
    expect(startProxyCatalog).not.toHaveBeenCalled();
  });

  it('partitions backend inputs through one catalog backend', async () => {
    const result = await partitionAndStartCloudCodeBackend([
      { providerId: 'antigravity', model, apiKey: 'agy-token', providerData: { projectId: 'proj-1' } },
      { providerId: 'claude-code', model: anthropicOAuthModel, apiKey: 'claude-token', providerData: { cliUserID: 'device-1' } },
    ], (proxyRoute, backend, original) => ({
      modelId: proxyRoute.aliasId,
      apiKey: backend.token,
      providerId: original.providerId,
      baseURL: `http://127.0.0.1:${backend.port}`,
    }), false);

    expect(startProxyCatalog).toHaveBeenCalledOnce();
    const [routes, startingAlias] = (startProxyCatalog as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(routes).toHaveLength(2);
    expect(routes[0]).toMatchObject({ providerId: 'antigravity', modelFormat: 'cloud-code' });
    expect(routes[1]).toMatchObject({ providerId: 'claude-code', modelFormat: 'anthropic' });
    expect(startingAlias).toBe(routes[0].aliasId);
    expect(result.backend).toMatchObject({ port: 49999, token: 'proxy-token-xyz' });
    expect(result.backendItems[0]).toMatchObject({
      apiKey: 'proxy-token-xyz',
      providerId: 'antigravity',
      baseURL: 'http://127.0.0.1:49999',
    });
  });
});

describe('buildSingleModelCloudCodeRoute', () => {
  afterEach(() => vi.clearAllMocks());

  it('starts a one-route backend for a cloud-code model', async () => {
    const result = await buildSingleModelCloudCodeRoute(model, 'tok', 'antigravity', { projectId: 'p' }, false);
    expect(startProxyCatalog).toHaveBeenCalledWith([result.proxyRoute], result.proxyRoute.aliasId, false);
    expect(result.proxyRoute).toMatchObject({ providerId: 'antigravity', modelFormat: 'cloud-code' });
    expect(result.backend).toMatchObject({ port: 49999, token: 'proxy-token-xyz' });
  });

  it('starts a one-route backend for an OAuth Anthropic model', async () => {
    const result = await buildSingleModelCloudCodeRoute(anthropicOAuthModel, 'tok', 'claude-code', { cliUserID: 'device-1' }, false);
    expect(startProxyCatalog).toHaveBeenCalledWith([result.proxyRoute], result.proxyRoute.aliasId, false);
    expect(result.proxyRoute).toMatchObject({ providerId: 'claude-code', modelFormat: 'anthropic' });
    expect(result.backend).toMatchObject({ port: 49999, token: 'proxy-token-xyz' });
  });
});

describe('buildCloudCodeProxyRoute', () => {
  afterEach(() => vi.clearAllMocks());

  it('sets modelFormat cloud-code and correct upstreamUrl', () => {
    const route = buildCloudCodeProxyRoute(model, 'token-abc', { projectId: 'proj-1' });
    expect(route.modelFormat).toBe('cloud-code');
    expect(route.upstreamUrl).toMatch(/googleapis\.com|cloudcode/);
    expect(route.apiKey).toBe('token-abc');
    expect(route.providerData).toEqual({ projectId: 'proj-1' });
    expect(route.providerId).toBe('antigravity');
    expect(route.authType).toBe('oauth');
  });

  it('aliases non-claude model ids with anthropic-antigravity__ prefix', () => {
    const route = buildCloudCodeProxyRoute(model, 'tok', {});
    expect(route.aliasId).toContain('antigravity');
    expect(route.aliasId).toContain('gemini-3.5-flash-low');
  });

  it('keeps claude-* model ids unchanged in aliasId', () => {
    const route = buildCloudCodeProxyRoute(claudeModel, 'tok', {});
    expect(route.aliasId).toMatch(/^claude-/);
  });

  it('sets realModelId from upstreamModelId', () => {
    const route = buildCloudCodeProxyRoute(model, 'tok', {});
    expect(route.realModelId).toBe('gemini-3.5-flash-low');
  });

  it('attaches a refreshToken callback', () => {
    const route = buildCloudCodeProxyRoute(model, 'tok', {});
    expect(typeof route.refreshToken).toBe('function');
  });
});

describe('startCloudCodeCatalogBackend', () => {
  afterEach(() => vi.clearAllMocks());

  it('passes routes directly to startProxyCatalog', async () => {
    const route = buildCloudCodeProxyRoute(model, 'tok', {});
    await startCloudCodeCatalogBackend([route], route.aliasId, false);
    expect(startProxyCatalog).toHaveBeenCalledWith([route], route.aliasId, false);
  });
});

describe('numbered accounts in the Cloud Code / OAuth routes', () => {
  it('a second Antigravity account gets its own alias, provider id and token refresh', async () => {
    const { resolveProviderCredential } = await import('../src/env.js');
    const first = buildCloudCodeProxyRoute(model, 'tok1', {});
    const second = buildCloudCodeProxyRoute(model, 'tok2', { projectId: 'p2' }, 'antigravity-2');

    expect(first.providerId).toBe('antigravity');
    expect(second.providerId).toBe('antigravity-2');
    expect(second.aliasId).not.toBe(first.aliasId);
    expect(second.aliasId).toContain('antigravity-2');

    vi.mocked(resolveProviderCredential).mockClear();
    await second.refreshToken?.();
    expect(resolveProviderCredential).toHaveBeenCalledWith('antigravity-2', 'keyring:oauth:provider:antigravity-2');
  });

  it('the first Antigravity account keeps exactly the alias it always had', () => {
    expect(buildCloudCodeProxyRoute(model, 'tok', {}).aliasId).toContain('anthropic-antigravity__');
  });
});
