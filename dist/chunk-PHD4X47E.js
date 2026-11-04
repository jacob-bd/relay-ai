#!/usr/bin/env node
import {
  classifyFreeStatus,
  poolEndpointRevision
} from "./chunk-IBAUEWWV.js";

// src/pool/enroll.ts
var RECEIPT_TTL_MS = 24 * 60 * 60 * 1e3;
var ENROLL_MAX_OUTPUT_TOKENS = 4096;
async function verifyPoolMember(member, providers, signal, deps, now = Date.now()) {
  const provider = providers.find((item) => item.id === member.providerId);
  const model = provider?.models.find((item) => item.id === member.modelId);
  if (!provider || !model) return { member, status: "skipped", reason: "unavailable" };
  if (!model.npm || model.modelFormat === "cloud-code") return { member, status: "skipped", reason: "unsupported-transport" };
  if (!Number.isSafeInteger(model.contextWindow) || !model.contextWindow || model.contextWindow <= 0) {
    return { member, status: "skipped", reason: "unverified-context-window" };
  }
  const freeStatus = classifyFreeStatus({ model, providerId: provider.id });
  if (freeStatus !== "verified_free" && freeStatus !== "free_provider") {
    return { member, status: "skipped", reason: "not-free" };
  }
  if (freeStatus !== "verified_free") {
    return { member, status: "skipped", reason: "billing-safeguard-unverified" };
  }
  const apiKey = await deps.resolveKey(provider);
  if (!apiKey) return { member, status: "skipped", reason: "missing-credential" };
  const languageModel = await deps.createModel(provider, model, apiKey);
  const probe = await deps.probe(languageModel, signal);
  if (probe.text !== "passed" || probe.tools !== "passed") {
    return { member, status: "skipped", reason: "probe-" + (probe.failure ?? "failed") };
  }
  const targets = ["codex", "claude"];
  const effortLevels = [];
  if (deps.probeEffort && model.reasoning) {
    const declared = (model.reasoningEffortLevels ?? []).filter((level) => ["low", "medium", "high", "xhigh", "max"].includes(level));
    const candidates = [...new Set(declared.length > 0 ? declared : ["high"])].slice(0, 4);
    for (const level of candidates) {
      if (await deps.probeEffort(languageModel, level, signal)) effortLevels.push(level);
    }
    if (effortLevels.length > 0) targets.push("antigravity");
  }
  const revision = poolEndpointRevision({
    providerId: provider.id,
    authRef: provider.authRef,
    npm: model.npm,
    baseURL: model.apiBaseUrl,
    upstreamModelId: model.upstreamModelId,
    headers: provider.headers
  });
  return {
    member,
    status: "verified",
    receipt: {
      member: { providerId: member.providerId, modelId: member.modelId },
      endpointRevision: revision,
      verifiedAt: now,
      expiresAt: now + RECEIPT_TTL_MS,
      targets,
      tools: true,
      maxOutputTokens: ENROLL_MAX_OUTPUT_TOKENS,
      contextWindow: model.contextWindow,
      contextSource: "provider",
      reasoningAccounting: "inside-output",
      effortLevels,
      billingSafe: true
    }
  };
}

// src/pool/probe.ts
import { streamText, tool, jsonSchema } from "ai";
async function probePoolModel(model, signal, timeoutMs = 2e4, onError) {
  const result = { text: "failed", tools: "failed" };
  const call = async (withTool) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const abortSignal = AbortSignal.any([signal, timeout]);
    const response = streamText({
      model,
      abortSignal,
      maxRetries: 0,
      maxOutputTokens: 256,
      prompt: withTool ? 'Call relay_pool_probe with value "ok". Do not perform any other action.' : "Reply with exactly OK.",
      ...withTool ? { toolChoice: { type: "tool", toolName: "relay_pool_probe" }, tools: {
        relay_pool_probe: tool({
          description: "Harmless enrollment capability probe; it is never executed.",
          inputSchema: jsonSchema({ type: "object", properties: { value: { type: "string", enum: ["ok"] } }, required: ["value"], additionalProperties: false })
        })
      } } : {},
      onError: () => {
      }
    });
    for (const promise of [response.text, response.toolCalls, response.finishReason, response.usage, response.response]) Promise.resolve(promise).catch(() => {
    });
    let text = "";
    let validTool = false;
    let finish = "";
    for await (const part of response.stream) {
      if (part.type === "error") throw part.error;
      if (part.type === "text-delta") text += part.text;
      if (part.type === "tool-call") validTool = part.toolName === "relay_pool_probe" && part.input?.value === "ok";
      if (part.type === "finish") finish = part.finishReason;
    }
    if (finish === "length") return "truncated";
    return withTool ? validTool && finish === "tool-calls" : text.trim() === "OK" && finish === "stop";
  };
  try {
    const text = await call(false);
    if (text !== true) return { ...result, failure: text === "truncated" ? "truncated" : "invalid-output" };
    result.text = "passed";
    const tools = await call(true);
    if (tools !== true) return { ...result, failure: tools === "truncated" ? "truncated" : "invalid-output" };
    result.tools = "passed";
    return result;
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    onError?.(error);
    return { ...result, failure: error?.name === "TimeoutError" ? "timeout" : "provider" };
  }
}
async function probePoolEffort(model, providerOptions, signal, timeoutMs = 2e4, onError) {
  try {
    const abortSignal = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
    const response = streamText({
      model,
      abortSignal,
      maxRetries: 0,
      maxOutputTokens: 32,
      prompt: "Reply with exactly OK.",
      providerOptions,
      onError: () => {
      }
    });
    for (const promise of [response.text, response.toolCalls, response.finishReason, response.usage, response.response]) {
      Promise.resolve(promise).catch(() => {
      });
    }
    let text = "";
    let finish = "";
    for await (const part of response.stream) {
      if (part.type === "error") {
        onError?.(part.error);
        return false;
      }
      if (part.type === "text-delta") text += part.text;
      if (part.type === "finish") finish = part.finishReason;
    }
    return finish === "stop" && text.trim().length > 0;
  } catch (error) {
    onError?.(error);
    return false;
  }
}

export {
  verifyPoolMember,
  probePoolModel,
  probePoolEffort
};
//# sourceMappingURL=chunk-PHD4X47E.js.map