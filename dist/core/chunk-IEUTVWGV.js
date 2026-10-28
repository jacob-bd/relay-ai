// src/vertex-env.ts
import { existsSync, readFileSync } from "fs";
import { homedir as homedir2 } from "os";
import { join as join2 } from "path";

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

// src/vertex-env.ts
var DEFAULT_VERTEX_MODELS = [
  { id: "claude-sonnet-4-6", display_name: "Claude Sonnet 4.6" },
  { id: "claude-opus-4-6", display_name: "Claude Opus 4.6" },
  { id: "claude-haiku-4-5", display_name: "Claude Haiku 4.5" }
];
function resolveVertexProject(env = process.env) {
  const project = env["ANTHROPIC_VERTEX_PROJECT_ID"] ?? env["GOOGLE_CLOUD_PROJECT"] ?? env["GOOGLE_VERTEX_PROJECT"];
  return project?.trim() || void 0;
}
function resolveVertexLocation(env = process.env) {
  const location = env["GOOGLE_CLOUD_LOCATION"] ?? env["CLOUD_ML_REGION"] ?? env["GOOGLE_VERTEX_LOCATION"] ?? "global";
  return location.trim() || "global";
}
function defaultAdcCredentialsPath(home = homedir2()) {
  return join2(home, ".config", "gcloud", "application_default_credentials.json");
}
function hasApplicationDefaultCredentials(home = homedir2(), adcPath = defaultAdcCredentialsPath(home), env = process.env) {
  const explicitPath = env["GOOGLE_APPLICATION_CREDENTIALS"]?.trim();
  if (explicitPath && existsSync(explicitPath)) return true;
  return existsSync(adcPath);
}
function loadVertexModelEntries(env = process.env) {
  const configPath = getVertexModelsPath(env);
  if (!existsSync(configPath)) return DEFAULT_VERTEX_MODELS;
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_VERTEX_MODELS;
    const models = parsed.filter(
      (entry) => !!entry && typeof entry === "object" && typeof entry.id === "string" && entry.id.length > 0 && typeof entry.display_name === "string" && entry.display_name.length > 0
    ).map((entry) => ({
      id: entry.id,
      display_name: entry.display_name,
      ...typeof entry.upstream_id === "string" && entry.upstream_id.length > 0 ? { upstream_id: entry.upstream_id } : {}
    }));
    return models.length > 0 ? models : DEFAULT_VERTEX_MODELS;
  } catch {
    return DEFAULT_VERTEX_MODELS;
  }
}

export {
  getAppHome,
  getLegacyAppHome,
  getConfigPath,
  getProvidersPath,
  getSecretsPath,
  getLegacyConfPath,
  DEFAULT_VERTEX_MODELS,
  resolveVertexProject,
  resolveVertexLocation,
  defaultAdcCredentialsPath,
  hasApplicationDefaultCredentials,
  loadVertexModelEntries
};
//# sourceMappingURL=chunk-IEUTVWGV.js.map