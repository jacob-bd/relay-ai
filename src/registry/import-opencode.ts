// src/registry/import-opencode.ts — one-shot import from OpenCode serve API

import { resolveProviderCredential, saveProviderCredential } from '../env.js';
import { fetchRawOpencodeProviders } from '../opencode-serve.js';
import type { LocalProvider } from '../types.js';
import { localProviderToRegistry } from './convert.js';
import {
  buildImportProviderList,
  isOAuthImportProvider,
  listCredentialSkippedProviders,
  type CredentialGapReason,
  oauthAuthRef,
  type OAuthImportContext,
} from './import-build.js';
import { loadRegistry, saveRegistry } from './io.js';
import { migrateLegacyCloudProviders } from './migrate.js';
import { readOpencodeAuthFile, oauthCredentialToKeychainJson } from './opencode-auth.js';
import type { RegistryProvider } from './types.js';
import { isValidProviderId } from './validate.js';
import {
  type ImportKeySkipReason,
  validateImportKey,
} from './validate-import-key.js';

export type ImportSkipReason =
  | 'invalid-id'
  | 'no-models'
  | 'convert-failed'
  | 'user-skipped'
  | 'conflict-kept'
  | 'invalid-key'
  | 'placeholder-key'
  | 'credential-save-failed'
  | CredentialGapReason;

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
  oauthImported: number;
  authFileWarning?: string;
  error?: string;
}

export interface ImportOpencodeOptions {
  resolveConflict?: (ctx: ImportConflictContext) => Promise<ImportConflictChoice>;
}

async function saveProviderKey(provider: LocalProvider): Promise<boolean> {
  if (!provider.apiKey?.trim()) return false;
  return saveProviderCredential(`keyring:provider:${provider.id}`, provider.apiKey);
}

async function saveOAuthKey(providerId: string, oauth: OAuthImportContext): Promise<boolean> {
  const cred = oauth.oauthByProviderId.get(providerId);
  if (!cred) return false;
  return saveProviderCredential(oauthAuthRef(providerId), oauthCredentialToKeychainJson(cred));
}

function importValidationSkipReason(
  reason: ImportKeySkipReason | undefined,
): ImportSkipReason {
  if (reason === 'untested-manual') return 'manual-only';
  if (reason === 'placeholder-key') return 'placeholder-key';
  if (reason === 'invalid-key') return 'invalid-key';
  return 'no-api-key';
}

async function keyHint(
  providerId: string,
  authRef: string,
  opts?: { fallbackKey?: string; oauth?: boolean },
): Promise<string> {
  if (opts?.oauth) return 'Signed in via OAuth (OpenCode)';
  const fromStore = await resolveProviderCredential(providerId, authRef);
  const key = fromStore ?? opts?.fallbackKey ?? '';
  if (!key) return 'no key';
  if (key.length <= 5) return '····' + key;
  return '····' + key.slice(-5);
}

export async function importFromOpencode(options: ImportOpencodeOptions = {}): Promise<ImportOpencodeResult> {
  const raw = await fetchRawOpencodeProviders();
  if (raw === null) {
    return {
      imported: [],
      skipped: [],
      keysSkipped: [],
      keysSaved: 0,
      oauthImported: 0,
      error: 'OpenCode CLI not found or failed to start. Install from https://opencode.ai',
    };
  }

  const authFile = readOpencodeAuthFile();
  const authEntries = authFile?.entries ?? {};
  const { providers: fetched, oauth } = buildImportProviderList(raw, authEntries);

  const registry = loadRegistry();
  migrateLegacyCloudProviders(registry);
  const imported: RegistryProvider[] = [];
  const skipped: ImportOpencodeResult['skipped'] = [];
  const keysSkipped: ImportKeySkipped[] = [];
  let keysSaved = 0;
  let oauthImported = 0;
  const importedIds = new Set<string>();

  for (const lp of fetched) {
    if (!lp.models.length) {
      skipped.push({ id: lp.id, name: lp.name, reason: 'no-models' });
      continue;
    }

    const isOAuth = isOAuthImportProvider(lp.id, oauth);
    const entry = localProviderToRegistry(lp, isOAuth
      ? { authType: 'oauth', authRef: oauthAuthRef(lp.id) }
      : undefined);
    if (!entry) {
      skipped.push({
        id: lp.id,
        name: lp.name,
        reason: isValidProviderId(lp.id) ? 'convert-failed' : 'invalid-id',
      });
      continue;
    }

    const keyCheck = await validateImportKey(lp, entry);
    if (!keyCheck.canImport) {
      skipped.push({
        id: lp.id,
        name: lp.name,
        reason: importValidationSkipReason(keyCheck.reason),
      });
      if (keyCheck.detail) {
        keysSkipped.push({
          id: lp.id,
          name: lp.name,
          reason: keyCheck.reason ?? 'invalid-key',
          detail: keyCheck.detail,
        });
      }
      continue;
    }

    const existingIdx = registry.providers.findIndex(p => p.id === entry.id);
    const existing = existingIdx >= 0 ? registry.providers[existingIdx]! : undefined;

    if (existing && options.resolveConflict) {
      const choice = await options.resolveConflict({
        existing,
        incoming: entry,
        incomingProvider: lp,
        existingKeyHint: await keyHint(existing.id, existing.authRef, { oauth: existing.authType === 'oauth' }),
        incomingKeyHint: await keyHint(entry.id, entry.authRef, {
          fallbackKey: lp.apiKey,
          oauth: isOAuth,
        }),
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

    const saved = isOAuth
      ? await saveOAuthKey(lp.id, oauth)
      : await saveProviderKey(lp);
    if (!saved) {
      skipped.push({ id: lp.id, name: lp.name, reason: 'credential-save-failed' });
      continue;
    }

    if (existingIdx >= 0) {
      registry.providers[existingIdx] = { ...entry, addedAt: registry.providers[existingIdx]!.addedAt, manualModels: registry.providers[existingIdx]!.manualModels };
    } else {
      registry.providers.push(entry);
    }
    imported.push(entry);
    importedIds.add(lp.id);
    keysSaved += 1;
    if (isOAuth) oauthImported += 1;
  }

  const alreadyReportedIds = new Set(skipped.map(s => s.id));
  const registryProviderIds = new Set(registry.providers.map(p => p.id));
  for (const provider of listCredentialSkippedProviders(
    raw,
    authEntries,
    importedIds,
    alreadyReportedIds,
    registryProviderIds,
  )) {
    skipped.push({ id: provider.id, name: provider.name, reason: provider.reason });
  }

  registry.importedAt = new Date().toISOString();
  saveRegistry(registry);

  return {
    imported,
    skipped,
    keysSkipped,
    keysSaved,
    oauthImported,
    authFileWarning: authFile?.permissionWarning,
  };
}
