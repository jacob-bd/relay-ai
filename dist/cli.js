#!/usr/bin/env node

// src/cli.ts
import pc3 from "picocolors";
import * as p4 from "@clack/prompts";
import { appendFileSync as appendFileSync2, readFileSync as readFileSync3, existsSync as existsSync4, realpathSync } from "fs";
import { homedir as homedir5, tmpdir } from "os";
import { join as join5 } from "path";
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
var MAX_MODEL_CATALOG = 10;
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
var VERSION = "0.3.0";

// src/context-window.ts
import { readFileSync } from "fs";
var DEFAULT_CONTEXT_WINDOW = 2e5;
var CACHE_PROVIDER_PRIORITY = /* @__PURE__ */ new Set(["opencode", "opencode-go"]);
var HEURISTIC_RULES = [
  [/gemini-2\.5-pro|gemini-1\.5-pro|gemini-3-pro/i, 2e6],
  [/gemini/i, 1e6],
  [/claude-opus-4-[678]|claude-sonnet-4-[678]|claude-haiku-4-[567]/i, 1e6],
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
  return key?.trim() || null;
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
async function readFromCredentialStore(diag) {
  try {
    const { Entry } = await import("@napi-rs/keyring");
    return new Entry("opencode-starter", "opencode-starter").getPassword() ?? null;
  } catch (err) {
    diag?.(classifyKeyringError(err));
    return null;
  }
}
async function saveToCredentialStore(key, diag) {
  try {
    const { Entry } = await import("@napi-rs/keyring");
    new Entry("opencode-starter", "opencode-starter").setPassword(key);
    return true;
  } catch (err) {
    diag?.(classifyKeyringError(err));
    return false;
  }
}
async function isSecretServiceAvailable() {
  try {
    const { Entry } = await import("@napi-rs/keyring");
    new Entry("opencode-starter-probe", "probe").getPassword();
    return true;
  } catch {
    return false;
  }
}

// src/proxy.ts
import { createServer } from "http";
import { Readable as Readable4 } from "stream";
import { appendFileSync } from "fs";

// src/proxy-gemini.ts
import { Readable } from "stream";

// src/gemini-schema.ts
var UNSUPPORTED_CONSTRAINTS = [
  "minLength",
  "maxLength",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "pattern",
  "minItems",
  "maxItems",
  "uniqueItems",
  "format",
  "default",
  "examples"
];
var UNSUPPORTED_KEYWORDS = [
  ...UNSUPPORTED_CONSTRAINTS,
  "$schema",
  "$defs",
  "definitions",
  "const",
  "$ref",
  "$id",
  "additionalProperties",
  "propertyNames",
  "patternProperties",
  "enumTitles",
  "prefill",
  "deprecated"
];
var GEMINI_REMOVE_KEYWORDS = /* @__PURE__ */ new Set([...UNSUPPORTED_KEYWORDS, "nullable", "title"]);

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

// src/proxy-shared.ts
var TOOL_USE_SIG_SEP = "::ts::";
function parseToolArguments(value) {
  if (value === null || value === void 0) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string") {
    if (!value) return {};
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
    }
  }
  return {};
}
function sseChunk(eventType, data) {
  return `event: ${eventType}
data: ${JSON.stringify(data)}

`;
}
function extractSseDataPayload(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(":")) return null;
  if (trimmed.startsWith("data:")) {
    const payload = trimmed.slice(5).trimStart();
    if (!payload || payload === "[DONE]") return null;
    return payload;
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;
  return null;
}
function splitToolUseId(id) {
  const sep = id.indexOf(TOOL_USE_SIG_SEP);
  if (sep === -1) return { rawId: id };
  return {
    rawId: id.slice(0, sep),
    thoughtSignature: id.slice(sep + TOOL_USE_SIG_SEP.length)
  };
}
function encodeToolUseId(rawId, thoughtSignature) {
  return thoughtSignature ? `${rawId}${TOOL_USE_SIG_SEP}${thoughtSignature}` : rawId;
}
function stripToolUseIdSuffix(toolUseId) {
  return splitToolUseId(toolUseId).rawId;
}
function serializeToolResultContent(content) {
  return typeof content === "string" ? content : JSON.stringify(content);
}
function attachSseLineReader(upstream, onLine, onDone) {
  const decoder = new TextDecoder();
  let buffer = "";
  const flushRemainder = () => {
    const trimmed = buffer.trim();
    if (trimmed) onLine(trimmed);
    buffer = "";
  };
  upstream.on("data", (chunk) => {
    buffer += decoder.decode(chunk, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      onLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  });
  upstream.on("end", () => {
    flushRemainder();
    onDone();
  });
  upstream.on("error", () => onDone());
}

// src/proxy-gemini.ts
var GEMINI_SKIP_THOUGHT_SIGNATURE = "skip_thought_signature_validator";

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
function createModelCatalog(models) {
  const byId = new Map(models.map((model) => [model.id, model]));
  return {
    get: (id) => byId.get(id),
    list: () => [...models]
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
function formatAnthropicModels(models) {
  return formatAnthropicModelList(
    models.map((model) => ({ id: model.id, name: model.name, contextWindow: model.contextWindow }))
  );
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
import { Readable as Readable2 } from "stream";
function anthropicUpstreamHeaders(apiKey, stream = false) {
  return {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
    Authorization: `Bearer ${apiKey}`,
    "x-api-key": apiKey,
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
    Readable2.fromWeb(upstreamRes.body).pipe(res);
    return;
  }
  const json = await upstreamRes.json();
  const payload = JSON.stringify(json);
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload).toString()
  });
  res.end(payload);
}

// src/mistral-messages.ts
var MISTRAL_MODEL_PATTERN = /mistral|ministral|devstral|pixtral/i;
function isMistralUpstream(completionsUrl, modelId) {
  if (completionsUrl?.includes("api.mistral.ai")) return true;
  if (modelId && MISTRAL_MODEL_PATTERN.test(modelId)) return true;
  return false;
}
function systemContent(msg) {
  if (typeof msg.content === "string") return msg.content;
  if (msg.content === null || msg.content === void 0) return "";
  return JSON.stringify(msg.content);
}
function normalizeMistralMessages(messages) {
  const systemParts = [];
  const body = [];
  let hoistedSystemBlocks = 0;
  for (const msg of messages) {
    if (msg.role === "system") {
      const text3 = systemContent(msg).trim();
      if (text3) systemParts.push(text3);
      hoistedSystemBlocks++;
      continue;
    }
    body.push(msg);
  }
  const merged = [];
  if (systemParts.length > 0) {
    merged.push({ role: "system", content: systemParts.join("\n\n") });
  }
  let insertedAssistantFillers = 0;
  for (let i = 0; i < body.length; i++) {
    merged.push(body[i]);
    const curr = body[i];
    const next = body[i + 1];
    if (curr.role === "tool" && next?.role === "user") {
      merged.push({ role: "assistant", content: "" });
      insertedAssistantFillers++;
    }
  }
  return { messages: merged, hoistedSystemBlocks, insertedAssistantFillers };
}

// src/provider-factory.ts
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createMistral } from "@ai-sdk/mistral";
import { createXai } from "@ai-sdk/xai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

// src/proxy-responses.ts
import { Readable as Readable3 } from "stream";
var RESPONSES_ONLY_PREFIXES = [
  "gpt-5.4",
  "gpt-5.5",
  "gpt-5-codex",
  "gpt-5-pro",
  "gpt-5.2-pro",
  "o3",
  "o4"
];
function isOpenAIChatCompletionsUrl(url) {
  return (url.includes("api.openai.com") || url.includes("api.x.ai")) && url.includes("/chat/completions");
}
function openAIResponsesUrl(completionsUrl) {
  return completionsUrl.replace(/\/chat\/completions\/?$/, "/responses");
}
function modelPrefersResponsesApi(modelId) {
  const lower = modelId.toLowerCase();
  if (RESPONSES_ONLY_PREFIXES.some((prefix) => lower === prefix || lower.startsWith(`${prefix}-`))) {
    return true;
  }
  if (lower.startsWith("gpt-") && lower.includes("-codex")) return true;
  if (lower.startsWith("grok-") && (lower.includes("multi-agent") || lower.includes("multiagent"))) return true;
  return false;
}
function translateImagePart(part) {
  const src = part.source;
  if (src.type === "url") {
    return { type: "input_image", image_url: src.url };
  }
  if (src.type === "base64") {
    return { type: "input_image", image_url: `data:${src.media_type};base64,${src.data}` };
  }
  return null;
}
function userContentParts(parts) {
  const out = [];
  let text3 = "";
  for (const part of parts) {
    if (part.type === "text") {
      text3 += (typeof part.text === "string" ? part.text : JSON.stringify(part.text)) + "\n";
    } else if (part.type === "image") {
      const img = translateImagePart(part);
      if (img) out.push(img);
    }
  }
  const trimmed = text3.trim();
  if (out.length === 0) return trimmed;
  if (trimmed) out.unshift({ type: "input_text", text: trimmed });
  return out;
}
function anthropicMessagesToResponsesInput(messages) {
  const input = [];
  for (const msg of messages ?? []) {
    if (typeof msg.content === "string") {
      if (msg.role === "user") {
        input.push({ role: "user", content: msg.content });
      } else {
        input.push({ role: "assistant", content: msg.content });
      }
      continue;
    }
    if (msg.role === "assistant") {
      let text3 = "";
      const toolCalls = [];
      for (const part of msg.content ?? []) {
        if (part.type === "text") {
          text3 += (typeof part.text === "string" ? part.text : JSON.stringify(part.text)) + "\n";
        } else if (part.type === "tool_use") {
          const { rawId } = splitToolUseId(part.id);
          toolCalls.push({
            type: "function_call",
            call_id: rawId,
            name: part.name,
            arguments: JSON.stringify(part.input ?? {})
          });
        }
      }
      const trimmed = text3.trim();
      if (trimmed) input.push({ role: "assistant", content: trimmed });
      input.push(...toolCalls);
      continue;
    }
    if (msg.role === "user") {
      const toolResults = [];
      const nonToolParts = [];
      for (const part of msg.content ?? []) {
        if (part.type === "tool_result") {
          toolResults.push({
            type: "function_call_output",
            call_id: stripToolUseIdSuffix(part.tool_use_id),
            output: serializeToolResultContent(part.content)
          });
        } else {
          nonToolParts.push(part);
        }
      }
      if (nonToolParts.length > 0) {
        const content = userContentParts(nonToolParts);
        if (typeof content === "string" ? content : content.length > 0) {
          input.push({ role: "user", content });
        }
      }
      input.push(...toolResults);
    }
  }
  return input;
}
function buildInstructions(system) {
  if (!system) return void 0;
  if (typeof system === "string") return system;
  const text3 = system.map((s) => s.text).filter(Boolean).join("\n\n");
  return text3 || void 0;
}
function translateToResponses(body) {
  const { model, messages, system, temperature, max_tokens, top_p, stop_sequences, tools, stream } = body;
  const data = {
    model,
    input: anthropicMessagesToResponsesInput(messages)
  };
  const instructions = buildInstructions(system);
  if (instructions) data.instructions = instructions;
  if (max_tokens !== void 0) data.max_output_tokens = max_tokens;
  if (temperature !== void 0) data.temperature = temperature;
  if (top_p !== void 0) data.top_p = top_p;
  if (stop_sequences?.length) data.stop = stop_sequences;
  if (stream !== void 0) data.stream = stream;
  const upstreamTools = resolveUpstreamTools(tools, messages);
  if (upstreamTools.length > 0) {
    data.tools = upstreamTools.map((tool2) => ({
      type: "function",
      name: tool2.name,
      description: typeof tool2.description === "string" ? tool2.description : isToolSearchTool(tool2) ? "Search deferred tools by name or regex pattern" : void 0,
      parameters: tool2.input_schema ?? { type: "object", properties: {} }
    }));
    data.tool_choice = "auto";
  }
  return data;
}
function extractOutputText(output) {
  let text3 = "";
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const obj = item;
    if (obj.type === "message" && Array.isArray(obj.content)) {
      for (const part of obj.content) {
        if (part && typeof part === "object" && part.type === "output_text") {
          text3 += String(part.text ?? "");
        }
      }
    }
    if (obj.type === "output_text") {
      text3 += String(obj.text ?? "");
    }
  }
  return text3;
}
function extractFunctionCalls(output) {
  const blocks = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const obj = item;
    if (obj.type !== "function_call") continue;
    const callId = String(obj.call_id ?? obj.id ?? `call_${Date.now()}`);
    blocks.push({
      type: "tool_use",
      id: callId,
      name: String(obj.name ?? ""),
      input: parseToolArguments(obj.arguments)
    });
  }
  return blocks;
}
function translateFromResponses(response, model) {
  const messageId = "msg_" + Date.now();
  const output = Array.isArray(response.output) ? response.output : [];
  const content = [];
  const text3 = typeof response.output_text === "string" && response.output_text ? response.output_text : extractOutputText(output);
  if (text3) content.push({ type: "text", text: text3 });
  content.push(...extractFunctionCalls(output));
  const hasToolUse = content.some((b) => b.type === "tool_use");
  let stop_reason = "end_turn";
  if (hasToolUse) stop_reason = "tool_use";
  else if (response.status === "incomplete") stop_reason = "max_tokens";
  const usage = response.usage;
  return {
    id: messageId,
    type: "message",
    role: "assistant",
    content,
    stop_reason,
    stop_sequence: null,
    model,
    usage: {
      input_tokens: Number(usage?.input_tokens ?? 0),
      output_tokens: Number(usage?.output_tokens ?? 0),
      cache_read_input_tokens: Number(
        usage?.input_tokens_details?.cached_tokens ?? 0
      ),
      cache_creation_input_tokens: 0
    }
  };
}
function translateStreamResponses(upstreamBody, model) {
  const messageId = "msg_" + Date.now();
  let contentBlockIndex = -1;
  let hasStartedTextBlock = false;
  let messageStarted = false;
  let finishReason = null;
  let lastUsage = { input_tokens: 0, output_tokens: 0 };
  const toolState = /* @__PURE__ */ new Map();
  const output = new Readable3({ read() {
  } });
  function emitSSE(eventType, data) {
    output.push(sseChunk(eventType, data));
  }
  function emitMessageStart() {
    if (messageStarted) return;
    emitSSE("message_start", {
      type: "message_start",
      message: {
        id: messageId,
        type: "message",
        role: "assistant",
        content: [],
        model,
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 }
      }
    });
    messageStarted = true;
  }
  function flushToolCallStart(outputIndex) {
    const state = toolState.get(outputIndex);
    if (!state || state.emitted) return;
    emitSSE("content_block_start", {
      type: "content_block_start",
      index: state.blockIndex,
      content_block: { type: "tool_use", id: state.callId, name: state.name ?? "", input: {} }
    });
    state.emitted = true;
  }
  function closeCurrentBlock() {
    if (hasStartedTextBlock) {
      emitSSE("content_block_stop", { type: "content_block_stop", index: contentBlockIndex });
      hasStartedTextBlock = false;
    }
  }
  function processEvent(event) {
    const type = String(event.type ?? "");
    if (type === "response.completed") {
      const response = event.response;
      const usage = response?.usage;
      if (usage) {
        lastUsage = {
          input_tokens: Number(usage.input_tokens ?? 0),
          output_tokens: Number(usage.output_tokens ?? 0),
          cache_read_input_tokens: Number(
            usage.input_tokens_details?.cached_tokens ?? 0
          ),
          cache_creation_input_tokens: 0
        };
      }
      const outputItems = Array.isArray(response?.output) ? response.output : [];
      if (outputItems.some((item) => item && typeof item === "object" && item.type === "function_call")) {
        finishReason = "tool_calls";
      } else if (response?.status === "incomplete") {
        finishReason = "length";
      } else {
        finishReason = "stop";
      }
      return;
    }
    if (type === "response.output_text.delta") {
      const delta = String(event.delta ?? "");
      if (!delta) return;
      if (!hasStartedTextBlock) {
        closeCurrentBlock();
        contentBlockIndex++;
        emitMessageStart();
        emitSSE("content_block_start", {
          type: "content_block_start",
          index: contentBlockIndex,
          content_block: { type: "text", text: "" }
        });
        hasStartedTextBlock = true;
      }
      emitSSE("content_block_delta", {
        type: "content_block_delta",
        index: contentBlockIndex,
        delta: { type: "text_delta", text: delta }
      });
      return;
    }
    if (type === "response.output_item.added") {
      const item = event.item;
      if (item?.type !== "function_call") return;
      const outputIndex = Number(event.output_index ?? 0);
      closeCurrentBlock();
      contentBlockIndex++;
      emitMessageStart();
      toolState.set(outputIndex, {
        callId: String(item.call_id ?? item.id ?? `call_${Date.now()}`),
        name: typeof item.name === "string" ? item.name : void 0,
        blockIndex: contentBlockIndex,
        emitted: false
      });
      return;
    }
    if (type === "response.function_call_arguments.delta") {
      const outputIndex = Number(event.output_index ?? 0);
      flushToolCallStart(outputIndex);
      const delta = String(event.delta ?? "");
      if (delta) {
        emitSSE("content_block_delta", {
          type: "content_block_delta",
          index: contentBlockIndex,
          delta: { type: "input_json_delta", partial_json: delta }
        });
      }
      return;
    }
    if (type === "response.function_call_arguments.done") {
      const outputIndex = Number(event.output_index ?? 0);
      const state = toolState.get(outputIndex);
      if (state && typeof event.name === "string") state.name = event.name;
      flushToolCallStart(outputIndex);
    }
  }
  function processLine(line) {
    const data = extractSseDataPayload(line);
    if (!data) return;
    try {
      processEvent(JSON.parse(data));
    } catch {
    }
  }
  function finish() {
    closeCurrentBlock();
    for (const [outputIndex] of toolState) flushToolCallStart(outputIndex);
    for (const state of toolState.values()) {
      if (state.emitted) {
        emitSSE("content_block_stop", { type: "content_block_stop", index: state.blockIndex });
      }
    }
    emitMessageStart();
    let stopReason = "end_turn";
    if (finishReason === "tool_calls") stopReason = "tool_use";
    else if (finishReason === "length") stopReason = "max_tokens";
    emitSSE("message_delta", {
      type: "message_delta",
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: lastUsage
    });
    emitSSE("message_stop", { type: "message_stop" });
    output.push(null);
  }
  attachSseLineReader(upstreamBody, (line) => {
    if (line.trim()) processLine(line);
  }, finish);
  return output;
}

// src/provider-factory.ts
function isSdkMigratedNpm(npm) {
  return !!npm && SDK_NPM_PACKAGES.has(npm);
}
var SDK_NPM_PACKAGES = /* @__PURE__ */ new Set([
  "@ai-sdk/openai",
  "@ai-sdk/google",
  "@ai-sdk/groq",
  "@ai-sdk/mistral",
  "@ai-sdk/xai",
  "@ai-sdk/openai-compatible",
  "@openrouter/ai-sdk-provider"
]);
function createLanguageModel(spec) {
  const { npm, modelId, apiKey, baseURL } = spec;
  switch (npm) {
    case "@ai-sdk/openai": {
      const openai = createOpenAI({ apiKey });
      return modelPrefersResponsesApi(modelId) ? openai.responses(modelId) : openai.chat(modelId);
    }
    case "@ai-sdk/xai": {
      const xai = createXai({ apiKey });
      return modelPrefersResponsesApi(modelId) ? xai.responses(modelId) : xai(modelId);
    }
    case "@ai-sdk/google":
      return createGoogleGenerativeAI({ apiKey })(modelId);
    case "@ai-sdk/groq":
      return createGroq({ apiKey })(modelId);
    case "@ai-sdk/mistral":
      return createMistral({ apiKey })(modelId);
    case "@ai-sdk/openai-compatible":
      return createOpenAICompatible({
        name: spec.providerId ?? "openai-compatible",
        apiKey,
        baseURL: baseURL ?? ""
      })(modelId);
    case "@openrouter/ai-sdk-provider":
      return createOpenRouter({ apiKey, baseURL })(modelId);
    default:
      throw new Error(`No SDK provider for npm package: ${npm}`);
  }
}
function thinkingProviderOptions(npm) {
  if (npm === "@ai-sdk/google") {
    return { google: { thinkingConfig: { includeThoughts: true } } };
  }
  return void 0;
}

// src/sdk-adapter.ts
import { streamText, generateText, tool, jsonSchema } from "ai";
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
          const p5 = imagePart(b);
          if (p5) parts.push(p5);
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
          const part = { type: "reasoning", text: b.thinking ?? "" };
          if (b.signature && isGoogle) part.providerOptions = { google: { thoughtSignature: b.signature } };
          parts.push(part);
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
function grabThoughtSignature(part) {
  return part.providerMetadata?.google?.thoughtSignature ?? part.providerMetadata?.google?.thought_signature;
}
async function writeAnthropicStream(fullStream, modelId, write, log4) {
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
        const sig = grabThoughtSignature(part);
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
        const sig = grabThoughtSignature(part);
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
          const sig = grabThoughtSignature(part);
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
        log4?.(() => `sdk stream error: ${JSON.stringify(e?.data ?? part.error)}`);
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
async function streamAnthropicResponse(model, params, modelId, write, log4) {
  const result = streamText({ model, ...params });
  await writeAnthropicStream(result.fullStream, modelId, write, log4);
}
async function generateAnthropicResponse(model, params, modelId) {
  const r = await generateText({ model, ...params });
  return {
    id: "msg_" + Date.now(),
    type: "message",
    role: "assistant",
    model: modelId,
    content: [{ type: "text", text: r.text }],
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
function tokenCount(...values) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}
function extractCachedTokens(usage) {
  return tokenCount(
    usage?.prompt_tokens_details?.cached_tokens,
    usage?.input_tokens_details?.cached_tokens,
    usage?.cache_read_input_tokens
  );
}
function extractInputTokens(usage) {
  return tokenCount(
    usage?.prompt_tokens,
    usage?.input_tokens,
    usage?.promptTokens,
    usage?.inputTokens
  );
}
function extractUncachedInputTokens(usage) {
  return Math.max(0, extractInputTokens(usage) - extractCachedTokens(usage));
}
function extractOutputTokens(usage) {
  return tokenCount(
    usage?.completion_tokens,
    usage?.output_tokens,
    usage?.completionTokens,
    usage?.outputTokens
  );
}
function translateImageBlock(part) {
  const src = part.source;
  if (!src) return null;
  if (src.type === "url") {
    return { type: "image_url", image_url: { url: src.url } };
  }
  if (src.type === "base64") {
    return { type: "image_url", image_url: { url: `data:${src.media_type};base64,${src.data}` } };
  }
  return null;
}
function translateRequest2(body, options = {}) {
  const { model, messages, system, temperature, max_tokens, top_p, stop_sequences, tools, stream } = body;
  const inlineSystemParts = [];
  const openAIMessages = Array.isArray(messages) ? messages.flatMap((msg) => {
    if (msg.role === "system") {
      const text3 = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? "");
      if (text3.trim()) inlineSystemParts.push(text3.trim());
      return [];
    }
    if (typeof msg.content === "string") {
      return [{ role: msg.role, content: msg.content }];
    }
    if (!Array.isArray(msg.content)) return [];
    const result = [];
    if (msg.role === "assistant") {
      const assistantMsg = { role: "assistant", content: null };
      let text3 = "";
      let reasoningContent = "";
      const toolCalls = [];
      for (const part of msg.content) {
        if (part.type === "text") {
          text3 += (typeof part.text === "string" ? part.text : JSON.stringify(part.text)) + "\n";
        } else if (part.type === "thinking") {
          reasoningContent += (typeof part.thinking === "string" ? part.thinking : JSON.stringify(part.thinking)) + "\n";
        } else if (part.type === "tool_use") {
          const { rawId, thoughtSignature } = splitToolUseId(part.id);
          const toolCall = {
            id: rawId,
            type: "function",
            function: { name: part.name, arguments: JSON.stringify(part.input) }
          };
          if (thoughtSignature) toolCall.thought_signature = thoughtSignature;
          toolCalls.push(toolCall);
        }
      }
      const trimmed = text3.trim();
      const trimmedReasoning = reasoningContent.trim();
      if (trimmed) assistantMsg.content = trimmed;
      if (trimmedReasoning) assistantMsg.reasoning_content = trimmedReasoning;
      if (toolCalls.length > 0) assistantMsg.tool_calls = toolCalls;
      if (assistantMsg.content || assistantMsg.reasoning_content || assistantMsg.tool_calls) result.push(assistantMsg);
    }
    if (msg.role === "user") {
      let userText = "";
      const contentParts = [];
      const toolResults = [];
      for (const part of msg.content) {
        if (part.type === "text") {
          userText += (typeof part.text === "string" ? part.text : JSON.stringify(part.text)) + "\n";
        } else if (part.type === "image") {
          const translated = translateImageBlock(part);
          if (translated) contentParts.push(translated);
        } else if (part.type === "tool_result") {
          toolResults.push({
            role: "tool",
            tool_call_id: stripToolUseIdSuffix(part.tool_use_id),
            content: serializeToolResultContent(part.content)
          });
        }
      }
      const trimmed = userText.trim();
      result.push(...toolResults);
      if (contentParts.length > 0) {
        if (trimmed) contentParts.unshift({ type: "text", text: trimmed });
        result.push({ role: "user", content: contentParts });
      } else if (trimmed) {
        result.push({ role: "user", content: trimmed });
      }
    }
    return result;
  }) : [];
  const systemMessages = Array.isArray(system) ? system.map((item) => ({ role: "system", content: item.text })) : system ? [{ role: "system", content: system }] : [];
  if (inlineSystemParts.length > 0) {
    const mergedInline = inlineSystemParts.join("\n\n");
    if (systemMessages.length > 0) {
      systemMessages[0].content = `${systemMessages[0].content}

${mergedInline}`;
    } else {
      systemMessages.push({ role: "system", content: mergedInline });
    }
  }
  const data = { model, messages: [...systemMessages, ...openAIMessages] };
  if (max_tokens !== void 0) data.max_tokens = max_tokens;
  if (temperature !== void 0) data.temperature = temperature;
  if (top_p !== void 0) data.top_p = top_p;
  if (stream !== void 0) data.stream = stream;
  if (stream) data.stream_options = { include_usage: true };
  if (stop_sequences) data.stop = stop_sequences;
  const upstreamTools = resolveUpstreamTools(tools, messages);
  if (upstreamTools.length > 0) {
    data.tools = upstreamTools.map((item) => ({
      type: "function",
      function: {
        name: item.name,
        description: item.description,
        parameters: item.input_schema
      }
    }));
  }
  if (isMistralUpstream(options.completionsUrl, model)) {
    const normalized = normalizeMistralMessages(data.messages);
    data.messages = normalized.messages;
    options.mistralNormalize = normalized;
  }
  return data;
}
function translateResponse(completion, model) {
  const messageId = "msg_" + Date.now();
  const content = [];
  const message = completion.choices?.[0]?.message;
  if (message?.reasoning_content) {
    content.push({ type: "thinking", thinking: message.reasoning_content, signature: "" });
  }
  if (message?.content) {
    content.push({ text: message.content, type: "text" });
  }
  if (message?.tool_calls) {
    content.push(...message.tool_calls.map((item) => {
      const id = encodeToolUseId(item.id ?? "", item.thought_signature);
      return {
        type: "tool_use",
        id,
        name: item.function?.name ?? "",
        input: parseToolArguments(item.function?.arguments)
      };
    }));
  }
  const finishReason = completion.choices?.[0]?.finish_reason;
  let stopReason = "end_turn";
  if (finishReason === "tool_calls") stopReason = "tool_use";
  else if (finishReason === "length") stopReason = "max_tokens";
  const result = {
    id: messageId,
    type: "message",
    role: "assistant",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    model,
    usage: completion.usage ? {
      input_tokens: extractUncachedInputTokens(completion.usage),
      output_tokens: extractOutputTokens(completion.usage),
      cache_read_input_tokens: extractCachedTokens(completion.usage),
      cache_creation_input_tokens: 0
    } : { input_tokens: 0, output_tokens: 0 }
  };
  return result;
}
function translateStream(upstreamBody, model) {
  const messageId = "msg_" + Date.now();
  let contentBlockIndex = -1;
  let hasStartedTextBlock = false;
  let hasStartedThinkingBlock = false;
  let isToolUse = false;
  let currentToolCallId = null;
  let currentToolCallStreamIndex = -1;
  let lastUsage = null;
  let finishReason = null;
  let messageStarted = false;
  const toolCallState = /* @__PURE__ */ new Map();
  const output = new Readable4({ read() {
  } });
  function emitSSE(eventType, data) {
    output.push(sseChunk(eventType, data));
  }
  function emitMessageStart() {
    if (messageStarted) return;
    emitSSE("message_start", {
      type: "message_start",
      message: {
        id: messageId,
        type: "message",
        role: "assistant",
        content: [],
        model,
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 }
      }
    });
    messageStarted = true;
  }
  function flushToolCallStart(streamIndex) {
    const state = toolCallState.get(streamIndex);
    if (!state || state.emitted) return;
    const encodedId = encodeToolUseId(state.id, state.thoughtSignature);
    emitSSE("content_block_start", {
      type: "content_block_start",
      index: state.blockIndex,
      content_block: { type: "tool_use", id: encodedId, name: state.name, input: {} }
    });
    state.emitted = true;
  }
  function closeCurrentBlock() {
    if (currentToolCallStreamIndex >= 0) {
      flushToolCallStart(currentToolCallStreamIndex);
    }
    if (hasStartedThinkingBlock) {
      emitSSE("content_block_delta", {
        type: "content_block_delta",
        index: contentBlockIndex,
        delta: { type: "signature_delta", signature: GEMINI_SKIP_THOUGHT_SIGNATURE }
      });
    }
    if (isToolUse || hasStartedTextBlock || hasStartedThinkingBlock) {
      emitSSE("content_block_stop", { type: "content_block_stop", index: contentBlockIndex });
    }
  }
  function processDelta(delta, parsed) {
    if (parsed.usage) {
      lastUsage = {
        input_tokens: extractUncachedInputTokens(parsed.usage),
        output_tokens: extractOutputTokens(parsed.usage),
        cache_read_input_tokens: extractCachedTokens(parsed.usage),
        cache_creation_input_tokens: 0
      };
    }
    if (parsed.choices?.[0]?.finish_reason) {
      finishReason = parsed.choices[0].finish_reason;
    }
    if (delta.tool_calls && delta.tool_calls.length > 0) {
      for (const toolCall of delta.tool_calls) {
        const streamIndex = toolCall.index ?? 0;
        if (toolCall.id && toolCall.id !== currentToolCallId) {
          closeCurrentBlock();
          isToolUse = true;
          hasStartedTextBlock = false;
          hasStartedThinkingBlock = false;
          currentToolCallId = toolCall.id;
          currentToolCallStreamIndex = streamIndex;
          contentBlockIndex++;
          emitMessageStart();
          toolCallState.set(streamIndex, {
            id: toolCall.id,
            name: toolCall.function?.name,
            thoughtSignature: toolCall.thought_signature,
            blockIndex: contentBlockIndex,
            emitted: false
          });
        } else {
          const existing = toolCallState.get(streamIndex);
          if (existing) {
            if (toolCall.thought_signature) existing.thoughtSignature = toolCall.thought_signature;
            if (toolCall.function?.name && !existing.name) existing.name = toolCall.function.name;
          }
        }
        if (toolCall.function?.arguments) {
          flushToolCallStart(streamIndex);
          emitSSE("content_block_delta", {
            type: "content_block_delta",
            index: contentBlockIndex,
            delta: { type: "input_json_delta", partial_json: toolCall.function.arguments }
          });
        }
      }
      return;
    }
    if (delta.reasoning_content) {
      if (isToolUse || hasStartedTextBlock) {
        closeCurrentBlock();
        isToolUse = false;
        hasStartedTextBlock = false;
        currentToolCallId = null;
        contentBlockIndex++;
      }
      if (!hasStartedThinkingBlock) {
        if (contentBlockIndex < 0) contentBlockIndex = 0;
        emitMessageStart();
        emitSSE("content_block_start", {
          type: "content_block_start",
          index: contentBlockIndex,
          content_block: { type: "thinking", thinking: "", signature: "" }
        });
        hasStartedThinkingBlock = true;
      }
      emitSSE("content_block_delta", {
        type: "content_block_delta",
        index: contentBlockIndex,
        delta: { type: "thinking_delta", thinking: delta.reasoning_content }
      });
      return;
    }
    if (delta.content) {
      if (isToolUse || hasStartedThinkingBlock) {
        closeCurrentBlock();
        isToolUse = false;
        hasStartedThinkingBlock = false;
        currentToolCallId = null;
        contentBlockIndex++;
      }
      if (!hasStartedTextBlock) {
        if (contentBlockIndex < 0) contentBlockIndex = 0;
        emitMessageStart();
        emitSSE("content_block_start", {
          type: "content_block_start",
          index: contentBlockIndex,
          content_block: { type: "text", text: "" }
        });
        hasStartedTextBlock = true;
      }
      emitSSE("content_block_delta", {
        type: "content_block_delta",
        index: contentBlockIndex,
        delta: { type: "text_delta", text: delta.content }
      });
    }
  }
  function processLine(line) {
    const data = extractSseDataPayload(line);
    if (!data) return;
    try {
      const parsed = JSON.parse(data);
      const delta = parsed.choices?.[0]?.delta;
      if (delta) processDelta(delta, parsed);
    } catch {
    }
  }
  function finish() {
    closeCurrentBlock();
    emitMessageStart();
    let stopReason = "end_turn";
    if (finishReason === "tool_calls") stopReason = "tool_use";
    else if (finishReason === "length") stopReason = "max_tokens";
    emitSSE("message_delta", {
      type: "message_delta",
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: lastUsage || { input_tokens: 0, output_tokens: 0 }
    });
    emitSSE("message_stop", { type: "message_stop" });
    output.push(null);
  }
  attachSseLineReader(upstreamBody, (line) => {
    if (line.trim()) processLine(line);
  }, finish);
  return output;
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
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
          const model = createLanguageModel({
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
    realModelId: modelId,
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
  if (!model.completionsUrl && !model.baseUrl) return null;
  return {
    aliasId: aliasModelId(model.id, lp.name),
    realModelId: model.id,
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
import pc from "picocolors";
import { networkInterfaces } from "os";
import * as p2 from "@clack/prompts";

// src/config.ts
import { dirname } from "path";
import { existsSync as existsSync2, mkdirSync, readFileSync as readFileSync2, renameSync, writeFileSync } from "fs";

// src/paths.ts
import { homedir as homedir3 } from "os";
import { join as join3 } from "path";
function userHome(env = process.env) {
  return env.HOME ?? env.USERPROFILE ?? homedir3();
}
function getAppHome(env = process.env) {
  if (env.OPENCODE_STARTER_HOME) return env.OPENCODE_STARTER_HOME;
  return join3(userHome(env), ".opencode-starter");
}
function getConfigPath(env = process.env) {
  return join3(getAppHome(env), "config.json");
}
function getLegacyConfPath(env = process.env, platform = process.platform) {
  const home = userHome(env);
  const appName = "opencode-starter-nodejs";
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
function ensureConfigMigrated() {
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
import { join as join4 } from "path";
var isWindows2 = process.platform === "win32";
var OPENCODE_FALLBACK_PATHS = isWindows2 ? [
  join4(process.env["APPDATA"] ?? homedir4(), "npm", "opencode.cmd"),
  join4(process.env["APPDATA"] ?? homedir4(), "npm", "opencode"),
  join4(homedir4(), "AppData", "Roaming", "npm", "opencode.cmd")
] : [
  join4(homedir4(), ".opencode", "bin", "opencode"),
  join4(homedir4(), ".local", "bin", "opencode"),
  join4(homedir4(), ".npm", "bin", "opencode"),
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
  switch (npm) {
    case "@ai-sdk/anthropic":
      return {
        format: "anthropic",
        baseUrl: (apiUrl || "https://api.anthropic.com").replace(/\/v1\/?$/, "")
      };
    case "@ai-sdk/openai-compatible":
      if (!apiUrl) return null;
      return {
        format: "openai",
        completionsUrl: apiUrl.replace(/\/$/, "") + "/chat/completions"
      };
    case "@ai-sdk/openai":
      return {
        format: "openai",
        completionsUrl: "https://api.openai.com/v1/chat/completions"
      };
    case "@ai-sdk/google":
      return {
        format: "openai",
        completionsUrl: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
      };
    case "@ai-sdk/groq":
      return {
        format: "openai",
        completionsUrl: "https://api.groq.com/openai/v1/chat/completions"
      };
    case "@ai-sdk/mistral":
      return {
        format: "openai",
        completionsUrl: "https://api.mistral.ai/v1/chat/completions"
      };
    case "@ai-sdk/xai":
      return {
        format: "openai",
        completionsUrl: "https://api.x.ai/v1/chat/completions"
      };
    case "@openrouter/ai-sdk-provider":
      return {
        format: "openai",
        completionsUrl: (apiUrl || "https://openrouter.ai/api/v1").replace(/\/$/, "") + "/chat/completions"
      };
    default:
      return null;
  }
}
function normalizeProviders(raw) {
  const result = [];
  for (const provider of raw) {
    if (!provider.key) continue;
    if (provider.id === "opencode" || provider.id === "opencode-go") continue;
    const models = [];
    for (const model of Object.values(provider.models ?? {})) {
      const endpoint = resolveEndpoint(model.api?.npm ?? "", model.api?.url ?? "");
      if (endpoint === null) continue;
      models.push({
        id: model.id,
        name: model.name ?? model.id,
        family: model.family ?? "",
        brand: deriveBrand(model.family ?? ""),
        modelFormat: endpoint.format,
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
        sourceBackend: "zen",
        modelFormat: model.modelFormat,
        cost: model.cost,
        baseUrl: model.baseUrl,
        completionsUrl: model.completionsUrl,
        apiKey: provider.apiKey,
        contextWindow: model.contextWindow
      });
    }
  }
  return models;
}

// src/server/prompts.ts
import * as p from "@clack/prompts";
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

// src/server/auth.ts
function isAuthorized(request, serverPassword) {
  if (serverPassword === null) return true;
  const bearerToken = extractBearerToken(request.headers.get("authorization"));
  if (bearerToken === serverPassword) return true;
  return request.headers.get("x-api-key") === serverPassword;
}
function extractBearerToken(value) {
  if (!value) return null;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match?.[1] ?? null;
}

// src/server/router.ts
import { Readable as Readable5 } from "stream";
async function startServer(options) {
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
      sendJson2(res, 200, formatAnthropicModels(options.catalog.list()));
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
    const messagesUrl = model.baseUrl ? `${model.baseUrl}/v1/messages` : `${backendFor(options, model).baseUrl}/v1/messages`;
    const apiKey = model.apiKey ?? options.apiKey;
    await forwardJson(res, messagesUrl, body, apiKey);
    return;
  }
  if (model.modelFormat === "openai") {
    const completionsUrl = model.completionsUrl ? model.completionsUrl : `${backendFor(options, model).baseUrl}/v1/chat/completions`;
    const apiKey = model.apiKey ?? options.apiKey;
    const useResponses = isOpenAIChatCompletionsUrl(completionsUrl) && modelPrefersResponsesApi(body.model);
    const upstreamUrl = useResponses ? openAIResponsesUrl(completionsUrl) : completionsUrl;
    const translateOpts = { completionsUrl };
    const upstreamBody = useResponses ? translateToResponses(body) : translateRequest2(body, translateOpts);
    const clientWantsStream = Boolean(body.stream);
    const upstreamRes = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...clientWantsStream ? { Accept: "text/event-stream" } : {},
        "Authorization": `Bearer ${apiKey}`,
        "X-API-Key": apiKey
      },
      body: JSON.stringify(upstreamBody)
    });
    if (!upstreamRes.ok) {
      const errText = await upstreamRes.text();
      res.writeHead(upstreamRes.status, { "Content-Type": upstreamRes.headers.get("content-type") || "application/json" });
      res.end(errText);
      return;
    }
    if (clientWantsStream && upstreamRes.body) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive"
      });
      const nodeStream = Readable5.fromWeb(upstreamRes.body);
      const translated = useResponses ? translateStreamResponses(nodeStream, body.model) : translateStream(nodeStream, body.model);
      translated.pipe(res);
      return;
    }
    const upstreamData = await upstreamRes.json();
    sendJson2(
      res,
      200,
      useResponses ? translateFromResponses(upstreamData, body.model) : translateResponse(upstreamData, body.model)
    );
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
      for (const item of value) headers.append(name, item);
    } else if (value !== void 0) {
      headers.set(name, value);
    }
  }
  return new Request("http://localhost/", { headers });
}
function sendJson2(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
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
    if (needsZen) models.push(...modelsForTier(tier, "zen", zenGo.zenModels));
    if (needsGo) models.push(...modelsForTier(tier, "go", zenGo.goModels));
  }
  try {
    const localProviders = await fetchLocalProviders();
    if (localProviders !== null) {
      models.push(...localProvidersToServerModels(localProviders));
    } else {
      p2.log.info("No local providers found \u2014 using cloud models only");
    }
  } catch {
    p2.log.info("No local providers found \u2014 using cloud models only");
  }
  return models;
}
async function runServerCommand() {
  let apiKey = resolveApiKey();
  if (!apiKey) {
    apiKey = await readFromCredentialStore((reason) => {
      p2.log.warn(`Credential store unavailable \u2014 ${reason}`);
    });
    if (apiKey) {
      const isMac = process.platform === "darwin";
      const isWindows3 = process.platform === "win32";
      const storeName = isMac ? "macOS Keychain" : isWindows3 ? "Windows Credential Manager" : "Secret Service";
      p2.log.success(`Found key in ${storeName}`);
    }
  }
  if (!apiKey) {
    p2.log.error("Missing OPENCODE_API_KEY. Run `opencode-starter claude` once to configure your key, or export OPENCODE_API_KEY.");
    return 1;
  }
  const tier = getSubscriptionTier();
  if (!tier) {
    p2.log.error("Missing subscription tier. Run `opencode-starter claude --setup` first.");
    return 1;
  }
  const mode = await askListenMode();
  if (!mode) return 0;
  const serverPassword = await getServerPasswordForMode(mode);
  if (serverPassword === void 0) return 0;
  const host = mode === "network" ? "0.0.0.0" : "127.0.0.1";
  const spinner3 = p2.spinner();
  spinner3.start("Fetching available models...");
  let models;
  try {
    models = await loadServerModels(tier);
    const localCount = models.filter((m) => m.apiKey !== void 0).length;
    spinner3.stop(`Loaded ${models.length} models (${localCount} from local providers)`);
  } catch (err) {
    spinner3.stop(pc.red("Failed to load models"));
    console.error(pc.red(String(err instanceof Error ? err.message : err)));
    return 1;
  }
  const server = await startServer({
    host,
    port: 17645,
    apiKey,
    serverPassword,
    catalog: createModelCatalog(models),
    backends: BACKENDS
  });
  console.log("");
  console.log(pc.bold(pc.green("OpenCode Starter server running")));
  console.log(`  Anthropic:  http://127.0.0.1:${server.port}/anthropic`);
  console.log(`  OpenAI:     http://127.0.0.1:${server.port}/openai`);
  if (mode === "network") {
    console.log(`  Network:    http://${getLocalIp()}:${server.port}`);
    console.log(`  API key:    ${serverPassword}`);
  } else {
    console.log("  API key:    any non-empty value");
  }
  console.log("");
  console.log(pc.dim("Press Ctrl+C to stop."));
  await waitForShutdown();
  await server.close();
  return 0;
}

// src/prompts.ts
import * as p3 from "@clack/prompts";
import pc2 from "picocolors";
function modelLabel(model, showBackendBadge = false) {
  if (model.modelFormat === "unsupported") {
    return pc2.dim(`${model.name} (not yet supported)`);
  }
  if (model.isFree) {
    const tag = showBackendBadge ? "(free \xB7 Zen)" : "(free)";
    return pc2.green(`${model.name} ${tag}`);
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
  const tier = await p3.select({
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
  if (p3.isCancel(tier)) {
    p3.cancel("Cancelled.");
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
    const picked = await p3.select({
      message: `${messagePrefix} (page ${currentPage + 1} of ${totalPages})`,
      options,
      initialValue
    });
    if (p3.isCancel(picked)) return "menu";
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
      const method = await p3.select({
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
      if (p3.isCancel(method)) {
        p3.cancel("Cancelled.");
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
    const searchInput = await p3.text({
      message: `Search models (${models.length} available):`,
      placeholder: "e.g. claude, sonnet, llama"
    });
    if (p3.isCancel(searchInput)) {
      mode = "choose";
      continue;
    }
    const matched = filterModelsBySearch(browseList, String(searchInput));
    if (matched.length === 0) {
      p3.log.warn("No models match \u2014 try a different search");
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
    const picked = await p3.select({
      message,
      options,
      initialValue
    });
    if (p3.isCancel(picked)) {
      p3.cancel("Cancelled.");
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
  const lines = conflicts.map((c) => `  ${pc2.dim(c.name)}=${pc2.dim(c.value)}`).join("\n");
  p3.note(lines, pc2.yellow("Env vars that will be temporarily overridden:"));
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
    const picked = await p3.select({
      message: "Which model?",
      options,
      initialValue: recentModels[0].id
    });
    if (p3.isCancel(picked)) {
      p3.cancel("Cancelled.");
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
  const confirmed = await p3.confirm({
    message: `Launch Claude Code \xB7 ${pc2.bold(selectedModel.id)} via ${pc2.bold(provider.name)}?`,
    initialValue: true
  });
  if (p3.isCancel(confirmed) || !confirmed) {
    p3.cancel("Cancelled.");
    return null;
  }
  p3.outro(pc2.green("Launching..."));
  return selectedModel;
}
async function runWizard(prefs, modelsByBackend, conflicts, tier) {
  let selectorBackendId = null;
  if (tier === "both") {
    const backendId = await p3.select({
      message: "Which backend?",
      options: [
        { value: "zen", label: "OpenCode Zen", hint: "66+ models, free tier available" },
        { value: "go", label: "OpenCode Go", hint: "17 models, subscription ($10/mo)" }
      ],
      initialValue: prefs.lastBackend ?? "zen"
    });
    if (p3.isCancel(backendId)) {
      p3.cancel("Cancelled.");
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
    p3.cancel("No models available for this backend and subscription tier.");
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
    p3.log.info(pc2.dim(`Not yet supported: ${summary} \u2014 need API format translation`));
  }
  const backend = BACKENDS[selectedModel.sourceBackend];
  noteEnvConflicts(conflicts);
  const confirmed = await p3.confirm({
    message: `Launch Claude Code \xB7 ${pc2.bold(selectedModel.id)} via ${pc2.bold(backend.name)}?`,
    initialValue: true
  });
  if (p3.isCancel(confirmed) || !confirmed) {
    p3.cancel("Cancelled.");
    return null;
  }
  p3.outro(pc2.green("Launching..."));
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
  return `${pc3.bold("opencode-starter")} v${VERSION}
Launch AI coding tools with OpenCode Zen, Go, or local providers (Groq, Mistral,
OpenAI, Gemini, Ollama, and more).

${pc3.bold("Usage:")}
  opencode-starter claude [starter-options] [claude-flags]
  opencode-starter models
  opencode-starter server
  opencode-starter --help
  opencode-starter --version

${pc3.bold("Commands:")}
  claude      Launch Claude Code \u2014 cloud Zen/Go or local OpenCode providers
  models      Manage favorite models for mid-session /model switching (max ${MAX_MODEL_CATALOG})
  server      Run a foreground API gateway (Zen, Go, and local providers)
  codex       planned

${pc3.bold("Migration:")}
  Bare opencode-starter prints this help instead of launching Claude Code.
  Use opencode-starter claude for the wizard and launcher.

${pc3.bold("Examples:")}
  opencode-starter claude
  opencode-starter models
  opencode-starter server
  opencode-starter claude -c
  opencode-starter claude --resume abc-123
  opencode-starter claude -- --print "hello"`;
}
function claudeHelpText() {
  return `${pc3.bold("opencode-starter claude")} v${VERSION}
Launch Claude Code with OpenCode Zen, Go, or local providers as the API backend.

${pc3.bold("Usage:")}
  opencode-starter claude [starter-options] [claude-flags]
  opencode-starter claude --help
  opencode-starter claude --version

${pc3.bold("Starter options:")}
  --dry-run    Run the wizard but show a preview instead of launching Claude Code
  --setup      Re-configure your subscription tier
  --trace      Write debug logs to /tmp and show errors on exit
  --help       Show this command help
  --version    Show version

${pc3.bold("Providers:")}
  Cloud (Zen/Go)  Requires OPENCODE_API_KEY \u2014 get one at https://opencode.ai/auth
  Local           Requires OpenCode CLI with providers configured (Groq, Mistral,
                  OpenAI, Gemini, Ollama, etc.). Shown in the wizard when available.

${pc3.bold("Model switching:")}
  Run opencode-starter models to save favorites (max ${MAX_MODEL_CATALOG}).
  When favorites exist, launch starts a multi-route proxy and Claude Code /model
  lists your starting model plus favorites for live switching.
  With no favorites, launch uses a single model as before.

${pc3.bold("Note:")}
  Claude Code may save the launched model to ~/.claude/settings.json.
  Bare claude later can still show that model \u2014 reset with claude --model sonnet.

${pc3.bold("Examples:")}
  opencode-starter claude
  opencode-starter claude -c
  opencode-starter claude --resume abc-123
  opencode-starter claude abc-123
  opencode-starter claude --dry-run -c
  opencode-starter claude --setup
  opencode-starter claude --trace --resume abc-123
  opencode-starter claude -- --print "hello"
  opencode-starter claude -- --dangerously-skip-permissions`;
}
function serverHelpText() {
  return `${pc3.bold("opencode-starter server")} v${VERSION}
Run a foreground API gateway for Zen, Go, and local OpenCode providers.

${pc3.bold("Usage:")}
  opencode-starter server
  opencode-starter server --help
  opencode-starter server --version

${pc3.bold("Behavior:")}
  Loads Zen/Go models plus configured local providers into one catalog.
  Prompts for local-only (127.0.0.1) or network (0.0.0.0) listen mode.
  Binds to port 17645. Network mode asks for a server password.
  Server password is saved only if the user chooses to save it.
  Server host and port are not saved.

${pc3.bold("Endpoints:")}
  Anthropic-compatible:  ANTHROPIC_BASE_URL=http://127.0.0.1:17645/anthropic
  OpenAI-compatible:     OPENAI_BASE_URL=http://127.0.0.1:17645/openai/v1
  API key: use anything locally; use the server password in network mode.`;
}
function modelsHelpText() {
  return `${pc3.bold("opencode-starter models")} v${VERSION}
Manage favorite models for mid-session switching in Claude Code.

${pc3.bold("Usage:")}
  opencode-starter models
  opencode-starter models --help
  opencode-starter models --version

${pc3.bold("Behavior:")}
  Opens an interactive manager to add or remove favorites.
  Pick from Zen, Go, or any configured local OpenCode provider.
  Favorites are saved to ~/.opencode-starter/config.json (max ${MAX_MODEL_CATALOG}).

${pc3.bold("How it works:")}
  When favorites exist, opencode-starter claude starts a multi-route catalog proxy.
  Claude Code /model lists your starting model plus favorites \u2014 switch live
  without restarting. Mix cloud and local favorites in one session.
  With no favorites, launch uses a single model as before.

${pc3.bold("Examples:")}
  opencode-starter models
  opencode-starter claude    # switch menu active when favorites are set`;
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
    p4.log.info(
      `Switch menu active \u2014 proxy on port ${proxyHandle.port} ` + pc3.dim(`(${catalogRoutes.length} model${catalogRoutes.length !== 1 ? "s" : ""} in /model)`)
    );
  } catch (err) {
    p4.log.error(`Failed to start proxy: ${err instanceof Error ? err.message : String(err)}`);
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
  const debugLogPath = join5(tmpdir(), "opencode-starter-debug.log");
  const traceArgs = trace ? ["--debug-file", debugLogPath] : [];
  if (trace) p4.log.info(`Debug log: ${debugLogPath}`);
  const exitCode = await launchClaude(childEnv, startingRoute.aliasId, [...traceArgs, ...claudeArgs]);
  proxyHandle.close();
  if (trace) printTraceLog(debugLogPath);
  return exitCode;
}
function printTraceLog(debugLogPath) {
  if (!existsSync4(debugLogPath)) return;
  const log4 = readFileSync3(debugLogPath, "utf8");
  const errorLines = log4.split("\n").filter(
    (l) => l.includes("error") || l.includes("Error") || l.includes('"type":"error"') || l.includes("status")
  );
  console.log("\n" + pc3.bold(pc3.cyan("\u2500\u2500 Debug trace \u2500\u2500")));
  if (errorLines.length > 0) {
    errorLines.slice(0, 30).forEach((l) => console.log(pc3.dim(l)));
  } else {
    console.log(pc3.dim("(no errors found in debug log)"));
  }
  console.log(pc3.dim(`Full log: ${debugLogPath}`));
}
function printDryRun(backendName, modelId, baseUrl, modelFormat, claudeArgs, conflicts, disableExperimentalBetas, npm) {
  console.log("");
  console.log(pc3.bold(pc3.cyan("  DRY RUN \u2014 would execute:")));
  console.log("");
  const claudeCmd = ["claude", "--model", modelId, ...claudeArgs].join(" ");
  console.log(`  ${pc3.bold("Command:")}  ${claudeCmd}`);
  console.log(`  ${pc3.bold("Backend:")}  ${backendName}`);
  if (modelFormat === "openai") {
    if (isSdkMigratedNpm(npm)) {
      console.log(`  ${pc3.bold("Proxy:")}    would start local SDK adapter proxy ${pc3.dim("(Vercel AI SDK)")}`);
      if (npm) console.log(`             ${pc3.dim(`npm: ${npm}`)}`);
    } else {
      console.log(`  ${pc3.bold("Proxy:")}    would start local translation proxy ${pc3.dim("(Anthropic \u2192 OpenAI)")}`);
      console.log(`             ${pc3.dim(`\u2192 ${baseUrl}/v1/chat/completions`)}`);
    }
  }
  console.log("");
  console.log(`  ${pc3.bold("Env vars SET:")}`);
  if (modelFormat === "openai") {
    console.log(`    ANTHROPIC_BASE_URL=http://127.0.0.1:<port>  ${pc3.dim("(local proxy)")}`);
  } else {
    console.log(`    ANTHROPIC_BASE_URL=${baseUrl}`);
  }
  console.log(`    ANTHROPIC_API_KEY=<your OPENCODE_API_KEY>`);
  console.log(`    ANTHROPIC_MODEL=${modelId}`);
  if (disableExperimentalBetas) {
    console.log(`    CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1  ${pc3.dim("(direct upstream \u2014 strips beta headers)")}`);
  } else {
    console.log(`    ${pc3.dim("(experimental betas enabled \u2014 tool search via local proxy)")}`);
  }
  console.log(`    ENABLE_TOOL_SEARCH=true  ${pc3.dim("(defer MCP tools like native Claude Code)")}`);
  console.log(`    CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT=0  ${pc3.dim("(keep full system prompt on proxy routes)")}`);
  console.log("");
  if (conflicts.length > 0) {
    console.log(`  ${pc3.bold("Env vars REMOVED:")}`);
    for (const c of conflicts) {
      console.log(`    ${pc3.dim(c.name)}=${pc3.dim(c.value)}`);
    }
    console.log("");
  }
  console.log(pc3.dim("  (dry run complete \u2014 Claude Code was NOT launched)"));
  console.log("");
}
function detectShellProfile() {
  const shell = process.env["SHELL"] ?? "";
  if (process.platform === "darwin") {
    if (shell.includes("zsh")) return { display: "~/.zshrc", path: `${homedir5()}/.zshrc` };
    if (shell.includes("bash")) return { display: "~/.bash_profile", path: `${homedir5()}/.bash_profile` };
    return { display: "~/.profile", path: `${homedir5()}/.profile` };
  }
  if (process.platform === "linux") {
    if (shell.includes("zsh")) return { display: "~/.zshrc", path: `${homedir5()}/.zshrc` };
    if (shell.includes("bash")) return { display: "~/.bashrc", path: `${homedir5()}/.bashrc` };
    return { display: "~/.profile", path: `${homedir5()}/.profile` };
  }
  if (shell.includes("bash")) return { display: "~/.bashrc", path: `${homedir5()}/.bashrc` };
  return { display: "~/.profile", path: `${homedir5()}/.profile` };
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
    p4.note(
      "Running in dry-run mode \u2014 no keys will be read from or written to your system.",
      "Simulating first-run onboarding"
    );
  }
  if (!simulate) {
    const keyDiag = (reason) => {
      p4.log.warn(`Credential store unavailable \u2014 ${reason}`);
      if (trace) {
        try {
          appendFileSync2(
            join5(tmpdir(), "opencode-starter-debug.log"),
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
      p4.log.success(`Found key in ${storeName}`);
      process.env["OPENCODE_API_KEY"] = storedKey;
      return storedKey;
    }
  }
  p4.note("Get your free key at: https://opencode.ai/auth", "OpenCode API key");
  const key = await p4.password({
    message: "Paste your OPENCODE_API_KEY:",
    validate: (val) => val.trim() ? void 0 : "Key cannot be empty"
  });
  if (p4.isCancel(key)) {
    p4.cancel("Cancelled.");
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
          hint: "Key stored encrypted in Keychain; opencode-starter reads it automatically next time"
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
          hint: "Key stored securely; opencode-starter reads it automatically next time"
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
        hint: "Key stored securely in your desktop keyring; opencode-starter reads it automatically next time"
      });
    } else if (!simulate) {
      p4.log.info("No keyring daemon detected \u2014 secure storage requires GNOME Keyring or KWallet running.");
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
  const saveChoice = await p4.select({
    message: "Where should we save the key?",
    options: saveOptions,
    initialValue: isMac ? "keychain" : isWindows3 ? "credential-manager" : secretServiceAvailable ? "secret-service" : "profile"
  });
  if (p4.isCancel(saveChoice)) {
    p4.cancel("Cancelled.");
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
    p4.log.info(`[dry-run] ${dryRunMessages[saveChoice]}`);
  } else if (saveChoice === "keychain") {
    if (await saveToCredentialStore(trimmedKey)) {
      p4.log.success("Key saved to macOS Keychain \u2014 active now and automatically loaded next time.");
    } else {
      p4.log.warn("Could not write to Keychain \u2014 key will be used for this session only");
    }
  } else if (saveChoice === "keychain-autoload") {
    if (await saveToCredentialStore(trimmedKey)) {
      try {
        const autoLoadLine = `export OPENCODE_API_KEY="$(security find-generic-password -s opencode-starter -a opencode-starter -w 2>/dev/null)"`;
        const existing = existsSync4(path) ? readFileSync3(path, "utf8") : "";
        if (!existing.includes(autoLoadLine)) {
          appendFileSync2(path, `
# opencode-starter: load API key from macOS Keychain
${autoLoadLine}
`);
        }
        p4.log.success(`Key saved to Keychain and auto-load added to ${display} \u2014 active now and in all future terminals.`);
      } catch {
        p4.log.success("Key saved to Keychain \u2014 active now and automatically loaded next time.");
        p4.log.warn(`Could not write auto-load line to ${display}`);
      }
    } else {
      p4.log.warn("Could not write to Keychain \u2014 key will be used for this session only");
    }
  } else if (saveChoice === "credential-manager") {
    if (await saveToCredentialStore(trimmedKey)) {
      p4.log.success("Key saved to Windows Credential Manager \u2014 active now and automatically loaded next time.");
    } else {
      p4.log.warn("Could not write to Credential Manager \u2014 key will be used for this session only");
    }
  } else if (saveChoice === "setx") {
    try {
      const result = spawnSync("setx", ["OPENCODE_API_KEY", trimmedKey], { stdio: ["pipe", "pipe", "pipe"] });
      if (result.status !== 0) throw new Error("setx exited with non-zero status");
      p4.log.success("Key saved as a user environment variable \u2014 active now and in all future terminals.");
    } catch {
      p4.log.warn("Could not run setx \u2014 key will be used for this session only");
    }
  } else if (saveChoice === "secret-service") {
    if (await saveToCredentialStore(trimmedKey)) {
      p4.log.success("Key saved to Secret Service \u2014 active now and automatically loaded next time.");
    } else {
      p4.log.warn("Could not write to Secret Service \u2014 key will be used for this session only");
    }
  } else if (saveChoice === "profile") {
    try {
      if (!existsSync4(path)) appendFileSync2(path, "");
      const escapedKey = trimmedKey.replace(/'/g, "'\\''");
      appendFileSync2(path, `
export OPENCODE_API_KEY='${escapedKey}'
`);
      p4.log.success(`Key saved to ${display} \u2014 active now and in all future terminals.`);
    } catch {
      p4.log.warn(`Could not write to ${display} \u2014 key will be used for this session only`);
    }
  }
  if (!simulate) process.env["OPENCODE_API_KEY"] = trimmedKey;
  return trimmedKey;
}
async function runModelsCommand() {
  p4.intro(pc3.bold("  OpenCode Starter \u2014 Favorite Models"));
  const spinner3 = p4.spinner();
  spinner3.start("Loading providers...");
  const catalog = await fetchProviderCatalog();
  spinner3.stop("");
  const allProviders = providersForPicker(catalog);
  if (allProviders.length === 0) {
    p4.log.warn("No providers found.");
    p4.log.info("OpenCode Zen/Go is always available. Local providers appear when OpenCode is running.");
    p4.outro("Done.");
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
      const label = entry ? `\u2605 ${entry.modelName} (${entry.providerName})` : pc3.dim(`\u2605 ${fav.modelId} \u2014 provider gone`);
      options.push({ value: `fav-${i}`, label, hint: "select to remove" });
    }
    const atCap = favorites.length >= MAX_MODEL_CATALOG;
    options.push({
      value: "__add__",
      label: atCap ? pc3.dim(`+ Add a model \u2192 (limit of ${MAX_MODEL_CATALOG} reached)`) : "+ Add a model \u2192",
      hint: atCap ? "Remove a favorite first to make room" : `${allProviders.length} provider${allProviders.length !== 1 ? "s" : ""} available`
    });
    options.push({ value: "__done__", label: "Done", hint: "" });
    const header = favorites.length === 0 ? `Favorites (0/${MAX_MODEL_CATALOG})` : `Favorites (${favorites.length}/${MAX_MODEL_CATALOG}) \u2014 select to remove`;
    const choice = await p4.select({
      message: header,
      options,
      initialValue: "__done__"
    });
    if (p4.isCancel(choice) || choice === "__done__") break;
    if (choice === "__add__") {
      if (atCap) {
        p4.log.warn(`Limit of ${MAX_MODEL_CATALOG} favorites reached \u2014 remove one first.`);
        continue;
      }
      const providerOptions = allProviders.map((ap) => ({
        value: ap.id,
        label: ap.name,
        hint: `${ap.models.length} model${ap.models.length !== 1 ? "s" : ""}`
      }));
      const pickedProviderId = await p4.select({
        message: "Which provider?",
        options: providerOptions
      });
      if (p4.isCancel(pickedProviderId)) continue;
      const provider = allProviders.find((ap) => ap.id === pickedProviderId);
      const browsed = await browseAllModels(provider, prefs);
      if (!browsed) continue;
      const fav = { providerId: provider.id, modelId: browsed.id };
      const result = addFavorite(favorites, fav);
      if (!result.ok) {
        if (result.reason === "duplicate") {
          p4.log.warn(`${browsed.name || browsed.id} is already in your favorites.`);
        } else {
          p4.log.warn(`Limit of ${MAX_MODEL_CATALOG} favorites reached \u2014 remove one first.`);
        }
        continue;
      }
      favorites = result.list;
      favoritesDirty = true;
      p4.log.success(`Added ${browsed.name || browsed.id} (${provider.name}) to favorites.`);
    } else if (choice.startsWith("fav-")) {
      const idx = parseInt(choice.slice(4), 10);
      const fav = favorites[idx];
      const entry = modelLookup.get(`${fav.providerId}:${fav.modelId}`);
      const label = entry ? `${entry.modelName} (${entry.providerName})` : fav.modelId;
      favorites = removeFavorite(favorites, fav);
      favoritesDirty = true;
      p4.log.success(`Removed ${label} from favorites.`);
    }
  }
  if (favoritesDirty) {
    savePreferences({ favoriteModels: favorites });
  }
  p4.outro(
    favorites.length === 0 ? "No favorites saved \u2014 launch will use single-model mode." : pc3.green(`${favorites.length} favorite${favorites.length !== 1 ? "s" : ""} saved \u2014 /model menu will show these on next launch.`)
  );
  return 0;
}
async function runClaudeCommand(parsed) {
  const { dryRun, setup, trace, claudeArgs } = parsed;
  const claudePath = findClaudeBinary();
  if (!claudePath) {
    console.error(pc3.red("\nError: claude binary not found on PATH.\n"));
    console.error("Install Claude Code:");
    console.error("  npm install -g @anthropic-ai/claude-code\n");
    return 1;
  }
  const prefs = dryRun ? {} : loadPreferences();
  const conflicts = detectConflicts();
  const favorites = dryRun ? [] : prefs.favoriteModels ?? [];
  const switchMenuActive = favorites.length > 0;
  const hasZenGoFavorites = favorites.some((f) => f.providerId === "zen" || f.providerId === "go");
  p4.intro(pc3.bold("  OpenCode Starter"));
  let earlyEffectiveKey = null;
  let earlyZenModels = [];
  let earlyGoModels = [];
  if (switchMenuActive && hasZenGoFavorites && !dryRun) {
    const apiKey2 = await resolveOrCollectApiKey(false, trace);
    if (!apiKey2) return 0;
    earlyEffectiveKey = apiKey2;
    const zenGoSpinner = p4.spinner();
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
      p4.log.warn(`Could not fetch OpenCode models (${detail}) \u2014 Zen/Go favorites will be skipped from /model catalog`);
    }
  }
  const providerSpinner = p4.spinner();
  providerSpinner.start("Checking for local providers...");
  const localProviders = await fetchLocalProviders();
  providerSpinner.stop("");
  if (localProviders === null) {
    p4.log.info(pc3.dim("Tip: Install OpenCode locally to unlock additional providers"));
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
    const chosen = await p4.select({
      message: "Which provider?",
      options: providerOptions,
      initialValue: initialProvider
    });
    if (p4.isCancel(chosen)) {
      p4.cancel("Cancelled.");
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
      const startingRoute = localModelToRoute(provider, selectedModel) ?? resolveRoute(provider.id, selectedModel.id);
      if (!startingRoute) {
        p4.log.error("Could not resolve a proxy route for the selected model.");
        return 1;
      }
      const catalogRoutes = buildCatalogRoutes(startingRoute, favorites, resolveRoute);
      if (dryRun) {
        const endpoint = selectedModel.baseUrl ?? selectedModel.completionsUrl ?? "(unknown)";
        console.log("");
        console.log(pc3.bold(pc3.cyan("  DRY RUN \u2014 would execute (switch-menu mode):")));
        console.log("");
        console.log(`  ${pc3.bold("Provider:")}      ${provider.name}`);
        console.log(`  ${pc3.bold("Starting model:")} ${selectedModel.id}`);
        console.log(`  ${pc3.bold("Endpoint:")}      ${endpoint}`);
        console.log(`  ${pc3.bold("/model catalog:")} ${catalogRoutes.length} model(s)`);
        catalogRoutes.forEach((r) => console.log(`    ${pc3.dim(r.displayName)}`));
        console.log("");
        console.log(pc3.dim("  (dry run complete \u2014 Claude Code was NOT launched)"));
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
      const sdkRoute = isSdkMigratedNpm(selectedModel.npm);
      const formatDesc = selectedModel.modelFormat === "anthropic" ? "direct passthrough" : sdkRoute ? "via SDK adapter proxy" : "via translation proxy";
      const endpoint = sdkRoute ? selectedModel.npm ?? "SDK" : selectedModel.baseUrl ?? selectedModel.completionsUrl ?? "(unknown)";
      console.log("");
      console.log(pc3.bold(pc3.cyan("  DRY RUN \u2014 would execute:")));
      console.log("");
      console.log(`  ${pc3.bold("Provider:")}  ${provider.name}`);
      console.log(`  ${pc3.bold("Model:")}     ${selectedModel.id}`);
      console.log(`  ${pc3.bold("Format:")}    ${selectedModel.modelFormat} (${formatDesc})`);
      console.log(`  ${pc3.bold(sdkRoute ? "SDK npm:" : "Endpoint:")} ${endpoint}`);
      console.log(`  ${pc3.bold("Key:")}       ${provider.id} provider key`);
      console.log("");
      console.log(pc3.dim("  (dry run complete \u2014 Claude Code was NOT launched)"));
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
          selectedModel.completionsUrl,
          selectedModel.id,
          trace,
          selectedModel.contextWindow,
          { npm: selectedModel.npm, baseURL: selectedModel.apiBaseUrl }
        );
        p4.log.info(
          `Translation proxy started on port ${proxyHandle2.port} ` + pc3.dim(`(${selectedModel.completionsUrl})`)
        );
      } catch (err) {
        p4.log.error(`Failed to start translation proxy: ${err instanceof Error ? err.message : String(err)}`);
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
    const debugLogPath2 = join5(tmpdir(), "opencode-starter-debug.log");
    const traceArgs2 = trace ? ["--debug-file", debugLogPath2] : [];
    if (trace) p4.log.info(`Debug log: ${debugLogPath2}`);
    const exitCode2 = await launchClaude(childEnv2, selectedModel.id, [...traceArgs2, ...claudeArgs]);
    proxyHandle2?.close();
    if (trace) printTraceLog(debugLogPath2);
    return exitCode2;
  }
  const apiKey = earlyEffectiveKey ?? await resolveOrCollectApiKey(dryRun, trace);
  if (!apiKey && !dryRun) return 0;
  const effectiveKey = apiKey ?? "dry-run-placeholder";
  let tier = dryRun ? null : getSubscriptionTier();
  if (!tier || setup) {
    tier = await askSubscriptionTier();
    if (!tier) return 0;
    if (!dryRun) setSubscriptionTier(tier);
  }
  const needsZen = tier === "free" || tier === "zen" || tier === "go" || tier === "both";
  const needsGo = tier === "go" || tier === "both";
  const spinner3 = p4.spinner();
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
    spinner3.stop(pc3.red("Failed to load models"));
    console.error(pc3.red(String(err instanceof Error ? err.message : err)));
    return 1;
  }
  const selection = await runWizard(prefs, { zen: zenModels, go: goModels }, conflicts, tier);
  if (!selection) return 0;
  if (!dryRun) savePreferences({ lastBackend: selection.backend.id, lastModel: selection.model.id, lastProvider: "opencode" });
  if (switchMenuActive && hasZenGoFavorites && !dryRun) {
    const resolveRoute = makeRouteResolver(localProviders, earlyZenModels, earlyGoModels, effectiveKey);
    const startingRoute = zenGoModelToRoute(selection.model, effectiveKey);
    if (!startingRoute) {
      p4.log.error("Could not resolve a proxy route for the selected model.");
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
      p4.log.info(
        `Translation proxy started on port ${proxyHandle.port} ` + pc3.dim(`(${selection.backend.baseUrl}/v1/chat/completions)`)
      );
    } catch (err) {
      p4.log.error(`Failed to start translation proxy: ${err instanceof Error ? err.message : String(err)}`);
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
  const debugLogPath = join5(tmpdir(), "opencode-starter-debug.log");
  const traceArgs = trace ? ["--debug-file", debugLogPath] : [];
  if (trace) {
    p4.log.info(`Debug log: ${debugLogPath}`);
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
    console.error(pc3.red(`
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
    return runServerCommand();
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
    console.error(pc3.red("\nUnexpected error:"), err);
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