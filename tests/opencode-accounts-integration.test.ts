// Second (and third) OpenCode Zen + Go accounts — real registry + real credential code, fake keychain.
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
vi.mock('../src/registry/refresh-models.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/registry/refresh-models.js')>()),
  refreshProviderModels: vi.fn(async (id: string) => ({ id, name: id, ok: true, modelCount: 3 })),
}));

import { addOpencodeCloudFromApiKey, removeProviderFromRegistry } from '../src/registry/crud.js';
import { addProviderFromTemplate } from '../src/registry/add-template.js';
import { loadRegistry, saveRegistry } from '../src/registry/io.js';
import { loadRegistryProviders } from '../src/registry/load.js';
import { getTemplateById } from '../src/provider-templates.js';
import { invalidateKeyringReadCache, resolveProviderCredential } from '../src/env.js';

const ENV_VARS = ['OPENCODE_API_KEY', 'RELAY_AI_KEY_ZEN', 'RELAY_AI_KEY_GO', 'RELAY_AI_KEY_ZEN_2', 'RELAY_AI_KEY_GO_2'];

describe('second OpenCode Zen + Go account, end to end', () => {
  const prevHome = process.env.RELAY_AI_HOME;
  const prevEnv = Object.fromEntries(ENV_VARS.map(v => [v, process.env[v]]));
  let home: string;

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'relay-ai-opencode-accounts-'));
    process.env.RELAY_AI_HOME = home;
    state.store.clear();
    invalidateKeyringReadCache();
    for (const v of ENV_VARS) delete process.env[v];
    expect((await addOpencodeCloudFromApiKey('key-one')).added).toBe(true);
  });
  afterEach(() => {
    if (prevHome === undefined) delete process.env.RELAY_AI_HOME;
    else process.env.RELAY_AI_HOME = prevHome;
    for (const v of ENV_VARS) {
      if (prevEnv[v] === undefined) delete process.env[v];
      else process.env[v] = prevEnv[v];
    }
    rmSync(home, { recursive: true, force: true });
  });

  const providers = () => loadRegistry().providers.map(p => [p.id, p.name, p.authRef]);

  it('the first account is unchanged: both providers share the global OpenCode key', () => {
    expect(providers()).toEqual([
      ['zen', 'OpenCode Zen', 'keyring:global:opencode'],
      ['go', 'OpenCode Go', 'keyring:global:opencode'],
    ]);
    expect(state.store.get('global:opencode')).toBe('key-one');
  });

  it('a second key creates a numbered Zen + Go pair that share one keychain item of their own', async () => {
    const result = await addOpencodeCloudFromApiKey('key-two', { addAccount: true });
    expect(result).toMatchObject({ added: true, modelCount: 6, addedNames: ['OpenCode Zen 2', 'OpenCode Go 2'] });

    expect(providers()).toEqual([
      ['zen', 'OpenCode Zen', 'keyring:global:opencode'],
      ['go', 'OpenCode Go', 'keyring:global:opencode'],
      ['zen-2', 'OpenCode Zen 2', 'keyring:provider:opencode-2'],
      ['go-2', 'OpenCode Go 2', 'keyring:provider:opencode-2'],
    ]);
    expect(state.store.get('provider:opencode-2')).toBe('key-two');
    expect(state.store.get('global:opencode')).toBe('key-one');     // first account untouched
    expect(process.env.OPENCODE_API_KEY).toBe('key-one');           // and the session key is not replaced
  });

  it('each account resolves its own key, and the second never falls back to the first', async () => {
    await addOpencodeCloudFromApiKey('key-two', { addAccount: true });
    // The model refresh is mocked, so give every provider one model for it to be loaded.
    const registry = loadRegistry();
    for (const p of registry.providers) {
      p.modelsCache = { fetchedAt: 'now', models: [{ id: 'm', name: 'M', upstreamModelId: 'm', family: 'x', brand: 'X', modelFormat: 'openai', npm: '@ai-sdk/openai-compatible' }] };
    }
    saveRegistry(registry);
    const loaded = await loadRegistryProviders();
    expect(loaded.map(p => [p.id, p.apiKey])).toEqual([
      ['zen', 'key-one'], ['go', 'key-one'], ['zen-2', 'key-two'], ['go-2', 'key-two'],
    ]);

    state.store.delete('provider:opencode-2');
    invalidateKeyringReadCache();
    expect(await resolveProviderCredential('zen-2', 'keyring:provider:opencode-2')).toBeNull();
    expect(await resolveProviderCredential('go-2', 'keyring:provider:opencode-2')).toBeNull();
  });

  it('refuses the same key twice (against the first account and against a later one)', async () => {
    const dupOfFirst = await addOpencodeCloudFromApiKey('key-one', { addAccount: true });
    expect(dupOfFirst).toMatchObject({ added: false, error: expect.stringContaining('already saved as "OpenCode Zen"') });
    expect(loadRegistry().providers).toHaveLength(2);

    await addOpencodeCloudFromApiKey('key-two', { addAccount: true });
    const dupOfSecond = await addOpencodeCloudFromApiKey('key-two', { addAccount: true });
    expect(dupOfSecond.added).toBe(false);
    expect(loadRegistry().providers).toHaveLength(4);
  });

  it('a third key makes zen-3 / go-3 with its own item', async () => {
    await addOpencodeCloudFromApiKey('key-two', { addAccount: true });
    await addOpencodeCloudFromApiKey('key-three', { addAccount: true });
    expect(providers().slice(4)).toEqual([
      ['zen-3', 'OpenCode Zen 3', 'keyring:provider:opencode-3'],
      ['go-3', 'OpenCode Go 3', 'keyring:provider:opencode-3'],
    ]);
    expect(state.store.get('provider:opencode-3')).toBe('key-three');
  });

  it('the second pair keeps working after its first member is removed; the key goes with the last one', async () => {
    await addOpencodeCloudFromApiKey('key-two', { addAccount: true });

    const first = await removeProviderFromRegistry('zen-2');
    expect(first.credentialDeleted).toBe(false);                    // go-2 still uses it
    expect(state.store.get('provider:opencode-2')).toBe('key-two');

    const last = await removeProviderFromRegistry('go-2');
    expect(last.credentialDeleted).toBe(true);
    expect(state.store.has('provider:opencode-2')).toBe(false);
    expect(state.store.get('global:opencode')).toBe('key-one');
  });

  it('a plain add (no second account) is still refused when Zen/Go already exist', async () => {
    const result = await addOpencodeCloudFromApiKey('key-two');
    expect(result).toMatchObject({ added: false, error: expect.stringMatching(/already configured/i) });
  });

  it('works through the template add path used by the CLI menu and the web UI', async () => {
    const result = await addProviderFromTemplate(getTemplateById('zen')!, 'key-two', { addAccount: true });
    expect(result).toMatchObject({ added: true, addedNames: ['OpenCode Zen 2', 'OpenCode Go 2'] });
    expect(loadRegistry().providers.map(p => p.id)).toEqual(['zen', 'go', 'zen-2', 'go-2']);
  });
});
