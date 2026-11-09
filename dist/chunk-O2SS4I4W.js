#!/usr/bin/env node
import {
  deleteProviderCredential,
  readStoredProviderCredential,
  saveProviderCredential
} from "./chunk-OYXXDDPI.js";
import {
  getAppHome
} from "./chunk-XEH2JMTL.js";

// src/intelligence/artificial-analysis.ts
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
var AA_AUTH_REF = "keyring:integration:artificial-analysis";
var AA_FREE_MODELS_URL = "https://artificialanalysis.ai/api/v2/language/models/free";
var AA_SITE_URL = "https://artificialanalysis.ai/";
var AA_MAX_AGE_MS = 24 * 60 * 60 * 1e3;
var MAX_PAGES = 10;
var REQUEST_TIMEOUT_MS = 2e4;
var IntelligenceError = class extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
  code;
};
function cachePath() {
  return join(getAppHome(), "intelligence.json");
}
function loadIntelligenceCache() {
  try {
    const parsed = JSON.parse(readFileSync(cachePath(), "utf8"));
    return typeof parsed?.fetchedAt === "string" && Array.isArray(parsed.models) ? parsed : null;
  } catch {
    return null;
  }
}
function writeIntelligenceCache(cache) {
  const path = cachePath();
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(cache), { mode: 384 });
  renameSync(tmp, path);
  try {
    chmodSync(path, 384);
  } catch {
  }
}
async function hasIntelligenceKey() {
  return Boolean(await readStoredProviderCredential(AA_AUTH_REF).catch(() => null));
}
async function saveIntelligenceKey(key) {
  return saveProviderCredential(AA_AUTH_REF, key.trim());
}
async function removeIntelligence() {
  await deleteProviderCredential(AA_AUTH_REF).catch(() => false);
  try {
    writeFileSync(cachePath(), JSON.stringify({ fetchedAt: (/* @__PURE__ */ new Date(0)).toISOString(), models: [] }));
  } catch {
  }
}
function isIntelligenceStale(cache, now = Date.now()) {
  if (!cache || cache.models.length === 0) return true;
  const age = now - Date.parse(cache.fetchedAt);
  return !Number.isFinite(age) || age >= AA_MAX_AGE_MS;
}
async function fetchIntelligenceScores(key, fetchImpl = fetch) {
  const models = [];
  let indexVersion;
  for (let page = 1; page <= MAX_PAGES; page++) {
    let response;
    try {
      response = await fetchImpl(`${AA_FREE_MODELS_URL}?page=${page}`, {
        headers: { "x-api-key": key, Accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
    } catch {
      throw new IntelligenceError("Could not reach Artificial Analysis. Check your connection.", "network");
    }
    if (response.status === 401 || response.status === 403) throw new IntelligenceError("Artificial Analysis rejected this key. Check that you copied it correctly.", "rejected");
    if (response.status === 429) throw new IntelligenceError("Artificial Analysis daily request limit reached. Try again tomorrow.", "rate-limit");
    if (!response.ok) throw new IntelligenceError(`Artificial Analysis returned HTTP ${response.status}.`, "bad-response");
    const body = await response.json().catch(() => null);
    if (!body || !Array.isArray(body.data)) throw new IntelligenceError("Artificial Analysis sent an unexpected response.", "bad-response");
    if (typeof body.intelligence_index_version === "number") indexVersion = body.intelligence_index_version;
    for (const row of body.data) {
      const score = row.evaluations?.artificial_analysis_intelligence_index;
      if (typeof row.slug !== "string" || typeof score !== "number" || !Number.isFinite(score)) continue;
      models.push({
        slug: row.slug,
        name: typeof row.name === "string" ? row.name : row.slug,
        score,
        ...typeof row.model_creator?.name === "string" ? { creator: row.model_creator.name } : {}
      });
    }
    if (body.pagination?.has_more !== true) break;
  }
  return { fetchedAt: (/* @__PURE__ */ new Date()).toISOString(), ...indexVersion === void 0 ? {} : { indexVersion }, models };
}
async function refreshIntelligence(fetchImpl = fetch) {
  const key = await readStoredProviderCredential(AA_AUTH_REF).catch(() => null);
  if (!key) throw new IntelligenceError("Add your Artificial Analysis API key first.", "no-key");
  const cache = await fetchIntelligenceScores(key, fetchImpl);
  writeIntelligenceCache(cache);
  return cache;
}
var CHECKPOINT_DATE = /-\d{4}$/;
function intelligenceKey(modelId) {
  return modelId.toLowerCase().replace(/^~/, "").replace(/^.*\//, "").replace(/[:_.\s]+/g, "-").replace(/-+/g, "-").replace(/-(free|cloud|batch)$/, "");
}
function datedDefaultScore(bySlug, base) {
  let best;
  const prefix = `${base}-`;
  for (const [slug, entry] of bySlug) {
    if (!slug.startsWith(prefix)) continue;
    if (!/^\d{4}$/.test(slug.slice(prefix.length))) continue;
    if (!best || slug > best.slug) best = entry;
  }
  return best;
}
function buildIntelligenceLookup(cache) {
  const bySlug = new Map((cache?.models ?? []).map((entry) => [entry.slug, entry]));
  return (modelId) => {
    const key = intelligenceKey(modelId);
    const exact = bySlug.get(key);
    if (exact) return exact;
    if (CHECKPOINT_DATE.test(key)) {
      const withoutDate = bySlug.get(key.replace(CHECKPOINT_DATE, ""));
      if (withoutDate) return withoutDate;
    }
    return datedDefaultScore(bySlug, key);
  };
}

export {
  AA_AUTH_REF,
  AA_FREE_MODELS_URL,
  AA_SITE_URL,
  AA_MAX_AGE_MS,
  IntelligenceError,
  loadIntelligenceCache,
  writeIntelligenceCache,
  hasIntelligenceKey,
  saveIntelligenceKey,
  removeIntelligence,
  isIntelligenceStale,
  fetchIntelligenceScores,
  refreshIntelligence,
  intelligenceKey,
  buildIntelligenceLookup
};
//# sourceMappingURL=chunk-O2SS4I4W.js.map