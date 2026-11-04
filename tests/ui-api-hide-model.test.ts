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

describe('UI hide-model route', () => {
  let tempHome: string;
  let previousRelayHome: string | undefined;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'relay-ai-ui-hide-'));
    previousRelayHome = process.env['RELAY_AI_HOME'];
    process.env['RELAY_AI_HOME'] = join(tempHome, 'relay-home');
    vi.spyOn(env, 'resolveProviderCredential').mockResolvedValue('key');
    saveRegistry({ schemaVersion: 1, providers: [{
      id: 'deepseek', templateId: 'deepseek', name: 'DeepSeek', enabled: true,
      api: { npm: '@ai-sdk/openai-compatible', url: 'https://api.deepseek.com' },
      authRef: 'keyring:provider:deepseek', addedAt: '2026-09-08T00:00:00Z',
      modelsCache: { fetchedAt: '2026-09-08T00:00:00Z', models: [
        { id: 'chat-a', name: 'Chat A', upstreamModelId: 'chat-a', modelFormat: 'openai' },
        { id: 'chat-b', name: 'Chat B', upstreamModelId: 'chat-b', modelFormat: 'openai' },
      ] },
    }] } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tempHome, { recursive: true, force: true });
    if (previousRelayHome === undefined) delete process.env['RELAY_AI_HOME'];
    else process.env['RELAY_AI_HOME'] = previousRelayHome;
  });

  it('hides a model, keeps it (flagged) on the Providers page, and drops it from launch pickers', async () => {
    const hide = await call('POST', '/api/providers/models/hide', { providerId: 'deepseek', modelId: 'chat-a', hidden: true });
    expect(hide.code).toBe(200);
    expect(loadRegistry().providers[0].hiddenModelIds).toEqual(['chat-a']);

    const page = (await call('GET', '/api/models')).json.providers.find((p: { id: string }) => p.id === 'deepseek');
    expect(page.models.map((m: { id: string; hidden?: boolean }) => [m.id, m.hidden === true])).toEqual([['chat-a', true], ['chat-b', false]]);
    expect(page.modelCount).toBe(1);

    const picker = (await call('GET', '/api/models?appId=claude')).json.providers.find((p: { id: string }) => p.id === 'deepseek');
    expect(picker.models.map((m: { id: string }) => m.id)).toEqual(['chat-b']);
  });

  it('shows the model again after unhiding', async () => {
    await call('POST', '/api/providers/models/hide', { providerId: 'deepseek', modelId: 'chat-a', hidden: true });
    await call('POST', '/api/providers/models/hide', { providerId: 'deepseek', modelId: 'chat-a', hidden: false });
    const page = (await call('GET', '/api/models')).json.providers.find((p: { id: string }) => p.id === 'deepseek');
    expect(page.models.every((m: { hidden?: boolean }) => !m.hidden)).toBe(true);
    expect(page.modelCount).toBe(2);
  });

  it('rejects bad input and unknown models', async () => {
    expect((await call('POST', '/api/providers/models/hide', { providerId: 'deepseek', modelId: 'chat-a' })).code).toBe(400);
    expect((await call('POST', '/api/providers/models/hide', { providerId: 'deepseek', modelId: 'nope', hidden: true })).code).toBe(404);
  });
});
