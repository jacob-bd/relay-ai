import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockRequest, createMockResponse } from './helpers/ui-api-test-utils.js';

const mocks = vi.hoisted(() => ({
  add: vi.fn(), remove: vi.fn(),
  catalog: [] as any[], registry: { schemaVersion: 1, providers: [] as any[] },
}));
vi.mock('../src/registry/manual-models.js', () => ({ addManualModel: mocks.add, removeManualModel: mocks.remove }));
vi.mock('../src/provider-catalog.js', () => ({ fetchProviderCatalog: vi.fn(async () => mocks.catalog) }));
vi.mock('../src/registry/io.js', () => ({ loadRegistry: vi.fn(() => mocks.registry) }));
vi.mock('../src/env.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/env.js')>(),
  resolveProviderCredential: vi.fn(async () => 'private-provider-key'),
}));

async function call(path: string, body?: unknown, raw?: string) {
  const { handleUiApiRequest } = await import('../src/ui/api.js');
  const response = createMockResponse();
  handleUiApiRequest(createMockRequest(path === '/api/models' ? 'GET' : 'POST', path,
    raw ?? (body === undefined ? undefined : JSON.stringify(body))), response.res, { uiMode: 'server' });
  await vi.waitFor(() => expect(response.result.data).not.toBe(''));
  return { code: response.result.code, body: JSON.parse(response.result.data), raw: response.result.data };
}

const manual = {
  id: 'test-model', name: 'Test model', upstreamModelId: 'test-model',
  modelFormat: 'openai', source: 'manual', validatedAt: '2026-09-08T12:00:00.000Z', contextWindow: 128000,
};
const provider = (overrides = {}) => ({
  id: 'custom-test', templateId: 'custom-openai', name: 'Test provider', enabled: true,
  authType: 'api', authRef: 'keyring:provider:custom-test',
  api: { npm: '@ai-sdk/openai-compatible', url: 'https://example.com/v1' },
  addedAt: '2026-09-08T00:00:00.000Z', ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.catalog = [];
  mocks.registry = { schemaVersion: 1, providers: [] };
  mocks.add.mockResolvedValue({ ok: true, model: manual });
  mocks.remove.mockReturnValue({ ok: true });
});

describe.each(['add', 'remove'])('POST /api/providers/models/%s', action => {
  const path = `/api/providers/models/${action}`;
  it.each([null, [], 'text', 3, {}, { providerId: 'p' }, { modelId: 'm' },
    { providerId: 3, modelId: 'm' }, { providerId: 'p', modelId: [] },
    { providerId: ' ', modelId: 'm' }, { providerId: 'p', modelId: ' ' }])('rejects invalid body %j', async body => {
    const result = await call(path, body);
    expect(result.code).toBe(400);
    expect(result.body.ok).toBe(false);
    expect(mocks.add).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('rejects malformed JSON', async () => {
    expect((await call(path, undefined, '{broken')).code).toBe(400);
  });
  it('returns backend refusals without claiming success', async () => {
    const result = { ok: false, error: 'Provider does not support manual models.' };
    mocks.add.mockResolvedValue(result);
    mocks.remove.mockReturnValue(result);
    expect((await call(path, { providerId: 'p', modelId: 'm' })).body).toEqual(result);
  });
  it('does not expose credentials from unexpected errors', async () => {
    mocks.add.mockRejectedValue(new Error('private-provider-key'));
    mocks.remove.mockImplementation(() => { throw new Error('private-provider-key'); });
    const result = await call(path, { providerId: 'p', modelId: 'm' });
    expect(result.code).toBe(500);
    expect(result.body.ok).toBe(false);
    expect(result.raw).not.toContain('private-provider-key');
  });
});

describe('manual model addition', () => {
  it.each([{ displayName: null }, { displayName: 4 }, { displayName: [] },
    { contextWindow: '128000' }, { contextWindow: null }, { contextWindow: 0 },
    { contextWindow: -1 }, { contextWindow: 1.5 }, { contextWindow: Number.MAX_SAFE_INTEGER + 1 }])(
    'validates optional fields %j', async fields => {
      expect((await call('/api/providers/models/add', { providerId: 'p', modelId: 'm', ...fields })).code).toBe(400);
      expect(mocks.add).not.toHaveBeenCalled();
    });
  it('trims fields, calls shared validation and only returns public model metadata', async () => {
    mocks.add.mockResolvedValue({ ok: true, model: { ...manual, apiKey: 'private-provider-key', api: { headers: { Authorization: 'secret' } } } });
    const result = await call('/api/providers/models/add', { providerId: ' p ', modelId: ' m ', displayName: ' Test ', contextWindow: 128000 });
    expect(mocks.add).toHaveBeenCalledExactlyOnceWith({ providerId: 'p', modelId: 'm', displayName: 'Test', contextWindow: 128000 });
    expect(result.code).toBe(200);
    expect(result.body).toEqual({ ok: true, model: {
      id: manual.id, name: manual.name, contextWindow: manual.contextWindow, validatedAt: manual.validatedAt, source: 'manual',
    } });
    expect(result.raw).not.toMatch(/private-provider-key|Authorization|secret/);
  });
  it('allows omitted optional values', async () => {
    await call('/api/providers/models/add', { providerId: 'p', modelId: 'm' });
    expect(mocks.add).toHaveBeenCalledExactlyOnceWith({ providerId: 'p', modelId: 'm' });
  });
  it('preserves validation failure details', async () => {
    mocks.add.mockResolvedValue({ ok: false, error: 'Tool-call validation failed.' });
    expect((await call('/api/providers/models/add', { providerId: 'p', modelId: 'm' })).body)
      .toEqual({ ok: false, error: 'Tool-call validation failed.' });
  });
  it('removes through the shared backend and omits unrelated backend data', async () => {
    mocks.remove.mockReturnValue({ ok: true, apiKey: 'private-provider-key' });
    const result = await call('/api/providers/models/remove', { providerId: ' p ', modelId: ' m ' });
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith('p', 'm');
    expect(result.body).toEqual({ ok: true });
  });
});

describe('GET /api/models manual metadata', () => {
  it('exposes enabled supported empty providers in server admin mode', async () => {
    mocks.registry.providers = [provider(), provider({ id: 'disabled', enabled: false }),
      provider({ id: 'google', api: { npm: '@ai-sdk/google' } }),
      provider({ id: 'unsupported-oauth', authType: 'oauth' })];
    const result = await call('/api/models');
    expect(result.code).toBe(200);
    expect(result.body.providers).toHaveLength(1);
    expect(result.body.providers[0]).toMatchObject({ id: 'custom-test', supportsManualModels: true, manualModels: [], modelCount: 0, models: [], hasKey: true });
    expect(result.raw).not.toMatch(/private-provider-key|authRef|keyring:/);
  });
  it('counts merged deduplicated models and exposes removable manual entries', async () => {
    mocks.registry.providers = [provider({
      modelsCache: { fetchedAt: manual.validatedAt, models: [{ ...manual, id: 'discovered', source: undefined }] },
      manualModels: [manual, { ...manual, id: 'discovered' }],
    })];
    mocks.catalog = [{ id: 'custom-test', name: 'Test provider', apiKey: 'private-provider-key', authType: 'api',
      models: [manual, { ...manual, id: 'discovered' }] }];
    const result = await call('/api/models');
    expect(result.body.providers).toHaveLength(1);
    expect(result.body.providers[0]).toMatchObject({ supportsManualModels: true, modelCount: 2,
      manualModels: [{ id: 'test-model', source: 'manual', validatedAt: manual.validatedAt }, { id: 'discovered' }],
      models: [{ id: 'test-model', source: 'manual' }, { id: 'discovered' }],
    });
    expect(result.raw).not.toMatch(/private-provider-key|authRef|keyring:/);
  });
});
