// src/registry/crud.ts — add/remove providers in the native registry

import {
  parseAuthRef,
  deleteProviderCredential,
  readGlobalOpencodeCredential,
  resolveProviderCredential,
  saveProviderCredential,
  saveToCredentialStore,
} from '../env.js';
import { goRegistryStub, zenRegistryStub } from './builtins.js';
import { loadRegistry, saveRegistry } from './io.js';
import { findProviderNameConflict, normalizeProviderName, uniqueProviderName, validateProviderName } from './provider-name.js';
import { providerKind } from './provider-kind.js';
import { MODEL_KINDS, type ModelKind } from './model-kind.js';
import { getProviderModels, isValidContextWindow, MAX_CONTEXT_WINDOW_OVERRIDE, MIN_CONTEXT_WINDOW_OVERRIDE } from './provider-models.js';
import { refreshProviderModels } from './refresh-models.js';
import type { RegistryProvider, RegistrySubscriptionFilter } from './types.js';

export interface RemoveProviderResult {
  removed: boolean;
  id: string;
  name?: string;
  credentialDeleted: boolean;
  error?: string;
}

function credentialStillReferenced(authRef: string, remaining: RegistryProvider[]): boolean {
  return remaining.some(p => p.authRef === authRef);
}

/** Remove a provider from the registry; delete per-provider keychain entry when safe. */
export async function removeProviderFromRegistry(
  id: string,
  opts?: { deleteCredential?: boolean },
): Promise<RemoveProviderResult> {
  const registry = loadRegistry();
  const index = registry.providers.findIndex(p => p.id === id);
  if (index < 0) {
    return { removed: false, id, credentialDeleted: false, error: `Provider not found: ${id}` };
  }

  const [removedProvider] = registry.providers.splice(index, 1);
  saveRegistry(registry);

  let credentialDeleted = false;
  if (opts?.deleteCredential !== false) {
    const parsed = parseAuthRef(removedProvider.authRef);
    // Zen + Go share one key (the global one, or `opencode-N` for a numbered pair): it goes with the last user.
    const shouldDelete = !credentialStillReferenced(removedProvider.authRef, registry.providers);
    if (shouldDelete && parsed?.kind === 'keyring') {
      credentialDeleted = await deleteProviderCredential(removedProvider.authRef);
    }
  }

  return {
    removed: true,
    id,
    name: removedProvider.name,
    credentialDeleted,
  };
}

export interface RenameProviderResult {
  renamed: boolean;
  id: string;
  name?: string;
  error?: string;
}

/** Change only the display name. The id, credential reference and models never change. */
export function renameProvider(id: string, newName: string): RenameProviderResult {
  const registry = loadRegistry();
  const provider = registry.providers.find(p => p.id === id);
  if (!provider) return { renamed: false, id, error: `Provider not found: ${id}` };

  const invalid = validateProviderName(newName);
  if (invalid) return { renamed: false, id, error: invalid };

  const name = normalizeProviderName(newName);
  if (name === provider.name) return { renamed: false, id, error: 'Nothing to change.' };

  const clash = findProviderNameConflict(registry.providers, name, id);
  if (clash) {
    return { renamed: false, id, error: `The name "${clash.name}" is already used by another provider.` };
  }

  provider.name = name;
  provider.nameCustomized = true;
  saveRegistry(registry);
  return { renamed: true, id, name };
}

export type SetModelHiddenResult = { ok: true; hidden: boolean } | { ok: false; error: string };

/** Hide or show one model of a provider everywhere Relay lists models. Survives model refreshes. */
export function setModelHidden(providerId: string, modelId: string, hidden: boolean): SetModelHiddenResult {
  const registry = loadRegistry();
  const provider = registry.providers.find(p => p.id === providerId);
  if (!provider) return { ok: false, error: `Provider not found: ${providerId}` };
  if (!getProviderModels(provider).some(m => m.id === modelId)) {
    return { ok: false, error: `Model not found: ${modelId}` };
  }
  const ids = new Set(provider.hiddenModelIds ?? []);
  if (hidden) ids.add(modelId);
  else ids.delete(modelId);
  if (ids.size > 0) provider.hiddenModelIds = [...ids];
  else delete provider.hiddenModelIds;
  saveRegistry(registry);
  return { ok: true, hidden };
}

/** Hide or show several models of one provider in a single save. Unknown ids are skipped. */
export function setModelsHidden(providerId: string, modelIds: string[], hidden: boolean): { ok: true; changed: number } | { ok: false; error: string } {
  const registry = loadRegistry();
  const provider = registry.providers.find(p => p.id === providerId);
  if (!provider) return { ok: false, error: `Provider not found: ${providerId}` };
  const known = new Set(getProviderModels(provider).map(m => m.id));
  const ids = new Set(provider.hiddenModelIds ?? []);
  let changed = 0;
  for (const id of modelIds) {
    if (!known.has(id) || ids.has(id) === hidden) continue;
    if (hidden) ids.add(id);
    else ids.delete(id);
    changed++;
  }
  if (changed === 0) return { ok: true, changed };
  if (ids.size > 0) provider.hiddenModelIds = [...ids];
  else delete provider.hiddenModelIds;
  saveRegistry(registry);
  return { ok: true, changed };
}

/** Remember what a Test found: the server refused chat (notChat) or replied to it. Writes only when it changes. */
export function setModelNotChat(providerId: string, modelId: string, notChat: boolean): void {
  const registry = loadRegistry();
  const provider = registry.providers.find(p => p.id === providerId);
  if (!provider) return;
  const nonChat = new Set(provider.nonChatModelIds ?? []);
  const chat = new Set(provider.chatModelIds ?? []);
  if (nonChat.has(modelId) === notChat && chat.has(modelId) === !notChat) return;
  if (notChat) { nonChat.add(modelId); chat.delete(modelId); }
  else { nonChat.delete(modelId); chat.add(modelId); }
  if (nonChat.size > 0) provider.nonChatModelIds = [...nonChat];
  else delete provider.nonChatModelIds;
  if (chat.size > 0) provider.chatModelIds = [...chat];
  else delete provider.chatModelIds;
  saveRegistry(registry);
}

/** Save (or, with null, remove) the type the user picked for a model. */
export function setModelKindOverride(providerId: string, modelId: string, kind: ModelKind | null): { ok: true } | { ok: false; error: string } {
  const registry = loadRegistry();
  const provider = registry.providers.find(p => p.id === providerId);
  if (!provider) return { ok: false, error: `Provider not found: ${providerId}` };
  if (!getProviderModels(provider).some(m => m.id === modelId)) return { ok: false, error: `Model not found: ${modelId}` };
  if (kind !== null && !MODEL_KINDS.includes(kind)) return { ok: false, error: `Unknown model type: ${kind}` };
  const kinds = { ...(provider.modelKindOverrides ?? {}) };
  if (kind === null) delete kinds[modelId];
  else kinds[modelId] = kind;
  if (Object.keys(kinds).length > 0) provider.modelKindOverrides = kinds;
  else delete provider.modelKindOverrides;
  saveRegistry(registry);
  return { ok: true };
}

export type SetContextWindowResult =
  | { ok: true; contextWindow: number | null; source?: 'user' | 'measured' }
  | { ok: false; error: string };

/**
 * Save (or, with null, remove) a model's context size. A measured size never replaces
 * one the user typed. Survives model refreshes because it lives outside modelsCache.
 */
export function setContextWindowOverride(
  providerId: string,
  modelId: string,
  contextWindow: number | null,
  source: 'user' | 'measured' = 'user',
): SetContextWindowResult {
  const registry = loadRegistry();
  const provider = registry.providers.find(p => p.id === providerId);
  if (!provider) return { ok: false, error: `Provider not found: ${providerId}` };
  if (!getProviderModels(provider).some(m => m.id === modelId)) {
    return { ok: false, error: `Model not found: ${modelId}` };
  }
  const overrides = { ...(provider.contextWindowOverrides ?? {}) };
  if (contextWindow === null) {
    delete overrides[modelId];
  } else {
    if (!isValidContextWindow(contextWindow)) {
      return { ok: false, error: `Context size must be a whole number between ${MIN_CONTEXT_WINDOW_OVERRIDE.toLocaleString('en-US')} and ${MAX_CONTEXT_WINDOW_OVERRIDE.toLocaleString('en-US')} tokens.` };
    }
    if (source === 'measured' && overrides[modelId]?.source === 'user') {
      return { ok: true, contextWindow: overrides[modelId]!.contextWindow, source: 'user' };
    }
    overrides[modelId] = { contextWindow, source };
  }
  if (Object.keys(overrides).length > 0) provider.contextWindowOverrides = overrides;
  else delete provider.contextWindowOverrides;
  saveRegistry(registry);
  return contextWindow === null ? { ok: true, contextWindow: null } : { ok: true, contextWindow, source };
}

export function addZenRegistryStub(opts?: {
  subscriptionFilter?: RegistrySubscriptionFilter;
}): { added: boolean; reason?: string } {
  const registry = loadRegistry();
  if (registry.providers.some(p => p.id === 'zen')) {
    return { added: false, reason: 'OpenCode Zen is already configured.' };
  }
  registry.providers.push(zenRegistryStub(opts?.subscriptionFilter));
  saveRegistry(registry);
  return { added: true };
}

export function addGoRegistryStub(): { added: boolean; reason?: string } {
  const registry = loadRegistry();
  if (registry.providers.some(p => p.id === 'go')) {
    return { added: false, reason: 'OpenCode Go is already configured.' };
  }
  registry.providers.push(goRegistryStub());
  saveRegistry(registry);
  return { added: true };
}

/**
 * Seed Zen/Go when an OpenCode cloud key exists but the registry is empty
 * (Docker / fresh RELAY_AI_HOME). Also fills empty modelsCache entries.
 */
export async function ensureOpencodeCloudProviders(
  hasOpencodeKey?: () => Promise<boolean>,
): Promise<{ seeded: boolean; refreshed: string[] }> {
  const hasKey = hasOpencodeKey
    ? await hasOpencodeKey()
    : Boolean(await readGlobalOpencodeCredential());
  if (!hasKey) return { seeded: false, refreshed: [] };

  const zenAdded = addZenRegistryStub({ subscriptionFilter: 'free' }).added;
  const goAdded = addGoRegistryStub().added;
  const seeded = zenAdded || goAdded;

  const refreshed: string[] = [];
  for (const id of ['zen', 'go'] as const) {
    const registry = loadRegistry();
    const provider = registry.providers.find(p => p.id === id);
    if (!provider || (provider.modelsCache?.models.length ?? 0) > 0) continue;
    const key = await resolveProviderCredential(provider.id, provider.authRef);
    const result = await refreshProviderModels(provider.id, key, registry);
    if (result.ok && !result.skipped) refreshed.push(id);
  }

  return { seeded, refreshed };
}

/**
 * Add OpenCode Zen + Go from an API key (UI / CLI shared path).
 * Zen/Go use fixed OpenCode backends — not a user-supplied base URL.
 */
export async function addOpencodeCloudFromApiKey(apiKey: string, opts?: { addAccount?: boolean }): Promise<{
  added: boolean;
  modelCount?: number;
  addedNames?: string[];
  error?: string;
  hint?: string;
}> {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    return { added: false, error: 'API key cannot be empty.' };
  }
  if (opts?.addAccount) return addOpencodeCloudAccount(trimmed);

  const saved = await saveToCredentialStore(trimmed);
  if (!saved) {
    return {
      added: false,
      error: 'Could not save API key.',
      hint: 'Ensure RELAY_AI_HOME is writable (Docker uses secrets.json when no OS keyring).',
    };
  }
  process.env['OPENCODE_API_KEY'] = trimmed;

  const zenStub = addZenRegistryStub();
  const goStub = addGoRegistryStub();
  if (!zenStub.added && !goStub.added) {
    return {
      added: false,
      error: 'OpenCode Zen / Go is already configured.',
      hint: 'Remove zen or go first, or use Refresh on the provider cards.',
    };
  }

  const registry = loadRegistry();
  const refreshResults = [
    await refreshProviderModels('zen', trimmed, registry),
    await refreshProviderModels('go', trimmed, registry),
  ];
  const modelCount = refreshResults.reduce((total, result) => total + (result.modelCount ?? 0), 0);
  const failed = refreshResults.filter(result => !result.ok);

  return {
    added: true,
    modelCount,
    ...(failed.length > 0
      ? {
          hint: `Providers added, but ${failed.length} catalog refresh${failed.length === 1 ? '' : 'es'} failed — try Refresh on the provider card.`,
        }
      : {}),
  };
}

/**
 * A second (third, …) OpenCode key: a numbered Zen + Go pair (`zen-2` + `go-2`) that share their own
 * keychain item. The first account and its global key are never touched, and a numbered account never
 * reads the global key.
 */
async function addOpencodeCloudAccount(key: string): Promise<{
  added: boolean;
  modelCount?: number;
  addedNames?: string[];
  error?: string;
  hint?: string;
}> {
  const registry = loadRegistry();
  for (const other of registry.providers) {
    const kind = providerKind(other.id);
    if (kind !== 'zen' && kind !== 'go') continue;
    if ((await resolveProviderCredential(other.id, other.authRef)) === key) {
      return {
        added: false,
        error: `This key is already saved as "${other.name}".`,
        hint: 'Use "Change API key" on that provider, or add a different key.',
      };
    }
  }

  const taken = new Set(registry.providers.map(p => p.id));
  let n = 2;
  while (taken.has(`zen-${n}`) || taken.has(`go-${n}`)) n++;
  const authRef = `keyring:provider:opencode-${n}`;
  const zenName = uniqueProviderName(registry.providers, 'OpenCode Zen');
  const goName = uniqueProviderName(registry.providers, 'OpenCode Go');

  if (!(await saveProviderCredential(authRef, key))) {
    return {
      added: false,
      error: 'Could not save API key.',
      hint: 'Ensure RELAY_AI_HOME is writable (Docker uses secrets.json when no OS keyring).',
    };
  }

  registry.providers.push(
    zenRegistryStub(undefined, { id: `zen-${n}`, name: zenName, authRef, nameCustomized: true }),
    goRegistryStub({ id: `go-${n}`, name: goName, authRef, nameCustomized: true }),
  );
  saveRegistry(registry);

  const fresh = loadRegistry();
  const refreshResults = [
    await refreshProviderModels(`zen-${n}`, key, fresh),
    await refreshProviderModels(`go-${n}`, key, fresh),
  ];
  const failed = refreshResults.filter(result => !result.ok);
  return {
    added: true,
    modelCount: refreshResults.reduce((total, result) => total + (result.modelCount ?? 0), 0),
    addedNames: [zenName, goName],
    ...(failed.length > 0
      ? {
          hint: `Accounts added, but ${failed.length} catalog refresh${failed.length === 1 ? '' : 'es'} failed — try Refresh on the provider card.`,
        }
      : {}),
  };
}

export function setRegistrySubscriptionFilter(
  providerId: 'zen' | 'go',
  filter: RegistrySubscriptionFilter,
): void {
  const registry = loadRegistry();
  const provider = registry.providers.find(p => p.id === providerId);
  if (!provider) return;
  provider.subscriptionFilter = filter;
  saveRegistry(registry);
}

export function toggleProviderEnabled(id: string): { toggled: boolean; enabled?: boolean; error?: string } {
  const registry = loadRegistry();
  const provider = registry.providers.find(p => p.id === id);
  if (!provider) return { toggled: false, error: `Provider not found: ${id}` };
  provider.enabled = !provider.enabled;
  saveRegistry(registry);
  return { toggled: true, enabled: provider.enabled };
}
