import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  MAX_PROVIDER_NAME_LENGTH,
  findProviderNameConflict,
  normalizeProviderName,
  uniqueProviderName,
  validateProviderName,
} from '../src/registry/provider-name.js';
import { migrateDuplicateProviderNames } from '../src/registry/migrate.js';
import { renameProvider } from '../src/registry/crud.js';
import { loadRegistry, saveRegistry } from '../src/registry/io.js';
import { materializeRegistry } from '../src/registry/materialize.js';
import { favoriteProviderDisplayName } from '../src/favorite-provider-display.js';
import type { ProviderRegistry, RegistryProvider } from '../src/registry/types.js';

function provider(id: string, name: string, over: Partial<RegistryProvider> = {}): RegistryProvider {
  return {
    id,
    templateId: id.replace(/-\d+$/, ''),
    name,
    enabled: true,
    authRef: `keyring:provider:${id}`,
    api: { npm: '@ai-sdk/openai-compatible', url: 'https://example.com/v1' },
    addedAt: '2026-01-01T00:00:00.000Z',
    modelsCache: {
      fetchedAt: '2026-01-01T00:00:00.000Z',
      models: [{ id: 'm1', name: 'M1', upstreamModelId: 'm1', modelFormat: 'openai', npm: '@ai-sdk/openai-compatible' }],
    },
    ...over,
  };
}

function registryOf(...providers: RegistryProvider[]): ProviderRegistry {
  return { schemaVersion: 1, providers };
}

describe('provider name helpers', () => {
  it('normalizes by trimming and collapsing inner whitespace', () => {
    expect(normalizeProviderName('  My   Chat GPT ')).toBe('My Chat GPT');
  });

  it('rejects empty, too-long and control-character names', () => {
    expect(validateProviderName('   ')).toMatch(/empty/i);
    expect(validateProviderName('x'.repeat(MAX_PROVIDER_NAME_LENGTH + 1))).toMatch(/at most/i);
    expect(validateProviderName('bad\u0007name')).toMatch(/control/i);
    expect(validateProviderName('Personal ChatGPT')).toBeNull();
    expect(validateProviderName('x'.repeat(MAX_PROVIDER_NAME_LENGTH))).toBeNull();
  });

  it('finds conflicts ignoring case and spacing, and excludes the provider itself', () => {
    const providers = [provider('groq', 'Groq'), provider('openai-oauth', 'OpenAI (ChatGPT)')];
    expect(findProviderNameConflict(providers, '  groq ')?.id).toBe('groq');
    expect(findProviderNameConflict(providers, 'OPENAI  (chatgpt)')?.id).toBe('openai-oauth');
    expect(findProviderNameConflict(providers, 'Mistral')).toBeUndefined();
    expect(findProviderNameConflict(providers, 'GROQ', 'groq')).toBeUndefined();
  });

  it('appends the first free number to a taken name', () => {
    const providers = [provider('groq', 'Groq'), provider('groq-2', 'Groq 2')];
    expect(uniqueProviderName(providers, 'Groq')).toBe('Groq 3');
    expect(uniqueProviderName(providers, 'Mistral')).toBe('Mistral');
    expect(uniqueProviderName(providers, 'groq', 'groq')).toBe('groq');
  });
});

describe('migrateDuplicateProviderNames', () => {
  it('numbers later duplicates, keeps the first, marks changed ones as customized', () => {
    const registry = registryOf(
      provider('groq', 'Groq'),
      provider('custom-a', 'groq'),
      provider('custom-b', 'GROQ '),
      provider('mistral', 'Mistral'),
    );
    expect(migrateDuplicateProviderNames(registry)).toBe(true);
    expect(registry.providers.map(p => p.name)).toEqual(['Groq', 'groq 2', 'GROQ 3', 'Mistral']);
    expect(registry.providers[0]!.nameCustomized).toBeUndefined();
    expect(registry.providers[1]!.nameCustomized).toBe(true);
    expect(registry.providers[2]!.nameCustomized).toBe(true);
  });

  it('never changes ids or credential references', () => {
    const registry = registryOf(provider('groq', 'Groq'), provider('custom-a', 'Groq'));
    migrateDuplicateProviderNames(registry);
    expect(registry.providers.map(p => p.id)).toEqual(['groq', 'custom-a']);
    expect(registry.providers[1]!.authRef).toBe('keyring:provider:custom-a');
  });

  it('is a no-op (and idempotent) when names are already unique', () => {
    const registry = registryOf(provider('groq', 'Groq'), provider('mistral', 'Mistral'));
    expect(migrateDuplicateProviderNames(registry)).toBe(false);
    const dup = registryOf(provider('a', 'X'), provider('b', 'X'));
    expect(migrateDuplicateProviderNames(dup)).toBe(true);
    expect(migrateDuplicateProviderNames(dup)).toBe(false);
  });
});

describe('registry persistence and rename', () => {
  let home: string;
  const prev = process.env.RELAY_AI_HOME;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'relay-ai-provider-name-'));
    process.env.RELAY_AI_HOME = home;
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.RELAY_AI_HOME;
    else process.env.RELAY_AI_HOME = prev;
    rmSync(home, { recursive: true, force: true });
  });

  it('keeps nameCustomized across save and load', () => {
    saveRegistry(registryOf(provider('groq', 'Mine', { nameCustomized: true })));
    expect(loadRegistry().providers[0]!.nameCustomized).toBe(true);
  });

  it('numbers duplicate names on load and persists the fix', () => {
    saveRegistry(registryOf(provider('groq', 'Groq'), provider('custom-a', 'Groq')));
    const first = loadRegistry();
    expect(first.providers.map(p => p.name)).toEqual(['Groq', 'Groq 2']);
    expect(loadRegistry(undefined, { persist: false }).providers.map(p => p.name)).toEqual(['Groq', 'Groq 2']);
  });

  it('renames without touching id, credential reference or models', () => {
    saveRegistry(registryOf(provider('openai-oauth', 'OpenAI (ChatGPT)', { authType: 'oauth', authRef: 'keyring:oauth:provider:openai-oauth' })));
    const result = renameProvider('openai-oauth', '  Personal   ChatGPT ');
    expect(result.renamed).toBe(true);
    const saved = loadRegistry().providers[0]!;
    expect(saved.id).toBe('openai-oauth');
    expect(saved.authRef).toBe('keyring:oauth:provider:openai-oauth');
    expect(saved.name).toBe('Personal ChatGPT');
    expect(saved.nameCustomized).toBe(true);
    expect(saved.modelsCache?.models).toHaveLength(1);
  });

  it('refuses a name another provider already uses, ignoring case', () => {
    saveRegistry(registryOf(provider('groq', 'Groq'), provider('mistral', 'Mistral')));
    const result = renameProvider('mistral', 'GROQ');
    expect(result.renamed).toBe(false);
    expect(result.error).toMatch(/already/i);
    expect(loadRegistry().providers.find(p => p.id === 'mistral')!.name).toBe('Mistral');
  });

  it('allows changing only the casing of its own name', () => {
    saveRegistry(registryOf(provider('groq', 'Groq')));
    expect(renameProvider('groq', 'GROQ').renamed).toBe(true);
    expect(loadRegistry().providers[0]!.name).toBe('GROQ');
  });

  it('rejects invalid names, unknown ids and no-op renames', () => {
    saveRegistry(registryOf(provider('groq', 'Groq')));
    expect(renameProvider('groq', '   ').renamed).toBe(false);
    expect(renameProvider('nope', 'Anything').error).toMatch(/not found/i);
    expect(renameProvider('groq', ' Groq ').renamed).toBe(false);
  });

  it('renamed name reaches materialized providers (what pickers show)', () => {
    saveRegistry(registryOf(provider('groq', 'Groq')));
    renameProvider('groq', 'Work Groq');
    const local = materializeRegistry(loadRegistry(), () => 'key');
    expect(local[0]!.name).toBe('Work Groq');
    expect(local[0]!.nameCustomized).toBe(true);
  });
});

describe('favoriteProviderDisplayName', () => {
  it('keeps the stock OAuth wording when not renamed', () => {
    expect(favoriteProviderDisplayName({ id: 'openai-oauth', name: 'OpenAI (ChatGPT)', authType: 'oauth' }))
      .toBe('OpenAI OAuth (ChatGPT)');
    expect(favoriteProviderDisplayName({ id: 'cline-pass', name: 'ClinePass', authType: 'oauth' }))
      .toBe('ClinePass OAuth');
  });

  it('shows exactly what the user typed once renamed', () => {
    expect(favoriteProviderDisplayName({ id: 'openai-oauth', name: 'Personal ChatGPT', authType: 'oauth', nameCustomized: true }))
      .toBe('Personal ChatGPT');
    expect(favoriteProviderDisplayName({ id: 'cline-pass', name: 'Work Cline', authType: 'oauth', nameCustomized: true }))
      .toBe('Work Cline');
  });
});
