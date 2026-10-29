// Real registry + real credential store (fake keychain); only the network model fetch is faked.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const state = vi.hoisted(() => ({ store: new Map<string, string>() }));
vi.mock('@napi-rs/keyring', () => ({
  Entry: class {
    #a: string;
    constructor(_s: string, a: string) { this.#a = a; }
    getPassword() { return state.store.get(this.#a) ?? null; }
    setPassword(v: string) { state.store.set(this.#a, v); }
    deletePassword() { state.store.delete(this.#a); }
  },
}));
vi.mock('../src/registry/fetch-template-models.js', () => ({
  fetchTemplateModels: vi.fn(async () => ({
    models: [{ id: 'llama-3.3-70b', name: 'Llama', upstreamModelId: 'llama-3.3-70b', family: 'llama', brand: 'Meta', modelFormat: 'openai', npm: '@ai-sdk/groq' }],
    baseUrl: 'https://api.groq.com/openai/v1',
  })),
}));
vi.mock('../src/registry/pricing.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/registry/pricing.js')>()),
  enrichPricingAsync: vi.fn(),
}));

import { addProviderFromTemplate } from '../src/registry/add-template.js';
import { loadRegistryProviders } from '../src/registry/load.js';
import { removeProviderFromRegistry, renameProvider } from '../src/registry/crud.js';
import { getTemplateById } from '../src/provider-templates.js';
import { invalidateKeyringReadCache } from '../src/env.js';

describe('two Groq accounts, end to end', () => {
  const prev = process.env.RELAY_AI_HOME;
  let home: string;
  const groq = getTemplateById('groq')!;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'relay-ai-api-accounts-'));
    process.env.RELAY_AI_HOME = home;
    state.store.clear();
    invalidateKeyringReadCache();
    for (const v of ['RELAY_AI_KEY_GROQ', 'RELAY_AI_KEY_GROQ_2', 'GROQ_API_KEY']) delete process.env[v];
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.RELAY_AI_HOME;
    else process.env.RELAY_AI_HOME = prev;
    rmSync(home, { recursive: true, force: true });
  });

  it('keeps each account with its own key, name and models; rename and remove touch only that account', async () => {
    expect((await addProviderFromTemplate(groq, 'key-personal')).added).toBe(true);
    const second = await addProviderFromTemplate(groq, 'key-work', { addAccount: true });
    expect(second).toMatchObject({ added: true, provider: { id: 'groq-2', name: 'Groq 2', authRef: 'keyring:provider:groq-2' } });
    expect([...state.store.entries()].filter(([k]) => k.startsWith('provider:'))).toEqual([
      ['provider:groq', 'key-personal'],
      ['provider:groq-2', 'key-work'],
    ]);

    const loaded = await loadRegistryProviders();
    expect(loaded.map(p => [p.id, p.name, p.apiKey])).toEqual([
      ['groq', 'Groq', 'key-personal'],
      ['groq-2', 'Groq 2', 'key-work'],
    ]);
    expect(loaded.every(p => p.models.length === 1)).toBe(true);

    expect(renameProvider('groq-2', 'Work Groq').renamed).toBe(true);
    expect(renameProvider('groq', 'work groq').renamed).toBe(false);   // names stay unique
    expect((await loadRegistryProviders()).map(p => p.name)).toEqual(['Groq', 'Work Groq']);

    const removed = await removeProviderFromRegistry('groq-2');
    expect(removed.credentialDeleted).toBe(true);
    expect([...state.store.keys()].filter(k => k.startsWith('provider:'))).toEqual(['provider:groq']);
    invalidateKeyringReadCache();
    expect((await loadRegistryProviders()).map(p => [p.id, p.apiKey])).toEqual([['groq', 'key-personal']]);
  });

  it('refuses to save the same key twice for the same server', async () => {
    await addProviderFromTemplate(groq, 'same-key');
    const again = await addProviderFromTemplate(groq, 'same-key', { addAccount: true });
    expect(again.added).toBe(false);
    expect(again.error).toMatch(/already saved as "Groq"/);
    expect([...state.store.keys()].filter(k => k.startsWith('provider:'))).toEqual(['provider:groq']);
  });
});
