#!/usr/bin/env node
import {
  validateCustomEndpointUrl
} from "./chunk-XWM4ELUX.js";
import {
  cachedModelCount,
  copilotPlanTier,
  deriveBrand,
  getModels,
  isLikelyPlaceholderKey,
  normalizeCopilotModels,
  normalizeGoogleDisplayName,
  normalizeGoogleModelId,
  resolveRefreshCredential,
  skipWithCachedModels
} from "./chunk-RLXYEMQD.js";
import {
  ANTIGRAVITY_BASE_URLS,
  ANTIGRAVITY_USER_AGENT,
  BACKENDS,
  CLINE_PASS_CATALOG_URL,
  CLINE_PASS_SDK_BASE_URL,
  CLINE_PASS_VALIDATION_URL,
  MAX_CONTEXT_WINDOW_OVERRIDE,
  MIN_CONTEXT_WINDOW_OVERRIDE,
  MODEL_KINDS,
  VERSION,
  applyModelsDevContextWindows,
  buildPricingIndex,
  classifyFreeStatus,
  customProviderId,
  deleteProviderCredential,
  enrichGithubCopilotOAuthProviderData,
  enrichModelsForProviderPricing,
  enrichPricingAsync,
  fetchClaudeCodeModels,
  fetchModelsDevCache,
  findModelsDevModel,
  findProviderNameConflict,
  formatClineRuntimeCredential,
  getAgentProviderModels,
  getProviderDebugLogPath,
  getProviderModels,
  isAntigravityCloudCodeHelperSlot,
  isFreeStatus,
  isProviderKind,
  isValidContextWindow,
  isValidProviderId,
  loadPricingCache,
  loadRegistry,
  localIsoTimestamp,
  localTimestamp,
  makeTraceLogger,
  modelPrefersResponsesApi,
  normalizeProviderName,
  parseAuthRef,
  providerKind,
  readGlobalOpencodeCredential,
  readStoredProviderCredential,
  resolveCodexClientVersion,
  resolveContextWindow,
  resolveProviderCredential,
  resolveProviderOAuthProviderData,
  saveProviderCredential,
  saveRegistry,
  saveToCredentialStore,
  shouldHideModel,
  slugifyProviderId,
  uniqueProviderName,
  validateProviderName,
  vertexAnthropicCachedModels,
  writeSecureLogLine
} from "./chunk-TNKSBY36.js";
import {
  getTemplateById,
  init_provider_templates
} from "./chunk-RKRPDZVV.js";

// src/tls-trust.ts
import tls from "tls";
var UNTRUSTED_CERTIFICATE_CODE = "untrusted-certificate";
var UNTRUSTED_ISSUER_CODES = /* @__PURE__ */ new Set([
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "CERT_UNTRUSTED"
]);
var caApi = tls;
var originalCertificates;
var applied = false;
function isSystemCaSupported() {
  return typeof caApi.setDefaultCACertificates === "function" && typeof caApi.getCACertificates === "function";
}
function isSystemCaActive() {
  return applied || process.env.NODE_USE_SYSTEM_CA === "1";
}
function applySystemCaTrust() {
  if (applied || process.env.NODE_USE_SYSTEM_CA === "1") return { ok: true };
  if (!isSystemCaSupported()) {
    return {
      ok: false,
      reason: `This Node version (${process.version}) cannot do this at runtime. Update Node to 22.19 or newer, or start Relay with NODE_USE_SYSTEM_CA=1.`
    };
  }
  try {
    const current = caApi.getCACertificates("default");
    const system = caApi.getCACertificates("system");
    originalCertificates = current;
    caApi.setDefaultCACertificates([...current, ...system]);
    applied = true;
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
function revertSystemCaTrust() {
  if (!applied || !originalCertificates) return;
  caApi.setDefaultCACertificates(originalCertificates);
  originalCertificates = void 0;
  applied = false;
}
function isUntrustedCertificateError(err) {
  let current = err;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
    const code = current.code;
    if (typeof code === "string" && UNTRUSTED_ISSUER_CODES.has(code)) return true;
    current = current.cause;
  }
  return false;
}
function untrustedCertificateMessage() {
  const error = "Relay doesn't trust this server's security certificate.";
  if (isSystemCaActive()) {
    return {
      error,
      hint: "Relay already trusts this computer's certificates, so this computer doesn't trust it either. Ask your IT team for the company CA certificate and install it in Keychain Access."
    };
  }
  return {
    error,
    hint: `Your computer may trust it (browsers do) but Relay doesn't. Turn on "Trust this computer's certificates" and try again. CLI: relay-ai providers trust-certs on`
  };
}
var TRUST_SYSTEM_CERTS_NOTICE = "Relay will trust every certificate authority your computer trusts (the same list your browser uses), including company ones added by your employer or IT tools. Only turn this on if you trust this computer's setup.";

// src/registry/builtins.ts
function zenRegistryStub(subscriptionFilter, account) {
  return {
    id: account?.id ?? "zen",
    templateId: "zen",
    name: account?.name ?? "OpenCode Zen",
    ...account?.nameCustomized ? { nameCustomized: true } : {},
    enabled: true,
    authRef: account?.authRef ?? "keyring:global:opencode",
    api: {},
    ...subscriptionFilter ? { subscriptionFilter } : {},
    addedAt: localIsoTimestamp()
  };
}
function goRegistryStub(account) {
  return {
    id: account?.id ?? "go",
    templateId: "go",
    name: account?.name ?? "OpenCode Go",
    ...account?.nameCustomized ? { nameCustomized: true } : {},
    enabled: true,
    authRef: account?.authRef ?? "keyring:global:opencode",
    api: {},
    addedAt: localIsoTimestamp()
  };
}

// src/registry/endpoint-timeout.ts
import ipaddr from "ipaddr.js";
function clampModelTimeoutMs(value, fallback) {
  return Number.isFinite(value) ? Math.min(12e4, Math.max(1e3, Math.round(value))) : fallback;
}
function isLocalEndpoint(baseUrl) {
  try {
    const hostname = new URL(baseUrl).hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
    const range = ipaddr.process(hostname).range();
    return range === "loopback" || range === "private" || range === "uniqueLocal";
  } catch {
    return false;
  }
}
function endpointModelTimeoutMs(templateId, baseUrl) {
  const slowEndpoint = templateId.startsWith("custom-") || templateId === "ollama" || templateId === "lmstudio" || isLocalEndpoint(baseUrl);
  if (!slowEndpoint) return 1e4;
  const configured = process.env.RELAY_AI_CUSTOM_ENDPOINT_MODEL_TIMEOUT_MS?.trim();
  return configured ? clampModelTimeoutMs(Number(configured), 3e4) : 3e4;
}

// src/registry/fetch-anthropic-models.ts
var MAX_MODEL_PAGES = 50;
function parsePage(rawBodyText) {
  try {
    if (rawBodyText.trim()) return JSON.parse(rawBodyText);
  } catch {
  }
  return {};
}
async function fetchAnthropicModels(baseUrl, apiKey, extraHeaders, timeoutMs) {
  const root = baseUrl.replace(/\/v1\/?$/, "").replace(/\/$/, "");
  const modelsUrl2 = `${root}/v1/models`;
  const defaultTimeoutMs = endpointModelTimeoutMs("anthropic", root);
  const effectiveTimeoutMs = clampModelTimeoutMs(timeoutMs ?? defaultTimeoutMs, defaultTimeoutMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), effectiveTimeoutMs);
  let logTrace;
  if (process.env.RELAY_AI_TRACE === "1") {
    logTrace = makeTraceLogger(getProviderDebugLogPath());
  }
  const requestPage = (url) => fetch(url, {
    method: "GET",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      Accept: "application/json",
      ...extraHeaders
    },
    redirect: "manual",
    signal: controller.signal
  });
  try {
    let url = modelsUrl2;
    let response = await requestPage(url);
    const models = [];
    const seenIds = /* @__PURE__ */ new Set();
    const seenCursors = /* @__PURE__ */ new Set();
    let incomplete;
    for (let page = 1; ; page++) {
      const rawBodyText = response.ok ? await response.text() : await response.text().catch(() => "");
      if (logTrace) {
        logTrace(`[fetchAnthropicModels] HTTP ${response.status} from ${url} (page ${page})`);
        logTrace(`[fetchAnthropicModels] Body: ${rawBodyText}`);
      }
      if (!response.ok) {
        if (page === 1) break;
        incomplete = `Page ${page} failed (HTTP ${response.status}); the model list may be missing later models.`;
        break;
      }
      const json = parsePage(rawBodyText);
      for (const row of json.data ?? []) {
        const id = row.id?.trim();
        if (!id || seenIds.has(id)) continue;
        seenIds.add(id);
        models.push({
          id,
          name: row.name?.trim() || id,
          upstreamModelId: id,
          family: id.split("-")[0] ?? id,
          brand: deriveBrand(id),
          contextWindow: resolveContextWindow(id),
          modelFormat: "anthropic",
          npm: "@ai-sdk/anthropic",
          apiUrl: root
        });
      }
      const cursor = typeof json.last_id === "string" ? json.last_id.trim() : "";
      if (json.has_more !== true) break;
      if (!cursor) {
        incomplete = "Server reported more models but gave no cursor; the model list may be incomplete.";
        break;
      }
      if (seenCursors.has(cursor)) {
        incomplete = "Server repeated a pagination cursor; the model list may be incomplete.";
        break;
      }
      if (page >= MAX_MODEL_PAGES) {
        incomplete = `Stopped after ${MAX_MODEL_PAGES} pages; the model list may be incomplete.`;
        break;
      }
      seenCursors.add(cursor);
      url = `${modelsUrl2}?after_id=${encodeURIComponent(cursor)}`;
      try {
        response = await requestPage(url);
      } catch {
        incomplete = `Page ${page + 1} could not be fetched${controller.signal.aborted ? " (timed out)" : ""}; the model list may be missing later models.`;
        break;
      }
    }
    if (models.length > 0) {
      if (incomplete && logTrace) logTrace(`[fetchAnthropicModels] incomplete: ${incomplete}`);
      return { models, baseUrl: root, ...incomplete ? { incomplete } : {} };
    }
    if (response.status === 401 || response.status === 403) {
      return { models: [], baseUrl: root, error: "API key was rejected.", hint: "Check your Anthropic-compatible API key." };
    }
    return {
      models: [],
      baseUrl: root,
      error: `Could not list models (HTTP ${response.status}).`,
      hint: "Verify the base URL supports Anthropic-compatible /v1/models or try the OpenAI-compatible option instead."
    };
  } catch (err) {
    if (isUntrustedCertificateError(err)) {
      return { models: [], baseUrl: root, ...untrustedCertificateMessage(), code: UNTRUSTED_CERTIFICATE_CODE };
    }
    const timedOut = controller.signal.aborted;
    return {
      models: [],
      baseUrl: root,
      error: timedOut ? `Connection timed out after ${Math.round(effectiveTimeoutMs / 1e3)} seconds.` : "Could not reach the Anthropic-compatible server.",
      hint: timedOut ? "Check your network or try again." : "Check the base URL and that the server is running."
    };
  } finally {
    clearTimeout(timer);
  }
}

// src/registry/fetch-template-models.ts
function modelFormatForNpm(npm) {
  return npm === "@ai-sdk/anthropic" ? "anthropic" : "openai";
}
function modelsUrl(baseUrl, template) {
  let trimmed = baseUrl.replace(/\/$/, "");
  if (template.modelsPath) {
    if (trimmed.endsWith("/v1") && (template.modelsPath.startsWith("/models") || template.modelsPath.startsWith("/ai/models"))) {
      trimmed = trimmed.slice(0, -3);
    }
    const path = template.modelsPath.startsWith("/") ? template.modelsPath : `/${template.modelsPath}`;
    return `${trimmed}${path}`;
  }
  if (/\/(v\d+[a-z]*|openai|beta)$/.test(trimmed)) {
    return `${trimmed}/models`;
  }
  return `${trimmed}/v1/models`;
}
function toNumber(value) {
  if (value === void 0) return void 0;
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : void 0;
}
function perMillion(value) {
  if (value === void 0) return void 0;
  return Number((value * 1e6).toPrecision(12));
}
function parseNativePricing(pricing) {
  if (!pricing) return void 0;
  const inputPerToken = toNumber(pricing.prompt) ?? toNumber(pricing.input) ?? toNumber(pricing.input_cost_per_token) ?? toNumber(pricing.inputCostPerToken);
  const outputPerToken = toNumber(pricing.completion) ?? toNumber(pricing.output) ?? toNumber(pricing.output_cost_per_token) ?? toNumber(pricing.outputCostPerToken);
  const inputPerMillion = toNumber(pricing.input_per_1m_tokens) ?? toNumber(pricing.inputPer1MTokens);
  const outputPerMillion = toNumber(pricing.output_per_1m_tokens) ?? toNumber(pricing.outputPer1MTokens);
  const input = perMillion(inputPerToken) ?? inputPerMillion;
  const output = perMillion(outputPerToken) ?? outputPerMillion;
  if (input === void 0 && output === void 0) return void 0;
  const cost = {
    input: input ?? 0,
    output: output ?? 0
  };
  const cacheRead = perMillion(toNumber(pricing.input_cache_read) ?? toNumber(pricing.cache_read));
  const cacheWrite = perMillion(toNumber(pricing.input_cache_write) ?? toNumber(pricing.cache_write));
  if (cacheRead !== void 0) cost.cache_read = cacheRead;
  if (cacheWrite !== void 0) cost.cache_write = cacheWrite;
  return cost;
}
function parseCloudflarePricing(priceValue) {
  if (!Array.isArray(priceValue)) return void 0;
  let input;
  let output;
  for (const item of priceValue) {
    if (typeof item !== "object" || !item) continue;
    const row = item;
    const unit = String(row.unit || "").toLowerCase();
    const price = Number(row.price);
    if (!Number.isFinite(price)) continue;
    if (unit.includes("input")) input = price;
    else if (unit.includes("output")) output = price;
  }
  if (input === void 0 && output === void 0) return void 0;
  return { input: input ?? 0, output: output ?? 0 };
}
var LEGACY_NON_TOOL_MODELS = /* @__PURE__ */ new Set([
  "@cf/google/gemma-2b-it-lora",
  "@cf/google/gemma-7b-it-lora",
  "@cf/meta-llama/llama-2-7b-chat-hf-lora",
  "@cf/mistral/mistral-7b-instruct-v0.2-lora"
]);
function parseModelList(body, npm) {
  const rows = body.data ?? body.models ?? body.result ?? [];
  const format = modelFormatForNpm(npm);
  const models = [];
  for (const row of rows) {
    const rawId = (row.name?.startsWith("@cf/") || row.name?.startsWith("@hf/") ? row.name : row.id)?.trim();
    if (!rawId) continue;
    let contextWindowFromProps;
    let isFreeFromProps;
    let costFromProps;
    if (Array.isArray(row.properties)) {
      if (LEGACY_NON_TOOL_MODELS.has(rawId)) continue;
      const cwProp = row.properties.find((p) => p.property_id === "context_window");
      if (cwProp?.value) contextWindowFromProps = toNumber(cwProp.value);
      const priceProp = row.properties.find((p) => p.property_id === "price");
      const isRestrictedPaidPlan = rawId.includes("/glm-") || rawId.includes("/kimi-");
      if (isRestrictedPaidPlan) {
        costFromProps = parseCloudflarePricing(priceProp?.value);
        isFreeFromProps = false;
      } else {
        isFreeFromProps = true;
        if (priceProp?.value) {
          costFromProps = parseCloudflarePricing(priceProp.value);
        }
      }
    }
    const { id, upstreamModelId } = normalizeGoogleModelId(rawId, npm);
    const family = id.replace(/^@[a-z0-9_-]+\//i, "").split(/[-/:]/)[0] ?? id;
    const cost = costFromProps ?? parseNativePricing(row.pricing);
    const freeStatus = classifyFreeStatus({
      model: { cost, isFree: row.isFree },
      // Cloudflare standard models carry a list price but are covered by the free
      // daily Neuron allowance, so free access is a provider rule, not a price.
      freeAccess: isFreeFromProps === true
    });
    const reportedWindow = contextWindowFromProps ?? row.context_length ?? row.contextWindow ?? row.context_window;
    const contextWindow2 = reportedWindow ?? resolveContextWindow(id);
    models.push({
      id,
      name: normalizeGoogleDisplayName(row.name, id),
      upstreamModelId,
      family,
      brand: deriveBrand(family),
      contextWindow: contextWindow2,
      // Marks a size the provider stated, so a guessed one can be labelled as an estimate.
      ...reportedWindow !== void 0 ? { contextWindowSource: "provider" } : {},
      cost,
      ...cost ? { costSource: "provider" } : {},
      isFree: isFreeStatus(freeStatus),
      freeStatus,
      modelFormat: format,
      npm,
      supportedParameters: Array.isArray(row.supported_parameters) ? row.supported_parameters : void 0,
      useResponsesLite: typeof row.use_responses_lite === "boolean" ? row.use_responses_lite : void 0,
      preferWebSockets: typeof row.prefer_websockets === "boolean" ? row.prefer_websockets : void 0
    });
  }
  return models;
}
async function fetchTemplateModels(template, apiKey, baseUrlOverride, extraHeaders, timeoutMs) {
  const trimmedOverride = baseUrlOverride?.trim();
  const baseUrl = (trimmedOverride || template.defaultBaseUrl)?.replace(/\/$/, "");
  if (!baseUrl) {
    return {
      models: [],
      baseUrl: "",
      error: "This provider needs a base URL.",
      hint: template.urlPrompt ? "Enter the API base URL when adding this provider." : "This template is missing a default base URL \u2014 report a bug."
    };
  }
  if (template.modelSource === "static-seed") {
    const models = (template.staticModels || []).map((sm) => {
      const family = sm.id.split(/[-/:]/)[0] ?? sm.id;
      return {
        id: sm.id,
        name: sm.name,
        upstreamModelId: sm.id,
        family,
        brand: deriveBrand(family),
        contextWindow: resolveContextWindow(sm.id),
        modelFormat: modelFormatForNpm(template.npm),
        npm: template.npm
      };
    });
    return { models, baseUrl };
  }
  const url = modelsUrl(baseUrl, template);
  const defaultTimeoutMs = endpointModelTimeoutMs(template.id, baseUrl);
  const effectiveTimeoutMs = clampModelTimeoutMs(timeoutMs ?? defaultTimeoutMs, defaultTimeoutMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), effectiveTimeoutMs);
  const headers = { Accept: "application/json" };
  const trimmedApiKey = apiKey.trim();
  if (template.npm === "@ai-sdk/anthropic") {
    if (trimmedApiKey) headers["x-api-key"] = trimmedApiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else if (trimmedApiKey) {
    headers["Authorization"] = `Bearer ${trimmedApiKey}`;
  }
  if (template.headers) Object.assign(headers, template.headers);
  if (extraHeaders) Object.assign(headers, extraHeaders);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      redirect: "manual",
      signal: controller.signal
    });
    if (response.status >= 300 && response.status < 400) {
      return {
        models: [],
        baseUrl,
        error: "Provider redirected the connection test.",
        hint: "Check the base URL \u2014 redirects are blocked for security."
      };
    }
    let logTrace;
    if (process.env.RELAY_AI_TRACE === "1") {
      logTrace = makeTraceLogger(getProviderDebugLogPath());
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      if (logTrace) {
        logTrace(`[fetchTemplateModels] HTTP ${response.status} from ${url}`);
        logTrace(`[fetchTemplateModels] Body: ${body}`);
      }
      const detail = body.slice(0, 200).trim();
      if (response.status === 401 || response.status === 403) {
        return {
          models: [],
          baseUrl,
          error: "API key was rejected.",
          hint: template.signupUrl ? `Get or verify your key at ${template.signupUrl}` : "Double-check the key you pasted."
        };
      }
      return {
        models: [],
        baseUrl,
        error: `Provider returned HTTP ${response.status}.`,
        hint: detail || "Check your API key and try again."
      };
    }
    const rawBodyText = await response.text();
    if (logTrace) {
      logTrace(`[fetchTemplateModels] HTTP ${response.status} from ${url}`);
      logTrace(`[fetchTemplateModels] Body: ${rawBodyText}`);
    }
    let json = {};
    try {
      if (rawBodyText.trim()) {
        json = JSON.parse(rawBodyText);
      }
    } catch {
    }
    const models = parseModelList(json, template.npm);
    if (models.length === 0) {
      return {
        models: [],
        baseUrl,
        error: "Connected but no models were returned.",
        hint: "The API key may be valid but model listing is unavailable for this provider."
      };
    }
    return { models, baseUrl };
  } catch (err) {
    if (isUntrustedCertificateError(err)) {
      return { models: [], baseUrl, ...untrustedCertificateMessage(), code: UNTRUSTED_CERTIFICATE_CODE };
    }
    const timedOut = controller.signal.aborted;
    return {
      models: [],
      baseUrl,
      error: timedOut ? `Connection timed out after ${Math.round(effectiveTimeoutMs / 1e3)} seconds.` : "Could not reach the provider.",
      hint: timedOut ? "Check your network or try again." : "Verify the provider is online and your API key is correct."
    };
  } finally {
    clearTimeout(timer);
  }
}

// src/registry/custom-endpoint.ts
function npmForKind(kind) {
  return kind === "anthropic" ? "@ai-sdk/anthropic" : "@ai-sdk/openai-compatible";
}
function modelFormatForKind(kind) {
  return kind === "anthropic" ? "anthropic" : "openai";
}
function customEndpointKind(provider) {
  if (provider.templateId === "custom-anthropic") return "anthropic";
  if (provider.templateId === "custom-openai") return "openai";
  return null;
}
function sameHeaders(a, b) {
  const norm = (h) => JSON.stringify(Object.entries(h ?? {}).sort(([x], [y]) => x.localeCompare(y)));
  return norm(a) === norm(b);
}
function compareableUrl(url) {
  return url.replace(/\/v1\/?$/, "").replace(/\/$/, "");
}
async function findDuplicateCustomProvider(registry, normalizedUrl, apiKey, headers) {
  const target = compareableUrl(normalizedUrl);
  for (const existing of registry.providers) {
    if (!customEndpointKind(existing)) continue;
    if (compareableUrl(existing.api.url ?? "") !== target) continue;
    if (!sameHeaders(existing.api.headers, headers)) continue;
    const storedKey = await readStoredProviderCredential(existing.authRef);
    if ((storedKey ?? "") === apiKey) return existing.id;
  }
  return null;
}
function uniqueProviderId(displayName, registry) {
  let base = customProviderId(displayName);
  if (!base.startsWith("custom-")) base = `custom-${slugifyProviderId(displayName)}`;
  if (!isValidProviderId(base)) base = "custom-provider";
  if (!registry.providers.some((p) => p.id === base)) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}-${i}`;
    if (isValidProviderId(candidate) && !registry.providers.some((p) => p.id === candidate)) {
      return candidate;
    }
  }
  return `${base}-${Date.now()}`;
}
async function fetchCustomEndpointModels(input) {
  const timeoutMs = endpointModelTimeoutMs(`custom-${input.kind}`, input.normalizedBaseUrl);
  const withReference = (fetched) => ({ ...fetched, models: applyModelsDevContextWindows(fetched.models) });
  if (input.kind === "anthropic") {
    return withReference(await fetchAnthropicModels(input.normalizedBaseUrl, input.apiKey, input.headers, timeoutMs));
  }
  return withReference(await fetchTemplateModels(
    {
      id: input.providerId,
      name: input.displayName,
      authType: input.apiKey === "local" ? "none" : "api",
      npm: npmForKind(input.kind),
      defaultBaseUrl: input.normalizedBaseUrl,
      modelSource: "api-list",
      supported: true
    },
    input.apiKey,
    input.normalizedBaseUrl,
    input.headers,
    timeoutMs
  ));
}
async function addCustomEndpointProvider(input) {
  const urlCheck = await validateCustomEndpointUrl(input.baseUrl, {
    allowInsecureLocal: input.allowInsecureLocal
  });
  if (!urlCheck.ok || !urlCheck.normalizedUrl) {
    return { added: false, error: urlCheck.error, hint: urlCheck.hint };
  }
  const registry = loadRegistry();
  const nameClash = findProviderNameConflict(registry.providers, input.displayName);
  if (nameClash) {
    return {
      added: false,
      error: `A provider named "${nameClash.name}" already exists.`,
      hint: "Pick a different name."
    };
  }
  const apiKey = input.apiKey.trim() || "local";
  const headers = input.headers && Object.keys(input.headers).length > 0 ? input.headers : void 0;
  if (!input.confirmDuplicate) {
    const duplicateOf = await findDuplicateCustomProvider(
      registry,
      urlCheck.normalizedUrl,
      apiKey,
      headers
    );
    if (duplicateOf) {
      return {
        added: false,
        duplicateOf,
        error: `A backend with the same URL, key and headers already exists (${duplicateOf}).`,
        hint: "Add it anyway to keep both, or cancel."
      };
    }
  }
  const providerId = uniqueProviderId(input.displayName.trim(), registry);
  const npm = npmForKind(input.kind);
  const fetched = await fetchCustomEndpointModels({
    providerId,
    displayName: input.displayName,
    kind: input.kind,
    normalizedBaseUrl: urlCheck.normalizedUrl,
    apiKey,
    headers
  });
  if (fetched.error || fetched.models.length === 0) {
    return {
      added: false,
      error: fetched.error ?? "No models returned.",
      hint: fetched.hint,
      ...fetched.code ? { code: fetched.code } : {}
    };
  }
  if (apiKey !== "local") {
    const saved = await saveProviderCredential(`keyring:provider:${providerId}`, apiKey);
    if (!saved) {
      return { added: false, error: "Could not save API key to credential store.", hint: "Grant Keychain access, or ensure RELAY_AI_HOME is writable (file fallback)." };
    }
  }
  const now = localIsoTimestamp();
  const entry = {
    id: providerId,
    templateId: input.kind === "anthropic" ? "custom-anthropic" : "custom-openai",
    name: input.displayName.trim(),
    enabled: true,
    authRef: apiKey === "local" ? `keyring:provider:${providerId}` : `keyring:provider:${providerId}`,
    api: { npm, url: fetched.baseUrl, ...headers ? { headers } : {} },
    addedAt: now,
    refreshedAt: now,
    modelsCache: {
      fetchedAt: now,
      models: fetched.models.map((m) => ({
        ...m,
        modelFormat: modelFormatForKind(input.kind),
        npm,
        apiUrl: fetched.baseUrl
      }))
    }
  };
  if (apiKey === "local") {
    await saveProviderCredential(entry.authRef, "local");
  }
  registry.providers.push(entry);
  saveRegistry(registry);
  return {
    added: true,
    provider: entry,
    modelCount: fetched.models.length,
    ...fetched.incomplete ? { incomplete: fetched.incomplete } : {}
  };
}
async function updateCustomEndpointProvider(input) {
  const registry = loadRegistry();
  const provider = registry.providers.find((pr) => pr.id === input.providerId);
  if (!provider) {
    return { updated: false, error: `Provider not found: ${input.providerId}` };
  }
  const kind = customEndpointKind(provider);
  if (!kind) {
    return {
      updated: false,
      error: "Edit is only available for custom backends.",
      hint: "Template providers can only change their API key."
    };
  }
  const nextName = input.displayName?.trim();
  let nextBaseUrl = provider.api.url ?? "";
  let urlChanged = false;
  const requestedUrl = input.baseUrl?.trim();
  if (requestedUrl) {
    const urlCheck = await validateCustomEndpointUrl(requestedUrl, {
      allowInsecureLocal: input.allowInsecureLocal
    });
    if (!urlCheck.ok || !urlCheck.normalizedUrl) {
      return { updated: false, error: urlCheck.error, hint: urlCheck.hint };
    }
    urlChanged = urlCheck.normalizedUrl !== nextBaseUrl;
    nextBaseUrl = urlCheck.normalizedUrl;
  }
  const newKey = input.apiKey?.trim();
  const headersChanged = input.headers !== void 0 && !sameHeaders(input.headers, provider.api.headers);
  const nextHeaders = input.headers !== void 0 ? Object.keys(input.headers).length > 0 ? input.headers : void 0 : provider.api.headers;
  const nameChanged = Boolean(nextName) && nextName !== provider.name;
  const nameClash = nameChanged ? findProviderNameConflict(registry.providers, nextName, provider.id) : void 0;
  if (nameClash) {
    return {
      updated: false,
      error: `A provider named "${nameClash.name}" already exists.`,
      hint: "Pick a different name."
    };
  }
  const needsTest = urlChanged || Boolean(newKey) || headersChanged;
  if (!needsTest) {
    if (!nameChanged) return { updated: false, error: "Nothing to change." };
    provider.name = nextName;
    saveRegistry(registry);
    return {
      updated: true,
      provider,
      modelCount: provider.modelsCache?.models.length ?? 0
    };
  }
  const apiKey = newKey || await readStoredProviderCredential(provider.authRef) || "";
  if (!apiKey) {
    return {
      updated: false,
      error: "No stored API key was found for this backend.",
      hint: "Enter an API key to continue."
    };
  }
  const fetched = await fetchCustomEndpointModels({
    providerId: provider.id,
    displayName: nextName || provider.name,
    kind,
    normalizedBaseUrl: nextBaseUrl,
    apiKey,
    headers: nextHeaders
  });
  const testFailed = Boolean(fetched.error) || fetched.models.length === 0;
  if (testFailed && !input.saveAnyway) {
    return {
      updated: false,
      error: fetched.error ?? "No models returned.",
      hint: fetched.hint,
      ...fetched.code ? { code: fetched.code } : {},
      canSaveAnyway: true
    };
  }
  if (newKey) {
    const saved = await saveProviderCredential(provider.authRef, newKey);
    if (!saved) {
      return {
        updated: false,
        error: "Could not save API key to credential store.",
        hint: "Grant Keychain access, or ensure RELAY_AI_HOME is writable (file fallback)."
      };
    }
  }
  const now = localIsoTimestamp();
  if (nameChanged) provider.name = nextName;
  const storedBaseUrl = kind === "anthropic" ? nextBaseUrl.replace(/\/v1\/?$/, "").replace(/\/$/, "") : nextBaseUrl;
  provider.api.url = testFailed ? storedBaseUrl : fetched.baseUrl || storedBaseUrl;
  if (nextHeaders) provider.api.headers = nextHeaders;
  else delete provider.api.headers;
  if (!testFailed) {
    provider.modelsCache = {
      fetchedAt: now,
      models: fetched.models.map((m) => ({
        ...m,
        modelFormat: modelFormatForKind(kind),
        npm: npmForKind(kind),
        apiUrl: fetched.baseUrl || storedBaseUrl
      }))
    };
    provider.refreshedAt = now;
  } else if (provider.modelsCache) {
    provider.modelsCache = {
      ...provider.modelsCache,
      models: provider.modelsCache.models.map((m) => ({ ...m, apiUrl: storedBaseUrl }))
    };
  }
  saveRegistry(registry);
  return {
    updated: true,
    provider,
    modelCount: provider.modelsCache?.models.length ?? 0,
    ...testFailed ? { modelsStale: true } : {},
    ...!testFailed && fetched.incomplete ? { incomplete: fetched.incomplete } : {}
  };
}

// src/registry/probe-models.ts
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function filterModelsByAvailability(models, spec) {
  const targets = [];
  models.forEach((model, index) => {
    if (!spec.select || spec.select(model)) targets.push({ model, index });
  });
  if (targets.length === 0) return { models, removedIds: [], aborted: false };
  const concurrency = Math.max(1, Math.min(spec.concurrency ?? 1, targets.length));
  const gapMs = Math.max(0, spec.gapMs ?? 0);
  const removedIndexes = /* @__PURE__ */ new Set();
  let next = 0;
  let started = 0;
  let aborted = false;
  let abortDetail;
  const run = async () => {
    while (!aborted) {
      const slot = targets[next++];
      if (!slot) return;
      if (gapMs > 0 && started++ > 0) await sleep(gapMs);
      let classification;
      let status = 0;
      try {
        const response = await spec.probe(slot.model);
        status = response.status;
        classification = spec.classify(response.status, response.body);
      } catch {
        classification = "unknown";
      }
      const verdict = typeof classification === "string" ? classification : classification.verdict;
      const detail = typeof classification === "string" ? void 0 : classification.detail;
      spec.trace?.(`[probe:${spec.label}] ${slot.model.id} -> ${verdict} (HTTP ${status})${detail ? ` ${detail}` : ""}`);
      if (verdict === "abort") {
        aborted = true;
        abortDetail = detail ?? `account-level rejection on ${slot.model.id}`;
        return;
      }
      if (verdict === "unavailable") removedIndexes.add(slot.index);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, run));
  if (aborted) {
    spec.trace?.(`[probe:${spec.label}] aborted (${abortDetail}) \u2014 catalog kept unchanged`);
    return { models, removedIds: [], aborted: true, abortDetail };
  }
  const removedIds = [...removedIndexes].sort((a, b) => a - b).map((index) => models[index].id);
  if (removedIds.length > 0) {
    spec.trace?.(`[probe:${spec.label}] removed ${removedIds.length} of ${targets.length}: ${removedIds.join(", ")}`);
  }
  return {
    models: models.filter((_, index) => !removedIndexes.has(index)),
    removedIds,
    aborted: false
  };
}

// src/registry/fetch-cline-pass-models.ts
var REQUEST_TIMEOUT_MS = 1e4;
var PROBE_TIMEOUT_MS = 2e4;
var PROBE_GAP_MS = 400;
var CLINE_PRODUCT_SURFACES_MARKER = "only available via cline product surfaces";
function trace(message) {
  if (process.env.RELAY_AI_TRACE !== "1") return;
  writeSecureLogLine(
    getProviderDebugLogPath(),
    `${localTimestamp()} ${message}`
  );
}
async function responseBodyPreview(response) {
  try {
    const clone = typeof response.clone === "function" ? response.clone() : response;
    if (typeof clone.text !== "function") return "";
    return (await clone.text()).slice(0, 500).trim();
  } catch {
    return "";
  }
}
function entries(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => Boolean(entry && typeof entry === "object"));
}
function positiveNumber(value) {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : void 0;
  return typeof number === "number" && Number.isFinite(number) && number > 0 ? number : void 0;
}
function contextWindow(entry) {
  return [
    entry.context_window,
    entry.contextWindow,
    entry.context_length,
    entry.max_input_tokens,
    entry.limit?.context
  ].map(positiveNumber).find((value) => value !== void 0);
}
function toCachedModel(entry, isFree) {
  const id = typeof entry.id === "string" ? entry.id.trim() : "";
  if (!id) return null;
  const name = typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : id;
  const reportedContextWindow = contextWindow(entry);
  const cost = isFree ? { input: 0, output: 0 } : void 0;
  const freeStatus = classifyFreeStatus({ model: { cost, isFree } });
  const family = id.split("/").pop()?.split(/[-:]/)[0] ?? id;
  return {
    id,
    name,
    upstreamModelId: id,
    family,
    brand: deriveBrand(family),
    contextWindow: reportedContextWindow,
    contextWindowSource: reportedContextWindow === void 0 ? void 0 : "provider",
    cost,
    isFree: isFreeStatus(freeStatus),
    freeStatus,
    modelFormat: "openai",
    npm: "@ai-sdk/openai-compatible"
  };
}
function parseClinePassModels(payload) {
  if (!payload || typeof payload !== "object") return [];
  const body = payload;
  const byId = /* @__PURE__ */ new Map();
  for (const entry of entries(body.clinePass)) {
    const model = toCachedModel(entry, false);
    if (model) byId.set(model.id, model);
  }
  for (const entry of entries(body.free)) {
    const model = toCachedModel(entry, true);
    if (model && !byId.has(model.id)) byId.set(model.id, model);
  }
  return [...byId.values()];
}
async function fetchJson(url, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  trace(`ClinePass GET ${url} authorization=${headers?.Authorization ? "present" : "absent"}`);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json", ...headers },
      redirect: "manual",
      signal: controller.signal
    });
    trace(`ClinePass response status=${response.status} url=${url}`);
    return response;
  } catch (err) {
    trace(`ClinePass request failed url=${url} error=${err instanceof Error ? err.message : String(err)}`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
function bodyErrorText(body) {
  if (typeof body === "string") return body;
  if (!body || typeof body !== "object") return "";
  const error = body.error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const nested = error.message;
    if (typeof nested === "string") return nested;
  }
  const message = body.message;
  return typeof message === "string" ? message : "";
}
function classifyClineProbeResponse(status, body) {
  const message = bodyErrorText(body).toLowerCase();
  if (status === 403 && message.includes(CLINE_PRODUCT_SURFACES_MARKER)) return "unavailable";
  if (status === 401 || status === 402) return "abort";
  if (status === 403 && message.includes("subscription")) return "abort";
  if (status === 403 || status === 429) return "unknown";
  if (status < 200 || status >= 500) return "unknown";
  return "available";
}
function buildClineFreeProbe(options) {
  const runtimeCredential = formatClineRuntimeCredential(
    "cline-pass",
    options.authType,
    options.credential.trim()
  );
  return {
    label: "cline-free",
    select: (model) => model.isFree === true,
    concurrency: 1,
    gapMs: PROBE_GAP_MS,
    trace,
    classify: classifyClineProbeResponse,
    probe: async (model) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
      try {
        const response = await fetch(`${CLINE_PASS_SDK_BASE_URL}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // Same identification headers the provider template sends on inference.
            "HTTP-Referer": "https://cline.bot",
            "X-Title": "Cline",
            Authorization: `Bearer ${runtimeCredential}`
          },
          body: JSON.stringify({
            model: model.upstreamModelId,
            max_tokens: 1,
            messages: [{ role: "user", content: "hi" }]
          }),
          signal: controller.signal
        });
        const body = await response.json().catch(() => null);
        return { status: response.status, body };
      } catch {
        return { status: 0, body: null };
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
async function fetchClinePassModels(probe) {
  const response = await fetchJson(CLINE_PASS_CATALOG_URL);
  if (!response.ok) {
    const body = await responseBodyPreview(response);
    if (body) trace(`ClinePass catalog body=${body}`);
    throw new Error(`ClinePass catalog returned HTTP ${response.status}.`);
  }
  const payload = await response.json().catch(() => null);
  const models = parseClinePassModels(payload);
  trace(`ClinePass catalog parsed models=${models.length}`);
  if (models.length === 0) throw new Error("ClinePass catalog returned no usable models.");
  if (!probe?.credential.trim()) {
    trace("ClinePass free probe skipped \u2014 no credential available");
    return models;
  }
  const outcome = await filterModelsByAvailability(models, buildClineFreeProbe(probe));
  if (outcome.aborted) {
    trace(`ClinePass free probe paused (${outcome.abortDetail ?? "account-level rejection"}) \u2014 no models removed.`);
  }
  return outcome.models.length > 0 ? outcome.models : models;
}
async function validateClinePassApiKey(apiKey) {
  const response = await fetchJson(CLINE_PASS_VALIDATION_URL, {
    Authorization: `Bearer ${apiKey.trim()}`
  });
  const body = await responseBodyPreview(response);
  if (body) trace(`ClinePass validation body=${body}`);
  if (response.status === 401 || response.status === 403) {
    throw new Error("API key was rejected.");
  }
  if (!response.ok) {
    throw new Error(`ClinePass API key validation returned HTTP ${response.status}.`);
  }
}

// src/registry/fetch-commandcode-models.ts
var COMMANDCODE_BASE_URL = "https://api.commandcode.ai/provider/v1";
var REQUEST_TIMEOUT_MS2 = 1e4;
var PROBE_TIMEOUT_MS2 = 25e3;
var PROBE_CONCURRENCY = 6;
function isAnthropicSchemaModel(id) {
  return id.startsWith("claude-");
}
function positiveNumber2(value) {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : void 0;
  return typeof number === "number" && Number.isFinite(number) && number > 0 ? number : void 0;
}
function toCachedModel2(entry, baseUrl) {
  const id = typeof entry.id === "string" ? entry.id.trim() : "";
  if (!id) return null;
  const anthropicSchema = isAnthropicSchemaModel(id);
  const displayName = typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : id;
  const contextWindow2 = positiveNumber2(entry.context_length);
  const family = id.split("/").pop()?.split(/[-:]/)[0] ?? id;
  return {
    id,
    name: displayName,
    upstreamModelId: id,
    family,
    brand: deriveBrand(family),
    contextWindow: contextWindow2,
    contextWindowSource: contextWindow2 === void 0 ? void 0 : "provider",
    modelFormat: anthropicSchema ? "anthropic" : "openai",
    npm: anthropicSchema ? "@ai-sdk/anthropic" : "@ai-sdk/openai-compatible",
    apiUrl: baseUrl
  };
}
function parseCommandCodeModels(payload, baseUrl) {
  if (!payload || typeof payload !== "object") return [];
  const rows = payload.data;
  if (!Array.isArray(rows)) return [];
  const models = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const model = toCachedModel2(row, baseUrl);
    if (model) models.push(model);
  }
  return models;
}
function classifyProbeResponse(status, body) {
  const message = typeof body === "object" && body !== null ? String(body.error?.message ?? "") : "";
  if (status === 403 && message.includes("MODEL_NOT_IN_PLAN")) return "not-in-plan";
  if (status >= 500) return "unknown";
  if (status === 429) return "unknown";
  if (status === 401 || status === 403) return "unknown";
  if (status >= 200 && status < 500) return "available";
  return "unknown";
}
async function probeModel(model, baseUrl, apiKey) {
  const anthropicSchema = model.modelFormat === "anthropic";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS2);
  try {
    const response = await fetch(`${baseUrl}/${anthropicSchema ? "messages" : "chat/completions"}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...anthropicSchema ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" } : { Authorization: `Bearer ${apiKey}` }
      },
      body: JSON.stringify({
        model: model.upstreamModelId,
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }]
      }),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => null);
    return { status: response.status, body: payload };
  } catch {
    return { status: 0, body: null };
  } finally {
    clearTimeout(timer);
  }
}
async function filterModelsByPlan(models, baseUrl, apiKey) {
  if (!apiKey.trim()) return models;
  const outcome = await filterModelsByAvailability(models, {
    label: "commandcode-plan",
    concurrency: PROBE_CONCURRENCY,
    classify: (status, body) => {
      const result = classifyProbeResponse(status, body);
      return result === "not-in-plan" ? "unavailable" : result;
    },
    probe: (model) => probeModel(model, baseUrl, apiKey)
  });
  return outcome.models;
}
async function fetchCommandCodeModels(baseUrl = COMMANDCODE_BASE_URL, apiKey) {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS2);
  let response;
  try {
    response = await fetch(`${normalizedBaseUrl}/models`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...apiKey?.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {}
      },
      redirect: "manual",
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error("Command Code rejected the API key.");
  }
  if (!response.ok) {
    throw new Error(`Command Code model list returned HTTP ${response.status}.`);
  }
  const payload = await response.json().catch(() => null);
  const models = parseCommandCodeModels(payload, normalizedBaseUrl);
  if (models.length === 0) throw new Error("Command Code returned no usable models.");
  if (!apiKey?.trim()) return models;
  const available = await filterModelsByPlan(models, normalizedBaseUrl, apiKey);
  return available.length > 0 ? available : models;
}

// src/registry/model-source.ts
init_provider_templates();

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

// src/registry/model-source.ts
var MANUAL_ONLY_TEMPLATE_IDS = /* @__PURE__ */ new Set(["vertex", "bedrock", "azure"]);
var MANUAL_ONLY_PROVIDER_IDS = /* @__PURE__ */ new Set(["google-vertex", "vertex", "bedrock", "azure"]);
var MANUAL_ONLY_NPMS = /* @__PURE__ */ new Set([
  "@ai-sdk/google-vertex",
  "@ai-sdk/amazon-bedrock",
  "@ai-sdk/azure"
]);
function resolveModelSource(provider) {
  const kind = providerKind(provider.id);
  if (kind === "zen" || kind === "go" || provider.templateId === "zen" || provider.templateId === "go") {
    return "zen-go-api";
  }
  if (MANUAL_ONLY_PROVIDER_IDS.has(kind) || MANUAL_ONLY_PROVIDER_IDS.has(provider.templateId) || MANUAL_ONLY_TEMPLATE_IDS.has(provider.templateId) || provider.api.npm && MANUAL_ONLY_NPMS.has(provider.api.npm)) {
    return "manual-only";
  }
  const template = resolveProviderTemplate(provider) ?? getTemplateById(provider.templateId);
  if (template) return template.modelSource;
  if (provider.templateId === "custom-openai" || provider.templateId === "custom-anthropic") {
    return "api-list";
  }
  return "api-list";
}

// src/data/openai-oauth-models.ts
var CHATGPT_CODEX_UNSUPPORTED_MODELS = /* @__PURE__ */ new Set([
  "gpt-5.5-fast"
  // confirmed: rejected by chatgpt.com/backend-api/codex
]);
var OPENAI_OAUTH_MODEL_SEEDS = [
  // GPT-5.6 family (Sol / Terra / Luna)
  { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", reasoning: true },
  { id: "gpt-5.6-terra", name: "GPT-5.6 Terra", reasoning: true },
  { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", reasoning: true, useResponsesLite: true, preferWebSockets: true },
  // GPT-5.5 family (Pro)
  { id: "gpt-5.5", name: "GPT-5.5", reasoning: true },
  // GPT-5.4 family
  { id: "gpt-5.4", name: "GPT-5.4" },
  { id: "gpt-5.4-mini", name: "GPT-5.4 Mini" },
  // GPT-5 base (Pro / Plus)
  { id: "gpt-5", name: "GPT-5", reasoning: true },
  // o-series reasoning (Plus+)
  { id: "o4-mini", name: "o4 Mini", reasoning: true },
  { id: "o3", name: "o3", reasoning: true },
  { id: "o3-mini", name: "o3 Mini", reasoning: true },
  { id: "o1", name: "o1", reasoning: true },
  { id: "o1-mini", name: "o1 Mini", reasoning: true }
];
function buildOpenAiOAuthModels() {
  return OPENAI_OAUTH_MODEL_SEEDS.map((seed) => {
    const prefix = seed.id.split("-")[0] ?? seed.id;
    return {
      id: seed.id,
      name: seed.name,
      upstreamModelId: seed.id,
      family: prefix,
      brand: deriveBrand(prefix),
      contextWindow: resolveContextWindow(seed.id),
      modelFormat: "openai",
      npm: "@ai-sdk/openai",
      reasoning: seed.reasoning,
      useResponsesLite: seed.useResponsesLite,
      preferWebSockets: seed.preferWebSockets
    };
  });
}

// src/data/xai-oauth-models.ts
var XAI_OAUTH_MODEL_SEEDS = [
  // Grok 4 family
  { id: "grok-4", name: "Grok 4", reasoning: true },
  { id: "grok-4-fast", name: "Grok 4 Fast", reasoning: true },
  // Grok 3 family
  { id: "grok-3", name: "Grok 3", reasoning: true },
  { id: "grok-3-fast", name: "Grok 3 Fast" },
  { id: "grok-3-mini", name: "Grok 3 Mini", reasoning: true },
  { id: "grok-3-mini-fast", name: "Grok 3 Mini Fast", reasoning: true }
];
function buildXaiOAuthModels() {
  return XAI_OAUTH_MODEL_SEEDS.map((seed) => {
    const prefix = seed.id.split("-")[0] ?? seed.id;
    return {
      id: seed.id,
      name: seed.name,
      upstreamModelId: seed.id,
      family: prefix,
      brand: deriveBrand(prefix),
      contextWindow: resolveContextWindow(seed.id),
      modelFormat: "openai",
      npm: "@ai-sdk/xai",
      reasoning: seed.reasoning
    };
  });
}

// src/registry/refresh-models.ts
function modelInfoToCached(m, npm, apiUrl) {
  const freeStatus = classifyFreeStatus({ model: m });
  return {
    id: m.id,
    name: m.name,
    upstreamModelId: m.id,
    family: m.brand,
    brand: m.brand,
    contextWindow: m.contextWindow,
    cost: m.cost,
    isFree: m.isFree,
    freeStatus,
    modelFormat: m.modelFormat === "anthropic" ? "anthropic" : "openai",
    sourceBackend: m.sourceBackend,
    npm,
    apiUrl
  };
}
async function refreshZenGoProvider(provider) {
  const backendId = providerKind(provider.id) === "go" || provider.templateId === "go" ? "go" : "zen";
  await fetchModelsDevCache();
  const result = await getModels(BACKENDS[backendId]);
  return result.models.filter((m) => m.modelFormat !== "unsupported").map((m) => {
    const isAnthropic = m.modelFormat === "anthropic";
    const npm = isAnthropic ? "@ai-sdk/anthropic" : "@ai-sdk/openai-compatible";
    const apiUrl = isAnthropic ? BACKENDS[backendId].baseUrl : `${BACKENDS[backendId].baseUrl}/v1`;
    return modelInfoToCached(m, npm, apiUrl);
  });
}
async function refreshClaudeCodeOAuthModels(accessToken) {
  const entries2 = await fetchClaudeCodeModels(accessToken);
  const models = entries2.map((entry) => ({
    id: entry.id,
    name: entry.displayName,
    upstreamModelId: entry.id,
    family: "claude",
    brand: "Anthropic",
    contextWindow: entry.maxInputTokens ?? resolveContextWindow(entry.id),
    modelFormat: "anthropic",
    npm: "@ai-sdk/anthropic",
    apiUrl: "https://api.anthropic.com"
  }));
  return { models, source: "live" };
}
async function refreshAntigravityOAuthModels(accessToken) {
  const merged = /* @__PURE__ */ new Map();
  for (const base of ANTIGRAVITY_BASE_URLS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1e4);
      const res = await fetch(`${base}/v1internal:fetchAvailableModels`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
          "User-Agent": ANTIGRAVITY_USER_AGENT,
          "Content-Type": "application/json"
        },
        signal: controller.signal
      }).finally(() => clearTimeout(timer));
      if (!res.ok) continue;
      const body = await res.json();
      const deprecatedModelIds = body.deprecatedModelIds && typeof body.deprecatedModelIds === "object" && !Array.isArray(body.deprecatedModelIds) ? body.deprecatedModelIds : {};
      const resolveUpstreamModelId = (id) => {
        let current = id;
        const seen = /* @__PURE__ */ new Set();
        while (!seen.has(current)) {
          seen.add(current);
          const alias = deprecatedModelIds[current];
          if (!alias || typeof alias !== "object" || Array.isArray(alias)) break;
          const next = alias.newModelId;
          if (typeof next !== "string" || next.length === 0) break;
          current = next;
        }
        return current;
      };
      const raw = body.models && typeof body.models === "object" && !Array.isArray(body.models) ? Object.entries(body.models).map(([id, model]) => ({ id, ...model })) : Array.isArray(body.models) ? body.models.filter((m) => typeof m.id === "string" && m.id.length > 0) : [];
      for (const m of raw) {
        if (typeof m.id !== "string" || m.id.length === 0 || isAntigravityCloudCodeHelperSlot(m.id)) continue;
        const id = m.id;
        const name = m.displayName ?? m.name ?? id;
        const isGemini = id.startsWith("gemini");
        const isClaude = id.startsWith("claude");
        const isOpenAi = id.startsWith("gpt") || id.startsWith("o");
        const maxTokens = typeof m.maxTokens === "number" ? m.maxTokens : void 0;
        const isReasoning = m.supportsThinking === true || id.includes("thinking") || id.includes("pro") || id.includes("argon");
        const existing = merged.get(id);
        if (!existing || !existing.reasoning && isReasoning || name !== id && existing.name === id) {
          merged.set(id, {
            id,
            name,
            upstreamModelId: resolveUpstreamModelId(id),
            family: isGemini ? "gemini" : id.split("-")[0] ?? id,
            brand: isGemini ? "Google" : isClaude ? "Anthropic" : isOpenAi ? "OpenAI" : "Other",
            contextWindow: maxTokens ?? existing?.contextWindow ?? resolveContextWindow(id),
            modelFormat: "cloud-code",
            reasoning: isReasoning
          });
        }
      }
    } catch {
    }
  }
  if (merged.size > 0) {
    return { models: Array.from(merged.values()), source: "live" };
  }
  throw new Error("Antigravity live model refresh failed \u2014 Cloud Code returned no usable models");
}
function buildCopilotFreeFallback() {
  return normalizeCopilotModels([
    {
      id: "gpt-4.1",
      supported_endpoints: ["/chat/completions"],
      billing: { multiplier: 0 }
    },
    {
      id: "gpt-4o",
      supported_endpoints: ["/chat/completions"],
      billing: { multiplier: 0 }
    }
  ], "free");
}
async function refreshGithubCopilotOAuthModels(accessToken, tier) {
  const result = await fetchJsonWithAuth(
    "https://api.githubcopilot.com/models",
    accessToken,
    1e4,
    { "Editor-Version": "vscode/1.85.1" }
  );
  const body = result.body;
  const rows = Array.isArray(body) ? body : body && typeof body === "object" ? Array.isArray(body["data"]) ? body["data"] : Array.isArray(body["models"]) ? body["models"] : [] : [];
  const models = normalizeCopilotModels(rows, tier);
  if (models.length > 0) return { models, source: "live" };
  return {
    models: buildCopilotFreeFallback(),
    source: "seed",
    failureReason: result.error ?? "GitHub Copilot returned no usable chat models",
    replaceCacheOnFallback: tier !== "paid"
  };
}
async function refreshOAuthProvider(provider, accessToken) {
  const tpl = provider.templateId ?? provider.id;
  if (tpl === "openai" || tpl === "openai-oauth") return refreshOpenAiOAuthModels(accessToken);
  if (tpl === "xai" || tpl === "xai-oauth") return refreshXaiOAuthModels(accessToken);
  if (tpl === "github-copilot") {
    let providerData = await resolveProviderOAuthProviderData(provider.authRef);
    if (copilotPlanTier(providerData) === "unknown") {
      providerData = await enrichGithubCopilotOAuthProviderData(provider.authRef) ?? providerData;
    }
    return refreshGithubCopilotOAuthModels(accessToken, copilotPlanTier(providerData));
  }
  if (tpl === "claude-code") return refreshClaudeCodeOAuthModels(accessToken);
  if (tpl === "antigravity") return refreshAntigravityOAuthModels(accessToken);
  throw new Error(`refreshOAuthProvider: unsupported template "${tpl}"`);
}
function readCapabilityFlags(m) {
  const bool = (v) => typeof v === "boolean" ? v : void 0;
  return {
    useResponsesLite: bool(m["use_responses_lite"]),
    preferWebSockets: bool(m["prefer_websockets"])
  };
}
function parseOpenAiModelEntries(body) {
  if (!body || typeof body !== "object") return [];
  const b = body;
  if (Array.isArray(b.models)) {
    return b.models.map((m) => ({
      id: m.slug ?? "",
      name: m.title ?? m.name ?? m.slug ?? "",
      context_window: m.context_window,
      ...readCapabilityFlags(m)
    })).filter((m) => m.id.length > 0);
  }
  if (Array.isArray(b.data)) {
    return b.data.map((m) => ({
      id: m.id ?? "",
      name: m.name ?? m.id ?? "",
      context_window: m.context_window,
      ...readCapabilityFlags(m)
    })).filter((m) => m.id.length > 0);
  }
  return [];
}
function buildDynamicOAuthModel(entry, seedById) {
  const seed = seedById.get(entry.id);
  if (seed) {
    return {
      ...seed,
      useResponsesLite: entry.useResponsesLite ?? seed.useResponsesLite,
      preferWebSockets: entry.preferWebSockets ?? seed.preferWebSockets
    };
  }
  const { id } = entry;
  const prefix = id.split("-")[0] ?? id;
  return {
    id,
    name: entry.name,
    upstreamModelId: id,
    family: prefix,
    brand: deriveBrand(prefix),
    contextWindow: entry.context_window ?? resolveContextWindow(id),
    modelFormat: "openai",
    npm: "@ai-sdk/openai",
    reasoning: findModelsDevModel("openai-oauth", id)?.reasoning ?? modelPrefersResponsesApi(id),
    useResponsesLite: entry.useResponsesLite,
    preferWebSockets: entry.preferWebSockets
  };
}
async function fetchJsonWithAuth(url, accessToken, timeoutMs, extraHeaders = {}) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        ...extraHeaders
      },
      signal: controller.signal
    }).finally(() => clearTimeout(timer));
    if (!response.ok) {
      const detail = await response.text().then((t) => t.slice(0, 200)).catch(() => "");
      return { body: null, error: `HTTP ${response.status}${detail ? `: ${detail}` : ""}` };
    }
    return { body: await response.json() };
  } catch (err) {
    return { body: null, error: err instanceof Error ? err.message : String(err) };
  }
}
async function refreshOpenAiOAuthModels(accessToken) {
  const TIMEOUT_MS = 1e4;
  const seedById = new Map(buildOpenAiOAuthModels().map((m) => [m.id, m]));
  const toModels = (entries2) => entries2.map((entry) => buildDynamicOAuthModel(entry, seedById));
  const codexVersion = await resolveCodexClientVersion();
  const codexResult = await fetchJsonWithAuth(
    `https://chatgpt.com/backend-api/codex/models?client_version=${codexVersion}`,
    accessToken,
    TIMEOUT_MS
  );
  const codexEntries = parseOpenAiModelEntries(codexResult.body);
  if (codexEntries.length > 0) {
    return { models: toModels(codexEntries), source: "live" };
  }
  const chatGptResult = await fetchJsonWithAuth(
    "https://chatgpt.com/backend-api/models",
    accessToken,
    TIMEOUT_MS
  );
  const chatGptEntries = parseOpenAiModelEntries(chatGptResult.body).filter(({ id }) => !CHATGPT_CODEX_UNSUPPORTED_MODELS.has(id));
  if (chatGptEntries.length > 0) {
    return { models: toModels(chatGptEntries), source: "live" };
  }
  return {
    models: [...seedById.values()],
    source: "seed",
    failureReason: chatGptResult.error ?? codexResult.error
  };
}
async function refreshXaiOAuthModels(accessToken) {
  const seed = buildXaiOAuthModels();
  const seedById = new Map(seed.map((m) => [m.id, m]));
  const result = await fetchJsonWithAuth("https://api.x.ai/v1/models", accessToken, 8e3);
  if (result.body) {
    const entries2 = (result.body.data ?? []).filter((m) => !!m.id);
    if (entries2.length > 0) {
      const live = entries2.map(({ id, context_length }) => {
        const cached = seedById.get(id);
        if (cached) return cached;
        const prefix = id.split("-")[0] ?? id;
        return { id, name: id, upstreamModelId: id, family: prefix, brand: deriveBrand(prefix), contextWindow: resolveContextWindow(id, context_length), modelFormat: "openai", npm: "@ai-sdk/xai", reasoning: modelPrefersResponsesApi(id) };
      });
      return { models: live, source: "live" };
    }
  }
  return { models: seed, source: "seed", failureReason: result.error };
}
async function refreshApiListProvider(provider, apiKey) {
  const npm = provider.api.npm ?? "@ai-sdk/openai-compatible";
  const catalogTemplate = resolveProviderTemplate(provider);
  const baseUrl = effectiveProviderBaseUrl(provider, catalogTemplate);
  if (!baseUrl) {
    return { models: [], error: "Provider has no API base URL configured." };
  }
  let safeBaseUrl = baseUrl;
  const configuredUrl = provider.api.url?.trim();
  const templateDefault = catalogTemplate?.defaultBaseUrl?.trim();
  if (configuredUrl && configuredUrl !== templateDefault) {
    const urlCheck = await validateCustomEndpointUrl(baseUrl, {
      allowInsecureLocal: catalogTemplate?.apiKeyOptional === true || customEndpointKind(provider) !== null
    });
    if (!urlCheck.ok || !urlCheck.normalizedUrl) {
      return { models: [], error: `${urlCheck.error ?? "Invalid API base URL."} ${urlCheck.hint ?? ""}`.trim() };
    }
    safeBaseUrl = urlCheck.normalizedUrl;
  }
  const template = catalogTemplate ?? syntheticTemplate(provider, safeBaseUrl);
  const timeoutMs = endpointModelTimeoutMs(catalogTemplate?.id ?? "custom-openai", safeBaseUrl);
  const extraHeaders = provider.api.headers && Object.keys(provider.api.headers).length > 0 ? provider.api.headers : void 0;
  if (npm === "@ai-sdk/anthropic") {
    const fetched2 = await fetchAnthropicModels(safeBaseUrl, apiKey, extraHeaders, timeoutMs);
    if (fetched2.error || fetched2.models.length === 0) {
      return { models: [], error: fetched2.error ?? "No models returned.", baseUrl: fetched2.baseUrl };
    }
    const anthropicModels = customEndpointKind(provider) ? applyModelsDevContextWindows(fetched2.models) : fetched2.models;
    return {
      models: anthropicModels.map((m) => ({ ...m, apiUrl: fetched2.baseUrl })),
      baseUrl: fetched2.baseUrl,
      ...fetched2.incomplete ? { incomplete: fetched2.incomplete } : {}
    };
  }
  const fetched = await fetchTemplateModels(template, apiKey, safeBaseUrl, extraHeaders, timeoutMs);
  if (fetched.error || fetched.models.length === 0) {
    return { models: [], error: fetched.error ?? "No models returned." };
  }
  const usableModels = !apiKey.trim() && template.anonymousFreeModels ? fetched.models.filter((model) => isFreeStatus(classifyFreeStatus({
    model,
    providerId: provider.id,
    templateId: provider.templateId
  }))) : fetched.models;
  if (usableModels.length === 0) {
    return { models: [], error: "No free models were returned for anonymous access." };
  }
  const referencedModels = customEndpointKind(provider) ? applyModelsDevContextWindows(usableModels) : usableModels;
  return {
    models: referencedModels.map((m) => ({
      ...m,
      apiUrl: fetched.baseUrl
    })),
    baseUrl: fetched.baseUrl
  };
}
function updateProviderCache(registry, providerId, models, baseUrl) {
  const idx = registry.providers.findIndex((p) => p.id === providerId);
  if (idx < 0) return;
  const now = localIsoTimestamp();
  const currentProviders = new Map(loadRegistry().providers.map((p) => [p.id, p]));
  for (const entry of registry.providers) {
    const current = currentProviders.get(entry.id);
    if (current) entry.manualModels = current.manualModels;
  }
  const existing = registry.providers[idx];
  registry.providers[idx] = {
    ...existing,
    refreshedAt: now,
    api: baseUrl ? { ...existing.api, url: baseUrl } : existing.api,
    modelsCache: {
      fetchedAt: now,
      models
    }
  };
}
function compatibleCachedModels(provider, models) {
  if (providerKind(provider.id) !== "antigravity") return models;
  return models.filter((model) => !shouldHideModel({
    providerId: provider.id,
    modelId: model.id,
    agent: "claude"
  }));
}
async function refreshProviderModels(providerId, apiKey, registry = loadRegistry()) {
  const provider = registry.providers.find((p) => p.id === providerId);
  if (!provider) {
    return { id: providerId, name: providerId, ok: false, reason: "Provider not found." };
  }
  const source = resolveModelSource(provider);
  if (source === "manual-only") {
    const hint = provider.templateId === "google-vertex" || provider.id === "google-vertex" || provider.api.npm === "@ai-sdk/google-vertex" ? "Vertex uses gcloud credentials \u2014 use relay-ai server --vertex, or refresh after configuring ADC." : "Manual-only provider \u2014 model list is not refreshed automatically.";
    return {
      id: provider.id,
      name: provider.name,
      ok: true,
      skipped: true,
      reason: hint
    };
  }
  try {
    const previousModelCount = getAgentProviderModels(provider).length;
    let models = [];
    let baseUrl;
    let oauthFallbackReason;
    let incompleteReason;
    if (source === "zen-go-api") {
      models = await refreshZenGoProvider(provider);
    } else if (source === "vertex-models-file") {
      models = vertexAnthropicCachedModels();
    } else if (source === "commandcode") {
      const ccBaseUrl = (provider.api.url ?? COMMANDCODE_BASE_URL).replace(/\/$/, "");
      try {
        models = await fetchCommandCodeModels(ccBaseUrl, apiKey ?? void 0);
        baseUrl = ccBaseUrl;
      } catch (err) {
        if (cachedModelCount(provider) > 0) {
          return skipWithCachedModels(
            provider,
            `Command Code catalog refresh failed: ${err instanceof Error ? err.message : String(err)} Kept the existing cached model list; try again later.`
          );
        }
        throw err;
      }
    } else if (source === "cline-recommended") {
      try {
        models = await fetchClinePassModels(
          apiKey?.trim() ? { credential: apiKey.trim(), authType: provider.authType === "oauth" ? "oauth" : "api" } : void 0
        );
        baseUrl = provider.api.url ?? "https://api.cline.bot/api/v1";
      } catch (err) {
        if (cachedModelCount(provider) > 0) {
          return skipWithCachedModels(
            provider,
            `ClinePass catalog refresh failed: ${err instanceof Error ? err.message : String(err)} Kept the existing cached model list; try again later.`
          );
        }
        throw err;
      }
    } else if (provider.authType === "oauth" && (["openai", "xai", "xai-oauth", "github-copilot", "claude-code", "antigravity"].includes(provider.templateId ?? provider.id) || providerKind(provider.id) === "openai-oauth" || providerKind(provider.id) === "xai-oauth")) {
      if (!apiKey) {
        return {
          id: provider.id,
          name: provider.name,
          ok: false,
          reason: "OAuth token not available \u2014 try signing in again with relay-ai providers auth."
        };
      }
      const oauthResult = await refreshOAuthProvider(provider, apiKey);
      const failureDetail = oauthResult.failureReason ? ` (${oauthResult.failureReason})` : "";
      if (oauthResult.source === "seed" && cachedModelCount(provider) > 0 && !oauthResult.replaceCacheOnFallback) {
        return skipWithCachedModels(
          provider,
          `Live model discovery failed${failureDetail} \u2014 kept your existing cached model list instead of overwriting it with relay-ai's built-in fallback list. Try refreshing again later.`
        );
      }
      if (oauthResult.source === "seed") {
        oauthFallbackReason = `Live model discovery failed${failureDetail} \u2014 showing relay-ai's built-in fallback model list, which may not include the newest models yet. Try refreshing again later.`;
      }
      models = oauthResult.models;
      if (models.length === 0) {
        return {
          id: provider.id,
          name: provider.name,
          ok: false,
          reason: "No models available for this OAuth provider \u2014 try signing in again."
        };
      }
    } else {
      const template = resolveProviderTemplate(provider);
      const keyOptional = template?.apiKeyOptional === true;
      const effectiveKey = keyOptional && isLikelyPlaceholderKey(apiKey) ? "" : apiKey;
      if (!keyOptional && isLikelyPlaceholderKey(effectiveKey)) {
        if (cachedModelCount(provider) > 0) {
          return skipWithCachedModels(
            provider,
            "OpenCode imported a placeholder API key \u2014 kept cached model list. Add this provider again via relay-ai providers add with a real key to refresh live."
          );
        }
        return {
          id: provider.id,
          name: provider.name,
          ok: false,
          reason: "No usable API key \u2014 add the provider via relay-ai providers add with a real key."
        };
      }
      if (!keyOptional && !effectiveKey) {
        return {
          id: provider.id,
          name: provider.name,
          ok: false,
          reason: "API key not available \u2014 cannot refresh models."
        };
      }
      const fetched = await refreshApiListProvider(provider, effectiveKey ?? "");
      if (fetched.error) {
        if ((fetched.error.includes("rejected") || fetched.error.includes("401") || fetched.error.includes("403")) && cachedModelCount(provider) > 0) {
          return skipWithCachedModels(
            provider,
            `${fetched.error} Kept ${cachedModelCount(provider)} cached model${cachedModelCount(provider) === 1 ? "" : "s"} from import. Update your API key via relay-ai providers add if you need a live refresh.`
          );
        }
        return { id: provider.id, name: provider.name, ok: false, reason: fetched.error };
      }
      models = fetched.models;
      baseUrl = fetched.baseUrl;
      incompleteReason = fetched.incomplete;
    }
    const pricingCache = loadPricingCache();
    const enriched = compatibleCachedModels(
      provider,
      enrichModelsForProviderPricing(
        models,
        buildPricingIndex(pricingCache),
        provider.templateId,
        provider.id
      )
    );
    if (providerKind(provider.id) === "antigravity" && enriched.length === 0) {
      return {
        id: provider.id,
        name: provider.name,
        ok: false,
        reason: "Cloud Code returned no usable Antigravity models \u2014 kept the existing model cache."
      };
    }
    updateProviderCache(registry, providerId, enriched, baseUrl);
    saveRegistry(registry);
    enrichPricingAsync();
    return {
      id: provider.id,
      name: provider.name,
      ok: true,
      modelCount: getAgentProviderModels(registry.providers.find((p) => p.id === providerId)).length,
      previousModelCount: provider.refreshedAt ? previousModelCount : void 0,
      reason: [oauthFallbackReason, incompleteReason].filter(Boolean).join(" ") || void 0
    };
  } catch (err) {
    return {
      id: provider.id,
      name: provider.name,
      ok: false,
      reason: err instanceof Error ? err.message : String(err)
    };
  }
}
async function refreshProviderModelsBatch(providers, resolveKey, registry) {
  const keys = [];
  for (const provider of providers) keys.push(await resolveRefreshCredential(provider, resolveKey));
  const refreshed = new Array(providers.length);
  let next = 0;
  const worker = async () => {
    while (next < providers.length) {
      const index = next++;
      refreshed[index] = await refreshProviderModels(providers[index].id, keys[index], registry);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, providers.length) }, worker));
  return { refreshed };
}
async function refreshAllProviderModels(resolveKey) {
  const registry = loadRegistry();
  const opencodeKey = await readGlobalOpencodeCredential();
  if (opencodeKey) {
    let changed = false;
    if (!registry.providers.some((p) => p.id === "zen")) {
      registry.providers.push({
        id: "zen",
        templateId: "zen",
        name: "OpenCode Zen",
        enabled: true,
        authRef: "keyring:global:opencode",
        authType: "none",
        subscriptionFilter: "free",
        api: {},
        addedAt: localIsoTimestamp()
      });
      changed = true;
    }
    if (!registry.providers.some((p) => p.id === "go")) {
      registry.providers.push({
        id: "go",
        templateId: "go",
        name: "OpenCode Go",
        enabled: true,
        authRef: "keyring:global:opencode",
        authType: "none",
        subscriptionFilter: "go",
        api: {},
        addedAt: localIsoTimestamp()
      });
      changed = true;
    }
    if (changed) {
      saveRegistry(registry);
    }
  }
  const enabledProviders = registry.providers.filter((p) => p.enabled);
  return refreshProviderModelsBatch(enabledProviders, resolveKey, registry);
}

// src/registry/crud.ts
function credentialStillReferenced(authRef, remaining) {
  return remaining.some((p) => p.authRef === authRef);
}
async function removeProviderFromRegistry(id, opts) {
  const registry = loadRegistry();
  const index = registry.providers.findIndex((p) => p.id === id);
  if (index < 0) {
    return { removed: false, id, credentialDeleted: false, error: `Provider not found: ${id}` };
  }
  const [removedProvider] = registry.providers.splice(index, 1);
  saveRegistry(registry);
  let credentialDeleted = false;
  if (opts?.deleteCredential !== false) {
    const parsed = parseAuthRef(removedProvider.authRef);
    const shouldDelete = !credentialStillReferenced(removedProvider.authRef, registry.providers);
    if (shouldDelete && parsed?.kind === "keyring") {
      credentialDeleted = await deleteProviderCredential(removedProvider.authRef);
    }
  }
  return {
    removed: true,
    id,
    name: removedProvider.name,
    credentialDeleted
  };
}
function renameProvider(id, newName) {
  const registry = loadRegistry();
  const provider = registry.providers.find((p) => p.id === id);
  if (!provider) return { renamed: false, id, error: `Provider not found: ${id}` };
  const invalid = validateProviderName(newName);
  if (invalid) return { renamed: false, id, error: invalid };
  const name = normalizeProviderName(newName);
  if (name === provider.name) return { renamed: false, id, error: "Nothing to change." };
  const clash = findProviderNameConflict(registry.providers, name, id);
  if (clash) {
    return { renamed: false, id, error: `The name "${clash.name}" is already used by another provider.` };
  }
  provider.name = name;
  provider.nameCustomized = true;
  saveRegistry(registry);
  return { renamed: true, id, name };
}
function setModelHidden(providerId, modelId, hidden) {
  const registry = loadRegistry();
  const provider = registry.providers.find((p) => p.id === providerId);
  if (!provider) return { ok: false, error: `Provider not found: ${providerId}` };
  if (!getProviderModels(provider).some((m) => m.id === modelId)) {
    return { ok: false, error: `Model not found: ${modelId}` };
  }
  const ids = new Set(provider.hiddenModelIds ?? []);
  if (hidden) ids.add(modelId);
  else ids.delete(modelId);
  if (ids.size > 0) provider.hiddenModelIds = [...ids];
  else delete provider.hiddenModelIds;
  saveRegistry(registry);
  return { ok: true, hidden };
}
function setModelsHidden(providerId, modelIds, hidden) {
  const registry = loadRegistry();
  const provider = registry.providers.find((p) => p.id === providerId);
  if (!provider) return { ok: false, error: `Provider not found: ${providerId}` };
  const known = new Set(getProviderModels(provider).map((m) => m.id));
  const ids = new Set(provider.hiddenModelIds ?? []);
  let changed = 0;
  for (const id of modelIds) {
    if (!known.has(id) || ids.has(id) === hidden) continue;
    if (hidden) ids.add(id);
    else ids.delete(id);
    changed++;
  }
  if (changed === 0) return { ok: true, changed };
  if (ids.size > 0) provider.hiddenModelIds = [...ids];
  else delete provider.hiddenModelIds;
  saveRegistry(registry);
  return { ok: true, changed };
}
function setModelNotChat(providerId, modelId, notChat) {
  const registry = loadRegistry();
  const provider = registry.providers.find((p) => p.id === providerId);
  if (!provider) return;
  const nonChat = new Set(provider.nonChatModelIds ?? []);
  const chat = new Set(provider.chatModelIds ?? []);
  if (nonChat.has(modelId) === notChat && chat.has(modelId) === !notChat) return;
  if (notChat) {
    nonChat.add(modelId);
    chat.delete(modelId);
  } else {
    nonChat.delete(modelId);
    chat.add(modelId);
  }
  if (nonChat.size > 0) provider.nonChatModelIds = [...nonChat];
  else delete provider.nonChatModelIds;
  if (chat.size > 0) provider.chatModelIds = [...chat];
  else delete provider.chatModelIds;
  saveRegistry(registry);
}
function setModelKindOverride(providerId, modelId, kind) {
  const registry = loadRegistry();
  const provider = registry.providers.find((p) => p.id === providerId);
  if (!provider) return { ok: false, error: `Provider not found: ${providerId}` };
  if (!getProviderModels(provider).some((m) => m.id === modelId)) return { ok: false, error: `Model not found: ${modelId}` };
  if (kind !== null && !MODEL_KINDS.includes(kind)) return { ok: false, error: `Unknown model type: ${kind}` };
  const kinds = { ...provider.modelKindOverrides ?? {} };
  if (kind === null) delete kinds[modelId];
  else kinds[modelId] = kind;
  if (Object.keys(kinds).length > 0) provider.modelKindOverrides = kinds;
  else delete provider.modelKindOverrides;
  saveRegistry(registry);
  return { ok: true };
}
function setContextWindowOverride(providerId, modelId, contextWindow2, source = "user") {
  const registry = loadRegistry();
  const provider = registry.providers.find((p) => p.id === providerId);
  if (!provider) return { ok: false, error: `Provider not found: ${providerId}` };
  if (!getProviderModels(provider).some((m) => m.id === modelId)) {
    return { ok: false, error: `Model not found: ${modelId}` };
  }
  const overrides = { ...provider.contextWindowOverrides ?? {} };
  if (contextWindow2 === null) {
    delete overrides[modelId];
  } else {
    if (!isValidContextWindow(contextWindow2)) {
      return { ok: false, error: `Context size must be a whole number between ${MIN_CONTEXT_WINDOW_OVERRIDE.toLocaleString("en-US")} and ${MAX_CONTEXT_WINDOW_OVERRIDE.toLocaleString("en-US")} tokens.` };
    }
    if (source === "measured" && overrides[modelId]?.source === "user") {
      return { ok: true, contextWindow: overrides[modelId].contextWindow, source: "user" };
    }
    overrides[modelId] = { contextWindow: contextWindow2, source };
  }
  if (Object.keys(overrides).length > 0) provider.contextWindowOverrides = overrides;
  else delete provider.contextWindowOverrides;
  saveRegistry(registry);
  return contextWindow2 === null ? { ok: true, contextWindow: null } : { ok: true, contextWindow: contextWindow2, source };
}
function addZenRegistryStub(opts) {
  const registry = loadRegistry();
  if (registry.providers.some((p) => p.id === "zen")) {
    return { added: false, reason: "OpenCode Zen is already configured." };
  }
  registry.providers.push(zenRegistryStub(opts?.subscriptionFilter));
  saveRegistry(registry);
  return { added: true };
}
function addGoRegistryStub() {
  const registry = loadRegistry();
  if (registry.providers.some((p) => p.id === "go")) {
    return { added: false, reason: "OpenCode Go is already configured." };
  }
  registry.providers.push(goRegistryStub());
  saveRegistry(registry);
  return { added: true };
}
async function ensureOpencodeCloudProviders(hasOpencodeKey) {
  const hasKey = hasOpencodeKey ? await hasOpencodeKey() : Boolean(await readGlobalOpencodeCredential());
  if (!hasKey) return { seeded: false, refreshed: [] };
  const zenAdded = addZenRegistryStub({ subscriptionFilter: "free" }).added;
  const goAdded = addGoRegistryStub().added;
  const seeded = zenAdded || goAdded;
  const refreshed = [];
  for (const id of ["zen", "go"]) {
    const registry = loadRegistry();
    const provider = registry.providers.find((p) => p.id === id);
    if (!provider || (provider.modelsCache?.models.length ?? 0) > 0) continue;
    const key = await resolveProviderCredential(provider.id, provider.authRef);
    const result = await refreshProviderModels(provider.id, key, registry);
    if (result.ok && !result.skipped) refreshed.push(id);
  }
  return { seeded, refreshed };
}
async function addOpencodeCloudFromApiKey(apiKey, opts) {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    return { added: false, error: "API key cannot be empty." };
  }
  if (opts?.addAccount) return addOpencodeCloudAccount(trimmed);
  const saved = await saveToCredentialStore(trimmed);
  if (!saved) {
    return {
      added: false,
      error: "Could not save API key.",
      hint: "Ensure RELAY_AI_HOME is writable (Docker uses secrets.json when no OS keyring)."
    };
  }
  process.env["OPENCODE_API_KEY"] = trimmed;
  const zenStub = addZenRegistryStub();
  const goStub = addGoRegistryStub();
  if (!zenStub.added && !goStub.added) {
    return {
      added: false,
      error: "OpenCode Zen / Go is already configured.",
      hint: "Remove zen or go first, or use Refresh on the provider cards."
    };
  }
  const registry = loadRegistry();
  const refreshResults = [
    await refreshProviderModels("zen", trimmed, registry),
    await refreshProviderModels("go", trimmed, registry)
  ];
  const modelCount = refreshResults.reduce((total, result) => total + (result.modelCount ?? 0), 0);
  const failed = refreshResults.filter((result) => !result.ok);
  return {
    added: true,
    modelCount,
    ...failed.length > 0 ? {
      hint: `Providers added, but ${failed.length} catalog refresh${failed.length === 1 ? "" : "es"} failed \u2014 try Refresh on the provider card.`
    } : {}
  };
}
async function addOpencodeCloudAccount(key) {
  const registry = loadRegistry();
  for (const other of registry.providers) {
    const kind = providerKind(other.id);
    if (kind !== "zen" && kind !== "go") continue;
    if (await resolveProviderCredential(other.id, other.authRef) === key) {
      return {
        added: false,
        error: `This key is already saved as "${other.name}".`,
        hint: 'Use "Change API key" on that provider, or add a different key.'
      };
    }
  }
  const taken = new Set(registry.providers.map((p) => p.id));
  let n = 2;
  while (taken.has(`zen-${n}`) || taken.has(`go-${n}`)) n++;
  const authRef = `keyring:provider:opencode-${n}`;
  const zenName = uniqueProviderName(registry.providers, "OpenCode Zen");
  const goName = uniqueProviderName(registry.providers, "OpenCode Go");
  if (!await saveProviderCredential(authRef, key)) {
    return {
      added: false,
      error: "Could not save API key.",
      hint: "Ensure RELAY_AI_HOME is writable (Docker uses secrets.json when no OS keyring)."
    };
  }
  registry.providers.push(
    zenRegistryStub(void 0, { id: `zen-${n}`, name: zenName, authRef, nameCustomized: true }),
    goRegistryStub({ id: `go-${n}`, name: goName, authRef, nameCustomized: true })
  );
  saveRegistry(registry);
  const fresh = loadRegistry();
  const refreshResults = [
    await refreshProviderModels(`zen-${n}`, key, fresh),
    await refreshProviderModels(`go-${n}`, key, fresh)
  ];
  const failed = refreshResults.filter((result) => !result.ok);
  return {
    added: true,
    modelCount: refreshResults.reduce((total, result) => total + (result.modelCount ?? 0), 0),
    addedNames: [zenName, goName],
    ...failed.length > 0 ? {
      hint: `Accounts added, but ${failed.length} catalog refresh${failed.length === 1 ? "" : "es"} failed \u2014 try Refresh on the provider card.`
    } : {}
  };
}
function toggleProviderEnabled(id) {
  const registry = loadRegistry();
  const provider = registry.providers.find((p) => p.id === id);
  if (!provider) return { toggled: false, error: `Provider not found: ${id}` };
  provider.enabled = !provider.enabled;
  saveRegistry(registry);
  return { toggled: true, enabled: provider.enabled };
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

export {
  zenRegistryStub,
  UNTRUSTED_CERTIFICATE_CODE,
  isSystemCaSupported,
  isSystemCaActive,
  applySystemCaTrust,
  revertSystemCaTrust,
  TRUST_SYSTEM_CERTS_NOTICE,
  endpointModelTimeoutMs,
  fetchAnthropicModels,
  fetchTemplateModels,
  resolveProviderTemplate,
  effectiveProviderBaseUrl,
  syntheticTemplate,
  resolveModelSource,
  OPENCODE_SESSION_HEADER,
  extractConversationId,
  mergeHeaders,
  openCodeGoHeaders,
  customEndpointKind,
  addCustomEndpointProvider,
  updateCustomEndpointProvider,
  filterModelsByAvailability,
  fetchClinePassModels,
  validateClinePassApiKey,
  COMMANDCODE_BASE_URL,
  fetchCommandCodeModels,
  refreshProviderModels,
  refreshProviderModelsBatch,
  refreshAllProviderModels,
  removeProviderFromRegistry,
  renameProvider,
  setModelHidden,
  setModelsHidden,
  setModelNotChat,
  setModelKindOverride,
  setContextWindowOverride,
  ensureOpencodeCloudProviders,
  addOpencodeCloudFromApiKey,
  toggleProviderEnabled
};
//# sourceMappingURL=chunk-42QGKQ3H.js.map