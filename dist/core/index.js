// src/config.ts
import { dirname, join as join3 } from "path";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";

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

// src/constants.ts
import { homedir as homedir2 } from "os";
import { join as join2 } from "path";

// package.json
var package_default = {
  name: "@jacobbd/relay-ai",
  version: "0.9.3",
  publishConfig: {
    access: "public"
  },
  description: "Relay any model into any coding agent \u2014 launch Claude Code, Codex, and more with multi-provider gateways",
  author: "jacob-bd",
  license: "MIT",
  repository: {
    type: "git",
    url: "git+https://github.com/jacob-bd/relay-ai.git"
  },
  homepage: "https://github.com/jacob-bd/relay-ai#readme",
  keywords: [
    "claude",
    "claude-code",
    "codex",
    "ai",
    "llm",
    "cli",
    "gateway",
    "relay",
    "vertex"
  ],
  type: "module",
  bin: {
    "relay-ai": "dist/cli.js"
  },
  files: [
    "dist",
    "README.md"
  ],
  engines: {
    node: ">=18"
  },
  scripts: {
    build: "tsup && tsup --config tsup.core.config.ts && node scripts/copy-ui-assets.mjs",
    dev: "tsup --watch",
    test: 'vitest run --exclude "tests/debug-*.test.ts"',
    "test:live": "vitest run tests/debug-xai.test.ts tests/debug-openai-oauth.test.ts",
    "test:watch": "vitest",
    typecheck: "tsc --noEmit",
    "release:check": "node scripts/release-metadata.mjs",
    "refresh:models-dev": "node scripts/refresh-models-dev-cache.mjs",
    prepublishOnly: "npm run release:check && npm run build"
  },
  dependencies: {
    "@ai-sdk/alibaba": "^1.0.26",
    "@ai-sdk/amazon-bedrock": "^4.0.113",
    "@ai-sdk/azure": "^3.0.70",
    "@ai-sdk/cerebras": "^2.0.54",
    "@ai-sdk/cohere": "^3.0.36",
    "@ai-sdk/deepinfra": "^2.0.52",
    "@ai-sdk/gateway": "^3.0.125",
    "@ai-sdk/google": "^3.0.80",
    "@ai-sdk/google-vertex": "^4.0.142",
    "@ai-sdk/groq": "^3.0.39",
    "@ai-sdk/mistral": "^3.0.37",
    "@ai-sdk/openai": "^3.0.68",
    "@ai-sdk/openai-compatible": "^2.0.48",
    "@ai-sdk/perplexity": "^3.0.33",
    "@ai-sdk/togetherai": "^2.0.53",
    "@ai-sdk/vercel": "^2.0.50",
    "@ai-sdk/xai": "^3.0.93",
    "@clack/prompts": "^0.9.1",
    "@openrouter/ai-sdk-provider": "^2.9.0",
    ai: "^6.0.197",
    "cross-spawn": "^7.0.6",
    "gitlab-ai-provider": "^6.8.0",
    graphql: "^16.14.2",
    "ipaddr.js": "^2.4.0",
    "node-forge": "^1.4.0",
    open: "^11.0.0",
    picocolors: "^1.1.1",
    "smol-toml": "^1.6.1",
    "venice-ai-sdk-provider": "^2.0.2",
    ws: "^8.21.0",
    zod: "^3.25.76"
  },
  devDependencies: {
    "@types/cross-spawn": "^6.0.6",
    "@types/node": "^22.0.0",
    "@types/node-forge": "^1.3.14",
    "@types/ws": "^8.18.1",
    "@vitest/coverage-v8": "^4.1.10",
    tsup: "^8.0.0",
    typescript: "^5.5.0",
    "vite-node": "^6.0.0",
    vitest: "^4.1.10"
  },
  optionalDependencies: {
    "@napi-rs/keyring": "^1.3.0"
  },
  overrides: {
    ws: "^8.21.0"
  },
  exports: {
    "./core": {
      types: "./dist/core/index.d.ts",
      import: "./dist/core/index.js",
      default: "./dist/core/index.js"
    },
    "./package.json": "./package.json"
  }
};

// src/constants.ts
var CODEX_RESPONSES_LITE_WS_URL = "wss://chatgpt.com/backend-api/codex/responses";
var CODEX_RESPONSES_LITE_VERSION = "0.144.1";
var CODEX_RESPONSES_WEBSOCKETS_BETA = "responses_websockets=2026-02-06";
var OPENCODE_CACHE_PATH = join2(homedir2(), ".cache", "opencode", "models.json");
var CODEX_SUBAGENT_MODEL_CAP = 1;
var VERTEX_ANTHROPIC_NPM = "@ai-sdk/google-vertex/anthropic";
var VERSION = package_default.version;

// src/config.ts
function readJsonFile(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
function ensureAppHomeMigrated() {
  const configPath = getConfigPath();
  if (existsSync(configPath)) return;
  const legacyConfig = join3(getLegacyAppHome(), "config.json");
  if (!existsSync(legacyConfig)) return;
  mkdirSync(getAppHome(), { recursive: true, mode: 448 });
  copyFileSync(legacyConfig, configPath);
  const legacyVertex = join3(getLegacyAppHome(), "vertex-models.json");
  const vertexPath = join3(getAppHome(), "vertex-models.json");
  if (existsSync(legacyVertex) && !existsSync(vertexPath)) {
    copyFileSync(legacyVertex, vertexPath);
  }
}
function ensureConfigMigrated() {
  ensureAppHomeMigrated();
  const configPath = getConfigPath();
  if (existsSync(configPath)) return;
  const legacyPath = getLegacyConfPath();
  if (!existsSync(legacyPath)) return;
  const legacy = readJsonFile(legacyPath);
  if (!legacy) return;
  mkdirSync(dirname(configPath), { recursive: true, mode: 448 });
  writeFileSync(configPath, `${JSON.stringify(legacy, null, 2)}
`, { encoding: "utf8", mode: 384 });
  try {
    renameSync(legacyPath, `${legacyPath}.migrated`);
  } catch {
  }
}
function readConfig() {
  ensureConfigMigrated();
  return readJsonFile(getConfigPath()) ?? {};
}
function loadPreferences() {
  const config = readConfig();
  const lastProvider = config.lastProvider === "opencode" ? "zen" : config.lastProvider;
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
    lastClaudeTransparentMode: config.lastClaudeTransparentMode,
    recentModelsByProvider: config.recentModelsByProvider,
    favoriteModels: config.favoriteModels,
    codexSubagentModels: Array.isArray(config.codexSubagentModels) ? config.codexSubagentModels.slice(0, CODEX_SUBAGENT_MODEL_CAP) : void 0,
    antigravityCliFavoriteModels: config.antigravityCliFavoriteModels,
    antigravityCliFavoritesHintShown: config.antigravityCliFavoritesHintShown,
    appPathOverrides: config.appPathOverrides,
    recentLaunchFolders: config.recentLaunchFolders,
    server: config.server
  };
}

// src/provider-factory.ts
import { wrapLanguageModel, extractReasoningMiddleware } from "ai";

// src/oauth/refresh-http.ts
async function postOAuthRefresh(url, body, options) {
  const isJson = options.contentType === "json";
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": isJson ? "application/json" : "application/x-www-form-urlencoded",
      Accept: "application/json",
      ...options.headers
    },
    body: isJson ? JSON.stringify(body) : body.toString()
  });
  if (!response.ok) {
    const detail = options.includeBody ? await response.text().catch(() => "") : "";
    const status = options.includeStatus ? ` (${response.status})` : "";
    throw new Error(`${options.errorPrefix}${status}${detail ? `: ${detail}` : ""}`);
  }
  return response.json();
}

// src/oauth/openai.ts
var CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
var ISSUER = "https://auth.openai.com";
var DEVICE_CODE_DEFAULT_EXPIRES_MS = 5 * 60 * 1e3;
function extractOpenAiAccountId(tokens) {
  const token = tokens.id_token ?? tokens.access_token;
  if (!token) return void 0;
  const parts = token.split(".");
  if (parts.length !== 3) return void 0;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    return claims.chatgpt_account_id ?? claims["https://api.openai.com/auth"]?.chatgpt_account_id ?? claims.organizations?.[0]?.id;
  } catch {
    return void 0;
  }
}
async function refreshOpenAiAccessToken(refreshToken) {
  return postOAuthRefresh(
    `${ISSUER}/oauth/token`,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID
    }),
    {
      contentType: "form",
      errorPrefix: "OpenAI token refresh failed",
      includeStatus: true
    }
  );
}

// src/oauth/responses-websocket.ts
var RESPONSES_LITE_HEADER = "x-openai-internal-codex-responses-lite";
var TERMINAL_EVENT_TYPES = /* @__PURE__ */ new Set(["response.completed", "response.failed", "response.incomplete", "error"]);
function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function recordKeys(value) {
  return isRecord(value) ? Object.keys(value).sort().join(",") : "";
}
function summarizeResponsesLiteEvent(event) {
  if (!isRecord(event)) return `kind=${event == null ? "null" : typeof event}`;
  const parts = [`type=${typeof event.type === "string" ? event.type : "unknown"}`, `keys=${recordKeys(event)}`];
  if (typeof event.delta === "string") parts.push(`deltaChars=${event.delta.length}`);
  if (typeof event.output_index === "number") parts.push(`hasOutputIndex=1`);
  if (typeof event.item_id === "string") parts.push(`hasItemId=1`);
  if (isRecord(event.item)) {
    parts.push(`itemType=${typeof event.item.type === "string" ? event.item.type : "unknown"}`);
    parts.push(`itemKeys=${recordKeys(event.item)}`);
    if (typeof event.item.arguments === "string") parts.push(`argumentsChars=${event.item.arguments.length}`);
  }
  if (isRecord(event.response)) {
    parts.push(`responseKeys=${recordKeys(event.response)}`);
    if (Array.isArray(event.response.output)) {
      parts.push(`outputCount=${event.response.output.length}`);
      parts.push(`outputTypes=${event.response.output.map((item) => isRecord(item) && typeof item.type === "string" ? item.type : "unknown").join(",")}`);
    }
    if (isRecord(event.response.usage)) parts.push(`usageKeys=${recordKeys(event.response.usage)}`);
    if (typeof event.response.status === "string") parts.push(`status=${event.response.status}`);
  }
  if (isRecord(event.error)) {
    parts.push(`errorKeys=${recordKeys(event.error)}`);
    if (typeof event.error.message === "string") parts.push(`messageChars=${event.error.message.length}`);
  }
  return parts.join(" ");
}
function createResponsesLiteNormalizeState() {
  return {
    nextId: 1,
    lastOutputIndex: 0,
    textDeltaForwarded: false,
    messageAddedIds: /* @__PURE__ */ new Set(),
    messageDoneIds: /* @__PURE__ */ new Set(),
    functionCalls: []
  };
}
function nextId(state, prefix) {
  const id = `${prefix}_${state.nextId}`;
  state.nextId += 1;
  return id;
}
function asString(value) {
  return typeof value === "string" && value.length > 0 ? value : void 0;
}
function normalizeErrorEvent(event) {
  const raw = isRecord(event.error) ? event.error : { message: typeof event.error === "string" ? event.error : "upstream error" };
  return {
    type: "error",
    sequence_number: typeof event.sequence_number === "number" ? event.sequence_number : 0,
    error: {
      type: asString(raw.type) ?? "server_error",
      code: asString(raw.code) ?? "unknown",
      message: asString(raw.message) ?? "upstream error",
      ...raw.param == null ? {} : { param: raw.param }
    }
  };
}
function resolveFunctionCall(state, hint) {
  if (hint.callId) {
    const byCallId = state.functionCalls.find((entry2) => entry2.callId === hint.callId);
    if (byCallId) return byCallId;
  }
  if (hint.itemId) {
    const byItemId = state.functionCalls.find((entry2) => entry2.itemId === hint.itemId);
    if (byItemId) return byItemId;
  }
  if (hint.outputIndex !== void 0) {
    const open3 = [...state.functionCalls].reverse().find((entry2) => entry2.outputIndex === hint.outputIndex && !entry2.done && !(hint.callId && entry2.callId !== hint.callId));
    if (open3) return open3;
  }
  if (hint.callId === void 0 && hint.itemId === void 0 && hint.outputIndex === void 0 && state.lastFunctionCall) {
    return state.lastFunctionCall;
  }
  const entry = {
    itemId: hint.itemId ?? nextId(state, "fc"),
    callId: hint.callId ?? hint.itemId ?? nextId(state, "call"),
    name: "",
    args: "",
    upstream: {},
    outputIndex: hint.outputIndex ?? state.lastOutputIndex,
    added: false,
    deltaForwarded: false,
    doneSeen: false,
    done: false
  };
  state.functionCalls.push(entry);
  return entry;
}
function absorbFunctionItem(entry, item, authoritative) {
  entry.upstream = { ...entry.upstream, ...item };
  const name = asString(item.name);
  if (name) entry.name = name;
  const callId = asString(item.call_id);
  if (callId) entry.callId = callId;
  if (authoritative && typeof item.arguments === "string") entry.upstreamArgs = item.arguments;
}
function resolveFunctionArgs(entry) {
  if (entry.upstreamArgs) return entry.upstreamArgs;
  if (entry.args) return entry.args;
  return entry.upstreamArgs;
}
function functionItemPayload(entry, extra) {
  return {
    ...entry.upstream,
    type: "function_call",
    id: entry.itemId,
    call_id: entry.callId,
    name: entry.name,
    ...extra
  };
}
function functionAddedEvent(entry) {
  entry.added = true;
  return {
    type: "response.output_item.added",
    output_index: entry.outputIndex,
    item: functionItemPayload(entry, { arguments: "" })
  };
}
function functionDoneEvent(entry, args) {
  entry.done = true;
  return {
    type: "response.output_item.done",
    output_index: entry.outputIndex,
    item: functionItemPayload(entry, { arguments: args, status: "completed" })
  };
}
function completeFunctionCall(entry, args) {
  if (entry.done) return [];
  const events = [];
  if (!entry.added) events.push(functionAddedEvent(entry));
  if (!entry.deltaForwarded && args.length > 0) {
    entry.deltaForwarded = true;
    events.push({
      type: "response.function_call_arguments.delta",
      item_id: entry.itemId,
      output_index: entry.outputIndex,
      delta: args
    });
  }
  events.push(functionDoneEvent(entry, args));
  return events;
}
function messageText(item) {
  if (typeof item.text === "string") return item.text;
  if (!Array.isArray(item.content)) return "";
  let out = "";
  for (const part of item.content) {
    if (isRecord(part) && typeof part.text === "string" && (part.type === "output_text" || part.type === "text")) {
      out += part.text;
    }
  }
  return out;
}
function synthesizeMessage(item, outputIndex, state) {
  const text = messageText(item);
  if (!text) return [];
  const id = asString(item.id) ?? nextId(state, "msg");
  state.lastMessageItemId = id;
  state.textDeltaForwarded = true;
  state.messageAddedIds.add(id);
  state.messageDoneIds.add(id);
  return [
    { type: "response.output_item.added", output_index: outputIndex, item: { type: "message", id } },
    { type: "response.output_text.delta", item_id: id, delta: text },
    { type: "response.output_item.done", output_index: outputIndex, item: { type: "message", id } }
  ];
}
function synthesizeFunctionCall(item, outputIndex, state) {
  const entry = resolveFunctionCall(state, {
    itemId: asString(item.id),
    callId: asString(item.call_id),
    outputIndex
  });
  absorbFunctionItem(entry, item, true);
  state.lastFunctionCall = entry;
  state.lastOutputIndex = entry.outputIndex;
  const args = resolveFunctionArgs(entry);
  if (args === void 0) {
    entry.doneSeen = true;
    return [];
  }
  return completeFunctionCall(entry, args);
}
function recoverFromCompletedOutput(response, state) {
  const recovered = [];
  if (Array.isArray(response.output)) {
    response.output.forEach((item, index) => {
      if (!isRecord(item) || typeof item.type !== "string") return;
      if (item.type === "message" && !state.textDeltaForwarded) {
        recovered.push(...synthesizeMessage(item, index, state));
      } else if (item.type === "function_call") {
        recovered.push(...synthesizeFunctionCall(item, index, state));
      }
    });
  }
  for (const entry of state.functionCalls) {
    if (entry.done || !entry.doneSeen) continue;
    recovered.push(normalizeErrorEvent({
      error: {
        type: "invalid_response",
        code: "incomplete_function_call",
        message: `Provider ended the response without arguments for function call "${entry.callId}"${entry.name ? ` (${entry.name})` : ""}.`
      }
    }));
  }
  return recovered;
}
function normalizeResponsesLiteEvent(event, state) {
  if (!isRecord(event) || typeof event.type !== "string") return [event];
  if (event.type === "error") return [normalizeErrorEvent(event)];
  if (event.type === "response.output_item.added" && isRecord(event.item)) {
    const outputIndex = typeof event.output_index === "number" ? event.output_index : state.lastOutputIndex;
    state.lastOutputIndex = outputIndex;
    if (event.item.type === "message") {
      const id = asString(event.item.id) ?? nextId(state, "msg");
      state.lastMessageItemId = id;
      state.messageAddedIds.add(id);
      return [{ ...event, output_index: outputIndex, item: { ...event.item, id } }];
    }
    if (event.item.type === "function_call") {
      const entry = resolveFunctionCall(state, {
        itemId: asString(event.item.id),
        callId: asString(event.item.call_id),
        outputIndex
      });
      absorbFunctionItem(entry, event.item, false);
      entry.outputIndex = outputIndex;
      entry.added = true;
      state.lastFunctionCall = entry;
      return [{ ...event, output_index: outputIndex, item: functionItemPayload(entry, { arguments: "" }) }];
    }
    return [{ ...event, output_index: outputIndex }];
  }
  if (event.type === "response.output_item.done" && isRecord(event.item)) {
    const outputIndex = typeof event.output_index === "number" ? event.output_index : state.lastOutputIndex;
    if (event.item.type === "function_call") {
      const entry = resolveFunctionCall(state, {
        itemId: asString(event.item.id),
        callId: asString(event.item.call_id),
        outputIndex
      });
      absorbFunctionItem(entry, event.item, true);
      entry.outputIndex = outputIndex;
      entry.doneSeen = true;
      state.lastFunctionCall = entry;
      state.lastOutputIndex = outputIndex;
      const args = resolveFunctionArgs(entry);
      if (args === void 0 || !entry.name) return [];
      if (entry.done) return [];
      const events = [];
      if (!entry.added) events.push(functionAddedEvent(entry));
      events.push({ ...event, output_index: outputIndex, item: functionItemPayload(entry, { arguments: args, status: "completed" }) });
      entry.done = true;
      return events;
    }
    if (event.item.type === "message") {
      const id = asString(event.item.id) ?? state.lastMessageItemId ?? nextId(state, "msg");
      state.lastMessageItemId = id;
      state.messageDoneIds.add(id);
      return [{ ...event, output_index: outputIndex, item: { ...event.item, id } }];
    }
    return [{ ...event, output_index: outputIndex }];
  }
  if (event.type === "response.output_text.delta") {
    const itemId = asString(event.item_id) ?? state.lastMessageItemId ?? nextId(state, "msg");
    state.lastMessageItemId = itemId;
    state.textDeltaForwarded = true;
    const events = [];
    if (!state.messageAddedIds.has(itemId)) {
      events.push({
        type: "response.output_item.added",
        output_index: state.lastOutputIndex,
        item: { type: "message", id: itemId }
      });
      state.messageAddedIds.add(itemId);
    }
    events.push({ ...event, item_id: itemId, delta: typeof event.delta === "string" ? event.delta : "" });
    return events;
  }
  if (event.type === "response.function_call_arguments.delta") {
    const entry = resolveFunctionCall(state, {
      itemId: asString(event.item_id),
      outputIndex: typeof event.output_index === "number" ? event.output_index : void 0
    });
    const delta = typeof event.delta === "string" ? event.delta : "";
    entry.args += delta;
    entry.deltaForwarded = true;
    state.lastFunctionCall = entry;
    state.lastOutputIndex = entry.outputIndex;
    return [{ ...event, item_id: entry.itemId, output_index: entry.outputIndex, delta }];
  }
  if (event.type === "response.completed" || event.type === "response.incomplete") {
    const response = isRecord(event.response) ? event.response : {};
    const recovered = recoverFromCompletedOutput(response, state);
    if (state.lastMessageItemId && state.textDeltaForwarded && !state.messageDoneIds.has(state.lastMessageItemId)) {
      recovered.push({
        type: "response.output_item.done",
        output_index: state.lastOutputIndex,
        item: { type: "message", id: state.lastMessageItemId }
      });
      state.messageDoneIds.add(state.lastMessageItemId);
    }
    return [...recovered, event];
  }
  return [event];
}
function toHeaderRecord(headers) {
  const out = {};
  if (!headers) return out;
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      out[key] = value;
    });
  } else if (Array.isArray(headers)) {
    for (const [key, value] of headers) out[key] = value;
  } else {
    for (const [key, value] of Object.entries(headers)) out[key] = String(value);
  }
  return out;
}
function hasResponsesLiteHeader(headers) {
  return Object.entries(headers).some(
    ([k, v]) => k.toLowerCase() === RESPONSES_LITE_HEADER && v.toLowerCase() === "true"
  );
}
function bodyToString(body) {
  if (body == null) return "";
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return Buffer.from(body).toString("utf8");
  if (body instanceof ArrayBuffer) return Buffer.from(new Uint8Array(body)).toString("utf8");
  return String(body);
}
function applyResponsesLiteShape(payload) {
  const reasoning = payload.reasoning && typeof payload.reasoning === "object" ? { ...payload.reasoning } : {};
  reasoning.context = "all_turns";
  return {
    ...payload,
    reasoning,
    parallel_tool_calls: false,
    store: false
  };
}
function createResponsesWebSocketFetch(wsUrl, log) {
  const debug = (msg) => {
    try {
      log?.(`ws: ${msg}`);
    } catch {
    }
  };
  return async (_input, init) => {
    const { WebSocket } = await import("ws");
    const headers = toHeaderRecord(init?.headers);
    headers["OpenAI-Beta"] = CODEX_RESPONSES_WEBSOCKETS_BETA;
    debug(`connecting ${wsUrl} headers=[${Object.keys(headers).join(", ")}]`);
    let payload = {};
    try {
      payload = JSON.parse(bodyToString(init?.body));
    } catch {
      payload = {};
    }
    if (hasResponsesLiteHeader(headers)) {
      payload = applyResponsesLiteShape(payload);
    }
    debug(
      `request type=response.create keys=${Object.keys(payload).sort().join(",")} toolCount=${Array.isArray(payload.tools) ? payload.tools.length : 0} store=${String(payload.store)} parallelToolCalls=${String(payload.parallel_tool_calls)} reasoningKeys=${recordKeys(payload.reasoning)}`
    );
    const outgoing = JSON.stringify({ type: "response.create", ...payload });
    const encoder = new TextEncoder();
    let socket;
    let frameCount = 0;
    const normalizeState = createResponsesLiteNormalizeState();
    const stream = new ReadableStream({
      start(controller) {
        let closed = false;
        const close = () => {
          if (closed) return;
          closed = true;
          try {
            controller.close();
          } catch {
          }
          try {
            socket.close();
          } catch {
          }
        };
        const fail = (message) => {
          if (closed) return;
          debug(`fail messageChars=${message.length}`);
          try {
            const [errorEvent] = normalizeResponsesLiteEvent({ type: "error", error: { message } }, normalizeState);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorEvent)}

`));
          } catch {
          }
          close();
        };
        socket = new WebSocket(wsUrl, { headers });
        socket.on("open", () => {
          debug(`open \u2014 sending ${outgoing.length}B payload`);
          socket.send(outgoing);
        });
        socket.on("unexpected-response", (_req, res) => {
          debug(`unexpected-response status=${res.statusCode}`);
        });
        socket.on("message", (data) => {
          const text = Array.isArray(data) ? Buffer.concat(data).toString("utf8") : data.toString("utf8");
          frameCount += 1;
          let event;
          try {
            event = JSON.parse(text);
          } catch {
            debug(`frame#${frameCount} non-json chars=${text.length}`);
            controller.enqueue(encoder.encode(`data: ${text.replace(/\r?\n/g, " ")}

`));
            return;
          }
          if (frameCount <= 8) debug(`frame#${frameCount} ${summarizeResponsesLiteEvent(event)}`);
          for (const next of normalizeResponsesLiteEvent(event, normalizeState)) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(next)}

`));
          }
          const type = isRecord(event) && typeof event.type === "string" ? event.type : void 0;
          if (type && TERMINAL_EVENT_TYPES.has(type)) {
            debug(`terminal event: ${type} (after ${frameCount} frames)`);
            close();
          }
        });
        socket.on("error", (err) => fail(err.message));
        socket.on("close", (code, reason) => {
          debug(`close code=${code} frames=${frameCount}${reason?.length ? ` reasonChars=${reason.length}` : ""}`);
          if (closed) return;
          if (code === 1e3 || code === 1005) {
            close();
            return;
          }
          fail(`WebSocket closed (${code})${reason?.length ? `: ${reason.toString("utf8")}` : ""}`);
        });
        const signal = init?.signal;
        if (signal) {
          if (signal.aborted) {
            close();
            return;
          }
          signal.addEventListener("abort", close, { once: true });
        }
      },
      cancel() {
        try {
          socket?.close();
        } catch {
        }
      }
    });
    return new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream; charset=utf-8" }
    });
  };
}

// src/oauth/claude-identity.ts
import { createHash, randomUUID } from "crypto";
var CLAUDE_CODE_CLI_VERSION = "2.1.195";
var CLAUDE_CODE_USER_AGENT = `claude-cli/${CLAUDE_CODE_CLI_VERSION} (external, cli)`;
var CLAUDE_CODE_ENTRYPOINT = process.env.CLAUDE_CODE_ENTRYPOINT ?? "cli";
var sessionCache = /* @__PURE__ */ new Map();
function getOrCreateSessionId(seed) {
  let id = sessionCache.get(seed);
  if (!id) {
    id = randomUUID();
    sessionCache.set(seed, id);
  }
  return id;
}
function uuidFromHash(input) {
  const h = createHash("sha256").update(input).digest("hex");
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    "4" + h.slice(13, 16),
    (parseInt(h[16], 16) & 3 | 8).toString(16) + h.slice(17, 20),
    h.slice(20, 32)
  ].join("-");
}
var HEX64_RE = /^[a-f0-9]{64}$/i;
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function resolveCliUserID(providerData, seed) {
  const v = providerData?.cliUserID;
  if (typeof v === "string" && HEX64_RE.test(v)) return v;
  return createHash("sha256").update(`cliUserID:${seed}`).digest("hex");
}
function resolveAccountUUID(providerData, seed) {
  const v = providerData?.accountUUID;
  if (typeof v === "string" && UUID_RE.test(v)) return v;
  return uuidFromHash(`account:${seed}`);
}
function buildUserIdJson(deviceId, accountUUID, sessionId) {
  return JSON.stringify({ device_id: deviceId, account_uuid: accountUUID, session_id: sessionId });
}
function injectClaudeIdentity(body, providerData, seed) {
  const deviceId = resolveCliUserID(providerData, seed);
  const accountUUID = resolveAccountUUID(providerData, seed);
  const sessionId = getOrCreateSessionId(seed);
  const userId = buildUserIdJson(deviceId, accountUUID, sessionId);
  const existing = body.metadata;
  body.metadata = { ...existing ?? {}, user_id: userId };
  return { sessionId, userId };
}

// src/cline-pass.ts
var CLINE_PASS_HOST = "https://api.cline.bot";
var CLINE_PASS_SDK_BASE_URL = `${CLINE_PASS_HOST}/api/v1`;
var CLINE_PASS_CATALOG_URL = `${CLINE_PASS_HOST}/api/v1/ai/cline/recommended-models`;
var CLINE_PASS_VALIDATION_URL = `${CLINE_PASS_HOST}/api/v1/users/me`;
var CLINE_PASS_REGISTER_URL = `${CLINE_PASS_HOST}/api/v1/auth/register`;
var CLINE_PASS_REFRESH_URL = `${CLINE_PASS_HOST}/api/v1/auth/refresh`;
var CLINE_PASS_WORKOS_PREFIX = "workos:";
function isClinePassOAuth(providerId, authType) {
  return providerId === "cline-pass" && authType === "oauth";
}
function formatClineRuntimeCredential(providerId, authType, key) {
  if (!isClinePassOAuth(providerId, authType)) return key;
  return key.toLowerCase().startsWith(CLINE_PASS_WORKOS_PREFIX) ? key : `${CLINE_PASS_WORKOS_PREFIX}${key}`;
}
function createClinePassOAuthFetch(initialRuntimeCredential, refreshToken, onTokenRefreshed, fetchImpl = globalThis.fetch) {
  let currentRuntimeCredential = initialRuntimeCredential;
  return async (input, init) => {
    const request = new Request(input, init);
    const send = (runtimeCredential) => {
      const headers = new Headers(request.headers);
      headers.set("Authorization", `Bearer ${runtimeCredential}`);
      return fetchImpl(request.clone(), { headers });
    };
    const response = await send(currentRuntimeCredential);
    if (response.status !== 401) return response;
    const refreshedRawToken = await refreshToken().catch(() => null);
    const refreshedRuntimeCredential = refreshedRawToken ? formatClineRuntimeCredential("cline-pass", "oauth", refreshedRawToken) : null;
    if (!refreshedRawToken || !refreshedRuntimeCredential || refreshedRuntimeCredential === currentRuntimeCredential) {
      return response;
    }
    currentRuntimeCredential = refreshedRuntimeCredential;
    onTokenRefreshed?.(refreshedRawToken);
    return send(currentRuntimeCredential);
  };
}

// src/provider-factory.ts
var RESPONSES_ONLY_PREFIXES = [
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
  const gpt5Minor = lower.match(/^gpt-5\.(\d+)(?:-|$)/);
  if (gpt5Minor && Number(gpt5Minor[1]) >= 4) return true;
  if (lower.startsWith("gpt-") && lower.includes("-codex")) return true;
  if (lower.startsWith("grok-") && (lower.includes("multi-agent") || lower.includes("multiagent"))) return true;
  return false;
}
var OPENAI_CHAT_COMPLETIONS_ONLY = [
  "davinci-002",
  "babbage-002",
  "gpt-3.5-turbo-instruct"
];
function shouldUseOpenAiResponsesEndpoint(modelId) {
  return !OPENAI_CHAT_COMPLETIONS_ONLY.includes(modelId.toLowerCase());
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
    const accountId = spec.authType === "oauth" ? spec.oauthAccountId ?? extractOpenAiAccountId({ access_token: apiKey }) : void 0;
    const oauthOptions = spec.authType === "oauth" ? {
      apiKey,
      baseURL: "https://chatgpt.com/backend-api/codex",
      headers: {
        ...accountId ? { "ChatGPT-Account-Id": accountId } : {},
        originator: "relay-ai",
        // Responses-Lite models (backend prefer_websockets/use_responses_lite,
        // e.g. gpt-5.6-luna) require these on the request.
        ...spec.useResponsesLite ? { version: CODEX_RESPONSES_LITE_VERSION, "x-openai-internal-codex-responses-lite": "true" } : {}
      },
      // Models the backend flags with prefer_websockets are only served over
      // the WebSocket Responses transport, not HTTP.
      ...spec.preferWebSockets ? { fetch: createResponsesWebSocketFetch(CODEX_RESPONSES_LITE_WS_URL, spec.onDebug) } : {}
    } : { apiKey };
    const openai = createOpenAI(oauthOptions);
    return shouldUseOpenAiResponsesEndpoint(modelId) ? openai.responses(modelId) : openai.chat(modelId);
  }
  if (npm === "@ai-sdk/xai") {
    const { createXai } = await import("@ai-sdk/xai");
    const xai = createXai({ apiKey });
    return modelPrefersResponsesApi(modelId) ? xai.responses(modelId) : xai(modelId);
  }
  if (npm === "@ai-sdk/google") {
    const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
    const google = createGoogleGenerativeAI({ apiKey });
    return google(modelId);
  }
  if (npm === "@ai-sdk/anthropic") {
    const { createAnthropic } = await import("@ai-sdk/anthropic");
    const root = baseURL?.replace(/\/v1\/?$/, "").replace(/\/$/, "");
    const anthropicOptions = spec.authType === "oauth" ? {
      authToken: apiKey,
      ...spec.providerId === "claude-code" ? {
        headers: {
          "User-Agent": CLAUDE_CODE_USER_AGENT,
          "x-app": "cli",
          "X-Claude-Code-Session-Id": injectClaudeIdentity(
            {},
            spec.providerData,
            spec.oauthAccountId ?? apiKey
          ).sessionId
        }
      } : {}
    } : { apiKey };
    if (spec.headers) {
      anthropicOptions.headers = { ...anthropicOptions.headers, ...spec.headers };
    }
    if (!root || root === "https://api.anthropic.com") {
      return createAnthropic(anthropicOptions)(modelId);
    }
    const sdkBase = baseURL.endsWith("/v1") ? baseURL : `${root}/v1`;
    return createAnthropic({ ...anthropicOptions, baseURL: sdkBase })(modelId);
  }
  let model;
  if (npm === "@ai-sdk/openai-compatible") {
    const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
    const runtimeApiKey = formatClineRuntimeCredential(spec.providerId, spec.authType, apiKey);
    const options = {
      name: spec.providerId ?? "openai-compatible",
      baseURL: baseURL ?? "",
      ...runtimeApiKey.trim() ? { apiKey: runtimeApiKey } : {},
      ...spec.headers ? { headers: spec.headers } : {},
      ...isClinePassOAuth(spec.providerId, spec.authType) && spec.refreshToken ? {
        fetch: createClinePassOAuthFetch(
          runtimeApiKey,
          spec.refreshToken,
          spec.onTokenRefreshed
        )
      } : {}
    };
    model = createOpenAICompatible({
      ...options
    })(modelId);
  } else if (npm === "@openrouter/ai-sdk-provider") {
    const { createOpenRouter } = await import("@openrouter/ai-sdk-provider");
    model = createOpenRouter({ apiKey, baseURL, ...spec.headers ? { headers: spec.headers } : {} })(modelId);
  } else {
    const create = await loadSdkProviderFactory(npm);
    const provider = create({
      apiKey,
      ...baseURL ? { baseURL } : {},
      ...spec.headers ? { headers: spec.headers } : {}
    });
    model = provider(modelId);
  }
  const isReasoning = modelId.toLowerCase().match(/deepseek-r1|think|reasoning|qwq/);
  if (isReasoning) {
    return wrapLanguageModel({
      model,
      middleware: [extractReasoningMiddleware({ tagName: "think" })]
    });
  }
  return model;
}
var ANTHROPIC_EFFORT_LEVELS = ["low", "medium", "high"];
var OPENAI_EFFORT_LEVELS = ["low", "medium", "high"];
var GEMINI_EFFORT_LEVELS = ["low", "medium", "high"];
var MISTRAL_EFFORT_LEVELS = ["high", "off"];
var XAI_CHAT_EFFORT_LEVELS = ["low", "high"];
var XAI_RESPONSES_EFFORT_LEVELS = ["low", "medium", "high"];
var OPENROUTER_EFFORT_LEVELS = ["none", "minimal", "low", "medium", "high", "xhigh"];
var DEEPSEEK_EFFORT_LEVELS = ["high", "max", "off"];
var GLM_52_EFFORT_LEVELS = ["high", "xhigh"];
var EMPTY_REASONING = {
  levels: [],
  defaultLevel: "",
  supportsSummaries: false,
  mode: "none",
  source: "none",
  confidence: "inferred"
};
var GEMINI_25_BUDGETS = {
  low: 1024,
  medium: 4096,
  high: 8192,
  xhigh: 16384,
  max: 16384,
  minimal: 512,
  none: 0
};
function isClaudeReasoningModel(modelId) {
  const lower = modelId.toLowerCase();
  if (!lower.startsWith("claude-")) return false;
  if (lower.includes("fable") || lower.includes("mythos")) return true;
  const m = lower.match(/claude-(?:opus|sonnet|haiku)-(\d+)-(\d+)/);
  if (!m) return false;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  return major > 4 || major === 4 && minor >= 6;
}
function isGeminiReasoningModel(modelId) {
  const lower = modelId.toLowerCase();
  return lower.startsWith("gemini-2.5-") || lower.startsWith("gemini-3") || lower.startsWith("gemini-3.");
}
function isGemini3Model(modelId) {
  const lower = modelId.toLowerCase();
  return lower.startsWith("gemini-3") || lower.startsWith("gemini-3.");
}
function isMistralReasoningModel(modelId) {
  const lower = modelId.toLowerCase();
  return lower.startsWith("mistral-") || lower.startsWith("magistral-") || lower.startsWith("ministral-") || lower.includes("reasoning");
}
function isXaiReasoningEffortModel(modelId) {
  const lower = modelId.toLowerCase();
  if (lower.includes("non-reasoning")) return false;
  if (lower.startsWith("grok-build")) return false;
  if (lower.startsWith("grok-imagine")) return false;
  if (modelPrefersResponsesApi(modelId)) return true;
  if (lower === "grok-4.3" || lower.startsWith("grok-4.3-")) return true;
  if (lower === "grok-4.5" || lower.startsWith("grok-4.5-")) return true;
  if (lower.includes("-reasoning")) return true;
  return false;
}
function xaiDefaultReasoningEffort(modelId) {
  const lower = modelId.toLowerCase();
  if (lower === "grok-4.5" || lower.startsWith("grok-4.5-")) return "high";
  return "low";
}
function isDeepSeekReasoningModel(modelId) {
  const lower = modelId.toLowerCase();
  return lower === "deepseek-v4-flash" || lower === "deepseek-v4-pro" || lower.startsWith("deepseek-v4-flash-") || lower.startsWith("deepseek-v4-pro-") || lower === "deepseek-reasoner" || lower === "deepseek-chat";
}
function isKimiReasoningModel(modelId) {
  const lower = modelId.toLowerCase();
  return lower.startsWith("kimi-");
}
function isGlm52ReasoningModel(modelId) {
  const lower = modelId.toLowerCase();
  return lower === "glm-5.2" || lower === "z-ai/glm-5.2" || lower === "zai/glm-5.2" || lower === "zai-org/glm-5.2" || lower === "zai-org/glm5.2" || lower === "glm5.2";
}
function toCamelCase(str) {
  return str.replace(/[-_]([a-z])/g, (_, g) => g.toUpperCase());
}
function hasSupportedParameter(metadata, param) {
  return (metadata?.supportedParameters ?? []).some((p) => p === param);
}
function isOpenRouterRoute(npm, metadata) {
  return npm === "@openrouter/ai-sdk-provider" || metadata?.providerId === "openrouter" || metadata?.apiBaseUrl?.includes("openrouter.ai") === true;
}
function openRouterReasoningCapabilities(metadata) {
  if (metadata?.supportedParameters && !hasSupportedParameter(metadata, "reasoning")) {
    return {
      ...EMPTY_REASONING,
      source: "provider-metadata",
      confidence: "documented"
    };
  }
  if (hasSupportedParameter(metadata, "reasoning")) {
    return {
      levels: [...OPENROUTER_EFFORT_LEVELS],
      defaultLevel: "medium",
      supportsSummaries: false,
      mode: "controllable",
      source: "provider-metadata",
      confidence: "documented",
      wireFormat: { kind: "openrouter-reasoning" }
    };
  }
  if (metadata?.reasoning) {
    return {
      ...EMPTY_REASONING,
      mode: "internal-only",
      source: "model-metadata",
      confidence: "inferred"
    };
  }
  return EMPTY_REASONING;
}
function mapCodexEffortToDeepSeek(effort) {
  switch (effort) {
    case "off":
    case "none":
      return "off";
    case "low":
    case "medium":
    case "high":
      return "high";
    case "xhigh":
    case "max":
      return "max";
    default:
      if (effort === "high" || effort === "max") return effort;
      return void 0;
  }
}
function deepSeekEffortProviderOptions(effort) {
  const mapped = mapCodexEffortToDeepSeek(effort);
  if (!mapped) return void 0;
  const thinking = { type: mapped === "off" ? "disabled" : "enabled" };
  const spread = { thinking };
  if (mapped === "off") {
    return {
      deepseek: spread,
      openaiCompatible: spread
    };
  }
  return {
    openaiCompatible: { reasoningEffort: mapped, ...spread },
    deepseek: spread
  };
}
function mapCodexEffortToAnthropic(effort) {
  switch (effort) {
    case "none":
    case "minimal":
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
    case "xhigh":
    case "max":
      return effort === "xhigh" ? "high" : effort === "max" ? "max" : "high";
    default:
      if (ANTHROPIC_EFFORT_LEVELS.includes(effort)) {
        return effort;
      }
      return void 0;
  }
}
var OPENAI_MODEL_REASONING = {
  "gpt-5-pro": { levels: ["high"], defaultLevel: "high" },
  "gpt-5.1": { levels: ["none", "low", "medium", "high"], defaultLevel: "none" },
  "gpt-5.1-codex-max": { levels: ["low", "medium", "high", "xhigh"], defaultLevel: "medium" },
  "gpt-5.2": { levels: ["none", "low", "medium", "high", "xhigh"], defaultLevel: "none" },
  "gpt-5.2-codex": { levels: ["low", "medium", "high", "xhigh"], defaultLevel: "medium" },
  "gpt-5.2-pro": { levels: ["medium", "high", "xhigh"], defaultLevel: "medium" },
  "gpt-5.3-codex": { levels: ["low", "medium", "high", "xhigh"], defaultLevel: "medium" },
  "gpt-5.4": { levels: ["none", "low", "medium", "high", "xhigh"], defaultLevel: "none" },
  "gpt-5.4-mini": { levels: ["none", "low", "medium", "high", "xhigh"], defaultLevel: "none" },
  "gpt-5.4-nano": { levels: ["none", "low", "medium", "high", "xhigh"], defaultLevel: "none" },
  "gpt-5.4-pro": { levels: ["medium", "high", "xhigh"], defaultLevel: "medium" },
  "gpt-5.5": { levels: ["none", "low", "medium", "high", "xhigh"], defaultLevel: "medium" },
  "gpt-5.5-pro": { levels: ["medium", "high", "xhigh"], defaultLevel: "high" },
  "gpt-5.6": { levels: ["none", "low", "medium", "high", "xhigh", "max"], defaultLevel: "medium" },
  "gpt-5.6-luna": { levels: ["none", "low", "medium", "high", "xhigh", "max"], defaultLevel: "medium" },
  "gpt-5.6-sol": { levels: ["none", "low", "medium", "high", "xhigh", "max"], defaultLevel: "medium" },
  "gpt-5.6-terra": { levels: ["none", "low", "medium", "high", "xhigh", "max"], defaultLevel: "medium" }
};
var OPENAI_NON_REASONING_MODELS = /* @__PURE__ */ new Set([
  "chat-latest",
  "gpt-5-chat-latest",
  "gpt-5.1-chat-latest",
  "gpt-5.2-chat-latest",
  "gpt-5.3-chat-latest"
]);
var OPENAI_DATED_SNAPSHOT_SUFFIX = /-\d{4}-\d{2}-\d{2}$/;
function canonicalOpenAiModelId(modelId, metadata) {
  return (metadata?.upstreamModelId ?? modelId ?? "").toLowerCase();
}
function openAiReasoningProfile(modelId, metadata) {
  const id = canonicalOpenAiModelId(modelId, metadata);
  if (!id) return void 0;
  return OPENAI_MODEL_REASONING[id] ?? OPENAI_MODEL_REASONING[id.replace(OPENAI_DATED_SNAPSHOT_SUFFIX, "")];
}
function openAiModelReasons(modelId, metadata) {
  const id = canonicalOpenAiModelId(modelId, metadata);
  if (OPENAI_NON_REASONING_MODELS.has(id.replace(OPENAI_DATED_SNAPSHOT_SUFFIX, ""))) return false;
  return !!openAiReasoningProfile(modelId, metadata) || modelPrefersResponsesApi(id) || !!metadata?.reasoning;
}
function mapCodexEffortToOpenAI(effort, allowed) {
  return allowed.includes(effort) ? effort : void 0;
}
function mapCodexEffortToOpenAICompatible(effort) {
  if (effort === "xhigh") return "high";
  const allowed = ["low", "medium", "high"];
  return allowed.includes(effort) ? effort : void 0;
}
function mapCodexEffortToGlm52(effort) {
  switch (effort) {
    case "high":
      return "high";
    case "xhigh":
    case "max":
      return "max";
    default:
      return void 0;
  }
}
function mapCodexEffortToXai(effort, supportsMedium) {
  switch (effort) {
    case "low":
      return "low";
    case "medium":
      return supportsMedium ? "medium" : void 0;
    case "high":
    case "xhigh":
    case "max":
      return "high";
    default:
      return void 0;
  }
}
function mapCodexEffortToGeminiLevel(effort) {
  switch (effort) {
    case "none":
    case "minimal":
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
    case "xhigh":
    case "max":
      return "high";
    default:
      return GEMINI_EFFORT_LEVELS.includes(effort) ? effort : void 0;
  }
}
function mapCodexEffortToGeminiBudget(effort) {
  const direct = GEMINI_25_BUDGETS[effort];
  if (direct !== void 0) return direct > 0 ? direct : void 0;
  const level = mapCodexEffortToGeminiLevel(effort);
  if (!level) return void 0;
  return GEMINI_25_BUDGETS[level];
}
function withMappableLevels(caps, npm, modelId, metadata) {
  if (caps.mode !== "controllable") return caps;
  const seen = /* @__PURE__ */ new Set();
  const levels = caps.levels.filter((level) => {
    const mapped = effortProviderOptions(npm, level, modelId, metadata);
    if (mapped === void 0) return false;
    const wire = JSON.stringify(mapped);
    if (seen.has(wire)) return false;
    seen.add(wire);
    return true;
  });
  if (levels.length === caps.levels.length) return caps;
  if (levels.length === 0) {
    return { ...caps, levels: [], defaultLevel: "", mode: "internal-only" };
  }
  return {
    ...caps,
    levels,
    defaultLevel: levels.includes(caps.defaultLevel) ? caps.defaultLevel : levels[levels.length - 1]
  };
}
function getReasoningCapabilities(npm, modelId, metadata) {
  return withMappableLevels(resolveRawReasoningCapabilities(npm, modelId, metadata), npm, modelId, metadata);
}
function resolveRawReasoningCapabilities(npm, modelId, metadata) {
  const id = modelId.toLowerCase();
  if (isOpenRouterRoute(npm, metadata)) {
    return openRouterReasoningCapabilities(metadata);
  }
  if (npm === "@ai-sdk/anthropic" || id.startsWith("claude-")) {
    const isClaude = isClaudeReasoningModel(modelId);
    if (isClaude || metadata?.reasoning) {
      return {
        levels: [...ANTHROPIC_EFFORT_LEVELS],
        defaultLevel: "high",
        supportsSummaries: true,
        mode: "controllable",
        source: isClaude ? "provider-rule" : "model-metadata",
        confidence: isClaude ? "documented" : "inferred",
        wireFormat: { kind: "anthropic-thinking" }
      };
    }
    return EMPTY_REASONING;
  }
  if (npm === "@ai-sdk/openai" || npm === "@ai-sdk/azure") {
    const canonicalId = canonicalOpenAiModelId(modelId, metadata);
    const profile = openAiReasoningProfile(modelId, metadata);
    const prefersResponses = modelPrefersResponsesApi(canonicalId);
    if (openAiModelReasons(modelId, metadata) && shouldUseOpenAiResponsesEndpoint(canonicalId)) {
      const levels = profile?.levels ?? [...OPENAI_EFFORT_LEVELS];
      return {
        levels: [...levels],
        defaultLevel: profile?.defaultLevel ?? (levels.includes("medium") ? "medium" : levels[levels.length - 1]),
        supportsSummaries: true,
        source: profile || prefersResponses ? "provider-rule" : "model-metadata",
        confidence: profile || prefersResponses ? "documented" : "inferred",
        mode: "controllable",
        wireFormat: { kind: "openai-reasoning-effort" }
      };
    }
    return EMPTY_REASONING;
  }
  if (npm === "@ai-sdk/google" || id.startsWith("gemini-")) {
    if (isGeminiReasoningModel(modelId)) {
      return {
        levels: [...GEMINI_EFFORT_LEVELS],
        defaultLevel: "medium",
        supportsSummaries: true,
        mode: "controllable",
        source: "provider-rule",
        confidence: "documented",
        wireFormat: { kind: "google-thinking-config" }
      };
    }
    return EMPTY_REASONING;
  }
  if (npm === "@ai-sdk/mistral") {
    if (isMistralReasoningModel(modelId)) {
      return {
        levels: [...MISTRAL_EFFORT_LEVELS],
        defaultLevel: "high",
        supportsSummaries: false,
        mode: "controllable",
        source: "provider-rule",
        confidence: "documented",
        wireFormat: { kind: "mistral-reasoning-effort" }
      };
    }
    return EMPTY_REASONING;
  }
  if (npm === "@ai-sdk/xai") {
    if (isXaiReasoningEffortModel(modelId)) {
      const levels = modelPrefersResponsesApi(modelId) ? [...XAI_RESPONSES_EFFORT_LEVELS] : [...XAI_CHAT_EFFORT_LEVELS];
      return {
        levels,
        defaultLevel: xaiDefaultReasoningEffort(modelId),
        supportsSummaries: true,
        mode: "controllable",
        source: "provider-rule",
        confidence: "documented",
        wireFormat: { kind: "openai-reasoning-effort" }
      };
    }
    return EMPTY_REASONING;
  }
  if (isDeepSeekReasoningModel(modelId)) {
    return {
      levels: [...DEEPSEEK_EFFORT_LEVELS],
      defaultLevel: "high",
      supportsSummaries: true,
      mode: "controllable",
      source: "provider-rule",
      confidence: "documented",
      wireFormat: { kind: "deepseek-thinking" }
    };
  }
  if (isKimiReasoningModel(modelId)) {
    return {
      levels: [...OPENAI_EFFORT_LEVELS],
      defaultLevel: "high",
      supportsSummaries: false,
      mode: "controllable",
      source: "provider-rule",
      confidence: "documented",
      wireFormat: { kind: "openai-reasoning-effort" }
    };
  }
  if (isGlm52ReasoningModel(modelId)) {
    return {
      levels: [...GLM_52_EFFORT_LEVELS],
      defaultLevel: "high",
      supportsSummaries: false,
      mode: "controllable",
      source: "provider-rule",
      confidence: "documented",
      wireFormat: { kind: "openai-reasoning-effort" }
    };
  }
  if (hasSupportedParameter(metadata, "reasoning_effort")) {
    return {
      levels: ["low", "medium", "high", "xhigh"],
      defaultLevel: "medium",
      supportsSummaries: false,
      mode: "controllable",
      source: "provider-metadata",
      confidence: "documented",
      wireFormat: { kind: "openai-reasoning-effort" }
    };
  }
  if (hasSupportedParameter(metadata, "reasoning")) {
    return {
      levels: [...OPENROUTER_EFFORT_LEVELS],
      defaultLevel: "medium",
      supportsSummaries: false,
      mode: "controllable",
      source: "provider-metadata",
      confidence: "documented",
      wireFormat: { kind: "openrouter-reasoning" }
    };
  }
  if (metadata?.reasoning) {
    return {
      levels: ["low", "medium", "high"],
      defaultLevel: "medium",
      supportsSummaries: false,
      mode: "controllable",
      source: "model-metadata",
      confidence: "inferred",
      wireFormat: { kind: "openai-reasoning-effort" }
    };
  }
  return EMPTY_REASONING;
}
function effortProviderOptions(npm, effort, modelId, metadata) {
  if (!effort) return void 0;
  if (isOpenRouterRoute(npm, metadata)) {
    const caps = openRouterReasoningCapabilities(metadata);
    if (caps.mode !== "controllable") return void 0;
    const allowed = new Set(OPENROUTER_EFFORT_LEVELS);
    const mapped = allowed.has(effort) ? effort : effort === "max" ? "xhigh" : void 0;
    return mapped ? { openrouter: { reasoning: { effort: mapped, exclude: false } } } : void 0;
  }
  if (npm === "@ai-sdk/openai" || npm === "@ai-sdk/azure") {
    if (!modelId || !shouldUseOpenAiResponsesEndpoint(canonicalOpenAiModelId(modelId, metadata))) return void 0;
    if (!openAiModelReasons(modelId, metadata)) return void 0;
    const allowed = openAiReasoningProfile(modelId, metadata)?.levels ?? OPENAI_EFFORT_LEVELS;
    const reasoningEffort = mapCodexEffortToOpenAI(effort, allowed);
    return reasoningEffort ? { openai: { reasoningEffort } } : void 0;
  }
  if (npm === "@ai-sdk/xai") {
    if (!modelId || !isXaiReasoningEffortModel(modelId)) return void 0;
    const reasoningEffort = mapCodexEffortToXai(effort, modelPrefersResponsesApi(modelId));
    return reasoningEffort ? { xai: { reasoningEffort } } : void 0;
  }
  if (npm === "@ai-sdk/anthropic" || npm === VERTEX_ANTHROPIC_NPM) {
    if (!modelId || !isClaudeReasoningModel(modelId)) return void 0;
    const mapped = mapCodexEffortToAnthropic(effort);
    return mapped ? { anthropic: { thinking: { type: "adaptive", effort: mapped } } } : void 0;
  }
  if (npm === "@ai-sdk/google") {
    const id = modelId ?? "";
    if (isGemini3Model(id)) {
      const thinkingLevel = mapCodexEffortToGeminiLevel(effort);
      return thinkingLevel ? { google: { thinkingConfig: { thinkingLevel, includeThoughts: true } } } : void 0;
    }
    const thinkingBudget = mapCodexEffortToGeminiBudget(effort);
    return thinkingBudget ? { google: { thinkingConfig: { thinkingBudget, includeThoughts: true } } } : void 0;
  }
  if (npm === "@ai-sdk/mistral") {
    if (!modelId || !isMistralReasoningModel(modelId)) return void 0;
    const reasoningEffort = effort === "off" || effort === "none" ? "none" : "high";
    return { mistral: { reasoningEffort } };
  }
  if (npm === "@ai-sdk/openai-compatible" || npm === "@ai-sdk/openai") {
    if (!modelId) return void 0;
    if (isDeepSeekReasoningModel(modelId)) {
      return deepSeekEffortProviderOptions(effort);
    }
    if (isKimiReasoningModel(modelId)) {
      const reasoningEffort = mapCodexEffortToOpenAICompatible(effort);
      if (reasoningEffort) {
        const key = metadata?.providerId ? toCamelCase(metadata.providerId) : "openaiCompatible";
        return { [key]: { reasoningEffort } };
      }
      return void 0;
    }
    if (isGlm52ReasoningModel(modelId)) {
      const reasoningEffort = mapCodexEffortToGlm52(effort);
      if (reasoningEffort) {
        const key = metadata?.providerId ? toCamelCase(metadata.providerId) : "openaiCompatible";
        return { [key]: { reasoningEffort } };
      }
      return void 0;
    }
    if (hasSupportedParameter(metadata, "reasoning_effort")) {
      const reasoningEffort = mapCodexEffortToOpenAICompatible(effort);
      return reasoningEffort ? { openai: { reasoningEffort }, openaiCompatible: { reasoningEffort } } : void 0;
    }
    if (hasSupportedParameter(metadata, "reasoning")) {
      const allowed = new Set(OPENROUTER_EFFORT_LEVELS);
      const mapped = allowed.has(effort) ? effort : effort === "max" ? "xhigh" : void 0;
      return mapped ? { openrouter: { reasoning: { effort: mapped, exclude: false } } } : void 0;
    }
    return void 0;
  }
  return void 0;
}
function deepMergeProviderOptions(a, b) {
  if (!a && !b) return void 0;
  if (!a) return b;
  if (!b) return a;
  const keys = /* @__PURE__ */ new Set([...Object.keys(a), ...Object.keys(b)]);
  const out = {};
  for (const key of keys) {
    out[key] = { ...a[key] ?? {}, ...b[key] ?? {} };
  }
  return out;
}

// src/registry/io.ts
import {
  chmodSync,
  copyFileSync as copyFileSync2,
  existsSync as existsSync2,
  mkdirSync as mkdirSync2,
  openSync,
  readFileSync as readFileSync2,
  renameSync as renameSync2,
  writeSync,
  closeSync
} from "fs";
import { dirname as dirname2 } from "path";

// src/registry/types.ts
var REGISTRY_SCHEMA_VERSION = 1;

// src/registry/migrate.ts
var LEGACY_CLOUD_PROVIDER_IDS = [
  { legacyId: "opencode", id: "zen", name: "OpenCode Zen" },
  { legacyId: "opencode-go", id: "go", name: "OpenCode Go" }
];
function migrateLegacyCloudProviders(registry) {
  let changed = false;
  for (const { legacyId, id, name } of LEGACY_CLOUD_PROVIDER_IDS) {
    const legacyIdx = registry.providers.findIndex((provider) => provider.id === legacyId);
    if (legacyIdx < 0) continue;
    if (registry.providers.some((provider) => provider.id === id)) {
      registry.providers.splice(legacyIdx, 1);
    } else {
      registry.providers[legacyIdx] = {
        ...registry.providers[legacyIdx],
        id,
        templateId: id,
        name,
        api: {}
      };
    }
    changed = true;
  }
  return changed;
}
function migrateOAuthOpenAiProvider(registry) {
  if (registry.providers.some((p) => p.id === "openai-oauth")) return false;
  const idx = registry.providers.findIndex(
    (p) => p.id === "openai" && p.authType === "oauth"
  );
  if (idx < 0) return false;
  const existing = registry.providers[idx];
  registry.providers[idx] = {
    ...existing,
    id: "openai-oauth",
    templateId: existing.templateId || "openai",
    name: existing.name === "OpenAI" ? "OpenAI (ChatGPT)" : existing.name
  };
  return true;
}
function migrateOAuthXaiProvider(registry) {
  if (registry.providers.some((p) => p.id === "xai-oauth")) return false;
  const idx = registry.providers.findIndex(
    (p) => p.id === "xai" && p.authType === "oauth"
  );
  if (idx < 0) return false;
  const existing = registry.providers[idx];
  registry.providers[idx] = {
    ...existing,
    id: "xai-oauth",
    templateId: existing.templateId || "xai",
    name: existing.name === "xAI" ? "xAI Grok (SuperGrok)" : existing.name
  };
  return true;
}
function migrateAlibabaDashScopeChinaLabel(registry) {
  const provider = registry.providers.find(
    (p) => p.id === "alibaba" && p.templateId === "alibaba" && p.name === "Alibaba DashScope" && p.api.url === "https://dashscope.aliyuncs.com/compatible-mode/v1"
  );
  if (!provider) return false;
  provider.name = "Alibaba DashScope (China)";
  return true;
}

// src/registry/validate.ts
var PROVIDER_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
function isValidProviderId(id) {
  return PROVIDER_ID_PATTERN.test(id);
}

// src/registry/io.ts
var DIR_MODE = 448;
var FILE_MODE = 384;
function ensureSecureAppHome() {
  const home = getAppHome();
  mkdirSync2(home, { recursive: true, mode: DIR_MODE });
  try {
    chmodSync(home, DIR_MODE);
  } catch {
  }
}
function writeSecureFile(path, content) {
  ensureSecureAppHome();
  mkdirSync2(dirname2(path), { recursive: true, mode: DIR_MODE });
  const fd = openSync(path, "w", FILE_MODE);
  try {
    writeSync(fd, content);
  } finally {
    closeSync(fd);
  }
  try {
    chmodSync(path, FILE_MODE);
  } catch {
  }
}
function parseProvider(raw) {
  if (!raw || typeof raw !== "object") return null;
  const p = raw;
  if (typeof p.id !== "string" || !isValidProviderId(p.id)) return null;
  if (typeof p.templateId !== "string" || !p.templateId) return null;
  if (typeof p.name !== "string" || !p.name) return null;
  if (typeof p.enabled !== "boolean") return null;
  if (typeof p.authRef !== "string" || !p.authRef) return null;
  if (typeof p.addedAt !== "string" || !p.addedAt) return null;
  const api = p.api;
  if (!api || typeof api !== "object") return null;
  const provider = {
    id: p.id,
    templateId: p.templateId,
    name: p.name,
    enabled: p.enabled,
    authRef: p.authRef,
    api,
    addedAt: p.addedAt
  };
  if (p.subscriptionFilter === "free" || p.subscriptionFilter === "zen" || p.subscriptionFilter === "go") {
    provider.subscriptionFilter = p.subscriptionFilter;
  }
  if (p.authType === "api" || p.authType === "oauth" || p.authType === "none") {
    provider.authType = p.authType;
  }
  if (typeof p.refreshedAt === "string") provider.refreshedAt = p.refreshedAt;
  if (p.modelsCache && typeof p.modelsCache === "object") {
    const cache = p.modelsCache;
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
function loadRegistry(path = getProvidersPath(), { persist = true } = {}) {
  if (!existsSync2(path)) {
    return { schemaVersion: REGISTRY_SCHEMA_VERSION, providers: [] };
  }
  try {
    const raw = JSON.parse(readFileSync2(path, "utf8"));
    const registry = parseRegistry(raw);
    let migrated = migrateLegacyCloudProviders(registry);
    if (migrateOAuthOpenAiProvider(registry)) migrated = true;
    if (migrateOAuthXaiProvider(registry)) migrated = true;
    if (migrateAlibabaDashScopeChinaLabel(registry)) migrated = true;
    if (migrated && persist) {
      try {
        saveRegistry(registry, path);
      } catch {
      }
    }
    return registry;
  } catch {
    return { schemaVersion: REGISTRY_SCHEMA_VERSION, providers: [] };
  }
}
function saveRegistry(registry, path = getProvidersPath()) {
  const payload = `${JSON.stringify(registry, null, 2)}
`;
  const backup = `${path}.bak`;
  if (existsSync2(path)) {
    try {
      copyFileSync2(path, backup);
    } catch {
    }
  }
  const tmp = `${path}.tmp`;
  writeSecureFile(tmp, payload);
  renameSync2(tmp, path);
}

// src/core/errors.ts
var DEFAULT_RETRYABLE = {
  INVALID_ROUTE_ID: false,
  ROUTE_NOT_FOUND: false,
  PROVIDER_DISABLED: false,
  CREDENTIAL_UNAVAILABLE: false,
  OAUTH_REFRESH_FAILED: true,
  UNSUPPORTED_MODEL: false,
  UNSUPPORTED_REASONING_LEVEL: false,
  UNSUPPORTED_REGISTRY_VERSION: false,
  PROVIDER_LOAD_FAILED: true
};
var RelayCoreError = class extends Error {
  code;
  retryable;
  providerId;
  routeId;
  constructor(code, message, options = {}) {
    super(message, options.cause !== void 0 ? { cause: options.cause } : void 0);
    this.name = "RelayCoreError";
    this.code = code;
    this.retryable = options.retryable ?? DEFAULT_RETRYABLE[code];
    if (options.providerId !== void 0) this.providerId = options.providerId;
    if (options.routeId !== void 0) this.routeId = options.routeId;
  }
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...this.providerId !== void 0 ? { providerId: this.providerId } : {},
      ...this.routeId !== void 0 ? { routeId: this.routeId } : {}
    };
  }
};
function isRelayCoreError(err) {
  return err instanceof RelayCoreError;
}

// src/core/reasoning.ts
var RELAY_REASONING_LEVELS = [
  "off",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max"
];
function isRelayReasoningLevel(value) {
  return typeof value === "string" && RELAY_REASONING_LEVELS.includes(value);
}
function reasoningNpmForRoute(provider, model) {
  if (model.modelFormat === "cloud-code") return "@ai-sdk/google";
  return model.npm ?? provider.api.npm ?? "";
}
function resolveReasoningProviderOptions(level, provider, model, routeId) {
  if (!isRelayReasoningLevel(level)) {
    throw new RelayCoreError(
      "UNSUPPORTED_REASONING_LEVEL",
      `Unknown reasoning level "${String(level)}" \u2014 expected one of: ${RELAY_REASONING_LEVELS.join(", ")}.`,
      { providerId: provider.id, routeId }
    );
  }
  const npm = reasoningNpmForRoute(provider, model);
  const upstreamModelId = model.upstreamModelId ?? model.id;
  const metadata = {
    providerId: provider.id,
    upstreamModelId,
    ...model.apiUrl ?? provider.api.url ? { apiBaseUrl: model.apiUrl ?? provider.api.url } : {},
    ...model.supportedParameters ? { supportedParameters: model.supportedParameters } : {},
    ...model.reasoning !== void 0 ? { reasoning: model.reasoning } : {},
    ...model.interleavedReasoningField ? { interleavedReasoningField: model.interleavedReasoningField } : {}
  };
  const caps = getReasoningCapabilities(npm, upstreamModelId, metadata);
  if (caps.mode !== "controllable" || !caps.levels.includes(level)) {
    const available = caps.levels.length > 0 ? caps.levels.join(", ") : "none";
    throw new RelayCoreError(
      "UNSUPPORTED_REASONING_LEVEL",
      `Model "${model.id}" on provider "${provider.name}" does not support reasoning level "${level}" \u2014 available levels: ${available}. See capabilities.reasoningLevels from listRelayModels().`,
      { providerId: provider.id, routeId }
    );
  }
  const resolved = effortProviderOptions(npm, level, upstreamModelId, metadata);
  if (!resolved) {
    throw new RelayCoreError(
      "UNSUPPORTED_REASONING_LEVEL",
      `Model "${model.id}" on provider "${provider.name}" advertises reasoning level "${level}" but Relay has no request mapping for it \u2014 this is a relay-ai bug, please report it.`,
      { providerId: provider.id, routeId }
    );
  }
  return resolved;
}
async function withReasoningProviderOptions(model, providerOptions) {
  const { wrapLanguageModel: wrapLanguageModel2 } = await import("ai");
  return wrapLanguageModel2({
    // `LanguageModel` also admits a bare model-id string and the legacy v2
    // interface; everything Core builds is a concrete current-spec model.
    model,
    middleware: {
      specificationVersion: "v3",
      transformParams: async ({ params }) => ({
        ...params,
        providerOptions: deepMergeProviderOptions(
          providerOptions,
          params.providerOptions
        )
      })
    }
  });
}

// src/core/route-id.ts
var SEPARATOR = "::";
function toRelayRouteId(providerId, modelId) {
  if (!isValidProviderId(providerId)) {
    throw new RelayCoreError("INVALID_ROUTE_ID", `Invalid provider id for route id: ${JSON.stringify(providerId)}`, {});
  }
  if (!modelId) {
    throw new RelayCoreError("INVALID_ROUTE_ID", "Model id must be non-empty for a route id", { providerId });
  }
  return `${providerId}${SEPARATOR}${modelId}`;
}
function parseRelayRouteId(routeId) {
  const idx = typeof routeId === "string" ? routeId.indexOf(SEPARATOR) : -1;
  if (idx <= 0 || idx === routeId.length - SEPARATOR.length) {
    throw new RelayCoreError("INVALID_ROUTE_ID", `Route id must be "provider::model", got: ${JSON.stringify(routeId)}`);
  }
  const providerId = routeId.slice(0, idx);
  const modelId = routeId.slice(idx + SEPARATOR.length);
  if (!isValidProviderId(providerId)) {
    throw new RelayCoreError("INVALID_ROUTE_ID", `Invalid provider id in route id: ${JSON.stringify(routeId)}`);
  }
  return { providerId, modelId };
}

// src/core/catalog.ts
function loadCoreRegistry(path) {
  const registry = loadRegistry(path, { persist: false });
  if (registry.schemaVersion > REGISTRY_SCHEMA_VERSION) {
    throw new RelayCoreError(
      "UNSUPPORTED_REGISTRY_VERSION",
      `Registry schema v${registry.schemaVersion} is newer than supported v${REGISTRY_SCHEMA_VERSION} \u2014 upgrade relay-ai.`
    );
  }
  return registry;
}
function mapReasoning(provider, model) {
  const base = { tools: "unknown", vision: "unknown" };
  const npm = reasoningNpmForRoute(provider, model);
  const upstreamModelId = model.upstreamModelId ?? model.id;
  try {
    const caps = getReasoningCapabilities(npm, upstreamModelId, {
      providerId: provider.id,
      apiBaseUrl: model.apiUrl ?? provider.api.url,
      supportedParameters: model.supportedParameters,
      reasoning: model.reasoning,
      interleavedReasoningField: model.interleavedReasoningField,
      upstreamModelId
    });
    switch (caps.mode) {
      case "none":
        return { ...base, reasoning: "none" };
      case "internal-only":
        return { ...base, reasoning: "fixed" };
      case "controllable": {
        const levels = caps.levels.filter(isRelayReasoningLevel);
        if (levels.length === 0) return { ...base, reasoning: "fixed" };
        return {
          ...base,
          reasoning: "adjustable",
          reasoningLevels: levels,
          ...isRelayReasoningLevel(caps.defaultLevel) ? { defaultReasoningLevel: caps.defaultLevel } : {}
        };
      }
      default:
        return { ...base, reasoning: "unknown" };
    }
  } catch {
    return { ...base, reasoning: "unknown" };
  }
}
function favoriteKey(providerId, modelId) {
  return `${providerId}::${modelId}`;
}
function toDescriptor(provider, model, favorites) {
  const upstreamModelId = model.upstreamModelId ?? model.id;
  return {
    routeId: toRelayRouteId(provider.id, model.id),
    providerId: provider.id,
    providerName: provider.name,
    modelId: model.id,
    upstreamModelId,
    displayName: model.name,
    authType: provider.authType ?? "api",
    favorite: favorites.has(favoriteKey(provider.id, model.id)),
    ...model.contextWindow !== void 0 ? { contextWindow: model.contextWindow } : {},
    ...model.cost ? {
      pricing: {
        input: model.cost.input,
        output: model.cost.output,
        ...model.cost.cache_read !== void 0 ? { cacheRead: model.cost.cache_read } : {},
        ...model.cost.cache_write !== void 0 ? { cacheWrite: model.cost.cache_write } : {}
      }
    } : {},
    capabilities: mapReasoning(provider, model)
  };
}
function listRelayModels(registryPath) {
  const registry = loadCoreRegistry(registryPath);
  const favorites = new Set(
    (loadPreferences().favoriteModels ?? []).map((f) => favoriteKey(f.providerId, f.modelId))
  );
  const descriptors = [];
  for (const provider of registry.providers) {
    if (!provider.enabled) continue;
    for (const model of provider.modelsCache?.models ?? []) {
      descriptors.push(toDescriptor(provider, model, favorites));
    }
  }
  return descriptors.sort(
    (a, b) => Number(b.favorite) - Number(a.favorite) || a.providerName.localeCompare(b.providerName) || a.displayName.localeCompare(b.displayName)
  );
}

// src/context-window.ts
import { readFileSync as readFileSync3 } from "fs";

// src/registry/opencode-auth.ts
import { existsSync as existsSync3, readFileSync as readFileSync4, statSync } from "fs";
import { homedir as homedir3 } from "os";
import { join as join4 } from "path";
function oauthCredentialToKeychainJson(cred) {
  return JSON.stringify(cred);
}

// src/oauth/types.ts
function tokensToStoredCredential(tokens, existingRefresh, accountId, providerData) {
  const mergedProviderData = providerData || tokens.providerData ? { ...providerData, ...tokens.providerData } : void 0;
  return {
    type: "oauth",
    access: tokens.access_token,
    refresh: tokens.refresh_token ?? existingRefresh ?? "",
    expires: Date.now() + (tokens.expires_in ?? 3600) * 1e3,
    ...accountId ? { accountId } : {},
    ...mergedProviderData ? { providerData: mergedProviderData } : {}
  };
}
function parseStoredOAuthCredential(raw) {
  if (!raw?.trim().startsWith("{")) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.type === "oauth" && typeof parsed.access === "string" && typeof parsed.refresh === "string" && typeof parsed.expires === "number") {
      return parsed;
    }
  } catch {
  }
  return null;
}
var OAUTH_REFRESH_SKEW_MS = 12e4;
function oauthCredentialNeedsRefresh(cred, skewMs = OAUTH_REFRESH_SKEW_MS) {
  return cred.expires <= Date.now() + Math.max(0, skewMs);
}
function accessTokenIsExpiring(token, skewMs = OAUTH_REFRESH_SKEW_MS) {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length < 2) return false;
  try {
    let payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (payload.length % 4 !== 0) payload += "=";
    const claims = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
    if (typeof claims.exp !== "number") return false;
    return claims.exp * 1e3 <= Date.now() + Math.max(0, skewMs);
  } catch {
    return false;
  }
}
var NATIVE_OAUTH_PROVIDER_IDS = ["xai", "xai-oauth", "openai", "openai-oauth", "github-copilot", "claude-code", "antigravity", "cline-pass"];

// src/oauth/github.ts
var COPILOT_TOKEN_URL = "https://api.github.com/copilot_internal/v2/token";
var COPILOT_USER_URL = "https://api.github.com/copilot_internal/user";
var DEVICE_CODE_DEFAULT_EXPIRES_MS2 = 15 * 60 * 1e3;
var FREE_COPILOT_SKUS = /* @__PURE__ */ new Set([
  "free_limited_copilot",
  "free_educational_quota",
  "no_auth_limited_copilot"
]);
function classifyCopilotAccount(user) {
  const login = typeof user["login"] === "string" && user["login"].trim() ? user["login"].trim() : void 0;
  const sku = typeof user["access_type_sku"] === "string" && user["access_type_sku"].trim() ? user["access_type_sku"].trim() : void 0;
  const plan = typeof user["copilot_plan"] === "string" && user["copilot_plan"].trim() ? user["copilot_plan"].trim() : void 0;
  if (!sku && !plan) {
    return {
      ...login ? { login } : {},
      lookup_status: "unknown"
    };
  }
  const isFree = FREE_COPILOT_SKUS.has(sku?.toLowerCase() ?? "") || plan?.toLowerCase() === "free";
  return {
    ...login ? { login } : {},
    ...sku ? { access_type_sku: sku } : {},
    ...plan ? { copilot_plan: plan } : {},
    is_free_plan: isFree,
    lookup_status: "known"
  };
}
async function fetchCopilotAccount(ghuToken) {
  const response = await fetch(COPILOT_USER_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${ghuToken}`,
      Accept: "application/json",
      "User-Agent": `relay-ai/${VERSION}`,
      "Editor-Version": "vscode/1.85.1",
      "X-GitHub-Api-Version": "2025-04-01"
    }
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`GitHub Copilot account lookup failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }
  const json = await response.json();
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    throw new Error("GitHub Copilot account lookup returned invalid JSON");
  }
  return classifyCopilotAccount(json);
}
async function exchangeForCopilotToken(ghuToken) {
  const response = await fetch(COPILOT_TOKEN_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${ghuToken}`,
      "User-Agent": `relay-ai/${VERSION}`,
      Accept: "application/json"
    }
  });
  if (!response.ok) {
    const msg = await response.text().catch(() => "");
    throw new Error(`GitHub Copilot token exchange failed (${response.status})${msg ? `: ${msg}` : ""}`);
  }
  const json = await response.json();
  if (!json.token) {
    throw new Error("GitHub Copilot token exchange response missing token field \u2014 is Copilot subscription active?");
  }
  let expiresIn = 1800;
  if (json.expires_at) {
    const expiresMs = new Date(json.expires_at).getTime() - Date.now();
    if (expiresMs > 0) expiresIn = Math.floor(expiresMs / 1e3);
  }
  let account = { lookup_status: "unknown" };
  try {
    account = await fetchCopilotAccount(ghuToken);
  } catch {
  }
  return {
    access_token: json.token,
    expires_in: expiresIn,
    providerData: { copilot: account }
  };
}
async function refreshGithubCopilotToken(ghuToken) {
  const copilot = await exchangeForCopilotToken(ghuToken);
  return {
    ...copilot,
    refresh_token: ghuToken
    // keep the same ghu_ token as refresh
  };
}

// src/oauth/xai.ts
var CLIENT_ID2 = "b1a00492-073a-47ea-816f-4c329264a828";
var TOKEN_URL = "https://auth.x.ai/oauth2/token";
var DEVICE_CODE_DEFAULT_EXPIRES_MS3 = 5 * 60 * 1e3;
function authHeaders() {
  return {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
    "User-Agent": `relay-ai/${VERSION}`
  };
}
async function refreshXaiAccessToken(refreshToken) {
  return postOAuthRefresh(
    TOKEN_URL,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID2
    }),
    {
      contentType: "form",
      errorPrefix: "xAI token refresh failed",
      includeStatus: true,
      includeBody: true,
      headers: authHeaders()
    }
  );
}

// src/oauth/claude-code.ts
import { randomBytes } from "crypto";
import open from "open";
var CLAUDE_CODE_CLIENT_ID = process.env.CLAUDE_OAUTH_CLIENT_ID ?? "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
var TOKEN_URL2 = "https://api.anthropic.com/v1/oauth/token";
var REDIRECT_URI = process.env.CLAUDE_CODE_REDIRECT_URI ?? "https://platform.claude.com/oauth/code/callback";
async function refreshClaudeCodeToken(refreshToken) {
  return postOAuthRefresh(
    TOKEN_URL2,
    {
      grant_type: "refresh_token",
      client_id: CLAUDE_CODE_CLIENT_ID,
      refresh_token: refreshToken
    },
    {
      contentType: "json",
      errorPrefix: "Claude Code token refresh failed",
      includeBody: true
    }
  );
}

// src/oauth/antigravity-oauth.ts
import open2 from "open";
import { readFileSync as readFileSync5 } from "fs";
import { homedir as homedir4 } from "os";
import { join as pathJoin } from "path";

// src/oauth/callback-server.ts
import http from "http";

// src/oauth/antigravity-oauth.ts
var DEFAULT_ANTIGRAVITY_CLIENT_ID = ["107100606059", "1-tmhssin2h2", "1lcre235vtol", "ojh4g403ep.a", "pps.googleus", "ercontent.co", "m"].join("");
var DEFAULT_ANTIGRAVITY_CLIENT_SECRET = ["GOCS", "PX-K", "58FW", "R486", "LdLJ", "1mLB", "8sXC", "4z6q", "DAf"].join("");
var ANTIGRAVITY_CLIENT_ID = process.env.ANTIGRAVITY_OAUTH_CLIENT_ID ?? DEFAULT_ANTIGRAVITY_CLIENT_ID;
var ANTIGRAVITY_CLIENT_SECRET = process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET ?? DEFAULT_ANTIGRAVITY_CLIENT_SECRET;
var TOKEN_URL3 = "https://oauth2.googleapis.com/token";
var SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs"
].join(" ");
var ANTIGRAVITY_VERSION = "4.2.0";
var ANTIGRAVITY_USER_AGENT = `vscode/1.X.X (Antigravity/${ANTIGRAVITY_VERSION})`;
var ANTIGRAVITY_BASE_URLS = [
  "https://daily-cloudcode-pa.googleapis.com",
  "https://cloudcode-pa.googleapis.com",
  "https://daily-cloudcode-pa.sandbox.googleapis.com"
];
var ANTIGRAVITY_API_VERSION = "v1internal";
async function refreshAntigravityToken(refreshToken) {
  return postOAuthRefresh(
    TOKEN_URL3,
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: ANTIGRAVITY_CLIENT_ID,
      client_secret: ANTIGRAVITY_CLIENT_SECRET,
      refresh_token: refreshToken
    }),
    {
      contentType: "form",
      errorPrefix: "Antigravity token refresh failed",
      includeBody: true
    }
  );
}

// src/oauth/cline-pass.ts
var DEFAULT_EXPIRES_MS = 10 * 60 * 1e3;
function jsonHeaders() {
  return {
    Accept: "application/json",
    "Content-Type": "application/json"
  };
}
function expiresInFromIso(expiresAt) {
  if (typeof expiresAt !== "string") throw new Error("ClinePass response is missing a valid expiresAt");
  const timestamp = Date.parse(expiresAt);
  if (!Number.isFinite(timestamp)) throw new Error("ClinePass response is missing a valid expiresAt");
  return Math.max(1, Math.floor((timestamp - Date.now()) / 1e3));
}
function toOAuthResult(data) {
  if (typeof data.accessToken !== "string" || !data.accessToken) {
    throw new Error("ClinePass response is missing accessToken");
  }
  const userInfo = data.userInfo && typeof data.userInfo === "object" && !Array.isArray(data.userInfo) ? data.userInfo : void 0;
  const accountId = typeof userInfo?.clineUserId === "string" ? userInfo.clineUserId : void 0;
  return {
    tokens: {
      access_token: data.accessToken,
      ...typeof data.refreshToken === "string" ? { refresh_token: data.refreshToken } : {},
      expires_in: expiresInFromIso(data.expiresAt),
      ...userInfo ? { providerData: userInfo } : {}
    },
    ...accountId ? { accountId } : {},
    ...userInfo ? { providerData: userInfo } : {}
  };
}
async function readError(response) {
  const text = await response.text().catch(() => "");
  if (!text) return `HTTP ${response.status}`;
  try {
    const parsed = JSON.parse(text);
    const detail = typeof parsed.error === "string" ? parsed.error : typeof parsed.message === "string" ? parsed.message : "";
    return detail || `HTTP ${response.status}`;
  } catch {
    return text.slice(0, 120);
  }
}
async function refreshClinePassAccessToken(refreshToken) {
  const response = await fetch(CLINE_PASS_REFRESH_URL, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ refreshToken, grantType: "refresh_token" })
  });
  if (!response.ok) {
    const detail = await readError(response);
    throw new Error(`ClinePass token refresh failed (${response.status}): ${detail}`);
  }
  const body = await response.json();
  if (body.success !== true || !body.data) {
    const detail = typeof body.error === "string" ? body.error : typeof body.message === "string" ? body.message : "unsuccessful response";
    throw new Error(`ClinePass token refresh failed: ${detail}`);
  }
  return toOAuthResult(body.data).tokens;
}

// src/oauth/refresh.ts
function oauthCredentialShouldRefresh(cred, providerId) {
  if (oauthCredentialNeedsRefresh(cred)) return true;
  if (NATIVE_OAUTH_PROVIDER_IDS.includes(providerId) && accessTokenIsExpiring(cred.access)) return true;
  return false;
}
async function refreshStoredOAuthCredential(providerId, cred) {
  if (!cred.refresh) {
    throw new Error(`${providerId}: OAuth refresh token missing \u2014 run relay-ai providers auth ${providerId}`);
  }
  let tokens;
  if (providerId === "openai" || providerId === "openai-oauth") {
    tokens = await refreshOpenAiAccessToken(cred.refresh);
  } else if (providerId === "xai" || providerId === "xai-oauth") {
    tokens = await refreshXaiAccessToken(cred.refresh);
  } else if (providerId === "github-copilot") {
    tokens = await refreshGithubCopilotToken(cred.refresh);
  } else if (providerId === "claude-code") {
    tokens = await refreshClaudeCodeToken(cred.refresh);
  } else if (providerId === "antigravity") {
    tokens = await refreshAntigravityToken(cred.refresh);
  } else if (providerId === "cline-pass") {
    tokens = await refreshClinePassAccessToken(cred.refresh);
  } else {
    throw new Error(`OAuth refresh not implemented for provider "${providerId}"`);
  }
  const accountId = providerId === "cline-pass" && typeof tokens.providerData?.clineUserId === "string" ? tokens.providerData.clineUserId : cred.accountId;
  return tokensToStoredCredential(tokens, cred.refresh, accountId, cred.providerData);
}

// src/secrets-file.ts
import { chmodSync as chmodSync2, existsSync as existsSync4, mkdirSync as mkdirSync3, readFileSync as readFileSync6, writeFileSync as writeFileSync2 } from "fs";
var DIR_MODE2 = 448;
var FILE_MODE2 = 384;
function emptySecrets() {
  return { version: 1, accounts: {} };
}
function readSecretsFile(env = process.env) {
  const path = getSecretsPath(env);
  if (!existsSync4(path)) return emptySecrets();
  try {
    const raw = JSON.parse(readFileSync6(path, "utf8"));
    if (raw?.version !== 1 || !raw.accounts || typeof raw.accounts !== "object") {
      return emptySecrets();
    }
    const accounts = {};
    for (const [k, v] of Object.entries(raw.accounts)) {
      if (typeof v === "string" && v.length > 0) accounts[k] = v;
    }
    return { version: 1, accounts };
  } catch {
    return emptySecrets();
  }
}
function writeSecretsFile(data, env = process.env) {
  const home = getAppHome(env);
  mkdirSync3(home, { recursive: true, mode: DIR_MODE2 });
  try {
    chmodSync2(home, DIR_MODE2);
  } catch {
  }
  const path = getSecretsPath(env);
  writeFileSync2(path, `${JSON.stringify(data, null, 2)}
`, { encoding: "utf8", mode: FILE_MODE2 });
  try {
    chmodSync2(path, FILE_MODE2);
  } catch {
  }
}
function readFileAccount(account, env = process.env) {
  const value = readSecretsFile(env).accounts[account];
  return value?.length ? value : null;
}
function writeFileAccount(account, value, env = process.env) {
  if (!account || !value) return false;
  try {
    const data = readSecretsFile(env);
    data.accounts[account] = value;
    writeSecretsFile(data, env);
    return true;
  } catch {
    return false;
  }
}
function deleteFileAccount(account, env = process.env) {
  try {
    const data = readSecretsFile(env);
    if (!(account in data.accounts)) return true;
    delete data.accounts[account];
    writeSecretsFile(data, env);
    return true;
  } catch {
    return false;
  }
}

// src/env.ts
function resolveApiKey() {
  const key = process.env["OPENCODE_API_KEY"];
  if (!key?.trim()) return null;
  return key.trim().split(/\r?\n/)[0]?.trim() || null;
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
var KEYRING_CHUNK_PREFIX = "__relay_chunked__:";
var KEYRING_CHUNK_SIZE = 1200;
var LEGACY_KEYRING_SERVICE = "opencode-starter";
var LEGACY_KEYRING_ACCOUNT = "opencode-starter";
var GLOBAL_OPENCODE_KEYRING_ACCOUNT = "global:opencode";
function providerKeyringAccount(providerId) {
  return `provider:${providerId}`;
}
function oauthProviderIdFromAccount(account) {
  const prefix = "oauth:provider:";
  return account.startsWith(prefix) ? account.slice(prefix.length) : null;
}
var oauthRefreshInflight = /* @__PURE__ */ new Map();
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
async function readOsKeyringAccount(account, diag) {
  try {
    const { Entry } = await import("@napi-rs/keyring");
    const value = new Entry(KEYRING_SERVICE, account).getPassword() ?? null;
    if (!value?.startsWith(KEYRING_CHUNK_PREFIX)) return value;
    const chunkCount = Number(value.slice(KEYRING_CHUNK_PREFIX.length));
    let combined = "";
    for (let i = 0; i < chunkCount; i++) {
      combined += new Entry(KEYRING_SERVICE, `${account}::chunk::${i}`).getPassword() ?? "";
    }
    return combined;
  } catch (err) {
    diag?.(classifyKeyringError(err));
    return null;
  }
}
async function writeOsKeyringAccount(account, key, diag) {
  try {
    const { Entry } = await import("@napi-rs/keyring");
    if (key.length <= KEYRING_CHUNK_SIZE) {
      new Entry(KEYRING_SERVICE, account).setPassword(key);
      return true;
    }
    const chunkCount = Math.ceil(key.length / KEYRING_CHUNK_SIZE);
    for (let i = 0; i < chunkCount; i++) {
      const chunk = key.slice(i * KEYRING_CHUNK_SIZE, (i + 1) * KEYRING_CHUNK_SIZE);
      new Entry(KEYRING_SERVICE, `${account}::chunk::${i}`).setPassword(chunk);
    }
    new Entry(KEYRING_SERVICE, account).setPassword(`${KEYRING_CHUNK_PREFIX}${chunkCount}`);
    return true;
  } catch (err) {
    diag?.(classifyKeyringError(err));
    return false;
  }
}
async function readKeyringAccount(account, diag) {
  const fromOs = await readOsKeyringAccount(account, diag);
  if (fromOs) return fromOs;
  return readFileAccount(account);
}
async function writeKeyringAccount(account, key, diag) {
  if (await writeOsKeyringAccount(account, key, diag)) {
    deleteFileAccount(account);
    return true;
  }
  if (writeFileAccount(account, key)) {
    diag?.("OS keyring unavailable \u2014 saved to secrets.json under RELAY_AI_HOME");
    return true;
  }
  return false;
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
async function resolveProviderCredential(providerId, authRef, diag) {
  const parsed = parseAuthRef(authRef);
  if (!parsed) return null;
  if (parsed.kind === "keyring" && parsed.account === GLOBAL_OPENCODE_KEYRING_ACCOUNT) {
    const relayOverride = await readProviderSecret(providerKeyringAccount("opencode"), diag);
    if (relayOverride) return relayOverride;
  }
  const namespaced = readEnvCredential(relayAiKeyEnvVar(providerId));
  if (namespaced) return namespaced;
  if (parsed.kind === "env") {
    return readEnvCredential(parsed.varName);
  }
  if (parsed.account === GLOBAL_OPENCODE_KEYRING_ACCOUNT) {
    return readGlobalOpencodeCredential(diag);
  }
  return readProviderSecret(parsed.account, diag);
}
async function forceRefreshProviderCredential(providerId, authRef, diag) {
  const parsed = parseAuthRef(authRef);
  if (!parsed || parsed.kind !== "keyring") {
    return resolveProviderCredential(providerId, authRef, diag);
  }
  if (parsed.account === GLOBAL_OPENCODE_KEYRING_ACCOUNT) {
    const relayOverride = await readProviderSecret(providerKeyringAccount("opencode"), diag);
    if (relayOverride) return relayOverride;
  }
  const namespaced = readEnvCredential(relayAiKeyEnvVar(providerId));
  if (namespaced) return namespaced;
  const oauthProviderId = oauthProviderIdFromAccount(parsed.account);
  const raw = await readKeyringAccount(parsed.account, diag);
  if (!raw || !oauthProviderId) return decodeProviderSecret(raw);
  return refreshOAuthKeyringAccount(parsed.account, oauthProviderId, raw, diag, true);
}
async function resolveProviderOAuthAccountId(authRef, diag) {
  const parsed = parseAuthRef(authRef);
  if (!parsed || parsed.kind !== "keyring" || !oauthProviderIdFromAccount(parsed.account)) return void 0;
  const raw = await readKeyringAccount(parsed.account, diag);
  return parseStoredOAuthCredential(raw)?.accountId;
}
async function resolveProviderOAuthProviderData(authRef, diag) {
  const parsed = parseAuthRef(authRef);
  if (!parsed || parsed.kind !== "keyring" || !oauthProviderIdFromAccount(parsed.account)) return void 0;
  const raw = await readKeyringAccount(parsed.account, diag);
  return parseStoredOAuthCredential(raw)?.providerData;
}
function decodeProviderSecret(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return trimmed;
  const oauth = parseStoredOAuthCredential(trimmed);
  if (oauth) return oauth.access;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed.type === "oauth" && typeof parsed.access === "string") return parsed.access;
    if (parsed.type === "wellknown" && typeof parsed.token === "string") return parsed.token;
  } catch {
  }
  return trimmed;
}
async function refreshOAuthKeyringAccount(account, providerId, raw, diag, force = false) {
  const existing = oauthRefreshInflight.get(account);
  if (existing) return existing;
  const work = (async () => {
    const cred = parseStoredOAuthCredential(raw);
    if (!cred || !force && !oauthCredentialShouldRefresh(cred, providerId)) {
      return decodeProviderSecret(raw);
    }
    try {
      const refreshed = await refreshStoredOAuthCredential(providerId, cred);
      const json = oauthCredentialToKeychainJson(refreshed);
      await writeKeyringAccount(account, json, diag);
      return refreshed.access;
    } catch (err) {
      diag?.(err instanceof Error ? err.message : String(err));
      if (cred.access && cred.expires > Date.now()) return cred.access;
      throw err;
    }
  })();
  oauthRefreshInflight.set(account, work);
  try {
    return await work;
  } finally {
    oauthRefreshInflight.delete(account);
  }
}
async function readProviderSecret(account, diag) {
  const raw = await readKeyringAccount(account, diag);
  if (!raw) return null;
  const oauthProviderId = oauthProviderIdFromAccount(account);
  if (oauthProviderId && raw.trim().startsWith("{")) {
    return refreshOAuthKeyringAccount(account, oauthProviderId, raw, diag);
  }
  return decodeProviderSecret(raw);
}

// src/data/model-incompatible.json
var model_incompatible_default = {
  schema_version: "1",
  entries: [
    {
      provider: "google",
      modelId: "antigravity-preview-05-2026",
      category: "managed_agent",
      reason: "Interactions API only; coding agents send multiturn chat via @ai-sdk/google streamGenerateContent",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "manual UAT 2026-06-10"
      ],
      verifiedAt: "2026-06-10"
    },
    {
      provider: "*",
      modelId: "z-ai/glm4.7",
      category: "gated_access",
      reason: "NVIDIA NIM requires separate access approval (HTTP 410)",
      sources: [
        "manual probe 2026-06"
      ],
      verifiedAt: "2026-06-10"
    },
    {
      provider: "*",
      modelId: "qwen3.6-plus-free",
      category: "stale_promotion",
      reason: "Free promotion ended; API returns 401",
      sources: [
        "OpenCode Zen catalog"
      ],
      verifiedAt: "2026-06-10"
    },
    {
      provider: "*",
      modelId: "mimo-v2-pro",
      category: "deprecated",
      reason: "Deprecated; API returns 400 \u2014 use mimo-v2.5-pro",
      sources: [
        "OpenCode Zen catalog"
      ],
      verifiedAt: "2026-06-10"
    },
    {
      provider: "*",
      modelId: "mimo-v2-omni",
      category: "deprecated",
      reason: "Deprecated; API returns 400 \u2014 use mimo-v2.5",
      sources: [
        "OpenCode Zen catalog"
      ],
      verifiedAt: "2026-06-10"
    },
    {
      provider: "google",
      modelId: "aqa",
      category: "managed_agent",
      reason: "Attributed QA model \u2014 not for coding agents",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "deep-research-max-preview-04-2026",
      category: "managed_agent",
      reason: "Specialized agent API \u2014 not standard coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "deep-research-preview-04-2026",
      category: "managed_agent",
      reason: "Specialized agent API \u2014 not standard coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "deep-research-pro-preview-12-2025",
      category: "managed_agent",
      reason: "Specialized agent API \u2014 not standard coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "gemini-2.5-computer-use-preview-10-2025",
      category: "managed_agent",
      reason: "Specialized agent API \u2014 not standard coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "gemini-2.5-flash-image",
      category: "image_generation",
      reason: "Image-output model \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "gemini-2.5-flash-native-audio-latest",
      category: "audio_only",
      reason: "Audio/music output \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "gemini-2.5-flash-native-audio-preview-09-2025",
      category: "audio_only",
      reason: "Audio/music output \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "gemini-2.5-flash-native-audio-preview-12-2025",
      category: "audio_only",
      reason: "Audio/music output \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "gemini-2.5-flash-preview-tts",
      category: "audio_only",
      reason: "Audio/music output \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "gemini-2.5-pro-preview-tts",
      category: "audio_only",
      reason: "Audio/music output \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "gemini-3-pro-preview",
      category: "deprecated",
      reason: "Retired preview; API returns 404 \u2014 use gemini-3.1-pro-preview or newer",
      sources: [
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview",
        "manual UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "gemini-3-pro-image",
      category: "image_generation",
      reason: "Image-output model \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "gemini-3-pro-image-preview",
      category: "image_generation",
      reason: "Image-output model \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "gemini-3.1-flash-image",
      category: "image_generation",
      reason: "Image-output model \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "gemini-3.1-flash-image-preview",
      category: "image_generation",
      reason: "Image-output model \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "gemini-3.1-flash-live-preview",
      category: "managed_agent",
      reason: "Live/session API \u2014 not for Codex multiturn chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "gemini-3.1-flash-tts-preview",
      category: "audio_only",
      reason: "Audio/music output \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "gemini-3.5-live-translate-preview",
      category: "managed_agent",
      reason: "Live/session API \u2014 not for Codex multiturn chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "gemini-embedding-001",
      category: "embedding",
      reason: "Embedding model \u2014 not for chat or tools",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "gemini-embedding-2",
      category: "embedding",
      reason: "Embedding model \u2014 not for chat or tools",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "gemini-embedding-2-preview",
      category: "embedding",
      reason: "Embedding model \u2014 not for chat or tools",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "gemini-robotics-er-1.5-preview",
      category: "managed_agent",
      reason: "Specialized agent API \u2014 not standard coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "gemini-robotics-er-1.6-preview",
      category: "managed_agent",
      reason: "Specialized agent API \u2014 not standard coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "imagen-4.0-fast-generate-001",
      category: "image_generation",
      reason: "Image generation \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "imagen-4.0-generate-001",
      category: "image_generation",
      reason: "Image generation \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "imagen-4.0-ultra-generate-001",
      category: "image_generation",
      reason: "Image generation \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "lyria-3-clip-preview",
      category: "audio_only",
      reason: "Audio/music output \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "lyria-3-pro-preview",
      category: "audio_only",
      reason: "Audio/music output \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "lyria-realtime-exp",
      category: "audio_only",
      reason: "Audio/music output \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "nano-banana-pro-preview",
      category: "image_generation",
      reason: "Image generation \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "veo-2.0-generate-001",
      category: "video_generation",
      reason: "Video generation \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "veo-3.0-fast-generate-001",
      category: "video_generation",
      reason: "Video generation \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "veo-3.0-generate-001",
      category: "video_generation",
      reason: "Video generation \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "veo-3.1-fast-generate-preview",
      category: "video_generation",
      reason: "Video generation \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "veo-3.1-generate-preview",
      category: "video_generation",
      reason: "Video generation \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "veo-3.1-lite-generate-preview",
      category: "video_generation",
      reason: "Video generation \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    }
  ]
};

// src/registry/models-dev.ts
import {
  chmodSync as chmodSync4,
  existsSync as existsSync6,
  mkdirSync as mkdirSync5,
  readFileSync as readFileSync8,
  statSync as statSync2,
  writeFileSync as writeFileSync4
} from "fs";
import { dirname as dirname4, join as join6 } from "path";

// src/registry/pricing.ts
import {
  chmodSync as chmodSync3,
  existsSync as existsSync5,
  mkdirSync as mkdirSync4,
  readFileSync as readFileSync7,
  writeFileSync as writeFileSync3
} from "fs";
import { dirname as dirname3, join as join5 } from "path";

// src/model-compatibility.ts
var BLACKLIST_ENTRIES = model_incompatible_default.entries ?? [];

// src/registry/import-build.ts
function oauthAuthRef(providerId) {
  return `keyring:oauth:provider:${providerId}`;
}

// src/provider-runtime.ts
function providerRefreshToken(providerId, authType, authRef) {
  if (authType !== "oauth" || !providerId) return void 0;
  return () => forceRefreshProviderCredential(providerId, authRef ?? oauthAuthRef(providerId));
}

// src/core/antigravity-model.ts
import { randomUUID as randomUUID2 } from "crypto";
var CLOUD_CODE_BASES = ANTIGRAVITY_BASE_URLS.map((base) => base.replace(/\/+$/, ""));
var CLOUD_CODE_BASE = CLOUD_CODE_BASES[0];
var STREAM_URLS = CLOUD_CODE_BASES.map((base) => `${base}/${ANTIGRAVITY_API_VERSION}:streamGenerateContent?alt=sse`);
var UNARY_URLS = CLOUD_CODE_BASES.map((base) => `${base}/${ANTIGRAVITY_API_VERSION}:generateContent`);
var SDK_BASE_URL = `${CLOUD_CODE_BASE}/v1beta`;
var ENDPOINT_FAILOVER_STATUSES = /* @__PURE__ */ new Set([404, 408, 429]);
function shouldTryNextEndpoint(status) {
  return ENDPOINT_FAILOVER_STATUSES.has(status) || status >= 500;
}
function discardResponse(response) {
  try {
    void response.body?.cancel();
  } catch {
  }
}
function unwrapCloudCodeSsePayload(payload) {
  const trimmed = payload.trim();
  if (trimmed === "" || trimmed === "[DONE]") return payload;
  try {
    const parsed = JSON.parse(trimmed);
    if (isWrappedCloudCodeBody(parsed)) {
      return JSON.stringify(parsed.response);
    }
  } catch {
  }
  return payload;
}
function unwrapCloudCodeJsonBody(text) {
  try {
    const parsed = JSON.parse(text);
    if (isWrappedCloudCodeBody(parsed)) {
      return JSON.stringify(parsed.response);
    }
  } catch {
  }
  return text;
}
function consumeCloudCodeSseBuffer(buffer) {
  const separator = /\r?\n\r?\n/;
  let rest = buffer;
  let emitted = "";
  while (true) {
    const match = separator.exec(rest);
    if (!match || match.index === void 0) break;
    const rawEvent = rest.slice(0, match.index);
    const sep = match[0];
    rest = rest.slice(match.index + sep.length);
    emitted += transformSseEvent(rawEvent) + sep;
  }
  return { emitted, rest };
}
function createCloudCodeSseUnwrapper() {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = "";
  return new TransformStream({
    transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true });
      const { emitted, rest } = consumeCloudCodeSseBuffer(pending);
      pending = rest;
      if (emitted) controller.enqueue(encoder.encode(emitted));
    },
    flush(controller) {
      pending += decoder.decode();
      if (!pending) return;
      const { emitted, rest } = consumeCloudCodeSseBuffer(pending);
      const tail = emitted + (rest ? transformSseEvent(rest) : "");
      if (tail) controller.enqueue(encoder.encode(tail));
    }
  });
}
function createCloudCodeFetch(options, fetchImpl) {
  let accessToken = options.accessToken;
  const debug = (msg) => {
    try {
      options.onDebug?.(`cloud-code: ${msg}`);
    } catch {
    }
  };
  return async (input, init) => {
    const url = requestUrl(input);
    const streaming = url.includes("streamGenerateContent");
    const signal = init?.signal ?? (input instanceof Request ? input.signal : void 0);
    const geminiBody = await readJsonBody(input, init);
    const envelope = {
      project: options.projectId,
      requestId: randomUUID2(),
      model: options.modelId,
      userAgent: ANTIGRAVITY_USER_AGENT,
      requestType: "agent",
      enabledCreditTypes: ["GOOGLE_ONE_AI"],
      request: geminiBody
    };
    const body = JSON.stringify(envelope);
    const bodyByteLength = Buffer.byteLength(body, "utf8");
    const upstreamUrls = streaming ? STREAM_URLS : UNARY_URLS;
    const doFetch = fetchImpl ?? ((input2, init2) => globalThis.fetch(input2, init2));
    const send = async (url2, token) => {
      try {
        return await doFetch(url2, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "User-Agent": ANTIGRAVITY_USER_AGENT
          },
          body,
          signal
        });
      } catch (err) {
        if (isAbortError(err, signal)) throw abortError(signal, err);
        throw err;
      }
    };
    const sendWithFailover = async (token, startIndex = 0) => {
      let lastError;
      for (let i = startIndex; i < upstreamUrls.length; i += 1) {
        const url2 = upstreamUrls[i];
        const isLast = i === upstreamUrls.length - 1;
        const where = `endpoint=${i + 1}/${upstreamUrls.length} host=${endpointHost(url2)}`;
        let response2;
        try {
          debug(`request ${where} kind=${streaming ? "stream" : "unary"} payloadBytes=${bodyByteLength}`);
          response2 = await send(url2, token);
        } catch (err) {
          if (isAbortError(err, signal)) throw err;
          lastError = err;
          debug(`network failure ${where} errorName=${errorName(err)}`);
        }
        if (response2) {
          if (isLast || !shouldTryNextEndpoint(response2.status)) {
            debug(`response ${where} status=${response2.status}`);
            return { response: response2, url: url2, index: i };
          }
          discardResponse(response2);
          lastError = new Error(`Cloud Code Assist endpoint returned ${response2.status}`);
          debug(`retryable status=${response2.status} ${where} \u2014 trying next endpoint`);
        }
        if (signal?.aborted) throw abortError(signal);
      }
      throw lastError ?? new Error("All Cloud Code Assist endpoints failed");
    };
    const tokenUsed = accessToken;
    let { response, index: servedByIndex } = await sendWithFailover(tokenUsed);
    if (response.status === 401 && options.refreshToken && !signal?.aborted) {
      debug("status=401 \u2014 refreshing credential");
      const refreshed = await options.refreshToken().catch(() => null);
      if (refreshed && refreshed !== tokenUsed && !signal?.aborted) {
        accessToken = refreshed;
        discardResponse(response);
        ({ response } = await sendWithFailover(refreshed, servedByIndex));
        debug(`retry after refresh status=${response.status}`);
      } else {
        debug(`refresh did not yield a new credential (refreshed=${refreshed ? "same" : "none"})`);
      }
    }
    return adaptUpstreamResponse(response, streaming);
  };
}
async function createAntigravityCloudCodeModel(options) {
  const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
  const google = createGoogleGenerativeAI({
    apiKey: "relay-cloud-code",
    baseURL: SDK_BASE_URL,
    fetch: createCloudCodeFetch(options)
  });
  return google(options.modelId);
}
function endpointHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return "unknown";
  }
}
function errorName(err) {
  if (err instanceof Error) return err.name || "Error";
  return typeof err;
}
function isWrappedCloudCodeBody(parsed) {
  return !!parsed && typeof parsed === "object" && !Array.isArray(parsed) && "response" in parsed && parsed.response !== null && typeof parsed.response === "object";
}
function transformSseEvent(event) {
  return event.replace(/^(data:[ \t]*)(.*)$/gm, (_all, prefix, payload) => `${prefix}${unwrapCloudCodeSsePayload(payload)}`);
}
function requestUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}
async function readJsonBody(input, init) {
  const body = init?.body;
  if (typeof body === "string") return JSON.parse(body);
  if (body instanceof Uint8Array) return JSON.parse(new TextDecoder().decode(body));
  if (body instanceof ArrayBuffer) return JSON.parse(new TextDecoder().decode(body));
  const request = input instanceof Request ? input.clone() : new Request(input, init);
  return request.json();
}
async function adaptUpstreamResponse(upstream, streaming) {
  const fallbackType = streaming ? "text/event-stream" : "application/json";
  const contentType = upstream.headers.get("content-type") ?? fallbackType;
  const headers = new Headers({ "Content-Type": contentType });
  if (!upstream.ok) {
    const errBody = await upstream.text();
    return new Response(errBody, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers
    });
  }
  if (streaming) {
    const body = upstream.body ? upstream.body.pipeThrough(createCloudCodeSseUnwrapper()) : null;
    return new Response(body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers
    });
  }
  const text = await upstream.text();
  headers.set("Content-Type", "application/json");
  return new Response(unwrapCloudCodeJsonBody(text), { status: 200, headers });
}
function isAbortError(err, signal) {
  if (signal?.aborted) return true;
  return !!err && typeof err === "object" && err.name === "AbortError";
}
function abortError(signal, cause) {
  if (signal?.reason instanceof Error) return signal.reason;
  if (cause instanceof Error) return cause;
  return new DOMException("This operation was aborted", "AbortError");
}

// src/core/model.ts
function isAntigravityCloudCodeRoute(provider, model) {
  return provider.id === "antigravity" && provider.authType === "oauth" && model.modelFormat === "cloud-code";
}
function findRoute(registry, providerId, modelId, routeId) {
  const provider = registry.providers.find((p) => p.id === providerId);
  if (!provider) {
    throw new RelayCoreError("ROUTE_NOT_FOUND", `No provider registered with id "${providerId}".`, { providerId, routeId });
  }
  if (!provider.enabled) {
    throw new RelayCoreError("PROVIDER_DISABLED", `Provider "${provider.name}" is disabled \u2014 enable it in relay-ai ui.`, { providerId, routeId });
  }
  const model = provider.modelsCache?.models.find((m) => m.id === modelId);
  if (!model) {
    throw new RelayCoreError("UNSUPPORTED_MODEL", `Provider "${provider.name}" has no cached model "${modelId}" \u2014 refresh its models in relay-ai ui.`, { providerId, routeId });
  }
  return { provider, model };
}
async function resolveCredential(provider, routeId) {
  try {
    const credential = await resolveProviderCredential(provider.id, provider.authRef);
    if (credential) return credential;
    if (provider.authType === "none") return "";
    throw new RelayCoreError(
      "CREDENTIAL_UNAVAILABLE",
      `No credential available for provider "${provider.name}" \u2014 re-authenticate in relay-ai ui.`,
      { providerId: provider.id, routeId }
    );
  } catch (err) {
    if (isRelayCoreError(err)) throw err;
    if (provider.authType === "oauth") {
      throw new RelayCoreError(
        "OAUTH_REFRESH_FAILED",
        `OAuth token refresh failed for provider "${provider.name}" \u2014 re-authenticate in relay-ai ui.`,
        { providerId: provider.id, routeId, cause: err }
      );
    }
    throw new RelayCoreError(
      "PROVIDER_LOAD_FAILED",
      `Failed to resolve the credential for provider "${provider.name}".`,
      { providerId: provider.id, routeId, cause: err }
    );
  }
}
async function createRelayModel(routeId, options) {
  const { providerId, modelId } = parseRelayRouteId(routeId);
  const registry = loadCoreRegistry();
  const { provider, model } = findRoute(registry, providerId, modelId, routeId);
  const reasoningOptions = options?.reasoning === void 0 ? void 0 : resolveReasoningProviderOptions(options.reasoning, provider, model, routeId);
  const finish = (built) => reasoningOptions ? withReasoningProviderOptions(built, reasoningOptions) : Promise.resolve(built);
  if (isAntigravityCloudCodeRoute(provider, model)) {
    const apiKey2 = await resolveCredential(provider, routeId);
    const providerData2 = await resolveProviderOAuthProviderData(provider.authRef);
    const projectId = typeof providerData2?.projectId === "string" ? providerData2.projectId.trim() : "";
    if (!projectId) {
      throw new RelayCoreError(
        "CREDENTIAL_UNAVAILABLE",
        `Provider "${provider.name}" is missing project metadata \u2014 re-authenticate in relay-ai ui.`,
        { providerId: provider.id, routeId }
      );
    }
    try {
      return await finish(await createAntigravityCloudCodeModel({
        modelId: model.upstreamModelId ?? model.id,
        accessToken: apiKey2,
        projectId,
        refreshToken: providerRefreshToken(provider.id, provider.authType, provider.authRef),
        ...options?.onDebug ? { onDebug: options.onDebug } : {}
      }));
    } catch (err) {
      if (isRelayCoreError(err)) throw err;
      throw new RelayCoreError(
        "PROVIDER_LOAD_FAILED",
        `Failed to construct model "${modelId}" for provider "${provider.name}".`,
        { providerId, routeId, cause: err }
      );
    }
  }
  const npm = model.npm ?? provider.api.npm;
  if (!npm) {
    throw new RelayCoreError("UNSUPPORTED_MODEL", `Model "${modelId}" has no SDK provider package \u2014 refresh the provider's models in relay-ai ui.`, { providerId, routeId });
  }
  const apiKey = await resolveCredential(provider, routeId);
  let oauthAccountId;
  let providerData;
  if (provider.authType === "oauth") {
    oauthAccountId = await resolveProviderOAuthAccountId(provider.authRef);
    providerData = await resolveProviderOAuthProviderData(provider.authRef);
  }
  const spec = {
    npm,
    modelId: model.upstreamModelId ?? model.id,
    apiKey,
    baseURL: model.apiUrl ?? provider.api.url,
    providerId: provider.id,
    authType: provider.authType,
    oauthAccountId,
    providerData,
    headers: provider.api.headers,
    refreshToken: providerRefreshToken(provider.id, provider.authType, provider.authRef),
    useResponsesLite: model.useResponsesLite,
    preferWebSockets: model.preferWebSockets,
    ...options?.onDebug ? { onDebug: options.onDebug } : {}
  };
  try {
    return await finish(await createLanguageModel(spec));
  } catch (err) {
    if (isRelayCoreError(err)) throw err;
    throw new RelayCoreError(
      "PROVIDER_LOAD_FAILED",
      `Failed to construct model "${modelId}" for provider "${provider.name}".`,
      { providerId, routeId, cause: err }
    );
  }
}
export {
  RelayCoreError,
  createRelayModel,
  isRelayCoreError,
  listRelayModels,
  parseRelayRouteId,
  toRelayRouteId
};
//# sourceMappingURL=index.js.map