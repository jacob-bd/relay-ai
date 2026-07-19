import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockRequest, createMockResponse } from './helpers/ui-api-test-utils.js';

const state = vi.hoisted(() => ({
  catalog: [] as any[],
  registry: { schemaVersion: 1, providers: [] as any[] },
}));

vi.mock('../src/provider-catalog.js', () => ({
  fetchProviderCatalog: vi.fn(async () => state.catalog),
}));

vi.mock('../src/registry/io.js', () => ({
  loadRegistry: vi.fn(() => state.registry),
}));

vi.mock('../src/env.js', () => ({
  resolveProviderCredential: vi.fn(async () => 'copilot-session'),
  saveProviderCredential: vi.fn(async () => true),
}));

vi.mock('../src/registry/provider-auth.js', () => ({
  saveNativeOAuthCredential: vi.fn(async () => true),
}));

vi.mock('../src/registry/refresh-models.js', () => ({
  refreshProviderModels: vi.fn(async () => ({ ok: true, modelCount: 1 })),
  refreshAllProviderModels: vi.fn(async () => ({ refreshed: [] })),
}));

vi.mock('../src/oauth/github.js', () => ({
  requestGithubDeviceCode: vi.fn(async () => ({
    device_code: 'device-secret',
    user_code: 'ABCD-1234',
    verification_uri: 'https://github.com/login/device',
  })),
  pollGithubDeviceCodeToken: vi.fn(() => new Promise(() => undefined)),
}));

vi.mock('../src/oauth/xai.js', () => ({
  requestXaiDeviceCode: vi.fn(),
  pollXaiDeviceCodeToken: vi.fn(),
}));

vi.mock('../src/oauth/openai.js', () => ({
  requestOpenAiDeviceCode: vi.fn(),
  pollOpenAiDeviceCodeToken: vi.fn(),
  openAiDeviceCodeUrl: vi.fn(),
}));

async function call(method: string, url: string, body?: unknown) {
  const { handleUiApiRequest } = await import('../src/ui/api.js');
  const req = createMockRequest(method, url, body === undefined ? undefined : JSON.stringify(body));
  const response = createMockResponse();
  handleUiApiRequest(req, response.res);
  await vi.waitFor(() => expect(response.result.data).not.toBe(''));
  return { code: response.result.code, body: JSON.parse(response.result.data) };
}

describe('UI OAuth API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.catalog = [];
    state.registry = { schemaVersion: 1, providers: [] };
  });

  it('returns a sanitized Copilot plan label and the policy-filtered model count', async () => {
    state.catalog = [{
      id: 'github-copilot',
      name: 'GitHub Copilot',
      authType: 'oauth',
      apiKey: 'copilot-session',
      providerData: {
        copilot: {
          lookup_status: 'known',
          is_free_plan: true,
          login: 'private-login',
          access_type_sku: 'free_limited_copilot',
        },
      },
      models: [{
        id: 'gpt-4.1',
        name: 'GPT-4.1',
        brand: 'OpenAI',
        family: 'gpt',
        modelFormat: 'openai',
        upstreamModelId: 'gpt-4.1',
        isFree: true,
        freeStatus: 'verified_free',
      }],
    }];
    state.registry.providers = [{
      id: 'github-copilot',
      templateId: 'github-copilot',
      name: 'GitHub Copilot',
      enabled: true,
      authRef: 'keyring:oauth:provider:github-copilot',
      authType: 'oauth',
      api: {},
      modelsCache: { fetchedAt: '2026-07-19T00:00:00.000Z', models: new Array(8).fill({}) },
    }];

    const result = await call('GET', '/api/models');

    expect(result.body.providers[0]).toMatchObject({
      id: 'github-copilot',
      modelCount: 1,
      subscription: { tier: 'free', label: 'Copilot Free' },
    });
    expect(JSON.stringify(result.body)).not.toContain('private-login');
    expect(JSON.stringify(result.body)).not.toContain('free_limited_copilot');
  });

  it('starts a visible device-code flow without returning the private device secret', async () => {
    const result = await call('POST', '/api/providers/oauth/start', { providerId: 'github-copilot' });

    expect(result).toMatchObject({ code: 200 });
    expect(result.body).toMatchObject({
      userCode: 'ABCD-1234',
      url: 'https://github.com/login/device',
    });
    expect(result.body.sessionId).toEqual(expect.any(String));
    expect(JSON.stringify(result.body)).not.toContain('device-secret');
  });

  it('rejects non-visible OAuth IDs without naming them in the response', async () => {
    const result = await call('POST', '/api/providers/oauth/start', { providerId: 'not-visible' });

    expect(result.code).toBe(400);
    expect(result.body.error).toBe('Unsupported OAuth provider.');
  });
});
