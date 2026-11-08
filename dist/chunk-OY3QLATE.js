#!/usr/bin/env node
import {
  PoolHealthStore,
  describePoolFailure,
  forcedFailures,
  materializeRegistry,
  mergeHeaders,
  poolAccountScope,
  poolEndpointScope,
  poolErrorDetail,
  poolFailure,
  poolProviderHeaders,
  poolRouteMember,
  poolRoutingProblem,
  providerRefreshToken,
  recordPoolActivity,
  resolveLocalProviderApiKey,
  retryPoolFailure
} from "./chunk-5TOPC5SV.js";
import {
  copilotPlanTier,
  filterCachedCopilotModels,
  stripGoogleModelPrefix
} from "./chunk-7AT2OG2W.js";
import {
  normalizeToolSchemaForNpm
} from "./chunk-UR4QFFSQ.js";
import {
  formatUpstreamError
} from "./chunk-IRMXZJ3D.js";
import {
  REGISTRY_SCHEMA_VERSION,
  buildCodexReasoningLevels,
  createLanguageModel,
  currentPoolReceipt,
  deepMergeProviderOptions,
  effortProviderOptions,
  encodeToolUseId,
  findModelsDevModel,
  generateTextStreamingIfRequired,
  getReasoningCapabilities,
  grabRoundTripSignature,
  isValidProviderId,
  loadPreferences,
  loadRegistry,
  localTimestamp,
  modelsDevCrossVendorOutputLimit,
  parseDsmlToolCalls,
  parseFreePool,
  parseToolArguments,
  poolEndpointRevision,
  poolFreeStatus,
  receiptInForce,
  resolveModelReasoningMetadata,
  runCodexCommandSync,
  serializeToolResultContent,
  splitToolUseId,
  sseChunk,
  streamActivity,
  thinkingProviderOptions
} from "./chunk-6ATJUU3L.js";
import {
  isProviderKind,
  resolveProviderOAuthProviderData
} from "./chunk-P3FIONJC.js";

// src/core/pool-model.ts
import { randomUUID as randomUUID2 } from "crypto";

// src/pool/attempt.ts
var MAX_POOL_ATTEMPTS = 8;
var PoolAttemptError = class extends Error {
  constructor(code, committed, cause) {
    super(code);
    this.code = code;
    this.committed = committed;
    this.cause = cause;
  }
  code;
  committed;
  cause;
};
function validPoolFinish(part) {
  return part.type === "finish" && ["stop", "tool-calls", "length"].includes(part.finishReason ?? "");
}
var PoolCoordinatorError = class extends Error {
  /**
   * True when the shared request budget ended the wait, not this member's own first-content or idle limit.
   * The member never got its full allowance, so the timeout says nothing about its health.
   */
  constructor(message, budget = false) {
    super(message);
    this.budget = budget;
  }
  budget;
};
function meaningful(part) {
  return ["text-delta", "reasoning-delta"].includes(part.type) && Boolean(part.text) || part.type === "tool-input-delta" && Boolean(part.delta) || part.type === "tool-input-start" || part.type === "tool-call";
}
async function bounded(work, ms, signal, code, budget = false) {
  signal.throwIfAborted();
  if (ms <= 0) throw new PoolCoordinatorError(code, budget);
  let timer;
  let onAbort = () => {
  };
  const interrupted = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => reject(new PoolCoordinatorError(code, budget)), Math.max(0, ms));
  });
  try {
    return await Promise.race([work, interrupted]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}
async function* runPoolAttempts(routes, signal, limits, retryable, onAttempt = () => {
}, onFailure = () => {
}, onSkip = () => {
}) {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Invalid pool limit: " + name);
  }
  const deadline = Date.now() + limits.totalMs;
  let committed = false;
  let lastError;
  let opened = 0;
  for (const route of routes) {
    if (opened >= limits.attempts) break;
    signal.throwIfAborted();
    if (Date.now() >= deadline) throw new PoolAttemptError("total-deadline", committed);
    if (route.admit) {
      let reason;
      try {
        reason = await route.admit(signal);
      } catch (error) {
        if (signal.aborted) throw signal.reason ?? error;
        reason = "could not be prepared: " + (error instanceof Error ? error.message : String(error));
      }
      if (reason) {
        onSkip(route.id, reason);
        continue;
      }
    }
    opened += 1;
    const controller = new AbortController();
    const attemptSignal = AbortSignal.any([signal, controller.signal]);
    const attemptStart = Date.now();
    const firstDeadline = Math.min(deadline, attemptStart + limits.firstContentMs);
    const firstBudget = deadline < attemptStart + limits.firstContentMs;
    let iterator;
    const buffered = [];
    let bytes = 0;
    let completed = false;
    let consumerThrew = false;
    let consumerError;
    let terminalThrown = false;
    onAttempt(route.id);
    try {
      const stream = await bounded(route.open(attemptSignal), firstDeadline - Date.now(), attemptSignal, "first-content-timeout", firstBudget);
      iterator = stream[Symbol.asyncIterator]();
      while (true) {
        const now = Date.now();
        const remaining = (committed ? Math.min(deadline, now + limits.idleMs) : firstDeadline) - now;
        const budget = committed ? deadline < now + limits.idleMs : firstBudget;
        const next = await bounded(iterator.next(), remaining, attemptSignal, committed ? "idle-or-total-timeout" : "first-content-timeout", budget);
        signal.throwIfAborted();
        if (next.done) throw new PoolCoordinatorError("missing-valid-finish");
        const part = next.value;
        if (part.type === "error") throw part.error ?? new Error("stream-error");
        const terminal = part.type === "finish";
        if (terminal && !validPoolFinish(part)) throw new PoolCoordinatorError("invalid-finish");
        if (!committed) {
          bytes += Buffer.byteLength(JSON.stringify(part));
          if (bytes > limits.bufferBytes) throw new PoolCoordinatorError("provisional-buffer-limit");
          buffered.push(part);
          if (!meaningful(part) && !terminal) continue;
          committed = true;
          for (const pending of buffered) {
            signal.throwIfAborted();
            try {
              yield pending;
            } catch (error) {
              consumerThrew = true;
              consumerError = error;
              throw error;
            }
          }
          buffered.length = 0;
        } else {
          try {
            yield part;
          } catch (error) {
            consumerThrew = true;
            consumerError = error;
            throw error;
          }
        }
        if (terminal) {
          completed = true;
          return;
        }
      }
    } catch (error) {
      if (consumerThrew) {
        terminalThrown = true;
        throw consumerError;
      }
      lastError = error;
      if (!signal.aborted) {
        if (error instanceof PoolCoordinatorError && !error.budget) await route.recordAttemptFailure?.(error);
        await onFailure(route.id, error, committed);
      }
      if (signal.aborted) {
        terminalThrown = true;
        throw signal.reason;
      }
      if (committed || !retryable(error)) {
        terminalThrown = true;
        throw new PoolAttemptError("attempt-failed", committed, error);
      }
    } finally {
      controller.abort();
      if (iterator?.return) {
        try {
          await bounded(iterator.return(), limits.cleanupMs, new AbortController().signal, "cleanup-timeout");
        } catch {
          if (!completed && !consumerThrew && !terminalThrown && !signal.aborted) {
            throw new PoolAttemptError("cleanup-failed", committed, lastError);
          }
        }
      }
    }
  }
  if (opened === 0) throw new PoolAttemptError("no-admitted-route", false, lastError);
  throw new PoolAttemptError("attempt-budget-exhausted", committed, lastError);
}

// src/pool/codex-retry.ts
import { createHash } from "crypto";
var DEFAULT_LIMITS = {
  ttlMs: 6e4,
  maxEntries: 128,
  maxResponseBytes: 2 * 1024 * 1024
};
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const record = value;
  return "{" + Object.keys(record).sort().map((key) => JSON.stringify(key) + ":" + canonical(record[key])).join(",") + "}";
}
function requestFingerprint(request) {
  return createHash("sha256").update(canonical(request)).digest("hex");
}
function checkLimit(name, value) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Invalid retry limit: " + name);
}
var CodexRetryGuard = class {
  constructor(limits = {}, now = Date.now) {
    this.now = now;
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    for (const [name, value] of Object.entries(this.limits)) checkLimit(name, value);
  }
  now;
  entries = /* @__PURE__ */ new Map();
  limits;
  /**
   * Claims one request operation. turnId must be the observed client turn;
   * fingerprint must hash the full translated request.
   */
  acquire(turnId, fingerprint) {
    if (!turnId || !fingerprint) throw new Error("turn-id-and-fingerprint-required");
    this.prune();
    const key = JSON.stringify([turnId, fingerprint]);
    const existing = this.entries.get(key);
    if (existing) {
      if (existing.status === "active") return { kind: "busy" };
      if (existing.status === "failed") return { kind: "blocked", reason: existing.reason ?? "previous-attempt-failed" };
      return { kind: "replay", response: existing.response };
    }
    if (this.entries.size >= this.limits.maxEntries) {
      return { kind: "blocked", reason: "retry-guard-capacity" };
    }
    const entry = { status: "active", token: /* @__PURE__ */ Symbol(), expires: this.now() + this.limits.ttlMs };
    this.entries.set(key, entry);
    const settle = (token) => this.entries.get(key)?.token === token;
    return {
      kind: "owner",
      complete: (response) => {
        if (!settle(entry.token)) return;
        if (typeof response !== "string" || Buffer.byteLength(response, "utf8") > this.limits.maxResponseBytes) {
          this.entries.set(key, { status: "failed", token: entry.token, expires: this.now() + this.limits.ttlMs, reason: "response-too-large" });
          return;
        }
        this.entries.set(key, { status: "succeeded", token: entry.token, expires: this.now() + this.limits.ttlMs, response });
      },
      fail: (reason, postcommit = false) => {
        if (!settle(entry.token)) return;
        this.entries.set(key, {
          status: "failed",
          token: entry.token,
          expires: this.now() + this.limits.ttlMs,
          reason: reason || "previous-attempt-failed",
          postcommit
        });
      },
      release: () => {
        if (settle(entry.token)) this.entries.delete(key);
      }
    };
  }
  prune() {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.status !== "active" && entry.expires <= now) this.entries.delete(key);
    }
  }
};

// src/codex-responses-adapter.ts
import { createHash as createHash2 } from "crypto";
import { streamText, tool, jsonSchema } from "ai";
function createCodexToolContext() {
  return { namespaceByFlatName: /* @__PURE__ */ new Map(), customToolNames: /* @__PURE__ */ new Set() };
}
var TOOL_SEARCH_NAME = "tool_search";
var MAX_MODEL_TOOL_NAME_LENGTH = 64;
var TOOL_NAME_DIGEST_LENGTH = 10;
function flatNamespaceName(namespace, name) {
  const flat = `${namespace}__${name}`;
  if (flat.length <= MAX_MODEL_TOOL_NAME_LENGTH) return flat;
  const digest = createHash2("sha256").update(flat).digest("hex").slice(0, TOOL_NAME_DIGEST_LENGTH);
  const prefixLength = MAX_MODEL_TOOL_NAME_LENGTH - digest.length - 2;
  return `${flat.slice(0, prefixLength)}__${digest}`;
}
function ingestToolDefs(tools, ctx) {
  for (const t of tools ?? []) {
    if (!t || typeof t !== "object") continue;
    if (t.type === "namespace") {
      for (const sub of t.tools ?? []) {
        if (sub?.type === "custom" && sub.name) {
          ctx.customToolNames.add(sub.name);
        } else if (sub?.type === "function" && sub.name) {
          ctx.namespaceByFlatName.set(flatNamespaceName(t.name, sub.name), {
            namespace: t.name,
            name: sub.name,
            parameters: sub.parameters
          });
        }
      }
    } else if (t.type === "custom" && t.name) {
      ctx.customToolNames.add(t.name);
    }
  }
}
function flattenNamespaceTools(ns) {
  return (ns.tools ?? []).filter((sub) => (sub?.type === "function" || sub?.type === "custom") && !!sub.name).map((sub) => sub.type === "custom" ? sub : { ...sub, name: flatNamespaceName(ns.name, sub.name) });
}
function liftAdditionalToolsInput(input, tools) {
  let lifted = [];
  const keptInput = [];
  let changed = false;
  for (const item of input) {
    if (item && item.type === "additional_tools") {
      changed = true;
      if (Array.isArray(item.tools)) lifted = lifted.concat(item.tools);
      if (item.content !== void 0) {
        keptInput.push({ role: item.role ?? "developer", content: item.content });
      }
      continue;
    }
    keptInput.push(item);
  }
  if (!changed) return { input, tools };
  return { input: keptInput, tools: lifted.length ? [...tools, ...lifted] : tools };
}
function messageText(content) {
  if (typeof content === "string") return content;
  return (content ?? []).map((p) => p.type === "output_text" || p.type === "input_text" || p.type === "text" ? p.text ?? "" : "").join("");
}
function messageContent(content) {
  if (typeof content === "string") return content;
  const parts = (content ?? []).flatMap((part) => {
    if (part.type === "output_text" || part.type === "input_text" || part.type === "text") {
      return typeof part.text === "string" ? [{ type: "text", text: part.text }] : [];
    }
    if (part.type === "input_image" && typeof part.image_url === "string" && part.image_url.trim()) {
      return [{ type: "image", image: part.image_url }];
    }
    return [];
  });
  return parts.length > 0 ? parts : [{ type: "text", text: "" }];
}
function splitToolOutputImages(output) {
  if (!Array.isArray(output)) return { content: serializeToolResultContent(output), images: [] };
  const images = [];
  const rest = [];
  for (const part of output) {
    const record = part && typeof part === "object" ? part : void 0;
    const imageUrl = record?.["type"] === "input_image" ? record["image_url"] : void 0;
    if (typeof imageUrl === "string" && imageUrl.trim()) images.push(imageUrl);
    else rest.push(part);
  }
  if (images.length === 0) return { content: serializeToolResultContent(output), images };
  return {
    content: rest.length > 0 ? serializeToolResultContent(rest) : "[image attached in the following message]",
    images
  };
}
function extractDeveloperAndInstructions(items2, instructions) {
  const developerParts = [];
  const remaining = [];
  for (const item of items2) {
    if ("role" in item && item.role === "developer") {
      const text = messageText(item.content);
      if (text.trim()) developerParts.push(text.trim());
    } else {
      remaining.push(item);
    }
  }
  const parts = [...developerParts];
  if (instructions?.trim()) parts.push(instructions.trim());
  const system = parts.length ? parts.join("\n") : void 0;
  return { system, remaining };
}
function annotateToolNamesFromCalls(items2) {
  const nameByCallId = /* @__PURE__ */ new Map();
  for (const item of items2) {
    if (item.type === "function_call") {
      const { rawId } = splitToolUseId(item.call_id);
      nameByCallId.set(rawId, item.namespace ? flatNamespaceName(item.namespace, item.name) : item.name);
    } else if (item.type === "tool_search_call") {
      const { rawId } = splitToolUseId(item.call_id);
      nameByCallId.set(rawId, TOOL_SEARCH_NAME);
    } else if (item.type === "custom_tool_call") {
      const { rawId } = splitToolUseId(item.call_id);
      nameByCallId.set(rawId, item.name);
    }
  }
  return nameByCallId;
}
function customToolInputFromArgs(name, args) {
  if (typeof args === "string") {
    const trimmed = args.trim();
    if (name === "apply_patch" && trimmed.startsWith("*** Begin Patch")) return args;
    try {
      return customToolInputFromArgs(name, JSON.parse(trimmed));
    } catch {
      return args;
    }
  }
  if (args && typeof args === "object") {
    const obj = args;
    if (Array.isArray(obj.command) && obj.command[0] === "apply_patch" && typeof obj.command[1] === "string") {
      return obj.command[1];
    }
    if (typeof obj.input === "string") return obj.input;
    for (const v of Object.values(obj)) {
      if (typeof v === "string") return v;
    }
  }
  return serializeToolResultContent(args);
}
function mergeConsecutiveMessages(messages) {
  if (messages.length <= 1) return messages;
  const out = [];
  for (const msg of messages) {
    const prev = out[out.length - 1];
    if (prev && prev.role === msg.role) {
      const prevContent = Array.isArray(prev.content) ? prev.content : [{ type: "text", text: String(prev.content ?? "") }];
      const msgContent = Array.isArray(msg.content) ? msg.content : [{ type: "text", text: String(msg.content ?? "") }];
      prev.content = [...prevContent, ...msgContent];
    } else {
      out.push(msg);
    }
  }
  return out;
}
function ensureUserFirst(messages) {
  if (messages.length === 0) return [{ role: "user", content: [{ type: "text", text: "(empty input)" }] }];
  if (messages[0].role === "assistant") {
    return [{ role: "user", content: [{ type: "text", text: "(conversation continued)" }] }, ...messages];
  }
  return messages;
}
function reasoningSummaryText(item) {
  return (item.summary ?? []).map((part) => part.type === "summary_text" ? part.text ?? "" : "").join("");
}
function makeReasoningOutputItem(id, text) {
  return {
    id,
    type: "reasoning",
    summary: text.trim() ? [{ type: "summary_text", text }] : []
  };
}
function translateResponsesInput(input, instructions, npm, toolContext = createCodexToolContext()) {
  if (typeof input === "string") {
    return {
      instructions: instructions?.trim() || void 0,
      messages: [{ role: "user", content: [{ type: "text", text: input }] }],
      deferredTools: []
    };
  }
  const { system, remaining } = extractDeveloperAndInstructions(input, instructions);
  const toolNames = annotateToolNamesFromCalls(remaining);
  const messages = [];
  const deferredTools = [];
  let pendingReasoning = "";
  for (const item of remaining) {
    if (item.type === "reasoning") {
      pendingReasoning += reasoningSummaryText(item);
      continue;
    }
    if (item.type === "function_call") {
      const { rawId, thoughtSignature } = splitToolUseId(item.call_id);
      const parts = [];
      if (pendingReasoning.trim()) {
        parts.push({ type: "reasoning", text: pendingReasoning });
        pendingReasoning = "";
      }
      const toolPart = {
        type: "tool-call",
        toolCallId: rawId,
        toolName: item.namespace ? flatNamespaceName(item.namespace, item.name) : item.name,
        input: parseToolArguments(item.arguments)
      };
      if (thoughtSignature && npm === "@ai-sdk/google") {
        toolPart.providerOptions = { google: { thoughtSignature } };
      }
      parts.push(toolPart);
      messages.push({ role: "assistant", content: parts });
    } else if (item.type === "function_call_output") {
      const { rawId } = splitToolUseId(item.call_id);
      const toolName = toolNames.get(rawId) ?? "unknown";
      const { content, images } = splitToolOutputImages(item.output);
      messages.push({
        role: "tool",
        content: [{
          type: "tool-result",
          toolCallId: rawId,
          toolName,
          output: { type: "text", value: content }
        }]
      });
      if (images.length > 0) {
        messages.push({
          role: "user",
          content: [
            { type: "text", text: `Image${images.length > 1 ? "s" : ""} returned by ${toolName} (${rawId}):` },
            ...images.map((image) => ({ type: "image", image }))
          ]
        });
      }
    } else if (item.type === "tool_search_call") {
      const { rawId, thoughtSignature } = splitToolUseId(item.call_id);
      const parts = [];
      if (pendingReasoning.trim()) {
        parts.push({ type: "reasoning", text: pendingReasoning });
        pendingReasoning = "";
      }
      parts.push({
        type: "tool-call",
        toolCallId: rawId,
        toolName: TOOL_SEARCH_NAME,
        input: parseToolArguments(item.arguments),
        ...thoughtSignature && npm === "@ai-sdk/google" ? { providerOptions: { google: { thoughtSignature } } } : {}
      });
      messages.push({ role: "assistant", content: parts });
    } else if (item.type === "tool_search_output") {
      const { rawId } = splitToolUseId(item.call_id);
      const surfacedTools = item.tools ?? [];
      ingestToolDefs(surfacedTools, toolContext);
      for (const t of surfacedTools) {
        if (t.type === "namespace") deferredTools.push(...flattenNamespaceTools(t));
        else if (t.type === "function" || t.type === "custom") deferredTools.push(t);
      }
      messages.push({
        role: "tool",
        content: [{
          type: "tool-result",
          toolCallId: rawId,
          toolName: TOOL_SEARCH_NAME,
          output: { type: "text", value: serializeToolResultContent(surfacedTools) }
        }]
      });
    } else if (item.type === "custom_tool_call") {
      const { rawId, thoughtSignature } = splitToolUseId(item.call_id);
      const parts = [];
      if (pendingReasoning.trim()) {
        parts.push({ type: "reasoning", text: pendingReasoning });
        pendingReasoning = "";
      }
      parts.push({
        type: "tool-call",
        toolCallId: rawId,
        toolName: item.name,
        input: { input: typeof item.input === "string" ? item.input : serializeToolResultContent(item.input) },
        ...thoughtSignature && npm === "@ai-sdk/google" ? { providerOptions: { google: { thoughtSignature } } } : {}
      });
      messages.push({ role: "assistant", content: parts });
    } else if (item.type === "custom_tool_call_output") {
      const { rawId } = splitToolUseId(item.call_id);
      messages.push({
        role: "tool",
        content: [{
          type: "tool-result",
          toolCallId: rawId,
          toolName: toolNames.get(rawId) ?? "unknown",
          output: { type: "text", value: serializeToolResultContent(item.output) }
        }]
      });
    } else if (item.type === "agent_message") {
      const text = messageText(item.content);
      if (text.trim()) {
        messages.push({ role: "user", content: [{ type: "text", text }] });
      }
    } else if (item.type === "compaction" || item.type === "context_compaction") {
      const summary = decodeCompactionContent(item.encrypted_content) ?? "";
      if (summary.trim()) {
        messages.push({ role: "user", content: [{ type: "text", text: `[Summary of earlier conversation]
${summary}` }] });
      }
    } else if ("role" in item) {
      const role = item.role === "assistant" ? "assistant" : "user";
      const content = messageContent(item.content);
      messages.push({ role, content });
    }
  }
  return {
    instructions: system,
    messages: ensureUserFirst(mergeConsecutiveMessages(messages)),
    deferredTools
  };
}
var TOOL_SEARCH_DESCRIPTION = "Search the available deferred Codex tools, plugin tools, MCP namespaces, and connectors by query. Use this when a needed tool is not already present in the current tool list. Returns matching tool definitions for a follow-up call.";
var TOOL_SEARCH_PARAMETERS = {
  type: "object",
  properties: {
    query: { type: "string", description: "Search query describing the tool or capability needed." },
    limit: { type: "number", description: "Maximum number of matching tools to return. Defaults to 8." }
  },
  required: ["query"],
  additionalProperties: false
};
var CUSTOM_TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: { input: { type: "string", description: "Freeform input for this custom tool (e.g. a patch body)." } },
  required: ["input"],
  additionalProperties: false
};
function translateResponsesTools(tools, options = {}) {
  if (!tools?.length) return void 0;
  const out = {};
  let toolCount = 0;
  const addTool = (name, description, parameters) => {
    if (options.maxTools !== void 0 && toolCount >= options.maxTools) return;
    out[name] = tool({
      description: description ?? "",
      inputSchema: jsonSchema(normalizeToolSchemaForNpm(parameters ?? { type: "object", properties: {} }, options.npm))
    });
    toolCount++;
  };
  for (const t of tools) {
    if (!t || typeof t !== "object") continue;
    if (t.type === "namespace") {
      for (const nested of t.tools ?? []) {
        if (!nested.name) continue;
        if (nested.type === "custom") {
          addTool(nested.name, nested.description, CUSTOM_TOOL_INPUT_SCHEMA);
        } else if (nested.type === "function") {
          addTool(flatNamespaceName(t.name, nested.name), nested.description, nested.parameters);
        }
      }
      continue;
    }
    if (t.type === "custom") {
      if (!t.name) continue;
      addTool(t.name, t.description, CUSTOM_TOOL_INPUT_SCHEMA);
      continue;
    }
    if (t.type === "tool_search") {
      addTool(TOOL_SEARCH_NAME, TOOL_SEARCH_DESCRIPTION, TOOL_SEARCH_PARAMETERS);
      continue;
    }
    if (t.type !== "function" || !t.name) continue;
    addTool(t.name, t.description, t.parameters);
  }
  return Object.keys(out).length ? out : void 0;
}
function omitsMaxOutputTokens(metadata) {
  return metadata?.providerId !== void 0 && isProviderKind(metadata.providerId, "openrouter") || (metadata?.apiBaseUrl?.includes("openrouter.ai") ?? false);
}
function translateResponsesRequest(body, npm, metadata, options = {}) {
  const toolContext = createCodexToolContext();
  let effectiveTools = body.tools ?? [];
  let effectiveInput = body.input;
  if (Array.isArray(effectiveInput)) {
    const lifted = liftAdditionalToolsInput(effectiveInput, effectiveTools);
    effectiveInput = lifted.input;
    effectiveTools = lifted.tools;
  }
  ingestToolDefs(effectiveTools, toolContext);
  const { instructions: system, messages, deferredTools } = translateResponsesInput(effectiveInput, body.instructions, npm, toolContext);
  const effort = body.reasoning?.effort;
  const providerOptions = deepMergeProviderOptions(
    thinkingProviderOptions(npm),
    effortProviderOptions(npm, effort, metadata?.upstreamModelId ?? body.model, metadata)
  );
  const tools = translateResponsesTools([...effectiveTools, ...deferredTools], { ...options, npm });
  const bridgedGemini = npm === "@ai-sdk/anthropic" && metadata?.providerId !== void 0 && isProviderKind(metadata.providerId, "antigravity") && /(?:^|__)gemini-/.test(metadata.upstreamModelId ?? body.model);
  return {
    instructions: system,
    messages,
    tools,
    ...options.forwardToolChoice ? { toolChoice: translateResponsesToolChoice(body.tool_choice) } : {},
    toolContext,
    maxOutputTokens: omitsMaxOutputTokens(metadata) ? void 0 : body.max_output_tokens ?? (bridgedGemini ? 65536 : void 0),
    temperature: body.temperature,
    providerOptions,
    headers: options.requestHeaders
  };
}
function translateResponsesToolChoice(choice) {
  if (choice === "auto" || choice === "none" || choice === "required") return choice;
  if (!choice || typeof choice !== "object") return void 0;
  if (choice.type === "function" || choice.type === "custom") {
    return typeof choice.name === "string" && choice.name ? { type: "tool", toolName: choice.name } : void 0;
  }
  if (choice.type === "tool_search") return { type: "tool", toolName: TOOL_SEARCH_NAME };
  return void 0;
}
function newResponseId() {
  return `resp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
function newItemId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
function functionCallItemId(upstreamId) {
  return upstreamId.startsWith("fc_") ? upstreamId : newItemId("fc");
}
function usageFromPart(part) {
  const input = part.totalUsage?.inputTokens ?? 0;
  const output = part.totalUsage?.outputTokens ?? 0;
  const cached = part.totalUsage?.inputTokenDetails?.cacheReadTokens ?? 0;
  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: input + output,
    ...cached > 0 ? { input_tokens_details: { cached_tokens: cached } } : {}
  };
}
var CODEX_SUBAGENT_TOOL_NAMES = /* @__PURE__ */ new Set(["spawn_agent", "multi_agent_v1__spawn_agent"]);
function isCodexSubagentToolName(toolName) {
  return CODEX_SUBAGENT_TOOL_NAMES.has(toolName) || toolName.endsWith("__spawn_agent");
}
function normalizeCodexSubagentArguments(toolName, argsStr) {
  if (!isCodexSubagentToolName(toolName)) return argsStr;
  const args = parseToolArguments(argsStr);
  for (const key of ["model", "reasoning_effort", "service_tier"]) {
    if (args[key] === "") delete args[key];
  }
  const items2 = args.items;
  const message = args.message;
  if (Array.isArray(items2) && items2.length > 0) {
    delete args.message;
  } else if (typeof message === "string" && message.trim()) {
    delete args.items;
  } else if (Array.isArray(items2) && items2.length === 0) {
    delete args.items;
  }
  return JSON.stringify(args);
}
function resolveOutputKind(flatName, ctx) {
  if (!ctx) return { kind: "plain" };
  if (flatName === TOOL_SEARCH_NAME) return { kind: "tool_search" };
  if (ctx.customToolNames.has(flatName)) return { kind: "custom" };
  const ns = ctx.namespaceByFlatName.get(flatName);
  if (ns) return { kind: "namespace", namespace: ns.namespace, name: ns.name };
  return { kind: "plain" };
}
function toolItemId(kind, upstreamId) {
  switch (kind.kind) {
    case "tool_search":
      return upstreamId.startsWith("tsc_") ? upstreamId : newItemId("tsc");
    case "custom":
      return upstreamId.startsWith("ctc_") ? upstreamId : newItemId("ctc");
    default:
      return functionCallItemId(upstreamId);
  }
}
function buildFinalToolItem(kind, flatName, callId, itemId, argsStr) {
  argsStr = normalizeCodexSubagentArguments(flatName, argsStr);
  switch (kind.kind) {
    case "namespace":
      return { type: "function_call", id: itemId, call_id: callId, namespace: kind.namespace, name: kind.name, arguments: argsStr, status: "completed" };
    case "tool_search": {
      const args = parseToolArguments(argsStr);
      if (typeof args.limit === "string" && /^-?\d+$/.test(args.limit)) args.limit = Number(args.limit);
      return { type: "tool_search_call", id: itemId, call_id: callId, execution: "client", arguments: args, status: "completed" };
    }
    case "custom":
      return { type: "custom_tool_call", id: itemId, call_id: callId, name: flatName, input: customToolInputFromArgs(flatName, parseToolArguments(argsStr)), status: "completed" };
    default:
      return { type: "function_call", id: itemId, call_id: callId, name: flatName, arguments: argsStr, status: "completed" };
  }
}
function incompleteReasonForFinish(finishReason) {
  if (finishReason === "length") return "max_output_tokens";
  if (finishReason === "content-filter") return "content_filter";
  return void 0;
}
var PROGRESS_INTERVAL_MS = 3e3;
var REPEAT_TAIL_CHARS = 200;
var REPEAT_STREAK_LIMIT = 3;
var LOOP_NOTICE = "\n\n[relay-ai: generation stopped after detecting a repetition loop]";
var INITIAL_REPEAT_TRACKER = { tail: "", len: 0, streak: 0 };
function trackRepetition(current, prev) {
  const tail = current.length >= REPEAT_TAIL_CHARS ? current.slice(-REPEAT_TAIL_CHARS) : current;
  const grew = current.length - prev.len >= REPEAT_TAIL_CHARS;
  const stale = tail.length === REPEAT_TAIL_CHARS && tail === prev.tail && grew;
  return { tail, len: current.length, streak: stale ? prev.streak + 1 : 0 };
}
async function writeResponsesStream(fullStream, modelId, write, onDone, onProgress, options) {
  const emit = (type, data) => write(sseChunk(type, data));
  const responseId = newResponseId();
  const createdAt = Math.floor(Date.now() / 1e3);
  let usage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  emit("response.created", {
    type: "response.created",
    response: {
      id: responseId,
      object: "response",
      model: modelId,
      created_at: createdAt,
      status: "in_progress",
      output: []
    }
  });
  let outputIndex = 0;
  let textItemId = null;
  let textOutputIndex = 0;
  let textFull = "";
  const toolStates = [];
  const toolStatesById = /* @__PURE__ */ new Map();
  let currentToolState = null;
  const streamStartedAt = Date.now();
  let lastProgressAt = streamStartedAt;
  const recentPartCounts = /* @__PURE__ */ new Map();
  let reasoningItemId = null;
  let reasoningText = "";
  let reasoningOutputIndex = 0;
  const outputItems = [];
  let reasoningRepeat = INITIAL_REPEAT_TRACKER;
  let textRepeat = INITIAL_REPEAT_TRACKER;
  let loopDetected;
  let finishReason;
  const ensureTextItem = () => {
    if (!textItemId) {
      textItemId = newItemId("msg");
      textOutputIndex = outputIndex;
      outputIndex++;
      emit("response.output_item.added", {
        type: "response.output_item.added",
        output_index: textOutputIndex,
        item: { id: textItemId, type: "message", role: "assistant", status: "in_progress", content: [] }
      });
      emit("response.content_part.added", {
        type: "response.content_part.added",
        item_id: textItemId,
        output_index: textOutputIndex,
        content_index: 0,
        part: { type: "output_text", text: "" }
      });
    }
    return textItemId;
  };
  const rememberToolState = (state) => {
    toolStates.push(state);
    toolStatesById.set(state.itemId, state);
    toolStatesById.set(state.callId, state);
    currentToolState = state;
    return state;
  };
  const createToolState = (rawId, name, signature) => {
    const kind = resolveOutputKind(name ?? "", options?.toolContext);
    const upstreamId = rawId ?? newItemId("call");
    const itemId = toolItemId(kind, upstreamId);
    const state = rememberToolState({
      itemId,
      callId: encodeToolUseId(upstreamId, signature, false),
      name: name ?? "unknown",
      outputIndex: outputIndex++,
      args: "",
      kind
    });
    emit("response.output_item.added", {
      type: "response.output_item.added",
      output_index: state.outputIndex,
      item: {
        type: "function_call",
        id: state.itemId,
        call_id: state.callId,
        name: state.name,
        arguments: "",
        status: "in_progress"
      }
    });
    return state;
  };
  const findToolState = (part) => {
    const key = part.id ?? part.toolCallId;
    if (key) return toolStatesById.get(key) ?? currentToolState;
    return currentToolState;
  };
  const appendToolArgs = (state, delta) => {
    if (!delta) return;
    state.args += delta;
    emit("response.function_call_arguments.delta", {
      type: "response.function_call_arguments.delta",
      item_id: state.itemId,
      output_index: state.outputIndex,
      delta
    });
  };
  for await (const part of fullStream) {
    recentPartCounts.set(part.type, (recentPartCounts.get(part.type) ?? 0) + 1);
    switch (part.type) {
      case "reasoning-start":
        reasoningText = "";
        reasoningItemId = newItemId("rs");
        reasoningOutputIndex = outputIndex++;
        emit("response.output_item.added", {
          type: "response.output_item.added",
          output_index: reasoningOutputIndex,
          item: { id: reasoningItemId, type: "reasoning", summary: [] }
        });
        break;
      case "reasoning-delta":
        if (!reasoningItemId) {
          reasoningItemId = newItemId("rs");
          reasoningOutputIndex = outputIndex++;
          emit("response.output_item.added", {
            type: "response.output_item.added",
            output_index: reasoningOutputIndex,
            item: { id: reasoningItemId, type: "reasoning", summary: [] }
          });
        }
        reasoningText += part.text ?? "";
        break;
      case "reasoning-end":
        break;
      case "text-start":
        textFull = "";
        ensureTextItem();
        break;
      case "text-delta":
        ensureTextItem();
        textFull += part.text ?? "";
        emit("response.output_text.delta", {
          type: "response.output_text.delta",
          item_id: textItemId,
          output_index: textOutputIndex,
          content_index: 0,
          delta: part.text ?? ""
        });
        break;
      case "tool-input-start": {
        const sig = grabRoundTripSignature(part);
        createToolState(part.id ?? part.toolCallId, part.toolName, sig);
        break;
      }
      case "tool-input-delta": {
        const state = findToolState(part);
        if (state) appendToolArgs(state, part.delta ?? part.text ?? "");
        break;
      }
      case "tool-call": {
        const sig = grabRoundTripSignature(part);
        const key = part.toolCallId ?? part.id;
        const state = (key ? toolStatesById.get(key) : void 0) ?? createToolState(key, part.toolName, sig);
        if (!state.args) {
          appendToolArgs(state, JSON.stringify(part.input ?? {}));
        }
        break;
      }
      case "finish-step":
        if (part.finishReason) finishReason = part.finishReason;
        break;
      case "finish":
        if (part.finishReason) finishReason = part.finishReason;
        if (part.totalUsage) usage = usageFromPart(part);
        break;
      case "abort": {
        const msg = `stream aborted: ${part.reason ?? "no data received from provider"}`;
        process.stderr.write(`[relay-ai] ${localTimestamp()} ${options?.logLabel ?? modelId}: ${msg}
`);
        onDone?.({
          reasoningChars: reasoningText.length,
          reasoningPreview: reasoningText.slice(0, 200),
          textChars: textFull.length,
          toolCallCount: toolStates.length,
          toolNames: toolStates.map((t) => t.name),
          loopDetected,
          aborted: true
        });
        emit("response.failed", {
          type: "response.failed",
          response: {
            id: responseId,
            object: "response",
            model: modelId,
            created_at: createdAt,
            status: "failed",
            output: [],
            error: { message: msg, type: "api_error" }
          }
        });
        return;
      }
      case "error": {
        const msg = formatUpstreamError(part.error);
        const is429 = msg.includes("429") || part.error && typeof part.error === "object" && (part.error.statusCode === 429 || part.error.lastError?.statusCode === 429);
        process.stderr.write(`[relay-ai] ${localTimestamp()} ${options?.logLabel ?? modelId}: ${msg}
`);
        onDone?.({
          reasoningChars: reasoningText.length,
          reasoningPreview: reasoningText.slice(0, 200),
          textChars: textFull.length,
          toolCallCount: toolStates.length,
          toolNames: toolStates.map((t) => t.name),
          loopDetected,
          errorMessage: msg,
          errorStatus: part.error?.statusCode
        });
        emit("response.failed", {
          type: "response.failed",
          response: {
            id: responseId,
            object: "response",
            model: modelId,
            created_at: createdAt,
            status: "failed",
            output: [],
            error: { message: msg, type: is429 ? "rate_limit_error" : "api_error", ...is429 ? { code: "429" } : {} }
          }
        });
        return;
      }
      default:
        break;
    }
    const now = Date.now();
    if (now - lastProgressAt >= PROGRESS_INTERVAL_MS) {
      lastProgressAt = now;
      reasoningRepeat = trackRepetition(reasoningText, reasoningRepeat);
      textRepeat = trackRepetition(textFull, textRepeat);
      if (reasoningRepeat.streak >= REPEAT_STREAK_LIMIT) loopDetected = "reasoning";
      else if (textRepeat.streak >= REPEAT_STREAK_LIMIT) loopDetected = "text";
      if (onProgress) {
        onProgress({
          reasoningChars: reasoningText.length,
          reasoningTail: reasoningText.slice(-200),
          textChars: textFull.length,
          toolCallCount: toolStates.length,
          elapsedMs: now - streamStartedAt,
          recentPartTypes: [...recentPartCounts].map(([type, n]) => `${type}:${n}`).join(",")
        });
      }
      recentPartCounts.clear();
      if (loopDetected) {
        options?.onForceStop?.(`repetition loop detected (${loopDetected})`);
        break;
      }
    }
  }
  const incompleteReason = incompleteReasonForFinish(finishReason);
  if (loopDetected) {
    ensureTextItem();
    textFull += LOOP_NOTICE;
    emit("response.output_text.delta", {
      type: "response.output_text.delta",
      item_id: textItemId,
      output_index: textOutputIndex,
      content_index: 0,
      delta: LOOP_NOTICE
    });
  }
  const dsml = loopDetected || incompleteReason ? null : parseDsmlToolCalls(textFull);
  if (dsml) {
    if (dsml.leadingText && textItemId) {
      emit("response.output_text.done", {
        type: "response.output_text.done",
        item_id: textItemId,
        output_index: textOutputIndex,
        content_index: 0,
        text: dsml.leadingText
      });
      emit("response.content_part.done", {
        type: "response.content_part.done",
        item_id: textItemId,
        output_index: textOutputIndex,
        content_index: 0,
        part: { type: "output_text", text: dsml.leadingText }
      });
      const textItem = {
        id: textItemId,
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: dsml.leadingText }]
      };
      emit("response.output_item.done", {
        type: "response.output_item.done",
        output_index: textOutputIndex,
        item: textItem
      });
      outputItems.push(textItem);
    }
    for (const call of dsml.calls) {
      const itemId = newItemId("fc");
      const callId = encodeToolUseId(itemId, void 0, false);
      const idx = outputIndex++;
      const args = JSON.stringify(call.args);
      emit("response.output_item.added", {
        type: "response.output_item.added",
        output_index: idx,
        item: { type: "function_call", id: itemId, call_id: callId, name: call.name, arguments: "", status: "in_progress" }
      });
      emit("response.function_call_arguments.done", {
        type: "response.function_call_arguments.done",
        item_id: itemId,
        output_index: idx,
        arguments: args
      });
      const fcItem = { type: "function_call", id: itemId, call_id: callId, name: call.name, arguments: args, status: "completed" };
      emit("response.output_item.done", { type: "response.output_item.done", output_index: idx, item: fcItem });
      outputItems.push(fcItem);
    }
  } else if (textItemId) {
    emit("response.output_text.done", {
      type: "response.output_text.done",
      item_id: textItemId,
      output_index: textOutputIndex,
      content_index: 0,
      text: textFull
    });
    emit("response.content_part.done", {
      type: "response.content_part.done",
      item_id: textItemId,
      output_index: textOutputIndex,
      content_index: 0,
      part: { type: "output_text", text: textFull }
    });
    const textItem = {
      id: textItemId,
      type: "message",
      role: "assistant",
      status: incompleteReason ? "incomplete" : "completed",
      content: [{ type: "output_text", text: textFull }]
    };
    emit("response.output_item.done", {
      type: "response.output_item.done",
      output_index: textOutputIndex,
      item: textItem
    });
    outputItems.push(textItem);
  }
  if (reasoningItemId) {
    const reasoningItem = makeReasoningOutputItem(reasoningItemId, reasoningText);
    emit("response.output_item.done", {
      type: "response.output_item.done",
      output_index: reasoningOutputIndex,
      item: reasoningItem
    });
    outputItems.unshift(reasoningItem);
  }
  for (const tool2 of incompleteReason ? [] : toolStates) {
    const normalizedArgs = normalizeCodexSubagentArguments(tool2.name, tool2.args);
    emit("response.function_call_arguments.done", {
      type: "response.function_call_arguments.done",
      item_id: tool2.itemId,
      output_index: tool2.outputIndex,
      arguments: normalizedArgs
    });
    const fcItem = buildFinalToolItem(tool2.kind, tool2.name, tool2.callId, tool2.itemId, normalizedArgs);
    emit("response.output_item.done", {
      type: "response.output_item.done",
      output_index: tool2.outputIndex,
      item: fcItem
    });
    outputItems.push(fcItem);
  }
  if (outputItems.length === 0 && !incompleteReason) {
    outputItems.push({ id: newItemId("msg"), type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "(conversation context was too large to summarize)" }] });
  }
  onDone?.({
    reasoningChars: reasoningText.length,
    reasoningPreview: reasoningText.slice(0, 200),
    textChars: textFull.length,
    toolCallCount: toolStates.length,
    toolNames: toolStates.map((t) => t.name),
    loopDetected,
    dsmlToolCallsRecovered: dsml?.calls.length,
    finishReason,
    incompleteReason
  });
  const terminalEvent = incompleteReason ? "response.incomplete" : "response.completed";
  emit(terminalEvent, {
    type: terminalEvent,
    response: {
      id: responseId,
      object: "response",
      model: modelId,
      created_at: createdAt,
      status: incompleteReason ? "incomplete" : "completed",
      ...incompleteReason ? { incomplete_details: { reason: incompleteReason } } : {},
      output: outputItems,
      usage
    }
  });
}
var STREAM_IDLE_TIMEOUT_MS = 12e4;
async function streamResponsesResponse(model, params, modelId, write, onDone, onProgress, options) {
  const configuredTimeout = (name, fallback) => {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  const idleTimeoutMs = options?.idleTimeoutMs ?? configuredTimeout("RELAY_AI_STREAM_IDLE_TIMEOUT_MS", STREAM_IDLE_TIMEOUT_MS);
  const progressTimeoutMs = options?.progressTimeoutMs ?? configuredTimeout("RELAY_AI_STREAM_PROGRESS_TIMEOUT_MS", 6e5);
  const abort = new AbortController();
  let idleTimer = setTimeout(
    () => abort.abort(new Error(`no data received from provider for ${Math.round(idleTimeoutMs / 1e3)}s`)),
    idleTimeoutMs
  );
  let active = true;
  const resetLiveness = () => {
    if (!active) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => abort.abort(new Error("no data received from provider for " + idleTimeoutMs / 1e3 + "s")), idleTimeoutMs);
  };
  const resetProgress = () => {
    clearTimeout(progressTimer);
    progressTimer = setTimeout(() => abort.abort(new Error("no content progress from provider for " + progressTimeoutMs / 1e3 + "s")), progressTimeoutMs);
  };
  let progressTimer;
  resetProgress();
  return streamActivity.run(resetLiveness, async () => {
    try {
      const { toolContext, ...sdkParams } = params;
      const result = streamText({ model, ...sdkParams, maxRetries: 0, abortSignal: abort.signal, onError: () => {
      } });
      Promise.resolve(result.text).catch(() => {
      });
      Promise.resolve(result.toolCalls).catch(() => {
      });
      Promise.resolve(result.toolResults).catch(() => {
      });
      Promise.resolve(result.finishReason).catch(() => {
      });
      Promise.resolve(result.usage).catch(() => {
      });
      Promise.resolve(result.response).catch(() => {
      });
      const watchedStream = (async function* () {
        try {
          for await (const part of result.stream) {
            resetLiveness();
            if (["text-delta", "reasoning-delta"].includes(part.type) && Boolean(part.text) || part.type === "tool-input-delta" && Boolean(part.delta) || ["tool-call", "finish", "finish-step"].includes(part.type)) resetProgress();
            yield part;
          }
        } catch (error) {
          if (!abort.signal.aborted) throw error;
          yield { type: "abort", reason: String(abort.signal.reason) };
        } finally {
          clearTimeout(idleTimer);
          clearTimeout(progressTimer);
        }
      })();
      await writeResponsesStream(watchedStream, modelId, write, onDone, onProgress, {
        onForceStop: (reason) => abort.abort(new Error(reason)),
        toolContext,
        logLabel: options?.logLabel
      });
    } finally {
      active = false;
      clearTimeout(idleTimer);
      clearTimeout(progressTimer);
    }
  });
}
async function generateResponsesResponse(model, params, modelId) {
  const { toolContext, ...sdkParams } = params;
  const r = await generateTextStreamingIfRequired({ model, ...sdkParams, maxRetries: 0 });
  const incompleteReason = incompleteReasonForFinish(r.finishReason);
  const createdAt = Math.floor(Date.now() / 1e3);
  const responseId = newResponseId();
  const output = [];
  if (r.reasoningText?.trim()) {
    output.push(makeReasoningOutputItem(newItemId("rs"), r.reasoningText));
  }
  if (r.text !== null && r.text !== void 0) {
    output.push({
      id: newItemId("msg"),
      type: "message",
      role: "assistant",
      status: incompleteReason ? "incomplete" : "completed",
      content: [{ type: "output_text", text: r.text }]
    });
  }
  for (const tc of incompleteReason ? [] : r.toolCalls) {
    const encodedId = encodeToolUseId(tc.toolCallId, grabRoundTripSignature(tc), false);
    const argsStr = JSON.stringify(tc.input ?? {});
    const kind = resolveOutputKind(tc.toolName, toolContext);
    output.push(buildFinalToolItem(
      kind,
      tc.toolName,
      encodedId,
      toolItemId(kind, tc.toolCallId),
      argsStr
    ));
  }
  if (output.length === 0 && !incompleteReason) {
    output.push({ id: newItemId("msg"), type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "(conversation context was too large to summarize)" }] });
  }
  const inputTokens = r.usage?.inputTokens ?? 0;
  const outputTokens = r.usage?.outputTokens ?? 0;
  return {
    id: responseId,
    object: "response",
    model: modelId,
    created_at: createdAt,
    status: incompleteReason ? "incomplete" : "completed",
    ...incompleteReason ? { incomplete_details: { reason: incompleteReason } } : {},
    output,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens
    }
  };
}
var COMPACTION_SUMMARY_INSTRUCTION = "You are performing a CONTEXT CHECKPOINT COMPACTION. Summarize the conversation so far into a concise but complete summary that preserves the user's goals, key decisions and facts, the current state of the work, and any pending or in-progress tasks. Output only the summary text.";
function encodeCompactionContent(summary) {
  return Buffer.from(JSON.stringify({ v: 1, summary }), "utf8").toString("base64");
}
function decodeCompactionContent(encrypted) {
  if (!encrypted) return null;
  try {
    const obj = JSON.parse(Buffer.from(encrypted, "base64").toString("utf8"));
    return obj?.v === 1 && typeof obj.summary === "string" ? obj.summary : null;
  } catch {
    return null;
  }
}
function makeCompactionItem(summary) {
  return { type: "compaction", id: newItemId("cmp"), encrypted_content: encodeCompactionContent(summary) };
}
function appendCompactionInstruction(params) {
  return {
    ...params,
    tools: void 0,
    messages: [
      ...params.messages,
      { role: "user", content: [{ type: "text", text: COMPACTION_SUMMARY_INSTRUCTION }] }
    ]
  };
}
async function collectCompactionSummary(model, params) {
  const { toolContext: _toolContext, ...sdkParams } = params;
  void _toolContext;
  let firstStreamError;
  const result = streamText({
    model,
    ...sdkParams,
    maxRetries: 0,
    onError: (event) => {
      firstStreamError ??= event;
    }
  });
  Promise.resolve(result.toolResults).catch(() => {
  });
  let text;
  try {
    text = await result.text ?? "";
  } catch (error) {
    throw firstStreamError ? firstStreamError.error : error;
  }
  if (firstStreamError) throw firstStreamError.error;
  return text;
}
function buildCompactionResponseBody(summary, modelId) {
  return {
    id: newResponseId(),
    object: "response",
    model: modelId,
    created_at: Math.floor(Date.now() / 1e3),
    status: "completed",
    output: [makeCompactionItem(summary)]
  };
}
function writeCompactionSse(summary, modelId, write) {
  const emit = (type, data) => write(sseChunk(type, data));
  const responseId = newResponseId();
  const createdAt = Math.floor(Date.now() / 1e3);
  const item = makeCompactionItem(summary);
  emit("response.created", {
    type: "response.created",
    response: { id: responseId, object: "response", model: modelId, created_at: createdAt, status: "in_progress", output: [] }
  });
  emit("response.output_item.added", { type: "response.output_item.added", output_index: 0, item });
  emit("response.output_item.done", { type: "response.output_item.done", output_index: 0, item });
  const completed = { id: responseId, object: "response", model: modelId, created_at: createdAt, status: "completed", output: [item] };
  emit("response.completed", { type: "response.completed", response: completed });
  return completed;
}
async function generateCompactionResponse(model, params, modelId) {
  const text = await collectCompactionSummary(model, params);
  return buildCompactionResponseBody(text.trim() || "(no summary produced)", modelId);
}
async function streamCompactionResponse(model, params, modelId, write) {
  const text = await collectCompactionSummary(model, params);
  writeCompactionSse(text.trim() || "(no summary produced)", modelId, write);
}
function responsesErrorBody(modelId, message, statusCode = 401) {
  return {
    id: newResponseId(),
    object: "response",
    model: modelId,
    created_at: Math.floor(Date.now() / 1e3),
    status: "failed",
    output: [],
    error: { message, type: statusCode === 429 ? "rate_limit_error" : "api_error", code: String(statusCode) }
  };
}
function writeResponsesErrorStream(modelId, message, write, statusCode = 401) {
  write(sseChunk("response.failed", {
    type: "response.failed",
    response: responsesErrorBody(modelId, message, statusCode)
  }));
}

// src/pool/context.ts
var IMAGE_INPUT_TOKENS = 4096;
var IMAGE_PART_TYPES = /* @__PURE__ */ new Set(["image", "image-data", "image-url"]);
var MEDIA_PART_TYPES = /* @__PURE__ */ new Set(["file", "media", "file-data"]);
function isImagePart(part) {
  if (typeof part.type !== "string") return false;
  if (IMAGE_PART_TYPES.has(part.type)) return true;
  return MEDIA_PART_TYPES.has(part.type) && typeof part.mediaType === "string" && part.mediaType.startsWith("image");
}
function withoutBinary(value, found) {
  if (value instanceof Uint8Array) {
    found.bytes += value.byteLength;
    return null;
  }
  if (Array.isArray(value)) return value.map((item) => withoutBinary(item, found));
  if (value === null || typeof value !== "object") return value;
  const record = value;
  if (typeof record.toJSON === "function") return withoutBinary(record.toJSON(), found);
  if (isImagePart(record)) {
    found.images += 1;
    return { type: "image" };
  }
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, withoutBinary(item, found)]));
}
function estimatePoolRequestTokens(value) {
  const found = { images: 0, bytes: 0 };
  const json = JSON.stringify(withoutBinary(value, found)) ?? "";
  return Math.ceil(Buffer.byteLength(json, "utf8") / 2) + found.images * IMAGE_INPUT_TOKENS + Math.ceil(found.bytes / 2);
}
function poolRequestFitsWindow(value, contextWindow, outputReserve) {
  if (!Number.isSafeInteger(contextWindow) || contextWindow <= 0) return { fits: false, required: Infinity };
  if (!Number.isSafeInteger(outputReserve) || outputReserve <= 0) return { fits: false, required: Infinity };
  const margin = Math.max(4096, Math.ceil(contextWindow * 0.1));
  const required = estimatePoolRequestTokens(value) + outputReserve + margin;
  return { fits: required <= contextWindow, required };
}

// src/pool/continuation.ts
function poolRouteKey(route) {
  return JSON.stringify([route.account, route.endpointRevision, route.model]);
}
var CALL_ID_TYPES = /* @__PURE__ */ new Set([
  "function_call",
  "function_call_output",
  "custom_tool_call",
  "custom_tool_call_output",
  "tool_search_call",
  "tool_search_output"
]);
function poolHistoryOrigins(body) {
  return bodyOrigins.get(body);
}
var bodyOrigins = /* @__PURE__ */ new WeakMap();
var DEFAULT_LIMITS2 = {
  ttlMs: 36e5,
  maxEntries: 2e3,
  maxBytes: 4 * 1024 * 1024,
  maxItems: 2e3,
  maxTotalBytes: 128 * 1024 * 1024
};
function withoutImageData(value) {
  if (Array.isArray(value)) return value.map(withoutImageData);
  if (value === null || typeof value !== "object") return value;
  const record = value;
  if (record.type === "input_image" && typeof record.image_url === "string") {
    return { ...record, image_url: "[image]" };
  }
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, withoutImageData(item)]));
}
function items(input) {
  if (typeof input === "string") return [{ type: "message", role: "user", content: input }];
  if (!Array.isArray(input)) throw new Error("unsupported-input");
  return structuredClone(input);
}
function checkLimit2(name, value) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Invalid continuation limit: " + name);
}
var PoolContinuationStore = class {
  constructor(limits = {}, now = Date.now) {
    this.now = now;
    this.limits = { ...DEFAULT_LIMITS2, ...limits };
    for (const [name, value] of Object.entries(this.limits)) checkLimit2(name, value);
  }
  now;
  states = /* @__PURE__ */ new Map();
  limits;
  remember(responseId, scope, request, output, source, origins) {
    if (!responseId) throw new Error("response-id-required");
    if (!scope) throw new Error("real-session-and-branch-required");
    const storedInput = items(request.input);
    const storedOutput = structuredClone(output);
    const inherited = origins ?? bodyOrigins.get(request);
    const owners = withOutputOrigins(inherited ? { ...inherited } : withInputOrigins({}, storedInput, source), storedOutput, source);
    if (storedInput.length + storedOutput.length > this.limits.maxItems) {
      throw new Error("continuation-history-too-large");
    }
    const state = {
      scope,
      input: storedInput,
      output: storedOutput,
      ...typeof request.instructions === "string" ? { instructions: request.instructions } : {},
      source: poolRouteKey(source),
      origins: owners,
      expires: this.now() + this.limits.ttlMs,
      bytes: 0
    };
    state.bytes = Buffer.byteLength(JSON.stringify(withoutImageData(state)), "utf8");
    if (state.bytes > this.limits.maxBytes) throw new Error("continuation-history-too-large");
    this.prune();
    const key = JSON.stringify([scope, responseId]);
    this.states.delete(key);
    this.states.set(key, state);
    let total = 0;
    for (const entry of this.states.values()) total += entry.bytes;
    while (this.states.size > 1 && (this.states.size > this.limits.maxEntries || total > this.limits.maxTotalBytes)) {
      const oldest = this.states.keys().next().value;
      total -= this.states.get(oldest).bytes;
      this.states.delete(oldest);
    }
  }
  resolve(scope, request) {
    const body = structuredClone(request);
    const previous = body.previous_response_id;
    if (previous === void 0 || previous === null) return { body };
    if (typeof previous !== "string" || !previous) throw new Error("unsupported-continuation: invalid response id");
    const state = this.states.get(JSON.stringify([scope, previous]));
    if (!scope || !state || state.expires <= this.now()) {
      throw new Error("unsupported-continuation: missing Relay-owned history");
    }
    const key = JSON.stringify([scope, previous]);
    this.states.delete(key);
    this.states.set(key, state);
    body.input = [...structuredClone(state.input), ...structuredClone(state.output), ...items(body.input)];
    body.instructions ??= state.instructions;
    delete body.previous_response_id;
    const origins = { ...state.origins };
    bodyOrigins.set(body, origins);
    return { body, source: state.source, origins };
  }
  prune() {
    const now = this.now();
    for (const [key, state] of this.states) {
      if (state.expires <= now) this.states.delete(key);
    }
  }
};
function withInputOrigins(origins, input, source) {
  const next = { ...origins };
  for (const item of input) {
    if (CALL_ID_TYPES.has(String(item.type)) && typeof item.call_id === "string") {
      const rawId = splitToolUseId(item.call_id).rawId;
      if (!next[rawId]) next[rawId] = poolRouteKey(source);
    }
  }
  return next;
}
function withOutputOrigins(origins, output, source) {
  const next = { ...origins };
  for (const item of output) {
    if (CALL_ID_TYPES.has(String(item.type)) && typeof item.call_id === "string") {
      next[splitToolUseId(item.call_id).rawId] = poolRouteKey(source);
    }
  }
  return next;
}
function stripRouteParts(part, target, source, origins) {
  if (part.type !== "tool-call" && part.type !== "tool-result") return part;
  const rawId = typeof part.toolCallId === "string" ? splitToolUseId(part.toolCallId).rawId : void 0;
  const owner = rawId ? origins[rawId] : void 0;
  const foreign = owner !== void 0 ? owner !== target : source !== target;
  if (!foreign) return { ...part, ...rawId ? { toolCallId: rawId } : {} };
  const { providerOptions: _options, toolCallId: _id, ...rest } = part;
  return { ...rest, ...rawId ? { toolCallId: rawId } : {} };
}
function isOpaqueCompaction(item) {
  return (item.type === "compaction" || item.type === "context_compaction") && decodeCompactionContent(item.encrypted_content) === null;
}
function hasReasoningSummary(item) {
  return Array.isArray(item.summary) && item.summary.some((part) => part && typeof part === "object" && typeof part.text === "string" && part.text.trim().length > 0);
}
function preparePoolHistory(body, source, target, npm, metadata, options, origins) {
  const fresh = structuredClone(body);
  const rawInput = items(fresh.input);
  const hadOpaque = rawInput.some((item) => isOpaqueCompaction(item) || item.type === "reasoning" && typeof item.encrypted_content === "string");
  const input = rawInput.filter((item) => !isOpaqueCompaction(item)).map((item) => {
    if (item.type !== "reasoning" || typeof item.encrypted_content !== "string") return item;
    const { encrypted_content: _encrypted, ...rest } = item;
    return rest;
  });
  const hasReadableHistory = input.some((item) => item.type !== "reasoning" || hasReasoningSummary(item));
  if (hadOpaque && !hasReadableHistory) {
    throw new Error("unsupported-continuation: opaque provider state requires original route");
  }
  fresh.input = input;
  const params = translateResponsesRequest(fresh, npm, metadata, options);
  const targetKey = poolRouteKey(target);
  const owners = origins ?? bodyOrigins.get(body) ?? {};
  params.messages = params.messages.map((message) => ({
    ...message,
    content: Array.isArray(message.content) ? message.content.filter((part) => !(source !== targetKey && part.type === "reasoning")).map((part) => stripRouteParts(part, targetKey, source, owners)) : message.content
  }));
  return params;
}

// src/pool/lazy-route.ts
function lazyPoolRoute(evidence, prepare, extra) {
  let built;
  const route = {
    ...evidence,
    ...extra ?? {},
    async admit(signal) {
      if (built) return void 0;
      const prepared = await prepare(signal);
      if ("skip" in prepared) return prepared.skip;
      built = prepared.route;
      if (prepared.attach) Object.assign(route, prepared.attach);
      return void 0;
    },
    async open(signal) {
      if (!built) throw new Error("Pool route used before it was admitted");
      return built.open(signal);
    },
    async recordAttemptFailure(error) {
      await built?.recordAttemptFailure?.(error);
    },
    async recordFailure(failure) {
      await built?.recordFailure?.(failure);
    }
  };
  return route;
}

// src/pool/sdk-route.ts
import { streamText as streamText2 } from "ai";
function sdkPoolRoute(evidence, model, request, health) {
  if (!Number.isSafeInteger(request.maxOutputTokens) || request.maxOutputTokens <= 0) {
    throw new Error("Pool requests require a bounded output reservation");
  }
  for (const definition of Object.values(request.tools ?? {})) {
    if (definition.execute) throw new Error("Pool tools must not execute inside Relay");
  }
  return poolRouteFromStream(evidence, (abortSignal) => {
    const result = streamText2({
      model,
      ...request,
      maxRetries: 0,
      abortSignal,
      onError: () => {
      }
    });
    for (const promise of [result.text, result.toolCalls, result.toolResults, result.finishReason, result.usage, result.response]) {
      Promise.resolve(promise).catch(() => {
      });
    }
    return result.stream;
  }, health);
}
function poolRouteFromStream(evidence, start, health) {
  const scopesFor = (failure) => health ? failure.kind === "rate-limit" || failure.kind === "quota" ? [...health.scopes, ...health.accountScopes ?? []] : health.scopes : [];
  return {
    ...evidence,
    recordFailure: health ? async (failure) => {
      await health.store.record(scopesFor(failure), failure);
    } : void 0,
    recordAttemptFailure: health ? async (error) => {
      const failure = poolFailure(error);
      await health.store.record(scopesFor(failure), failure);
    } : void 0,
    async open(abortSignal) {
      const decision = health ? await health.store.acquire({ id: evidence.revision, scopes: [...health.scopes, ...health.accountScopes ?? []] }) : void 0;
      if (decision && !decision.ok) throw new Error("Pool route entered cooldown");
      const releaseLateClaim = () => {
        if (decision?.ok) void decision.release().catch(() => {
        });
      };
      if (decision?.ok) {
        if (abortSignal.aborted) {
          await decision.release();
          throw abortSignal.reason ?? new Error("Pool attempt aborted");
        }
        abortSignal.addEventListener("abort", releaseLateClaim, { once: true });
      }
      return (async function* () {
        abortSignal.removeEventListener("abort", releaseLateClaim);
        let success = false;
        let recorded = false;
        try {
          const source = start(abortSignal);
          for await (const part of source) {
            if (part.type === "error" && !abortSignal.aborted) {
              const failure = poolFailure(part.error);
              if (health && failure.kind !== "canceled") {
                const result = await health.store.record(scopesFor(failure), failure);
                recorded = recorded || result.recorded;
              }
            }
            if (validPoolFinish(part)) success = true;
            yield part;
          }
        } catch (error) {
          if (health && decision && decision.ok && !abortSignal.aborted) {
            const failure = poolFailure(error);
            if (failure.kind !== "canceled") {
              const result = await health.store.record(scopesFor(failure), failure);
              recorded = recorded || result.recorded;
            }
          }
          throw error;
        } finally {
          if (health && decision && decision.ok) {
            if (success && !recorded) await decision.settle(true);
            else await decision.release();
          }
        }
      })();
    }
  };
}

// src/pool/effort.ts
function poolMemberEffort(requested, receipt) {
  if (!requested || requested === "auto") return null;
  return receipt.effortLevels.includes(requested) ? requested : null;
}

// src/pool/output-limit.ts
var POOL_DEFAULT_OUTPUT_TOKENS = 32768;
var MAX_OUTPUT_WINDOW_SHARE = 4;
var MIN_OUTPUT_TOKENS = 1024;
function poolOutputCap(providerId, modelId, contextWindow) {
  const published = findModelsDevModel(providerId, modelId)?.limit?.output ?? modelsDevCrossVendorOutputLimit(modelId);
  const base = typeof published === "number" && Number.isSafeInteger(published) && published > 0 ? published : POOL_DEFAULT_OUTPUT_TOKENS;
  const windowCap = Math.floor(contextWindow / MAX_OUTPUT_WINDOW_SHARE);
  return Math.max(MIN_OUTPUT_TOKENS, Math.min(base, windowCap));
}

// src/pool/codex-prepare.ts
var POOL_MAX_TOOLS = 128;
var POOL_COMPACTION_MAX_OUTPUT_TOKENS = 4e3;
function isPoolCompactionRequest(body) {
  return Array.isArray(body.input) && body.input.some((item) => item && typeof item === "object" && item.type === "compaction_trigger");
}
var EFFORT_CLAIM_KEYS = /* @__PURE__ */ new Set([
  "effort",
  "reasoningEffort",
  "reasoning_effort",
  "thinkingLevel",
  "thinkingBudget",
  "thinking_budget",
  "effortLevel",
  "budget_tokens"
]);
function omitPoolEffort(body, level) {
  const reasoning = { ...body.reasoning };
  delete reasoning.effort;
  if (level !== null) reasoning.effort = level;
  const next = { ...body };
  if (Object.keys(reasoning).length > 0) next.reasoning = reasoning;
  else delete next.reasoning;
  return next;
}
function translatedEffortClaim(providerOptions) {
  for (const [provider, value] of Object.entries(providerOptions ?? {})) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    for (const [key, nested] of Object.entries(value)) {
      if (EFFORT_CLAIM_KEYS.has(key)) return provider + "." + key;
      if (!nested || typeof nested !== "object" || Array.isArray(nested)) continue;
      for (const inner of Object.keys(nested)) {
        if (EFFORT_CLAIM_KEYS.has(inner)) return provider + "." + key + "." + inner;
      }
    }
  }
  return void 0;
}
async function prepareCodexPoolRoutes(options) {
  const routes = [];
  const compaction = isPoolCompactionRequest(options.body);
  for (const member of options.pool.members) {
    options.signal.throwIfAborted();
    const skip = (reason) => options.onSkip?.(member, reason);
    const provider = options.providers.find((item) => item.id === member.providerId);
    const model = provider?.models.find((item) => item.id === member.modelId);
    if (!provider || !model || !model.npm || model.modelFormat === "cloud-code") {
      skip("not available in the registry");
      continue;
    }
    const revision = poolEndpointRevision({
      providerId: provider.id,
      authRef: provider.authRef,
      npm: model.npm,
      baseURL: model.apiBaseUrl,
      upstreamModelId: model.upstreamModelId,
      headers: provider.headers
    });
    const receipt = currentPoolReceipt(options.receipts, member, revision, Date.now());
    if (!receipt) {
      skip("no fresh verification (run Test)");
      continue;
    }
    const freeStatus = poolFreeStatus({ model, providerId: provider.id });
    if (freeStatus !== "verified_free") {
      skip("not verified free");
      continue;
    }
    if (!receipt.billingSafe || !receipt.targets.includes("codex")) {
      skip("not verified for Codex");
      continue;
    }
    const npm = model.npm;
    const identity = { account: provider.id, endpointRevision: revision, model: model.id };
    routes.push(lazyPoolRoute({
      member,
      revision,
      freeStatus,
      catalogVerified: true,
      accessVerified: true,
      billingSafe: receipt.billingSafe,
      targets: receipt.targets,
      toolsVerified: receipt.tools,
      defaultEffortVerified: true,
      effortLevels: receipt.effortLevels,
      contextFits: true,
      contextVerified: true
    }, async () => {
      const gone = (reason) => {
        skip(reason);
        return { skip: reason };
      };
      try {
        const requested = options.body.reasoning?.effort ?? options.pool.effort;
        const auto = requested === "auto";
        const memberEffort = poolMemberEffort(auto ? "auto" : requested, receipt);
        const memberAuto = memberEffort === null;
        const body = omitPoolEffort(options.body, memberEffort);
        const translate = options.translate ?? preparePoolHistory;
        const params = translate(body, options.source, identity, npm, {
          ...model,
          providerId: provider.id,
          apiBaseUrl: model.apiBaseUrl
        }, { maxTools: POOL_MAX_TOOLS, npm, forwardToolChoice: true }, poolHistoryOrigins(options.body));
        if (memberAuto && translatedEffortClaim(params.providerOptions)) {
          return gone("translation would set an effort");
        }
        if (compaction) Object.assign(params, appendCompactionInstruction(params), { toolChoice: void 0 });
        const outputCap = poolOutputCap(provider.id, model.id, receipt.contextWindow);
        const askedOutput = typeof body.max_output_tokens === "number" ? body.max_output_tokens : outputCap;
        if (!Number.isSafeInteger(askedOutput) || askedOutput <= 0) {
          return gone("invalid output limit");
        }
        params.maxOutputTokens = Math.min(askedOutput, outputCap, compaction ? POOL_COMPACTION_MAX_OUTPUT_TOKENS : Infinity);
        const context = await (options.checkContext ?? defaultContextCheck)(params, receipt);
        if (!context.verified || !context.fits) {
          return gone(context.verified ? "request too large for its context window" : "context window not verified");
        }
        const scopes = [poolEndpointScope(provider.id, revision, model.id)];
        const accountScopes = [poolAccountScope(provider.id)];
        const off = await options.health.disabledFor(scopes);
        if (off) {
          return gone("DISABLED: " + off.note + " (run Test to re-enable)");
        }
        const unavailableUntil = await options.health.cooldownFor({ id: revision, scopes: [...scopes, ...accountScopes] });
        if (unavailableUntil !== void 0 && unavailableUntil > Date.now()) {
          return gone("cooling down after a failure");
        }
        const apiKey = await resolveLocalProviderApiKey(provider);
        if (apiKey === null || apiKey === void 0) {
          return gone("no credential");
        }
        const languageModel = await createLanguageModel({
          npm,
          modelId: model.upstreamModelId,
          apiKey,
          baseURL: model.apiBaseUrl,
          providerId: provider.id,
          authType: provider.authType,
          oauthAccountId: provider.oauthAccountId,
          providerData: provider.providerData,
          headers: poolProviderHeaders(provider, model, options.sessionId),
          sessionId: options.sessionId,
          refreshToken: providerRefreshToken(provider.id, provider.authType, provider.authRef)
        });
        const { toolContext: _toolContext, instructions, ...sdkParams } = params;
        const dispatch = sdkPoolRoute({
          member,
          revision,
          freeStatus,
          catalogVerified: true,
          accessVerified: true,
          billingSafe: receipt.billingSafe,
          targets: receipt.targets,
          toolsVerified: receipt.tools,
          // Auto is constructively verified: Relay omits the field and any translator
          // claim is refused above, so no named default rung is required.
          defaultEffortVerified: true,
          effortLevels: receipt.effortLevels,
          contextFits: true,
          contextVerified: true
        }, languageModel, { ...sdkParams, system: instructions, maxOutputTokens: params.maxOutputTokens }, { store: options.health, scopes, accountScopes });
        return { route: dispatch, attach: { toolContext: params.toolContext } };
      } catch (error) {
        if (options.signal.aborted) throw options.signal.reason ?? error;
        return gone("could not be prepared: " + (error instanceof Error ? error.message : String(error)));
      }
    }, { identity }));
  }
  return routes;
}
async function defaultContextCheck(params, receipt) {
  const { fits } = poolRequestFitsWindow({
    messages: params.messages,
    instructions: params.instructions,
    tools: params.tools
  }, receipt.contextWindow, params.maxOutputTokens ?? receipt.maxOutputTokens);
  return { verified: receipt.contextSource === "provider" || receipt.contextSource === "observed" || receipt.contextSource === "attested", fits };
}

// src/pool/codex-identity.ts
var MAX_METADATA_BYTES = 8192;
function objectMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return void 0;
  return value;
}
function parseMetadata(value) {
  if (typeof value !== "string" || Buffer.byteLength(value) > MAX_METADATA_BYTES) return void 0;
  try {
    return objectMetadata(JSON.parse(value));
  } catch {
    return void 0;
  }
}
function identityFrom(metadata) {
  if (!metadata) return void 0;
  const valid = (value) => typeof value === "string" && value.length > 0 && value.length <= 256;
  if (!valid(metadata.session_id) || !valid(metadata.thread_id) || !valid(metadata.turn_id)) return void 0;
  const agent = metadata.agent_name;
  if (agent !== void 0 && !valid(agent)) return void 0;
  const conversation = JSON.stringify([metadata.session_id, metadata.thread_id, agent ?? ""]);
  return { conversation, turn: JSON.stringify([conversation, metadata.turn_id]) };
}
function codexPoolIdentity(headers, body) {
  const header = parseMetadata(headers["x-codex-turn-metadata"]);
  const client = objectMetadata(body?.client_metadata);
  const embedded = parseMetadata(client?.["x-codex-turn-metadata"]);
  for (const candidate of [embedded, client, header]) {
    const identity = identityFrom(candidate);
    if (identity) return identity;
  }
  return void 0;
}

// src/pool/eligibility.ts
function poolRouteIdentity(route) {
  return JSON.stringify([route.member.providerId, route.revision, route.member.modelId]);
}
function evaluatePoolMembers(pool, evidence, request) {
  return pool.members.map((member) => {
    const matches = evidence.filter((route2) => route2.member.providerId === member.providerId && route2.member.modelId === member.modelId);
    if (matches.length !== 1) return { member, reason: matches.length ? "ambiguous-route" : "unavailable" };
    const route = matches[0];
    const effort = request.effort ?? pool.effort;
    let reason;
    if (!route.revision) reason = "unverified-endpoint";
    else if (!route.catalogVerified) reason = "unverified-catalog";
    else if (route.freeStatus !== "verified_free") reason = "not-free";
    else if (!route.billingSafe) reason = "billing-risk";
    else if (!route.accessVerified) reason = "unverified-access";
    else if (!route.targets.includes(request.target)) reason = "unsupported-target";
    else if (request.tools && !route.toolsVerified) reason = "unverified-tools";
    else if (effort === "auto" ? !route.defaultEffortVerified : !route.effortLevels.includes(effort)) reason = "unsupported-effort";
    else if (!route.contextVerified) reason = "unverified-context";
    else if (!route.contextFits) reason = "context-limit";
    else if (route.unavailableUntil !== void 0 && (!Number.isFinite(route.unavailableUntil) || route.unavailableUntil > request.now)) reason = "cooldown";
    return { member, route, ...reason ? { reason } : {} };
  });
}

// src/pool/dispatch.ts
var SIMULATED_COOLDOWN_MS = 6e4;
var SIMULATED_FAILURE_MESSAGE = "Simulated failure (RELAY_POOL_FORCE_FAIL)";
async function* dispatchFreePool(pool, routes, request, policy) {
  const candidates = evaluatePoolMembers(pool, routes, { ...request, now: Date.now() });
  const eligible = candidates.filter((candidate) => !candidate.reason && candidate.route);
  if (!eligible.length) {
    throw new Error("No eligible free pool members: " + candidates.map((candidate) => candidate.member.providerId + "/" + candidate.member.modelId + ": " + candidate.reason).join("; "));
  }
  const attempts = eligible.map((candidate) => {
    const route = routes.find((item) => candidate.route && poolRouteIdentity(item) === poolRouteIdentity(candidate.route));
    if (!route) throw new Error("Pool route changed during admission");
    const forced = forcedFailures().has(route.member.providerId + "/" + route.member.modelId);
    const open = forced ? async () => {
      await route.recordFailure?.({ kind: "transient", retryAt: Date.now() + SIMULATED_COOLDOWN_MS });
      throw Object.assign(new Error(SIMULATED_FAILURE_MESSAGE), { statusCode: 429 });
    } : route.open;
    return { id: poolRouteIdentity(route), open, recordAttemptFailure: route.recordAttemptFailure, admit: route.admit };
  });
  const session = policy.sessions?.begin(request.conversationScope, attempts);
  let activeRoute;
  const passedOver = [];
  try {
    yield* runPoolAttempts(session?.routes ?? attempts, request.signal, policy.limits, policy.retryable, (id) => {
      activeRoute = id;
      policy.onAttempt?.(id);
    }, policy.onFailure, (id, reason) => {
      const member = routes.find((item) => poolRouteIdentity(item) === id)?.member;
      if (member) passedOver.push(member.providerId + "/" + member.modelId + ": " + reason);
      policy.onSkip?.(id, reason);
    });
  } catch (error) {
    if (error instanceof PoolAttemptError && error.code === "no-admitted-route") {
      throw new Error("No eligible free pool members: " + [
        ...candidates.filter((candidate) => candidate.reason).map((candidate) => candidate.member.providerId + "/" + candidate.member.modelId + ": " + candidate.reason),
        ...passedOver
      ].join("; "));
    }
    throw error;
  }
  if (activeRoute) session?.succeed(activeRoute);
}

// src/pool/session.ts
var PoolSessionRoutes = class {
  constructor(ttlMs = 36e5, capacity = 256, now = Date.now) {
    this.ttlMs = ttlMs;
    this.capacity = capacity;
    this.now = now;
  }
  ttlMs;
  capacity;
  now;
  states = /* @__PURE__ */ new Map();
  begin(scope, eligible) {
    const routes = [...eligible];
    if (!scope) return { routes, succeed: (_id) => {
    } };
    const previous = this.states.get(scope);
    const pinned = previous && previous.expires > this.now() ? previous.pinned : void 0;
    const state = { token: /* @__PURE__ */ Symbol(), pinned, expires: this.now() + this.ttlMs };
    this.states.delete(scope);
    this.states.set(scope, state);
    while (this.states.size > this.capacity) this.states.delete(this.states.keys().next().value);
    const index = routes.findIndex((route) => route.id === pinned);
    if (index > 0) routes.unshift(...routes.splice(index, 1));
    return {
      routes,
      succeed: (id) => {
        if (this.states.get(scope)?.token !== state.token || !routes.some((route) => route.id === id)) return;
        this.states.set(scope, { ...state, pinned: id, expires: this.now() + this.ttlMs });
      }
    };
  }
};

// src/pool/codex-response.ts
async function writeCodexPoolResponse(stream, modelId, write, options = {}) {
  let completed;
  let bytes = 0;
  const context = options.toolContext ?? { namespaceByFlatName: /* @__PURE__ */ new Map(), customToolNames: /* @__PURE__ */ new Set() };
  let ready = false;
  let finalizing = false;
  const terminalChunks = [];
  let terminalBytes = 0;
  const preamble = [];
  const contextualStream = (async function* () {
    for await (const part of stream) {
      if (!ready) {
        ready = true;
        if (!options.nonstream) for (const chunk of preamble) write(chunk);
        preamble.length = 0;
      }
      const selected = options.getToolContext?.();
      if (selected) {
        context.namespaceByFlatName = selected.namespaceByFlatName;
        context.customToolNames = selected.customToolNames;
      }
      if (part.type === "finish") finalizing = true;
      yield part;
    }
  })();
  await writeResponsesStream(contextualStream, modelId, (chunk) => {
    for (const line of chunk.split(String.fromCharCode(10))) {
      if (!line.startsWith("data:")) continue;
      const event = JSON.parse(line.slice(5));
      if (event.type === "response.output_text.done" || event.type === "response.content_part.done" || event.type === "response.output_item.done" || event.type === "response.function_call_arguments.done" || event.type === "response.custom_tool_call_input.done" || event.type === "response.completed" || event.type === "response.incomplete") finalizing = true;
      if (event.type === "response.completed" || event.type === "response.incomplete") {
        if (!event.response) throw new Error("Pool response missing terminal result");
        options.beforeComplete?.(event.response);
        completed = event.response;
      }
      if (event.type === "response.failed") throw new Error("Pool response failed");
    }
    if (options.nonstream) {
      bytes += Buffer.byteLength(chunk);
      if (bytes > (options.maxResponseBytes ?? 4 * 1024 * 1024)) throw new Error("Pool response buffer exceeded");
    } else if (finalizing) {
      terminalBytes += Buffer.byteLength(chunk);
      if (terminalBytes > (options.maxResponseBytes ?? 4 * 1024 * 1024)) throw new Error("Pool response buffer exceeded");
      terminalChunks.push(chunk);
    } else if (ready) write(chunk);
    else preamble.push(chunk);
  }, void 0, void 0, { toolContext: context });
  if (!completed) throw new Error("Pool response missing terminal result");
  for (const chunk of terminalChunks) write(chunk);
  return completed;
}

// src/pool/codex-runtime.ts
import { randomUUID } from "crypto";
var FREE_POOL_MODEL_ID = "relay-free-pool";
var FREE_POOL_PROVIDER_ID = "relay-free-pool";
var DEFAULT_POOL_LIMITS = {
  attempts: MAX_POOL_ATTEMPTS,
  firstContentMs: 2e4,
  idleMs: 2e4,
  totalMs: 6e4,
  bufferBytes: 65536,
  cleanupMs: 1e3
};
var CodexPoolRuntime = class {
  constructor(pool, prepare, limits = DEFAULT_POOL_LIMITS) {
    this.pool = pool;
    this.prepare = prepare;
    this.limits = limits;
  }
  pool;
  prepare;
  limits;
  history = new PoolContinuationStore({ ttlMs: 36e5 });
  sessions = new PoolSessionRoutes();
  retries = new CodexRetryGuard();
  /**
   * Remote compaction: the member's text is held until it finishes, then sent as the single `compaction` item Codex
   * requires. The stored history is the summary alone, so later turns continue from it instead of the old transcript.
   */
  async writeCompaction(stream, body, conversation, served, write, markProduced) {
    let text = "";
    for await (const part of stream) if (part.type === "text-delta") text += part.text;
    if (!text.trim()) throw new Error("Pool compaction produced no summary");
    markProduced();
    const route = served();
    if (!route) throw new Error("Pool response missing route or history");
    const response = body.stream === true ? writeCompactionSse(text.trim(), FREE_POOL_MODEL_ID, write) : buildCompactionResponseBody(text.trim(), FREE_POOL_MODEL_ID);
    this.history.remember(String(response.id), conversation, { ...body, input: [] }, response.output, route.identity);
    return response;
  }
  async respond(headers, request, signal, write) {
    if (request.model !== FREE_POOL_MODEL_ID) throw new Error("Pool runtime requires an explicit pool model");
    const identity = codexPoolIdentity(headers, request);
    if (!identity) throw new Error("Pool requires verified Codex conversation and turn metadata");
    const { body, source } = this.history.resolve(identity.conversation, request);
    const lease = this.retries.acquire(identity.turn, requestFingerprint(body));
    if (lease.kind === "replay") {
      const cached = JSON.parse(lease.response);
      if (body.stream === true) for (const chunk of cached.chunks) write(chunk);
      return cached.response;
    }
    if (lease.kind !== "owner") throw new Error("Pool retry " + lease.kind);
    const chunks = [];
    let committed = false;
    let produced = false;
    const requestId = randomUUID().slice(0, 8);
    const started = Date.now();
    let attemptStarted = started;
    let attemptedId;
    let logged = false;
    const skipped = [];
    try {
      const routes = await this.prepare(
        body,
        source,
        signal,
        identity.conversation,
        (member, reason) => skipped.push({ ...member, reason })
      );
      let served;
      const compaction = isPoolCompactionRequest(body);
      const stream = dispatchFreePool(this.pool, routes, {
        // Members that have not verified the requested level run on the provider default (see prepareCodexPoolRoutes),
        // so admission must not re-reject them for an effort that was deliberately not sent.
        target: "codex",
        effort: "auto",
        tools: !compaction && Array.isArray(body.tools) && body.tools.length > 0,
        signal,
        conversationScope: identity.conversation
      }, {
        limits: this.limits,
        sessions: this.sessions,
        retryable: retryPoolFailure,
        onAttempt: (id) => {
          attemptedId = id;
          attemptStarted = Date.now();
          served = routes.find((route) => JSON.stringify([route.member.providerId, route.revision, route.member.modelId]) === id);
        },
        onFailure: (id, error) => {
          const member = poolRouteMember(id);
          if (!member) return;
          const reason = describePoolFailure(error);
          const detail = reason.startsWith("simulated") ? void 0 : poolErrorDetail(error);
          recordPoolActivity({ target: "codex", event: "failed", ...member, requestId, reason, ...detail ? { detail } : {}, ms: Date.now() - attemptStarted });
        }
      });
      const response = compaction ? await this.writeCompaction(stream, body, identity.conversation, () => served, (chunk) => {
        committed = true;
        chunks.push(chunk);
        write(chunk);
      }, () => {
        produced = true;
      }) : await writeCodexPoolResponse(stream, FREE_POOL_MODEL_ID, (chunk) => {
        committed = true;
        chunks.push(chunk);
        write(chunk);
      }, {
        nonstream: body.stream !== true,
        getToolContext: () => served?.toolContext,
        beforeComplete: (response2) => {
          produced = true;
          if (!served || typeof response2.id !== "string" || !Array.isArray(response2.output)) throw new Error("Pool response missing route or history");
          this.history.remember(response2.id, identity.conversation, body, response2.output, served.identity);
        }
      });
      const answered = attemptedId ? poolRouteMember(attemptedId) : void 0;
      if (answered) {
        logged = true;
        recordPoolActivity({ target: "codex", event: "served", ...answered, requestId, ms: Date.now() - attemptStarted });
      }
      lease.complete(JSON.stringify({ response, chunks }));
      return response;
    } catch (error) {
      if (!logged && !signal.aborted) {
        for (const item of skipped) {
          recordPoolActivity({ target: "codex", event: "failed", providerId: item.providerId, modelId: item.modelId, requestId, reason: "skipped: " + item.reason });
        }
        recordPoolActivity({ target: "codex", event: "gave-up", providerId: "pool", modelId: "none", requestId, ms: Date.now() - started });
      }
      if (signal.aborted || !committed && !produced) lease.release();
      else lease.fail("Pool request failed", committed);
      throw error;
    }
  }
};

// src/codex/multi-agent.ts
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
var CODEX_MULTI_AGENT_V2 = Object.freeze({
  enabled: true,
  max_concurrent_threads_per_session: 6,
  expose_spawn_agent_model_overrides: true
});
function renderMultiAgentV2Feature() {
  return "[features]\nmulti_agent_v2 = { enabled = true, max_concurrent_threads_per_session = 6, expose_spawn_agent_model_overrides = true }\n";
}
function probeText(value) {
  if (!value || typeof value !== "object") return String(value ?? "");
  const result = value;
  return `${result.stdout ?? ""}
${result.stderr ?? ""}`;
}
function supportsMultiAgentV2(binaryPath, run = (path, args, env) => runCodexCommandSync(path, args, { timeout: 1e4, env })) {
  const probeHome = mkdtempSync(join(tmpdir(), "relay-codex-v2-probe-"));
  try {
    writeFileSync(join(probeHome, "config.toml"), renderMultiAgentV2Feature(), { encoding: "utf8", mode: 384 });
    const env = { ...process.env, CODEX_HOME: probeHome };
    let output = "";
    try {
      output = probeText(run(binaryPath, ["login", "status"], env));
    } catch (error) {
      output = probeText(error);
    }
    if (/ENOENT|not found|cannot find the file/i.test(output)) return false;
    return !/error loading configuration|invalid configuration|unknown field/i.test(output);
  } finally {
    rmSync(probeHome, { recursive: true, force: true });
  }
}

// src/codex/app-profile.ts
var CODEX_APP_PROVIDER_ID = "relay-ai-launch-codex-app";
var PREVIEW_PROXY_PORT = 54321;
var CODEX_APP_AUTO_COMPACT_RATIO = 0.9;
var CODEX_APP_THREAD_UNLOAD_DELAY_SECS = 48 * 60 * 60;
function codexAppModelSlug(rawModelId) {
  return rawModelId.startsWith("models/") ? rawModelId.slice("models/".length) : rawModelId;
}
function parseCodexAppModelSlug(modelKey) {
  const prefix = `${CODEX_APP_PROVIDER_ID}/`;
  return modelKey.startsWith(prefix) ? modelKey.slice(prefix.length) : modelKey;
}
function buildCodexAppRootConfig(spec) {
  return {
    model: codexAppModelSlug(spec.route.modelId),
    model_provider: "openai",
    openai_base_url: spec.proxyBaseUrl ?? `http://127.0.0.1:${spec.proxyPort}/v1`,
    model_catalog_json: spec.catalogPath,
    thread_unload_delay_secs: CODEX_APP_THREAD_UNLOAD_DELAY_SECS,
    ...spec.multiAgentV2Enabled ? {
      features: { multi_agent_v2: CODEX_MULTI_AGENT_V2 }
    } : {}
  };
}

// src/codex/catalog.ts
var DEFAULT_CONTEXT = 128e3;
var CODEX_NO_REASONING_EFFORT = "none";
function codexCatalogReasoningFields(npm, wireId, metadata) {
  const reasoning = getReasoningCapabilities(npm, wireId, metadata);
  if (reasoning.levels.length > 0) {
    return {
      supported_reasoning_levels: buildCodexReasoningLevels(reasoning),
      default_reasoning_level: reasoning.defaultLevel,
      supports_reasoning_summaries: reasoning.supportsSummaries,
      default_reasoning_summary: reasoning.supportsSummaries ? "auto" : "none"
    };
  }
  return {
    supported_reasoning_levels: buildCodexReasoningLevels({
      levels: [CODEX_NO_REASONING_EFFORT]
    }),
    default_reasoning_level: CODEX_NO_REASONING_EFFORT,
    supports_reasoning_summaries: false,
    default_reasoning_summary: "none"
  };
}
function formatCodexModelLabel(model) {
  const trimmed = model.name.trim();
  if (trimmed && trimmed !== model.id) return trimmed;
  const id = stripGoogleModelPrefix(model.id);
  const claude = id.match(/^claude-([\w-]+?)-(\d+)-(\d+)(?:-\d{8})?$/);
  if (claude) {
    const tier = claude[1].split("-").map(
      (part) => part.charAt(0).toUpperCase() + part.slice(1)
    ).join(" ");
    return `Claude ${tier} ${claude[2]}.${claude[3]}`;
  }
  const gpt = id.match(/^gpt-(\d+(?:\.\d+)?)(?:-([\w-]+))?$/i);
  if (gpt) {
    const suffix = gpt[2] ? ` ${gpt[2].split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}` : "";
    return `GPT-${gpt[1]}${suffix}`;
  }
  return id;
}
function catalogEntryFromModel(model, providerName, priority, appCatalog = false, slugOverride) {
  const slug = slugOverride ?? (appCatalog ? codexAppModelSlug(model.id) : stripGoogleModelPrefix(model.id));
  const context = model.contextWindow ?? DEFAULT_CONTEXT;
  const label = formatCodexModelLabel(model);
  const wireId = model.upstreamModelId ?? model.id;
  const reasoningFields = codexCatalogReasoningFields(model.npm ?? "", wireId, {
    apiBaseUrl: model.apiBaseUrl,
    supportedParameters: model.supportedParameters,
    reasoning: model.reasoning,
    interleavedReasoningField: model.interleavedReasoningField,
    reasoningEffortLevels: model.reasoningEffortLevels,
    reasoningEffortConflict: model.reasoningEffortConflict
  });
  return {
    slug,
    display_name: label,
    ...reasoningFields,
    shell_type: appCatalog ? "default" : "shell_command",
    visibility: "list",
    supported_in_api: true,
    priority,
    availability_nux: null,
    upgrade: null,
    base_instructions: "",
    support_verbosity: false,
    default_verbosity: null,
    apply_patch_tool_type: null,
    truncation_policy: appCatalog ? { mode: "bytes", limit: 1e4 } : { mode: "tokens", limit: context },
    supports_parallel_tool_calls: !appCatalog,
    experimental_supported_tools: [],
    context_window: context,
    max_context_window: context,
    input_modalities: model.modalities ?? ["text", "image"],
    description: `${label} \xB7 ${providerName}`
  };
}
function buildCatalogFile(models, providerName) {
  return {
    models: models.map((m, i) => catalogEntryFromModel(m, providerName, i))
  };
}
function buildAppCatalogFile(models, providerName, selectedModelId) {
  const selected = models.find((m) => m.id === selectedModelId);
  const rest = models.filter((m) => m.id !== selectedModelId);
  const ordered = selected ? [selected, ...rest] : models;
  return {
    models: ordered.map((m, i) => catalogEntryFromModel(m, providerName, i, true))
  };
}
function serializeCatalog(catalog) {
  return `${JSON.stringify(catalog, null, 2)}
`;
}

// src/pool/catalog.ts
var ALIASES = {
  codex: FREE_POOL_MODEL_ID,
  claude: "claude-pool",
  antigravity: "free-pool",
  core: "relay-free-pool"
};
function servable(receipt, target, now) {
  return Boolean(receipt && receiptInForce(receipt, now) && receipt.targets.includes(target) && receipt.billingSafe && Number.isSafeInteger(receipt.contextWindow) && receipt.contextWindow > 0);
}
function poolCatalogEntry(pool, receipts, target, now = Date.now()) {
  const verified = pool.members.map((member) => receipts.find((receipt) => receipt.member.providerId === member.providerId && receipt.member.modelId === member.modelId)).filter((receipt) => servable(receipt, target, now));
  if (!verified.length) return void 0;
  const window = Math.max(...verified.map((receipt) => receipt.contextWindow));
  const reserve = Math.max(4096, Math.ceil(window * 0.1));
  const levels = verified[0].effortLevels.filter((level) => verified.every((receipt) => receipt.effortLevels.includes(level)));
  return {
    id: ALIASES[target],
    display_name: "Relay Free Pool",
    context_window: Math.max(1024, window - reserve),
    supported_reasoning_levels: levels.map((level) => ({ effort: level, description: level }))
  };
}
function codexPoolCatalogEntry(pool, receipts, now = Date.now()) {
  return poolCatalogEntry(pool, receipts, "codex", now);
}
function codexPoolCatalogModel(pool, receipts, options = {}) {
  const entry = poolCatalogEntry(pool, receipts, "codex", options.now);
  if (!entry) return void 0;
  const model = {
    id: FREE_POOL_MODEL_ID,
    name: entry.display_name,
    family: "",
    brand: "",
    modelFormat: "openai",
    npm: "@ai-sdk/openai-compatible",
    upstreamModelId: FREE_POOL_MODEL_ID,
    contextWindow: entry.context_window
  };
  const base = catalogEntryFromModel(
    model,
    entry.display_name,
    options.priority ?? 1,
    options.appCatalog === true,
    FREE_POOL_MODEL_ID
  );
  const levels = entry.supported_reasoning_levels.length > 0 ? entry.supported_reasoning_levels : [{ effort: "none", description: "none" }];
  return {
    ...base,
    supported_reasoning_levels: levels,
    default_reasoning_level: levels[0].effort,
    default_reasoning_summary: "none",
    supports_reasoning_summaries: false,
    support_verbosity: false,
    default_verbosity: null,
    context_window: entry.context_window,
    max_context_window: entry.context_window,
    truncation_policy: options.appCatalog === true ? base.truncation_policy : { mode: "tokens", limit: entry.context_window }
  };
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
    // Shared with the Codex materializer so Core can't diverge on reasoning/
    // interleaved/effort. Effort resolves on the catalog id (models.dev's key).
    ...resolveModelReasoningMetadata(provider.id, model.id, {
      reasoning: model.reasoning,
      interleavedField: model.interleavedReasoningField
    })
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
  const { wrapLanguageModel } = await import("ai");
  return wrapLanguageModel({
    // `LanguageModel` also admits a bare model-id string and the legacy v2
    // interface; everything Core builds is a concrete current-spec model.
    model,
    middleware: {
      specificationVersion: "v4",
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
async function withRequestHeaders(model, headers) {
  const { wrapLanguageModel } = await import("ai");
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: "v4",
      transformParams: async ({ params }) => ({
        ...params,
        headers: mergeHeaders(
          headers,
          params.headers
        )
      })
    }
  });
}

// src/core/route-id.ts
var SEPARATOR = "::";
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

// src/core/pool-model.ts
var RELAY_POOL_PROVIDER_ID = "relay-free-pool";
var RELAY_POOL_MODEL_ID = "relay-free-pool";
var RELAY_POOL_ROUTE_ID = `${RELAY_POOL_PROVIDER_ID}::${RELAY_POOL_MODEL_ID}`;
var ORIGIN_NAMESPACE = "relay-pool";
var RAW = /* @__PURE__ */ Symbol("relay-pool-raw-part");
var NO_CREDENTIAL_NEEDED = () => "relay-core-pool";
function loadPoolState(registryPath, copilotData) {
  let pool;
  try {
    pool = parseFreePool(loadPreferences().freePool);
  } catch {
    return void 0;
  }
  if (pool.enabled !== true || pool.members.length === 0) return void 0;
  const ids = new Set(pool.members.map((member) => member.providerId));
  const registry = loadCoreRegistry(registryPath);
  const trimmed = {
    ...registry,
    providers: registry.providers.filter((provider) => ids.has(provider.id)).map((provider) => {
      if (!copilotData?.has(provider.id) || !provider.modelsCache) return provider;
      return { ...provider, modelsCache: {
        ...provider.modelsCache,
        models: filterCachedCopilotModels(provider.modelsCache.models, copilotPlanTier(copilotData.get(provider.id)))
      } };
    })
  };
  return { pool, providers: materializeRegistry(trimmed, NO_CREDENTIAL_NEEDED, { agent: "codex" }) };
}
async function loadPoolStateForCall() {
  const first = loadPoolState();
  if (!first) return void 0;
  const copilot = first.pool.members.filter((member) => isProviderKind(member.providerId, "github-copilot"));
  if (copilot.length === 0) return first;
  const registry = loadCoreRegistry();
  const data = /* @__PURE__ */ new Map();
  for (const member of copilot) {
    const provider = registry.providers.find((item) => item.id === member.providerId);
    if (!provider || data.has(provider.id)) continue;
    try {
      data.set(provider.id, await resolveProviderOAuthProviderData(provider.authRef));
    } catch {
      data.set(provider.id, void 0);
    }
  }
  return loadPoolState(void 0, data);
}
function servableMembers(state, now, planKnown = true) {
  const found = [];
  for (const member of state.pool.members) {
    const provider = state.providers.find((item) => item.id === member.providerId);
    const model = provider?.models.find((item) => item.id === member.modelId);
    if (!provider || !model || !model.npm || model.modelFormat === "cloud-code") continue;
    const planPending = !planKnown && isProviderKind(provider.id, "github-copilot");
    if (!planPending && poolFreeStatus({ model, providerId: provider.id }) !== "verified_free") continue;
    if (!planPending && poolRoutingProblem(provider, model)) continue;
    const revision = poolEndpointRevision({
      providerId: provider.id,
      authRef: provider.authRef,
      npm: model.npm,
      baseURL: model.apiBaseUrl,
      upstreamModelId: model.upstreamModelId,
      headers: provider.headers
    });
    const receipt = currentPoolReceipt(state.pool.receipts, member, revision, now);
    if (!receipt || !receipt.billingSafe || !receipt.targets.includes("core")) continue;
    found.push({ member, provider, model, revision, receipt, routeId: `${provider.id}::${model.id}` });
  }
  return found;
}
function commonEffortLevels(members) {
  if (!members.length) return [];
  return members[0].receipt.effortLevels.filter((level) => members.every((item) => item.receipt.effortLevels.includes(level))).filter(isRelayReasoningLevel);
}
function relayPoolDescriptor(now = Date.now(), registryPath) {
  const state = loadPoolState(registryPath);
  if (!state) return void 0;
  const members = servableMembers(state, now, false);
  const entry = members.length ? poolCatalogEntry(state.pool, state.pool.receipts, "core", now) : void 0;
  if (!entry) return void 0;
  const levels = commonEffortLevels(members);
  return {
    routeId: RELAY_POOL_ROUTE_ID,
    providerId: RELAY_POOL_PROVIDER_ID,
    providerName: "Relay Free Pool",
    providerShortName: "Free Pool",
    modelId: RELAY_POOL_MODEL_ID,
    upstreamModelId: RELAY_POOL_MODEL_ID,
    displayName: "Relay Free Pool",
    authType: "none",
    favorite: false,
    contextWindow: entry.context_window,
    pricing: { input: 0, output: 0 },
    capabilities: {
      tools: "unknown",
      vision: "unknown",
      reasoning: levels.length ? "adjustable" : "unknown",
      ...levels.length ? { reasoningLevels: levels } : {}
    }
  };
}
function tagPart(part, key) {
  if (!part.providerMetadata || Object.keys(part.providerMetadata).length === 0) return part;
  return { ...part, providerMetadata: { ...part.providerMetadata, [ORIGIN_NAMESPACE]: { route: key } } };
}
function isolateHistory(prompt, key) {
  return prompt.map((message) => {
    if (message.role !== "assistant" || !Array.isArray(message.content)) return message;
    return {
      ...message,
      content: message.content.map((part) => {
        const options = part.providerOptions;
        if (!options) return part;
        const { providerOptions: _drop, ...clean } = part;
        const origin = options[ORIGIN_NAMESPACE]?.route;
        if (origin !== key) return clean;
        const { [ORIGIN_NAMESPACE]: _tag, ...own } = options;
        return Object.keys(own).length ? { ...clean, providerOptions: own } : clean;
      })
    };
  });
}
var EFFORT_CLAIM_KEYS2 = /* @__PURE__ */ new Set([
  "effort",
  "reasoningEffort",
  "reasoning_effort",
  "thinkingLevel",
  "thinkingBudget",
  "thinking_budget",
  "effortLevel",
  "budget_tokens"
]);
function withoutEffortClaims(options) {
  if (!options) return options;
  const strip = (value, depth) => {
    if (!value || typeof value !== "object" || Array.isArray(value) || depth > 3) return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !EFFORT_CLAIM_KEYS2.has(key)).map(([key, nested]) => [key, strip(nested, depth + 1)]));
  };
  return strip(options, 0);
}
function finishReasonOf(part) {
  if (part.type !== "finish") return void 0;
  const reason = part.finishReason;
  return typeof reason === "string" ? reason : reason?.unified;
}
function toPoolEvent(part, key) {
  const tagged = tagPart(part, key);
  const event = { ...tagged };
  if (part.type === "text-delta" || part.type === "reasoning-delta") event.text = part.delta;
  if (part.type === "finish") event.finishReason = finishReasonOf(part);
  event[RAW] = tagged;
  return event;
}
function rawPart(event) {
  return event[RAW];
}
function wrapPoolError(error) {
  if (isRelayCoreError(error)) return error;
  if (error instanceof PoolAttemptError) {
    if (error.committed) return error.cause ?? error;
    return new RelayCoreError(
      "PROVIDER_LOAD_FAILED",
      "All free pool members failed" + (error.cause ? ": " + describePoolFailure(error.cause) : ""),
      { routeId: RELAY_POOL_ROUTE_ID, retryable: true, cause: error.cause ?? error }
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("No eligible free pool members")) {
    return new RelayCoreError("UNSUPPORTED_MODEL", message, { routeId: RELAY_POOL_ROUTE_ID, retryable: true, cause: error });
  }
  return error;
}
var sessions = new PoolSessionRoutes();
async function memberModel(routeId, context) {
  const { createRelayModel } = await import("./model-KFJ5RIJG.js");
  return createRelayModel(routeId, {
    sessionId: context.sessionId,
    ...context.options?.onDebug ? { onDebug: context.options.onDebug } : {},
    ...context.options?.fetchImpl ? { fetchImpl: context.options.fetchImpl } : {},
    ...context.options?.reasoning !== void 0 ? { reasoning: context.options.reasoning } : {}
  });
}
function buildRoutes(members, context, skips) {
  return members.map((item) => {
    const key = poolRouteKey({ account: item.provider.id, endpointRevision: item.revision, model: item.model.id });
    const scopes = [poolEndpointScope(item.provider.id, item.revision, item.model.id)];
    const accountScopes = [poolAccountScope(item.provider.id)];
    const label = item.provider.id + "/" + item.model.id;
    return lazyPoolRoute({
      member: item.member,
      revision: item.revision,
      freeStatus: "verified_free",
      catalogVerified: true,
      accessVerified: true,
      billingSafe: true,
      targets: item.receipt.targets,
      toolsVerified: item.receipt.tools,
      defaultEffortVerified: true,
      effortLevels: item.receipt.effortLevels,
      contextFits: true,
      contextVerified: true
    }, async () => {
      const gone = (reason) => {
        skips.push(label + ": " + reason);
        return { skip: reason };
      };
      const off = await context.health.disabledFor(scopes);
      if (off) return gone("DISABLED: " + off.note + " (run Test to re-enable)");
      const until = await context.health.cooldownFor({ id: item.revision, scopes: [...scopes, ...accountScopes] });
      if (until !== void 0 && until > context.now) return gone("cooling down after a failure");
      const outputCap = poolOutputCap(item.provider.id, item.model.id, item.receipt.contextWindow);
      const asked = context.call.maxOutputTokens ?? outputCap;
      if (!Number.isSafeInteger(asked) || asked <= 0) return gone("invalid output limit");
      const requestedOutput = Math.min(asked, outputCap);
      const tools = context.call.tools && context.call.tools.length > POOL_MAX_TOOLS ? context.call.tools.slice(0, POOL_MAX_TOOLS) : context.call.tools;
      const prompt = isolateHistory(context.call.prompt, key);
      if (!poolRequestFitsWindow({ prompt, tools }, item.receipt.contextWindow, requestedOutput).fits) {
        return gone("request too large for its context window");
      }
      let model;
      try {
        model = await memberModel(item.routeId, context);
      } catch (error) {
        if (isRelayCoreError(error) && (error.code === "CREDENTIAL_UNAVAILABLE" || error.code === "OAUTH_REFRESH_FAILED")) {
          return gone("no credential");
        }
        return gone("could not be prepared: " + (error instanceof Error ? error.message : String(error)));
      }
      if (typeof model === "string" || typeof model.doStream !== "function") {
        return gone("could not be prepared: unsupported model object");
      }
      context.onBuilt?.();
      const member = model;
      return {
        route: poolRouteFromStream({
          member: item.member,
          revision: item.revision,
          freeStatus: "verified_free",
          catalogVerified: true,
          accessVerified: true,
          billingSafe: true,
          targets: item.receipt.targets,
          toolsVerified: item.receipt.tools,
          defaultEffortVerified: true,
          effortLevels: item.receipt.effortLevels,
          contextFits: true,
          contextVerified: true
        }, (abortSignal) => {
          const source = (async () => (await member.doStream({
            ...context.call,
            prompt,
            tools,
            maxOutputTokens: requestedOutput,
            providerOptions: withoutEffortClaims(context.call.providerOptions),
            abortSignal
          })).stream)();
          return (async function* () {
            const reader = (await source).getReader();
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) return;
                yield toPoolEvent(value, key);
              }
            } finally {
              await reader.cancel().catch(() => {
              });
            }
          })();
        }, { store: context.health, scopes, accountScopes })
      };
    });
  });
}
async function* runPool(options, call) {
  const now = Date.now();
  const state = await loadPoolStateForCall();
  if (!state) {
    throw new RelayCoreError("UNSUPPORTED_MODEL", "Relay Free Pool is not enabled or has no members \u2014 set it up with `relay-ai pool` or relay-ai ui.", { routeId: RELAY_POOL_ROUTE_ID });
  }
  const members = servableMembers(state, now);
  const skips = [];
  const requestId = randomUUID2().slice(0, 8);
  const signal = call.abortSignal ?? new AbortController().signal;
  const started = { at: Date.now() };
  let answering;
  const routes = buildRoutes(members, {
    options,
    call,
    requestId,
    now,
    health: new PoolHealthStore(),
    // A host-supplied conversation id is kept; otherwise Go/Zen members still get a header for this call.
    sessionId: options?.sessionId ?? randomUUID2()
  }, skips);
  const hasTools = Boolean(call.tools?.length);
  const events = dispatchFreePool(state.pool, routes, {
    target: "core",
    tools: hasTools,
    effort: "auto",
    signal,
    ...options?.sessionId ? { conversationScope: options.sessionId } : {}
  }, {
    limits: { ...DEFAULT_POOL_LIMITS, attempts: MAX_POOL_ATTEMPTS },
    sessions,
    retryable: retryPoolFailure,
    onAttempt: (id) => {
      answering = id;
      started.at = Date.now();
    },
    onFailure: (id, error) => {
      const member = poolRouteMember(id);
      if (!member) return;
      const reason = describePoolFailure(error);
      const detail = reason.startsWith("simulated") ? void 0 : poolErrorDetail(error);
      recordPoolActivity({ target: "core", event: "failed", ...member, requestId, reason, ...detail ? { detail } : {}, ms: Date.now() - started.at });
    }
  });
  let served = false;
  try {
    for await (const event of events) {
      if (event.type === "finish") served = true;
      yield rawPart(event);
    }
  } catch (error) {
    if (!signal.aborted) {
      for (const line of skips) {
        const [member, ...reason] = line.split(": ");
        const [providerId, ...model] = (member ?? "").split("/");
        recordPoolActivity({ target: "core", event: "failed", providerId: providerId ?? "pool", modelId: model.join("/") || "none", requestId, reason: "skipped: " + reason.join(": ") });
      }
      recordPoolActivity({ target: "core", event: "gave-up", providerId: "pool", modelId: "none", requestId, ms: Date.now() - started.at });
    }
    throw wrapPoolError(error);
  }
  const answered = answering ? poolRouteMember(answering) : void 0;
  if (served && answered) recordPoolActivity({ target: "core", event: "served", ...answered, requestId, ms: Date.now() - started.at });
}
async function generateFromStream(parts) {
  const text = /* @__PURE__ */ new Map();
  const reasoning = /* @__PURE__ */ new Map();
  const content = [];
  const order = [];
  let warnings = [];
  let finishReason = void 0;
  let usage = void 0;
  let providerMetadata;
  const open = (map, kind, id, meta) => {
    if (!map.has(id)) {
      map.set(id, { text: "", ...meta ? { meta } : {} });
      order.push({ kind, id });
    }
  };
  for await (const part of parts) {
    const p = part;
    switch (p.type) {
      case "stream-start":
        warnings = p.warnings;
        break;
      case "text-start":
        open(text, "text", p.id, p.providerMetadata);
        break;
      case "text-delta":
        open(text, "text", p.id);
        text.get(p.id).text += p.delta ?? "";
        break;
      case "text-end":
        if (p.providerMetadata) {
          open(text, "text", p.id);
          text.get(p.id).meta = p.providerMetadata;
        }
        break;
      case "reasoning-start":
        open(reasoning, "reasoning", p.id, p.providerMetadata);
        break;
      case "reasoning-delta":
        open(reasoning, "reasoning", p.id);
        reasoning.get(p.id).text += p.delta ?? "";
        break;
      case "reasoning-end":
        if (p.providerMetadata) {
          open(reasoning, "reasoning", p.id);
          reasoning.get(p.id).meta = p.providerMetadata;
        }
        break;
      case "tool-call":
      case "file":
      case "source":
        order.push({ kind: "text", id: "" });
        content.push(p);
        break;
      case "finish":
        finishReason = p.finishReason;
        usage = p.usage;
        providerMetadata = p.providerMetadata;
        break;
      default:
        break;
    }
  }
  const leading = [];
  for (const entry of order) {
    if (entry.id === "") continue;
    const source = (entry.kind === "text" ? text : reasoning).get(entry.id);
    leading.push({ type: entry.kind, text: source.text, ...source.meta ? { providerMetadata: source.meta } : {} });
  }
  return {
    content: [...leading, ...content],
    finishReason,
    usage,
    warnings,
    ...providerMetadata ? { providerMetadata } : {}
  };
}
function createRelayPoolModel(options) {
  const state = loadPoolState();
  const members = state ? servableMembers(state, Date.now(), false) : [];
  if (!state || members.length === 0) {
    throw new RelayCoreError("UNSUPPORTED_MODEL", "Relay Free Pool is not enabled or has no usable members \u2014 set it up with `relay-ai pool` or relay-ai ui.", { routeId: RELAY_POOL_ROUTE_ID });
  }
  if (options?.reasoning !== void 0) {
    const levels = commonEffortLevels(members);
    if (!levels.includes(options.reasoning)) {
      throw new RelayCoreError(
        "UNSUPPORTED_REASONING_LEVEL",
        `Relay Free Pool cannot apply reasoning level "${options.reasoning}": every member must have verified it (verified by all: ${levels.join(", ") || "none"}).`,
        { routeId: RELAY_POOL_ROUTE_ID }
      );
    }
  }
  const model = {
    specificationVersion: "v4",
    provider: "relay",
    modelId: RELAY_POOL_MODEL_ID,
    supportedUrls: {},
    async doStream(call) {
      const iterator = runPool(options, call)[Symbol.asyncIterator]();
      const first = await iterator.next();
      const stream = new ReadableStream({
        async start(controller) {
          if (!first.done) controller.enqueue(first.value);
          else controller.close();
        },
        async pull(controller) {
          try {
            const next = await iterator.next();
            if (next.done) controller.close();
            else controller.enqueue(next.value);
          } catch (error) {
            controller.error(error);
          }
        },
        async cancel() {
          await iterator.return?.(void 0);
        }
      });
      return { stream };
    },
    async doGenerate(call) {
      const result = await generateFromStream({ [Symbol.asyncIterator]: () => runPool(options, call) });
      return result;
    }
  };
  return model;
}

export {
  renderMultiAgentV2Feature,
  supportsMultiAgentV2,
  CODEX_APP_PROVIDER_ID,
  PREVIEW_PROXY_PORT,
  CODEX_APP_AUTO_COMPACT_RATIO,
  codexAppModelSlug,
  parseCodexAppModelSlug,
  buildCodexAppRootConfig,
  formatCodexModelLabel,
  catalogEntryFromModel,
  buildCatalogFile,
  buildAppCatalogFile,
  serializeCatalog,
  MAX_POOL_ATTEMPTS,
  PoolAttemptError,
  requestFingerprint,
  dispatchFreePool,
  lazyPoolRoute,
  sdkPoolRoute,
  poolRequestFitsWindow,
  translateResponsesRequest,
  streamResponsesResponse,
  generateResponsesResponse,
  decodeCompactionContent,
  appendCompactionInstruction,
  generateCompactionResponse,
  streamCompactionResponse,
  writeResponsesErrorStream,
  poolRouteKey,
  poolMemberEffort,
  poolOutputCap,
  POOL_MAX_TOOLS,
  translatedEffortClaim,
  prepareCodexPoolRoutes,
  FREE_POOL_MODEL_ID,
  FREE_POOL_PROVIDER_ID,
  DEFAULT_POOL_LIMITS,
  CodexPoolRuntime,
  poolCatalogEntry,
  codexPoolCatalogEntry,
  codexPoolCatalogModel,
  RelayCoreError,
  isRelayCoreError,
  reasoningNpmForRoute,
  resolveReasoningProviderOptions,
  withReasoningProviderOptions,
  withRequestHeaders,
  RELAY_POOL_PROVIDER_ID,
  RELAY_POOL_MODEL_ID,
  RELAY_POOL_ROUTE_ID,
  loadPoolState,
  loadPoolStateForCall,
  servableMembers,
  relayPoolDescriptor,
  tagPart,
  isolateHistory,
  createRelayPoolModel,
  parseRelayRouteId,
  loadCoreRegistry
};
//# sourceMappingURL=chunk-OY3QLATE.js.map