// src/registry/import-opencode.ts — one-shot import from OpenCode serve API

import { deleteProviderCredential, resolveProviderCredential, saveProviderCredential } from '../env.js';
import { fetchLocalProviders } from '../providers.js';
import type { LocalProvider } from '../types.js';
import { localProviderToRegistry } from './convert.js';
import { loadRegistry, saveRegistry } from './io.js';
import type { RegistryProvider } from './types.js';
import { isValidProviderId } from './validate.js';
import {
  type ImportKeySkipReason,
  validateImportKey,
} from './validate-import-key.js';

export type ImportSkipReason = 'invalid-id' | 'no-models' | 'convert-failed' | 'user-skipped' | 'conflict-kept';

export interface ImportKeySkipped {
  id: string;
  name: string;
  reason: ImportKeySkipReason;
  detail?: string;
}

export interface ImportConflictContext {
  existing: RegistryProvider;
  incoming: RegistryProvider;
  incomingProvider: LocalProvider;
  existingKeyHint: string;
  incomingKeyHint: string;
}

export type ImportConflictChoice = 'keep' | 'import' | 'skip';

export interface ImportOpencodeResult {
  imported: RegistryProvider[];
  skipped: Array<{ id: string; name: string; reason: ImportSkipReason }>;
  keysSkipped: ImportKeySkipped[];
  keysSaved: number;
  error?: string;
}

export interface ImportOpencodeOptions {
  resolveConflict?: (ctx: ImportConflictContext) => Promise<ImportConflictChoice>;
}

async function saveProviderKey(provider: LocalProvider): Promise<boolean> {
  if (!provider.apiKey?.trim()) return false;
  return saveProviderCredential(`keyring:provider:${provider.id}`, provider.apiKey);
}

async function keyHint(providerId: string, authRef: string, fallbackKey?: string): Promise<string> {
  const fromStore = await resolveProviderCredential(providerId, authRef);
  const key = fromStore ?? fallbackKey ?? '';
  if (!key) return 'no key';
  if (key.length <= 5) return '····' + key;
  return '····' + key.slice(-5);
}

export async function importFromOpencode(options: ImportOpencodeOptions = {}): Promise<ImportOpencodeResult> {
  const fetched = await fetchLocalProviders();
  if (fetched === null) {
    return {
      imported: [],
      skipped: [],
      keysSkipped: [],
      keysSaved: 0,
      error: 'OpenCode CLI not found or failed to start. Install from https://opencode.ai',
    };
  }

  const registry = loadRegistry();
  const imported: RegistryProvider[] = [];
  const skipped: ImportOpencodeResult['skipped'] = [];
  const keysSkipped: ImportKeySkipped[] = [];
  let keysSaved = 0;

  for (const lp of fetched) {
    if (!lp.models.length) {
      skipped.push({ id: lp.id, name: lp.name, reason: 'no-models' });
      continue;
    }
    const entry = localProviderToRegistry(lp);
    if (!entry) {
      skipped.push({
        id: lp.id,
        name: lp.name,
        reason: isValidProviderId(lp.id) ? 'convert-failed' : 'invalid-id',
      });
      continue;
    }

    const existingIdx = registry.providers.findIndex(p => p.id === entry.id);
    const existing = existingIdx >= 0 ? registry.providers[existingIdx]! : undefined;

    if (existing && options.resolveConflict) {
      const choice = await options.resolveConflict({
        existing,
        incoming: entry,
        incomingProvider: lp,
        existingKeyHint: await keyHint(existing.id, existing.authRef),
        incomingKeyHint: await keyHint(entry.id, entry.authRef, lp.apiKey),
      });

      if (choice === 'skip') {
        skipped.push({ id: lp.id, name: lp.name, reason: 'user-skipped' });
        continue;
      }
      if (choice === 'keep') {
        skipped.push({ id: lp.id, name: lp.name, reason: 'conflict-kept' });
        continue;
      }
    }

    if (existingIdx >= 0) {
      registry.providers[existingIdx] = { ...entry, addedAt: registry.providers[existingIdx]!.addedAt };
    } else {
      registry.providers.push(entry);
    }
    imported.push(entry);

    const keyCheck = await validateImportKey(lp, entry);
    if (keyCheck.shouldSaveKey) {
      if (await saveProviderKey(lp)) keysSaved += 1;
    } else if (keyCheck.reason) {
      keysSkipped.push({
        id: lp.id,
        name: lp.name,
        reason: keyCheck.reason,
        detail: keyCheck.detail,
      });
      // Drop stale Keychain entries so a prior placeholder import cannot keep working.
      await deleteProviderCredential(entry.authRef);
    }
  }

  registry.importedAt = new Date().toISOString();
  saveRegistry(registry);

  return { imported, skipped, keysSkipped, keysSaved };
}
