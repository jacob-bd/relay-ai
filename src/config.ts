import type { UserPreferences, ModelInfo } from './types.js';
import { MODELS_CACHE_TTL_MS } from './constants.js';
import { dirname } from 'node:path';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { getConfigPath, getLegacyConfPath } from './paths.js';

function readJsonFile(path: string): UserPreferences | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed as UserPreferences : null;
  } catch {
    return null;
  }
}

function ensureConfigMigrated(): void {
  const configPath = getConfigPath();
  if (existsSync(configPath)) return;

  const legacyPath = getLegacyConfPath();
  if (!existsSync(legacyPath)) return;

  const legacy = readJsonFile(legacyPath);
  if (!legacy) return;

  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(legacy, null, 2)}\n`, 'utf8');

  try {
    renameSync(legacyPath, `${legacyPath}.migrated`);
  } catch {
    // Migration copy is enough; renaming is best-effort.
  }
}

function readConfig(): UserPreferences {
  ensureConfigMigrated();
  return readJsonFile(getConfigPath()) ?? {};
}

function writeConfig(config: UserPreferences): void {
  const configPath = getConfigPath();
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export function loadPreferences(): UserPreferences {
  const config = readConfig();
  return {
    lastBackend: config.lastBackend,
    lastModel: config.lastModel,
    subscriptionTier: config.subscriptionTier,
    modelListCache: config.modelListCache,
    server: config.server,
  };
}

export function savePreferences(prefs: Partial<Pick<UserPreferences, 'lastBackend' | 'lastModel'>>): void {
  const config = readConfig();
  if (prefs.lastBackend !== undefined) config.lastBackend = prefs.lastBackend;
  if (prefs.lastModel !== undefined) config.lastModel = prefs.lastModel;
  writeConfig(config);
}

export function getCachedModels(backendId: 'zen' | 'go'): ModelInfo[] | null {
  const modelListCache = readConfig().modelListCache;
  const entry = modelListCache?.[backendId];
  if (!entry) return null;
  const age = Date.now() - new Date(entry.fetchedAt).getTime();
  if (age > MODELS_CACHE_TTL_MS) return null;
  return entry.models;
}

export function setCachedModels(backendId: 'zen' | 'go', models: ModelInfo[]): void {
  const config = readConfig();
  config.modelListCache = {
    ...(config.modelListCache ?? {}),
    [backendId]: { models, fetchedAt: new Date().toISOString() },
  };
  writeConfig(config);
}

export function getSubscriptionTier(): 'free' | 'zen' | 'go' | 'both' | null {
  return readConfig().subscriptionTier ?? null;
}

export function setSubscriptionTier(tier: 'free' | 'zen' | 'go' | 'both'): void {
  const config = readConfig();
  config.subscriptionTier = tier;
  writeConfig(config);
}

export function getSavedServerPassword(): string | null {
  return readConfig().server?.savedPassword?.trim() || null;
}

export function setSavedServerPassword(password: string): void {
  const config = readConfig();
  config.server = {
    ...(config.server ?? {}),
    savedPassword: password,
  };
  writeConfig(config);
}

export function clearSavedServerPassword(): void {
  const config = readConfig();
  if (!config.server) return;
  delete config.server.savedPassword;
  if (Object.keys(config.server).length === 0) delete config.server;
  writeConfig(config);
}
