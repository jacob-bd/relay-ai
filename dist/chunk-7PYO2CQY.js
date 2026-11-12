#!/usr/bin/env node
import {
  normalizeToolSchemaForNpm
} from "./chunk-UR4QFFSQ.js";
import {
  anthropicErrorType,
  upstreamHttpStatus
} from "./chunk-IRMXZJ3D.js";
import {
  deepMergeProviderOptions,
  effortProviderOptions,
  encodeToolUseId,
  grabRoundTripSignature,
  serializeToolResultContent,
  splitToolUseId,
  sseChunk,
  thinkingProviderOptions
} from "./chunk-HWZBCTO3.js";
import {
  MAX_MODEL_CATALOG
} from "./chunk-VWAB7443.js";

// src/subagent-route-registry.ts
import { randomUUID } from "crypto";
var DEFAULT_TTL_MS = 5 * 6e4;
var DEFAULT_MAX_ENTRIES = 1024;
var ROUTE_MARKER_PATTERN = /(?:\n\n)?<relay-ai-subagent-route token="([0-9a-f-]{36})"\s*\/>/gi;
function firstHeader(value) {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" && first.trim() ? first.trim() : void 0;
}
function extractClaudeSessionId(headers, body) {
  const headerSession = firstHeader(headers["x-claude-code-session-id"]);
  if (headerSession) return headerSession;
  const userId = body?.metadata?.user_id;
  if (typeof userId !== "string") return void 0;
  try {
    const parsed = JSON.parse(userId);
    return typeof parsed.session_id === "string" && parsed.session_id.trim() ? parsed.session_id.trim() : void 0;
  } catch {
    return void 0;
  }
}
function appendSubagentRouteMarker(prompt, token) {
  return `${prompt}

<relay-ai-subagent-route token="${token}"/>`;
}
function findMarkersInUserMessages(body) {
  if (!Array.isArray(body.messages)) return void 0;
  const tokens = [];
  const messages = [...body.messages];
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const message = body.messages[messageIndex];
    if (!message || message.role !== "user") continue;
    if (typeof message.content === "string") {
      const matches = [...message.content.matchAll(ROUTE_MARKER_PATTERN)];
      if (matches.length === 0) continue;
      tokens.push(...matches.flatMap((match) => match[1] ? [match[1]] : []));
      messages[messageIndex] = {
        ...message,
        content: message.content.replace(ROUTE_MARKER_PATTERN, "").trimEnd()
      };
      continue;
    }
    if (!Array.isArray(message.content)) continue;
    const content = [...message.content];
    for (let partIndex = 0; partIndex < message.content.length; partIndex++) {
      const part = message.content[partIndex];
      if (!part || part.type !== "text" || typeof part.text !== "string") continue;
      const matches = [...part.text.matchAll(ROUTE_MARKER_PATTERN)];
      if (matches.length === 0) continue;
      tokens.push(...matches.flatMap((match) => match[1] ? [match[1]] : []));
      content[partIndex] = {
        ...part,
        text: part.text.replace(ROUTE_MARKER_PATTERN, "").trimEnd()
      };
    }
    messages[messageIndex] = { ...message, content };
  }
  return tokens.length > 0 ? { tokens, body: { ...body, messages } } : void 0;
}
var SubagentRouteRegistry = class {
  entries = /* @__PURE__ */ new Map();
  ttlMs;
  maxEntries;
  now;
  constructor(options = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.now = options.now ?? Date.now;
  }
  register(sessionId, modelId) {
    this.cleanup();
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (!oldest) break;
      this.entries.delete(oldest);
    }
    const token = randomUUID();
    this.entries.set(token, { sessionId, modelId, createdAt: this.now() });
    return token;
  }
  consume(headers, body) {
    this.cleanup();
    if (!firstHeader(headers["x-claude-code-agent-id"])) return void 0;
    const sessionId = extractClaudeSessionId(headers, body);
    if (!sessionId) return void 0;
    const marked = findMarkersInUserMessages(body);
    if (!marked) return void 0;
    const token = [...marked.tokens].reverse().find((candidate) => this.entries.get(candidate)?.sessionId === sessionId);
    if (!token) return void 0;
    const entry = this.entries.get(token);
    this.entries.delete(token);
    return { modelId: entry.modelId, body: marked.body };
  }
  cleanup() {
    const cutoff = this.now() - this.ttlMs;
    for (const [token, entry] of this.entries) {
      if (entry.createdAt < cutoff) this.entries.delete(token);
    }
  }
};

// src/subagent-model-routing.ts
var CLAUDE_MODEL_FAMILIES = ["sonnet", "opus", "haiku", "fable"];
var CLAUDE_MODEL_FAMILY_SET = new Set(CLAUDE_MODEL_FAMILIES);
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function claudeModelFamily(modelId) {
  const normalized = modelId.toLowerCase();
  if (!normalized.startsWith("claude-")) return void 0;
  return CLAUDE_MODEL_FAMILIES.find((family) => normalized.includes(family));
}
function isClaudeAgentTool(tool2) {
  if (tool2.name !== "Agent" || !isRecord(tool2.input_schema)) return false;
  const properties = tool2.input_schema.properties;
  if (!isRecord(properties)) return false;
  return ["description", "prompt", "subagent_type"].every((name) => isRecord(properties[name]));
}
var UnavailableSubagentModelError = class extends Error {
  constructor(selector, routing) {
    const visible = routing.models.slice(0, MAX_MODEL_CATALOG).map((model) => model.id);
    const omitted = routing.models.length - visible.length;
    const suffix = omitted > 0 ? `, and ${omitted} more` : "";
    super(
      `Subagent model "${selector}" is unavailable in this Relay AI session. Available model ids: ${visible.join(", ")}${suffix}.`
    );
    this.selector = selector;
    this.name = "UnavailableSubagentModelError";
  }
  selector;
  statusCode = 400;
};
function normalizeClaudeAgentInput(input, routing) {
  const source = isRecord(input) ? input : {};
  const normalized = { ...source };
  if (source.subagent_type === "fork") {
    return { input: normalized, decision: { kind: "fork" } };
  }
  const rawModel = source.model;
  if (rawModel == null) {
    normalized.model = routing.parentModelId;
    return {
      input: normalized,
      decision: { kind: "inherit", resolvedModelId: routing.parentModelId }
    };
  }
  if (typeof rawModel !== "string") {
    throw new UnavailableSubagentModelError(String(rawModel), routing);
  }
  const selector = rawModel.trim();
  if (selector === "" || selector === "inherit") {
    normalized.model = routing.parentModelId;
    return {
      input: normalized,
      decision: { kind: "inherit", resolvedModelId: routing.parentModelId }
    };
  }
  const exposed = routing.models.find((model) => model.id === selector);
  if (exposed) {
    normalized.model = exposed.id;
    return {
      input: normalized,
      decision: { kind: "explicit", resolvedModelId: exposed.id }
    };
  }
  const compatible = routing.models.find((model) => model.compatibilityIds.includes(selector));
  if (compatible) {
    normalized.model = compatible.id;
    return {
      input: normalized,
      decision: {
        kind: "compatibility",
        requestedModelId: selector,
        resolvedModelId: compatible.id
      }
    };
  }
  if (CLAUDE_MODEL_FAMILY_SET.has(selector)) {
    const family = selector;
    const nativeModel = routing.models.find((model) => model.family === family);
    const resolvedModelId = nativeModel?.id ?? routing.parentModelId;
    normalized.model = resolvedModelId;
    return {
      input: normalized,
      decision: nativeModel ? { kind: "family", requestedModelId: family, resolvedModelId } : { kind: "family-fallback", requestedModelId: family, resolvedModelId }
    };
  }
  throw new UnavailableSubagentModelError(selector, routing);
}
function prepareClaudeAgentInput(input, routing) {
  const normalized = normalizeClaudeAgentInput(input, routing);
  const decision = normalized.decision;
  if (decision.kind === "fork") return normalized;
  if (!routing.registerSubagentRoute) return normalized;
  const prompt = normalized.input.prompt;
  if (typeof prompt !== "string") return normalized;
  const token = routing.registerSubagentRoute(decision.resolvedModelId);
  const clientInput = { ...normalized.input };
  const target = routing.models.find((model) => model.id === decision.resolvedModelId);
  if (target?.family) clientInput.model = target.family;
  else delete clientInput.model;
  clientInput.prompt = appendSubagentRouteMarker(prompt, token);
  return { input: clientInput, decision };
}
function augmentClaudeAgentTool(tool2, routing) {
  const inputSchema = isRecord(tool2.input_schema) ? tool2.input_schema : {};
  const properties = isRecord(inputSchema.properties) ? inputSchema.properties : {};
  const originalModel = isRecord(properties.model) ? properties.model : {};
  const smallCatalog = routing.models.length <= MAX_MODEL_CATALOG;
  const modelProperty = {
    ...originalModel,
    type: "string"
  };
  if (smallCatalog) {
    const originalEnum = Array.isArray(originalModel.enum) ? originalModel.enum.filter((value) => typeof value === "string") : CLAUDE_MODEL_FAMILIES;
    modelProperty.enum = [.../* @__PURE__ */ new Set([...originalEnum, ...routing.models.map((model) => model.id)])];
  } else {
    delete modelProperty.enum;
  }
  const guidance = smallCatalog ? `Relay AI subagent model routing (default: ${routing.parentModelId}). ` + routing.models.map((model) => `${model.displayName}: ${model.id}`).join("; ") : `Relay AI subagent model routing (default: ${routing.parentModelId}). Other explicit model values must be exact ids from the current session catalog.`;
  return {
    ...tool2,
    description: [tool2.description?.trim(), guidance].filter(Boolean).join("\n\n"),
    input_schema: {
      ...inputSchema,
      properties: {
        ...properties,
        model: modelProperty
      }
    }
  };
}

// src/sdk-adapter.ts
import { streamText, generateText, tool, jsonSchema } from "ai";

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
function toAnthropicUsage(usage, fallbackInputTokens = 0) {
  const totalInput = usage?.inputTokens ?? fallbackInputTokens;
  const cacheRead = usage?.inputTokenDetails?.cacheReadTokens;
  const cacheWrite = usage?.inputTokenDetails?.cacheWriteTokens;
  const noCache = usage?.inputTokenDetails?.noCacheTokens;
  return {
    input_tokens: noCache ?? (cacheRead !== void 0 ? Math.max(0, totalInput - cacheRead) : totalInput),
    output_tokens: usage?.outputTokens ?? 0,
    ...cacheRead !== void 0 && cacheRead > 0 ? { cache_read_input_tokens: cacheRead } : {},
    ...cacheWrite !== void 0 && cacheWrite > 0 ? { cache_creation_input_tokens: cacheWrite } : {}
  };
}
function anthropicEffortFromRequest(body) {
  const effort = body.output_config?.effort;
  if (typeof effort === "string" && effort.trim()) return effort.trim();
  return void 0;
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
    const text = typeof msg.content === "string" ? msg.content : msg.content.map((b) => b.text ?? "").join("\n");
    if (text.trim()) parts.push(text.trim());
  }
  return parts;
}
function imagePart(block) {
  const src = block.source;
  if (!src) return null;
  if (src.type === "base64" && src.data) {
    return { type: "file", mediaType: src.media_type ?? "image", data: Buffer.from(src.data, "base64") };
  }
  if (src.type === "url" && src.url) {
    return { type: "file", mediaType: src.media_type ?? "image", data: { type: "url", url: new URL(src.url) } };
  }
  return null;
}
function toolResultOutput(content) {
  if (!Array.isArray(content) || !content.some((block) => block?.type === "image")) {
    return { type: "text", value: serializeToolResultContent(content) };
  }
  return {
    type: "content",
    value: content.map((block) => {
      if (block?.type === "image") {
        const image = imagePart(block);
        if (image) return {
          type: "file",
          mediaType: image.mediaType,
          data: image.data instanceof Uint8Array ? { type: "data", data: image.data } : image.data
        };
      }
      return { type: "text", text: block?.type === "text" ? block.text ?? "" : serializeToolResultContent(block) };
    })
  };
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
  const text = block.thinking ?? "";
  if (npm === "@ai-sdk/openai" && !block.signature && !text.trim()) return null;
  const part = { type: "reasoning", text };
  if (block.signature) {
    if (npm === "@ai-sdk/google") {
      part.providerOptions = { google: { thoughtSignature: block.signature } };
    } else if (npm === "@ai-sdk/openai" || npm === "@ai-sdk/openai-compatible") {
      part.providerOptions = { openai: { reasoningEncryptedContent: block.signature } };
    }
  }
  return part;
}
function translateMessages(messages, npm, onDebug) {
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
          const p = imagePart(b);
          if (p) parts.push(p);
        }
      }
      if (blocks.length && !toolResults.length && !parts.length) {
        const types = blocks.map((b) => b.type).join(", ");
        onDebug?.(`sdk: dropped user turn with unrecognized block types: [${types}]`);
      }
      if (toolResults.length) {
        out.push({
          role: "tool",
          content: toolResults.map((tr) => ({
            type: "tool-result",
            toolCallId: splitToolUseId(tr.tool_use_id ?? "").rawId,
            toolName: tr._name ?? "unknown",
            output: toolResultOutput(tr.content)
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
function stripNullInputs(input) {
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (v !== null) out[k] = v;
  }
  return out;
}
function translateTools(anthropicTools, npm) {
  if (!anthropicTools?.length) return void 0;
  const tools = {};
  for (const t of anthropicTools) {
    if (!t.name || !t.input_schema) continue;
    tools[t.name] = tool({
      description: t.description ?? "",
      inputSchema: jsonSchema(normalizeToolSchemaForNpm(t.input_schema, npm))
    });
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
function translateRequest(body, npm, options) {
  const messages = body.messages ?? [];
  annotateToolNames(messages);
  const baseSystem = systemToString(body.system);
  const inlineParts = inlineSystemText(messages);
  const systemText = [baseSystem, ...inlineParts].filter((s) => s && s.trim()).join("\n\n") || (options?.openAiOAuth ? "You are a coding assistant." : void 0);
  let upstreamTools = resolveUpstreamTools(
    body.tools,
    messages
  );
  if (options?.maxTools !== void 0 && upstreamTools.length > options.maxTools) {
    upstreamTools = upstreamTools.slice(0, options.maxTools);
  }
  let responseSubagentRouting;
  if (options?.subagentRouting) {
    const agentIndex = upstreamTools.findIndex((toolDefinition) => isClaudeAgentTool(toolDefinition));
    if (agentIndex >= 0) {
      upstreamTools = upstreamTools.map((toolDefinition, index) => index === agentIndex ? augmentClaudeAgentTool(
        toolDefinition,
        options.subagentRouting
      ) : toolDefinition);
      responseSubagentRouting = options.subagentRouting;
    }
  }
  const effort = options?.fixedEffort ?? anthropicEffortFromRequest(body) ?? options?.defaultEffort;
  let providerOptions = deepMergeProviderOptions(
    thinkingProviderOptions(npm),
    effortProviderOptions(npm, effort, options?.reasoningMetadata?.upstreamModelId ?? body.model, options?.reasoningMetadata)
  );
  if (options?.openAiOAuth && systemText) {
    providerOptions = deepMergeProviderOptions(providerOptions, {
      openai: { instructions: systemText }
    });
  }
  return {
    instructions: options?.openAiOAuth ? void 0 : systemText,
    messages: translateMessages(messages, npm, options?.onDebug),
    tools: translateTools(upstreamTools.length ? upstreamTools : void 0, npm),
    toolChoice: translateToolChoice(body.tool_choice),
    maxOutputTokens: options?.openAiOAuth ? void 0 : body.max_tokens,
    temperature: body.temperature,
    providerOptions,
    headers: options?.requestHeaders,
    subagentRouting: responseSubagentRouting
  };
}
function logSubagentDecision(log, decision) {
  if (!log || decision.kind === "fork" || decision.kind === "explicit") return;
  log(() => decision.kind === "family-fallback" ? `sdk Agent model "${decision.requestedModelId}" unavailable; using parent ${decision.resolvedModelId}` : `sdk Agent model ${decision.kind}: ${"requestedModelId" in decision ? `${decision.requestedModelId} -> ` : ""}${decision.resolvedModelId}`);
}
async function writeAnthropicStream(fullStream, modelId, write, log, estimatedInputTokens = 0, subagentRouting) {
  const messageId = "msg_" + Date.now();
  let blockIndex = -1;
  let started = false;
  let openType = null;
  let pendingThinkingSig;
  const pendingToolStarts = /* @__PURE__ */ new Map();
  let finishReason = "end_turn";
  let usage = { input_tokens: estimatedInputTokens, output_tokens: 0 };
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
        usage: { input_tokens: estimatedInputTokens, output_tokens: 0 }
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
      // Complete tool arguments before opening a block: calls may interleave.
      case "tool-input-start":
        pendingToolStarts.set(part.id ?? "", part);
        break;
      case "tool-input-delta":
      case "tool-input-end":
        break;
      case "tool-call": {
        finishReason = "tool_use";
        const toolCallId = part.toolCallId ?? "";
        const pendingStart = pendingToolStarts.get(toolCallId);
        pendingToolStarts.delete(toolCallId);
        closeOpen();
        let input = part.input ?? {};
        if (subagentRouting && part.toolName === "Agent") {
          try {
            const normalized = prepareClaudeAgentInput(part.input, subagentRouting);
            logSubagentDecision(log, normalized.decision);
            input = normalized.input;
          } catch (error) {
            if (error instanceof UnavailableSubagentModelError) {
              emit("error", {
                type: "error",
                error: { type: anthropicErrorType(error.statusCode), message: error.message }
              });
              return;
            }
            throw error;
          }
        }
        const sig = grabRoundTripSignature(pendingStart ?? part) ?? grabRoundTripSignature(part);
        openBlock("tool", {
          type: "tool_use",
          id: encodeToolUseId(toolCallId, sig),
          name: part.toolName,
          input: {}
        });
        emit("content_block_delta", {
          type: "content_block_delta",
          index: blockIndex,
          delta: { type: "input_json_delta", partial_json: JSON.stringify(stripNullInputs(input)) }
        });
        closeOpen();
        break;
      }
      case "finish":
        if (part.totalUsage) {
          usage = toAnthropicUsage(part.totalUsage, estimatedInputTokens);
        }
        if (part.finishReason === "tool-calls") finishReason = "tool_use";
        else if (part.finishReason === "length") finishReason = "max_tokens";
        else if (part.finishReason === "stop" && finishReason !== "tool_use") finishReason = "end_turn";
        break;
      case "error": {
        const e = part.error;
        const errMsg = e?.message || (typeof part.error === "string" ? part.error : JSON.stringify(e?.data ?? part.error));
        const errorType = anthropicErrorType(upstreamHttpStatus(part.error, errMsg));
        log?.(() => `sdk stream error (${errorType}): ${errMsg}`);
        pendingToolStarts.clear();
        closeOpen();
        emit("error", { type: "error", error: { type: errorType, message: errMsg } });
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
async function streamAnthropicResponse(model, params, modelId, write, log, estimatedInputTokens = 0) {
  const { subagentRouting, ...providerParams } = params;
  const result = streamText({ model, ...providerParams, onError: () => {
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
  await writeAnthropicStream(
    result.stream,
    modelId,
    write,
    log,
    estimatedInputTokens,
    subagentRouting
  );
}
async function generateAnthropicResponse(model, params, modelId, options) {
  const { subagentRouting, ...providerParams } = params;
  let text;
  let toolCalls;
  let finishReason;
  let usage;
  if (options?.forceStream) {
    let firstStreamError;
    const r = streamText({
      model,
      ...providerParams,
      onError: (event) => {
        firstStreamError ??= event;
      }
    });
    Promise.resolve(r.toolResults).catch(() => {
    });
    try {
      [text, toolCalls, finishReason, usage] = await Promise.all([r.text, r.toolCalls, r.finishReason, r.usage]);
    } catch (error) {
      throw firstStreamError ? firstStreamError.error : error;
    }
  } else {
    const r = await generateText({ model, ...providerParams });
    ({ text, toolCalls, finishReason, usage } = r);
  }
  return {
    id: "msg_" + Date.now(),
    type: "message",
    role: "assistant",
    model: modelId,
    content: [
      ...text ? [{ type: "text", text }] : [],
      ...toolCalls.map((tc) => {
        let input = tc.input;
        if (subagentRouting && tc.toolName === "Agent") {
          const normalized = prepareClaudeAgentInput(tc.input, subagentRouting);
          logSubagentDecision(options?.log, normalized.decision);
          input = normalized.input;
        }
        return {
          type: "tool_use",
          id: encodeToolUseId(tc.toolCallId, grabRoundTripSignature(tc)),
          name: tc.toolName,
          input: stripNullInputs(input)
        };
      })
    ],
    stop_reason: finishReason === "tool-calls" ? "tool_use" : "end_turn",
    usage: toAnthropicUsage(usage)
  };
}

export {
  extractClaudeSessionId,
  SubagentRouteRegistry,
  claudeModelFamily,
  anthropicEffortFromRequest,
  translateRequest,
  writeAnthropicStream,
  streamAnthropicResponse,
  generateAnthropicResponse
};
//# sourceMappingURL=chunk-7PYO2CQY.js.map