// tests/core-catalog.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listRelayModels } from '../src/core/catalog.js';
import { isRelayCoreError } from '../src/core/errors.js';

const CANARY = 'sk-canary-token-abc123';

function provider(overrides: Record<string, unknown>) {
  return {
    id: 'provider-one',
    templateId: 'provider-one',
    name: 'Provider One',
    enabled: true,
    authRef: 'keychain:provider-one',
    authType: 'api',
    api: { npm: '@ai-sdk/groq', url: 'https://api.groq.com/openai/v1', headers: { authorization: `Bearer ${CANARY}` } },
    modelsCache: {
      fetchedAt: '2026-07-23T00:00:00Z',
      models: [
        { id: 'shared-model', name: 'Shared Model', upstreamModelId: 'shared-model', modelFormat: 'openai' },
      ],
    },
    addedAt: '2026-07-23T00:00:00Z',
    ...overrides,
  };
}

describe('listRelayModels', () => {
  let home: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'relay-core-catalog-'));
    prevHome = process.env.RELAY_AI_HOME;
    process.env.RELAY_AI_HOME = home;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.RELAY_AI_HOME;
    else process.env.RELAY_AI_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  });

  function writeRegistry(providers: unknown[], schemaVersion = 1) {
    writeFileSync(join(home, 'providers.json'), JSON.stringify({ schemaVersion, providers }));
  }

  function writeConfig(config: unknown) {
    writeFileSync(join(home, 'config.json'), JSON.stringify(config));
  }

  it('produces distinct route ids for two providers exposing the same bare model id', () => {
    writeRegistry([
      provider({}),
      provider({ id: 'provider-two', name: 'Provider Two', authRef: 'keychain:provider-two' }),
    ]);
    const models = listRelayModels();
    expect(models).toHaveLength(2);
    expect(models.map(m => m.routeId).sort()).toEqual([
      'provider-one::shared-model',
      'provider-two::shared-model',
    ]);
  });

  it('excludes disabled providers', () => {
    writeRegistry([provider({}), provider({ id: 'provider-off', name: 'Off', enabled: false })]);
    const models = listRelayModels();
    expect(models).toHaveLength(1);
    expect(models[0]!.providerId).toBe('provider-one');
  });

  it('marks favorites and sorts them first', () => {
    writeRegistry([
      provider({}),
      provider({ id: 'aaa-first', name: 'AAA First', authRef: 'keychain:aaa' }),
    ]);
    writeConfig({ favoriteModels: [{ providerId: 'provider-one', modelId: 'shared-model' }] });
    const models = listRelayModels();
    expect(models[0]!.routeId).toBe('provider-one::shared-model');
    expect(models[0]!.favorite).toBe(true);
    expect(models[1]!.favorite).toBe(false);
  });

  it('maps pricing snake_case → camelCase and passes contextWindow through', () => {
    writeRegistry([provider({
      modelsCache: {
        fetchedAt: '2026-07-23T00:00:00Z',
        models: [{
          id: 'priced', name: 'Priced', upstreamModelId: 'priced', modelFormat: 'openai',
          contextWindow: 131072,
          cost: { input: 1.5, output: 10, cache_read: 0.15, cache_write: 1.875 },
        }],
      },
    })]);
    const [m] = listRelayModels();
    expect(m!.contextWindow).toBe(131072);
    expect(m!.pricing).toEqual({ input: 1.5, output: 10, cacheRead: 0.15, cacheWrite: 1.875 });
  });

  it('classifies reasoning via getReasoningCapabilities (claude → adjustable with levels)', () => {
    writeRegistry([provider({
      api: { npm: '@ai-sdk/anthropic' },
      modelsCache: {
        fetchedAt: '2026-07-23T00:00:00Z',
        models: [
          { id: 'claude-sonnet-4-6', name: 'Sonnet', upstreamModelId: 'claude-sonnet-4-6', modelFormat: 'anthropic' },
          { id: 'plain-model', name: 'Plain', upstreamModelId: 'plain-model', modelFormat: 'openai', npm: '@ai-sdk/groq' },
        ],
      },
    })]);
    const models = listRelayModels();
    const claude = models.find(m => m.modelId === 'claude-sonnet-4-6')!;
    expect(claude.capabilities.reasoning).toBe('adjustable');
    expect(claude.capabilities.reasoningLevels).toContain('high');
    expect(claude.capabilities.defaultReasoningLevel).toBe('high');
    const plain = models.find(m => m.modelId === 'plain-model')!;
    expect(plain.capabilities.reasoning).toBe('none');
    expect(plain.capabilities.tools).toBe('unknown');
    expect(plain.capabilities.vision).toBe('unknown');
  });

  it('uses provider-reported metadata for OpenRouter reasoning classification', () => {
    writeRegistry([provider({
      api: { npm: '@openrouter/ai-sdk-provider', url: 'https://openrouter.ai/api/v1' },
      modelsCache: {
        fetchedAt: '2026-07-23T00:00:00Z',
        models: [{
          id: 'vendor/some-reasoner:free', name: 'Reasoner', upstreamModelId: 'vendor/some-reasoner:free',
          modelFormat: 'openai', reasoning: true, supportedParameters: ['reasoning', 'tools'],
        }],
      },
    })]);
    const [m] = listRelayModels();
    expect(m!.capabilities.reasoning).toBe('adjustable');
    expect(m!.modelId).toBe('vendor/some-reasoner:free');
  });

  it('exposes no credential material', () => {
    writeRegistry([provider({})]);
    const models = listRelayModels();
    const json = JSON.stringify(models);
    expect(json).not.toMatch(/api[_-]?key|access[_-]?token|refresh[_-]?token|authRef|authorization/i);
    expect(json).not.toContain(CANARY);
  });

  it('rejects a newer registry schema and never rewrites the file', () => {
    writeRegistry([provider({})], 99);
    const before = readFileSync(join(home, 'providers.json'), 'utf8');
    let caught: unknown;
    try {
      listRelayModels();
    } catch (err) {
      caught = err;
    }
    expect(isRelayCoreError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe('UNSUPPORTED_REGISTRY_VERSION');
    expect(readFileSync(join(home, 'providers.json'), 'utf8')).toBe(before);
    expect(readdirSync(home).sort()).toEqual(['providers.json']);
  });

  it('applies in-memory migrations but does not persist them', () => {
    // { id: 'openai', authType: 'oauth' } triggers migrateOAuthOpenAiProvider.
    writeRegistry([provider({ id: 'openai', name: 'OpenAI', authType: 'oauth', api: { npm: '@ai-sdk/openai' } })]);
    const before = readFileSync(join(home, 'providers.json'), 'utf8');
    const models = listRelayModels();
    expect(models[0]!.providerId).toBe('openai-oauth');
    expect(models[0]!.routeId).toBe('openai-oauth::shared-model');
    expect(models[0]!.authType).toBe('oauth');
    // File on disk untouched — no migration persistence, no .bak.
    expect(readFileSync(join(home, 'providers.json'), 'utf8')).toBe(before);
    expect(readdirSync(home).sort()).toEqual(['providers.json']);
  });
});
