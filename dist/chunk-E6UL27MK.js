#!/usr/bin/env node
import {
  getAgentProviderModels,
  getProviderModels,
  loadModelsDevCache,
  resolveModelsDevSlug,
  shouldHideModel
} from "./chunk-S3QYWK2P.js";
import {
  classifyModelFormat,
  contextWindowFromHeuristics,
  resolveContextWindow
} from "./chunk-QYL2HTTP.js";
import {
  getTemplateById,
  init_provider_templates
} from "./chunk-6DCEGHZH.js";

// src/registry/google-model-id.ts
var GOOGLE_MODEL_PREFIX = "models/";
function stripGoogleModelPrefix(id) {
  return id.startsWith(GOOGLE_MODEL_PREFIX) ? id.slice(GOOGLE_MODEL_PREFIX.length) : id;
}
function normalizeGoogleModelId(rawId, npm) {
  if (npm !== "@ai-sdk/google") {
    return { id: rawId, upstreamModelId: rawId };
  }
  const bare = stripGoogleModelPrefix(rawId);
  return { id: bare, upstreamModelId: bare };
}
function normalizeGoogleDisplayName(rawName, bareId) {
  const trimmed = rawName?.trim();
  if (!trimmed) return bareId;
  return stripGoogleModelPrefix(trimmed);
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
function readModelsFromModelsDev(backendId, cache = loadModelsDevCache()) {
  const providerKey = resolveModelsDevSlug(backendId);
  const providerData = cache[providerKey];
  if (!providerData?.models) return null;
  const result = /* @__PURE__ */ new Map();
  for (const [modelKey, entry] of Object.entries(providerData.models)) {
    const id = entry.id ?? modelKey;
    if (entry.status === "deprecated") continue;
    const isFree = entry.cost !== void 0 && entry.cost.input === 0 && entry.cost.output === 0;
    const modelFormat = classifyModelFormat(id, entry.provider?.npm);
    result.set(id, {
      id,
      name: entry.name ?? id,
      isFree,
      brand: deriveBrand(entry.family ?? id),
      sourceBackend: backendId,
      modelFormat,
      cost: entry.cost,
      contextWindow: entry.limit?.context ?? contextWindowFromHeuristics(id),
      reasoning: entry.reasoning,
      interleavedReasoningField: entry.interleaved?.field
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
  const uniqueIds = Array.from(new Set(apiIds));
  return uniqueIds.filter((id) => !shouldHideModel({ providerId: backendId, modelId: id, agent: "claude" })).map((id) => {
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
      contextWindow: contextWindowFromHeuristics(id)
    };
  });
}
async function getModels(backend, fallbackModels) {
  const cache = readModelsFromModelsDev(backend.id);
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

// src/registry/refresh-credentials.ts
var PLACEHOLDER_KEYS = /* @__PURE__ */ new Set([
  "anything",
  "local",
  "ollama",
  "none",
  "n/a",
  "na",
  "placeholder",
  "test",
  "no-key"
]);
var ENV_FALLBACK_BY_PROVIDER = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"]
};
function isPlaceholderProviderKey(key) {
  if (!key?.trim()) return true;
  return PLACEHOLDER_KEYS.has(key.trim().toLowerCase());
}
function isLikelyPlaceholderKey(key) {
  if (isPlaceholderProviderKey(key)) return true;
  const trimmed = key?.trim() ?? "";
  if (trimmed.length <= 2) return true;
  return false;
}
function cachedModelCount(provider) {
  return getProviderModels(provider).length;
}
function skipWithCachedModels(provider, reason) {
  const count = getAgentProviderModels(provider).length;
  return {
    id: provider.id,
    name: provider.name,
    ok: true,
    skipped: true,
    modelCount: count > 0 ? count : void 0,
    reason
  };
}
async function resolveRefreshCredential(provider, resolveKey) {
  let key;
  try {
    key = await resolveKey(provider);
  } catch {
    key = null;
  }
  if (!isLikelyPlaceholderKey(key)) return key;
  for (const envVar of ENV_FALLBACK_BY_PROVIDER[provider.id] ?? []) {
    const fromEnv = process.env[envVar]?.trim();
    if (fromEnv && !isLikelyPlaceholderKey(fromEnv)) return fromEnv;
  }
  return key;
}

// src/registry/resolve-template.ts
init_provider_templates();
var TEMPLATE_ID_ALIASES = {
  "google-vertex": "vertex"
};
var NPM_DEFAULT_BASE_URL = {
  "@ai-sdk/anthropic": "https://api.anthropic.com"
};
function resolveProviderTemplate(provider) {
  const candidates = [
    TEMPLATE_ID_ALIASES[provider.templateId],
    provider.templateId,
    TEMPLATE_ID_ALIASES[provider.id],
    provider.id
  ].filter(Boolean);
  for (const id of candidates) {
    const template = getTemplateById(id);
    if (template) return template;
  }
  return void 0;
}
function effectiveProviderBaseUrl(provider, template) {
  const fromRegistry = provider.api.url?.trim();
  if (fromRegistry) return fromRegistry;
  if (template?.defaultBaseUrl?.trim()) return template.defaultBaseUrl.trim();
  const npm = provider.api.npm?.trim();
  if (npm && NPM_DEFAULT_BASE_URL[npm]) return NPM_DEFAULT_BASE_URL[npm];
  return void 0;
}
function syntheticTemplate(provider, baseUrl) {
  const npm = provider.api.npm ?? "@ai-sdk/openai-compatible";
  return {
    id: provider.id,
    name: provider.name,
    authType: "api",
    npm,
    defaultBaseUrl: baseUrl,
    modelSource: "api-list",
    supported: true
  };
}

// src/registry/copilot-models.ts
var FREE_MODEL_IDS = /* @__PURE__ */ new Set([
  "gpt-4.1",
  "gpt-4o",
  "gpt-4o-mini",
  "raptor-mini",
  "goldeneye"
]);
var FREE_CHAT_BLOCKLIST = /* @__PURE__ */ new Set(["gpt-5-mini"]);
function copilotPlanTier(providerData) {
  const copilot = providerData?.["copilot"];
  if (!copilot || typeof copilot !== "object" || Array.isArray(copilot)) return "unknown";
  const summary = copilot;
  if (summary["lookup_status"] === "unknown") return "unknown";
  if (summary["is_free_plan"] === true) return "free";
  if (summary["is_free_plan"] === false) return "paid";
  return "unknown";
}
function normalizeCopilotModels(rows, tier) {
  const models = [];
  for (const value of rows) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const row = value;
    const id = typeof row["id"] === "string" ? row["id"].trim() : "";
    if (!id || !copilotModelAllowed(row, tier)) continue;
    const lowerId = id.toLowerCase();
    const isFree = tier !== "paid" || copilotModelIsIncluded(row);
    const family = lowerId.split(/[-/:]/)[0] ?? lowerId;
    const contextWindow = numericValue(row["context_length"]) ?? numericValue(row["contextWindow"]) ?? numericValue(row["context_window"]) ?? resolveContextWindow(id);
    models.push({
      id,
      name: `${id} [Copilot]`,
      upstreamModelId: id,
      family,
      brand: deriveBrand(family),
      contextWindow,
      isFree,
      freeStatus: isFree ? "verified_free" : "unknown",
      modelFormat: "openai",
      npm: "@ai-sdk/openai-compatible",
      apiUrl: "https://api.githubcopilot.com"
    });
  }
  return models;
}
function filterCachedCopilotModels(models, tier) {
  return models.flatMap((model) => {
    const id = model.id.toLowerCase();
    if (!copilotIdIsCallable(id)) return [];
    if (tier !== "paid" && (!FREE_MODEL_IDS.has(id) || FREE_CHAT_BLOCKLIST.has(id))) return [];
    if (tier === "paid") return [model];
    return [{ ...model, isFree: true, freeStatus: "verified_free" }];
  });
}
function copilotModelAllowed(row, tier) {
  const id = String(row["id"] ?? "").toLowerCase();
  if (!copilotIdIsCallable(id)) return false;
  if (row["model_picker_enabled"] === false) return false;
  const policy = row["policy"];
  if (policy && typeof policy === "object" && !Array.isArray(policy)) {
    if (String(policy["state"] ?? "").toLowerCase() === "disabled") return false;
  }
  const capabilities = row["capabilities"];
  if (capabilities && typeof capabilities === "object" && !Array.isArray(capabilities)) {
    const family = String(capabilities["family"] ?? "").toLowerCase();
    if (family.includes("embedding")) return false;
  }
  const endpoints = row["supported_endpoints"];
  if (Array.isArray(endpoints) && endpoints.length > 0) {
    const supportsChat = endpoints.some((endpoint) => {
      const normalized = String(endpoint).toLowerCase().replace(/\/$/, "");
      return normalized.endsWith("/chat/completions") || normalized === "chat/completions";
    });
    if (!supportsChat) return false;
  }
  if (tier !== "paid" && (!FREE_MODEL_IDS.has(id) || FREE_CHAT_BLOCKLIST.has(id))) return false;
  return true;
}
function copilotIdIsCallable(id) {
  return id !== "auto" && !id.endsWith("-auto") && !id.includes("embedding");
}
function copilotModelIsIncluded(row) {
  const id = String(row["id"] ?? "").toLowerCase();
  if (FREE_CHAT_BLOCKLIST.has(id) || !copilotIdIsCallable(id)) return false;
  const billing = row["billing"];
  if (billing && typeof billing === "object" && !Array.isArray(billing)) {
    const multiplier = numericValue(billing["multiplier"]);
    if (multiplier !== void 0) return multiplier === 0;
  }
  return FREE_MODEL_IDS.has(id);
}
function numericValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return void 0;
}

export {
  stripGoogleModelPrefix,
  normalizeGoogleModelId,
  normalizeGoogleDisplayName,
  deriveBrand,
  getModels,
  isLikelyPlaceholderKey,
  cachedModelCount,
  skipWithCachedModels,
  resolveRefreshCredential,
  resolveProviderTemplate,
  effectiveProviderBaseUrl,
  syntheticTemplate,
  copilotPlanTier,
  normalizeCopilotModels,
  filterCachedCopilotModels
};
//# sourceMappingURL=chunk-E6UL27MK.js.map