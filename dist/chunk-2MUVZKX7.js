#!/usr/bin/env node
import {
  BACKENDS,
  VERSION,
  classifyModelFormat,
  contextWindowFromHeuristics,
  findModelsDevModel,
  forceRefreshProviderCredential,
  getAgentProviderModels,
  getProviderModels,
  isOpencodeApi,
  isOpencodeOAuth,
  isProviderKind,
  loadModelsDevCache,
  providerKind,
  resolveContextWindow,
  resolveModelsDevSlug,
  shouldHideModel
} from "./chunk-O5RS74BQ.js";
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

// src/opencode-session.ts
import { randomUUID } from "crypto";
var OPENCODE_SESSION_HEADER = "x-opencode-session";
var MAX_OPENCODE_SESSION_LENGTH = 256;
var RELAY_USER_AGENT = `relay-ai/${VERSION}`;
var NATIVE_CONVERSATION_HEADERS = [
  "x-claude-code-session-id",
  "session_id",
  "session-id",
  "x-session-id",
  "thread_id",
  "thread-id",
  "x-thread-id",
  "conversation_id",
  "conversation-id",
  "x-conversation-id"
];
function sanitizeSessionId(value) {
  if (typeof value !== "string") return void 0;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_OPENCODE_SESSION_LENGTH) return void 0;
  if (/[\u0000-\u001f\u007f\r\n]/.test(normalized)) return void 0;
  return normalized;
}
function headerValue(headers, name) {
  if (!headers) return void 0;
  if (headers instanceof Headers) {
    return sanitizeSessionId(headers.get(name));
  }
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== lowerName) continue;
    const first = Array.isArray(value) ? value[0] : value;
    return sanitizeSessionId(first);
  }
  return void 0;
}
function metadataSessionId(body) {
  if (!body || typeof body !== "object") return void 0;
  const record = body;
  const metadata = record.metadata;
  if (metadata && typeof metadata === "object") {
    const metadataRecord = metadata;
    const direct = sanitizeSessionId(metadataRecord.session_id ?? metadataRecord.sessionId);
    if (direct) return direct;
    const userId = metadataRecord.user_id;
    if (typeof userId === "string") {
      try {
        const parsed = JSON.parse(userId);
        const parsedId = sanitizeSessionId(parsed.session_id ?? parsed.sessionId);
        if (parsedId) return parsedId;
      } catch {
      }
    }
  }
  const clientMetadata = record.client_metadata;
  if (clientMetadata && typeof clientMetadata === "object") {
    const client = clientMetadata;
    const id = sanitizeSessionId(client.session_id ?? client.sessionId ?? client.thread_id ?? client.threadId);
    if (id) return id;
  }
  return sanitizeSessionId(record.session_id ?? record.sessionId ?? record.thread_id ?? record.threadId);
}
function extractConversationId(headers, body) {
  const explicit = headerValue(headers, OPENCODE_SESSION_HEADER);
  if (explicit) return explicit;
  for (const name of NATIVE_CONVERSATION_HEADERS) {
    const native = headerValue(headers, name);
    if (native) return native;
  }
  return metadataSessionId(body);
}
function isOpenCodeGoEndpoint(providerId, endpoint) {
  const id = providerId?.trim().toLowerCase();
  if (id !== void 0 && (isProviderKind(id, "go") || id === "opencode-go")) return true;
  if (!endpoint) return false;
  try {
    const url = new URL(endpoint);
    if (url.hostname.toLowerCase() !== "opencode.ai") return false;
    return url.pathname.split("/").some((segment) => segment.toLowerCase() === "go");
  } catch {
    return false;
  }
}
function mergeHeaders(base, overrides) {
  const result = {};
  for (const [key, value] of Object.entries(base ?? {})) {
    if (typeof value === "string") result[key] = value;
  }
  for (const [key, value] of Object.entries(overrides ?? {})) {
    for (const existing of Object.keys(result)) {
      if (existing.toLowerCase() === key.toLowerCase()) delete result[existing];
    }
    result[key] = value;
  }
  return result;
}
function openCodeGoHeaders(providerId, endpoint, sessionId, baseHeaders, options) {
  if (!isOpenCodeGoEndpoint(providerId, endpoint)) return void 0;
  let normalizedSessionId = sanitizeSessionId(sessionId);
  if (!normalizedSessionId && (options?.generateFallbackSession ?? true)) {
    normalizedSessionId = `relay-${randomUUID()}`;
  }
  return mergeHeaders(baseHeaders, {
    "User-Agent": RELAY_USER_AGENT,
    ...normalizedSessionId ? { [OPENCODE_SESSION_HEADER]: normalizedSessionId } : {}
  });
}

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

export {
  deriveBrand,
  getModels,
  resolveEndpoint,
  isLikelyPlaceholderKey,
  cachedModelCount,
  skipWithCachedModels,
  resolveRefreshCredential,
  oauthAuthRef,
  toOAuthRegistryId,
  buildImportProviderList,
  isOAuthImportProvider,
  listCredentialSkippedProviders,
  resolveProviderTemplate,
  effectiveProviderBaseUrl,
  syntheticTemplate,
  OPENCODE_SESSION_HEADER,
  extractConversationId,
  mergeHeaders,
  openCodeGoHeaders,
  providerRefreshToken,
  reconcileCachedModelProtocol
};
//# sourceMappingURL=chunk-2MUVZKX7.js.map