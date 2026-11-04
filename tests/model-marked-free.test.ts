import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { classifyFreeStatus, poolFreeStatus } from '../src/free-models.js';
import { poolMembershipProblem } from '../src/pool/verify.js';
import { loadRegistry, saveRegistry } from '../src/registry/io.js';
import { setModelMarkedFree } from '../src/registry/crud.js';
import { getProviderModels } from '../src/registry/provider-models.js';
import { cachedModelToLocal } from '../src/registry/materialize.js';
import type { RegistryProvider } from '../src/registry/types.js';

const priced = { input: 1, output: 2 };

describe('user-marked free models', () => {
  beforeEach(() => { process.env['RELAY_AI_HOME'] = mkdtempSync(join(tmpdir(), 'relay-free-')); });

  it('outranks a listed price, but only through the explicit flag', () => {
    expect(classifyFreeStatus({ model: { cost: priced, isFree: true, freeStatus: 'verified_free' } })).toBe('paid');
    expect(classifyFreeStatus({ model: { cost: priced, userMarkedFree: true } })).toBe('verified_free');
    expect(poolFreeStatus({ model: { cost: priced, userMarkedFree: true }, providerId: 'custom-openai-x' })).toBe('verified_free');
  });

  it('is applied to provider models and survives the registry whitelist', () => {
    const base = {
      id: 'custom-openai', name: 'Gateway', templateId: 'custom-openai', authType: 'api', authRef: 'x', enabled: true, addedAt: '2026-01-01T00:00:00Z',
      api: { npm: '@ai-sdk/openai-compatible', url: 'https://example.test/v1' },
      modelsCache: { fetchedAt: 'now', models: [
        { id: 'a', name: 'a', upstreamModelId: 'a', modelFormat: 'openai', cost: priced },
        { id: 'b', name: 'b', upstreamModelId: 'b', modelFormat: 'openai', cost: priced },
      ] },
      freeModelIds: ['a', 7, ''],
    } as unknown as RegistryProvider;
    const registry = loadRegistry();
    registry.providers.push(base);
    saveRegistry(registry);
    const reloaded = loadRegistry().providers.find(p => p.id === 'custom-openai')!;
    expect(reloaded.freeModelIds).toEqual(['a']);
    expect(setModelMarkedFree('custom-openai', 'b', true)).toEqual({ ok: true, free: true });
    expect(setModelMarkedFree('custom-openai', 'nope', true).ok).toBe(false);
    expect(setModelMarkedFree('custom-openai', 'b', false)).toEqual({ ok: true, free: false });
    expect(loadRegistry().providers.find(p => p.id === 'custom-openai')!.freeModelIds).toEqual(['a']);
    const models = getProviderModels(reloaded);
    expect(models.find(m => m.id === 'a')?.userMarkedFree).toBe(true);
    expect(models.find(m => m.id === 'b')?.userMarkedFree).toBeUndefined();

    const local = cachedModelToLocal(models[0]!, reloaded)!;
    expect(local.freeStatus).toBe('verified_free');
    expect(poolMembershipProblem({ id: reloaded.id } as never, local)).toBeUndefined();
    const unmarked = cachedModelToLocal(models[1]!, reloaded)!;
    expect(poolMembershipProblem({ id: reloaded.id } as never, unmarked)).toBe('Requires verified zero pricing');
  });
});

describe('local endpoints count as free', () => {
  const make = (id: string, url: string, modelId: string) => ({
    id, name: id, templateId: id.replace(/-\d+$/, ''), authType: 'api', authRef: 'x', enabled: true, addedAt: '2026-01-01T00:00:00Z',
    api: { npm: '@ai-sdk/openai-compatible', url },
    modelsCache: { fetchedAt: 'now', models: [{ id: modelId, name: modelId, upstreamModelId: modelId, modelFormat: 'openai' }] },
  }) as unknown as RegistryProvider;

  it('classifies loopback and LAN hosts only, and never Ollama cloud ids', async () => {
    const { isLocalEndpointUrl, isOllamaCloudModelId } = await import('../src/free-models.js');
    for (const url of ['http://127.0.0.1:11434/v1', 'http://localhost:1234/v1', 'http://192.168.1.5:8000/v1', 'http://10.0.0.2/v1', 'http://[::1]:11434/v1']) {
      expect(isLocalEndpointUrl(url)).toBe(true);
    }
    for (const url of ['https://ollama.com/v1', 'https://api.example.com/v1', 'http://172.32.0.1/v1', undefined]) {
      expect(isLocalEndpointUrl(url)).toBe(false);
    }
    expect(isOllamaCloudModelId('gpt-oss:120b-cloud')).toBe(true);
    expect(isOllamaCloudModelId('qwen3:cloud')).toBe(true);
    expect(isOllamaCloudModelId('llama3.2:3b')).toBe(false);
  });

  it('marks local models, skips Ollama cloud ids and remote hosts', () => {
    const local = getProviderModels(make('ollama', 'http://127.0.0.1:11434/v1', 'llama3.2:3b'))[0]!;
    expect(local.localEndpoint).toBe(true);
    expect(classifyFreeStatus({ model: local })).toBe('verified_free');
    expect(getProviderModels(make('ollama', 'http://127.0.0.1:11434/v1', 'gpt-oss:120b-cloud'))[0]!.localEndpoint).toBeUndefined();
    expect(getProviderModels(make('ollama-2', 'https://ollama.com/v1', 'llama3.2:3b'))[0]!.localEndpoint).toBeUndefined();
  });
});

describe('local test log', () => {
  it('records the latest test per model, survives reload, and caps entries', async () => {
    const { recordModelTestResult } = await import('../src/registry/crud.js');
    const registry = loadRegistry();
    registry.providers.push({
      id: 'groq', name: 'Groq', templateId: 'groq', authType: 'api', authRef: 'x', enabled: true, addedAt: '2026-01-01T00:00:00Z',
      api: { npm: '@ai-sdk/openai-compatible', url: 'https://example.test/v1' },
    } as unknown as RegistryProvider);
    saveRegistry(registry);
    recordModelTestResult('groq', 'm1', { ok: false, error: 'No response' });
    recordModelTestResult('groq', 'm1', { ok: true, latencyMs: 900, toolsPassed: true });
    recordModelTestResult('groq', 'm2', { ok: false, error: 'x'.repeat(500) });
    const stored = loadRegistry().providers.find(p => p.id === 'groq')!.modelTestResults!;
    expect(stored['m1']).toMatchObject({ ok: true, latencyMs: 900, toolsPassed: true });
    expect(stored['m2']!.ok).toBe(false);
    expect(stored['m2']!.error!.length).toBeLessThanOrEqual(300);
  });
});

describe('transient test failures', () => {
  it('are stored as transient and survive reload', async () => {
    const { recordModelTestResult } = await import('../src/registry/crud.js');
    const registry = loadRegistry();
    registry.providers.push({
      id: 'openrouter', name: 'OpenRouter', templateId: 'openrouter', authType: 'api', authRef: 'x', enabled: true, addedAt: '2026-01-01T00:00:00Z',
      api: { npm: '@ai-sdk/openai-compatible', url: 'https://example.test/v1' },
    } as unknown as RegistryProvider);
    saveRegistry(registry);
    recordModelTestResult('openrouter', 'm', { ok: false, error: 'Provider rate limit reached. Try again later.', transient: true });
    expect(loadRegistry().providers.find(p => p.id === 'openrouter')!.modelTestResults!['m']).toMatchObject({ ok: false, transient: true });
  });
});
