#!/usr/bin/env node

// src/cli.ts
import pc7 from "picocolors";
import * as p8 from "@clack/prompts";
import { realpathSync } from "fs";
import { fileURLToPath } from "url";

// src/launch.ts
import { execSync, spawn } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
var isWindows = process.platform === "win32";
var FALLBACK_PATHS = isWindows ? [
  join(process.env["APPDATA"] ?? homedir(), "npm", "claude.cmd"),
  join(process.env["APPDATA"] ?? homedir(), "npm", "claude"),
  join(homedir(), "AppData", "Roaming", "npm", "claude.cmd")
] : [
  join(homedir(), ".local", "bin", "claude"),
  join(homedir(), ".npm", "bin", "claude"),
  "/usr/local/bin/claude",
  "/opt/homebrew/bin/claude"
];
function findClaudeBinary() {
  try {
    const result = execSync(isWindows ? "where.exe claude" : "which claude", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"]
    });
    const path = result.trim().split("\n")[0].trim();
    if (path) return path;
  } catch {
  }
  for (const path of FALLBACK_PATHS) {
    if (existsSync(path)) return path;
  }
  return null;
}
function buildClaudeArgs(model, extraArgs) {
  return ["--model", model, ...extraArgs];
}
function launchClaude(env, model, extraArgs) {
  return new Promise((resolve) => {
    const claudePath = findClaudeBinary();
    const args = buildClaudeArgs(model, extraArgs);
    const child = spawn(claudePath, args, {
      stdio: "inherit",
      env,
      shell: isWindows
    });
    const forward = (signal) => {
      child.kill(signal);
    };
    process.once("SIGINT", () => forward("SIGINT"));
    process.once("SIGTERM", () => forward("SIGTERM"));
    child.on("exit", (code) => {
      resolve(code ?? 0);
    });
  });
}

// src/constants.ts
import { homedir as homedir2 } from "os";
import { join as join2 } from "path";
var BACKENDS = {
  zen: {
    id: "zen",
    name: "OpenCode Zen",
    // No /v1 suffix — the Anthropic SDK appends /v1/messages automatically
    baseUrl: "https://opencode.ai/zen"
  },
  go: {
    id: "go",
    name: "OpenCode Go",
    baseUrl: "https://opencode.ai/zen/go"
  }
};
var CONFLICTING_ENV_VARS = [
  "CLAUDE_CODE_USE_VERTEX",
  "ANTHROPIC_VERTEX_PROJECT_ID",
  "ANTHROPIC_VERTEX_BASE_URL",
  "CLOUD_ML_REGION",
  "ANTHROPIC_BEDROCK_BASE_URL",
  "ANTHROPIC_AWS_BASE_URL",
  "ANTHROPIC_AWS_API_KEY",
  "ANTHROPIC_AWS_WORKSPACE_ID",
  "ANTHROPIC_FOUNDRY_API_KEY",
  "ANTHROPIC_FOUNDRY_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL"
];
var OPENCODE_CACHE_PATH = join2(homedir2(), ".cache", "opencode", "models.json");
var MODELS_CACHE_TTL_MS = 60 * 60 * 1e3;
var MAX_MODEL_CATALOG = 20;
var VERTEX_ANTHROPIC_NPM = "@ai-sdk/google-vertex/anthropic";
var BLACKLISTED_LOCAL_MODEL_IDS = /* @__PURE__ */ new Set([
  "z-ai/glm4.7"
  // NVIDIA NIM: requires separate access approval
]);
var STALE_FREE_MODELS = /* @__PURE__ */ new Set([
  "qwen3.6-plus-free",
  // 401 — free promotion ended
  "mimo-v2-pro",
  // 400 — deprecated, migrate to mimo-v2.5-pro
  "mimo-v2-omni"
  // 400 — deprecated, migrate to mimo-v2.5
]);
function classifyModelFormat(modelId, providerNpm) {
  if (providerNpm === "@ai-sdk/anthropic") return "anthropic";
  if (providerNpm === "@ai-sdk/openai") return "unsupported";
  if (providerNpm === "@ai-sdk/google") return "unsupported";
  const lower = modelId.toLowerCase();
  if (lower.startsWith("claude-")) return "anthropic";
  if (lower.startsWith("gpt-")) return "unsupported";
  if (lower.startsWith("gemini-")) return "unsupported";
  return "openai";
}
var VERSION = "0.1.0";

// src/context-window.ts
import { readFileSync } from "fs";
var DEFAULT_CONTEXT_WINDOW = 2e5;
var CACHE_PROVIDER_PRIORITY = /* @__PURE__ */ new Set(["opencode", "opencode-go"]);
var HEURISTIC_RULES = [
  [/gemini-2\.5-pro|gemini-1\.5-pro|gemini-3-pro/i, 2e6],
  [/gemini/i, 1e6],
  [/claude-opus-4-[678]|claude-sonnet-4-[678]/i, 1e6],
  [/claude-haiku-4-[567]/i, 2e5],
  [/claude.*\[1m\]/i, 1e6],
  [/claude-opus-4-[56]|claude-sonnet-4-[45]|claude-3/i, 2e5],
  [/claude/i, 2e5],
  [/deepseek-v4|deepseek-r1|deepseek-reasoner/i, 1e6],
  [/deepseek/i, 64e3],
  [/gpt-5|gpt-4\.1|o3-|o4-/i, 1e6],
  [/gpt-4o|gpt-4-turbo|gpt-4/i, 128e3],
  [/gpt-oss/i, 131072],
  [/qwen3|qwen-3|qwen2\.5-72b|qwen2\.5-32b|qwen-coder/i, 262144],
  [/qwen/i, 131072],
  [/kimi-k2|kimi-k2\.5|moonshot/i, 262144],
  [/minimax-m2/i, 204800],
  [/minimax/i, 128e3],
  [/mistral-large|ministral|mistral/i, 262144],
  [/llama-3\.[23]|llama3/i, 131072],
  [/grok-3|grok-4/i, 131072],
  [/nemotron/i, 131072],
  [/glm-4/i, 128e3],
  [/solar-pro3/i, 131072],
  [/solar-pro2/i, 65536],
  [/solar/i, 32768]
];
var parsedCache;
var cacheIndex;
var heuristicCache = /* @__PURE__ */ new Map();
function loadOpencodeCache() {
  if (parsedCache === void 0) {
    try {
      parsedCache = JSON.parse(readFileSync(OPENCODE_CACHE_PATH, "utf8"));
    } catch {
      parsedCache = null;
    }
  }
  return parsedCache;
}
function buildContextWindowIndex(cache) {
  const index = /* @__PURE__ */ new Map();
  const allLimits = /* @__PURE__ */ new Map();
  for (const [providerKey, providerData] of Object.entries(cache)) {
    const models = providerData?.models;
    if (!models) continue;
    for (const [modelId, entry] of Object.entries(models)) {
      const ctx = entry.limit?.context;
      if (typeof ctx !== "number" || ctx <= 0) continue;
      const limits = allLimits.get(modelId) ?? [];
      limits.push(ctx);
      allLimits.set(modelId, limits);
      if (CACHE_PROVIDER_PRIORITY.has(providerKey)) {
        index.set(modelId, ctx);
      }
    }
  }
  for (const [modelId, limits] of allLimits) {
    if (!index.has(modelId)) {
      index.set(modelId, Math.max(...limits));
    }
  }
  return index;
}
function getCacheIndex() {
  if (cacheIndex === void 0) {
    const cache = loadOpencodeCache();
    cacheIndex = cache ? buildContextWindowIndex(cache) : /* @__PURE__ */ new Map();
  }
  return cacheIndex;
}
function contextWindowFromHeuristics(modelId) {
  const cached = heuristicCache.get(modelId);
  if (cached !== void 0) return cached;
  for (const [pattern, size] of HEURISTIC_RULES) {
    if (pattern.test(modelId)) {
      heuristicCache.set(modelId, size);
      return size;
    }
  }
  heuristicCache.set(modelId, DEFAULT_CONTEXT_WINDOW);
  return DEFAULT_CONTEXT_WINDOW;
}
function lookupContextWindow(modelId) {
  return getCacheIndex().get(modelId) ?? contextWindowFromHeuristics(modelId);
}
function resolveContextWindow(modelId, explicit) {
  if (typeof explicit === "number" && explicit > 0) return explicit;
  return lookupContextWindow(modelId);
}

// src/env.ts
function detectConflicts() {
  return CONFLICTING_ENV_VARS.filter((name) => process.env[name] !== void 0).map((name) => ({ name, value: process.env[name] }));
}
function resolveApiKey() {
  const key = process.env["OPENCODE_API_KEY"];
  if (!key?.trim()) return null;
  return key.trim().split(/\r?\n/)[0]?.trim() || null;
}
function applyClaudeCodeThirdPartyCompat(env) {
  env["ENABLE_TOOL_SEARCH"] = "true";
  env["CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT"] = "0";
}
function buildChildEnv(baseUrl, model, apiKey, proxyPort, contextWindow, enableGatewayDiscovery) {
  const env = { ...process.env };
  for (const name of CONFLICTING_ENV_VARS) {
    delete env[name];
  }
  env["ANTHROPIC_BASE_URL"] = proxyPort ? `http://127.0.0.1:${proxyPort}` : baseUrl;
  env["ANTHROPIC_API_KEY"] = apiKey;
  env["ANTHROPIC_MODEL"] = model;
  env["CLAUDE_CODE_MAX_CONTEXT_TOKENS"] = String(resolveContextWindow(model, contextWindow));
  if (enableGatewayDiscovery) {
    env["CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY"] = "1";
  }
  applyClaudeCodeThirdPartyCompat(env);
  return env;
}
function classifyKeyringError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (lower.includes("cannot find module") || lower.includes("module not found") || lower.includes("failed to load")) {
    return "native keyring module not available on this system";
  }
  if (lower.includes("secret service") || lower.includes("dbus") || lower.includes("daemon")) {
    return "Secret Service daemon is not running (start GNOME Keyring or KWallet)";
  }
  if (lower.includes("denied") || lower.includes("locked") || lower.includes("cancelled") || lower.includes("user refused")) {
    return "keychain access was denied or the keychain is locked";
  }
  return `keyring error: ${msg}`;
}
var KEYRING_SERVICE = "relay-ai";
var KEYRING_ACCOUNT = "relay-ai";
var LEGACY_KEYRING_SERVICE = "opencode-starter";
var LEGACY_KEYRING_ACCOUNT = "opencode-starter";
var GLOBAL_OPENCODE_KEYRING_ACCOUNT = "global:opencode";
function parseAuthRef(authRef) {
  if (authRef.startsWith("keyring:")) {
    const account = authRef.slice("keyring:".length);
    return account ? { kind: "keyring", account } : null;
  }
  if (authRef.startsWith("env:")) {
    const varName = authRef.slice("env:".length);
    return varName ? { kind: "env", varName } : null;
  }
  return null;
}
function relayAiKeyEnvVar(providerId) {
  return `RELAY_AI_KEY_${providerId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
}
function readEnvCredential(varName) {
  const raw = process.env[varName];
  if (!raw?.trim()) return null;
  return raw.trim().split(/\r?\n/)[0]?.trim() || null;
}
async function readKeyringAccount(account, diag) {
  try {
    const { Entry } = await import("@napi-rs/keyring");
    return new Entry(KEYRING_SERVICE, account).getPassword() ?? null;
  } catch (err) {
    diag?.(classifyKeyringError(err));
    return null;
  }
}
async function writeKeyringAccount(account, key, diag) {
  try {
    const { Entry } = await import("@napi-rs/keyring");
    new Entry(KEYRING_SERVICE, account).setPassword(key);
    return true;
  } catch (err) {
    diag?.(classifyKeyringError(err));
    return false;
  }
}
async function deleteKeyringAccount(account, diag) {
  try {
    const { Entry } = await import("@napi-rs/keyring");
    new Entry(KEYRING_SERVICE, account).deletePassword();
    return true;
  } catch (err) {
    diag?.(classifyKeyringError(err));
    return false;
  }
}
async function readGlobalOpencodeCredential(diag) {
  const fromEnv = resolveApiKey();
  if (fromEnv) return fromEnv;
  const global = await readKeyringAccount(GLOBAL_OPENCODE_KEYRING_ACCOUNT, diag);
  if (global) return global;
  const current = await readKeyringAccount(KEYRING_ACCOUNT, diag);
  if (current) return current;
  try {
    const { Entry } = await import("@napi-rs/keyring");
    return new Entry(LEGACY_KEYRING_SERVICE, LEGACY_KEYRING_ACCOUNT).getPassword() ?? null;
  } catch (err) {
    diag?.(classifyKeyringError(err));
    return null;
  }
}
async function migrateGlobalOpencodeCredential(diag) {
  const existing = await readKeyringAccount(GLOBAL_OPENCODE_KEYRING_ACCOUNT, diag);
  if (existing) return true;
  const legacy = await readKeyringAccount(KEYRING_ACCOUNT, diag) ?? await (async () => {
    try {
      const { Entry } = await import("@napi-rs/keyring");
      return new Entry(LEGACY_KEYRING_SERVICE, LEGACY_KEYRING_ACCOUNT).getPassword() ?? null;
    } catch (err) {
      diag?.(classifyKeyringError(err));
      return null;
    }
  })();
  if (!legacy) return false;
  const wrote = await writeKeyringAccount(GLOBAL_OPENCODE_KEYRING_ACCOUNT, legacy, diag);
  if (!wrote) return false;
  const verified = await readKeyringAccount(GLOBAL_OPENCODE_KEYRING_ACCOUNT, diag);
  if (verified !== legacy) {
    diag?.("credential migration verification failed \u2014 keeping legacy keychain entries");
    return false;
  }
  if (await readKeyringAccount(KEYRING_ACCOUNT, diag)) {
    await deleteKeyringAccount(KEYRING_ACCOUNT, diag);
  }
  try {
    const { Entry } = await import("@napi-rs/keyring");
    if (new Entry(LEGACY_KEYRING_SERVICE, LEGACY_KEYRING_ACCOUNT).getPassword()) {
      new Entry(LEGACY_KEYRING_SERVICE, LEGACY_KEYRING_ACCOUNT).deletePassword();
    }
  } catch {
  }
  return true;
}
async function resolveProviderCredential(providerId, authRef, diag) {
  const namespaced = readEnvCredential(relayAiKeyEnvVar(providerId));
  if (namespaced) return namespaced;
  const parsed = parseAuthRef(authRef);
  if (!parsed) return null;
  if (parsed.kind === "env") {
    return readEnvCredential(parsed.varName);
  }
  if (parsed.account === GLOBAL_OPENCODE_KEYRING_ACCOUNT) {
    return readGlobalOpencodeCredential(diag);
  }
  return readKeyringAccount(parsed.account, diag);
}
async function saveProviderCredential(authRef, key, diag) {
  const parsed = parseAuthRef(authRef);
  if (!parsed || parsed.kind !== "keyring") return false;
  return writeKeyringAccount(parsed.account, key, diag);
}
async function deleteProviderCredential(authRef, diag) {
  const parsed = parseAuthRef(authRef);
  if (!parsed || parsed.kind !== "keyring") return false;
  return deleteKeyringAccount(parsed.account, diag);
}
async function readFromCredentialStore(diag) {
  return readGlobalOpencodeCredential(diag);
}
async function saveToCredentialStore(key, diag) {
  const wrote = await writeKeyringAccount(GLOBAL_OPENCODE_KEYRING_ACCOUNT, key, diag);
  if (wrote) {
    await deleteKeyringAccount(KEYRING_ACCOUNT, diag);
  }
  return wrote;
}
async function isSecretServiceAvailable() {
  try {
    const { Entry } = await import("@napi-rs/keyring");
    new Entry(`${KEYRING_SERVICE}-probe`, "probe").getPassword();
    return true;
  } catch {
    return false;
  }
}

// src/key-setup.ts
import * as p from "@clack/prompts";
import { appendFileSync, readFileSync as readFileSync3, existsSync as existsSync3 } from "fs";
import { homedir as homedir4 } from "os";
import { spawnSync } from "child_process";

// src/trace-log.ts
import {
  chmodSync,
  existsSync as existsSync2,
  mkdirSync,
  readFileSync as readFileSync2,
  unlinkSync,
  writeFileSync
} from "fs";
import { join as join4 } from "path";
import pc from "picocolors";

// src/paths.ts
import { homedir as homedir3 } from "os";
import { join as join3 } from "path";
var APP_DIR_NAME = "relay-ai";
var LEGACY_APP_DIR_NAME = "opencode-starter";
function userHome(env = process.env) {
  return env.HOME ?? env.USERPROFILE ?? homedir3();
}
function resolveAppHomeOverride(env = process.env) {
  const override = env.RELAY_AI_HOME ?? env.OPENCODE_STARTER_HOME;
  return override?.trim() || void 0;
}
function getAppHome(env = process.env) {
  const override = resolveAppHomeOverride(env);
  if (override) return override;
  return join3(userHome(env), `.${APP_DIR_NAME}`);
}
function getLegacyAppHome(env = process.env) {
  return join3(userHome(env), `.${LEGACY_APP_DIR_NAME}`);
}
function getConfigPath(env = process.env) {
  return join3(getAppHome(env), "config.json");
}
function getProvidersPath(env = process.env) {
  return join3(getAppHome(env), "providers.json");
}
function getLogsPath(env = process.env) {
  return join3(getAppHome(env), "logs");
}
function getVertexModelsPath(env = process.env) {
  return join3(getAppHome(env), "vertex-models.json");
}
function getLegacyConfPath(env = process.env, platform = process.platform) {
  const home = userHome(env);
  const appName = `${LEGACY_APP_DIR_NAME}-nodejs`;
  if (platform === "darwin") {
    return join3(home, "Library", "Preferences", appName, "config.json");
  }
  if (platform === "win32") {
    return join3(env.APPDATA ?? join3(home, "AppData", "Roaming"), appName, "Config", "config.json");
  }
  return join3(env.XDG_CONFIG_HOME ?? join3(home, ".config"), appName, "config.json");
}

// src/trace-log.ts
var DIR_MODE = 448;
var FILE_MODE = 384;
var CLAUDE_DEBUG_LOG = "claude-debug.log";
var PROXY_DEBUG_LOG = "proxy-debug.log";
function ensureLogsDir() {
  const dir = getLogsPath();
  mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  try {
    chmodSync(dir, DIR_MODE);
  } catch {
  }
  return dir;
}
function getClaudeDebugLogPath() {
  return join4(ensureLogsDir(), CLAUDE_DEBUG_LOG);
}
function prepareClaudeTraceLog() {
  const path = getClaudeDebugLogPath();
  resetTraceLog(path);
  return path;
}
function getProxyDebugLogPath() {
  return join4(ensureLogsDir(), PROXY_DEBUG_LOG);
}
function resetTraceLog(path) {
  ensureLogsDir();
  if (existsSync2(path)) {
    try {
      unlinkSync(path);
    } catch {
    }
  }
}
var REDACTION_PATTERNS = [
  // Bearer / Authorization headers
  (line) => line.replace(/Bearer\s+[A-Za-z0-9._\-+/=]+/gi, "Bearer [REDACTED]"),
  (line) => line.replace(/("authorization"\s*:\s*")[^"]+/gi, "$1[REDACTED]"),
  (line) => line.replace(/(x-api-key"\s*:\s*")[^"]+/gi, "$1[REDACTED]"),
  // Common API key prefixes
  (line) => line.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "sk-[REDACTED]"),
  (line) => line.replace(/\bsk-ant-[A-Za-z0-9_-]{8,}\b/g, "sk-ant-[REDACTED]"),
  (line) => line.replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, "AIza[REDACTED]"),
  (line) => line.replace(/\bgsk_[A-Za-z0-9]{20,}\b/g, "gsk_[REDACTED]")
];
function redactTraceLine(line) {
  let out = line;
  for (const apply of REDACTION_PATTERNS) {
    out = apply(out);
  }
  return out;
}
function redactTraceLog(content) {
  return content.split("\n").map(redactTraceLine).join("\n");
}
function writeSecureLogLine(path, line) {
  ensureLogsDir();
  const redacted = redactTraceLine(line);
  try {
    writeFileSync(path, `${redacted}
`, { flag: "a", mode: FILE_MODE });
    chmodSync(path, FILE_MODE);
  } catch {
  }
}
function printTraceLog(debugLogPath) {
  if (!existsSync2(debugLogPath)) return;
  const raw = readFileSync2(debugLogPath, "utf8");
  const log8 = redactTraceLog(raw);
  const errorLines = log8.split("\n").filter(
    (l) => l.includes("error") || l.includes("Error") || l.includes('"type":"error"') || l.includes("status")
  );
  console.log("\n" + pc.bold(pc.cyan("\u2500\u2500 Debug trace \u2500\u2500")));
  if (errorLines.length > 0) {
    errorLines.slice(0, 30).forEach((l) => console.log(pc.dim(l)));
  } else {
    console.log(pc.dim("(no errors found in debug log)"));
  }
  console.log(pc.dim(`Full log: ${debugLogPath}`));
}

// src/key-setup.ts
function detectShellProfile() {
  const shell = process.env["SHELL"] ?? "";
  if (process.platform === "darwin") {
    if (shell.includes("zsh")) return { display: "~/.zshrc", path: `${homedir4()}/.zshrc` };
    if (shell.includes("bash")) return { display: "~/.bash_profile", path: `${homedir4()}/.bash_profile` };
    return { display: "~/.profile", path: `${homedir4()}/.profile` };
  }
  if (process.platform === "linux") {
    if (shell.includes("zsh")) return { display: "~/.zshrc", path: `${homedir4()}/.zshrc` };
    if (shell.includes("bash")) return { display: "~/.bashrc", path: `${homedir4()}/.bashrc` };
    return { display: "~/.profile", path: `${homedir4()}/.profile` };
  }
  if (shell.includes("bash")) return { display: "~/.bashrc", path: `${homedir4()}/.bashrc` };
  return { display: "~/.profile", path: `${homedir4()}/.profile` };
}
async function resolveOrCollectApiKey(simulate = false, trace = false) {
  if (!simulate) {
    const existing = resolveApiKey();
    if (existing) return existing;
  }
  const isMac = process.platform === "darwin";
  const isWindows3 = process.platform === "win32";
  const isLinux = process.platform === "linux";
  if (simulate) {
    p.note(
      "Running in dry-run mode \u2014 no keys will be read from or written to your system.",
      "Simulating first-run onboarding"
    );
  }
  if (!simulate) {
    const keyDiag = (reason) => {
      p.log.warn(`Credential store unavailable \u2014 ${reason}`);
      if (trace) {
        writeSecureLogLine(getClaudeDebugLogPath(), `keyring: ${reason}`);
      }
    };
    const storedKey = await readFromCredentialStore(keyDiag);
    if (storedKey) {
      const storeName = isMac ? "macOS Keychain" : isWindows3 ? "Windows Credential Manager" : "Secret Service";
      p.log.success(`Found key in ${storeName}`);
      process.env["OPENCODE_API_KEY"] = storedKey;
      return storedKey;
    }
  }
  p.note("Get your free key at: https://opencode.ai/auth", "OpenCode API key");
  const key = await p.password({
    message: "Paste your OPENCODE_API_KEY:",
    validate: (val) => val.trim() ? void 0 : "Key cannot be empty"
  });
  if (p.isCancel(key)) {
    p.cancel("Cancelled.");
    return null;
  }
  const trimmedKey = key.trim();
  let secretServiceAvailable = false;
  if (isLinux && !simulate) {
    secretServiceAvailable = await isSecretServiceAvailable();
  }
  const { display, path } = detectShellProfile();
  const saveOptions = (() => {
    if (isMac) {
      return [
        { value: "keychain", label: "Keychain only", hint: "Key stored encrypted in Keychain; relay-ai reads it automatically next time" },
        { value: "keychain-autoload", label: `Keychain + ${display} auto-load`, hint: `Key in Keychain; ${display} also exports it so all terminal tools can see it` },
        { value: "profile", label: `${display} only (plaintext)`, hint: "Key written directly to your shell profile \u2014 simpler but less secure" },
        { value: "session", label: "This session only", hint: "Not saved anywhere \u2014 you'll be asked again next time" }
      ];
    }
    if (isWindows3) {
      return [
        { value: "credential-manager", label: "Windows Credential Manager", hint: "Key stored securely; relay-ai reads it automatically next time" },
        { value: "setx", label: "Persistent environment variable (plaintext)", hint: "Runs setx \u2014 key visible in System Properties \u2192 Environment Variables" },
        { value: "session", label: "This session only", hint: "Not saved anywhere \u2014 you'll be asked again next time" }
      ];
    }
    const opts = [];
    if (secretServiceAvailable) {
      opts.push({ value: "secret-service", label: "Secret Service (GNOME Keyring / KWallet)", hint: "Key stored securely in your desktop keyring; relay-ai reads it automatically next time" });
    } else if (!simulate) {
      p.log.info("No keyring daemon detected \u2014 secure storage requires GNOME Keyring or KWallet running.");
    }
    opts.push(
      { value: "profile", label: `${display} (plaintext)`, hint: "Key written directly to your shell profile" },
      { value: "session", label: "This session only", hint: "Not saved anywhere \u2014 you'll be asked again next time" }
    );
    return opts;
  })();
  const saveChoice = await p.select({
    message: "Where should we save the key?",
    options: saveOptions,
    initialValue: isMac ? "keychain" : isWindows3 ? "credential-manager" : secretServiceAvailable ? "secret-service" : "profile"
  });
  if (p.isCancel(saveChoice)) {
    p.cancel("Cancelled.");
    return null;
  }
  if (simulate) {
    const dryRunMessages = {
      keychain: "Would save key to macOS Keychain",
      "keychain-autoload": `Would save key to macOS Keychain and add auto-load to ${display}`,
      "credential-manager": "Would save key to Windows Credential Manager",
      setx: "Would run: setx OPENCODE_API_KEY ***",
      "secret-service": "Would save key to Secret Service (GNOME Keyring / KWallet)",
      profile: `Would append OPENCODE_API_KEY export to ${display}`,
      session: "Would use key for this session only"
    };
    p.log.info(`[dry-run] ${dryRunMessages[saveChoice]}`);
  } else if (saveChoice === "keychain") {
    if (await saveToCredentialStore(trimmedKey)) {
      p.log.success("Key saved to macOS Keychain \u2014 active now and automatically loaded next time.");
    } else {
      p.log.warn("Could not write to Keychain \u2014 key will be used for this session only");
    }
  } else if (saveChoice === "keychain-autoload") {
    if (await saveToCredentialStore(trimmedKey)) {
      try {
        const autoLoadLine = `export OPENCODE_API_KEY="$(security find-generic-password -s relay-ai -a ${GLOBAL_OPENCODE_KEYRING_ACCOUNT} -w 2>/dev/null)"`;
        const existing = existsSync3(path) ? readFileSync3(path, "utf8") : "";
        if (!existing.includes(autoLoadLine)) {
          appendFileSync(path, `
# relay-ai: load API key from macOS Keychain
${autoLoadLine}
`);
        }
        p.log.success(`Key saved to Keychain and auto-load added to ${display} \u2014 active now and in all future terminals.`);
      } catch {
        p.log.success("Key saved to Keychain \u2014 active now and automatically loaded next time.");
        p.log.warn(`Could not write auto-load line to ${display}`);
      }
    } else {
      p.log.warn("Could not write to Keychain \u2014 key will be used for this session only");
    }
  } else if (saveChoice === "credential-manager") {
    if (await saveToCredentialStore(trimmedKey)) {
      p.log.success("Key saved to Windows Credential Manager \u2014 active now and automatically loaded next time.");
    } else {
      p.log.warn("Could not write to Credential Manager \u2014 key will be used for this session only");
    }
  } else if (saveChoice === "setx") {
    try {
      const result = spawnSync("setx", ["OPENCODE_API_KEY", trimmedKey], { stdio: ["pipe", "pipe", "pipe"] });
      if (result.status !== 0) throw new Error("setx exited with non-zero status");
      p.log.success("Key saved as a user environment variable \u2014 active now and in all future terminals.");
    } catch {
      p.log.warn("Could not run setx \u2014 key will be used for this session only");
    }
  } else if (saveChoice === "secret-service") {
    if (await saveToCredentialStore(trimmedKey)) {
      p.log.success("Key saved to Secret Service \u2014 active now and automatically loaded next time.");
    } else {
      p.log.warn("Could not write to Secret Service \u2014 key will be used for this session only");
    }
  } else if (saveChoice === "profile") {
    try {
      if (!existsSync3(path)) appendFileSync(path, "");
      const escapedKey = trimmedKey.replace(/'/g, "'\\''");
      appendFileSync(path, `
export OPENCODE_API_KEY='${escapedKey}'
`);
      p.log.success(`Key saved to ${display} \u2014 active now and in all future terminals.`);
    } catch {
      p.log.warn(`Could not write to ${display} \u2014 key will be used for this session only`);
    }
  }
  if (!simulate) process.env["OPENCODE_API_KEY"] = trimmedKey;
  return trimmedKey;
}

// src/first-run.ts
import pc2 from "picocolors";
import * as p2 from "@clack/prompts";

// src/config.ts
import { dirname, join as join5 } from "path";
import { copyFileSync, existsSync as existsSync4, mkdirSync as mkdirSync2, readFileSync as readFileSync4, renameSync, writeFileSync as writeFileSync2 } from "fs";
function readJsonFile(path) {
  try {
    const parsed = JSON.parse(readFileSync4(path, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
function ensureAppHomeMigrated() {
  const configPath = getConfigPath();
  if (existsSync4(configPath)) return;
  const legacyConfig = join5(getLegacyAppHome(), "config.json");
  if (!existsSync4(legacyConfig)) return;
  mkdirSync2(getAppHome(), { recursive: true });
  copyFileSync(legacyConfig, configPath);
  const legacyVertex = join5(getLegacyAppHome(), "vertex-models.json");
  const vertexPath = join5(getAppHome(), "vertex-models.json");
  if (existsSync4(legacyVertex) && !existsSync4(vertexPath)) {
    copyFileSync(legacyVertex, vertexPath);
  }
}
function ensureConfigMigrated() {
  ensureAppHomeMigrated();
  const configPath = getConfigPath();
  if (existsSync4(configPath)) return;
  const legacyPath = getLegacyConfPath();
  if (!existsSync4(legacyPath)) return;
  const legacy = readJsonFile(legacyPath);
  if (!legacy) return;
  mkdirSync2(dirname(configPath), { recursive: true });
  writeFileSync2(configPath, `${JSON.stringify(legacy, null, 2)}
`, "utf8");
  try {
    renameSync(legacyPath, `${legacyPath}.migrated`);
  } catch {
  }
}
function readConfig() {
  ensureConfigMigrated();
  return readJsonFile(getConfigPath()) ?? {};
}
function writeConfig(config) {
  const configPath = getConfigPath();
  mkdirSync2(dirname(configPath), { recursive: true });
  writeFileSync2(configPath, `${JSON.stringify(config, null, 2)}
`, "utf8");
}
function loadPreferences() {
  const config = readConfig();
  return {
    lastBackend: config.lastBackend,
    lastModel: config.lastModel,
    lastProvider: config.lastProvider,
    recentModelsByProvider: config.recentModelsByProvider,
    favoriteModels: config.favoriteModels,
    subscriptionTier: config.subscriptionTier,
    modelListCache: config.modelListCache,
    server: config.server
  };
}
function savePreferences(prefs) {
  const config = readConfig();
  if (prefs.lastBackend !== void 0) config.lastBackend = prefs.lastBackend;
  if (prefs.lastModel !== void 0) config.lastModel = prefs.lastModel;
  if (prefs.lastProvider !== void 0) config.lastProvider = prefs.lastProvider;
  if (prefs.recentModelsByProvider !== void 0) config.recentModelsByProvider = prefs.recentModelsByProvider;
  if (prefs.favoriteModels !== void 0) config.favoriteModels = prefs.favoriteModels;
  writeConfig(config);
}
function getCachedModels(backendId) {
  const modelListCache = readConfig().modelListCache;
  const entry = modelListCache?.[backendId];
  if (!entry) return null;
  const age = Date.now() - new Date(entry.fetchedAt).getTime();
  if (age > MODELS_CACHE_TTL_MS) return null;
  return entry.models;
}
function setCachedModels(backendId, models) {
  const config = readConfig();
  config.modelListCache = {
    ...config.modelListCache ?? {},
    [backendId]: { models, fetchedAt: (/* @__PURE__ */ new Date()).toISOString() }
  };
  writeConfig(config);
}
function getSubscriptionTier() {
  return readConfig().subscriptionTier ?? null;
}
function setSubscriptionTier(tier) {
  const config = readConfig();
  config.subscriptionTier = tier;
  writeConfig(config);
}
function getSavedServerPassword() {
  return readConfig().server?.savedPassword?.trim() || null;
}
function setSavedServerPassword(password3) {
  const config = readConfig();
  config.server = {
    ...config.server ?? {},
    savedPassword: password3
  };
  writeConfig(config);
}
function getServerExposedProviders() {
  const list = readConfig().server?.exposedProviders;
  return list && list.length > 0 ? list : null;
}
function setServerExposedProviders(providerIds) {
  const config = readConfig();
  config.server = {
    ...config.server ?? {},
    exposedProviders: providerIds
  };
  writeConfig(config);
}
function getServerMaskGatewayIds() {
  return readConfig().server?.maskGatewayIds ?? true;
}
function setServerMaskGatewayIds(mask) {
  const config = readConfig();
  config.server = {
    ...config.server ?? {},
    maskGatewayIds: mask
  };
  writeConfig(config);
}
function getServerFavoritesOnly() {
  return readConfig().server?.favoritesOnly ?? false;
}
function setServerFavoritesOnly(favoritesOnly) {
  const config = readConfig();
  config.server = {
    ...config.server ?? {},
    favoritesOnly
  };
  writeConfig(config);
}

// src/providers.ts
import { execSync as execSync2, spawn as spawn2 } from "child_process";
import { existsSync as existsSync5 } from "fs";
import { homedir as homedir5 } from "os";
import { join as join6 } from "path";

// src/models.ts
var BRAND_MAP = [
  ["claude", "Claude"],
  ["gpt", "GPT"],
  ["gemini", "Gemini"],
  ["deepseek", "DeepSeek"],
  ["qwen", "Qwen"],
  ["minimax", "MiniMax"],
  ["kimi", "Kimi"],
  ["glm", "GLM"],
  ["mimo", "MiMo"],
  ["grok", "Grok"],
  ["nemotron", "Nemotron"]
];
function deriveBrand(family) {
  const lower = family.toLowerCase();
  for (const [prefix, brand] of BRAND_MAP) {
    if (lower.startsWith(prefix)) return brand;
  }
  return "Other";
}
function readModelsFromCache(backendId) {
  const cache = loadOpencodeCache();
  if (!cache) return null;
  const providerKey = backendId === "zen" ? "opencode" : "opencode-go";
  const providerData = cache[providerKey];
  if (!providerData?.models) return null;
  const result = /* @__PURE__ */ new Map();
  for (const entry of Object.values(providerData.models)) {
    if (!entry.id || entry.status === "deprecated") continue;
    const isFree = entry.cost !== void 0 && entry.cost.input === 0 && entry.cost.output === 0;
    const modelFormat = classifyModelFormat(entry.id, entry.provider?.npm);
    result.set(entry.id, {
      id: entry.id,
      name: entry.name ?? entry.id,
      isFree,
      brand: deriveBrand(entry.family ?? ""),
      sourceBackend: backendId,
      modelFormat,
      cost: entry.cost,
      contextWindow: resolveContextWindow(entry.id, entry.limit?.context)
    });
  }
  return result;
}
async function fetchModelsFromApi(backend) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5e3);
  try {
    const res = await fetch(`${backend.baseUrl}/v1/models`, {
      signal: controller.signal,
      headers: { Authorization: "Bearer test" }
    });
    if (!res.ok) throw new Error(`API returned HTTP ${res.status}`);
    const body = await res.json();
    return body.data.map((m) => m.id);
  } finally {
    clearTimeout(timer);
  }
}
function mergeModels(apiIds, cache, backendId) {
  return apiIds.filter((id) => !STALE_FREE_MODELS.has(id)).map((id) => {
    const cached = cache?.get(id);
    if (cached) return { ...cached, sourceBackend: backendId };
    const modelFormat = classifyModelFormat(id, void 0);
    return {
      id,
      name: id,
      isFree: false,
      brand: "Other",
      sourceBackend: backendId,
      modelFormat,
      contextWindow: resolveContextWindow(id)
    };
  });
}
async function getModels(backend, fallbackModels) {
  const cache = readModelsFromCache(backend.id);
  try {
    const apiIds = await fetchModelsFromApi(backend);
    return { models: mergeModels(apiIds, cache, backend.id), fromCache: false };
  } catch {
    if (cache && cache.size > 0) {
      return { models: [...cache.values()], fromCache: true };
    }
    if (fallbackModels && fallbackModels.length > 0) {
      return { models: fallbackModels, fromCache: true };
    }
    throw new Error(
      "Cannot fetch models. Check your network and https://opencode.ai status."
    );
  }
}

// src/providers.ts
var isWindows2 = process.platform === "win32";
var OPENCODE_FALLBACK_PATHS = isWindows2 ? [
  join6(process.env["APPDATA"] ?? homedir5(), "npm", "opencode.cmd"),
  join6(process.env["APPDATA"] ?? homedir5(), "npm", "opencode"),
  join6(homedir5(), "AppData", "Roaming", "npm", "opencode.cmd")
] : [
  join6(homedir5(), ".opencode", "bin", "opencode"),
  join6(homedir5(), ".local", "bin", "opencode"),
  join6(homedir5(), ".npm", "bin", "opencode"),
  "/usr/local/bin/opencode",
  "/opt/homebrew/bin/opencode"
];
function findOpencodeBinary() {
  try {
    const result = execSync2(isWindows2 ? "where.exe opencode" : "which opencode", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"]
    });
    const path = result.trim().split("\n")[0].trim();
    if (path) return path;
  } catch {
  }
  for (const path of OPENCODE_FALLBACK_PATHS) {
    if (existsSync5(path)) return path;
  }
  return null;
}
function resolveEndpoint(npm, apiUrl) {
  if (!npm) return null;
  if (npm === "@ai-sdk/anthropic") {
    return {
      format: "anthropic",
      baseUrl: (apiUrl || "https://api.anthropic.com").replace(/\/v1\/?$/, "")
    };
  }
  if (npm === "@ai-sdk/openai-compatible") {
    if (!apiUrl) return null;
    return {
      format: "openai",
      completionsUrl: apiUrl.replace(/\/$/, "") + "/chat/completions"
    };
  }
  return { format: "openai" };
}
function normalizeProviders(raw) {
  const result = [];
  for (const provider of raw) {
    if (!provider.key) continue;
    if (provider.id === "opencode" || provider.id === "opencode-go") continue;
    const models = [];
    for (const model of Object.values(provider.models ?? {})) {
      if (BLACKLISTED_LOCAL_MODEL_IDS.has(model.id)) continue;
      const endpoint = resolveEndpoint(model.api?.npm ?? "", model.api?.url ?? "");
      if (endpoint === null) continue;
      models.push({
        id: model.id,
        name: model.name ?? model.id,
        family: model.family ?? "",
        brand: deriveBrand(model.family ?? ""),
        modelFormat: endpoint.format,
        upstreamModelId: model.api?.id ?? model.id,
        baseUrl: endpoint.baseUrl,
        completionsUrl: endpoint.completionsUrl,
        npm: model.api?.npm,
        apiBaseUrl: model.api?.url,
        cost: model.cost,
        contextWindow: resolveContextWindow(model.id, model.limit?.context)
      });
    }
    if (models.length === 0) continue;
    result.push({
      id: provider.id,
      name: provider.name,
      apiKey: provider.key,
      models
    });
  }
  return result;
}
async function fetchLocalProviders() {
  const binary = findOpencodeBinary();
  if (!binary) return null;
  return new Promise((resolve) => {
    let child = null;
    let settled = false;
    const TIMEOUT_MS = 1e4;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child?.kill();
      } catch {
      }
      resolve(value);
    };
    const timer = setTimeout(() => {
      finish(null);
    }, TIMEOUT_MS);
    try {
      child = spawn2(binary, ["serve", "--port", "0"], {
        stdio: ["pipe", "pipe", "pipe"]
      });
    } catch {
      finish(null);
      return;
    }
    const portRegex = /opencode server listening on http:\/\/127\.0\.0\.1:(\d+)/;
    let portFound = false;
    let stdoutBuf = "";
    const onData = (chunk) => {
      if (portFound) return;
      stdoutBuf += chunk.toString();
      const match = portRegex.exec(stdoutBuf);
      if (!match) return;
      portFound = true;
      const port = match[1];
      fetch(`http://127.0.0.1:${port}/config/providers`).then((res) => res.json()).then((data) => {
        const raw = data.providers;
        if (!Array.isArray(raw)) {
          finish(null);
          return;
        }
        const providers = normalizeProviders(raw);
        finish(providers);
      }).catch(() => {
        finish(null);
      });
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", () => {
      finish(null);
    });
    child.on("exit", () => {
      if (!settled) finish(null);
    });
  });
}

// src/registry/builtins.ts
function zenRegistryStub() {
  return {
    id: "zen",
    templateId: "zen",
    name: "OpenCode Zen",
    enabled: true,
    authRef: "keyring:global:opencode",
    api: {},
    addedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function goRegistryStub() {
  return {
    id: "go",
    templateId: "go",
    name: "OpenCode Go",
    enabled: true,
    authRef: "keyring:global:opencode",
    api: {},
    addedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}

// src/registry/validate.ts
var PROVIDER_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
function isValidProviderId(id) {
  return PROVIDER_ID_PATTERN.test(id);
}
function slugifyProviderId(displayName) {
  const base = displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!base) return "custom-provider";
  if (isValidProviderId(base)) return base;
  const trimmed = base.replace(/^-+|-+$/g, "");
  return isValidProviderId(trimmed) ? trimmed : `custom-${trimmed.slice(0, 40)}`;
}
function customProviderId(displayName) {
  const slug = slugifyProviderId(displayName);
  return slug.startsWith("custom-") ? slug : `custom-${slug}`;
}

// src/registry/convert.ts
function modelToCached(model) {
  return {
    id: model.id,
    name: model.name,
    upstreamModelId: model.upstreamModelId,
    family: model.family,
    brand: model.brand,
    contextWindow: model.contextWindow,
    cost: model.cost,
    modelFormat: model.modelFormat,
    npm: model.npm,
    apiUrl: model.apiBaseUrl
  };
}
function localProviderToRegistry(provider, templateId) {
  if (!isValidProviderId(provider.id)) return null;
  if (provider.models.length === 0) return null;
  const first = provider.models[0];
  const apiUrl = (first.apiBaseUrl ?? first.baseUrl)?.trim();
  return {
    id: provider.id,
    templateId: templateId ?? provider.id,
    name: provider.name,
    enabled: true,
    authRef: `keyring:provider:${provider.id}`,
    api: {
      npm: first.npm,
      ...apiUrl ? { url: apiUrl } : {}
    },
    addedAt: (/* @__PURE__ */ new Date()).toISOString(),
    refreshedAt: (/* @__PURE__ */ new Date()).toISOString(),
    modelsCache: {
      fetchedAt: (/* @__PURE__ */ new Date()).toISOString(),
      models: provider.models.map(modelToCached)
    }
  };
}

// src/registry/io.ts
import {
  chmodSync as chmodSync2,
  copyFileSync as copyFileSync2,
  existsSync as existsSync6,
  mkdirSync as mkdirSync3,
  openSync,
  readFileSync as readFileSync5,
  renameSync as renameSync2,
  writeSync,
  closeSync
} from "fs";
import { dirname as dirname2 } from "path";

// src/registry/types.ts
var REGISTRY_SCHEMA_VERSION = 1;

// src/registry/io.ts
var DIR_MODE2 = 448;
var FILE_MODE2 = 384;
function ensureSecureAppHome() {
  const home = getAppHome();
  mkdirSync3(home, { recursive: true, mode: DIR_MODE2 });
  try {
    chmodSync2(home, DIR_MODE2);
  } catch {
  }
}
function writeSecureFile(path, content) {
  ensureSecureAppHome();
  mkdirSync3(dirname2(path), { recursive: true, mode: DIR_MODE2 });
  const fd = openSync(path, "w", FILE_MODE2);
  try {
    writeSync(fd, content);
  } finally {
    closeSync(fd);
  }
  try {
    chmodSync2(path, FILE_MODE2);
  } catch {
  }
}
function parseProvider(raw) {
  if (!raw || typeof raw !== "object") return null;
  const p9 = raw;
  if (typeof p9.id !== "string" || !isValidProviderId(p9.id)) return null;
  if (typeof p9.templateId !== "string" || !p9.templateId) return null;
  if (typeof p9.name !== "string" || !p9.name) return null;
  if (typeof p9.enabled !== "boolean") return null;
  if (typeof p9.authRef !== "string" || !p9.authRef) return null;
  if (typeof p9.addedAt !== "string" || !p9.addedAt) return null;
  const api = p9.api;
  if (!api || typeof api !== "object") return null;
  const provider = {
    id: p9.id,
    templateId: p9.templateId,
    name: p9.name,
    enabled: p9.enabled,
    authRef: p9.authRef,
    api,
    addedAt: p9.addedAt
  };
  if (p9.subscriptionFilter === "free" || p9.subscriptionFilter === "zen" || p9.subscriptionFilter === "go") {
    provider.subscriptionFilter = p9.subscriptionFilter;
  }
  if (typeof p9.refreshedAt === "string") provider.refreshedAt = p9.refreshedAt;
  if (p9.modelsCache && typeof p9.modelsCache === "object") {
    const cache = p9.modelsCache;
    if (typeof cache.fetchedAt === "string" && Array.isArray(cache.models)) {
      provider.modelsCache = {
        fetchedAt: cache.fetchedAt,
        models: cache.models.filter((m) => m && typeof m === "object")
      };
    }
  }
  return provider;
}
function parseRegistry(raw) {
  const empty = { schemaVersion: REGISTRY_SCHEMA_VERSION, providers: [] };
  if (!raw || typeof raw !== "object") return empty;
  const data = raw;
  const providers = [];
  if (Array.isArray(data.providers)) {
    for (const entry of data.providers) {
      const parsed = parseProvider(entry);
      if (parsed) providers.push(parsed);
    }
  }
  const registry = {
    schemaVersion: typeof data.schemaVersion === "number" ? data.schemaVersion : REGISTRY_SCHEMA_VERSION,
    providers
  };
  if (typeof data.importedAt === "string") registry.importedAt = data.importedAt;
  if (typeof data.pricingCacheAt === "string") registry.pricingCacheAt = data.pricingCacheAt;
  return registry;
}
function loadRegistry(path = getProvidersPath()) {
  if (!existsSync6(path)) {
    return { schemaVersion: REGISTRY_SCHEMA_VERSION, providers: [] };
  }
  try {
    const raw = JSON.parse(readFileSync5(path, "utf8"));
    return parseRegistry(raw);
  } catch {
    return { schemaVersion: REGISTRY_SCHEMA_VERSION, providers: [] };
  }
}
function saveRegistry(registry, path = getProvidersPath()) {
  const payload = `${JSON.stringify(registry, null, 2)}
`;
  const backup = `${path}.bak`;
  if (existsSync6(path)) {
    try {
      copyFileSync2(path, backup);
    } catch {
    }
  }
  const tmp = `${path}.tmp`;
  writeSecureFile(tmp, payload);
  renameSync2(tmp, path);
}

// src/registry/fetch-template-models.ts
var TEST_TIMEOUT_MS = 1e4;
function modelFormatForNpm(npm) {
  return npm === "@ai-sdk/anthropic" ? "anthropic" : "openai";
}
function modelsUrl(baseUrl) {
  const trimmed = baseUrl.replace(/\/$/, "");
  if (trimmed.endsWith("/v1")) return `${trimmed}/models`;
  return `${trimmed}/v1/models`;
}
function parseModelList(body, npm) {
  const rows = body.data ?? body.models ?? [];
  const format = modelFormatForNpm(npm);
  const models = [];
  for (const row of rows) {
    const id = row.id?.trim();
    if (!id) continue;
    const family = id.split(/[-/:]/)[0] ?? id;
    models.push({
      id,
      name: row.name?.trim() || id,
      upstreamModelId: id,
      family,
      brand: deriveBrand(family),
      contextWindow: resolveContextWindow(id),
      modelFormat: format,
      npm
    });
  }
  return models;
}
async function fetchTemplateModels(template, apiKey, baseUrlOverride) {
  const trimmedOverride = baseUrlOverride?.trim();
  const baseUrl = (trimmedOverride || template.defaultBaseUrl)?.replace(/\/$/, "");
  if (!baseUrl) {
    return {
      models: [],
      baseUrl: "",
      error: "This provider needs a base URL.",
      hint: "Use relay-ai providers import from OpenCode for advanced setups."
    };
  }
  const url = modelsUrl(baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json"
      },
      redirect: "manual",
      signal: controller.signal
    });
    if (response.status >= 300 && response.status < 400) {
      return {
        models: [],
        baseUrl,
        error: "Provider redirected the connection test.",
        hint: "Check the base URL \u2014 redirects are blocked for security."
      };
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const detail = body.slice(0, 200).trim();
      if (response.status === 401 || response.status === 403) {
        return {
          models: [],
          baseUrl,
          error: "API key was rejected.",
          hint: template.signupUrl ? `Get or verify your key at ${template.signupUrl}` : "Double-check the key you pasted."
        };
      }
      return {
        models: [],
        baseUrl,
        error: `Provider returned HTTP ${response.status}.`,
        hint: detail || "Check your API key and try again."
      };
    }
    const json = await response.json();
    const models = parseModelList(json, template.npm);
    if (models.length === 0) {
      return {
        models: [],
        baseUrl,
        error: "Connected but no models were returned.",
        hint: "The API key may be valid but model listing is unavailable for this provider."
      };
    }
    return { models, baseUrl };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const timedOut = message.includes("abort") || message.includes("Abort");
    return {
      models: [],
      baseUrl,
      error: timedOut ? "Connection timed out after 10 seconds." : "Could not reach the provider.",
      hint: timedOut ? "Check your network or try again." : "Verify the provider is online and your API key is correct."
    };
  } finally {
    clearTimeout(timer);
  }
}

// src/registry/url-security.ts
import { lookup } from "dns/promises";
var BLOCKED_HOSTNAMES = /* @__PURE__ */ new Set([
  "169.254.169.254",
  "metadata.google.internal",
  "169.254.170.2",
  "fd00:ec2::254",
  "localhost"
]);
function ipv4ToInt(octets) {
  return (octets[0] << 24 | octets[1] << 16 | octets[2] << 8 | octets[3]) >>> 0;
}
function parseIpv4(ip) {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((p9) => Number(p9));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return octets;
}
function isBlockedIpv4(ip, allowInsecureLocal) {
  const octets = parseIpv4(ip);
  if (!octets) return true;
  const n = ipv4ToInt(octets);
  if (allowInsecureLocal && octets[0] === 127) return false;
  if (octets[0] === 127) return true;
  if (octets[0] === 10) return true;
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
  if (octets[0] === 192 && octets[1] === 168) return true;
  if (octets[0] === 169 && octets[1] === 254) return true;
  if (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) return true;
  return false;
}
function expandIpv6(ip) {
  const lower = ip.toLowerCase();
  if (lower.includes("::ffff:")) {
    const mapped = lower.split("::ffff:")[1];
    if (mapped && parseIpv4(mapped)) return mapped;
  }
  return lower;
}
function isBlockedIpv6(ip, allowInsecureLocal) {
  const lower = ip.toLowerCase();
  const mapped = expandIpv6(lower);
  if (mapped && mapped !== lower) {
    return isBlockedIpv4(mapped, allowInsecureLocal);
  }
  if (allowInsecureLocal && (lower === "::1" || lower === "0:0:0:0:0:0:0:1")) return false;
  if (lower === "::1" || lower === "0:0:0:0:0:0:0:1") return true;
  if (lower.startsWith("fe80:")) return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  return false;
}
function isBlockedIp(ip, allowInsecureLocal) {
  if (ip.includes(":")) return isBlockedIpv6(ip, allowInsecureLocal);
  return isBlockedIpv4(ip, allowInsecureLocal);
}
async function resolveHostAddresses(hostname) {
  if (parseIpv4(hostname)) return [hostname];
  try {
    const records = await lookup(hostname, { all: true, verbatim: true });
    return records.map((r) => r.address);
  } catch {
    return [];
  }
}
async function validateCustomEndpointUrl(rawUrl, opts = {}) {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { ok: false, error: "Base URL is required.", hint: "Example: https://api.example.com/v1" };
  }
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "Invalid URL.", hint: "Include https:// and the full base path." };
  }
  const allowLocal = opts.allowInsecureLocal === true;
  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return {
      ok: false,
      error: "This URL points to a blocked internal/metadata host.",
      hint: "Use a public API endpoint for your provider."
    };
  }
  if (parsed.protocol === "http:") {
    if (!allowLocal) {
      return {
        ok: false,
        error: "Only HTTPS URLs are allowed.",
        hint: "For local servers (Ollama, LM Studio), enable \u201CAllow local HTTP\u201D."
      };
    }
    if (hostname !== "127.0.0.1" && hostname !== "localhost" && hostname !== "::1") {
      return {
        ok: false,
        error: "HTTP is only allowed for localhost.",
        hint: "Use https:// for remote servers, or http://127.0.0.1 for local ones."
      };
    }
  } else if (parsed.protocol !== "https:") {
    return { ok: false, error: "URL must use https:// (or http://localhost when local is allowed)." };
  }
  const addresses = await resolveHostAddresses(hostname);
  if (addresses.length === 0) {
    return {
      ok: false,
      error: `Could not resolve hostname: ${hostname}`,
      hint: "Check the URL spelling and your network connection."
    };
  }
  for (const addr of addresses) {
    if (isBlockedIp(addr, allowLocal)) {
      return {
        ok: false,
        error: "URL resolves to a private or restricted network address.",
        hint: "Custom providers must use publicly reachable API endpoints (unless localhost with local HTTP enabled)."
      };
    }
  }
  const normalizedUrl = `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(/\/$/, "");
  return { ok: true, normalizedUrl };
}

// src/registry/custom-endpoint.ts
function npmForKind(kind) {
  return kind === "anthropic" ? "@ai-sdk/anthropic" : "@ai-sdk/openai-compatible";
}
function modelFormatForKind(kind) {
  return kind === "anthropic" ? "anthropic" : "openai";
}
async function fetchAnthropicModels(baseUrl, apiKey) {
  const root = baseUrl.replace(/\/v1\/?$/, "").replace(/\/$/, "");
  const modelsUrl2 = `${root}/v1/models`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1e4);
  try {
    const response = await fetch(modelsUrl2, {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        Accept: "application/json"
      },
      redirect: "manual",
      signal: controller.signal
    });
    if (response.ok) {
      const json = await response.json();
      const models = [];
      for (const row of json.data ?? []) {
        const id = row.id?.trim();
        if (!id) continue;
        models.push({
          id,
          name: row.name?.trim() || id,
          upstreamModelId: id,
          family: id.split("-")[0] ?? id,
          brand: deriveBrand(id),
          contextWindow: resolveContextWindow(id),
          modelFormat: "anthropic",
          npm: "@ai-sdk/anthropic",
          apiUrl: root
        });
      }
      if (models.length > 0) return { models, baseUrl: root };
    }
    if (response.status === 401 || response.status === 403) {
      return { models: [], baseUrl: root, error: "API key was rejected.", hint: "Check your Anthropic-compatible API key." };
    }
    return {
      models: [],
      baseUrl: root,
      error: `Could not list models (HTTP ${response.status}).`,
      hint: "Verify the base URL supports Anthropic-compatible /v1/models or try the OpenAI-compatible option instead."
    };
  } catch {
    return {
      models: [],
      baseUrl: root,
      error: "Could not reach the Anthropic-compatible server.",
      hint: "Check the base URL and that the server is running."
    };
  } finally {
    clearTimeout(timer);
  }
}
function uniqueProviderId(displayName, registry) {
  let base = customProviderId(displayName);
  if (!base.startsWith("custom-")) base = `custom-${slugifyProviderId(displayName)}`;
  if (!isValidProviderId(base)) base = "custom-provider";
  if (!registry.providers.some((p9) => p9.id === base)) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}-${i}`;
    if (isValidProviderId(candidate) && !registry.providers.some((p9) => p9.id === candidate)) {
      return candidate;
    }
  }
  return `${base}-${Date.now()}`;
}
async function addCustomEndpointProvider(input) {
  const urlCheck = await validateCustomEndpointUrl(input.baseUrl, {
    allowInsecureLocal: input.allowInsecureLocal
  });
  if (!urlCheck.ok || !urlCheck.normalizedUrl) {
    return { added: false, error: urlCheck.error, hint: urlCheck.hint };
  }
  const registry = loadRegistry();
  const providerId = uniqueProviderId(input.displayName.trim(), registry);
  const npm = npmForKind(input.kind);
  const apiKey = input.apiKey.trim() || "local";
  let fetched;
  if (input.kind === "anthropic") {
    fetched = await fetchAnthropicModels(urlCheck.normalizedUrl, apiKey);
  } else {
    fetched = await fetchTemplateModels(
      {
        id: providerId,
        name: input.displayName,
        authType: apiKey === "local" ? "none" : "api",
        npm,
        defaultBaseUrl: urlCheck.normalizedUrl,
        modelSource: "api-list",
        supported: true
      },
      apiKey,
      urlCheck.normalizedUrl
    );
  }
  if (fetched.error || fetched.models.length === 0) {
    return { added: false, error: fetched.error ?? "No models returned.", hint: fetched.hint };
  }
  if (apiKey !== "local") {
    const saved = await saveProviderCredential(`keyring:provider:${providerId}`, apiKey);
    if (!saved) {
      return { added: false, error: "Could not save API key to Keychain.", hint: "Grant Keychain access and try again." };
    }
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const entry = {
    id: providerId,
    templateId: input.kind === "anthropic" ? "custom-anthropic" : "custom-openai",
    name: input.displayName.trim(),
    enabled: true,
    authRef: apiKey === "local" ? `keyring:provider:${providerId}` : `keyring:provider:${providerId}`,
    api: { npm, url: fetched.baseUrl },
    addedAt: now,
    refreshedAt: now,
    modelsCache: {
      fetchedAt: now,
      models: fetched.models.map((m) => ({
        ...m,
        modelFormat: modelFormatForKind(input.kind),
        npm,
        apiUrl: fetched.baseUrl
      }))
    }
  };
  if (apiKey === "local") {
    await saveProviderCredential(entry.authRef, "local");
  }
  registry.providers.push(entry);
  saveRegistry(registry);
  return { added: true, provider: entry, modelCount: fetched.models.length };
}

// src/registry/refresh-credentials.ts
var PLACEHOLDER_KEYS = /* @__PURE__ */ new Set([
  "anything",
  "local",
  "ollama",
  "none",
  "n/a",
  "na",
  "placeholder",
  "test",
  "no-key"
]);
var ENV_FALLBACK_BY_PROVIDER = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"]
};
function isPlaceholderProviderKey(key) {
  if (!key?.trim()) return true;
  return PLACEHOLDER_KEYS.has(key.trim().toLowerCase());
}
function isLikelyPlaceholderKey(key) {
  if (isPlaceholderProviderKey(key)) return true;
  const trimmed = key?.trim() ?? "";
  if (trimmed.length <= 2) return true;
  return false;
}
function cachedModelCount(provider) {
  return provider.modelsCache?.models.length ?? 0;
}
function skipWithCachedModels(provider, reason) {
  const count = cachedModelCount(provider);
  return {
    id: provider.id,
    name: provider.name,
    ok: true,
    skipped: true,
    modelCount: count > 0 ? count : void 0,
    reason
  };
}
async function resolveRefreshCredential(provider, resolveKey) {
  let key = await resolveKey(provider);
  if (!isLikelyPlaceholderKey(key)) return key;
  for (const envVar of ENV_FALLBACK_BY_PROVIDER[provider.id] ?? []) {
    const fromEnv = process.env[envVar]?.trim();
    if (fromEnv && !isLikelyPlaceholderKey(fromEnv)) return fromEnv;
  }
  return key;
}

// src/provider-templates.ts
var PROVIDER_TEMPLATES = [
  {
    id: "groq",
    name: "Groq",
    authType: "api",
    npm: "@ai-sdk/groq",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    signupUrl: "https://console.groq.com/keys",
    modelSource: "api-list",
    supported: true
  },
  {
    id: "mistral",
    name: "Mistral",
    authType: "api",
    npm: "@ai-sdk/mistral",
    defaultBaseUrl: "https://api.mistral.ai/v1",
    signupUrl: "https://console.mistral.ai/api-keys",
    modelSource: "api-list",
    supported: true
  },
  {
    id: "togetherai",
    name: "Together AI",
    authType: "api",
    npm: "@ai-sdk/togetherai",
    defaultBaseUrl: "https://api.together.xyz/v1",
    signupUrl: "https://api.together.xyz/settings/api-keys",
    modelSource: "api-list",
    supported: true
  },
  {
    id: "cerebras",
    name: "Cerebras",
    authType: "api",
    npm: "@ai-sdk/cerebras",
    defaultBaseUrl: "https://api.cerebras.ai/v1",
    signupUrl: "https://cloud.cerebras.ai",
    modelSource: "api-list",
    supported: true
  },
  {
    id: "deepinfra",
    name: "DeepInfra",
    authType: "api",
    npm: "@ai-sdk/deepinfra",
    defaultBaseUrl: "https://api.deepinfra.com/v1/openai",
    signupUrl: "https://deepinfra.com/dash/api_keys",
    modelSource: "api-list",
    supported: true
  },
  {
    id: "xai",
    name: "xAI",
    authType: "api",
    npm: "@ai-sdk/xai",
    defaultBaseUrl: "https://api.x.ai/v1",
    signupUrl: "https://console.x.ai",
    modelSource: "api-list",
    supported: true
  },
  {
    id: "perplexity",
    name: "Perplexity",
    authType: "api",
    npm: "@ai-sdk/perplexity",
    defaultBaseUrl: "https://api.perplexity.ai",
    signupUrl: "https://www.perplexity.ai/settings/api",
    modelSource: "api-list",
    supported: true
  },
  {
    id: "cohere",
    name: "Cohere",
    authType: "api",
    npm: "@ai-sdk/cohere",
    defaultBaseUrl: "https://api.cohere.com/compatibility/v1",
    signupUrl: "https://dashboard.cohere.com/api-keys",
    modelSource: "api-list",
    supported: true
  },
  {
    id: "openai",
    name: "OpenAI",
    authType: "api",
    npm: "@ai-sdk/openai",
    defaultBaseUrl: "https://api.openai.com/v1",
    signupUrl: "https://platform.openai.com/api-keys",
    modelSource: "api-list",
    supported: true
  },
  {
    id: "google",
    name: "Google Gemini",
    authType: "api",
    npm: "@ai-sdk/google",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    signupUrl: "https://aistudio.google.com/apikey",
    modelSource: "api-list",
    supported: true
  },
  {
    id: "alibaba",
    name: "Alibaba DashScope",
    authType: "api",
    npm: "@ai-sdk/alibaba",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    signupUrl: "https://dashscope.console.aliyun.com/apiKey",
    modelSource: "api-list",
    supported: true
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    authType: "api",
    npm: "@openrouter/ai-sdk-provider",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    signupUrl: "https://openrouter.ai/keys",
    modelSource: "api-list",
    supported: true
  },
  {
    id: "venice",
    name: "Venice AI",
    authType: "api",
    npm: "venice-ai-sdk-provider",
    defaultBaseUrl: "https://api.venice.ai/api/v1",
    signupUrl: "https://venice.ai/settings/api",
    modelSource: "api-list",
    supported: true
  },
  {
    id: "anthropic",
    name: "Anthropic",
    authType: "api",
    npm: "@ai-sdk/anthropic",
    defaultBaseUrl: "https://api.anthropic.com",
    signupUrl: "https://console.anthropic.com/settings/keys",
    modelSource: "api-list",
    supported: true
  },
  {
    id: "bedrock",
    name: "Amazon Bedrock",
    authType: "api",
    npm: "@ai-sdk/amazon-bedrock",
    modelSource: "manual-only",
    supported: false,
    unsupportedReason: "Requires AWS credentials \u2014 use relay-ai providers import from OpenCode for now."
  },
  {
    id: "azure",
    name: "Azure OpenAI",
    authType: "api",
    npm: "@ai-sdk/azure",
    modelSource: "manual-only",
    supported: false,
    unsupportedReason: "Requires Azure deployment URLs \u2014 use relay-ai providers import from OpenCode for now."
  },
  {
    id: "vertex",
    name: "Google Vertex AI",
    authType: "none",
    npm: "@ai-sdk/google-vertex",
    modelSource: "manual-only",
    supported: false,
    unsupportedReason: "Uses gcloud Application Default Credentials \u2014 use relay-ai server --vertex instead."
  }
];
function listSupportedTemplates() {
  return PROVIDER_TEMPLATES.filter((t) => t.supported && t.authType === "api");
}
function listAddableTemplates(configuredIds = []) {
  const configured = new Set(configuredIds);
  return listSupportedTemplates().filter((t) => !configured.has(t.id));
}
function getTemplateById(id) {
  return PROVIDER_TEMPLATES.find((t) => t.id === id);
}
function filterTemplates(templates, query) {
  const q = query.trim().toLowerCase();
  if (!q) return templates;
  return templates.filter(
    (t) => t.id.toLowerCase().includes(q) || t.name.toLowerCase().includes(q) || t.npm.toLowerCase().includes(q)
  );
}

// src/registry/resolve-template.ts
var TEMPLATE_ID_ALIASES = {
  "google-vertex": "vertex"
};
var NPM_DEFAULT_BASE_URL = {
  "@ai-sdk/anthropic": "https://api.anthropic.com"
};
function resolveProviderTemplate(provider) {
  const candidates = [
    TEMPLATE_ID_ALIASES[provider.templateId],
    provider.templateId,
    TEMPLATE_ID_ALIASES[provider.id],
    provider.id
  ].filter(Boolean);
  for (const id of candidates) {
    const template = getTemplateById(id);
    if (template) return template;
  }
  return void 0;
}
function effectiveProviderBaseUrl(provider, template) {
  const fromRegistry = provider.api.url?.trim();
  if (fromRegistry) return fromRegistry;
  if (template?.defaultBaseUrl?.trim()) return template.defaultBaseUrl.trim();
  const npm = provider.api.npm?.trim();
  if (npm && NPM_DEFAULT_BASE_URL[npm]) return NPM_DEFAULT_BASE_URL[npm];
  return void 0;
}
function syntheticTemplate(provider, baseUrl) {
  const npm = provider.api.npm ?? "@ai-sdk/openai-compatible";
  return {
    id: provider.id,
    name: provider.name,
    authType: "api",
    npm,
    defaultBaseUrl: baseUrl,
    modelSource: "api-list",
    supported: true
  };
}

// src/registry/model-source.ts
var MANUAL_ONLY_TEMPLATE_IDS = /* @__PURE__ */ new Set(["vertex", "bedrock", "azure"]);
var MANUAL_ONLY_PROVIDER_IDS = /* @__PURE__ */ new Set(["google-vertex", "vertex", "bedrock", "azure"]);
var MANUAL_ONLY_NPMS = /* @__PURE__ */ new Set([
  "@ai-sdk/google-vertex",
  "@ai-sdk/amazon-bedrock",
  "@ai-sdk/azure"
]);
function resolveModelSource(provider) {
  if (provider.id === "zen" || provider.id === "go" || provider.templateId === "zen" || provider.templateId === "go") {
    return "zen-go-api";
  }
  if (MANUAL_ONLY_PROVIDER_IDS.has(provider.id) || MANUAL_ONLY_PROVIDER_IDS.has(provider.templateId) || MANUAL_ONLY_TEMPLATE_IDS.has(provider.templateId) || provider.api.npm && MANUAL_ONLY_NPMS.has(provider.api.npm)) {
    return "manual-only";
  }
  const template = resolveProviderTemplate(provider) ?? getTemplateById(provider.templateId);
  if (template) return template.modelSource;
  if (provider.templateId === "custom-openai" || provider.templateId === "custom-anthropic") {
    return "api-list";
  }
  return "api-list";
}

// src/registry/validate-import-key.ts
async function validateImportKey(lp, entry) {
  const key = lp.apiKey?.trim() ?? "";
  if (!key) {
    return { shouldSaveKey: false, reason: "invalid-key", detail: "No API key in OpenCode config." };
  }
  if (isLikelyPlaceholderKey(key)) {
    return {
      shouldSaveKey: false,
      reason: "placeholder-key",
      detail: 'OpenCode has a placeholder key (e.g. "anything") \u2014 not saved to Keychain.'
    };
  }
  const source = resolveModelSource(entry);
  if (source === "manual-only") {
    return {
      shouldSaveKey: false,
      reason: "untested-manual",
      detail: "Provider uses gcloud/AWS/Azure auth \u2014 API key not stored by relay-ai."
    };
  }
  if (source === "zen-go-api") {
    return { shouldSaveKey: true };
  }
  const npm = entry.api.npm ?? lp.models[0]?.npm ?? "@ai-sdk/openai-compatible";
  const catalogTemplate = resolveProviderTemplate(entry);
  const baseUrl = effectiveProviderBaseUrl(entry, catalogTemplate);
  if (!baseUrl) {
    return {
      shouldSaveKey: false,
      reason: "invalid-key",
      detail: "No API base URL \u2014 cannot verify key."
    };
  }
  if (npm === "@ai-sdk/anthropic") {
    const result2 = await fetchAnthropicModels(baseUrl, key);
    if (result2.error) {
      return {
        shouldSaveKey: false,
        reason: "invalid-key",
        detail: result2.error
      };
    }
    return { shouldSaveKey: true };
  }
  const template = catalogTemplate ?? syntheticTemplate(entry, baseUrl);
  const result = await fetchTemplateModels(template, key, baseUrl);
  if (result.error) {
    return {
      shouldSaveKey: false,
      reason: "invalid-key",
      detail: result.error
    };
  }
  return { shouldSaveKey: true };
}

// src/registry/import-opencode.ts
async function saveProviderKey(provider) {
  if (!provider.apiKey?.trim()) return false;
  return saveProviderCredential(`keyring:provider:${provider.id}`, provider.apiKey);
}
async function keyHint(providerId, authRef, fallbackKey) {
  const fromStore = await resolveProviderCredential(providerId, authRef);
  const key = fromStore ?? fallbackKey ?? "";
  if (!key) return "no key";
  if (key.length <= 5) return "\xB7\xB7\xB7\xB7" + key;
  return "\xB7\xB7\xB7\xB7" + key.slice(-5);
}
async function importFromOpencode(options = {}) {
  const fetched = await fetchLocalProviders();
  if (fetched === null) {
    return {
      imported: [],
      skipped: [],
      keysSkipped: [],
      keysSaved: 0,
      error: "OpenCode CLI not found or failed to start. Install from https://opencode.ai"
    };
  }
  const registry = loadRegistry();
  const imported = [];
  const skipped = [];
  const keysSkipped = [];
  let keysSaved = 0;
  for (const lp of fetched) {
    if (!lp.models.length) {
      skipped.push({ id: lp.id, name: lp.name, reason: "no-models" });
      continue;
    }
    const entry = localProviderToRegistry(lp);
    if (!entry) {
      skipped.push({
        id: lp.id,
        name: lp.name,
        reason: isValidProviderId(lp.id) ? "convert-failed" : "invalid-id"
      });
      continue;
    }
    const existingIdx = registry.providers.findIndex((p9) => p9.id === entry.id);
    const existing = existingIdx >= 0 ? registry.providers[existingIdx] : void 0;
    if (existing && options.resolveConflict) {
      const choice = await options.resolveConflict({
        existing,
        incoming: entry,
        incomingProvider: lp,
        existingKeyHint: await keyHint(existing.id, existing.authRef),
        incomingKeyHint: await keyHint(entry.id, entry.authRef, lp.apiKey)
      });
      if (choice === "skip") {
        skipped.push({ id: lp.id, name: lp.name, reason: "user-skipped" });
        continue;
      }
      if (choice === "keep") {
        skipped.push({ id: lp.id, name: lp.name, reason: "conflict-kept" });
        continue;
      }
    }
    if (existingIdx >= 0) {
      registry.providers[existingIdx] = { ...entry, addedAt: registry.providers[existingIdx].addedAt };
    } else {
      registry.providers.push(entry);
    }
    imported.push(entry);
    const keyCheck = await validateImportKey(lp, entry);
    if (keyCheck.shouldSaveKey) {
      if (await saveProviderKey(lp)) keysSaved += 1;
    } else if (keyCheck.reason) {
      keysSkipped.push({
        id: lp.id,
        name: lp.name,
        reason: keyCheck.reason,
        detail: keyCheck.detail
      });
      await deleteProviderCredential(entry.authRef);
    }
  }
  registry.importedAt = (/* @__PURE__ */ new Date()).toISOString();
  saveRegistry(registry);
  return { imported, skipped, keysSkipped, keysSaved };
}

// src/first-run.ts
async function needsFirstRunSetup() {
  const registry = loadRegistry();
  if (registry.providers.length > 0) return false;
  const key = await readGlobalOpencodeCredential();
  return !key;
}
function ensureZenRegistryStub() {
  const registry = loadRegistry();
  if (registry.providers.some((pr) => pr.id === "zen")) return;
  registry.providers.push(zenRegistryStub());
  saveRegistry(registry);
}
async function runFirstRunWizard(trace = false) {
  p2.note("Let's get you set up.", pc2.bold("Welcome to relay-ai!"));
  const hasOpencode = findOpencodeBinary() !== null;
  const options = [
    {
      value: "zen",
      label: "Quick start with OpenCode Zen (free)",
      hint: "Enter your API key and pick a model \u2014 launches Claude Code"
    },
    {
      value: "providers",
      label: "Set up your own AI provider",
      hint: hasOpencode ? "Import providers you configured in OpenCode" : "Import from OpenCode or add providers via relay-ai providers"
    }
  ];
  if (hasOpencode) {
    options.push({
      value: "import",
      label: "Bring settings from OpenCode",
      hint: "One-time import of your OpenCode provider config"
    });
  }
  const choice = await p2.select({
    message: "How do you want to get started?",
    options
  });
  if (p2.isCancel(choice)) {
    p2.cancel("Cancelled.");
    return "cancel";
  }
  if (choice === "zen") {
    const apiKey = await resolveOrCollectApiKey(false, trace);
    if (!apiKey) return "cancel";
    await migrateGlobalOpencodeCredential();
    ensureZenRegistryStub();
    setSubscriptionTier("free");
    p2.log.success("OpenCode Zen ready \u2014 picking a model next.");
    return "continue";
  }
  if (choice === "import" || choice === "providers") {
    if (!hasOpencode && choice === "import") {
      p2.log.error("OpenCode CLI not found. Install from https://opencode.ai");
      return runFirstRunWizard(trace);
    }
    if (!hasOpencode) {
      p2.log.info("Run relay-ai providers to add providers, then relay-ai claude again.");
      p2.log.info("Quick start with Zen is the fastest path if you have an OpenCode API key.");
      const retry = await p2.select({
        message: "What next?",
        options: [
          { value: "zen", label: "Quick start with OpenCode Zen", hint: "" },
          { value: "cancel", label: "Cancel", hint: "" }
        ]
      });
      if (p2.isCancel(retry) || retry === "cancel") return "cancel";
      return runFirstRunWizard(trace);
    }
    const spinner5 = p2.spinner();
    spinner5.start("Importing from OpenCode...");
    const result = await importFromOpencode();
    spinner5.stop("");
    if (result.error) {
      p2.log.error(result.error);
      return runFirstRunWizard(trace);
    }
    if (result.imported.length === 0) {
      p2.log.warn("No providers imported. Configure providers in OpenCode first, or use Quick start with Zen.");
      return runFirstRunWizard(trace);
    }
    p2.log.success(
      `Imported ${result.imported.length} provider${result.imported.length === 1 ? "" : "s"}.`
    );
    return "continue";
  }
  return "continue";
}

// src/proxy.ts
import { createServer } from "http";
import { appendFileSync as appendFileSync2, openSync as openSync2, writeSync as writeSync2, closeSync as closeSync2 } from "fs";

// src/server/vendor-mask.ts
function reverseSegment(value) {
  return [...value].reverse().join("");
}
function maskGatewayModelId(aliasId) {
  if (!aliasId.startsWith("anthropic-")) return aliasId;
  const sep = aliasId.indexOf("__");
  if (sep === -1) return aliasId;
  const providerSlug = aliasId.slice("anthropic-".length, sep);
  const modelSuffix = aliasId.slice(sep + 2);
  return `anthropic-${reverseSegment(providerSlug)}__${reverseSegment(modelSuffix)}`;
}

// src/server/models.ts
var CREATED_AT_ISO = "2025-01-01T00:00:00Z";
var CREATED_AT_UNIX = 1735689600;
function formatAnthropicModelEntry(id, displayName, contextWindow) {
  const maxInput = resolveContextWindow(id, contextWindow);
  return {
    id,
    type: "model",
    display_name: displayName,
    created_at: CREATED_AT_ISO,
    context_window: maxInput,
    max_input_tokens: maxInput
  };
}
function formatAnthropicModelList(entries) {
  return {
    data: entries.map((entry) => formatAnthropicModelEntry(entry.id, entry.name, entry.contextWindow)),
    has_more: false,
    first_id: entries[0]?.id ?? null,
    last_id: entries.at(-1)?.id ?? null
  };
}
function gatewayProviderLabel(model) {
  return model.providerLabel ?? (model.sourceBackend === "go" ? "OpenCode Go" : "OpenCode Zen");
}
function gatewayProviderId(model) {
  return model.providerId ?? model.sourceBackend;
}
function gatewayAliasId(model) {
  return aliasModelId(model.id, gatewayProviderId(model));
}
function exposedGatewayAliasId(model, opts) {
  const alias = gatewayAliasId(model);
  return opts?.maskGatewayIds ? maskGatewayModelId(alias) : alias;
}
function gatewayDisplayName(model, opts) {
  if (!opts?.maskGatewayIds) return model.name;
  return `${model.name} (${gatewayProviderLabel(model)})`;
}
function formatGatewayAnthropicModels(models, opts) {
  return formatAnthropicModelList(
    models.map((model) => ({
      id: exposedGatewayAliasId(model, opts),
      name: gatewayDisplayName(model, opts),
      contextWindow: model.contextWindow
    }))
  );
}
function createGatewayModelCatalog(models, opts) {
  const byId = /* @__PURE__ */ new Map();
  for (const model of models) {
    byId.set(model.id, model);
    const alias = exposedGatewayAliasId(model, opts);
    if (alias !== model.id) byId.set(alias, model);
    if (opts?.maskGatewayIds) {
      const rawAlias = gatewayAliasId(model);
      if (rawAlias !== alias) byId.set(rawAlias, model);
    }
  }
  return {
    get: (id) => byId.get(id),
    list: () => [...models]
  };
}
function upstreamModelId(model) {
  const id = model.upstreamModelId ?? model.id;
  return id.replace(/\[1m\]$/i, "");
}
function formatOpenAIModels(models) {
  return {
    object: "list",
    data: models.map((model) => ({
      id: model.id,
      object: "model",
      created: CREATED_AT_UNIX,
      owned_by: model.sourceBackend
    }))
  };
}

// src/upstream-forward.ts
import { Readable } from "stream";

// src/server/auth.ts
function sanitizeCredential(value) {
  if (!value) return null;
  const firstLine = value.trim().split(/\r?\n/)[0]?.trim();
  return firstLine || null;
}
function isAuthorized(request, serverPassword) {
  if (serverPassword === null) return true;
  const bearerToken = extractBearerToken(request.headers.get("authorization"));
  if (bearerToken === serverPassword) return true;
  return sanitizeCredential(request.headers.get("x-api-key")) === serverPassword;
}
function extractBearerToken(value) {
  if (!value) return null;
  const normalized = value.replace(/\r?\n/g, " ").trim();
  const match = /^Bearer\s+(\S+)/i.exec(normalized);
  return sanitizeCredential(match?.[1]);
}

// src/upstream-forward.ts
function anthropicUpstreamHeaders(apiKey, stream = false) {
  const key = sanitizeCredential(apiKey) ?? apiKey.trim();
  return {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
    Authorization: `Bearer ${key}`,
    "x-api-key": key,
    ...stream ? { Accept: "text/event-stream" } : {}
  };
}
async function postJsonUpstream(url, body, apiKey) {
  const response = await fetch(url, {
    method: "POST",
    headers: anthropicUpstreamHeaders(apiKey, false),
    body: JSON.stringify(body)
  });
  const text4 = await response.text();
  let parsed = null;
  if (text4) {
    try {
      parsed = JSON.parse(text4);
    } catch {
      parsed = text4;
    }
  }
  return { status: response.status, body: parsed };
}
var UpstreamUnreachableError = class extends Error {
  constructor(cause) {
    super(`Upstream unreachable: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "UpstreamUnreachableError";
  }
};
async function relayAnthropicMessages(res, messagesUrl, body, apiKey, clientWantsStream) {
  let upstreamRes;
  try {
    upstreamRes = await fetch(messagesUrl, {
      method: "POST",
      headers: anthropicUpstreamHeaders(apiKey, clientWantsStream),
      body: JSON.stringify(body)
    });
  } catch (err) {
    throw new UpstreamUnreachableError(err);
  }
  if (!upstreamRes.ok) {
    const errBody = await upstreamRes.text();
    res.writeHead(upstreamRes.status, { "Content-Type": upstreamRes.headers.get("content-type") || "application/json" });
    res.end(errBody);
    return;
  }
  if (clientWantsStream && upstreamRes.body) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    });
    Readable.fromWeb(upstreamRes.body).on("error", () => res.destroy()).pipe(res);
    return;
  }
  if (!upstreamRes.body) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "Upstream returned empty response body" } }));
    return;
  }
  let json;
  try {
    json = await upstreamRes.json();
  } catch {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "Upstream response was not valid JSON" } }));
    return;
  }
  const payload = JSON.stringify(json);
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload).toString()
  });
  res.end(payload);
}

// src/provider-factory.ts
var RESPONSES_ONLY_PREFIXES = [
  "gpt-5.4",
  "gpt-5.5",
  "gpt-5-codex",
  "gpt-5-pro",
  "gpt-5.2-pro",
  "o3",
  "o4"
];
var factoryCache = /* @__PURE__ */ new Map();
function modelPrefersResponsesApi(modelId) {
  const lower = modelId.toLowerCase();
  if (RESPONSES_ONLY_PREFIXES.some((prefix) => lower === prefix || lower.startsWith(`${prefix}-`))) {
    return true;
  }
  if (lower.startsWith("gpt-") && lower.includes("-codex")) return true;
  if (lower.startsWith("grok-") && (lower.includes("multi-agent") || lower.includes("multiagent"))) return true;
  return false;
}
function isSdkMigratedNpm(npm) {
  return !!npm && npm !== "@ai-sdk/anthropic";
}
function findCreateFactory(mod) {
  for (const value of Object.values(mod)) {
    if (typeof value === "function" && value.name.startsWith("create")) {
      return value;
    }
  }
  throw new Error("No create* factory export found in provider package");
}
async function loadSdkProviderFactory(npm) {
  let cached = factoryCache.get(npm);
  if (!cached) {
    cached = (async () => {
      try {
        const mod = await import(npm);
        return findCreateFactory(mod);
      } catch (err) {
        const code = err && typeof err === "object" && "code" in err ? err.code : void 0;
        if (code === "ERR_MODULE_NOT_FOUND") {
          throw new Error(`SDK provider package not installed: ${npm}. Run: npm install ${npm}`);
        }
        throw err;
      }
    })();
    factoryCache.set(npm, cached);
    cached.catch(() => factoryCache.delete(npm));
  }
  return cached;
}
async function createLanguageModel(spec) {
  const { npm, modelId, apiKey, baseURL } = spec;
  if (npm === VERTEX_ANTHROPIC_NPM) {
    if (!spec.vertex?.project) {
      throw new Error("Vertex project is required for @ai-sdk/google-vertex/anthropic");
    }
    const { createVertexAnthropic } = await import("@ai-sdk/google-vertex/anthropic");
    const vertex = createVertexAnthropic({
      project: spec.vertex.project,
      location: spec.vertex.location
    });
    return vertex(modelId);
  }
  if (npm === "@ai-sdk/openai") {
    const { createOpenAI } = await import("@ai-sdk/openai");
    const openai = createOpenAI({ apiKey });
    return modelPrefersResponsesApi(modelId) ? openai.responses(modelId) : openai.chat(modelId);
  }
  if (npm === "@ai-sdk/xai") {
    const { createXai } = await import("@ai-sdk/xai");
    const xai = createXai({ apiKey });
    return modelPrefersResponsesApi(modelId) ? xai.responses(modelId) : xai(modelId);
  }
  if (npm === "@ai-sdk/openai-compatible") {
    const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
    return createOpenAICompatible({
      name: spec.providerId ?? "openai-compatible",
      apiKey,
      baseURL: baseURL ?? ""
    })(modelId);
  }
  if (npm === "@openrouter/ai-sdk-provider") {
    const { createOpenRouter } = await import("@openrouter/ai-sdk-provider");
    return createOpenRouter({ apiKey, baseURL })(modelId);
  }
  const create = await loadSdkProviderFactory(npm);
  const provider = create(baseURL ? { apiKey, baseURL } : { apiKey });
  return provider(modelId);
}
function thinkingProviderOptions(npm) {
  if (npm === "@ai-sdk/google") {
    return { google: { thinkingConfig: { includeThoughts: true } } };
  }
  if (npm === "@ai-sdk/openai") {
    return {
      openai: {
        store: false,
        include: ["reasoning.encrypted_content"]
      }
    };
  }
  return void 0;
}

// src/sdk-adapter.ts
import { streamText, generateText, tool, jsonSchema } from "ai";

// src/proxy-shared.ts
var TOOL_USE_SIG_SEP = "::ts::";
function sseChunk(eventType, data) {
  return `event: ${eventType}
data: ${JSON.stringify(data)}

`;
}
function splitToolUseId(id) {
  const sep = id.lastIndexOf(TOOL_USE_SIG_SEP);
  if (sep === -1) return { rawId: id };
  return {
    rawId: id.slice(0, sep),
    thoughtSignature: id.slice(sep + TOOL_USE_SIG_SEP.length)
  };
}
function encodeToolUseId(rawId, thoughtSignature) {
  return thoughtSignature ? `${rawId}${TOOL_USE_SIG_SEP}${thoughtSignature}` : rawId;
}
function serializeToolResultContent(content) {
  return typeof content === "string" ? content : JSON.stringify(content);
}

// src/tool-search.ts
var TOOL_SEARCH_TYPE_PREFIX = "tool_search_tool";
function isToolSearchTool(tool2) {
  if (typeof tool2.type === "string" && tool2.type.startsWith(TOOL_SEARCH_TYPE_PREFIX)) return true;
  const name = tool2.name ?? "";
  return name.includes("tool_search") || name === "ToolSearch";
}
function extractReferencedToolNames(messages) {
  const names = /* @__PURE__ */ new Set();
  const visitContent = (content) => {
    if (typeof content === "string") return;
    if (!Array.isArray(content)) return;
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const part = block;
      if (part.type === "tool_reference" && typeof part.tool_name === "string") {
        names.add(part.tool_name);
      }
      if (part.type === "tool_search_tool_result") {
        const inner = part.content;
        const refs = inner?.tool_references;
        if (Array.isArray(refs)) {
          for (const ref of refs) {
            if (ref && typeof ref === "object" && typeof ref.tool_name === "string") {
              names.add(ref.tool_name);
            }
          }
        }
      }
      if (part.type === "tool_result" && part.content) {
        visitContent(part.content);
      }
    }
  };
  for (const msg of messages ?? []) {
    visitContent(msg.content);
  }
  return names;
}
function resolveUpstreamTools(tools, messages) {
  if (!tools?.length) return [];
  const referenced = extractReferencedToolNames(messages);
  const upstream = [];
  for (const tool2 of tools) {
    if (isToolSearchTool(tool2)) {
      upstream.push(tool2);
      continue;
    }
    if (tool2.defer_loading === true) {
      if (referenced.has(tool2.name)) upstream.push(tool2);
      continue;
    }
    upstream.push(tool2);
  }
  return upstream;
}

// src/sdk-adapter.ts
var sdkWarningsSilenced = false;
function silenceSdkWarnings() {
  if (sdkWarningsSilenced) return;
  sdkWarningsSilenced = true;
  globalThis.AI_SDK_LOG_WARNINGS = false;
}
function systemToString(system) {
  if (!system) return void 0;
  if (typeof system === "string") return system;
  return system.map((b) => typeof b === "string" ? b : b.text ?? "").join("\n");
}
function inlineSystemText(messages) {
  const parts = [];
  for (const msg of messages) {
    if (msg.role !== "system") continue;
    const text4 = typeof msg.content === "string" ? msg.content : msg.content.map((b) => b.text ?? "").join("\n");
    if (text4.trim()) parts.push(text4.trim());
  }
  return parts;
}
function imagePart(block) {
  const src = block.source;
  if (!src) return null;
  if (src.type === "base64" && src.data) {
    return { type: "image", image: Buffer.from(src.data, "base64"), mediaType: src.media_type };
  }
  if (src.type === "url" && src.url) {
    return { type: "image", image: new URL(src.url) };
  }
  return null;
}
function annotateToolNames(messages) {
  const nameById = /* @__PURE__ */ new Map();
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const b of msg.content) {
      if (b.type === "tool_use" && b.id && b.name) nameById.set(splitToolUseId(b.id).rawId, b.name);
    }
  }
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const b of msg.content) {
      if (b.type === "tool_result" && b.tool_use_id) {
        b._name = nameById.get(splitToolUseId(b.tool_use_id).rawId);
      }
    }
  }
}
function thinkingToSdkPart(block, npm) {
  if (npm !== "@ai-sdk/google" && npm !== "@ai-sdk/openai") return null;
  const text4 = block.thinking ?? "";
  if (npm === "@ai-sdk/openai" && !block.signature && !text4.trim()) return null;
  const part = { type: "reasoning", text: text4 };
  if (block.signature) {
    part.providerOptions = npm === "@ai-sdk/google" ? { google: { thoughtSignature: block.signature } } : { openai: { reasoningEncryptedContent: block.signature } };
  }
  return part;
}
function translateMessages(messages, npm) {
  const isGoogle = npm === "@ai-sdk/google";
  const out = [];
  for (const msg of messages) {
    const blocks = typeof msg.content === "string" ? [{ type: "text", text: msg.content }] : msg.content ?? [];
    if (msg.role === "user") {
      const toolResults = blocks.filter((b) => b.type === "tool_result");
      const parts = [];
      for (const b of blocks) {
        if (b.type === "text") parts.push({ type: "text", text: b.text ?? "" });
        else if (b.type === "image") {
          const p9 = imagePart(b);
          if (p9) parts.push(p9);
        }
      }
      if (toolResults.length) {
        out.push({
          role: "tool",
          content: toolResults.map((tr) => ({
            type: "tool-result",
            toolCallId: splitToolUseId(tr.tool_use_id ?? "").rawId,
            toolName: tr._name ?? "unknown",
            output: { type: "text", value: serializeToolResultContent(tr.content) }
          }))
        });
      }
      if (parts.length) out.push({ role: "user", content: parts });
    } else if (msg.role === "assistant") {
      const parts = [];
      for (const b of blocks) {
        if (b.type === "text") {
          parts.push({ type: "text", text: b.text ?? "" });
        } else if (b.type === "thinking") {
          const part = thinkingToSdkPart(b, npm);
          if (part) parts.push(part);
        } else if (b.type === "tool_use" && b.id) {
          const { rawId, thoughtSignature } = splitToolUseId(b.id);
          const part = {
            type: "tool-call",
            toolCallId: rawId,
            toolName: b.name,
            input: b.input ?? {}
          };
          if (thoughtSignature && isGoogle) part.providerOptions = { google: { thoughtSignature } };
          parts.push(part);
        }
      }
      if (parts.length) out.push({ role: "assistant", content: parts });
    }
  }
  return out;
}
function translateTools(anthropicTools) {
  if (!anthropicTools?.length) return void 0;
  const tools = {};
  for (const t of anthropicTools) {
    if (!t.name || !t.input_schema) continue;
    tools[t.name] = tool({ description: t.description ?? "", inputSchema: jsonSchema(t.input_schema) });
  }
  return Object.keys(tools).length ? tools : void 0;
}
function translateToolChoice(tc) {
  if (!tc) return void 0;
  if (tc.type === "auto") return "auto";
  if (tc.type === "any") return "required";
  if (tc.type === "tool" && tc.name) return { type: "tool", toolName: tc.name };
  return void 0;
}
function translateRequest(body, npm) {
  const messages = body.messages ?? [];
  annotateToolNames(messages);
  const baseSystem = systemToString(body.system);
  const inlineParts = inlineSystemText(messages);
  const system = [baseSystem, ...inlineParts].filter((s) => s && s.trim()).join("\n\n") || void 0;
  const upstreamTools = resolveUpstreamTools(
    body.tools,
    messages
  );
  return {
    system,
    messages: translateMessages(messages, npm),
    tools: translateTools(upstreamTools.length ? upstreamTools : void 0),
    toolChoice: translateToolChoice(body.tool_choice),
    maxOutputTokens: body.max_tokens,
    temperature: body.temperature,
    providerOptions: thinkingProviderOptions(npm)
  };
}
function grabRoundTripSignature(part) {
  const md = part.providerMetadata;
  return md?.google?.thoughtSignature ?? md?.google?.thought_signature ?? md?.openai?.reasoningEncryptedContent ?? void 0;
}
async function writeAnthropicStream(fullStream, modelId, write, log8) {
  const messageId = "msg_" + Date.now();
  let blockIndex = -1;
  let started = false;
  let openType = null;
  let pendingThinkingSig;
  const idToBlock = /* @__PURE__ */ new Map();
  let finishReason = "end_turn";
  let usage = { input_tokens: 0, output_tokens: 0 };
  const emit = (event, data) => write(sseChunk(event, data));
  const ensureStart = () => {
    if (started) return;
    emit("message_start", {
      type: "message_start",
      message: {
        id: messageId,
        type: "message",
        role: "assistant",
        content: [],
        model: modelId,
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 }
      }
    });
    started = true;
  };
  const closeOpen = () => {
    if (openType === "thinking") {
      emit("content_block_delta", {
        type: "content_block_delta",
        index: blockIndex,
        delta: { type: "signature_delta", signature: pendingThinkingSig ?? "" }
      });
      pendingThinkingSig = void 0;
    }
    if (openType) emit("content_block_stop", { type: "content_block_stop", index: blockIndex });
    openType = null;
  };
  const openBlock = (type, contentBlock) => {
    ensureStart();
    closeOpen();
    blockIndex++;
    openType = type;
    emit("content_block_start", { type: "content_block_start", index: blockIndex, content_block: contentBlock });
  };
  for await (const part of fullStream) {
    switch (part.type) {
      case "start":
        ensureStart();
        break;
      case "reasoning-start":
        openBlock("thinking", { type: "thinking", thinking: "", signature: "" });
        break;
      case "reasoning-delta":
        if (openType !== "thinking") openBlock("thinking", { type: "thinking", thinking: "", signature: "" });
        emit("content_block_delta", {
          type: "content_block_delta",
          index: blockIndex,
          delta: { type: "thinking_delta", thinking: part.text ?? "" }
        });
        break;
      case "reasoning-end": {
        const sig = grabRoundTripSignature(part);
        if (sig) pendingThinkingSig = sig;
        break;
      }
      case "text-start":
        openBlock("text", { type: "text", text: "" });
        break;
      case "text-delta":
        if (openType !== "text") openBlock("text", { type: "text", text: "" });
        emit("content_block_delta", {
          type: "content_block_delta",
          index: blockIndex,
          delta: { type: "text_delta", text: part.text ?? "" }
        });
        break;
      case "text-end":
        break;
      case "tool-input-start": {
        const sig = grabRoundTripSignature(part);
        openBlock("tool", {
          type: "tool_use",
          id: encodeToolUseId(part.id ?? "", sig),
          name: part.toolName,
          input: {}
        });
        idToBlock.set(part.id ?? "", blockIndex);
        break;
      }
      case "tool-input-delta":
        emit("content_block_delta", {
          type: "content_block_delta",
          index: idToBlock.get(part.id ?? "") ?? blockIndex,
          delta: { type: "input_json_delta", partial_json: part.delta ?? part.text ?? "" }
        });
        break;
      case "tool-input-end":
        break;
      case "tool-call": {
        finishReason = "tool_use";
        if (!idToBlock.has(part.toolCallId ?? "") && openType !== "tool") {
          const sig = grabRoundTripSignature(part);
          openBlock("tool", {
            type: "tool_use",
            id: encodeToolUseId(part.toolCallId ?? "", sig),
            name: part.toolName,
            input: {}
          });
          emit("content_block_delta", {
            type: "content_block_delta",
            index: blockIndex,
            delta: { type: "input_json_delta", partial_json: JSON.stringify(part.input ?? {}) }
          });
        }
        break;
      }
      case "finish":
        if (part.totalUsage) {
          usage = {
            input_tokens: part.totalUsage.inputTokens ?? 0,
            output_tokens: part.totalUsage.outputTokens ?? 0
          };
        }
        if (part.finishReason === "tool-calls") finishReason = "tool_use";
        else if (part.finishReason === "length") finishReason = "max_tokens";
        else if (part.finishReason === "stop" && finishReason !== "tool_use") finishReason = "end_turn";
        break;
      case "error": {
        const e = part.error;
        log8?.(() => `sdk stream error: ${JSON.stringify(e?.data ?? part.error)}`);
        closeOpen();
        ensureStart();
        emit("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage });
        emit("message_stop", { type: "message_stop" });
        return;
      }
      default:
        break;
    }
  }
  closeOpen();
  ensureStart();
  emit("message_delta", { type: "message_delta", delta: { stop_reason: finishReason, stop_sequence: null }, usage });
  emit("message_stop", { type: "message_stop" });
}
async function streamAnthropicResponse(model, params, modelId, write, log8) {
  const result = streamText({ model, ...params });
  await writeAnthropicStream(result.fullStream, modelId, write, log8);
}
async function generateAnthropicResponse(model, params, modelId) {
  const r = await generateText({ model, ...params });
  return {
    id: "msg_" + Date.now(),
    type: "message",
    role: "assistant",
    model: modelId,
    content: [
      ...r.text ? [{ type: "text", text: r.text }] : [],
      ...r.toolCalls.map((tc) => ({
        type: "tool_use",
        id: tc.toolCallId,
        name: tc.toolName,
        input: tc.input
      }))
    ],
    stop_reason: r.finishReason === "tool-calls" ? "tool_use" : "end_turn",
    usage: { input_tokens: r.usage?.inputTokens ?? 0, output_tokens: r.usage?.outputTokens ?? 0 }
  };
}

// src/proxy.ts
function appendSecureLog(logPath, line) {
  const redacted = redactTraceLine(line);
  try {
    const fd = openSync2(logPath, "a", 384);
    try {
      writeSync2(fd, `${(/* @__PURE__ */ new Date()).toISOString()} ${redacted}
`);
    } finally {
      closeSync2(fd);
    }
  } catch {
    try {
      appendFileSync2(logPath, `${(/* @__PURE__ */ new Date()).toISOString()} ${redacted}
`);
    } catch {
    }
  }
}
function makeProxyLog(debug, logPath) {
  if (!debug) return () => {
  };
  const path = logPath ?? getProxyDebugLogPath();
  resetTraceLog(path);
  return (message) => {
    const line = typeof message === "function" ? message() : message;
    appendSecureLog(path, line);
  };
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalSize = 0;
    req.on("data", (c) => {
      totalSize += c.length;
      if (totalSize > 50 * 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}
function extractApiKey(req) {
  const xApiKey = req.headers["x-api-key"];
  if (typeof xApiKey === "string") return xApiKey;
  const auth = req.headers["authorization"];
  if (typeof auth === "string") return auth.replace("Bearer ", "").trim();
  return null;
}
function sendJson(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(json);
}
function anthropicError(res, status, message) {
  sendJson(res, status, {
    type: "error",
    error: { type: "api_error", message }
  });
}
function aliasModelId(realId, providerId) {
  if (realId.startsWith("claude-")) return realId;
  const sanitized = providerId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `anthropic-${sanitized}__${realId}`;
}
function startProxyCatalog(routes, defaultAliasId, debug = false) {
  silenceSdkWarnings();
  if (routes.length === 0) {
    return Promise.reject(new Error("Proxy catalog requires at least one route"));
  }
  const byAlias = new Map(routes.map((r) => [r.aliasId, r]));
  const defaultRoute = byAlias.get(defaultAliasId) ?? routes[0];
  const plog = makeProxyLog(debug);
  const modelsPayload = JSON.stringify(
    formatAnthropicModelList(
      routes.map((r) => ({ id: r.aliasId, name: r.displayName, contextWindow: r.contextWindow }))
    )
  );
  const server = createServer(async (req, res) => {
    plog(() => `${req.method} ${req.url}`);
    if (req.method === "HEAD") {
      res.writeHead(200);
      res.end();
      return;
    }
    if (req.method === "GET" && req.url?.startsWith("/v1/models")) {
      const modelPathMatch = req.url.match(/^\/v1\/models\/([^?]+)/);
      if (modelPathMatch) {
        const id = decodeURIComponent(modelPathMatch[1]);
        const route = byAlias.get(id);
        if (route) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(formatAnthropicModelEntry(route.aliasId, route.displayName, route.contextWindow)));
        } else {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { type: "not_found_error", message: `Model '${id}' not found` } }));
        }
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(modelsPayload);
      }
      return;
    }
    if (req.method === "POST" && req.url?.startsWith("/v1/messages")) {
      const inboundKey = extractApiKey(req);
      let anthropicBody;
      try {
        const raw = await readBody(req);
        anthropicBody = JSON.parse(raw);
      } catch {
        anthropicError(res, 400, "Invalid JSON body");
        return;
      }
      const originalModel = anthropicBody.model;
      const clientWantsStream = Boolean(anthropicBody.stream);
      const route = byAlias.get(originalModel) ?? defaultRoute;
      const apiKey = route.apiKey || inboundKey || "";
      const upstreamUrl = route.upstreamUrl;
      plog(
        () => `POST /v1/messages - alias=${originalModel} route=${route.realModelId} format=${route.modelFormat} key=${apiKey ? `len:${apiKey.length}` : "MISSING"}`
      );
      if (!apiKey) {
        anthropicError(res, 401, "Missing API key");
        return;
      }
      if (route.modelFormat === "anthropic") {
        const forwardBody = { ...anthropicBody, model: route.realModelId };
        const targetUrl = `${upstreamUrl}/v1/messages`;
        plog(() => `anthropic-passthrough: model=${route.realModelId}, stream=${clientWantsStream}`);
        try {
          await relayAnthropicMessages(res, targetUrl, forwardBody, apiKey, clientWantsStream);
        } catch (err) {
          const message = err instanceof UpstreamUnreachableError ? err.message : String(err);
          plog(() => `anthropic-passthrough error: ${message}`);
          anthropicError(res, 502, message);
        }
        return;
      }
      if (isSdkMigratedNpm(route.npm)) {
        const params = translateRequest(anthropicBody, route.npm);
        plog(
          () => `sdk: npm=${route.npm} model=${route.realModelId}, stream=${clientWantsStream}, tools=${anthropicBody.tools?.length ?? 0}, msgs=${params.messages.length}`
        );
        try {
          const model = await createLanguageModel({
            npm: route.npm,
            modelId: route.realModelId,
            apiKey,
            baseURL: route.baseURL,
            providerId: route.aliasId
          });
          if (clientWantsStream) {
            res.writeHead(200, {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              "Connection": "keep-alive"
            });
            await streamAnthropicResponse(model, params, originalModel, (c) => res.write(c), plog);
            res.end();
          } else {
            const anthropicResponse = await generateAnthropicResponse(model, params, originalModel);
            sendJson(res, 200, anthropicResponse);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          plog(() => `sdk error: ${message}`);
          if (!res.headersSent) anthropicError(res, 502, message);
          else res.end();
        }
        return;
      }
      anthropicError(res, 500, `No SDK provider configured for model ${originalModel} (npm=${route.npm ?? "none"})`);
      return;
    }
    anthropicError(res, 404, `Unknown endpoint: ${req.method} ${req.url}`);
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to bind proxy"));
        return;
      }
      plog(() => `started on port ${addr.port}, catalog=${routes.length} model(s), default=${defaultRoute.aliasId}`);
      resolve({
        port: addr.port,
        close: () => server.close()
      });
    });
  });
}
function startProxy(completionsUrl, modelId, debug = false, contextWindow, sdk) {
  return startProxyCatalog([{
    aliasId: modelId,
    realModelId: sdk?.upstreamModelId ?? modelId,
    displayName: modelId,
    upstreamUrl: completionsUrl,
    apiKey: "",
    // '' → use inbound bearer from Claude Code (single-model compat)
    modelFormat: "openai",
    contextWindow,
    npm: sdk?.npm,
    baseURL: sdk?.baseURL
  }], modelId, debug);
}

// src/catalog.ts
function localModelToRoute(lp, model) {
  if (model.modelFormat === "anthropic" && !model.baseUrl) return null;
  if (model.modelFormat === "openai" && !isSdkMigratedNpm(model.npm) && !model.completionsUrl) return null;
  return {
    aliasId: aliasModelId(model.id, lp.id),
    realModelId: model.upstreamModelId,
    displayName: `${model.name || model.id} (${lp.name})`,
    upstreamUrl: (model.modelFormat === "anthropic" ? model.baseUrl : model.completionsUrl) ?? "",
    apiKey: lp.apiKey,
    modelFormat: model.modelFormat,
    contextWindow: model.contextWindow,
    npm: model.npm,
    baseURL: model.apiBaseUrl
  };
}
function zenGoModelToRoute(model, apiKey) {
  if (model.modelFormat === "unsupported") return null;
  const backend = BACKENDS[model.sourceBackend];
  const isAnthropic = model.modelFormat === "anthropic";
  return {
    aliasId: aliasModelId(model.id, model.sourceBackend),
    realModelId: model.id,
    displayName: `${model.name} (${backend.name})`,
    upstreamUrl: isAnthropic ? backend.baseUrl : `${backend.baseUrl}/v1/chat/completions`,
    apiKey,
    modelFormat: model.modelFormat,
    contextWindow: model.contextWindow,
    // openai-format Zen/Go models route through the SDK (openai-compatible);
    // anthropic models stay direct passthrough (no npm).
    npm: isAnthropic ? void 0 : "@ai-sdk/openai-compatible",
    baseURL: isAnthropic ? void 0 : `${backend.baseUrl}/v1`
  };
}
function makeRouteResolver(localProviders, zenModels, goModels, zenGoApiKey) {
  return (providerId, modelId) => {
    if (providerId === "zen" || providerId === "go") {
      if (!zenGoApiKey) return void 0;
      const model2 = (providerId === "zen" ? zenModels : goModels).find((m) => m.id === modelId);
      return model2 ? zenGoModelToRoute(model2, zenGoApiKey) ?? void 0 : void 0;
    }
    const provider = localProviders?.find((lp) => lp.id === providerId);
    const model = provider?.models.find((m) => m.id === modelId);
    return provider && model ? localModelToRoute(provider, model) ?? void 0 : void 0;
  };
}
function buildCatalogRoutes(startingRoute, favorites, resolveRoute, max = MAX_MODEL_CATALOG) {
  const droppedFavorites = [];
  const tail = favorites.map((fav) => {
    const route = resolveRoute(fav.providerId, fav.modelId);
    if (!route) droppedFavorites.push(fav);
    return route;
  }).filter((route) => route !== void 0);
  const routes = [
    startingRoute,
    ...tail.filter((route) => route.aliasId !== startingRoute.aliasId)
  ].slice(0, max);
  return { routes, droppedFavorites };
}

// src/server/index.ts
import pc4 from "picocolors";
import { networkInterfaces } from "os";
import * as p5 from "@clack/prompts";

// src/registry/materialize.ts
function cachedModelToLocal(cached, provider) {
  const npm = cached.npm ?? provider.api.npm ?? "";
  const apiUrl = cached.apiUrl ?? provider.api.url ?? "";
  const endpoint = resolveEndpoint(npm, apiUrl);
  if (endpoint === null) return null;
  return {
    id: cached.id,
    name: cached.name,
    family: cached.family ?? "",
    brand: cached.brand ?? deriveBrand(cached.family ?? ""),
    modelFormat: cached.modelFormat ?? endpoint.format,
    upstreamModelId: cached.upstreamModelId,
    baseUrl: endpoint.baseUrl,
    completionsUrl: endpoint.completionsUrl,
    npm: npm || void 0,
    apiBaseUrl: apiUrl || void 0,
    cost: cached.cost,
    contextWindow: cached.contextWindow ?? resolveContextWindow(cached.id)
  };
}
function materializeOne(provider, resolveCredential) {
  if (!provider.enabled) return null;
  if (!isValidProviderId(provider.id)) return null;
  const models = [];
  for (const cached of provider.modelsCache?.models ?? []) {
    const model = cachedModelToLocal(cached, provider);
    if (model) models.push(model);
  }
  if (models.length === 0) return null;
  const apiKey = resolveCredential(provider) ?? "";
  if (!apiKey) return null;
  return {
    id: provider.id,
    name: provider.name,
    apiKey,
    models
  };
}
function materializeRegistry(registry, resolveCredential) {
  const result = [];
  for (const provider of registry.providers) {
    const local = materializeOne(provider, resolveCredential);
    if (local) result.push(local);
  }
  return result;
}

// src/registry/load.ts
async function loadRegistryProviders(diag) {
  const registry = loadRegistry();
  const keys = /* @__PURE__ */ new Map();
  for (const provider of registry.providers) {
    const key = await resolveProviderCredential(provider.id, provider.authRef, diag);
    if (key) keys.set(provider.id, key);
  }
  return materializeRegistry(registry, (provider) => keys.get(provider.id) ?? null);
}

// src/provider-catalog.ts
async function fetchZenGoModels(backends, persistCache = false) {
  const results = await Promise.all(
    backends.map(async (id) => {
      const result = await getModels(BACKENDS[id], getCachedModels(id) ?? void 0);
      if (!result.fromCache && persistCache) setCachedModels(id, result.models);
      return { id, models: result.models };
    })
  );
  let zenModels = [];
  let goModels = [];
  for (const entry of results) {
    if (entry.id === "zen") zenModels = entry.models;
    else goModels = entry.models;
  }
  return { zenModels, goModels };
}
async function resolveLocalProviders() {
  const fromRegistry = await loadRegistryProviders();
  if (fromRegistry.length > 0) return fromRegistry;
  if (process.env["RELAY_AI_LEGACY_SERVE"] === "0") return [];
  const fromOpencode = await fetchLocalProviders();
  return fromOpencode ?? [];
}
async function fetchProviderCatalog(opts) {
  const persistCache = opts?.persistCache ?? false;
  const [localProviders, zenGo] = await Promise.all([
    resolveLocalProviders(),
    fetchZenGoModels(["zen", "go"], persistCache)
  ]);
  return {
    localProviders,
    zenModels: zenGo.zenModels,
    goModels: zenGo.goModels
  };
}
function zenGoAsLocalProvider(backendId, models) {
  const name = backendId === "zen" ? "OpenCode Zen" : "OpenCode Go";
  return {
    id: backendId,
    name,
    apiKey: "",
    models: models.filter((m) => m.modelFormat !== "unsupported").map((m) => ({
      id: m.id,
      name: m.name,
      family: m.brand,
      brand: m.brand,
      modelFormat: m.modelFormat,
      upstreamModelId: m.id,
      contextWindow: m.contextWindow,
      cost: m.cost
    }))
  };
}
function providersForPicker(catalog) {
  return [
    ...catalog.zenModels.length > 0 ? [zenGoAsLocalProvider("zen", catalog.zenModels)] : [],
    ...catalog.goModels.length > 0 ? [zenGoAsLocalProvider("go", catalog.goModels)] : [],
    ...catalog.localProviders
  ];
}
function countUsableZenGoModels(models) {
  return models.filter((m) => m.modelFormat !== "unsupported").length;
}
async function resolveProvidersForDisplay() {
  const reg = loadRegistry();
  const registryIds = new Set(reg.providers.map((p9) => p9.id));
  const entries = [];
  const opencodeKey = await readGlobalOpencodeCredential();
  let zenCount = 0;
  let goCount = 0;
  if (opencodeKey) {
    const zenGo = await fetchZenGoModels(["zen", "go"]);
    zenCount = countUsableZenGoModels(zenGo.zenModels);
    goCount = countUsableZenGoModels(zenGo.goModels);
    if (!registryIds.has("zen") && zenCount > 0) {
      entries.push({
        id: "zen",
        name: "OpenCode Zen",
        modelCount: zenCount,
        enabled: true,
        authLabel: "keychain (OpenCode API key)",
        inRegistry: false,
        cloudBuiltin: "zen"
      });
    }
    if (!registryIds.has("go") && goCount > 0) {
      entries.push({
        id: "go",
        name: "OpenCode Go",
        modelCount: goCount,
        enabled: true,
        authLabel: "keychain (OpenCode API key)",
        inRegistry: false,
        cloudBuiltin: "go"
      });
    }
  }
  for (const provider of reg.providers) {
    let modelCount = provider.modelsCache?.models.length ?? 0;
    if (provider.id === "zen" && zenCount > 0) modelCount = zenCount;
    if (provider.id === "go" && goCount > 0) modelCount = goCount;
    entries.push({
      id: provider.id,
      name: provider.name,
      modelCount,
      enabled: provider.enabled,
      authLabel: provider.authRef.startsWith("keyring:global:opencode") ? "keychain (OpenCode API key)" : provider.authRef.startsWith("keyring:") ? "keychain" : provider.authRef,
      inRegistry: true
    });
  }
  return entries;
}
async function resolveZenGoAvailability() {
  const reg = loadRegistry();
  const key = await readGlobalOpencodeCredential();
  if (!key) {
    return {
      zen: reg.providers.some((p9) => p9.id === "zen"),
      go: reg.providers.some((p9) => p9.id === "go")
    };
  }
  const zenGo = await fetchZenGoModels(["zen", "go"]);
  return {
    zen: reg.providers.some((p9) => p9.id === "zen") || countUsableZenGoModels(zenGo.zenModels) > 0,
    go: reg.providers.some((p9) => p9.id === "go") || countUsableZenGoModels(zenGo.goModels) > 0
  };
}
function localProvidersToServerModels(localProviders) {
  const models = [];
  for (const provider of localProviders) {
    for (const model of provider.models) {
      models.push({
        id: model.id,
        name: model.name,
        isFree: false,
        brand: model.brand,
        providerLabel: provider.name,
        providerId: provider.id,
        sourceBackend: provider.id,
        modelFormat: model.modelFormat,
        upstreamModelId: model.upstreamModelId,
        cost: model.cost,
        baseUrl: model.baseUrl,
        completionsUrl: model.completionsUrl,
        npm: model.npm,
        apiBaseUrl: model.apiBaseUrl,
        apiKey: provider.apiKey,
        contextWindow: model.contextWindow
      });
    }
  }
  return models;
}
function zenGoModelsToServerModels(models) {
  return models.filter((m) => m.modelFormat !== "unsupported").map((model) => {
    const base = {
      id: model.id,
      name: model.name,
      isFree: model.isFree,
      brand: model.brand,
      providerLabel: model.sourceBackend === "go" ? "OpenCode Go" : "OpenCode Zen",
      providerId: model.sourceBackend,
      sourceBackend: model.sourceBackend,
      modelFormat: model.modelFormat,
      cost: model.cost,
      contextWindow: model.contextWindow
    };
    if (model.modelFormat === "openai") {
      base.npm = "@ai-sdk/openai-compatible";
      base.apiBaseUrl = `${BACKENDS[model.sourceBackend].baseUrl}/v1`;
    }
    return base;
  });
}

// src/server/prompts.ts
import * as p3 from "@clack/prompts";
async function askServerStartMode() {
  const mode = await p3.select({
    message: "How do you want to start the server?",
    options: [
      { value: "configure", label: "Configure & start", hint: "Providers, discovery masking, listen mode" },
      { value: "quick", label: "Start with saved settings", hint: "Use last server configuration" }
    ],
    initialValue: "configure"
  });
  if (p3.isCancel(mode)) {
    p3.cancel("Cancelled.");
    return null;
  }
  return mode;
}
async function askMaskGatewayIds(initialValue) {
  p3.note(
    "Claude Desktop and Cowork filter competitor model names in gateway ids. Masking keeps discovery working while display names stay readable.",
    "Needed for Claude Desktop / Cowork"
  );
  const mask = await p3.confirm({
    message: "Mask gateway model ids for discovery?",
    initialValue
  });
  if (p3.isCancel(mask)) {
    p3.cancel("Cancelled.");
    return null;
  }
  return Boolean(mask);
}
async function askFavoritesOnly(initialValue) {
  const favoritesOnly = await p3.confirm({
    message: "Expose only favorite models?",
    initialValue
  });
  if (p3.isCancel(favoritesOnly)) {
    p3.cancel("Cancelled.");
    return null;
  }
  return Boolean(favoritesOnly);
}
async function askListenMode() {
  const mode = await p3.select({
    message: "Where should the server listen?",
    options: [
      { value: "local", label: "Local only", hint: "Only this computer can use it" },
      { value: "network", label: "Network", hint: "Other computers on your network can use it" }
    ],
    initialValue: "local"
  });
  if (p3.isCancel(mode)) {
    p3.cancel("Cancelled.");
    return null;
  }
  return mode;
}
async function askServerPassword() {
  p3.note(
    "Anyone on your network who knows this password can use this server through your OpenCode account.",
    "Network mode warning"
  );
  const password3 = await p3.text({
    message: "Choose a server password for this run:",
    validate: (value) => value.trim() ? void 0 : "Password cannot be empty"
  });
  if (p3.isCancel(password3)) {
    p3.cancel("Cancelled.");
    return null;
  }
  return String(password3).trim();
}
async function askUseSavedServerPassword() {
  const choice = await p3.select({
    message: "Use saved server password?",
    options: [
      { value: "use-saved", label: "Use saved password" },
      { value: "new-password", label: "Enter a new password" }
    ],
    initialValue: "use-saved"
  });
  if (p3.isCancel(choice)) {
    p3.cancel("Cancelled.");
    return null;
  }
  return choice;
}
async function askSaveServerPassword() {
  const save = await p3.confirm({
    message: "Save this server password for future server runs?",
    initialValue: false
  });
  if (p3.isCancel(save)) {
    p3.cancel("Cancelled.");
    return null;
  }
  return Boolean(save);
}

// src/server/router.ts
import { createServer as createServer2 } from "http";
async function startServer(options) {
  silenceSdkWarnings();
  const server = createServer2((req, res) => {
    void routeRequest(req, res, options);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Server did not bind to a TCP port");
  }
  return {
    host: options.host,
    port: address.port,
    url: `http://${options.host}:${address.port}`,
    server,
    close: () => new Promise((resolve, reject) => {
      server.close((err) => err ? reject(err) : resolve());
    })
  };
}
async function routeRequest(req, res, options) {
  try {
    const pathname = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`).pathname;
    if (req.method === "GET" && pathname === "/health") {
      sendJson2(res, 200, { ok: true });
      return;
    }
    if (!isAuthorized(toRequest(req), options.serverPassword)) {
      sendJson2(res, 401, { error: { message: "Unauthorized" } });
      return;
    }
    if (req.method === "GET" && pathname === "/models") {
      sendJson2(res, 200, { models: options.catalog.list().map(({ apiKey: _apiKey, ...rest }) => rest) });
      return;
    }
    if (req.method === "GET" && pathname === "/anthropic/v1/models") {
      sendJson2(res, 200, formatGatewayAnthropicModels(options.catalog.list(), options.gateway));
      return;
    }
    if (req.method === "GET" && pathname === "/openai/v1/models") {
      sendJson2(res, 200, formatOpenAIModels(options.catalog.list()));
      return;
    }
    if (req.method === "POST" && pathname === "/anthropic/v1/messages") {
      await handleAnthropicMessages(req, res, options);
      return;
    }
    if (req.method === "POST" && pathname === "/openai/v1/chat/completions") {
      await handleOpenAIChatCompletions(req, res, options);
      return;
    }
    sendJson2(res, 404, { error: { message: "Not found" } });
  } catch (err) {
    sendJson2(res, 500, { error: { message: err instanceof Error ? err.message : String(err) } });
  }
}
async function handleAnthropicMessages(req, res, options) {
  const body = await readJson(req);
  if (!body) {
    sendJson2(res, 400, { error: { message: "Invalid JSON body" } });
    return;
  }
  const model = lookupModel(res, options.catalog, body.model);
  if (!model) return;
  if (model.modelFormat === "anthropic") {
    if (model.baseUrl && !/^https?:\/\//i.test(model.baseUrl)) {
      sendJson2(res, 400, { error: { message: `Invalid provider baseUrl: must be http:// or https://` } });
      return;
    }
    const messagesUrl = model.baseUrl ? `${model.baseUrl}/v1/messages` : `${backendFor(options, model).baseUrl}/v1/messages`;
    const apiKey = model.apiKey ?? options.apiKey;
    await forwardJson(res, messagesUrl, { ...body, model: upstreamModelId(model) }, apiKey);
    return;
  }
  if (model.modelFormat === "openai") {
    if (!isSdkMigratedNpm(model.npm)) {
      sendJson2(res, 400, { error: { message: `No SDK provider for model: ${model.id}` } });
      return;
    }
    const apiKey = model.apiKey ?? options.apiKey;
    const languageModel = await createLanguageModel({
      npm: model.npm,
      modelId: upstreamModelId(model),
      apiKey,
      baseURL: model.apiBaseUrl,
      providerId: model.sourceBackend,
      vertex: options.vertex
    });
    const params = translateRequest(body, model.npm);
    const clientWantsStream = Boolean(body.stream);
    try {
      if (clientWantsStream) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive"
        });
        const clientModel = typeof body.model === "string" ? body.model : model.id;
        await streamAnthropicResponse(languageModel, params, clientModel, (chunk) => res.write(chunk));
        res.end();
      } else {
        const clientModel = typeof body.model === "string" ? body.model : model.id;
        const anthropicResponse = await generateAnthropicResponse(languageModel, params, clientModel);
        sendJson2(res, 200, anthropicResponse);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) sendJson2(res, 502, { error: { message } });
      else res.end();
    }
    return;
  }
  sendJson2(res, 400, { error: { message: `Unsupported model format: ${model.modelFormat}` } });
}
async function handleOpenAIChatCompletions(req, res, options) {
  const body = await readJson(req);
  if (!body) {
    sendJson2(res, 400, { error: { message: "Invalid JSON body" } });
    return;
  }
  const model = lookupModel(res, options.catalog, body.model);
  if (!model) return;
  if (model.modelFormat === "openai") {
    if (model.completionsUrl && !/^https?:\/\//i.test(model.completionsUrl)) {
      sendJson2(res, 400, { error: { message: `Invalid provider completionsUrl: must be http:// or https://` } });
      return;
    }
    const completionsUrl = model.completionsUrl ? model.completionsUrl : `${backendFor(options, model).baseUrl}/v1/chat/completions`;
    const apiKey = model.apiKey ?? options.apiKey;
    await forwardJson(res, completionsUrl, body, apiKey);
    return;
  }
  if (model.modelFormat === "anthropic") {
    sendJson2(res, 400, { error: { message: "OpenAI to Anthropic reverse translation is not supported yet" } });
    return;
  }
  sendJson2(res, 400, { error: { message: `Unsupported model format: ${model.modelFormat}` } });
}
function lookupModel(res, catalog, modelId) {
  if (typeof modelId !== "string") {
    sendJson2(res, 400, { error: { message: "Request body must include a model string" } });
    return null;
  }
  const model = catalog.get(modelId);
  if (!model) {
    sendJson2(res, 400, { error: { message: `Unknown model: ${modelId}` } });
    return null;
  }
  return model;
}
function backendFor(options, model) {
  if (model.sourceBackend === "vertex") {
    throw new Error(`Vertex models route through the SDK adapter, not cloud backends: ${model.id}`);
  }
  if (model.sourceBackend === "zen") return options.backends.zen;
  if (model.sourceBackend === "go") return options.backends.go;
  throw new Error(`Provider ${model.sourceBackend} is not a cloud backend \u2014 model must set baseUrl/completionsUrl`);
}
async function forwardJson(res, url, body, apiKey) {
  const upstream = await postJsonUpstream(url, body, apiKey);
  sendJson2(res, upstream.status, upstream.body);
}
async function readJson(req) {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return null;
  }
}
function toRequest(req) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, sanitizeIncomingHeaderValue(item));
    } else if (value !== void 0) {
      headers.set(name, sanitizeIncomingHeaderValue(value));
    }
  }
  return new Request("http://localhost/", { headers });
}
function sanitizeIncomingHeaderValue(value) {
  return value.replace(/\r?\n/g, " ").trim();
}
function sendJson2(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

// src/server/catalog-filter.ts
function filterServerModelsByProviders(models, providerIds) {
  if (!providerIds || providerIds.length === 0) return models;
  const allowed = new Set(providerIds);
  return models.filter((model) => model.providerId && allowed.has(model.providerId));
}
function filterServerModelsByFavorites(models, favorites) {
  if (favorites.length === 0) return [];
  const allowed = new Set(favorites.map((fav) => `${fav.providerId}:${fav.modelId}`));
  return models.filter((model) => model.providerId && allowed.has(`${model.providerId}:${model.id}`));
}
function summarizeServerProviders(models) {
  const counts = /* @__PURE__ */ new Map();
  for (const model of models) {
    const key = model.providerLabel ?? model.providerId ?? "unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, count]) => `${name} (${count})`).join(", ");
}

// src/server/provider-select.ts
import pc3 from "picocolors";
import * as p4 from "@clack/prompts";
function isSelected(list, id) {
  return list.includes(id);
}
function resolveInitialServerProviders(initial, available) {
  if (!initial?.length) return [];
  return initial.filter((id) => available.some((provider) => provider.id === id));
}
async function selectServerProviders(available, initial) {
  if (available.length === 0) {
    p4.log.warn("No providers available to expose.");
    return null;
  }
  let selected = resolveInitialServerProviders(initial, available);
  const lookup2 = new Map(available.map((provider) => [provider.id, provider]));
  while (true) {
    const options = [];
    for (let i = 0; i < selected.length; i++) {
      const id = selected[i];
      const provider = lookup2.get(id);
      const label = provider ? `\u2605 ${provider.name}` : pc3.dim(`\u2605 ${id} \u2014 provider gone`);
      const hint = provider ? `${provider.modelCount} model${provider.modelCount !== 1 ? "s" : ""}` : "select to remove";
      options.push({ value: `prov-${i}`, label, hint: "select to remove" });
    }
    const unselected = available.filter((provider) => !isSelected(selected, provider.id));
    options.push({
      value: "__add__",
      label: unselected.length === 0 ? pc3.dim("+ Add a provider \u2192 (all providers selected)") : "+ Add a provider \u2192",
      hint: unselected.length === 0 ? "" : `${unselected.length} more available`
    });
    options.push({ value: "__all__", label: "Expose all providers", hint: `${available.length} total` });
    if (selected.length > 0) {
      options.push({ value: "__clear__", label: "Clear all", hint: "start over" });
    }
    options.push({ value: "__done__", label: "Done", hint: "" });
    const header = selected.length === 0 ? `Exposed providers (0/${available.length}) \u2014 add providers to expose` : `Exposed providers (${selected.length}/${available.length}) \u2014 select to stop exposing`;
    const choice = await p4.select({
      message: header,
      options,
      initialValue: "__done__"
    });
    if (p4.isCancel(choice) || choice === "__done__") {
      if (selected.length === 0) {
        p4.log.warn("Select at least one provider to expose.");
        continue;
      }
      break;
    }
    if (choice === "__all__") {
      selected = available.map((provider) => provider.id);
      p4.log.success(`Exposing all ${available.length} providers.`);
      continue;
    }
    if (choice === "__clear__") {
      selected = [];
      p4.log.success("Cleared provider list \u2014 add the ones you want to expose.");
      continue;
    }
    if (choice === "__add__") {
      if (unselected.length === 0) continue;
      const picked = await p4.select({
        message: "Which provider?",
        options: unselected.map((provider) => ({
          value: provider.id,
          label: provider.name,
          hint: `${provider.modelCount} model${provider.modelCount !== 1 ? "s" : ""}`
        }))
      });
      if (p4.isCancel(picked)) continue;
      selected = [...selected, picked];
      continue;
    }
    if (choice.startsWith("prov-")) {
      const idx = parseInt(choice.slice(5), 10);
      const id = selected[idx];
      if (!id) continue;
      const provider = lookup2.get(id);
      selected = selected.filter((_, i) => i !== idx);
      p4.log.success(`Removed ${provider?.name ?? id}.`);
    }
  }
  return selected;
}

// src/server/vertex-config.ts
import { existsSync as existsSync7, readFileSync as readFileSync6 } from "fs";
import { homedir as homedir6 } from "os";
import { join as join7 } from "path";
var DEFAULT_VERTEX_MODELS = [
  { id: "claude-sonnet-4-6", display_name: "Claude Sonnet 4.6" },
  { id: "claude-opus-4-6", display_name: "Claude Opus 4.6" },
  { id: "claude-haiku-4-5", display_name: "Claude Haiku 4.5" }
];
var VERTEX_MODEL_SHORT_ALIASES = {
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5",
  opus: "claude-opus-4-6"
};
var VERTEX_ONE_M_MODEL_IDS = /* @__PURE__ */ new Set([
  "claude-sonnet-4-6",
  "claude-opus-4-6"
]);
function resolveVertexProject(env = process.env) {
  const project = env["ANTHROPIC_VERTEX_PROJECT_ID"] ?? env["GOOGLE_CLOUD_PROJECT"] ?? env["GOOGLE_VERTEX_PROJECT"];
  return project?.trim() || void 0;
}
function resolveVertexLocation(env = process.env) {
  const location = env["GOOGLE_CLOUD_LOCATION"] ?? env["CLOUD_ML_REGION"] ?? env["GOOGLE_VERTEX_LOCATION"] ?? "global";
  return location.trim() || "global";
}
function defaultAdcCredentialsPath(home = homedir6()) {
  return join7(home, ".config", "gcloud", "application_default_credentials.json");
}
function hasApplicationDefaultCredentials(home = homedir6(), adcPath = defaultAdcCredentialsPath(home)) {
  return existsSync7(adcPath);
}
function loadVertexModelEntries(env = process.env) {
  const configPath = getVertexModelsPath(env);
  if (!existsSync7(configPath)) return DEFAULT_VERTEX_MODELS;
  try {
    const parsed = JSON.parse(readFileSync6(configPath, "utf8"));
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
function buildVertexRuntimeConfig(env = process.env) {
  const project = resolveVertexProject(env);
  if (!project) return null;
  return {
    project,
    location: resolveVertexLocation(env),
    models: loadVertexModelEntries(env)
  };
}
function vertexModelsToServerModels(config) {
  return config.models.map((model) => ({
    id: model.id,
    name: model.display_name,
    isFree: false,
    brand: "Anthropic",
    sourceBackend: "vertex",
    modelFormat: "openai",
    upstreamModelId: model.upstream_id ?? model.id,
    npm: VERTEX_ANTHROPIC_NPM,
    providerLabel: "Vertex AI",
    providerId: "vertex",
    contextWindow: resolveContextWindow(model.id)
  }));
}
function vertexClientModelLookupCandidates(modelId) {
  const candidates = [modelId];
  const without1m = modelId.replace(/\[1m\]$/i, "");
  if (without1m !== modelId) candidates.push(without1m);
  const withoutDate = without1m.replace(/-(\d{8})$/, "");
  if (withoutDate !== without1m) candidates.push(withoutDate);
  if (withoutDate !== without1m) {
    const datedWith1m = `${withoutDate}[1m]`;
    if (!candidates.includes(datedWith1m)) candidates.push(datedWith1m);
  }
  return [...new Set(candidates)];
}
function registerVertexCatalogAlias(byId, alias, model) {
  if (!byId.has(alias)) byId.set(alias, model);
}
function createVertexModelCatalog(models) {
  const catalog = createGatewayModelCatalog(models);
  const byId = /* @__PURE__ */ new Map();
  for (const model of models) {
    byId.set(model.id, model);
    for (const [alias, targetId] of Object.entries(VERTEX_MODEL_SHORT_ALIASES)) {
      if (model.id === targetId) {
        registerVertexCatalogAlias(byId, alias, model);
        if (VERTEX_ONE_M_MODEL_IDS.has(targetId)) {
          registerVertexCatalogAlias(byId, `${alias}[1m]`, model);
        }
      }
    }
    if (VERTEX_ONE_M_MODEL_IDS.has(model.id)) {
      registerVertexCatalogAlias(byId, `${model.id}[1m]`, model);
    }
  }
  return {
    get: (id) => {
      const requested1m = /\[1m\]$/i.test(id);
      for (const candidate of vertexClientModelLookupCandidates(id)) {
        const match = byId.get(candidate) ?? catalog.get(candidate);
        if (match) {
          if (requested1m && !VERTEX_ONE_M_MODEL_IDS.has(match.id)) return void 0;
          return match;
        }
      }
      return void 0;
    },
    list: () => catalog.list()
  };
}

// src/server/index.ts
function getLocalIp() {
  const ifaces = networkInterfaces();
  for (const iface of Object.values(ifaces)) {
    for (const addr of iface ?? []) {
      if (addr.family === "IPv4" && !addr.internal) {
        return addr.address;
      }
    }
  }
  return "<this-computer-ip>";
}
function modelsForTier(tier, backendId, models) {
  if (tier === "free") return backendId === "zen" ? models.filter((model) => model.isFree) : [];
  if (tier === "go") return backendId === "zen" ? models.filter((model) => model.isFree) : models;
  return models;
}
function waitForShutdown() {
  return new Promise((resolve) => {
    const cleanup = () => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
    };
    const onSignal = () => {
      cleanup();
      resolve();
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
  });
}
async function getServerPasswordForMode(mode) {
  if (mode === "local") return null;
  const savedPassword = getSavedServerPassword();
  let serverPassword = null;
  if (savedPassword) {
    const savedChoice = await askUseSavedServerPassword();
    if (!savedChoice) return void 0;
    serverPassword = savedChoice === "use-saved" ? savedPassword : await askServerPassword();
  } else {
    serverPassword = await askServerPassword();
  }
  if (!serverPassword) return void 0;
  if (serverPassword !== savedPassword) {
    const savePassword = await askSaveServerPassword();
    if (savePassword === null) return void 0;
    if (savePassword) setSavedServerPassword(serverPassword);
  }
  return serverPassword;
}
async function loadServerModels(tier) {
  const needsZen = tier === "free" || tier === "zen" || tier === "go" || tier === "both";
  const needsGo = tier === "go" || tier === "both";
  const models = [];
  const zenGoBackends = [];
  if (needsZen) zenGoBackends.push("zen");
  if (needsGo) zenGoBackends.push("go");
  if (zenGoBackends.length > 0) {
    const zenGo = await fetchZenGoModels(zenGoBackends, true);
    if (needsZen) models.push(...zenGoModelsToServerModels(modelsForTier(tier, "zen", zenGo.zenModels)));
    if (needsGo) models.push(...zenGoModelsToServerModels(modelsForTier(tier, "go", zenGo.goModels)));
  }
  try {
    const localProviders = await fetchLocalProviders();
    if (localProviders !== null) {
      models.push(...localProvidersToServerModels(localProviders));
    } else {
      p5.log.info("No local providers found \u2014 using cloud models only");
    }
  } catch {
    p5.log.info("No local providers found \u2014 using cloud models only");
  }
  return models;
}
function providerOptionsForTier(tier, catalog) {
  const options = [];
  const needsZen = tier === "free" || tier === "zen" || tier === "go" || tier === "both";
  const needsGo = tier === "go" || tier === "both";
  if (needsZen && catalog.zenModels.length > 0) {
    options.push({
      id: "zen",
      name: "OpenCode Zen",
      modelCount: modelsForTier(tier, "zen", catalog.zenModels).length
    });
  }
  if (needsGo && catalog.goModels.length > 0) {
    options.push({
      id: "go",
      name: "OpenCode Go",
      modelCount: modelsForTier(tier, "go", catalog.goModels).length
    });
  }
  for (const provider of catalog.localProviders) {
    options.push({
      id: provider.id,
      name: provider.name,
      modelCount: provider.models.length
    });
  }
  return options;
}
async function configureExposedProviders(tier) {
  p5.log.info("Add providers to expose. Listed providers are removed when selected \u2014 like favorites.");
  const spinner5 = p5.spinner();
  spinner5.start("Loading providers...");
  const catalog = await fetchProviderCatalog();
  spinner5.stop("");
  const available = providerOptionsForTier(tier, catalog);
  const picked = await selectServerProviders(available, getServerExposedProviders() ?? void 0);
  if (!picked) return void 0;
  setServerExposedProviders(picked);
  p5.log.success(`Saved ${picked.length} provider${picked.length !== 1 ? "s" : ""} for future server runs.`);
  return picked;
}
async function runServerWizard(tier) {
  p5.intro(pc4.bold("  Relay AI \u2014 Server"));
  const startMode = await askServerStartMode();
  if (!startMode) return void 0;
  if (startMode === "quick") {
    return {
      exposedProviders: getServerExposedProviders(),
      maskGatewayIds: getServerMaskGatewayIds(),
      favoritesOnly: getServerFavoritesOnly()
    };
  }
  const exposedProviders = await configureExposedProviders(tier);
  if (exposedProviders === void 0) return void 0;
  const maskGatewayIds = await askMaskGatewayIds(getServerMaskGatewayIds());
  if (maskGatewayIds === null) return void 0;
  setServerMaskGatewayIds(maskGatewayIds);
  const favoritesOnly = await askFavoritesOnly(getServerFavoritesOnly());
  if (favoritesOnly === null) return void 0;
  setServerFavoritesOnly(favoritesOnly);
  if (favoritesOnly) {
    p5.log.info("Manage favorites with `relay-ai models`.");
  }
  return { exposedProviders, maskGatewayIds, favoritesOnly };
}
async function runVertexServerCommand() {
  p5.intro(pc4.bold("  Relay AI \u2014 Vertex Gateway"));
  const vertexConfig = buildVertexRuntimeConfig();
  if (!vertexConfig) {
    p5.log.error("Set ANTHROPIC_VERTEX_PROJECT_ID or GOOGLE_CLOUD_PROJECT to your GCP project.");
    return 1;
  }
  if (!hasApplicationDefaultCredentials()) {
    p5.log.error("Google Application Default Credentials not found.");
    p5.log.info("Run: gcloud auth application-default login");
    return 1;
  }
  const mode = await askListenMode();
  if (!mode) return 0;
  const serverPassword = await getServerPasswordForMode(mode);
  if (serverPassword === void 0) return 0;
  const host = mode === "network" ? "0.0.0.0" : "127.0.0.1";
  const models = vertexModelsToServerModels(vertexConfig);
  const server = await startServer({
    host,
    port: 17645,
    apiKey: "vertex-local",
    serverPassword,
    catalog: createVertexModelCatalog(models),
    backends: BACKENDS,
    vertex: {
      project: vertexConfig.project,
      location: vertexConfig.location
    }
  });
  console.log("");
  console.log(pc4.bold(pc4.green("Vertex gateway running")));
  console.log(`  Anthropic:  http://127.0.0.1:${server.port}/anthropic`);
  console.log(`  Models:     ${models.map((model) => model.id).join(", ")}`);
  if (mode === "network") {
    console.log(`  Network:    http://${getLocalIp()}:${server.port}`);
    console.log(`  API key:    ${serverPassword}`);
  } else {
    console.log("  API key:    any non-empty value");
  }
  console.log(pc4.dim("  Auth:       gcloud Application Default Credentials"));
  console.log("");
  console.log(pc4.dim("Press Ctrl+C to stop."));
  await waitForShutdown();
  await server.close();
  return 0;
}
async function runServerCommand(options = {}) {
  if (options.vertex) {
    return runVertexServerCommand();
  }
  let apiKey = resolveApiKey();
  if (!apiKey) {
    apiKey = await readFromCredentialStore((reason) => {
      p5.log.warn(`Credential store unavailable \u2014 ${reason}`);
    });
    if (apiKey) {
      const isMac = process.platform === "darwin";
      const isWindows3 = process.platform === "win32";
      const storeName = isMac ? "macOS Keychain" : isWindows3 ? "Windows Credential Manager" : "Secret Service";
      p5.log.success(`Found key in ${storeName}`);
    }
  }
  apiKey = sanitizeCredential(apiKey) ?? "";
  if (!apiKey) {
    p5.log.error("Missing OPENCODE_API_KEY. Run `relay-ai claude` once to configure your key, or export OPENCODE_API_KEY.");
    return 1;
  }
  const tier = getSubscriptionTier();
  if (!tier) {
    p5.log.error("Missing subscription tier. Run `relay-ai claude --setup` first.");
    return 1;
  }
  const runConfig = await runServerWizard(tier);
  if (!runConfig) return 0;
  const mode = await askListenMode();
  if (!mode) return 0;
  const serverPassword = await getServerPasswordForMode(mode);
  if (serverPassword === void 0) return 0;
  const host = mode === "network" ? "0.0.0.0" : "127.0.0.1";
  const spinner5 = p5.spinner();
  spinner5.start("Fetching available models...");
  let models;
  try {
    models = await loadServerModels(tier);
    if (runConfig.exposedProviders) {
      models = filterServerModelsByProviders(models, runConfig.exposedProviders);
    }
    if (runConfig.favoritesOnly) {
      const favorites = loadPreferences().favoriteModels ?? [];
      if (favorites.length === 0) {
        spinner5.stop(pc4.red("No favorite models configured"));
        p5.log.error("Run `relay-ai models` to add favorites, or turn off favorites-only in the server wizard.");
        return 1;
      }
      models = filterServerModelsByFavorites(models, favorites);
      if (models.length === 0) {
        spinner5.stop(pc4.red("No favorite models matched the current provider filter"));
        p5.log.error("Adjust favorites with `relay-ai models` or change exposed providers in the server wizard.");
        return 1;
      }
    }
    if (models.length === 0) {
      spinner5.stop(pc4.red("No models to expose"));
      p5.log.error("Add providers in the server wizard \u2014 Configure & start \u2192 manage exposed providers.");
      return 1;
    }
    const localCount = models.filter((m) => m.apiKey !== void 0).length;
    const summary = summarizeServerProviders(models);
    const filterNote = runConfig.exposedProviders ? ` \u2014 ${runConfig.exposedProviders.length} provider${runConfig.exposedProviders.length !== 1 ? "s" : ""}` : "";
    const favoritesNote = runConfig.favoritesOnly ? " \u2014 favorites only" : "";
    const maskNote = runConfig.maskGatewayIds ? " \u2014 discovery ids masked" : "";
    spinner5.stop(`Loaded ${models.length} models (${localCount} from local providers)${filterNote}${favoritesNote}${maskNote}`);
    if (summary) p5.log.info(summary);
  } catch (err) {
    spinner5.stop(pc4.red("Failed to load models"));
    console.error(pc4.red(String(err instanceof Error ? err.message : err)));
    return 1;
  }
  const gateway = runConfig.maskGatewayIds ? { maskGatewayIds: true } : void 0;
  const server = await startServer({
    host,
    port: 17645,
    apiKey,
    serverPassword,
    catalog: createGatewayModelCatalog(models, gateway),
    backends: BACKENDS,
    gateway
  });
  console.log("");
  console.log(pc4.bold(pc4.green("Relay AI server running")));
  console.log(`  Anthropic:  http://127.0.0.1:${server.port}/anthropic`);
  console.log(`  OpenAI:     http://127.0.0.1:${server.port}/openai`);
  if (mode === "network") {
    console.log(`  Network:    http://${getLocalIp()}:${server.port}`);
    console.log(`  API key:    ${serverPassword}`);
  } else {
    console.log("  API key:    any non-empty value");
  }
  if (runConfig.exposedProviders) {
    console.log(pc4.dim(`  Providers:  ${runConfig.exposedProviders.join(", ")}`));
  }
  if (runConfig.favoritesOnly) {
    console.log(pc4.dim("  Catalog:    favorite models only"));
  }
  if (runConfig.maskGatewayIds) {
    console.log(pc4.dim("  Discovery:  gateway ids masked for Claude Desktop / Cowork"));
  }
  console.log("");
  console.log(pc4.dim("Press Ctrl+C to stop."));
  await waitForShutdown();
  await server.close();
  return 0;
}

// src/prompts.ts
import * as p6 from "@clack/prompts";
import pc5 from "picocolors";
var BROWSE_ALL = "__browse_all__";
var MAX_RECENT = 3;
var MODEL_SEARCH_THRESHOLD = 25;
var MODEL_PAGE_SIZE = 15;
var PAGE_PREV = "__page_prev__";
var PAGE_NEXT = "__page_next__";
var SWITCH_SEARCH = "__switch_search__";
var SWITCH_BROWSE = "__switch_browse__";
var MODE_SEARCH = "search";
var MODE_BROWSE = "browse";
function sortModelsByBrand(models) {
  return [...models].sort((a, b) => {
    const brandCmp = a.brand.localeCompare(b.brand);
    return brandCmp !== 0 ? brandCmp : a.id.localeCompare(b.id);
  });
}
function filterModelsBySearch(models, query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return models.filter(
    (m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q) || m.brand.toLowerCase().includes(q)
  );
}
function sliceModelPage(items, page, pageSize = MODEL_PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const clampedPage = Math.min(Math.max(0, page), totalPages - 1);
  const start = clampedPage * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page: clampedPage,
    totalPages
  };
}
function isSelectedModel(value) {
  return value !== "search" && value !== "browse" && value !== "menu";
}
async function pickModelFromPagedList(list, toOption, messagePrefix, initialModelId, links) {
  let page = 0;
  if (initialModelId) {
    const idx = list.findIndex((m) => m.id === initialModelId);
    if (idx >= 0) page = Math.floor(idx / MODEL_PAGE_SIZE);
  }
  while (true) {
    const { items: pageItems, page: currentPage, totalPages } = sliceModelPage(list, page);
    const options = [];
    if (currentPage > 0) {
      options.push({
        value: PAGE_PREV,
        label: "\u2190 Previous page",
        hint: `Page ${currentPage} of ${totalPages}`
      });
    }
    options.push(...pageItems.map(toOption));
    if (currentPage < totalPages - 1) {
      options.push({
        value: PAGE_NEXT,
        label: "Next page \u2192",
        hint: `Page ${currentPage + 2} of ${totalPages}`
      });
    }
    if (links?.search) {
      options.push({ value: SWITCH_SEARCH, label: "Search instead \u2192", hint: "" });
    }
    if (links?.browse) {
      options.push({ value: SWITCH_BROWSE, label: "Browse all instead \u2192", hint: "" });
    }
    if (links?.newSearch) {
      options.push({ value: SWITCH_SEARCH, label: "\u2190 New search", hint: "" });
    }
    const initialValue = (initialModelId && pageItems.some((m) => m.id === initialModelId) ? initialModelId : pageItems[0]?.id) ?? options[0]?.value;
    const picked = await p6.select({
      message: `${messagePrefix} (page ${currentPage + 1} of ${totalPages})`,
      options,
      initialValue
    });
    if (p6.isCancel(picked)) return "menu";
    const choice = String(picked);
    if (choice === PAGE_PREV) {
      page = currentPage - 1;
      continue;
    }
    if (choice === PAGE_NEXT) {
      page = currentPage + 1;
      continue;
    }
    if (choice === SWITCH_SEARCH) return "search";
    if (choice === SWITCH_BROWSE) return "browse";
    const selected = list.find((m) => m.id === choice);
    if (selected) return selected;
    continue;
  }
}
async function selectLargeCatalog(models, browseList, toOption, message, initialModelId) {
  let mode = "choose";
  while (true) {
    if (mode === "choose") {
      const method = await p6.select({
        message: `${message} (${models.length} available)`,
        options: [
          { value: MODE_SEARCH, label: "Search models", hint: "Filter by name, id, or brand" },
          {
            value: MODE_BROWSE,
            label: "Browse all models",
            hint: `${MODEL_PAGE_SIZE} per page \xB7 ${Math.ceil(browseList.length / MODEL_PAGE_SIZE)} pages`
          }
        ]
      });
      if (p6.isCancel(method)) {
        p6.cancel("Cancelled.");
        return null;
      }
      mode = method === MODE_BROWSE ? "browse" : "search";
      continue;
    }
    if (mode === "browse") {
      const picked = await pickModelFromPagedList(
        browseList,
        toOption,
        message,
        initialModelId,
        { search: true }
      );
      if (picked === "search") {
        mode = "search";
        continue;
      }
      if (picked === "menu") {
        mode = "choose";
        continue;
      }
      if (isSelectedModel(picked)) return picked;
      continue;
    }
    const searchInput = await p6.text({
      message: `Search models (${models.length} available):`,
      placeholder: "e.g. claude, sonnet, llama"
    });
    if (p6.isCancel(searchInput)) {
      mode = "choose";
      continue;
    }
    const matched = filterModelsBySearch(browseList, String(searchInput));
    if (matched.length === 0) {
      p6.log.warn("No models match \u2014 try a different search");
      continue;
    }
    const result = await pickModelFromPagedList(
      matched,
      toOption,
      matched.length === 1 ? "Match found" : `Select model (${matched.length} matches)`,
      initialModelId,
      { browse: true, newSearch: true }
    );
    if (result === "search") continue;
    if (result === "browse") {
      mode = "browse";
      continue;
    }
    if (result === "menu") {
      mode = "choose";
      continue;
    }
    if (isSelectedModel(result)) return result;
  }
}
async function selectModelWithSearch(models, toOption, message, initialModelId, browseList) {
  if (models.length === 0) return null;
  const orderedBrowse = browseList ?? sortModelsByBrand(models);
  if (models.length <= MODEL_SEARCH_THRESHOLD) {
    const options = models.map(toOption);
    const initialValue = initialModelId && options.some((o) => o.value === initialModelId) ? initialModelId : options[0]?.value;
    const picked = await p6.select({
      message,
      options,
      initialValue
    });
    if (p6.isCancel(picked)) {
      p6.cancel("Cancelled.");
      return null;
    }
    const selected = models.find((m) => m.id === String(picked));
    if (!selected) return null;
    return selected;
  }
  return selectLargeCatalog(models, orderedBrowse, toOption, message, initialModelId);
}
function noteEnvConflicts(conflicts) {
  if (conflicts.length === 0) return;
  const lines = conflicts.map((c) => `  ${pc5.dim(c.name)}=${pc5.dim(c.value)}`).join("\n");
  p6.note(lines, pc5.yellow("Env vars that will be temporarily overridden:"));
}
function modelToOption(model, hint) {
  return {
    value: model.id,
    label: model.name !== model.id ? model.name : model.id,
    hint: hint ?? (model.name !== model.id ? model.id : model.brand)
  };
}
async function browseAllModels(provider, prefs) {
  return selectModelWithSearch(
    provider.models,
    (m) => modelToOption(m),
    "Which model?",
    prefs.lastModel
  );
}
async function pickLocalModel(provider, conflicts, prefs) {
  const recentIds = (prefs.recentModelsByProvider?.[provider.id] ?? []).slice(0, MAX_RECENT);
  const recentModels = recentIds.map((id) => provider.models.find((m) => m.id === id)).filter((m) => m !== void 0);
  let selectedModel;
  if (recentModels.length > 0) {
    const options = [
      ...recentModels.map((m) => modelToOption(m, "recent")),
      { value: BROWSE_ALL, label: "Browse all models \u2192", hint: `${provider.models.length} available` }
    ];
    const picked = await p6.select({
      message: "Which model?",
      options,
      initialValue: recentModels[0].id
    });
    if (p6.isCancel(picked)) {
      p6.cancel("Cancelled.");
      return null;
    }
    if (String(picked) === BROWSE_ALL) {
      const browsed = await browseAllModels(provider, prefs);
      if (!browsed) return null;
      selectedModel = browsed;
    } else {
      selectedModel = recentModels.find((m) => m.id === String(picked));
    }
  } else {
    const browsed = await browseAllModels(provider, prefs);
    if (!browsed) return null;
    selectedModel = browsed;
  }
  noteEnvConflicts(conflicts);
  const confirmed = await p6.confirm({
    message: `Launch Claude Code \xB7 ${pc5.bold(selectedModel.id)} via ${pc5.bold(provider.name)}?`,
    initialValue: true
  });
  if (p6.isCancel(confirmed) || !confirmed) {
    p6.cancel("Cancelled.");
    return null;
  }
  p6.outro(pc5.green("Launching..."));
  return selectedModel;
}

// src/favorites.ts
function isFavorite(list, fav) {
  return list.some((f) => f.providerId === fav.providerId && f.modelId === fav.modelId);
}
function addFavorite(list, fav, max = MAX_MODEL_CATALOG) {
  if (isFavorite(list, fav)) return { ok: false, reason: "duplicate" };
  if (list.length >= max) return { ok: false, reason: "cap" };
  return { ok: true, list: [...list, fav] };
}
function removeFavorite(list, fav) {
  return list.filter((f) => !(f.providerId === fav.providerId && f.modelId === fav.modelId));
}

// src/providers-command.ts
import pc6 from "picocolors";
import * as p7 from "@clack/prompts";

// src/registry/pricing.ts
import {
  chmodSync as chmodSync3,
  existsSync as existsSync8,
  mkdirSync as mkdirSync4,
  readFileSync as readFileSync7,
  writeFileSync as writeFileSync3
} from "fs";
import { dirname as dirname3, join as join8 } from "path";

// src/data/pricing-cache.json
var pricing_cache_default = {
  schema_version: "1.2.0",
  generated_at: "2026-06-09T00:00:00.000Z",
  models: [
    {
      provider: "groq",
      model_id: "llama-3.3-70b-versatile",
      aliases: { groq: "llama-3.3-70b-versatile" },
      pricing: [
        {
          platform: "groq",
          tier: "standard",
          modality: "text",
          input_per_1m_tokens: 0.59,
          output_per_1m_tokens: 0.79
        }
      ]
    },
    {
      provider: "anthropic",
      model_id: "claude-sonnet-4-20250514",
      aliases: { anthropic: "claude-sonnet-4-20250514" },
      pricing: [
        {
          platform: "anthropic",
          tier: "standard",
          modality: "text",
          input_per_1m_tokens: 3,
          output_per_1m_tokens: 15
        }
      ]
    },
    {
      provider: "moonshot",
      model_id: "moonshotai/kimi-k2.6",
      aliases: {
        openrouter: "moonshotai/kimi-k2.6",
        nvidia: "moonshotai/kimi-k2.6"
      },
      pricing: [
        {
          platform: "openrouter",
          tier: "standard",
          modality: "text",
          input_per_1m_tokens: 0.6,
          output_per_1m_tokens: 2.4
        }
      ]
    }
  ]
};

// src/registry/pricing.ts
var PRICING_API_URL = "https://ai-model-pricing.com/api/v1/pricing.json";
var FETCH_TIMEOUT_MS = 15e3;
var FILE_MODE3 = 384;
var TEMPLATE_TO_PRICING_PLATFORM = {
  groq: "groq",
  mistral: "mistral",
  togetherai: "together",
  cerebras: "cerebras",
  deepinfra: "deepinfra",
  xai: "xai",
  perplexity: "perplexity",
  cohere: "cohere",
  openai: "openai",
  google: "google_ai_studio",
  alibaba: "alibaba",
  openrouter: "openrouter",
  anthropic: "anthropic",
  nvidia: "nvidia",
  venice: "openrouter"
};
function loadBundledPricingCache() {
  return pricing_cache_default;
}
function readPricingFile(path) {
  if (!existsSync8(path)) return null;
  try {
    return JSON.parse(readFileSync7(path, "utf8"));
  } catch {
    return null;
  }
}
function writePricingCache(path, data) {
  mkdirSafe(dirname3(path));
  writeFileSync3(path, `${JSON.stringify(data, null, 2)}
`, { mode: FILE_MODE3 });
  try {
    chmodSync3(path, FILE_MODE3);
  } catch {
  }
}
function mkdirSafe(dir) {
  try {
    mkdirSync4(dir, { recursive: true, mode: 448 });
  } catch {
  }
}
function getUserPricingCachePath() {
  return join8(getAppHome(), "pricing-cache.json");
}
function loadPricingCache() {
  return readPricingFile(getUserPricingCachePath()) ?? loadBundledPricingCache();
}
async function fetchPricingCache() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(PRICING_API_URL, {
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!Array.isArray(data.models)) return null;
    writePricingCache(getUserPricingCachePath(), data);
    return data;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
function pickPricingRow(rows, platform) {
  const textRows = rows.filter((r) => !r.modality || r.modality === "text");
  const pool = textRows.length > 0 ? textRows : rows;
  if (platform) {
    const platformStandard = pool.find((r) => r.platform === platform && r.tier === "standard");
    if (platformStandard) return platformStandard;
    const platformAny = pool.find((r) => r.platform === platform);
    if (platformAny) return platformAny;
  }
  const standard = pool.find((r) => r.tier === "standard");
  if (standard) return standard;
  return pool[0] ?? null;
}
function rowToCost(row) {
  if (row.input_per_1m_tokens === void 0 && row.output_per_1m_tokens === void 0) return void 0;
  return {
    input: row.input_per_1m_tokens ?? 0,
    output: row.output_per_1m_tokens ?? 0
  };
}
function normalizeModelIdCandidates(id) {
  const trimmed = id.trim();
  const lower = trimmed.toLowerCase();
  const candidates = /* @__PURE__ */ new Set([trimmed, lower]);
  for (const prefix of ["openrouter/", "moonshotai/", "anthropic/", "openai/"]) {
    if (lower.startsWith(prefix)) {
      candidates.add(lower.slice(prefix.length));
      candidates.add(trimmed.slice(prefix.length));
    }
  }
  const slash = lower.indexOf("/");
  if (slash > 0) {
    candidates.add(lower.slice(slash + 1));
  }
  return [...candidates];
}
function buildPricingIndex(cache) {
  const byId = /* @__PURE__ */ new Map();
  for (const entry of cache.models ?? []) {
    if (!entry.model_id) continue;
    for (const candidate of normalizeModelIdCandidates(entry.model_id)) {
      byId.set(candidate, entry);
    }
    if (entry.aliases) {
      for (const alias of Object.values(entry.aliases)) {
        for (const candidate of normalizeModelIdCandidates(alias)) {
          byId.set(candidate, entry);
        }
      }
    }
  }
  return { byId };
}
function lookupModelCost(index, modelId, platform) {
  for (const candidate of normalizeModelIdCandidates(modelId)) {
    const entry = index.byId.get(candidate);
    if (!entry?.pricing?.length) continue;
    const row = pickPricingRow(entry.pricing, platform);
    const cost = row ? rowToCost(row) : void 0;
    if (cost) return cost;
  }
  return void 0;
}
function enrichModelsWithPricing(models, index, platform) {
  return models.map((model) => {
    const cost = lookupModelCost(index, model.id, platform) ?? lookupModelCost(index, model.upstreamModelId, platform);
    if (!cost) return model;
    return { ...model, cost };
  });
}
function applyPricingToRegistryProviders(registry, cache) {
  const index = buildPricingIndex(cache);
  let changed = false;
  for (const provider of registry.providers) {
    if (!provider.modelsCache?.models.length) continue;
    const platform = TEMPLATE_TO_PRICING_PLATFORM[provider.templateId] ?? TEMPLATE_TO_PRICING_PLATFORM[provider.id];
    const enriched = enrichModelsWithPricing(provider.modelsCache.models, index, platform);
    if (JSON.stringify(enriched) !== JSON.stringify(provider.modelsCache.models)) {
      provider.modelsCache = { ...provider.modelsCache, models: enriched };
      changed = true;
    }
  }
  if (changed) {
    registry.pricingCacheAt = cache.generated_at ?? (/* @__PURE__ */ new Date()).toISOString();
  }
  return changed;
}
function enrichPricingAsync(onComplete) {
  void (async () => {
    const fetched = await fetchPricingCache();
    const cache = fetched ?? loadPricingCache();
    const registry = loadRegistry();
    const changed = applyPricingToRegistryProviders(registry, cache);
    if (changed) saveRegistry(registry);
    onComplete?.(changed);
  })();
}
function pricingPlatformForProvider(templateId, providerId) {
  return TEMPLATE_TO_PRICING_PLATFORM[templateId] ?? TEMPLATE_TO_PRICING_PLATFORM[providerId];
}

// src/registry/add-template.ts
async function probeTemplatePackage(template) {
  if (!template.supported) return template.unsupportedReason ?? "Provider is not supported yet.";
  if (!template.npm) return "Template is missing an SDK package.";
  if (!isSdkMigratedNpm(template.npm) && template.npm !== "@ai-sdk/anthropic") {
    return `SDK package ${template.npm} is not available in relay-ai.`;
  }
  try {
    await import(template.npm);
    return null;
  } catch {
    return `Could not load ${template.npm}. Run npm install in your relay-ai checkout.`;
  }
}
async function addProviderFromTemplate(template, apiKey, opts) {
  const packageError = await probeTemplatePackage(template);
  if (packageError) {
    return { added: false, error: packageError };
  }
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    return { added: false, error: "API key cannot be empty." };
  }
  const registry = loadRegistry();
  const existing = registry.providers.find((p9) => p9.id === template.id);
  if (existing && !opts?.replaceExisting) {
    return {
      added: false,
      error: `${template.name} is already configured.`,
      hint: `Remove it first with: relay-ai providers remove ${template.id}`
    };
  }
  const fetched = await fetchTemplateModels(template, trimmedKey, opts?.baseUrl);
  if (fetched.error || fetched.models.length === 0) {
    return {
      added: false,
      error: fetched.error ?? "No models returned.",
      hint: fetched.hint
    };
  }
  const saved = await saveProviderCredential(`keyring:provider:${template.id}`, trimmedKey);
  if (!saved) {
    return {
      added: false,
      error: "Could not save API key to Keychain.",
      hint: "Grant Keychain access or try again."
    };
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const pricingCache = loadPricingCache();
  const platform = pricingPlatformForProvider(template.id, template.id);
  const pricedModels = enrichModelsWithPricing(
    fetched.models.map((m) => ({ ...m, apiUrl: fetched.baseUrl })),
    buildPricingIndex(pricingCache),
    platform
  );
  const entry = {
    id: template.id,
    templateId: template.id,
    name: template.name,
    enabled: true,
    authRef: `keyring:provider:${template.id}`,
    api: {
      npm: template.npm,
      url: fetched.baseUrl
    },
    addedAt: existing?.addedAt ?? now,
    refreshedAt: now,
    modelsCache: {
      fetchedAt: now,
      models: pricedModels
    }
  };
  if (existing) {
    const idx = registry.providers.findIndex((p9) => p9.id === template.id);
    registry.providers[idx] = entry;
  } else {
    registry.providers.push(entry);
  }
  saveRegistry(registry);
  enrichPricingAsync();
  return { added: true, provider: entry, modelCount: fetched.models.length };
}

// src/registry/crud.ts
function credentialStillReferenced(authRef, remaining) {
  return remaining.some((p9) => p9.authRef === authRef);
}
async function removeProviderFromRegistry(id, opts) {
  const registry = loadRegistry();
  const index = registry.providers.findIndex((p9) => p9.id === id);
  if (index < 0) {
    return { removed: false, id, credentialDeleted: false, error: `Provider not found: ${id}` };
  }
  const [removedProvider] = registry.providers.splice(index, 1);
  saveRegistry(registry);
  let credentialDeleted = false;
  if (opts?.deleteCredential !== false) {
    const parsed = parseAuthRef(removedProvider.authRef);
    const isGlobal = parsed?.kind === "keyring" && parsed.account === GLOBAL_OPENCODE_KEYRING_ACCOUNT;
    const shouldDelete = !isGlobal || !credentialStillReferenced(removedProvider.authRef, registry.providers);
    if (shouldDelete && parsed?.kind === "keyring") {
      credentialDeleted = await deleteProviderCredential(removedProvider.authRef);
    }
  }
  return {
    removed: true,
    id,
    name: removedProvider.name,
    credentialDeleted
  };
}
function addZenRegistryStub() {
  const registry = loadRegistry();
  if (registry.providers.some((p9) => p9.id === "zen")) {
    return { added: false, reason: "OpenCode Zen is already configured." };
  }
  registry.providers.push(zenRegistryStub());
  saveRegistry(registry);
  return { added: true };
}
function addGoRegistryStub() {
  const registry = loadRegistry();
  if (registry.providers.some((p9) => p9.id === "go")) {
    return { added: false, reason: "OpenCode Go is already configured." };
  }
  registry.providers.push(goRegistryStub());
  saveRegistry(registry);
  return { added: true };
}
function toggleProviderEnabled(id) {
  const registry = loadRegistry();
  const provider = registry.providers.find((p9) => p9.id === id);
  if (!provider) return { toggled: false, error: `Provider not found: ${id}` };
  provider.enabled = !provider.enabled;
  saveRegistry(registry);
  return { toggled: true, enabled: provider.enabled };
}

// src/registry/refresh-models.ts
function modelInfoToCached(m, npm, apiUrl) {
  return {
    id: m.id,
    name: m.name,
    upstreamModelId: m.id,
    family: m.brand,
    brand: m.brand,
    contextWindow: m.contextWindow,
    cost: m.cost,
    modelFormat: m.modelFormat === "anthropic" ? "anthropic" : "openai",
    sourceBackend: m.sourceBackend,
    npm,
    apiUrl
  };
}
async function refreshZenGoProvider(provider) {
  const backendId = provider.id === "go" || provider.templateId === "go" ? "go" : "zen";
  const result = await getModels(BACKENDS[backendId]);
  return result.models.filter((m) => m.modelFormat !== "unsupported").map((m) => modelInfoToCached(m, "@ai-sdk/openai-compatible", `${BACKENDS[backendId].baseUrl}/v1`));
}
async function refreshApiListProvider(provider, apiKey) {
  const npm = provider.api.npm ?? "@ai-sdk/openai-compatible";
  const catalogTemplate = resolveProviderTemplate(provider);
  const baseUrl = effectiveProviderBaseUrl(provider, catalogTemplate);
  const template = catalogTemplate ?? syntheticTemplate(provider, baseUrl);
  if (!baseUrl) {
    return { models: [], error: "Provider has no API base URL configured." };
  }
  if (npm === "@ai-sdk/anthropic") {
    const fetched2 = await fetchAnthropicModels(baseUrl, apiKey);
    if (fetched2.error || fetched2.models.length === 0) {
      return { models: [], error: fetched2.error ?? "No models returned.", baseUrl: fetched2.baseUrl };
    }
    return {
      models: fetched2.models.map((m) => ({ ...m, apiUrl: fetched2.baseUrl })),
      baseUrl: fetched2.baseUrl
    };
  }
  const fetched = await fetchTemplateModels(template, apiKey, baseUrl);
  if (fetched.error || fetched.models.length === 0) {
    return { models: [], error: fetched.error ?? "No models returned." };
  }
  return {
    models: fetched.models.map((m) => ({
      ...m,
      apiUrl: fetched.baseUrl
    })),
    baseUrl: fetched.baseUrl
  };
}
function updateProviderCache(registry, providerId, models, baseUrl) {
  const idx = registry.providers.findIndex((p9) => p9.id === providerId);
  if (idx < 0) return;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const existing = registry.providers[idx];
  registry.providers[idx] = {
    ...existing,
    refreshedAt: now,
    api: baseUrl ? { ...existing.api, url: baseUrl } : existing.api,
    modelsCache: {
      fetchedAt: now,
      models
    }
  };
}
async function refreshProviderModels(providerId, apiKey, registry = loadRegistry()) {
  const provider = registry.providers.find((p9) => p9.id === providerId);
  if (!provider) {
    return { id: providerId, name: providerId, ok: false, reason: "Provider not found." };
  }
  const source = resolveModelSource(provider);
  if (source === "manual-only") {
    const hint = provider.templateId === "google-vertex" || provider.id === "google-vertex" || provider.api.npm === "@ai-sdk/google-vertex" ? "Vertex uses gcloud credentials \u2014 re-import from OpenCode or use relay-ai server --vertex." : "Manual-only provider \u2014 model list is not refreshed automatically.";
    return {
      id: provider.id,
      name: provider.name,
      ok: true,
      skipped: true,
      reason: hint
    };
  }
  try {
    let models = [];
    let baseUrl;
    if (source === "zen-go-api") {
      models = await refreshZenGoProvider(provider);
    } else {
      if (isLikelyPlaceholderKey(apiKey)) {
        if (cachedModelCount(provider) > 0) {
          return skipWithCachedModels(
            provider,
            "OpenCode imported a placeholder API key \u2014 kept cached model list. Add this provider again via relay-ai providers add with a real key to refresh live."
          );
        }
        return {
          id: provider.id,
          name: provider.name,
          ok: false,
          reason: "No usable API key \u2014 add the provider via relay-ai providers add with a real key."
        };
      }
      if (!apiKey) {
        return {
          id: provider.id,
          name: provider.name,
          ok: false,
          reason: "API key not available \u2014 cannot refresh models."
        };
      }
      const fetched = await refreshApiListProvider(provider, apiKey);
      if (fetched.error) {
        if ((fetched.error.includes("rejected") || fetched.error.includes("401") || fetched.error.includes("403")) && cachedModelCount(provider) > 0) {
          return skipWithCachedModels(
            provider,
            `${fetched.error} Kept ${cachedModelCount(provider)} cached model${cachedModelCount(provider) === 1 ? "" : "s"} from import. Update your API key via relay-ai providers add if you need a live refresh.`
          );
        }
        return { id: provider.id, name: provider.name, ok: false, reason: fetched.error };
      }
      models = fetched.models;
      baseUrl = fetched.baseUrl;
    }
    const pricingCache = loadPricingCache();
    const platform = pricingPlatformForProvider(provider.templateId, provider.id);
    const enriched = enrichModelsWithPricing(models, buildPricingIndex(pricingCache), platform);
    updateProviderCache(registry, providerId, enriched, baseUrl);
    saveRegistry(registry);
    enrichPricingAsync();
    return {
      id: provider.id,
      name: provider.name,
      ok: true,
      modelCount: enriched.length
    };
  } catch (err) {
    return {
      id: provider.id,
      name: provider.name,
      ok: false,
      reason: err instanceof Error ? err.message : String(err)
    };
  }
}
async function refreshAllProviderModels(resolveKey) {
  const refreshed = [];
  const ids = loadRegistry().providers.filter((p9) => p9.enabled).map((p9) => p9.id);
  for (const id of ids) {
    const registry = loadRegistry();
    const provider = registry.providers.find((p9) => p9.id === id);
    if (!provider) continue;
    const key = await resolveRefreshCredential(provider, resolveKey);
    refreshed.push(await refreshProviderModels(id, key, registry));
  }
  return { refreshed };
}

// src/providers-command.ts
function parseProvidersArgs(args) {
  if (args.length === 0) return { subcommand: "hub", showHelp: false };
  const [first, ...rest] = args;
  if (first === "--help" || first === "-h") return { subcommand: "help", showHelp: true };
  if (first === "add") {
    if (rest.length > 0) return { subcommand: "add", showHelp: false, error: `Unknown add option: ${rest[0]}` };
    return { subcommand: "add", showHelp: false };
  }
  if (first === "import") {
    if (rest.length > 0) return { subcommand: "import", showHelp: false, error: `Unknown import option: ${rest[0]}` };
    return { subcommand: "import", showHelp: false };
  }
  if (first === "list") {
    if (rest.length > 0) return { subcommand: "list", showHelp: false, error: `Unknown list option: ${rest[0]}` };
    return { subcommand: "list", showHelp: false };
  }
  if (first === "remove") {
    if (rest.length === 0) return { subcommand: "remove", showHelp: false, error: "Usage: relay-ai providers remove <id>" };
    if (rest.length > 1) return { subcommand: "remove", showHelp: false, error: `Unknown remove option: ${rest[1]}` };
    return { subcommand: "remove", showHelp: false, removeId: rest[0] };
  }
  if (first === "refresh-models") {
    if (rest.length === 0) return { subcommand: "refresh-models", showHelp: false };
    if (rest.length > 1) return { subcommand: "refresh-models", showHelp: false, error: `Unknown refresh-models option: ${rest[1]}` };
    return { subcommand: "refresh-models", showHelp: false, removeId: rest[0] };
  }
  return { subcommand: "hub", showHelp: false, error: `Unknown providers subcommand: ${first}` };
}
function providersHelpText() {
  return `${pc6.bold("relay-ai providers")} \u2014 manage your AI providers

${pc6.bold("Usage:")}
  relay-ai providers
  relay-ai providers add
  relay-ai providers import
  relay-ai providers list
  relay-ai providers remove <id>
  relay-ai providers refresh-models [id]

${pc6.bold("Subcommands:")}
  (none)      Provider hub wizard ${pc6.dim("[Phase 1.1]")}
  add         Add a provider (Groq, Mistral, Together AI, \u2026) ${pc6.dim("[Phase 1.1]")}
  import      Bring settings from OpenCode (one-time) ${pc6.dim("[Phase 1.0]")}
  list        Show configured providers ${pc6.dim("[Phase 1.0]")}
  remove      Remove a provider by id ${pc6.dim("[Phase 1.1]")}
  refresh-models  Update cached model lists ${pc6.dim("[Phase 1.2]")}

${pc6.dim("Coming soon: auth (OAuth)")}`;
}
function maskAuthRef(authRef) {
  if (authRef.startsWith("keyring:global:opencode")) return "keychain (shared Zen/Go key)";
  if (authRef.startsWith("keyring:")) return "keychain";
  if (authRef.startsWith("env:")) return authRef;
  return authRef;
}
function providerLabel(name, modelCount, enabled) {
  const star = enabled ? "\u2605" : "\u25CB";
  return `${star} ${name} (${modelCount} model${modelCount === 1 ? "" : "s"})`;
}
async function runProvidersImport() {
  const registry = loadRegistry();
  const hasExisting = registry.providers.length > 0;
  const resolveConflict = hasExisting ? async (ctx) => {
    p7.note(
      `Existing: ${ctx.existingKeyHint}
Imported: ${ctx.incomingKeyHint}`,
      `Provider "${ctx.existing.name}" already configured`
    );
    const choice = await p7.select({
      message: "Which configuration should we keep?",
      options: [
        { value: "keep", label: "Keep mine", hint: "Leave your current relay-ai config unchanged" },
        { value: "import", label: "Use imported", hint: "Replace with OpenCode settings and refresh models" },
        { value: "skip", label: "Skip this provider", hint: "" }
      ]
    });
    if (p7.isCancel(choice)) return "skip";
    return choice;
  } : void 0;
  const spinner5 = p7.spinner();
  spinner5.start("Importing from OpenCode...");
  const result = await importFromOpencode({ resolveConflict });
  spinner5.stop("");
  if (result.error) {
    p7.log.error(result.error);
    return 1;
  }
  if (result.imported.length === 0 && result.skipped.length === 0) {
    p7.log.warn("No configured providers found in OpenCode.");
    p7.log.info("Add providers in OpenCode first, or use relay-ai providers add.");
    return 0;
  }
  p7.log.success(
    `Imported ${result.imported.length} provider${result.imported.length === 1 ? "" : "s"}, ${result.imported.reduce((n, pr) => n + (pr.modelsCache?.models.length ?? 0), 0)} models, ${result.keysSaved} key${result.keysSaved === 1 ? "" : "s"} saved to Keychain.`
  );
  if (result.keysSkipped.length > 0) {
    for (const k of result.keysSkipped) {
      const label = k.reason === "placeholder-key" ? "placeholder key not saved" : k.reason === "untested-manual" ? "key not saved (non-API auth)" : "API key not saved (failed verification)";
      p7.log.warn(`${k.name} (${k.id}): ${label}${k.detail ? ` \u2014 ${k.detail}` : ""}`);
    }
  }
  if (result.skipped.length > 0) {
    for (const s of result.skipped) {
      const reason = s.reason === "user-skipped" ? "skipped by you" : s.reason === "conflict-kept" ? "kept your existing config" : s.reason;
      p7.log.warn(`Skipped ${s.name} (${s.id}): ${reason}`);
    }
  }
  return 0;
}
async function runProvidersRefreshModels(providerId) {
  const resolveKey = async (provider) => resolveProviderCredential(provider.id, provider.authRef);
  if (providerId) {
    const registry = loadRegistry();
    const provider = registry.providers.find((p9) => p9.id === providerId);
    if (!provider) {
      p7.log.error(`Provider not found: ${providerId}`);
      return 1;
    }
    const spinner6 = p7.spinner();
    spinner6.start(`Refreshing ${provider.name}...`);
    const key = await resolveRefreshCredential(
      provider,
      async (p9) => resolveProviderCredential(p9.id, p9.authRef)
    );
    const result = await refreshProviderModels(providerId, key);
    spinner6.stop("");
    if (result.skipped) {
      const countNote = result.modelCount ? ` (${result.modelCount} cached models kept)` : "";
      p7.log.warn(`${result.name}: ${result.reason}${countNote}`);
      return 0;
    }
    if (!result.ok) {
      p7.log.error(`${result.name}: ${result.reason ?? "Refresh failed."}`);
      return 1;
    }
    p7.log.success(`${result.name}: ${result.modelCount} model${result.modelCount === 1 ? "" : "s"} updated.`);
    return 0;
  }
  const spinner5 = p7.spinner();
  spinner5.start("Refreshing model lists...");
  const { refreshed } = await refreshAllProviderModels(resolveKey);
  spinner5.stop("");
  const ok = refreshed.filter((r) => r.ok && !r.skipped);
  const skipped = refreshed.filter((r) => r.skipped);
  const failed = refreshed.filter((r) => !r.ok);
  if (ok.length > 0) {
    p7.log.success(`Updated ${ok.length} provider${ok.length === 1 ? "" : "s"}.`);
    for (const r of ok) {
      p7.log.info(`  ${r.name}: ${r.modelCount} model${r.modelCount === 1 ? "" : "s"}`);
    }
  }
  for (const r of skipped) {
    const countNote = r.modelCount ? ` (${r.modelCount} cached models kept)` : "";
    p7.log.warn(`Skipped ${r.name}: ${r.reason}${countNote}`);
  }
  for (const r of failed) {
    p7.log.error(`${r.name}: ${r.reason ?? "Refresh failed."}`);
  }
  return failed.length > 0 ? 1 : 0;
}
async function runProvidersList() {
  const entries = await resolveProvidersForDisplay();
  if (entries.length === 0) {
    p7.log.info("No providers configured. Run relay-ai providers add or import.");
    return 0;
  }
  console.log("");
  for (const entry of entries) {
    const status = entry.enabled ? pc6.green("\u25CF") : pc6.dim("\u25CB");
    const cloudNote = entry.cloudBuiltin ? pc6.dim(" \xB7 cloud builtin") : "";
    console.log(
      `  ${status} ${pc6.bold(entry.name)} ${pc6.dim(`(${entry.id})`)} \u2014 ${entry.modelCount} model${entry.modelCount === 1 ? "" : "s"}, auth: ${entry.authLabel}${cloudNote}`
    );
  }
  console.log("");
  return 0;
}
async function addBuiltinZen() {
  const key = await readGlobalOpencodeCredential();
  if (!key) {
    const collected = await resolveOrCollectApiKey();
    if (!collected) return 0;
    await migrateGlobalOpencodeCredential();
  }
  const result = addZenRegistryStub();
  if (!result.added) {
    p7.log.warn(result.reason ?? "Could not add OpenCode Zen.");
    return 0;
  }
  setSubscriptionTier("free");
  p7.log.success("OpenCode Zen added to your providers.");
  return 0;
}
async function pickTemplateFromCatalog() {
  while (true) {
    const templates = listAddableTemplates(loadRegistry().providers.map((p9) => p9.id));
    if (templates.length === 0) return null;
    const method = await p7.select({
      message: `Choose a provider (${templates.length} available)`,
      options: [
        { value: "search", label: "Search providers", hint: "e.g. gro, mistral, together" },
        { value: "browse", label: "Browse all providers", hint: "Scroll the full list" },
        { value: "back", label: "Back", hint: "" }
      ]
    });
    if (p7.isCancel(method) || method === "back") return null;
    if (method === "browse") {
      const options2 = templates.map((t) => ({
        value: t.id,
        label: t.name,
        hint: t.npm
      }));
      const picked2 = await p7.select({ message: "Select a provider", options: options2 });
      if (p7.isCancel(picked2)) continue;
      const template2 = templates.find((t) => t.id === picked2);
      if (template2) return template2;
      continue;
    }
    const searchInput = await p7.text({
      message: "Search providers:",
      placeholder: "e.g. groq, mistral, openrouter"
    });
    if (p7.isCancel(searchInput)) continue;
    const matched = filterTemplates(templates, String(searchInput));
    if (matched.length === 0) {
      p7.log.warn("No providers match \u2014 try a different search");
      continue;
    }
    const options = matched.map((t) => ({
      value: t.id,
      label: t.name,
      hint: t.npm
    }));
    const picked = await p7.select({
      message: matched.length === 1 ? "Match found" : `Select provider (${matched.length} matches)`,
      options
    });
    if (p7.isCancel(picked)) continue;
    const template = matched.find((t) => t.id === picked);
    if (template) return template;
  }
}
async function runTemplateAddFlow() {
  if (listAddableTemplates(loadRegistry().providers.map((p9) => p9.id)).length === 0) {
    p7.log.info("All catalog providers are already configured.");
    return 0;
  }
  const template = await pickTemplateFromCatalog();
  if (!template) return 0;
  if (template.signupUrl) {
    p7.note(`Get an API key at:
${template.signupUrl}`, template.name);
  }
  const apiKey = await p7.password({
    message: `Paste your ${template.name} API key:`,
    validate: (val) => val.trim() ? void 0 : "Key cannot be empty"
  });
  if (p7.isCancel(apiKey)) {
    p7.cancel("Cancelled.");
    return 0;
  }
  const spinner5 = p7.spinner();
  spinner5.start(`Testing connection to ${template.name}...`);
  const result = await addProviderFromTemplate(template, String(apiKey));
  spinner5.stop("");
  if (!result.added) {
    p7.log.error(result.error ?? "Could not add provider.");
    if (result.hint) p7.log.info(result.hint);
    return 1;
  }
  p7.log.success(`Connected \xB7 ${result.modelCount} model${result.modelCount === 1 ? "" : "s"} \u2014 ${template.name} saved.`);
  return 0;
}
async function addBuiltinGo() {
  const key = await readGlobalOpencodeCredential();
  if (!key) {
    const collected = await resolveOrCollectApiKey();
    if (!collected) return 0;
    await migrateGlobalOpencodeCredential();
  }
  const result = addGoRegistryStub();
  if (!result.added) {
    p7.log.warn(result.reason ?? "Could not add OpenCode Go.");
    return 0;
  }
  setSubscriptionTier("go");
  p7.log.success("OpenCode Go added to your providers.");
  return 0;
}
async function runCustomEndpointAddFlow() {
  const kindChoice = await p7.select({
    message: "Custom server type",
    options: [
      {
        value: "openai",
        label: "Works with most AI services",
        hint: "OpenAI-compatible API (Together, vLLM, Ollama, \u2026)"
      },
      {
        value: "anthropic",
        label: "Claude-style API servers",
        hint: "Anthropic-compatible /v1/messages passthrough"
      },
      { value: "back", label: "Back", hint: "" }
    ]
  });
  if (p7.isCancel(kindChoice) || kindChoice === "back") return 0;
  const displayName = await p7.text({
    message: "Display name:",
    placeholder: "My Work LLM",
    validate: (v) => v.trim() ? void 0 : "Name is required"
  });
  if (p7.isCancel(displayName)) return 0;
  const baseUrl = await p7.text({
    message: "Base URL:",
    placeholder: kindChoice === "openai" ? "https://api.together.xyz/v1" : "https://api.anthropic.com",
    validate: (v) => v.trim() ? void 0 : "URL is required"
  });
  if (p7.isCancel(baseUrl)) return 0;
  const allowLocal = await p7.confirm({
    message: "Allow local HTTP (Ollama / LM Studio on localhost)?",
    initialValue: String(baseUrl).includes("127.0.0.1") || String(baseUrl).includes("localhost")
  });
  if (p7.isCancel(allowLocal)) return 0;
  const apiKey = await p7.password({
    message: "API key (leave empty for local servers without auth):"
  });
  if (p7.isCancel(apiKey)) return 0;
  const spinner5 = p7.spinner();
  spinner5.start("Testing connection...");
  const result = await addCustomEndpointProvider({
    displayName: String(displayName).trim(),
    baseUrl: String(baseUrl).trim(),
    apiKey: String(apiKey ?? "").trim(),
    kind: kindChoice,
    allowInsecureLocal: allowLocal === true
  });
  spinner5.stop("");
  if (!result.added) {
    p7.log.error(result.error ?? "Could not add custom provider.");
    if (result.hint) p7.log.info(result.hint);
    return 1;
  }
  p7.log.success(`Connected \xB7 ${result.modelCount} model${result.modelCount === 1 ? "" : "s"} \u2014 ${result.provider?.name} saved.`);
  return 0;
}
async function runProvidersAdd() {
  const registry = loadRegistry();
  const zenGo = await resolveZenGoAvailability();
  const hasZen = zenGo.zen;
  const hasGo = zenGo.go;
  const hasOpencode = findOpencodeBinary() !== null;
  const options = [
    { value: "import", label: "Bring settings from OpenCode", hint: hasOpencode ? "One-time import" : "Requires OpenCode CLI" }
  ];
  if (!hasZen) {
    options.push({ value: "zen", label: "Add OpenCode Zen (free)", hint: "Uses your OpenCode API key" });
  }
  if (!hasGo) {
    options.push({ value: "go", label: "Add OpenCode Go (paid)", hint: "Uses your OpenCode API key" });
  }
  const addableTemplates = listAddableTemplates(registry.providers.map((p9) => p9.id));
  if (addableTemplates.length > 0) {
    options.push({
      value: "templates",
      label: "Add Groq, Mistral, Together AI, \u2026",
      hint: `${addableTemplates.length} provider${addableTemplates.length === 1 ? "" : "s"} available`
    });
  }
  options.push({
    value: "custom",
    label: "Custom server (Advanced)",
    hint: "OpenAI-compatible or Claude-style API URL"
  });
  const choice = await p7.select({ message: "Add a provider", options });
  if (p7.isCancel(choice)) {
    p7.cancel("Cancelled.");
    return 0;
  }
  if (choice === "import") {
    if (!hasOpencode) {
      p7.log.error("OpenCode CLI not found. Install from https://opencode.ai");
      return 1;
    }
    return runProvidersImport();
  }
  if (choice === "zen") return addBuiltinZen();
  if (choice === "go") return addBuiltinGo();
  if (choice === "templates") return runTemplateAddFlow();
  if (choice === "custom") return runCustomEndpointAddFlow();
  return 0;
}
async function runProvidersRemove(id, interactive = false) {
  const registry = loadRegistry();
  const provider = registry.providers.find((pr) => pr.id === id);
  if (!provider) {
    p7.log.error(`Provider not found: ${id}`);
    return 1;
  }
  if (interactive) {
    const confirm4 = await p7.confirm({
      message: `Remove ${provider.name} (${id})?`,
      initialValue: false
    });
    if (p7.isCancel(confirm4) || !confirm4) {
      p7.cancel("Cancelled.");
      return 0;
    }
  }
  const result = await removeProviderFromRegistry(id);
  if (!result.removed) {
    p7.log.error(result.error ?? `Could not remove ${id}`);
    return 1;
  }
  p7.log.success(`Removed ${result.name ?? id}.`);
  if (result.credentialDeleted) {
    p7.log.info("Provider API key removed from Keychain.");
  }
  return 0;
}
async function runCloudBuiltinDetail(id) {
  const name = id === "zen" ? "OpenCode Zen" : "OpenCode Go";
  p7.note(
    `${name} is already active via your saved OpenCode API key.
It does not need to be added separately \u2014 relay-ai fetches its models live from OpenCode.`,
    "Cloud provider"
  );
  return "back";
}
async function runProviderDetail(id) {
  const registry = loadRegistry();
  const provider = registry.providers.find((pr) => pr.id === id);
  if (!provider) return "back";
  const modelCount = provider.modelsCache?.models.length ?? 0;
  p7.note(
    `${modelCount} cached model${modelCount === 1 ? "" : "s"} \xB7 auth: ${maskAuthRef(provider.authRef)}`,
    provider.name
  );
  const action = await p7.select({
    message: "What would you like to do?",
    options: [
      {
        value: "refresh",
        label: "Refresh model list",
        hint: "Fetch latest models from the provider API"
      },
      {
        value: "toggle",
        label: provider.enabled ? "Disable provider" : "Enable provider",
        hint: provider.enabled ? "Hide from relay-ai claude picker" : "Show in relay-ai claude picker"
      },
      { value: "remove", label: "Remove provider", hint: "Delete from registry and Keychain when safe" },
      { value: "back", label: "Back", hint: "" }
    ]
  });
  if (p7.isCancel(action) || action === "back") return "back";
  if (action === "refresh") {
    await runProvidersRefreshModels(id);
    return "back";
  }
  if (action === "toggle") {
    const result = toggleProviderEnabled(id);
    if (result.toggled) {
      p7.log.success(`${provider.name} ${result.enabled ? "enabled" : "disabled"}.`);
    }
    return "back";
  }
  const code = await runProvidersRemove(id, true);
  return code === 0 ? "removed" : "back";
}
async function runProvidersHub() {
  const hasOpencode = findOpencodeBinary() !== null;
  while (true) {
    const entries = await resolveProvidersForDisplay();
    const options = [];
    for (const entry of entries) {
      const hint = entry.cloudBuiltin ? "Active via OpenCode API key" : entry.id;
      const value = entry.cloudBuiltin ? `cloud:${entry.id}` : `provider:${entry.id}`;
      options.push({
        value,
        label: providerLabel(entry.name, entry.modelCount, entry.enabled),
        hint
      });
    }
    options.push({ value: "add", label: "+ Add a provider", hint: "" });
    if (hasOpencode) {
      options.push({ value: "import", label: "\u2192 Bring settings from OpenCode", hint: "One-time import" });
    }
    options.push({ value: "done", label: "Done", hint: "" });
    const choice = await p7.select({
      message: entries.length > 0 ? "Your AI providers" : "Get started",
      options
    });
    if (p7.isCancel(choice) || choice === "done") {
      return 0;
    }
    if (choice === "add") {
      await runProvidersAdd();
      continue;
    }
    if (choice === "import") {
      await runProvidersImport();
      continue;
    }
    if (typeof choice === "string" && choice.startsWith("cloud:")) {
      const id = choice.slice("cloud:".length);
      if (id === "zen" || id === "go") await runCloudBuiltinDetail(id);
      continue;
    }
    if (typeof choice === "string" && choice.startsWith("provider:")) {
      const id = choice.slice("provider:".length);
      const outcome = await runProviderDetail(id);
      if (outcome === "removed") continue;
    }
  }
}
async function runProvidersCommand(args) {
  const parsed = parseProvidersArgs(args);
  if (parsed.error) {
    p7.log.error(parsed.error);
    return 1;
  }
  if (parsed.showHelp) {
    console.log(providersHelpText());
    return 0;
  }
  if (parsed.subcommand === "import") return runProvidersImport();
  if (parsed.subcommand === "list") return runProvidersList();
  if (parsed.subcommand === "add") return runProvidersAdd();
  if (parsed.subcommand === "remove" && parsed.removeId) return runProvidersRemove(parsed.removeId);
  if (parsed.subcommand === "refresh-models") return runProvidersRefreshModels(parsed.removeId);
  p7.intro(pc6.bold("  Your AI providers"));
  return runProvidersHub();
}

// src/cli.ts
var STARTER_CLAUDE_FLAGS = /* @__PURE__ */ new Set(["--dry-run", "--setup", "--trace", "--help", "-h", "--version", "-v"]);
function emptyParsed(command) {
  return {
    command,
    showHelp: false,
    showVersion: false,
    dryRun: false,
    setup: false,
    trace: false,
    vertex: false,
    claudeArgs: []
  };
}
function parseArgs(args) {
  if (args.length === 0) return { ...emptyParsed("root"), showHelp: true };
  const [first, ...rest] = args;
  if (first === "--help" || first === "-h") {
    return { ...emptyParsed("root"), showHelp: true };
  }
  if (first === "--version" || first === "-v") {
    return { ...emptyParsed("root"), showVersion: true };
  }
  if (first === "server") {
    const parsed2 = emptyParsed("server");
    for (const arg of rest) {
      if (arg === "--help" || arg === "-h") parsed2.showHelp = true;
      else if (arg === "--version" || arg === "-v") parsed2.showVersion = true;
      else if (arg === "--vertex") parsed2.vertex = true;
      else if (!parsed2.error) parsed2.error = `Unknown server option: ${arg}`;
    }
    return parsed2;
  }
  if (first === "models") {
    const parsed2 = emptyParsed("models");
    for (const arg of rest) {
      if (arg === "--help" || arg === "-h") parsed2.showHelp = true;
      else if (arg === "--version" || arg === "-v") parsed2.showVersion = true;
      else if (!parsed2.error) parsed2.error = `Unknown models option: ${arg}`;
    }
    return parsed2;
  }
  if (first === "providers") {
    const parsed2 = emptyParsed("providers");
    parsed2.claudeArgs = rest;
    for (const arg of rest) {
      if (arg === "--help" || arg === "-h") parsed2.showHelp = true;
      else if (arg === "--version" || arg === "-v") parsed2.showVersion = true;
    }
    return parsed2;
  }
  if (first !== "claude") {
    return {
      ...emptyParsed("root"),
      error: first.startsWith("-") ? `Unknown root option: ${first}` : `Unknown command: ${first}`
    };
  }
  const parsed = emptyParsed("claude");
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--") {
      parsed.claudeArgs.push(...rest.slice(i + 1));
      break;
    }
    if (!STARTER_CLAUDE_FLAGS.has(arg)) {
      parsed.claudeArgs.push(arg);
      continue;
    }
    if (arg === "--dry-run") parsed.dryRun = true;
    if (arg === "--setup") parsed.setup = true;
    if (arg === "--trace") parsed.trace = true;
    if (arg === "--help" || arg === "-h") parsed.showHelp = true;
    if (arg === "--version" || arg === "-v") parsed.showVersion = true;
  }
  return parsed;
}
function rootHelpText() {
  return `${pc7.bold("relay-ai")} v${VERSION}
Launch AI coding tools with OpenCode Zen, Go, or local providers (Groq, Mistral,
OpenAI, Gemini, Ollama, and more).

${pc7.bold("Usage:")}
  relay-ai claude [options] [claude-flags]
  relay-ai models
  relay-ai providers
  relay-ai server
  relay-ai --help
  relay-ai --version

${pc7.bold("Commands:")}
  claude      Launch Claude Code \u2014 cloud Zen/Go or local OpenCode providers
  models      Manage favorite models for mid-session /model switching (max ${MAX_MODEL_CATALOG})
  providers   Add, import, and manage your AI providers
  server      Run a foreground API gateway (Zen, Go, and local providers)
  codex       planned

${pc7.bold("Migration:")}
  Bare relay-ai prints this help instead of launching Claude Code.
  Use relay-ai claude for the wizard and launcher.

${pc7.bold("Examples:")}
  relay-ai claude
  relay-ai models
  relay-ai server
  relay-ai claude -c
  relay-ai claude --resume abc-123
  relay-ai claude -- --print "hello"`;
}
function claudeHelpText() {
  return `${pc7.bold("relay-ai claude")} v${VERSION}
Launch Claude Code with OpenCode Zen, Go, or local providers as the API backend.

${pc7.bold("Usage:")}
  relay-ai claude [options] [claude-flags]
  relay-ai claude --help
  relay-ai claude --version

${pc7.bold("Options:")}
  --dry-run    Run the wizard but show a preview instead of launching Claude Code
  --setup      Re-configure your subscription tier
  --trace      Write debug logs to ~/.relay-ai/logs/ and show errors on exit
  --help       Show this command help
  --version    Show version

${pc7.bold("Providers:")}
  Cloud (Zen/Go)  Requires OPENCODE_API_KEY \u2014 get one at https://opencode.ai/auth
  Local           Requires OpenCode CLI with providers configured (Groq, Mistral,
                  OpenAI, Gemini, Ollama, etc.). Shown in the wizard when available.

${pc7.bold("Model switching:")}
  Run relay-ai models to save favorites (max ${MAX_MODEL_CATALOG}).
  When favorites exist, launch starts a multi-route proxy and Claude Code /model
  lists your starting model plus favorites for live switching.
  With no favorites, launch uses a single model as before.

${pc7.bold("Note:")}
  Claude Code may save the launched model to ~/.claude/settings.json.
  Bare claude later can still show that model \u2014 reset with claude --model sonnet.

${pc7.bold("Examples:")}
  relay-ai claude
  relay-ai claude -c
  relay-ai claude --resume abc-123
  relay-ai claude abc-123
  relay-ai claude --dry-run -c
  relay-ai claude --setup
  relay-ai claude --trace --resume abc-123
  relay-ai claude -- --print "hello"
  relay-ai claude -- --dangerously-skip-permissions`;
}
function serverHelpText() {
  return `${pc7.bold("relay-ai server")} v${VERSION}
Run a foreground API gateway for Zen, Go, local OpenCode providers, or Vertex AI.

${pc7.bold("Usage:")}
  relay-ai server
  relay-ai server --vertex
  relay-ai server --help
  relay-ai server --version

${pc7.bold("Behavior:")}
  Default: interactive wizard for exposed providers, discovery id masking (for
  Claude Desktop / Cowork), optional favorites-only catalog, then listen mode.
  --vertex: Anthropic-compatible gateway to Claude on Google Vertex AI using
  local gcloud Application Default Credentials (no OpenCode API key).
  Binds to port 17645. Network mode asks for a server password.

${pc7.bold("Vertex env:")}
  ANTHROPIC_VERTEX_PROJECT_ID or GOOGLE_CLOUD_PROJECT \u2014 your GCP project
  GOOGLE_CLOUD_LOCATION or CLOUD_ML_REGION \u2014 region (default: global)
  Optional catalog: ~/.relay-ai/vertex-models.json (see vertex-models.example.json)

${pc7.bold("Endpoints:")}
  Anthropic-compatible:  ANTHROPIC_BASE_URL=http://127.0.0.1:17645/anthropic
  OpenAI-compatible:     OPENAI_BASE_URL=http://127.0.0.1:17645/openai/v1
  API key: use anything locally; use the server password in network mode.`;
}
function modelsHelpText() {
  return `${pc7.bold("relay-ai models")} v${VERSION}
Manage favorite models for mid-session switching in Claude Code.

${pc7.bold("Usage:")}
  relay-ai models
  relay-ai models --help
  relay-ai models --version

${pc7.bold("Behavior:")}
  Opens an interactive manager to add or remove favorites.
  Pick from Zen, Go, or any configured local OpenCode provider.
  Favorites are saved to ~/.relay-ai/config.json (max ${MAX_MODEL_CATALOG}).

${pc7.bold("How it works:")}
  When favorites exist, relay-ai claude starts a multi-route catalog proxy.
  Claude Code /model lists your starting model plus favorites \u2014 switch live
  without restarting. Mix cloud and local favorites in one session.
  With no favorites, launch uses a single model as before.

${pc7.bold("Examples:")}
  relay-ai models
  relay-ai claude    # switch menu active when favorites are set`;
}
function printHelp(text4) {
  console.log(`
${text4}
`);
}
async function launchClaudeViaCatalog(catalogRoutes, startingRoute, contextWindow, trace, claudeArgs) {
  let proxyHandle;
  try {
    proxyHandle = await startProxyCatalog(catalogRoutes, startingRoute.aliasId, trace);
    p8.log.info(
      `Switch menu active \u2014 proxy on port ${proxyHandle.port} ` + pc7.dim(`(${catalogRoutes.length} model${catalogRoutes.length !== 1 ? "s" : ""} in /model)`)
    );
  } catch (err) {
    p8.log.error(`Failed to start proxy: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  const childEnv = buildChildEnv(
    `http://127.0.0.1:${proxyHandle.port}`,
    startingRoute.aliasId,
    "catalog-proxy",
    proxyHandle.port,
    contextWindow,
    true
  );
  const debugLogPath = prepareClaudeTraceLog();
  const traceArgs = trace ? ["--debug-file", debugLogPath] : [];
  if (trace) p8.log.info(`Debug log: ${debugLogPath}`);
  const exitCode = await launchClaude(childEnv, startingRoute.aliasId, [...traceArgs, ...claudeArgs]);
  proxyHandle.close();
  if (trace) printTraceLog(debugLogPath);
  return exitCode;
}
function printDryRun(backendName, modelId, baseUrl, modelFormat, claudeArgs, conflicts, disableExperimentalBetas, npm) {
  console.log("");
  console.log(pc7.bold(pc7.cyan("  DRY RUN \u2014 would execute:")));
  console.log("");
  const claudeCmd = ["claude", "--model", modelId, ...claudeArgs].join(" ");
  console.log(`  ${pc7.bold("Command:")}  ${claudeCmd}`);
  console.log(`  ${pc7.bold("Backend:")}  ${backendName}`);
  if (modelFormat === "openai") {
    console.log(`  ${pc7.bold("Proxy:")}    would start local SDK adapter proxy ${pc7.dim("(Vercel AI SDK)")}`);
    if (npm) console.log(`             ${pc7.dim(`npm: ${npm}`)}`);
  }
  console.log("");
  console.log(`  ${pc7.bold("Env vars SET:")}`);
  if (modelFormat === "openai") {
    console.log(`    ANTHROPIC_BASE_URL=http://127.0.0.1:<port>  ${pc7.dim("(local proxy)")}`);
  } else {
    console.log(`    ANTHROPIC_BASE_URL=${baseUrl}`);
  }
  console.log(`    ANTHROPIC_API_KEY=<your OPENCODE_API_KEY>`);
  console.log(`    ANTHROPIC_MODEL=${modelId}`);
  if (disableExperimentalBetas) {
    console.log(`    CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1  ${pc7.dim("(direct upstream \u2014 strips beta headers)")}`);
  } else {
    console.log(`    ${pc7.dim("(experimental betas enabled \u2014 tool search via local proxy)")}`);
  }
  console.log(`    ENABLE_TOOL_SEARCH=true  ${pc7.dim("(defer MCP tools like native Claude Code)")}`);
  console.log(`    CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT=0  ${pc7.dim("(keep full system prompt on proxy routes)")}`);
  console.log("");
  if (conflicts.length > 0) {
    console.log(`  ${pc7.bold("Env vars REMOVED:")}`);
    for (const c of conflicts) {
      console.log(`    ${pc7.dim(c.name)}=${pc7.dim(c.value)}`);
    }
    console.log("");
  }
  console.log(pc7.dim("  (dry run complete \u2014 Claude Code was NOT launched)"));
  console.log("");
}
async function runModelsCommand() {
  p8.intro(pc7.bold("  Relay AI \u2014 Favorite Models"));
  const spinner5 = p8.spinner();
  spinner5.start("Loading providers...");
  const catalog = await fetchProviderCatalog();
  spinner5.stop("");
  const allProviders = providersForPicker(catalog);
  if (allProviders.length === 0) {
    p8.log.warn("No providers found.");
    p8.log.info("OpenCode Zen/Go is always available. Local providers appear when OpenCode is running.");
    p8.outro("Done.");
    return 0;
  }
  const modelLookup = /* @__PURE__ */ new Map();
  for (const ap of allProviders) {
    for (const m of ap.models) {
      modelLookup.set(`${ap.id}:${m.id}`, { modelName: m.name || m.id, providerName: ap.name });
    }
  }
  const prefs = loadPreferences();
  let favorites = prefs.favoriteModels ?? [];
  let favoritesDirty = false;
  while (true) {
    const options = [];
    for (let i = 0; i < favorites.length; i++) {
      const fav = favorites[i];
      const entry = modelLookup.get(`${fav.providerId}:${fav.modelId}`);
      const label = entry ? `\u2605 ${entry.modelName} (${entry.providerName})` : pc7.dim(`\u2605 ${fav.modelId} \u2014 provider gone`);
      options.push({ value: `fav-${i}`, label, hint: "select to remove" });
    }
    const atCap = favorites.length >= MAX_MODEL_CATALOG;
    options.push({
      value: "__add__",
      label: atCap ? pc7.dim(`+ Add a model \u2192 (limit of ${MAX_MODEL_CATALOG} reached)`) : "+ Add a model \u2192",
      hint: atCap ? "Remove a favorite first to make room" : `${allProviders.length} provider${allProviders.length !== 1 ? "s" : ""} available`
    });
    options.push({ value: "__done__", label: "Done", hint: "" });
    const header = favorites.length === 0 ? `Favorites (0/${MAX_MODEL_CATALOG})` : `Favorites (${favorites.length}/${MAX_MODEL_CATALOG}) \u2014 select to remove`;
    const choice = await p8.select({
      message: header,
      options,
      initialValue: "__done__"
    });
    if (p8.isCancel(choice) || choice === "__done__") break;
    if (choice === "__add__") {
      if (atCap) {
        p8.log.warn(`Limit of ${MAX_MODEL_CATALOG} favorites reached \u2014 remove one first.`);
        continue;
      }
      const providerOptions = allProviders.map((ap) => ({
        value: ap.id,
        label: ap.name,
        hint: `${ap.models.length} model${ap.models.length !== 1 ? "s" : ""}`
      }));
      const pickedProviderId = await p8.select({
        message: "Which provider?",
        options: providerOptions
      });
      if (p8.isCancel(pickedProviderId)) continue;
      const provider = allProviders.find((ap) => ap.id === pickedProviderId);
      const browsed = await browseAllModels(provider, prefs);
      if (!browsed) continue;
      const fav = { providerId: provider.id, modelId: browsed.id };
      const result = addFavorite(favorites, fav);
      if (!result.ok) {
        if (result.reason === "duplicate") {
          p8.log.warn(`${browsed.name || browsed.id} is already in your favorites.`);
        } else {
          p8.log.warn(`Limit of ${MAX_MODEL_CATALOG} favorites reached \u2014 remove one first.`);
        }
        continue;
      }
      favorites = result.list;
      favoritesDirty = true;
      p8.log.success(`Added ${browsed.name || browsed.id} (${provider.name}) to favorites.`);
    } else if (choice.startsWith("fav-")) {
      const idx = parseInt(choice.slice(4), 10);
      const fav = favorites[idx];
      const entry = modelLookup.get(`${fav.providerId}:${fav.modelId}`);
      const label = entry ? `${entry.modelName} (${entry.providerName})` : fav.modelId;
      favorites = removeFavorite(favorites, fav);
      favoritesDirty = true;
      p8.log.success(`Removed ${label} from favorites.`);
    }
  }
  if (favoritesDirty) {
    savePreferences({ favoriteModels: favorites });
  }
  p8.outro(
    favorites.length === 0 ? "No favorites saved \u2014 launch will use single-model mode." : pc7.green(`${favorites.length} favorite${favorites.length !== 1 ? "s" : ""} saved \u2014 /model menu will show these on next launch.`)
  );
  return 0;
}
async function runClaudeCommand(parsed) {
  const { dryRun, setup, trace, claudeArgs } = parsed;
  const claudePath = findClaudeBinary();
  if (!claudePath) {
    console.error(pc7.red("\nError: claude binary not found on PATH.\n"));
    console.error("Install Claude Code:");
    console.error("  npm install -g @anthropic-ai/claude-code\n");
    return 1;
  }
  const prefs = dryRun ? {} : loadPreferences();
  const conflicts = detectConflicts();
  const favorites = dryRun ? [] : prefs.favoriteModels ?? [];
  const switchMenuActive = favorites.length > 0;
  const hasZenGoFavorites = favorites.some((f) => f.providerId === "zen" || f.providerId === "go");
  p8.intro(pc7.bold("  Relay AI"));
  if (setup && !dryRun) {
    p8.log.info("Provider setup now lives in relay-ai providers \u2014 opening that next is recommended.");
  }
  if (!dryRun && await needsFirstRunSetup()) {
    const firstRun = await runFirstRunWizard(trace);
    if (firstRun === "cancel") return 0;
  }
  let earlyEffectiveKey = null;
  let earlyZenModels = [];
  let earlyGoModels = [];
  if (switchMenuActive && hasZenGoFavorites && !dryRun) {
    const apiKey = await resolveOrCollectApiKey(false, trace);
    if (!apiKey) return 0;
    earlyEffectiveKey = apiKey;
    const zenGoSpinner = p8.spinner();
    zenGoSpinner.start("Fetching OpenCode models for switch menu...");
    try {
      const backends = [];
      if (favorites.some((f) => f.providerId === "zen")) backends.push("zen");
      if (favorites.some((f) => f.providerId === "go")) backends.push("go");
      const fetched = await fetchZenGoModels(backends, false);
      earlyZenModels = fetched.zenModels;
      earlyGoModels = fetched.goModels;
      zenGoSpinner.stop("");
    } catch (err) {
      zenGoSpinner.stop("");
      const detail = err instanceof Error ? err.message : String(err);
      p8.log.warn(`Could not fetch OpenCode models (${detail}) \u2014 Zen/Go favorites will be skipped from /model catalog`);
    }
  }
  const catalogSpinner = p8.spinner();
  catalogSpinner.start("Loading your providers...");
  let catalog;
  try {
    catalog = await fetchProviderCatalog({ persistCache: !dryRun });
  } catch (err) {
    catalogSpinner.stop("");
    console.error(pc7.red(String(err instanceof Error ? err.message : err)));
    return 1;
  }
  catalogSpinner.stop("");
  const allProviders = providersForPicker(catalog);
  if (allProviders.length === 0) {
    p8.log.warn("No providers available.");
    p8.log.info(pc7.dim("Run relay-ai providers add or import to get started."));
    return 0;
  }
  const migrateLastProvider = (id) => id === "opencode" ? "zen" : id;
  const providerOptions = allProviders.map((lp) => ({
    value: lp.id,
    label: lp.name,
    hint: `${lp.models.length} model${lp.models.length !== 1 ? "s" : ""} available`
  }));
  const migratedLast = migrateLastProvider(prefs.lastProvider);
  const initialProvider = migratedLast && providerOptions.some((o) => o.value === migratedLast) ? migratedLast : providerOptions[0].value;
  const chosen = await p8.select({
    message: "Which provider?",
    options: providerOptions,
    initialValue: initialProvider
  });
  if (p8.isCancel(chosen)) {
    p8.cancel("Cancelled.");
    return 0;
  }
  const providerChoice = chosen;
  let activeProvider = allProviders.find((lp) => lp.id === providerChoice);
  const isZenGo = providerChoice === "zen" || providerChoice === "go";
  let zenGoApiKey = earlyEffectiveKey;
  if (isZenGo && !dryRun) {
    zenGoApiKey = zenGoApiKey ?? await resolveOrCollectApiKey(false, trace);
    if (!zenGoApiKey) return 0;
    activeProvider = { ...activeProvider, apiKey: zenGoApiKey };
  }
  const selectedModel = await pickLocalModel(activeProvider, conflicts, prefs);
  if (!selectedModel) return 0;
  if (!dryRun) {
    const prevRecent = prefs.recentModelsByProvider?.[activeProvider.id] ?? [];
    const updatedRecent = [selectedModel.id, ...prevRecent.filter((id) => id !== selectedModel.id)].slice(0, 3);
    savePreferences({
      lastProvider: activeProvider.id,
      lastModel: selectedModel.id,
      recentModelsByProvider: { ...prefs.recentModelsByProvider, [activeProvider.id]: updatedRecent }
    });
  }
  const localProviders = catalog.localProviders.length > 0 ? catalog.localProviders : null;
  const effectiveZenGoKey = isZenGo ? zenGoApiKey ?? "dry-run-placeholder" : zenGoApiKey;
  const zenGoModelInfo = isZenGo ? (providerChoice === "zen" ? catalog.zenModels : catalog.goModels).find((m) => m.id === selectedModel.id) : void 0;
  if (switchMenuActive) {
    const resolveRoute = makeRouteResolver(
      localProviders,
      catalog.zenModels,
      catalog.goModels,
      effectiveZenGoKey
    );
    const startingRoute = isZenGo && zenGoModelInfo ? zenGoModelToRoute(zenGoModelInfo, activeProvider.apiKey) : localModelToRoute(activeProvider, selectedModel);
    if (!startingRoute) {
      p8.log.error("Could not resolve a proxy route for the selected model.");
      return 1;
    }
    const { routes: catalogRoutes, droppedFavorites } = buildCatalogRoutes(startingRoute, favorites, resolveRoute);
    if (droppedFavorites.length > 0) {
      p8.log.warn(
        `Skipping ${droppedFavorites.length} favorite${droppedFavorites.length === 1 ? "" : "s"} that are no longer available in /model`
      );
    }
    if (dryRun) {
      const endpoint = isZenGo ? BACKENDS[providerChoice].baseUrl : selectedModel.baseUrl ?? selectedModel.completionsUrl ?? "(unknown)";
      console.log("");
      console.log(pc7.bold(pc7.cyan("  DRY RUN \u2014 would execute (switch-menu mode):")));
      console.log("");
      console.log(`  ${pc7.bold("Provider:")}      ${activeProvider.name}`);
      console.log(`  ${pc7.bold("Starting model:")} ${selectedModel.id}`);
      console.log(`  ${pc7.bold("Endpoint:")}      ${endpoint}`);
      console.log(`  ${pc7.bold("/model catalog:")} ${catalogRoutes.length} model(s)`);
      catalogRoutes.forEach((r) => console.log(`    ${pc7.dim(r.displayName)}`));
      console.log("");
      console.log(pc7.dim("  (dry run complete \u2014 Claude Code was NOT launched)"));
      console.log("");
      return 0;
    }
    return launchClaudeViaCatalog(
      catalogRoutes,
      startingRoute,
      selectedModel.contextWindow,
      trace,
      claudeArgs
    );
  }
  if (dryRun) {
    if (isZenGo && zenGoModelInfo) {
      const backend = BACKENDS[zenGoModelInfo.sourceBackend];
      printDryRun(
        backend.name,
        zenGoModelInfo.id,
        backend.baseUrl,
        zenGoModelInfo.modelFormat,
        claudeArgs,
        conflicts,
        zenGoModelInfo.modelFormat !== "openai",
        zenGoModelInfo.modelFormat === "openai" ? "@ai-sdk/openai-compatible" : void 0
      );
      return 0;
    }
    const formatDesc = selectedModel.modelFormat === "anthropic" ? "direct passthrough" : "via SDK adapter proxy";
    const endpoint = selectedModel.modelFormat === "anthropic" ? selectedModel.baseUrl ?? "(unknown)" : selectedModel.npm ?? "SDK";
    console.log("");
    console.log(pc7.bold(pc7.cyan("  DRY RUN \u2014 would execute:")));
    console.log("");
    console.log(`  ${pc7.bold("Provider:")}  ${activeProvider.name}`);
    console.log(`  ${pc7.bold("Model:")}     ${selectedModel.id}`);
    console.log(`  ${pc7.bold("Format:")}    ${selectedModel.modelFormat} (${formatDesc})`);
    console.log(`  ${pc7.bold(selectedModel.modelFormat === "anthropic" ? "Endpoint:" : "SDK npm:")} ${endpoint}`);
    console.log(`  ${pc7.bold("Key:")}       ${activeProvider.name} provider key`);
    console.log("");
    console.log(pc7.dim("  (dry run complete \u2014 Claude Code was NOT launched)"));
    console.log("");
    return 0;
  }
  if (isZenGo && zenGoModelInfo) {
    const backend = BACKENDS[zenGoModelInfo.sourceBackend];
    const disableExperimentalBetas = zenGoModelInfo.modelFormat !== "openai";
    let proxyHandle2 = null;
    if (zenGoModelInfo.modelFormat === "openai") {
      try {
        proxyHandle2 = await startProxy(
          `${backend.baseUrl}/v1/chat/completions`,
          zenGoModelInfo.id,
          trace,
          zenGoModelInfo.contextWindow,
          { npm: "@ai-sdk/openai-compatible", baseURL: `${backend.baseUrl}/v1` }
        );
        p8.log.info(`Translation proxy started on port ${proxyHandle2.port}`);
      } catch (err) {
        p8.log.error(`Failed to start translation proxy: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
      }
    }
    const childEnv2 = buildChildEnv(
      backend.baseUrl,
      zenGoModelInfo.id,
      activeProvider.apiKey,
      proxyHandle2?.port,
      zenGoModelInfo.contextWindow
    );
    if (disableExperimentalBetas) {
      childEnv2["CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS"] = "1";
    }
    const debugLogPath2 = prepareClaudeTraceLog();
    const traceArgs2 = trace ? ["--debug-file", debugLogPath2] : [];
    if (trace) p8.log.info(`Debug log: ${debugLogPath2}`);
    const exitCode2 = await launchClaude(childEnv2, zenGoModelInfo.id, [...traceArgs2, ...claudeArgs]);
    proxyHandle2?.close();
    if (trace) printTraceLog(debugLogPath2);
    return exitCode2;
  }
  let proxyHandle = null;
  let childEnv;
  if (selectedModel.modelFormat === "anthropic") {
    childEnv = buildChildEnv(
      selectedModel.baseUrl,
      selectedModel.id,
      activeProvider.apiKey,
      void 0,
      selectedModel.contextWindow
    );
  } else {
    try {
      proxyHandle = await startProxy(
        selectedModel.completionsUrl ?? "",
        selectedModel.id,
        trace,
        selectedModel.contextWindow,
        {
          npm: selectedModel.npm,
          baseURL: selectedModel.apiBaseUrl,
          upstreamModelId: selectedModel.upstreamModelId
        }
      );
      p8.log.info(
        `SDK adapter proxy started on port ${proxyHandle.port}` + (selectedModel.npm ? pc7.dim(` (${selectedModel.npm})`) : "")
      );
    } catch (err) {
      p8.log.error(`Failed to start SDK adapter proxy: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
    childEnv = buildChildEnv(
      `http://127.0.0.1:${proxyHandle.port}`,
      selectedModel.id,
      activeProvider.apiKey,
      proxyHandle.port,
      selectedModel.contextWindow
    );
  }
  if (selectedModel.modelFormat === "anthropic") {
    childEnv["CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS"] = "1";
  }
  const debugLogPath = prepareClaudeTraceLog();
  const traceArgs = trace ? ["--debug-file", debugLogPath] : [];
  if (trace) p8.log.info(`Debug log: ${debugLogPath}`);
  const exitCode = await launchClaude(childEnv, selectedModel.id, [...traceArgs, ...claudeArgs]);
  proxyHandle?.close();
  if (trace) printTraceLog(debugLogPath);
  return exitCode;
}
async function main(args = process.argv.slice(2)) {
  const parsed = parseArgs(args);
  if (parsed.error) {
    console.error(pc7.red(`
Error: ${parsed.error}
`));
    printHelp(rootHelpText());
    return 1;
  }
  if (parsed.command === "root") {
    if (parsed.showVersion) {
      console.log(VERSION);
    } else {
      printHelp(rootHelpText());
    }
    return 0;
  }
  if (parsed.command === "server") {
    if (parsed.showVersion) {
      console.log(VERSION);
      return 0;
    }
    if (parsed.showHelp) {
      printHelp(serverHelpText());
      return 0;
    }
    return runServerCommand({ vertex: parsed.vertex });
  }
  if (parsed.command === "models") {
    if (parsed.showVersion) {
      console.log(VERSION);
      return 0;
    }
    if (parsed.showHelp) {
      printHelp(modelsHelpText());
      return 0;
    }
    return runModelsCommand();
  }
  if (parsed.command === "providers") {
    if (parsed.showVersion) {
      console.log(VERSION);
      return 0;
    }
    if (parsed.showHelp) {
      printHelp(providersHelpText());
      return 0;
    }
    return runProvidersCommand(parsed.claudeArgs);
  }
  if (parsed.showVersion) {
    console.log(VERSION);
    return 0;
  }
  if (parsed.showHelp) {
    printHelp(claudeHelpText());
    return 0;
  }
  return runClaudeCommand(parsed);
}
function isCliEntryPoint() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}
if (isCliEntryPoint()) {
  main().then((exitCode) => {
    process.exit(exitCode);
  }).catch((err) => {
    if (err === /* @__PURE__ */ Symbol.for("clack:cancel")) {
      process.exit(0);
    }
    console.error(pc7.red("\nUnexpected error:"), err);
    process.exit(1);
  });
}
export {
  claudeHelpText,
  main,
  modelsHelpText,
  parseArgs,
  rootHelpText,
  runClaudeCommand,
  runModelsCommand,
  serverHelpText
};
//# sourceMappingURL=cli.js.map