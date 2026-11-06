#!/usr/bin/env node
import {
  DEFAULT_POOL_LIMITS,
  MAX_POOL_ATTEMPTS,
  POOL_MAX_TOOLS,
  PoolAttemptError,
  PoolSessionRoutes,
  dispatchFreePool,
  lazyPoolRoute,
  poolOutputCap,
  poolRequestFitsWindow,
  poolRouteFromStream,
  poolRouteKey
} from "./chunk-7BKIHQYO.js";
import {
  normalizeToolSchemaForNpm
} from "./chunk-UR4QFFSQ.js";
import {
  PoolHealthStore,
  copilotPlanTier,
  describePoolFailure,
  filterCachedCopilotModels,
  materializeRegistry,
  mergeHeaders,
  openCodeGoHeaders,
  poolAccountScope,
  poolEndpointScope,
  poolErrorDetail,
  poolRouteMember,
  poolRoutingProblem,
  providerRefreshToken,
  reconcileCachedModelProtocol,
  recordPoolActivity,
  retryPoolFailure
} from "./chunk-7TNNCDPU.js";
import {
  ANTIGRAVITY_API_VERSION,
  ANTIGRAVITY_BASE_URLS,
  ANTIGRAVITY_USER_AGENT,
  REGISTRY_SCHEMA_VERSION,
  createLanguageModel,
  currentPoolReceipt,
  deepMergeProviderOptions,
  effortProviderOptions,
  getProviderModels,
  getReasoningCapabilities,
  isProviderKind,
  isValidProviderId,
  loadPreferences,
  loadRegistry,
  parseFreePool,
  poolEndpointRevision,
  poolFreeStatus,
  providerKind,
  resolveModelReasoningMetadata,
  resolveProviderCredential,
  resolveProviderOAuthAccountId,
  resolveProviderOAuthProviderData,
  withProviderRequestDefaults
} from "./chunk-PRSSAHTH.js";
import {
  getTemplateById,
  init_provider_templates
} from "./chunk-RKRPDZVV.js";

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
    toolCount: tools.reduce((count, tool) => {
      const declarations = record(tool).functionDeclarations;
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

// src/core/pool-model.ts
import { randomUUID as randomUUID2 } from "crypto";
var RELAY_POOL_PROVIDER_ID = "relay-free-pool";
var RELAY_POOL_MODEL_ID = "relay-free-pool";
var RELAY_POOL_ROUTE_ID = `${RELAY_POOL_PROVIDER_ID}::${RELAY_POOL_MODEL_ID}`;
var ORIGIN_NAMESPACE = "relay-pool";
var RAW = /* @__PURE__ */ Symbol("relay-pool-raw-part");
var NO_CREDENTIAL_NEEDED = () => "relay-core-pool";
function loadPoolState(registryPath, copilotData) {
  let pool;
  try {
    pool = parseFreePool(loadPreferences().freePool);
  } catch {
    return void 0;
  }
  if (pool.enabled !== true || pool.members.length === 0) return void 0;
  const ids = new Set(pool.members.map((member) => member.providerId));
  const registry = loadCoreRegistry(registryPath);
  const trimmed = {
    ...registry,
    providers: registry.providers.filter((provider) => ids.has(provider.id)).map((provider) => {
      if (!copilotData?.has(provider.id) || !provider.modelsCache) return provider;
      return { ...provider, modelsCache: {
        ...provider.modelsCache,
        models: filterCachedCopilotModels(provider.modelsCache.models, copilotPlanTier(copilotData.get(provider.id)))
      } };
    })
  };
  return { pool, providers: materializeRegistry(trimmed, NO_CREDENTIAL_NEEDED, { agent: "codex" }) };
}
async function loadPoolStateForCall() {
  const first = loadPoolState();
  if (!first) return void 0;
  const copilot = first.pool.members.filter((member) => isProviderKind(member.providerId, "github-copilot"));
  if (copilot.length === 0) return first;
  const registry = loadCoreRegistry();
  const data = /* @__PURE__ */ new Map();
  for (const member of copilot) {
    const provider = registry.providers.find((item) => item.id === member.providerId);
    if (!provider || data.has(provider.id)) continue;
    try {
      data.set(provider.id, await resolveProviderOAuthProviderData(provider.authRef));
    } catch {
      data.set(provider.id, void 0);
    }
  }
  return loadPoolState(void 0, data);
}
function servableMembers(state, now, planKnown = true) {
  const found = [];
  for (const member of state.pool.members) {
    const provider = state.providers.find((item) => item.id === member.providerId);
    const model = provider?.models.find((item) => item.id === member.modelId);
    if (!provider || !model || !model.npm || model.modelFormat === "cloud-code") continue;
    const planPending = !planKnown && isProviderKind(provider.id, "github-copilot");
    if (!planPending && poolFreeStatus({ model, providerId: provider.id }) !== "verified_free") continue;
    if (!planPending && poolRoutingProblem(provider, model)) continue;
    const revision = poolEndpointRevision({
      providerId: provider.id,
      authRef: provider.authRef,
      npm: model.npm,
      baseURL: model.apiBaseUrl,
      upstreamModelId: model.upstreamModelId,
      headers: provider.headers
    });
    const receipt = currentPoolReceipt(state.pool.receipts, member, revision, now);
    if (!receipt || !receipt.billingSafe || !receipt.targets.includes("core")) continue;
    found.push({ member, provider, model, revision, receipt, routeId: `${provider.id}::${model.id}` });
  }
  return found;
}
function commonEffortLevels(members) {
  if (!members.length) return [];
  return members[0].receipt.effortLevels.filter((level) => members.every((item) => item.receipt.effortLevels.includes(level))).filter(isRelayReasoningLevel);
}
function tagPart(part, key) {
  if (!part.providerMetadata || Object.keys(part.providerMetadata).length === 0) return part;
  return { ...part, providerMetadata: { ...part.providerMetadata, [ORIGIN_NAMESPACE]: { route: key } } };
}
function isolateHistory(prompt, key) {
  return prompt.map((message) => {
    if (message.role !== "assistant" || !Array.isArray(message.content)) return message;
    return {
      ...message,
      content: message.content.map((part) => {
        const options = part.providerOptions;
        if (!options) return part;
        const { providerOptions: _drop, ...clean } = part;
        const origin = options[ORIGIN_NAMESPACE]?.route;
        if (origin !== key) return clean;
        const { [ORIGIN_NAMESPACE]: _tag, ...own } = options;
        return Object.keys(own).length ? { ...clean, providerOptions: own } : clean;
      })
    };
  });
}
var EFFORT_CLAIM_KEYS = /* @__PURE__ */ new Set([
  "effort",
  "reasoningEffort",
  "reasoning_effort",
  "thinkingLevel",
  "thinkingBudget",
  "thinking_budget",
  "effortLevel",
  "budget_tokens"
]);
function withoutEffortClaims(options) {
  if (!options) return options;
  const strip = (value, depth) => {
    if (!value || typeof value !== "object" || Array.isArray(value) || depth > 3) return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !EFFORT_CLAIM_KEYS.has(key)).map(([key, nested]) => [key, strip(nested, depth + 1)]));
  };
  return strip(options, 0);
}
function finishReasonOf(part) {
  if (part.type !== "finish") return void 0;
  const reason = part.finishReason;
  return typeof reason === "string" ? reason : reason?.unified;
}
function toPoolEvent(part, key) {
  const tagged = tagPart(part, key);
  const event = { ...tagged };
  if (part.type === "text-delta" || part.type === "reasoning-delta") event.text = part.delta;
  if (part.type === "finish") event.finishReason = finishReasonOf(part);
  event[RAW] = tagged;
  return event;
}
function rawPart(event) {
  return event[RAW];
}
function wrapPoolError(error) {
  if (isRelayCoreError(error)) return error;
  if (error instanceof PoolAttemptError) {
    if (error.committed) return error.cause ?? error;
    return new RelayCoreError(
      "PROVIDER_LOAD_FAILED",
      "All free pool members failed" + (error.cause ? ": " + describePoolFailure(error.cause) : ""),
      { routeId: RELAY_POOL_ROUTE_ID, retryable: true, cause: error.cause ?? error }
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("No eligible free pool members")) {
    return new RelayCoreError("UNSUPPORTED_MODEL", message, { routeId: RELAY_POOL_ROUTE_ID, retryable: true, cause: error });
  }
  return error;
}
var sessions = new PoolSessionRoutes();
async function memberModel(routeId, context) {
  const { createRelayModel: createRelayModel2 } = await import("./model-S2PLLPPZ.js");
  return createRelayModel2(routeId, {
    sessionId: context.sessionId,
    ...context.options?.onDebug ? { onDebug: context.options.onDebug } : {},
    ...context.options?.fetchImpl ? { fetchImpl: context.options.fetchImpl } : {},
    ...context.options?.reasoning !== void 0 ? { reasoning: context.options.reasoning } : {}
  });
}
function buildRoutes(members, context, skips) {
  return members.map((item) => {
    const key = poolRouteKey({ account: item.provider.id, endpointRevision: item.revision, model: item.model.id });
    const scopes = [poolEndpointScope(item.provider.id, item.revision, item.model.id)];
    const accountScopes = [poolAccountScope(item.provider.id)];
    const label = item.provider.id + "/" + item.model.id;
    return lazyPoolRoute({
      member: item.member,
      revision: item.revision,
      freeStatus: "verified_free",
      catalogVerified: true,
      accessVerified: true,
      billingSafe: true,
      targets: item.receipt.targets,
      toolsVerified: item.receipt.tools,
      defaultEffortVerified: true,
      effortLevels: item.receipt.effortLevels,
      contextFits: true,
      contextVerified: true
    }, async () => {
      const gone = (reason) => {
        skips.push(label + ": " + reason);
        return { skip: reason };
      };
      const off = await context.health.disabledFor(scopes);
      if (off) return gone("DISABLED: " + off.note + " (run Test to re-enable)");
      const until = await context.health.cooldownFor({ id: item.revision, scopes: [...scopes, ...accountScopes] });
      if (until !== void 0 && until > context.now) return gone("cooling down after a failure");
      const outputCap = poolOutputCap(item.provider.id, item.model.id, item.receipt.contextWindow);
      const asked = context.call.maxOutputTokens ?? outputCap;
      if (!Number.isSafeInteger(asked) || asked <= 0) return gone("invalid output limit");
      const requestedOutput = Math.min(asked, outputCap);
      const tools = context.call.tools && context.call.tools.length > POOL_MAX_TOOLS ? context.call.tools.slice(0, POOL_MAX_TOOLS) : context.call.tools;
      const prompt = isolateHistory(context.call.prompt, key);
      if (!poolRequestFitsWindow({ prompt, tools }, item.receipt.contextWindow, requestedOutput).fits) {
        return gone("request too large for its context window");
      }
      let model;
      try {
        model = await memberModel(item.routeId, context);
      } catch (error) {
        if (isRelayCoreError(error) && (error.code === "CREDENTIAL_UNAVAILABLE" || error.code === "OAUTH_REFRESH_FAILED")) {
          return gone("no credential");
        }
        return gone("could not be prepared: " + (error instanceof Error ? error.message : String(error)));
      }
      if (typeof model === "string" || typeof model.doStream !== "function") {
        return gone("could not be prepared: unsupported model object");
      }
      context.onBuilt?.();
      const member = model;
      return {
        route: poolRouteFromStream({
          member: item.member,
          revision: item.revision,
          freeStatus: "verified_free",
          catalogVerified: true,
          accessVerified: true,
          billingSafe: true,
          targets: item.receipt.targets,
          toolsVerified: item.receipt.tools,
          defaultEffortVerified: true,
          effortLevels: item.receipt.effortLevels,
          contextFits: true,
          contextVerified: true
        }, (abortSignal) => {
          const source = (async () => (await member.doStream({
            ...context.call,
            prompt,
            tools,
            maxOutputTokens: requestedOutput,
            providerOptions: withoutEffortClaims(context.call.providerOptions),
            abortSignal
          })).stream)();
          return (async function* () {
            const reader = (await source).getReader();
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) return;
                yield toPoolEvent(value, key);
              }
            } finally {
              await reader.cancel().catch(() => {
              });
            }
          })();
        }, { store: context.health, scopes, accountScopes })
      };
    });
  });
}
async function* runPool(options, call) {
  const now = Date.now();
  const state = await loadPoolStateForCall();
  if (!state) {
    throw new RelayCoreError("UNSUPPORTED_MODEL", "Relay Free Pool is not enabled or has no members \u2014 set it up with `relay-ai pool` or relay-ai ui.", { routeId: RELAY_POOL_ROUTE_ID });
  }
  const members = servableMembers(state, now);
  const skips = [];
  const requestId = randomUUID2().slice(0, 8);
  const signal = call.abortSignal ?? new AbortController().signal;
  const started = { at: Date.now() };
  let answering;
  const routes = buildRoutes(members, {
    options,
    call,
    requestId,
    now,
    health: new PoolHealthStore(),
    // A host-supplied conversation id is kept; otherwise Go/Zen members still get a header for this call.
    sessionId: options?.sessionId ?? randomUUID2()
  }, skips);
  const hasTools = Boolean(call.tools?.length);
  const events = dispatchFreePool(state.pool, routes, {
    target: "core",
    tools: hasTools,
    effort: "auto",
    signal,
    ...options?.sessionId ? { conversationScope: options.sessionId } : {}
  }, {
    limits: { ...DEFAULT_POOL_LIMITS, attempts: MAX_POOL_ATTEMPTS },
    sessions,
    retryable: retryPoolFailure,
    onAttempt: (id) => {
      answering = id;
      started.at = Date.now();
    },
    onFailure: (id, error) => {
      const member = poolRouteMember(id);
      if (!member) return;
      const reason = describePoolFailure(error);
      const detail = reason.startsWith("simulated") ? void 0 : poolErrorDetail(error);
      recordPoolActivity({ target: "core", event: "failed", ...member, requestId, reason, ...detail ? { detail } : {}, ms: Date.now() - started.at });
    }
  });
  let served = false;
  try {
    for await (const event of events) {
      if (event.type === "finish") served = true;
      yield rawPart(event);
    }
  } catch (error) {
    if (!signal.aborted) {
      for (const line of skips) {
        const [member, ...reason] = line.split(": ");
        const [providerId, ...model] = (member ?? "").split("/");
        recordPoolActivity({ target: "core", event: "failed", providerId: providerId ?? "pool", modelId: model.join("/") || "none", requestId, reason: "skipped: " + reason.join(": ") });
      }
      recordPoolActivity({ target: "core", event: "gave-up", providerId: "pool", modelId: "none", requestId, ms: Date.now() - started.at });
    }
    throw wrapPoolError(error);
  }
  const answered = answering ? poolRouteMember(answering) : void 0;
  if (served && answered) recordPoolActivity({ target: "core", event: "served", ...answered, requestId, ms: Date.now() - started.at });
}
async function generateFromStream(parts) {
  const text = /* @__PURE__ */ new Map();
  const reasoning = /* @__PURE__ */ new Map();
  const content = [];
  const order = [];
  let warnings = [];
  let finishReason = void 0;
  let usage = void 0;
  let providerMetadata;
  const open = (map, kind, id, meta) => {
    if (!map.has(id)) {
      map.set(id, { text: "", ...meta ? { meta } : {} });
      order.push({ kind, id });
    }
  };
  for await (const part of parts) {
    const p = part;
    switch (p.type) {
      case "stream-start":
        warnings = p.warnings;
        break;
      case "text-start":
        open(text, "text", p.id, p.providerMetadata);
        break;
      case "text-delta":
        open(text, "text", p.id);
        text.get(p.id).text += p.delta ?? "";
        break;
      case "text-end":
        if (p.providerMetadata) {
          open(text, "text", p.id);
          text.get(p.id).meta = p.providerMetadata;
        }
        break;
      case "reasoning-start":
        open(reasoning, "reasoning", p.id, p.providerMetadata);
        break;
      case "reasoning-delta":
        open(reasoning, "reasoning", p.id);
        reasoning.get(p.id).text += p.delta ?? "";
        break;
      case "reasoning-end":
        if (p.providerMetadata) {
          open(reasoning, "reasoning", p.id);
          reasoning.get(p.id).meta = p.providerMetadata;
        }
        break;
      case "tool-call":
      case "file":
      case "source":
        order.push({ kind: "text", id: "" });
        content.push(p);
        break;
      case "finish":
        finishReason = p.finishReason;
        usage = p.usage;
        providerMetadata = p.providerMetadata;
        break;
      default:
        break;
    }
  }
  const leading = [];
  for (const entry of order) {
    if (entry.id === "") continue;
    const source = (entry.kind === "text" ? text : reasoning).get(entry.id);
    leading.push({ type: entry.kind, text: source.text, ...source.meta ? { providerMetadata: source.meta } : {} });
  }
  return {
    content: [...leading, ...content],
    finishReason,
    usage,
    warnings,
    ...providerMetadata ? { providerMetadata } : {}
  };
}
function createRelayPoolModel(options) {
  const state = loadPoolState();
  const members = state ? servableMembers(state, Date.now(), false) : [];
  if (!state || members.length === 0) {
    throw new RelayCoreError("UNSUPPORTED_MODEL", "Relay Free Pool is not enabled or has no usable members \u2014 set it up with `relay-ai pool` or relay-ai ui.", { routeId: RELAY_POOL_ROUTE_ID });
  }
  if (options?.reasoning !== void 0) {
    const levels = commonEffortLevels(members);
    if (!levels.includes(options.reasoning)) {
      throw new RelayCoreError(
        "UNSUPPORTED_REASONING_LEVEL",
        `Relay Free Pool cannot apply reasoning level "${options.reasoning}": every member must have verified it (verified by all: ${levels.join(", ") || "none"}).`,
        { routeId: RELAY_POOL_ROUTE_ID }
      );
    }
  }
  const model = {
    specificationVersion: "v4",
    provider: "relay",
    modelId: RELAY_POOL_MODEL_ID,
    supportedUrls: {},
    async doStream(call) {
      const iterator = runPool(options, call)[Symbol.asyncIterator]();
      const first = await iterator.next();
      const stream = new ReadableStream({
        async start(controller) {
          if (!first.done) controller.enqueue(first.value);
          else controller.close();
        },
        async pull(controller) {
          try {
            const next = await iterator.next();
            if (next.done) controller.close();
            else controller.enqueue(next.value);
          } catch (error) {
            controller.error(error);
          }
        },
        async cancel() {
          await iterator.return?.(void 0);
        }
      });
      return { stream };
    },
    async doGenerate(call) {
      const result = await generateFromStream({ [Symbol.asyncIterator]: () => runPool(options, call) });
      return result;
    }
  };
  return model;
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
  if (routeId === RELAY_POOL_ROUTE_ID) return createRelayPoolModel(options);
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

export {
  withPortableToolSchemas,
  createRelayModel
};
//# sourceMappingURL=chunk-JECZBX7O.js.map