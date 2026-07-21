import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  emptyRegistry,
  isValidProviderId,
  loadRegistry,
  materializeRegistry,
  saveRegistry,
  slugifyProviderId,
} from '../src/registry/index.js';

describe('provider id validation', () => {
  it('accepts stable slugs', () => {
    expect(isValidProviderId('groq')).toBe(true);
    expect(isValidProviderId('openai')).toBe(true);
    expect(isValidProviderId('custom-together-ai')).toBe(true);
    expect(isValidProviderId('go')).toBe(true);
  });

  it('rejects invalid ids', () => {
    expect(isValidProviderId('OpenAI')).toBe(false);
    expect(isValidProviderId('has space')).toBe(false);
    expect(isValidProviderId('bad:id')).toBe(false);
    expect(isValidProviderId('-leading')).toBe(false);
    expect(isValidProviderId('trailing-')).toBe(false);
  });

  it('slugifies display names', () => {
    expect(slugifyProviderId('Together AI')).toBe('together-ai');
    expect(slugifyProviderId('My vLLM Server')).toBe('my-vllm-server');
  });
});

describe('registry io', () => {
  let home: string;
  const prev = process.env.RELAY_AI_HOME;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'relay-ai-registry-'));
    process.env.RELAY_AI_HOME = home;
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.RELAY_AI_HOME;
    else process.env.RELAY_AI_HOME = prev;
    rmSync(home, { recursive: true, force: true });
  });

  it('round-trips registry json', () => {
    const registry = emptyRegistry();
    registry.providers.push({
      id: 'groq',
      templateId: 'groq',
      name: 'Groq',
      enabled: true,
      authRef: 'keyring:provider:groq',
      api: { npm: '@ai-sdk/groq' },
      addedAt: '2026-06-09T00:00:00.000Z',
      modelsCache: {
        fetchedAt: '2026-06-09T00:00:00.000Z',
        models: [{
          id: 'llama-3.3-70b',
          name: 'Llama 3.3 70B',
          upstreamModelId: 'llama-3.3-70b',
          modelFormat: 'openai',
          npm: '@ai-sdk/groq',
        }],
      },
    });
    saveRegistry(registry);
    const loaded = loadRegistry();
    expect(loaded.providers).toHaveLength(1);
    expect(loaded.providers[0]?.id).toBe('groq');
    expect(loaded.providers[0]?.modelsCache?.models[0]?.npm).toBe('@ai-sdk/groq');
  });

  it('writes providers.json with restrictive permissions', () => {
    saveRegistry(emptyRegistry());
    const path = join(home, 'providers.json');
    expect(existsSync(path)).toBe(true);
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('skips invalid provider entries on load', () => {
    const path = join(home, 'providers.json');
    const raw = {
      schemaVersion: 1,
      providers: [
        { id: 'BAD ID', templateId: 'x', name: 'X', enabled: true, authRef: 'k', api: {}, addedAt: 't' },
        {
          id: 'groq',
          templateId: 'groq',
          name: 'Groq',
          enabled: true,
          authRef: 'keyring:provider:groq',
          api: { npm: '@ai-sdk/groq' },
          addedAt: '2026-06-09T00:00:00.000Z',
        },
      ],
    };
    mkdirSync(home, { recursive: true });
    writeFileSync(path, JSON.stringify(raw));
    const loaded = loadRegistry(path);
    expect(loaded.providers).toHaveLength(1);
    expect(loaded.providers[0]?.id).toBe('groq');
  });

  it('removes legacy OpenCode cloud duplicates on load and persists the cleanup', () => {
    const path = join(home, 'providers.json');
    const base = {
      enabled: true,
      authRef: 'keyring:global:opencode',
      api: {},
      addedAt: '2026-06-18T00:00:00.000Z',
    };
    mkdirSync(home, { recursive: true });
    writeFileSync(path, JSON.stringify({
      schemaVersion: 1,
      providers: [
        { ...base, id: 'zen', templateId: 'zen', name: 'OpenCode Zen' },
        { ...base, id: 'opencode', templateId: 'opencode', name: 'OpenCode Zen' },
        { ...base, id: 'go', templateId: 'go', name: 'OpenCode Go' },
        { ...base, id: 'opencode-go', templateId: 'opencode-go', name: 'OpenCode Go' },
      ],
    }));

    const loaded = loadRegistry(path);

    expect(loaded.providers.map(provider => provider.id)).toEqual(['zen', 'go']);
    expect(JSON.parse(readFileSync(path, 'utf8')).providers.map((provider: { id: string }) => provider.id))
      .toEqual(['zen', 'go']);
  });

  it('renames a legacy OpenCode cloud provider when no canonical entry exists', () => {
    const path = join(home, 'providers.json');
    mkdirSync(home, { recursive: true });
    writeFileSync(path, JSON.stringify({
      schemaVersion: 1,
      providers: [{
        id: 'opencode',
        templateId: 'opencode',
        name: 'OpenCode',
        enabled: true,
        authRef: 'keyring:provider:opencode',
        api: { npm: '@ai-sdk/openai-compatible', url: 'https://opencode.ai/zen/v1' },
        addedAt: '2026-06-18T00:00:00.000Z',
      }],
    }));

    const loaded = loadRegistry(path);

    expect(loaded.providers[0]).toMatchObject({
      id: 'zen',
      templateId: 'zen',
      name: 'OpenCode Zen',
      authRef: 'keyring:provider:opencode',
      api: {},
    });
  });

  it('renames and persists only the exact legacy Alibaba China label', () => {
    const path = join(home, 'providers.json');
    const legacy = {
      id: 'alibaba',
      templateId: 'alibaba',
      name: 'Alibaba DashScope',
      enabled: true,
      authRef: 'keyring:provider:alibaba',
      api: { npm: '@ai-sdk/alibaba', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
      addedAt: '2026-07-19T00:00:00.000Z',
    };
    mkdirSync(home, { recursive: true });
    writeFileSync(path, JSON.stringify({ schemaVersion: 1, providers: [legacy] }));

    const loaded = loadRegistry(path);

    expect(loaded.providers[0]?.name).toBe('Alibaba DashScope (China)');
    expect(JSON.parse(readFileSync(path, 'utf8')).providers[0]?.name).toBe('Alibaba DashScope (China)');
  });

  it.each([
    { name: 'Alibaba DashScope', url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' },
    { name: 'My DashScope', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  ])('does not rename a non-legacy Alibaba entry (%o)', ({ name, url }) => {
    const path = join(home, 'providers.json');
    mkdirSync(home, { recursive: true });
    writeFileSync(path, JSON.stringify({
      schemaVersion: 1,
      providers: [{
        id: 'alibaba',
        templateId: 'alibaba',
        name,
        enabled: true,
        authRef: 'keyring:provider:alibaba',
        api: { npm: '@ai-sdk/alibaba', url },
        addedAt: '2026-07-19T00:00:00.000Z',
      }],
    }));

    const loaded = loadRegistry(path);

    expect(loaded.providers[0]?.name).toBe(name);
  });
});

describe('materializeRegistry', () => {
  it('materializes enabled providers with credentials and models', () => {
    const registry = emptyRegistry();
    registry.providers.push({
      id: 'openai',
      templateId: 'openai',
      name: 'OpenAI',
      enabled: true,
      authRef: 'keyring:provider:openai',
      authType: 'oauth',
      api: { npm: '@ai-sdk/openai' },
      addedAt: '2026-06-09T00:00:00.000Z',
      modelsCache: {
        fetchedAt: '2026-06-09T00:00:00.000Z',
        models: [{
          id: 'gpt-5.5-fast',
          name: 'GPT-5.5 Fast',
          upstreamModelId: 'gpt-5.5',
          modelFormat: 'openai',
          npm: '@ai-sdk/openai',
        }],
      },
    });
    const locals = materializeRegistry(registry, () => 'sk-test');
    expect(locals).toHaveLength(1);
    expect(locals[0]?.models[0]?.upstreamModelId).toBe('gpt-5.5');
    expect(locals[0]?.apiKey).toBe('sk-test');
    expect(locals[0]?.authType).toBe('oauth');
  });

  it('returns empty when credential missing', () => {
    const registry = emptyRegistry();
    registry.providers.push({
      id: 'groq',
      templateId: 'groq',
      name: 'Groq',
      enabled: true,
      authRef: 'keyring:provider:groq',
      api: { npm: '@ai-sdk/groq' },
      addedAt: '2026-06-09T00:00:00.000Z',
      modelsCache: {
        fetchedAt: '2026-06-09T00:00:00.000Z',
        models: [{
          id: 'llama',
          name: 'Llama',
          upstreamModelId: 'llama',
          modelFormat: 'openai',
          npm: '@ai-sdk/groq',
        }],
      },
    });
    expect(materializeRegistry(registry, () => null)).toHaveLength(0);
  });

  it('allows anonymous Kilo but exposes only verified free models', () => {
    const registry = emptyRegistry();
    registry.providers.push({
      id: 'kilo',
      templateId: 'kilo',
      name: 'Kilo Code',
      enabled: true,
      authRef: 'keyring:provider:kilo',
      authType: 'api',
      api: { npm: '@ai-sdk/openai-compatible', url: 'https://api.kilo.ai/api/gateway' },
      addedAt: '2026-07-06T00:00:00.000Z',
      modelsCache: {
        fetchedAt: '2026-07-06T00:00:00.000Z',
        models: [
          {
            id: 'tencent/hy3:free',
            name: 'Tencent: Hy3 (free)',
            upstreamModelId: 'tencent/hy3:free',
            modelFormat: 'openai',
            npm: '@ai-sdk/openai-compatible',
            cost: { input: 0, output: 0 },
            isFree: true,
            freeStatus: 'verified_free',
          },
          {
            id: 'anthropic/claude-sonnet-4.5',
            name: 'Claude Sonnet 4.5',
            upstreamModelId: 'anthropic/claude-sonnet-4.5',
            modelFormat: 'openai',
            npm: '@ai-sdk/openai-compatible',
            cost: { input: 3, output: 15 },
            isFree: false,
            freeStatus: 'paid',
          },
        ],
      },
    });

    const locals = materializeRegistry(registry, () => null);

    expect(locals).toHaveLength(1);
    expect(locals[0]?.apiKey).toBe('');
    expect(locals[0]?.models.map(m => m.id)).toEqual(['tencent/hy3:free']);
    expect(locals[0]?.models[0]).toMatchObject({
      isFree: true,
      freeStatus: 'verified_free',
    });
  });

  it('marks NVIDIA imported models as free provider access', () => {
    const registry = emptyRegistry();
    registry.providers.push({
      id: 'nvidia',
      templateId: 'nvidia',
      name: 'NVIDIA NIM',
      enabled: true,
      authRef: 'keyring:provider:nvidia',
      api: { npm: '@ai-sdk/openai-compatible', url: 'https://integrate.api.nvidia.com/v1' },
      addedAt: '2026-07-06T00:00:00.000Z',
      modelsCache: {
        fetchedAt: '2026-07-06T00:00:00.000Z',
        models: [{
          id: 'nvidia/llama-3.1-nemotron',
          name: 'NVIDIA Nemotron',
          upstreamModelId: 'nvidia/llama-3.1-nemotron',
          modelFormat: 'openai',
          npm: '@ai-sdk/openai-compatible',
        }],
      },
    });

    const locals = materializeRegistry(registry, () => 'nvapi-test');

    expect(locals[0]?.models[0]).toMatchObject({
      isFree: true,
      freeStatus: 'free_provider',
    });
  });

  it('honors per-model npm and apiUrl overrides', () => {
    const registry = emptyRegistry();
    registry.providers.push({
      id: 'custom-proxy',
      templateId: 'custom-openai',
      name: 'Custom Proxy',
      enabled: true,
      authRef: 'keyring:provider:custom-proxy',
      api: { npm: '@ai-sdk/openai-compatible', url: 'https://default.example/v1' },
      addedAt: '2026-06-09T00:00:00.000Z',
      modelsCache: {
        fetchedAt: '2026-06-09T00:00:00.000Z',
        models: [{
          id: 'model-a',
          name: 'Model A',
          upstreamModelId: 'model-a',
          modelFormat: 'openai',
          npm: '@ai-sdk/openai-compatible',
          apiUrl: 'https://override.example/v1',
        }],
      },
    });
    const locals = materializeRegistry(registry, () => 'key');
    expect(locals[0]?.models[0]?.apiBaseUrl).toBe('https://override.example/v1');
    expect(locals[0]?.models[0]?.completionsUrl).toBe('https://override.example/v1/chat/completions');
  });
});

describe('ensureOpencodeCloudProviders', () => {
  let home: string;
  const prevHome = process.env.RELAY_AI_HOME;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'relay-ai-ensure-opencode-'));
    process.env.RELAY_AI_HOME = home;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.RELAY_AI_HOME;
    else process.env.RELAY_AI_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('seeds zen and go when an OpenCode key is available and registry is empty', async () => {
    const { ensureOpencodeCloudProviders, loadRegistry } = await import('../src/registry/index.js');
    const result = await ensureOpencodeCloudProviders(async () => true);
    expect(result.seeded).toBe(true);
    const ids = loadRegistry().providers.map(p => p.id).sort();
    expect(ids).toEqual(['go', 'zen']);
  });

  it('does nothing when no OpenCode key is available', async () => {
    const { ensureOpencodeCloudProviders, loadRegistry } = await import('../src/registry/index.js');
    const result = await ensureOpencodeCloudProviders(async () => false);
    expect(result.seeded).toBe(false);
    expect(result.refreshed).toEqual([]);
    expect(loadRegistry().providers).toHaveLength(0);
  });
});
