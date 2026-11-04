import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleUiApiRequest } from '../src/ui/api.js';
import * as env from '../src/env.js';
import { saveRegistry } from '../src/registry/io.js';
import { setContextWindowOverride } from '../src/registry/crud.js';
import { fetchTemplateModels } from '../src/registry/fetch-template-models.js';
import type { ProviderTemplate } from '../src/provider-templates.js';
import { createMockRequest, createMockResponse } from './helpers/ui-api-test-utils.js';

async function call(method: string, url: string, body?: unknown) {
  const response = createMockResponse();
  handleUiApiRequest(createMockRequest(method, url, body === undefined ? undefined : JSON.stringify(body)), response.res);
  await vi.waitFor(() => expect(response.result.data).not.toBe(''));
  return { code: response.result.code, json: JSON.parse(response.result.data) };
}

const models = [
  { id: 'guessed', name: 'Guessed', upstreamModelId: 'guessed', modelFormat: 'openai', contextWindow: 200_000 },
  { id: 'reported', name: 'Reported', upstreamModelId: 'reported', modelFormat: 'openai', contextWindow: 131_072, contextWindowSource: 'provider' },
];
const entry = (id: string, templateId: string) => ({
  id, templateId, name: id, enabled: true,
  api: { npm: '@ai-sdk/openai-compatible', url: `https://${id}.example.com/v1` },
  authRef: `keyring:provider:${id}`, addedAt: '2026-11-03T00:00:00Z',
  modelsCache: { fetchedAt: '2026-11-03T00:00:00Z', models },
});

describe('"estimate" label for custom endpoints', () => {
  let tempHome: string;
  let previousRelayHome: string | undefined;
  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'relay-ai-ui-estimate-'));
    previousRelayHome = process.env['RELAY_AI_HOME'];
    process.env['RELAY_AI_HOME'] = join(tempHome, 'relay-home');
    vi.spyOn(env, 'resolveProviderCredential').mockResolvedValue('key');
    saveRegistry({ schemaVersion: 1, providers: [entry('custom-gw', 'custom-openai'), entry('deepseek', 'deepseek')] } as never);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tempHome, { recursive: true, force: true });
    if (previousRelayHome === undefined) delete process.env['RELAY_AI_HOME'];
    else process.env['RELAY_AI_HOME'] = previousRelayHome;
  });

  const estimates = async (providerId: string) => Object.fromEntries(
    (await call('GET', '/api/models')).json.providers.find((p: { id: string }) => p.id === providerId)
      .models.map((m: { id: string; contextWindowEstimate?: string }) => [m.id, Boolean(m.contextWindowEstimate)]),
  );

  it('flags only guessed sizes on a custom endpoint', async () => {
    expect(await estimates('custom-gw')).toEqual({ guessed: true, reported: false });
  });

  it('never flags built-in providers', async () => {
    expect(await estimates('deepseek')).toEqual({ guessed: false, reported: false });
  });

  it('drops the flag once a size is typed or measured', async () => {
    setContextWindowOverride('custom-gw', 'guessed', 40_960, 'measured');
    expect((await estimates('custom-gw')).guessed).toBe(false);
  });

  it('says where an estimate came from', async () => {
    const registry = (await import('../src/registry/io.js')).loadRegistry();
    registry.providers[0]!.modelsCache!.models[0]!.contextWindowSource = 'models.dev';
    saveRegistry(registry);
    const row = (await call('GET', '/api/models')).json.providers.find((p: { id: string }) => p.id === 'custom-gw')
      .models.find((m: { id: string }) => m.id === 'guessed');
    expect(row.contextWindowEstimate).toBe('models.dev');
  });

  it('refuses bulk measuring for built-in providers', async () => {
    const result = await call('POST', '/api/providers/models/measure-context', { providerId: 'deepseek', modelId: 'guessed' });
    expect(result.code).toBe(400);
  });
});

describe('fetched sizes are marked when the provider stated them', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('marks a listed size and leaves a guessed one unmarked', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [
      { id: 'listed', context_length: 32_768 },
      { id: 'unlisted' },
    ] }))));
    const template = { id: 'custom-openai', name: 'X', authType: 'api', npm: '@ai-sdk/openai-compatible', modelSource: 'api-list', supported: true } as unknown as ProviderTemplate;
    const result = await fetchTemplateModels(template, 'k', 'https://gw.example.com/v1');
    const byId = Object.fromEntries(result.models.map(m => [m.id, m]));
    expect(byId['listed']).toMatchObject({ contextWindow: 32_768, contextWindowSource: 'provider' });
    expect(byId['unlisted']!.contextWindowSource).toBeUndefined();
    expect(byId['unlisted']!.contextWindow).toBeGreaterThan(0);
  });
});
