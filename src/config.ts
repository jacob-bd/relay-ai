import type { UserPreferences, FavoriteModel } from './types.js';
import { dirname, join } from 'node:path';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { getAppHome, getConfigPath, getLegacyAppHome, getLegacyConfPath } from './paths.js';

function readJsonFile(path: string): UserPreferences | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed as UserPreferences : null;
  } catch {
    return null;
  }
}

function ensureAppHomeMigrated(): void {
  const configPath = getConfigPath();
  if (existsSync(configPath)) return;

  const legacyConfig = join(getLegacyAppHome(), 'config.json');
  if (!existsSync(legacyConfig)) return;

  mkdirSync(getAppHome(), { recursive: true });
  copyFileSync(legacyConfig, configPath);

  const legacyVertex = join(getLegacyAppHome(), 'vertex-models.json');
  const vertexPath = join(getAppHome(), 'vertex-models.json');
  if (existsSync(legacyVertex) && !existsSync(vertexPath)) {
    copyFileSync(legacyVertex, vertexPath);
  }
}

function ensureConfigMigrated(): void {
  ensureAppHomeMigrated();

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
  const lastProvider =
    config.lastProvider === 'opencode' ? 'zen' : config.lastProvider;
  return {
    lastBackend: config.lastBackend,
    lastModel: config.lastModel,
    lastProvider,
    recentModelsByProvider: config.recentModelsByProvider,
    favoriteModels: config.favoriteModels,
    server: config.server,
  };
}

export function savePreferences(prefs: Partial<Pick<UserPreferences, 'lastBackend' | 'lastModel' | 'lastProvider' | 'recentModelsByProvider' | 'favoriteModels'>>): void {
  const config = readConfig();
  if (prefs.lastBackend !== undefined) config.lastBackend = prefs.lastBackend;
  if (prefs.lastModel !== undefined) config.lastModel = prefs.lastModel;
  if (prefs.lastProvider !== undefined) config.lastProvider = prefs.lastProvider;
  if (prefs.recentModelsByProvider !== undefined) config.recentModelsByProvider = prefs.recentModelsByProvider;
  if (prefs.favoriteModels !== undefined) config.favoriteModels = prefs.favoriteModels;
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

export function getServerExposedProviders(): string[] | null {
  const list = readConfig().server?.exposedProviders;
  return list && list.length > 0 ? list : null;
}

export function setServerExposedProviders(providerIds: string[]): void {
  const config = readConfig();
  config.server = {
    ...(config.server ?? {}),
    exposedProviders: providerIds,
  };
  writeConfig(config);
}

export function getServerMaskGatewayIds(): boolean {
  return readConfig().server?.maskGatewayIds ?? true;
}

export function setServerMaskGatewayIds(mask: boolean): void {
  const config = readConfig();
  config.server = {
    ...(config.server ?? {}),
    maskGatewayIds: mask,
  };
  writeConfig(config);
}

export function getServerFavoritesOnly(): boolean {
  return readConfig().server?.favoritesOnly ?? false;
}

export function setServerFavoritesOnly(favoritesOnly: boolean): void {
  const config = readConfig();
  config.server = {
    ...(config.server ?? {}),
    favoritesOnly,
  };
  writeConfig(config);
}
