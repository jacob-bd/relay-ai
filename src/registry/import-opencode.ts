// src/registry/import-opencode.ts — one-shot import from OpenCode serve API

import { saveProviderCredential } from '../env.js';
import { fetchLocalProviders } from '../providers.js';
import type { LocalProvider } from '../types.js';
import { localProviderToRegistry } from './convert.js';
import { loadRegistry, saveRegistry } from './io.js';
import type { RegistryProvider } from './types.js';
import { isValidProviderId } from './validate.js';

export type ImportSkipReason = 'invalid-id' | 'no-models' | 'convert-failed';

export interface ImportOpencodeResult {
  imported: RegistryProvider[];
  skipped: Array<{ id: string; name: string; reason: ImportSkipReason }>;
  keysSaved: number;
  error?: string;
}

async function saveProviderKey(provider: LocalProvider): Promise<boolean> {
  if (!provider.apiKey?.trim()) return false;
  return saveProviderCredential(`keyring:provider:${provider.id}`, provider.apiKey);
}

export async function importFromOpencode(): Promise<ImportOpencodeResult> {
  const fetched = await fetchLocalProviders();
  if (fetched === null) {
    return {
      imported: [],
      skipped: [],
      keysSaved: 0,
      error: 'OpenCode CLI not found or failed to start. Install from https://opencode.ai',
    };
  }

  const registry = loadRegistry();
  const imported: RegistryProvider[] = [];
  const skipped: ImportOpencodeResult['skipped'] = [];
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
    if (existingIdx >= 0) {
      registry.providers[existingIdx] = { ...entry, addedAt: registry.providers[existingIdx]!.addedAt };
    } else {
      registry.providers.push(entry);
    }
    imported.push(entry);

    if (await saveProviderKey(lp)) keysSaved += 1;
  }

  registry.importedAt = new Date().toISOString();
  saveRegistry(registry);

  return { imported, skipped, keysSaved };
}
