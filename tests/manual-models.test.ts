import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRegistry, saveRegistry } from '../src/registry/io.js';
import { addManualModel, removeManualModel } from '../src/registry/manual-models.js';
import { getProviderModels, parseManualModel } from '../src/registry/provider-models.js';
import { validateManualModel } from '../src/registry/validate-manual-model.js';
import { resolveProviderCredential } from '../src/env.js';
import { materializeRegistry } from '../src/registry/materialize.js';
import { listRelayModels } from '../src/core/catalog.js';
import type { RegistryProvider } from '../src/registry/types.js';

vi.mock('../src/registry/validate-manual-model.js', () => ({ validateManualModel: vi.fn() }));
vi.mock('../src/env.js', () => ({ resolveProviderCredential: vi.fn() }));
const model = { id: 'beta', name: 'Beta', upstreamModelId: 'beta', modelFormat: 'openai' as const, source: 'manual' as const, validatedAt: '2026-09-08T00:00:00Z' };
let dir: string;
function provider(): RegistryProvider {
  return { id: 'deepseek', templateId: 'deepseek', name: 'DeepSeek', enabled: true,
    api: { npm: '@ai-sdk/openai-compatible', url: 'https://api.deepseek.com' },
    authRef: 'keyring:provider:deepseek', addedAt: '2026-09-08T00:00:00Z',
    modelsCache: { fetchedAt: '2026-09-08T00:00:00Z', models: [{ id: 'listed', name: 'Listed', upstreamModelId: 'listed', modelFormat: 'openai' }] } };
}
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'relay-manual-test-'));
  vi.stubEnv('RELAY_AI_HOME', dir);
  vi.mocked(resolveProviderCredential).mockResolvedValue('test-secret');
  vi.mocked(validateManualModel).mockResolvedValue(undefined);
  saveRegistry({ schemaVersion: 1, providers: [provider()] });
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); rmSync(dir, { recursive: true, force: true }); });

describe('manual models', () => {
  it('validates and saves separately, survives refresh replacement, and appears in runtime and Core', async () => {
    const result = await addManualModel({ providerId: 'deepseek', modelId: 'beta', displayName: 'Beta' });
    expect(result.ok).toBe(true);
    expect(validateManualModel).toHaveBeenCalledOnce();
    const registry = loadRegistry();
    expect(registry.providers[0].modelsCache!.models.map(m => m.id)).toEqual(['listed']);
    expect(registry.providers[0].manualModels?.[0]).toMatchObject({ id: 'beta', source: 'manual' });
    registry.providers[0].modelsCache!.models = [];
    saveRegistry(registry);
    const reloaded = loadRegistry();
    const runtime = materializeRegistry(reloaded, () => 'key', { agent: 'server' });
    expect(runtime[0].models[0]).toMatchObject({ id: 'beta', upstreamModelId: 'beta' });
    expect(runtime[0].models[0].contextWindow).toBeUndefined();
    expect(listRelayModels()[0]).toMatchObject({ modelId: 'beta', displayName: 'Beta' });
    expect(listRelayModels()[0].contextWindow).toBeUndefined();
  });

  it('deduplicates when a manual model later appears in discovery and restores the discovered entry on removal', () => {
    const p = provider(); p.manualModels = [model]; p.modelsCache!.models.push({ ...model, source: undefined, name: 'Discovered beta' });
    saveRegistry({ schemaVersion: 1, providers: [p] });
    expect(getProviderModels(p).filter(m => m.id === 'beta')).toEqual([model]);
    expect(removeManualModel('deepseek', 'beta').ok).toBe(true);
    expect(getProviderModels(loadRegistry().providers[0]).find(m => m.id === 'beta')?.name).toBe('Discovered beta');
  });

  it.each([{ modelId: '' }, { modelId: 'bad\nmodel' }, { modelId: 'listed' }, { modelId: 'beta', contextWindow: -1 }, { modelId: 'beta', contextWindow: 1.5 }, { modelId: 'beta', displayName: 123 }])('rejects invalid or duplicate input before testing: %j', async input => {
    expect((await addManualModel({ providerId: 'deepseek', ...input } as any)).ok).toBe(false);
    expect(validateManualModel).not.toHaveBeenCalled();
  });

  it('does not save a failed test and redacts the key from the error', async () => {
    vi.mocked(validateManualModel).mockRejectedValue(new Error('Rejected test-secret'));
    const result = await addManualModel({ providerId: 'deepseek', modelId: 'beta' });
    expect(result).toEqual({ ok: false, error: 'Rejected [REDACTED]' });
    expect(loadRegistry().providers[0].manualModels).toBeUndefined();
  });

  it('rejects OAuth and disabled providers before testing', async () => {
    for (const extra of [{ authType: 'oauth' as const }, { enabled: false }]) {
      saveRegistry({ schemaVersion: 1, providers: [{ ...provider(), ...extra }] });
      expect((await addManualModel({ providerId: 'deepseek', modelId: 'beta' })).ok).toBe(false);
    }
    expect(validateManualModel).not.toHaveBeenCalled();
  });

  it('does not overwrite a provider change while validation is running', async () => {
    vi.mocked(validateManualModel).mockImplementation(async () => {
      const registry = loadRegistry(); registry.providers[0].api.url = 'https://other.example'; saveRegistry(registry);
    });
    expect((await addManualModel({ providerId: 'deepseek', modelId: 'beta' })).ok).toBe(false);
    expect(loadRegistry().providers[0].api.url).toBe('https://other.example');
    expect(loadRegistry().providers[0].manualModels).toBeUndefined();
  });

  it('preserves unrelated changes and other model additions during testing', async () => {
    vi.mocked(validateManualModel).mockImplementation(async () => {
      const registry = loadRegistry(); registry.providers[0].manualModels = [{ ...model, id: 'other', upstreamModelId: 'other' }]; saveRegistry(registry);
    });
    expect((await addManualModel({ providerId: 'deepseek', modelId: 'beta' })).ok).toBe(true);
    expect(loadRegistry().providers[0].manualModels?.map(m => m.id)).toEqual(['other', 'beta']);
  });

  it('ignores unvalidated records and does not load routing overrides from manual entries', () => {
    expect(parseManualModel({ ...model, validatedAt: 'invalid' })).toBeUndefined();
    expect(parseManualModel({ ...model, apiUrl: 'https://evil.example', npm: 'arbitrary-package', upstreamModelId: 'different' })).toEqual(model);
  });

  it('cannot remove a discovered model', () => {
    expect(removeManualModel('deepseek', 'listed').ok).toBe(false);
    expect(getProviderModels(loadRegistry().providers[0])).toHaveLength(1);
  });
});
