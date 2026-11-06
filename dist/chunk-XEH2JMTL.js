#!/usr/bin/env node

// src/paths.ts
import { homedir } from "os";
import { join } from "path";
var APP_DIR_NAME = "relay-ai";
var LEGACY_APP_DIR_NAME = "opencode-starter";
function userHome(env = process.env) {
  return env.HOME ?? env.USERPROFILE ?? homedir();
}
function resolveAppHomeOverride(env = process.env) {
  const override = env.RELAY_AI_HOME ?? env.OPENCODE_STARTER_HOME;
  return override?.trim() || void 0;
}
function getAppHome(env = process.env) {
  const override = resolveAppHomeOverride(env);
  if (override) return override;
  return join(userHome(env), `.${APP_DIR_NAME}`);
}
function getLegacyAppHome(env = process.env) {
  return join(userHome(env), `.${LEGACY_APP_DIR_NAME}`);
}
function getConfigPath(env = process.env) {
  return join(getAppHome(env), "config.json");
}
function getProvidersPath(env = process.env) {
  return join(getAppHome(env), "providers.json");
}
function getSecretsPath(env = process.env) {
  return join(getAppHome(env), "secrets.json");
}
function getLogsPath(env = process.env) {
  return join(getAppHome(env), "logs");
}
function getVertexModelsPath(env = process.env) {
  return join(getAppHome(env), "vertex-models.json");
}
function getLegacyConfPath(env = process.env, platform = process.platform) {
  const home = userHome(env);
  const appName = `${LEGACY_APP_DIR_NAME}-nodejs`;
  if (platform === "darwin") {
    return join(home, "Library", "Preferences", appName, "config.json");
  }
  if (platform === "win32") {
    return join(env.APPDATA ?? join(home, "AppData", "Roaming"), appName, "Config", "config.json");
  }
  return join(env.XDG_CONFIG_HOME ?? join(home, ".config"), appName, "config.json");
}

export {
  getAppHome,
  getLegacyAppHome,
  getConfigPath,
  getProvidersPath,
  getSecretsPath,
  getLogsPath,
  getVertexModelsPath,
  getLegacyConfPath
};
//# sourceMappingURL=chunk-XEH2JMTL.js.map