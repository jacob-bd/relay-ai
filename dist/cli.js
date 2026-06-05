#!/usr/bin/env node

// src/cli.ts
import pc3 from "picocolors";
import * as p4 from "@clack/prompts";
import { appendFileSync as appendFileSync2, readFileSync as readFileSync3, existsSync as existsSync3, realpathSync } from "fs";
import { homedir as homedir4, tmpdir } from "os";
import { join as join4 } from "path";
import { fileURLToPath } from "url";
import { execSync as execSync2 } from "child_process";

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
var STALE_FREE_MODELS = /* @__PURE__ */ new Set([
  "qwen3.6-plus-free"
  // 401 — free promotion ended
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
var VERSION = "0.2.2";

// src/env.ts
function detectConflicts() {
  return CONFLICTING_ENV_VARS.filter((name) => process.env[name] !== void 0).map((name) => ({ name, value: process.env[name] }));
}
function resolveApiKey() {
  const key = process.env["OPENCODE_API_KEY"];
  return key?.trim() || null;
}
function buildChildEnv(backend, model, apiKey, proxyPort) {
  const env = { ...process.env };
  for (const name of CONFLICTING_ENV_VARS) {
    delete env[name];
  }
  env["ANTHROPIC_BASE_URL"] = proxyPort ? `http://127.0.0.1:${proxyPort}` : backend.baseUrl;
  env["ANTHROPIC_API_KEY"] = apiKey;
  env["ANTHROPIC_MODEL"] = model;
  return env;
}

// src/models.ts
import { readFileSync } from "fs";
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
  try {
    const raw = readFileSync(OPENCODE_CACHE_PATH, "utf8");
    const cache = JSON.parse(raw);
    const providerKey = backendId === "zen" ? "opencode" : "opencode-go";
    const providerData = cache[providerKey];
    if (!providerData?.models) return null;
    const result = /* @__PURE__ */ new Map();
    for (const entry of Object.values(providerData.models)) {
      if (entry.status === "deprecated") continue;
      const isFree = entry.cost !== void 0 && entry.cost.input === 0 && entry.cost.output === 0;
      const modelFormat = classifyModelFormat(entry.id, entry.provider?.npm);
      result.set(entry.id, {
        id: entry.id,
        name: entry.name ?? entry.id,
        isFree,
        brand: deriveBrand(entry.family ?? ""),
        sourceBackend: backendId,
        modelFormat,
        cost: entry.cost
      });
    }
    return result;
  } catch {
    return null;
  }
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
      modelFormat
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

// src/proxy.ts
import { createServer } from "http";
import { Readable } from "stream";
import { appendFileSync } from "fs";
function hashSystemPrompt(system) {
  if (!system) return null;
  const text = typeof system === "string" ? system : system.map((s) => s.text || "").join("\n");
  if (!text.trim()) return null;
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) + hash + text.charCodeAt(i);
    hash = hash & hash;
  }
  return "cache-" + Math.abs(hash).toString(36);
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
function translateRequest(body) {
  const { model, messages, system, temperature, max_tokens, top_p, stop_sequences, tools, stream } = body;
  const openAIMessages = Array.isArray(messages) ? messages.flatMap((msg) => {
    if (typeof msg.content === "string") {
      return [{ role: msg.role, content: msg.content }];
    }
    if (!Array.isArray(msg.content)) return [];
    const result = [];
    if (msg.role === "assistant") {
      const assistantMsg = { role: "assistant", content: null };
      let text = "";
      let reasoningContent = "";
      const toolCalls = [];
      for (const part of msg.content) {
        if (part.type === "text") {
          text += (typeof part.text === "string" ? part.text : JSON.stringify(part.text)) + "\n";
        } else if (part.type === "thinking") {
          reasoningContent += (typeof part.thinking === "string" ? part.thinking : JSON.stringify(part.thinking)) + "\n";
        } else if (part.type === "tool_use") {
          toolCalls.push({
            id: part.id,
            type: "function",
            function: { name: part.name, arguments: JSON.stringify(part.input) }
          });
        }
      }
      const trimmed = text.trim();
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
            tool_call_id: part.tool_use_id,
            content: typeof part.content === "string" ? part.content : JSON.stringify(part.content)
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
  const data = { model, messages: [...systemMessages, ...openAIMessages] };
  if (max_tokens !== void 0) data.max_tokens = max_tokens;
  if (temperature !== void 0) data.temperature = temperature;
  if (top_p !== void 0) data.top_p = top_p;
  if (stream !== void 0) data.stream = stream;
  if (stream) data.stream_options = { include_usage: true };
  if (stop_sequences) data.stop = stop_sequences;
  if (tools) {
    data.tools = tools.map((item) => ({
      type: "function",
      function: {
        name: item.name,
        description: item.description,
        parameters: item.input_schema
      }
    }));
  }
  const cacheKey = hashSystemPrompt(system);
  if (cacheKey) data.prompt_cache_key = cacheKey;
  return data;
}
function parseToolArguments(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
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
    content.push(...message.tool_calls.map((item) => ({
      type: "tool_use",
      id: item.id,
      name: item.function?.name,
      input: parseToolArguments(item.function?.arguments)
    })));
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
    model
  };
  if (completion.usage) {
    result.usage = {
      input_tokens: extractUncachedInputTokens(completion.usage),
      output_tokens: extractOutputTokens(completion.usage),
      cache_read_input_tokens: extractCachedTokens(completion.usage),
      cache_creation_input_tokens: 0
    };
  }
  return result;
}
function sseChunk(eventType, data) {
  return `event: ${eventType}
data: ${JSON.stringify(data)}

`;
}
function translateStream(upstreamBody, model) {
  const messageId = "msg_" + Date.now();
  let contentBlockIndex = -1;
  let hasStartedTextBlock = false;
  let hasStartedThinkingBlock = false;
  let isToolUse = false;
  let currentToolCallId = null;
  let lastUsage = null;
  let finishReason = null;
  let messageStarted = false;
  let buffer = "";
  const output = new Readable({ read() {
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
  function closeCurrentBlock() {
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
    if (delta.tool_calls?.length > 0) {
      for (const toolCall of delta.tool_calls) {
        if (toolCall.id && toolCall.id !== currentToolCallId) {
          closeCurrentBlock();
          isToolUse = true;
          hasStartedTextBlock = false;
          hasStartedThinkingBlock = false;
          currentToolCallId = toolCall.id;
          contentBlockIndex++;
          emitMessageStart();
          emitSSE("content_block_start", {
            type: "content_block_start",
            index: contentBlockIndex,
            content_block: { type: "tool_use", id: toolCall.id, name: toolCall.function?.name, input: {} }
          });
        }
        if (toolCall.function?.arguments) {
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
    if (!line.startsWith("data: ")) return;
    const data = line.slice(6).trim();
    if (data === "[DONE]") return;
    try {
      const parsed = JSON.parse(data);
      const delta = parsed.choices?.[0]?.delta;
      if (delta) processDelta(delta, parsed);
    } catch {
    }
  }
  function finish() {
    closeCurrentBlock();
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
  const decoder = new TextDecoder();
  upstreamBody.on("data", (chunk) => {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (line.trim()) processLine(line);
    }
  });
  upstreamBody.on("end", () => {
    if (buffer.trim()) processLine(buffer);
    finish();
  });
  upstreamBody.on("error", () => {
    finish();
  });
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
function startProxy(upstreamBaseUrl, modelId, debug = false) {
  const upstreamUrl = `${upstreamBaseUrl}/v1/chat/completions`;
  const LOG = "/tmp/opencode-proxy-debug.log";
  const plog = debug ? (msg) => {
    try {
      appendFileSync(LOG, `${(/* @__PURE__ */ new Date()).toISOString()} ${msg}
`);
    } catch {
    }
  } : (_msg) => {
  };
  const modelsResponse = JSON.stringify({
    data: [{ id: modelId, type: "model", display_name: modelId, created_at: "2025-01-01T00:00:00Z" }],
    has_more: false,
    first_id: modelId,
    last_id: modelId
  });
  const server = createServer(async (req, res) => {
    plog(`${req.method} ${req.url}`);
    if (req.method === "HEAD") {
      res.writeHead(200);
      res.end();
      return;
    }
    if (req.method === "GET" && req.url?.startsWith("/v1/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(modelsResponse);
      return;
    }
    if (req.method === "POST" && req.url?.startsWith("/v1/messages")) {
      const apiKey = extractApiKey(req);
      plog(`POST /v1/messages - key=${apiKey ? `len:${apiKey.length}` : "MISSING"}, headers=${Object.keys(req.headers).join(",")}`);
      if (!apiKey) {
        anthropicError(res, 401, "Missing API key");
        return;
      }
      let anthropicBody;
      try {
        const raw = await readBody(req);
        anthropicBody = JSON.parse(raw);
      } catch {
        anthropicError(res, 400, "Invalid JSON body");
        return;
      }
      const originalModel = anthropicBody.model;
      const openaiBody = translateRequest(anthropicBody);
      let upstreamRes;
      try {
        upstreamRes = await fetch(upstreamUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
          },
          body: JSON.stringify(openaiBody)
        });
      } catch (err) {
        plog(`upstream error: ${err instanceof Error ? err.message : String(err)}`);
        anthropicError(res, 502, `Upstream unreachable: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      plog(`upstream ${upstreamRes.status} from ${upstreamUrl}`);
      if (!upstreamRes.ok) {
        const errBody = await upstreamRes.text();
        plog(`upstream error body: ${errBody.slice(0, 500)}`);
        res.writeHead(upstreamRes.status, { "Content-Type": upstreamRes.headers.get("content-type") || "application/json" });
        res.end(errBody);
        return;
      }
      if (openaiBody.stream && upstreamRes.body) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive"
        });
        const nodeStream = Readable.fromWeb(upstreamRes.body);
        const translated = translateStream(nodeStream, originalModel);
        translated.pipe(res);
        return;
      }
      const openaiData = await upstreamRes.json();
      const anthropicResponse = translateResponse(openaiData, originalModel);
      sendJson(res, 200, anthropicResponse);
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
      plog(`started on port ${addr.port}, forwarding to ${upstreamUrl}`);
      resolve({
        port: addr.port,
        close: () => server.close()
      });
    });
  });
}

// src/server/index.ts
import pc from "picocolors";
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
    subscriptionTier: config.subscriptionTier,
    modelListCache: config.modelListCache,
    server: config.server
  };
}
function savePreferences(prefs) {
  const config = readConfig();
  if (prefs.lastBackend !== void 0) config.lastBackend = prefs.lastBackend;
  if (prefs.lastModel !== void 0) config.lastModel = prefs.lastModel;
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
  const password3 = await p.password({
    message: "Choose a server password for this run:",
    validate: (value) => value.trim() ? void 0 : "Password cannot be empty"
  });
  if (p.isCancel(password3)) {
    p.cancel("Cancelled.");
    return null;
  }
  return String(password3).trim();
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

// src/server/models.ts
var CREATED_AT_ISO = "2025-01-01T00:00:00Z";
var CREATED_AT_UNIX = 1735689600;
function createModelCatalog(models) {
  const byId = new Map(models.map((model) => [model.id, model]));
  return {
    get: (id) => byId.get(id),
    list: () => [...models]
  };
}
function formatAnthropicModels(models) {
  return {
    data: models.map((model) => ({
      id: model.id,
      type: "model",
      display_name: model.name,
      created_at: CREATED_AT_ISO
    })),
    has_more: false,
    first_id: models[0]?.id ?? null,
    last_id: models.at(-1)?.id ?? null
  };
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
      sendJson2(res, 200, { models: options.catalog.list() });
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
    await forwardJson(res, `${backendFor(options, model).baseUrl}/v1/messages`, body, options.apiKey);
    return;
  }
  if (model.modelFormat === "openai") {
    const upstreamJson = await postJson(`${backendFor(options, model).baseUrl}/v1/chat/completions`, translateRequest(body), options.apiKey);
    sendJson2(res, upstreamJson.status, translateResponse(upstreamJson.body, body.model));
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
    await forwardJson(res, `${backendFor(options, model).baseUrl}/v1/chat/completions`, body, options.apiKey);
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
  const upstream = await postJson(url, body, apiKey);
  sendJson2(res, upstream.status, upstream.body);
}
async function postJson(url, body, apiKey) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;
  return { status: response.status, body: parsed };
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
  if (needsZen) {
    const result = await getModels(BACKENDS.zen, getCachedModels("zen") ?? void 0);
    if (!result.fromCache) setCachedModels("zen", result.models);
    models.push(...modelsForTier(tier, "zen", result.models));
  }
  if (needsGo) {
    const result = await getModels(BACKENDS.go, getCachedModels("go") ?? void 0);
    if (!result.fromCache) setCachedModels("go", result.models);
    models.push(...modelsForTier(tier, "go", result.models));
  }
  return models;
}
async function runServerCommand() {
  const apiKey = resolveApiKey();
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
    spinner3.stop(`Loaded ${models.length} models`);
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
    console.log(`  Network:    http://<this-computer-ip>:${server.port}`);
    console.log("  API key:    <server password>");
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
async function runWizard(prefs, modelsByBackend, conflicts, tier) {
  p3.intro(pc2.bold("  OpenCode Starter"));
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
  const options = [];
  for (const m of free) {
    options.push({ value: m.id, label: modelLabel(m, showBackendBadge), hint: modelHint(m) });
  }
  const brandOrder = ["Claude", "GPT", "Gemini", "DeepSeek", "Qwen", "MiniMax", "Kimi", "GLM", "MiMo", "Grok", "Nemotron", "Other"];
  const sortedBrands = [...byBrand.keys()].sort(
    (a, b) => (brandOrder.indexOf(a) !== -1 ? brandOrder.indexOf(a) : 99) - (brandOrder.indexOf(b) !== -1 ? brandOrder.indexOf(b) : 99)
  );
  for (const brand of sortedBrands) {
    for (const m of byBrand.get(brand) ?? []) {
      options.push({ value: m.id, label: modelLabel(m), hint: modelHint(m) });
    }
  }
  if (options.length === 0) {
    p3.cancel("No models available for this backend and subscription tier.");
    return null;
  }
  const defaultModel = prefs.lastModel && options.some((o) => o.value === prefs.lastModel) ? prefs.lastModel : options[0]?.value;
  const modelId = await p3.select({
    message: "Which model?",
    options,
    initialValue: defaultModel
  });
  if (p3.isCancel(modelId)) {
    p3.cancel("Cancelled.");
    return null;
  }
  if (unsupportedModels.length > 0) {
    const brandCounts = unsupportedModels.reduce((acc, m) => {
      acc[m.brand] = (acc[m.brand] ?? 0) + 1;
      return acc;
    }, {});
    const summary = Object.entries(brandCounts).map(([b, c]) => `${b} (${c})`).join(", ");
    p3.log.info(pc2.dim(`Not yet supported: ${summary} \u2014 need API format translation`));
  }
  const selectedModel = selectableModels.find((m) => m.id === String(modelId));
  const backend = BACKENDS[selectedModel.sourceBackend];
  if (conflicts.length > 0) {
    const lines = conflicts.map((c) => `  ${pc2.dim(c.name)}=${pc2.dim(c.value)}`).join("\n");
    p3.note(lines, pc2.yellow("Env vars that will be temporarily overridden:"));
  }
  const confirmed = await p3.confirm({
    message: `Launch Claude Code \xB7 ${pc2.bold(String(modelId))} via ${pc2.bold(backend.name)}?`,
    initialValue: true
  });
  if (p3.isCancel(confirmed) || !confirmed) {
    p3.cancel("Cancelled.");
    return null;
  }
  p3.outro(pc2.green("Launching..."));
  return { backend, model: selectedModel };
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
Launch supported coding tools with OpenCode Zen or Go as the API backend.

${pc3.bold("Usage:")}
  opencode-starter claude [starter-options] [claude-flags]
  opencode-starter server
  opencode-starter --help
  opencode-starter --version

${pc3.bold("Commands:")}
  claude      Launch Claude Code through OpenCode Starter
  server      Run a foreground OpenCode Starter API gateway
  codex       planned

${pc3.bold("Migration:")}
  Bare opencode-starter now prints this help instead of launching Claude Code.
  Use opencode-starter claude to run the existing Claude Code wizard and launcher.

${pc3.bold("Examples:")}
  opencode-starter claude
  opencode-starter claude -c
  opencode-starter claude --resume abc-123
  opencode-starter claude -- --print "hello"`;
}
function claudeHelpText() {
  return `${pc3.bold("opencode-starter claude")} v${VERSION}
Launch Claude Code with OpenCode Zen or Go as the Anthropic API backend.

${pc3.bold("Usage:")}
  opencode-starter claude [starter-options] [claude-flags]
  opencode-starter claude --help
  opencode-starter claude --version

${pc3.bold("Starter options:")}
  --dry-run    Run the wizard but show a preview instead of launching Claude Code
  --setup      Re-configure your subscription tier
  --trace      Write Claude Code debug logs to /tmp/opencode-starter-debug.log and show errors on exit
  --help       Show this command help
  --version    Show version

${pc3.bold("Setup:")}
  Get your API key at https://opencode.ai/settings/keys
  Then run: export OPENCODE_API_KEY="your-key"

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
Run a foreground OpenCode Starter API gateway.

${pc3.bold("Usage:")}
  opencode-starter server
  opencode-starter server --help
  opencode-starter server --version

${pc3.bold("Behavior:")}
  Prompts for local-only or network listen mode.
  Network mode asks for a server password.
  Server password is saved only if the user chooses to save it.
  Server host and port are not saved.`;
}
function printHelp(text) {
  console.log(`
${text}
`);
}
function printDryRun(backendName, modelId, baseUrl, modelFormat, claudeArgs, conflicts, disableExperimentalBetas) {
  console.log("");
  console.log(pc3.bold(pc3.cyan("  DRY RUN \u2014 would execute:")));
  console.log("");
  const claudeCmd = ["claude", "--model", modelId, ...claudeArgs].join(" ");
  console.log(`  ${pc3.bold("Command:")}  ${claudeCmd}`);
  console.log(`  ${pc3.bold("Backend:")}  ${backendName}`);
  if (modelFormat === "openai") {
    console.log(`  ${pc3.bold("Proxy:")}    would start local translation proxy ${pc3.dim("(Anthropic \u2192 OpenAI)")}`);
    console.log(`             ${pc3.dim(`\u2192 ${baseUrl}/v1/chat/completions`)}`);
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
    console.log(`    CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1  ${pc3.dim("(auto-set: model uses protocol translation)")}`);
  }
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
async function readFromCredentialStore() {
  try {
    const { Entry } = await import("@napi-rs/keyring");
    return new Entry("opencode-starter", "opencode-starter").getPassword() ?? null;
  } catch {
    return null;
  }
}
async function saveToCredentialStore(key) {
  try {
    const { Entry } = await import("@napi-rs/keyring");
    new Entry("opencode-starter", "opencode-starter").setPassword(key);
    return true;
  } catch {
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
async function resolveOrCollectApiKey(simulate = false) {
  if (!simulate) {
    const existing = resolveApiKey();
    if (existing) return existing;
  }
  const isMac = process.platform === "darwin";
  const isWindows2 = process.platform === "win32";
  const isLinux = process.platform === "linux";
  if (simulate) {
    p4.note(
      "Running in dry-run mode \u2014 no keys will be read from or written to your system.",
      "Simulating first-run onboarding"
    );
  }
  if (!simulate) {
    const storedKey = await readFromCredentialStore();
    if (storedKey) {
      const storeName = isMac ? "macOS Keychain" : isWindows2 ? "Windows Credential Manager" : "Secret Service";
      p4.log.success(`Found key in ${storeName}`);
      process.env["OPENCODE_API_KEY"] = storedKey;
      return storedKey;
    }
  }
  p4.note("Get your free key at: https://opencode.ai/settings/keys", "OpenCode API key");
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
    if (isWindows2) {
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
    initialValue: isMac ? "keychain" : isWindows2 ? "credential-manager" : secretServiceAvailable ? "secret-service" : "profile"
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
        const existing = existsSync3(path) ? readFileSync3(path, "utf8") : "";
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
      execSync2(`setx OPENCODE_API_KEY "${trimmedKey}"`, { stdio: ["pipe", "pipe", "pipe"] });
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
      if (!existsSync3(path)) appendFileSync2(path, "");
      appendFileSync2(path, `
export OPENCODE_API_KEY="${trimmedKey}"
`);
      p4.log.success(`Key saved to ${display} \u2014 active now and in all future terminals.`);
    } catch {
      p4.log.warn(`Could not write to ${display} \u2014 key will be used for this session only`);
    }
  }
  if (!simulate) process.env["OPENCODE_API_KEY"] = trimmedKey;
  return trimmedKey;
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
  const apiKey = await resolveOrCollectApiKey(dryRun);
  if (!apiKey && !dryRun) return 0;
  const effectiveKey = apiKey ?? "dry-run-placeholder";
  const prefs = dryRun ? {} : loadPreferences();
  const conflicts = detectConflicts();
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
  let zenModels = [];
  let goModels = [];
  try {
    if (needsZen) {
      const cachedZen = getCachedModels("zen") ?? void 0;
      const result = await getModels(BACKENDS.zen, cachedZen);
      zenModels = result.models;
      if (!result.fromCache && !dryRun) setCachedModels("zen", zenModels);
    }
    if (needsGo) {
      const cachedGo = getCachedModels("go") ?? void 0;
      const result = await getModels(BACKENDS.go, cachedGo);
      goModels = result.models;
      if (!result.fromCache && !dryRun) setCachedModels("go", goModels);
    }
    const total = zenModels.length + goModels.length;
    spinner3.stop(`Loaded ${total} models`);
  } catch (err) {
    spinner3.stop(pc3.red("Failed to load models"));
    console.error(pc3.red(String(err instanceof Error ? err.message : err)));
    return 1;
  }
  const selection = await runWizard(prefs, { zen: zenModels, go: goModels }, conflicts, tier);
  if (!selection) return 0;
  if (!dryRun) savePreferences({ lastBackend: selection.backend.id, lastModel: selection.model.id });
  const disableExperimentalBetas = true;
  if (dryRun) {
    printDryRun(
      selection.backend.name,
      selection.model.id,
      selection.backend.baseUrl,
      selection.model.modelFormat,
      claudeArgs,
      conflicts,
      disableExperimentalBetas
    );
    return 0;
  }
  let proxyHandle = null;
  if (selection.model.modelFormat === "openai") {
    try {
      proxyHandle = await startProxy(selection.backend.baseUrl, selection.model.id, trace);
      p4.log.info(
        `Translation proxy started on port ${proxyHandle.port} ` + pc3.dim(`(${selection.backend.baseUrl}/v1/chat/completions)`)
      );
    } catch (err) {
      p4.log.error(`Failed to start translation proxy: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
  }
  const childEnv = buildChildEnv(selection.backend, selection.model.id, effectiveKey, proxyHandle?.port);
  childEnv["CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS"] = "1";
  const debugLogPath = join4(tmpdir(), "opencode-starter-debug.log");
  const traceArgs = trace ? ["--debug-file", debugLogPath] : [];
  if (trace) {
    p4.log.info(`Debug log: ${debugLogPath}`);
  }
  const exitCode = await launchClaude(childEnv, selection.model.id, [...traceArgs, ...claudeArgs]);
  if (proxyHandle) {
    proxyHandle.close();
  }
  if (trace && existsSync3(debugLogPath)) {
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
  parseArgs,
  rootHelpText,
  runClaudeCommand,
  serverHelpText
};
//# sourceMappingURL=cli.js.map