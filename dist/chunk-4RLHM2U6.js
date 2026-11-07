#!/usr/bin/env node
import {
  PROVIDER_TEMPLATES,
  init_provider_templates
} from "./chunk-6DCEGHZH.js";
import {
  getAppHome,
  getSecretsPath
} from "./chunk-XEH2JMTL.js";

// src/registry/provider-kind.ts
init_provider_templates();
var KIND_IDS_WITHOUT_TEMPLATE = ["openai-oauth", "xai-oauth", "zen", "go"];
var knownKinds;
function kinds() {
  knownKinds ??= /* @__PURE__ */ new Set([...PROVIDER_TEMPLATES.map((t) => t.id), ...KIND_IDS_WITHOUT_TEMPLATE]);
  return knownKinds;
}
function providerKind(providerId) {
  const match = /^(.+)-(\d+)$/.exec(providerId);
  if (!match || kinds().has(providerId)) return providerId;
  const base = match[1];
  return Number(match[2]) >= 2 && kinds().has(base) ? base : providerId;
}
function isProviderKind(providerId, kind) {
  return providerKind(providerId) === kind;
}
function nextInstanceId(base, takenIds) {
  const taken = new Set(takenIds);
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

// src/constants.ts
import { homedir } from "os";
import { join } from "path";

// package.json
var package_default = {
  name: "@jacobbd/relay-ai",
  version: "0.22.0",
  publishConfig: {
    access: "public"
  },
  description: "Relay any model into any coding agent \u2014 launch Claude Code, Codex, and more with multi-provider gateways",
  author: "jacob-bd",
  license: "MIT",
  repository: {
    type: "git",
    url: "git+https://github.com/jacob-bd/relay-ai.git"
  },
  homepage: "https://github.com/jacob-bd/relay-ai#readme",
  keywords: [
    "claude",
    "claude-code",
    "codex",
    "ai",
    "llm",
    "cli",
    "gateway",
    "relay",
    "vertex"
  ],
  type: "module",
  bin: {
    "relay-ai": "dist/cli.js",
    relayai: "dist/cli.js",
    relay: "dist/cli.js"
  },
  files: [
    "dist",
    "README.md"
  ],
  engines: {
    node: ">=22"
  },
  scripts: {
    build: "tsup && tsup --config tsup.core.config.ts && node scripts/copy-ui-assets.mjs",
    dev: "tsup --watch",
    test: 'vitest run --exclude "tests/debug-*.test.ts"',
    "test:reasoning": "vitest run tests/reasoning-coverage.test.ts",
    "test:live:reasoning": "vitest run tests/debug-reasoning-live.test.ts",
    "test:live:cache": "vitest run tests/debug-cache-live.test.ts",
    "test:live": "vitest run tests/debug-xai.test.ts tests/debug-openai-oauth.test.ts",
    "test:watch": "vitest",
    typecheck: "tsc --noEmit",
    "release:check": "node scripts/release-metadata.mjs",
    "refresh:models-dev": "node scripts/refresh-models-dev-cache.mjs",
    prepublishOnly: "npm run release:check && npm run build"
  },
  dependencies: {
    "@ai-sdk/alibaba": "^2.0.41",
    "@ai-sdk/amazon-bedrock": "^5.0.76",
    "@ai-sdk/azure": "^4.0.63",
    "@ai-sdk/cerebras": "^3.0.44",
    "@ai-sdk/cohere": "^4.0.37",
    "@ai-sdk/deepinfra": "^3.0.44",
    "@ai-sdk/gateway": "^4.0.75",
    "@ai-sdk/google": "^4.0.64",
    "@ai-sdk/google-vertex": "^5.0.76",
    "@ai-sdk/groq": "^4.0.37",
    "@ai-sdk/mistral": "^4.0.39",
    "@ai-sdk/openai": "^4.0.60",
    "@ai-sdk/openai-compatible": "^3.0.44",
    "@ai-sdk/perplexity": "^4.0.39",
    "@ai-sdk/togetherai": "^3.0.45",
    "@ai-sdk/xai": "^4.0.54",
    "@clack/prompts": "^0.9.1",
    "@openrouter/ai-sdk-provider": "^3.0.0",
    ai: "^7.0.93",
    "cross-spawn": "^7.0.6",
    "gitlab-ai-provider": "^6.15.0",
    graphql: "^16.14.2",
    "ipaddr.js": "^2.4.0",
    "jsonc-parser": "^3.3.1",
    "node-forge": "^1.4.0",
    open: "^11.0.0",
    picocolors: "^1.1.1",
    "smol-toml": "^1.6.1",
    ws: "^8.21.0",
    zod: "^3.25.76"
  },
  devDependencies: {
    "@types/cross-spawn": "^6.0.6",
    "@types/node": "^22.0.0",
    "@types/node-forge": "^1.3.14",
    "@types/ws": "^8.18.1",
    "@vitest/coverage-v8": "^4.1.10",
    tsup: "^8.0.0",
    typescript: "^5.5.0",
    "vite-node": "^6.0.0",
    vitest: "^4.1.10"
  },
  optionalDependencies: {
    "@napi-rs/keyring": "^1.3.0"
  },
  overrides: {
    ws: "^8.21.0"
  },
  exports: {
    "./core": {
      types: "./dist/core/index.d.ts",
      import: "./dist/core/index.js",
      default: "./dist/core/index.js"
    },
    "./package.json": "./package.json"
  }
};

// src/constants.ts
var BACKENDS = {
  zen: {
    id: "zen",
    name: "OpenCode Zen",
    // No /v1 suffix — the Anthropic SDK appends /v1/messages automatically
    baseUrl: "https://opencode.ai/zen"
  },
  go: {
    id: "go",
    name: "OpenCode Go",
    baseUrl: "https://opencode.ai/zen/go"
  }
};
var CODEX_RESPONSES_LITE_WS_URL = "wss://chatgpt.com/backend-api/codex/responses";
var CODEX_RESPONSES_LITE_VERSION = "0.155.1";
var CODEX_RESPONSES_WEBSOCKETS_BETA = "responses_websockets=2026-02-06";
var CONFLICTING_ENV_VARS = [
  "CLAUDE_CODE_USE_VERTEX",
  "ANTHROPIC_VERTEX_PROJECT_ID",
  "ANTHROPIC_VERTEX_BASE_URL",
  "CLOUD_ML_REGION",
  "ANTHROPIC_BEDROCK_BASE_URL",
  "ANTHROPIC_AWS_BASE_URL",
  "ANTHROPIC_AWS_API_KEY",
  "ANTHROPIC_AWS_WORKSPACE_ID",
  "ANTHROPIC_FOUNDRY_API_KEY",
  "ANTHROPIC_FOUNDRY_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL"
];
var PARENT_SESSION_ENV_VARS = [
  "CLAUDECODE",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_HOST_SESSION_ID",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_PID"
];
var OPENCODE_CACHE_PATH = join(homedir(), ".cache", "opencode", "models.json");
var MAX_MODEL_CATALOG = 50;
var CODEX_SUBAGENT_MODEL_CAP = 1;
var MIN_CONTEXT_WINDOW = 128e3;
var VERTEX_ANTHROPIC_NPM = "@ai-sdk/google-vertex/anthropic";
function classifyModelFormat(modelId, providerNpm) {
  if (providerNpm === "@ai-sdk/anthropic") return "anthropic";
  if (providerNpm === "@ai-sdk/openai") return "unsupported";
  if (providerNpm === "@ai-sdk/google") return "unsupported";
  const lower = modelId.toLowerCase();
  if (lower.startsWith("claude-")) return "anthropic";
  if (lower.startsWith("gpt-")) return "unsupported";
  if (lower.startsWith("gemini-")) return "unsupported";
  return "openai";
}
var VERSION = package_default.version;

// src/context-window.ts
import { readFileSync } from "fs";
var DEFAULT_CONTEXT_WINDOW = 2e5;
var CACHE_PROVIDER_PRIORITY = /* @__PURE__ */ new Set(["opencode", "opencode-go"]);
var HEURISTIC_RULES = [
  [/gemini-2\.5-pro|gemini-1\.5-pro|gemini-3-pro/i, 2e6],
  [/gemini/i, 1e6],
  [/claude-opus-4-[678]|claude-sonnet-4-[678]/i, 1e6],
  [/claude-haiku-4-[567]/i, 2e5],
  [/claude.*\[1m\]/i, 1e6],
  [/claude-opus-4-[56]|claude-sonnet-4-[45]|claude-3/i, 2e5],
  // Claude 5.x and later (incl. Haiku 5.5) and Fable: 1M per models.dev.
  [/claude-(?:opus|sonnet|haiku)-(?:[5-9]|\d{2,})(?:\b|-)|claude-fable/i, 1e6],
  [/claude/i, 2e5],
  [/deepseek-v4|deepseek-r1|deepseek-reasoner/i, 1e6],
  [/deepseek/i, 64e3],
  [/gpt-5|gpt-4\.1|o3-|o4-/i, 1e6],
  [/gpt-4o|gpt-4-turbo|gpt-4/i, 128e3],
  [/gpt-oss/i, 131072],
  [/qwen3|qwen-3|qwen2\.5-72b|qwen2\.5-32b|qwen-coder/i, 262144],
  [/qwen/i, 131072],
  [/kimi-k2|kimi-k2\.5|moonshot/i, 262144],
  [/minimax-m2/i, 204800],
  [/minimax/i, 128e3],
  [/mistral-large|ministral|mistral/i, 262144],
  [/llama-3\.[23]|llama3/i, 131072],
  [/grok-4\.20/i, 1e6],
  [/grok-4\.5/i, 5e5],
  [/grok-3|grok-4/i, 131072],
  [/nemotron/i, 131072],
  [/glm-4/i, 128e3],
  [/solar-pro3/i, 131072],
  [/solar-pro2/i, 65536],
  [/solar/i, 32768]
];
var parsedCache;
var cacheIndex;
var heuristicCache = /* @__PURE__ */ new Map();
function loadOpencodeCache() {
  if (parsedCache === void 0) {
    try {
      parsedCache = JSON.parse(readFileSync(OPENCODE_CACHE_PATH, "utf8"));
    } catch {
      parsedCache = null;
    }
  }
  return parsedCache;
}
function buildContextWindowIndex(cache) {
  const index = /* @__PURE__ */ new Map();
  const allLimits = /* @__PURE__ */ new Map();
  for (const [providerKey, providerData] of Object.entries(cache)) {
    const models = providerData?.models;
    if (!models) continue;
    for (const [modelId, entry] of Object.entries(models)) {
      const ctx = entry.limit?.context;
      if (typeof ctx !== "number" || ctx <= 0) continue;
      const limits = allLimits.get(modelId) ?? [];
      limits.push(ctx);
      allLimits.set(modelId, limits);
      if (CACHE_PROVIDER_PRIORITY.has(providerKey)) {
        index.set(modelId, ctx);
      }
    }
  }
  for (const [modelId, limits] of allLimits) {
    if (!index.has(modelId)) {
      index.set(modelId, Math.max(...limits));
    }
  }
  return index;
}
function getCacheIndex() {
  if (cacheIndex === void 0) {
    const cache = loadOpencodeCache();
    cacheIndex = cache ? buildContextWindowIndex(cache) : /* @__PURE__ */ new Map();
  }
  return cacheIndex;
}
function contextWindowFromHeuristics(modelId) {
  const cached = heuristicCache.get(modelId);
  if (cached !== void 0) return cached;
  for (const [pattern, size] of HEURISTIC_RULES) {
    if (pattern.test(modelId)) {
      heuristicCache.set(modelId, size);
      return size;
    }
  }
  heuristicCache.set(modelId, DEFAULT_CONTEXT_WINDOW);
  return DEFAULT_CONTEXT_WINDOW;
}
function lookupContextWindow(modelId) {
  return getCacheIndex().get(modelId) ?? contextWindowFromHeuristics(modelId);
}
function resolveContextWindow(modelId, explicit) {
  if (typeof explicit === "number" && explicit > 0) return explicit;
  return lookupContextWindow(modelId);
}

// src/context-model-id.ts
var ONE_M_CONTEXT_SUFFIX = "[1m]";
var ONE_M_CONTEXT_WINDOW = 1e6;
function claudeCodeContextWindow(model) {
  const window = resolveContextWindow(stripOneMContextSuffix(model.id), model.contextWindow);
  return model.contextWindowEstimated ? Math.min(window, DEFAULT_CONTEXT_WINDOW) : window;
}
function stripOneMContextSuffix(modelId) {
  return modelId.replace(/\[1m\]$/i, "");
}
function claudeCodeClientModelId(modelId, contextWindow) {
  const bare = stripOneMContextSuffix(modelId);
  const window = resolveContextWindow(bare, contextWindow);
  if (window >= ONE_M_CONTEXT_WINDOW) {
    return `${bare}${ONE_M_CONTEXT_SUFFIX}`;
  }
  return bare;
}
function routeLookupIds(id) {
  const bare = stripOneMContextSuffix(id);
  const googleBare = bare.startsWith("models/") ? bare.slice("models/".length) : bare;
  return [.../* @__PURE__ */ new Set([
    id,
    bare,
    `${bare}${ONE_M_CONTEXT_SUFFIX}`,
    googleBare,
    `${googleBare}${ONE_M_CONTEXT_SUFFIX}`,
    `models/${googleBare}`,
    `models/${bare}`
  ])];
}

// src/oauth/antigravity-oauth.ts
import open from "open";
import { readFileSync as readFileSync2 } from "fs";
import { homedir as homedir2 } from "os";
import { join as pathJoin } from "path";

// src/oauth/pkce.ts
function generateRandomString(length) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  return Array.from(crypto.getRandomValues(new Uint8Array(length))).map((b) => chars[b % chars.length]).join("");
}
function base64UrlEncode(buffer) {
  const binary = String.fromCharCode(...new Uint8Array(buffer));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function generatePkce() {
  const verifier = generateRandomString(64);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64UrlEncode(hash) };
}
function generateOAuthState() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function positiveSecondsToMs(value, defaultMs) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1e3 : defaultMs;
}
async function sleepMs(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// src/oauth/callback-server.ts
import http from "http";
var SUCCESS_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Authorized</title></head>
<body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0">
<div style="text-align:center;padding:2rem;background:#fff;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.1)">
<div style="color:#22c55e;font-size:2.5rem">&#10003;</div>
<h1 style="margin:.5rem 0">Authentication successful</h1>
<p style="color:#666">You can close this tab and return to the terminal.</p>
</div></body></html>`;
function startCallbackServer() {
  return new Promise((resolve, reject) => {
    let codeResolve;
    let codeReject;
    const server = http.createServer((req, res) => {
      const u = new URL(req.url ?? "/", "http://localhost");
      if (u.pathname !== "/callback" && u.pathname !== "/oauth/callback") {
        res.writeHead(404);
        res.end();
        return;
      }
      const code = u.searchParams.get("code") ?? "";
      const state = u.searchParams.get("state") ?? "";
      const error = u.searchParams.get("error") ?? "";
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(SUCCESS_HTML);
      codeResolve?.({ code, state, error: error || void 0 });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = addr.port;
      resolve({
        port,
        redirectUri: `http://127.0.0.1:${port}/callback`,
        waitForCallback(timeoutMs = 3e5) {
          return new Promise((res, rej) => {
            codeResolve = res;
            codeReject = rej;
            setTimeout(
              () => rej(new Error("OAuth timeout \u2014 browser closed without completing sign-in")),
              timeoutMs
            );
          });
        },
        close() {
          server.close();
          codeReject?.(new Error("Server closed"));
        }
      });
    });
    server.on("error", reject);
  });
}

// src/oauth/refresh-http.ts
var REVOKED_REFRESH_CODES = /* @__PURE__ */ new Set([
  "invalid_grant",
  "refresh_token_reused",
  "refresh_token_expired",
  "refresh_token_invalidated"
]);
var OAuthRefreshRevokedError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "OAuthRefreshRevokedError";
  }
};
function isRevokedRefreshResponse(status, body) {
  if (status !== 400 && status !== 401) return false;
  try {
    const parsed = JSON.parse(body);
    const code = typeof parsed.error === "string" ? parsed.error : parsed.error?.code;
    return typeof code === "string" && REVOKED_REFRESH_CODES.has(code);
  } catch {
    return false;
  }
}
async function postOAuthRefresh(url, body, options) {
  const isJson = options.contentType === "json";
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": isJson ? "application/json" : "application/x-www-form-urlencoded",
      Accept: "application/json",
      ...options.headers
    },
    body: isJson ? JSON.stringify(body) : body.toString()
  });
  if (!response.ok) {
    const text2 = await response.text().catch(() => "");
    const detail = options.includeBody ? text2 : "";
    const status = options.includeStatus ? ` (${response.status})` : "";
    if (isRevokedRefreshResponse(response.status, text2)) {
      throw new OAuthRefreshRevokedError(`${options.errorPrefix}${status}: this sign-in is no longer valid`);
    }
    throw new Error(`${options.errorPrefix}${status}${detail ? `: ${detail}` : ""}`);
  }
  return response.json();
}

// src/oauth/antigravity-oauth.ts
var DEFAULT_ANTIGRAVITY_CLIENT_ID = ["107100606059", "1-tmhssin2h2", "1lcre235vtol", "ojh4g403ep.a", "pps.googleus", "ercontent.co", "m"].join("");
var DEFAULT_ANTIGRAVITY_CLIENT_SECRET = ["GOCS", "PX-K", "58FW", "R486", "LdLJ", "1mLB", "8sXC", "4z6q", "DAf"].join("");
var ANTIGRAVITY_CLIENT_ID = process.env.ANTIGRAVITY_OAUTH_CLIENT_ID ?? DEFAULT_ANTIGRAVITY_CLIENT_ID;
var ANTIGRAVITY_CLIENT_SECRET = process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET ?? DEFAULT_ANTIGRAVITY_CLIENT_SECRET;
var AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
var TOKEN_URL = "https://oauth2.googleapis.com/token";
var USER_INFO_URL = "https://www.googleapis.com/oauth2/v1/userinfo";
var SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs"
].join(" ");
var osType = process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "windows" : "linux";
var archType = process.arch === "arm64" ? "arm64" : "x64";
var ANTIGRAVITY_USER_AGENT = `antigravity/2.22.0 (aidev_client; os_type=${osType}; arch=${archType}; cl=997489728; auth_method=oauth)`;
var ANTIGRAVITY_METADATA = { ideType: "ANTIGRAVITY" };
var ANTIGRAVITY_BASE_URLS = [
  "https://daily-cloudcode-pa.googleapis.com",
  "https://cloudcode-pa.googleapis.com",
  "https://daily-cloudcode-pa.sandbox.googleapis.com"
];
var ANTIGRAVITY_API_VERSION = "v1internal";
async function buildAntigravityAuthUrl(redirectUri) {
  const { verifier, challenge } = await generatePkce();
  const state = generateOAuthState();
  const params = new URLSearchParams({
    client_id: ANTIGRAVITY_CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: SCOPES,
    state,
    access_type: "offline",
    prompt: "consent",
    code_challenge: challenge,
    code_challenge_method: "S256"
  });
  return { authUrl: `${AUTHORIZE_URL}?${params}`, codeVerifier: verifier, oauthState: state, redirectUri };
}
async function exchangeAntigravityToken(code, codeVerifier, redirectUri) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: ANTIGRAVITY_CLIENT_ID,
    client_secret: ANTIGRAVITY_CLIENT_SECRET,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": ANTIGRAVITY_USER_AGENT
    },
    body
  });
  if (!res.ok) throw new Error(`Antigravity token exchange failed: ${await res.text()}`);
  return res.json();
}
async function refreshAntigravityToken(refreshToken) {
  return postOAuthRefresh(
    TOKEN_URL,
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: ANTIGRAVITY_CLIENT_ID,
      client_secret: ANTIGRAVITY_CLIENT_SECRET,
      refresh_token: refreshToken
    }),
    {
      contentType: "form",
      errorPrefix: "Antigravity token refresh failed",
      includeBody: true
    }
  );
}
async function fetchUserInfo(accessToken) {
  try {
    const res = await fetch(`${USER_INFO_URL}?alt=json`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) return {};
    const data = await res.json();
    return {
      email: typeof data.email === "string" ? data.email : void 0,
      name: typeof data.name === "string" ? data.name : void 0
    };
  } catch {
    return {};
  }
}
function apiHeaders(accessToken) {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${accessToken}`,
    "User-Agent": ANTIGRAVITY_USER_AGENT
  };
}
async function fetchFirstOk(paths, init) {
  let lastErr;
  for (const url of paths) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
      lastErr = new Error(`${res.status} ${await res.text()}`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error("All Antigravity endpoints failed");
}
function toRecord(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}
function pickTierId(tier) {
  const v = toRecord(tier).id;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function findDefaultAllowedTier(sub) {
  if (!Array.isArray(sub.allowedTiers)) return null;
  for (const t of sub.allowedTiers) {
    const tier = toRecord(t);
    if (tier.isDefault) return tier;
  }
  return null;
}
function resolveAntigravityOnboardTierId(data) {
  const sub = toRecord(data);
  const hasIneligible = Array.isArray(sub.ineligibleTiers) && sub.ineligibleTiers.length > 0;
  if (!hasIneligible) {
    const current = pickTierId(sub.currentTier);
    if (current) return current;
  }
  const def = findDefaultAllowedTier(sub);
  if (def) {
    const defId = pickTierId(def);
    if (defId) return defId;
  }
  const paid = pickTierId(sub.paidTier);
  if (paid) return paid;
  return pickTierId(sub.currentTier) ?? "legacy-tier";
}
async function loadCodeAssist(accessToken) {
  const endpoints = ANTIGRAVITY_BASE_URLS.map((b) => `${b}/${ANTIGRAVITY_API_VERSION}:loadCodeAssist`);
  const res = await fetchFirstOk(endpoints, {
    method: "POST",
    headers: apiHeaders(accessToken),
    body: JSON.stringify({ metadata: ANTIGRAVITY_METADATA })
  });
  const data = await res.json();
  let projectId = data.cloudaicompanionProject;
  if (typeof projectId === "object" && projectId !== null) {
    projectId = projectId.id ?? "";
  }
  return {
    projectId: typeof projectId === "string" ? projectId : "",
    tierId: resolveAntigravityOnboardTierId(data)
  };
}
async function onboardUser(accessToken, tierId, maxAttempts = 10) {
  const endpoints = ANTIGRAVITY_BASE_URLS.map((b) => `${b}/${ANTIGRAVITY_API_VERSION}:onboardUser`);
  let finalProjectId = "";
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetchFirstOk(endpoints, {
      method: "POST",
      headers: apiHeaders(accessToken),
      body: JSON.stringify({ tier_id: tierId, metadata: ANTIGRAVITY_METADATA })
    });
    const result = await res.json();
    if (result.done === true) {
      const p = result.response ? result.response.cloudaicompanionProject : void 0;
      if (typeof p === "string") finalProjectId = p.trim();
      else if (p && typeof p === "object") finalProjectId = String(p.id ?? "") || finalProjectId;
      break;
    }
    if (i < maxAttempts - 1) await new Promise((r) => setTimeout(r, 5e3));
  }
  return finalProjectId;
}
function readAgyProjectId() {
  try {
    const cache = pathJoin(homedir2(), ".gemini", "antigravity-cli", "cache", "projects.json");
    const data = JSON.parse(readFileSync2(cache, "utf8"));
    return data[homedir2()] ?? Object.values(data)[0] ?? "";
  } catch {
    return "";
  }
}
async function runBootstrap(tokens) {
  const [userInfoResult, bootstrapResult] = await Promise.allSettled([
    fetchUserInfo(tokens.access_token),
    loadCodeAssist(tokens.access_token)
  ]);
  const userInfo = userInfoResult.status === "fulfilled" ? userInfoResult.value : {};
  let projectId = bootstrapResult.status === "fulfilled" ? bootstrapResult.value.projectId : "";
  const tierId = bootstrapResult.status === "fulfilled" ? bootstrapResult.value.tierId : "free-tier";
  const finalProjectId = await onboardUser(tokens.access_token, tierId, 3).catch(() => "");
  if (finalProjectId) projectId = finalProjectId;
  if (!projectId && tierId !== "free-tier") {
    const freeTierProjectId = await onboardUser(tokens.access_token, "free-tier", 3).catch(() => "");
    if (freeTierProjectId) projectId = freeTierProjectId;
  }
  if (!projectId) {
    projectId = readAgyProjectId();
  }
  return { tokens, userInfo, projectId, tierId };
}
async function runAntigravityOAuthFlow(onAuthUrl) {
  const server = await startCallbackServer();
  try {
    const { authUrl, codeVerifier, oauthState, redirectUri } = await buildAntigravityAuthUrl(server.redirectUri);
    onAuthUrl(authUrl);
    open(authUrl).catch(() => {
    });
    const { code, state, error } = await server.waitForCallback();
    if (error) throw new Error(`Google sign-in was not completed: ${error}`);
    if (state !== oauthState) throw new Error("Google sign-in returned an unexpected state \u2014 start the sign-in again");
    if (!code) throw new Error("No authorization code received from Google");
    const tokens = await exchangeAntigravityToken(code, codeVerifier, redirectUri);
    return runBootstrap(tokens);
  } finally {
    server.close();
  }
}
async function completeAntigravityExchange(code, codeVerifier, redirectUri) {
  const tokens = await exchangeAntigravityToken(code, codeVerifier, redirectUri);
  return runBootstrap(tokens);
}

// src/registry/opencode-auth.ts
import { existsSync, readFileSync as readFileSync3, statSync } from "fs";
import { homedir as homedir3 } from "os";
import { join as join2 } from "path";
function resolveOpencodeAuthPath(env = process.env) {
  const dataHome = env["XDG_DATA_HOME"] ?? join2(homedir3(), ".local", "share");
  if (process.platform === "win32") {
    return join2(env["APPDATA"] ?? join2(homedir3(), "AppData", "Roaming"), "opencode", "auth.json");
  }
  return join2(dataHome, "opencode", "auth.json");
}
function decodeAuthEntry(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!value || typeof value !== "object") return null;
  const record2 = value;
  if (record2["type"] === "api" && typeof record2["key"] === "string" && record2["key"].trim()) {
    return {
      type: "api",
      key: record2["key"],
      metadata: record2["metadata"] && typeof record2["metadata"] === "object" && !Array.isArray(record2["metadata"]) ? record2["metadata"] : void 0
    };
  }
  if (record2["type"] === "oauth" && typeof record2["access"] === "string" && typeof record2["refresh"] === "string" && typeof record2["expires"] === "number") {
    return {
      type: "oauth",
      access: record2["access"],
      refresh: record2["refresh"],
      expires: record2["expires"],
      accountId: typeof record2["accountId"] === "string" ? record2["accountId"] : void 0,
      enterpriseUrl: typeof record2["enterpriseUrl"] === "string" ? record2["enterpriseUrl"] : void 0,
      providerData: record2["providerData"] && typeof record2["providerData"] === "object" && !Array.isArray(record2["providerData"]) ? record2["providerData"] : void 0
    };
  }
  if (record2["type"] === "wellknown" && typeof record2["key"] === "string" && typeof record2["token"] === "string") {
    return { type: "wellknown", key: record2["key"], token: record2["token"] };
  }
  return null;
}
function authFilePermissionWarning(path) {
  if (!existsSync(path)) return void 0;
  if (process.platform === "win32") return void 0;
  try {
    const mode = statSync(path).mode & 511;
    if (mode & 63) {
      return `OpenCode auth file ${path} is readable by others (mode ${mode.toString(8)}). Consider chmod 600.`;
    }
  } catch {
  }
  return void 0;
}
function readOpencodeAuthFile(env = process.env) {
  const path = resolveOpencodeAuthPath(env);
  if (!existsSync(path)) return null;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync3(path, "utf8"));
  } catch {
    return { path, entries: {}, permissionWarning: authFilePermissionWarning(path) };
  }
  const entries = {};
  if (parsed && typeof parsed === "object") {
    for (const [providerId, value] of Object.entries(parsed)) {
      const entry = decodeAuthEntry(value);
      if (entry) entries[providerId] = entry;
    }
  }
  return {
    path,
    entries,
    permissionWarning: authFilePermissionWarning(path)
  };
}
function isOpencodeOAuth(entry) {
  return !!entry && typeof entry === "object" && entry.type === "oauth";
}
function isOpencodeApi(entry) {
  return !!entry && typeof entry === "object" && entry.type === "api";
}
function oauthCredentialToKeychainJson(cred) {
  return JSON.stringify(cred);
}

// src/oauth/identity.ts
function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : void 0;
}
function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : void 0;
}
function jwtClaims(token) {
  const parts = token?.split(".");
  if (!parts || parts.length !== 3) return void 0;
  try {
    return record(JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")));
  } catch {
    return void 0;
  }
}
function compact(identity) {
  return Object.fromEntries(Object.entries(identity).filter(([, v]) => v !== void 0));
}
function identityFromJwt(token) {
  const claims = jwtClaims(token);
  if (!claims) return {};
  const auth = record(claims["https://api.openai.com/auth"]);
  const profile = record(claims["https://api.openai.com/profile"]);
  return compact({
    email: text(claims.email) ?? text(profile?.email),
    name: text(claims.name),
    plan: text(auth?.chatgpt_plan_type),
    userId: text(auth?.chatgpt_user_id) ?? text(auth?.user_id) ?? text(claims.sub)
  });
}
function mergeIdentity(...parts) {
  const merged = {};
  for (const part of parts) Object.assign(merged, compact(part ?? {}));
  return Object.keys(merged).length > 0 ? merged : void 0;
}
function storedIdentity(providerData) {
  const stored = record(providerData?.identity);
  return compact({
    email: text(stored?.email),
    name: text(stored?.name),
    plan: text(stored?.plan),
    userId: text(stored?.userId),
    login: text(stored?.login)
  });
}
function describeOAuthAccount(input) {
  const data = input.providerData;
  const kind = providerKind(input.kind);
  let fromProvider = {};
  if (kind === "antigravity") {
    fromProvider = compact({
      email: input.accountId?.includes("@") ? input.accountId : void 0,
      plan: text(data?.tier)
    });
  } else if (kind === "cline-pass") {
    fromProvider = compact({ email: text(data?.email), name: text(data?.name) });
  } else if (kind === "github-copilot") {
    const copilot = record(data?.copilot);
    fromProvider = compact({ login: text(copilot?.login), plan: text(copilot?.copilot_plan) });
  } else if (kind === "claude-code") {
    fromProvider = compact({ plan: text(data?.plan), name: text(data?.organizationName) });
  }
  return mergeIdentity(identityFromJwt(input.accessToken), fromProvider, storedIdentity(data)) ?? {};
}
function formatOAuthAccount(identity) {
  const who = identity.email ?? identity.login ?? identity.name;
  const parts = [who, identity.plan].filter((p) => Boolean(p));
  return parts.length > 0 ? parts.join(" \xB7 ") : void 0;
}
var USER_LEVEL_ACCOUNT_ID_KINDS = /* @__PURE__ */ new Set(["cline-pass", "claude-code"]);
function accountKeys(kind, cred) {
  const identity = describeOAuthAccount({
    kind,
    accountId: cred.accountId,
    providerData: cred.providerData,
    accessToken: cred.access
  });
  const keys = /* @__PURE__ */ new Set();
  if (identity.userId) keys.add(`user:${identity.userId}`);
  if (identity.email) keys.add(`email:${identity.email.toLowerCase()}`);
  if (identity.login) keys.add(`login:${identity.login.toLowerCase()}`);
  if (USER_LEVEL_ACCOUNT_ID_KINDS.has(providerKind(kind)) && cred.accountId) keys.add(`account:${cred.accountId}`);
  return keys;
}
function sameOAuthAccount(kind, a, b) {
  const keysOfB = accountKeys(kind, b);
  return [...accountKeys(kind, a)].some((key) => keysOfB.has(key));
}

// src/oauth/types.ts
function tokensToStoredCredential(tokens, existingRefresh, accountId, providerData) {
  const identity = mergeIdentity(storedIdentity(providerData), identityFromJwt(tokens.id_token));
  const baseProviderData = providerData || tokens.providerData ? { ...providerData, ...tokens.providerData } : void 0;
  const mergedProviderData = identity ? { ...baseProviderData, identity } : baseProviderData;
  return {
    type: "oauth",
    access: tokens.access_token,
    refresh: tokens.refresh_token ?? existingRefresh ?? "",
    expires: Date.now() + (tokens.expires_in ?? 3600) * 1e3,
    ...accountId ? { accountId } : {},
    ...mergedProviderData ? { providerData: mergedProviderData } : {}
  };
}
function parseStoredOAuthCredential(raw) {
  if (!raw?.trim().startsWith("{")) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.type === "oauth" && typeof parsed.access === "string" && typeof parsed.refresh === "string" && typeof parsed.expires === "number") {
      return parsed;
    }
  } catch {
  }
  return null;
}
var OAUTH_REFRESH_SKEW_MS = 12e4;
function oauthCredentialNeedsRefresh(cred, skewMs = OAUTH_REFRESH_SKEW_MS) {
  return cred.expires <= Date.now() + Math.max(0, skewMs);
}
function accessTokenIsExpiring(token, skewMs = OAUTH_REFRESH_SKEW_MS) {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length < 2) return false;
  try {
    let payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (payload.length % 4 !== 0) payload += "=";
    const claims = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
    if (typeof claims.exp !== "number") return false;
    return claims.exp * 1e3 <= Date.now() + Math.max(0, skewMs);
  } catch {
    return false;
  }
}
var NATIVE_OAUTH_PROVIDER_IDS = ["xai", "xai-oauth", "openai", "openai-oauth", "github-copilot", "claude-code", "antigravity", "cline-pass"];
function supportsNativeOAuth(providerId) {
  return NATIVE_OAUTH_PROVIDER_IDS.includes(providerId);
}
var BROWSER_REDIRECT_OAUTH_IDS = ["claude-code", "antigravity"];
function isBrowserRedirectOAuth(id) {
  return BROWSER_REDIRECT_OAUTH_IDS.includes(id);
}
function supportsAdditionalOAuthAccounts(kind) {
  return supportsNativeOAuth(kind);
}

// src/oauth/openai.ts
var CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
var ISSUER = "https://auth.openai.com";
var OAUTH_POLLING_SAFETY_MARGIN_MS = 3e3;
var DEVICE_CODE_DEFAULT_EXPIRES_MS = 5 * 60 * 1e3;
function extractOpenAiAccountId(tokens) {
  const token = tokens.id_token ?? tokens.access_token;
  if (!token) return void 0;
  const parts = token.split(".");
  if (parts.length !== 3) return void 0;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    return claims.chatgpt_account_id ?? claims["https://api.openai.com/auth"]?.chatgpt_account_id ?? claims.organizations?.[0]?.id;
  } catch {
    return void 0;
  }
}
async function requestOpenAiDeviceCode() {
  const response = await fetch(`${ISSUER}/api/accounts/deviceauth/usercode`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": `relay-ai/${VERSION}`
    },
    body: JSON.stringify({ client_id: CLIENT_ID })
  });
  if (!response.ok) {
    throw new Error("Failed to initiate OpenAI device authorization");
  }
  return response.json();
}
function openAiDeviceCodeUrl() {
  return `${ISSUER}/codex/device`;
}
async function pollOpenAiDeviceCodeToken(deviceData, opts) {
  const sleep2 = opts?.sleep ?? sleepMs;
  const now = opts?.now ?? (() => Date.now());
  const intervalMs = Math.max(parseInt(deviceData.interval, 10) || 5, 1) * 1e3;
  const deadline = now() + positiveSecondsToMs(deviceData.expires_in, DEVICE_CODE_DEFAULT_EXPIRES_MS);
  while (now() < deadline) {
    const response = await fetch(`${ISSUER}/api/accounts/deviceauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": `relay-ai/${VERSION}`
      },
      body: JSON.stringify({
        device_auth_id: deviceData.device_auth_id,
        user_code: deviceData.user_code
      })
    });
    if (response.ok) {
      const data = await response.json();
      const tokenResponse = await fetch(`${ISSUER}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: data.authorization_code,
          redirect_uri: `${ISSUER}/deviceauth/callback`,
          client_id: CLIENT_ID,
          code_verifier: data.code_verifier
        }).toString()
      });
      if (!tokenResponse.ok) {
        throw new Error(`OpenAI token exchange failed (${tokenResponse.status})`);
      }
      const tokens = await tokenResponse.json();
      return { tokens, accountId: extractOpenAiAccountId(tokens) };
    }
    if (response.status !== 403 && response.status !== 404) {
      throw new Error(`OpenAI device authorization failed (${response.status})`);
    }
    await sleep2(Math.min(intervalMs + OAUTH_POLLING_SAFETY_MARGIN_MS, Math.max(0, deadline - now())));
  }
  throw new Error("OpenAI device authorization timed out");
}
async function refreshOpenAiAccessToken(refreshToken) {
  return postOAuthRefresh(
    `${ISSUER}/oauth/token`,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID
    }),
    {
      contentType: "form",
      errorPrefix: "OpenAI token refresh failed",
      includeStatus: true
    }
  );
}
async function runOpenAiDeviceCodeFlow(onDeviceCode, opts) {
  const deviceData = await requestOpenAiDeviceCode();
  onDeviceCode({ url: openAiDeviceCodeUrl(), userCode: deviceData.user_code });
  return pollOpenAiDeviceCodeToken(deviceData, opts);
}

// src/oauth/github.ts
var CLIENT_ID2 = "Iv1.b507a08c87ecfe98";
var DEVICE_CODE_URL = "https://github.com/login/device/code";
var TOKEN_URL2 = "https://github.com/login/oauth/access_token";
var COPILOT_TOKEN_URL = "https://api.github.com/copilot_internal/v2/token";
var COPILOT_USER_URL = "https://api.github.com/copilot_internal/user";
var SCOPE = "copilot";
var DEVICE_CODE_DEFAULT_INTERVAL_MS = 5e3;
var DEVICE_CODE_DEFAULT_EXPIRES_MS2 = 15 * 60 * 1e3;
var OAUTH_POLLING_SAFETY_MARGIN_MS2 = 1e3;
var FREE_COPILOT_SKUS = /* @__PURE__ */ new Set([
  "free_limited_copilot",
  "free_educational_quota",
  "no_auth_limited_copilot"
]);
function commonHeaders() {
  return {
    Accept: "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": `relay-ai/${VERSION}`
  };
}
function classifyCopilotAccount(user) {
  const login = typeof user["login"] === "string" && user["login"].trim() ? user["login"].trim() : void 0;
  const sku = typeof user["access_type_sku"] === "string" && user["access_type_sku"].trim() ? user["access_type_sku"].trim() : void 0;
  const plan = typeof user["copilot_plan"] === "string" && user["copilot_plan"].trim() ? user["copilot_plan"].trim() : void 0;
  if (!sku && !plan) {
    return {
      ...login ? { login } : {},
      lookup_status: "unknown"
    };
  }
  const isFree = FREE_COPILOT_SKUS.has(sku?.toLowerCase() ?? "") || plan?.toLowerCase() === "free";
  return {
    ...login ? { login } : {},
    ...sku ? { access_type_sku: sku } : {},
    ...plan ? { copilot_plan: plan } : {},
    is_free_plan: isFree,
    lookup_status: "known"
  };
}
async function fetchCopilotAccount(ghuToken) {
  const response = await fetch(COPILOT_USER_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${ghuToken}`,
      Accept: "application/json",
      "User-Agent": `relay-ai/${VERSION}`,
      "Editor-Version": "vscode/1.85.1",
      "X-GitHub-Api-Version": "2025-04-01"
    }
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`GitHub Copilot account lookup failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }
  const json = await response.json();
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    throw new Error("GitHub Copilot account lookup returned invalid JSON");
  }
  return classifyCopilotAccount(json);
}
async function requestGithubDeviceCode() {
  const response = await fetch(DEVICE_CODE_URL, {
    method: "POST",
    headers: commonHeaders(),
    body: new URLSearchParams({ client_id: CLIENT_ID2, scope: SCOPE }).toString()
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`GitHub device code request failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }
  const json = await response.json();
  if (!json.device_code || !json.user_code || !json.verification_uri) {
    throw new Error("GitHub device code response is missing required fields");
  }
  return json;
}
async function exchangeForCopilotToken(ghuToken) {
  const response = await fetch(COPILOT_TOKEN_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${ghuToken}`,
      "User-Agent": `relay-ai/${VERSION}`,
      Accept: "application/json"
    }
  });
  if (!response.ok) {
    const msg = await response.text().catch(() => "");
    throw new Error(`GitHub Copilot token exchange failed (${response.status})${msg ? `: ${msg}` : ""}`);
  }
  const json = await response.json();
  if (!json.token) {
    throw new Error("GitHub Copilot token exchange response missing token field \u2014 is Copilot subscription active?");
  }
  let expiresIn = 1800;
  if (json.expires_at) {
    const expiresMs = new Date(json.expires_at).getTime() - Date.now();
    if (expiresMs > 0) expiresIn = Math.floor(expiresMs / 1e3);
  }
  let account = { lookup_status: "unknown" };
  try {
    account = await fetchCopilotAccount(ghuToken);
  } catch {
  }
  return {
    access_token: json.token,
    expires_in: expiresIn,
    providerData: { copilot: account }
  };
}
async function refreshGithubCopilotToken(ghuToken) {
  const copilot = await exchangeForCopilotToken(ghuToken);
  return {
    ...copilot,
    refresh_token: ghuToken
    // keep the same ghu_ token as refresh
  };
}
async function pollGithubDeviceCodeToken(device, opts) {
  const sleep2 = opts?.sleep ?? sleepMs;
  const now = opts?.now ?? (() => Date.now());
  const deadline = now() + positiveSecondsToMs(device.expires_in, DEVICE_CODE_DEFAULT_EXPIRES_MS2);
  let intervalMs = Math.max(
    positiveSecondsToMs(device.interval, DEVICE_CODE_DEFAULT_INTERVAL_MS),
    1e3
  );
  while (now() < deadline) {
    const response = await fetch(TOKEN_URL2, {
      method: "POST",
      headers: commonHeaders(),
      body: new URLSearchParams({
        client_id: CLIENT_ID2,
        device_code: device.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code"
      }).toString()
    });
    const body = await response.json().catch(() => ({}));
    const error = body["error"];
    if (!error && body["access_token"]) {
      const ghuToken = body["access_token"];
      const copilot = await exchangeForCopilotToken(ghuToken);
      return {
        access_token: copilot.access_token,
        refresh_token: ghuToken,
        // store ghu_ as refresh for re-exchange later
        expires_in: copilot.expires_in,
        providerData: copilot.providerData
      };
    }
    if (error === "authorization_pending") {
      await sleep2(Math.min(intervalMs + OAUTH_POLLING_SAFETY_MARGIN_MS2, Math.max(0, deadline - now())));
      continue;
    }
    if (error === "slow_down") {
      intervalMs += 5e3;
      await sleep2(Math.min(intervalMs + OAUTH_POLLING_SAFETY_MARGIN_MS2, Math.max(0, deadline - now())));
      continue;
    }
    if (error === "expired_token") {
      throw new Error("GitHub device code expired \u2014 please run relay-ai providers auth github-copilot again");
    }
    throw new Error(`GitHub device authorization failed${error ? `: ${error}` : ""}`);
  }
  throw new Error("GitHub device authorization timed out");
}
async function runGithubDeviceCodeFlow(onDeviceCode, opts) {
  const device = await requestGithubDeviceCode();
  onDeviceCode({ url: device.verification_uri, userCode: device.user_code });
  return pollGithubDeviceCodeToken(device, opts);
}

// src/oauth/xai.ts
var CLIENT_ID3 = "b1a00492-073a-47ea-816f-4c329264a828";
var TOKEN_URL3 = "https://auth.x.ai/oauth2/token";
var DEVICE_AUTHORIZATION_URL = "https://auth.x.ai/oauth2/device/code";
var DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";
var SCOPE2 = "openid profile email offline_access grok-cli:access api:access";
var DEVICE_CODE_DEFAULT_INTERVAL_MS2 = 5e3;
var DEVICE_CODE_MIN_INTERVAL_MS = 1e3;
var DEVICE_CODE_SLOW_DOWN_INCREMENT_MS = 5e3;
var DEVICE_CODE_DEFAULT_EXPIRES_MS3 = 5 * 60 * 1e3;
var OAUTH_POLLING_SAFETY_MARGIN_MS3 = 3e3;
function authHeaders() {
  return {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
    "User-Agent": `relay-ai/${VERSION}`
  };
}
async function requestXaiDeviceCode() {
  const response = await fetch(DEVICE_AUTHORIZATION_URL, {
    method: "POST",
    headers: authHeaders(),
    body: new URLSearchParams({
      client_id: CLIENT_ID3,
      scope: SCOPE2
    }).toString()
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`xAI device code request failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }
  const json = await response.json();
  if (!json.device_code || !json.user_code || !json.verification_uri) {
    throw new Error("xAI device code response is missing required fields");
  }
  return json;
}
async function pollXaiDeviceCodeToken(device, opts) {
  const sleep2 = opts?.sleep ?? sleepMs;
  const now = opts?.now ?? (() => Date.now());
  const deadline = now() + positiveSecondsToMs(device.expires_in, DEVICE_CODE_DEFAULT_EXPIRES_MS3);
  let intervalMs = Math.max(
    positiveSecondsToMs(device.interval, DEVICE_CODE_DEFAULT_INTERVAL_MS2),
    DEVICE_CODE_MIN_INTERVAL_MS
  );
  while (now() < deadline) {
    const response = await fetch(TOKEN_URL3, {
      method: "POST",
      headers: authHeaders(),
      body: new URLSearchParams({
        grant_type: DEVICE_CODE_GRANT_TYPE,
        client_id: CLIENT_ID3,
        device_code: device.device_code
      }).toString()
    });
    if (response.ok) return response.json();
    const body = await response.json().catch(() => ({}));
    const remaining = Math.max(0, deadline - now());
    if (body.error === "authorization_pending") {
      await sleep2(Math.min(intervalMs + OAUTH_POLLING_SAFETY_MARGIN_MS3, remaining));
      continue;
    }
    if (body.error === "slow_down") {
      intervalMs += DEVICE_CODE_SLOW_DOWN_INCREMENT_MS;
      await sleep2(Math.min(intervalMs + OAUTH_POLLING_SAFETY_MARGIN_MS3, remaining));
      continue;
    }
    throw new Error(`xAI device authorization failed${body.error ? `: ${body.error}` : ""}`);
  }
  throw new Error("xAI device authorization timed out");
}
async function refreshXaiAccessToken(refreshToken) {
  return postOAuthRefresh(
    TOKEN_URL3,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID3
    }),
    {
      contentType: "form",
      errorPrefix: "xAI token refresh failed",
      includeStatus: true,
      includeBody: true,
      headers: authHeaders()
    }
  );
}
async function runXaiDeviceCodeFlow(onDeviceCode, opts) {
  const device = await requestXaiDeviceCode();
  onDeviceCode({
    url: device.verification_uri_complete ?? device.verification_uri,
    userCode: device.user_code
  });
  return pollXaiDeviceCodeToken(device, opts);
}

// src/oauth/claude-code.ts
import { randomBytes } from "crypto";
import open2 from "open";

// src/oauth/claude-identity.ts
import { createHash, randomUUID } from "crypto";
var CLAUDE_CODE_CLI_VERSION = "2.1.312";
var CLAUDE_CODE_USER_AGENT = `claude-cli/${CLAUDE_CODE_CLI_VERSION} (external, cli)`;
var CLAUDE_CODE_ENTRYPOINT = process.env.CLAUDE_CODE_ENTRYPOINT ?? "cli";
var CLAUDE_CODE_BILLING_HEADER_PREFIX = "x-anthropic-billing-header:";
var sessionCache = /* @__PURE__ */ new Map();
function getOrCreateSessionId(seed) {
  let id = sessionCache.get(seed);
  if (!id) {
    id = randomUUID();
    sessionCache.set(seed, id);
  }
  return id;
}
function uuidFromHash(input) {
  const h = createHash("sha256").update(input).digest("hex");
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    "4" + h.slice(13, 16),
    (parseInt(h[16], 16) & 3 | 8).toString(16) + h.slice(17, 20),
    h.slice(20, 32)
  ].join("-");
}
var HEX64_RE = /^[a-f0-9]{64}$/i;
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function resolveCliUserID(providerData, seed) {
  const v = providerData?.cliUserID;
  if (typeof v === "string" && HEX64_RE.test(v)) return v;
  return createHash("sha256").update(`cliUserID:${seed}`).digest("hex");
}
function resolveAccountUUID(providerData, seed) {
  const v = providerData?.accountUUID;
  if (typeof v === "string" && UUID_RE.test(v)) return v;
  return uuidFromHash(`account:${seed}`);
}
function buildUserIdJson(deviceId, accountUUID, sessionId) {
  return JSON.stringify({ device_id: deviceId, account_uuid: accountUUID, session_id: sessionId });
}
function buildClaudeCodeBillingSystemLine() {
  return `${CLAUDE_CODE_BILLING_HEADER_PREFIX} cc_version=${CLAUDE_CODE_CLI_VERSION}.0; cc_entrypoint=${CLAUDE_CODE_ENTRYPOINT};`;
}
function systemBlockText(block) {
  if (typeof block === "string") return block;
  if (block && typeof block === "object" && "text" in block) {
    const text2 = block.text;
    return typeof text2 === "string" ? text2 : void 0;
  }
  return void 0;
}
function hasClaudeCodeBillingSystemLine(system) {
  if (typeof system === "string") return system.startsWith(CLAUDE_CODE_BILLING_HEADER_PREFIX);
  if (!Array.isArray(system)) return false;
  return system.some((block) => systemBlockText(block)?.startsWith(CLAUDE_CODE_BILLING_HEADER_PREFIX));
}
function injectClaudeCodeBillingSystemLine(body) {
  if (hasClaudeCodeBillingSystemLine(body.system)) return;
  const billingBlock = { type: "text", text: buildClaudeCodeBillingSystemLine() };
  if (body.system === void 0 || body.system === null) {
    body.system = [billingBlock];
  } else if (typeof body.system === "string") {
    body.system = [billingBlock, { type: "text", text: body.system }];
  } else if (Array.isArray(body.system)) {
    body.system = [billingBlock, ...body.system];
  } else {
    body.system = [billingBlock];
  }
}
var ALWAYS = [
  "oauth-2025-04-20",
  "context-management-2025-06-27",
  "prompt-caching-scope-2026-01-05"
];
var AGENT = [
  "claude-code-20250219",
  "extended-cache-ttl-2025-04-11",
  "cache-diagnosis-2026-04-07",
  "advisor-tool-2026-03-01"
];
var THINKING = [
  "interleaved-thinking-2025-05-14",
  "redact-thinking-2026-02-12",
  "thinking-token-count-2026-05-13"
];
var HEAVY = ["advanced-tool-use-2025-11-20", "effort-2025-11-24"];
var OPUS_ONLY = ["context-1m-2025-08-07", "mid-conversation-system-2026-04-07"];
function selectBetaFlags(body, model, clientBeta) {
  const hasSystem = !!body.system && (typeof body.system === "string" || Array.isArray(body.system) && body.system.length > 0);
  const tools = body.tools;
  const isFullAgent = hasSystem && Array.isArray(tools) && tools.length > 0;
  const m = (model ?? (typeof body.model === "string" ? body.model : "")).toLowerCase();
  const isOpus = m.includes("opus");
  const isSonnetOrOpus = isOpus || m.includes("sonnet");
  const clientSet = clientBeta ? new Set(clientBeta.split(",").map((s) => s.trim()).filter(Boolean)) : null;
  const allowThinking = !clientSet || clientSet.has("interleaved-thinking-2025-05-14");
  const allowHeavy = !clientSet || clientSet.has("advanced-tool-use-2025-11-20") || clientSet.has("effort-2025-11-24");
  const flags = [...ALWAYS];
  if (isFullAgent) flags.push(...AGENT);
  if (isOpus) flags.push(...OPUS_ONLY);
  if (allowThinking) flags.push(...THINKING);
  if (isFullAgent && isSonnetOrOpus && allowHeavy) flags.push(...HEAVY);
  return flags.join(",");
}
function injectClaudeIdentity(body, providerData, seed) {
  const deviceId = resolveCliUserID(providerData, seed);
  const accountUUID = resolveAccountUUID(providerData, seed);
  const sessionId = getOrCreateSessionId(seed);
  const userId = buildUserIdJson(deviceId, accountUUID, sessionId);
  const existing = body.metadata;
  body.metadata = { ...existing ?? {}, user_id: userId };
  return { sessionId, userId };
}

// src/oauth/claude-code.ts
var CLAUDE_CODE_CLIENT_ID = process.env.CLAUDE_OAUTH_CLIENT_ID ?? "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
var AUTHORIZE_URL2 = "https://claude.com/cai/oauth/authorize";
var TOKEN_URL4 = "https://platform.claude.com/v1/oauth/token";
var REDIRECT_URI = process.env.CLAUDE_CODE_REDIRECT_URI ?? "https://platform.claude.com/oauth/code/callback";
var SCOPES2 = "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers";
async function buildClaudeCodeAuthUrl(redirectUri = REDIRECT_URI) {
  const { verifier, challenge } = await generatePkce();
  const state = generateOAuthState();
  const params = new URLSearchParams({
    code: "true",
    client_id: CLAUDE_CODE_CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: SCOPES2,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    // Forces fresh auth — prevents session takeover that invalidates previous refresh tokens.
    prompt: "login"
  });
  return { authUrl: `${AUTHORIZE_URL2}?${params}`, codeVerifier: verifier, oauthState: state, redirectUri };
}
async function exchangeClaudeCodeToken(code, codeVerifier, redirectUri, state) {
  const { code: authCode, state: returnedState } = parseClaudeAuthInput(code);
  if (returnedState && returnedState !== state) {
    throw new Error("Anthropic returned an unexpected state \u2014 start the sign-in again");
  }
  const codeState = state;
  const res = await fetch(TOKEN_URL4, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      code: authCode,
      state: codeState,
      grant_type: "authorization_code",
      client_id: CLAUDE_CODE_CLIENT_ID,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier
    })
  });
  if (!res.ok) throw new Error(`Claude Code token exchange failed: ${await res.text()}`);
  return res.json();
}
function parseClaudeAuthInput(input) {
  let code = extractClaudeAuthCode(input);
  let state;
  try {
    state = new URL(input.trim()).searchParams.get("state") ?? void 0;
  } catch {
    const trimmed = input.trim();
    if (trimmed.startsWith("?") || trimmed.includes("code=")) {
      state = new URLSearchParams(trimmed.startsWith("?") ? trimmed.slice(1) : trimmed).get("state") ?? void 0;
    }
  }
  const hash = code.indexOf("#");
  if (hash >= 0) {
    state = code.slice(hash + 1) || state;
    code = code.slice(0, hash);
  }
  return { code, ...state ? { state } : {} };
}
function extractClaudeAuthCode(input) {
  const trimmed = input.trim();
  try {
    const parsed = new URL(trimmed);
    return parsed.searchParams.get("code") ?? trimmed;
  } catch {
    if (trimmed.startsWith("?") || trimmed.includes("code=")) {
      const query = trimmed.startsWith("?") ? trimmed.slice(1) : trimmed;
      return new URLSearchParams(query).get("code") ?? trimmed;
    }
    return trimmed;
  }
}
async function refreshClaudeCodeToken(refreshToken) {
  return postOAuthRefresh(
    TOKEN_URL4,
    {
      grant_type: "refresh_token",
      client_id: CLAUDE_CODE_CLIENT_ID,
      refresh_token: refreshToken
    },
    {
      contentType: "json",
      errorPrefix: "Claude Code token refresh failed",
      includeBody: true
    }
  );
}
async function fetchClaudeBootstrap(accessToken) {
  try {
    const res = await fetch("https://api.anthropic.com/api/claude_cli/bootstrap", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "User-Agent": `claude-cli/${CLAUDE_CODE_CLI_VERSION} (external, cli)`,
        "anthropic-beta": "oauth-2025-04-20"
      },
      signal: AbortSignal.timeout(1e4)
    });
    if (!res.ok) return {};
    const data = await res.json();
    const acct = data.oauth_account;
    if (!acct) return {};
    return {
      accountId: typeof acct.account_uuid === "string" ? acct.account_uuid : void 0,
      email: typeof acct.account_email === "string" ? acct.account_email : void 0,
      organizationId: typeof acct.organization_uuid === "string" ? acct.organization_uuid : void 0,
      organizationName: typeof acct.organization_name === "string" ? acct.organization_name : void 0,
      plan: typeof acct.organization_rate_limit_tier === "string" ? acct.organization_rate_limit_tier : void 0
    };
  } catch {
    return {};
  }
}
function generateCliUserID() {
  return randomBytes(32).toString("hex");
}
async function runClaudeCodeOAuthFlow(onAuthUrl, readAuthCode) {
  const { authUrl, codeVerifier, oauthState, redirectUri } = await buildClaudeCodeAuthUrl();
  onAuthUrl(authUrl);
  open2(authUrl).catch(() => {
  });
  const code = (await readAuthCode()).trim();
  if (!code) throw new Error("No authorization code received from Anthropic");
  const tokens = await exchangeClaudeCodeToken(code, codeVerifier, redirectUri, oauthState);
  const bootstrap = await fetchClaudeBootstrap(tokens.access_token);
  return { tokens, bootstrap };
}
async function fetchClaudeCodeModels(accessToken) {
  const res = await fetch("https://api.anthropic.com/v1/models", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "anthropic-version": "2023-06-01",
      Accept: "application/json",
      "User-Agent": `claude-cli/${CLAUDE_CODE_CLI_VERSION} (external, cli)`
    },
    signal: AbortSignal.timeout(1e4)
  });
  if (!res.ok) {
    throw new Error(`Claude Code model discovery failed (HTTP ${res.status}): ${await res.text().catch(() => "")}`);
  }
  const body = await res.json();
  const entries = (body.data ?? []).filter((m) => typeof m.id === "string" && m.id.length > 0).map((m) => ({
    id: m.id,
    displayName: typeof m.display_name === "string" ? m.display_name : m.id,
    maxInputTokens: typeof m.max_input_tokens === "number" ? m.max_input_tokens : void 0,
    maxTokens: typeof m.max_tokens === "number" ? m.max_tokens : void 0
  }));
  if (entries.length === 0) {
    throw new Error("Claude Code model discovery returned no models");
  }
  return entries;
}
async function completeClaudeCodeExchange(code, codeVerifier, oauthState, redirectUri) {
  const tokens = await exchangeClaudeCodeToken(code, codeVerifier, redirectUri, oauthState);
  const bootstrap = await fetchClaudeBootstrap(tokens.access_token);
  return { tokens, bootstrap };
}
function guiCallbackRedirectUri(host) {
  return `http://${host}/oauth/callback`;
}

// src/cline-pass.ts
var CLINE_PASS_HOST = "https://api.cline.bot";
var CLINE_PASS_SDK_BASE_URL = `${CLINE_PASS_HOST}/api/v1`;
var CLINE_PASS_CATALOG_URL = `${CLINE_PASS_HOST}/api/v1/ai/cline/recommended-models`;
var CLINE_PASS_VALIDATION_URL = `${CLINE_PASS_HOST}/api/v1/users/me`;
var CLINE_PASS_REGISTER_URL = `${CLINE_PASS_HOST}/api/v1/auth/register`;
var CLINE_PASS_REFRESH_URL = `${CLINE_PASS_HOST}/api/v1/auth/refresh`;
var CLINE_PASS_LEGACY_DEFAULT_CONTEXT_WINDOW = 131072;
var CLINE_PASS_WORKOS_PREFIX = "workos:";
function isClinePassOAuth(providerId, authType) {
  return providerId !== void 0 && isProviderKind(providerId, "cline-pass") && authType === "oauth";
}
function formatClineRuntimeCredential(providerId, authType, key) {
  if (!isClinePassOAuth(providerId, authType)) return key;
  return key.toLowerCase().startsWith(CLINE_PASS_WORKOS_PREFIX) ? key : `${CLINE_PASS_WORKOS_PREFIX}${key}`;
}
function createClinePassOAuthFetch(initialRuntimeCredential, refreshToken, onTokenRefreshed, fetchImpl = globalThis.fetch) {
  let currentRuntimeCredential = initialRuntimeCredential;
  return async (input, init) => {
    const request = new Request(input, init);
    const send = (runtimeCredential) => {
      const headers = new Headers(request.headers);
      headers.set("Authorization", `Bearer ${runtimeCredential}`);
      return fetchImpl(request.clone(), { headers });
    };
    const response = await send(currentRuntimeCredential);
    if (response.status !== 401) return response;
    const refreshedRawToken = await refreshToken().catch(() => null);
    const refreshedRuntimeCredential = refreshedRawToken ? formatClineRuntimeCredential("cline-pass", "oauth", refreshedRawToken) : null;
    if (!refreshedRawToken || !refreshedRuntimeCredential || refreshedRuntimeCredential === currentRuntimeCredential) {
      return response;
    }
    currentRuntimeCredential = refreshedRuntimeCredential;
    onTokenRefreshed?.(refreshedRawToken);
    return send(currentRuntimeCredential);
  };
}

// src/oauth/cline-pass.ts
var WORKOS_CLIENT_ID = "client_01K3A541FN8TA3EPPHTD2325AR";
var WORKOS_DEVICE_URL = "https://api.workos.com/user_management/authorize/device";
var WORKOS_TOKEN_URL = "https://api.workos.com/user_management/authenticate";
var DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";
var DEFAULT_INTERVAL_MS = 5e3;
var SLOW_DOWN_INCREMENT_MS = 1e3;
var DEFAULT_EXPIRES_MS = 10 * 60 * 1e3;
function formHeaders() {
  return {
    Accept: "application/json",
    "Content-Type": "application/x-www-form-urlencoded"
  };
}
function jsonHeaders() {
  return {
    Accept: "application/json",
    "Content-Type": "application/json"
  };
}
function expiresInFromIso(expiresAt) {
  if (typeof expiresAt !== "string") throw new Error("ClinePass response is missing a valid expiresAt");
  const timestamp = Date.parse(expiresAt);
  if (!Number.isFinite(timestamp)) throw new Error("ClinePass response is missing a valid expiresAt");
  return Math.max(1, Math.floor((timestamp - Date.now()) / 1e3));
}
function toOAuthResult(data) {
  if (typeof data.accessToken !== "string" || !data.accessToken) {
    throw new Error("ClinePass response is missing accessToken");
  }
  const userInfo = data.userInfo && typeof data.userInfo === "object" && !Array.isArray(data.userInfo) ? data.userInfo : void 0;
  const accountId = typeof userInfo?.clineUserId === "string" ? userInfo.clineUserId : void 0;
  return {
    tokens: {
      access_token: data.accessToken,
      ...typeof data.refreshToken === "string" ? { refresh_token: data.refreshToken } : {},
      expires_in: expiresInFromIso(data.expiresAt),
      ...userInfo ? { providerData: userInfo } : {}
    },
    ...accountId ? { accountId } : {},
    ...userInfo ? { providerData: userInfo } : {}
  };
}
async function readError(response) {
  const text2 = await response.text().catch(() => "");
  if (!text2) return `HTTP ${response.status}`;
  try {
    const parsed = JSON.parse(text2);
    const detail = typeof parsed.error === "string" ? parsed.error : typeof parsed.message === "string" ? parsed.message : "";
    return detail || `HTTP ${response.status}`;
  } catch {
    return text2.slice(0, 120);
  }
}
async function requestClinePassDeviceCode() {
  const response = await fetch(WORKOS_DEVICE_URL, {
    method: "POST",
    headers: formHeaders(),
    body: new URLSearchParams({ client_id: WORKOS_CLIENT_ID }).toString()
  });
  if (!response.ok) throw new Error(`ClinePass device code request failed (${response.status})`);
  const json = await response.json();
  if (!json.device_code || !json.user_code || !json.verification_uri) {
    throw new Error("ClinePass device code response is missing required fields");
  }
  return json;
}
async function registerClinePassTokens(accessToken, refreshToken) {
  const response = await fetch(CLINE_PASS_REGISTER_URL, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ accessToken, refreshToken })
  });
  if (!response.ok) throw new Error(`ClinePass registration failed (${response.status})`);
  const body = await response.json();
  if (body.success !== true || !body.data) {
    const detail = typeof body.error === "string" ? body.error : typeof body.message === "string" ? body.message : "unsuccessful response";
    throw new Error(`ClinePass registration failed: ${detail}`);
  }
  return toOAuthResult(body.data);
}
async function pollClinePassDeviceCode(device, opts) {
  const sleep2 = opts?.sleep ?? sleepMs;
  const now = opts?.now ?? (() => Date.now());
  const deadline = now() + positiveSecondsToMs(device.expires_in, DEFAULT_EXPIRES_MS);
  let intervalMs = Math.max(positiveSecondsToMs(device.interval, DEFAULT_INTERVAL_MS), 1e3);
  while (now() < deadline) {
    const response = await fetch(WORKOS_TOKEN_URL, {
      method: "POST",
      headers: formHeaders(),
      body: new URLSearchParams({
        grant_type: DEVICE_GRANT_TYPE,
        client_id: WORKOS_CLIENT_ID,
        device_code: device.device_code
      }).toString()
    });
    if (response.ok) {
      const workos = await response.json();
      if (!workos.access_token || !workos.refresh_token) {
        throw new Error("ClinePass WorkOS response is missing required tokens");
      }
      return registerClinePassTokens(workos.access_token, workos.refresh_token);
    }
    const body = await response.json().catch(() => ({}));
    const remaining = Math.max(0, deadline - now());
    if (body.error === "authorization_pending") {
      await sleep2(Math.min(intervalMs, remaining));
      continue;
    }
    if (body.error === "slow_down") {
      intervalMs += SLOW_DOWN_INCREMENT_MS;
      await sleep2(Math.min(intervalMs, remaining));
      continue;
    }
    throw new Error(`ClinePass device authorization failed${body.error ? `: ${body.error}` : ""}`);
  }
  throw new Error("ClinePass device authorization timed out");
}
async function runClinePassDeviceCodeFlow(onDeviceCode, opts) {
  const device = await requestClinePassDeviceCode();
  onDeviceCode({
    url: device.verification_uri_complete ?? device.verification_uri,
    userCode: device.user_code
  });
  return pollClinePassDeviceCode(device, opts);
}
async function refreshClinePassAccessToken(refreshToken) {
  const response = await fetch(CLINE_PASS_REFRESH_URL, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ refreshToken, grantType: "refresh_token" })
  });
  if (!response.ok) {
    const detail = await readError(response);
    throw new Error(`ClinePass token refresh failed (${response.status}): ${detail}`);
  }
  const body = await response.json();
  if (body.success !== true || !body.data) {
    const detail = typeof body.error === "string" ? body.error : typeof body.message === "string" ? body.message : "unsuccessful response";
    throw new Error(`ClinePass token refresh failed: ${detail}`);
  }
  return toOAuthResult(body.data).tokens;
}

// src/oauth/refresh.ts
function oauthCredentialShouldRefresh(cred, providerId) {
  if (oauthCredentialNeedsRefresh(cred)) return true;
  if (NATIVE_OAUTH_PROVIDER_IDS.includes(providerKind(providerId)) && accessTokenIsExpiring(cred.access)) return true;
  return false;
}
async function refreshStoredOAuthCredential(providerId, cred) {
  if (!cred.refresh) {
    throw new Error(`${providerId}: OAuth refresh token missing \u2014 run relay-ai providers auth ${providerId}`);
  }
  const kind = providerKind(providerId);
  let tokens;
  if (kind === "openai" || kind === "openai-oauth") {
    tokens = await refreshOpenAiAccessToken(cred.refresh);
  } else if (kind === "xai" || kind === "xai-oauth") {
    tokens = await refreshXaiAccessToken(cred.refresh);
  } else if (kind === "github-copilot") {
    tokens = await refreshGithubCopilotToken(cred.refresh);
  } else if (kind === "claude-code") {
    tokens = await refreshClaudeCodeToken(cred.refresh);
  } else if (kind === "antigravity") {
    tokens = await refreshAntigravityToken(cred.refresh);
  } else if (kind === "cline-pass") {
    tokens = await refreshClinePassAccessToken(cred.refresh);
  } else {
    throw new Error(`OAuth refresh not implemented for provider "${providerId}"`);
  }
  const accountId = kind === "cline-pass" && typeof tokens.providerData?.clineUserId === "string" ? tokens.providerData.clineUserId : cred.accountId;
  return tokensToStoredCredential(tokens, cred.refresh, accountId, cred.providerData);
}

// src/oauth/refresh-lock.ts
import { closeSync, mkdirSync, openSync, readFileSync as readFileSync4, statSync as statSync2, unlinkSync, writeSync } from "fs";
import { createHash as createHash2, randomUUID as randomUUID2 } from "crypto";
import { join as join3 } from "path";
var POLL_MS = 100;
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}
function readHolder(path) {
  try {
    const parsed = JSON.parse(readFileSync4(path, "utf8"));
    return {
      pid: typeof parsed.pid === "number" ? parsed.pid : void 0,
      token: typeof parsed.token === "string" ? parsed.token : void 0
    };
  } catch {
    return {};
  }
}
function isStale(path, staleMs) {
  try {
    const { pid } = readHolder(path);
    if (pid !== void 0 && !processAlive(pid)) return true;
    return Date.now() - statSync2(path).mtimeMs > staleMs;
  } catch {
    return false;
  }
}
function removeLock(path) {
  try {
    unlinkSync(path);
  } catch {
  }
}
async function acquire(path, timeoutMs, staleMs) {
  const token = randomUUID2();
  const deadline = Date.now() + timeoutMs;
  for (; ; ) {
    try {
      const fd = openSync(path, "wx", 384);
      try {
        writeSync(fd, JSON.stringify({ pid: process.pid, token }));
      } finally {
        closeSync(fd);
      }
      return token;
    } catch (err) {
      if (err.code !== "EEXIST") return null;
      if (isStale(path, staleMs)) {
        removeLock(path);
        continue;
      }
      if (Date.now() >= deadline) return null;
      await sleep(POLL_MS);
    }
  }
}
async function withRefreshLock(key, work, options = {}) {
  const dir = options.dir ?? join3(getAppHome(), "locks");
  let path;
  let token = null;
  try {
    mkdirSync(dir, { recursive: true, mode: 448 });
    path = join3(dir, `oauth-${createHash2("sha256").update(key).digest("hex").slice(0, 24)}.lock`);
    token = await acquire(path, options.timeoutMs ?? 2e4, options.staleMs ?? 12e4);
  } catch {
    token = null;
  }
  try {
    return await work();
  } finally {
    if (path && token && readHolder(path).token === token) removeLock(path);
  }
}

// src/secrets-file.ts
import { chmodSync, existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync as readFileSync5, writeFileSync } from "fs";
var DIR_MODE = 448;
var FILE_MODE = 384;
function emptySecrets() {
  return { version: 1, accounts: {} };
}
function readSecretsFile(env = process.env) {
  const path = getSecretsPath(env);
  if (!existsSync2(path)) return emptySecrets();
  try {
    const raw = JSON.parse(readFileSync5(path, "utf8"));
    if (raw?.version !== 1 || !raw.accounts || typeof raw.accounts !== "object") {
      return emptySecrets();
    }
    const accounts = {};
    for (const [k, v] of Object.entries(raw.accounts)) {
      if (typeof v === "string" && v.length > 0) accounts[k] = v;
    }
    return { version: 1, accounts };
  } catch {
    return emptySecrets();
  }
}
function writeSecretsFile(data, env = process.env) {
  const home = getAppHome(env);
  mkdirSync2(home, { recursive: true, mode: DIR_MODE });
  try {
    chmodSync(home, DIR_MODE);
  } catch {
  }
  const path = getSecretsPath(env);
  writeFileSync(path, `${JSON.stringify(data, null, 2)}
`, { encoding: "utf8", mode: FILE_MODE });
  try {
    chmodSync(path, FILE_MODE);
  } catch {
  }
}
function readFileAccount(account, env = process.env) {
  const value = readSecretsFile(env).accounts[account];
  return value?.length ? value : null;
}
function writeFileAccount(account, value, env = process.env) {
  if (!account || !value) return false;
  try {
    const data = readSecretsFile(env);
    data.accounts[account] = value;
    writeSecretsFile(data, env);
    return true;
  } catch {
    return false;
  }
}
function deleteFileAccount(account, env = process.env) {
  try {
    const data = readSecretsFile(env);
    if (!(account in data.accounts)) return true;
    delete data.accounts[account];
    writeSecretsFile(data, env);
    return true;
  } catch {
    return false;
  }
}

// src/env.ts
function detectConflicts() {
  return CONFLICTING_ENV_VARS.filter((name) => process.env[name] !== void 0).map((name) => ({ name, value: process.env[name] }));
}
function resolveApiKey() {
  const key = process.env["OPENCODE_API_KEY"];
  if (!key?.trim()) return null;
  return key.trim().split(/\r?\n/)[0]?.trim() || null;
}
function applyClaudeCodeThirdPartyCompat(env) {
  env["ENABLE_TOOL_SEARCH"] = "true";
  env["CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT"] = "0";
}
function buildChildEnv(baseUrl, model, apiKey, proxyPort, contextWindow, enableGatewayDiscovery) {
  const env = { ...process.env };
  for (const name of CONFLICTING_ENV_VARS) {
    delete env[name];
  }
  for (const name of PARENT_SESSION_ENV_VARS) {
    delete env[name];
  }
  env["ANTHROPIC_BASE_URL"] = proxyPort ? `http://127.0.0.1:${proxyPort}` : baseUrl;
  env["ANTHROPIC_API_KEY"] = apiKey;
  const bareModel = stripOneMContextSuffix(model);
  env["ANTHROPIC_MODEL"] = claudeCodeClientModelId(model, contextWindow);
  if (!enableGatewayDiscovery) {
    env["CLAUDE_CODE_MAX_CONTEXT_TOKENS"] = String(resolveContextWindow(bareModel, contextWindow));
  }
  if (enableGatewayDiscovery) {
    delete env["CLAUDE_CODE_MAX_CONTEXT_TOKENS"];
    env["CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY"] = "1";
  }
  env["CLAUDE_CODE_AUTO_MODE_SERVER"] ??= "0";
  applyClaudeCodeThirdPartyCompat(env);
  return env;
}
function buildAntigravityChildEnv(gatewayUrl) {
  const env = { ...process.env };
  for (const name of CONFLICTING_ENV_VARS) {
    delete env[name];
  }
  env["CLOUD_CODE_URL"] = gatewayUrl;
  env["ANTIGRAVITY_API_KEY"] = "relay-dummy-key";
  env["GEMINI_API_KEY"] = "relay-dummy-key";
  env["GOOGLE_API_KEY"] = "relay-dummy-key";
  env["GOOGLE_GEMINI_API_KEY"] = "relay-dummy-key";
  return env;
}
function classifyKeyringError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (lower.includes("cannot find module") || lower.includes("module not found") || lower.includes("failed to load")) {
    return "native keyring module not available on this system";
  }
  if (lower.includes("secret service") || lower.includes("dbus") || lower.includes("daemon")) {
    return "Secret Service daemon is not running (start GNOME Keyring or KWallet)";
  }
  if (lower.includes("denied") || lower.includes("locked") || lower.includes("cancelled") || lower.includes("user refused")) {
    return "keychain access was denied or the keychain is locked";
  }
  return `keyring error: ${msg}`;
}
var KEYRING_SERVICE = "relay-ai";
var KEYRING_ACCOUNT = "relay-ai";
var KEYRING_CHUNK_PREFIX = "__relay_chunked__:";
var KEYRING_CHUNK_SIZE = 1200;
var LEGACY_KEYRING_SERVICE = "opencode-starter";
var LEGACY_KEYRING_ACCOUNT = "opencode-starter";
var GLOBAL_OPENCODE_KEYRING_ACCOUNT = "global:opencode";
function providerKeyringAccount(providerId) {
  return `provider:${providerId}`;
}
function preferredRelayCredentialAuthRef(providerId, fallbackAuthRef) {
  return providerId === "go" || providerId === "zen" ? `keyring:${providerKeyringAccount("opencode")}` : fallbackAuthRef;
}
function oauthProviderIdFromAccount(account) {
  const prefix = "oauth:provider:";
  return account.startsWith(prefix) ? account.slice(prefix.length) : null;
}
var oauthRefreshInflight = /* @__PURE__ */ new Map();
function parseAuthRef(authRef) {
  if (authRef.startsWith("keyring:")) {
    const account = authRef.slice("keyring:".length);
    return account ? { kind: "keyring", account } : null;
  }
  if (authRef.startsWith("env:")) {
    const varName = authRef.slice("env:".length);
    return varName ? { kind: "env", varName } : null;
  }
  return null;
}
function relayAiKeyEnvVar(providerId) {
  return `RELAY_AI_KEY_${providerId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
}
function readEnvCredential(varName) {
  const raw = process.env[varName];
  if (!raw?.trim()) return null;
  return raw.trim().split(/\r?\n/)[0]?.trim() || null;
}
var osKeyringReadCache = /* @__PURE__ */ new Map();
function invalidateKeyringReadCache(account) {
  if (account === void 0) osKeyringReadCache.clear();
  else osKeyringReadCache.delete(account);
}
async function readOsKeyringAccount(account, diag) {
  const cached = osKeyringReadCache.get(account);
  if (cached) return cached;
  const read = (async () => {
    try {
      const { Entry } = await import("@napi-rs/keyring");
      const value = new Entry(KEYRING_SERVICE, account).getPassword() ?? null;
      if (!value?.startsWith(KEYRING_CHUNK_PREFIX)) return value;
      const chunkCount = Number(value.slice(KEYRING_CHUNK_PREFIX.length));
      let combined = "";
      for (let i = 0; i < chunkCount; i++) {
        combined += new Entry(KEYRING_SERVICE, `${account}::chunk::${i}`).getPassword() ?? "";
      }
      return combined;
    } catch (err) {
      diag?.(classifyKeyringError(err));
      return null;
    }
  })();
  osKeyringReadCache.set(account, read);
  return read;
}
async function writeOsKeyringAccount(account, key, diag) {
  try {
    const { Entry } = await import("@napi-rs/keyring");
    if (key.length <= KEYRING_CHUNK_SIZE) {
      new Entry(KEYRING_SERVICE, account).setPassword(key);
      return true;
    }
    const chunkCount = Math.ceil(key.length / KEYRING_CHUNK_SIZE);
    for (let i = 0; i < chunkCount; i++) {
      const chunk = key.slice(i * KEYRING_CHUNK_SIZE, (i + 1) * KEYRING_CHUNK_SIZE);
      new Entry(KEYRING_SERVICE, `${account}::chunk::${i}`).setPassword(chunk);
    }
    new Entry(KEYRING_SERVICE, account).setPassword(`${KEYRING_CHUNK_PREFIX}${chunkCount}`);
    return true;
  } catch (err) {
    diag?.(classifyKeyringError(err));
    return false;
  }
}
async function deleteOsKeyringAccount(account, diag) {
  try {
    const { Entry } = await import("@napi-rs/keyring");
    const value = new Entry(KEYRING_SERVICE, account).getPassword();
    if (value?.startsWith(KEYRING_CHUNK_PREFIX)) {
      const chunkCount = Number(value.slice(KEYRING_CHUNK_PREFIX.length));
      for (let i = 0; i < chunkCount; i++) {
        new Entry(KEYRING_SERVICE, `${account}::chunk::${i}`).deletePassword();
      }
    }
    new Entry(KEYRING_SERVICE, account).deletePassword();
    return true;
  } catch (err) {
    diag?.(classifyKeyringError(err));
    return false;
  }
}
async function readKeyringAccount(account, diag) {
  const fromOs = await readOsKeyringAccount(account, diag);
  if (fromOs) return fromOs;
  return readFileAccount(account);
}
async function writeKeyringAccount(account, key, diag) {
  invalidateKeyringReadCache(account);
  try {
    if (await writeOsKeyringAccount(account, key, diag)) {
      deleteFileAccount(account);
      return true;
    }
    if (writeFileAccount(account, key)) {
      diag?.("OS keyring unavailable \u2014 saved to secrets.json under RELAY_AI_HOME");
      return true;
    }
    return false;
  } finally {
    invalidateKeyringReadCache(account);
  }
}
async function deleteKeyringAccount(account, diag) {
  invalidateKeyringReadCache(account);
  try {
    const osOk = await deleteOsKeyringAccount(account, diag);
    const fileOk = deleteFileAccount(account);
    return osOk || fileOk;
  } finally {
    invalidateKeyringReadCache(account);
  }
}
async function readGlobalOpencodeCredential(diag) {
  const fromEnv = resolveApiKey();
  if (fromEnv) return fromEnv;
  const global = await readKeyringAccount(GLOBAL_OPENCODE_KEYRING_ACCOUNT, diag);
  if (global) return global;
  const current = await readKeyringAccount(KEYRING_ACCOUNT, diag);
  if (current) return current;
  try {
    const { Entry } = await import("@napi-rs/keyring");
    return new Entry(LEGACY_KEYRING_SERVICE, LEGACY_KEYRING_ACCOUNT).getPassword() ?? null;
  } catch (err) {
    diag?.(classifyKeyringError(err));
    return null;
  }
}
async function readStoredProviderCredential(authRef, diag) {
  const parsed = parseAuthRef(authRef);
  if (!parsed || parsed.kind !== "keyring") return null;
  return readProviderSecret(parsed.account, diag);
}
async function migrateGlobalOpencodeCredential(diag) {
  const existing = await readKeyringAccount(GLOBAL_OPENCODE_KEYRING_ACCOUNT, diag);
  if (existing) return true;
  const legacy = await readKeyringAccount(KEYRING_ACCOUNT, diag) ?? await (async () => {
    try {
      const { Entry } = await import("@napi-rs/keyring");
      return new Entry(LEGACY_KEYRING_SERVICE, LEGACY_KEYRING_ACCOUNT).getPassword() ?? null;
    } catch (err) {
      diag?.(classifyKeyringError(err));
      return null;
    }
  })();
  if (!legacy) return false;
  const wrote = await writeKeyringAccount(GLOBAL_OPENCODE_KEYRING_ACCOUNT, legacy, diag);
  if (!wrote) return false;
  const verified = await readKeyringAccount(GLOBAL_OPENCODE_KEYRING_ACCOUNT, diag);
  if (verified !== legacy) {
    diag?.("credential migration verification failed \u2014 keeping legacy keychain entries");
    return false;
  }
  if (await readKeyringAccount(KEYRING_ACCOUNT, diag)) {
    await deleteKeyringAccount(KEYRING_ACCOUNT, diag);
  }
  try {
    const { Entry } = await import("@napi-rs/keyring");
    if (new Entry(LEGACY_KEYRING_SERVICE, LEGACY_KEYRING_ACCOUNT).getPassword()) {
      new Entry(LEGACY_KEYRING_SERVICE, LEGACY_KEYRING_ACCOUNT).deletePassword();
    }
  } catch {
  }
  return true;
}
async function resolveProviderCredential(providerId, authRef, diag) {
  const parsed = parseAuthRef(authRef);
  if (!parsed) return null;
  if (parsed.kind === "keyring" && parsed.account === GLOBAL_OPENCODE_KEYRING_ACCOUNT) {
    const relayOverride = await readProviderSecret(providerKeyringAccount("opencode"), diag);
    if (relayOverride) return relayOverride;
  }
  const namespaced = readEnvCredential(relayAiKeyEnvVar(providerId));
  if (namespaced) return namespaced;
  if (parsed.kind === "env") {
    return readEnvCredential(parsed.varName);
  }
  if (parsed.account === GLOBAL_OPENCODE_KEYRING_ACCOUNT) {
    return readGlobalOpencodeCredential(diag);
  }
  if (oauthProviderIdFromAccount(parsed.account)) invalidateKeyringReadCache(parsed.account);
  return readProviderSecret(parsed.account, diag);
}
async function forceRefreshProviderCredential(providerId, authRef, diag) {
  const parsed = parseAuthRef(authRef);
  if (!parsed || parsed.kind !== "keyring") {
    return resolveProviderCredential(providerId, authRef, diag);
  }
  if (parsed.account === GLOBAL_OPENCODE_KEYRING_ACCOUNT) {
    const relayOverride = await readProviderSecret(providerKeyringAccount("opencode"), diag);
    if (relayOverride) return relayOverride;
  }
  const namespaced = readEnvCredential(relayAiKeyEnvVar(providerId));
  if (namespaced) return namespaced;
  const oauthProviderId = oauthProviderIdFromAccount(parsed.account);
  if (oauthProviderId) invalidateKeyringReadCache(parsed.account);
  const raw = await readKeyringAccount(parsed.account, diag);
  if (!raw || !oauthProviderId) return decodeProviderSecret(raw);
  return refreshOAuthKeyringAccount(parsed.account, oauthProviderId, raw, diag, true);
}
async function readStoredOAuthCredential(authRef, diag) {
  const parsed = parseAuthRef(authRef);
  if (!parsed || parsed.kind !== "keyring" || !oauthProviderIdFromAccount(parsed.account)) return void 0;
  return parseStoredOAuthCredential(await readKeyringAccount(parsed.account, diag)) ?? void 0;
}
async function resolveProviderOAuthAccountId(authRef, diag) {
  const parsed = parseAuthRef(authRef);
  if (!parsed || parsed.kind !== "keyring" || !oauthProviderIdFromAccount(parsed.account)) return void 0;
  const raw = await readKeyringAccount(parsed.account, diag);
  return parseStoredOAuthCredential(raw)?.accountId;
}
async function resolveProviderOAuthProviderData(authRef, diag) {
  const parsed = parseAuthRef(authRef);
  if (!parsed || parsed.kind !== "keyring" || !oauthProviderIdFromAccount(parsed.account)) return void 0;
  const raw = await readKeyringAccount(parsed.account, diag);
  return parseStoredOAuthCredential(raw)?.providerData;
}
async function enrichGithubCopilotOAuthProviderData(authRef, diag) {
  const parsed = parseAuthRef(authRef);
  if (!parsed || parsed.kind !== "keyring" || oauthProviderIdFromAccount(parsed.account) !== "github-copilot") {
    return void 0;
  }
  const raw = await readKeyringAccount(parsed.account, diag);
  const credential = parseStoredOAuthCredential(raw);
  if (!credential?.refresh) return credential?.providerData;
  try {
    const summary = await fetchCopilotAccount(credential.refresh);
    const providerData = { ...credential.providerData, copilot: summary };
    await writeKeyringAccount(
      parsed.account,
      oauthCredentialToKeychainJson({ ...credential, providerData }),
      diag
    );
    return providerData;
  } catch (err) {
    diag?.(`GitHub Copilot plan lookup unavailable \u2014 ${err instanceof Error ? err.message : String(err)}`);
    return credential.providerData;
  }
}
function decodeProviderSecret(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return trimmed;
  const oauth = parseStoredOAuthCredential(trimmed);
  if (oauth) return oauth.access;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed.type === "oauth" && typeof parsed.access === "string") return parsed.access;
    if (parsed.type === "wellknown" && typeof parsed.token === "string") return parsed.token;
  } catch {
  }
  return trimmed;
}
async function refreshOAuthKeyringAccount(account, providerId, raw, diag, force = false) {
  const existing = oauthRefreshInflight.get(account);
  if (existing) return existing;
  const work = (async () => {
    const seen = parseStoredOAuthCredential(raw);
    if (!seen || !force && !oauthCredentialShouldRefresh(seen, providerId)) {
      return decodeProviderSecret(raw);
    }
    return withRefreshLock(account, async () => {
      invalidateKeyringReadCache(account);
      const cred = parseStoredOAuthCredential(await readKeyringAccount(account, diag)) ?? seen;
      const replacedByOther = cred.access !== seen.access || cred.refresh !== seen.refresh;
      if (replacedByOther && !oauthCredentialShouldRefresh(cred, providerId)) return cred.access;
      if (!force && !oauthCredentialShouldRefresh(cred, providerId)) return cred.access;
      try {
        const refreshed = await refreshStoredOAuthCredential(providerId, cred);
        const json = oauthCredentialToKeychainJson(refreshed);
        await writeKeyringAccount(account, json, diag);
        return refreshed.access;
      } catch (err) {
        diag?.(err instanceof Error ? err.message : String(err));
        if (cred.access && cred.expires > Date.now()) return cred.access;
        if (err instanceof OAuthRefreshRevokedError) {
          throw new Error(`${err.message}. Sign in again: relay-ai providers auth ${providerId}`);
        }
        throw err;
      }
    });
  })();
  oauthRefreshInflight.set(account, work);
  try {
    return await work;
  } finally {
    oauthRefreshInflight.delete(account);
  }
}
async function readProviderSecret(account, diag) {
  const raw = await readKeyringAccount(account, diag);
  if (!raw) return null;
  const oauthProviderId = oauthProviderIdFromAccount(account);
  if (oauthProviderId && raw.trim().startsWith("{")) {
    return refreshOAuthKeyringAccount(account, oauthProviderId, raw, diag);
  }
  return decodeProviderSecret(raw);
}
async function saveProviderCredential(authRef, key, diag) {
  const parsed = parseAuthRef(authRef);
  if (!parsed || parsed.kind !== "keyring") return false;
  return writeKeyringAccount(parsed.account, key, diag);
}
async function deleteProviderCredential(authRef, diag) {
  const parsed = parseAuthRef(authRef);
  if (!parsed || parsed.kind !== "keyring") return false;
  return deleteKeyringAccount(parsed.account, diag);
}
async function readFromCredentialStore(diag) {
  return readGlobalOpencodeCredential(diag);
}
async function saveToCredentialStore(key, diag) {
  const wrote = await writeKeyringAccount(GLOBAL_OPENCODE_KEYRING_ACCOUNT, key, diag);
  if (wrote) {
    await deleteKeyringAccount(KEYRING_ACCOUNT, diag);
  }
  return wrote;
}
async function isSecretServiceAvailable() {
  try {
    const { Entry } = await import("@napi-rs/keyring");
    new Entry(`${KEYRING_SERVICE}-probe`, "probe").getPassword();
    return true;
  } catch {
    return false;
  }
}

export {
  providerKind,
  isProviderKind,
  nextInstanceId,
  BACKENDS,
  CODEX_RESPONSES_LITE_WS_URL,
  CODEX_RESPONSES_LITE_VERSION,
  CODEX_RESPONSES_WEBSOCKETS_BETA,
  CONFLICTING_ENV_VARS,
  MAX_MODEL_CATALOG,
  CODEX_SUBAGENT_MODEL_CAP,
  MIN_CONTEXT_WINDOW,
  VERTEX_ANTHROPIC_NPM,
  classifyModelFormat,
  VERSION,
  extractOpenAiAccountId,
  requestOpenAiDeviceCode,
  openAiDeviceCodeUrl,
  pollOpenAiDeviceCodeToken,
  runOpenAiDeviceCodeFlow,
  CLAUDE_CODE_CLI_VERSION,
  CLAUDE_CODE_USER_AGENT,
  CLAUDE_CODE_BILLING_HEADER_PREFIX,
  buildClaudeCodeBillingSystemLine,
  injectClaudeCodeBillingSystemLine,
  selectBetaFlags,
  injectClaudeIdentity,
  CLINE_PASS_HOST,
  CLINE_PASS_SDK_BASE_URL,
  CLINE_PASS_CATALOG_URL,
  CLINE_PASS_VALIDATION_URL,
  CLINE_PASS_LEGACY_DEFAULT_CONTEXT_WINDOW,
  isClinePassOAuth,
  formatClineRuntimeCredential,
  createClinePassOAuthFetch,
  contextWindowFromHeuristics,
  resolveContextWindow,
  claudeCodeContextWindow,
  stripOneMContextSuffix,
  claudeCodeClientModelId,
  routeLookupIds,
  readOpencodeAuthFile,
  isOpencodeOAuth,
  isOpencodeApi,
  oauthCredentialToKeychainJson,
  describeOAuthAccount,
  formatOAuthAccount,
  sameOAuthAccount,
  tokensToStoredCredential,
  supportsNativeOAuth,
  isBrowserRedirectOAuth,
  supportsAdditionalOAuthAccounts,
  requestGithubDeviceCode,
  pollGithubDeviceCodeToken,
  runGithubDeviceCodeFlow,
  requestXaiDeviceCode,
  pollXaiDeviceCodeToken,
  runXaiDeviceCodeFlow,
  buildClaudeCodeAuthUrl,
  generateCliUserID,
  runClaudeCodeOAuthFlow,
  fetchClaudeCodeModels,
  completeClaudeCodeExchange,
  guiCallbackRedirectUri,
  ANTIGRAVITY_USER_AGENT,
  ANTIGRAVITY_BASE_URLS,
  ANTIGRAVITY_API_VERSION,
  buildAntigravityAuthUrl,
  runAntigravityOAuthFlow,
  completeAntigravityExchange,
  requestClinePassDeviceCode,
  pollClinePassDeviceCode,
  runClinePassDeviceCodeFlow,
  detectConflicts,
  resolveApiKey,
  buildChildEnv,
  buildAntigravityChildEnv,
  GLOBAL_OPENCODE_KEYRING_ACCOUNT,
  preferredRelayCredentialAuthRef,
  parseAuthRef,
  readGlobalOpencodeCredential,
  readStoredProviderCredential,
  migrateGlobalOpencodeCredential,
  resolveProviderCredential,
  forceRefreshProviderCredential,
  readStoredOAuthCredential,
  resolveProviderOAuthAccountId,
  resolveProviderOAuthProviderData,
  enrichGithubCopilotOAuthProviderData,
  saveProviderCredential,
  deleteProviderCredential,
  readFromCredentialStore,
  saveToCredentialStore,
  isSecretServiceAvailable
};
//# sourceMappingURL=chunk-4RLHM2U6.js.map