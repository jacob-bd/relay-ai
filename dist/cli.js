#!/usr/bin/env node

// src/cli.ts
import pc4 from "picocolors";
import * as p5 from "@clack/prompts";
import { appendFileSync as appendFileSync2, readFileSync as readFileSync4, existsSync as existsSync5, realpathSync } from "fs";
import { homedir as homedir6, tmpdir } from "os";
import { join as join7 } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

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
async function readFromCredentialStore(diag) {
  try {
    const { Entry } = await import("@napi-rs/keyring");
    const current = new Entry(KEYRING_SERVICE, KEYRING_ACCOUNT).getPassword();
    if (current) return current;
    return new Entry(LEGACY_KEYRING_SERVICE, LEGACY_KEYRING_ACCOUNT).getPassword() ?? null;
  } catch (err) {
    diag?.(classifyKeyringError(err));
    return null;
  }
}
async function saveToCredentialStore(key, diag) {
  try {
    const { Entry } = await import("@napi-rs/keyring");
    new Entry(KEYRING_SERVICE, KEYRING_ACCOUNT).setPassword(key);
    return true;
  } catch (err) {
    diag?.(classifyKeyringError(err));
    return false;
  }
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

// src/proxy.ts
import { createServer } from "http";
import { appendFileSync } from "fs";

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
function gatewayAliasId(model) {
  return aliasModelId(model.id, gatewayProviderLabel(model));
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
  const text3 = await response.text();
  let parsed = null;
  if (text3) {
    try {
      parsed = JSON.parse(text3);
    } catch {
      parsed = text3;
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
    const text3 = typeof msg.content === "string" ? msg.content : msg.content.map((b) => b.text ?? "").join("\n");
    if (text3.trim()) parts.push(text3.trim());
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
  const text3 = block.thinking ?? "";
  if (npm === "@ai-sdk/openai" && !block.signature && !text3.trim()) return null;
  const part = { type: "reasoning", text: text3 };
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
          const p6 = imagePart(b);
          if (p6) parts.push(p6);
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
async function writeAnthropicStream(fullStream, modelId, write, log5) {
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
        log5?.(() => `sdk stream error: ${JSON.stringify(e?.data ?? part.error)}`);
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
async function streamAnthropicResponse(model, params, modelId, write, log5) {
  const result = streamText({ model, ...params });
  await writeAnthropicStream(result.fullStream, modelId, write, log5);
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
function makeProxyLog(debug, logPath = "/tmp/opencode-proxy-debug.log") {
  if (!debug) return () => {
  };
  return (message) => {
    try {
      const line = typeof message === "function" ? message() : message;
      appendFileSync(logPath, `${(/* @__PURE__ */ new Date()).toISOString()} ${line}
`);
    } catch {
    }
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
function aliasModelId(realId, providerLabel) {
  if (realId.startsWith("claude-")) return realId;
  const sanitized = providerLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
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
    aliasId: aliasModelId(model.id, lp.name),
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
    aliasId: aliasModelId(model.id, backend.name),
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
  const tail = favorites.map((fav) => resolveRoute(fav.providerId, fav.modelId)).filter((route) => route !== void 0);
  return [
    startingRoute,
    ...tail.filter((route) => route.aliasId !== startingRoute.aliasId)
  ].slice(0, max);
}

// src/server/index.ts
import pc2 from "picocolors";
import { networkInterfaces } from "os";
import * as p3 from "@clack/prompts";

// src/config.ts
import { dirname, join as join4 } from "path";
import { copyFileSync, existsSync as existsSync2, mkdirSync, readFileSync as readFileSync2, renameSync, writeFileSync } from "fs";

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

// src/config.ts
function readJsonFile(path) {
  try {
    const parsed = JSON.parse(readFileSync2(path, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
function ensureAppHomeMigrated() {
  const configPath = getConfigPath();
  if (existsSync2(configPath)) return;
  const legacyConfig = join4(getLegacyAppHome(), "config.json");
  if (!existsSync2(legacyConfig)) return;
  mkdirSync(getAppHome(), { recursive: true });
  copyFileSync(legacyConfig, configPath);
  const legacyVertex = join4(getLegacyAppHome(), "vertex-models.json");
  const vertexPath = join4(getAppHome(), "vertex-models.json");
  if (existsSync2(legacyVertex) && !existsSync2(vertexPath)) {
    copyFileSync(legacyVertex, vertexPath);
  }
}
function ensureConfigMigrated() {
  ensureAppHomeMigrated();
  const configPath = getConfigPath();
  if (existsSync2(configPath)) return;
  const legacyPath = getLegacyConfPath();
  if (!existsSync2(legacyPath)) return;
  const legacy = readJsonFile(legacyPath);
  if (!legacy) return;
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(legacy, null, 2)}
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
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}
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
function setSavedServerPassword(password2) {
  const config = readConfig();
  config.server = {
    ...config.server ?? {},
    savedPassword: password2
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
function groupModels(models) {
  const free = models.filter((m) => m.isFree).sort((a, b) => a.id.localeCompare(b.id));
  const byBrand = /* @__PURE__ */ new Map();
  for (const m of models.filter((m2) => !m2.isFree)) {
    const list = byBrand.get(m.brand) ?? [];
    list.push(m);
    byBrand.set(m.brand, list);
  }
  for (const [brand, list] of byBrand) {
    byBrand.set(brand, list.sort((a, b) => a.id.localeCompare(b.id)));
  }
  return { free, byBrand };
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
import { execSync as execSync2, spawn as spawn2 } from "child_process";
import { existsSync as existsSync3 } from "fs";
import { homedir as homedir4 } from "os";
import { join as join5 } from "path";
var isWindows2 = process.platform === "win32";
var OPENCODE_FALLBACK_PATHS = isWindows2 ? [
  join5(process.env["APPDATA"] ?? homedir4(), "npm", "opencode.cmd"),
  join5(process.env["APPDATA"] ?? homedir4(), "npm", "opencode"),
  join5(homedir4(), "AppData", "Roaming", "npm", "opencode.cmd")
] : [
  join5(homedir4(), ".opencode", "bin", "opencode"),
  join5(homedir4(), ".local", "bin", "opencode"),
  join5(homedir4(), ".npm", "bin", "opencode"),
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
    if (existsSync3(path)) return path;
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
async function fetchProviderCatalog(opts) {
  const persistCache = opts?.persistCache ?? false;
  const [localProviders, zenGo] = await Promise.all([
    fetchLocalProviders().then((providers) => providers ?? []),
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
        sourceBackend: "zen",
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
import * as p from "@clack/prompts";
async function askServerStartMode() {
  const mode = await p.select({
    message: "How do you want to start the server?",
    options: [
      { value: "configure", label: "Configure & start", hint: "Providers, discovery masking, listen mode" },
      { value: "quick", label: "Start with saved settings", hint: "Use last server configuration" }
    ],
    initialValue: "configure"
  });
  if (p.isCancel(mode)) {
    p.cancel("Cancelled.");
    return null;
  }
  return mode;
}
async function askMaskGatewayIds(initialValue) {
  p.note(
    "Claude Desktop and Cowork filter competitor model names in gateway ids. Masking keeps discovery working while display names stay readable.",
    "Needed for Claude Desktop / Cowork"
  );
  const mask = await p.confirm({
    message: "Mask gateway model ids for discovery?",
    initialValue
  });
  if (p.isCancel(mask)) {
    p.cancel("Cancelled.");
    return null;
  }
  return Boolean(mask);
}
async function askFavoritesOnly(initialValue) {
  const favoritesOnly = await p.confirm({
    message: "Expose only favorite models?",
    initialValue
  });
  if (p.isCancel(favoritesOnly)) {
    p.cancel("Cancelled.");
    return null;
  }
  return Boolean(favoritesOnly);
}
async function askListenMode() {
  const mode = await p.select({
    message: "Where should the server listen?",
    options: [
      { value: "local", label: "Local only", hint: "Only this computer can use it" },
      { value: "network", label: "Network", hint: "Other computers on your network can use it" }
    ],
    initialValue: "local"
  });
  if (p.isCancel(mode)) {
    p.cancel("Cancelled.");
    return null;
  }
  return mode;
}
async function askServerPassword() {
  p.note(
    "Anyone on your network who knows this password can use this server through your OpenCode account.",
    "Network mode warning"
  );
  const password2 = await p.text({
    message: "Choose a server password for this run:",
    validate: (value) => value.trim() ? void 0 : "Password cannot be empty"
  });
  if (p.isCancel(password2)) {
    p.cancel("Cancelled.");
    return null;
  }
  return String(password2).trim();
}
async function askUseSavedServerPassword() {
  const choice = await p.select({
    message: "Use saved server password?",
    options: [
      { value: "use-saved", label: "Use saved password" },
      { value: "new-password", label: "Enter a new password" }
    ],
    initialValue: "use-saved"
  });
  if (p.isCancel(choice)) {
    p.cancel("Cancelled.");
    return null;
  }
  return choice;
}
async function askSaveServerPassword() {
  const save = await p.confirm({
    message: "Save this server password for future server runs?",
    initialValue: false
  });
  if (p.isCancel(save)) {
    p.cancel("Cancelled.");
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
  return options.backends[model.sourceBackend];
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
import pc from "picocolors";
import * as p2 from "@clack/prompts";
function isSelected(list, id) {
  return list.includes(id);
}
function resolveInitialServerProviders(initial, available) {
  if (!initial?.length) return [];
  return initial.filter((id) => available.some((provider) => provider.id === id));
}
async function selectServerProviders(available, initial) {
  if (available.length === 0) {
    p2.log.warn("No providers available to expose.");
    return null;
  }
  let selected = resolveInitialServerProviders(initial, available);
  const lookup = new Map(available.map((provider) => [provider.id, provider]));
  while (true) {
    const options = [];
    for (let i = 0; i < selected.length; i++) {
      const id = selected[i];
      const provider = lookup.get(id);
      const label = provider ? `\u2605 ${provider.name}` : pc.dim(`\u2605 ${id} \u2014 provider gone`);
      const hint = provider ? `${provider.modelCount} model${provider.modelCount !== 1 ? "s" : ""}` : "select to remove";
      options.push({ value: `prov-${i}`, label, hint: "select to remove" });
    }
    const unselected = available.filter((provider) => !isSelected(selected, provider.id));
    options.push({
      value: "__add__",
      label: unselected.length === 0 ? pc.dim("+ Add a provider \u2192 (all providers selected)") : "+ Add a provider \u2192",
      hint: unselected.length === 0 ? "" : `${unselected.length} more available`
    });
    options.push({ value: "__all__", label: "Expose all providers", hint: `${available.length} total` });
    if (selected.length > 0) {
      options.push({ value: "__clear__", label: "Clear all", hint: "start over" });
    }
    options.push({ value: "__done__", label: "Done", hint: "" });
    const header = selected.length === 0 ? `Exposed providers (0/${available.length}) \u2014 add providers to expose` : `Exposed providers (${selected.length}/${available.length}) \u2014 select to stop exposing`;
    const choice = await p2.select({
      message: header,
      options,
      initialValue: "__done__"
    });
    if (p2.isCancel(choice) || choice === "__done__") {
      if (selected.length === 0) {
        p2.log.warn("Select at least one provider to expose.");
        continue;
      }
      break;
    }
    if (choice === "__all__") {
      selected = available.map((provider) => provider.id);
      p2.log.success(`Exposing all ${available.length} providers.`);
      continue;
    }
    if (choice === "__clear__") {
      selected = [];
      p2.log.success("Cleared provider list \u2014 add the ones you want to expose.");
      continue;
    }
    if (choice === "__add__") {
      if (unselected.length === 0) continue;
      const picked = await p2.select({
        message: "Which provider?",
        options: unselected.map((provider) => ({
          value: provider.id,
          label: provider.name,
          hint: `${provider.modelCount} model${provider.modelCount !== 1 ? "s" : ""}`
        }))
      });
      if (p2.isCancel(picked)) continue;
      selected = [...selected, picked];
      continue;
    }
    if (choice.startsWith("prov-")) {
      const idx = parseInt(choice.slice(5), 10);
      const id = selected[idx];
      if (!id) continue;
      const provider = lookup.get(id);
      selected = selected.filter((_, i) => i !== idx);
      p2.log.success(`Removed ${provider?.name ?? id}.`);
    }
  }
  return selected;
}

// src/server/vertex-config.ts
import { existsSync as existsSync4, readFileSync as readFileSync3 } from "fs";
import { homedir as homedir5 } from "os";
import { join as join6 } from "path";
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
function defaultAdcCredentialsPath(home = homedir5()) {
  return join6(home, ".config", "gcloud", "application_default_credentials.json");
}
function hasApplicationDefaultCredentials(home = homedir5(), adcPath = defaultAdcCredentialsPath(home)) {
  return existsSync4(adcPath);
}
function loadVertexModelEntries(env = process.env) {
  const configPath = getVertexModelsPath(env);
  if (!existsSync4(configPath)) return DEFAULT_VERTEX_MODELS;
  try {
    const parsed = JSON.parse(readFileSync3(configPath, "utf8"));
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
      p3.log.info("No local providers found \u2014 using cloud models only");
    }
  } catch {
    p3.log.info("No local providers found \u2014 using cloud models only");
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
  p3.log.info("Add providers to expose. Listed providers are removed when selected \u2014 like favorites.");
  const spinner3 = p3.spinner();
  spinner3.start("Loading providers...");
  const catalog = await fetchProviderCatalog();
  spinner3.stop("");
  const available = providerOptionsForTier(tier, catalog);
  const picked = await selectServerProviders(available, getServerExposedProviders() ?? void 0);
  if (!picked) return void 0;
  setServerExposedProviders(picked);
  p3.log.success(`Saved ${picked.length} provider${picked.length !== 1 ? "s" : ""} for future server runs.`);
  return picked;
}
async function runServerWizard(tier) {
  p3.intro(pc2.bold("  Relay AI \u2014 Server"));
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
    p3.log.info("Manage favorites with `relay-ai models`.");
  }
  return { exposedProviders, maskGatewayIds, favoritesOnly };
}
async function runVertexServerCommand() {
  p3.intro(pc2.bold("  Relay AI \u2014 Vertex Gateway"));
  const vertexConfig = buildVertexRuntimeConfig();
  if (!vertexConfig) {
    p3.log.error("Set ANTHROPIC_VERTEX_PROJECT_ID or GOOGLE_CLOUD_PROJECT to your GCP project.");
    return 1;
  }
  if (!hasApplicationDefaultCredentials()) {
    p3.log.error("Google Application Default Credentials not found.");
    p3.log.info("Run: gcloud auth application-default login");
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
  console.log(pc2.bold(pc2.green("Vertex gateway running")));
  console.log(`  Anthropic:  http://127.0.0.1:${server.port}/anthropic`);
  console.log(`  Models:     ${models.map((model) => model.id).join(", ")}`);
  if (mode === "network") {
    console.log(`  Network:    http://${getLocalIp()}:${server.port}`);
    console.log(`  API key:    ${serverPassword}`);
  } else {
    console.log("  API key:    any non-empty value");
  }
  console.log(pc2.dim("  Auth:       gcloud Application Default Credentials"));
  console.log("");
  console.log(pc2.dim("Press Ctrl+C to stop."));
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
      p3.log.warn(`Credential store unavailable \u2014 ${reason}`);
    });
    if (apiKey) {
      const isMac = process.platform === "darwin";
      const isWindows3 = process.platform === "win32";
      const storeName = isMac ? "macOS Keychain" : isWindows3 ? "Windows Credential Manager" : "Secret Service";
      p3.log.success(`Found key in ${storeName}`);
    }
  }
  apiKey = sanitizeCredential(apiKey) ?? "";
  if (!apiKey) {
    p3.log.error("Missing OPENCODE_API_KEY. Run `relay-ai claude` once to configure your key, or export OPENCODE_API_KEY.");
    return 1;
  }
  const tier = getSubscriptionTier();
  if (!tier) {
    p3.log.error("Missing subscription tier. Run `relay-ai claude --setup` first.");
    return 1;
  }
  const runConfig = await runServerWizard(tier);
  if (!runConfig) return 0;
  const mode = await askListenMode();
  if (!mode) return 0;
  const serverPassword = await getServerPasswordForMode(mode);
  if (serverPassword === void 0) return 0;
  const host = mode === "network" ? "0.0.0.0" : "127.0.0.1";
  const spinner3 = p3.spinner();
  spinner3.start("Fetching available models...");
  let models;
  try {
    models = await loadServerModels(tier);
    if (runConfig.exposedProviders) {
      models = filterServerModelsByProviders(models, runConfig.exposedProviders);
    }
    if (runConfig.favoritesOnly) {
      const favorites = loadPreferences().favoriteModels ?? [];
      if (favorites.length === 0) {
        spinner3.stop(pc2.red("No favorite models configured"));
        p3.log.error("Run `relay-ai models` to add favorites, or turn off favorites-only in the server wizard.");
        return 1;
      }
      models = filterServerModelsByFavorites(models, favorites);
      if (models.length === 0) {
        spinner3.stop(pc2.red("No favorite models matched the current provider filter"));
        p3.log.error("Adjust favorites with `relay-ai models` or change exposed providers in the server wizard.");
        return 1;
      }
    }
    if (models.length === 0) {
      spinner3.stop(pc2.red("No models to expose"));
      p3.log.error("Add providers in the server wizard \u2014 Configure & start \u2192 manage exposed providers.");
      return 1;
    }
    const localCount = models.filter((m) => m.apiKey !== void 0).length;
    const summary = summarizeServerProviders(models);
    const filterNote = runConfig.exposedProviders ? ` \u2014 ${runConfig.exposedProviders.length} provider${runConfig.exposedProviders.length !== 1 ? "s" : ""}` : "";
    const favoritesNote = runConfig.favoritesOnly ? " \u2014 favorites only" : "";
    const maskNote = runConfig.maskGatewayIds ? " \u2014 discovery ids masked" : "";
    spinner3.stop(`Loaded ${models.length} models (${localCount} from local providers)${filterNote}${favoritesNote}${maskNote}`);
    if (summary) p3.log.info(summary);
  } catch (err) {
    spinner3.stop(pc2.red("Failed to load models"));
    console.error(pc2.red(String(err instanceof Error ? err.message : err)));
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
  console.log(pc2.bold(pc2.green("Relay AI server running")));
  console.log(`  Anthropic:  http://127.0.0.1:${server.port}/anthropic`);
  console.log(`  OpenAI:     http://127.0.0.1:${server.port}/openai`);
  if (mode === "network") {
    console.log(`  Network:    http://${getLocalIp()}:${server.port}`);
    console.log(`  API key:    ${serverPassword}`);
  } else {
    console.log("  API key:    any non-empty value");
  }
  if (runConfig.exposedProviders) {
    console.log(pc2.dim(`  Providers:  ${runConfig.exposedProviders.join(", ")}`));
  }
  if (runConfig.favoritesOnly) {
    console.log(pc2.dim("  Catalog:    favorite models only"));
  }
  if (runConfig.maskGatewayIds) {
    console.log(pc2.dim("  Discovery:  gateway ids masked for Claude Desktop / Cowork"));
  }
  console.log("");
  console.log(pc2.dim("Press Ctrl+C to stop."));
  await waitForShutdown();
  await server.close();
  return 0;
}

// src/prompts.ts
import * as p4 from "@clack/prompts";
import pc3 from "picocolors";
function modelLabel(model, showBackendBadge = false) {
  if (model.modelFormat === "unsupported") {
    return pc3.dim(`${model.name} (not yet supported)`);
  }
  if (model.isFree) {
    const tag = showBackendBadge ? "(free \xB7 Zen)" : "(free)";
    return pc3.green(`${model.name} ${tag}`);
  }
  return model.name;
}
function modelHint(model) {
  const parts = [];
  if (model.modelFormat === "openai") parts.push("via proxy");
  else if (model.modelFormat === "unsupported") parts.push("needs format support");
  if (!model.isFree) parts.push(`${model.brand} \xB7 ${model.id}`);
  else parts.push(model.id);
  return parts.join(" \xB7 ");
}
async function askSubscriptionTier() {
  const tier = await p4.select({
    message: "What OpenCode subscription do you have?",
    options: [
      {
        value: "free",
        label: "Free only",
        hint: "Zen free models only \u2014 no subscription needed"
      },
      {
        value: "zen",
        label: "Zen subscription",
        hint: "All Zen models (paid + free)"
      },
      {
        value: "go",
        label: "Go subscription",
        hint: "All Go models"
      },
      {
        value: "both",
        label: "Both (Zen + Go)",
        hint: "All Go models + all Zen models \u2014 choose backend each launch"
      }
    ],
    initialValue: "free"
  });
  if (p4.isCancel(tier)) {
    p4.cancel("Cancelled.");
    return null;
  }
  return tier;
}
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
    const picked = await p4.select({
      message: `${messagePrefix} (page ${currentPage + 1} of ${totalPages})`,
      options,
      initialValue
    });
    if (p4.isCancel(picked)) return "menu";
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
      const method = await p4.select({
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
      if (p4.isCancel(method)) {
        p4.cancel("Cancelled.");
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
    const searchInput = await p4.text({
      message: `Search models (${models.length} available):`,
      placeholder: "e.g. claude, sonnet, llama"
    });
    if (p4.isCancel(searchInput)) {
      mode = "choose";
      continue;
    }
    const matched = filterModelsBySearch(browseList, String(searchInput));
    if (matched.length === 0) {
      p4.log.warn("No models match \u2014 try a different search");
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
    const picked = await p4.select({
      message,
      options,
      initialValue
    });
    if (p4.isCancel(picked)) {
      p4.cancel("Cancelled.");
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
  const lines = conflicts.map((c) => `  ${pc3.dim(c.name)}=${pc3.dim(c.value)}`).join("\n");
  p4.note(lines, pc3.yellow("Env vars that will be temporarily overridden:"));
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
    const picked = await p4.select({
      message: "Which model?",
      options,
      initialValue: recentModels[0].id
    });
    if (p4.isCancel(picked)) {
      p4.cancel("Cancelled.");
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
  const confirmed = await p4.confirm({
    message: `Launch Claude Code \xB7 ${pc3.bold(selectedModel.id)} via ${pc3.bold(provider.name)}?`,
    initialValue: true
  });
  if (p4.isCancel(confirmed) || !confirmed) {
    p4.cancel("Cancelled.");
    return null;
  }
  p4.outro(pc3.green("Launching..."));
  return selectedModel;
}
async function runWizard(prefs, modelsByBackend, conflicts, tier) {
  let selectorBackendId = null;
  if (tier === "both") {
    const backendId = await p4.select({
      message: "Which backend?",
      options: [
        { value: "zen", label: "OpenCode Zen", hint: "66+ models, free tier available" },
        { value: "go", label: "OpenCode Go", hint: "17 models, subscription ($10/mo)" }
      ],
      initialValue: prefs.lastBackend ?? "zen"
    });
    if (p4.isCancel(backendId)) {
      p4.cancel("Cancelled.");
      return null;
    }
    selectorBackendId = backendId;
  }
  const showBackendBadge = tier === "go";
  let models;
  if (tier === "free") {
    models = modelsByBackend.zen.filter((m) => m.isFree);
  } else if (tier === "zen") {
    models = modelsByBackend.zen;
  } else if (tier === "go") {
    const zenFree = modelsByBackend.zen.filter((m) => m.isFree);
    models = [...zenFree, ...modelsByBackend.go];
  } else {
    models = selectorBackendId === "go" ? modelsByBackend.go : modelsByBackend.zen;
  }
  const selectableModels = [];
  const unsupportedModels = [];
  for (const m of models) {
    (m.modelFormat === "unsupported" ? unsupportedModels : selectableModels).push(m);
  }
  const { free, byBrand } = groupModels(selectableModels);
  const brandOrder = ["Claude", "GPT", "Gemini", "DeepSeek", "Qwen", "MiniMax", "Kimi", "GLM", "MiMo", "Grok", "Nemotron", "Other"];
  const sortedBrands = [...byBrand.keys()].sort(
    (a, b) => (brandOrder.indexOf(a) !== -1 ? brandOrder.indexOf(a) : 99) - (brandOrder.indexOf(b) !== -1 ? brandOrder.indexOf(b) : 99)
  );
  const orderedSelectable = [
    ...free,
    ...sortedBrands.flatMap((brand) => byBrand.get(brand) ?? [])
  ];
  if (orderedSelectable.length === 0) {
    p4.cancel("No models available for this backend and subscription tier.");
    return null;
  }
  const selectedModel = await selectModelWithSearch(
    orderedSelectable,
    (m) => ({ value: m.id, label: modelLabel(m, showBackendBadge), hint: modelHint(m) }),
    "Which model?",
    prefs.lastModel,
    orderedSelectable
  );
  if (!selectedModel) return null;
  if (unsupportedModels.length > 0) {
    const brandCounts = unsupportedModels.reduce((acc, m) => {
      acc[m.brand] = (acc[m.brand] ?? 0) + 1;
      return acc;
    }, {});
    const summary = Object.entries(brandCounts).map(([b, c]) => `${b} (${c})`).join(", ");
    p4.log.info(pc3.dim(`Not yet supported: ${summary} \u2014 need API format translation`));
  }
  const backend = BACKENDS[selectedModel.sourceBackend];
  noteEnvConflicts(conflicts);
  const confirmed = await p4.confirm({
    message: `Launch Claude Code \xB7 ${pc3.bold(selectedModel.id)} via ${pc3.bold(backend.name)}?`,
    initialValue: true
  });
  if (p4.isCancel(confirmed) || !confirmed) {
    p4.cancel("Cancelled.");
    return null;
  }
  p4.outro(pc3.green("Launching..."));
  return { backend, model: selectedModel };
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
  return `${pc4.bold("relay-ai")} v${VERSION}
Launch AI coding tools with OpenCode Zen, Go, or local providers (Groq, Mistral,
OpenAI, Gemini, Ollama, and more).

${pc4.bold("Usage:")}
  relay-ai claude [starter-options] [claude-flags]
  relay-ai models
  relay-ai server
  relay-ai --help
  relay-ai --version

${pc4.bold("Commands:")}
  claude      Launch Claude Code \u2014 cloud Zen/Go or local OpenCode providers
  models      Manage favorite models for mid-session /model switching (max ${MAX_MODEL_CATALOG})
  server      Run a foreground API gateway (Zen, Go, and local providers)
  codex       planned

${pc4.bold("Migration:")}
  Bare relay-ai prints this help instead of launching Claude Code.
  Use relay-ai claude for the wizard and launcher.

${pc4.bold("Examples:")}
  relay-ai claude
  relay-ai models
  relay-ai server
  relay-ai claude -c
  relay-ai claude --resume abc-123
  relay-ai claude -- --print "hello"`;
}
function claudeHelpText() {
  return `${pc4.bold("relay-ai claude")} v${VERSION}
Launch Claude Code with OpenCode Zen, Go, or local providers as the API backend.

${pc4.bold("Usage:")}
  relay-ai claude [starter-options] [claude-flags]
  relay-ai claude --help
  relay-ai claude --version

${pc4.bold("Starter options:")}
  --dry-run    Run the wizard but show a preview instead of launching Claude Code
  --setup      Re-configure your subscription tier
  --trace      Write debug logs to /tmp and show errors on exit
  --help       Show this command help
  --version    Show version

${pc4.bold("Providers:")}
  Cloud (Zen/Go)  Requires OPENCODE_API_KEY \u2014 get one at https://opencode.ai/auth
  Local           Requires OpenCode CLI with providers configured (Groq, Mistral,
                  OpenAI, Gemini, Ollama, etc.). Shown in the wizard when available.

${pc4.bold("Model switching:")}
  Run relay-ai models to save favorites (max ${MAX_MODEL_CATALOG}).
  When favorites exist, launch starts a multi-route proxy and Claude Code /model
  lists your starting model plus favorites for live switching.
  With no favorites, launch uses a single model as before.

${pc4.bold("Note:")}
  Claude Code may save the launched model to ~/.claude/settings.json.
  Bare claude later can still show that model \u2014 reset with claude --model sonnet.

${pc4.bold("Examples:")}
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
  return `${pc4.bold("relay-ai server")} v${VERSION}
Run a foreground API gateway for Zen, Go, local OpenCode providers, or Vertex AI.

${pc4.bold("Usage:")}
  relay-ai server
  relay-ai server --vertex
  relay-ai server --help
  relay-ai server --version

${pc4.bold("Behavior:")}
  Default: interactive wizard for exposed providers, discovery id masking (for
  Claude Desktop / Cowork), optional favorites-only catalog, then listen mode.
  --vertex: Anthropic-compatible gateway to Claude on Google Vertex AI using
  local gcloud Application Default Credentials (no OpenCode API key).
  Binds to port 17645. Network mode asks for a server password.

${pc4.bold("Vertex env:")}
  ANTHROPIC_VERTEX_PROJECT_ID or GOOGLE_CLOUD_PROJECT \u2014 your GCP project
  GOOGLE_CLOUD_LOCATION or CLOUD_ML_REGION \u2014 region (default: global)
  Optional catalog: ~/.relay-ai/vertex-models.json (see vertex-models.example.json)

${pc4.bold("Endpoints:")}
  Anthropic-compatible:  ANTHROPIC_BASE_URL=http://127.0.0.1:17645/anthropic
  OpenAI-compatible:     OPENAI_BASE_URL=http://127.0.0.1:17645/openai/v1
  API key: use anything locally; use the server password in network mode.`;
}
function modelsHelpText() {
  return `${pc4.bold("relay-ai models")} v${VERSION}
Manage favorite models for mid-session switching in Claude Code.

${pc4.bold("Usage:")}
  relay-ai models
  relay-ai models --help
  relay-ai models --version

${pc4.bold("Behavior:")}
  Opens an interactive manager to add or remove favorites.
  Pick from Zen, Go, or any configured local OpenCode provider.
  Favorites are saved to ~/.relay-ai/config.json (max ${MAX_MODEL_CATALOG}).

${pc4.bold("How it works:")}
  When favorites exist, relay-ai claude starts a multi-route catalog proxy.
  Claude Code /model lists your starting model plus favorites \u2014 switch live
  without restarting. Mix cloud and local favorites in one session.
  With no favorites, launch uses a single model as before.

${pc4.bold("Examples:")}
  relay-ai models
  relay-ai claude    # switch menu active when favorites are set`;
}
function printHelp(text3) {
  console.log(`
${text3}
`);
}
async function launchClaudeViaCatalog(catalogRoutes, startingRoute, contextWindow, trace, claudeArgs) {
  let proxyHandle;
  try {
    proxyHandle = await startProxyCatalog(catalogRoutes, startingRoute.aliasId, trace);
    p5.log.info(
      `Switch menu active \u2014 proxy on port ${proxyHandle.port} ` + pc4.dim(`(${catalogRoutes.length} model${catalogRoutes.length !== 1 ? "s" : ""} in /model)`)
    );
  } catch (err) {
    p5.log.error(`Failed to start proxy: ${err instanceof Error ? err.message : String(err)}`);
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
  const debugLogPath = join7(tmpdir(), "relay-ai-debug.log");
  const traceArgs = trace ? ["--debug-file", debugLogPath] : [];
  if (trace) p5.log.info(`Debug log: ${debugLogPath}`);
  const exitCode = await launchClaude(childEnv, startingRoute.aliasId, [...traceArgs, ...claudeArgs]);
  proxyHandle.close();
  if (trace) printTraceLog(debugLogPath);
  return exitCode;
}
function printTraceLog(debugLogPath) {
  if (!existsSync5(debugLogPath)) return;
  const log5 = readFileSync4(debugLogPath, "utf8");
  const errorLines = log5.split("\n").filter(
    (l) => l.includes("error") || l.includes("Error") || l.includes('"type":"error"') || l.includes("status")
  );
  console.log("\n" + pc4.bold(pc4.cyan("\u2500\u2500 Debug trace \u2500\u2500")));
  if (errorLines.length > 0) {
    errorLines.slice(0, 30).forEach((l) => console.log(pc4.dim(l)));
  } else {
    console.log(pc4.dim("(no errors found in debug log)"));
  }
  console.log(pc4.dim(`Full log: ${debugLogPath}`));
}
function printDryRun(backendName, modelId, baseUrl, modelFormat, claudeArgs, conflicts, disableExperimentalBetas, npm) {
  console.log("");
  console.log(pc4.bold(pc4.cyan("  DRY RUN \u2014 would execute:")));
  console.log("");
  const claudeCmd = ["claude", "--model", modelId, ...claudeArgs].join(" ");
  console.log(`  ${pc4.bold("Command:")}  ${claudeCmd}`);
  console.log(`  ${pc4.bold("Backend:")}  ${backendName}`);
  if (modelFormat === "openai") {
    console.log(`  ${pc4.bold("Proxy:")}    would start local SDK adapter proxy ${pc4.dim("(Vercel AI SDK)")}`);
    if (npm) console.log(`             ${pc4.dim(`npm: ${npm}`)}`);
  }
  console.log("");
  console.log(`  ${pc4.bold("Env vars SET:")}`);
  if (modelFormat === "openai") {
    console.log(`    ANTHROPIC_BASE_URL=http://127.0.0.1:<port>  ${pc4.dim("(local proxy)")}`);
  } else {
    console.log(`    ANTHROPIC_BASE_URL=${baseUrl}`);
  }
  console.log(`    ANTHROPIC_API_KEY=<your OPENCODE_API_KEY>`);
  console.log(`    ANTHROPIC_MODEL=${modelId}`);
  if (disableExperimentalBetas) {
    console.log(`    CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1  ${pc4.dim("(direct upstream \u2014 strips beta headers)")}`);
  } else {
    console.log(`    ${pc4.dim("(experimental betas enabled \u2014 tool search via local proxy)")}`);
  }
  console.log(`    ENABLE_TOOL_SEARCH=true  ${pc4.dim("(defer MCP tools like native Claude Code)")}`);
  console.log(`    CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT=0  ${pc4.dim("(keep full system prompt on proxy routes)")}`);
  console.log("");
  if (conflicts.length > 0) {
    console.log(`  ${pc4.bold("Env vars REMOVED:")}`);
    for (const c of conflicts) {
      console.log(`    ${pc4.dim(c.name)}=${pc4.dim(c.value)}`);
    }
    console.log("");
  }
  console.log(pc4.dim("  (dry run complete \u2014 Claude Code was NOT launched)"));
  console.log("");
}
function detectShellProfile() {
  const shell = process.env["SHELL"] ?? "";
  if (process.platform === "darwin") {
    if (shell.includes("zsh")) return { display: "~/.zshrc", path: `${homedir6()}/.zshrc` };
    if (shell.includes("bash")) return { display: "~/.bash_profile", path: `${homedir6()}/.bash_profile` };
    return { display: "~/.profile", path: `${homedir6()}/.profile` };
  }
  if (process.platform === "linux") {
    if (shell.includes("zsh")) return { display: "~/.zshrc", path: `${homedir6()}/.zshrc` };
    if (shell.includes("bash")) return { display: "~/.bashrc", path: `${homedir6()}/.bashrc` };
    return { display: "~/.profile", path: `${homedir6()}/.profile` };
  }
  if (shell.includes("bash")) return { display: "~/.bashrc", path: `${homedir6()}/.bashrc` };
  return { display: "~/.profile", path: `${homedir6()}/.profile` };
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
    p5.note(
      "Running in dry-run mode \u2014 no keys will be read from or written to your system.",
      "Simulating first-run onboarding"
    );
  }
  if (!simulate) {
    const keyDiag = (reason) => {
      p5.log.warn(`Credential store unavailable \u2014 ${reason}`);
      if (trace) {
        try {
          appendFileSync2(
            join7(tmpdir(), "relay-ai-debug.log"),
            `${(/* @__PURE__ */ new Date()).toISOString()} keyring: ${reason}
`
          );
        } catch {
        }
      }
    };
    const storedKey = await readFromCredentialStore(keyDiag);
    if (storedKey) {
      const storeName = isMac ? "macOS Keychain" : isWindows3 ? "Windows Credential Manager" : "Secret Service";
      p5.log.success(`Found key in ${storeName}`);
      process.env["OPENCODE_API_KEY"] = storedKey;
      return storedKey;
    }
  }
  p5.note("Get your free key at: https://opencode.ai/auth", "OpenCode API key");
  const key = await p5.password({
    message: "Paste your OPENCODE_API_KEY:",
    validate: (val) => val.trim() ? void 0 : "Key cannot be empty"
  });
  if (p5.isCancel(key)) {
    p5.cancel("Cancelled.");
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
        {
          value: "keychain",
          label: "Keychain only",
          hint: "Key stored encrypted in Keychain; relay-ai reads it automatically next time"
        },
        {
          value: "keychain-autoload",
          label: `Keychain + ${display} auto-load`,
          hint: `Key in Keychain; ${display} also exports it so all terminal tools can see it`
        },
        {
          value: "profile",
          label: `${display} only (plaintext)`,
          hint: "Key written directly to your shell profile \u2014 simpler but less secure"
        },
        {
          value: "session",
          label: "This session only",
          hint: "Not saved anywhere \u2014 you'll be asked again next time"
        }
      ];
    }
    if (isWindows3) {
      return [
        {
          value: "credential-manager",
          label: "Windows Credential Manager",
          hint: "Key stored securely; relay-ai reads it automatically next time"
        },
        {
          value: "setx",
          label: "Persistent environment variable (plaintext)",
          hint: "Runs setx \u2014 key visible in System Properties \u2192 Environment Variables"
        },
        {
          value: "session",
          label: "This session only",
          hint: "Not saved anywhere \u2014 you'll be asked again next time"
        }
      ];
    }
    const opts = [];
    if (secretServiceAvailable) {
      opts.push({
        value: "secret-service",
        label: "Secret Service (GNOME Keyring / KWallet)",
        hint: "Key stored securely in your desktop keyring; relay-ai reads it automatically next time"
      });
    } else if (!simulate) {
      p5.log.info("No keyring daemon detected \u2014 secure storage requires GNOME Keyring or KWallet running.");
    }
    opts.push(
      {
        value: "profile",
        label: `${display} (plaintext)`,
        hint: "Key written directly to your shell profile"
      },
      {
        value: "session",
        label: "This session only",
        hint: "Not saved anywhere \u2014 you'll be asked again next time"
      }
    );
    return opts;
  })();
  const saveChoice = await p5.select({
    message: "Where should we save the key?",
    options: saveOptions,
    initialValue: isMac ? "keychain" : isWindows3 ? "credential-manager" : secretServiceAvailable ? "secret-service" : "profile"
  });
  if (p5.isCancel(saveChoice)) {
    p5.cancel("Cancelled.");
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
    p5.log.info(`[dry-run] ${dryRunMessages[saveChoice]}`);
  } else if (saveChoice === "keychain") {
    if (await saveToCredentialStore(trimmedKey)) {
      p5.log.success("Key saved to macOS Keychain \u2014 active now and automatically loaded next time.");
    } else {
      p5.log.warn("Could not write to Keychain \u2014 key will be used for this session only");
    }
  } else if (saveChoice === "keychain-autoload") {
    if (await saveToCredentialStore(trimmedKey)) {
      try {
        const autoLoadLine = `export OPENCODE_API_KEY="$(security find-generic-password -s relay-ai -a relay-ai -w 2>/dev/null)"`;
        const existing = existsSync5(path) ? readFileSync4(path, "utf8") : "";
        if (!existing.includes(autoLoadLine)) {
          appendFileSync2(path, `
# relay-ai: load API key from macOS Keychain
${autoLoadLine}
`);
        }
        p5.log.success(`Key saved to Keychain and auto-load added to ${display} \u2014 active now and in all future terminals.`);
      } catch {
        p5.log.success("Key saved to Keychain \u2014 active now and automatically loaded next time.");
        p5.log.warn(`Could not write auto-load line to ${display}`);
      }
    } else {
      p5.log.warn("Could not write to Keychain \u2014 key will be used for this session only");
    }
  } else if (saveChoice === "credential-manager") {
    if (await saveToCredentialStore(trimmedKey)) {
      p5.log.success("Key saved to Windows Credential Manager \u2014 active now and automatically loaded next time.");
    } else {
      p5.log.warn("Could not write to Credential Manager \u2014 key will be used for this session only");
    }
  } else if (saveChoice === "setx") {
    try {
      const result = spawnSync("setx", ["OPENCODE_API_KEY", trimmedKey], { stdio: ["pipe", "pipe", "pipe"] });
      if (result.status !== 0) throw new Error("setx exited with non-zero status");
      p5.log.success("Key saved as a user environment variable \u2014 active now and in all future terminals.");
    } catch {
      p5.log.warn("Could not run setx \u2014 key will be used for this session only");
    }
  } else if (saveChoice === "secret-service") {
    if (await saveToCredentialStore(trimmedKey)) {
      p5.log.success("Key saved to Secret Service \u2014 active now and automatically loaded next time.");
    } else {
      p5.log.warn("Could not write to Secret Service \u2014 key will be used for this session only");
    }
  } else if (saveChoice === "profile") {
    try {
      if (!existsSync5(path)) appendFileSync2(path, "");
      const escapedKey = trimmedKey.replace(/'/g, "'\\''");
      appendFileSync2(path, `
export OPENCODE_API_KEY='${escapedKey}'
`);
      p5.log.success(`Key saved to ${display} \u2014 active now and in all future terminals.`);
    } catch {
      p5.log.warn(`Could not write to ${display} \u2014 key will be used for this session only`);
    }
  }
  if (!simulate) process.env["OPENCODE_API_KEY"] = trimmedKey;
  return trimmedKey;
}
async function runModelsCommand() {
  p5.intro(pc4.bold("  Relay AI \u2014 Favorite Models"));
  const spinner3 = p5.spinner();
  spinner3.start("Loading providers...");
  const catalog = await fetchProviderCatalog();
  spinner3.stop("");
  const allProviders = providersForPicker(catalog);
  if (allProviders.length === 0) {
    p5.log.warn("No providers found.");
    p5.log.info("OpenCode Zen/Go is always available. Local providers appear when OpenCode is running.");
    p5.outro("Done.");
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
      const label = entry ? `\u2605 ${entry.modelName} (${entry.providerName})` : pc4.dim(`\u2605 ${fav.modelId} \u2014 provider gone`);
      options.push({ value: `fav-${i}`, label, hint: "select to remove" });
    }
    const atCap = favorites.length >= MAX_MODEL_CATALOG;
    options.push({
      value: "__add__",
      label: atCap ? pc4.dim(`+ Add a model \u2192 (limit of ${MAX_MODEL_CATALOG} reached)`) : "+ Add a model \u2192",
      hint: atCap ? "Remove a favorite first to make room" : `${allProviders.length} provider${allProviders.length !== 1 ? "s" : ""} available`
    });
    options.push({ value: "__done__", label: "Done", hint: "" });
    const header = favorites.length === 0 ? `Favorites (0/${MAX_MODEL_CATALOG})` : `Favorites (${favorites.length}/${MAX_MODEL_CATALOG}) \u2014 select to remove`;
    const choice = await p5.select({
      message: header,
      options,
      initialValue: "__done__"
    });
    if (p5.isCancel(choice) || choice === "__done__") break;
    if (choice === "__add__") {
      if (atCap) {
        p5.log.warn(`Limit of ${MAX_MODEL_CATALOG} favorites reached \u2014 remove one first.`);
        continue;
      }
      const providerOptions = allProviders.map((ap) => ({
        value: ap.id,
        label: ap.name,
        hint: `${ap.models.length} model${ap.models.length !== 1 ? "s" : ""}`
      }));
      const pickedProviderId = await p5.select({
        message: "Which provider?",
        options: providerOptions
      });
      if (p5.isCancel(pickedProviderId)) continue;
      const provider = allProviders.find((ap) => ap.id === pickedProviderId);
      const browsed = await browseAllModels(provider, prefs);
      if (!browsed) continue;
      const fav = { providerId: provider.id, modelId: browsed.id };
      const result = addFavorite(favorites, fav);
      if (!result.ok) {
        if (result.reason === "duplicate") {
          p5.log.warn(`${browsed.name || browsed.id} is already in your favorites.`);
        } else {
          p5.log.warn(`Limit of ${MAX_MODEL_CATALOG} favorites reached \u2014 remove one first.`);
        }
        continue;
      }
      favorites = result.list;
      favoritesDirty = true;
      p5.log.success(`Added ${browsed.name || browsed.id} (${provider.name}) to favorites.`);
    } else if (choice.startsWith("fav-")) {
      const idx = parseInt(choice.slice(4), 10);
      const fav = favorites[idx];
      const entry = modelLookup.get(`${fav.providerId}:${fav.modelId}`);
      const label = entry ? `${entry.modelName} (${entry.providerName})` : fav.modelId;
      favorites = removeFavorite(favorites, fav);
      favoritesDirty = true;
      p5.log.success(`Removed ${label} from favorites.`);
    }
  }
  if (favoritesDirty) {
    savePreferences({ favoriteModels: favorites });
  }
  p5.outro(
    favorites.length === 0 ? "No favorites saved \u2014 launch will use single-model mode." : pc4.green(`${favorites.length} favorite${favorites.length !== 1 ? "s" : ""} saved \u2014 /model menu will show these on next launch.`)
  );
  return 0;
}
async function runClaudeCommand(parsed) {
  const { dryRun, setup, trace, claudeArgs } = parsed;
  const claudePath = findClaudeBinary();
  if (!claudePath) {
    console.error(pc4.red("\nError: claude binary not found on PATH.\n"));
    console.error("Install Claude Code:");
    console.error("  npm install -g @anthropic-ai/claude-code\n");
    return 1;
  }
  const prefs = dryRun ? {} : loadPreferences();
  const conflicts = detectConflicts();
  const favorites = dryRun ? [] : prefs.favoriteModels ?? [];
  const switchMenuActive = favorites.length > 0;
  const hasZenGoFavorites = favorites.some((f) => f.providerId === "zen" || f.providerId === "go");
  p5.intro(pc4.bold("  Relay AI"));
  let earlyEffectiveKey = null;
  let earlyZenModels = [];
  let earlyGoModels = [];
  if (switchMenuActive && hasZenGoFavorites && !dryRun) {
    const apiKey2 = await resolveOrCollectApiKey(false, trace);
    if (!apiKey2) return 0;
    earlyEffectiveKey = apiKey2;
    const zenGoSpinner = p5.spinner();
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
      p5.log.warn(`Could not fetch OpenCode models (${detail}) \u2014 Zen/Go favorites will be skipped from /model catalog`);
    }
  }
  const providerSpinner = p5.spinner();
  providerSpinner.start("Checking for local providers...");
  const localProviders = await fetchLocalProviders();
  providerSpinner.stop("");
  if (localProviders === null) {
    p5.log.info(pc4.dim("Tip: Install OpenCode locally to unlock additional providers"));
  }
  let providerChoice = "opencode";
  if (localProviders !== null && localProviders.length > 0) {
    const providerOptions = [
      { value: "opencode", label: "OpenCode (Zen / Go)", hint: "Cloud API \u2014 requires OpenCode subscription" },
      ...localProviders.map((lp) => ({
        value: lp.id,
        label: lp.name,
        hint: `${lp.models.length} model${lp.models.length !== 1 ? "s" : ""} available`
      }))
    ];
    const initialProvider = prefs.lastProvider && providerOptions.some((o) => o.value === prefs.lastProvider) ? prefs.lastProvider : "opencode";
    const chosen = await p5.select({
      message: "Which provider?",
      options: providerOptions,
      initialValue: initialProvider
    });
    if (p5.isCancel(chosen)) {
      p5.cancel("Cancelled.");
      return 0;
    }
    providerChoice = chosen;
  }
  if (providerChoice !== "opencode") {
    const provider = localProviders.find((lp) => lp.id === providerChoice);
    const selectedModel = await pickLocalModel(provider, conflicts, prefs);
    if (!selectedModel) return 0;
    if (!dryRun) {
      const prevRecent = prefs.recentModelsByProvider?.[provider.id] ?? [];
      const updatedRecent = [selectedModel.id, ...prevRecent.filter((id) => id !== selectedModel.id)].slice(0, 3);
      savePreferences({
        lastProvider: provider.id,
        lastModel: selectedModel.id,
        recentModelsByProvider: { ...prefs.recentModelsByProvider, [provider.id]: updatedRecent }
      });
    }
    if (switchMenuActive) {
      const resolveRoute = makeRouteResolver(
        localProviders,
        earlyZenModels,
        earlyGoModels,
        earlyEffectiveKey
      );
      const startingRoute = localModelToRoute(provider, selectedModel);
      if (!startingRoute) {
        p5.log.error("Could not resolve a proxy route for the selected model.");
        return 1;
      }
      const catalogRoutes = buildCatalogRoutes(startingRoute, favorites, resolveRoute);
      if (dryRun) {
        const endpoint = selectedModel.baseUrl ?? selectedModel.completionsUrl ?? "(unknown)";
        console.log("");
        console.log(pc4.bold(pc4.cyan("  DRY RUN \u2014 would execute (switch-menu mode):")));
        console.log("");
        console.log(`  ${pc4.bold("Provider:")}      ${provider.name}`);
        console.log(`  ${pc4.bold("Starting model:")} ${selectedModel.id}`);
        console.log(`  ${pc4.bold("Endpoint:")}      ${endpoint}`);
        console.log(`  ${pc4.bold("/model catalog:")} ${catalogRoutes.length} model(s)`);
        catalogRoutes.forEach((r) => console.log(`    ${pc4.dim(r.displayName)}`));
        console.log("");
        console.log(pc4.dim("  (dry run complete \u2014 Claude Code was NOT launched)"));
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
      const formatDesc = selectedModel.modelFormat === "anthropic" ? "direct passthrough" : "via SDK adapter proxy";
      const endpoint = selectedModel.modelFormat === "anthropic" ? selectedModel.baseUrl ?? "(unknown)" : selectedModel.npm ?? "SDK";
      console.log("");
      console.log(pc4.bold(pc4.cyan("  DRY RUN \u2014 would execute:")));
      console.log("");
      console.log(`  ${pc4.bold("Provider:")}  ${provider.name}`);
      console.log(`  ${pc4.bold("Model:")}     ${selectedModel.id}`);
      console.log(`  ${pc4.bold("Format:")}    ${selectedModel.modelFormat} (${formatDesc})`);
      console.log(`  ${pc4.bold(selectedModel.modelFormat === "anthropic" ? "Endpoint:" : "SDK npm:")} ${endpoint}`);
      console.log(`  ${pc4.bold("Key:")}       ${provider.id} provider key`);
      console.log("");
      console.log(pc4.dim("  (dry run complete \u2014 Claude Code was NOT launched)"));
      console.log("");
      return 0;
    }
    let proxyHandle2 = null;
    let childEnv2;
    if (selectedModel.modelFormat === "anthropic") {
      childEnv2 = buildChildEnv(
        selectedModel.baseUrl,
        selectedModel.id,
        provider.apiKey,
        void 0,
        selectedModel.contextWindow
      );
    } else {
      try {
        proxyHandle2 = await startProxy(
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
        p5.log.info(
          `SDK adapter proxy started on port ${proxyHandle2.port}` + (selectedModel.npm ? pc4.dim(` (${selectedModel.npm})`) : "")
        );
      } catch (err) {
        p5.log.error(`Failed to start SDK adapter proxy: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
      }
      childEnv2 = buildChildEnv(
        `http://127.0.0.1:${proxyHandle2.port}`,
        selectedModel.id,
        provider.apiKey,
        proxyHandle2.port,
        selectedModel.contextWindow
      );
    }
    if (selectedModel.modelFormat === "anthropic") {
      childEnv2["CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS"] = "1";
    }
    const debugLogPath2 = join7(tmpdir(), "relay-ai-debug.log");
    const traceArgs2 = trace ? ["--debug-file", debugLogPath2] : [];
    if (trace) p5.log.info(`Debug log: ${debugLogPath2}`);
    const exitCode2 = await launchClaude(childEnv2, selectedModel.id, [...traceArgs2, ...claudeArgs]);
    proxyHandle2?.close();
    if (trace) printTraceLog(debugLogPath2);
    return exitCode2;
  }
  const apiKey = earlyEffectiveKey ?? await resolveOrCollectApiKey(dryRun, trace);
  if (!apiKey && !dryRun) return 1;
  const effectiveKey = apiKey ?? "dry-run-placeholder";
  let tier = dryRun ? null : getSubscriptionTier();
  if (!tier || setup) {
    tier = await askSubscriptionTier();
    if (!tier) return 1;
    if (!dryRun) setSubscriptionTier(tier);
  }
  const needsZen = tier === "free" || tier === "zen" || tier === "go" || tier === "both";
  const needsGo = tier === "go" || tier === "both";
  const spinner3 = p5.spinner();
  spinner3.start("Fetching available models...");
  let zenModels = earlyZenModels;
  let goModels = earlyGoModels;
  const fetchZen = needsZen && zenModels.length === 0;
  const fetchGo = needsGo && goModels.length === 0;
  try {
    if (fetchZen || fetchGo) {
      const backends = [];
      if (fetchZen) backends.push("zen");
      if (fetchGo) backends.push("go");
      const fetched = await fetchZenGoModels(backends, !dryRun);
      if (fetchZen) zenModels = fetched.zenModels;
      if (fetchGo) goModels = fetched.goModels;
    }
    spinner3.stop(`Loaded ${zenModels.length + goModels.length} models`);
  } catch (err) {
    spinner3.stop(pc4.red("Failed to load models"));
    console.error(pc4.red(String(err instanceof Error ? err.message : err)));
    return 1;
  }
  const selection = await runWizard(prefs, { zen: zenModels, go: goModels }, conflicts, tier);
  if (!selection) return 0;
  if (!dryRun) savePreferences({ lastBackend: selection.backend.id, lastModel: selection.model.id, lastProvider: "opencode" });
  if (switchMenuActive && !dryRun) {
    const resolveRoute = makeRouteResolver(localProviders, earlyZenModels, earlyGoModels, effectiveKey);
    const startingRoute = zenGoModelToRoute(selection.model, effectiveKey);
    if (!startingRoute) {
      p5.log.error("Could not resolve a proxy route for the selected model.");
      return 1;
    }
    const catalogRoutes = buildCatalogRoutes(startingRoute, favorites, resolveRoute);
    return launchClaudeViaCatalog(
      catalogRoutes,
      startingRoute,
      selection.model.contextWindow,
      trace,
      claudeArgs
    );
  }
  const disableExperimentalBetas = selection.model.modelFormat !== "openai";
  if (dryRun) {
    printDryRun(
      selection.backend.name,
      selection.model.id,
      selection.backend.baseUrl,
      selection.model.modelFormat,
      claudeArgs,
      conflicts,
      disableExperimentalBetas,
      selection.model.modelFormat === "openai" ? "@ai-sdk/openai-compatible" : void 0
    );
    return 0;
  }
  let proxyHandle = null;
  if (selection.model.modelFormat === "openai") {
    try {
      proxyHandle = await startProxy(
        `${selection.backend.baseUrl}/v1/chat/completions`,
        selection.model.id,
        trace,
        selection.model.contextWindow,
        { npm: "@ai-sdk/openai-compatible", baseURL: `${selection.backend.baseUrl}/v1` }
      );
      p5.log.info(
        `Translation proxy started on port ${proxyHandle.port} ` + pc4.dim(`(${selection.backend.baseUrl}/v1/chat/completions)`)
      );
    } catch (err) {
      p5.log.error(`Failed to start translation proxy: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
  }
  const childEnv = buildChildEnv(
    selection.backend.baseUrl,
    selection.model.id,
    effectiveKey,
    proxyHandle?.port,
    selection.model.contextWindow
  );
  if (disableExperimentalBetas) {
    childEnv["CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS"] = "1";
  }
  const debugLogPath = join7(tmpdir(), "relay-ai-debug.log");
  const traceArgs = trace ? ["--debug-file", debugLogPath] : [];
  if (trace) {
    p5.log.info(`Debug log: ${debugLogPath}`);
  }
  const exitCode = await launchClaude(childEnv, selection.model.id, [...traceArgs, ...claudeArgs]);
  if (proxyHandle) {
    proxyHandle.close();
  }
  if (trace) printTraceLog(debugLogPath);
  return exitCode;
}
async function main(args = process.argv.slice(2)) {
  const parsed = parseArgs(args);
  if (parsed.error) {
    console.error(pc4.red(`
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
    console.error(pc4.red("\nUnexpected error:"), err);
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