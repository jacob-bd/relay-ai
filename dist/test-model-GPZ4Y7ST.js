#!/usr/bin/env node
import {
  mergeHeaders,
  openCodeGoHeaders
} from "./chunk-IGBLHT37.js";
import {
  normalizeToolSchemaForNpm,
  upstreamHttpStatus
} from "./chunk-FKGBGJZK.js";
import {
  TEST_MAX_OUTPUT_TOKENS,
  cachedModelToLocal,
  providerRefreshToken,
  reconcileCachedModelProtocol,
  setContextWindowOverride,
  setModelNotChat
} from "./chunk-6IT5C4N6.js";
import {
  ANTIGRAVITY_API_VERSION,
  ANTIGRAVITY_BASE_URLS,
  ANTIGRAVITY_USER_AGENT,
  REGISTRY_SCHEMA_VERSION,
  createLanguageModel,
  deepMergeProviderOptions,
  effortProviderOptions,
  getProviderModels,
  getReasoningCapabilities,
  isProviderKind,
  isValidProviderId,
  loadRegistry,
  providerKind,
  resolveModelReasoningMetadata,
  resolveProviderCredential,
  resolveProviderOAuthAccountId,
  resolveProviderOAuthProviderData,
  withProviderRequestDefaults
} from "./chunk-IKGOSD5H.js";
import {
  getTemplateById,
  init_provider_templates
} from "./chunk-RKRPDZVV.js";
import "./chunk-KNCSTHR4.js";
import "./chunk-JIDIH7DS.js";

// src/test-model.ts
import { randomUUID as randomUUID2 } from "crypto";
import { streamText, tool, jsonSchema } from "ai";

// src/core/model.ts
init_provider_templates();

// src/core/antigravity-model.ts
import { randomUUID } from "crypto";

// src/core/antigravity-diagnostics.ts
import { createHash } from "crypto";
var SECTION_NAMES = ["systemInstruction", "tools", "toolConfig", "generationConfig"];
var USAGE_NAMES = ["promptTokenCount", "cachedContentTokenCount", "thoughtsTokenCount"];
function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function requestFingerprint(value) {
  const body = record(value);
  const sections = Object.fromEntries(SECTION_NAMES.map((name) => {
    const text = JSON.stringify(body[name]);
    return [name, text === void 0 ? { present: false } : {
      present: true,
      bytes: Buffer.byteLength(text),
      hash: createHash("sha256").update(text).digest("hex").slice(0, 32)
    }];
  }));
  const prefix = createHash("sha256");
  const contents = (Array.isArray(body.contents) ? body.contents : []).map((item) => {
    const text = JSON.stringify(item);
    const bytes = Buffer.byteLength(text);
    prefix.update(`${bytes}:`).update(text);
    return { bytes, prefixHash: prefix.copy().digest("hex").slice(0, 32) };
  });
  const tools = Array.isArray(body.tools) ? body.tools : [];
  return {
    // Unknown property names can contain caller data. Keep their position but hide their names.
    keyOrder: Object.keys(body).map((key) => [...SECTION_NAMES, "contents", "safetySettings", "cachedContent", "labels"].includes(key) ? key : "[other]"),
    sections,
    contents,
    contentsCount: contents.length,
    toolCount: tools.reduce((count, tool2) => {
      const declarations = record(tool2).functionDeclarations;
      return count + (Array.isArray(declarations) ? declarations.length : 0);
    }, 0)
  };
}
function observeCloudCodeBody(body, streaming, log, startedAt, signal) {
  const decoder = new TextDecoder();
  let pending = "";
  let usage;
  let firstBodyByteMs = null;
  let finished = false;
  const inspect = (text) => {
    try {
      const parsed = record(JSON.parse(text));
      const response = "response" in parsed ? record(parsed.response) : parsed;
      if (response.usageMetadata && typeof response.usageMetadata === "object") {
        usage = record(response.usageMetadata);
      }
    } catch {
    }
  };
  const inspectEvent = (event) => {
    const data = event.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    if (data) inspect(data);
  };
  const scan = (chunk) => {
    pending += chunk ? decoder.decode(chunk, { stream: true }) : decoder.decode();
    if (!streaming) {
      if (!chunk) inspect(pending);
      return;
    }
    while (true) {
      const separator = /\r?\n\r?\n/.exec(pending);
      if (!separator) break;
      inspectEvent(pending.slice(0, separator.index));
      pending = pending.slice(separator.index + separator[0].length);
    }
    if (!chunk && pending) inspectEvent(pending);
  };
  const finish = (outcome) => {
    if (finished) return;
    finished = true;
    signal?.removeEventListener("abort", onAbort);
    log(`end ${JSON.stringify({
      outcome,
      elapsedMs: performance.now() - startedAt,
      firstBodyByteMs,
      usageMetadataPresent: usage !== void 0,
      usage: Object.fromEntries(USAGE_NAMES.map((name) => {
        if (!usage || !Object.hasOwn(usage, name)) return [name, { present: false }];
        const value = usage[name];
        return [name, typeof value === "number" && Number.isFinite(value) ? { present: true, value } : { present: true, valid: false }];
      }))
    })}`);
    pending = "";
  };
  const onAbort = () => finish("cancelled");
  if (!body) {
    finish("completed");
    return null;
  }
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  const reader = body.getReader();
  return new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await reader.read();
        if (done) {
          if (!finished) scan();
          finish("completed");
          reader.releaseLock();
          controller.close();
        } else {
          if (!finished) {
            firstBodyByteMs ??= performance.now() - startedAt;
            scan(value);
          }
          controller.enqueue(value);
        }
      } catch (err) {
        finish(signal?.aborted ? "cancelled" : "failed");
        reader.releaseLock();
        controller.error(err);
      }
    },
    async cancel(reason) {
      finish("cancelled");
      try {
        await reader.cancel(reason);
      } finally {
        reader.releaseLock();
      }
    }
  }, { highWaterMark: 0 });
}

// src/core/antigravity-model.ts
var CLOUD_CODE_BASES = ANTIGRAVITY_BASE_URLS.map((base) => base.replace(/\/+$/, ""));
var CLOUD_CODE_BASE = CLOUD_CODE_BASES[0];
var STREAM_URLS = CLOUD_CODE_BASES.map((base) => `${base}/${ANTIGRAVITY_API_VERSION}:streamGenerateContent?alt=sse`);
var UNARY_URLS = CLOUD_CODE_BASES.map((base) => `${base}/${ANTIGRAVITY_API_VERSION}:generateContent`);
var SDK_BASE_URL = `${CLOUD_CODE_BASE}/v1beta`;
var ENDPOINT_FAILOVER_STATUSES = /* @__PURE__ */ new Set([404, 408, 429]);
function shouldTryNextEndpoint(status) {
  return ENDPOINT_FAILOVER_STATUSES.has(status) || status >= 500;
}
function discardResponse(response) {
  try {
    void response.body?.cancel();
  } catch {
  }
}
function unwrapCloudCodeSsePayload(payload) {
  const trimmed = payload.trim();
  if (trimmed === "" || trimmed === "[DONE]") return payload;
  try {
    const parsed = JSON.parse(trimmed);
    if (isWrappedCloudCodeBody(parsed)) {
      return JSON.stringify(parsed.response);
    }
  } catch {
  }
  return payload;
}
function unwrapCloudCodeJsonBody(text) {
  try {
    const parsed = JSON.parse(text);
    if (isWrappedCloudCodeBody(parsed)) {
      return JSON.stringify(parsed.response);
    }
  } catch {
  }
  return text;
}
function consumeCloudCodeSseBuffer(buffer) {
  const separator = /\r?\n\r?\n/;
  let rest = buffer;
  let emitted = "";
  while (true) {
    const match = separator.exec(rest);
    if (!match || match.index === void 0) break;
    const rawEvent = rest.slice(0, match.index);
    const sep = match[0];
    rest = rest.slice(match.index + sep.length);
    emitted += transformSseEvent(rawEvent) + sep;
  }
  return { emitted, rest };
}
function createCloudCodeSseUnwrapper() {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = "";
  return new TransformStream({
    transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true });
      const { emitted, rest } = consumeCloudCodeSseBuffer(pending);
      pending = rest;
      if (emitted) controller.enqueue(encoder.encode(emitted));
    },
    flush(controller) {
      pending += decoder.decode();
      if (!pending) return;
      const { emitted, rest } = consumeCloudCodeSseBuffer(pending);
      const tail = emitted + (rest ? transformSseEvent(rest) : "");
      if (tail) controller.enqueue(encoder.encode(tail));
    }
  });
}
function createCloudCodeFetch(options, fetchImpl) {
  let accessToken = options.accessToken;
  return async (input, init) => {
    const startedAt = options.onDebug ? performance.now() : 0;
    const diagnosticId = options.onDebug ? randomUUID() : "";
    let attempt = 0;
    const debug = (msg) => {
      try {
        options.onDebug?.(`cloud-code: call=${diagnosticId} attempt=${attempt} ${msg}`);
      } catch {
      }
    };
    const url = requestUrl(input);
    const streaming = url.includes("streamGenerateContent");
    const signal = init?.signal ?? (input instanceof Request ? input.signal : void 0);
    const geminiBody = await readJsonBody(input, init);
    if (options.onDebug) debug(`fingerprint ${JSON.stringify(requestFingerprint(geminiBody))}`);
    const envelope = {
      project: options.projectId,
      requestId: randomUUID(),
      model: options.modelId,
      userAgent: ANTIGRAVITY_USER_AGENT,
      requestType: "agent",
      enabledCreditTypes: ["GOOGLE_ONE_AI"],
      request: geminiBody
    };
    const body = JSON.stringify(envelope);
    const bodyByteLength = Buffer.byteLength(body, "utf8");
    const upstreamUrls = streaming ? STREAM_URLS : UNARY_URLS;
    const doFetch = fetchImpl ?? options.fetchImpl ?? ((input2, init2) => globalThis.fetch(input2, init2));
    const send = async (url2, token) => {
      try {
        return await doFetch(url2, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "User-Agent": ANTIGRAVITY_USER_AGENT
          },
          body,
          signal
        });
      } catch (err) {
        if (isAbortError(err, signal)) throw abortError(signal, err);
        throw err;
      }
    };
    const sendWithFailover = async (token, startIndex = 0) => {
      let lastError;
      for (let i = startIndex; i < upstreamUrls.length; i += 1) {
        attempt += 1;
        const attemptStartedAt = options.onDebug ? performance.now() : 0;
        const url2 = upstreamUrls[i];
        const isLast = i === upstreamUrls.length - 1;
        const where = `endpoint=${i + 1}/${upstreamUrls.length} host=${endpointHost(url2)}`;
        let response2;
        try {
          debug(`request ${where} kind=${streaming ? "stream" : "unary"} payloadBytes=${bodyByteLength}`);
          response2 = await send(url2, token);
          if (options.onDebug) debug(`timing ${where} headersMs=${performance.now() - attemptStartedAt} sendMs=${attemptStartedAt - startedAt} httpVersion=unavailable socketReused=unavailable`);
        } catch (err) {
          if (isAbortError(err, signal)) {
            debug('end {"outcome":"cancelled","phase":"fetch"}');
            throw err;
          }
          lastError = err;
          debug(`network failure ${where} errorName=${errorName(err)}`);
        }
        if (response2) {
          if (isLast || !shouldTryNextEndpoint(response2.status)) {
            debug(`response ${where} status=${response2.status}`);
            return { response: response2, url: url2, index: i };
          }
          discardResponse(response2);
          lastError = new Error(`Cloud Code Assist endpoint returned ${response2.status}`);
          debug(`retryable status=${response2.status} ${where} \u2014 trying next endpoint`);
        }
        if (signal?.aborted) {
          debug('end {"outcome":"cancelled","phase":"fetch"}');
          throw abortError(signal);
        }
      }
      debug('end {"outcome":"failed","phase":"fetch"}');
      throw lastError ?? new Error("All Cloud Code Assist endpoints failed");
    };
    const tokenUsed = accessToken;
    let { response, index: servedByIndex } = await sendWithFailover(tokenUsed);
    if (response.status === 401 && options.refreshToken && !signal?.aborted) {
      debug("status=401 \u2014 refreshing credential");
      const refreshed = await options.refreshToken().catch(() => null);
      if (refreshed && refreshed !== tokenUsed && !signal?.aborted) {
        accessToken = refreshed;
        discardResponse(response);
        ({ response } = await sendWithFailover(refreshed, servedByIndex));
        debug(`retry after refresh status=${response.status}`);
      } else {
        debug(`refresh did not yield a new credential (refreshed=${refreshed ? "same" : "none"})`);
      }
    }
    if (options.onDebug) {
      const observed = observeCloudCodeBody(response.body, streaming && response.ok, debug, startedAt, signal);
      response = new Response(observed, { status: response.status, statusText: response.statusText, headers: response.headers });
    }
    return adaptUpstreamResponse(response, streaming);
  };
}
async function createAntigravityCloudCodeModel(options) {
  const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
  const google = createGoogleGenerativeAI({
    apiKey: "relay-cloud-code",
    baseURL: SDK_BASE_URL,
    fetch: createCloudCodeFetch(options)
  });
  return withProviderRequestDefaults(google(options.modelId), {
    npm: "@ai-sdk/google",
    modelId: options.modelId,
    apiKey: options.accessToken
  });
}
function endpointHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return "unknown";
  }
}
function errorName(err) {
  if (err instanceof Error) return err.name || "Error";
  return typeof err;
}
function isWrappedCloudCodeBody(parsed) {
  return !!parsed && typeof parsed === "object" && !Array.isArray(parsed) && "response" in parsed && parsed.response !== null && typeof parsed.response === "object";
}
function transformSseEvent(event) {
  return event.replace(/^(data:[ \t]*)(.*)$/gm, (_all, prefix, payload) => `${prefix}${unwrapCloudCodeSsePayload(payload)}`);
}
function requestUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}
async function readJsonBody(input, init) {
  const body = init?.body;
  if (typeof body === "string") return JSON.parse(body);
  if (body instanceof Uint8Array) return JSON.parse(new TextDecoder().decode(body));
  if (body instanceof ArrayBuffer) return JSON.parse(new TextDecoder().decode(body));
  const request = input instanceof Request ? input.clone() : new Request(input, init);
  return request.json();
}
async function adaptUpstreamResponse(upstream, streaming) {
  const fallbackType = streaming ? "text/event-stream" : "application/json";
  const contentType = upstream.headers.get("content-type") ?? fallbackType;
  const headers = new Headers({ "Content-Type": contentType });
  if (!upstream.ok) {
    const errBody = await upstream.text();
    return new Response(errBody, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers
    });
  }
  if (streaming) {
    const body = upstream.body ? upstream.body.pipeThrough(createCloudCodeSseUnwrapper()) : null;
    return new Response(body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers
    });
  }
  const text = await upstream.text();
  headers.set("Content-Type", "application/json");
  return new Response(unwrapCloudCodeJsonBody(text), { status: 200, headers });
}
function isAbortError(err, signal) {
  if (signal?.aborted) return true;
  return !!err && typeof err === "object" && err.name === "AbortError";
}
function abortError(signal, cause) {
  if (signal?.reason instanceof Error) return signal.reason;
  if (cause instanceof Error) return cause;
  return new DOMException("This operation was aborted", "AbortError");
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

// src/core/model.ts
async function withPortableToolSchemas(model, npm) {
  const { wrapLanguageModel } = await import("ai");
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: "v4",
      transformParams: async ({ params }) => {
        const tools = params.tools;
        if (!tools?.length) return params;
        let changed = false;
        const next = tools.map((entry) => {
          if (entry.type !== "function" || !entry.inputSchema || typeof entry.inputSchema !== "object") return entry;
          const inputSchema = normalizeToolSchemaForNpm(entry.inputSchema, npm);
          if (inputSchema === entry.inputSchema) return entry;
          changed = true;
          return { ...entry, inputSchema };
        });
        return changed ? { ...params, tools: next } : params;
      }
    }
  });
}
function isAntigravityCloudCodeRoute(provider, model) {
  return isProviderKind(provider.id, "antigravity") && provider.authType === "oauth" && model.modelFormat === "cloud-code";
}
function findRoute(registry, providerId, modelId, routeId) {
  const provider = registry.providers.find((p) => p.id === providerId);
  if (!provider) {
    throw new RelayCoreError("ROUTE_NOT_FOUND", `No provider registered with id "${providerId}".`, { providerId, routeId });
  }
  if (!provider.enabled) {
    throw new RelayCoreError("PROVIDER_DISABLED", `Provider "${provider.name}" is disabled \u2014 enable it in relay-ai ui.`, { providerId, routeId });
  }
  const model = getProviderModels(provider).find((m) => m.id === modelId);
  if (!model) {
    throw new RelayCoreError("UNSUPPORTED_MODEL", `Provider "${provider.name}" has no cached model "${modelId}" \u2014 refresh its models in relay-ai ui.`, { providerId, routeId });
  }
  return { provider, model };
}
async function resolveCredential(provider, routeId) {
  try {
    const credential = await resolveProviderCredential(provider.id, provider.authRef);
    if (credential) return credential;
    if (provider.authType === "none") return "";
    const template = getTemplateById(providerKind(provider.id));
    if (template?.apiKeyOptional) return "";
    throw new RelayCoreError(
      "CREDENTIAL_UNAVAILABLE",
      `No credential available for provider "${provider.name}" \u2014 re-authenticate in relay-ai ui.`,
      { providerId: provider.id, routeId }
    );
  } catch (err) {
    if (isRelayCoreError(err)) throw err;
    if (provider.authType === "oauth") {
      throw new RelayCoreError(
        "OAUTH_REFRESH_FAILED",
        `OAuth token refresh failed for provider "${provider.name}" \u2014 re-authenticate in relay-ai ui.`,
        { providerId: provider.id, routeId, cause: err }
      );
    }
    throw new RelayCoreError(
      "PROVIDER_LOAD_FAILED",
      `Failed to resolve the credential for provider "${provider.name}".`,
      { providerId: provider.id, routeId, cause: err }
    );
  }
}
async function createRelayModel(routeId, options) {
  const { providerId, modelId } = parseRelayRouteId(routeId);
  const registry = loadCoreRegistry();
  const found = findRoute(registry, providerId, modelId, routeId);
  const provider = found.provider;
  const model = reconcileCachedModelProtocol(found.model, provider);
  const reasoningOptions = options?.reasoning === void 0 ? void 0 : resolveReasoningProviderOptions(options.reasoning, provider, model, routeId);
  const transportHeaders = openCodeGoHeaders(
    provider.id,
    model.apiUrl ?? provider.api.url,
    options?.sessionId,
    provider.api.headers,
    // The returned model may be reused across conversations, so never fabricate a
    // session here — a baked-in id would blend histories. The host passes sessionId.
    { generateFallbackSession: false }
  );
  const finish = async (built, schemaNpm) => {
    let finished = await withPortableToolSchemas(built, schemaNpm);
    if (reasoningOptions) finished = await withReasoningProviderOptions(finished, reasoningOptions);
    if (transportHeaders) finished = await withRequestHeaders(finished, transportHeaders);
    return finished;
  };
  if (isAntigravityCloudCodeRoute(provider, model)) {
    const apiKey2 = await resolveCredential(provider, routeId);
    const providerData2 = await resolveProviderOAuthProviderData(provider.authRef);
    const projectId = typeof providerData2?.projectId === "string" ? providerData2.projectId.trim() : "";
    if (!projectId) {
      throw new RelayCoreError(
        "CREDENTIAL_UNAVAILABLE",
        `Provider "${provider.name}" is missing project metadata \u2014 re-authenticate in relay-ai ui.`,
        { providerId: provider.id, routeId }
      );
    }
    try {
      return await finish(await createAntigravityCloudCodeModel({
        modelId: model.upstreamModelId ?? model.id,
        accessToken: apiKey2,
        projectId,
        refreshToken: providerRefreshToken(provider.id, provider.authType, provider.authRef),
        ...options?.onDebug ? { onDebug: options.onDebug } : {},
        ...options?.fetchImpl ? { fetchImpl: options.fetchImpl } : {}
      }), reasoningNpmForRoute(provider, model));
    } catch (err) {
      if (isRelayCoreError(err)) throw err;
      throw new RelayCoreError(
        "PROVIDER_LOAD_FAILED",
        `Failed to construct model "${modelId}" for provider "${provider.name}".`,
        { providerId, routeId, cause: err }
      );
    }
  }
  const npm = model.npm ?? provider.api.npm;
  if (!npm) {
    throw new RelayCoreError("UNSUPPORTED_MODEL", `Model "${modelId}" has no SDK provider package \u2014 refresh the provider's models in relay-ai ui.`, { providerId, routeId });
  }
  const apiKey = await resolveCredential(provider, routeId);
  let oauthAccountId;
  let providerData;
  if (provider.authType === "oauth") {
    oauthAccountId = await resolveProviderOAuthAccountId(provider.authRef);
    providerData = await resolveProviderOAuthProviderData(provider.authRef);
  }
  const spec = {
    npm,
    modelId: model.upstreamModelId ?? model.id,
    apiKey,
    baseURL: model.apiUrl ?? provider.api.url,
    providerId: provider.id,
    authType: provider.authType,
    oauthAccountId,
    providerData,
    headers: provider.api.headers,
    refreshToken: providerRefreshToken(provider.id, provider.authType, provider.authRef),
    useResponsesLite: model.useResponsesLite,
    preferWebSockets: model.preferWebSockets,
    ...options?.sessionId ? { sessionId: options.sessionId } : {},
    ...options?.onDebug ? { onDebug: options.onDebug } : {}
  };
  try {
    return await finish(await createLanguageModel(spec), npm);
  } catch (err) {
    if (isRelayCoreError(err)) throw err;
    throw new RelayCoreError(
      "PROVIDER_LOAD_FAILED",
      `Failed to construct model "${modelId}" for provider "${provider.name}".`,
      { providerId, routeId, cause: err }
    );
  }
}

// src/test-model.ts
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
    const model = await createRelayModel(`${providerId}::${modelId}`, { sessionId: `relay-test-${randomUUID2()}` });
    const result = streamText({
      model,
      prompt: "Reply with OK.",
      maxOutputTokens: CONTEXT_PROBE_MAX_TOKENS,
      maxRetries: 0,
      abortSignal: AbortSignal.any([signal, controller.signal]),
      onError: () => {
      }
    });
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
async function checkContextWindow(providerId, modelId, signal) {
  const timeout = AbortSignal.timeout(2e4);
  const probe = await probeModel(providerId, modelId, signal ? AbortSignal.any([signal, timeout]) : timeout);
  const measured = probe.limit;
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
async function testModel(providerId, modelId, signal) {
  const provider = loadRegistry().providers.find((p) => p.id === providerId);
  if (!provider?.enabled || !getProviderModels(provider).some((m) => m.id === modelId)) {
    return { ok: false, error: "Model is no longer available. Refresh this provider." };
  }
  const started = Date.now();
  const timeout = AbortSignal.timeout(3e4);
  const abortSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const model = await createRelayModel(`${providerId}::${modelId}`, { sessionId: `relay-test-${randomUUID2()}` });
    abortSignal.throwIfAborted();
    const result = streamText({
      model,
      prompt: 'Say OK, then call relay_pool_probe with value "ok".',
      maxOutputTokens: TEST_MAX_OUTPUT_TOKENS,
      tools: { relay_pool_probe: tool({
        description: "Harmless capability check; never executed.",
        inputSchema: jsonSchema({ type: "object", properties: { value: { type: "string", enum: ["ok"] } }, required: ["value"], additionalProperties: false })
      }) },
      maxRetries: 0,
      abortSignal,
      onError: () => {
      }
    });
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
  parseContextLimit,
  probeModel,
  testModel
};
//# sourceMappingURL=test-model-GPZ4Y7ST.js.map