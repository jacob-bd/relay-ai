import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleUiApiRequest } from '../src/ui/api.js';
import * as env from '../src/env.js';
import { loadRegistry, saveRegistry } from '../src/registry/io.js';
import { createMockRequest, createMockResponse } from './helpers/ui-api-test-utils.js';

async function call(method: string, url: string, body?: unknown) {
  const response = createMockResponse();
  handleUiApiRequest(createMockRequest(method, url, body === undefined ? undefined : JSON.stringify(body)), response.res);
  await vi.waitFor(() => expect(response.result.data).not.toBe(''));
  return { code: response.result.code, json: JSON.parse(response.result.data) };
}

describe('UI context-size route', () => {
  let tempHome: string;
  let previousRelayHome: string | undefined;
  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'relay-ai-ui-ctx-'));
    previousRelayHome = process.env['RELAY_AI_HOME'];
    process.env['RELAY_AI_HOME'] = join(tempHome, 'relay-home');
    vi.spyOn(env, 'resolveProviderCredential').mockResolvedValue('key');
    saveRegistry({ schemaVersion: 1, providers: [{
      id: 'deepseek', templateId: 'deepseek', name: 'DeepSeek', enabled: true,
      api: { npm: '@ai-sdk/openai-compatible', url: 'https://api.deepseek.com' },
      authRef: 'keyring:provider:deepseek', addedAt: '2026-11-03T00:00:00Z',
      modelsCache: { fetchedAt: '2026-11-03T00:00:00Z', models: [
        { id: 'chat-a', name: 'Chat A', upstreamModelId: 'chat-a', modelFormat: 'openai', contextWindow: 64_000 },
      ] },
    }] } as never);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tempHome, { recursive: true, force: true });
    if (previousRelayHome === undefined) delete process.env['RELAY_AI_HOME'];
    else process.env['RELAY_AI_HOME'] = previousRelayHome;
  });

  const row = async () => (await call('GET', '/api/models')).json.providers[0].models[0];

  it('saves a size, shows it as custom, and resets it', async () => {
    expect((await call('POST', '/api/providers/models/context', { providerId: 'deepseek', modelId: 'chat-a', contextWindow: 128_000 })).code).toBe(200);
    expect(await row()).toMatchObject({ contextWindow: 128_000, contextWindowOverride: 'user' });

    expect((await call('POST', '/api/providers/models/context', { providerId: 'deepseek', modelId: 'chat-a', contextWindow: null })).code).toBe(200);
    const reset = await row();
    expect(reset.contextWindow).toBe(64_000);
    expect(reset.contextWindowOverride).toBeUndefined();
    expect(loadRegistry().providers[0]!.contextWindowOverrides).toBeUndefined();
  });

  it('rejects bad input', async () => {
    expect((await call('POST', '/api/providers/models/context', { providerId: 'deepseek', modelId: 'chat-a', contextWindow: '128k' })).code).toBe(400);
    expect((await call('POST', '/api/providers/models/context', { providerId: 'deepseek', modelId: 'chat-a', contextWindow: 5 })).code).toBe(400);
  });
});
