#!/usr/bin/env node
import {
  RELAY_POOL_ROUTE_ID,
  RelayCoreError,
  createRelayPoolModel,
  isRelayCoreError,
  loadCoreRegistry,
  parseRelayRouteId,
  reasoningNpmForRoute,
  resolveReasoningProviderOptions,
  withReasoningProviderOptions,
  withRequestHeaders
} from "./chunk-WB67LIBU.js";
import {
  openCodeGoHeaders,
  providerRefreshToken,
  reconcileCachedModelProtocol
} from "./chunk-M77KUXEO.js";
import {
  normalizeToolSchemaForNpm
} from "./chunk-UR4QFFSQ.js";
import {
  createLanguageModel,
  getProviderModels,
  withProviderRequestDefaults
} from "./chunk-25YDTUQR.js";
import {
  ANTIGRAVITY_API_VERSION,
  ANTIGRAVITY_BASE_URLS,
  ANTIGRAVITY_USER_AGENT,
  isProviderKind,
  providerKind,
  resolveProviderCredential,
  resolveProviderOAuthAccountId,
  resolveProviderOAuthProviderData
} from "./chunk-I6I4JU6A.js";
import {
  getTemplateById,
  init_provider_templates
} from "./chunk-6DCEGHZH.js";

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
//# sourceMappingURL=chunk-WOB377G7.js.map