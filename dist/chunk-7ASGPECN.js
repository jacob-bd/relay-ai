#!/usr/bin/env node

// src/constants.ts
import { homedir } from "os";
import { join } from "path";

// package.json
var package_default = {
  name: "@jacobbd/relay-ai",
  version: "0.12.1",
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
    "relay-ai": "dist/cli.js"
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
    "@ai-sdk/vercel": "^3.0.30",
    "@ai-sdk/xai": "^4.0.54",
    "@clack/prompts": "^0.9.1",
    "@openrouter/ai-sdk-provider": "^3.0.0",
    ai: "^7.0.93",
    "cross-spawn": "^7.0.6",
    "gitlab-ai-provider": "^6.15.0",
    graphql: "^16.14.2",
    "ipaddr.js": "^2.4.0",
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
var CODEX_RESPONSES_LITE_VERSION = "0.153.4";
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
var MAX_MODEL_CATALOG = 20;
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

// src/paths.ts
import { homedir as homedir2 } from "os";
import { join as join2 } from "path";
var APP_DIR_NAME = "relay-ai";
var LEGACY_APP_DIR_NAME = "opencode-starter";
function userHome(env = process.env) {
  return env.HOME ?? env.USERPROFILE ?? homedir2();
}
function resolveAppHomeOverride(env = process.env) {
  const override = env.RELAY_AI_HOME ?? env.OPENCODE_STARTER_HOME;
  return override?.trim() || void 0;
}
function getAppHome(env = process.env) {
  const override = resolveAppHomeOverride(env);
  if (override) return override;
  return join2(userHome(env), `.${APP_DIR_NAME}`);
}
function getLegacyAppHome(env = process.env) {
  return join2(userHome(env), `.${LEGACY_APP_DIR_NAME}`);
}
function getConfigPath(env = process.env) {
  return join2(getAppHome(env), "config.json");
}
function getProvidersPath(env = process.env) {
  return join2(getAppHome(env), "providers.json");
}
function getSecretsPath(env = process.env) {
  return join2(getAppHome(env), "secrets.json");
}
function getLogsPath(env = process.env) {
  return join2(getAppHome(env), "logs");
}
function getVertexModelsPath(env = process.env) {
  return join2(getAppHome(env), "vertex-models.json");
}
function getLegacyConfPath(env = process.env, platform = process.platform) {
  const home = userHome(env);
  const appName = `${LEGACY_APP_DIR_NAME}-nodejs`;
  if (platform === "darwin") {
    return join2(home, "Library", "Preferences", appName, "config.json");
  }
  if (platform === "win32") {
    return join2(env.APPDATA ?? join2(home, "AppData", "Roaming"), appName, "Config", "config.json");
  }
  return join2(env.XDG_CONFIG_HOME ?? join2(home, ".config"), appName, "config.json");
}

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
function stripOneMContextSuffix(modelId) {
  return modelId.replace(/\[1m\]$/i, "");
}
function claudeCodeClientModelId(modelId, contextWindow) {
  const bare = stripOneMContextSuffix(modelId);
  const window = resolveContextWindow(bare, contextWindow);
  if (window > DEFAULT_CONTEXT_WINDOW) {
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
import { homedir as homedir3 } from "os";
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
    const detail = options.includeBody ? await response.text().catch(() => "") : "";
    const status = options.includeStatus ? ` (${response.status})` : "";
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
var ANTIGRAVITY_VERSION = "4.2.0";
var ANTIGRAVITY_USER_AGENT = `vscode/1.X.X (Antigravity/${ANTIGRAVITY_VERSION})`;
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
    const cache = pathJoin(homedir3(), ".gemini", "antigravity-cli", "cache", "projects.json");
    const data = JSON.parse(readFileSync2(cache, "utf8"));
    return data[homedir3()] ?? Object.values(data)[0] ?? "";
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
    const { authUrl, codeVerifier, redirectUri } = await buildAntigravityAuthUrl(server.redirectUri);
    onAuthUrl(authUrl);
    open(authUrl).catch(() => {
    });
    const { code } = await server.waitForCallback();
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
import { homedir as homedir4 } from "os";
import { join as join3 } from "path";
function resolveOpencodeAuthPath(env = process.env) {
  const dataHome = env["XDG_DATA_HOME"] ?? join3(homedir4(), ".local", "share");
  if (process.platform === "win32") {
    return join3(env["APPDATA"] ?? join3(homedir4(), "AppData", "Roaming"), "opencode", "auth.json");
  }
  return join3(dataHome, "opencode", "auth.json");
}
function decodeAuthEntry(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!value || typeof value !== "object") return null;
  const record = value;
  if (record["type"] === "oauth" && typeof record["access"] === "string" && typeof record["refresh"] === "string" && typeof record["expires"] === "number") {
    return {
      type: "oauth",
      access: record["access"],
      refresh: record["refresh"],
      expires: record["expires"],
      accountId: typeof record["accountId"] === "string" ? record["accountId"] : void 0,
      enterpriseUrl: typeof record["enterpriseUrl"] === "string" ? record["enterpriseUrl"] : void 0,
      providerData: record["providerData"] && typeof record["providerData"] === "object" && !Array.isArray(record["providerData"]) ? record["providerData"] : void 0
    };
  }
  if (record["type"] === "wellknown" && typeof record["key"] === "string" && typeof record["token"] === "string") {
    return { type: "wellknown", key: record["key"], token: record["token"] };
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
function oauthCredentialToKeychainJson(cred) {
  return JSON.stringify(cred);
}

// src/oauth/types.ts
function tokensToStoredCredential(tokens, existingRefresh, accountId, providerData) {
  const mergedProviderData = providerData || tokens.providerData ? { ...providerData, ...tokens.providerData } : void 0;
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
  const sleep = opts?.sleep ?? sleepMs;
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
    await sleep(Math.min(intervalMs + OAUTH_POLLING_SAFETY_MARGIN_MS, Math.max(0, deadline - now())));
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
  const sleep = opts?.sleep ?? sleepMs;
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
      await sleep(Math.min(intervalMs + OAUTH_POLLING_SAFETY_MARGIN_MS2, Math.max(0, deadline - now())));
      continue;
    }
    if (error === "slow_down") {
      intervalMs += 5e3;
      await sleep(Math.min(intervalMs + OAUTH_POLLING_SAFETY_MARGIN_MS2, Math.max(0, deadline - now())));
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
  const sleep = opts?.sleep ?? sleepMs;
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
      await sleep(Math.min(intervalMs + OAUTH_POLLING_SAFETY_MARGIN_MS3, remaining));
      continue;
    }
    if (body.error === "slow_down") {
      intervalMs += DEVICE_CODE_SLOW_DOWN_INCREMENT_MS;
      await sleep(Math.min(intervalMs + OAUTH_POLLING_SAFETY_MARGIN_MS3, remaining));
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
var CLAUDE_CODE_CLIENT_ID = process.env.CLAUDE_OAUTH_CLIENT_ID ?? "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
var AUTHORIZE_URL2 = "https://claude.ai/oauth/authorize";
var TOKEN_URL4 = "https://api.anthropic.com/v1/oauth/token";
var REDIRECT_URI = process.env.CLAUDE_CODE_REDIRECT_URI ?? "https://platform.claude.com/oauth/code/callback";
var SCOPES2 = "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers";
var CLAUDE_CODE_CLI_VERSION = "2.1.195";
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
  let authCode = extractClaudeAuthCode(code);
  let codeState = state;
  if (authCode.includes("#")) {
    const idx = authCode.indexOf("#");
    codeState = authCode.slice(idx + 1) || state;
    authCode = authCode.slice(0, idx);
  }
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
  return providerId === "cline-pass" && authType === "oauth";
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
  const text = await response.text().catch(() => "");
  if (!text) return `HTTP ${response.status}`;
  try {
    const parsed = JSON.parse(text);
    const detail = typeof parsed.error === "string" ? parsed.error : typeof parsed.message === "string" ? parsed.message : "";
    return detail || `HTTP ${response.status}`;
  } catch {
    return text.slice(0, 120);
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
  const sleep = opts?.sleep ?? sleepMs;
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
      await sleep(Math.min(intervalMs, remaining));
      continue;
    }
    if (body.error === "slow_down") {
      intervalMs += SLOW_DOWN_INCREMENT_MS;
      await sleep(Math.min(intervalMs, remaining));
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
  if (NATIVE_OAUTH_PROVIDER_IDS.includes(providerId) && accessTokenIsExpiring(cred.access)) return true;
  return false;
}
async function refreshStoredOAuthCredential(providerId, cred) {
  if (!cred.refresh) {
    throw new Error(`${providerId}: OAuth refresh token missing \u2014 run relay-ai providers auth ${providerId}`);
  }
  let tokens;
  if (providerId === "openai" || providerId === "openai-oauth") {
    tokens = await refreshOpenAiAccessToken(cred.refresh);
  } else if (providerId === "xai" || providerId === "xai-oauth") {
    tokens = await refreshXaiAccessToken(cred.refresh);
  } else if (providerId === "github-copilot") {
    tokens = await refreshGithubCopilotToken(cred.refresh);
  } else if (providerId === "claude-code") {
    tokens = await refreshClaudeCodeToken(cred.refresh);
  } else if (providerId === "antigravity") {
    tokens = await refreshAntigravityToken(cred.refresh);
  } else if (providerId === "cline-pass") {
    tokens = await refreshClinePassAccessToken(cred.refresh);
  } else {
    throw new Error(`OAuth refresh not implemented for provider "${providerId}"`);
  }
  const accountId = providerId === "cline-pass" && typeof tokens.providerData?.clineUserId === "string" ? tokens.providerData.clineUserId : cred.accountId;
  return tokensToStoredCredential(tokens, cred.refresh, accountId, cred.providerData);
}

// src/secrets-file.ts
import { chmodSync, existsSync as existsSync2, mkdirSync, readFileSync as readFileSync4, writeFileSync } from "fs";
var DIR_MODE = 448;
var FILE_MODE = 384;
function emptySecrets() {
  return { version: 1, accounts: {} };
}
function readSecretsFile(env = process.env) {
  const path = getSecretsPath(env);
  if (!existsSync2(path)) return emptySecrets();
  try {
    const raw = JSON.parse(readFileSync4(path, "utf8"));
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
  mkdirSync(home, { recursive: true, mode: DIR_MODE });
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
async function readOsKeyringAccount(account, diag) {
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
  if (await writeOsKeyringAccount(account, key, diag)) {
    deleteFileAccount(account);
    return true;
  }
  if (writeFileAccount(account, key)) {
    diag?.("OS keyring unavailable \u2014 saved to secrets.json under RELAY_AI_HOME");
    return true;
  }
  return false;
}
async function deleteKeyringAccount(account, diag) {
  const osOk = await deleteOsKeyringAccount(account, diag);
  const fileOk = deleteFileAccount(account);
  return osOk || fileOk;
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
  const raw = await readKeyringAccount(parsed.account, diag);
  if (!raw || !oauthProviderId) return decodeProviderSecret(raw);
  return refreshOAuthKeyringAccount(parsed.account, oauthProviderId, raw, diag, true);
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
    const cred = parseStoredOAuthCredential(raw);
    if (!cred || !force && !oauthCredentialShouldRefresh(cred, providerId)) {
      return decodeProviderSecret(raw);
    }
    try {
      const refreshed = await refreshStoredOAuthCredential(providerId, cred);
      const json = oauthCredentialToKeychainJson(refreshed);
      await writeKeyringAccount(account, json, diag);
      return refreshed.access;
    } catch (err) {
      diag?.(err instanceof Error ? err.message : String(err));
      if (cred.access && cred.expires > Date.now()) return cred.access;
      throw err;
    }
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

// src/registry/provider-models.ts
var MANUAL_MODEL_PACKAGES = /* @__PURE__ */ new Set([
  "@ai-sdk/openai-compatible",
  "@ai-sdk/openai",
  "@ai-sdk/anthropic",
  "@openrouter/ai-sdk-provider"
]);
function supportsManualModels(provider) {
  return provider.authType !== "oauth" && !["zen", "go", "antigravity"].includes(provider.templateId) && MANUAL_MODEL_PACKAGES.has(provider.api.npm ?? "");
}
function getProviderModels(provider) {
  const models = new Map((provider.modelsCache?.models ?? []).map((model) => [model.id, model]));
  if (supportsManualModels(provider)) {
    for (const model of provider.manualModels ?? []) {
      models.set(model.id, { ...model, modelFormat: provider.api.npm === "@ai-sdk/anthropic" ? "anthropic" : "openai" });
    }
  }
  return [...models.values()];
}
function modelIdError(value) {
  if (typeof value !== "string" || !value.trim()) return "Model ID is required.";
  if (value.trim().length > 512 || /[\s\u0000-\u001f\u007f]/u.test(value.trim())) {
    return "Model ID must be at most 512 characters with no whitespace or control characters.";
  }
}
function contextWindowError(value) {
  if (value !== void 0 && (!Number.isSafeInteger(value) || Number(value) <= 0)) {
    return "Context size must be a positive whole number of tokens, or left blank.";
  }
}
function parseManualModel(raw) {
  if (!raw || typeof raw !== "object") return void 0;
  const m = raw;
  if (modelIdError(m.id) || typeof m.name !== "string" || !m.name.trim() || m.name.length > 200 || m.source !== "manual" || typeof m.validatedAt !== "string" || !Number.isFinite(Date.parse(m.validatedAt)) || contextWindowError(m.contextWindow) || m.modelFormat !== "openai" && m.modelFormat !== "anthropic") return void 0;
  return {
    id: m.id.trim(),
    name: m.name.trim(),
    upstreamModelId: m.id.trim(),
    modelFormat: m.modelFormat,
    source: "manual",
    validatedAt: m.validatedAt,
    ...m.contextWindow === void 0 ? {} : { contextWindow: m.contextWindow, contextWindowSource: "user" }
  };
}

// src/registry/io.ts
import {
  chmodSync as chmodSync2,
  copyFileSync,
  existsSync as existsSync3,
  mkdirSync as mkdirSync2,
  openSync,
  readFileSync as readFileSync5,
  renameSync,
  writeSync,
  closeSync
} from "fs";
import { dirname } from "path";

// src/registry/types.ts
var REGISTRY_SCHEMA_VERSION = 1;

// src/registry/migrate.ts
var LEGACY_CLOUD_PROVIDER_IDS = [
  { legacyId: "opencode", id: "zen", name: "OpenCode Zen" },
  { legacyId: "opencode-go", id: "go", name: "OpenCode Go" }
];
function migrateLegacyCloudProviders(registry) {
  let changed = false;
  for (const { legacyId, id, name } of LEGACY_CLOUD_PROVIDER_IDS) {
    const legacyIdx = registry.providers.findIndex((provider) => provider.id === legacyId);
    if (legacyIdx < 0) continue;
    if (registry.providers.some((provider) => provider.id === id)) {
      registry.providers.splice(legacyIdx, 1);
    } else {
      registry.providers[legacyIdx] = {
        ...registry.providers[legacyIdx],
        id,
        templateId: id,
        name,
        api: {}
      };
    }
    changed = true;
  }
  return changed;
}
function migrateOAuthOpenAiProvider(registry) {
  if (registry.providers.some((p) => p.id === "openai-oauth")) return false;
  const idx = registry.providers.findIndex(
    (p) => p.id === "openai" && p.authType === "oauth"
  );
  if (idx < 0) return false;
  const existing = registry.providers[idx];
  registry.providers[idx] = {
    ...existing,
    id: "openai-oauth",
    templateId: existing.templateId || "openai",
    name: existing.name === "OpenAI" ? "OpenAI (ChatGPT)" : existing.name
  };
  return true;
}
function migrateOAuthXaiProvider(registry) {
  if (registry.providers.some((p) => p.id === "xai-oauth")) return false;
  const idx = registry.providers.findIndex(
    (p) => p.id === "xai" && p.authType === "oauth"
  );
  if (idx < 0) return false;
  const existing = registry.providers[idx];
  registry.providers[idx] = {
    ...existing,
    id: "xai-oauth",
    templateId: existing.templateId || "xai",
    name: existing.name === "xAI" ? "xAI Grok (SuperGrok)" : existing.name
  };
  return true;
}
function migrateAlibabaDashScopeChinaLabel(registry) {
  const provider = registry.providers.find(
    (p) => p.id === "alibaba" && p.templateId === "alibaba" && p.name === "Alibaba DashScope" && p.api.url === "https://dashscope.aliyuncs.com/compatible-mode/v1"
  );
  if (!provider) return false;
  provider.name = "Alibaba DashScope (China)";
  return true;
}

// src/registry/validate.ts
var PROVIDER_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
function isValidProviderId(id) {
  return PROVIDER_ID_PATTERN.test(id);
}
function slugifyProviderId(displayName) {
  const base = displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!base) return "custom-provider";
  if (isValidProviderId(base)) return base;
  const trimmed = base.replace(/^-+|-+$/g, "");
  return isValidProviderId(trimmed) ? trimmed : `custom-${trimmed.slice(0, 40)}`;
}
function customProviderId(displayName) {
  const slug = slugifyProviderId(displayName);
  return slug.startsWith("custom-") ? slug : `custom-${slug}`;
}

// src/registry/io.ts
var DIR_MODE2 = 448;
var FILE_MODE2 = 384;
function ensureSecureAppHome() {
  const home = getAppHome();
  mkdirSync2(home, { recursive: true, mode: DIR_MODE2 });
  try {
    chmodSync2(home, DIR_MODE2);
  } catch {
  }
}
function writeSecureFile(path, content) {
  ensureSecureAppHome();
  mkdirSync2(dirname(path), { recursive: true, mode: DIR_MODE2 });
  const fd = openSync(path, "w", FILE_MODE2);
  try {
    writeSync(fd, content);
  } finally {
    closeSync(fd);
  }
  try {
    chmodSync2(path, FILE_MODE2);
  } catch {
  }
}
function parseProvider(raw) {
  if (!raw || typeof raw !== "object") return null;
  const p = raw;
  if (typeof p.id !== "string" || !isValidProviderId(p.id)) return null;
  if (typeof p.templateId !== "string" || !p.templateId) return null;
  if (typeof p.name !== "string" || !p.name) return null;
  if (typeof p.enabled !== "boolean") return null;
  if (typeof p.authRef !== "string" || !p.authRef) return null;
  if (typeof p.addedAt !== "string" || !p.addedAt) return null;
  const api = p.api;
  if (!api || typeof api !== "object") return null;
  const provider = {
    id: p.id,
    templateId: p.templateId,
    name: p.name,
    enabled: p.enabled,
    authRef: p.authRef,
    api,
    addedAt: p.addedAt
  };
  if (p.subscriptionFilter === "free" || p.subscriptionFilter === "zen" || p.subscriptionFilter === "go") {
    provider.subscriptionFilter = p.subscriptionFilter;
  }
  if (p.authType === "api" || p.authType === "oauth" || p.authType === "none") {
    provider.authType = p.authType;
  }
  if (typeof p.refreshedAt === "string") provider.refreshedAt = p.refreshedAt;
  if (Array.isArray(p.manualModels)) {
    provider.manualModels = p.manualModels.flatMap((raw2) => {
      const model = parseManualModel(raw2);
      return model ? [model] : [];
    });
  }
  if (p.modelsCache && typeof p.modelsCache === "object") {
    const cache = p.modelsCache;
    if (typeof cache.fetchedAt === "string" && Array.isArray(cache.models)) {
      provider.modelsCache = {
        fetchedAt: cache.fetchedAt,
        models: cache.models.filter((m) => m && typeof m === "object")
      };
    }
  }
  return provider;
}
function parseRegistry(raw) {
  const empty = { schemaVersion: REGISTRY_SCHEMA_VERSION, providers: [] };
  if (!raw || typeof raw !== "object") return empty;
  const data = raw;
  const providers = [];
  if (Array.isArray(data.providers)) {
    for (const entry of data.providers) {
      const parsed = parseProvider(entry);
      if (parsed) providers.push(parsed);
    }
  }
  const registry = {
    schemaVersion: typeof data.schemaVersion === "number" ? data.schemaVersion : REGISTRY_SCHEMA_VERSION,
    providers
  };
  if (typeof data.importedAt === "string") registry.importedAt = data.importedAt;
  if (typeof data.pricingCacheAt === "string") registry.pricingCacheAt = data.pricingCacheAt;
  return registry;
}
function loadRegistry(path = getProvidersPath(), { persist = true } = {}) {
  if (!existsSync3(path)) {
    return { schemaVersion: REGISTRY_SCHEMA_VERSION, providers: [] };
  }
  try {
    const raw = JSON.parse(readFileSync5(path, "utf8"));
    const registry = parseRegistry(raw);
    let migrated = migrateLegacyCloudProviders(registry);
    if (migrateOAuthOpenAiProvider(registry)) migrated = true;
    if (migrateOAuthXaiProvider(registry)) migrated = true;
    if (migrateAlibabaDashScopeChinaLabel(registry)) migrated = true;
    if (migrated && persist) {
      try {
        saveRegistry(registry, path);
      } catch {
      }
    }
    return registry;
  } catch {
    return { schemaVersion: REGISTRY_SCHEMA_VERSION, providers: [] };
  }
}
function saveRegistry(registry, path = getProvidersPath()) {
  const payload = `${JSON.stringify(registry, null, 2)}
`;
  const backup = `${path}.bak`;
  if (existsSync3(path)) {
    try {
      copyFileSync(path, backup);
    } catch {
    }
  }
  const tmp = `${path}.tmp`;
  writeSecureFile(tmp, payload);
  renameSync(tmp, path);
}

// src/registry/url-security.ts
import { lookup } from "dns/promises";
import ipaddr from "ipaddr.js";
var BLOCKED_HOSTNAMES = /* @__PURE__ */ new Set([
  "169.254.169.254",
  "metadata.google.internal",
  "169.254.170.2",
  "fd00:ec2::254"
]);
function isBlockedIp(ipStr, allowInsecureLocal) {
  try {
    const ip = ipaddr.process(ipStr);
    const range = ip.range();
    if (allowInsecureLocal && (range === "loopback" || range === "private")) {
      return false;
    }
    if (range === "loopback") return true;
    if (range === "private") return true;
    if (range === "linkLocal") return true;
    if (range === "uniqueLocal") return true;
    if (range === "carrierGradeNat") return true;
    return false;
  } catch {
    return true;
  }
}
async function resolveHostAddresses(hostname) {
  try {
    ipaddr.parse(hostname);
    return [hostname];
  } catch {
  }
  try {
    const records = await lookup(hostname, { all: true, verbatim: true });
    return records.map((r) => r.address);
  } catch {
    return [];
  }
}
async function validateCustomEndpointUrl(rawUrl, opts = {}) {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { ok: false, error: "Base URL is required.", hint: "Example: https://api.example.com/v1" };
  }
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "Invalid URL.", hint: "Include https:// and the full base path." };
  }
  const allowLocal = opts.allowInsecureLocal === true;
  if (parsed.protocol === "http:" && !allowLocal) {
    return {
      ok: false,
      error: "Only HTTPS URLs are allowed.",
      hint: "For local or LAN servers (Ollama, LM Studio, vLLM), allow insecure HTTP when prompted."
    };
  } else if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "URL must use https:// or user-approved http:// for local/LAN servers." };
  }
  const rawHostname = parsed.hostname.toLowerCase();
  const hostname = rawHostname.replace(/^\[(.*)\]$/, "$1");
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return {
      ok: false,
      error: "This URL points to a blocked internal/metadata host.",
      hint: "Use a public API endpoint for your provider."
    };
  }
  const addresses = await resolveHostAddresses(hostname);
  if (addresses.length === 0) {
    return {
      ok: false,
      error: `Could not resolve hostname: ${hostname}`,
      hint: "Check the URL spelling and your network connection."
    };
  }
  for (const addr of addresses) {
    try {
      ipaddr.process(addr);
    } catch {
      continue;
    }
    if (isBlockedIp(addr, allowLocal)) {
      return {
        ok: false,
        error: "URL resolves to a private or restricted network address.",
        hint: "Use a public HTTPS endpoint, or explicitly allow insecure HTTP for a trusted local/LAN server."
      };
    }
  }
  if (parsed.protocol === "http:") {
    const allResolvedAddressesAreLocal = addresses.every((addr) => {
      try {
        const range = ipaddr.process(addr).range();
        return range === "loopback" || range === "private" || range === "uniqueLocal";
      } catch {
        return false;
      }
    });
    if (!allowLocal || !allResolvedAddressesAreLocal) {
      return {
        ok: false,
        error: "HTTP is only allowed for local loopback or private-network addresses.",
        hint: "Use https://, or allow insecure HTTP for a trusted local/LAN server."
      };
    }
  }
  const normalizedUrl = `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(/\/$/, "");
  return { ok: true, normalizedUrl };
}

// src/oauth/claude-identity.ts
import { createHash, randomUUID } from "crypto";
var CLAUDE_CODE_CLI_VERSION2 = "2.1.195";
var CLAUDE_CODE_USER_AGENT = `claude-cli/${CLAUDE_CODE_CLI_VERSION2} (external, cli)`;
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
  return `${CLAUDE_CODE_BILLING_HEADER_PREFIX} cc_version=${CLAUDE_CODE_CLI_VERSION2}.0; cc_entrypoint=${CLAUDE_CODE_ENTRYPOINT};`;
}
function systemBlockText(block) {
  if (typeof block === "string") return block;
  if (block && typeof block === "object" && "text" in block) {
    const text = block.text;
    return typeof text === "string" ? text : void 0;
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

// src/provider-factory.ts
import { wrapLanguageModel, extractReasoningMiddleware } from "ai";

// src/oauth/responses-websocket.ts
var RESPONSES_LITE_HEADER = "x-openai-internal-codex-responses-lite";
var TERMINAL_EVENT_TYPES = /* @__PURE__ */ new Set(["response.completed", "response.failed", "response.incomplete", "error"]);
function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function recordKeys(value) {
  return isRecord(value) ? Object.keys(value).sort().join(",") : "";
}
function summarizeResponsesLiteEvent(event) {
  if (!isRecord(event)) return `kind=${event == null ? "null" : typeof event}`;
  const parts = [`type=${typeof event.type === "string" ? event.type : "unknown"}`, `keys=${recordKeys(event)}`];
  if (typeof event.delta === "string") parts.push(`deltaChars=${event.delta.length}`);
  if (typeof event.output_index === "number") parts.push(`hasOutputIndex=1`);
  if (typeof event.item_id === "string") parts.push(`hasItemId=1`);
  if (isRecord(event.item)) {
    parts.push(`itemType=${typeof event.item.type === "string" ? event.item.type : "unknown"}`);
    parts.push(`itemKeys=${recordKeys(event.item)}`);
    if (typeof event.item.arguments === "string") parts.push(`argumentsChars=${event.item.arguments.length}`);
  }
  if (isRecord(event.response)) {
    parts.push(`responseKeys=${recordKeys(event.response)}`);
    if (Array.isArray(event.response.output)) {
      parts.push(`outputCount=${event.response.output.length}`);
      parts.push(`outputTypes=${event.response.output.map((item) => isRecord(item) && typeof item.type === "string" ? item.type : "unknown").join(",")}`);
    }
    if (isRecord(event.response.usage)) parts.push(`usageKeys=${recordKeys(event.response.usage)}`);
    if (typeof event.response.status === "string") parts.push(`status=${event.response.status}`);
  }
  if (isRecord(event.error)) {
    parts.push(`errorKeys=${recordKeys(event.error)}`);
    if (typeof event.error.message === "string") parts.push(`messageChars=${event.error.message.length}`);
  }
  return parts.join(" ");
}
function createResponsesLiteNormalizeState() {
  return {
    nextId: 1,
    lastOutputIndex: 0,
    textDeltaForwarded: false,
    messageAddedIds: /* @__PURE__ */ new Set(),
    messageDoneIds: /* @__PURE__ */ new Set(),
    functionCalls: []
  };
}
function nextId(state, prefix) {
  const id = `${prefix}_${state.nextId}`;
  state.nextId += 1;
  return id;
}
function asString(value) {
  return typeof value === "string" && value.length > 0 ? value : void 0;
}
function normalizeErrorEvent(event) {
  const raw = isRecord(event.error) ? event.error : { message: typeof event.error === "string" ? event.error : "upstream error" };
  return {
    type: "error",
    sequence_number: typeof event.sequence_number === "number" ? event.sequence_number : 0,
    error: {
      type: asString(raw.type) ?? "server_error",
      code: asString(raw.code) ?? "unknown",
      message: asString(raw.message) ?? "upstream error",
      ...raw.param == null ? {} : { param: raw.param }
    }
  };
}
function resolveFunctionCall(state, hint) {
  if (hint.callId) {
    const byCallId = state.functionCalls.find((entry2) => entry2.callId === hint.callId);
    if (byCallId) return byCallId;
  }
  if (hint.itemId) {
    const byItemId = state.functionCalls.find((entry2) => entry2.itemId === hint.itemId);
    if (byItemId) return byItemId;
  }
  if (hint.outputIndex !== void 0) {
    const open3 = [...state.functionCalls].reverse().find((entry2) => entry2.outputIndex === hint.outputIndex && !entry2.done && !(hint.callId && entry2.callId !== hint.callId));
    if (open3) return open3;
  }
  if (hint.callId === void 0 && hint.itemId === void 0 && hint.outputIndex === void 0 && state.lastFunctionCall) {
    return state.lastFunctionCall;
  }
  const entry = {
    itemId: hint.itemId ?? nextId(state, "fc"),
    callId: hint.callId ?? hint.itemId ?? nextId(state, "call"),
    name: "",
    args: "",
    upstream: {},
    outputIndex: hint.outputIndex ?? state.lastOutputIndex,
    added: false,
    deltaForwarded: false,
    doneSeen: false,
    done: false
  };
  state.functionCalls.push(entry);
  return entry;
}
function absorbFunctionItem(entry, item, authoritative) {
  entry.upstream = { ...entry.upstream, ...item };
  const name = asString(item.name);
  if (name) entry.name = name;
  const callId = asString(item.call_id);
  if (callId) entry.callId = callId;
  if (authoritative && typeof item.arguments === "string") entry.upstreamArgs = item.arguments;
}
function resolveFunctionArgs(entry) {
  if (entry.upstreamArgs) return entry.upstreamArgs;
  if (entry.args) return entry.args;
  return entry.upstreamArgs;
}
function functionItemPayload(entry, extra) {
  return {
    ...entry.upstream,
    type: "function_call",
    id: entry.itemId,
    call_id: entry.callId,
    name: entry.name,
    ...extra
  };
}
function functionAddedEvent(entry) {
  entry.added = true;
  return {
    type: "response.output_item.added",
    output_index: entry.outputIndex,
    item: functionItemPayload(entry, { arguments: "" })
  };
}
function functionDoneEvent(entry, args) {
  entry.done = true;
  return {
    type: "response.output_item.done",
    output_index: entry.outputIndex,
    item: functionItemPayload(entry, { arguments: args, status: "completed" })
  };
}
function completeFunctionCall(entry, args) {
  if (entry.done) return [];
  const events = [];
  if (!entry.added) events.push(functionAddedEvent(entry));
  if (!entry.deltaForwarded && args.length > 0) {
    entry.deltaForwarded = true;
    events.push({
      type: "response.function_call_arguments.delta",
      item_id: entry.itemId,
      output_index: entry.outputIndex,
      delta: args
    });
  }
  events.push(functionDoneEvent(entry, args));
  return events;
}
function messageText(item) {
  if (typeof item.text === "string") return item.text;
  if (!Array.isArray(item.content)) return "";
  let out = "";
  for (const part of item.content) {
    if (isRecord(part) && typeof part.text === "string" && (part.type === "output_text" || part.type === "text")) {
      out += part.text;
    }
  }
  return out;
}
function synthesizeMessage(item, outputIndex, state) {
  const text = messageText(item);
  if (!text) return [];
  const id = asString(item.id) ?? nextId(state, "msg");
  state.lastMessageItemId = id;
  state.textDeltaForwarded = true;
  state.messageAddedIds.add(id);
  state.messageDoneIds.add(id);
  return [
    { type: "response.output_item.added", output_index: outputIndex, item: { type: "message", id } },
    { type: "response.output_text.delta", item_id: id, delta: text },
    { type: "response.output_item.done", output_index: outputIndex, item: { type: "message", id } }
  ];
}
function synthesizeFunctionCall(item, outputIndex, state) {
  const entry = resolveFunctionCall(state, {
    itemId: asString(item.id),
    callId: asString(item.call_id),
    outputIndex
  });
  absorbFunctionItem(entry, item, true);
  state.lastFunctionCall = entry;
  state.lastOutputIndex = entry.outputIndex;
  const args = resolveFunctionArgs(entry);
  if (args === void 0) {
    entry.doneSeen = true;
    return [];
  }
  return completeFunctionCall(entry, args);
}
function recoverFromCompletedOutput(response, state) {
  const recovered = [];
  if (Array.isArray(response.output)) {
    response.output.forEach((item, index) => {
      if (!isRecord(item) || typeof item.type !== "string") return;
      if (item.type === "message" && !state.textDeltaForwarded) {
        recovered.push(...synthesizeMessage(item, index, state));
      } else if (item.type === "function_call") {
        recovered.push(...synthesizeFunctionCall(item, index, state));
      }
    });
  }
  for (const entry of state.functionCalls) {
    if (entry.done || !entry.doneSeen) continue;
    recovered.push(normalizeErrorEvent({
      error: {
        type: "invalid_response",
        code: "incomplete_function_call",
        message: `Provider ended the response without arguments for function call "${entry.callId}"${entry.name ? ` (${entry.name})` : ""}.`
      }
    }));
  }
  return recovered;
}
function normalizeResponsesLiteEvent(event, state) {
  if (!isRecord(event) || typeof event.type !== "string") return [event];
  if (event.type === "error") return [normalizeErrorEvent(event)];
  if (event.type === "response.output_item.added" && isRecord(event.item)) {
    const outputIndex = typeof event.output_index === "number" ? event.output_index : state.lastOutputIndex;
    state.lastOutputIndex = outputIndex;
    if (event.item.type === "message") {
      const id = asString(event.item.id) ?? nextId(state, "msg");
      state.lastMessageItemId = id;
      state.messageAddedIds.add(id);
      return [{ ...event, output_index: outputIndex, item: { ...event.item, id } }];
    }
    if (event.item.type === "function_call") {
      const entry = resolveFunctionCall(state, {
        itemId: asString(event.item.id),
        callId: asString(event.item.call_id),
        outputIndex
      });
      absorbFunctionItem(entry, event.item, false);
      entry.outputIndex = outputIndex;
      entry.added = true;
      state.lastFunctionCall = entry;
      return [{ ...event, output_index: outputIndex, item: functionItemPayload(entry, { arguments: "" }) }];
    }
    return [{ ...event, output_index: outputIndex }];
  }
  if (event.type === "response.output_item.done" && isRecord(event.item)) {
    const outputIndex = typeof event.output_index === "number" ? event.output_index : state.lastOutputIndex;
    if (event.item.type === "function_call") {
      const entry = resolveFunctionCall(state, {
        itemId: asString(event.item.id),
        callId: asString(event.item.call_id),
        outputIndex
      });
      absorbFunctionItem(entry, event.item, true);
      entry.outputIndex = outputIndex;
      entry.doneSeen = true;
      state.lastFunctionCall = entry;
      state.lastOutputIndex = outputIndex;
      const args = resolveFunctionArgs(entry);
      if (args === void 0 || !entry.name) return [];
      if (entry.done) return [];
      const events = [];
      if (!entry.added) events.push(functionAddedEvent(entry));
      events.push({ ...event, output_index: outputIndex, item: functionItemPayload(entry, { arguments: args, status: "completed" }) });
      entry.done = true;
      return events;
    }
    if (event.item.type === "message") {
      const id = asString(event.item.id) ?? state.lastMessageItemId ?? nextId(state, "msg");
      state.lastMessageItemId = id;
      state.messageDoneIds.add(id);
      return [{ ...event, output_index: outputIndex, item: { ...event.item, id } }];
    }
    return [{ ...event, output_index: outputIndex }];
  }
  if (event.type === "response.output_text.delta") {
    const itemId = asString(event.item_id) ?? state.lastMessageItemId ?? nextId(state, "msg");
    state.lastMessageItemId = itemId;
    state.textDeltaForwarded = true;
    const events = [];
    if (!state.messageAddedIds.has(itemId)) {
      events.push({
        type: "response.output_item.added",
        output_index: state.lastOutputIndex,
        item: { type: "message", id: itemId }
      });
      state.messageAddedIds.add(itemId);
    }
    events.push({ ...event, item_id: itemId, delta: typeof event.delta === "string" ? event.delta : "" });
    return events;
  }
  if (event.type === "response.function_call_arguments.delta") {
    const entry = resolveFunctionCall(state, {
      itemId: asString(event.item_id),
      outputIndex: typeof event.output_index === "number" ? event.output_index : void 0
    });
    const delta = typeof event.delta === "string" ? event.delta : "";
    entry.args += delta;
    entry.deltaForwarded = true;
    state.lastFunctionCall = entry;
    state.lastOutputIndex = entry.outputIndex;
    return [{ ...event, item_id: entry.itemId, output_index: entry.outputIndex, delta }];
  }
  if (event.type === "response.completed" || event.type === "response.incomplete") {
    const response = isRecord(event.response) ? event.response : {};
    const recovered = recoverFromCompletedOutput(response, state);
    if (state.lastMessageItemId && state.textDeltaForwarded && !state.messageDoneIds.has(state.lastMessageItemId)) {
      recovered.push({
        type: "response.output_item.done",
        output_index: state.lastOutputIndex,
        item: { type: "message", id: state.lastMessageItemId }
      });
      state.messageDoneIds.add(state.lastMessageItemId);
    }
    return [...recovered, event];
  }
  return [event];
}
function toHeaderRecord(headers) {
  const out = {};
  if (!headers) return out;
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      out[key] = value;
    });
  } else if (Array.isArray(headers)) {
    for (const [key, value] of headers) out[key] = value;
  } else {
    for (const [key, value] of Object.entries(headers)) out[key] = String(value);
  }
  return out;
}
function hasResponsesLiteHeader(headers) {
  return Object.entries(headers).some(
    ([k, v]) => k.toLowerCase() === RESPONSES_LITE_HEADER && v.toLowerCase() === "true"
  );
}
function bodyToString(body) {
  if (body == null) return "";
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return Buffer.from(body).toString("utf8");
  if (body instanceof ArrayBuffer) return Buffer.from(new Uint8Array(body)).toString("utf8");
  return String(body);
}
function applyResponsesLiteShape(payload) {
  const reasoning = payload.reasoning && typeof payload.reasoning === "object" ? { ...payload.reasoning } : {};
  reasoning.context = "all_turns";
  return {
    ...payload,
    reasoning,
    parallel_tool_calls: false,
    store: false
  };
}
function createResponsesWebSocketFetch(wsUrl, log) {
  const debug = (msg) => {
    try {
      log?.(`ws: ${msg}`);
    } catch {
    }
  };
  return async (_input, init) => {
    const { WebSocket } = await import("ws");
    const headers = toHeaderRecord(init?.headers);
    headers["OpenAI-Beta"] = CODEX_RESPONSES_WEBSOCKETS_BETA;
    debug(`connecting ${wsUrl} headers=[${Object.keys(headers).join(", ")}]`);
    let payload = {};
    try {
      payload = JSON.parse(bodyToString(init?.body));
    } catch {
      payload = {};
    }
    if (hasResponsesLiteHeader(headers)) {
      payload = applyResponsesLiteShape(payload);
    }
    debug(
      `request type=response.create keys=${Object.keys(payload).sort().join(",")} toolCount=${Array.isArray(payload.tools) ? payload.tools.length : 0} store=${String(payload.store)} parallelToolCalls=${String(payload.parallel_tool_calls)} reasoningKeys=${recordKeys(payload.reasoning)}`
    );
    const outgoing = JSON.stringify({ type: "response.create", ...payload });
    const encoder = new TextEncoder();
    let socket;
    let frameCount = 0;
    const normalizeState = createResponsesLiteNormalizeState();
    const stream = new ReadableStream({
      start(controller) {
        let closed = false;
        const close = () => {
          if (closed) return;
          closed = true;
          try {
            controller.close();
          } catch {
          }
          try {
            socket.close();
          } catch {
          }
        };
        const fail = (message) => {
          if (closed) return;
          debug(`fail messageChars=${message.length}`);
          try {
            const [errorEvent] = normalizeResponsesLiteEvent({ type: "error", error: { message } }, normalizeState);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorEvent)}

`));
          } catch {
          }
          close();
        };
        socket = new WebSocket(wsUrl, { headers });
        socket.on("open", () => {
          debug(`open \u2014 sending ${outgoing.length}B payload`);
          socket.send(outgoing);
        });
        socket.on("unexpected-response", (_req, res) => {
          debug(`unexpected-response status=${res.statusCode}`);
        });
        socket.on("message", (data) => {
          const text = Array.isArray(data) ? Buffer.concat(data).toString("utf8") : data.toString("utf8");
          frameCount += 1;
          let event;
          try {
            event = JSON.parse(text);
          } catch {
            debug(`frame#${frameCount} non-json chars=${text.length}`);
            controller.enqueue(encoder.encode(`data: ${text.replace(/\r?\n/g, " ")}

`));
            return;
          }
          if (frameCount <= 8) debug(`frame#${frameCount} ${summarizeResponsesLiteEvent(event)}`);
          for (const next of normalizeResponsesLiteEvent(event, normalizeState)) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(next)}

`));
          }
          const type = isRecord(event) && typeof event.type === "string" ? event.type : void 0;
          if (type && TERMINAL_EVENT_TYPES.has(type)) {
            debug(`terminal event: ${type} (after ${frameCount} frames)`);
            close();
          }
        });
        socket.on("error", (err) => fail(err.message));
        socket.on("close", (code, reason) => {
          debug(`close code=${code} frames=${frameCount}${reason?.length ? ` reasonChars=${reason.length}` : ""}`);
          if (closed) return;
          if (code === 1e3 || code === 1005) {
            close();
            return;
          }
          fail(`WebSocket closed (${code})${reason?.length ? `: ${reason.toString("utf8")}` : ""}`);
        });
        const signal = init?.signal;
        if (signal) {
          if (signal.aborted) {
            close();
            return;
          }
          signal.addEventListener("abort", close, { once: true });
        }
      },
      cancel() {
        try {
          socket?.close();
        } catch {
        }
      }
    });
    return new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream; charset=utf-8" }
    });
  };
}

// src/provider-factory.ts
var RESPONSES_ONLY_PREFIXES = [
  "gpt-5-codex",
  "gpt-5-pro",
  "gpt-5.2-pro",
  "o3",
  "o4"
];
var factoryCache = /* @__PURE__ */ new Map();
function modelPrefersResponsesApi(modelId) {
  const lower = modelId.toLowerCase();
  if (RESPONSES_ONLY_PREFIXES.some((prefix) => lower === prefix || lower.startsWith(`${prefix}-`))) {
    return true;
  }
  const gpt5Minor = lower.match(/^gpt-5\.(\d+)(?:-|$)/);
  if (gpt5Minor && Number(gpt5Minor[1]) >= 4) return true;
  if (lower.startsWith("gpt-") && lower.includes("-codex")) return true;
  if (lower.startsWith("grok-") && (lower.includes("multi-agent") || lower.includes("multiagent"))) return true;
  return false;
}
var OPENAI_CHAT_COMPLETIONS_ONLY = [
  "davinci-002",
  "babbage-002",
  "gpt-3.5-turbo-instruct"
];
function shouldUseOpenAiResponsesEndpoint(modelId) {
  return !OPENAI_CHAT_COMPLETIONS_ONLY.includes(modelId.toLowerCase());
}
function isSdkMigratedNpm(npm) {
  return !!npm && npm !== "@ai-sdk/anthropic";
}
function maxToolsForNpm(npm) {
  return npm === "@ai-sdk/groq" ? 128 : void 0;
}
function resolveProviderNpm(npm) {
  return npm === "venice-ai-sdk-provider" ? "@ai-sdk/openai-compatible" : npm;
}
function findCreateFactory(mod) {
  for (const value of Object.values(mod)) {
    if (typeof value === "function" && value.name.startsWith("create")) {
      return value;
    }
  }
  throw new Error("No create* factory export found in provider package");
}
async function loadSdkProviderFactory(npm) {
  let cached = factoryCache.get(npm);
  if (!cached) {
    cached = (async () => {
      try {
        const mod = await import(npm);
        return findCreateFactory(mod);
      } catch (err) {
        const code = err && typeof err === "object" && "code" in err ? err.code : void 0;
        if (code === "ERR_MODULE_NOT_FOUND") {
          throw new Error(`SDK provider package not installed: ${npm}. Run: npm install ${npm}`);
        }
        throw err;
      }
    })();
    factoryCache.set(npm, cached);
    cached.catch(() => factoryCache.delete(npm));
  }
  return cached;
}
async function createLanguageModel(spec) {
  const npm = resolveProviderNpm(spec.npm);
  const { modelId, apiKey, baseURL } = spec;
  if (npm === VERTEX_ANTHROPIC_NPM) {
    if (!spec.vertex?.project) {
      throw new Error("Vertex project is required for @ai-sdk/google-vertex/anthropic");
    }
    const { createVertexAnthropic } = await import("@ai-sdk/google-vertex/anthropic");
    const vertex = createVertexAnthropic({
      project: spec.vertex.project,
      location: spec.vertex.location
    });
    return vertex(modelId);
  }
  if (npm === "@ai-sdk/openai") {
    const { createOpenAI } = await import("@ai-sdk/openai");
    const accountId = spec.authType === "oauth" ? spec.oauthAccountId ?? extractOpenAiAccountId({ access_token: apiKey }) : void 0;
    const oauthOptions = spec.authType === "oauth" ? {
      apiKey,
      baseURL: "https://chatgpt.com/backend-api/codex",
      headers: {
        ...accountId ? { "ChatGPT-Account-Id": accountId } : {},
        originator: "relay-ai",
        // Responses-Lite models (backend prefer_websockets/use_responses_lite,
        // e.g. gpt-5.6-luna) require these on the request.
        ...spec.useResponsesLite ? { version: CODEX_RESPONSES_LITE_VERSION, "x-openai-internal-codex-responses-lite": "true" } : {}
      },
      // Models the backend flags with prefer_websockets are only served over
      // the WebSocket Responses transport, not HTTP.
      ...spec.preferWebSockets ? { fetch: createResponsesWebSocketFetch(CODEX_RESPONSES_LITE_WS_URL, spec.onDebug) } : {}
    } : { apiKey };
    const openai = createOpenAI(oauthOptions);
    return shouldUseOpenAiResponsesEndpoint(modelId) ? openai.responses(modelId) : openai.chat(modelId);
  }
  if (npm === "@ai-sdk/xai") {
    const { createXai } = await import("@ai-sdk/xai");
    const xai = createXai({ apiKey });
    return modelPrefersResponsesApi(modelId) ? xai.responses(modelId) : xai(modelId);
  }
  if (npm === "@ai-sdk/google") {
    const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
    const google = createGoogleGenerativeAI({ apiKey });
    return google(modelId);
  }
  if (npm === "@ai-sdk/anthropic") {
    const { createAnthropic } = await import("@ai-sdk/anthropic");
    const root = baseURL?.replace(/\/v1\/?$/, "").replace(/\/$/, "");
    const anthropicOptions = spec.authType === "oauth" ? {
      authToken: apiKey,
      ...spec.providerId === "claude-code" ? {
        headers: {
          "User-Agent": CLAUDE_CODE_USER_AGENT,
          "x-app": "cli",
          "X-Claude-Code-Session-Id": injectClaudeIdentity(
            {},
            spec.providerData,
            spec.oauthAccountId ?? apiKey
          ).sessionId
        }
      } : {}
    } : { apiKey };
    if (spec.headers) {
      anthropicOptions.headers = { ...anthropicOptions.headers, ...spec.headers };
    }
    if (!root || root === "https://api.anthropic.com") {
      return createAnthropic(anthropicOptions)(modelId);
    }
    const sdkBase = baseURL.endsWith("/v1") ? baseURL : `${root}/v1`;
    return createAnthropic({ ...anthropicOptions, baseURL: sdkBase })(modelId);
  }
  let model;
  if (npm === "@ai-sdk/openai-compatible") {
    const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
    const runtimeApiKey = formatClineRuntimeCredential(spec.providerId, spec.authType, apiKey);
    const options = {
      name: spec.providerId ?? "openai-compatible",
      baseURL: baseURL ?? "",
      ...runtimeApiKey.trim() ? { apiKey: runtimeApiKey } : {},
      ...spec.headers ? { headers: spec.headers } : {},
      ...isClinePassOAuth(spec.providerId, spec.authType) && spec.refreshToken ? {
        fetch: createClinePassOAuthFetch(
          runtimeApiKey,
          spec.refreshToken,
          spec.onTokenRefreshed
        )
      } : {}
    };
    model = createOpenAICompatible({
      ...options
    })(modelId);
  } else if (npm === "@openrouter/ai-sdk-provider") {
    const { createOpenRouter } = await import("@openrouter/ai-sdk-provider");
    model = createOpenRouter({ apiKey, baseURL, ...spec.headers ? { headers: spec.headers } : {} })(modelId);
  } else {
    const create = await loadSdkProviderFactory(npm);
    const provider = create({
      apiKey,
      ...baseURL ? { baseURL } : {},
      ...spec.headers ? { headers: spec.headers } : {}
    });
    model = provider(modelId);
  }
  const isReasoning = modelId.toLowerCase().match(/deepseek-r1|think|reasoning|qwq/);
  if (isReasoning) {
    return wrapLanguageModel({
      model,
      middleware: [extractReasoningMiddleware({ tagName: "think" })]
    });
  }
  return model;
}
var ANTHROPIC_EFFORT_LEVELS = ["low", "medium", "high"];
var OPENAI_EFFORT_LEVELS = ["low", "medium", "high"];
var GEMINI_EFFORT_LEVELS = ["low", "medium", "high"];
var MISTRAL_EFFORT_LEVELS = ["high", "off"];
var XAI_CHAT_EFFORT_LEVELS = ["low", "high"];
var XAI_RESPONSES_EFFORT_LEVELS = ["low", "medium", "high"];
var OPENROUTER_EFFORT_LEVELS = ["none", "minimal", "low", "medium", "high", "xhigh"];
var DEEPSEEK_EFFORT_LEVELS = ["high", "max", "off"];
var GLM_52_EFFORT_LEVELS = ["high", "xhigh"];
var EMPTY_REASONING = {
  levels: [],
  defaultLevel: "",
  supportsSummaries: false,
  mode: "none",
  source: "none",
  confidence: "inferred"
};
var EFFORT_DESCRIPTIONS = {
  off: "Turn off extended reasoning",
  none: "No reasoning",
  minimal: "Minimal reasoning",
  low: "Light reasoning",
  medium: "Balanced reasoning",
  high: "Deep reasoning",
  xhigh: "Maximum reasoning",
  max: "Maximum effort"
};
var GEMINI_25_BUDGETS = {
  low: 1024,
  medium: 4096,
  high: 8192,
  xhigh: 16384,
  max: 16384,
  minimal: 512,
  none: 0
};
function isClaudeReasoningModel(modelId) {
  const lower = modelId.toLowerCase();
  if (!lower.startsWith("claude-")) return false;
  if (lower.includes("fable") || lower.includes("mythos")) return true;
  const m = lower.match(/claude-(?:opus|sonnet|haiku)-(\d+)-(\d+)/);
  if (!m) return false;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  return major > 4 || major === 4 && minor >= 6;
}
function isGeminiReasoningModel(modelId) {
  const lower = modelId.toLowerCase();
  return lower.startsWith("gemini-2.5-") || lower.startsWith("gemini-3") || lower.startsWith("gemini-3.");
}
function isGemini3Model(modelId) {
  const lower = modelId.toLowerCase();
  return lower.startsWith("gemini-3") || lower.startsWith("gemini-3.");
}
function isMistralReasoningModel(modelId) {
  const lower = modelId.toLowerCase();
  return lower.startsWith("mistral-") || lower.startsWith("magistral-") || lower.startsWith("ministral-") || lower.includes("reasoning");
}
function isXaiReasoningEffortModel(modelId) {
  const lower = modelId.toLowerCase();
  if (lower.includes("non-reasoning")) return false;
  if (lower.startsWith("grok-build")) return false;
  if (lower.startsWith("grok-imagine")) return false;
  if (modelPrefersResponsesApi(modelId)) return true;
  if (lower === "grok-4.3" || lower.startsWith("grok-4.3-")) return true;
  if (lower === "grok-4.5" || lower.startsWith("grok-4.5-")) return true;
  if (lower.includes("-reasoning")) return true;
  return false;
}
function xaiDefaultReasoningEffort(modelId) {
  const lower = modelId.toLowerCase();
  if (lower === "grok-4.5" || lower.startsWith("grok-4.5-")) return "high";
  return "low";
}
function isDeepSeekReasoningModel(modelId) {
  const lower = modelId.toLowerCase();
  return lower === "deepseek-v4-flash" || lower === "deepseek-v4-pro" || lower.startsWith("deepseek-v4-flash-") || lower.startsWith("deepseek-v4-pro-") || lower === "deepseek-reasoner" || lower === "deepseek-chat";
}
function isKimiReasoningModel(modelId) {
  const lower = modelId.toLowerCase();
  return lower.startsWith("kimi-");
}
function isGlm52ReasoningModel(modelId) {
  const lower = modelId.toLowerCase();
  return lower === "glm-5.2" || lower === "z-ai/glm-5.2" || lower === "zai/glm-5.2" || lower === "zai-org/glm-5.2" || lower === "zai-org/glm5.2" || lower === "glm5.2";
}
function toCamelCase(str) {
  return str.replace(/[-_]([a-z])/g, (_, g) => g.toUpperCase());
}
function hasSupportedParameter(metadata, param) {
  return (metadata?.supportedParameters ?? []).some((p) => p === param);
}
function isOpenRouterRoute(npm, metadata) {
  return npm === "@openrouter/ai-sdk-provider" || metadata?.providerId === "openrouter" || metadata?.apiBaseUrl?.includes("openrouter.ai") === true;
}
function openRouterReasoningCapabilities(metadata) {
  if (metadata?.supportedParameters && !hasSupportedParameter(metadata, "reasoning")) {
    return {
      ...EMPTY_REASONING,
      source: "provider-metadata",
      confidence: "documented"
    };
  }
  if (hasSupportedParameter(metadata, "reasoning")) {
    return {
      levels: [...OPENROUTER_EFFORT_LEVELS],
      defaultLevel: "medium",
      supportsSummaries: false,
      mode: "controllable",
      source: "provider-metadata",
      confidence: "documented",
      wireFormat: { kind: "openrouter-reasoning" }
    };
  }
  if (metadata?.reasoning) {
    return {
      ...EMPTY_REASONING,
      mode: "internal-only",
      source: "model-metadata",
      confidence: "inferred"
    };
  }
  return EMPTY_REASONING;
}
function mapCodexEffortToDeepSeek(effort) {
  switch (effort) {
    case "off":
    case "none":
      return "off";
    case "low":
    case "medium":
    case "high":
      return "high";
    case "xhigh":
    case "max":
      return "max";
    default:
      if (effort === "high" || effort === "max") return effort;
      return void 0;
  }
}
function deepSeekEffortProviderOptions(effort) {
  const mapped = mapCodexEffortToDeepSeek(effort);
  if (!mapped) return void 0;
  const thinking = { type: mapped === "off" ? "disabled" : "enabled" };
  const spread = { thinking };
  if (mapped === "off") {
    return {
      deepseek: spread,
      openaiCompatible: spread
    };
  }
  return {
    openaiCompatible: { reasoningEffort: mapped, ...spread },
    deepseek: spread
  };
}
function mapCodexEffortToAnthropic(effort) {
  switch (effort) {
    case "none":
    case "minimal":
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
    case "xhigh":
    case "max":
      return effort === "xhigh" ? "high" : effort === "max" ? "max" : "high";
    default:
      if (ANTHROPIC_EFFORT_LEVELS.includes(effort)) {
        return effort;
      }
      return void 0;
  }
}
var OPENAI_MODEL_REASONING = {
  "gpt-5-pro": { levels: ["high"], defaultLevel: "high" },
  "gpt-5.1": { levels: ["none", "low", "medium", "high"], defaultLevel: "none" },
  "gpt-5.1-codex-max": { levels: ["low", "medium", "high", "xhigh"], defaultLevel: "medium" },
  "gpt-5.2": { levels: ["none", "low", "medium", "high", "xhigh"], defaultLevel: "none" },
  "gpt-5.2-codex": { levels: ["low", "medium", "high", "xhigh"], defaultLevel: "medium" },
  "gpt-5.2-pro": { levels: ["medium", "high", "xhigh"], defaultLevel: "medium" },
  "gpt-5.3-codex": { levels: ["low", "medium", "high", "xhigh"], defaultLevel: "medium" },
  "gpt-5.4": { levels: ["none", "low", "medium", "high", "xhigh"], defaultLevel: "none" },
  "gpt-5.4-mini": { levels: ["none", "low", "medium", "high", "xhigh"], defaultLevel: "none" },
  "gpt-5.4-nano": { levels: ["none", "low", "medium", "high", "xhigh"], defaultLevel: "none" },
  "gpt-5.4-pro": { levels: ["medium", "high", "xhigh"], defaultLevel: "medium" },
  "gpt-5.5": { levels: ["none", "low", "medium", "high", "xhigh"], defaultLevel: "medium" },
  "gpt-5.5-pro": { levels: ["medium", "high", "xhigh"], defaultLevel: "high" },
  "gpt-5.6": { levels: ["none", "low", "medium", "high", "xhigh", "max"], defaultLevel: "medium" },
  "gpt-5.6-luna": { levels: ["none", "low", "medium", "high", "xhigh", "max"], defaultLevel: "medium" },
  "gpt-5.6-sol": { levels: ["none", "low", "medium", "high", "xhigh", "max"], defaultLevel: "medium" },
  "gpt-5.6-terra": { levels: ["none", "low", "medium", "high", "xhigh", "max"], defaultLevel: "medium" }
};
var OPENAI_NON_REASONING_MODELS = /* @__PURE__ */ new Set([
  "chat-latest",
  "gpt-5-chat-latest",
  "gpt-5.1-chat-latest",
  "gpt-5.2-chat-latest",
  "gpt-5.3-chat-latest"
]);
var OPENAI_DATED_SNAPSHOT_SUFFIX = /-\d{4}-\d{2}-\d{2}$/;
function canonicalOpenAiModelId(modelId, metadata) {
  return (metadata?.upstreamModelId ?? modelId ?? "").toLowerCase();
}
function openAiReasoningProfile(modelId, metadata) {
  const id = canonicalOpenAiModelId(modelId, metadata);
  if (!id) return void 0;
  return OPENAI_MODEL_REASONING[id] ?? OPENAI_MODEL_REASONING[id.replace(OPENAI_DATED_SNAPSHOT_SUFFIX, "")];
}
function openAiModelReasons(modelId, metadata) {
  const id = canonicalOpenAiModelId(modelId, metadata);
  if (OPENAI_NON_REASONING_MODELS.has(id.replace(OPENAI_DATED_SNAPSHOT_SUFFIX, ""))) return false;
  return !!openAiReasoningProfile(modelId, metadata) || modelPrefersResponsesApi(id) || !!metadata?.reasoning;
}
function mapCodexEffortToOpenAI(effort, allowed) {
  return allowed.includes(effort) ? effort : void 0;
}
function mapCodexEffortToOpenAICompatible(effort) {
  if (effort === "xhigh") return "high";
  const allowed = ["low", "medium", "high"];
  return allowed.includes(effort) ? effort : void 0;
}
function mapCodexEffortToGlm52(effort) {
  switch (effort) {
    case "high":
      return "high";
    case "xhigh":
    case "max":
      return "max";
    default:
      return void 0;
  }
}
function mapCodexEffortToXai(effort, supportsMedium) {
  switch (effort) {
    case "low":
      return "low";
    case "medium":
      return supportsMedium ? "medium" : void 0;
    case "high":
    case "xhigh":
    case "max":
      return "high";
    default:
      return void 0;
  }
}
function mapCodexEffortToGeminiLevel(effort) {
  switch (effort) {
    case "none":
    case "minimal":
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
    case "xhigh":
    case "max":
      return "high";
    default:
      return GEMINI_EFFORT_LEVELS.includes(effort) ? effort : void 0;
  }
}
function mapCodexEffortToGeminiBudget(effort) {
  const direct = GEMINI_25_BUDGETS[effort];
  if (direct !== void 0) return direct > 0 ? direct : void 0;
  const level = mapCodexEffortToGeminiLevel(effort);
  if (!level) return void 0;
  return GEMINI_25_BUDGETS[level];
}
function withMappableLevels(caps, npm, modelId, metadata) {
  if (caps.mode !== "controllable") return caps;
  const seen = /* @__PURE__ */ new Set();
  const levels = caps.levels.filter((level) => {
    const mapped = effortProviderOptions(npm, level, modelId, metadata);
    if (mapped === void 0) return false;
    const wire = JSON.stringify(mapped);
    if (seen.has(wire)) return false;
    seen.add(wire);
    return true;
  });
  if (levels.length === caps.levels.length) return caps;
  if (levels.length === 0) {
    return { ...caps, levels: [], defaultLevel: "", mode: "internal-only" };
  }
  return {
    ...caps,
    levels,
    defaultLevel: levels.includes(caps.defaultLevel) ? caps.defaultLevel : levels[levels.length - 1]
  };
}
function getReasoningCapabilities(npm, modelId, metadata) {
  return withMappableLevels(resolveRawReasoningCapabilities(npm, modelId, metadata), npm, modelId, metadata);
}
function resolveRawReasoningCapabilities(npm, modelId, metadata) {
  const id = modelId.toLowerCase();
  if (isOpenRouterRoute(npm, metadata)) {
    return openRouterReasoningCapabilities(metadata);
  }
  if (npm === "@ai-sdk/anthropic" || id.startsWith("claude-")) {
    const isClaude = isClaudeReasoningModel(modelId);
    if (isClaude || metadata?.reasoning) {
      return {
        levels: [...ANTHROPIC_EFFORT_LEVELS],
        defaultLevel: "high",
        supportsSummaries: true,
        mode: "controllable",
        source: isClaude ? "provider-rule" : "model-metadata",
        confidence: isClaude ? "documented" : "inferred",
        wireFormat: { kind: "anthropic-thinking" }
      };
    }
    return EMPTY_REASONING;
  }
  if (npm === "@ai-sdk/openai" || npm === "@ai-sdk/azure") {
    const canonicalId = canonicalOpenAiModelId(modelId, metadata);
    const profile = openAiReasoningProfile(modelId, metadata);
    const prefersResponses = modelPrefersResponsesApi(canonicalId);
    if (openAiModelReasons(modelId, metadata) && shouldUseOpenAiResponsesEndpoint(canonicalId)) {
      const levels = profile?.levels ?? [...OPENAI_EFFORT_LEVELS];
      return {
        levels: [...levels],
        defaultLevel: profile?.defaultLevel ?? (levels.includes("medium") ? "medium" : levels[levels.length - 1]),
        supportsSummaries: true,
        source: profile || prefersResponses ? "provider-rule" : "model-metadata",
        confidence: profile || prefersResponses ? "documented" : "inferred",
        mode: "controllable",
        wireFormat: { kind: "openai-reasoning-effort" }
      };
    }
    return EMPTY_REASONING;
  }
  if (npm === "@ai-sdk/google" || id.startsWith("gemini-")) {
    if (isGeminiReasoningModel(modelId)) {
      return {
        levels: [...GEMINI_EFFORT_LEVELS],
        defaultLevel: "medium",
        supportsSummaries: true,
        mode: "controllable",
        source: "provider-rule",
        confidence: "documented",
        wireFormat: { kind: "google-thinking-config" }
      };
    }
    return EMPTY_REASONING;
  }
  if (npm === "@ai-sdk/mistral") {
    if (isMistralReasoningModel(modelId)) {
      return {
        levels: [...MISTRAL_EFFORT_LEVELS],
        defaultLevel: "high",
        supportsSummaries: false,
        mode: "controllable",
        source: "provider-rule",
        confidence: "documented",
        wireFormat: { kind: "mistral-reasoning-effort" }
      };
    }
    return EMPTY_REASONING;
  }
  if (npm === "@ai-sdk/xai") {
    if (isXaiReasoningEffortModel(modelId)) {
      const levels = modelPrefersResponsesApi(modelId) ? [...XAI_RESPONSES_EFFORT_LEVELS] : [...XAI_CHAT_EFFORT_LEVELS];
      return {
        levels,
        defaultLevel: xaiDefaultReasoningEffort(modelId),
        supportsSummaries: true,
        mode: "controllable",
        source: "provider-rule",
        confidence: "documented",
        wireFormat: { kind: "openai-reasoning-effort" }
      };
    }
    return EMPTY_REASONING;
  }
  if (isDeepSeekReasoningModel(modelId)) {
    return {
      levels: [...DEEPSEEK_EFFORT_LEVELS],
      defaultLevel: "high",
      supportsSummaries: true,
      mode: "controllable",
      source: "provider-rule",
      confidence: "documented",
      wireFormat: { kind: "deepseek-thinking" }
    };
  }
  if (isKimiReasoningModel(modelId)) {
    return {
      levels: [...OPENAI_EFFORT_LEVELS],
      defaultLevel: "high",
      supportsSummaries: false,
      mode: "controllable",
      source: "provider-rule",
      confidence: "documented",
      wireFormat: { kind: "openai-reasoning-effort" }
    };
  }
  if (isGlm52ReasoningModel(modelId)) {
    return {
      levels: [...GLM_52_EFFORT_LEVELS],
      defaultLevel: "high",
      supportsSummaries: false,
      mode: "controllable",
      source: "provider-rule",
      confidence: "documented",
      wireFormat: { kind: "openai-reasoning-effort" }
    };
  }
  if (hasSupportedParameter(metadata, "reasoning_effort")) {
    return {
      levels: ["low", "medium", "high", "xhigh"],
      defaultLevel: "medium",
      supportsSummaries: false,
      mode: "controllable",
      source: "provider-metadata",
      confidence: "documented",
      wireFormat: { kind: "openai-reasoning-effort" }
    };
  }
  if (hasSupportedParameter(metadata, "reasoning")) {
    return {
      levels: [...OPENROUTER_EFFORT_LEVELS],
      defaultLevel: "medium",
      supportsSummaries: false,
      mode: "controllable",
      source: "provider-metadata",
      confidence: "documented",
      wireFormat: { kind: "openrouter-reasoning" }
    };
  }
  if (metadata?.reasoning) {
    return {
      levels: ["low", "medium", "high"],
      defaultLevel: "medium",
      supportsSummaries: false,
      mode: "controllable",
      source: "model-metadata",
      confidence: "inferred",
      wireFormat: { kind: "openai-reasoning-effort" }
    };
  }
  return EMPTY_REASONING;
}
function buildCodexReasoningLevels(capabilities) {
  return capabilities.levels.map((effort) => ({
    effort,
    description: EFFORT_DESCRIPTIONS[effort] ?? effort
  }));
}
function effortProviderOptions(npm, effort, modelId, metadata) {
  if (!effort) return void 0;
  if (isOpenRouterRoute(npm, metadata)) {
    const caps = openRouterReasoningCapabilities(metadata);
    if (caps.mode !== "controllable") return void 0;
    const allowed = new Set(OPENROUTER_EFFORT_LEVELS);
    const mapped = allowed.has(effort) ? effort : effort === "max" ? "xhigh" : void 0;
    return mapped ? { openrouter: { reasoning: { effort: mapped, exclude: false } } } : void 0;
  }
  if (npm === "@ai-sdk/openai" || npm === "@ai-sdk/azure") {
    if (!modelId || !shouldUseOpenAiResponsesEndpoint(canonicalOpenAiModelId(modelId, metadata))) return void 0;
    if (!openAiModelReasons(modelId, metadata)) return void 0;
    const allowed = openAiReasoningProfile(modelId, metadata)?.levels ?? OPENAI_EFFORT_LEVELS;
    const reasoningEffort = mapCodexEffortToOpenAI(effort, allowed);
    return reasoningEffort ? { openai: { reasoningEffort } } : void 0;
  }
  if (npm === "@ai-sdk/xai") {
    if (!modelId || !isXaiReasoningEffortModel(modelId)) return void 0;
    const reasoningEffort = mapCodexEffortToXai(effort, modelPrefersResponsesApi(modelId));
    return reasoningEffort ? { xai: { reasoningEffort } } : void 0;
  }
  if (npm === "@ai-sdk/anthropic" || npm === VERTEX_ANTHROPIC_NPM) {
    if (!modelId || !isClaudeReasoningModel(modelId)) return void 0;
    const mapped = mapCodexEffortToAnthropic(effort);
    return mapped ? { anthropic: { thinking: { type: "adaptive", effort: mapped } } } : void 0;
  }
  if (npm === "@ai-sdk/google") {
    const id = modelId ?? "";
    if (isGemini3Model(id)) {
      const thinkingLevel = mapCodexEffortToGeminiLevel(effort);
      return thinkingLevel ? { google: { thinkingConfig: { thinkingLevel, includeThoughts: true } } } : void 0;
    }
    const thinkingBudget = mapCodexEffortToGeminiBudget(effort);
    return thinkingBudget ? { google: { thinkingConfig: { thinkingBudget, includeThoughts: true } } } : void 0;
  }
  if (npm === "@ai-sdk/mistral") {
    if (!modelId || !isMistralReasoningModel(modelId)) return void 0;
    const reasoningEffort = effort === "off" || effort === "none" ? "none" : "high";
    return { mistral: { reasoningEffort } };
  }
  if (npm === "@ai-sdk/openai-compatible" || npm === "@ai-sdk/openai") {
    if (!modelId) return void 0;
    if (isDeepSeekReasoningModel(modelId)) {
      return deepSeekEffortProviderOptions(effort);
    }
    if (isKimiReasoningModel(modelId)) {
      const reasoningEffort = mapCodexEffortToOpenAICompatible(effort);
      if (reasoningEffort) {
        const key = metadata?.providerId ? toCamelCase(metadata.providerId) : "openaiCompatible";
        return { [key]: { reasoningEffort } };
      }
      return void 0;
    }
    if (isGlm52ReasoningModel(modelId)) {
      const reasoningEffort = mapCodexEffortToGlm52(effort);
      if (reasoningEffort) {
        const key = metadata?.providerId ? toCamelCase(metadata.providerId) : "openaiCompatible";
        return { [key]: { reasoningEffort } };
      }
      return void 0;
    }
    if (hasSupportedParameter(metadata, "reasoning_effort")) {
      const reasoningEffort = mapCodexEffortToOpenAICompatible(effort);
      return reasoningEffort ? { openai: { reasoningEffort }, openaiCompatible: { reasoningEffort } } : void 0;
    }
    if (hasSupportedParameter(metadata, "reasoning")) {
      const allowed = new Set(OPENROUTER_EFFORT_LEVELS);
      const mapped = allowed.has(effort) ? effort : effort === "max" ? "xhigh" : void 0;
      return mapped ? { openrouter: { reasoning: { effort: mapped, exclude: false } } } : void 0;
    }
    return void 0;
  }
  return void 0;
}
function deepMergeProviderOptions(a, b) {
  if (!a && !b) return void 0;
  if (!a) return b;
  if (!b) return a;
  const keys = /* @__PURE__ */ new Set([...Object.keys(a), ...Object.keys(b)]);
  const out = {};
  for (const key of keys) {
    out[key] = { ...a[key] ?? {}, ...b[key] ?? {} };
  }
  return out;
}
function thinkingProviderOptions(npm) {
  if (npm === "@ai-sdk/google") {
    return { google: { thinkingConfig: { includeThoughts: true } } };
  }
  if (npm === "@ai-sdk/openai") {
    return {
      openai: {
        store: false,
        include: ["reasoning.encrypted_content"]
      }
    };
  }
  return void 0;
}

// src/subagent-route-registry.ts
import { randomUUID as randomUUID2 } from "crypto";
var DEFAULT_TTL_MS = 5 * 6e4;
var DEFAULT_MAX_ENTRIES = 1024;
var ROUTE_MARKER_PATTERN = /(?:\n\n)?<relay-ai-subagent-route token="([0-9a-f-]{36})"\s*\/>/gi;
function firstHeader(value) {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" && first.trim() ? first.trim() : void 0;
}
function extractClaudeSessionId(headers, body) {
  const headerSession = firstHeader(headers["x-claude-code-session-id"]);
  if (headerSession) return headerSession;
  const userId = body?.metadata?.user_id;
  if (typeof userId !== "string") return void 0;
  try {
    const parsed = JSON.parse(userId);
    return typeof parsed.session_id === "string" && parsed.session_id.trim() ? parsed.session_id.trim() : void 0;
  } catch {
    return void 0;
  }
}
function appendSubagentRouteMarker(prompt, token) {
  return `${prompt}

<relay-ai-subagent-route token="${token}"/>`;
}
function findMarkersInUserMessages(body) {
  if (!Array.isArray(body.messages)) return void 0;
  const tokens = [];
  const messages = [...body.messages];
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const message = body.messages[messageIndex];
    if (!message || message.role !== "user") continue;
    if (typeof message.content === "string") {
      const matches = [...message.content.matchAll(ROUTE_MARKER_PATTERN)];
      if (matches.length === 0) continue;
      tokens.push(...matches.flatMap((match) => match[1] ? [match[1]] : []));
      messages[messageIndex] = {
        ...message,
        content: message.content.replace(ROUTE_MARKER_PATTERN, "").trimEnd()
      };
      continue;
    }
    if (!Array.isArray(message.content)) continue;
    const content = [...message.content];
    for (let partIndex = 0; partIndex < message.content.length; partIndex++) {
      const part = message.content[partIndex];
      if (!part || part.type !== "text" || typeof part.text !== "string") continue;
      const matches = [...part.text.matchAll(ROUTE_MARKER_PATTERN)];
      if (matches.length === 0) continue;
      tokens.push(...matches.flatMap((match) => match[1] ? [match[1]] : []));
      content[partIndex] = {
        ...part,
        text: part.text.replace(ROUTE_MARKER_PATTERN, "").trimEnd()
      };
    }
    messages[messageIndex] = { ...message, content };
  }
  return tokens.length > 0 ? { tokens, body: { ...body, messages } } : void 0;
}
var SubagentRouteRegistry = class {
  entries = /* @__PURE__ */ new Map();
  ttlMs;
  maxEntries;
  now;
  constructor(options = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.now = options.now ?? Date.now;
  }
  register(sessionId, modelId) {
    this.cleanup();
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (!oldest) break;
      this.entries.delete(oldest);
    }
    const token = randomUUID2();
    this.entries.set(token, { sessionId, modelId, createdAt: this.now() });
    return token;
  }
  consume(headers, body) {
    this.cleanup();
    if (!firstHeader(headers["x-claude-code-agent-id"])) return void 0;
    const sessionId = extractClaudeSessionId(headers, body);
    if (!sessionId) return void 0;
    const marked = findMarkersInUserMessages(body);
    if (!marked) return void 0;
    const token = [...marked.tokens].reverse().find((candidate) => this.entries.get(candidate)?.sessionId === sessionId);
    if (!token) return void 0;
    const entry = this.entries.get(token);
    this.entries.delete(token);
    return { modelId: entry.modelId, body: marked.body };
  }
  cleanup() {
    const cutoff = this.now() - this.ttlMs;
    for (const [token, entry] of this.entries) {
      if (entry.createdAt < cutoff) this.entries.delete(token);
    }
  }
};

// src/subagent-model-routing.ts
var CLAUDE_MODEL_FAMILIES = ["sonnet", "opus", "haiku", "fable"];
var CLAUDE_MODEL_FAMILY_SET = new Set(CLAUDE_MODEL_FAMILIES);
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function claudeModelFamily(modelId) {
  const normalized = modelId.toLowerCase();
  if (!normalized.startsWith("claude-")) return void 0;
  return CLAUDE_MODEL_FAMILIES.find((family) => normalized.includes(family));
}
function isClaudeAgentTool(tool2) {
  if (tool2.name !== "Agent" || !isRecord2(tool2.input_schema)) return false;
  const properties = tool2.input_schema.properties;
  if (!isRecord2(properties)) return false;
  return ["description", "prompt", "subagent_type"].every((name) => isRecord2(properties[name]));
}
var UnavailableSubagentModelError = class extends Error {
  constructor(selector, routing) {
    const visible = routing.models.slice(0, MAX_MODEL_CATALOG).map((model) => model.id);
    const omitted = routing.models.length - visible.length;
    const suffix = omitted > 0 ? `, and ${omitted} more` : "";
    super(
      `Subagent model "${selector}" is unavailable in this Relay AI session. Available model ids: ${visible.join(", ")}${suffix}.`
    );
    this.selector = selector;
    this.name = "UnavailableSubagentModelError";
  }
  selector;
  statusCode = 400;
};
function normalizeClaudeAgentInput(input, routing) {
  const source = isRecord2(input) ? input : {};
  const normalized = { ...source };
  if (source.subagent_type === "fork") {
    return { input: normalized, decision: { kind: "fork" } };
  }
  const rawModel = source.model;
  if (rawModel == null) {
    normalized.model = routing.parentModelId;
    return {
      input: normalized,
      decision: { kind: "inherit", resolvedModelId: routing.parentModelId }
    };
  }
  if (typeof rawModel !== "string") {
    throw new UnavailableSubagentModelError(String(rawModel), routing);
  }
  const selector = rawModel.trim();
  if (selector === "" || selector === "inherit") {
    normalized.model = routing.parentModelId;
    return {
      input: normalized,
      decision: { kind: "inherit", resolvedModelId: routing.parentModelId }
    };
  }
  const exposed = routing.models.find((model) => model.id === selector);
  if (exposed) {
    normalized.model = exposed.id;
    return {
      input: normalized,
      decision: { kind: "explicit", resolvedModelId: exposed.id }
    };
  }
  const compatible = routing.models.find((model) => model.compatibilityIds.includes(selector));
  if (compatible) {
    normalized.model = compatible.id;
    return {
      input: normalized,
      decision: {
        kind: "compatibility",
        requestedModelId: selector,
        resolvedModelId: compatible.id
      }
    };
  }
  if (CLAUDE_MODEL_FAMILY_SET.has(selector)) {
    const family = selector;
    const nativeModel = routing.models.find((model) => model.family === family);
    const resolvedModelId = nativeModel?.id ?? routing.parentModelId;
    normalized.model = resolvedModelId;
    return {
      input: normalized,
      decision: nativeModel ? { kind: "family", requestedModelId: family, resolvedModelId } : { kind: "family-fallback", requestedModelId: family, resolvedModelId }
    };
  }
  throw new UnavailableSubagentModelError(selector, routing);
}
function prepareClaudeAgentInput(input, routing) {
  const normalized = normalizeClaudeAgentInput(input, routing);
  const decision = normalized.decision;
  if (decision.kind === "fork") return normalized;
  if (!routing.registerSubagentRoute) return normalized;
  const prompt = normalized.input.prompt;
  if (typeof prompt !== "string") return normalized;
  const token = routing.registerSubagentRoute(decision.resolvedModelId);
  const clientInput = { ...normalized.input };
  const target = routing.models.find((model) => model.id === decision.resolvedModelId);
  if (target?.family) clientInput.model = target.family;
  else delete clientInput.model;
  clientInput.prompt = appendSubagentRouteMarker(prompt, token);
  return { input: clientInput, decision };
}
function augmentClaudeAgentTool(tool2, routing) {
  const inputSchema = isRecord2(tool2.input_schema) ? tool2.input_schema : {};
  const properties = isRecord2(inputSchema.properties) ? inputSchema.properties : {};
  const originalModel = isRecord2(properties.model) ? properties.model : {};
  const smallCatalog = routing.models.length <= MAX_MODEL_CATALOG;
  const modelProperty = {
    ...originalModel,
    type: "string"
  };
  if (smallCatalog) {
    const originalEnum = Array.isArray(originalModel.enum) ? originalModel.enum.filter((value) => typeof value === "string") : CLAUDE_MODEL_FAMILIES;
    modelProperty.enum = [.../* @__PURE__ */ new Set([...originalEnum, ...routing.models.map((model) => model.id)])];
  } else {
    delete modelProperty.enum;
  }
  const guidance = smallCatalog ? `Relay AI subagent model routing (default: ${routing.parentModelId}). ` + routing.models.map((model) => `${model.displayName}: ${model.id}`).join("; ") : `Relay AI subagent model routing (default: ${routing.parentModelId}). Other explicit model values must be exact ids from the current session catalog.`;
  return {
    ...tool2,
    description: [tool2.description?.trim(), guidance].filter(Boolean).join("\n\n"),
    input_schema: {
      ...inputSchema,
      properties: {
        ...properties,
        model: modelProperty
      }
    }
  };
}

// src/proxy-shared.ts
function grabRoundTripSignature(part) {
  const md = part.providerMetadata;
  return md?.google?.thoughtSignature ?? md?.google?.thought_signature ?? md?.openai?.reasoningEncryptedContent ?? void 0;
}
var sdkWarningsSilenced = false;
function silenceSdkWarnings() {
  if (sdkWarningsSilenced) return;
  sdkWarningsSilenced = true;
  globalThis.AI_SDK_LOG_WARNINGS = false;
}
var TOOL_USE_SIG_SEP = "__ts__";
var MAX_INLINE_TOOL_SIGNATURE_BYTES = 256;
var MAX_STORED_TOOL_SIGNATURES = 1e3;
var toolSignatureRegistry = /* @__PURE__ */ new Map();
function rememberToolSignature(rawId, thoughtSignature) {
  toolSignatureRegistry.set(rawId, thoughtSignature);
  if (toolSignatureRegistry.size <= MAX_STORED_TOOL_SIGNATURES) return;
  const oldest = toolSignatureRegistry.keys().next().value;
  if (oldest) toolSignatureRegistry.delete(oldest);
}
function parseToolArguments(value) {
  if (value === null || value === void 0) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string") {
    if (!value) return {};
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
    }
  }
  return {};
}
function sseChunk(eventType, data) {
  return `event: ${eventType}
data: ${JSON.stringify(data)}

`;
}
var DSML_NOISE = "[|\uFF5C\\s]*";
var DSML_BLOCK_RE = new RegExp(`<${DSML_NOISE}DSML${DSML_NOISE}tool_calls>([\\s\\S]*?)<\\/${DSML_NOISE}DSML${DSML_NOISE}tool_calls>`, "i");
var DSML_INVOKE_RE = new RegExp(`<${DSML_NOISE}DSML${DSML_NOISE}invoke\\s+name="([^"]+)"[^>]*>([\\s\\S]*?)<\\/${DSML_NOISE}DSML${DSML_NOISE}invoke>`, "gi");
var DSML_PARAM_RE = new RegExp(`<${DSML_NOISE}DSML${DSML_NOISE}parameter\\s+name="([^"]+)"(?:\\s+string="(true|false)")?[^>]*>([\\s\\S]*?)<\\/${DSML_NOISE}DSML${DSML_NOISE}parameter>`, "gi");
function parseDsmlToolCalls(text) {
  const outer = DSML_BLOCK_RE.exec(text);
  if (!outer) return null;
  const calls = [];
  for (const invokeMatch of outer[1].matchAll(DSML_INVOKE_RE)) {
    const name = invokeMatch[1];
    const body = invokeMatch[2];
    const args = {};
    for (const paramMatch of body.matchAll(DSML_PARAM_RE)) {
      const paramName = paramMatch[1];
      const isJson = paramMatch[2] === "false";
      const rawValue = paramMatch[3] ?? "";
      if (isJson) {
        try {
          args[paramName] = JSON.parse(rawValue.trim());
        } catch {
          args[paramName] = rawValue;
        }
      } else {
        args[paramName] = rawValue;
      }
    }
    calls.push({ name, args });
  }
  if (!calls.length) return null;
  return { leadingText: text.slice(0, outer.index).trim(), calls };
}
function splitToolUseId(id) {
  let sep = id.lastIndexOf(TOOL_USE_SIG_SEP);
  if (sep !== -1) {
    return {
      rawId: id.slice(0, sep),
      thoughtSignature: Buffer.from(id.slice(sep + TOOL_USE_SIG_SEP.length), "base64url").toString("utf8")
    };
  }
  sep = id.lastIndexOf("::ts::");
  if (sep !== -1) {
    return {
      rawId: id.slice(0, sep),
      thoughtSignature: id.slice(sep + 6)
    };
  }
  return { rawId: id, thoughtSignature: toolSignatureRegistry.get(id) };
}
function encodeToolUseId(rawId, thoughtSignature, inline = true) {
  if (!thoughtSignature) return rawId;
  rememberToolSignature(rawId, thoughtSignature);
  if (!inline) return rawId;
  if (Buffer.byteLength(thoughtSignature, "utf8") > MAX_INLINE_TOOL_SIGNATURE_BYTES) {
    return rawId;
  }
  const encoded = Buffer.from(thoughtSignature, "utf8").toString("base64url");
  return `${rawId}${TOOL_USE_SIG_SEP}${encoded}`;
}
function serializeToolResultContent(content) {
  if (typeof content === "string") return content;
  if (content === void 0) return "";
  return JSON.stringify(content);
}

// src/codex/upstream-error.ts
var TRACE_FIELD_LIMIT = 4e3;
function clipTraceField(value) {
  return value.length <= TRACE_FIELD_LIMIT ? value : `${value.slice(0, TRACE_FIELD_LIMIT)}\u2026`;
}
function safeUpstreamErrorFields(err, includeCause) {
  if (!err || typeof err !== "object") {
    return { message: clipTraceField(String(err)) };
  }
  const rec = err;
  const result = {};
  if (rec.name) result.name = rec.name;
  if (rec.message) result.message = clipTraceField(rec.message);
  if (rec.statusCode !== void 0) result.statusCode = rec.statusCode;
  if (rec.responseBody) result.responseBody = clipTraceField(rec.responseBody);
  if (rec.data?.error) {
    result.data = {
      error: {
        ...rec.data.error.type ? { type: rec.data.error.type } : {},
        ...rec.data.error.message ? { message: clipTraceField(rec.data.error.message) } : {}
      }
    };
  }
  if (rec.lastError) {
    result.lastError = {
      ...rec.lastError.message ? { message: clipTraceField(rec.lastError.message) } : {},
      ...rec.lastError.statusCode !== void 0 ? { statusCode: rec.lastError.statusCode } : {}
    };
  }
  if (rec.errors?.length) {
    result.errors = rec.errors.map((item) => ({
      ...item.message ? { message: clipTraceField(item.message) } : {},
      ...item.statusCode !== void 0 ? { statusCode: item.statusCode } : {}
    }));
  }
  if (includeCause && rec.cause !== void 0) {
    result.cause = safeUpstreamErrorFields(rec.cause, false);
  }
  return result;
}
function formatUpstreamErrorTrace(err) {
  return JSON.stringify(safeUpstreamErrorFields(err, true));
}
function formatUpstreamError(err) {
  if (!err || typeof err !== "object") return "Upstream model request failed.";
  const rec = err;
  if (rec.data?.error?.message) {
    const short = sanitizeMessage(rec.data.error.message);
    return rec.statusCode ? `${short} (HTTP ${rec.statusCode})` : short;
  }
  if (rec.responseBody) {
    try {
      const parsed = JSON.parse(rec.responseBody);
      if (parsed.error?.message) {
        const short = sanitizeMessage(parsed.error.message);
        return rec.statusCode ? `${short} (HTTP ${rec.statusCode})` : short;
      }
    } catch {
    }
  }
  const last = rec.lastError;
  if (last?.message) {
    const code = last.statusCode;
    const short = sanitizeMessage(last.message);
    return code ? `${short} (HTTP ${code})` : short;
  }
  const fromList = rec.errors?.[rec.errors.length - 1];
  if (fromList?.message) {
    const short = sanitizeMessage(fromList.message);
    return fromList.statusCode ? `${short} (HTTP ${fromList.statusCode})` : short;
  }
  if (rec.message) {
    const short = sanitizeMessage(rec.message);
    if (short && !short.includes("file://") && !short.includes("APICallError") && short.length < 240) {
      return rec.statusCode ? `${short} (HTTP ${rec.statusCode})` : short;
    }
  }
  return "Upstream model request failed.";
}
function upstreamHttpStatus(err, message) {
  if (err && typeof err === "object" && "statusCode" in err) {
    const code = err.statusCode;
    if (code === 400 || code === 401 || code === 403 || code === 404 || code === 429) return code;
  }
  if (message.includes("HTTP 429") || message.includes("429")) return 429;
  if (message.includes("HTTP 400")) return 400;
  return 500;
}
function anthropicErrorType(status) {
  switch (status) {
    case 400:
      return "invalid_request_error";
    case 401:
      return "authentication_error";
    case 403:
      return "permission_error";
    case 404:
      return "not_found_error";
    case 429:
      return "rate_limit_error";
    default:
      return "api_error";
  }
}
function sanitizeMessage(message) {
  const line = message.split("\n")[0]?.trim() ?? message;
  if (line.startsWith("RetryError") || line.includes("AI_RetryError")) {
    return "Upstream model request failed after retries.";
  }
  return line;
}

// src/sdk-adapter.ts
import { streamText, generateText, tool, jsonSchema } from "ai";

// src/tool-search.ts
var TOOL_SEARCH_TYPE_PREFIX = "tool_search_tool";
function isToolSearchTool(tool2) {
  if (typeof tool2.type === "string" && tool2.type.startsWith(TOOL_SEARCH_TYPE_PREFIX)) return true;
  const name = tool2.name ?? "";
  return name.includes("tool_search") || name === "ToolSearch";
}
function extractReferencedToolNames(messages) {
  const names = /* @__PURE__ */ new Set();
  const visitContent = (content) => {
    if (typeof content === "string") return;
    if (!Array.isArray(content)) return;
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const part = block;
      if (part.type === "tool_reference" && typeof part.tool_name === "string") {
        names.add(part.tool_name);
      }
      if (part.type === "tool_search_tool_result") {
        const inner = part.content;
        const refs = inner?.tool_references;
        if (Array.isArray(refs)) {
          for (const ref of refs) {
            if (ref && typeof ref === "object" && typeof ref.tool_name === "string") {
              names.add(ref.tool_name);
            }
          }
        }
      }
      if (part.type === "tool_result" && part.content) {
        visitContent(part.content);
      }
    }
  };
  for (const msg of messages ?? []) {
    visitContent(msg.content);
  }
  return names;
}
function resolveUpstreamTools(tools, messages) {
  if (!tools?.length) return [];
  const referenced = extractReferencedToolNames(messages);
  const upstream = [];
  for (const tool2 of tools) {
    if (isToolSearchTool(tool2)) {
      upstream.push(tool2);
      continue;
    }
    if (tool2.defer_loading === true) {
      if (referenced.has(tool2.name)) upstream.push(tool2);
      continue;
    }
    upstream.push(tool2);
  }
  return upstream;
}

// src/tool-schema.ts
var GOOGLE_NPM = /* @__PURE__ */ new Set(["@ai-sdk/google", "@ai-sdk/google-vertex"]);
function collapseSchemaUnionTypes(value) {
  if (Array.isArray(value)) return value.map(collapseSchemaUnionTypes);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "type" && Array.isArray(child)) {
      const nonNull = child.filter((entry) => entry !== "null");
      if (nonNull.length === 1) {
        out.type = nonNull[0];
        if (nonNull.length < child.length) out.nullable = true;
        continue;
      }
    }
    out[key] = collapseSchemaUnionTypes(child);
  }
  return out;
}
function normalizeToolSchemaForNpm(schema, npm) {
  if (!npm || !GOOGLE_NPM.has(npm)) return schema;
  return collapseSchemaUnionTypes(schema);
}

// src/sdk-adapter.ts
var NEEDS_TRAILING_TOOL_NUDGE = /* @__PURE__ */ new Set(["@ai-sdk/alibaba"]);
var TRAILING_TOOL_NUDGE_TEXT = "Continue.";
function anthropicEffortFromRequest(body) {
  const effort = body.output_config?.effort;
  if (typeof effort === "string" && effort.trim()) return effort.trim();
  return void 0;
}
function systemToString(system) {
  if (!system) return void 0;
  if (typeof system === "string") return system;
  return system.map((b) => typeof b === "string" ? b : b.text ?? "").join("\n");
}
function inlineSystemText(messages) {
  const parts = [];
  for (const msg of messages) {
    if (msg.role !== "system") continue;
    const text = typeof msg.content === "string" ? msg.content : msg.content.map((b) => b.text ?? "").join("\n");
    if (text.trim()) parts.push(text.trim());
  }
  return parts;
}
function imagePart(block) {
  const src = block.source;
  if (!src) return null;
  if (src.type === "base64" && src.data) {
    return { type: "file", mediaType: src.media_type ?? "image", data: Buffer.from(src.data, "base64") };
  }
  if (src.type === "url" && src.url) {
    return { type: "file", mediaType: src.media_type ?? "image", data: { type: "url", url: new URL(src.url) } };
  }
  return null;
}
function annotateToolNames(messages) {
  const nameById = /* @__PURE__ */ new Map();
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const b of msg.content) {
      if (b.type === "tool_use" && b.id && b.name) nameById.set(splitToolUseId(b.id).rawId, b.name);
    }
  }
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const b of msg.content) {
      if (b.type === "tool_result" && b.tool_use_id) {
        b._name = nameById.get(splitToolUseId(b.tool_use_id).rawId);
      }
    }
  }
}
function thinkingToSdkPart(block, npm) {
  const text = block.thinking ?? "";
  if (npm === "@ai-sdk/openai" && !block.signature && !text.trim()) return null;
  const part = { type: "reasoning", text };
  if (block.signature) {
    if (npm === "@ai-sdk/google") {
      part.providerOptions = { google: { thoughtSignature: block.signature } };
    } else if (npm === "@ai-sdk/openai" || npm === "@ai-sdk/openai-compatible") {
      part.providerOptions = { openai: { reasoningEncryptedContent: block.signature } };
    }
  }
  return part;
}
function translateMessages(messages, npm, onDebug) {
  const isGoogle = npm === "@ai-sdk/google";
  const out = [];
  for (const msg of messages) {
    const blocks = typeof msg.content === "string" ? [{ type: "text", text: msg.content }] : msg.content ?? [];
    if (msg.role === "user") {
      const toolResults = blocks.filter((b) => b.type === "tool_result");
      const parts = [];
      for (const b of blocks) {
        if (b.type === "text") parts.push({ type: "text", text: b.text ?? "" });
        else if (b.type === "image") {
          const p = imagePart(b);
          if (p) parts.push(p);
        }
      }
      if (blocks.length && !toolResults.length && !parts.length) {
        const types = blocks.map((b) => b.type).join(", ");
        onDebug?.(`sdk: dropped user turn with unrecognized block types: [${types}]`);
      }
      if (toolResults.length) {
        out.push({
          role: "tool",
          content: toolResults.map((tr) => ({
            type: "tool-result",
            toolCallId: splitToolUseId(tr.tool_use_id ?? "").rawId,
            toolName: tr._name ?? "unknown",
            output: { type: "text", value: serializeToolResultContent(tr.content) }
          }))
        });
      }
      if (parts.length) out.push({ role: "user", content: parts });
    } else if (msg.role === "assistant") {
      const parts = [];
      for (const b of blocks) {
        if (b.type === "text") {
          parts.push({ type: "text", text: b.text ?? "" });
        } else if (b.type === "thinking") {
          const part = thinkingToSdkPart(b, npm);
          if (part) parts.push(part);
        } else if (b.type === "tool_use" && b.id) {
          const { rawId, thoughtSignature } = splitToolUseId(b.id);
          const part = {
            type: "tool-call",
            toolCallId: rawId,
            toolName: b.name,
            input: b.input ?? {}
          };
          if (thoughtSignature && isGoogle) part.providerOptions = { google: { thoughtSignature } };
          parts.push(part);
        }
      }
      if (parts.length) out.push({ role: "assistant", content: parts });
    }
  }
  if (NEEDS_TRAILING_TOOL_NUDGE.has(npm) && out[out.length - 1]?.role === "tool") {
    out.push({ role: "user", content: [{ type: "text", text: TRAILING_TOOL_NUDGE_TEXT }] });
    onDebug?.("sdk: appended continuation nudge (request ended on tool result)");
  }
  return out;
}
function stripNullInputs(input) {
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (v !== null) out[k] = v;
  }
  return out;
}
function translateTools(anthropicTools, npm) {
  if (!anthropicTools?.length) return void 0;
  const tools = {};
  for (const t of anthropicTools) {
    if (!t.name || !t.input_schema) continue;
    tools[t.name] = tool({
      description: t.description ?? "",
      inputSchema: jsonSchema(normalizeToolSchemaForNpm(t.input_schema, npm))
    });
  }
  return Object.keys(tools).length ? tools : void 0;
}
function translateToolChoice(tc) {
  if (!tc) return void 0;
  if (tc.type === "auto") return "auto";
  if (tc.type === "any") return "required";
  if (tc.type === "tool" && tc.name) return { type: "tool", toolName: tc.name };
  return void 0;
}
function translateRequest(body, npm, options) {
  const messages = body.messages ?? [];
  annotateToolNames(messages);
  const baseSystem = systemToString(body.system);
  const inlineParts = inlineSystemText(messages);
  const systemText = [baseSystem, ...inlineParts].filter((s) => s && s.trim()).join("\n\n") || (options?.openAiOAuth ? "You are a coding assistant." : void 0);
  let upstreamTools = resolveUpstreamTools(
    body.tools,
    messages
  );
  if (options?.maxTools !== void 0 && upstreamTools.length > options.maxTools) {
    upstreamTools = upstreamTools.slice(0, options.maxTools);
  }
  let responseSubagentRouting;
  if (options?.subagentRouting) {
    const agentIndex = upstreamTools.findIndex((toolDefinition) => isClaudeAgentTool(toolDefinition));
    if (agentIndex >= 0) {
      upstreamTools = upstreamTools.map((toolDefinition, index) => index === agentIndex ? augmentClaudeAgentTool(
        toolDefinition,
        options.subagentRouting
      ) : toolDefinition);
      responseSubagentRouting = options.subagentRouting;
    }
  }
  const effort = anthropicEffortFromRequest(body) ?? options?.defaultEffort;
  let providerOptions = deepMergeProviderOptions(
    thinkingProviderOptions(npm),
    effortProviderOptions(npm, effort, options?.reasoningMetadata?.upstreamModelId ?? body.model, options?.reasoningMetadata)
  );
  if (options?.openAiOAuth && systemText) {
    providerOptions = deepMergeProviderOptions(providerOptions, {
      openai: { instructions: systemText }
    });
  }
  return {
    instructions: options?.openAiOAuth ? void 0 : systemText,
    messages: translateMessages(messages, npm, options?.onDebug),
    tools: translateTools(upstreamTools.length ? upstreamTools : void 0, npm),
    toolChoice: translateToolChoice(body.tool_choice),
    maxOutputTokens: options?.openAiOAuth ? void 0 : body.max_tokens,
    temperature: body.temperature,
    providerOptions,
    headers: options?.requestHeaders,
    subagentRouting: responseSubagentRouting
  };
}
function logSubagentDecision(log, decision) {
  if (!log || decision.kind === "fork" || decision.kind === "explicit") return;
  log(() => decision.kind === "family-fallback" ? `sdk Agent model "${decision.requestedModelId}" unavailable; using parent ${decision.resolvedModelId}` : `sdk Agent model ${decision.kind}: ${"requestedModelId" in decision ? `${decision.requestedModelId} -> ` : ""}${decision.resolvedModelId}`);
}
async function writeAnthropicStream(fullStream, modelId, write, log, estimatedInputTokens = 0, subagentRouting) {
  const messageId = "msg_" + Date.now();
  let blockIndex = -1;
  let started = false;
  let openType = null;
  let pendingThinkingSig;
  const idToBlock = /* @__PURE__ */ new Map();
  const bufferedAgentCalls = /* @__PURE__ */ new Map();
  let finishReason = "end_turn";
  let usage = { input_tokens: estimatedInputTokens, output_tokens: 0 };
  const emit = (event, data) => write(sseChunk(event, data));
  const ensureStart = () => {
    if (started) return;
    emit("message_start", {
      type: "message_start",
      message: {
        id: messageId,
        type: "message",
        role: "assistant",
        content: [],
        model: modelId,
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: estimatedInputTokens, output_tokens: 0 }
      }
    });
    started = true;
  };
  const closeOpen = () => {
    if (openType === "thinking") {
      emit("content_block_delta", {
        type: "content_block_delta",
        index: blockIndex,
        delta: { type: "signature_delta", signature: pendingThinkingSig ?? "" }
      });
      pendingThinkingSig = void 0;
    }
    if (openType) emit("content_block_stop", { type: "content_block_stop", index: blockIndex });
    openType = null;
  };
  const openBlock = (type, contentBlock) => {
    ensureStart();
    closeOpen();
    blockIndex++;
    openType = type;
    emit("content_block_start", { type: "content_block_start", index: blockIndex, content_block: contentBlock });
  };
  for await (const part of fullStream) {
    switch (part.type) {
      case "start":
        ensureStart();
        break;
      case "reasoning-start":
        openBlock("thinking", { type: "thinking", thinking: "", signature: "" });
        break;
      case "reasoning-delta":
        if (openType !== "thinking") openBlock("thinking", { type: "thinking", thinking: "", signature: "" });
        emit("content_block_delta", {
          type: "content_block_delta",
          index: blockIndex,
          delta: { type: "thinking_delta", thinking: part.text ?? "" }
        });
        break;
      case "reasoning-end": {
        const sig = grabRoundTripSignature(part);
        if (sig) pendingThinkingSig = sig;
        break;
      }
      case "text-start":
        openBlock("text", { type: "text", text: "" });
        break;
      case "text-delta":
        if (openType !== "text") openBlock("text", { type: "text", text: "" });
        emit("content_block_delta", {
          type: "content_block_delta",
          index: blockIndex,
          delta: { type: "text_delta", text: part.text ?? "" }
        });
        break;
      case "text-end":
        break;
      case "tool-input-start": {
        const sig = grabRoundTripSignature(part);
        openBlock("tool", {
          type: "tool_use",
          id: encodeToolUseId(part.id ?? "", sig),
          name: part.toolName,
          input: {}
        });
        idToBlock.set(part.id ?? "", blockIndex);
        if (subagentRouting && part.toolName === "Agent") {
          bufferedAgentCalls.set(part.id ?? "", { blockIndex });
        }
        break;
      }
      case "tool-input-delta":
        if (bufferedAgentCalls.has(part.id ?? "")) break;
        emit("content_block_delta", {
          type: "content_block_delta",
          index: idToBlock.get(part.id ?? "") ?? blockIndex,
          delta: { type: "input_json_delta", partial_json: part.delta ?? part.text ?? "" }
        });
        break;
      case "tool-input-end":
        break;
      case "tool-call": {
        finishReason = "tool_use";
        const toolCallId = part.toolCallId ?? "";
        if (subagentRouting && part.toolName === "Agent") {
          try {
            const normalized = prepareClaudeAgentInput(part.input, subagentRouting);
            logSubagentDecision(log, normalized.decision);
            const buffered = bufferedAgentCalls.get(toolCallId);
            if (!buffered && !idToBlock.has(toolCallId)) {
              const sig = grabRoundTripSignature(part);
              openBlock("tool", {
                type: "tool_use",
                id: encodeToolUseId(toolCallId, sig),
                name: part.toolName,
                input: {}
              });
              idToBlock.set(toolCallId, blockIndex);
            }
            emit("content_block_delta", {
              type: "content_block_delta",
              index: buffered?.blockIndex ?? idToBlock.get(toolCallId) ?? blockIndex,
              delta: {
                type: "input_json_delta",
                partial_json: JSON.stringify(stripNullInputs(normalized.input))
              }
            });
            bufferedAgentCalls.delete(toolCallId);
          } catch (error) {
            if (error instanceof UnavailableSubagentModelError) {
              bufferedAgentCalls.delete(toolCallId);
              closeOpen();
              emit("error", {
                type: "error",
                error: {
                  type: anthropicErrorType(error.statusCode),
                  message: error.message
                }
              });
              return;
            }
            throw error;
          }
          break;
        }
        if (!idToBlock.has(toolCallId) && openType !== "tool") {
          const sig = grabRoundTripSignature(part);
          openBlock("tool", {
            type: "tool_use",
            id: encodeToolUseId(toolCallId, sig),
            name: part.toolName,
            input: {}
          });
          emit("content_block_delta", {
            type: "content_block_delta",
            index: blockIndex,
            delta: { type: "input_json_delta", partial_json: JSON.stringify(stripNullInputs(part.input ?? {})) }
          });
        }
        break;
      }
      case "finish":
        if (part.totalUsage) {
          usage = {
            input_tokens: part.totalUsage.inputTokens ?? estimatedInputTokens,
            output_tokens: part.totalUsage.outputTokens ?? 0
          };
        }
        if (part.finishReason === "tool-calls") finishReason = "tool_use";
        else if (part.finishReason === "length") finishReason = "max_tokens";
        else if (part.finishReason === "stop" && finishReason !== "tool_use") finishReason = "end_turn";
        break;
      case "error": {
        const e = part.error;
        const errMsg = e?.message || (typeof part.error === "string" ? part.error : JSON.stringify(e?.data ?? part.error));
        const errorType = anthropicErrorType(upstreamHttpStatus(part.error, errMsg));
        log?.(() => `sdk stream error (${errorType}): ${errMsg}`);
        bufferedAgentCalls.clear();
        closeOpen();
        emit("error", { type: "error", error: { type: errorType, message: errMsg } });
        return;
      }
      default:
        break;
    }
  }
  closeOpen();
  ensureStart();
  emit("message_delta", { type: "message_delta", delta: { stop_reason: finishReason, stop_sequence: null }, usage });
  emit("message_stop", { type: "message_stop" });
}
async function streamAnthropicResponse(model, params, modelId, write, log, estimatedInputTokens = 0) {
  const { subagentRouting, ...providerParams } = params;
  const result = streamText({ model, ...providerParams, onError: () => {
  } });
  Promise.resolve(result.text).catch(() => {
  });
  Promise.resolve(result.toolCalls).catch(() => {
  });
  Promise.resolve(result.toolResults).catch(() => {
  });
  Promise.resolve(result.finishReason).catch(() => {
  });
  Promise.resolve(result.usage).catch(() => {
  });
  await writeAnthropicStream(
    result.stream,
    modelId,
    write,
    log,
    estimatedInputTokens,
    subagentRouting
  );
}
async function generateAnthropicResponse(model, params, modelId, options) {
  const { subagentRouting, ...providerParams } = params;
  let text;
  let toolCalls;
  let finishReason;
  let usage;
  if (options?.forceStream) {
    let firstStreamError;
    const r = streamText({
      model,
      ...providerParams,
      onError: (event) => {
        firstStreamError ??= event;
      }
    });
    Promise.resolve(r.toolResults).catch(() => {
    });
    try {
      [text, toolCalls, finishReason, usage] = await Promise.all([r.text, r.toolCalls, r.finishReason, r.usage]);
    } catch (error) {
      throw firstStreamError ? firstStreamError.error : error;
    }
  } else {
    const r = await generateText({ model, ...providerParams });
    ({ text, toolCalls, finishReason, usage } = r);
  }
  return {
    id: "msg_" + Date.now(),
    type: "message",
    role: "assistant",
    model: modelId,
    content: [
      ...text ? [{ type: "text", text }] : [],
      ...toolCalls.map((tc) => {
        let input = tc.input;
        if (subagentRouting && tc.toolName === "Agent") {
          const normalized = prepareClaudeAgentInput(tc.input, subagentRouting);
          logSubagentDecision(options?.log, normalized.decision);
          input = normalized.input;
        }
        return {
          type: "tool_use",
          id: encodeToolUseId(tc.toolCallId, grabRoundTripSignature(tc)),
          name: tc.toolName,
          input: stripNullInputs(input)
        };
      })
    ],
    stop_reason: finishReason === "tool-calls" ? "tool_use" : "end_turn",
    usage: { input_tokens: usage?.inputTokens ?? 0, output_tokens: usage?.outputTokens ?? 0 }
  };
}

export {
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
  requestOpenAiDeviceCode,
  openAiDeviceCodeUrl,
  pollOpenAiDeviceCodeToken,
  runOpenAiDeviceCodeFlow,
  CLAUDE_CODE_CLI_VERSION2 as CLAUDE_CODE_CLI_VERSION,
  CLAUDE_CODE_USER_AGENT,
  buildClaudeCodeBillingSystemLine,
  injectClaudeCodeBillingSystemLine,
  selectBetaFlags,
  injectClaudeIdentity,
  CLINE_PASS_CATALOG_URL,
  CLINE_PASS_VALIDATION_URL,
  CLINE_PASS_LEGACY_DEFAULT_CONTEXT_WINDOW,
  modelPrefersResponsesApi,
  isSdkMigratedNpm,
  maxToolsForNpm,
  createLanguageModel,
  getReasoningCapabilities,
  buildCodexReasoningLevels,
  effortProviderOptions,
  deepMergeProviderOptions,
  thinkingProviderOptions,
  getAppHome,
  getLegacyAppHome,
  getConfigPath,
  getProvidersPath,
  getLogsPath,
  getVertexModelsPath,
  getLegacyConfPath,
  contextWindowFromHeuristics,
  resolveContextWindow,
  stripOneMContextSuffix,
  claudeCodeClientModelId,
  routeLookupIds,
  readOpencodeAuthFile,
  isOpencodeOAuth,
  oauthCredentialToKeychainJson,
  tokensToStoredCredential,
  supportsNativeOAuth,
  isBrowserRedirectOAuth,
  requestGithubDeviceCode,
  pollGithubDeviceCodeToken,
  runGithubDeviceCodeFlow,
  requestXaiDeviceCode,
  pollXaiDeviceCodeToken,
  runXaiDeviceCodeFlow,
  generateCliUserID,
  runClaudeCodeOAuthFlow,
  fetchClaudeCodeModels,
  guiCallbackRedirectUri,
  ANTIGRAVITY_BASE_URLS,
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
  resolveProviderOAuthAccountId,
  resolveProviderOAuthProviderData,
  enrichGithubCopilotOAuthProviderData,
  saveProviderCredential,
  deleteProviderCredential,
  readFromCredentialStore,
  saveToCredentialStore,
  isSecretServiceAvailable,
  migrateLegacyCloudProviders,
  isValidProviderId,
  slugifyProviderId,
  customProviderId,
  supportsManualModels,
  getProviderModels,
  modelIdError,
  contextWindowError,
  loadRegistry,
  saveRegistry,
  validateCustomEndpointUrl,
  extractClaudeSessionId,
  SubagentRouteRegistry,
  claudeModelFamily,
  grabRoundTripSignature,
  silenceSdkWarnings,
  parseToolArguments,
  sseChunk,
  parseDsmlToolCalls,
  splitToolUseId,
  encodeToolUseId,
  serializeToolResultContent,
  normalizeToolSchemaForNpm,
  formatUpstreamErrorTrace,
  formatUpstreamError,
  upstreamHttpStatus,
  anthropicErrorType,
  anthropicEffortFromRequest,
  translateRequest,
  streamAnthropicResponse,
  generateAnthropicResponse
};
//# sourceMappingURL=chunk-7ASGPECN.js.map