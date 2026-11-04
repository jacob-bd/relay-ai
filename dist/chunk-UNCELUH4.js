#!/usr/bin/env node
import {
  copilotPlanTier,
  filterCachedCopilotModels,
  materializeRegistry,
  oauthAuthRef,
  providerRefreshToken
} from "./chunk-4NL6K57P.js";
import {
  classifyFreeStatus,
  createLanguageModel,
  effortProviderOptions,
  getAgentProviderModels,
  loadRegistry,
  poolEndpointRevision,
  providerKind,
  resolveProviderCredential,
  resolveProviderOAuthAccountId,
  resolveProviderOAuthProviderData
} from "./chunk-W7B52E2T.js";
import {
  getTemplateById,
  init_provider_templates
} from "./chunk-RKRPDZVV.js";

// src/registry/load.ts
async function loadRegistryProviders(diag, opts) {
  const registry = loadRegistry();
  const keys = /* @__PURE__ */ new Map();
  const oauthAccountIds = /* @__PURE__ */ new Map();
  const oauthProviderData = /* @__PURE__ */ new Map();
  await Promise.all(registry.providers.map(async (provider) => {
    try {
      const key = await resolveProviderCredential(provider.id, provider.authRef, diag);
      if (key) keys.set(provider.id, key);
    } catch (err) {
      diag?.(`${provider.id}: credential unavailable \u2014 ${err instanceof Error ? err.message : String(err)}`);
    }
    if (provider.authType === "oauth") {
      try {
        const accountId = await resolveProviderOAuthAccountId(provider.authRef, diag);
        if (accountId) oauthAccountIds.set(provider.id, accountId);
        const pd = await resolveProviderOAuthProviderData(provider.authRef, diag);
        if (pd) oauthProviderData.set(provider.id, pd);
      } catch {
      }
    }
  }));
  const runtimeRegistry = {
    ...registry,
    providers: registry.providers.map((provider) => {
      if (providerKind(provider.id) !== "github-copilot" || !provider.modelsCache) return provider;
      return {
        ...provider,
        modelsCache: {
          ...provider.modelsCache,
          models: filterCachedCopilotModels(
            provider.modelsCache.models,
            copilotPlanTier(oauthProviderData.get(provider.id))
          )
        }
      };
    })
  };
  return materializeRegistry(runtimeRegistry, (provider) => keys.get(provider.id) ?? null, opts).map((provider) => ({
    ...provider,
    oauthAccountId: oauthAccountIds.get(provider.id),
    providerData: oauthProviderData.get(provider.id)
  }));
}

// src/provider-catalog.ts
init_provider_templates();
async function fetchProviderCatalog(opts) {
  return loadRegistryProviders(void 0, opts);
}
function launchModelsForProvider(provider, selectedModel) {
  return provider.launchAllModels ? provider.models : [selectedModel];
}
function providersForPicker(providers) {
  for (const p of providers) {
    p.models.sort((a, b) => {
      const nameA = a.name || a.id;
      const nameB = b.name || b.id;
      return nameA.localeCompare(nameB, void 0, { sensitivity: "base", numeric: true });
    });
  }
  return providers.sort((a, b) => a.name.localeCompare(b.name, void 0, { sensitivity: "base", numeric: true }));
}
async function resolveLocalProviderApiKey(provider) {
  const direct = provider.apiKey?.trim();
  if (direct) return direct;
  if (provider.authType === "none") return "anonymous";
  const template = getTemplateById(providerKind(provider.id));
  if (template?.apiKeyOptional || template?.anonymousFreeModels) {
    return "anonymous";
  }
  const reg = loadRegistry().providers.find((p) => p.id === provider.id);
  const authRef = reg?.authRef ?? (provider.id === "zen" || provider.id === "go" ? "keyring:global:opencode" : oauthAuthRef(provider.id));
  return resolveProviderCredential(provider.id, authRef);
}
function formatRegistryAuthLabel(provider) {
  if (provider.authType === "oauth" || provider.authRef.includes("oauth:provider:")) {
    return "keychain (OAuth)";
  }
  if (provider.authRef.startsWith("keyring:global:opencode")) {
    return "keychain (OpenCode API key)";
  }
  if (provider.authType === "none") {
    return "gcloud / manual credentials";
  }
  if (provider.authRef.startsWith("keyring:")) {
    return "keychain (API key)";
  }
  if (provider.authRef.startsWith("env:")) {
    return provider.authRef;
  }
  return provider.authRef;
}
async function resolveProvidersForDisplay() {
  const reg = loadRegistry();
  const entries = [];
  for (const provider of reg.providers) {
    entries.push({
      id: provider.id,
      name: provider.name,
      modelCount: getAgentProviderModels(provider).length,
      enabled: provider.enabled,
      authLabel: formatRegistryAuthLabel(provider),
      inRegistry: true
    });
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}
function localProvidersToServerModels(localProviders) {
  return localProviders.flatMap(
    (provider) => provider.models.map((model) => ({
      id: model.id,
      name: model.name,
      isFree: model.isFree ?? false,
      freeStatus: model.freeStatus,
      brand: model.brand,
      providerLabel: provider.name,
      providerId: provider.id,
      sourceBackend: provider.id,
      modelFormat: model.modelFormat,
      upstreamModelId: model.upstreamModelId,
      cost: model.cost,
      baseUrl: model.baseUrl,
      completionsUrl: model.completionsUrl,
      npm: model.modelFormat === "openai" ? model.npm || "@ai-sdk/openai-compatible" : model.npm,
      apiBaseUrl: model.apiBaseUrl,
      apiKey: provider.apiKey,
      authType: provider.authType,
      oauthAccountId: provider.oauthAccountId,
      contextWindow: model.contextWindow,
      supportedParameters: model.supportedParameters,
      reasoning: model.reasoning,
      interleavedReasoningField: model.interleavedReasoningField,
      reasoningEffortLevels: model.reasoningEffortLevels,
      reasoningEffortConflict: model.reasoningEffortConflict,
      useResponsesLite: model.useResponsesLite,
      preferWebSockets: model.preferWebSockets,
      headers: provider.headers,
      providerData: provider.providerData
    }))
  );
}

// src/pool/enroll.ts
var RECEIPT_TTL_MS = 24 * 60 * 60 * 1e3;
var ENROLL_MAX_OUTPUT_TOKENS = 4096;
async function verifyPoolMember(member, providers, signal, deps, now = Date.now()) {
  const provider = providers.find((item) => item.id === member.providerId);
  const model = provider?.models.find((item) => item.id === member.modelId);
  if (!provider || !model) return { member, status: "skipped", reason: "unavailable" };
  if (!model.npm || model.modelFormat === "cloud-code") return { member, status: "skipped", reason: "unsupported-transport" };
  if (model.contextWindowEstimated || !Number.isSafeInteger(model.contextWindow) || !model.contextWindow || model.contextWindow <= 0) {
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
  const call = async () => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const abortSignal = AbortSignal.any([signal, timeout]);
    const response = streamText({
      model,
      abortSignal,
      maxRetries: 0,
      maxOutputTokens: 256,
      prompt: 'Call relay_pool_probe with value "ok". Do not perform any other action.',
      toolChoice: { type: "tool", toolName: "relay_pool_probe" },
      tools: {
        relay_pool_probe: tool({
          description: "Harmless enrollment capability probe; it is never executed.",
          inputSchema: jsonSchema({ type: "object", properties: { value: { type: "string", enum: ["ok"] } }, required: ["value"], additionalProperties: false })
        })
      },
      onError: () => {
      }
    });
    for (const promise of [response.text, response.toolCalls, response.finishReason, response.usage, response.response]) Promise.resolve(promise).catch(() => {
    });
    let validTool = false;
    let finish = "";
    for await (const part of response.stream) {
      if (part.type === "error") throw part.error;
      if (part.type === "tool-call") validTool = part.toolName === "relay_pool_probe" && part.input?.value === "ok";
      if (part.type === "finish") finish = part.finishReason;
    }
    if (finish === "length") return "truncated";
    return validTool && finish === "tool-calls";
  };
  try {
    const outcome = await call();
    if (outcome !== true) return { ...result, failure: outcome === "truncated" ? "truncated" : "invalid-output" };
    result.text = "passed";
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

// src/http-utils.ts
import * as zlib from "zlib";
function decodeRequestBody(raw, encoding) {
  const enc = (Array.isArray(encoding) ? encoding.join(",") : encoding ?? "").toLowerCase().trim();
  if (!enc || enc === "identity") return raw.toString();
  switch (enc) {
    case "gzip":
    case "x-gzip":
      return zlib.gunzipSync(raw).toString();
    case "deflate":
      return zlib.inflateSync(raw).toString();
    case "br":
      return zlib.brotliDecompressSync(raw).toString();
    case "zstd":
      if (typeof zlib.zstdDecompressSync !== "function") {
        throw new Error("zstd request encoding requires Node >= 22.15");
      }
      return zlib.zstdDecompressSync(raw).toString();
    default:
      return raw.toString();
  }
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
    req.on("end", () => {
      try {
        resolve(decodeRequestBody(Buffer.concat(chunks), req.headers["content-encoding"]));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}
function extractApiKey(req) {
  const xApiKey = req.headers["x-api-key"];
  if (typeof xApiKey === "string") return xApiKey;
  const auth = req.headers["authorization"];
  if (typeof auth === "string") return auth.replace(/^Bearer\s+/i, "").trim();
  return null;
}
function sendJson(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(json);
}

// src/pool/verify.ts
function poolMembershipProblem(provider, model) {
  if (classifyFreeStatus({ model, providerId: provider.id }) !== "verified_free") return "Requires verified zero pricing";
  if (!model.npm || model.modelFormat === "cloud-code") return "Unsupported pool transport";
  return void 0;
}
function poolRoutingProblem(provider, model) {
  const membership = poolMembershipProblem(provider, model);
  if (membership) return membership;
  if (model.contextWindowEstimated) return "Set or measure the context size before Relay can route this model";
  if (!Number.isSafeInteger(model.contextWindow) || !model.contextWindow || model.contextWindow <= 0) {
    return "A verified context size is required";
  }
  return void 0;
}
function enrollmentContextProblem(model) {
  return Boolean(model.contextWindowEstimated) || !Number.isSafeInteger(model.contextWindow) || !model.contextWindow || model.contextWindow <= 0;
}
function poolDiagnostic(error) {
  const text = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const redacted = text.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]").replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{6,}/gi, "[redacted]").replace(
    /\b(?:sk|pk|rk|api[-_]?key|token|secret|authorization)[-_A-Za-z0-9]*\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{6,}/gi,
    "[redacted]"
  ).replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[redacted]").replace(/\s+/g, " ").trim();
  return redacted ? redacted.slice(0, 160) : void 0;
}
async function verifyConfiguredPoolMember(member, providers, signal, options = {}) {
  const provider = providers.find((item) => item.id === member.providerId);
  const model = provider?.models.find((item) => item.id === member.modelId);
  if (!provider || !model) return { member, status: "skipped", reason: "unavailable" };
  if (enrollmentContextProblem(model)) return { member, status: "skipped", reason: "unverified-context-window" };
  const routingProblem = poolRoutingProblem(provider, model);
  if (routingProblem) return { member, status: "skipped", reason: routingProblem };
  try {
    return await verifyPoolMember(member, providers, signal, {
      resolveKey: resolveLocalProviderApiKey,
      createModel: (provider2, model2, apiKey) => createLanguageModel({
        npm: model2.npm,
        modelId: model2.upstreamModelId,
        apiKey,
        baseURL: model2.apiBaseUrl,
        providerId: provider2.id,
        authType: provider2.authType,
        oauthAccountId: provider2.oauthAccountId,
        providerData: provider2.providerData,
        headers: provider2.headers,
        refreshToken: providerRefreshToken(provider2.id, provider2.authType, provider2.authRef)
      }),
      probe: options.evidence ? async () => options.evidence : probePoolModel,
      probeEffort: options.reasoning ? (languageModel, level) => probePoolEffort(
        languageModel,
        effortProviderOptions(model.npm, level, model.upstreamModelId, {
          ...model,
          providerId: provider.id,
          apiBaseUrl: model.apiBaseUrl
        }),
        signal
      ) : void 0
    });
  } catch (error) {
    return { member, status: "skipped", reason: "probe-failed", diagnostic: poolDiagnostic(error) };
  }
}

export {
  readBody,
  extractApiKey,
  sendJson,
  fetchProviderCatalog,
  launchModelsForProvider,
  providersForPicker,
  resolveLocalProviderApiKey,
  formatRegistryAuthLabel,
  resolveProvidersForDisplay,
  localProvidersToServerModels,
  verifyPoolMember,
  probePoolModel,
  probePoolEffort,
  poolMembershipProblem,
  poolRoutingProblem,
  poolDiagnostic,
  verifyConfiguredPoolMember
};
//# sourceMappingURL=chunk-UNCELUH4.js.map