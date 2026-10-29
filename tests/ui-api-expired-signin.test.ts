import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockRequest, createMockResponse } from './helpers/ui-api-test-utils.js';

const state = vi.hoisted(() => ({
  catalog: [] as any[],
  registry: { schemaVersion: 1, providers: [] as any[] },
  credential: vi.fn(),
}));

vi.mock('../src/provider-catalog.js', () => ({ fetchProviderCatalog: vi.fn(async () => state.catalog) }));
vi.mock('../src/registry/io.js', () => ({ loadRegistry: vi.fn(() => state.registry) }));
vi.mock('../src/env.js', () => ({
  resolveProviderCredential: state.credential,
  readStoredOAuthCredential: vi.fn(async () => undefined),
  saveProviderCredential: vi.fn(async () => true),
}));

async function models() {
  const { handleUiApiRequest } = await import('../src/ui/api.js');
  const response = createMockResponse();
  handleUiApiRequest(createMockRequest('GET', '/api/models'), response.res);
  await vi.waitFor(() => expect(response.result.data).not.toBe(''));
  return Object.fromEntries((JSON.parse(response.result.data).providers as any[]).map(p => [p.id, p]));
}

const entry = (id: string, templateId: string, over: Record<string, unknown> = {}) => ({
  id, templateId, name: `Name of ${id}`, enabled: true, authType: 'oauth', authRef: `keyring:oauth:provider:${id}`, api: {},
  modelsCache: {
    fetchedAt: '2026-01-01T00:00:00.000Z',
    models: Array.from({ length: 14 }, (_, i) => ({ id: `m${i}`, name: `M${i}`, upstreamModelId: `m${i}`, modelFormat: 'openai' })),
  },
  ...over,
});

describe('UI: OAuth accounts whose sign-in can no longer be used', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.catalog = [];
    state.registry = { schemaVersion: 1, providers: [] };
    state.credential.mockImplementation(async () => 'token');
  });

  it('keeps an expired account on the page, flagged, instead of hiding it', async () => {
    state.registry.providers = [entry('claude-code', 'claude-code')];
    state.credential.mockRejectedValue(new Error('Claude Code token refresh failed: this sign-in is no longer valid. Sign in again: relay-ai providers auth claude-code'));

    const card = (await models())['claude-code'];

    expect(card).toMatchObject({
      id: 'claude-code',
      hasKey: false,
      needsSignIn: true,
      modelCount: 14,
      authType: 'oauth',
    });
    expect(card.signInIssue).toContain('no longer valid');
    // The card has its own "Sign in again" button; the terminal command in the message is not repeated.
    expect(card.signInIssue).not.toContain('relay-ai providers auth');
  });

  it('does the same for a numbered account', async () => {
    state.registry.providers = [entry('openai-oauth-2', 'openai')];
    state.credential.mockRejectedValue(new Error('OpenAI token refresh failed (400): this sign-in is no longer valid'));
    expect((await models())['openai-oauth-2']).toMatchObject({ needsSignIn: true, hasKey: false });
  });

  it('does not flag a healthy account that simply has no models yet', async () => {
    state.registry.providers = [entry('openai-oauth', 'openai', { modelsCache: { fetchedAt: 'x', models: [] } })];
    const card = (await models())['openai-oauth'];
    expect(card).toMatchObject({ hasKey: true });
    expect(card.needsSignIn).toBeUndefined();
  });

  it('still leaves out a disabled account and one that has no stored sign-in at all', async () => {
    state.registry.providers = [entry('xai-oauth', 'xai', { enabled: false }), entry('cline-pass', 'cline-pass')];
    state.credential.mockImplementation(async (id: string) => {
      if (id === 'xai-oauth') throw new Error('expired');
      return null;   // nothing stored
    });
    const byId = await models();
    expect(byId['xai-oauth']).toBeUndefined();
    expect(byId['cline-pass']).toBeUndefined();
  });

  it('never puts more than a short, token-free reason in the response', async () => {
    state.registry.providers = [entry('claude-code', 'claude-code')];
    state.credential.mockRejectedValue(new Error('refresh failed: ' + 'x'.repeat(1000)));
    const card = (await models())['claude-code'];
    expect(card.signInIssue.length).toBeLessThanOrEqual(200);
  });
});
