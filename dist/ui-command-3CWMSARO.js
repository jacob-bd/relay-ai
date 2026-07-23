#!/usr/bin/env node
import {
  BACKENDS,
  MAX_MODEL_CATALOG,
  VERSION,
  addCustomEndpointProvider,
  addProviderFromTemplate,
  buildAntigravityAuthUrl,
  buildDedupedModelRows,
  checkForUpdates,
  completeAntigravityExchange,
  copilotPlanTier,
  createGatewayModelCatalog,
  ensureOpencodeCloudProviders,
  favoriteProviderDisplayName,
  fetchProviderCatalog,
  filterServerModelsByFavorites,
  filterServerModelsByFreeStatus,
  filterServerModelsByProviders,
  findBinaryOnPath,
  findClaudeApp,
  findCodexApp,
  formatGatewayUrls,
  freeStatusLabel,
  gatewayProviderLabel,
  getAppHome,
  getAppPathOverride,
  getEnvServerPassword,
  getSavedServerPassword,
  getServerDebugLogPath,
  getServerExposedProviders,
  getServerFavoritesOnly,
  getServerFreeModelsOnly,
  getServerListenMode,
  getServerMaskGatewayIds,
  getUiDebugLogPath,
  guiCallbackRedirectUri,
  hostFromHeader,
  loadPreferences,
  loadRegistry,
  loadServerModels,
  makeTraceLogger,
  openAiDeviceCodeUrl,
  openAiIdCollisions,
  pollGithubDeviceCodeToken,
  pollOpenAiDeviceCodeToken,
  pollXaiDeviceCodeToken,
  providerOptionsFromCatalog,
  readBody,
  recordLaunchFolder,
  refreshAllProviderModels,
  refreshProviderModels,
  removeProviderFromRegistry,
  requestGithubDeviceCode,
  requestOpenAiDeviceCode,
  requestXaiDeviceCode,
  resolveAdvertiseAddresses,
  resolveAdvertiseGatewayPort,
  resolveProviderCredential,
  resolveServerUpstreamApiKey,
  saveNativeOAuthCredential,
  savePreferences,
  saveProviderCredential,
  sendJson,
  setAppPathOverride,
  setSavedServerPassword,
  setServerExposedProviders,
  setServerFavoritesOnly,
  setServerFreeModelsOnly,
  setServerListenMode,
  setServerMaskGatewayIds,
  startServer,
  summarizeServerProviders,
  supportsClaudeTransparentMode,
  validateCustomEndpointUrl,
  writeSecureLogLine
} from "./chunk-IYYLLN5T.js";
import {
  __toCommonJS,
  init_provider_templates,
  listAddableTemplates,
  listVisibleOAuthTemplates,
  provider_templates_exports
} from "./chunk-EJONCU3B.js";

// src/ui-command.ts
import { createServer } from "http";
import { readFileSync, readdirSync, writeFileSync as writeFileSync2, unlinkSync, existsSync as existsSync3, mkdirSync } from "fs";
import { join as join2 } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import pc from "picocolors";
import * as p from "@clack/prompts";

// src/native-launcher.ts
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from "fs";
import { homedir } from "os";
import { tmpdir } from "os";
import { join } from "path";
var isWindows = process.platform === "win32";
var isMac = process.platform === "darwin";
var SUPPORTED_APPS = [
  { id: "claude", name: "Claude Code CLI", type: "cli", detectId: "claude", relayCommand: "claude" },
  { id: "codex", name: "Codex CLI", type: "cli", detectId: "codex", relayCommand: "codex" },
  { id: "gemini", name: "Gemini CLI", type: "cli", detectId: "gemini", relayCommand: "gemini" },
  { id: "agy", name: "Antigravity CLI", type: "cli", detectId: "agy", relayCommand: "agy" },
  {
    id: "antigravity",
    name: "Antigravity (App)",
    type: "app",
    detectId: "antigravity",
    relayCommand: "antigravity"
  },
  {
    id: "antigravity-ide",
    name: "Antigravity IDE (App)",
    type: "app",
    detectId: "antigravity-ide",
    relayCommand: "antigravity-ide"
  },
  {
    id: "claude-app",
    name: "Claude Code Desktop",
    type: "app",
    detectId: "claude-app",
    relayCommand: "claude-app"
  },
  {
    id: "codex-app",
    name: "ChatGPT Desktop (Codex)",
    type: "app",
    detectId: "codex-app",
    relayCommand: "codex-app"
  }
];
function fallbackPathsForApp(id, platform = process.platform) {
  const windows = platform === "win32";
  const mac = platform === "darwin";
  const appData = process.env["APPDATA"] ?? homedir();
  const localAppData = process.env["LOCALAPPDATA"] ?? join(homedir(), "AppData", "Local");
  switch (id) {
    case "claude":
      return windows ? [
        join(appData, "npm", "claude.cmd"),
        join(appData, "npm", "claude")
      ] : [
        join(homedir(), ".local", "bin", "claude"),
        join(homedir(), ".npm", "bin", "claude"),
        "/usr/local/bin/claude",
        "/opt/homebrew/bin/claude"
      ];
    case "codex":
      return windows ? [
        join(appData, "npm", "codex.cmd"),
        join(appData, "npm", "codex")
      ] : [
        join(homedir(), ".local", "bin", "codex"),
        join(homedir(), ".npm", "bin", "codex"),
        "/usr/local/bin/codex",
        "/opt/homebrew/bin/codex"
      ];
    case "gemini":
      return windows ? [
        join(appData, "npm", "gemini.cmd"),
        join(appData, "npm", "gemini")
      ] : [
        join(homedir(), ".local", "bin", "gemini"),
        join(homedir(), ".npm", "bin", "gemini"),
        "/usr/local/bin/gemini",
        "/opt/homebrew/bin/gemini"
      ];
    case "agy":
      return windows ? [
        join(appData, "npm", "agy.cmd"),
        join(appData, "npm", "agy"),
        join(localAppData, "Antigravity", "agy.exe")
      ] : [
        join(homedir(), ".local", "bin", "agy"),
        join(homedir(), ".npm", "bin", "agy"),
        "/usr/local/bin/agy",
        "/opt/homebrew/bin/agy"
      ];
    case "antigravity-ide":
      if (mac) {
        return [
          "/Applications/Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide",
          join(homedir(), "Applications", "Antigravity IDE.app", "Contents", "Resources", "app", "bin", "antigravity-ide")
        ];
      }
      if (windows) {
        return [
          join(localAppData, "Programs", "Antigravity IDE", "Antigravity IDE.exe"),
          join(localAppData, "Programs", "antigravity-ide", "Antigravity IDE.exe"),
          join(localAppData, "Programs", "Antigravity", "Antigravity IDE.exe")
        ];
      }
      return ["/opt/antigravity-ide/Antigravity-IDE"];
    case "antigravity":
      if (mac) {
        return [
          "/Applications/Antigravity.app/Contents/MacOS/Antigravity",
          join(homedir(), "Applications", "Antigravity.app", "Contents", "MacOS", "Antigravity")
        ];
      }
      if (windows) {
        return [
          join(localAppData, "Programs", "Antigravity", "Antigravity.exe")
        ];
      }
      return [
        "/opt/antigravity/antigravity",
        "/usr/local/bin/antigravity",
        "/usr/bin/antigravity"
      ];
    case "claude-app":
      if (mac) {
        return [
          "/Applications/Claude.app/Contents/MacOS/Claude",
          join(homedir(), "Applications", "Claude.app", "Contents", "MacOS", "Claude")
        ];
      }
      return windows ? [join(localAppData, "Programs", "claude", "Claude.exe")] : [];
    case "codex-app":
      if (mac) {
        return [
          "/Applications/ChatGPT.app",
          join(homedir(), "Applications", "ChatGPT.app"),
          "/Applications/Codex.app",
          join(homedir(), "Applications", "Codex.app")
        ];
      }
      return windows ? [
        join(localAppData, "Programs", "ChatGPT", "ChatGPT.exe"),
        join(localAppData, "Programs", "OpenAI ChatGPT", "ChatGPT.exe"),
        join(localAppData, "openai-chatgpt-electron", "ChatGPT.exe"),
        join(localAppData, "Programs", "Codex", "Codex.exe"),
        join(localAppData, "Programs", "OpenAI Codex", "Codex.exe"),
        join(localAppData, "openai-codex-electron", "Codex.exe")
      ] : [];
    default:
      return [];
  }
}
var FALLBACKS = Object.fromEntries(
  SUPPORTED_APPS.map((app) => [app.detectId, fallbackPathsForApp(app.detectId)])
);
function getSupportedApp(id) {
  return SUPPORTED_APPS.find((app) => app.id === id);
}
function detectApp(id) {
  const override = getAppPathOverride(id);
  if (override) {
    return existsSync(override) ? { installed: true, path: override, pathSource: "override" } : { installed: false, path: override, pathSource: "override" };
  }
  const resolvedPath = findBinaryOnPath(id, FALLBACKS[id] ?? [], { verifyWhichResult: true });
  if (resolvedPath) {
    return { installed: true, path: resolvedPath, pathSource: "auto" };
  }
  const appFinder = id === "claude-app" ? findClaudeApp : id === "codex-app" ? findCodexApp : null;
  if (appFinder) {
    const appPath = appFinder();
    if (appPath) return { installed: true, path: appPath, pathSource: "auto" };
  }
  return { installed: false, path: null, pathSource: null };
}
function getTerminalLaunchCommand(binPath, args, opts = {}) {
  const fullCmd = [binPath, ...args].map((arg) => {
    if (!/^[a-zA-Z0-9\-_./:]+$/.test(arg)) {
      throw new Error(`Unsafe launch argument: ${JSON.stringify(arg)}`);
    }
    return arg;
  }).join(" ");
  const cwdPrefix = opts.cwd ? `cd ${quoteShellArg(opts.cwd)} && ` : "";
  const runCmd = `${cwdPrefix}${fullCmd}`;
  if (isMac) {
    const dir2 = mkdtempSync(join(tmpdir(), "relay-ai-launch-"));
    const scriptPath2 = join(dir2, "launch.command");
    const displayCommand = opts.displayCommand ?? [binPath, ...args].join(" ");
    writeFileSync(scriptPath2, [
      "#!/bin/sh",
      `trap 'rm -f "$0"; rmdir "$(dirname "$0")" 2>/dev/null' EXIT`,
      "clear",
      opts.cwd ? `cd ${quoteShellArg(opts.cwd)} || exit 1` : "",
      `printf '%s\\n\\n' ${quoteShellArg(`$ ${displayCommand}`)}`,
      fullCmd,
      "status=$?",
      'printf "\\nRelay AI session exited with code %s. Press Return to close this window. " "$status"',
      "read _",
      'exit "$status"',
      ""
    ].join("\n"), { encoding: "utf8", mode: 448 });
    chmodSync(scriptPath2, 448);
    return `open -a Terminal ${quoteShellArg(scriptPath2)}`;
  }
  if (isWindows) {
    const dirFlag = opts.cwd ? `/d "${opts.cwd}" ` : "";
    return `start "Relay AI Terminal" ${dirFlag}cmd.exe /k "${fullCmd}"`;
  }
  const dir = mkdtempSync(join(tmpdir(), "relay-ai-launch-"));
  const scriptPath = join(dir, "launch.sh");
  writeFileSync(scriptPath, [
    "#!/bin/sh",
    runCmd,
    "exec sh",
    ""
  ].join("\n"), { encoding: "utf8", mode: 448 });
  chmodSync(scriptPath, 448);
  const scriptArg = quoteShellArg(scriptPath);
  return `x-terminal-emulator -e sh ${scriptArg} || gnome-terminal -- sh ${scriptArg} || xterm -e sh ${scriptArg}`;
}
function quoteShellArg(value) {
  if (/^[a-zA-Z0-9\-_./]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}
function relayCliPath() {
  return "relay-ai";
}
function getRelayLaunchCommand(appId, options = {}) {
  const app = getSupportedApp(appId);
  if (!app) throw new Error(`Unsupported app: ${appId}`);
  const args = [app.relayCommand];
  if (options.trace) {
    args.push("--trace");
  }
  if (options.httpProxy) {
    if (app.id !== "claude") {
      throw new Error("Transparent proxy mode is available only for Claude Code CLI.");
    }
    args.push("--http-proxy");
  }
  if (options.providerId && options.modelId) {
    args.push("--provider", options.providerId, "--model", options.modelId);
  } else if (options.providerId || options.modelId) {
    throw new Error("Both providerId and modelId are required for an explicit Relay launch.");
  }
  return getTerminalLaunchCommand(relayCliPath(), args, {
    cwd: options.cwd,
    displayCommand: ["relay-ai", ...args].join(" ")
  });
}
function getSupportedApps() {
  return SUPPORTED_APPS.map((app) => {
    const { installed, path, pathSource } = detectApp(app.detectId);
    return {
      id: app.id,
      name: app.name,
      type: app.type,
      installed,
      path,
      pathSource,
      relayCommand: app.relayCommand,
      launchCommand: installed ? getRelayLaunchCommand(app.id) : null
    };
  });
}

// src/ui/api.ts
import { exec } from "child_process";
import { promisify } from "util";
import { existsSync as existsSync2, statSync } from "fs";
import { randomUUID } from "crypto";
init_provider_templates();

// src/ui/server-control.ts
var running = null;
var startInFlight = null;
var SAVED_PASSWORD_CACHE_TTL_MS = 3e4;
var hasSavedPasswordCache = null;
async function hasSavedPasswordCached() {
  const now = Date.now();
  if (hasSavedPasswordCache && hasSavedPasswordCache.expiresAt > now) return hasSavedPasswordCache.value;
  const value = Boolean(await getSavedServerPassword());
  hasSavedPasswordCache = { value, expiresAt: now + SAVED_PASSWORD_CACHE_TTL_MS };
  return value;
}
function buildModelRows(models, gateway) {
  const groups = /* @__PURE__ */ new Map();
  for (const model of models) {
    const label = gatewayProviderLabel(model);
    const list = groups.get(label);
    if (list) list.push(model);
    else groups.set(label, [model]);
  }
  const collisions = openAiIdCollisions(models);
  const rows = [];
  for (const [providerLabel, groupModels] of groups) {
    for (const row of buildDedupedModelRows(groupModels, gateway, collisions)) rows.push({ providerLabel, ...row });
  }
  return rows.sort((a, b) => a.providerLabel.localeCompare(b.providerLabel) || a.name.localeCompare(b.name));
}
async function buildSavedConfig() {
  const envPassword = getEnvServerPassword();
  return {
    favoritesOnly: getServerFavoritesOnly(),
    freeModelsOnly: getServerFreeModelsOnly(),
    exposedProviders: getServerExposedProviders(),
    maskGatewayIds: getServerMaskGatewayIds(),
    listenMode: getServerListenMode(),
    hasSavedPassword: await hasSavedPasswordCached(),
    hasEnvPassword: Boolean(envPassword),
    ...envPassword ? { prefillPassword: envPassword } : {}
  };
}
async function getServerStatus(opts) {
  const saved = await buildSavedConfig();
  if (!running) return { running: false, saved };
  const { handle, config, serverPassword, providerSummary, modelRows } = running;
  const publicPort = resolveAdvertiseGatewayPort(handle.port);
  const loopback = formatGatewayUrls("127.0.0.1", publicPort);
  const payload = {
    running: true,
    saved,
    listenMode: config.listenMode,
    anthropicUrl: loopback.anthropicUrl,
    openaiUrl: loopback.openaiUrl,
    exposedProviders: config.exposedProviders,
    favoritesOnly: config.favoritesOnly,
    freeModelsOnly: config.freeModelsOnly,
    maskGatewayIds: config.maskGatewayIds,
    providerSummary,
    models: modelRows
  };
  if (config.listenMode === "network") {
    payload.networkUrls = resolveAdvertiseAddresses({ requestHost: opts?.requestHost }).map(
      ({ name, address }) => {
        const urls = formatGatewayUrls(address, publicPort);
        return { name, anthropicUrl: urls.anthropicUrl, openaiUrl: urls.openaiUrl };
      }
    );
    payload.apiKey = serverPassword ?? void 0;
  } else {
    payload.apiKey = "any non-empty value";
  }
  return payload;
}
function startGatewayServer(req, opts) {
  if (running) return Promise.resolve({ ok: false, error: "Server is already running. Stop it first." });
  if (startInFlight) return startInFlight;
  startInFlight = doStartGatewayServer(req, opts).finally(() => {
    startInFlight = null;
  });
  return startInFlight;
}
async function doStartGatewayServer(req, opts) {
  if (req.listenMode !== "local" && req.listenMode !== "network") {
    return { ok: false, error: "Invalid listen mode." };
  }
  const apiKey = await resolveServerUpstreamApiKey();
  if (!apiKey) {
    return { ok: false, error: "No providers configured. Add a provider in Providers & Keys first." };
  }
  let serverPassword = null;
  if (req.listenMode === "network") {
    if (req.passwordMode === "saved") {
      const configured = await getSavedServerPassword() ?? getEnvServerPassword();
      if (!configured) {
        return {
          ok: false,
          error: "No configured password found \u2014 set RELAY_AI_SERVER_PASSWORD, or enter a new password."
        };
      }
      serverPassword = configured;
    } else {
      const trimmed = (req.password ?? "").trim();
      if (!trimmed) {
        const configured = getEnvServerPassword() ?? await getSavedServerPassword();
        if (!configured) return { ok: false, error: "A server password is required for network mode." };
        serverPassword = configured;
      } else {
        serverPassword = trimmed;
        if (req.savePassword) {
          await setSavedServerPassword(trimmed);
          hasSavedPasswordCache = { value: true, expiresAt: Date.now() + SAVED_PASSWORD_CACHE_TTL_MS };
        }
      }
    }
  }
  let models;
  try {
    models = await loadServerModels();
  } catch (err) {
    return { ok: false, error: `Failed to load models: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (req.exposedProviders) models = filterServerModelsByProviders(models, req.exposedProviders);
  if (req.favoritesOnly) {
    const favorites = loadPreferences().favoriteModels ?? [];
    if (favorites.length === 0) {
      return { ok: false, error: "No favorite models configured. Add favorites in the Favorites tab first." };
    }
    models = filterServerModelsByFavorites(models, favorites).slice(0, MAX_MODEL_CATALOG);
    if (models.length === 0) {
      return { ok: false, error: "No favorite models matched the current provider filter." };
    }
  }
  if (req.freeModelsOnly) {
    models = filterServerModelsByFreeStatus(models);
    if (models.length === 0) {
      return { ok: false, error: "No free models matched the current server filters." };
    }
  }
  if (models.length === 0) {
    return { ok: false, error: "No models to expose. Add providers or adjust the exposed-provider filter." };
  }
  setServerFavoritesOnly(req.favoritesOnly);
  setServerFreeModelsOnly(req.freeModelsOnly);
  if (!req.favoritesOnly) {
    setServerExposedProviders(req.exposedProviders ?? []);
  }
  setServerMaskGatewayIds(req.maskGatewayIds);
  setServerListenMode(req.listenMode);
  const host = req.listenMode === "network" ? "0.0.0.0" : "127.0.0.1";
  const gateway = req.maskGatewayIds ? { maskGatewayIds: true } : void 0;
  let handle;
  try {
    handle = await startServer({
      host,
      port: 17645,
      apiKey,
      serverPassword,
      catalog: createGatewayModelCatalog(models, gateway),
      backends: BACKENDS,
      gateway,
      debugLogPath: getServerDebugLogPath()
    });
  } catch (err) {
    const code = err?.code;
    const message = code === "EADDRINUSE" ? "Port 17645 is already in use \u2014 stop the other relay-ai server instance first." : `Failed to start server: ${err instanceof Error ? err.message : String(err)}`;
    return { ok: false, error: message };
  }
  running = {
    handle,
    serverPassword,
    config: {
      favoritesOnly: req.favoritesOnly,
      freeModelsOnly: req.freeModelsOnly,
      exposedProviders: req.exposedProviders,
      maskGatewayIds: req.maskGatewayIds,
      listenMode: req.listenMode
    },
    providerSummary: summarizeServerProviders(models),
    modelRows: buildModelRows(models, gateway)
  };
  return { ok: true, status: await getServerStatus({ requestHost: opts?.requestHost }) };
}
async function stopGatewayServer() {
  if (running) {
    await running.handle.close();
    running = null;
    return { ok: true, stopped: true };
  }
  return { ok: true, stopped: false };
}

// src/ui/api.ts
var execAsync = promisify(exec);
var MODELS_TIMEOUT_MS = 3e4;
var oauthSessions = /* @__PURE__ */ new Map();
async function fetchModelsWithTimeout(opts) {
  const timeout = new Promise(
    (_, reject) => setTimeout(() => reject(new Error("timeout")), MODELS_TIMEOUT_MS)
  );
  return Promise.race([fetchProviderCatalog(opts), timeout]);
}
function sendCatalogFetchError(res, err, label) {
  const isTimeout = String(err).includes("timeout");
  sendJson(res, isTimeout ? 504 : 500, { error: isTimeout ? `${label} timed out` : String(err) });
}
function isLoopbackOrigin(origin) {
  if (!origin) return false;
  try {
    const hostname = new URL(origin).hostname;
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
  } catch {
    return false;
  }
}
function sendCors(req, res) {
  const origin = req.headers.origin;
  const originValue = Array.isArray(origin) ? origin[0] : origin;
  if (isLoopbackOrigin(originValue)) {
    res.setHeader("Access-Control-Allow-Origin", originValue);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
function traceUi(opts, message) {
  if (!opts?.trace || !opts.traceLogPath) return;
  writeSecureLogLine(opts.traceLogPath, `${(/* @__PURE__ */ new Date()).toISOString()} ${message}`);
}
function notifyServerLifecycle(opts, event) {
  try {
    opts.onServerLifecycle?.(event);
  } catch {
  }
}
function handleUiApiRequest(req, res, opts = {}) {
  sendCors(req, res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  const url = req.url ?? "";
  traceUi(opts, `${req.method ?? "GET"} ${url}`);
  if (url === "/api/config" && req.method === "GET") {
    handleGetConfig(res);
  } else if (url === "/api/update-status" && req.method === "GET") {
    handleGetUpdateStatus(res);
  } else if (url === "/api/config" && req.method === "POST") {
    handlePostConfig(req, res);
  } else if (url === "/api/models" && req.method === "GET") {
    handleGetModels(res);
  } else if (url === "/api/keys" && req.method === "POST") {
    handlePostKeys(req, res);
  } else if (url === "/api/providers/refresh" && req.method === "POST") {
    handleProviderRefresh(req, res);
  } else if (url === "/api/providers/refresh-all" && req.method === "POST") {
    handleRefreshAll(res);
  } else if (url === "/api/providers/templates" && req.method === "GET") {
    handleGetTemplates(res);
  } else if (url === "/api/providers/add" && req.method === "POST") {
    handleAddProvider(req, res);
  } else if (url === "/api/providers/add-custom" && req.method === "POST") {
    handleAddCustomProvider(req, res);
  } else if (url === "/api/providers/delete" && req.method === "POST") {
    handleDeleteProvider(req, res);
  } else if (url === "/api/providers/oauth/start" && req.method === "POST") {
    handleOAuthStart(req, res);
  } else if (url.startsWith("/api/providers/oauth/status") && req.method === "GET") {
    handleOAuthStatus(req, res);
  } else if (url.startsWith("/oauth/callback") && req.method === "GET") {
    handleOAuthCallback(req, res);
  } else if (url.startsWith("/api/apps")) {
    if (opts.uiMode === "server") {
      sendJson(res, 403, { error: "App launch is unavailable in server admin UI mode." });
      return;
    }
    if (url === "/api/apps" && req.method === "GET") handleGetApps(res);
    else if (url === "/api/apps/path" && req.method === "POST") handleSetAppPath(req, res);
    else if (url === "/api/apps/launch" && req.method === "POST") handleLaunchApp(req, res, opts);
    else if (url === "/api/apps/browse-folder" && req.method === "POST") handleBrowseFolder(res);
    else sendJson(res, 404, { error: "Not found" });
  } else if (url === "/api/server/status" && req.method === "GET") {
    handleGetServerStatus(req, res);
  } else if (url === "/api/server/providers" && req.method === "GET") {
    handleGetServerProviders(res);
  } else if (url === "/api/server/start" && req.method === "POST") {
    handleStartServer(req, res, opts);
  } else if (url === "/api/server/stop" && req.method === "POST") {
    handleStopServer(res, opts);
  } else {
    sendJson(res, 404, { error: "Not found" });
  }
}
async function handleGetUpdateStatus(res) {
  sendJson(res, 200, await checkForUpdates());
}
function handleGetConfig(res) {
  const prefs = loadPreferences();
  sendJson(res, 200, {
    favoriteModels: prefs.favoriteModels ?? [],
    antigravityCliFavoriteModels: prefs.antigravityCliFavoriteModels ?? []
  });
}
async function handlePostConfig(req, res) {
  try {
    const body = JSON.parse(await readBody(req));
    const update = {};
    if (Array.isArray(body.favoriteModels)) update.favoriteModels = body.favoriteModels;
    if (Array.isArray(body.antigravityCliFavoriteModels)) update.antigravityCliFavoriteModels = body.antigravityCliFavoriteModels;
    if (Object.keys(update).length > 0) savePreferences(update);
    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 400, { error: String(err) });
  }
}
async function handleGetModels(res) {
  try {
    const catalog = (await fetchModelsWithTimeout()).filter((provider) => provider.authType !== "oauth" || DEVICE_CODE_PROVIDER_IDS.has(provider.id));
    const registry = loadRegistry();
    const rawCountById = new Map(registry.providers.map((p2) => [p2.id, p2.modelsCache?.models.length ?? 0]));
    const providers = catalog.map((p2) => ({
      id: p2.id,
      name: p2.name,
      favoriteName: favoriteProviderDisplayName(p2),
      hasKey: Boolean(p2.apiKey),
      freeAccess: !p2.apiKey && (() => {
        const t = registry.providers.find((rp) => rp.id === p2.id)?.templateId ?? p2.id;
        const { getTemplateById } = (init_provider_templates(), __toCommonJS(provider_templates_exports));
        return getTemplateById(t)?.anonymousFreeModels === true;
      })(),
      authType: p2.authType ?? "api",
      // Copilot's runtime catalog is policy-filtered by account plan. Never replace
      // that safe count with the larger raw cache count.
      modelCount: p2.id === "github-copilot" ? p2.models.length : rawCountById.get(p2.id) ?? p2.models.length,
      ...p2.id === "github-copilot" ? { subscription: copilotSubscription(p2.providerData) } : {},
      models: p2.models.map((m) => ({
        id: m.id,
        name: m.name,
        isFree: m.isFree ?? false,
        freeStatus: m.freeStatus,
        freeLabel: freeStatusLabel(m.freeStatus),
        contextWindow: m.contextWindow,
        cost: m.cost,
        claudeTransparentCompatible: supportsClaudeTransparentMode(m)
      }))
    }));
    const materializedIds = new Set(catalog.map((p2) => p2.id));
    for (const rp of registry.providers) {
      if (rp.authType !== "oauth" || !DEVICE_CODE_PROVIDER_IDS.has(rp.id) || !rp.enabled || materializedIds.has(rp.id)) continue;
      const credential = await resolveProviderCredential(rp.id, rp.authRef).catch(() => null);
      if (!credential) continue;
      providers.push({
        id: rp.id,
        name: rp.name,
        favoriteName: favoriteProviderDisplayName({ id: rp.id, name: rp.name, authType: rp.authType }),
        hasKey: true,
        freeAccess: false,
        authType: "oauth",
        modelCount: 0,
        ...rp.id === "github-copilot" ? { subscription: copilotSubscription(void 0) } : {},
        models: []
      });
    }
    sendJson(res, 200, { providers });
  } catch (err) {
    sendCatalogFetchError(res, err, "Model fetch");
  }
}
function copilotSubscription(providerData) {
  const tier = copilotPlanTier(providerData);
  if (tier === "free") return { tier, label: "Copilot Free" };
  if (tier === "paid") return { tier, label: "Copilot Paid" };
  return { tier, label: "Plan unverified" };
}
async function handlePostKeys(req, res) {
  try {
    const body = JSON.parse(await readBody(req));
    const { providerId, key } = body;
    if (!providerId || typeof providerId !== "string") {
      sendJson(res, 400, { error: "providerId required" });
      return;
    }
    if (!key || typeof key !== "string" || key.trim().length === 0) {
      sendJson(res, 400, { error: "key must be a non-empty string" });
      return;
    }
    const authRef = `keyring:provider:${providerId}`;
    const saved = await saveProviderCredential(authRef, key.trim());
    if (saved) {
      sendJson(res, 200, { ok: true });
    } else {
      sendJson(res, 500, { error: "Credential store unavailable \u2014 key not saved" });
    }
  } catch (err) {
    sendJson(res, 400, { error: String(err) });
  }
}
var CUSTOM_TEMPLATES = [
  { id: "__custom_openai__", name: "Custom OpenAI-compatible", signupUrl: null, authType: "api", custom: true },
  { id: "__custom_anthropic__", name: "Custom Anthropic-compatible", signupUrl: null, authType: "api", custom: true }
];
function handleGetTemplates(res) {
  const registry = loadRegistry();
  const configured = new Set(registry.providers.map((p2) => p2.id));
  const apiTemplates = listAddableTemplates(configured).map((t) => ({
    id: t.id,
    name: t.name,
    signupUrl: t.signupUrl ?? null,
    authType: t.authType,
    anonymousFreeModels: t.anonymousFreeModels ?? false,
    urlPrompt: t.urlPrompt ?? null,
    defaultBaseUrl: t.defaultBaseUrl ?? null,
    apiKeyOptional: t.apiKeyOptional ?? false,
    custom: false
  }));
  const oauthTemplates = listVisibleOAuthTemplates(configured).map((t) => ({
    id: t.id,
    name: t.name,
    signupUrl: t.signupUrl ?? null,
    authType: t.authType,
    subscriptionRisk: t.subscriptionRisk ?? false,
    custom: false
  }));
  sendJson(res, 200, { templates: [...apiTemplates, ...oauthTemplates, ...CUSTOM_TEMPLATES] });
}
async function handleAddCustomProvider(req, res) {
  try {
    const body = JSON.parse(await readBody(req));
    const { kind, displayName, baseUrl, apiKey = "", headers } = body;
    if (kind !== "openai" && kind !== "anthropic") {
      sendJson(res, 400, { error: 'kind must be "openai" or "anthropic"' });
      return;
    }
    if (!displayName?.trim()) {
      sendJson(res, 400, { error: "displayName required" });
      return;
    }
    if (!baseUrl?.trim()) {
      sendJson(res, 400, { error: "baseUrl required" });
      return;
    }
    const result = await addCustomEndpointProvider({
      kind,
      displayName: displayName.trim(),
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      allowInsecureLocal: true,
      headers: headers && Object.keys(headers).length > 0 ? headers : void 0
    });
    if (result.added) {
      sendJson(res, 200, { ok: true, name: displayName.trim(), count: result.modelCount ?? 0 });
    } else {
      sendJson(res, 200, { ok: false, error: result.error, hint: result.hint });
    }
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
}
async function handleAddProvider(req, res) {
  try {
    const body = JSON.parse(await readBody(req));
    const { templateId, key, baseUrl } = body;
    if (!templateId || typeof templateId !== "string") {
      sendJson(res, 400, { error: "templateId required" });
      return;
    }
    const { listSupportedTemplates } = await import("./provider-templates-BPGB5V2L.js");
    const template = listSupportedTemplates().find((t) => t.id === templateId);
    if (!template) {
      sendJson(res, 404, { error: `Template '${templateId}' not found` });
      return;
    }
    const rawKey = typeof key === "string" ? key.trim() : "";
    if (!rawKey && !template.anonymousFreeModels && !template.apiKeyOptional) {
      sendJson(res, 400, { error: "key must be a non-empty string" });
      return;
    }
    const keyText = template.apiKeyOptional && !rawKey && !template.anonymousFreeModels ? template.id : rawKey;
    let baseUrlOverride;
    if (template.urlPrompt) {
      baseUrlOverride = typeof baseUrl === "string" ? baseUrl.trim() : "";
      if (!baseUrlOverride) {
        sendJson(res, 400, { error: "baseUrl required" });
        return;
      }
      const usesHttp = /^http:\/\//i.test(baseUrlOverride);
      const valid = await validateCustomEndpointUrl(baseUrlOverride, { allowInsecureLocal: usesHttp });
      if (!valid.ok) {
        sendJson(res, 400, { error: valid.error ?? "Invalid URL", hint: valid.hint });
        return;
      }
    }
    const result = await addProviderFromTemplate(template, keyText, { baseUrl: baseUrlOverride });
    if (result.added) {
      sendJson(res, 200, { ok: true, name: template.name, count: result.modelCount ?? 0 });
    } else {
      sendJson(res, 200, { ok: false, error: result.error, hint: result.hint });
    }
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
}
async function handleRefreshAll(res) {
  try {
    const result = await refreshAllProviderModels(async (provider) => {
      if (!provider.authRef) return null;
      return resolveProviderCredential(provider.id, provider.authRef);
    });
    const summary = result.refreshed.map((r) => {
      const isOAuthExpected = !r.ok && !r.skipped && r.reason?.includes("OAuth token");
      return {
        id: r.id,
        name: r.name,
        ok: r.ok || isOAuthExpected,
        count: r.modelCount ?? r.previousModelCount ?? 0,
        skipped: r.skipped ?? isOAuthExpected,
        oauthWarning: isOAuthExpected,
        reason: r.reason
      };
    });
    sendJson(res, 200, { ok: true, providers: summary, total: summary.reduce((n, p2) => n + p2.count, 0) });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: String(err) });
  }
}
async function handleProviderRefresh(req, res) {
  try {
    const body = JSON.parse(await readBody(req));
    const { providerId } = body;
    if (!providerId || typeof providerId !== "string") {
      sendJson(res, 400, { error: "providerId required" });
      return;
    }
    const registry = loadRegistry();
    const registryProvider = registry.providers.find((p2) => p2.id === providerId);
    if (!registryProvider) {
      sendJson(res, 200, { ok: false, error: "Provider not found in registry" });
      return;
    }
    const apiKey = await resolveProviderCredential(providerId, registryProvider.authRef);
    const result = await refreshProviderModels(providerId, apiKey, registry);
    if (result.ok) {
      sendJson(res, 200, { ok: true, count: result.modelCount ?? result.previousModelCount ?? 0 });
    } else {
      sendJson(res, 200, { ok: false, error: result.reason ?? "Refresh failed" });
    }
  } catch (err) {
    sendJson(res, 200, { ok: false, error: String(err) });
  }
}
async function handleDeleteProvider(req, res) {
  try {
    const body = JSON.parse(await readBody(req));
    const { providerId } = body;
    if (!providerId || typeof providerId !== "string") {
      sendJson(res, 400, { error: "providerId required" });
      return;
    }
    const result = await removeProviderFromRegistry(providerId);
    if (result.removed) {
      sendJson(res, 200, { ok: true, name: result.name });
    } else {
      sendJson(res, 200, { ok: false, error: result.error ?? "Provider not found" });
    }
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
}
var DEVICE_CODE_PROVIDER_IDS = /* @__PURE__ */ new Set(["xai-oauth", "openai-oauth", "github-copilot"]);
var PKCE_PROVIDER_IDS = /* @__PURE__ */ new Set(["claude-code", "antigravity"]);
var NATIVE_OAUTH_PROVIDER_IDS = DEVICE_CODE_PROVIDER_IDS;
async function refreshOAuthProviderModels(providerId) {
  const registry = loadRegistry();
  const entry = registry.providers.find((p2) => p2.id === providerId);
  if (!entry) return;
  const apiKey = await resolveProviderCredential(providerId, entry.authRef);
  await refreshProviderModels(providerId, apiKey, registry);
}
async function handleOAuthStart(req, res) {
  try {
    const body = JSON.parse(await readBody(req));
    const { providerId } = body;
    if (!providerId || !NATIVE_OAUTH_PROVIDER_IDS.has(providerId)) {
      sendJson(res, 400, { error: "Unsupported OAuth provider." });
      return;
    }
    const sessionId = randomUUID();
    if (providerId === "xai-oauth") {
      const device2 = await requestXaiDeviceCode();
      const url2 = device2.verification_uri_complete ?? device2.verification_uri;
      const session2 = { status: "pending", url: url2, userCode: device2.user_code, providerId };
      oauthSessions.set(sessionId, session2);
      pollXaiDeviceCodeToken(device2).then(async (tokens) => {
        await saveNativeOAuthCredential(providerId, tokens);
        await refreshOAuthProviderModels(providerId);
        oauthSessions.set(sessionId, { ...session2, status: "done" });
      }).catch((err) => {
        oauthSessions.set(sessionId, { ...session2, status: "error", error: String(err) });
      });
      sendJson(res, 200, { sessionId, url: url2, userCode: device2.user_code });
      return;
    }
    if (providerId === "github-copilot") {
      const device2 = await requestGithubDeviceCode();
      const url2 = device2.verification_uri;
      const session2 = { status: "pending", url: url2, userCode: device2.user_code, providerId };
      oauthSessions.set(sessionId, session2);
      pollGithubDeviceCodeToken(device2).then(async (tokens) => {
        await saveNativeOAuthCredential(providerId, tokens);
        await refreshOAuthProviderModels(providerId);
        oauthSessions.set(sessionId, { ...session2, status: "done" });
      }).catch((err) => {
        oauthSessions.set(sessionId, { ...session2, status: "error", error: String(err) });
      });
      sendJson(res, 200, { sessionId, url: url2, userCode: device2.user_code });
      return;
    }
    if (PKCE_PROVIDER_IDS.has(providerId)) {
      if (providerId === "claude-code") {
        sendJson(res, 400, {
          error: "Claude Code OAuth must be completed in the terminal: relay-ai providers auth claude-code"
        });
        return;
      }
      const host = req.headers.host ?? "127.0.0.1";
      const redirectUri = guiCallbackRedirectUri(host);
      let pkce;
      if (providerId === "antigravity") {
        pkce = await buildAntigravityAuthUrl(redirectUri);
      } else {
        sendJson(res, 400, { error: `PKCE flow for "${providerId}" not yet implemented` });
        return;
      }
      const { authUrl, codeVerifier, oauthState } = pkce;
      const session2 = {
        status: "pending",
        url: authUrl,
        providerId,
        codeVerifier,
        oauthState
      };
      oauthSessions.set(sessionId, session2);
      const codePromise = new Promise((resolve, reject) => {
        session2.codeResolver = resolve;
        session2.errorRejecter = (err) => reject(new Error(err));
        setTimeout(() => reject(new Error("OAuth timeout \u2014 sign-in not completed")), 10 * 60 * 1e3);
      });
      oauthSessions.set(sessionId, session2);
      codePromise.then(async (code) => {
        let providerData = {};
        let accountId;
        let tokens;
        if (providerId === "antigravity") {
          const result = await completeAntigravityExchange(code, codeVerifier, redirectUri);
          tokens = result.tokens;
          accountId = result.userInfo.email;
          if (result.projectId) providerData.projectId = result.projectId;
          if (result.tierId) providerData.tier = result.tierId;
        } else {
          throw new Error(`Unknown PKCE provider: ${providerId}`);
        }
        await saveNativeOAuthCredential(providerId, tokens, accountId, providerData);
        await refreshOAuthProviderModels(providerId);
        oauthSessions.set(sessionId, { ...session2, status: "done" });
      }).catch((err) => {
        oauthSessions.set(sessionId, { ...session2, status: "error", error: String(err) });
      });
      sendJson(res, 200, { sessionId, authUrl, pkce: true });
      return;
    }
    const device = await requestOpenAiDeviceCode();
    const url = openAiDeviceCodeUrl();
    const session = { status: "pending", url, userCode: device.user_code, providerId };
    oauthSessions.set(sessionId, session);
    pollOpenAiDeviceCodeToken(device).then(async ({ tokens, accountId }) => {
      await saveNativeOAuthCredential(providerId, tokens, accountId);
      await refreshOAuthProviderModels(providerId);
      oauthSessions.set(sessionId, { ...session, status: "done" });
    }).catch((err) => {
      oauthSessions.set(sessionId, { ...session, status: "error", error: String(err) });
    });
    sendJson(res, 200, { sessionId, url, userCode: device.user_code });
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
}
function handleOAuthStatus(req, res) {
  const searchParams = new URL(req.url ?? "", "http://localhost").searchParams;
  const sessionId = searchParams.get("sessionId") ?? "";
  const session = oauthSessions.get(sessionId);
  if (!session) {
    sendJson(res, 404, { error: "Session not found or expired" });
    return;
  }
  sendJson(res, 200, { status: session.status, error: session.error });
  if (session.status !== "pending") oauthSessions.delete(sessionId);
}
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function callbackPage(type, message) {
  const icon = type === "success" ? "&#10003;" : "&#10007;";
  const color = type === "success" ? "#22c55e" : "#ef4444";
  const title = type === "success" ? "Authentication successful" : "Authentication failed";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0">
<div style="text-align:center;padding:2rem;background:#fff;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.1);max-width:400px">
<div style="color:${color};font-size:2.5rem">${icon}</div>
<h1 style="margin:.5rem 0">${title}</h1>
<p style="color:#666">${escapeHtml(message)}</p>
</div></body></html>`;
}
function handleOAuthCallback(req, res) {
  const sp = new URL(req.url ?? "", "http://localhost").searchParams;
  const code = sp.get("code") ?? "";
  const state = sp.get("state") ?? "";
  const error = sp.get("error") ?? "";
  let matchedSession;
  for (const session of oauthSessions.values()) {
    if (session.oauthState === state) {
      matchedSession = session;
      break;
    }
  }
  if (!matchedSession) {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end(callbackPage("error", "Unknown or expired OAuth session. Please try signing in again."));
    return;
  }
  if (error) {
    matchedSession.errorRejecter?.(error);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(callbackPage("error", `Authorization denied: ${error}`));
    return;
  }
  if (!code) {
    matchedSession.errorRejecter?.("No authorization code received");
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end(callbackPage("error", "No authorization code received. Please try again."));
    return;
  }
  matchedSession.codeResolver?.(code);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(callbackPage("success", "You can close this tab and return to relay-ai."));
}
function handleGetApps(res) {
  try {
    const apps = getSupportedApps();
    sendJson(res, 200, { apps, recentLaunchFolders: loadPreferences().recentLaunchFolders ?? [] });
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
}
var AGY_APP_IDS = /* @__PURE__ */ new Set(["antigravity", "agy", "antigravity-ide"]);
async function handleLaunchApp(req, res, opts) {
  try {
    const body = JSON.parse(await readBody(req));
    const { appId, favorites, cwd } = body;
    const httpProxy = body.httpProxy === true;
    let { providerId, modelId } = body;
    if (!appId) {
      sendJson(res, 400, { error: "Missing appId" });
      return;
    }
    if (!getSupportedApp(appId)) {
      sendJson(res, 400, { error: `Unknown app: ${appId}` });
      return;
    }
    if (body.httpProxy !== void 0 && typeof body.httpProxy !== "boolean") {
      sendJson(res, 400, { error: "httpProxy must be true or false." });
      return;
    }
    if (httpProxy && appId !== "claude") {
      sendJson(res, 400, { error: "Anthropic + Relay mode is available only for Claude Code CLI." });
      return;
    }
    const { installed, path } = detectApp(appId);
    if (!installed || !path) {
      sendJson(res, 400, { error: `App ${appId} is not installed on this system.` });
      return;
    }
    if (!favorites && (providerId || modelId) && (!providerId || !modelId)) {
      sendJson(res, 400, { error: "Both providerId and modelId are required to launch a specific Relay model." });
      return;
    }
    if (httpProxy && providerId && modelId) {
      let catalog;
      try {
        catalog = await fetchModelsWithTimeout();
      } catch (err) {
        sendCatalogFetchError(res, err, "Model validation");
        return;
      }
      const selectedModel = catalog.find((provider) => provider.id === providerId)?.models.find((model) => model.id === modelId);
      if (!selectedModel || !supportsClaudeTransparentMode(selectedModel)) {
        sendJson(res, 400, {
          error: "The selected model cannot be combined with your Anthropic login."
        });
        return;
      }
    }
    if (favorites && !httpProxy && !providerId && !modelId) {
      const prefs = loadPreferences();
      const favList = AGY_APP_IDS.has(appId) ? prefs.antigravityCliFavoriteModels ?? [] : prefs.favoriteModels ?? [];
      if (favList.length > 0) {
        providerId = favList[0].providerId;
        modelId = favList[0].modelId;
      }
    }
    const launchFolder = typeof cwd === "string" && cwd.trim() ? cwd.trim() : void 0;
    if (launchFolder) {
      try {
        if (!statSync(launchFolder).isDirectory()) {
          sendJson(res, 400, { error: "Launch folder must be a directory." });
          return;
        }
      } catch {
        sendJson(res, 400, { error: "Launch folder does not exist." });
        return;
      }
      recordLaunchFolder(launchFolder);
    }
    const launchCmd = getRelayLaunchCommand(appId, {
      providerId,
      modelId,
      cwd: launchFolder,
      trace: opts.trace,
      httpProxy
    });
    traceUi(
      opts,
      `launch app=${appId} provider=${providerId ?? ""} model=${modelId ?? ""} favorites=${Boolean(favorites)} http-proxy=${httpProxy} resolved-from-favorites=${Boolean(favorites && providerId)} cwd=${launchFolder ?? ""} command=${launchCmd}`
    );
    exec(launchCmd, (err) => {
      if (err) {
        traceUi(opts, `launch error app=${appId} error=${err.message}`);
        console.error("Failed to spawn native terminal window:", err);
      }
    });
    sendJson(res, 200, { ok: true, command: launchCmd });
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
}
async function handleSetAppPath(req, res) {
  try {
    const body = JSON.parse(await readBody(req));
    const { appId, path } = body;
    if (!appId || typeof appId !== "string") {
      sendJson(res, 400, { error: "Missing appId" });
      return;
    }
    if (path !== null && (typeof path !== "string" || !path.trim())) {
      sendJson(res, 400, { error: "path must be a non-empty string, or null to clear the override." });
      return;
    }
    const trimmed = typeof path === "string" ? path.trim() : null;
    if (trimmed && !existsSync2(trimmed)) {
      sendJson(res, 400, { error: "That path does not exist." });
      return;
    }
    setAppPathOverride(appId, trimmed);
    sendJson(res, 200, { ok: true, apps: getSupportedApps() });
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
}
async function handleGetServerStatus(req, res) {
  try {
    sendJson(res, 200, await getServerStatus({ requestHost: hostFromHeader(req.headers.host) }));
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
}
async function handleGetServerProviders(res) {
  try {
    const catalog = await fetchModelsWithTimeout({ agent: "server" });
    sendJson(res, 200, { providers: providerOptionsFromCatalog(catalog) });
  } catch (err) {
    sendCatalogFetchError(res, err, "Provider fetch");
  }
}
async function handleStartServer(req, res, opts) {
  try {
    const body = JSON.parse(await readBody(req));
    if (typeof body.favoritesOnly !== "boolean") {
      sendJson(res, 400, { error: "favoritesOnly must be a boolean" });
      return;
    }
    if (typeof body.maskGatewayIds !== "boolean") {
      sendJson(res, 400, { error: "maskGatewayIds must be a boolean" });
      return;
    }
    if (body.listenMode !== "local" && body.listenMode !== "network") {
      sendJson(res, 400, { error: 'listenMode must be "local" or "network"' });
      return;
    }
    const listenMode = opts.uiMode === "server" ? "network" : body.listenMode;
    const request = {
      favoritesOnly: body.favoritesOnly,
      freeModelsOnly: Boolean(body.freeModelsOnly),
      exposedProviders: Array.isArray(body.exposedProviders) ? body.exposedProviders : null,
      maskGatewayIds: body.maskGatewayIds,
      listenMode,
      passwordMode: body.passwordMode === "saved" ? "saved" : "new",
      password: typeof body.password === "string" ? body.password : void 0,
      savePassword: Boolean(body.savePassword)
    };
    const result = await startGatewayServer(request, {
      requestHost: hostFromHeader(req.headers.host)
    });
    if (result.ok) {
      notifyServerLifecycle(opts, {
        type: "started",
        listenMode: request.listenMode,
        modelCount: result.status.models?.length ?? 0
      });
    }
    sendJson(res, 200, result);
  } catch (err) {
    sendJson(res, 500, { ok: false, error: String(err) });
  }
}
async function handleStopServer(res, opts) {
  try {
    const result = await stopGatewayServer();
    if (result.stopped) notifyServerLifecycle(opts, { type: "stopped" });
    sendJson(res, 200, result);
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
}
async function handleBrowseFolder(res) {
  try {
    let resultPath = "";
    const isMac2 = process.platform === "darwin";
    const isWindows2 = process.platform === "win32";
    if (isMac2) {
      const script = 'POSIX path of (choose folder with prompt "Select launch folder:")';
      try {
        const { stdout } = await execAsync(`osascript -e '${script}'`);
        resultPath = stdout.trim();
      } catch (err) {
        if (err.code === 1 || String(err.stderr).includes("-128") || String(err.stdout).includes("-128")) {
          sendJson(res, 200, { ok: true, canceled: true });
          return;
        }
        throw err;
      }
    } else if (isWindows2) {
      const psCommand = [
        "try {",
        "  Add-Type -AssemblyName System.Windows.Forms",
        "  $f = New-Object System.Windows.Forms.FolderBrowserDialog",
        '  $f.Description = "Select launch folder"',
        "  $owner = New-Object System.Windows.Forms.Form",
        "  $owner.TopMost = $true",
        "  $owner.ShowInTaskbar = $false",
        '  $owner.FormBorderStyle = "None"',
        "  $owner.Opacity = 0",
        "  $owner.Width = 1",
        "  $owner.Height = 1",
        '  $owner.StartPosition = "CenterScreen"',
        "  $owner.Show()",
        "  $owner.Activate()",
        '  if ($f.ShowDialog($owner) -eq "OK") { $f.SelectedPath }',
        "  $owner.Close()",
        "} catch {",
        "  [Console]::Error.WriteLine($_.Exception.Message)",
        "  exit 1",
        "}"
      ].join("\n");
      try {
        const encoded = Buffer.from(psCommand, "utf16le").toString("base64");
        const { stdout } = await execAsync(`powershell -NoProfile -Sta -EncodedCommand ${encoded}`);
        resultPath = stdout.trim();
      } catch (err) {
        sendJson(res, 500, { error: `Failed to open folder picker: ${err instanceof Error ? err.message : String(err)}` });
        return;
      }
    } else {
      try {
        const { stdout } = await execAsync('zenity --file-selection --directory --title="Select launch folder"');
        resultPath = stdout.trim();
      } catch {
        try {
          const { stdout } = await execAsync("kdialog --getexistingdirectory .");
          resultPath = stdout.trim();
        } catch {
          sendJson(res, 500, { error: "No GUI folder picker available on this platform" });
          return;
        }
      }
    }
    if (!resultPath) {
      sendJson(res, 200, { ok: true, canceled: true });
      return;
    }
    sendJson(res, 200, { ok: true, path: resultPath });
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
}

// src/ui-command.ts
var __dirname = dirname(fileURLToPath(import.meta.url));
var PUBLIC_DIR = join2(__dirname, "ui", "public");
var LOCK_FILE = join2(getAppHome(), "ui.lock");
var DEFAULT_SERVER_UI_PORT = 8787;
var MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml"
};
function ext(path) {
  const i = path.lastIndexOf(".");
  return i >= 0 ? path.slice(i) : "";
}
function resolveUiMode(opts = {}, env = process.env) {
  if (opts.serverMode) return "server";
  return env.RELAY_AI_UI_MODE === "server" ? "server" : "full";
}
function resolveServerUiPort(opts, env) {
  if (opts.port != null) return opts.port;
  const envPort = Number(env.RELAY_AI_UI_PORT);
  return Number.isFinite(envPort) && envPort > 0 ? envPort : DEFAULT_SERVER_UI_PORT;
}
function resolveUiRuntimeConfig(opts = {}, env = process.env) {
  const mode = resolveUiMode(opts, env);
  if (mode === "server") {
    return {
      mode,
      host: "0.0.0.0",
      port: resolveServerUiPort(opts, env),
      openBrowser: false,
      confirmShutdownOnSigint: false
    };
  }
  return {
    mode,
    host: "127.0.0.1",
    port: opts.port ?? 0,
    openBrowser: true,
    confirmShutdownOnSigint: true
  };
}
function buildStaticCache(mode) {
  const cache = /* @__PURE__ */ new Map();
  try {
    for (const name of readdirSync(PUBLIC_DIR)) {
      const mime = MIME[ext(name)];
      if (!mime) continue;
      const raw = readFileSync(join2(PUBLIC_DIR, name));
      let content = raw;
      if (name === "index.html") {
        content = Buffer.from(
          raw.toString("utf8").replaceAll("{{VERSION}}", VERSION).replaceAll("{{UI_MODE}}", mode)
        );
      }
      cache.set(`/${name}`, { content, mime });
    }
  } catch {
  }
  return cache;
}
function removeLock() {
  try {
    unlinkSync(LOCK_FILE);
  } catch {
  }
}
function checkExistingServer() {
  if (!existsSync3(LOCK_FILE)) return null;
  try {
    const { pid, port } = JSON.parse(readFileSync(LOCK_FILE, "utf8"));
    process.kill(pid, 0);
    return `http://127.0.0.1:${port}`;
  } catch {
    removeLock();
    return null;
  }
}
function isUiApiRoute(url) {
  return url.startsWith("/api/") || url.startsWith("/oauth/callback");
}
function formatUiServerLifecycleMessage(event) {
  if (event.type === "stopped") return "\u25C7 Server Gateway stopped";
  const mode = event.listenMode === "network" ? "Network" : "Local";
  const modelLabel = event.modelCount === 1 ? "model" : "models";
  return `\u25C6 Server Gateway started \xB7 ${mode} mode \xB7 ${event.modelCount} ${modelLabel} exposed`;
}
async function resolveUiShutdownDecision(signal, promptClose = () => p.confirm({
  message: "Relay-AI UI is still running. Close it?",
  initialValue: true
}), opts) {
  const confirmOnSigint = opts?.confirmOnSigint !== false;
  if (signal !== "SIGINT" || !confirmOnSigint) return "close";
  const shouldClose = await promptClose();
  if (p.isCancel(shouldClose)) return "close";
  return shouldClose ? "close" : "keep";
}
async function runUiCommand(opts = {}) {
  const runtime = resolveUiRuntimeConfig(opts);
  await ensureOpencodeCloudProviders();
  const existing = checkExistingServer();
  if (existing) {
    console.log(`
  ${pc.bold("relay-ai UI")} already running at ${pc.cyan(existing)}
`);
    return 0;
  }
  if (opts.trace) {
    process.env.RELAY_AI_TRACE = "1";
  }
  const staticCache = buildStaticCache(runtime.mode);
  const traceLogPath = opts.trace ? getUiDebugLogPath() : void 0;
  const trace = traceLogPath ? makeTraceLogger(traceLogPath) : void 0;
  trace?.(`ui server starting mode=${runtime.mode}`);
  const server = createServer((req, res) => {
    const url2 = req.url ?? "/";
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (isUiApiRoute(url2)) {
      handleUiApiRequest(req, res, {
        trace: opts.trace,
        traceLogPath,
        uiMode: runtime.mode,
        onServerLifecycle: (event) => {
          console.log(`
  ${formatUiServerLifecycleMessage(event)}
`);
        }
      });
      return;
    }
    const key = url2 === "/" ? "/index.html" : url2.split("?")[0];
    trace?.(`static ${req.method ?? "GET"} ${url2} -> ${key}`);
    const cached = staticCache.get(key);
    if (cached) {
      res.writeHead(200, { "Content-Type": cached.mime });
      res.end(cached.content);
      return;
    }
    res.writeHead(404);
    res.end("Not found");
  });
  await new Promise((resolve, reject) => {
    server.listen(runtime.port, runtime.host, () => resolve());
    server.once("error", reject);
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    console.error("Failed to bind server");
    return 1;
  }
  const port = addr.port;
  const displayHost = runtime.host === "0.0.0.0" ? "127.0.0.1" : runtime.host;
  const url = `http://${displayHost}:${port}`;
  mkdirSync(getAppHome(), { recursive: true });
  writeFileSync2(LOCK_FILE, JSON.stringify({ pid: process.pid, port, mode: runtime.mode }));
  const cleanup = () => {
    removeLock();
    server.close();
    process.exit(0);
  };
  let handlingSignal = false;
  const handleSignal = async (signal) => {
    if (handlingSignal) return;
    handlingSignal = true;
    const decision = await resolveUiShutdownDecision(
      signal,
      void 0,
      { confirmOnSigint: runtime.confirmShutdownOnSigint }
    );
    if (decision === "keep") {
      handlingSignal = false;
      return;
    }
    cleanup();
  };
  process.on("SIGINT", () => {
    void handleSignal("SIGINT");
  });
  process.on("SIGTERM", () => {
    void handleSignal("SIGTERM");
  });
  const modeLabel = runtime.mode === "server" ? " (server admin)" : "";
  console.log(`
  ${pc.bold("relay-ai UI")}${modeLabel}  ${pc.cyan(url)}
  ${pc.dim("Press Ctrl+C to stop")}
`);
  if (runtime.mode === "server") {
    console.log(`  ${pc.dim("Gateway API (when started from Server tab): http://127.0.0.1:17645")}
`);
  }
  if (traceLogPath) {
    console.log(`  ${pc.dim(`Trace log: ${traceLogPath}`)}
`);
    trace?.(`ui server listening ${url}`);
  }
  if (runtime.openBrowser) {
    try {
      const { default: open } = await import("open");
      await open(url);
      trace?.(`browser open ${url}`);
    } catch {
      trace?.(`browser open failed ${url}`);
    }
  }
  await new Promise(() => {
  });
  return 0;
}
export {
  formatUiServerLifecycleMessage,
  isUiApiRoute,
  resolveUiMode,
  resolveUiRuntimeConfig,
  resolveUiShutdownDecision,
  runUiCommand
};
//# sourceMappingURL=ui-command-3CWMSARO.js.map