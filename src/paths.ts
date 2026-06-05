import { homedir } from 'node:os';
import { join } from 'node:path';

interface HomeEnv {
  APPDATA?: string;
  HOME?: string;
  OPENCODE_STARTER_HOME?: string;
  USERPROFILE?: string;
  XDG_CONFIG_HOME?: string;
}

function userHome(env: HomeEnv = process.env): string {
  return env.HOME ?? env.USERPROFILE ?? homedir();
}

export function getAppHome(env: HomeEnv = process.env): string {
  if (env.OPENCODE_STARTER_HOME) return env.OPENCODE_STARTER_HOME;
  return join(userHome(env), '.opencode-starter');
}

export function getConfigPath(env: HomeEnv = process.env): string {
  return join(getAppHome(env), 'config.json');
}

export function getLegacyConfPath(env: HomeEnv = process.env, platform = process.platform): string {
  const home = userHome(env);
  const appName = 'opencode-starter-nodejs';

  if (platform === 'darwin') {
    return join(home, 'Library', 'Preferences', appName, 'config.json');
  }

  if (platform === 'win32') {
    return join(env.APPDATA ?? join(home, 'AppData', 'Roaming'), appName, 'Config', 'config.json');
  }

  return join(env.XDG_CONFIG_HOME ?? join(home, '.config'), appName, 'config.json');
}
