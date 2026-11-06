import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleUiApiRequest } from '../src/ui/api.js';
import * as env from '../src/env.js';
import { loadRegistry, saveRegistry } from '../src/registry/io.js';
import { setProviderServerUrl } from '../src/registry/crud.js';
import { createMockRequest, createMockResponse } from './helpers/ui-api-test-utils.js';

async function call(method: string, url: string, body?: unknown) {
  const response = createMockResponse();
  handleUiApiRequest(createMockRequest(method, url, body === undefined ? undefined : JSON.stringify(body)), response.res);
  await vi.waitFor(() => expect(response.result.data).not.toBe(''));
  return { code: response.result.code, json: JSON.parse(response.result.data) };
}

const model = { id: 'm', name: 'M', upstreamModelId: 'm', modelFormat: 'openai', contextWindow: 100_000, apiUrl: 'http://127.0.0.1:11434/v1' };
const entry = (id: string, templateId: string, url: string) => ({
  id, templateId, name: id, enabled: true,
  api: { npm: '@ai-sdk/openai-compatible', url },
  authRef: `keyring:provider:${id}`, addedAt: '2026-11-03T00:00:00Z',
  modelsCache: { fetchedAt: '2026-11-03T00:00:00Z', models: [model] },
});

describe('add another account and server address', () => {
  let tempHome: string;
  let previous: string | undefined;
  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'relay-ai-ui-add-another-'));
    previous = process.env['RELAY_AI_HOME'];
    process.env['RELAY_AI_HOME'] = join(tempHome, 'relay-home');
    vi.spyOn(env, 'resolveProviderCredential').mockResolvedValue('key');
    saveRegistry({ schemaVersion: 1, providers: [
      entry('ollama', 'ollama', 'http://127.0.0.1:11434/v1'),
      entry('groq', 'groq', 'https://api.groq.com/openai/v1'),
    ] } as never);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tempHome, { recursive: true, force: true });
    if (previous === undefined) delete process.env['RELAY_AI_HOME']; else process.env['RELAY_AI_HOME'] = previous;
  });

  it('keeps a configured key provider in the add list, marked as another account', async () => {
    const { json } = await call('GET', '/api/providers/templates');
    const groq = json.templates.find((t: { id: string }) => t.id === 'groq');
    expect(groq?.addAnother).toBe(true);
    const mistral = json.templates.find((t: { id: string }) => t.id === 'mistral');
    expect(mistral?.addAnother).toBeUndefined();
  });

  it('lists Claude Code and Antigravity sign-ins with the risk flag', async () => {
    const { json } = await call('GET', '/api/providers/templates');
    for (const id of ['claude-code', 'antigravity']) {
      expect(json.templates.find((t: { id: string }) => t.id === id)?.subscriptionRisk).toBe(true);
    }
  });

  it('offers an address edit only for providers that ask for a server address', async () => {
    const { json } = await call('GET', '/api/models');
    const byId = (id: string) => json.providers.find((p: { id: string }) => p.id === id);
    expect(byId('ollama').canEditServerUrl).toBe(true);
    expect(byId('ollama').serverUrl).toBe('http://127.0.0.1:11434/v1');
    expect(byId('groq').canEditServerUrl).toBeUndefined();
  });

  it('refuses an address edit for a provider without one', async () => {
    const result = await call('POST', '/api/providers/edit-url', { providerId: 'groq', baseUrl: 'http://10.0.0.5/v1' });
    expect(result.code).toBe(400);
  });

  it('rewrites the provider and its cached models to the new address', () => {
    setProviderServerUrl('ollama', 'http://192.168.1.20:11434/v1');
    const provider = loadRegistry().providers.find(p => p.id === 'ollama')!;
    expect(provider.api.url).toBe('http://192.168.1.20:11434/v1');
    expect(provider.modelsCache!.models[0]!.apiUrl).toBe('http://192.168.1.20:11434/v1');
    expect(provider.id).toBe('ollama');
  });
});
