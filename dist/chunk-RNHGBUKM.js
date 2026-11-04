#!/usr/bin/env node
import {
  BACKENDS,
  CLINE_PASS_LEGACY_DEFAULT_CONTEXT_WINDOW,
  buildPricingIndex,
  classifyFreeStatus,
  classifyModelFormat,
  contextWindowFromHeuristics,
  enrichModelsForProviderPricing,
  findModelsDevModel,
  forceRefreshProviderCredential,
  getAgentProviderModels,
  getProviderModels,
  isFreeStatus,
  isOpencodeApi,
  isOpencodeOAuth,
  isValidProviderId,
  loadModelsDevCache,
  loadPricingCache,
  providerKind,
  resolveContextWindow,
  resolveModelReasoningMetadata,
  resolveModelsDevSlug,
  shouldHideModel
} from "./chunk-IBAUEWWV.js";
import {
  getTemplateById,
  init_provider_templates
} from "./chunk-RKRPDZVV.js";

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

// src/providers.ts
function resolveEndpoint(npm, apiUrl) {
  if (!npm) return null;
  if (npm === "@ai-sdk/anthropic") {
    return {
      format: "anthropic",
      baseUrl: (apiUrl || "https://api.anthropic.com").replace(/\/v1\/?$/, "")
    };
  }
  if (npm === "@ai-sdk/openai-compatible") {
    if (!apiUrl) return null;
    return {
      format: "openai",
      completionsUrl: apiUrl.replace(/\/$/, "") + "/chat/completions"
    };
  }
  return { format: "openai" };
}
function normalizeProviders(raw, opts) {
  const agent = opts?.agent ?? "claude";
  const result = [];
  for (const provider of raw) {
    const hasKey = !!provider.key?.trim();
    if (!hasKey && !opts?.includeOAuthPlaceholders) continue;
    const models = [];
    for (const model of Object.values(provider.models ?? {})) {
      if (shouldHideModel({ providerId: provider.id, modelId: model.id, agent })) continue;
      const endpoint = resolveEndpoint(model.api?.npm ?? "", model.api?.url ?? "");
      if (endpoint === null) continue;
      models.push({
        id: model.id,
        name: model.name ?? model.id,
        family: model.family ?? "",
        brand: deriveBrand(model.family ?? ""),
        modelFormat: endpoint.format,
        upstreamModelId: model.api?.id ?? model.id,
        baseUrl: endpoint.baseUrl,
        completionsUrl: endpoint.completionsUrl,
        npm: model.api?.npm,
        apiBaseUrl: model.api?.url,
        cost: model.cost,
        contextWindow: resolveContextWindow(model.id, model.limit?.context),
        supportedParameters: model.supportedParameters ?? model.supported_parameters,
        reasoning: model.reasoning,
        interleavedReasoningField: model.interleaved?.field
      });
    }
    if (models.length === 0) continue;
    result.push({
      id: provider.id,
      name: provider.name,
      apiKey: provider.key?.trim() ?? "",
      models
    });
  }
  return result;
}

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

// src/registry/materialize.ts
init_provider_templates();

// src/registry/model-protocol.ts
function reconcileCachedModelProtocol(model, provider, metadata = loadModelsDevCache()) {
  if (model.source === "manual") return model;
  const kind = providerKind(provider.id);
  const isZenGo = kind === "zen" || kind === "go" || provider.templateId === "zen" || provider.templateId === "go";
  if (!isZenGo) return model;
  const metadataNpm = findModelsDevModel(provider.id, model.id, metadata)?.provider?.npm;
  if (!metadataNpm) return model;
  const format = classifyModelFormat(model.id, metadataNpm);
  if (format === "unsupported") return model;
  const backendId = kind === "go" || provider.templateId === "go" ? "go" : "zen";
  const apiUrl = model.apiUrl ?? provider.api.url ?? BACKENDS[backendId].baseUrl;
  return {
    ...model,
    modelFormat: format,
    npm: metadataNpm,
    apiUrl
  };
}

// src/registry/materialize.ts
function cachedModelToLocal(cached, provider, metadata = loadModelsDevCache(), agent = "claude") {
  const reconciled = reconcileCachedModelProtocol(cached, provider, metadata);
  cached = reconciled;
  const freeStatus = classifyFreeStatus({
    model: cached,
    providerId: provider.id,
    templateId: provider.templateId
  });
  if (cached.modelFormat === "cloud-code") {
    const { id: id2 } = normalizeGoogleModelId(cached.id, "");
    return {
      id: id2,
      name: cached.name,
      family: cached.family ?? "",
      brand: cached.brand ?? deriveBrand(cached.family ?? ""),
      modelFormat: "cloud-code",
      upstreamModelId: cached.upstreamModelId ?? cached.id,
      contextWindow: cached.contextWindow ?? resolveContextWindow(id2),
      isFree: isFreeStatus(freeStatus),
      freeStatus,
      reasoning: cached.reasoning,
      interleavedReasoningField: cached.interleavedReasoningField
    };
  }
  const modelsDev = findModelsDevModel(provider.id, cached.id, metadata);
  const kind = providerKind(provider.id);
  const isZenGo = kind === "zen" || kind === "go" || provider.templateId === "zen" || provider.templateId === "go";
  const metadataNpm = !cached.source && isZenGo ? modelsDev?.provider?.npm : void 0;
  const preferAnthropic = kind === "a2agent" && agent === "claude";
  const npm = preferAnthropic ? "@ai-sdk/anthropic" : cached.npm ?? provider.api.npm ?? "";
  const apiUrl = cached.apiUrl ?? provider.api.url ?? (isZenGo ? BACKENDS[kind === "go" || provider.templateId === "go" ? "go" : "zen"].baseUrl : "");
  const endpoint = resolveEndpoint(npm, apiUrl);
  if (endpoint === null) return null;
  const { id, upstreamModelId } = normalizeGoogleModelId(cached.id, npm);
  const normalizedUpstream = normalizeGoogleModelId(cached.upstreamModelId ?? cached.id, npm).upstreamModelId;
  const family = npm === "@ai-sdk/google" ? id.split(/[-/:]/)[0] ?? id : cached.family ?? "";
  const classifiedFormat = classifyModelFormat(cached.id, npm);
  const resolvedFormat = classifiedFormat === "anthropic" ? classifiedFormat : "openai";
  return {
    id,
    name: npm === "@ai-sdk/google" ? normalizeGoogleDisplayName(cached.name, id) : cached.name,
    family,
    brand: npm === "@ai-sdk/google" ? deriveBrand(family) : cached.brand ?? deriveBrand(cached.family ?? ""),
    modelFormat: preferAnthropic ? "anthropic" : metadataNpm ? resolvedFormat : cached.modelFormat ?? endpoint.format,
    upstreamModelId: normalizedUpstream,
    baseUrl: endpoint.baseUrl,
    completionsUrl: endpoint.completionsUrl,
    npm: npm || void 0,
    apiBaseUrl: apiUrl || void 0,
    cost: cached.cost,
    referencePrice: cached.referencePrice,
    isFree: isFreeStatus(freeStatus),
    freeStatus,
    // ClinePass's public catalog does not currently report per-model context
    // limits. Preserve that unknown state for the picker instead of displaying
    // a heuristic as if it were provider metadata. Launch-time callers still
    // resolve their required safety fallback when they build the child env or
    // proxy catalog.
    contextWindow: cached.source === "manual" ? cached.contextWindow : kind === "cline-pass" && cached.contextWindow === CLINE_PASS_LEGACY_DEFAULT_CONTEXT_WINDOW && cached.contextWindowSource === void 0 ? void 0 : cached.contextWindow ?? (kind === "cline-pass" ? void 0 : resolveContextWindow(id)),
    // Custom endpoints: a size that was not reported, typed or measured is a guess (the UI's "estimate").
    ...(provider.templateId === "custom-openai" || provider.templateId === "custom-anthropic") && (cached.contextWindowSource === void 0 || cached.contextWindowSource === "models.dev") ? { contextWindowEstimated: true } : {},
    supportedParameters: cached.supportedParameters,
    ...resolveModelReasoningMetadata(
      provider.id,
      cached.id,
      {
        // ChatGPT-login models that aren't in the seed list were saved with a name-based
        // reasoning guess; models.dev (OpenAI's own entry) is the better source.
        reasoning: kind === "openai-oauth" ? findModelsDevModel(provider.id, cached.id, metadata)?.reasoning ?? cached.reasoning : cached.reasoning,
        interleavedField: cached.interleavedReasoningField
      },
      metadata
    ),
    useResponsesLite: cached.useResponsesLite,
    preferWebSockets: cached.preferWebSockets
  };
}
function providerAllowsAnonymousFreeModels(provider) {
  const template = getTemplateById(provider.templateId) ?? getTemplateById(provider.id);
  return template?.anonymousFreeModels === true;
}
function materializeOne(provider, resolveCredential, agent, pricingIndex, metadata, includeHidden = false) {
  if (!provider.enabled) return null;
  if (!isValidProviderId(provider.id)) return null;
  const freeOnly = provider.subscriptionFilter === "free";
  const apiKey = resolveCredential(provider) ?? "";
  const anonymousFreeOnly = !apiKey.trim() && providerAllowsAnonymousFreeModels(provider);
  const models = [];
  const hiddenIds = new Set(provider.hiddenModelIds ?? []);
  for (const cached of enrichModelsForProviderPricing(getProviderModels(provider), pricingIndex, provider.templateId, provider.id, metadata)) {
    const freeStatus = classifyFreeStatus({
      model: cached,
      providerId: provider.id,
      templateId: provider.templateId
    });
    if ((freeOnly || anonymousFreeOnly) && !isFreeStatus(freeStatus)) continue;
    const userHidden = hiddenIds.has(cached.id);
    if (userHidden && !includeHidden) continue;
    const model = cachedModelToLocal(cached, provider, metadata, agent);
    if (!model) continue;
    if (shouldHideModel({ providerId: provider.id, modelId: model.id, agent })) continue;
    models.push(userHidden ? { ...model, hidden: true } : model);
  }
  if (models.length === 0) return null;
  if (!apiKey.trim() && !anonymousFreeOnly) return null;
  return {
    id: provider.id,
    name: provider.name,
    ...provider.nameCustomized ? { nameCustomized: true } : {},
    apiKey,
    authRef: provider.authRef,
    authType: provider.authType,
    headers: provider.api.headers,
    models
  };
}
function materializeRegistry(registry, resolveCredential, opts) {
  const agent = opts?.agent ?? "claude";
  const pricingIndex = buildPricingIndex(loadPricingCache());
  const metadata = loadModelsDevCache();
  const result = [];
  for (const provider of registry.providers) {
    const local = materializeOne(provider, resolveCredential, agent, pricingIndex, metadata, opts?.includeHidden === true);
    if (local) result.push(local);
  }
  return result;
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

// src/registry/import-build.ts
function oauthAuthRef(providerId) {
  return `keyring:oauth:provider:${providerId}`;
}
function toOAuthRegistryId(id) {
  if (id === "openai") return "openai-oauth";
  if (id === "xai") return "xai-oauth";
  return id;
}
function normalizeImportProviderIdentity(provider) {
  if (provider.id === "opencode") {
    return { ...provider, id: "zen", name: "OpenCode Zen" };
  }
  if (provider.id === "opencode-go") {
    return { ...provider, id: "go", name: "OpenCode Go" };
  }
  return provider;
}
function buildImportProviderList(raw, authEntries) {
  const oauthByProviderId = /* @__PURE__ */ new Map();
  const covered = /* @__PURE__ */ new Set();
  const merged = [];
  const rawWithLegacyKeys = raw.map((provider) => {
    const authEntry = authEntries[provider.id];
    if (provider.key?.trim() || !isOpencodeApi(authEntry)) return provider;
    return { ...provider, key: authEntry.key };
  });
  for (const provider of normalizeProviders(rawWithLegacyKeys)) {
    const normalized = normalizeImportProviderIdentity(provider);
    if (covered.has(normalized.id)) continue;
    merged.push(normalized);
    covered.add(normalized.id);
  }
  for (const provider of raw) {
    if (provider.id === "opencode" || provider.id === "opencode-go") continue;
    if (covered.has(provider.id)) continue;
    const authEntry = authEntries[provider.id];
    if (!isOpencodeOAuth(authEntry)) continue;
    const oauthProviders = normalizeProviders(
      [{ ...provider, key: authEntry.access }],
      { includeOAuthPlaceholders: true }
    );
    if (oauthProviders.length === 0) continue;
    const registryId = toOAuthRegistryId(provider.id);
    oauthByProviderId.set(registryId, authEntry);
    merged.push({ ...oauthProviders[0], id: registryId, apiKey: "" });
    covered.add(registryId);
    covered.add(provider.id);
  }
  return { providers: merged, oauth: { oauthByProviderId } };
}
function isOAuthImportProvider(providerId, oauth) {
  return oauth.oauthByProviderId.has(providerId);
}
var OPENCODE_OAUTH_PROVIDER_IDS = /* @__PURE__ */ new Set([
  "xai",
  "openai",
  "github",
  "gitlab",
  "kimi",
  "moonshot"
]);
var OPENCODE_MANUAL_ONLY_IDS = /* @__PURE__ */ new Set([
  "google-vertex",
  "vertex",
  "bedrock",
  "azure"
]);
function classifyOpencodeCredentialGap(providerId) {
  if (OPENCODE_MANUAL_ONLY_IDS.has(providerId)) return "manual-only";
  if (OPENCODE_OAUTH_PROVIDER_IDS.has(providerId)) return "oauth-no-token";
  return "no-api-key";
}
function listCredentialSkippedProviders(raw, authEntries, importedIds, alreadyReportedIds = /* @__PURE__ */ new Set(), registryProviderIds = /* @__PURE__ */ new Set()) {
  const skipped = [];
  for (const provider of raw) {
    if (provider.id === "opencode" || provider.id === "opencode-go") continue;
    if (importedIds.has(provider.id)) continue;
    if (alreadyReportedIds.has(provider.id)) continue;
    const hasApiKey = !!provider.key?.trim() && !isLikelyPlaceholderKey(provider.key);
    if (hasApiKey) continue;
    if (isOpencodeOAuth(authEntries[provider.id])) continue;
    if (!provider.models || Object.keys(provider.models).length === 0) continue;
    const reason = classifyOpencodeCredentialGap(provider.id);
    if (reason !== "oauth-no-token" && !provider.configured && !registryProviderIds.has(provider.id)) continue;
    skipped.push({ id: provider.id, name: provider.name, reason });
  }
  return skipped;
}

// src/provider-runtime.ts
function providerRefreshToken(providerId, authType, authRef) {
  if (authType !== "oauth" || !providerId) return void 0;
  return () => forceRefreshProviderCredential(providerId, authRef ?? oauthAuthRef(providerId));
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
  oauthAuthRef,
  toOAuthRegistryId,
  buildImportProviderList,
  isOAuthImportProvider,
  listCredentialSkippedProviders,
  reconcileCachedModelProtocol,
  cachedModelToLocal,
  materializeRegistry,
  copilotPlanTier,
  normalizeCopilotModels,
  filterCachedCopilotModels,
  providerRefreshToken
};
//# sourceMappingURL=chunk-RNHGBUKM.js.map