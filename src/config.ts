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

  mkdirSync(getAppHome(), { recursive: true, mode: 0o700 });
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

  mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
  writeFileSync(configPath, `${JSON.stringify(legacy, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });

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
  mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

export function loadPreferences(): UserPreferences {
  const config = readConfig();
  const lastProvider =
    config.lastProvider === 'opencode' ? 'zen' : config.lastProvider;
  return {
    lastBackend: config.lastBackend,
    lastModel: config.lastModel,
    lastProvider,
    lastCodexProvider: config.lastCodexProvider,
    lastCodexModel: config.lastCodexModel,
    lastGeminiProvider: config.lastGeminiProvider,
    lastGeminiModel: config.lastGeminiModel,
    lastAntigravityProvider: config.lastAntigravityProvider,
    lastAntigravityModel: config.lastAntigravityModel,
    recentModelsByProvider: config.recentModelsByProvider,
    favoriteModels: config.favoriteModels,
    antigravityCliFavoriteModels: config.antigravityCliFavoriteModels,
    antigravityCliFavoritesHintShown: config.antigravityCliFavoritesHintShown,
    server: config.server,
  };
}

export function savePreferences(prefs: Partial<Pick<UserPreferences, 'lastBackend' | 'lastModel' | 'lastProvider' | 'lastCodexProvider' | 'lastCodexModel' | 'lastGeminiProvider' | 'lastGeminiModel' | 'lastAntigravityProvider' | 'lastAntigravityModel' | 'recentModelsByProvider' | 'favoriteModels' | 'antigravityCliFavoriteModels' | 'antigravityCliFavoritesHintShown'>>): void {
  const config = readConfig();
  if (prefs.lastBackend !== undefined) config.lastBackend = prefs.lastBackend;
  if (prefs.lastModel !== undefined) config.lastModel = prefs.lastModel;
  if (prefs.lastProvider !== undefined) config.lastProvider = prefs.lastProvider;
  if (prefs.lastCodexProvider !== undefined) config.lastCodexProvider = prefs.lastCodexProvider;
  if (prefs.lastCodexModel !== undefined) config.lastCodexModel = prefs.lastCodexModel;
  if (prefs.lastGeminiProvider !== undefined) config.lastGeminiProvider = prefs.lastGeminiProvider;
  if (prefs.lastGeminiModel !== undefined) config.lastGeminiModel = prefs.lastGeminiModel;
  if (prefs.lastAntigravityProvider !== undefined) config.lastAntigravityProvider = prefs.lastAntigravityProvider;
  if (prefs.lastAntigravityModel !== undefined) config.lastAntigravityModel = prefs.lastAntigravityModel;
  if (prefs.recentModelsByProvider !== undefined) config.recentModelsByProvider = prefs.recentModelsByProvider;
  if (prefs.favoriteModels !== undefined) config.favoriteModels = prefs.favoriteModels;
  if (prefs.antigravityCliFavoriteModels !== undefined) config.antigravityCliFavoriteModels = prefs.antigravityCliFavoriteModels;
  if (prefs.antigravityCliFavoritesHintShown !== undefined) config.antigravityCliFavoritesHintShown = prefs.antigravityCliFavoritesHintShown;
  writeConfig(config);
}

const MAX_RECENT_MODELS = 3;

export function recordLaunchSelection(
  agent: 'claude' | 'codex' | 'gemini',
  providerId: string,
  modelId: string,
  prefs: UserPreferences,
): void {
  const prevRecent = prefs.recentModelsByProvider?.[providerId] ?? [];
  const updatedRecent = [modelId, ...prevRecent.filter(id => id !== modelId)].slice(0, MAX_RECENT_MODELS);
  savePreferences({
    ...(agent === 'claude'
      ? { lastProvider: providerId, lastModel: modelId }
      : agent === 'codex'
      ? { lastCodexProvider: providerId, lastCodexModel: modelId }
      : { lastGeminiProvider: providerId, lastGeminiModel: modelId }),
    recentModelsByProvider: { ...prefs.recentModelsByProvider, [providerId]: updatedRecent },
  });
}

const SERVER_PASSWORD_SERVICE = 'relay-ai-server-password';
const SERVER_PASSWORD_ACCOUNT = 'server-password';

async function getServerPasswordKeyring(): Promise<any | null> {
  try {
    const { Entry } = await import('@napi-rs/keyring');
    return new Entry(SERVER_PASSWORD_SERVICE, SERVER_PASSWORD_ACCOUNT);
  } catch {
    return null;
  }
}

export async function getSavedServerPassword(): Promise<string | null> {
  const config = readConfig();
  if (config.server?.savedPassword) {
    const pwd = config.server.savedPassword;
    const keyring = await getServerPasswordKeyring();
    if (keyring) {
      try {
        await keyring.setPassword(pwd);
        delete config.server.savedPassword;
        if (Object.keys(config.server).length === 0) delete config.server;
        writeConfig(config);
      } catch {
        // Fallback: keep in config.json if keyring fails
      }
    }
    return pwd;
  }

  const keyring = await getServerPasswordKeyring();
  if (keyring) {
    try {
      return await keyring.getPassword();
    } catch {
      return null;
    }
  }
  return null;
}

export async function setSavedServerPassword(password: string): Promise<void> {
  const keyring = await getServerPasswordKeyring();
  if (keyring) {
    try {
      await keyring.setPassword(password);
      return;
    } catch {
      // Fallback
    }
  }
  const config = readConfig();
  config.server = {
    ...(config.server ?? {}),
    savedPassword: password,
  };
  writeConfig(config);
}

export async function clearSavedServerPassword(): Promise<void> {
  const keyring = await getServerPasswordKeyring();
  if (keyring) {
    try {
      await keyring.deletePassword();
    } catch {
      // Ignore
    }
  }
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
