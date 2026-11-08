import {
  ANTIGRAVITY_BASE_URLS,
  ANTIGRAVITY_USER_AGENT,
  CLAUDE_CODE_CLI_VERSION,
  RELAY_POOL_ROUTE_ID,
  RelayCoreError,
  VERSION,
  createRelayModel,
  isAntigravityCloudCodeHelperSlot,
  isRelayCoreError,
  listRelayModels,
  loadCoreRegistry,
  parseRelayRouteId,
  providerKind,
  readStoredOAuthCredential,
  resolveProviderCredential,
  resolveProviderOAuthAccountId,
  toRelayRouteId
} from "./chunk-5EDLMNOY.js";
import {
  getAppHome
} from "./chunk-EH4R3WCO.js";

// src/usage/parse.ts
var FIVE_HOURS = 5 * 3600;
var SEVEN_DAYS = 7 * 86400;
var THIRTY_DAYS = 30 * 86400;
function obj(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : void 0;
}
function percent(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}
function round(value) {
  return Math.round(value * 100) / 100;
}
function toIsoTime(value) {
  if (typeof value === "string" && value.trim()) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return new Date(value < 1e12 ? value * 1e3 : value).toISOString();
  }
  const seconds = obj(value)?.["seconds"];
  if (seconds !== void 0) return toIsoTime(typeof seconds === "string" ? Number(seconds) : seconds);
  return null;
}
function durationLabel(seconds) {
  if (seconds === FIVE_HOURS) return { id: "5h", label: "5-hour limit" };
  if (seconds === SEVEN_DAYS) return { id: "7d", label: "Weekly limit" };
  if (seconds === THIRTY_DAYS) return { id: "30d", label: "30-day limit" };
  const hours = Math.round(seconds / 3600);
  return hours % 24 === 0 ? { id: `${hours / 24}d`, label: `${hours / 24}-day limit` } : { id: `${hours}h`, label: `${hours}-hour limit` };
}
function parseClaudeUsage(payload) {
  const data = obj(payload);
  if (!data) return null;
  const windows = [];
  const add = (key, id, label, windowSeconds, family) => {
    const raw = obj(data[key]);
    const used = percent(raw?.["utilization"]);
    if (used === null) return;
    windows.push({
      id,
      label,
      usedPercent: used,
      resetsAt: toIsoTime(raw?.["resets_at"]),
      windowSeconds,
      scope: family ? { type: "model-group", family, modelIds: [] } : { type: "account" }
    });
  };
  add("five_hour", "5h", "5-hour limit", FIVE_HOURS);
  add("seven_day", "7d", "Weekly limit", SEVEN_DAYS);
  add("seven_day_opus", "7d:opus", "Weekly Opus limit", SEVEN_DAYS, "opus");
  add("seven_day_sonnet", "7d:sonnet", "Weekly Sonnet limit", SEVEN_DAYS, "sonnet");
  return windows.length ? windows : null;
}
function parseChatGptUsage(payload) {
  const rate = obj(obj(payload)?.["rate_limit"]);
  if (!rate) return null;
  const windows = [];
  for (const key of ["primary_window", "secondary_window"]) {
    const w = obj(rate[key]);
    const used = percent(w?.["used_percent"]);
    const seconds = w?.["limit_window_seconds"];
    if (used === null || typeof seconds !== "number" || seconds <= 0) continue;
    const resetAfter = w?.["reset_after_seconds"];
    const resetsAt = toIsoTime(w?.["reset_at"]) ?? (typeof resetAfter === "number" && resetAfter >= 0 ? new Date(Date.now() + resetAfter * 1e3).toISOString() : null);
    windows.push({ ...durationLabel(seconds), usedPercent: used, resetsAt, windowSeconds: seconds, scope: { type: "account" } });
  }
  if (!windows.length) return null;
  return { windows, limitReached: rate["limit_reached"] === true || rate["allowed"] === false };
}
function antigravityPool(modelId) {
  if (/^gemini-4(?:[.-]|$)/.test(modelId)) return "gemini-4";
  if (modelId.startsWith("gemini")) return "gemini";
  return "shared";
}
function antigravityGroupLabel(pool, modelIds) {
  if (pool === "gemini-4") return "Gemini 4 models";
  if (pool === "gemini") return "Gemini models";
  const brands = new Set(modelIds.map((id) => id.startsWith("claude") ? "Claude" : id.startsWith("gpt") ? "GPT" : "Other"));
  return `${[...brands].join(" / ")} models`;
}
function parseAntigravityUsage(responses) {
  const perModel = /* @__PURE__ */ new Map();
  for (const response of responses) {
    const models = obj(obj(response)?.["models"]);
    if (!models) continue;
    for (const [id, raw] of Object.entries(models)) {
      if (isAntigravityCloudCodeHelperSlot(id)) continue;
      const quota = obj(obj(raw)?.["quotaInfo"]);
      const remaining = quota?.["remainingFraction"];
      const resetTime = toIsoTime(quota?.["resetTime"]);
      if (typeof remaining !== "number" || !Number.isFinite(remaining) || !resetTime) continue;
      const clamped = Math.min(1, Math.max(0, remaining));
      const existing = perModel.get(id);
      if (!existing || clamped < existing.remaining) perModel.set(id, { remaining: clamped, resetTime });
    }
  }
  if (!perModel.size) return null;
  const groups = /* @__PURE__ */ new Map();
  for (const [id, { remaining, resetTime }] of perModel) {
    const pool = antigravityPool(id);
    const key = `${pool}|${remaining}|${resetTime}`;
    const group = groups.get(key) ?? { pool, remaining, resetTime, modelIds: [] };
    group.modelIds.push(id);
    groups.set(key, group);
  }
  const order = ["gemini-4", "gemini", "shared"];
  return [...groups.values()].sort((a, b) => order.indexOf(a.pool) - order.indexOf(b.pool) || a.resetTime.localeCompare(b.resetTime)).map((group) => {
    group.modelIds.sort();
    return {
      id: `models:${group.pool}:${group.resetTime}`,
      label: antigravityGroupLabel(group.pool, group.modelIds),
      usedPercent: round((1 - group.remaining) * 100),
      resetsAt: group.resetTime,
      scope: { type: "model-group", family: group.pool, modelIds: group.modelIds }
    };
  });
}
var COPILOT_QUOTA_LABELS = {
  premium_interactions: "Premium requests",
  chat: "Chat messages",
  completions: "Code completions"
};
function parseCopilotUsage(payload) {
  const data = obj(payload);
  if (!data) return null;
  const resetsAt = toIsoTime(data["quota_reset_date_utc"]) ?? toIsoTime(data["quota_reset_date"]) ?? toIsoTime(data["limited_user_reset_date"]);
  const windows = [];
  const snapshots = obj(data["quota_snapshots"]);
  if (snapshots) {
    for (const [key, raw] of Object.entries(snapshots)) {
      const snap = obj(raw);
      if (!snap || snap["unlimited"] === true) continue;
      const entitlement = snap["entitlement"];
      if (entitlement === 0) continue;
      let used = null;
      const remainingPct = percent(snap["percent_remaining"]);
      const remaining = snap["remaining"];
      if (remainingPct !== null) used = round(100 - remainingPct);
      else if (typeof entitlement === "number" && entitlement > 0 && typeof remaining === "number") {
        used = round(Math.min(100, Math.max(0, (1 - remaining / entitlement) * 100)));
      }
      if (used === null) continue;
      windows.push({
        id: `monthly:${key}`,
        label: `${COPILOT_QUOTA_LABELS[key] ?? key} (monthly)`,
        usedPercent: used,
        resetsAt,
        ...typeof entitlement === "number" && entitlement > 0 ? { limit: entitlement } : {},
        ...typeof remaining === "number" ? { remaining } : {},
        scope: { type: "account" }
      });
    }
  }
  const monthly = obj(data["monthly_quotas"]);
  const left = obj(data["limited_user_quotas"]);
  if (!windows.length && monthly && left) {
    for (const [key, total] of Object.entries(monthly)) {
      const remaining = left[key];
      if (typeof total !== "number" || total <= 0 || typeof remaining !== "number") continue;
      windows.push({
        id: `monthly:${key}`,
        label: `${COPILOT_QUOTA_LABELS[key] ?? key} (monthly)`,
        usedPercent: round(Math.min(100, Math.max(0, (1 - remaining / total) * 100))),
        resetsAt,
        limit: total,
        remaining,
        scope: { type: "account" }
      });
    }
  }
  return windows.length ? windows : null;
}
function parseXaiUsage(payload) {
  const outer = obj(payload);
  const data = obj(outer?.["config"]) ?? outer;
  if (!data) return null;
  const period = obj(data["currentPeriod"]) ?? obj(data["current_period"]);
  const start = toIsoTime(period?.["start"] ?? period?.["startTime"] ?? data["billingPeriodStart"]);
  const end = toIsoTime(period?.["end"] ?? period?.["endTime"] ?? data["billingPeriodEnd"]);
  const windowSeconds = start && end ? Math.round((Date.parse(end) - Date.parse(start)) / 1e3) : void 0;
  const periodType = typeof period?.["type"] === "string" ? period["type"] : "";
  const windows = [];
  const reported = percent(data["creditUsagePercent"] ?? data["credit_usage_percent"]);
  if (reported !== null || end) {
    const used = reported ?? 0;
    const label = periodType.endsWith("WEEKLY") || windowSeconds && Math.abs(windowSeconds - SEVEN_DAYS) < 3600 ? "Weekly limit" : periodType.endsWith("MONTHLY") || windowSeconds && windowSeconds > 27 * 86400 ? "Monthly limit" : "Usage limit";
    windows.push({
      id: "credits",
      label,
      usedPercent: used,
      resetsAt: end,
      ...windowSeconds && windowSeconds > 0 ? { windowSeconds } : {},
      scope: { type: "account" }
    });
  }
  const products = data["productUsage"] ?? data["product_usage"];
  if (Array.isArray(products)) {
    for (const raw of products) {
      const item = obj(raw);
      const product = typeof item?.["product"] === "string" ? item["product"] : void 0;
      const used = percent(item?.["usagePercent"] ?? item?.["usage_percent"]);
      if (!product || used === null) continue;
      windows.push({
        id: `product:${product}`,
        label: product.replace(/([a-z])([A-Z])/g, "$1 $2"),
        usedPercent: used,
        resetsAt: end,
        ...windowSeconds && windowSeconds > 0 ? { windowSeconds } : {},
        scope: { type: "account" }
      });
    }
  }
  const balances = [];
  const prepaid = obj(data["prepaidBalance"] ?? data["prepaid_balance"]);
  if (prepaid) {
    const raw = prepaid["val"] ?? 0;
    const cents = typeof raw === "string" ? Number(raw) : raw;
    if (typeof cents === "number" && Number.isFinite(cents)) {
      balances.push({ id: "extra-credits", label: "Extra usage credits", amount: cents / 100, currency: "USD" });
    }
  }
  return windows.length || balances.length ? { windows, balances } : null;
}

// src/usage/store.ts
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
var STORE_VERSION = 1;
function usageStorePath() {
  return join(getAppHome(), "usage.json");
}
function readStore(path) {
  try {
    const parsed2 = JSON.parse(readFileSync(path, "utf8"));
    if (parsed2?.version === STORE_VERSION && parsed2.accounts && typeof parsed2.accounts === "object") return parsed2;
  } catch {
  }
  return { version: STORE_VERSION, accounts: {} };
}
function loadStoredUsage(path = usageStorePath()) {
  return readStore(path).accounts;
}
function saveUsageResults(results, path = usageStorePath()) {
  const store = readStore(path);
  for (const result of results) {
    const previous = store.accounts[result.providerId];
    store.accounts[result.providerId] = result.status === "error" && previous?.windows.length ? { ...result, windows: previous.windows, ...previous.balances ? { balances: previous.balances } : {}, fetchedAt: previous.fetchedAt, ...previous.limitReached !== void 0 ? { limitReached: previous.limitReached } : {} } : result;
  }
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(store, null, 2)}
`, { mode: 384 });
  renameSync(tmp, path);
  try {
    chmodSync(path, 384);
  } catch {
  }
  return store.accounts;
}

// src/core/usage.ts
var CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
var CHATGPT_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
var COPILOT_USER_URL = "https://api.github.com/copilot_internal/user";
var XAI_BILLING_URL = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
var DEFAULT_TIMEOUT_MS = 1e4;
var USAGE_KINDS = /* @__PURE__ */ new Set(["claude-code", "openai-oauth", "antigravity", "xai-oauth", "github-copilot"]);
var UsageError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
  code;
};
function statusError(status, provider) {
  if (status === 401) return new UsageError("reauth_required", `${provider} rejected the sign-in \u2014 sign in again in relay-ai.`);
  if (status === 403) return new UsageError("access_denied", `${provider} refused the usage request (403).`);
  if (status === 429) return new UsageError("rate_limited", `${provider} is rate-limiting usage requests \u2014 try again later.`);
  return new UsageError("unavailable", `${provider} usage request failed (${status}).`);
}
async function getJson(ctx, url, init, provider) {
  let response;
  try {
    response = await ctx.fetchImpl(url, { ...init, redirect: "error", signal: AbortSignal.timeout(ctx.timeoutMs) });
  } catch {
    throw new UsageError("unavailable", `${provider} usage request did not complete.`);
  }
  if (!response.ok) throw statusError(response.status, provider);
  try {
    return await response.json();
  } catch {
    throw new UsageError("unsupported_payload", `${provider} returned a usage response Relay could not read.`);
  }
}
function parsed(value, provider) {
  if (value === null) throw new UsageError("unsupported_payload", `${provider} returned no usage Relay recognises.`);
  return value;
}
async function accessToken(provider) {
  let token = null;
  try {
    token = await resolveProviderCredential(provider.id, provider.authRef);
  } catch {
    throw new UsageError("reauth_required", `Could not refresh the sign-in for ${provider.name} \u2014 sign in again in relay-ai.`);
  }
  if (!token) throw new UsageError("credential_unavailable", `No stored sign-in for ${provider.name}.`);
  return token;
}
async function claudeUsage(provider, ctx) {
  const body = await getJson(ctx, CLAUDE_USAGE_URL, {
    headers: {
      Authorization: `Bearer ${await accessToken(provider)}`,
      "anthropic-beta": "oauth-2025-04-20",
      "User-Agent": `claude-cli/${CLAUDE_CODE_CLI_VERSION} (external, cli)`,
      Accept: "application/json"
    }
  }, "Claude");
  const windows = parsed(parseClaudeUsage(body), "Claude");
  return { windows, limitReached: windows.some((w) => w.scope.type === "account" && (w.usedPercent ?? 0) >= 100) };
}
async function chatGptUsage(provider, ctx) {
  const token = await accessToken(provider);
  const accountId = await resolveProviderOAuthAccountId(provider.authRef).catch(() => void 0);
  const body = await getJson(ctx, CHATGPT_USAGE_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      ...accountId ? { "ChatGPT-Account-Id": accountId } : {},
      "User-Agent": "codex-cli",
      Accept: "application/json"
    }
  }, "ChatGPT");
  return parsed(parseChatGptUsage(body), "ChatGPT");
}
async function antigravityUsage(provider, ctx) {
  const token = await accessToken(provider);
  const responses = [];
  let lastError;
  for (const base of ANTIGRAVITY_BASE_URLS) {
    try {
      responses.push(await getJson(ctx, `${base}/v1internal:fetchAvailableModels`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": ANTIGRAVITY_USER_AGENT,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: "{}"
      }, "Antigravity"));
    } catch (err) {
      lastError = err instanceof UsageError ? err : new UsageError("unavailable", "Antigravity usage request failed.");
    }
  }
  if (!responses.length) throw lastError ?? new UsageError("unavailable", "Antigravity usage request failed.");
  const windows = parsed(parseAntigravityUsage(responses), "Antigravity");
  return { windows };
}
async function copilotUsage(provider, ctx) {
  const stored = await readStoredOAuthCredential(provider.authRef).catch(() => void 0);
  if (!stored?.refresh) throw new UsageError("credential_unavailable", `No stored GitHub sign-in for ${provider.name}.`);
  const body = await getJson(ctx, COPILOT_USER_URL, {
    headers: {
      Authorization: `Bearer ${stored.refresh}`,
      Accept: "application/json",
      "User-Agent": `relay-ai/${VERSION}`,
      "Editor-Version": "vscode/1.85.1",
      "X-GitHub-Api-Version": "2025-04-01"
    }
  }, "GitHub Copilot");
  const windows = parsed(parseCopilotUsage(body), "GitHub Copilot");
  return { windows, limitReached: windows.some((w) => w.id === "monthly:premium_interactions" && (w.usedPercent ?? 0) >= 100) };
}
async function xaiUsage(provider, ctx) {
  const body = await getJson(ctx, XAI_BILLING_URL, {
    headers: {
      Authorization: `Bearer ${await accessToken(provider)}`,
      "X-XAI-Token-Auth": "xai-grok-cli",
      Accept: "application/json"
    }
  }, "xAI");
  const { windows, balances } = parsed(parseXaiUsage(body), "xAI");
  return { windows, balances, limitReached: windows.some((w) => w.id === "credits" && (w.usedPercent ?? 0) >= 100) };
}
var FETCHERS = {
  "claude-code": claudeUsage,
  "openai-oauth": chatGptUsage,
  antigravity: antigravityUsage,
  "xai-oauth": xaiUsage,
  "github-copilot": copilotUsage
};
function supportsAccountUsage(providerId) {
  return USAGE_KINDS.has(providerKind(providerId));
}
async function usageForProvider(provider, ctx) {
  const kind = providerKind(provider.id);
  const base = { providerId: provider.id, providerKind: kind, providerName: provider.name };
  const fetcher = FETCHERS[kind];
  if (!fetcher) return { ...base, status: "unsupported", windows: [], fetchedAt: null };
  try {
    const result = await fetcher(provider, ctx);
    return {
      ...base,
      status: "ok",
      windows: result.windows,
      ...result.balances?.length ? { balances: result.balances } : {},
      ...result.limitReached !== void 0 ? { limitReached: result.limitReached } : {},
      fetchedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  } catch (err) {
    const error = err instanceof UsageError ? err : new UsageError("unavailable", `Usage lookup failed for ${provider.name}.`);
    return { ...base, status: "error", windows: [], fetchedAt: null, error: { code: error.code, message: error.message } };
  }
}
function oauthAccounts(opts) {
  const registry = loadCoreRegistry(opts.registryPath);
  const wanted = opts.providerIds ? new Set(opts.providerIds) : void 0;
  return registry.providers.filter((p) => p.enabled && p.authType === "oauth" && (!wanted || wanted.has(p.id)));
}
var inFlight = /* @__PURE__ */ new Map();
function checkOnce(provider, ctx, key) {
  const running = inFlight.get(key);
  if (running) return running;
  const check = usageForProvider(provider, ctx).finally(() => inFlight.delete(key));
  inFlight.set(key, check);
  return check;
}
async function checkAccounts(providers, opts) {
  const ctx = { fetchImpl: opts.fetchImpl ?? globalThis.fetch, timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS };
  const scope = `${opts.registryPath ?? ""}|${opts.usageStorePath ?? ""}`;
  const results = await Promise.all(providers.map((provider) => checkOnce(provider, ctx, `${scope}|${provider.id}`)));
  if (opts.persist === false) return results;
  const stored = saveUsageResults(results.filter((r) => r.status !== "unsupported"), opts.usageStorePath);
  return results.map((r) => stored[r.providerId] ?? r);
}
async function getRelayAccountUsage(opts = {}) {
  return checkAccounts(oauthAccounts(opts), opts);
}
async function readRelayAccountUsage(opts = {}) {
  const providers = oauthAccounts(opts);
  const stored = loadStoredUsage(opts.usageStorePath);
  const missing = providers.filter((p) => supportsAccountUsage(p.id) && !stored[p.id]);
  const fetched = opts.fetchMissing && missing.length ? new Map((await checkAccounts(missing, opts)).map((r) => [r.providerId, r])) : /* @__PURE__ */ new Map();
  return providers.map((provider) => {
    const kind = providerKind(provider.id);
    const base = { providerId: provider.id, providerKind: kind, providerName: provider.name };
    if (!supportsAccountUsage(provider.id)) return { ...base, status: "unsupported", windows: [], fetchedAt: null };
    const reading = fetched.get(provider.id) ?? stored[provider.id];
    return reading ? { ...reading, ...base } : { ...base, status: "unchecked", windows: [], fetchedAt: null };
  });
}
export {
  RELAY_POOL_ROUTE_ID,
  RelayCoreError,
  createRelayModel,
  getRelayAccountUsage,
  isRelayCoreError,
  listRelayModels,
  parseRelayRouteId,
  readRelayAccountUsage,
  supportsAccountUsage,
  toRelayRouteId
};
//# sourceMappingURL=index.js.map