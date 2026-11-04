import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRegistry, saveRegistry } from '../src/registry/io.js';
import { setModelHidden } from '../src/registry/crud.js';
import { materializeRegistry } from '../src/registry/materialize.js';
import { listRelayModels } from '../src/core/catalog.js';
import type { RegistryProvider } from '../src/registry/types.js';

let dir: string;

function provider(): RegistryProvider {
  return {
    id: 'deepseek', templateId: 'deepseek', name: 'DeepSeek', enabled: true,
    api: { npm: '@ai-sdk/openai-compatible', url: 'https://api.deepseek.com' },
    authRef: 'keyring:provider:deepseek', addedAt: '2026-09-08T00:00:00Z',
    modelsCache: {
      fetchedAt: '2026-09-08T00:00:00Z',
      models: [
        { id: 'chat-a', name: 'Chat A', upstreamModelId: 'chat-a', modelFormat: 'openai' },
        { id: 'chat-b', name: 'Chat B', upstreamModelId: 'chat-b', modelFormat: 'openai' },
      ],
    },
  };
}

const materialize = (opts?: { includeHidden?: boolean }) =>
  materializeRegistry(loadRegistry(), () => 'key', { agent: 'server', ...opts });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'relay-hidden-test-'));
  vi.stubEnv('RELAY_AI_HOME', dir);
  saveRegistry({ schemaVersion: 1, providers: [provider()] });
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); });

describe('hiding models', () => {
  it('saves the choice and keeps it across a reload', () => {
    expect(setModelHidden('deepseek', 'chat-a', true)).toEqual({ ok: true, hidden: true });
    expect(loadRegistry().providers[0].hiddenModelIds).toEqual(['chat-a']);
  });

  it('removes a hidden model from launch catalogs by default', () => {
    setModelHidden('deepseek', 'chat-a', true);
    expect(materialize()[0].models.map(m => m.id)).toEqual(['chat-b']);
  });

  it('returns hidden models flagged when asked (Providers page)', () => {
    setModelHidden('deepseek', 'chat-a', true);
    const models = materialize({ includeHidden: true })[0].models;
    expect(models.map(m => [m.id, m.hidden === true])).toEqual([['chat-a', true], ['chat-b', false]]);
  });

  it('drops a provider whose models are all hidden from launch catalogs only', () => {
    setModelHidden('deepseek', 'chat-a', true);
    setModelHidden('deepseek', 'chat-b', true);
    expect(materialize()).toHaveLength(0);
    expect(materialize({ includeHidden: true })).toHaveLength(1);
  });

  it('unhides and cleans the saved list', () => {
    setModelHidden('deepseek', 'chat-a', true);
    setModelHidden('deepseek', 'chat-a', false);
    expect(loadRegistry().providers[0].hiddenModelIds).toBeUndefined();
    expect(materialize()[0].models.map(m => m.id)).toEqual(['chat-a', 'chat-b']);
  });

  it('survives a model refresh that rewrites the cached list', () => {
    setModelHidden('deepseek', 'chat-a', true);
    const registry = loadRegistry();
    registry.providers[0].modelsCache!.models = [...registry.providers[0].modelsCache!.models];
    saveRegistry(registry);
    expect(materialize()[0].models.map(m => m.id)).toEqual(['chat-b']);
  });

  it('is hidden from the embedded Core catalog too', () => {
    setModelHidden('deepseek', 'chat-a', true);
    expect(listRelayModels().map(m => m.modelId)).toEqual(['chat-b']);
  });

  it('rejects unknown providers and models', () => {
    expect(setModelHidden('nope', 'chat-a', true)).toMatchObject({ ok: false });
    expect(setModelHidden('deepseek', 'nope', true)).toMatchObject({ ok: false });
    expect(loadRegistry().providers[0].hiddenModelIds).toBeUndefined();
  });
});
