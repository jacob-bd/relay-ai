#!/usr/bin/env node
import {
  setContextWindowOverride,
  setModelNotChat
} from "./chunk-L5UIRBFD.js";
import "./chunk-5HGLQHX6.js";
import {
  createRelayModel
} from "./chunk-BEUC3XZN.js";
import "./chunk-A3Q3C2FS.js";
import {
  TEST_MAX_OUTPUT_TOKENS,
  cachedModelToLocal
} from "./chunk-SZETLIMN.js";
import "./chunk-OIJVKOTS.js";
import "./chunk-UR4QFFSQ.js";
import {
  upstreamHttpStatus
} from "./chunk-IRMXZJ3D.js";
import {
  getProviderModels,
  loadRegistry
} from "./chunk-EP5Y4GRS.js";
import "./chunk-W32XKRNU.js";
import {
  providerKind,
  resolveProviderCredential
} from "./chunk-4RLHM2U6.js";
import "./chunk-6DCEGHZH.js";
import "./chunk-XEH2JMTL.js";
import "./chunk-JIDIH7DS.js";

// src/test-model.ts
import { randomUUID } from "crypto";
import { streamText, tool, jsonSchema } from "ai";
var CONTEXT_PROBE_MAX_TOKENS = 1e8;
var CONTEXT_LIMIT_PATTERNS = [
  /max_model_len\s*=\s*(?:max_total_tokens\s*=\s*)?(\d[\d,_]*)/i,
  /maximum context (?:length|window|size)[^0-9]{0,40}?(\d[\d,_]*)/i,
  /context (?:length|window|size) (?:limit )?(?:is|of)[^0-9]{0,10}(\d[\d,_]*)\s*tokens/i
];
function parseContextLimit(text) {
  for (const pattern of CONTEXT_LIMIT_PATTERNS) {
    const match = pattern.exec(text);
    if (!match?.[1]) continue;
    const value = Number(match[1].replace(/[,_]/g, ""));
    if (Number.isSafeInteger(value) && value >= 1e3 && value < CONTEXT_PROBE_MAX_TOKENS) return value;
  }
  return void 0;
}
function errorText(error) {
  if (!error || typeof error !== "object") return String(error ?? "");
  const e = error;
  return [e.message, e.responseBody, e.cause && typeof e.cause === "object" ? e.cause.message : void 0].filter((part) => typeof part === "string").join(" ");
}
var NOT_CHAT_PATTERN = /not a chat model|does not support chat|chat(?: completions?)? (?:is |are )?not supported|only supports? (?:embeddings?|rerank)|is an embedding model/i;
function isNotChatRefusal(error) {
  const text = errorText(error);
  if (NOT_CHAT_PATTERN.test(text)) return true;
  const status = error && typeof error === "object" ? error.statusCode : void 0;
  const letters = text.toLowerCase().replace(/[^a-z]/g, "");
  return status === 404 && /^(?:detail|notfound)+$/.test(letters);
}
async function probeModel(providerId, modelId, signal) {
  const inspect = (error) => {
    const limit = parseContextLimit(errorText(error));
    if (limit !== void 0) return { limit, chat: true };
    return isNotChatRefusal(error) ? { chat: false } : {};
  };
  const controller = new AbortController();
  try {
    const model = await createRelayModel(`${providerId}::${modelId}`, { sessionId: `relay-test-${randomUUID()}` });
    const result = streamText({
      model,
      prompt: "Reply with OK.",
      maxOutputTokens: CONTEXT_PROBE_MAX_TOKENS,
      maxRetries: 0,
      abortSignal: AbortSignal.any([signal, controller.signal]),
      onError: () => {
      }
    });
    for (const promise of [result.text, result.toolCalls, result.toolResults, result.finishReason, result.usage, result.response]) {
      Promise.resolve(promise).catch(() => {
      });
    }
    for await (const part of result.stream) {
      if (part.type === "error") return inspect(part.error);
      if (part.type === "text-delta") {
        controller.abort();
        return { chat: true };
      }
      if (part.type === "finish") return { chat: true };
    }
    return {};
  } catch (error) {
    if (controller.signal.aborted) return { chat: true };
    return inspect(error);
  }
}
async function measureContextWindow(providerId, modelId, signal) {
  return (await probeModel(providerId, modelId, signal)).limit;
}
function rememberChatResult(providerId, modelId, chat) {
  if (chat === void 0) return;
  try {
    setModelNotChat(providerId, modelId, !chat);
  } catch {
  }
}
async function ollamaContextLimit(providerId, modelId, signal) {
  try {
    const provider = loadRegistry().providers.find((p) => p.id === providerId);
    if (!provider || providerKind(provider.id) !== "ollama" || !provider.api.url) return void 0;
    const root = provider.api.url.replace(/\/+$/, "").replace(/\/v1$/, "");
    const key = await resolveProviderCredential(provider.id, provider.authRef).catch(() => "");
    const upstream = getProviderModels(provider).find((m) => m.id === modelId)?.upstreamModelId ?? modelId;
    const response = await fetch(`${root}/api/show`, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", ...key && key !== "ollama" ? { Authorization: `Bearer ${key}` } : {} },
      body: JSON.stringify({ model: upstream })
    });
    if (!response.ok) return void 0;
    const info = (await response.json()).model_info ?? {};
    for (const [name, value] of Object.entries(info)) {
      if (name.endsWith(".context_length") && typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
    }
  } catch {
  }
  return void 0;
}
async function checkContextWindow(providerId, modelId, signal, opts) {
  const timeout = AbortSignal.timeout(2e4);
  const bounded = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const probe = opts?.lookupOnly ? {} : await probeModel(providerId, modelId, bounded);
  const measured = probe.limit ?? await ollamaContextLimit(providerId, modelId, bounded);
  rememberChatResult(providerId, modelId, probe.chat);
  const notChat = probe.chat === void 0 ? {} : { notChat: !probe.chat };
  const provider = loadRegistry().providers.find((p) => p.id === providerId);
  const cached = provider ? getProviderModels(provider).find((m) => m.id === modelId) : void 0;
  const previous = provider && cached ? cachedModelToLocal(cached, provider)?.contextWindow : void 0;
  const keptManual = provider?.contextWindowOverrides?.[modelId]?.source === "user";
  const confirmsGuess = measured !== void 0 && measured === previous && (cached?.contextWindowSource === void 0 || cached.contextWindowSource === "models.dev");
  if (measured === void 0 || keptManual || measured === previous && !confirmsGuess) {
    return { measured, previous, updated: false, keptManual: keptManual && measured !== void 0 && measured !== previous, ...notChat };
  }
  let saved = false;
  try {
    saved = setContextWindowOverride(providerId, modelId, measured, "measured").ok;
  } catch {
  }
  return { measured, previous, updated: saved && measured !== previous, saved, keptManual: false, ...notChat };
}
async function testModel(providerId, modelId, signal, opts) {
  const provider = loadRegistry().providers.find((p) => p.id === providerId);
  if (!provider?.enabled || !getProviderModels(provider).some((m) => m.id === modelId)) {
    return { ok: false, error: "Model is no longer available. Refresh this provider." };
  }
  const started = Date.now();
  const timeout = AbortSignal.timeout(3e4);
  const abortSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const model = await createRelayModel(`${providerId}::${modelId}`, { sessionId: `relay-test-${randomUUID()}` });
    abortSignal.throwIfAborted();
    const result = streamText({
      model,
      prompt: opts?.withoutTools ? "Say OK." : 'Say OK, then call relay_pool_probe with value "ok".',
      maxOutputTokens: TEST_MAX_OUTPUT_TOKENS,
      ...opts?.withoutTools ? {} : { tools: { relay_pool_probe: tool({
        description: "Harmless capability check; never executed.",
        inputSchema: jsonSchema({ type: "object", properties: { value: { type: "string", enum: ["ok"] } }, required: ["value"], additionalProperties: false })
      }) } },
      maxRetries: 0,
      abortSignal,
      onError: () => {
      }
    });
    for (const promise of [result.text, result.toolCalls, result.toolResults, result.finishReason, result.usage, result.response]) {
      Promise.resolve(promise).catch(() => {
      });
    }
    let text = "";
    let finished = false;
    let hitLimit = false;
    let toolsPassed = false;
    for await (const part of result.stream) {
      if (part.type === "error") throw part.error;
      if (part.type === "text-delta") text += part.text;
      if (part.type === "tool-call") toolsPassed = part.toolName === "relay_pool_probe" && part.input?.value === "ok";
      if (part.type === "finish") {
        finished = part.finishReason !== "length";
        hitLimit = part.finishReason === "length";
      }
    }
    abortSignal.throwIfAborted();
    if (!finished || !text.trim() && !toolsPassed) {
      if (hitLimit && !text.trim()) {
        return { ok: false, error: "The model used its whole 1024-token test budget before answering (likely hidden reasoning). It may still work in a real session; try the test again." };
      }
      return { ok: false, error: "The model returned no complete text response. Try again or choose another model." };
    }
    const latencyMs = Date.now() - started;
    rememberChatResult(providerId, modelId, true);
    return { ok: true, latencyMs, notChat: false, toolsPassed };
  } catch (error) {
    if (!opts?.withoutTools && !abortSignal.aborted && /does not support tools|tools? (?:are|is) not supported/i.test(errorText(error))) {
      return testModel(providerId, modelId, signal, { withoutTools: true });
    }
    if (!abortSignal.aborted && isNotChatRefusal(error)) {
      rememberChatResult(providerId, modelId, false);
      return { ok: false, notChat: true, error: "This is not a chat model (the server refused the chat request), so Relay cannot use it. You can hide it." };
    }
    const status = upstreamHttpStatus(error, "");
    const text = errorText(error);
    const message = abortSignal.aborted ? "No response within 30 seconds, or the test was cancelled." : status === 404 && /unsupported_path|not an? (?:\w+ )?surface/i.test(text) ? "This provider's endpoint doesn't serve this model. Try the same model on your other provider for this gateway (e.g. the OpenAI-style one)." : status === 403 && /subscription .* does not include model/i.test(text) ? "Your plan doesn't include this model." : status === 401 || status === 403 ? "Access denied. Check the provider key or sign in again." : status === 429 ? "Provider rate limit reached. Try again later." : status === 402 ? "Provider quota or credits exhausted." : "The model could not respond. Check the provider credentials and connection, then try again.";
    const transient = abortSignal.aborted || status === 429 || status === 402 || status === void 0 || typeof status === "number" && status >= 500;
    return { ok: false, error: message, ...transient ? { transient: true } : {} };
  }
}
export {
  checkContextWindow,
  isNotChatRefusal,
  measureContextWindow,
  ollamaContextLimit,
  parseContextLimit,
  probeModel,
  testModel
};
//# sourceMappingURL=test-model-2GXVA25S.js.map