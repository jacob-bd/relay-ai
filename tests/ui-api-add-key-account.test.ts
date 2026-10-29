import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockRequest, createMockResponse } from './helpers/ui-api-test-utils.js';

const state = vi.hoisted(() => ({
  catalog: [] as any[],
  registry: { schemaVersion: 1, providers: [] as any[] },
  add: vi.fn(),
}));

vi.mock('../src/provider-catalog.js', () => ({ fetchProviderCatalog: vi.fn(async () => state.catalog) }));
vi.mock('../src/registry/io.js', () => ({ loadRegistry: vi.fn(() => state.registry) }));
vi.mock('../src/registry/add-template.js', () => ({ addProviderFromTemplate: state.add }));

async function call(method: string, url: string, body?: unknown) {
  const { handleUiApiRequest } = await import('../src/ui/api.js');
  const req = createMockRequest(method, url, body === undefined ? undefined : JSON.stringify(body));
  const response = createMockResponse();
  handleUiApiRequest(req, response.res);
  await vi.waitFor(() => expect(response.result.data).not.toBe(''));
  return { code: response.result.code, body: JSON.parse(response.result.data) };
}

const model = { id: 'm', name: 'M', brand: 'X', family: 'x', modelFormat: 'openai', upstreamModelId: 'm' };
const regEntry = (id: string, templateId: string, authType = 'api') => ({
  id, templateId, name: id, enabled: true, authType, authRef: `keyring:provider:${id}`, api: {}, modelsCache: { fetchedAt: 'x', models: [{}] },
});

describe('UI: adding a second API-key account', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.catalog = [];
    state.registry = { schemaVersion: 1, providers: [] };
    state.add.mockResolvedValue({ added: true, modelCount: 4, provider: { name: 'Groq 2' } });
  });

  it('adds another account and reports the new (numbered) name', async () => {
    const result = await call('POST', '/api/providers/add', { templateId: 'groq', key: 'second-key', addAccount: true });

    expect(result.body).toMatchObject({ ok: true, name: 'Groq 2', count: 4 });
    expect(state.add).toHaveBeenCalledWith(expect.objectContaining({ id: 'groq' }), 'second-key', expect.objectContaining({ addAccount: true }));
  });

  it('a normal add does not ask for a second account', async () => {
    await call('POST', '/api/providers/add', { templateId: 'groq', key: 'k' });
    expect(state.add.mock.calls[0]?.[2]).not.toHaveProperty('addAccount');
  });

  it('refuses a second account for providers that cannot have one', async () => {
    const result = await call('POST', '/api/providers/add', { templateId: 'opencode-cloud', key: 'k', addAccount: true });
    expect(result.code).toBe(400);
    expect(result.body.error).toMatch(/second account/i);
    expect(state.add).not.toHaveBeenCalled();
  });

  it('passes the refusal reason through (for example the same key twice)', async () => {
    state.add.mockResolvedValue({ added: false, error: 'This key is already saved as "Groq" for the same server.', hint: 'Add a different key.' });
    const result = await call('POST', '/api/providers/add', { templateId: 'groq', key: 'dup', addAccount: true });
    expect(result.body).toMatchObject({ ok: false, error: expect.stringContaining('already saved') });
  });

  it('flags which API-key cards can add another account (key-only providers, numbered ones included)', async () => {
    state.registry.providers = [
      regEntry('groq', 'groq'), regEntry('groq-2', 'groq'), regEntry('zen', 'zen'),
      regEntry('custom-acme', 'custom-openai'), regEntry('openai-oauth', 'openai', 'oauth'),
      regEntry('cloudflare', 'cloudflare'),
    ];
    state.catalog = state.registry.providers.map(rp => ({ id: rp.id, name: rp.name, authType: rp.authType, apiKey: 'k', models: [model] }));

    const byId = Object.fromEntries((await call('GET', '/api/models')).body.providers.map((p: any) => [p.id, p]));

    expect(byId['groq']).toMatchObject({ canAddKeyAccount: true, templateId: 'groq' });
    expect(byId['groq-2']).toMatchObject({ canAddKeyAccount: true, templateId: 'groq' });
    for (const id of ['zen', 'custom-acme', 'openai-oauth', 'cloudflare']) {
      expect(byId[id].canAddKeyAccount, id).toBeUndefined();   // cloudflare needs an account id: terminal only
    }
  });
});
