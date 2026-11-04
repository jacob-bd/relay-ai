// src/registry/io.ts — load/save providers.json with secure permissions

import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
  closeSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { getAppHome, getProvidersPath } from '../paths.js';
import type { ProviderRegistry, RegistryProvider } from './types.js';
import { REGISTRY_SCHEMA_VERSION } from './types.js';
import {
  migrateAlibabaDashScopeChinaLabel,
  migrateDuplicateProviderNames,
  migrateLegacyCloudProviders,
  migrateOAuthOpenAiProvider,
  migrateOAuthXaiProvider,
} from './migrate.js';
import { isValidProviderId } from './validate.js';
import { isValidContextWindow, parseManualModel } from './provider-models.js';
import { MODEL_KINDS, type ModelKind } from './model-kind.js';

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

export function ensureSecureAppHome(): void {
  const home = getAppHome();
  mkdirSync(home, { recursive: true, mode: DIR_MODE });
  try {
    chmodSync(home, DIR_MODE);
  } catch {
    // best-effort on platforms that restrict chmod
  }
}

function writeSecureFile(path: string, content: string): void {
  ensureSecureAppHome();
  mkdirSync(dirname(path), { recursive: true, mode: DIR_MODE });
  const fd = openSync(path, 'w', FILE_MODE);
  try {
    writeSync(fd, content);
  } finally {
    closeSync(fd);
  }
  try {
    chmodSync(path, FILE_MODE);
  } catch {
    // best-effort
  }
}

function parseProvider(raw: unknown): RegistryProvider | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.id !== 'string' || !isValidProviderId(p.id)) return null;
  if (typeof p.templateId !== 'string' || !p.templateId) return null;
  if (typeof p.name !== 'string' || !p.name) return null;
  if (typeof p.enabled !== 'boolean') return null;
  if (typeof p.authRef !== 'string' || !p.authRef) return null;
  if (typeof p.addedAt !== 'string' || !p.addedAt) return null;
  const api = p.api;
  if (!api || typeof api !== 'object') return null;

  const provider: RegistryProvider = {
    id: p.id,
    templateId: p.templateId,
    name: p.name,
    enabled: p.enabled,
    authRef: p.authRef,
    api: api as RegistryProvider['api'],
    addedAt: p.addedAt,
  };

  if (p.subscriptionFilter === 'free' || p.subscriptionFilter === 'zen' || p.subscriptionFilter === 'go') {
    provider.subscriptionFilter = p.subscriptionFilter;
  }
  if (p.authType === 'api' || p.authType === 'oauth' || p.authType === 'none') {
    provider.authType = p.authType;
  }
  if (p.nameCustomized === true) provider.nameCustomized = true;
  if (typeof p.refreshedAt === 'string') provider.refreshedAt = p.refreshedAt;
  if (p.modelKindOverrides && typeof p.modelKindOverrides === 'object' && !Array.isArray(p.modelKindOverrides)) {
    const kinds: NonNullable<RegistryProvider['modelKindOverrides']> = {};
    for (const [modelId, kind] of Object.entries(p.modelKindOverrides as Record<string, unknown>)) {
      if (typeof kind === 'string' && (MODEL_KINDS as readonly string[]).includes(kind)) kinds[modelId] = kind as ModelKind;
    }
    if (Object.keys(kinds).length > 0) provider.modelKindOverrides = kinds;
  }
  if (Array.isArray(p.nonChatModelIds)) {
    const ids = p.nonChatModelIds.filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (ids.length > 0) provider.nonChatModelIds = [...new Set(ids)];
  }
  if (Array.isArray(p.chatModelIds)) {
    const ids = p.chatModelIds.filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (ids.length > 0) provider.chatModelIds = [...new Set(ids)];
  }
  if (Array.isArray(p.hiddenModelIds)) {
    const hidden = p.hiddenModelIds.filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (hidden.length > 0) provider.hiddenModelIds = [...new Set(hidden)];
  }
  if (p.modelTestResults && typeof p.modelTestResults === 'object' && !Array.isArray(p.modelTestResults)) {
    const results: NonNullable<RegistryProvider['modelTestResults']> = {};
    for (const [modelId, raw] of Object.entries(p.modelTestResults as Record<string, unknown>)) {
      const r = raw as { ok?: unknown; at?: unknown; latencyMs?: unknown; toolsPassed?: unknown; error?: unknown; transient?: unknown } | null;
      if (!r || typeof r.ok !== 'boolean' || typeof r.at !== 'string' || !modelId) continue;
      results[modelId] = {
        ok: r.ok, at: r.at,
        ...(typeof r.latencyMs === 'number' ? { latencyMs: r.latencyMs } : {}),
        ...(typeof r.toolsPassed === 'boolean' ? { toolsPassed: r.toolsPassed } : {}),
        ...(typeof r.error === 'string' ? { error: r.error.slice(0, 300) } : {}),
        ...(r.transient === true ? { transient: true } : {}),
      };
    }
    if (Object.keys(results).length > 0) provider.modelTestResults = results;
  }
  if (Array.isArray(p.freeModelIds)) {
    const free = p.freeModelIds.filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (free.length > 0) provider.freeModelIds = [...new Set(free)];
  }
  if (p.contextWindowOverrides && typeof p.contextWindowOverrides === 'object' && !Array.isArray(p.contextWindowOverrides)) {
    const overrides: NonNullable<RegistryProvider['contextWindowOverrides']> = {};
    for (const [modelId, raw] of Object.entries(p.contextWindowOverrides as Record<string, unknown>)) {
      const entry = raw as { contextWindow?: unknown; source?: unknown } | null;
      if (!entry || !isValidContextWindow(entry.contextWindow)) continue;
      if (entry.source !== 'user' && entry.source !== 'measured') continue;
      overrides[modelId] = { contextWindow: entry.contextWindow, source: entry.source };
    }
    if (Object.keys(overrides).length > 0) provider.contextWindowOverrides = overrides;
  }
  if (Array.isArray(p.manualModels)) {
    provider.manualModels = p.manualModels.flatMap(raw => {
      const model = parseManualModel(raw);
      return model ? [model] : [];
    });
  }
  if (p.modelsCache && typeof p.modelsCache === 'object') {
    const cache = p.modelsCache as { fetchedAt?: string; models?: unknown[] };
    if (typeof cache.fetchedAt === 'string' && Array.isArray(cache.models)) {
      provider.modelsCache = {
        fetchedAt: cache.fetchedAt,
        models: cache.models.filter(m => m && typeof m === 'object') as RegistryProvider['modelsCache'] extends infer C
          ? C extends { models: infer M } ? M : never
          : never,
      };
    }
  }
  return provider;
}

function parseRegistry(raw: unknown): ProviderRegistry {
  const empty: ProviderRegistry = { schemaVersion: REGISTRY_SCHEMA_VERSION, providers: [] };
  if (!raw || typeof raw !== 'object') return empty;
  const data = raw as Record<string, unknown>;
  const providers: RegistryProvider[] = [];
  if (Array.isArray(data.providers)) {
    for (const entry of data.providers) {
      const parsed = parseProvider(entry);
      if (parsed) providers.push(parsed);
    }
  }
  const registry: ProviderRegistry = {
    schemaVersion:
      typeof data.schemaVersion === 'number' ? data.schemaVersion : REGISTRY_SCHEMA_VERSION,
    providers,
  };
  if (typeof data.importedAt === 'string') registry.importedAt = data.importedAt;
  if (typeof data.pricingCacheAt === 'string') registry.pricingCacheAt = data.pricingCacheAt;
  return registry;
}

export function loadRegistry(path = getProvidersPath(), { persist = true }: { persist?: boolean } = {}): ProviderRegistry {
  if (!existsSync(path)) {
    return { schemaVersion: REGISTRY_SCHEMA_VERSION, providers: [] };
  }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    const registry = parseRegistry(raw);
    let migrated = migrateLegacyCloudProviders(registry);
    if (migrateOAuthOpenAiProvider(registry)) migrated = true;
    if (migrateOAuthXaiProvider(registry)) migrated = true;
    if (migrateAlibabaDashScopeChinaLabel(registry)) migrated = true;
    if (migrateDuplicateProviderNames(registry)) migrated = true;
    // In-memory migrations always run (consumers like the embedded Core API
    // depend on them); persistence is gated so read-only callers never write.
    if (migrated && persist) {
      try {
        saveRegistry(registry, path);
      } catch {
        // Parsed data remains usable even when migration persistence fails.
      }
    }
    return registry;
  } catch {
    return { schemaVersion: REGISTRY_SCHEMA_VERSION, providers: [] };
  }
}

export function saveRegistry(registry: ProviderRegistry, path = getProvidersPath()): void {
  const payload = `${JSON.stringify(registry, null, 2)}\n`;
  const backup = `${path}.bak`;
  if (existsSync(path)) {
    try {
      copyFileSync(path, backup);
    } catch {
      // backup is best-effort
    }
  }
  const tmp = `${path}.tmp`;
  writeSecureFile(tmp, payload);
  renameSync(tmp, path);
}

export function emptyRegistry(): ProviderRegistry {
  return { schemaVersion: REGISTRY_SCHEMA_VERSION, providers: [] };
}
