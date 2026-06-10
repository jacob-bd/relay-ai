import { homedir } from 'node:os';
import { join } from 'node:path';

export const APP_DIR_NAME = 'relay-ai';
export const LEGACY_APP_DIR_NAME = 'opencode-starter';

interface HomeEnv {
  APPDATA?: string;
  HOME?: string;
  RELAY_AI_HOME?: string;
  /** @deprecated Use RELAY_AI_HOME */
  OPENCODE_STARTER_HOME?: string;
  USERPROFILE?: string;
  XDG_CONFIG_HOME?: string;
}

function userHome(env: HomeEnv = process.env): string {
  return env.HOME ?? env.USERPROFILE ?? homedir();
}

export function resolveAppHomeOverride(env: HomeEnv = process.env): string | undefined {
  const override = env.RELAY_AI_HOME ?? env.OPENCODE_STARTER_HOME;
  return override?.trim() || undefined;
}

export function getAppHome(env: HomeEnv = process.env): string {
  const override = resolveAppHomeOverride(env);
  if (override) return override;
  return join(userHome(env), `.${APP_DIR_NAME}`);
}

export function getLegacyAppHome(env: HomeEnv = process.env): string {
  return join(userHome(env), `.${LEGACY_APP_DIR_NAME}`);
}

export function getConfigPath(env: HomeEnv = process.env): string {
  return join(getAppHome(env), 'config.json');
}

export function getProvidersPath(env: HomeEnv = process.env): string {
  return join(getAppHome(env), 'providers.json');
}

export function getLogsPath(env: HomeEnv = process.env): string {
  return join(getAppHome(env), 'logs');
}

export function getVertexModelsPath(env: HomeEnv = process.env): string {
  return join(getAppHome(env), 'vertex-models.json');
}

export function getLegacyConfPath(env: HomeEnv = process.env, platform = process.platform): string {
  const home = userHome(env);
  const appName = `${LEGACY_APP_DIR_NAME}-nodejs`;

  if (platform === 'darwin') {
    return join(home, 'Library', 'Preferences', appName, 'config.json');
  }

  if (platform === 'win32') {
    return join(env.APPDATA ?? join(home, 'AppData', 'Roaming'), appName, 'Config', 'config.json');
  }

  return join(env.XDG_CONFIG_HOME ?? join(home, '.config'), appName, 'config.json');
}
