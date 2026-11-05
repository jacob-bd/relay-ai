#!/usr/bin/env node
import {
  copilotPlanTier,
  filterCachedCopilotModels,
  materializeRegistry,
  oauthAuthRef,
  openCodeGoHeaders,
  probePoolEffort,
  probePoolModel,
  providerRefreshToken
} from "./chunk-CKWEYKVD.js";
import {
  EFFORT_RANK,
  MAX_MODEL_CATALOG,
  MIN_CONTEXT_WINDOW,
  createLanguageModel,
  effortProviderOptions,
  formatUpstreamError,
  getAgentProviderModels,
  getReasoningCapabilities,
  isProviderKind,
  loadRegistry,
  poolEndpointRevision,
  poolFreeStatus,
  providerKind,
  resolveProviderCredential,
  resolveProviderOAuthAccountId,
  resolveProviderOAuthProviderData,
  shouldHideModel,
  upstreamHttpStatus
} from "./chunk-DDFLIKBI.js";
import {
  getTemplateById,
  init_provider_templates
} from "./chunk-RKRPDZVV.js";
import {
  getAppHome,
  getLogsPath
} from "./chunk-KNCSTHR4.js";

// src/pool/activity.ts
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "fs";
import { join } from "path";

// src/pool/errors.ts
var GONE_PATTERN = new RegExp([
  String.raw`model[_ -]?not[_ -]?found`,
  String.raw`model\b[^.\n]{0,60}\b(?:does not exist|doesn't exist|no longer (?:available|supported|exists?)|has been (?:deprecated|retired|removed|discontinued|decommissioned|shut down)|is (?:deprecated|decommissioned|discontinued|retired))`,
  String.raw`\b(?:deprecated|decommissioned|discontinued|retired|sunset)\b[^.\n]{0,20}\bmodel\b`,
  String.raw`\bthis model (?:was|has been|is) (?:deprecated|decommissioned|discontinued|retired|removed|shut down)`,
  String.raw`\bunknown model\b`
].join("|"), "i");
var PROMO_PATTERN = new RegExp([
  // The model's own free access ended. "free trial expired" is account-wide and is a quota matter, not a verdict on one model.
  String.raw`\bmodel\b[^.\n]{0,60}\b(?:free|promo(?:tion(?:al)?)?)\b[^.\n]{0,40}\b(?:ended|expired|is over|no longer)`,
  String.raw`\b(?:free|promo(?:tion(?:al)?)?)\b[^.\n]{0,40}\b(?:access|period|offer|pricing)\b[^.\n]{0,40}\b(?:ended|expired|is over)`,
  String.raw`\bpromo(?:tion(?:al)?)?\b[^.\n]{0,50}\b(?:ended|expired|is over|no longer)`,
  String.raw`\bno longer (?:free|available for free)`,
  String.raw`\bnot (?:included )?in (?:your|the) (?:current )?(?:plan|tier|subscription)`,
  String.raw`MODEL_NOT_IN_PLAN`
].join("|"), "i");
var VERDICT_STATUSES = /* @__PURE__ */ new Set([400, 402, 403, 404, 410]);
var DISABLED_GONE_NOTE = "model no longer available";
var DISABLED_PROMO_NOTE = "free access ended or not included in the plan";
function disablingNote(status, text) {
  if (status === void 0 || !VERDICT_STATUSES.has(status) || !text) return void 0;
  if (PROMO_PATTERN.test(text)) return DISABLED_PROMO_NOTE;
  if (GONE_PATTERN.test(text)) return DISABLED_GONE_NOTE;
  return void 0;
}
function poolFailure(error, now = Date.now()) {
  const value = error;
  if (value?.name === "AbortError" || value?.code === "ABORT_ERR") return { kind: "canceled" };
  const status = value?.statusCode;
  const text = ((value?.message ?? "") + " " + (typeof value?.responseBody === "string" ? value.responseBody.slice(0, 2e3) : "")).trim();
  if (status !== 429) {
    const note = disablingNote(status, text);
    if (note) return { kind: "disabled", status, note };
  }
  if (status === 429) {
    const raw = Object.entries(value?.responseHeaders ?? {}).find(([key]) => key.toLowerCase() === "retry-after")?.[1];
    let retryAt;
    if (raw?.trim()) {
      const seconds = Number(raw);
      if (Number.isFinite(seconds) && seconds >= 0) retryAt = now + Math.ceil(seconds * 1e3);
      else {
        const parsed = Date.parse(raw);
        if (Number.isFinite(parsed)) retryAt = Math.max(now, parsed);
      }
    }
    return { kind: "rate-limit", status, retryAt };
  }
  if (status === 402) return { kind: "quota", status };
  if (status === 404 || status === 410) return { kind: "missing", status };
  if ([401, 403, 404].includes(status ?? 0)) return { kind: "access", status };
  if (status === 400 && /context.{0,20}(length|window|exceed)|prompt.{0,20}too long/i.test(value?.message ?? "")) return { kind: "context", status };
  if (status === 400 || status === 422) return { kind: "invalid", status };
  if (status !== void 0 && status >= 500 || /ECONNRESET|ETIMEDOUT|ENOTFOUND|first-content-timeout|idle-or-total-timeout|provisional-buffer-limit|missing-valid-finish|invalid-finish|stream-error|Pool route entered cooldown/.test(value?.message ?? "")) return { kind: "transient", status };
  return { kind: "unknown", status };
}
function retryPoolFailure(error) {
  return poolFailure(error).kind !== "canceled";
}

// src/pool/activity.ts
import pc from "picocolors";
var MAX_BYTES = 256 * 1024;
var KEEP_LINES = 500;
function poolActivityPath() {
  return join(getLogsPath(), "pool-activity.jsonl");
}
function poolRouteMember(routeId) {
  try {
    const parsed = JSON.parse(routeId);
    if (Array.isArray(parsed) && typeof parsed[0] === "string" && typeof parsed[2] === "string") {
      return { providerId: parsed[0], modelId: parsed[2] };
    }
  } catch {
  }
  return void 0;
}
function describePoolFailure(error) {
  const raw = error instanceof Error ? error.message : "";
  const verdict = poolFailure(error);
  if (verdict.kind === "disabled") return "DISABLED: " + (verdict.note ?? "disabled after an error") + " (run Test to re-enable)";
  if (raw.includes("Simulated failure (RELAY_POOL_FORCE_FAIL)")) return "simulated failure (test switch)";
  if (raw.includes("Pool route entered cooldown")) return "skipped: recovering from an earlier failure";
  const carried = error;
  const explicit = [carried?.statusCode, carried?.status, carried?.response?.status].find((value) => typeof value === "number");
  const status = explicit ?? (/\b(4\d\d|5\d\d)\b/.test(raw) ? upstreamHttpStatus(error, raw) : void 0);
  if (status === 429) return "rate limit (429)";
  if (status === 401 || status === 403) return `access denied (${status})`;
  if (status === 402) return "quota or credits exhausted (402)";
  if (status === 404) return "model not found (404)";
  if (status === 400) return "request rejected (400)";
  if (typeof status === "number" && status >= 500) return `provider error (${status})`;
  if (/timeout|timed out|ETIMEDOUT|abort/i.test(raw)) return "timeout";
  if (/ECONNRESET|ENOTFOUND|fetch failed/i.test(raw)) return "network error";
  return "failed";
}
function recordPoolActivity(entry) {
  try {
    const path = poolActivityPath();
    mkdirSync(getLogsPath(), { recursive: true });
    appendFileSync(path, JSON.stringify({ at: (/* @__PURE__ */ new Date()).toISOString(), ...entry }) + "\n");
    if (statSync(path).size > MAX_BYTES) {
      const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
      writeFileSync(path, lines.slice(-KEEP_LINES).join("\n") + "\n");
    }
  } catch {
  }
}
function readPoolActivity(limit = 50) {
  try {
    const lines = readFileSync(poolActivityPath(), "utf8").split("\n").filter(Boolean);
    const entries = [];
    for (const line of lines.slice(-Math.max(limit, 1) * 2)) {
      try {
        const e = JSON.parse(line);
        if (e && typeof e.at === "string" && typeof e.providerId === "string" && typeof e.modelId === "string" && (e.event === "served" || e.event === "failed" || e.event === "gave-up")) entries.push(e);
      } catch {
      }
    }
    return entries.slice(-limit).reverse();
  } catch {
    return [];
  }
}
function parseActivityLine(line) {
  try {
    const e = JSON.parse(line);
    return e && typeof e.at === "string" && typeof e.providerId === "string" && typeof e.modelId === "string" && (e.event === "served" || e.event === "failed" || e.event === "gave-up") ? e : void 0;
  } catch {
    return void 0;
  }
}
async function followPoolActivity(onEntry, signal, pollMs = 400) {
  const path = poolActivityPath();
  let offset = existsSync(path) ? statSync(path).size : 0;
  let partial = "";
  while (!signal.aborted) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, pollMs);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
    if (signal.aborted) return;
    try {
      if (!existsSync(path)) {
        offset = 0;
        partial = "";
        continue;
      }
      const size = statSync(path).size;
      if (size < offset) {
        offset = 0;
        partial = "";
      }
      if (size === offset) continue;
      const fd = openSync(path, "r");
      try {
        const buffer = Buffer.alloc(size - offset);
        readSync(fd, buffer, 0, buffer.length, offset);
        offset = size;
        const lines = (partial + buffer.toString("utf8")).split("\n");
        partial = lines.pop() ?? "";
        for (const line of lines) {
          const entry = line ? parseActivityLine(line) : void 0;
          if (entry) onEntry(entry);
        }
      } finally {
        closeSync(fd);
      }
    } catch {
    }
  }
}
function attemptOf(e) {
  return { providerId: e.providerId, modelId: e.modelId, ...e.reason ? { reason: e.reason } : {}, ...e.detail ? { detail: e.detail } : {} };
}
var PoolRequestGrouper = class {
  open = /* @__PURE__ */ new Map();
  /** Returns the finished request this entry completes, if any. */
  add(e) {
    if (!e.requestId) {
      if (e.event === "served") return { at: e.at, outcome: "answered", answeredBy: { providerId: e.providerId, modelId: e.modelId }, ms: e.ms, tried: [] };
      return void 0;
    }
    const summary = this.open.get(e.requestId) ?? { at: e.at, outcome: "failed", tried: [] };
    this.open.set(e.requestId, summary);
    if (e.event === "failed") {
      summary.tried.push(attemptOf(e));
      return void 0;
    }
    this.open.delete(e.requestId);
    summary.at = e.at;
    summary.ms = e.ms;
    if (e.event === "served") {
      summary.outcome = "answered";
      summary.answeredBy = { providerId: e.providerId, modelId: e.modelId };
    }
    return summary;
  }
};
function groupPoolActivity(entriesOldestFirst) {
  const grouper = new PoolRequestGrouper();
  const out = [];
  for (const e of entriesOldestFirst) {
    const done = grouper.add(e);
    if (done) out.push(done);
  }
  return out;
}
function clockTime(at) {
  const when = new Date(at);
  return Number.isNaN(when.getTime()) ? at : when.toLocaleTimeString([], { hour12: false });
}
function durationText(ms) {
  return typeof ms === "number" ? ` in ${(ms / 1e3).toFixed(1)}s` : "";
}
function attemptLines(tried) {
  const lines = [];
  for (const t of tried) {
    const name = `${t.providerId}/${t.modelId}`;
    const reason = t.reason ?? "failed";
    if (/^(skipped: )?DISABLED/.test(reason)) lines.push(pc.bold(pc.red(`      \u26D4 ${name} ${reason.replace(/^skipped:\s*/, "")}`)));
    else if (reason.startsWith("skipped")) lines.push(pc.yellow(`      \u2013 ${name} skipped: ${reason.replace(/^skipped:\s*/, "")}`));
    else lines.push(pc.red(`      \u2717 ${name} failed: ${reason}`));
    if (t.detail) lines.push(pc.dim(`          ${t.detail}`));
  }
  return lines;
}
function formatPoolRequestLines(r) {
  const time = pc.dim(clockTime(r.at));
  const head = r.outcome === "answered" && r.answeredBy ? `${time}  ${pc.green(`\u2713 ${r.answeredBy.providerId}/${r.answeredBy.modelId} answered${durationText(r.ms)}`)}` : `${time}  ${pc.bold(pc.red("\u2717 nobody answered"))}`;
  return [head, ...attemptLines(r.tried)].join("\n");
}
var PoolEventFilter = class {
  current;
  /** Time of the first request the current model answered smoothly. */
  since;
  /** Smooth requests since the last event. */
  quiet = 0;
  push(request) {
    const quietBefore = this.quiet;
    const same = (a, b) => Boolean(a && b && a.providerId === b.providerId && a.modelId === b.modelId);
    if (request.outcome !== "answered" || !request.answeredBy) {
      this.quiet = 0;
      return { kind: "failed", request, quietBefore, changed: false };
    }
    const wasFirst = !this.current;
    const previous = this.current;
    const changed = !same(this.current, request.answeredBy);
    const hadTrouble = request.tried.length > 0;
    if (changed) {
      this.current = request.answeredBy;
      this.since = request.at;
    }
    if (hadTrouble || changed) {
      this.quiet = 0;
      return { kind: hadTrouble ? "failover" : wasFirst ? "now-answering" : "switched", request, quietBefore, changed, ...previous ? { previous } : {} };
    }
    this.quiet++;
    return void 0;
  }
};
function formatPoolEventLines(block) {
  const r = block.request;
  const time = pc.dim(clockTime(r.at));
  if (block.kind === "failed" || !r.answeredBy) {
    const lines2 = [`${time}  ${pc.bold(pc.red("\u2717 nobody answered"))}`, ...attemptLines(r.tried)];
    if (block.quietBefore > 0) lines2.push(pc.dim(`      (${block.quietBefore} earlier request${block.quietBefore === 1 ? "" : "s"} answered normally)`));
    return lines2.join("\n");
  }
  const who = `${r.answeredBy.providerId}/${r.answeredBy.modelId}`;
  const from = block.previous ? `${block.previous.providerId}/${block.previous.modelId}` : void 0;
  const note = block.changed ? pc.dim(from ? `  \xB7 switched from ${from}` : "  \xB7 first model seen") : "";
  const lines = [`${time}  ${pc.green(`\u2713 ${who} answered${durationText(r.ms)}`)}${note}`, ...attemptLines(r.tried)];
  if (block.quietBefore > 0 && block.kind !== "now-answering") {
    lines.push(pc.dim(`      (${block.quietBefore} earlier request${block.quietBefore === 1 ? "" : "s"} answered normally)`));
  }
  return lines.join("\n");
}
function summarizePoolEvents(requests) {
  const filter = new PoolEventFilter();
  const events = [];
  for (const r of requests) {
    const block = filter.push(r);
    if (block) events.push(block);
  }
  return { events, current: filter.current, since: filter.since, quiet: filter.quiet };
}
function formatPoolCurrentLine(state) {
  if (!state.current) return "No pool requests recorded yet.";
  const when = state.since ? new Date(state.since) : void 0;
  const since = when && !Number.isNaN(when.getTime()) ? ` since ${when.toLocaleTimeString([], { hour12: false })}` : "";
  const smooth = state.quiet > 0 ? `, ${state.quiet} request${state.quiet === 1 ? "" : "s"} answered normally since` : "";
  return `Current model: ${pc.green(`${state.current.providerId}/${state.current.modelId}`)}${pc.dim(since + smooth)}`;
}

// src/pool/force-fail.ts
import { existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync as readFileSync2, rmSync, writeFileSync as writeFileSync2 } from "fs";
import { dirname, join as join2 } from "path";
var FORCE_FAIL_ENV = "RELAY_POOL_FORCE_FAIL";
var DEFAULT_FORCE_FAIL_MINUTES = 10;
var MAX_FORCE_FAIL_MINUTES = 60;
function forceFailPath() {
  return join2(getAppHome(), "pool-force-fail.json");
}
function readForceFailState(now = Date.now()) {
  try {
    const path = forceFailPath();
    if (!existsSync2(path)) return void 0;
    const raw = JSON.parse(readFileSync2(path, "utf8"));
    if (!Array.isArray(raw.members) || typeof raw.expiresAt !== "number" || raw.expiresAt <= now) return void 0;
    const members = raw.members.filter((item) => typeof item === "string" && item.length > 0);
    return members.length > 0 ? { members, expiresAt: raw.expiresAt } : void 0;
  } catch {
    return void 0;
  }
}
function setForceFail(members, minutes = DEFAULT_FORCE_FAIL_MINUTES, now = Date.now()) {
  const clamped = Math.min(MAX_FORCE_FAIL_MINUTES, Math.max(1, Math.round(minutes) || DEFAULT_FORCE_FAIL_MINUTES));
  const state = { members: [...new Set(members.map((item) => item.trim()).filter(Boolean))], expiresAt: now + clamped * 6e4 };
  const path = forceFailPath();
  mkdirSync2(dirname(path), { recursive: true });
  writeFileSync2(path, JSON.stringify(state) + "\n");
  return state;
}
function clearForceFail() {
  try {
    rmSync(forceFailPath(), { force: true });
  } catch {
  }
}
function forcedFailures(env = process.env, now = Date.now()) {
  const fromEnv = (env[FORCE_FAIL_ENV] ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  return /* @__PURE__ */ new Set([...fromEnv, ...readForceFailState(now)?.members ?? []]);
}

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

// src/pool/health.ts
import { createHash, randomUUID } from "crypto";
import { mkdir, open, readFile, rename, unlink, writeFile } from "fs/promises";
import { join as join3 } from "path";
var PoolHealthLockTimeoutError = class extends Error {
  ownerPid;
  ownerSince;
  constructor(lockPath, owner) {
    const holder = owner?.pid ? "pid " + owner.pid + (owner.createdAt ? " since " + new Date(owner.createdAt).toISOString() : "") : "an unreadable owner file";
    super("Pool health lock is held by " + holder + " (" + lockPath + "); it is not taken over automatically. If that process is gone, a human can clear it with PoolHealthStore.clear(scopes, { forceUnlock: true }).");
    this.name = "PoolHealthLockTimeoutError";
    this.ownerPid = owner?.pid;
    this.ownerSince = owner?.createdAt;
  }
};
var PoolHealthStateCorruptError = class extends Error {
  constructor(path) {
    super("Pool health state is unreadable (" + path + "); refusing to route without cooldown knowledge");
    this.name = "PoolHealthStateCorruptError";
  }
};
var PoolHealthForceUnlockRefusedError = class extends Error {
  ownerPid;
  constructor(lockPath, reason, ownerPid) {
    super("Refusing to force-unlock the pool health lock (" + lockPath + "): " + reason);
    this.name = "PoolHealthForceUnlockRefusedError";
    this.ownerPid = ownerPid;
  }
};
var FAILURE_COOLDOWN_BASE_MS = { transient: 6e4, access: 3e5, unknown: 3e4 };
var FAILURE_COOLDOWN_MAX_MS = 6e5;
var UNKNOWN_RATE_LIMIT_LADDER_MS = [12e4, 6e5, 36e5, 216e5, 864e5];
var MAX_ENTRIES = 512;
var MAX_LABEL_CHARS = 200;
var RETENTION_MS = 864e5;
var LOCK_POLL_MS = 10;
var DEFAULT_LOCK_TIMEOUT_MS = 5e3;
function poolAccountScope(providerId) {
  return "account:" + providerId;
}
function poolEndpointScope(providerId, endpointRevision, modelId) {
  return "endpoint:" + providerId + "/" + endpointRevision + "/" + modelId;
}
function hashScope(scope) {
  return createHash("sha256").update(scope).digest("hex");
}
var SECRET_PART = /^(?:sk|gsk|xai|nvapi|AIza|hf|ghp)[-_A-Za-z0-9]*$/;
function sanitizePoolScopeLabel(scope) {
  const label = scope.split(/([:/])/).map((part) => {
    if (part === ":" || part === "/") return part;
    if (SECRET_PART.test(part) || part.length >= 32) return "<redacted:" + hashScope(part).slice(0, 10) + ">";
    return part.replace(/[^A-Za-z0-9._-]/g, "_");
  }).join("");
  return label.length > MAX_LABEL_CHARS ? label.slice(0, MAX_LABEL_CHARS) + "~" : label;
}
var DISABLED_FOR_MS = 100 * 365 * 864e5;
var MISSING_NOTE = "missing";
var MAX_NOTE_CHARS = 120;
function emptyStore() {
  return { version: 1, entries: {} };
}
function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function normalizeEntry(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid entry");
  const value = raw;
  const label = value["label"];
  const failures = value["failures"];
  const until = value["until"];
  const reason = value["reason"];
  const updatedAt = value["updatedAt"];
  if (typeof label !== "string" || !label || label.length > MAX_LABEL_CHARS + 1) throw new Error("invalid label");
  if (typeof failures !== "number" || !Number.isSafeInteger(failures) || failures < 1 || failures > 100) throw new Error("invalid failures");
  if (typeof until !== "number" || !Number.isFinite(until)) throw new Error("invalid until");
  if (reason !== "rate-limit" && reason !== "quota" && reason !== "disabled" && !(typeof reason === "string" && reason in FAILURE_COOLDOWN_BASE_MS)) throw new Error("unsupported reason");
  const note = value["note"];
  if (note !== void 0 && (typeof note !== "string" || note.length > MAX_NOTE_CHARS)) throw new Error("invalid note");
  if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt)) throw new Error("invalid updatedAt");
  let recovery;
  const rawClaim = value["recovery"];
  if (rawClaim !== void 0) {
    if (!rawClaim || typeof rawClaim !== "object" || Array.isArray(rawClaim)) throw new Error("invalid claim");
    const claim = rawClaim;
    if (typeof claim["token"] !== "string" || claim["token"].length < 16) throw new Error("invalid claim token");
    if (typeof claim["pid"] !== "number" || !Number.isSafeInteger(claim["pid"])) throw new Error("invalid claim pid");
    if (typeof claim["startedAt"] !== "number" || !Number.isFinite(claim["startedAt"])) throw new Error("invalid claim start");
    if (claim["superseded"] !== void 0 && typeof claim["superseded"] !== "boolean") throw new Error("invalid claim superseded");
    recovery = { token: claim["token"], pid: claim["pid"], startedAt: claim["startedAt"], ...claim["superseded"] === true ? { superseded: true } : {} };
  }
  return {
    label,
    failures,
    until,
    reason,
    updatedAt,
    ...typeof note === "string" ? { note } : {},
    ...recovery ? { recovery } : {}
  };
}
function normalizeStore(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid root");
  const value = raw;
  if (value["version"] !== 1) throw new Error("unsupported version");
  const entries = value["entries"];
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) throw new Error("invalid entries");
  const state = emptyStore();
  for (const [key, entry] of Object.entries(entries)) {
    if (!/^[0-9a-f]{64}$/.test(key)) throw new Error("invalid scope key");
    state.entries[key] = normalizeEntry(entry);
  }
  return state;
}
function parseOwner(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return void 0;
    const value = parsed;
    const token = value["token"];
    const pid = value["pid"];
    const createdAt = value["createdAt"];
    if (typeof token !== "string" || !token) return void 0;
    if (typeof pid !== "number" || !Number.isSafeInteger(pid)) return void 0;
    return { token, pid, createdAt: typeof createdAt === "number" ? createdAt : 0 };
  } catch {
    return void 0;
  }
}
async function readOwner(lockPath) {
  try {
    return parseOwner(await readFile(lockPath, "utf8"));
  } catch {
    return void 0;
  }
}
async function removeOwnerIfContentMatches(lockPath, expected) {
  let handle;
  try {
    handle = await open(lockPath, "r");
    const content = await handle.readFile("utf8");
    if (content !== expected) return false;
    await unlink(lockPath);
    return true;
  } catch {
    return true;
  } finally {
    await handle?.close().catch(() => {
    });
  }
}
async function acquireLock(lockPath, timeoutMs) {
  const token = randomUUID();
  const payload = JSON.stringify({ token, pid: process.pid, createdAt: Date.now() });
  await mkdir(join3(lockPath, ".."), { recursive: true, mode: 448 });
  const deadline = Date.now() + Math.max(1, timeoutMs);
  for (; ; ) {
    try {
      await writeFile(lockPath, payload, { flag: "wx", mode: 384 });
      return { token, payload };
    } catch (error) {
      const code = error.code;
      if (code !== "EEXIST") throw error;
    }
    if (Date.now() >= deadline) throw await lockTimeout(lockPath);
    await delay(LOCK_POLL_MS + Math.floor(Math.random() * LOCK_POLL_MS));
  }
}
async function releaseLock(lockPath, payload) {
  await removeOwnerIfContentMatches(lockPath, payload);
}
async function lockTimeout(lockPath) {
  const owner = await readOwner(lockPath).catch(() => void 0);
  return new PoolHealthLockTimeoutError(lockPath, owner);
}
function prune(state, now) {
  for (const [key, entry] of Object.entries(state.entries)) {
    if (!entry.recovery && entry.until <= now - RETENTION_MS) delete state.entries[key];
  }
  const keys = Object.keys(state.entries);
  if (keys.length <= MAX_ENTRIES) return;
  keys.sort((a, b) => (state.entries[a]?.until ?? 0) - (state.entries[b]?.until ?? 0));
  for (const key of keys) {
    if (Object.keys(state.entries).length <= MAX_ENTRIES) break;
    if (!state.entries[key]?.recovery) delete state.entries[key];
  }
}
var PoolHealthStore = class {
  root;
  now;
  ladder;
  lockTimeoutMs;
  constructor(options = {}) {
    this.root = options.root ?? join3(getAppHome(), "pool");
    this.now = options.now ?? Date.now;
    this.ladder = options.ladderMs ?? UNKNOWN_RATE_LIMIT_LADDER_MS;
    this.lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
    if (!this.ladder.length || this.ladder.some((step) => !Number.isSafeInteger(step) || step <= 0)) {
      throw new Error("Invalid rate-limit ladder");
    }
  }
  get statePath() {
    return join3(this.root, "health.json");
  }
  get lockPath() {
    return join3(this.root, "health.lock");
  }
  /** Throws PoolHealthStateCorruptError; the file is left exactly as found. */
  async readState() {
    let raw;
    try {
      raw = await readFile(this.statePath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return emptyStore();
      throw new PoolHealthStateCorruptError(this.statePath);
    }
    try {
      return normalizeStore(JSON.parse(raw));
    } catch {
      throw new PoolHealthStateCorruptError(this.statePath);
    }
  }
  async writeState(state) {
    await mkdir(this.root, { recursive: true, mode: 448 });
    const temp = this.statePath + ".tmp-" + randomUUID();
    await writeFile(temp, JSON.stringify(state), { mode: 384 });
    await rename(temp, this.statePath);
  }
  async mutate(work) {
    await mkdir(this.root, { recursive: true, mode: 448 });
    const { payload } = await acquireLock(this.lockPath, this.lockTimeoutMs);
    try {
      const state = await this.readState();
      let dirty = false;
      const result = await work(state, () => {
        dirty = true;
      });
      if (dirty) await this.writeState(state);
      return result;
    } finally {
      await releaseLock(this.lockPath, payload);
    }
  }
  /** A claim is live while its owner pid exists. Age alone never releases it. */
  claimLive(claim) {
    if (!claim) return false;
    return claim.pid === process.pid || processAlive(claim.pid);
  }
  /**
   * Persist a provider failure. Rate limits use the long ladder; transient, access and unknown failures get a
   * short escalating cooldown (FAILURE_COOLDOWN_BASE_MS); cancellation, context and invalid failures are never written.
   * Throws PoolHealthLockTimeoutError when a live process holds the lock.
   */
  async record(scopes, failure) {
    const cooled = failure.kind === "missing" ? "access" : failure.kind;
    const shortBase = cooled in FAILURE_COOLDOWN_BASE_MS ? FAILURE_COOLDOWN_BASE_MS[cooled] : void 0;
    if (failure.kind !== "rate-limit" && failure.kind !== "quota" && failure.kind !== "disabled" && shortBase === void 0) return { recorded: false, reason: failure.kind };
    const unique = [...new Set(scopes.filter((scope) => typeof scope === "string" && scope.trim().length > 0))];
    if (!unique.length) return { recorded: false, reason: "no-scopes" };
    const now = this.now();
    return this.mutate((state, touch) => {
      let until = 0;
      let disabledNote;
      for (const scope of unique) {
        const key = hashScope(scope);
        const previous = state.entries[key];
        if (previous?.reason === "disabled") {
          until = Math.max(until, previous.until);
          disabledNote = previous.note;
          continue;
        }
        const confirmedMissing = failure.kind === "missing" && previous?.note === MISSING_NOTE && previous.until <= now;
        if (failure.kind === "disabled" || confirmedMissing) {
          const note = failure.kind === "disabled" ? failure.note ?? "disabled after an error" : "model not found (404)";
          state.entries[key] = {
            label: sanitizePoolScopeLabel(scope),
            failures: Math.min((previous?.failures ?? 0) + 1, 100),
            until: now + DISABLED_FOR_MS,
            reason: "disabled",
            updatedAt: now,
            note: note.slice(0, MAX_NOTE_CHARS)
          };
          until = Math.max(until, now + DISABLED_FOR_MS);
          disabledNote = state.entries[key].note;
          continue;
        }
        const failures = Math.min((previous?.failures ?? 0) + 1, 100);
        const step = shortBase !== void 0 ? Math.min(shortBase * 2 ** Math.min(failures - 1, 10), FAILURE_COOLDOWN_MAX_MS) : this.ladder[Math.min(failures - 1, this.ladder.length - 1)];
        const proposedUntil = failure.retryAt !== void 0 ? Math.max(failure.retryAt, now) : now + step;
        const entryUntil = previous && previous.until > now ? Math.max(previous.until, proposedUntil) : proposedUntil;
        state.entries[key] = {
          // A rate-limit can arrive while this process's recovery is in flight.
          // Keep the claim so another process cannot start a second provider call.
          ...previous?.recovery ? { recovery: { ...previous.recovery, superseded: true } } : {},
          label: sanitizePoolScopeLabel(scope),
          failures,
          until: entryUntil,
          reason: cooled,
          updatedAt: now,
          ...failure.kind === "missing" ? { note: MISSING_NOTE } : {}
        };
        until = Math.max(until, entryUntil);
      }
      prune(state, now);
      touch();
      return { recorded: true, until, ...disabledNote ? { disabled: true, note: disabledNote } : {} };
    });
  }
  /** Forget a route's failure history after a genuine success (resets the ladder). */
  async markHealthy(scopes) {
    const unique = [...new Set(scopes.filter((scope) => typeof scope === "string" && scope.trim().length > 0))];
    if (!unique.length) return;
    await this.mutate((state, touch) => {
      for (const scope of unique) {
        const key = hashScope(scope);
        if (state.entries[key] && state.entries[key].reason !== "disabled") {
          delete state.entries[key];
          touch();
        }
      }
    });
  }
  /**
   * Explicit human escape hatch. forceUnlock removes the lock only when its owner pid
   * is provably dead. A live or unreadable owner is refused so a live process's lock
   * is never taken over. Nothing in this module reaps locks on its own.
   */
  async clear(scopes, options = {}) {
    const unique = [...new Set(scopes.filter((scope) => typeof scope === "string" && scope.trim().length > 0))];
    if (options.forceUnlock) {
      let raw;
      try {
        raw = await readFile(this.lockPath, "utf8");
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw new PoolHealthForceUnlockRefusedError(this.lockPath, "the owner file is unreadable");
        }
      }
      if (raw !== void 0) {
        const owner = parseOwner(raw);
        if (!owner) throw new PoolHealthForceUnlockRefusedError(this.lockPath, "the owner file is unreadable");
        if (processAlive(owner.pid)) {
          throw new PoolHealthForceUnlockRefusedError(this.lockPath, "owner pid " + owner.pid + " is still alive", owner.pid);
        }
        if (!await removeOwnerIfContentMatches(this.lockPath, raw)) {
          throw new PoolHealthForceUnlockRefusedError(this.lockPath, "the lock changed while it was being cleared", owner.pid);
        }
      }
    }
    if (!unique.length) return 0;
    return this.mutate((state, touch) => {
      let removed = 0;
      for (const scope of unique) {
        const key = hashScope(scope);
        if (state.entries[key]) {
          delete state.entries[key];
          removed += 1;
          touch();
        }
      }
      return removed;
    });
  }
  /** Why a member is disabled, if it is. Cleared only by a passing Test. */
  async disabledFor(scopes) {
    const state = await this.readState();
    for (const scope of scopes) {
      const entry = state.entries[hashScope(scope)];
      if (entry?.reason === "disabled") return { note: entry.note ?? "disabled after an error", since: entry.updatedAt };
    }
    return void 0;
  }
  /** Highest active cooldown for a route, if any (does not claim recovery). */
  async cooldownFor(route) {
    const now = this.now();
    const state = await this.readState();
    const active = route.scopes.map((scope) => state.entries[hashScope(scope)]).filter((entry) => Boolean(entry) && entry.until > now);
    return active.length ? Math.max(...active.map((entry) => entry.until)) : void 0;
  }
  /**
   * Decide whether this route may be attempted. A cooled-down or already-recovering
   * route is blocked; an expired cooldown grants exactly one cross-process recovery.
   */
  async acquire(route) {
    const now = this.now();
    const scopes = [...new Set(route.scopes.filter((scope) => typeof scope === "string" && scope.trim().length > 0))];
    const outcome = await this.mutate((state, touch) => {
      const relevant = scopes.map((scope) => [scope, state.entries[hashScope(scope)]]).filter((entry) => Boolean(entry[1]));
      const active = relevant.filter(([, entry]) => entry.until > now);
      if (active.length) {
        return {
          blocked: {
            ok: false,
            reason: "cooldown",
            retryAt: Math.max(...active.map(([, entry]) => entry.until)),
            details: active.map(([, entry]) => entry.label + ": " + entry.reason)
          }
        };
      }
      const inFlight = relevant.filter(([, entry]) => this.claimLive(entry.recovery));
      if (inFlight.length) {
        return {
          blocked: {
            ok: false,
            reason: "recovery-in-flight",
            details: inFlight.map(([, entry]) => entry.label + ": recovery-in-flight (pid " + entry.recovery.pid + ")")
          }
        };
      }
      const stale = relevant.filter(([, entry]) => entry.recovery);
      const expiredCooldown = relevant.filter(([, entry]) => entry.until <= now);
      if (!stale.length && !expiredCooldown.length) return {};
      const token2 = randomUUID();
      for (const [scope] of relevant) {
        const entry = state.entries[hashScope(scope)];
        if (!entry) continue;
        entry.recovery = { token: token2, pid: process.pid, startedAt: now };
        touch();
      }
      return { token: token2 };
    });
    if (outcome.blocked) return outcome.blocked;
    if (!outcome.token) {
      return { ok: true, mode: "normal", settle: async () => {
      }, release: async () => {
      } };
    }
    const token = outcome.token;
    let settled = false;
    const settleClaim = async (success) => {
      const at = this.now();
      await this.mutate((state, touch) => {
        for (const scope of scopes) {
          const key = hashScope(scope);
          const entry = state.entries[key];
          if (!entry?.recovery || entry.recovery.token !== token) continue;
          if (success && entry.recovery.superseded) {
            delete entry.recovery;
          } else if (success) {
            delete state.entries[key];
          } else {
            const failures = Math.min(entry.failures + 1, 100);
            const step = this.ladder[Math.min(failures - 1, this.ladder.length - 1)];
            const { recovery: _consumed, ...rest } = entry;
            state.entries[key] = { ...rest, failures, until: Math.max(entry.until, at + step), updatedAt: at };
          }
          touch();
        }
      });
    };
    return {
      ok: true,
      mode: "recovery",
      settle: async (success) => {
        if (settled) return;
        settled = true;
        await settleClaim(success);
      },
      release: async () => {
        if (settled) return;
        settled = true;
        await this.mutate((state, touch) => {
          for (const scope of scopes) {
            const key = hashScope(scope);
            const entry = state.entries[key];
            if (!entry?.recovery || entry.recovery.token !== token) continue;
            delete entry.recovery;
            touch();
          }
        });
      }
    };
  }
  /** Sanitized view for diagnostics and the UI; contains no prompts or credentials. */
  async inspect(route) {
    const state = await this.readState();
    return route.scopes.flatMap((scope) => {
      const entry = state.entries[hashScope(scope)];
      if (!entry) return [];
      return [{
        scope: entry.label,
        reason: entry.reason,
        until: entry.until,
        failures: entry.failures,
        recovering: this.claimLive(entry.recovery),
        ...entry.recovery ? { claimPid: entry.recovery.pid } : {}
      }];
    });
  }
  /** Retained entry count; bounded by MAX_ENTRIES. */
  async size() {
    return Object.keys((await this.readState()).entries).length;
  }
};

// src/pool/session-id.ts
function poolProviderHeaders(provider, model, sessionId) {
  return openCodeGoHeaders(provider.id, model.apiBaseUrl, sessionId, provider.headers) ?? provider.headers;
}

// src/pool/disabled.ts
import pc2 from "picocolors";
function disabledMessage(note) {
  return "Disabled after an error: " + note + ". Test it again to re-enable.";
}
function revisionFor(provider, modelId) {
  const model = provider.models.find((item) => item.id === modelId);
  if (!model?.npm) return void 0;
  return poolEndpointRevision({
    providerId: provider.id,
    authRef: provider.authRef,
    npm: model.npm,
    baseURL: model.apiBaseUrl,
    upstreamModelId: model.upstreamModelId,
    headers: provider.headers
  });
}
async function disabledPoolMembers(providers, pool, store = new PoolHealthStore()) {
  const disabled = /* @__PURE__ */ new Map();
  for (const member of pool.members) {
    const provider = providers.find((item) => item.id === member.providerId);
    const revision = provider ? revisionFor(provider, member.modelId) : void 0;
    if (!revision) continue;
    try {
      const found = await store.disabledFor([poolEndpointScope(member.providerId, revision, member.modelId)]);
      if (found) disabled.set(member.providerId + "/" + member.modelId, found);
    } catch {
    }
  }
  return disabled;
}
async function clearDisabledPoolMember(member, endpointRevision, store = new PoolHealthStore()) {
  try {
    await store.clear([poolEndpointScope(member.providerId, endpointRevision, member.modelId)]);
  } catch {
  }
}
async function warnDisabledPoolMembers(providers, pool, store, write = (line) => console.error(line)) {
  const disabled = await disabledPoolMembers(providers, pool, store);
  for (const [name, info] of disabled) {
    write(pc2.bold(pc2.red("\u26D4 Free pool member disabled: " + name)) + pc2.red(" - " + info.note + ". Test it again (relay-ai ui > Free Pool) to re-enable."));
  }
  return disabled.size;
}

// src/antigravity/slot-registry.ts
var AGY_SLOT_VALIDATION_SOURCE = "AGY CLI 1.0.10 / Antigravity IDE 2.1.1 fixture capture 2026-06-23";
var AGY_NATIVE_SLOT_REGISTRY = [
  {
    slotId: "gemini-3.5-flash-low",
    model: "MODEL_PLACEHOLDER_M20",
    role: "agent-switch",
    status: "validated",
    validatedWith: AGY_SLOT_VALIDATION_SOURCE
  },
  {
    slotId: "gemini-3.5-flash-extra-low",
    model: "MODEL_PLACEHOLDER_M187",
    role: "agent-switch",
    status: "validated",
    validatedWith: AGY_SLOT_VALIDATION_SOURCE
  },
  {
    slotId: "gemini-3.1-pro-low",
    model: "MODEL_PLACEHOLDER_M36",
    role: "agent-switch",
    status: "validated",
    validatedWith: AGY_SLOT_VALIDATION_SOURCE
  },
  {
    slotId: "gemini-pro-agent",
    model: "MODEL_PLACEHOLDER_M16",
    role: "agent-switch",
    status: "validated",
    validatedWith: AGY_SLOT_VALIDATION_SOURCE
  },
  {
    slotId: "claude-sonnet-4-6",
    model: "MODEL_PLACEHOLDER_M35",
    role: "agent-switch",
    status: "validated",
    validatedWith: AGY_SLOT_VALIDATION_SOURCE
  },
  {
    slotId: "claude-opus-4-6-thinking",
    model: "MODEL_PLACEHOLDER_M26",
    role: "agent-switch",
    status: "validated",
    validatedWith: AGY_SLOT_VALIDATION_SOURCE
  },
  {
    slotId: "gpt-oss-120b-medium",
    model: "MODEL_OPENAI_GPT_OSS_120B_MEDIUM",
    role: "agent-switch",
    status: "validated",
    validatedWith: AGY_SLOT_VALIDATION_SOURCE
  },
  {
    slotId: "gemini-3-flash-agent",
    model: "MODEL_PLACEHOLDER_M132",
    role: "cascade-plan",
    status: "reserved",
    validatedWith: AGY_SLOT_VALIDATION_SOURCE,
    notes: "Visible in agentModelSorts, but reserved for cascade plan construction."
  },
  {
    slotId: "gemini-2.5-flash",
    model: "MODEL_GOOGLE_GEMINI_2_5_FLASH",
    role: "cascade-intent",
    status: "reserved",
    validatedWith: AGY_SLOT_VALIDATION_SOURCE
  },
  {
    slotId: "gemini-2.5-flash-lite",
    model: "MODEL_GOOGLE_GEMINI_2_5_FLASH_LITE",
    role: "cascade-fallback",
    status: "reserved",
    validatedWith: AGY_SLOT_VALIDATION_SOURCE
  },
  {
    slotId: "gemini-3.1-pro-high",
    model: "MODEL_PLACEHOLDER_M37",
    role: "agent-switch",
    status: "candidate",
    validatedWith: AGY_SLOT_VALIDATION_SOURCE,
    notes: "Model-shaped fixture entry; requires live switching proof before promotion."
  },
  {
    slotId: "gemini-2.5-pro",
    model: "MODEL_GOOGLE_GEMINI_2_5_PRO",
    role: "agent-switch",
    status: "candidate",
    validatedWith: AGY_SLOT_VALIDATION_SOURCE,
    notes: "Model-shaped fixture entry; requires live switching proof before promotion."
  },
  {
    slotId: "gemini-2.5-flash-thinking",
    model: "MODEL_GOOGLE_GEMINI_2_5_FLASH_THINKING",
    role: "agent-switch",
    status: "candidate",
    validatedWith: AGY_SLOT_VALIDATION_SOURCE,
    notes: "Model-shaped fixture entry; requires live switching proof before promotion."
  },
  {
    slotId: "gemini-3-flash",
    model: "MODEL_PLACEHOLDER_M18",
    role: "command",
    status: "candidate",
    validatedWith: AGY_SLOT_VALIDATION_SOURCE,
    notes: "Command model in the fixture; not switch-safe without live proof."
  },
  {
    slotId: "gemini-3.1-flash-lite",
    model: "MODEL_PLACEHOLDER_M50",
    role: "cascade-checkpoint",
    status: "candidate",
    validatedWith: AGY_SLOT_VALIDATION_SOURCE,
    notes: "Checkpoint/search/commit slot; route as helper until live proof exists."
  },
  {
    slotId: "gemini-3.1-flash-image",
    model: "MODEL_PLACEHOLDER_M21",
    role: "image",
    status: "candidate",
    validatedWith: AGY_SLOT_VALIDATION_SOURCE,
    notes: "Image generation slot; not switch-safe without live proof."
  },
  {
    slotId: "tab_jump_flash_lite_preview",
    model: "MODEL_PLACEHOLDER_M28",
    role: "tab",
    status: "unsafe",
    validatedWith: AGY_SLOT_VALIDATION_SOURCE
  },
  {
    slotId: "tab_flash_lite_preview",
    model: "MODEL_PLACEHOLDER_M19",
    role: "tab",
    status: "unsafe",
    validatedWith: AGY_SLOT_VALIDATION_SOURCE
  },
  {
    slotId: "chat_20706",
    model: "MODEL_CHAT_20706",
    role: "chat",
    status: "unsafe",
    validatedWith: AGY_SLOT_VALIDATION_SOURCE
  },
  {
    slotId: "chat_23310",
    model: "MODEL_CHAT_23310",
    role: "chat",
    status: "unsafe",
    validatedWith: AGY_SLOT_VALIDATION_SOURCE
  }
];
var KNOWN_COMPATIBLE_AGY_VERSIONS = /* @__PURE__ */ new Set([
  "1.0.10",
  "1.1.0",
  "1.1.1",
  "1.1.2",
  "1.1.3",
  "1.1.4",
  "1.1.5",
  "1.1.6",
  "1.1.7"
]);
var KNOWN_INCOMPATIBLE_AGY_VERSIONS = /* @__PURE__ */ new Set(["1.0.9"]);
function withFixtureModel(definition, model) {
  return model === definition.model ? definition : { ...definition, model };
}
function assertNoDuplicateSwitchEnums(fixture, definitions) {
  const seen = /* @__PURE__ */ new Map();
  for (const definition of definitions) {
    if (definition.status !== "validated") continue;
    const actualModel = fixture.models[definition.slotId]?.model;
    if (!actualModel) continue;
    const previousSlotId = seen.get(actualModel);
    if (previousSlotId) {
      throw new Error(
        `Duplicate AGY switch slot enum ${actualModel}: ${previousSlotId} and ${definition.slotId}`
      );
    }
    seen.set(actualModel, definition.slotId);
  }
}
function validateAgySlotRegistry(fixture) {
  assertNoDuplicateSwitchEnums(fixture, AGY_NATIVE_SLOT_REGISTRY);
  const switchSlots = [];
  const reservedSlots = [];
  const candidateSlots = [];
  const warnings = [];
  for (const definition of AGY_NATIVE_SLOT_REGISTRY) {
    const entry = fixture.models[definition.slotId];
    if (!entry) {
      if (definition.status === "validated" || definition.status === "reserved") {
        warnings.push(`AGY slot ${definition.slotId} missing from fixture`);
      }
      continue;
    }
    if (entry.model !== definition.model) {
      warnings.push(
        `AGY slot ${definition.slotId} expected ${definition.model} but fixture has ${entry.model}`
      );
      continue;
    }
    if (definition.status === "validated") {
      switchSlots.push(withFixtureModel(definition, entry.model));
    } else if (definition.status === "reserved") {
      reservedSlots.push(withFixtureModel(definition, entry.model));
    } else if (definition.status === "candidate") {
      candidateSlots.push(withFixtureModel(definition, entry.model));
    }
  }
  return { switchSlots, reservedSlots, candidateSlots, warnings };
}
function getValidatedAgySwitchSlots(fixture) {
  return validateAgySlotRegistry(fixture).switchSlots;
}
function evaluateAgySwitchCompatibility(opts) {
  const validation = validateAgySlotRegistry(opts.fixture);
  const shapeMatches = validation.warnings.length === 0 && validation.switchSlots.length > 0;
  const warnings = [];
  if (opts.versionReadError) {
    warnings.push(`Could not read agy --version (${opts.versionReadError}); validating AGY fixture shape instead.`);
  }
  if (opts.version && KNOWN_INCOMPATIBLE_AGY_VERSIONS.has(opts.version)) {
    return {
      mode: "single-model",
      validatedSwitchSlotCount: validation.switchSlots.length,
      warnings: [
        ...warnings,
        `Known-incompatible AGY version ${opts.version}; falling back to single-model mode.`
      ]
    };
  }
  if (!shapeMatches) {
    return {
      mode: "single-model",
      validatedSwitchSlotCount: validation.switchSlots.length,
      warnings: [
        ...warnings,
        ...validation.warnings,
        "AGY fixture shape does not match the validated slot registry; falling back to single-model mode."
      ]
    };
  }
  if (opts.version && !KNOWN_COMPATIBLE_AGY_VERSIONS.has(opts.version)) {
    warnings.push(
      `AGY version ${opts.version} is not in the explicitly validated set, but its slot config shape matches; multi-model switching is enabled.`
    );
  } else if (!opts.version && !opts.versionReadError) {
    warnings.push("AGY version is unknown; fixture shape matches, so multi-model switching remains enabled.");
  }
  return {
    mode: "multi-model",
    validatedSwitchSlotCount: validation.switchSlots.length,
    warnings
  };
}

// src/antigravity/catalog.ts
var RELAY_CASCADE_PLAN_MODEL = "MODEL_PLACEHOLDER_M132";
var RELAY_AGENT_PLACEHOLDER = "MODEL_PLACEHOLDER_M20";
var RELAY_CASCADE_CHECKPOINT_MODEL = "MODEL_PLACEHOLDER_M50";
var RELAY_CASCADE_INTENT_MODEL = "MODEL_GOOGLE_GEMINI_2_5_FLASH";
var RELAY_CASCADE_ANCHOR_ID = "gemini-3.5-flash-low";
var RELAY_CASCADE_PLAN_ANCHOR_ID = "gemini-3-flash-agent";
var RELAY_CASCADE_FALLBACK_ID = "gemini-2.5-flash-lite";
var RELAY_CASCADE_INTENT_MODEL_ID = "gemini-2.5-flash";
var RELAY_KEY_PREFIX = "relay-";
function nativeEntries(catalog) {
  return Object.entries(catalog.models).filter(([key]) => !key.startsWith(RELAY_KEY_PREFIX));
}
function unusedModelEnums(catalog, count) {
  const used = new Set(nativeEntries(catalog).map(([, entry]) => entry.model));
  const out = [];
  for (let n = 400; out.length < count && n < 650; n += 1) {
    const candidate = `MODEL_PLACEHOLDER_M${n}`;
    if (!used.has(candidate)) out.push(candidate);
  }
  return out;
}
function overflowSlotId(catalogId, taken) {
  const base = catalogId.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  taken.add(id);
  return id;
}
function withCascadeCheckpointer(entry, maxTokenLimit = 128e3) {
  const tokenThreshold = Math.min(5e4, Math.floor(maxTokenLimit * 0.75));
  const existingModelExperiments = entry.modelExperiments;
  entry.modelExperiments = {
    ...existingModelExperiments,
    experiments: {
      ...existingModelExperiments?.experiments ?? {},
      CASCADE_USE_EXPERIMENT_CHECKPOINTER: {
        stringValue: JSON.stringify({
          strategy: "CHECKPOINT_STRATEGY_SAME_MODEL",
          max_token_limit: String(maxTokenLimit),
          token_threshold: String(tokenThreshold),
          max_overhead_ratio: "0.15",
          moving_window_size: "1",
          enabled: true,
          max_output_tokens: "16384",
          checkpoint_model: RELAY_CASCADE_CHECKPOINT_MODEL,
          use_last_planner_model: true,
          is_sync: true,
          max_user_requests: 10,
          include_last_user_message: true,
          include_conversation_log: false,
          include_running_task_snapshots: true,
          include_subagent_snapshots: true,
          include_artifact_snapshots: true,
          retry_config: {
            max_retries: 0,
            initial_sleep_duration_ms: 1e3,
            exponential_multiplier: 2,
            include_error_feedback: false
          }
        })
      }
    }
  };
  return entry;
}
var ANTIGRAVITY_REQUIRED_INPUT_TOKENS = 128e3;
var ANTIGRAVITY_MIN_OUTPUT_TOKENS = 8192;
var ANTIGRAVITY_MIN_CONTEXT_WINDOW = ANTIGRAVITY_REQUIRED_INPUT_TOKENS + ANTIGRAVITY_MIN_OUTPUT_TOKENS;
function applyRouteContextBounds(entry, route) {
  const maxTokenLimit = route.contextWindow ?? 128e3;
  const maxOutputTokens = Math.min(
    entry.maxOutputTokens ?? 65536,
    Math.max(
      ANTIGRAVITY_MIN_OUTPUT_TOKENS,
      maxTokenLimit - ANTIGRAVITY_REQUIRED_INPUT_TOKENS
    )
  );
  const checkpointTokenLimit = Math.min(
    128e3,
    Math.max(1, maxTokenLimit - maxOutputTokens)
  );
  entry.maxTokens = maxTokenLimit;
  entry.maxOutputTokens = maxOutputTokens;
  return withCascadeCheckpointer(entry, checkpointTokenLimit);
}
var RELAY_CASCADE_FALLBACK_ENTRY = withCascadeCheckpointer({
  displayName: "Gemini 3.1 Flash Lite",
  model: "MODEL_GOOGLE_GEMINI_2_5_FLASH_LITE",
  apiProvider: "API_PROVIDER_GOOGLE_GEMINI",
  modelProvider: "MODEL_PROVIDER_GOOGLE",
  tokenizerType: "LLAMA_WITH_SPECIAL",
  maxTokens: 1048576,
  maxOutputTokens: 65535,
  quotaInfo: { remainingFraction: 1 }
});
var RELAY_CASCADE_INTENT_MODEL_ENTRY = withCascadeCheckpointer({
  ...RELAY_CASCADE_FALLBACK_ENTRY,
  model: RELAY_CASCADE_INTENT_MODEL
});
function planRelayCatalogSlots(catalog, routes, templateKey, opts = {}) {
  const validation = validateAgySlotRegistry(catalog);
  const switchSlots = getValidatedAgySwitchSlots(catalog);
  const templateSlot = switchSlots.find((slot) => slot.slotId === templateKey);
  const orderedSlots = templateSlot ? [templateSlot, ...switchSlots.filter((slot) => slot.slotId !== templateKey)] : switchSlots;
  if (routes.length > 0 && orderedSlots.length === 0) {
    throw new Error("No validated AGY switch slots are available for the selected launch route");
  }
  const nativeCount = opts.nativeSlots === false ? 0 : orderedSlots.length;
  const nativeRoutes = routes.slice(0, nativeCount);
  const overflowRoutes = routes.slice(nativeCount);
  const slots = nativeRoutes.map((route, index) => ({
    slotId: orderedSlots[index].slotId,
    route
  }));
  const enums = unusedModelEnums(catalog, overflowRoutes.length);
  const taken = new Set(nativeEntries(catalog).map(([key]) => key));
  overflowRoutes.slice(0, enums.length).forEach((route, index) => {
    slots.push({ slotId: overflowSlotId(route.catalogId, taken), route, extraModelEnum: enums[index] });
  });
  const switchableRoutes = slots.map((slot) => slot.route);
  const skippedRoutes = overflowRoutes.slice(enums.length);
  return {
    slots,
    switchableRoutes,
    skippedRoutes,
    validation
  };
}
function resolveRelayCatalogSlots(catalog, routes, templateKey, opts = {}) {
  return planRelayCatalogSlots(catalog, routes, templateKey, opts).slots;
}
function buildRelayCatalogEntry(route, template) {
  const entry = structuredClone(template);
  entry.displayName = route.displayName;
  entry.model = template.model ?? RELAY_AGENT_PLACEHOLDER;
  entry.requestedModelId = route.catalogId;
  entry.modelVersion = route.catalogId;
  entry.modelVersionId = route.catalogId;
  entry.quotaInfo = { remainingFraction: 1, resetTime: "2026-06-23T02:00:57Z" };
  return applyRouteContextBounds(entry, route);
}
function buildRelayCatalogSlotEntry(route, template) {
  const entry = structuredClone(template);
  entry.displayName = route.displayName;
  entry.quotaInfo = { remainingFraction: 1, resetTime: "2026-06-23T02:00:57Z" };
  delete entry.requestedModelId;
  delete entry.modelVersion;
  delete entry.modelVersionId;
  delete entry.isInternal;
  return applyRouteContextBounds(entry, route);
}
function injectRelayModels(fixture, routes, templateKey, opts = {}) {
  const result = structuredClone(fixture);
  const template = fixture.models[templateKey];
  if (!template) {
    throw new Error(`Template model "${templateKey}" not found in catalog fixture`);
  }
  const seen = /* @__PURE__ */ new Set();
  for (const route of routes) {
    if (seen.has(route.catalogId)) {
      throw new Error(`Catalog ID collision: ${route.catalogId}`);
    }
    if (fixture.models[route.catalogId]) {
      throw new Error(`Catalog ID collision with native model: ${route.catalogId}`);
    }
    seen.add(route.catalogId);
  }
  if (routes.length > 0) {
    result.models[RELAY_CASCADE_ANCHOR_ID] ??= structuredClone(template);
    result.models[RELAY_CASCADE_FALLBACK_ID] ??= structuredClone(RELAY_CASCADE_FALLBACK_ENTRY);
    result.models[RELAY_CASCADE_INTENT_MODEL_ID] ??= structuredClone(RELAY_CASCADE_INTENT_MODEL_ENTRY);
    if (!result.models[RELAY_CASCADE_PLAN_ANCHOR_ID]) {
      const planAnchor = withCascadeCheckpointer(structuredClone(template));
      planAnchor.model = RELAY_CASCADE_PLAN_MODEL;
      result.models[RELAY_CASCADE_PLAN_ANCHOR_ID] = planAnchor;
    }
    const slotPlan = planRelayCatalogSlots(result, routes, templateKey, opts);
    const slots = slotPlan.slots;
    for (const { slotId, route, extraModelEnum } of slots) {
      if (extraModelEnum) {
        const entry = buildRelayCatalogEntry(route, template);
        entry.model = extraModelEnum;
        result.models[slotId] = entry;
        continue;
      }
      const slotTemplate = result.models[slotId] ?? template;
      if (result.models[slotId]) {
        result.models[slotId] = buildRelayCatalogSlotEntry(route, slotTemplate);
      }
      result.models[route.catalogId] = buildRelayCatalogEntry(route, slotTemplate);
    }
    result.defaultAgentModelId = slots[0]?.slotId ?? RELAY_CASCADE_ANCHOR_ID;
    result.agentModelSorts = [
      {
        displayName: "Recommended",
        groups: [{
          modelIds: slots.map((slot) => slot.slotId)
        }]
      }
    ];
    for (const entry of Object.values(result.models)) {
      const mimeTypes = entry.supportedMimeTypes;
      if (!mimeTypes || typeof mimeTypes !== "object" || Array.isArray(mimeTypes)) continue;
      entry.supportedMimeTypes = Object.fromEntries(
        Object.entries(mimeTypes).filter(([mime]) => !mime.toLowerCase().includes("audio/"))
      );
    }
    result.audioTranscriptionModelIds = [];
    return result;
  }
  if (!result.agentModelSorts?.[0]?.groups?.[0]) {
    result.agentModelSorts = [
      {
        displayName: "Recommended",
        groups: [{ modelIds: [] }]
      }
    ];
  }
  return result;
}
function buildAntigravityRoutes(resolvedFavorites, maxRoutes = MAX_MODEL_CATALOG, opts = {}) {
  const effortMode = opts.effortMode ?? "rows";
  const groups = [];
  const seen = /* @__PURE__ */ new Set();
  for (const fav of resolvedFavorites) {
    if (groups.length >= maxRoutes) break;
    const favModel = fav.model;
    const modelId = favModel.id;
    const safeModelSlug = modelId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const catalogId = `relay-ai__${fav.providerId}__${safeModelSlug}`;
    if (seen.has(catalogId)) continue;
    seen.add(catalogId);
    const npm = favModel.npm || "@ai-sdk/openai-compatible";
    const upstreamModelId = favModel.upstreamModelId || modelId;
    const baseURL = favModel.apiBaseUrl || favModel.completionsUrl || void 0;
    const contextWindow = favModel.contextWindow;
    const modelFormat = favModel.modelFormat;
    const baseRoute = {
      catalogId,
      providerId: fav.providerId,
      providerName: fav.providerName,
      modelId,
      upstreamModelId,
      displayName: `${favModel.name} (Relay)`,
      ...modelFormat ? { modelFormat } : {},
      npm,
      apiKey: fav.apiKey,
      ...fav.authType ? { authType: fav.authType } : {},
      ...fav.oauthAccountId ? { oauthAccountId: fav.oauthAccountId } : {},
      ...fav.providerData ? { providerData: fav.providerData } : {},
      ...fav.headers ? { headers: fav.headers } : {},
      ...fav.refreshToken ? { refreshToken: fav.refreshToken } : {},
      baseURL,
      contextWindow
    };
    groups.push({ routes: effortVariants(baseRoute, favModel, groups.length === 0, effortMode) });
  }
  const included = groups.slice(0, maxRoutes);
  const extrasByGroup = included.map(() => 0);
  let remaining = Math.max(0, maxRoutes - included.length);
  if (remaining > 0 && included.length > 0) {
    const launchExtra = Math.min(included[0].routes.length - 1, remaining);
    extrasByGroup[0] = launchExtra;
    remaining -= launchExtra;
  }
  while (remaining > 0) {
    let progressed = false;
    for (let index = 1; index < included.length && remaining > 0; index += 1) {
      const extraCount = included[index].routes.length - 1;
      if (extrasByGroup[index] >= extraCount) continue;
      extrasByGroup[index] += 1;
      remaining -= 1;
      progressed = true;
    }
    if (!progressed) break;
  }
  const routes = included.flatMap((group, index) => [
    group.routes[0],
    ...group.routes.slice(1, 1 + extrasByGroup[index])
  ]);
  const labeled = applyUniqueAntigravityRouteLabels(routes);
  if (effortMode !== "submenu") return labeled;
  return labeled.map((route) => {
    if (!route.reasoningEffort || !["low", "medium", "high"].includes(route.reasoningEffort)) return route;
    const label = effortLabel(route.reasoningEffort);
    return { ...route, displayName: `${route.displayName.replace(` ${label} (Relay`, " (Relay")} (${label})` };
  });
}
function favoriteEffortLevels(levels, defaultLevel) {
  let start = levels.indexOf("medium");
  if (start < 0) start = Math.max(0, levels.indexOf(defaultLevel));
  let from = start;
  let to = Math.min(levels.length, start + 3);
  while (to - from < 3 && from > 0) from -= 1;
  return levels.slice(from, to);
}
function effortLabel(level) {
  return level === "xhigh" ? "XHigh" : level.charAt(0).toUpperCase() + level.slice(1);
}
var AGY_SLIDER_LEVELS = ["low", "medium", "high", "max"];
var AGY_EXTRA_LEVELS = ["xhigh"];
function effortVariants(route, model, isLaunchModel, effortMode) {
  if (route.modelFormat === "cloud-code") return [route];
  const m = model;
  const metadata = {
    providerId: route.providerId,
    upstreamModelId: route.upstreamModelId,
    ...route.baseURL ? { apiBaseUrl: route.baseURL } : {},
    ...m.supportedParameters ? { supportedParameters: m.supportedParameters } : {},
    ...m.reasoning !== void 0 ? { reasoning: m.reasoning } : {},
    ...m.interleavedReasoningField ? { interleavedReasoningField: m.interleavedReasoningField } : {},
    ...m.reasoningEffortLevels ? { reasoningEffortLevels: m.reasoningEffortLevels } : {},
    ...m.reasoningEffortConflict ? { reasoningEffortConflict: true } : {}
  };
  const caps = getReasoningCapabilities(route.npm, route.upstreamModelId, metadata);
  if (caps.mode !== "controllable" || caps.levels.length < 2) return [route];
  const rank = (level) => {
    const index = EFFORT_RANK.indexOf(level);
    return index < 0 ? EFFORT_RANK.length : index;
  };
  const ordered = [...caps.levels].sort((a, b) => rank(a) - rank(b));
  const folded = effortMode === "slider" || effortMode === "submenu";
  const levels = folded ? ordered.filter((level) => AGY_SLIDER_LEVELS.includes(level) || AGY_EXTRA_LEVELS.includes(level)) : isLaunchModel ? ordered : favoriteEffortLevels(ordered, caps.defaultLevel);
  if (levels.length < 2) return [route];
  const baseName = routeBaseModelName(route);
  const sliderRowLevel = effortMode === "slider" ? levels.find((level) => AGY_SLIDER_LEVELS.includes(level)) : void 0;
  return levels.map((level) => ({
    ...route,
    catalogId: `${route.catalogId}__effort_${level}`,
    displayName: level === sliderRowLevel ? `${baseName} (Relay)` : `${baseName} ${effortLabel(level)} (Relay)`,
    reasoningEffort: level,
    reasoningMetadata: metadata
  }));
}
function routeBaseModelName(route) {
  const relayMatch = route.displayName.match(/^(.*) \(Relay(?: - .*)?\)$/);
  return relayMatch?.[1] ?? route.displayName;
}
function authKindLabel(route) {
  if (route.authType === "oauth") return "OAuth";
  if (route.authType === "api") return "API key";
  if (route.authType === "none") return "local";
  return "provider";
}
function duplicateCounts(values) {
  const counts = /* @__PURE__ */ new Map();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}
function assertUniqueRouteDisplayNames(routes) {
  const counts = duplicateCounts(routes.map((route) => route.displayName));
  const duplicate = [...counts.entries()].find(([, count]) => count > 1);
  if (duplicate) {
    throw new Error(`Duplicate AGY model label after disambiguation: ${duplicate[0]}`);
  }
}
function applyUniqueAntigravityRouteLabels(routes) {
  const baseNames = routes.map(routeBaseModelName);
  const providerNameCounts = duplicateCounts(
    [...new Set(routes.map((route) => `${route.providerId}\0${route.providerName}`))].map((key) => key.split("\0")[1])
  );
  const labeled = routes.map((route, index) => {
    const baseName = baseNames[index];
    const providerName = route.providerName || route.providerId;
    const providerSuffix = (providerNameCounts.get(providerName) ?? 0) > 1 ? `${providerName} ${authKindLabel(route)}` : providerName;
    return {
      ...route,
      displayName: `${baseName} (Relay - ${providerSuffix})`
    };
  });
  const firstPassCounts = duplicateCounts(labeled.map((route) => route.displayName));
  const withProviderIds = labeled.map((route) => {
    if ((firstPassCounts.get(route.displayName) ?? 0) <= 1) return route;
    return {
      ...route,
      displayName: route.displayName.replace(/\)$/, ` - ${route.providerId})`)
    };
  });
  assertUniqueRouteDisplayNames(withProviderIds);
  return withProviderIds;
}
function routeLabels(routes) {
  assertUniqueRouteDisplayNames(routes);
  const labels = /* @__PURE__ */ new Map();
  for (const route of routes) {
    labels.set(route.catalogId, route.displayName);
  }
  return labels;
}
function buildClientModelConfigData(routes, catalog, templateKey = RELAY_CASCADE_ANCHOR_ID, precomputedSlots) {
  const catalogRoutes = routes.slice(0, MAX_MODEL_CATALOG);
  const slots = precomputedSlots ?? (catalog ? resolveRelayCatalogSlots(catalog, catalogRoutes, templateKey) : catalogRoutes.map((route) => ({ slotId: route.catalogId, route })));
  const labels = routeLabels(catalogRoutes);
  const clientModelConfigs = slots.map(({ slotId, route }) => {
    const entry = catalog?.models[slotId] ?? catalog?.models[route.catalogId] ?? catalog?.models[RELAY_CASCADE_ANCHOR_ID];
    const label = labels.get(route.catalogId) ?? route.displayName;
    return {
      label,
      modelOrAlias: {
        alias: slotId,
        choice: { case: "alias", value: slotId }
      },
      disabled: false,
      supportedMimeTypes: entry?.supportedMimeTypes ?? {},
      quotaInfo: entry?.quotaInfo ?? { remainingFraction: 1 },
      tagTitle: entry?.tagTitle,
      tagDescription: entry?.tagDescription,
      supportsThoughtCirculation: entry?.supportsThoughtCirculation ?? false
    };
  });
  return {
    clientModelConfigs,
    clientModelSorts: [
      {
        name: "Recommended",
        groups: [
          {
            groupName: "",
            modelLabels: clientModelConfigs.map((config) => config.label)
          }
        ]
      }
    ],
    defaultOverrideModelConfig: clientModelConfigs[0] ?? {}
  };
}
function buildListModelConfigsResponse(routes, catalog, templateKey = RELAY_CASCADE_ANCHOR_ID, opts = {}) {
  const catalogRoutes = routes.slice(0, MAX_MODEL_CATALOG);
  const slots = catalog ? resolveRelayCatalogSlots(catalog, catalogRoutes, templateKey, opts) : catalogRoutes.map((route) => ({ slotId: route.catalogId, route }));
  const config = slots.map(({ slotId }) => ({
    requestedModelId: slotId,
    planModel: RELAY_CASCADE_PLAN_MODEL,
    requestedModel: catalog?.models[slotId]?.model ?? RELAY_AGENT_PLACEHOLDER
  }));
  return {
    ...buildClientModelConfigData(routes, catalog, templateKey, slots),
    allowedModelConfigs: config,
    defaultAgentModelConfig: config[0] ?? {}
  };
}
var CURRENT_EXPERIMENT_IDS = [
  105979552,
  105979574,
  106015351,
  105979579,
  105867471,
  105979530,
  105995634,
  106121401,
  106100625,
  104638466,
  101868197,
  104817729,
  105695344,
  106064591,
  104913215,
  106324349,
  106309078,
  105821930,
  104922093,
  103012598,
  106143956,
  105856899,
  106312323,
  106064030,
  105746183,
  105757908,
  104892493,
  105822886,
  105785683,
  105721273,
  105897325,
  105658071,
  106240758,
  105943702,
  106106760,
  106283618,
  105620019,
  106038160,
  106309520,
  106281951,
  106264532,
  106222835,
  106094629,
  105887313,
  105849474,
  106032303,
  106228452,
  106113900,
  106121607,
  105979531,
  105979553,
  106015328,
  105867469,
  105979517,
  106121399,
  106100654,
  104638459,
  101551624,
  104673683,
  105695346,
  106064590,
  104913210,
  105821928,
  104922082,
  103012592,
  106064028,
  105746181,
  104892490,
  105822881,
  105721268,
  105895316,
  105658068,
  106240748,
  105943694,
  106283614,
  105620012,
  106038153,
  105887311,
  106032301,
  106113877,
  106121604
];
var ANTIGRAVITY_FEATURE_FLAGS = [
  { name: "Chat__enable_mcp_server_ij", boolValue: true },
  { name: "DatacloudMcp__enable_stdio_mcp_proxy", boolValue: true },
  { name: "enable-customization-kind-mcp", boolValue: true },
  // Without this AGY loads MCP tools inline during the turn and blocks for a
  // fixed ~18 s (UI shows "Initializing MCP servers") before the first model
  // request, on every turn. The key is a compile-time literal in the AGY Go
  // binary; the old `mcp-lazy-load-tools` name never existed there, so the
  // deferral it promised never engaged.
  { name: "enable-mcp-non-blocking-turn-load", boolValue: true }
];
function buildListExperimentsResponse() {
  return {
    experimentIds: [...CURRENT_EXPERIMENT_IDS],
    flags: ANTIGRAVITY_FEATURE_FLAGS.map((flag) => ({ ...flag }))
  };
}

// src/target-compatibility.ts
function blacklistAgentForTarget(target) {
  if (target === "claude-app") return "codex-app";
  return target;
}
function contextFloorForTarget(target) {
  if (target === "antigravity") return ANTIGRAVITY_MIN_CONTEXT_WINDOW;
  if (target === "server") return 0;
  return MIN_CONTEXT_WINDOW;
}
function meetsContextFloor(target, contextWindow) {
  return contextWindow === void 0 || contextWindow >= contextFloorForTarget(target);
}
function isTargetCompatibleModel(ctx) {
  const blacklistAgent = blacklistAgentForTarget(ctx.target);
  if (shouldHideModel({ providerId: ctx.providerId, modelId: ctx.model.id, agent: blacklistAgent })) {
    return { compatible: false, reason: "model is hidden by compatibility filters" };
  }
  if (!meetsContextFloor(ctx.target, ctx.model.contextWindow)) {
    const floor = contextFloorForTarget(ctx.target);
    return {
      compatible: false,
      reason: `${ctx.target} needs a ${Math.round(floor / 1e3)}K+ context window; this model has ${Math.round(ctx.model.contextWindow / 1e3)}K`
    };
  }
  if (ctx.model.modelFormat === "cloud-code") {
    if (ctx.target === "server") {
      return { compatible: false, reason: "Cloud Code models are not supported for the server target yet" };
    }
    return { compatible: true };
  }
  if (ctx.model.modelFormat === "anthropic") {
    return { compatible: true };
  }
  if (ctx.model.modelFormat === "openai") {
    if (isProviderKind(ctx.providerId, "zen") || isProviderKind(ctx.providerId, "go")) return { compatible: true };
    if (ctx.model.npm) return { compatible: true };
    return { compatible: false, reason: "OpenAI-format model is missing an SDK provider package" };
  }
  return { compatible: false, reason: `Unsupported model format: ${ctx.model.modelFormat}` };
}
function routableModelsForTarget(provider, target) {
  return provider.models.filter(
    (model) => isTargetCompatibleModel({
      target,
      providerId: provider.id,
      authType: provider.authType,
      model
    }).compatible
  );
}
function providerForTarget(provider, target) {
  return { ...provider, models: routableModelsForTarget(provider, target) };
}
function providersForTarget(providers, target) {
  return providers.map((provider) => providerForTarget(provider, target)).filter((provider) => provider.models.length > 0);
}
function providersForCodexSubagents(providers) {
  const cli = providersForTarget(providers, "codex");
  const app = new Map(
    providersForTarget(providers, "codex-app").map((provider) => [
      provider.id,
      new Set(provider.models.map((model) => model.id))
    ])
  );
  return cli.map((provider) => ({
    ...provider,
    models: provider.models.filter((model) => app.get(provider.id)?.has(model.id))
  })).filter((provider) => provider.models.length > 0);
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
  const freeStatus = poolFreeStatus({ model, providerId: provider.id });
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
  const targets = ["codex", "claude", "antigravity"];
  const effortLevels = [];
  if (deps.probeEffort && model.reasoning) {
    const declared = (model.reasoningEffortLevels ?? []).filter((level) => ["low", "medium", "high", "xhigh", "max"].includes(level));
    const candidates = [...new Set(declared.length > 0 ? declared : ["high"])].slice(0, 4);
    for (const level of candidates) {
      if (await deps.probeEffort(languageModel, level, signal)) effortLevels.push(level);
    }
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

// src/pool/diagnostic.ts
function redactDiagnostic(text, max = 160) {
  const redacted = text.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]").replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{6,}/gi, "[redacted]").replace(
    /\b(?:sk|pk|rk|api[-_]?key|token|secret|authorization)[-_A-Za-z0-9]*\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{6,}/gi,
    "[redacted]"
  ).replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[redacted]").replace(/\s+/g, " ").trim();
  return redacted ? redacted.slice(0, max) : void 0;
}
function poolErrorDetail(error) {
  try {
    const formatted = formatUpstreamError(error);
    const raw = error instanceof Error ? error.message : "";
    const text = formatted && formatted !== "Upstream model request failed." ? formatted : raw;
    return redactDiagnostic(text, 200);
  } catch {
    return void 0;
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
import { randomUUID as randomUUID2 } from "crypto";
function poolMembershipProblem(provider, model) {
  if (poolFreeStatus({ model, providerId: provider.id }) !== "verified_free") return "Requires verified zero pricing";
  if (!model.npm || model.modelFormat === "cloud-code") return "Unsupported pool transport";
  if (!meetsContextFloor("claude", model.contextWindow)) {
    return `Context window is below ${Math.round(contextFloorForTarget("claude") / 1e3)}K, the minimum for Claude Code and Codex`;
  }
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
  return redactDiagnostic(error instanceof Error ? error.message : typeof error === "string" ? error : "");
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
        // Some gateways (OpenCode Go) reject requests that carry no session id header.
        sessionId: `relay-pool-verify-${randomUUID2()}`,
        headers: poolProviderHeaders(provider2, model2, `relay-pool-verify-${randomUUID2()}`),
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
  poolFailure,
  retryPoolFailure,
  poolRouteMember,
  describePoolFailure,
  recordPoolActivity,
  readPoolActivity,
  followPoolActivity,
  PoolRequestGrouper,
  groupPoolActivity,
  formatPoolRequestLines,
  PoolEventFilter,
  formatPoolEventLines,
  summarizePoolEvents,
  formatPoolCurrentLine,
  poolErrorDetail,
  DEFAULT_FORCE_FAIL_MINUTES,
  readForceFailState,
  setForceFail,
  clearForceFail,
  forcedFailures,
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
  poolAccountScope,
  poolEndpointScope,
  PoolHealthStore,
  poolProviderHeaders,
  disabledMessage,
  disabledPoolMembers,
  clearDisabledPoolMember,
  warnDisabledPoolMembers,
  evaluateAgySwitchCompatibility,
  resolveRelayCatalogSlots,
  injectRelayModels,
  buildAntigravityRoutes,
  favoriteEffortLevels,
  effortLabel,
  buildListModelConfigsResponse,
  buildListExperimentsResponse,
  meetsContextFloor,
  routableModelsForTarget,
  providersForTarget,
  providersForCodexSubagents,
  verifyPoolMember,
  poolMembershipProblem,
  poolRoutingProblem,
  poolDiagnostic,
  verifyConfiguredPoolMember
};
//# sourceMappingURL=chunk-YUWP5APP.js.map