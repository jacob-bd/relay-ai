import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs';
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
