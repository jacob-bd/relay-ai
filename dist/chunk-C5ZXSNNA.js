#!/usr/bin/env node
import {
  contextWindowError,
  createLanguageModel,
  getProviderModels,
  loadRegistry,
  modelIdError,
  resolveProviderCredential,
  saveRegistry,
  supportsManualModels,
  translateRequest,
  validateCustomEndpointUrl
} from "./chunk-KP67Q2B7.js";

// src/registry/validate-manual-model.ts
import { randomUUID } from "crypto";
import { streamText } from "ai";
async function completeStream(model, params, signal) {
  const { subagentRouting: _routing, ...call } = params;
  const result = streamText({ model, ...call, maxRetries: 0, abortSignal: signal, onError: () => {
  } });
  const output = Promise.all([result.text, result.toolCalls, result.finishReason, result.responseMessages]);
  output.catch(() => {
  });
  let error;
  let finished = false;
  for await (const part of result.stream) {
    if (part.type === "error" && error === void 0) error = part.error;
    if (part.type === "finish") finished = true;
  }
  if (error !== void 0) throw error;
  signal.throwIfAborted();
  if (!finished) throw new Error("Validation stream ended before completion. Try again.");
  const [text, calls, finishReason, messages] = await output;
  if (!["stop", "tool-calls"].includes(finishReason)) {
    throw new Error(`Validation did not complete (finish reason: ${finishReason}). Model was not added.`);
  }
  return { text, calls, messages };
}
async function validateManualModel(provider, modelId, apiKey) {
  const npm = provider.api.npm;
  const model = await createLanguageModel({
    npm,
    modelId,
    apiKey,
    providerId: provider.id,
    authType: provider.authType,
    baseURL: provider.api.url,
    headers: provider.api.headers
  });
  const signal = AbortSignal.timeout(9e4);
  const params = (messages, tools = false) => {
    const translated = translateRequest({
      model: modelId,
      max_tokens: 1024,
      messages: [{ role: "user", content: "Validation" }],
      ...tools ? { tools: [{
        name: "relay_validation",
        description: "Echo a validation value. No external actions.",
        input_schema: { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false }
      }], tool_choice: { type: "auto" } } : {}
    }, npm, { reasoningMetadata: { providerId: provider.id, apiBaseUrl: provider.api.url, upstreamModelId: modelId } });
    return { ...translated, messages };
  };
  const generated = await completeStream(model, params([{ role: "user", content: "Reply with exactly RELAY_OK." }]), signal);
  if (!generated.text.trim()) throw new Error("The model returned no text. Model was not added.");
  const nonce = randomUUID();
  const toolPrompt = [{ role: "user", content: `Call relay_validation once with value "${nonce}". Do not answer in text yet.` }];
  const toolResult = await completeStream(model, params(toolPrompt, true), signal);
  const call = toolResult.calls[0];
  if (toolResult.calls.length !== 1 || call.toolName !== "relay_validation" || !call.input || typeof call.input !== "object" || call.input.value !== nonce || Object.keys(call.input).length !== 1) {
    throw new Error("The model did not return the expected tool call and valid arguments. Model was not added.");
  }
  const receipt = `RELAY_RESULT_${randomUUID()}`;
  const continuation = [
    ...toolPrompt,
    ...toolResult.messages,
    { role: "tool", content: [{ type: "tool-result", toolCallId: call.toolCallId, toolName: call.toolName, output: { type: "text", value: receipt } }] },
    { role: "user", content: "Reply with the exact value returned by the tool. Do not call another tool." }
  ];
  const roundTrip = await completeStream(model, params(continuation, true), signal);
  if (!roundTrip.text.includes(receipt) || roundTrip.calls.length) {
    throw new Error("The model could not complete the tool-result round-trip. Model was not added.");
  }
}

// src/registry/manual-models.ts
function fingerprint(provider) {
  return JSON.stringify([provider.enabled, provider.authRef, provider.authType, provider.api]);
}
async function addManualModel(input) {
  if (!input || typeof input !== "object" || typeof input.providerId !== "string") return { ok: false, error: "Provider ID is required." };
  const invalid = modelIdError(input.modelId) ?? contextWindowError(input.contextWindow);
  if (invalid) return { ok: false, error: invalid };
  if (input.displayName !== void 0 && (typeof input.displayName !== "string" || input.displayName.length > 200 || /[\u0000-\u001f\u007f]/u.test(input.displayName))) {
    return { ok: false, error: "Display name must be at most 200 characters without control characters." };
  }
  const id = input.modelId.trim();
  const registry = loadRegistry();
  const provider = registry.providers.find((p) => p.id === input.providerId);
  if (!provider || !provider.enabled) return { ok: false, error: "Provider not found or disabled." };
  if (!supportsManualModels(provider)) return { ok: false, error: "Manual models are supported for API-key OpenAI-compatible, Anthropic, OpenAI and OpenRouter providers." };
  if (getProviderModels(provider).some((m) => m.id === id)) return { ok: false, error: "This model ID is already in the provider catalog." };
  let key = "";
  try {
    if (provider.api.url) {
      const checked = await validateCustomEndpointUrl(provider.api.url, { allowInsecureLocal: true });
      if (!checked.ok) return { ok: false, error: checked.error ?? "Invalid provider URL." };
    }
    key = await resolveProviderCredential(provider.id, provider.authRef) ?? "";
    if (!key && provider.authType !== "none") return { ok: false, error: "No stored API key. Configure this provider before adding a model." };
    const before = fingerprint(provider);
    await validateManualModel(provider, id, key);
    if ((await resolveProviderCredential(provider.id, provider.authRef) ?? "") !== key) {
      return { ok: false, error: "Provider credential changed during validation. Test again." };
    }
    const latest = loadRegistry();
    const current = latest.providers.find((p) => p.id === provider.id);
    if (!current || fingerprint(current) !== before) return { ok: false, error: "Provider settings changed during validation. Test again." };
    if (getProviderModels(current).some((m) => m.id === id)) return { ok: false, error: "This model was added while validation was running." };
    const model = {
      id,
      name: input.displayName?.trim() || id,
      upstreamModelId: id,
      modelFormat: provider.api.npm === "@ai-sdk/anthropic" ? "anthropic" : "openai",
      source: "manual",
      validatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      ...input.contextWindow === void 0 ? {} : { contextWindow: input.contextWindow, contextWindowSource: "user" }
    };
    current.manualModels = [...current.manualModels ?? [], model];
    saveRegistry(latest);
    return { ok: true, model };
  } catch (error) {
    let message = error instanceof Error ? error.message : String(error);
    for (const secret of [key, ...Object.values(provider.api.headers ?? {})].filter(Boolean)) message = message.split(secret).join("[REDACTED]");
    return { ok: false, error: message.slice(0, 1500) };
  }
}
function removeManualModel(providerId, modelId) {
  const registry = loadRegistry();
  const provider = registry.providers.find((p) => p.id === providerId);
  if (!provider?.manualModels?.some((m) => m.id === modelId)) return { ok: false, error: "Manual model not found." };
  provider.manualModels = provider.manualModels.filter((m) => m.id !== modelId);
  saveRegistry(registry);
  return { ok: true };
}

export {
  addManualModel,
  removeManualModel
};
//# sourceMappingURL=chunk-C5ZXSNNA.js.map