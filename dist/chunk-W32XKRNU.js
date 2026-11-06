#!/usr/bin/env node
import {
  getVertexModelsPath
} from "./chunk-XEH2JMTL.js";

// src/vertex-env.ts
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
var DEFAULT_VERTEX_MODELS = [
  { id: "claude-opus-5-5", display_name: "Claude Opus 5.5" },
  { id: "claude-sonnet-5-5", display_name: "Claude Sonnet 5.5" },
  { id: "claude-haiku-5-5", display_name: "Claude Haiku 5.5" },
  { id: "claude-sonnet-5", display_name: "Claude Sonnet 5" },
  { id: "claude-opus-4-6", display_name: "Claude Opus 4.6" },
  { id: "claude-sonnet-4-6", display_name: "Claude Sonnet 4.6" },
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
function defaultAdcCredentialsPath(home = homedir()) {
  return join(home, ".config", "gcloud", "application_default_credentials.json");
}
function hasApplicationDefaultCredentials(home = homedir(), adcPath = defaultAdcCredentialsPath(home), env = process.env) {
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
function hasCustomVertexModels(env = process.env) {
  return existsSync(getVertexModelsPath(env));
}
function saveVertexModelEntries(entries, env = process.env) {
  const path = getVertexModelsPath(env);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(entries, null, 2)}
`);
}
function resetVertexModelEntries(env = process.env) {
  rmSync(getVertexModelsPath(env), { force: true });
}

export {
  DEFAULT_VERTEX_MODELS,
  resolveVertexProject,
  resolveVertexLocation,
  defaultAdcCredentialsPath,
  hasApplicationDefaultCredentials,
  loadVertexModelEntries,
  hasCustomVertexModels,
  saveVertexModelEntries,
  resetVertexModelEntries
};
//# sourceMappingURL=chunk-W32XKRNU.js.map