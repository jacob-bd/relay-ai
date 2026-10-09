#!/usr/bin/env node
import {
  getTemplateById,
  init_provider_templates
} from "./chunk-3R25QO5X.js";
import {
  ANTIGRAVITY_BASE_URLS,
  BACKENDS,
  CLAUDE_CODE_CLI_VERSION,
  CLINE_PASS_CATALOG_URL,
  CLINE_PASS_LEGACY_DEFAULT_CONTEXT_WINDOW,
  CLINE_PASS_SDK_BASE_URL,
  CLINE_PASS_VALIDATION_URL,
  EFFORT_RANK,
  GLOBAL_OPENCODE_KEYRING_ACCOUNT,
  MAX_MODEL_CATALOG,
  MIN_CONTEXT_WINDOW,
  SubagentRouteRegistry,
  UpstreamUnreachableError,
  VERSION,
  VERTEX_ANTHROPIC_NPM,
  anthropicEffortFromRequest,
  anthropicErrorType,
  buildCodexReasoningLevels,
  buildPricingIndex,
  classifyFreeStatus,
  classifyModelFormat,
  claudeCodeClientModelId,
  claudeModelFamily,
  contextWindowFromHeuristics,
  createLanguageModel,
  customProviderId,
  deleteProviderCredential,
  encodeToolUseId,
  enrichGithubCopilotOAuthProviderData,
  enrichModelsForProviderPricing,
  enrichPricingAsync,
  extractClaudeSessionId,
  fetchClaudeCodeModels,
  fetchModelsDevCache,
  fetchWithOAuthRetry,
  findModelsDevModel,
  forceRefreshProviderCredential,
  formatClineRuntimeCredential,
  formatUpstreamError,
  generateAnthropicResponse,
  generateCliUserID,
  getAppHome,
  getEnvServerPassword,
  getProviderDebugLogPath,
  getProviderModels,
  getProxyDebugLogPath,
  getReasoningCapabilities,
  getSavedServerPassword,
  getServerDebugLogPath,
  getServerExposedProviders,
  getServerFavoritesOnly,
  getServerFreeModelsOnly,
  getServerListenMode,
  getServerMaskGatewayIds,
  getVertexModelsPath,
  injectClaudeCodeBillingSystemLine,
  injectClaudeIdentity,
  isAuthorized,
  isBrowserRedirectOAuth,
  isFreeStatus,
  isOpencodeApi,
  isOpencodeOAuth,
  isSdkMigratedNpm,
  isValidProviderId,
  loadModelsDevCache,
  loadPreferences,
  loadPricingCache,
  loadRegistry,
  localIsoTimestamp,
  localTimestamp,
  makeTraceLogger,
  maxToolsForNpm,
  modelPrefersResponsesApi,
  oauthCredentialToKeychainJson,
  parseAuthRef,
  parseToolArguments,
  printTraceLog,
  readFromCredentialStore,
  readGlobalOpencodeCredential,
  readStoredProviderCredential,
  redactTraceLine,
  relayAnthropicMessages,
  resetTraceLog,
  resolveApiKey,
  resolveCodexClientVersion,
  resolveContextWindow,
  resolveModelReasoningMetadata,
  resolveModelsDevSlug,
  resolveProviderCredential,
  resolveProviderOAuthAccountId,
  resolveProviderOAuthProviderData,
  routeLookupIds,
  runAntigravityOAuthFlow,
  runClaudeCodeOAuthFlow,
  runClinePassDeviceCodeFlow,
  runCodexCommandSync,
  runGithubDeviceCodeFlow,
  runOpenAiDeviceCodeFlow,
  runXaiDeviceCodeFlow,
  sanitizeCredential,
  saveProviderCredential,
  saveRegistry,
  saveToCredentialStore,
  selectBetaFlags,
  setSavedServerPassword,
  setServerExposedProviders,
  setServerFavoritesOnly,
  setServerFreeModelsOnly,
  setServerListenMode,
  setServerMaskGatewayIds,
  shouldHideByModelsDevCapabilities,
  silenceSdkWarnings,
  slugifyProviderId,
  splitToolUseId,
  streamAnthropicResponse,
  stripOneMContextSuffix,
  supportsNativeOAuth,
  tokensToStoredCredential,
  translateRequest,
  upstreamHttpStatus,
  validateCustomEndpointUrl,
  writeSecureLogLine
} from "./chunk-ZLLXP35M.js";

// src/registry/google-model-id.ts
var GOOGLE_MODEL_PREFIX = "models/";
function stripGoogleModelPrefix(id) {
  return id.startsWith(GOOGLE_MODEL_PREFIX) ? id.slice(GOOGLE_MODEL_PREFIX.length) : id;
}
function normalizeGoogleModelId(rawId, npm) {
  if (npm !== "@ai-sdk/google") {
    return { id: rawId, upstreamModelId: rawId };
  }
  const bare = stripGoogleModelPrefix(rawId);
  return { id: bare, upstreamModelId: bare };
}
function normalizeGoogleDisplayName(rawName, bareId) {
  const trimmed = rawName?.trim();
  if (!trimmed) return bareId;
  return stripGoogleModelPrefix(trimmed);
}

// src/codex/multi-agent.ts
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
var CODEX_MULTI_AGENT_V2 = Object.freeze({
  enabled: true,
  max_concurrent_threads_per_session: 6,
  expose_spawn_agent_model_overrides: true
});
function renderMultiAgentV2Feature() {
  return "[features]\nmulti_agent_v2 = { enabled = true, max_concurrent_threads_per_session = 6, expose_spawn_agent_model_overrides = true }\n";
}
function probeText(value) {
  if (!value || typeof value !== "object") return String(value ?? "");
  const result = value;
  return `${result.stdout ?? ""}
${result.stderr ?? ""}`;
}
function supportsMultiAgentV2(binaryPath, run3 = (path, args, env) => runCodexCommandSync(path, args, { timeout: 1e4, env })) {
  const probeHome = mkdtempSync(join(tmpdir(), "relay-codex-v2-probe-"));
  try {
    writeFileSync(join(probeHome, "config.toml"), renderMultiAgentV2Feature(), { encoding: "utf8", mode: 384 });
    const env = { ...process.env, CODEX_HOME: probeHome };
    let output = "";
    try {
      output = probeText(run3(binaryPath, ["login", "status"], env));
    } catch (error) {
      output = probeText(error);
    }
    if (/ENOENT|not found|cannot find the file/i.test(output)) return false;
    return !/error loading configuration|invalid configuration|unknown field/i.test(output);
  } finally {
    rmSync(probeHome, { recursive: true, force: true });
  }
}

// src/codex/app-profile.ts
var CODEX_APP_PROVIDER_ID = "relay-ai-launch-codex-app";
var PREVIEW_PROXY_PORT = 54321;
var CODEX_APP_AUTO_COMPACT_RATIO = 0.9;
function codexAppModelSlug(rawModelId) {
  return rawModelId.startsWith("models/") ? rawModelId.slice("models/".length) : rawModelId;
}
function parseCodexAppModelSlug(modelKey) {
  const prefix = `${CODEX_APP_PROVIDER_ID}/`;
  return modelKey.startsWith(prefix) ? modelKey.slice(prefix.length) : modelKey;
}
function buildCodexAppRootConfig(spec) {
  const ctxWindow = spec.route.contextWindow;
  return {
    model: codexAppModelSlug(spec.route.modelId),
    model_provider: "openai",
    openai_base_url: spec.proxyBaseUrl ?? `http://127.0.0.1:${spec.proxyPort}/v1`,
    model_catalog_json: spec.catalogPath,
    ...spec.multiAgentV2Enabled ? {
      features: { multi_agent_v2: CODEX_MULTI_AGENT_V2 }
    } : {},
    ...ctxWindow && ctxWindow > 0 ? {
      model_context_window: ctxWindow,
      model_auto_compact_token_limit: Math.floor(ctxWindow * CODEX_APP_AUTO_COMPACT_RATIO)
    } : {}
  };
}

// src/codex/catalog.ts
var DEFAULT_CONTEXT = 128e3;
var CODEX_NO_REASONING_EFFORT = "none";
function codexCatalogReasoningFields(npm, wireId, metadata) {
  const reasoning = getReasoningCapabilities(npm, wireId, metadata);
  if (reasoning.levels.length > 0) {
    return {
      supported_reasoning_levels: buildCodexReasoningLevels(reasoning),
      default_reasoning_level: reasoning.defaultLevel,
      supports_reasoning_summaries: reasoning.supportsSummaries,
      default_reasoning_summary: reasoning.supportsSummaries ? "auto" : "none"
    };
  }
  return {
    supported_reasoning_levels: buildCodexReasoningLevels({
      levels: [CODEX_NO_REASONING_EFFORT]
    }),
    default_reasoning_level: CODEX_NO_REASONING_EFFORT,
    supports_reasoning_summaries: false,
    default_reasoning_summary: "none"
  };
}
function formatCodexModelLabel(model) {
  const trimmed = model.name.trim();
  if (trimmed && trimmed !== model.id) return trimmed;
  const id = stripGoogleModelPrefix(model.id);
  const claude = id.match(/^claude-([\w-]+?)-(\d+)-(\d+)(?:-\d{8})?$/);
  if (claude) {
    const tier = claude[1].split("-").map(
      (part) => part.charAt(0).toUpperCase() + part.slice(1)
    ).join(" ");
    return `Claude ${tier} ${claude[2]}.${claude[3]}`;
  }
  const gpt = id.match(/^gpt-(\d+(?:\.\d+)?)(?:-([\w-]+))?$/i);
  if (gpt) {
    const suffix = gpt[2] ? ` ${gpt[2].split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}` : "";
    return `GPT-${gpt[1]}${suffix}`;
  }
  return id;
}
function catalogEntryFromModel(model, providerName, priority, appCatalog = false, slugOverride) {
  const slug = slugOverride ?? (appCatalog ? codexAppModelSlug(model.id) : stripGoogleModelPrefix(model.id));
  const context = model.contextWindow ?? DEFAULT_CONTEXT;
  const label = formatCodexModelLabel(model);
  const wireId = model.upstreamModelId ?? model.id;
  const reasoningFields = codexCatalogReasoningFields(model.npm ?? "", wireId, {
    apiBaseUrl: model.apiBaseUrl,
    supportedParameters: model.supportedParameters,
    reasoning: model.reasoning,
    interleavedReasoningField: model.interleavedReasoningField,
    reasoningEffortLevels: model.reasoningEffortLevels,
    reasoningEffortConflict: model.reasoningEffortConflict
  });
  return {
    slug,
    display_name: label,
    ...reasoningFields,
    shell_type: appCatalog ? "default" : "shell_command",
    visibility: "list",
    supported_in_api: true,
    priority,
    availability_nux: null,
    upgrade: null,
    base_instructions: "",
    support_verbosity: false,
    default_verbosity: null,
    apply_patch_tool_type: null,
    truncation_policy: appCatalog ? { mode: "bytes", limit: 1e4 } : { mode: "tokens", limit: context },
    supports_parallel_tool_calls: !appCatalog,
    experimental_supported_tools: [],
    context_window: context,
    max_context_window: context,
    input_modalities: model.modalities ?? ["text", "image"],
    description: `${label} \xB7 ${providerName}`
  };
}
function buildCatalogFile(models, providerName) {
  return {
    models: models.map((m, i) => catalogEntryFromModel(m, providerName, i))
  };
}
function buildAppCatalogFile(models, providerName, selectedModelId) {
  const selected = models.find((m) => m.id === selectedModelId);
  const rest = models.filter((m) => m.id !== selectedModelId);
  const ordered = selected ? [selected, ...rest] : models;
  return {
    models: ordered.map((m, i) => catalogEntryFromModel(m, providerName, i, true))
  };
}
function serializeCatalog(catalog) {
  return `${JSON.stringify(catalog, null, 2)}
`;
}

// src/ui.ts
import pc from "picocolors";
import * as p from "@clack/prompts";
var bar = pc.gray("\u2502");
var hline = pc.gray("\u2500");
function stripAnsi(s) {
  return s.replace(/\u001b\[[0-9;]*m/g, "");
}
function panelWidth(lines, title) {
  const maxLine = lines.reduce((max, line) => Math.max(max, stripAnsi(line).length), 0);
  return Math.max(maxLine, stripAnsi(title).length) + 2;
}
function printPanel(title, lines) {
  const width = panelWidth(lines, title);
  const topRule = hline.repeat(Math.max(width - stripAnsi(title).length - 1, 1));
  process.stdout.write(`${bar}
`);
  process.stdout.write(`${pc.green("\u25C7")}  ${pc.bold(title)} ${pc.gray(topRule + "\u256E")}
`);
  for (const line of lines) {
    if (line.trim() === "") {
      process.stdout.write(`${bar}  ${bar}
`);
      continue;
    }
    const pad = " ".repeat(Math.max(width - stripAnsi(line).length, 0));
    process.stdout.write(`${bar}  ${line}${pad}${bar}
`);
  }
  process.stdout.write(`${pc.gray("\u251C" + "\u2500".repeat(width + 2) + "\u256F")}
`);
}
function relayIntro(section) {
  p.intro(`${pc.bold(pc.cyan("Relay AI"))}${pc.bold(` \u2014 ${section}`)}`);
}
function relayOutro(status, detail) {
  p.outro(detail ? `${pc.green(status)} ${pc.dim("\u2014")} ${detail}` : pc.green(status));
}
function fmtModel(label, id) {
  return id ? `${pc.cyan(pc.bold(label))} ${pc.dim(`(${id})`)}` : pc.cyan(pc.bold(label));
}
function fmtProvider(name) {
  return pc.cyanBright(pc.bold(name));
}
function fmtProviderBracket(providerId, providerName, isFree) {
  const color = providerTagColor(providerId);
  const text4 = isFree ? `${providerName} \xB7 free` : providerName;
  return color(pc.bold(`(${text4})`));
}
function providerTagColor(providerId) {
  switch (providerId) {
    case "zen":
      return pc.yellow;
    case "go":
      return pc.green;
    case "openrouter":
      return pc.blue;
    case "deepseek":
      return pc.magenta;
    case "anthropic":
      return pc.yellow;
    case "google":
      return pc.cyan;
    case "openai":
      return pc.white;
    case "xai":
    case "xai-oauth":
      return pc.white;
    case "groq":
      return pc.red;
    case "mistral":
      return pc.red;
    case "togetherai":
      return pc.blue;
    case "nvidia":
      return pc.green;
    default:
      return pc.yellow;
  }
}
function fmtCommand(cmd) {
  return pc.cyan(cmd);
}
function fmtUrl(url) {
  return pc.cyan(url);
}
function fmtCount(n, noun) {
  return `${pc.bold(String(n))} ${noun}${n === 1 ? "" : "s"}`;
}
function fmtRecentHint() {
  return pc.yellow("recent");
}
function fmtEnabledStar(enabled) {
  return enabled ? pc.yellow("\u2605") : pc.dim("\u25CB");
}
function providerSelectOption(provider) {
  return {
    value: provider.id,
    label: fmtProvider(provider.name),
    hint: `${provider.models.length} model${provider.models.length !== 1 ? "s" : ""}`
  };
}
function modelSelectOption(model, hint) {
  const label = formatCodexModelLabel(model);
  let defaultHint = hint;
  if (!defaultHint) {
    const isCloudflare = model.id.startsWith("@cf/") || model.id.startsWith("@hf/");
    if (model.isFree) {
      defaultHint = pc.green(isCloudflare ? "Free (10k/day)" : "Free");
    } else if (model.cost && (model.cost.input > 0 || model.cost.output > 0)) {
      const inputStr = `$${model.cost.input}`;
      const outputStr = `$${model.cost.output}`;
      defaultHint = pc.dim(isCloudflare ? `Paid plan req (${inputStr}/${outputStr} 1M)` : `${inputStr}/${outputStr} 1M`);
    } else {
      defaultHint = model.name !== model.id ? model.id : model.brand || model.family || "";
    }
  } else if (hint === "recent") {
    const isCloudflare = model.id.startsWith("@cf/") || model.id.startsWith("@hf/");
    const freeLabel = isCloudflare ? "Free (10k/day)" : "Free";
    const freeSuffix = model.isFree ? " \xB7 " + pc.green(freeLabel) : "";
    defaultHint = fmtRecentHint() + freeSuffix;
  }
  const ctxSuffix = fmtContextWindow(model.contextWindow);
  return {
    value: model.id,
    label: fmtModel(label),
    hint: defaultHint && ctxSuffix ? `${defaultHint} \xB7 ${ctxSuffix}` : defaultHint || ctxSuffix
  };
}
function fmtContextWindow(contextWindow2) {
  if (!contextWindow2) return "";
  const k = contextWindow2 >= 1e3 ? `${Math.round(contextWindow2 / 1e3)}k` : String(contextWindow2);
  return pc.dim(`${k} ctx`);
}
function navOption(value, label, hint = "") {
  return { value, label: pc.cyan(label), hint };
}
function logActiveModel(modelLabel, modelId) {
  p.log.success(`${pc.bold("Active model:")} ${fmtModel(modelLabel, modelId)}`);
}
function logProxy(port) {
  p.log.info(`${pc.dim("Proxy")} ${pc.cyan(pc.bold(`127.0.0.1:${port}`))}`);
}
function logConnected(name, modelCount) {
  p.log.success(
    `${pc.bold("Connected")} ${pc.dim("\xB7")} ${fmtCount(modelCount, "model")} ${pc.dim("\u2014")} ${fmtProvider(name)}`
  );
}
function printWelcomePanel() {
  printPanel(pc.cyan("Welcome to relay-ai"), [
    `${pc.white("Let's get you set up.")}`,
    `${pc.dim("Pick a path below \u2014 you can always add more providers later with ")}${fmtCommand("relay-ai providers")}${pc.dim(".")}`
  ]);
}
function printEnvConflictPanel(conflicts) {
  if (conflicts.length === 0) return;
  printPanel(pc.yellow("Env overrides"), [
    `${pc.white("These variables will be ")}${pc.yellow(pc.bold("temporarily removed"))}${pc.white(" for the Claude Code child process:")}`,
    "",
    ...conflicts.map((c) => `  ${pc.dim(c.name)}${pc.white("=")}${pc.yellow(c.value)}`)
  ]);
}
function printApiKeyPanel(url) {
  printPanel(pc.cyan("OpenCode API key"), [
    `${pc.white("Get a free key at:")} ${fmtUrl(url)}`,
    `${pc.dim("Paste it below \u2014 relay-ai stores it in your system keychain when possible.")}`
  ]);
}
function printDryRunPanel() {
  printPanel(pc.yellow("Dry run"), [
    `${pc.white("Simulating first-run \u2014 ")}${pc.yellow(pc.bold("no keys read or written"))}${pc.white(".")}`
  ]);
}
function printImportConflictPanel(providerName, existingHint, incomingHint) {
  printPanel(pc.yellow(`Provider "${providerName}" already configured`), [
    `${pc.bold("Existing")}  ${pc.white(existingHint)}`,
    `${pc.bold("Imported")}  ${pc.white(incomingHint)}`
  ]);
}
function printProviderDetailPanel(name, modelCount, authLabel) {
  printPanel(fmtProvider(name), [
    `${pc.bold("Models")}  ${pc.cyan(String(modelCount))} cached`,
    `${pc.bold("Auth")}    ${pc.white(authLabel)}`
  ]);
}
function printCloudProviderPanel(name) {
  printPanel(pc.cyan("Cloud provider"), [
    `${fmtProvider(name)} ${pc.white("is active via your saved OpenCode API key.")}`,
    `${pc.dim("Models are fetched live \u2014 no separate setup needed.")}`
  ]);
}
function printOAuthStepsPanel(title, providerLabel) {
  printPanel(pc.cyan(title), [
    `${pc.white("1. Open the URL below in your browser")}`,
    `${pc.white("2. Enter the code when prompted")}`,
    `${pc.white("3. Approve access for ")}${fmtProvider(providerLabel)}`
  ]);
}
async function confirmSubscriptionOAuthRisk(providerId) {
  const isGoogle = providerId === "antigravity";
  const providerLabel = isGoogle ? "Antigravity / Google" : "Claude Code";
  const service = isGoogle ? "Google account (Gmail, Drive, YouTube, Workspace, and all tied services)" : "Anthropic account (Claude Pro / Max subscription)";
  const enforcementNote = isGoogle ? "Community reports: Google has issued account bans for this usage." : "Anthropic actively enforces this \u2014 validating request shape and has taken legal action against other projects.";
  const compatibilityNote = isGoogle ? void 0 : "For compatibility, relay-ai may reproduce Claude Code-style request metadata and attribution so Anthropic classifies traffic as Claude Code.";
  printPanel(pc.red(`\u26A0  Account Risk \u2014 ${providerLabel} OAuth`), [
    `${pc.white("This extracts OAuth tokens from your")} ${pc.bold(service)}.`,
    "",
    `${pc.white("Routing subscription tokens through relay-ai to power other tools")}`,
    `${pc.white("may violate the provider's Terms of Service.")}`,
    "",
    `${pc.yellow(enforcementNote)}`,
    ...compatibilityNote ? [`${pc.yellow(compatibilityNote)}`] : [],
    "",
    `${pc.white("Possible consequences:")}`,
    `  ${pc.dim("\u2022")} ${pc.white("Token revocation")}`,
    `  ${pc.dim("\u2022")} ${pc.white("Account suspension or permanent ban")}`,
    ...isGoogle ? [`  ${pc.dim("\u2022")} ${pc.red(pc.bold("Loss of ALL services tied to this Google account"))}`] : [],
    "",
    ...isGoogle ? [`${pc.red(pc.bold("Do not use your primary Google account."))} ${pc.white("Use a throwaway account.")}`] : [],
    `${pc.dim(`relay-ai is not affiliated with ${isGoogle ? "Google" : "Anthropic"} and cannot protect you.`)}`
  ]);
  const answer = await p.text({
    message: 'Type "yes" to accept the risk and proceed, or Ctrl+C to cancel:',
    validate: (v) => v === "yes" ? void 0 : 'Type exactly "yes" to confirm'
  });
  return !p.isCancel(answer) && answer === "yes";
}
function printNetworkWarningPanel() {
  printPanel(pc.yellow("Network mode"), [
    `${pc.yellow(pc.bold("Anyone on your network"))}${pc.white(" who knows the password can use this server through your account.")}`
  ]);
}
function printFavoritesOnlyPanel() {
  printPanel(pc.cyan("Favorites-only mode"), [
    `${pc.white("Limits ")}${pc.cyan("GET /anthropic/v1/models")}${pc.white(" to your curated favorites.")}`,
    `${pc.white("Registry models not in your favorites will not appear in the Desktop / Cowork picker.")}`,
    `${pc.white("Edit with ")}${pc.cyan("relay-ai models")}${pc.white(".")}`
  ]);
}

// src/proxy.ts
import { createServer } from "http";
import { appendFileSync, openSync, writeSync, closeSync } from "fs";

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

// src/server/vendor-mask.ts
function reverseSegment(value) {
  return [...value].reverse().join("");
}
function maskGatewayModelId(aliasId) {
  if (!aliasId.startsWith("anthropic-")) return aliasId;
  const sep = aliasId.indexOf("__");
  if (sep === -1) return aliasId;
  const providerSlug = aliasId.slice("anthropic-".length, sep);
  const modelSuffix = aliasId.slice(sep + 2);
  return `anthropic-${reverseSegment(providerSlug)}__${reverseSegment(modelSuffix)}`;
}

// src/server/models.ts
var CREATED_AT_ISO = "2025-01-01T00:00:00Z";
var CREATED_AT_UNIX = 1735689600;
function formatAnthropicModelEntry(id, displayName, contextWindow2, options) {
  const maxInput = resolveContextWindow(id, contextWindow2);
  return {
    id,
    type: "model",
    display_name: displayName,
    created_at: CREATED_AT_ISO,
    context_window: maxInput,
    max_input_tokens: maxInput,
    ...options?.supportsOneM !== void 0 ? { supports_1m: options.supportsOneM } : {}
  };
}
function formatAnthropicModelList(entries2) {
  return {
    data: entries2.map((entry) => formatAnthropicModelEntry(
      entry.id,
      entry.name,
      entry.contextWindow,
      { supportsOneM: entry.supportsOneM }
    )),
    has_more: false,
    first_id: entries2[0]?.id ?? null,
    last_id: entries2.at(-1)?.id ?? null
  };
}
function gatewayProviderLabel(model) {
  return model.providerLabel ?? (model.sourceBackend === "go" ? "OpenCode Go" : "OpenCode Zen");
}
function gatewayProviderId(model) {
  return model.providerId ?? model.sourceBackend;
}
function gatewayAliasId(model) {
  return aliasModelId(model.id, gatewayProviderId(model));
}
function openAiIdCollisions(models) {
  const counts = /* @__PURE__ */ new Map();
  for (const model of models) counts.set(model.id, (counts.get(model.id) ?? 0) + 1);
  const collisions = /* @__PURE__ */ new Set();
  for (const [id, count] of counts) if (count > 1) collisions.add(id);
  return collisions;
}
function openAiExposedId(model, collisions) {
  return collisions.has(model.id) ? `${gatewayProviderId(model)}/${model.id}` : model.id;
}
function exposedGatewayAliasId(model, opts) {
  const singleOneM = usesSingleOneMEntry(model, opts);
  const alias = gatewayAliasId(singleOneM ? { ...model, id: stripOneMContextSuffix(model.id) } : model);
  const exposed = opts?.maskGatewayIds ? maskGatewayModelId(alias) : alias;
  return singleOneM ? `${stripOneMContextSuffix(exposed)}[1m]` : exposed;
}
function gatewayModelIdentity(model, models, opts) {
  const collisions = openAiIdCollisions(models);
  const ids = [];
  const modelIndex = models.indexOf(model);
  const firstBareIndex = models.findIndex((candidate) => candidate.id === model.id);
  if (modelIndex === firstBareIndex || modelIndex < 0) ids.push(model.id);
  const scopedId = openAiExposedId(model, collisions);
  if (scopedId !== model.id) ids.push(scopedId);
  const publicId = exposedGatewayAliasId(model, opts);
  if (publicId !== model.id) ids.push(publicId);
  const singleOneM = usesSingleOneMEntry(model, opts);
  if (singleOneM) {
    const bareModel = { ...model, id: stripOneMContextSuffix(model.id) };
    const rawBareAlias = gatewayAliasId(bareModel);
    const exposedBareAlias = opts?.maskGatewayIds ? maskGatewayModelId(rawBareAlias) : rawBareAlias;
    ids.push(
      stripOneMContextSuffix(model.id),
      rawBareAlias,
      `${rawBareAlias}[1m]`,
      exposedBareAlias,
      `${exposedBareAlias}[1m]`
    );
  }
  if (opts?.maskGatewayIds) {
    const rawAlias = gatewayAliasId(singleOneM ? { ...model, id: stripOneMContextSuffix(model.id) } : model);
    if (rawAlias !== publicId) ids.push(rawAlias);
  }
  return {
    publicId,
    compatibilityIds: [...new Set(ids)]
  };
}
function buildServerSubagentModelRouting(models, parentModel, opts) {
  const identities = models.map((model) => gatewayModelIdentity(model, models, opts));
  const parentIndex = models.indexOf(parentModel);
  const parentModelId = parentIndex >= 0 ? identities[parentIndex].publicId : exposedGatewayAliasId(parentModel, opts);
  return {
    parentModelId,
    models: models.map((model, index) => ({
      id: identities[index].publicId,
      compatibilityIds: identities[index].compatibilityIds,
      displayName: gatewayDisplayName(model, opts),
      family: model.modelFormat === "anthropic" ? claudeModelFamily(model.upstreamModelId ?? model.id) : void 0
    }))
  };
}
function gatewayDisplayName(model, opts) {
  const name = opts?.maskGatewayIds ? `${model.name} (${gatewayProviderLabel(model)})` : model.name;
  return usesSingleOneMEntry(model, opts) && !/\b1m$/i.test(name) ? `${name} 1M` : name;
}
function formatGatewayAnthropicModels(models, opts) {
  return formatAnthropicModelList(
    models.map((model) => ({
      id: exposedGatewayAliasId(model, opts),
      name: gatewayDisplayName(model, opts),
      contextWindow: model.contextWindow,
      supportsOneM: usesSingleOneMEntry(model, opts) ? false : void 0
    }))
  );
}
function usesSingleOneMEntry(model, opts) {
  return opts?.longContextDisplay === "single-1m" && resolveContextWindow(stripOneMContextSuffix(model.id), model.contextWindow) >= 1e6;
}
function createGatewayModelCatalog(models, opts) {
  const byId = /* @__PURE__ */ new Map();
  for (const model of models) {
    const identity = gatewayModelIdentity(model, models, opts);
    for (const compatibleId of identity.compatibilityIds) {
      byId.set(compatibleId, model);
    }
  }
  return {
    get: (id) => byId.get(id),
    list: () => [...models]
  };
}
function upstreamModelId(model) {
  const id = model.upstreamModelId ?? model.id;
  return id.replace(/\[1m\]$/i, "");
}
function buildDedupedModelRows(models, opts, collisions = openAiIdCollisions(models)) {
  const seen = /* @__PURE__ */ new Set();
  const rows = [];
  for (const model of [...models].sort((a, b) => a.name.localeCompare(b.name))) {
    const row = {
      name: model.name,
      anthropicId: exposedGatewayAliasId(model, opts),
      openaiId: openAiExposedId(model, collisions)
    };
    const key = `${row.name}\0${row.anthropicId}\0${row.openaiId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }
  return rows;
}
function supportsDirectOpenAIChatCompletions(model) {
  return model.modelFormat === "openai" && (!!model.completionsUrl || model.sourceBackend === "zen" || model.sourceBackend === "go");
}
function formatOpenAIModels(models) {
  const collisions = openAiIdCollisions(models);
  return {
    object: "list",
    data: models.map((model) => ({
      id: openAiExposedId(model, collisions),
      object: "model",
      created: CREATED_AT_UNIX,
      owned_by: model.sourceBackend
    }))
  };
}

// src/anthropic-endpoints.ts
var MESSAGE_PATH = "/v1/messages";
var COUNT_TOKENS_PATH = "/v1/messages/count_tokens";
var MODELS_PATH = "/v1/models";
function anthropicModelsEndpoint(url) {
  if (!url) return null;
  try {
    const pathname = new URL(url, "http://relay.local").pathname;
    if (pathname === MODELS_PATH || pathname === `${MODELS_PATH}/`) return "list";
    if (pathname.startsWith(`${MODELS_PATH}/`)) {
      const id = decodeURIComponent(pathname.slice(MODELS_PATH.length + 1));
      if (id) return { id };
    }
  } catch {
  }
  return null;
}
function anthropicMessagesEndpoint(url) {
  if (!url) return null;
  try {
    const pathname = new URL(url, "http://relay.local").pathname;
    if (pathname === MESSAGE_PATH) return "messages";
    if (pathname === COUNT_TOKENS_PATH) return "count_tokens";
  } catch {
  }
  return null;
}
var NON_CONTEXT_FIELDS = /* @__PURE__ */ new Set([
  "model",
  "stream",
  "max_tokens",
  "temperature",
  "top_p",
  "top_k",
  "stop_sequences",
  "metadata"
]);
function estimateAnthropicInputTokens(body) {
  const contextBody = Object.fromEntries(
    Object.entries(body).filter(([key]) => !NON_CONTEXT_FIELDS.has(key))
  );
  const serialized = JSON.stringify(contextBody);
  if (!serialized || serialized === "{}") return 0;
  return Math.max(1, Math.ceil(Buffer.byteLength(serialized, "utf8") / 4));
}

// src/antigravity/anthropic-to-cloudcode.ts
import { randomUUID } from "crypto";
var DEFAULT_SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" }
];
var ANTIGRAVITY_USER_AGENT = "vscode/1.X.X (Antigravity/4.2.0)";
var MIN_ANTIGRAVITY_OUTPUT_TOKENS = 1024;
var STRIP_KEYS = /* @__PURE__ */ new Set([
  "$schema",
  "$defs",
  "definitions",
  "$ref",
  "$comment",
  "additionalProperties",
  "propertyNames",
  "patternProperties",
  "prefixItems",
  "title",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minimum",
  "maximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minItems",
  "maxItems",
  "uniqueItems",
  "contains",
  "minContains",
  "maxContains",
  "minProperties",
  "maxProperties",
  "dependencies",
  "dependentRequired",
  "dependentSchemas",
  "allOf",
  "anyOf",
  "oneOf",
  "not",
  "if",
  "then",
  "else",
  "const",
  "default",
  "examples",
  "readOnly",
  "writeOnly",
  "deprecated",
  // Codex app tool schemas can include this internal annotation. It is not a
  // JSON Schema keyword and Cloud Code's Schema protobuf rejects it.
  "encrypted"
]);
var CLOUD_CODE_SCHEMA_TYPES = /* @__PURE__ */ new Map([
  ["array", "ARRAY"],
  ["boolean", "BOOLEAN"],
  ["integer", "INTEGER"],
  ["null", "NULL"],
  ["number", "NUMBER"],
  ["object", "OBJECT"],
  ["string", "STRING"]
]);
function normalizeCloudCodeSchemaType(value) {
  if (typeof value === "string") {
    return CLOUD_CODE_SCHEMA_TYPES.get(value.toLowerCase()) ?? value;
  }
  return value;
}
function isNullSchema(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
  const type = obj.type;
  return type === "null" || type === "NULL" || Array.isArray(type) && type.every((value) => value === "null" || value === "NULL");
}
function resolveLocalSchemaRef(ref, root) {
  if (!ref.startsWith("#/$defs/")) return void 0;
  const name = ref.slice("#/$defs/".length).replace(/~1/g, "/").replace(/~0/g, "~");
  const defs = root.$defs;
  if (!defs || typeof defs !== "object" || Array.isArray(defs)) return void 0;
  return defs[name];
}
function stripDraftMeta(obj, root = void 0, resolvingRefs = /* @__PURE__ */ new Set()) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map((value) => stripDraftMeta(value, root, resolvingRefs));
  const source = obj;
  const schemaRoot = root ?? source;
  if (typeof source.$ref === "string") {
    const resolved = resolveLocalSchemaRef(source.$ref, schemaRoot);
    if (resolved !== void 0) {
      if (resolvingRefs.has(source.$ref)) return { type: "OBJECT" };
      const nextRefs = new Set(resolvingRefs);
      nextRefs.add(source.$ref);
      const dereferenced = stripDraftMeta(resolved, schemaRoot, nextRefs);
      if (dereferenced && typeof dereferenced === "object" && !Array.isArray(dereferenced)) {
        const siblings = { ...source };
        delete siblings.$ref;
        const sanitizedSiblings = stripDraftMeta(siblings, schemaRoot, resolvingRefs);
        return {
          ...dereferenced,
          ...sanitizedSiblings
        };
      }
      return dereferenced;
    }
  }
  const out = {};
  for (const [k, v] of Object.entries(source)) {
    if (STRIP_KEYS.has(k) || k.startsWith("x-")) continue;
    if (k === "properties" && v && typeof v === "object" && !Array.isArray(v)) {
      out.properties = Object.fromEntries(
        Object.entries(v).map(([name, schema]) => [
          name,
          stripDraftMeta(schema, schemaRoot, resolvingRefs)
        ])
      );
      continue;
    }
    if (k === "type") {
      const types = (Array.isArray(v) ? v : [v]).map(normalizeCloudCodeSchemaType).filter((type) => typeof type === "string");
      const concreteType = types.find((type) => type !== "NULL");
      out.type = concreteType ?? "STRING";
      if (types.includes("NULL")) out.nullable = true;
      continue;
    }
    if (k === "enum" && Array.isArray(v)) {
      out.enum = v.filter((value) => value !== null && value !== void 0).map(String);
      continue;
    }
    if (k === "items" && Array.isArray(v)) {
      out.items = stripDraftMeta(v[0] ?? {}, schemaRoot, resolvingRefs);
      continue;
    }
    out[k] = stripDraftMeta(v, schemaRoot, resolvingRefs);
  }
  const union = Array.isArray(source.anyOf) ? source.anyOf : Array.isArray(source.oneOf) ? source.oneOf : void 0;
  if (union) {
    const nullable = union.some(isNullSchema);
    const alternatives = union.filter((branch) => !isNullSchema(branch)).map((branch) => stripDraftMeta(branch, schemaRoot, resolvingRefs)).filter((branch) => Boolean(branch) && typeof branch === "object" && !Array.isArray(branch));
    if (alternatives.length === 1) Object.assign(out, alternatives[0], out);
    else if (alternatives.length > 1) out.anyOf = alternatives;
    if (nullable) out.nullable = true;
  }
  if (!out.type) {
    if (out.properties && typeof out.properties === "object" && !Array.isArray(out.properties)) {
      out.type = "OBJECT";
    } else if (out.items && typeof out.items === "object" && !Array.isArray(out.items)) {
      out.type = "ARRAY";
    }
  }
  if (Array.isArray(out.required) && out.properties && typeof out.properties === "object") {
    const props = out.properties;
    const valid = out.required.filter(
      (f) => typeof f === "string" && Object.prototype.hasOwnProperty.call(props, f)
    );
    if (valid.length === 0) delete out.required;
    else out.required = valid;
  }
  return out;
}
function stringToParts(text4) {
  return [{ text: text4 }];
}
function anthropicContentToParts(content, toolUseIdToName) {
  if (typeof content === "string") return stringToParts(content);
  if (!Array.isArray(content)) return [];
  const parts = [];
  for (const block of content) {
    const type = block.type;
    if (type === "text" && typeof block.text === "string") {
      parts.push({ text: block.text });
    } else if (type === "thinking" && typeof block.thinking === "string") {
      parts.push({ thought: true, text: block.thinking });
    } else if (type === "tool_use") {
      const name = block.name;
      const id = block.id;
      const { thoughtSignature } = id ? splitToolUseId(id) : { thoughtSignature: void 0 };
      if (id && name) toolUseIdToName.set(id, name);
      const part = { functionCall: { name, args: block.input ?? {} } };
      part.thoughtSignature = thoughtSignature ?? "skip_thought_signature_validator";
      parts.push(part);
    } else if (type === "tool_result") {
      const toolUseId = block.tool_use_id;
      const name = toolUseIdToName.get(toolUseId) ?? toolUseId;
      const rawContent = block.content;
      let result;
      if (typeof rawContent === "string") {
        result = rawContent;
      } else if (Array.isArray(rawContent)) {
        result = rawContent.filter((b) => b.type === "text").map((b) => b.text).join("");
      } else {
        result = rawContent ?? "";
      }
      parts.push({ functionResponse: { name, response: { result } } });
    }
  }
  return parts;
}
function extractSystem(system) {
  if (!system) return void 0;
  if (typeof system === "string" && system) {
    return { parts: [{ text: system }] };
  }
  if (Array.isArray(system)) {
    const text4 = system.filter((b) => b.type === "text").map((b) => b.text).join("\n");
    return text4 ? { parts: [{ text: text4 }] } : void 0;
  }
  return void 0;
}
function translateTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return void 0;
  const decls = [];
  for (const t of tools) {
    if (typeof t.name !== "string") continue;
    const translated = stripDraftMeta(t.input_schema ?? { type: "object", properties: {} });
    const parameters = translated && typeof translated === "object" && !Array.isArray(translated) ? translated : { type: "OBJECT", properties: {} };
    if (!parameters.type) parameters.type = "OBJECT";
    decls.push({
      name: t.name,
      description: typeof t.description === "string" ? t.description : "",
      parameters
    });
  }
  return decls.length > 0 ? [{ functionDeclarations: decls }] : void 0;
}
function anthropicToCloudCode(body, realModelId, projectId) {
  const toolUseIdToName = /* @__PURE__ */ new Map();
  const messages = body.messages ?? [];
  const contents = [];
  for (const msg of messages) {
    const role = msg.role === "assistant" ? "model" : "user";
    const parts = anthropicContentToParts(msg.content, toolUseIdToName);
    if (parts.length === 0) continue;
    const last = contents[contents.length - 1];
    if (last && last.role === role) {
      last.parts.push(...parts);
    } else {
      contents.push({ role, parts });
    }
  }
  const generationConfig = {};
  if (typeof body.max_tokens === "number") {
    generationConfig.maxOutputTokens = Math.max(body.max_tokens, MIN_ANTIGRAVITY_OUTPUT_TOKENS);
  }
  if (typeof body.temperature === "number") generationConfig.temperature = body.temperature;
  if (typeof body.top_p === "number") generationConfig.topP = body.top_p;
  const ccTools = translateTools(body.tools);
  const systemInstruction = extractSystem(body.system);
  const request = {
    contents,
    generationConfig,
    safetySettings: DEFAULT_SAFETY_SETTINGS
  };
  if (systemInstruction) request.systemInstruction = systemInstruction;
  if (ccTools) {
    request.tools = ccTools;
    request.toolConfig = { functionCallingConfig: { mode: "VALIDATED" } };
  }
  return {
    project: projectId,
    requestId: randomUUID(),
    model: realModelId,
    userAgent: ANTIGRAVITY_USER_AGENT,
    requestType: "agent",
    enabledCreditTypes: ["GOOGLE_ONE_AI"],
    request
  };
}

// src/antigravity/cloudcode-to-anthropic.ts
import { randomUUID as randomUUID2 } from "crypto";
function writeEvent(res, event, data) {
  res.write(`event: ${event}
data: ${JSON.stringify(data)}

`);
}
function parseCloudCodeChunk(line) {
  const text4 = line.startsWith("data: ") ? line.slice(6).trim() : line.trim();
  if (!text4 || text4 === "[DONE]") return null;
  try {
    return JSON.parse(text4);
  } catch {
    return null;
  }
}
function getCandidate(chunk) {
  const resp = chunk.response;
  if (!resp) return null;
  const candidates = resp.candidates;
  return candidates?.[0] ?? null;
}
function getParts(candidate) {
  const content = candidate.content;
  const parts = content?.parts;
  return parts ?? [];
}
function getFinishReason(candidate) {
  const r = candidate.finishReason;
  return r ?? null;
}
function getUsage(chunk) {
  const resp = chunk.response;
  const u = resp?.usageMetadata;
  if (!u) return null;
  return {
    input: u.promptTokenCount ?? 0,
    output: u.candidatesTokenCount ?? 0
  };
}
function partThoughtSignature(part) {
  const sig = part.thoughtSignature ?? part.thought_signature;
  if (typeof sig === "string" && sig.length > 0) return sig;
  const fc = part.functionCall;
  const nested = fc?.thoughtSignature ?? fc?.thought_signature;
  return typeof nested === "string" && nested.length > 0 ? nested : void 0;
}
function mapStopReason(finishReason) {
  if (finishReason === "STOP") return "end_turn";
  if (finishReason === "MAX_TOKENS") return "max_tokens";
  if (finishReason === "SAFETY") return "stop_sequence";
  return "end_turn";
}
function summarizeParts(parts) {
  let textParts = 0;
  let textChars = 0;
  let thoughtParts = 0;
  let thoughtChars = 0;
  let functionCalls = 0;
  for (const part of parts) {
    if (part.thought === true && typeof part.text === "string") {
      thoughtParts++;
      thoughtChars += part.text.length;
    } else if (typeof part.text === "string") {
      textParts++;
      textChars += part.text.length;
    } else if (part.functionCall && typeof part.functionCall === "object") {
      functionCalls++;
    }
  }
  return `textParts=${textParts} textChars=${textChars} thoughtParts=${thoughtParts} thoughtChars=${thoughtChars} functionCalls=${functionCalls}`;
}
function openTextBlock(res, state) {
  writeEvent(res, "content_block_start", {
    type: "content_block_start",
    index: state.blockIdx,
    content_block: { type: "text", text: "" }
  });
  state.textBlockOpen = true;
}
function closeBlock(res, state) {
  writeEvent(res, "content_block_stop", {
    type: "content_block_stop",
    index: state.blockIdx
  });
  state.blockIdx++;
  state.textBlockOpen = false;
}
async function streamCloudCodeToAnthropic(res, upstreamRes, model, log7) {
  const state = {
    messageId: `msg_${randomUUID2().replace(/-/g, "").slice(0, 24)}`,
    model,
    blockIdx: 0,
    textBlockOpen: false,
    pendingThoughtSignature: void 0,
    toolCalls: [],
    usage: { input: 0, output: 0 },
    emittedTextChars: 0,
    suppressedThoughtChars: 0
  };
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });
  writeEvent(res, "message_start", {
    type: "message_start",
    message: {
      id: state.messageId,
      type: "message",
      role: "assistant",
      content: [],
      model: state.model,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 }
    }
  });
  writeEvent(res, "ping", { type: "ping" });
  if (!upstreamRes.body) {
    writeEvent(res, "message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 0 } });
    writeEvent(res, "message_stop", { type: "message_stop" });
    res.end();
    return;
  }
  const reader = upstreamRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalStopReason = "end_turn";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const chunk = parseCloudCodeChunk(line);
        if (!chunk) continue;
        const usage = getUsage(chunk);
        if (usage) state.usage = usage;
        const candidate = getCandidate(chunk);
        if (!candidate) continue;
        const parts = getParts(candidate);
        const finishReason = getFinishReason(candidate);
        for (const part of parts) {
          const signature = partThoughtSignature(part);
          if (signature) state.pendingThoughtSignature = signature;
          if (part.thought === true && typeof part.text === "string") {
            state.suppressedThoughtChars += part.text.length;
            continue;
          } else if (typeof part.text === "string" && part.text !== "") {
            if (!state.textBlockOpen) openTextBlock(res, state);
            state.emittedTextChars += part.text.length;
            writeEvent(res, "content_block_delta", {
              type: "content_block_delta",
              index: state.blockIdx,
              delta: { type: "text_delta", text: part.text }
            });
          } else if (part.functionCall && typeof part.functionCall === "object") {
            const fc = part.functionCall;
            state.toolCalls.push({
              name: fc.name ?? "",
              args: fc.args ?? {},
              signature: signature ?? state.pendingThoughtSignature
            });
            state.pendingThoughtSignature = void 0;
          }
        }
        if (finishReason) {
          finalStopReason = mapStopReason(finishReason);
          log7?.(() => {
            const toolNames = state.toolCalls.map((tc) => tc.name).filter(Boolean).join(",");
            return `cloud-code stream finish=${finishReason} mapped=${finalStopReason} ${summarizeParts(parts)} emittedTextChars=${state.emittedTextChars} suppressedThoughtChars=${state.suppressedThoughtChars} queuedToolCalls=${state.toolCalls.length} queuedToolNames=${toolNames || "-"} outputTokens=${state.usage.output}`;
          });
          if (state.textBlockOpen) {
            closeBlock(res, state);
          }
          for (const tc of state.toolCalls) {
            const rawToolId = `toolu_${randomUUID2().replace(/-/g, "").slice(0, 16)}`;
            const toolId = encodeToolUseId(rawToolId, tc.signature);
            writeEvent(res, "content_block_start", {
              type: "content_block_start",
              index: state.blockIdx,
              content_block: { type: "tool_use", id: toolId, name: tc.name, input: {} }
            });
            writeEvent(res, "content_block_delta", {
              type: "content_block_delta",
              index: state.blockIdx,
              delta: { type: "input_json_delta", partial_json: JSON.stringify(tc.args) }
            });
            writeEvent(res, "content_block_stop", {
              type: "content_block_stop",
              index: state.blockIdx
            });
            state.blockIdx++;
          }
          if (state.blockIdx === 0) {
            openTextBlock(res, state);
            closeBlock(res, state);
          }
          const anthropicStopReason = state.toolCalls.length > 0 ? "tool_use" : finalStopReason;
          writeEvent(res, "message_delta", {
            type: "message_delta",
            delta: { stop_reason: anthropicStopReason, stop_sequence: null },
            usage: { output_tokens: state.usage.output }
          });
          writeEvent(res, "message_stop", { type: "message_stop" });
          res.end();
          return;
        }
      }
    }
  } catch {
  }
  if (state.textBlockOpen) closeBlock(res, state);
  if (state.blockIdx === 0) {
    openTextBlock(res, state);
    closeBlock(res, state);
  }
  writeEvent(res, "message_delta", {
    type: "message_delta",
    delta: { stop_reason: finalStopReason, stop_sequence: null },
    usage: { output_tokens: state.usage.output }
  });
  writeEvent(res, "message_stop", { type: "message_stop" });
  res.end();
}
async function collectCloudCodeToAnthropic(upstreamRes, model, log7) {
  const text4 = await upstreamRes.text();
  const messageId = `msg_${randomUUID2().replace(/-/g, "").slice(0, 24)}`;
  const content = [];
  let stopReason = "end_turn";
  let inputTokens = 0;
  let outputTokens = 0;
  let pendingThoughtSignature;
  let suppressedThoughtChars = 0;
  for (const line of text4.split("\n")) {
    const chunk = parseCloudCodeChunk(line);
    if (!chunk) continue;
    const usage = getUsage(chunk);
    if (usage) {
      inputTokens = usage.input;
      outputTokens = usage.output;
    }
    const candidate = getCandidate(chunk);
    if (!candidate) continue;
    for (const part of getParts(candidate)) {
      const signature = partThoughtSignature(part);
      if (signature) pendingThoughtSignature = signature;
      if (part.thought === true && typeof part.text === "string") {
        suppressedThoughtChars += part.text.length;
        continue;
      } else if (typeof part.text === "string" && part.text !== "") {
        const existing = content.find((b) => b.type === "text");
        if (existing) existing.text = existing.text + part.text;
        else content.push({ type: "text", text: part.text });
      } else if (part.functionCall && typeof part.functionCall === "object") {
        const fc = part.functionCall;
        const rawToolId = `toolu_${randomUUID2().replace(/-/g, "").slice(0, 16)}`;
        content.push({
          type: "tool_use",
          id: encodeToolUseId(rawToolId, signature ?? pendingThoughtSignature),
          name: fc.name,
          input: fc.args ?? {}
        });
        pendingThoughtSignature = void 0;
      }
    }
    const fr = getFinishReason(candidate);
    if (fr) {
      stopReason = content.some((b) => b.type === "tool_use") ? "tool_use" : mapStopReason(fr);
      log7?.(() => {
        const toolNames = content.filter((b) => b.type === "tool_use").map((b) => String(b.name ?? "")).filter(Boolean).join(",");
        return `cloud-code collect finish=${fr} mapped=${stopReason} ${summarizeParts(getParts(candidate))} suppressedThoughtChars=${suppressedThoughtChars} contentBlocks=${content.length} toolNames=${toolNames || "-"} outputTokens=${outputTokens}`;
      });
    }
  }
  if (content.length === 0) content.push({ type: "text", text: "" });
  return {
    id: messageId,
    type: "message",
    role: "assistant",
    content,
    model,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens }
  };
}

// src/proxy.ts
import { randomUUID as randomUUID4 } from "crypto";

// src/opencode-session.ts
import { randomUUID as randomUUID3 } from "crypto";
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
  if (id === "go" || id === "opencode-go") return true;
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
    normalizedSessionId = `relay-${randomUUID3()}`;
  }
  return mergeHeaders(baseHeaders, {
    "User-Agent": RELAY_USER_AGENT,
    ...normalizedSessionId ? { [OPENCODE_SESSION_HEADER]: normalizedSessionId } : {}
  });
}

// src/proxy.ts
function appendSecureLog(logPath, line) {
  const redacted = redactTraceLine(line);
  try {
    const fd = openSync(logPath, "a", 384);
    try {
      writeSync(fd, `${localTimestamp()} ${redacted}
`);
    } finally {
      closeSync(fd);
    }
  } catch {
    try {
      appendFileSync(logPath, `${localTimestamp()} ${redacted}
`);
    } catch {
    }
  }
}
function makeProxyLog(debug, logPath) {
  if (!debug) return () => {
  };
  const path = logPath ?? getProxyDebugLogPath();
  resetTraceLog(path);
  return (message) => {
    const line = typeof message === "function" ? message() : message;
    appendSecureLog(path, line);
  };
}
function anthropicError(res, status, message) {
  sendJson(res, status, {
    type: "error",
    error: { type: anthropicErrorType(status), message }
  });
}
function aliasModelId(realId, providerId) {
  const sanitized = providerId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (realId.startsWith("claude-") && !sanitized.startsWith("custom-")) return realId;
  return `anthropic-${sanitized}__${realId}`;
}
function buildProxySubagentModelRouting(routes, parentRoute) {
  const publicId = (route) => route.gatewayAliasId ?? route.aliasId;
  return {
    parentModelId: publicId(parentRoute),
    models: routes.map((route) => ({
      id: publicId(route),
      compatibilityIds: [.../* @__PURE__ */ new Set([
        ...routeLookupIds(route.aliasId),
        ...route.gatewayAliasId ? routeLookupIds(route.gatewayAliasId) : []
      ])],
      displayName: route.displayName,
      family: route.modelFormat === "anthropic" ? claudeModelFamily(route.realModelId) : void 0
    }))
  };
}
function lookupRoute(byAlias, id) {
  for (const key of routeLookupIds(id)) {
    const route = byAlias.get(key);
    if (route) return route;
  }
  return void 0;
}
function startProxyCatalog(routes, defaultAliasId, debug = false) {
  const proxyToken = randomUUID4();
  silenceSdkWarnings();
  if (routes.length === 0) {
    return Promise.reject(new Error("Proxy catalog requires at least one route"));
  }
  const byAlias = new Map(routes.map((r) => [r.aliasId, r]));
  const defaultRoute = byAlias.get(defaultAliasId) ?? routes[0];
  const subagentRouteRegistry = new SubagentRouteRegistry();
  const plog = makeProxyLog(debug);
  const onRejection = (reason) => {
    plog(() => `Unhandled Rejection: ${reason instanceof Error ? reason.stack || reason.message : String(reason)}`);
  };
  const onException = (error) => {
    plog(() => `Uncaught Exception: ${error.stack || error.message}`);
  };
  process.on("unhandledRejection", onRejection);
  process.on("uncaughtException", onException);
  const modelsPayload = JSON.stringify(
    formatAnthropicModelList(
      routes.map((r) => ({ id: r.aliasId, name: r.displayName, contextWindow: r.contextWindow }))
    )
  );
  const server = createServer(async (req, res) => {
    plog(() => `${req.method} ${req.url}`);
    if (req.method === "HEAD") {
      res.writeHead(200);
      res.end();
      return;
    }
    if (req.method === "GET" && req.url?.startsWith("/v1/models")) {
      const modelPathMatch = req.url.match(/^\/v1\/models\/([^?]+)/);
      if (modelPathMatch) {
        const id = decodeURIComponent(modelPathMatch[1]);
        const route = lookupRoute(byAlias, id);
        if (route) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(formatAnthropicModelEntry(route.aliasId, route.displayName, route.contextWindow)));
        } else {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { type: "not_found_error", message: `Model '${id}' not found` } }));
        }
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(modelsPayload);
      }
      return;
    }
    if (req.method === "POST" && req.url?.startsWith("/v1/messages")) {
      const inboundKey = extractApiKey(req);
      if (inboundKey !== proxyToken) {
        anthropicError(res, 401, "Invalid proxy token");
        return;
      }
      let anthropicBody;
      try {
        const raw = await readBody(req);
        anthropicBody = JSON.parse(raw);
      } catch {
        anthropicError(res, 400, "Invalid JSON body");
        return;
      }
      const correlatedSubagent = subagentRouteRegistry.consume(req.headers, anthropicBody);
      if (correlatedSubagent) anthropicBody = correlatedSubagent.body;
      const originalModel = anthropicBody.model;
      const clientWantsStream = Boolean(anthropicBody.stream);
      const correlatedRoute = correlatedSubagent ? routes.find((candidate) => (candidate.gatewayAliasId ?? candidate.aliasId) === correlatedSubagent.modelId) : void 0;
      const route = correlatedRoute ?? lookupRoute(byAlias, originalModel) ?? defaultRoute;
      const apiKey = route.apiKey;
      const upstreamUrl = route.upstreamUrl;
      plog(
        () => `POST /v1/messages - alias=${originalModel} route=${route.realModelId} format=${route.modelFormat} key=${apiKey ? `len:${apiKey.length}` : "MISSING"}`
      );
      const usesSdkAdapter = isSdkMigratedNpm(route.npm);
      if (!apiKey && !usesSdkAdapter) {
        anthropicError(res, 401, "Missing API key");
        return;
      }
      if (route.modelFormat === "anthropic") {
        const betaHeaderRaw = req.headers["anthropic-beta"];
        const inboundBeta = Array.isArray(betaHeaderRaw) ? betaHeaderRaw.join(",") : betaHeaderRaw;
        const forwardBody = { ...anthropicBody, model: route.realModelId };
        const targetUrl = `${upstreamUrl}/v1/messages`;
        const isOAuth = route.authType === "oauth";
        const upstreamHeaders = openCodeGoHeaders(
          route.providerId,
          route.baseURL ?? upstreamUrl,
          extractConversationId(req.headers, anthropicBody),
          route.headers
        ) ?? route.headers;
        let effectiveBeta = inboundBeta;
        let claudeCodeSessionId;
        if (isOAuth) {
          const seed = route.providerId ?? route.realModelId;
          const identity = injectClaudeIdentity(forwardBody, route.providerData, seed);
          if (route.providerId === "claude-code") injectClaudeCodeBillingSystemLine(forwardBody);
          claudeCodeSessionId = identity.sessionId;
          effectiveBeta = selectBetaFlags(forwardBody, route.realModelId, inboundBeta);
          plog(() => `anthropic-oauth: model=${route.realModelId}, beta=${effectiveBeta}`);
          plog(() => `anthropic-oauth headers: user-agent=claude-cli/${CLAUDE_CODE_CLI_VERSION} x-app=cli session-header=${claudeCodeSessionId ? "set" : "missing"}`);
        } else {
          plog(() => `anthropic-passthrough: model=${route.realModelId}, stream=${clientWantsStream}`);
        }
        try {
          await relayAnthropicMessages(
            res,
            targetUrl,
            forwardBody,
            apiKey,
            clientWantsStream,
            effectiveBeta,
            isOAuth ? "oauth" : "api",
            (message) => plog(message),
            claudeCodeSessionId,
            upstreamHeaders,
            route.refreshToken,
            (refreshed) => {
              route.apiKey = refreshed;
            },
            true
          );
        } catch (err) {
          const message = err instanceof UpstreamUnreachableError ? err.message : String(err);
          plog(() => `anthropic-passthrough error: ${message}`);
          anthropicError(res, 502, message);
        }
        return;
      }
      if (usesSdkAdapter) {
        const openAiOAuth = route.npm === "@ai-sdk/openai" && route.authType === "oauth";
        const subagentRouting = buildProxySubagentModelRouting(routes, route);
        const sessionId = extractClaudeSessionId(req.headers, anthropicBody);
        const requestHeaders = openCodeGoHeaders(
          route.providerId,
          route.baseURL ?? upstreamUrl,
          extractConversationId(req.headers, anthropicBody),
          route.headers
        );
        if (sessionId) {
          subagentRouting.registerSubagentRoute = (modelId) => subagentRouteRegistry.register(sessionId, modelId);
        }
        const params = translateRequest(anthropicBody, route.npm, {
          openAiOAuth,
          maxTools: maxToolsForNpm(route.npm),
          onDebug: (msg) => plog(() => msg),
          subagentRouting,
          ...requestHeaders ? { requestHeaders } : {},
          reasoningMetadata: {
            providerId: route.providerId,
            apiBaseUrl: route.baseURL,
            supportedParameters: route.supportedParameters,
            reasoning: route.reasoning,
            interleavedReasoningField: route.interleavedReasoningField,
            reasoningEffortLevels: route.reasoningEffortLevels,
            reasoningEffortConflict: route.reasoningEffortConflict,
            upstreamModelId: route.realModelId
          }
        });
        plog(
          () => `sdk: npm=${route.npm} model=${route.realModelId}, stream=${clientWantsStream}, tools=${anthropicBody.tools?.length ?? 0}, msgs=${params.messages.length}`
        );
        try {
          const model = await createLanguageModel({
            npm: route.npm,
            modelId: route.realModelId,
            apiKey,
            baseURL: route.baseURL,
            providerId: route.providerId ?? route.aliasId,
            authType: route.authType,
            oauthAccountId: route.oauthAccountId,
            providerData: route.providerData,
            headers: route.headers,
            refreshToken: route.refreshToken,
            onTokenRefreshed: (refreshed) => {
              route.apiKey = refreshed;
            },
            useResponsesLite: route.useResponsesLite,
            preferWebSockets: route.preferWebSockets,
            onDebug: (msg) => plog(() => msg)
          });
          if (clientWantsStream) {
            res.writeHead(200, {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              "Connection": "keep-alive"
            });
            await streamAnthropicResponse(
              model,
              params,
              originalModel,
              (c) => res.write(c),
              plog,
              estimateAnthropicInputTokens(anthropicBody)
            );
            res.end();
          } else {
            const anthropicResponse = await generateAnthropicResponse(
              model,
              params,
              originalModel,
              { forceStream: openAiOAuth, log: plog }
            );
            sendJson(res, 200, anthropicResponse);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const body = err && typeof err === "object" && "responseBody" in err ? err.responseBody : void 0;
          plog(() => `sdk error: ${message}${body ? ` \u2014 body: ${body}` : ""}`);
          if (!res.headersSent) {
            const status = upstreamHttpStatus(err, message);
            anthropicError(res, status === 500 ? 502 : status, message);
          } else {
            const errorType = anthropicErrorType(upstreamHttpStatus(err, message));
            res.write(`event: error
data: ${JSON.stringify({ type: "error", error: { type: errorType, message } })}

`);
            res.end();
          }
        }
        return;
      }
      if (route.modelFormat === "cloud-code") {
        const projectId = route.providerData?.projectId ?? "";
        if (!projectId) {
          anthropicError(res, 500, "Antigravity provider missing projectId \u2014 re-authenticate with relay-ai providers auth antigravity");
          return;
        }
        const envelope = anthropicToCloudCode(anthropicBody, route.realModelId, projectId);
        const cloudContents = envelope.request.contents ?? [];
        const cloudToolResults = cloudContents.reduce((count, msg) => count + (msg.parts ?? []).filter((p8) => p8.functionResponse).length, 0);
        const cloudToolCalls = cloudContents.reduce((count, msg) => count + (msg.parts ?? []).filter((p8) => p8.functionCall).length, 0);
        const cloudTools = envelope.request.tools?.length ?? 0;
        const cloudMaxOutput = envelope.request.generationConfig?.maxOutputTokens;
        const baseUrl = upstreamUrl.replace(/\/+$/, "");
        const cloudCodeUrl = `${baseUrl}/v1internal:streamGenerateContent?alt=sse`;
        plog(() => `cloud-code: model=${route.realModelId}, project=${projectId.slice(0, 8)}\u2026 msgs=${cloudContents.length} toolCalls=${cloudToolCalls} toolResults=${cloudToolResults} tools=${cloudTools} maxOutput=${cloudMaxOutput ?? "unset"} stream=${clientWantsStream}`);
        const fetchCloudCode = (token) => fetch(cloudCodeUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "User-Agent": "vscode/1.X.X (Antigravity/4.2.0)"
          },
          body: JSON.stringify(envelope)
        });
        try {
          const retryResult = await fetchWithOAuthRetry(apiKey, fetchCloudCode, route.refreshToken);
          const upstream = retryResult.response;
          if (retryResult.refreshed) route.apiKey = retryResult.apiKey;
          if (!upstream.ok) {
            const errBody = await upstream.text();
            plog(() => `cloud-code error ${upstream.status}: ${errBody}`);
            anthropicError(res, upstream.status >= 500 ? 502 : upstream.status, errBody);
            return;
          }
          if (clientWantsStream) {
            await streamCloudCodeToAnthropic(res, upstream, route.realModelId, plog);
          } else {
            const response = await collectCloudCodeToAnthropic(upstream, route.realModelId, plog);
            sendJson(res, 200, response);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          plog(() => `cloud-code fetch error: ${message}`);
          if (!res.headersSent) anthropicError(res, 502, message);
          else res.end();
        }
        return;
      }
      anthropicError(res, 500, `No SDK provider configured for model ${originalModel} (npm=${route.npm ?? "none"})`);
      return;
    }
    anthropicError(res, 404, `Unknown endpoint: ${req.method} ${req.url}`);
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to bind proxy"));
        return;
      }
      plog(() => `started on port ${addr.port}, catalog=${routes.length} model(s), default=${defaultRoute.aliasId}`);
      resolve({
        port: addr.port,
        token: proxyToken,
        close: () => {
          process.off("unhandledRejection", onRejection);
          process.off("uncaughtException", onException);
          server.close();
        }
      });
    });
  });
}
function startProxy(completionsUrl, modelId, debug = false, contextWindow2, sdk, apiKey) {
  const bareModelId = stripOneMContextSuffix(modelId);
  const clientModelId = claudeCodeClientModelId(modelId, contextWindow2);
  return startProxyCatalog([{
    aliasId: clientModelId,
    realModelId: sdk?.upstreamModelId ?? bareModelId,
    displayName: bareModelId,
    upstreamUrl: completionsUrl,
    apiKey: apiKey ?? "",
    modelFormat: sdk?.modelFormat ?? "openai",
    contextWindow: contextWindow2,
    npm: sdk?.npm,
    baseURL: sdk?.baseURL,
    providerId: sdk?.providerId,
    authType: sdk?.authType,
    oauthAccountId: sdk?.oauthAccountId,
    providerData: sdk?.providerData,
    refreshToken: sdk?.refreshToken,
    headers: sdk?.headers,
    supportedParameters: sdk?.supportedParameters,
    reasoning: sdk?.reasoning,
    interleavedReasoningField: sdk?.interleavedReasoningField,
    reasoningEffortLevels: sdk?.reasoningEffortLevels,
    reasoningEffortConflict: sdk?.reasoningEffortConflict,
    useResponsesLite: sdk?.useResponsesLite,
    preferWebSockets: sdk?.preferWebSockets
  }], clientModelId, debug);
}

// src/data/model-incompatible.json
var model_incompatible_default = {
  schema_version: "1",
  entries: [
    {
      provider: "google",
      modelId: "antigravity-preview-05-2026",
      category: "managed_agent",
      reason: "Interactions API only; coding agents send multiturn chat via @ai-sdk/google streamGenerateContent",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "manual UAT 2026-06-10"
      ],
      verifiedAt: "2026-06-10"
    },
    {
      provider: "*",
      modelId: "z-ai/glm4.7",
      category: "gated_access",
      reason: "NVIDIA NIM requires separate access approval (HTTP 410)",
      sources: [
        "manual probe 2026-06"
      ],
      verifiedAt: "2026-06-10"
    },
    {
      provider: "*",
      modelId: "qwen3.6-plus-free",
      category: "stale_promotion",
      reason: "Free promotion ended; API returns 401",
      sources: [
        "OpenCode Zen catalog"
      ],
      verifiedAt: "2026-06-10"
    },
    {
      provider: "*",
      modelId: "mimo-v2-pro",
      category: "deprecated",
      reason: "Deprecated; API returns 400 \u2014 use mimo-v2.5-pro",
      sources: [
        "OpenCode Zen catalog"
      ],
      verifiedAt: "2026-06-10"
    },
    {
      provider: "*",
      modelId: "mimo-v2-omni",
      category: "deprecated",
      reason: "Deprecated; API returns 400 \u2014 use mimo-v2.5",
      sources: [
        "OpenCode Zen catalog"
      ],
      verifiedAt: "2026-06-10"
    },
    {
      provider: "google",
      modelId: "aqa",
      category: "managed_agent",
      reason: "Attributed QA model \u2014 not for coding agents",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "deep-research-max-preview-04-2026",
      category: "managed_agent",
      reason: "Specialized agent API \u2014 not standard coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "deep-research-preview-04-2026",
      category: "managed_agent",
      reason: "Specialized agent API \u2014 not standard coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "deep-research-pro-preview-12-2025",
      category: "managed_agent",
      reason: "Specialized agent API \u2014 not standard coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "gemini-2.5-computer-use-preview-10-2025",
      category: "managed_agent",
      reason: "Specialized agent API \u2014 not standard coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "gemini-2.5-flash-image",
      category: "image_generation",
      reason: "Image-output model \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "gemini-2.5-flash-native-audio-latest",
      category: "audio_only",
      reason: "Audio/music output \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "gemini-2.5-flash-native-audio-preview-09-2025",
      category: "audio_only",
      reason: "Audio/music output \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "gemini-2.5-flash-native-audio-preview-12-2025",
      category: "audio_only",
      reason: "Audio/music output \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "gemini-2.5-flash-preview-tts",
      category: "audio_only",
      reason: "Audio/music output \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "gemini-2.5-pro-preview-tts",
      category: "audio_only",
      reason: "Audio/music output \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "gemini-3-pro-preview",
      category: "deprecated",
      reason: "Retired preview; API returns 404 \u2014 use gemini-3.1-pro-preview or newer",
      sources: [
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview",
        "manual UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "gemini-3-pro-image",
      category: "image_generation",
      reason: "Image-output model \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "gemini-3-pro-image-preview",
      category: "image_generation",
      reason: "Image-output model \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "gemini-3.1-flash-image",
      category: "image_generation",
      reason: "Image-output model \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "gemini-3.1-flash-image-preview",
      category: "image_generation",
      reason: "Image-output model \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "gemini-3.1-flash-live-preview",
      category: "managed_agent",
      reason: "Live/session API \u2014 not for Codex multiturn chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "gemini-3.1-flash-tts-preview",
      category: "audio_only",
      reason: "Audio/music output \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "gemini-3.5-live-translate-preview",
      category: "managed_agent",
      reason: "Live/session API \u2014 not for Codex multiturn chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "gemini-embedding-001",
      category: "embedding",
      reason: "Embedding model \u2014 not for chat or tools",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "gemini-embedding-2",
      category: "embedding",
      reason: "Embedding model \u2014 not for chat or tools",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "gemini-embedding-2-preview",
      category: "embedding",
      reason: "Embedding model \u2014 not for chat or tools",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "gemini-robotics-er-1.5-preview",
      category: "managed_agent",
      reason: "Specialized agent API \u2014 not standard coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "gemini-robotics-er-1.6-preview",
      category: "managed_agent",
      reason: "Specialized agent API \u2014 not standard coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "imagen-4.0-fast-generate-001",
      category: "image_generation",
      reason: "Image generation \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "imagen-4.0-generate-001",
      category: "image_generation",
      reason: "Image generation \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "imagen-4.0-ultra-generate-001",
      category: "image_generation",
      reason: "Image generation \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "lyria-3-clip-preview",
      category: "audio_only",
      reason: "Audio/music output \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "lyria-3-pro-preview",
      category: "audio_only",
      reason: "Audio/music output \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "lyria-realtime-exp",
      category: "audio_only",
      reason: "Audio/music output \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "nano-banana-pro-preview",
      category: "image_generation",
      reason: "Image generation \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "veo-2.0-generate-001",
      category: "video_generation",
      reason: "Video generation \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "veo-3.0-fast-generate-001",
      category: "video_generation",
      reason: "Video generation \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "veo-3.0-generate-001",
      category: "video_generation",
      reason: "Video generation \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "veo-3.1-fast-generate-preview",
      category: "video_generation",
      reason: "Video generation \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "veo-3.1-generate-preview",
      category: "video_generation",
      reason: "Video generation \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    },
    {
      provider: "google",
      modelId: "veo-3.1-lite-generate-preview",
      category: "video_generation",
      reason: "Video generation \u2014 not for coding chat",
      sources: [
        "https://ai.google.dev/gemini-api/docs/models",
        "Google GET /v1/models vs models.dev gap \u2014 UAT 2026-06-11"
      ],
      verifiedAt: "2026-06-11"
    }
  ]
};

// src/model-compatibility.ts
var BLACKLIST_ENTRIES = model_incompatible_default.entries ?? [];
var ANTIGRAVITY_HELPER_SLOT = /^(tab_|chat_|models\/)|image/i;
function isAntigravityCloudCodeHelperSlot(modelId) {
  return ANTIGRAVITY_HELPER_SLOT.test(modelId);
}
var ZEN_FREE_TIER_PROVIDERS = /* @__PURE__ */ new Set(["zen", "go"]);
function isZenFreeTierModel(providerId, modelId) {
  if (!ZEN_FREE_TIER_PROVIDERS.has(providerId)) return false;
  const id = modelId.trim().toLowerCase();
  return id === "big-pickle" || id.endsWith("-free");
}
function matchesAgent(entryAgents, agent) {
  if (!entryAgents || entryAgents.length === 0) return true;
  return entryAgents.includes(agent);
}
function matchesProvider(entryProvider, providerId) {
  return entryProvider === providerId || entryProvider === "*";
}
function findBlacklistEntry(ctx) {
  for (const entry of BLACKLIST_ENTRIES) {
    if (entry.modelId !== ctx.modelId) continue;
    if (!matchesProvider(entry.provider, ctx.providerId)) continue;
    if (!matchesAgent(entry.agents, ctx.agent)) continue;
    return entry;
  }
  return null;
}
function hideReason(ctx) {
  if (ctx.providerId === "antigravity" && isAntigravityCloudCodeHelperSlot(ctx.modelId)) {
    return "[antigravity-oauth] Cloud Code helper/internal slot";
  }
  if (isZenFreeTierModel(ctx.providerId, ctx.modelId)) {
    return "[zen-free-tier] restricted to the OpenCode client (403 outside)";
  }
  const blacklist = findBlacklistEntry(ctx);
  if (blacklist) return `[blacklist:${blacklist.category}] ${blacklist.reason}`;
  const modelsDev = findModelsDevModel(ctx.providerId, ctx.modelId, loadModelsDevCache());
  if (modelsDev && shouldHideByModelsDevCapabilities(modelsDev)) {
    return "[models.dev] incompatible capabilities for coding agents";
  }
  return null;
}
function shouldHideModel(ctx) {
  return hideReason(ctx) !== null;
}

// src/models.ts
var BRAND_MAP = [
  ["claude", "Claude"],
  ["gpt", "GPT"],
  ["gemini", "Gemini"],
  ["deepseek", "DeepSeek"],
  ["qwen", "Qwen"],
  ["minimax", "MiniMax"],
  ["kimi", "Kimi"],
  ["glm", "GLM"],
  ["mimo", "MiMo"],
  ["grok", "Grok"],
  ["nemotron", "Nemotron"]
];
function deriveBrand(family) {
  const lower = family.toLowerCase();
  for (const [prefix, brand] of BRAND_MAP) {
    if (lower.startsWith(prefix)) return brand;
  }
  return "Other";
}
function readModelsFromModelsDev(backendId, cache = loadModelsDevCache()) {
  const providerKey = resolveModelsDevSlug(backendId);
  const providerData = cache[providerKey];
  if (!providerData?.models) return null;
  const result = /* @__PURE__ */ new Map();
  for (const [modelKey, entry] of Object.entries(providerData.models)) {
    const id = entry.id ?? modelKey;
    if (entry.status === "deprecated") continue;
    const isFree = entry.cost !== void 0 && entry.cost.input === 0 && entry.cost.output === 0;
    const modelFormat = classifyModelFormat(id, entry.provider?.npm);
    result.set(id, {
      id,
      name: entry.name ?? id,
      isFree,
      brand: deriveBrand(entry.family ?? id),
      sourceBackend: backendId,
      modelFormat,
      cost: entry.cost,
      contextWindow: entry.limit?.context ?? contextWindowFromHeuristics(id),
      reasoning: entry.reasoning,
      interleavedReasoningField: entry.interleaved?.field
    });
  }
  return result;
}
async function fetchModelsFromApi(backend) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5e3);
  try {
    const res = await fetch(`${backend.baseUrl}/v1/models`, {
      signal: controller.signal,
      headers: { Authorization: "Bearer test" }
    });
    if (!res.ok) throw new Error(`API returned HTTP ${res.status}`);
    const body = await res.json();
    return body.data.map((m) => m.id);
  } finally {
    clearTimeout(timer);
  }
}
function mergeModels(apiIds, cache, backendId) {
  const uniqueIds = Array.from(new Set(apiIds));
  return uniqueIds.filter((id) => !shouldHideModel({ providerId: backendId, modelId: id, agent: "claude" })).map((id) => {
    const cached = cache?.get(id);
    if (cached) return { ...cached, sourceBackend: backendId };
    const modelFormat = classifyModelFormat(id, void 0);
    return {
      id,
      name: id,
      isFree: false,
      brand: "Other",
      sourceBackend: backendId,
      modelFormat,
      contextWindow: contextWindowFromHeuristics(id)
    };
  });
}
async function getModels(backend, fallbackModels) {
  const cache = readModelsFromModelsDev(backend.id);
  try {
    const apiIds = await fetchModelsFromApi(backend);
    return { models: mergeModels(apiIds, cache, backend.id), fromCache: false };
  } catch {
    if (cache && cache.size > 0) {
      return { models: [...cache.values()], fromCache: true };
    }
    if (fallbackModels && fallbackModels.length > 0) {
      return { models: fallbackModels, fromCache: true };
    }
    throw new Error(
      "Cannot fetch models. Check your network and https://opencode.ai status."
    );
  }
}

// src/providers.ts
function resolveEndpoint(npm, apiUrl) {
  if (!npm) return null;
  if (npm === "@ai-sdk/anthropic") {
    return {
      format: "anthropic",
      baseUrl: (apiUrl || "https://api.anthropic.com").replace(/\/v1\/?$/, "")
    };
  }
  if (npm === "@ai-sdk/openai-compatible") {
    if (!apiUrl) return null;
    return {
      format: "openai",
      completionsUrl: apiUrl.replace(/\/$/, "") + "/chat/completions"
    };
  }
  return { format: "openai" };
}
function normalizeProviders(raw, opts) {
  const agent = opts?.agent ?? "claude";
  const result = [];
  for (const provider of raw) {
    const hasKey = !!provider.key?.trim();
    if (!hasKey && !opts?.includeOAuthPlaceholders) continue;
    const models = [];
    for (const model of Object.values(provider.models ?? {})) {
      if (shouldHideModel({ providerId: provider.id, modelId: model.id, agent })) continue;
      const endpoint = resolveEndpoint(model.api?.npm ?? "", model.api?.url ?? "");
      if (endpoint === null) continue;
      models.push({
        id: model.id,
        name: model.name ?? model.id,
        family: model.family ?? "",
        brand: deriveBrand(model.family ?? ""),
        modelFormat: endpoint.format,
        upstreamModelId: model.api?.id ?? model.id,
        baseUrl: endpoint.baseUrl,
        completionsUrl: endpoint.completionsUrl,
        npm: model.api?.npm,
        apiBaseUrl: model.api?.url,
        cost: model.cost,
        contextWindow: resolveContextWindow(model.id, model.limit?.context),
        supportedParameters: model.supportedParameters ?? model.supported_parameters,
        reasoning: model.reasoning,
        interleavedReasoningField: model.interleaved?.field
      });
    }
    if (models.length === 0) continue;
    result.push({
      id: provider.id,
      name: provider.name,
      apiKey: provider.key?.trim() ?? "",
      models
    });
  }
  return result;
}

// src/registry/refresh-credentials.ts
var PLACEHOLDER_KEYS = /* @__PURE__ */ new Set([
  "anything",
  "local",
  "ollama",
  "none",
  "n/a",
  "na",
  "placeholder",
  "test",
  "no-key"
]);
var ENV_FALLBACK_BY_PROVIDER = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"]
};
function isPlaceholderProviderKey(key) {
  if (!key?.trim()) return true;
  return PLACEHOLDER_KEYS.has(key.trim().toLowerCase());
}
function isLikelyPlaceholderKey(key) {
  if (isPlaceholderProviderKey(key)) return true;
  const trimmed = key?.trim() ?? "";
  if (trimmed.length <= 2) return true;
  return false;
}
function cachedModelCount(provider) {
  return getProviderModels(provider).length;
}
function skipWithCachedModels(provider, reason) {
  const count = cachedModelCount(provider);
  return {
    id: provider.id,
    name: provider.name,
    ok: true,
    skipped: true,
    modelCount: count > 0 ? count : void 0,
    reason
  };
}
async function resolveRefreshCredential(provider, resolveKey) {
  let key;
  try {
    key = await resolveKey(provider);
  } catch {
    key = null;
  }
  if (!isLikelyPlaceholderKey(key)) return key;
  for (const envVar of ENV_FALLBACK_BY_PROVIDER[provider.id] ?? []) {
    const fromEnv = process.env[envVar]?.trim();
    if (fromEnv && !isLikelyPlaceholderKey(fromEnv)) return fromEnv;
  }
  return key;
}

// src/registry/import-build.ts
function oauthAuthRef(providerId) {
  return `keyring:oauth:provider:${providerId}`;
}
function toOAuthRegistryId(id) {
  if (id === "openai") return "openai-oauth";
  if (id === "xai") return "xai-oauth";
  return id;
}
function normalizeImportProviderIdentity(provider) {
  if (provider.id === "opencode") {
    return { ...provider, id: "zen", name: "OpenCode Zen" };
  }
  if (provider.id === "opencode-go") {
    return { ...provider, id: "go", name: "OpenCode Go" };
  }
  return provider;
}
function buildImportProviderList(raw, authEntries) {
  const oauthByProviderId = /* @__PURE__ */ new Map();
  const covered = /* @__PURE__ */ new Set();
  const merged = [];
  const rawWithLegacyKeys = raw.map((provider) => {
    const authEntry = authEntries[provider.id];
    if (provider.key?.trim() || !isOpencodeApi(authEntry)) return provider;
    return { ...provider, key: authEntry.key };
  });
  for (const provider of normalizeProviders(rawWithLegacyKeys)) {
    const normalized = normalizeImportProviderIdentity(provider);
    if (covered.has(normalized.id)) continue;
    merged.push(normalized);
    covered.add(normalized.id);
  }
  for (const provider of raw) {
    if (provider.id === "opencode" || provider.id === "opencode-go") continue;
    if (covered.has(provider.id)) continue;
    const authEntry = authEntries[provider.id];
    if (!isOpencodeOAuth(authEntry)) continue;
    const oauthProviders = normalizeProviders(
      [{ ...provider, key: authEntry.access }],
      { includeOAuthPlaceholders: true }
    );
    if (oauthProviders.length === 0) continue;
    const registryId = toOAuthRegistryId(provider.id);
    oauthByProviderId.set(registryId, authEntry);
    merged.push({ ...oauthProviders[0], id: registryId, apiKey: "" });
    covered.add(registryId);
    covered.add(provider.id);
  }
  return { providers: merged, oauth: { oauthByProviderId } };
}
function isOAuthImportProvider(providerId, oauth) {
  return oauth.oauthByProviderId.has(providerId);
}
var OPENCODE_OAUTH_PROVIDER_IDS = /* @__PURE__ */ new Set([
  "xai",
  "openai",
  "github",
  "gitlab",
  "kimi",
  "moonshot"
]);
var OPENCODE_MANUAL_ONLY_IDS = /* @__PURE__ */ new Set([
  "google-vertex",
  "vertex",
  "bedrock",
  "azure"
]);
function classifyOpencodeCredentialGap(providerId) {
  if (OPENCODE_MANUAL_ONLY_IDS.has(providerId)) return "manual-only";
  if (OPENCODE_OAUTH_PROVIDER_IDS.has(providerId)) return "oauth-no-token";
  return "no-api-key";
}
function listCredentialSkippedProviders(raw, authEntries, importedIds, alreadyReportedIds = /* @__PURE__ */ new Set(), registryProviderIds = /* @__PURE__ */ new Set()) {
  const skipped = [];
  for (const provider of raw) {
    if (provider.id === "opencode" || provider.id === "opencode-go") continue;
    if (importedIds.has(provider.id)) continue;
    if (alreadyReportedIds.has(provider.id)) continue;
    const hasApiKey = !!provider.key?.trim() && !isLikelyPlaceholderKey(provider.key);
    if (hasApiKey) continue;
    if (isOpencodeOAuth(authEntries[provider.id])) continue;
    if (!provider.models || Object.keys(provider.models).length === 0) continue;
    const reason = classifyOpencodeCredentialGap(provider.id);
    if (reason !== "oauth-no-token" && !provider.configured && !registryProviderIds.has(provider.id)) continue;
    skipped.push({ id: provider.id, name: provider.name, reason });
  }
  return skipped;
}

// src/provider-runtime.ts
function providerRefreshToken(providerId, authType, authRef) {
  if (authType !== "oauth" || !providerId) return void 0;
  return () => forceRefreshProviderCredential(providerId, authRef ?? oauthAuthRef(providerId));
}

// src/catalog.ts
function localModelToRoute(lp, model) {
  if (model.modelFormat === "anthropic" && !model.baseUrl) return null;
  if (model.modelFormat === "openai" && !isSdkMigratedNpm(model.npm) && !model.completionsUrl) return null;
  const upstreamUrl = model.modelFormat === "cloud-code" ? model.baseUrl ?? ANTIGRAVITY_BASE_URLS[0] : model.modelFormat === "anthropic" ? model.baseUrl : model.completionsUrl;
  return {
    aliasId: claudeCodeClientModelId(aliasModelId(model.id, lp.id), model.contextWindow),
    realModelId: model.upstreamModelId,
    displayName: `${model.name || model.id} (${lp.name})`,
    upstreamUrl: upstreamUrl ?? "",
    apiKey: lp.apiKey,
    modelFormat: model.modelFormat,
    contextWindow: model.contextWindow,
    npm: model.npm,
    baseURL: model.apiBaseUrl,
    providerId: lp.id,
    authType: lp.authType,
    oauthAccountId: lp.oauthAccountId,
    providerData: lp.providerData,
    refreshToken: providerRefreshToken(lp.id, lp.authType, lp.authRef),
    headers: lp.headers,
    supportedParameters: model.supportedParameters,
    reasoning: model.reasoning,
    interleavedReasoningField: model.interleavedReasoningField,
    reasoningEffortLevels: model.reasoningEffortLevels,
    reasoningEffortConflict: model.reasoningEffortConflict,
    useResponsesLite: model.useResponsesLite,
    preferWebSockets: model.preferWebSockets
  };
}
function makeRouteResolver(localProviders) {
  return (providerId, modelId) => {
    const provider = localProviders?.find((lp) => lp.id === providerId);
    const model = provider?.models.find((m) => m.id === modelId);
    return provider && model ? localModelToRoute(provider, model) ?? void 0 : void 0;
  };
}
function buildCatalogRoutes(startingRoute, favorites, resolveRoute, max = MAX_MODEL_CATALOG) {
  const droppedFavorites = [];
  const tail = favorites.map((fav) => {
    const route = resolveRoute(fav.providerId, fav.modelId);
    if (!route) droppedFavorites.push(fav);
    return route;
  }).filter((route) => route !== void 0);
  const routes = [
    startingRoute,
    ...tail.filter((route) => route.aliasId !== startingRoute.aliasId)
  ].slice(0, max);
  return { routes, droppedFavorites };
}

// src/registry/materialize.ts
init_provider_templates();

// src/registry/model-protocol.ts
function reconcileCachedModelProtocol(model, provider, metadata = loadModelsDevCache()) {
  if (model.source === "manual") return model;
  const isZenGo = provider.id === "zen" || provider.id === "go" || provider.templateId === "zen" || provider.templateId === "go";
  if (!isZenGo) return model;
  const metadataNpm = findModelsDevModel(provider.id, model.id, metadata)?.provider?.npm;
  if (!metadataNpm) return model;
  const format = classifyModelFormat(model.id, metadataNpm);
  if (format === "unsupported") return model;
  const backendId = provider.id === "go" || provider.templateId === "go" ? "go" : "zen";
  const apiUrl = model.apiUrl ?? provider.api.url ?? BACKENDS[backendId].baseUrl;
  return {
    ...model,
    modelFormat: format,
    npm: metadataNpm,
    apiUrl
  };
}

// src/registry/materialize.ts
function cachedModelToLocal(cached, provider, metadata = loadModelsDevCache()) {
  const reconciled = reconcileCachedModelProtocol(cached, provider, metadata);
  cached = reconciled;
  const freeStatus = classifyFreeStatus({
    model: cached,
    providerId: provider.id,
    templateId: provider.templateId
  });
  if (cached.modelFormat === "cloud-code") {
    const { id: id2 } = normalizeGoogleModelId(cached.id, "");
    return {
      id: id2,
      name: cached.name,
      family: cached.family ?? "",
      brand: cached.brand ?? deriveBrand(cached.family ?? ""),
      modelFormat: "cloud-code",
      upstreamModelId: cached.upstreamModelId ?? cached.id,
      contextWindow: cached.contextWindow ?? resolveContextWindow(id2),
      isFree: isFreeStatus(freeStatus),
      freeStatus,
      reasoning: cached.reasoning,
      interleavedReasoningField: cached.interleavedReasoningField
    };
  }
  const modelsDev = findModelsDevModel(provider.id, cached.id, metadata);
  const isZenGo = provider.id === "zen" || provider.id === "go" || provider.templateId === "zen" || provider.templateId === "go";
  const metadataNpm = !cached.source && isZenGo ? modelsDev?.provider?.npm : void 0;
  const npm = cached.npm ?? provider.api.npm ?? "";
  const apiUrl = cached.apiUrl ?? provider.api.url ?? (isZenGo ? BACKENDS[provider.id === "go" || provider.templateId === "go" ? "go" : "zen"].baseUrl : "");
  const endpoint = resolveEndpoint(npm, apiUrl);
  if (endpoint === null) return null;
  const { id, upstreamModelId: upstreamModelId2 } = normalizeGoogleModelId(cached.id, npm);
  const normalizedUpstream = normalizeGoogleModelId(cached.upstreamModelId ?? cached.id, npm).upstreamModelId;
  const family = npm === "@ai-sdk/google" ? id.split(/[-/:]/)[0] ?? id : cached.family ?? "";
  const classifiedFormat = classifyModelFormat(cached.id, npm);
  const resolvedFormat = classifiedFormat === "anthropic" ? classifiedFormat : "openai";
  return {
    id,
    name: npm === "@ai-sdk/google" ? normalizeGoogleDisplayName(cached.name, id) : cached.name,
    family,
    brand: npm === "@ai-sdk/google" ? deriveBrand(family) : cached.brand ?? deriveBrand(cached.family ?? ""),
    modelFormat: metadataNpm ? resolvedFormat : cached.modelFormat ?? endpoint.format,
    upstreamModelId: normalizedUpstream,
    baseUrl: endpoint.baseUrl,
    completionsUrl: endpoint.completionsUrl,
    npm: npm || void 0,
    apiBaseUrl: apiUrl || void 0,
    cost: cached.cost,
    isFree: isFreeStatus(freeStatus),
    freeStatus,
    // ClinePass's public catalog does not currently report per-model context
    // limits. Preserve that unknown state for the picker instead of displaying
    // a heuristic as if it were provider metadata. Launch-time callers still
    // resolve their required safety fallback when they build the child env or
    // proxy catalog.
    contextWindow: cached.source === "manual" ? cached.contextWindow : provider.id === "cline-pass" && cached.contextWindow === CLINE_PASS_LEGACY_DEFAULT_CONTEXT_WINDOW && cached.contextWindowSource !== "provider" ? void 0 : cached.contextWindow ?? (provider.id === "cline-pass" ? void 0 : resolveContextWindow(id)),
    supportedParameters: cached.supportedParameters,
    ...resolveModelReasoningMetadata(
      provider.id,
      cached.id,
      {
        // ChatGPT-login models that aren't in the seed list were saved with a name-based
        // reasoning guess; models.dev (OpenAI's own entry) is the better source.
        reasoning: provider.id === "openai-oauth" ? findModelsDevModel(provider.id, cached.id, metadata)?.reasoning ?? cached.reasoning : cached.reasoning,
        interleavedField: cached.interleavedReasoningField
      },
      metadata
    ),
    useResponsesLite: cached.useResponsesLite,
    preferWebSockets: cached.preferWebSockets
  };
}
function providerAllowsAnonymousFreeModels(provider) {
  const template = getTemplateById(provider.templateId) ?? getTemplateById(provider.id);
  return template?.anonymousFreeModels === true;
}
function materializeOne(provider, resolveCredential, agent) {
  if (!provider.enabled) return null;
  if (!isValidProviderId(provider.id)) return null;
  const freeOnly = provider.subscriptionFilter === "free";
  const apiKey = resolveCredential(provider) ?? "";
  const anonymousFreeOnly = !apiKey.trim() && providerAllowsAnonymousFreeModels(provider);
  const models = [];
  for (const cached of getProviderModels(provider)) {
    const freeStatus = classifyFreeStatus({
      model: cached,
      providerId: provider.id,
      templateId: provider.templateId
    });
    if ((freeOnly || anonymousFreeOnly) && !isFreeStatus(freeStatus)) continue;
    const model = cachedModelToLocal(cached, provider);
    if (!model) continue;
    if (shouldHideModel({ providerId: provider.id, modelId: model.id, agent })) continue;
    models.push(model);
  }
  if (models.length === 0) return null;
  if (!apiKey.trim() && !anonymousFreeOnly) return null;
  return {
    id: provider.id,
    name: provider.name,
    apiKey,
    authRef: provider.authRef,
    authType: provider.authType,
    headers: provider.api.headers,
    models
  };
}
function materializeRegistry(registry, resolveCredential, opts) {
  const agent = opts?.agent ?? "claude";
  const result = [];
  for (const provider of registry.providers) {
    const local = materializeOne(provider, resolveCredential, agent);
    if (local) result.push(local);
  }
  return result;
}

// src/registry/copilot-models.ts
var FREE_MODEL_IDS = /* @__PURE__ */ new Set([
  "gpt-4.1",
  "gpt-4o",
  "gpt-4o-mini",
  "raptor-mini",
  "goldeneye"
]);
var FREE_CHAT_BLOCKLIST = /* @__PURE__ */ new Set(["gpt-5-mini"]);
function copilotPlanTier(providerData) {
  const copilot = providerData?.["copilot"];
  if (!copilot || typeof copilot !== "object" || Array.isArray(copilot)) return "unknown";
  const summary = copilot;
  if (summary["lookup_status"] === "unknown") return "unknown";
  if (summary["is_free_plan"] === true) return "free";
  if (summary["is_free_plan"] === false) return "paid";
  return "unknown";
}
function normalizeCopilotModels(rows, tier) {
  const models = [];
  for (const value of rows) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const row = value;
    const id = typeof row["id"] === "string" ? row["id"].trim() : "";
    if (!id || !copilotModelAllowed(row, tier)) continue;
    const lowerId = id.toLowerCase();
    const isFree = tier !== "paid" || copilotModelIsIncluded(row);
    const family = lowerId.split(/[-/:]/)[0] ?? lowerId;
    const contextWindow2 = numericValue(row["context_length"]) ?? numericValue(row["contextWindow"]) ?? numericValue(row["context_window"]) ?? resolveContextWindow(id);
    models.push({
      id,
      name: `${id} [Copilot]`,
      upstreamModelId: id,
      family,
      brand: deriveBrand(family),
      contextWindow: contextWindow2,
      isFree,
      freeStatus: isFree ? "verified_free" : "unknown",
      modelFormat: "openai",
      npm: "@ai-sdk/openai-compatible",
      apiUrl: "https://api.githubcopilot.com"
    });
  }
  return models;
}
function filterCachedCopilotModels(models, tier) {
  return models.flatMap((model) => {
    const id = model.id.toLowerCase();
    if (!copilotIdIsCallable(id)) return [];
    if (tier !== "paid" && (!FREE_MODEL_IDS.has(id) || FREE_CHAT_BLOCKLIST.has(id))) return [];
    if (tier === "paid") return [model];
    return [{ ...model, isFree: true, freeStatus: "verified_free" }];
  });
}
function copilotModelAllowed(row, tier) {
  const id = String(row["id"] ?? "").toLowerCase();
  if (!copilotIdIsCallable(id)) return false;
  if (row["model_picker_enabled"] === false) return false;
  const policy = row["policy"];
  if (policy && typeof policy === "object" && !Array.isArray(policy)) {
    if (String(policy["state"] ?? "").toLowerCase() === "disabled") return false;
  }
  const capabilities = row["capabilities"];
  if (capabilities && typeof capabilities === "object" && !Array.isArray(capabilities)) {
    const family = String(capabilities["family"] ?? "").toLowerCase();
    if (family.includes("embedding")) return false;
  }
  const endpoints = row["supported_endpoints"];
  if (Array.isArray(endpoints) && endpoints.length > 0) {
    const supportsChat = endpoints.some((endpoint) => {
      const normalized = String(endpoint).toLowerCase().replace(/\/$/, "");
      return normalized.endsWith("/chat/completions") || normalized === "chat/completions";
    });
    if (!supportsChat) return false;
  }
  if (tier !== "paid" && (!FREE_MODEL_IDS.has(id) || FREE_CHAT_BLOCKLIST.has(id))) return false;
  return true;
}
function copilotIdIsCallable(id) {
  return id !== "auto" && !id.endsWith("-auto") && !id.includes("embedding");
}
function copilotModelIsIncluded(row) {
  const id = String(row["id"] ?? "").toLowerCase();
  if (FREE_CHAT_BLOCKLIST.has(id) || !copilotIdIsCallable(id)) return false;
  const billing = row["billing"];
  if (billing && typeof billing === "object" && !Array.isArray(billing)) {
    const multiplier = numericValue(billing["multiplier"]);
    if (multiplier !== void 0) return multiplier === 0;
  }
  return FREE_MODEL_IDS.has(id);
}
function numericValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return void 0;
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
      if (provider.id !== "github-copilot" || !provider.modelsCache) return provider;
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
function providersForPicker(providers) {
  for (const p8 of providers) {
    p8.models.sort((a, b) => {
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
  const template = getTemplateById(provider.id);
  if (template?.apiKeyOptional || template?.anonymousFreeModels) {
    return "anonymous";
  }
  const reg = loadRegistry().providers.find((p8) => p8.id === provider.id);
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
  const entries2 = [];
  for (const provider of reg.providers) {
    entries2.push({
      id: provider.id,
      name: provider.name,
      modelCount: getProviderModels(provider).length,
      enabled: provider.enabled,
      authLabel: formatRegistryAuthLabel(provider),
      inRegistry: true
    });
  }
  return entries2.sort((a, b) => a.name.localeCompare(b.name));
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
  const routes = [];
  const seen = /* @__PURE__ */ new Set();
  for (const fav of resolvedFavorites) {
    if (routes.length >= maxRoutes) break;
    const favModel = fav.model;
    const modelId = favModel.id;
    const safeModelSlug = modelId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const catalogId = `relay-ai__${fav.providerId}__${safeModelSlug}`;
    if (seen.has(catalogId)) continue;
    seen.add(catalogId);
    const npm = favModel.npm || "@ai-sdk/openai-compatible";
    const upstreamModelId2 = favModel.upstreamModelId || modelId;
    const baseURL = favModel.apiBaseUrl || favModel.completionsUrl || void 0;
    const contextWindow2 = favModel.contextWindow;
    const modelFormat = favModel.modelFormat;
    routes.push({
      catalogId,
      providerId: fav.providerId,
      providerName: fav.providerName,
      modelId,
      upstreamModelId: upstreamModelId2,
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
      contextWindow: contextWindow2
    });
    const route = routes.pop();
    routes.push(...effortVariants(route, favModel, routes.length === 0, effortMode));
  }
  const labeled = applyUniqueAntigravityRouteLabels(routes.slice(0, maxRoutes));
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
function buildListExperimentsResponse() {
  return {
    experimentIds: [...CURRENT_EXPERIMENT_IDS]
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
function meetsContextFloor(target, contextWindow2) {
  return contextWindow2 === void 0 || contextWindow2 >= contextFloorForTarget(target);
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
    if (ctx.providerId === "zen" || ctx.providerId === "go") return { compatible: true };
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

// src/registry/builtins.ts
function zenRegistryStub(subscriptionFilter) {
  return {
    id: "zen",
    templateId: "zen",
    name: "OpenCode Zen",
    enabled: true,
    authRef: "keyring:global:opencode",
    api: {},
    ...subscriptionFilter ? { subscriptionFilter } : {},
    addedAt: localIsoTimestamp()
  };
}
function goRegistryStub() {
  return {
    id: "go",
    templateId: "go",
    name: "OpenCode Go",
    enabled: true,
    authRef: "keyring:global:opencode",
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
async function fetchAnthropicModels(baseUrl, apiKey, extraHeaders, timeoutMs) {
  const root = baseUrl.replace(/\/v1\/?$/, "").replace(/\/$/, "");
  const modelsUrl2 = `${root}/v1/models`;
  const defaultTimeoutMs = endpointModelTimeoutMs("anthropic", root);
  const effectiveTimeoutMs = clampModelTimeoutMs(timeoutMs ?? defaultTimeoutMs, defaultTimeoutMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), effectiveTimeoutMs);
  try {
    const response = await fetch(modelsUrl2, {
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
    let logTrace;
    if (process.env.RELAY_AI_TRACE === "1") {
      logTrace = makeTraceLogger(getProviderDebugLogPath());
    }
    const rawBodyText = response.ok ? await response.text() : await response.text().catch(() => "");
    if (logTrace) {
      logTrace(`[fetchAnthropicModels] HTTP ${response.status} from ${modelsUrl2}`);
      logTrace(`[fetchAnthropicModels] Body: ${rawBodyText}`);
    }
    if (response.ok) {
      let json = {};
      try {
        if (rawBodyText.trim()) {
          json = JSON.parse(rawBodyText);
        }
      } catch {
      }
      const models = [];
      for (const row of json.data ?? []) {
        const id = row.id?.trim();
        if (!id) continue;
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
      if (models.length > 0) return { models, baseUrl: root };
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
  } catch {
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
      const cwProp = row.properties.find((p8) => p8.property_id === "context_window");
      if (cwProp?.value) contextWindowFromProps = toNumber(cwProp.value);
      const priceProp = row.properties.find((p8) => p8.property_id === "price");
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
    const { id, upstreamModelId: upstreamModelId2 } = normalizeGoogleModelId(rawId, npm);
    const family = id.replace(/^@[a-z0-9_-]+\//i, "").split(/[-/:]/)[0] ?? id;
    const cost = costFromProps ?? parseNativePricing(row.pricing);
    const freeStatus = classifyFreeStatus({
      model: { cost, isFree: row.isFree },
      // Cloudflare standard models carry a list price but are covered by the free
      // daily Neuron allowance, so free access is a provider rule, not a price.
      freeAccess: isFreeFromProps === true
    });
    const contextWindow2 = contextWindowFromProps ?? row.context_length ?? row.contextWindow ?? row.context_window ?? resolveContextWindow(id);
    models.push({
      id,
      name: normalizeGoogleDisplayName(row.name, id),
      upstreamModelId: upstreamModelId2,
      family,
      brand: deriveBrand(family),
      contextWindow: contextWindow2,
      cost,
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
  } catch {
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
  if (!registry.providers.some((p8) => p8.id === base)) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}-${i}`;
    if (isValidProviderId(candidate) && !registry.providers.some((p8) => p8.id === candidate)) {
      return candidate;
    }
  }
  return `${base}-${Date.now()}`;
}
async function fetchCustomEndpointModels(input) {
  const timeoutMs = endpointModelTimeoutMs(`custom-${input.kind}`, input.normalizedBaseUrl);
  if (input.kind === "anthropic") {
    return fetchAnthropicModels(input.normalizedBaseUrl, input.apiKey, input.headers, timeoutMs);
  }
  return fetchTemplateModels(
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
  );
}
async function addCustomEndpointProvider(input) {
  const urlCheck = await validateCustomEndpointUrl(input.baseUrl, {
    allowInsecureLocal: input.allowInsecureLocal
  });
  if (!urlCheck.ok || !urlCheck.normalizedUrl) {
    return { added: false, error: urlCheck.error, hint: urlCheck.hint };
  }
  const registry = loadRegistry();
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
    return { added: false, error: fetched.error ?? "No models returned.", hint: fetched.hint };
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
  return { added: true, provider: entry, modelCount: fetched.models.length };
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
    ...testFailed ? { modelsStale: true } : {}
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
  const run3 = async () => {
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
  await Promise.all(Array.from({ length: concurrency }, run3));
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
  if (provider.id === "zen" || provider.id === "go" || provider.templateId === "zen" || provider.templateId === "go") {
    return "zen-go-api";
  }
  if (MANUAL_ONLY_PROVIDER_IDS.has(provider.id) || MANUAL_ONLY_PROVIDER_IDS.has(provider.templateId) || MANUAL_ONLY_TEMPLATE_IDS.has(provider.templateId) || provider.api.npm && MANUAL_ONLY_NPMS.has(provider.api.npm)) {
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
  const backendId = provider.id === "go" || provider.templateId === "go" ? "go" : "zen";
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
  for (const base of ANTIGRAVITY_BASE_URLS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1e4);
      const res = await fetch(`${base}/v1internal:fetchAvailableModels`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
          "User-Agent": "vscode/1.X.X (Antigravity/4.2.0)",
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
      if (raw.length === 0) continue;
      const models = raw.filter((m) => typeof m.id === "string" && m.id.length > 0 && !isAntigravityCloudCodeHelperSlot(m.id)).map((m) => {
        const id = m.id;
        const name = m.displayName ?? m.name ?? id;
        const isGemini = id.startsWith("gemini");
        const isClaude = id.startsWith("claude");
        const isOpenAi = id.startsWith("gpt") || id.startsWith("o");
        const maxTokens = typeof m.maxTokens === "number" ? m.maxTokens : void 0;
        return {
          id,
          name,
          upstreamModelId: resolveUpstreamModelId(id),
          family: isGemini ? "gemini" : id.split("-")[0] ?? id,
          brand: isGemini ? "Google" : isClaude ? "Anthropic" : isOpenAi ? "OpenAI" : "Other",
          contextWindow: maxTokens ?? resolveContextWindow(id),
          modelFormat: "cloud-code",
          reasoning: m.supportsThinking === true || id.includes("thinking") || id.includes("pro")
        };
      });
      if (models.length > 0) return { models, source: "live" };
    } catch {
    }
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
    return {
      models: fetched2.models.map((m) => ({ ...m, apiUrl: fetched2.baseUrl })),
      baseUrl: fetched2.baseUrl
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
  return {
    models: usableModels.map((m) => ({
      ...m,
      apiUrl: fetched.baseUrl
    })),
    baseUrl: fetched.baseUrl
  };
}
function updateProviderCache(registry, providerId, models, baseUrl) {
  const idx = registry.providers.findIndex((p8) => p8.id === providerId);
  if (idx < 0) return;
  const now = localIsoTimestamp();
  const currentProviders = new Map(loadRegistry().providers.map((p8) => [p8.id, p8]));
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
  if (provider.id !== "antigravity") return models;
  return models.filter((model) => !shouldHideModel({
    providerId: provider.id,
    modelId: model.id,
    agent: "claude"
  }));
}
async function refreshProviderModels(providerId, apiKey, registry = loadRegistry()) {
  const provider = registry.providers.find((p8) => p8.id === providerId);
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
    const previousModelCount = getProviderModels(provider).length;
    let models = [];
    let baseUrl;
    let oauthFallbackReason;
    if (source === "zen-go-api") {
      models = await refreshZenGoProvider(provider);
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
    } else if (provider.authType === "oauth" && (["openai", "xai", "xai-oauth", "github-copilot", "claude-code", "antigravity"].includes(provider.templateId ?? provider.id) || provider.id === "openai-oauth" || provider.id === "xai-oauth")) {
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
    if (provider.id === "antigravity" && enriched.length === 0) {
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
      modelCount: getProviderModels(registry.providers.find((p8) => p8.id === providerId)).length,
      previousModelCount: provider.refreshedAt ? previousModelCount : void 0,
      reason: oauthFallbackReason
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
    if (!registry.providers.some((p8) => p8.id === "zen")) {
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
    if (!registry.providers.some((p8) => p8.id === "go")) {
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
  const enabledProviders = registry.providers.filter((p8) => p8.enabled);
  return refreshProviderModelsBatch(enabledProviders, resolveKey, registry);
}

// src/registry/crud.ts
function credentialStillReferenced(authRef, remaining) {
  return remaining.some((p8) => p8.authRef === authRef);
}
async function removeProviderFromRegistry(id, opts) {
  const registry = loadRegistry();
  const index = registry.providers.findIndex((p8) => p8.id === id);
  if (index < 0) {
    return { removed: false, id, credentialDeleted: false, error: `Provider not found: ${id}` };
  }
  const [removedProvider] = registry.providers.splice(index, 1);
  saveRegistry(registry);
  let credentialDeleted = false;
  if (opts?.deleteCredential !== false) {
    const parsed = parseAuthRef(removedProvider.authRef);
    const isGlobal = parsed?.kind === "keyring" && parsed.account === GLOBAL_OPENCODE_KEYRING_ACCOUNT;
    const shouldDelete = !isGlobal || !credentialStillReferenced(removedProvider.authRef, registry.providers);
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
function addZenRegistryStub(opts) {
  const registry = loadRegistry();
  if (registry.providers.some((p8) => p8.id === "zen")) {
    return { added: false, reason: "OpenCode Zen is already configured." };
  }
  registry.providers.push(zenRegistryStub(opts?.subscriptionFilter));
  saveRegistry(registry);
  return { added: true };
}
function addGoRegistryStub() {
  const registry = loadRegistry();
  if (registry.providers.some((p8) => p8.id === "go")) {
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
    const provider = registry.providers.find((p8) => p8.id === id);
    if (!provider || (provider.modelsCache?.models.length ?? 0) > 0) continue;
    const key = await resolveProviderCredential(provider.id, provider.authRef);
    const result = await refreshProviderModels(provider.id, key, registry);
    if (result.ok && !result.skipped) refreshed.push(id);
  }
  return { seeded, refreshed };
}
async function addOpencodeCloudFromApiKey(apiKey) {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    return { added: false, error: "API key cannot be empty." };
  }
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
function toggleProviderEnabled(id) {
  const registry = loadRegistry();
  const provider = registry.providers.find((p8) => p8.id === id);
  if (!provider) return { toggled: false, error: `Provider not found: ${id}` };
  provider.enabled = !provider.enabled;
  saveRegistry(registry);
  return { toggled: true, enabled: provider.enabled };
}

// src/server/index.ts
import pc4 from "picocolors";
import * as p4 from "@clack/prompts";

// src/server/advertise-addrs.ts
import { networkInterfaces } from "os";
function getLocalIps() {
  const ifaces = networkInterfaces();
  const result = [];
  for (const [name, iface] of Object.entries(ifaces)) {
    for (const addr of iface ?? []) {
      if (addr.family === "IPv4" && !addr.internal) {
        result.push({ name, address: addr.address });
      }
    }
  }
  return result;
}
function isLoopbackHost(host) {
  const h = host.trim().toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "0.0.0.0";
}
function hostFromHeader(hostHeader) {
  if (!hostHeader?.trim()) return void 0;
  let host = hostHeader.trim();
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    if (end > 0) return host.slice(1, end) || void 0;
  }
  const colon = host.lastIndexOf(":");
  if (colon > 0 && host.indexOf(":") === colon) {
    host = host.slice(0, colon);
  }
  return host || void 0;
}
function parseAdvertiseHostsFromEnv(env = process.env) {
  const raw = env.RELAY_AI_ADVERTISE_HOSTS ?? env.RELAY_AI_ADVERTISE_HOST ?? "";
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const part of raw.split(/[,\s]+/)) {
    const host = part.trim();
    if (!host || isLoopbackHost(host) || seen.has(host)) continue;
    seen.add(host);
    out.push(host);
  }
  return out;
}
function resolveAdvertiseAddresses(opts) {
  const env = opts?.env ?? process.env;
  const hosts = parseAdvertiseHostsFromEnv(env);
  const req = opts?.requestHost?.trim();
  if (req && !isLoopbackHost(req) && !hosts.includes(req)) {
    hosts.push(req);
  }
  if (hosts.length > 0) {
    return hosts.map((address) => ({
      name: hosts.length === 1 ? "LAN" : address,
      address
    }));
  }
  return getLocalIps();
}
function resolveAdvertiseGatewayPort(listenPort, env = process.env) {
  const raw = env.RELAY_AI_ADVERTISE_GATEWAY_PORT ?? env.RELAY_AI_GATEWAY_HOST_PORT;
  if (!raw?.trim()) return listenPort;
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n <= 0 || n > 65535) return listenPort;
  return Math.trunc(n);
}
function formatGatewayUrls(host, port) {
  return {
    anthropicUrl: `http://${host}:${port}/anthropic`,
    openaiUrl: `http://${host}:${port}/openai/v1`
  };
}

// src/server/prompts.ts
import * as p2 from "@clack/prompts";
import pc2 from "picocolors";
async function askServerStartMode() {
  const mode = await p2.select({
    message: "How do you want to start the server?",
    options: [
      { value: "configure", label: pc2.cyan("Configure & start"), hint: "Providers, discovery masking, listen mode" },
      { value: "quick", label: pc2.cyan("Start with saved settings"), hint: "Use last server configuration" }
    ],
    initialValue: "configure"
  });
  if (p2.isCancel(mode)) {
    p2.cancel("Cancelled.");
    return null;
  }
  return mode;
}
async function askMaskGatewayIds(initialValue) {
  const mask = await p2.confirm({
    message: "Mask gateway model ids for discovery? (Needed for Claude Desktop / Cowork)",
    initialValue
  });
  if (p2.isCancel(mask)) {
    p2.cancel("Cancelled.");
    return null;
  }
  return Boolean(mask);
}
async function askFavoritesOnly(initialValue) {
  printFavoritesOnlyPanel();
  const favoritesOnly = await p2.confirm({
    message: "Expose only favorite models?",
    initialValue
  });
  if (p2.isCancel(favoritesOnly)) {
    p2.cancel("Cancelled.");
    return null;
  }
  return Boolean(favoritesOnly);
}
async function askFreeModelsOnly(initialValue) {
  const freeOnly = await p2.confirm({
    message: "Limit exposed models to free/free-access models?",
    initialValue
  });
  if (p2.isCancel(freeOnly)) {
    p2.cancel("Cancelled.");
    return null;
  }
  return Boolean(freeOnly);
}
async function askListenMode() {
  const mode = await p2.select({
    message: "Where should the server listen?",
    options: [
      { value: "local", label: pc2.cyan("Local only"), hint: "Only this computer can use it" },
      { value: "network", label: pc2.cyan("Network"), hint: "Other computers on your network can use it" }
    ],
    initialValue: "local"
  });
  if (p2.isCancel(mode)) {
    p2.cancel("Cancelled.");
    return null;
  }
  return mode;
}
async function askServerPassword() {
  printNetworkWarningPanel();
  const password = await p2.text({
    message: "Choose a server password for this run:",
    validate: (value) => value.trim() ? void 0 : "Password cannot be empty"
  });
  if (p2.isCancel(password)) {
    p2.cancel("Cancelled.");
    return null;
  }
  return String(password).trim();
}
async function askUseSavedServerPassword() {
  const choice = await p2.select({
    message: "Use saved server password?",
    options: [
      { value: "use-saved", label: pc2.cyan("Use saved password") },
      { value: "new-password", label: pc2.cyan("Enter a new password") }
    ],
    initialValue: "use-saved"
  });
  if (p2.isCancel(choice)) {
    p2.cancel("Cancelled.");
    return null;
  }
  return choice;
}
async function askSaveServerPassword() {
  const save = await p2.confirm({
    message: "Save this server password for future server runs?",
    initialValue: false
  });
  if (p2.isCancel(save)) {
    p2.cancel("Cancelled.");
    return null;
  }
  return Boolean(save);
}

// src/server/router.ts
import { createServer as createServer2 } from "http";

// src/openai-adapter.ts
import { tool, jsonSchema, streamText, generateText } from "ai";
function translateOpenAiRequest(body, requestHeaders) {
  const toolNameById = /* @__PURE__ */ new Map();
  for (const msg of body.messages) {
    if (msg.role === "assistant" && msg.tool_calls) {
      for (const tc of msg.tool_calls) toolNameById.set(tc.id, tc.function.name);
    }
  }
  let system;
  const messages = [];
  for (const msg of body.messages) {
    switch (msg.role) {
      case "system":
        system = typeof msg.content === "string" ? msg.content : void 0;
        break;
      case "user":
        messages.push({ role: "user", content: msg.content });
        break;
      case "assistant": {
        const parts = [];
        const assistantText = typeof msg.content === "string" ? msg.content : Array.isArray(msg.content) ? msg.content.filter((p8) => p8?.type === "text" && typeof p8.text === "string").map((p8) => p8.text).join("") : "";
        if (assistantText) {
          parts.push({ type: "text", text: assistantText });
        }
        for (const tc of msg.tool_calls ?? []) {
          parts.push({
            type: "tool-call",
            toolCallId: tc.id,
            toolName: tc.function.name,
            input: parseToolArguments(tc.function.arguments)
          });
        }
        messages.push({ role: "assistant", content: parts.length > 0 ? parts : "" });
        break;
      }
      case "tool": {
        const resultPart = {
          type: "tool-result",
          toolCallId: msg.tool_call_id ?? "",
          toolName: toolNameById.get(msg.tool_call_id ?? "") ?? "unknown",
          output: {
            type: "text",
            value: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? "")
          }
        };
        const lastMsg = messages[messages.length - 1];
        if (lastMsg?.role === "tool" && Array.isArray(lastMsg.content)) {
          lastMsg.content.push(resultPart);
        } else {
          messages.push({ role: "tool", content: [resultPart] });
        }
        break;
      }
    }
  }
  let sdkToolChoice;
  if (body.tool_choice === "auto" || body.tool_choice === "required") {
    sdkToolChoice = body.tool_choice;
  } else if (typeof body.tool_choice === "object" && body.tool_choice?.type === "function") {
    sdkToolChoice = { type: "tool", toolName: body.tool_choice.function.name };
  }
  let tools;
  if (body.tools?.length) {
    tools = {};
    for (const t of body.tools) {
      if (t.type === "function" && t.function.name) {
        const schema = t.function.parameters ? jsonSchema(t.function.parameters) : void 0;
        tools[t.function.name] = tool({
          description: t.function.description ?? "",
          inputSchema: schema ?? jsonSchema({ type: "object", properties: {} })
        });
      }
    }
  }
  return {
    instructions: system,
    messages,
    tools,
    toolChoice: sdkToolChoice,
    temperature: body.temperature,
    maxOutputTokens: body.max_completion_tokens ?? body.max_tokens,
    headers: requestHeaders
  };
}
function toOpenAiFinishReason(reason) {
  switch (reason) {
    case "tool-calls":
      return "tool_calls";
    case "content-filter":
      return "content_filter";
    case "length":
      return "length";
    case "stop":
      return "stop";
    default:
      return "stop";
  }
}
async function generateOpenAiResponse(model, params, responseModelId) {
  const result = await generateText({ model, ...params });
  const message = { role: "assistant", content: result.text || null };
  if (result.reasoningText || result.reasoning) {
    message.reasoning_content = result.reasoningText ?? result.reasoning;
  }
  if (result.toolCalls?.length) {
    message.tool_calls = result.toolCalls.map((tc) => ({
      id: tc.toolCallId,
      type: "function",
      function: { name: tc.toolName, arguments: JSON.stringify(tc.input ?? tc.args ?? {}) }
    }));
  }
  return {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1e3),
    model: responseModelId,
    choices: [{ index: 0, message, finish_reason: toOpenAiFinishReason(result.finishReason) }],
    usage: {
      prompt_tokens: result.usage?.promptTokens ?? 0,
      completion_tokens: result.usage?.completionTokens ?? 0,
      total_tokens: result.usage?.totalTokens ?? 0
    }
  };
}
async function streamOpenAiResponse(model, params, responseModelId, onChunk, log7) {
  const { stream } = streamText({ model, ...params });
  const baseData = {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1e3),
    model: responseModelId
  };
  const send = (delta, finish_reason = null) => onChunk(`data: ${JSON.stringify({ ...baseData, choices: [{ index: 0, delta, finish_reason }] })}

`);
  const streamedToolIndex = /* @__PURE__ */ new Map();
  let nextToolIndex = 0;
  const seenPartTypes = /* @__PURE__ */ new Set();
  let toolCallChunksEmitted = 0;
  for await (const part of stream) {
    const p8 = part;
    seenPartTypes.add(p8.type);
    switch (p8.type) {
      case "text-delta":
        send({ role: "assistant", content: p8.textDelta ?? p8.text ?? "" });
        break;
      case "reasoning-delta":
        send({ role: "assistant", reasoning_content: p8.text ?? p8.delta ?? "" });
        break;
      case "tool-input-start":
      case "tool-call-streaming-start": {
        const id = p8.id ?? p8.toolCallId ?? "";
        const index = nextToolIndex++;
        streamedToolIndex.set(id, index);
        send({ role: "assistant", tool_calls: [{ index, id, type: "function", function: { name: p8.toolName, arguments: "" } }] });
        toolCallChunksEmitted++;
        break;
      }
      case "tool-input-delta":
      case "tool-call-delta": {
        const id = p8.id ?? p8.toolCallId ?? "";
        const index = streamedToolIndex.get(id) ?? 0;
        send({ tool_calls: [{ index, function: { arguments: p8.delta ?? p8.text ?? p8.argsTextDelta ?? "" } }] });
        break;
      }
      case "tool-call": {
        const id = p8.toolCallId ?? "";
        if (streamedToolIndex.has(id)) break;
        const index = nextToolIndex++;
        send({
          role: "assistant",
          tool_calls: [{ index, id, type: "function", function: { name: p8.toolName, arguments: JSON.stringify(p8.input ?? {}) } }]
        });
        toolCallChunksEmitted++;
        break;
      }
      case "finish":
        log7?.(() => `openai stream parts=[${[...seenPartTypes].join(",")}] toolCallChunks=${toolCallChunksEmitted} finishReason=${p8.finishReason}`);
        send({}, toOpenAiFinishReason(p8.finishReason));
        break;
      case "error": {
        const errMsg = typeof p8.error === "string" ? p8.error : formatUpstreamError(p8.error);
        log7?.(() => `openai stream error parts=[${[...seenPartTypes].join(",")}]: ${errMsg}`);
        log7?.(() => {
          try {
            return `openai stream error raw: ${JSON.stringify(p8.error, Object.getOwnPropertyNames(p8.error ?? {})).slice(0, 3e3)}`;
          } catch {
            return `openai stream error raw: (unserializable) ${String(p8.error)}`;
          }
        });
        send({ role: "assistant", content: `

[relay-ai upstream error: ${errMsg}]` });
        send({}, "stop");
        onChunk("data: [DONE]\n\n");
        return;
      }
    }
  }
  onChunk("data: [DONE]\n\n");
}

// src/server/router.ts
function makeServerLog(debugLogPath) {
  if (!debugLogPath) return () => {
  };
  resetTraceLog(debugLogPath);
  return (msg) => writeSecureLogLine(debugLogPath, typeof msg === "function" ? msg() : msg);
}
async function startServer(options) {
  silenceSdkWarnings();
  const languageModelCache = /* @__PURE__ */ new Map();
  const plog = makeServerLog(options.debugLogPath);
  const subagentRouteRegistry = new SubagentRouteRegistry();
  const server = createServer2((req, res) => {
    void routeRequest(req, res, options, languageModelCache, plog, subagentRouteRegistry);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Server did not bind to a TCP port");
  }
  return {
    host: options.host,
    port: address.port,
    url: `http://${options.host}:${address.port}`,
    server,
    close: () => new Promise((resolve, reject) => {
      server.close((err) => err ? reject(err) : resolve());
    })
  };
}
async function routeRequest(req, res, options, modelCache, plog, subagentRouteRegistry) {
  try {
    const pathname = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`).pathname;
    plog(`${req.method} ${pathname}`);
    if (req.method === "GET" && pathname === "/health") {
      sendJson(res, 200, { ok: true });
      return;
    }
    if (!isAuthorized(toRequest(req), options.serverPassword)) {
      sendJson(res, 401, { error: { message: "Unauthorized" } });
      return;
    }
    if (req.method === "GET" && pathname === "/models") {
      sendJson(res, 200, { models: options.catalog.list().map(({ apiKey: _apiKey, headers: _headers, ...rest }) => rest) });
      return;
    }
    if (req.method === "GET" && pathname === "/anthropic/v1/models") {
      sendJson(res, 200, formatGatewayAnthropicModels(options.catalog.list(), options.gateway));
      return;
    }
    if (req.method === "GET" && pathname === "/openai/v1/models") {
      sendJson(res, 200, formatOpenAIModels(options.catalog.list()));
      return;
    }
    if (req.method === "POST" && pathname === "/anthropic/v1/messages") {
      await handleAnthropicMessages(req, res, options, modelCache, plog, subagentRouteRegistry);
      return;
    }
    if (req.method === "POST" && pathname === "/openai/v1/chat/completions") {
      await handleOpenAIChatCompletions(req, res, options, modelCache, plog);
      return;
    }
    sendJson(res, 404, { error: { message: "Not found" } });
  } catch (err) {
    sendJson(res, 500, { error: { message: err instanceof Error ? err.message : String(err) } });
  }
}
async function handleAnthropicMessages(req, res, options, modelCache, plog, subagentRouteRegistry) {
  let body = await readJson(req);
  if (!body) {
    sendJson(res, 400, { error: { message: "Invalid JSON body" } });
    return;
  }
  const correlatedSubagent = subagentRouteRegistry.consume(req.headers, body);
  if (correlatedSubagent) body = correlatedSubagent.body;
  const requestedModelId = correlatedSubagent?.modelId ?? body.model;
  const model = lookupModel(res, options.catalog, requestedModelId);
  if (!model) {
    plog(`model not found: ${body.model}`);
    return;
  }
  plog(() => `anthropic-messages model=${body.model} format=${model.modelFormat} npm=${model.npm ?? "none"} stream=${body.stream}`);
  if (model.modelFormat === "anthropic") {
    if (model.baseUrl && !/^https?:\/\//i.test(model.baseUrl)) {
      sendJson(res, 400, { error: { message: `Invalid provider baseUrl: must be http:// or https://` } });
      return;
    }
    const messagesUrl = model.baseUrl ? `${model.baseUrl}/v1/messages` : `${backendFor(options, model).baseUrl}/v1/messages`;
    const apiKey = model.apiKey ?? options.apiKey;
    const betaHeaderRaw = req.headers["anthropic-beta"];
    const inboundBeta = Array.isArray(betaHeaderRaw) ? betaHeaderRaw.join(",") : betaHeaderRaw;
    const clientWantsStream = Boolean(body.stream);
    const forwardBody = { ...body, model: upstreamModelId(model) };
    const isOAuth = model.authType === "oauth";
    const upstreamHeaders = openCodeGoHeaders(
      model.providerId ?? model.sourceBackend,
      model.baseUrl ?? messagesUrl,
      extractConversationId(req.headers, body),
      model.headers
    ) ?? model.headers;
    let effectiveBeta = inboundBeta;
    let claudeCodeSessionId;
    if (isOAuth) {
      const seed = model.providerId ?? upstreamModelId(model);
      const identity = injectClaudeIdentity(forwardBody, model.providerData, seed);
      if (model.providerId === "claude-code") injectClaudeCodeBillingSystemLine(forwardBody);
      claudeCodeSessionId = identity.sessionId;
      effectiveBeta = selectBetaFlags(forwardBody, upstreamModelId(model), inboundBeta);
    }
    const refreshToken = isOAuth && model.providerId ? () => resolveProviderCredential(model.providerId, oauthAuthRef(model.providerId)) : void 0;
    plog(() => `anthropic-passthrough \u2192 ${messagesUrl} oauth=${isOAuth} stream=${clientWantsStream}`);
    await relayAnthropicMessages(
      res,
      messagesUrl,
      forwardBody,
      apiKey,
      clientWantsStream,
      effectiveBeta,
      isOAuth ? "oauth" : "api",
      (message) => plog(message),
      claudeCodeSessionId,
      upstreamHeaders,
      refreshToken,
      (refreshed) => {
        model.apiKey = refreshed;
      }
    );
    return;
  }
  if (model.modelFormat === "openai") {
    if (!isSdkMigratedNpm(model.npm)) {
      sendJson(res, 400, { error: { message: `No SDK provider for model: ${model.id}` } });
      return;
    }
    const apiKey = model.apiKey ?? options.apiKey;
    const languageModel = await getOrInitLanguageModel(
      modelCache,
      model,
      model.npm,
      model.apiBaseUrl,
      apiKey,
      options.vertex,
      providerRefreshToken(model.providerId, model.authType)
    );
    const npmMaxTools = maxToolsForNpm(model.npm);
    const toolCount = Array.isArray(body.tools) ? body.tools.length : 0;
    if (npmMaxTools !== void 0 && toolCount > npmMaxTools) {
      plog(`tools truncated: ${toolCount} \u2192 ${npmMaxTools} (provider limit)`);
    }
    const subagentRouting = buildServerSubagentModelRouting(
      options.catalog.list(),
      model,
      options.gateway
    );
    const sessionId = extractClaudeSessionId(req.headers, body);
    if (sessionId) {
      subagentRouting.registerSubagentRoute = (modelId) => subagentRouteRegistry.register(sessionId, modelId);
    }
    const params = translateRequest(body, model.npm, {
      defaultEffort: anthropicEffortFromRequest(body) ? void 0 : model.defaultEffort,
      fixedEffort: model.fixedEffort,
      openAiOAuth: model.npm === "@ai-sdk/openai" && model.authType === "oauth",
      onDebug: plog,
      subagentRouting,
      reasoningMetadata: {
        providerId: model.providerId,
        apiBaseUrl: model.apiBaseUrl,
        supportedParameters: model.supportedParameters,
        reasoning: model.reasoning,
        interleavedReasoningField: model.interleavedReasoningField,
        reasoningEffortLevels: model.reasoningEffortLevels,
        reasoningEffortConflict: model.reasoningEffortConflict,
        upstreamModelId: upstreamModelId(model)
      },
      maxTools: npmMaxTools,
      ...(() => {
        const requestHeaders = openCodeGoHeaders(
          model.providerId ?? model.sourceBackend,
          model.apiBaseUrl ?? model.baseUrl,
          extractConversationId(req.headers, body),
          model.headers
        );
        return requestHeaders ? { requestHeaders } : {};
      })()
    });
    const clientWantsStream = Boolean(body.stream);
    const responseModelId = getResponseModelId(body.model, model, options);
    plog(() => `sdk npm=${model.npm} upstream=${upstreamModelId(model)} responseModel=${responseModelId} stream=${clientWantsStream}`);
    try {
      if (clientWantsStream) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive"
        });
        await streamAnthropicResponse(
          languageModel,
          params,
          responseModelId,
          (chunk) => res.write(chunk),
          plog,
          estimateAnthropicInputTokens(body)
        );
        res.end();
      } else {
        const anthropicResponse = await generateAnthropicResponse(
          languageModel,
          params,
          responseModelId,
          { forceStream: model.npm === "@ai-sdk/openai" && model.authType === "oauth", log: plog }
        );
        sendJson(res, 200, anthropicResponse);
      }
    } catch (err) {
      const message = formatUpstreamError(err);
      plog(`sdk error npm=${model.npm} upstream=${upstreamModelId(model)}: ${message}`);
      if (!res.headersSent) {
        const status = upstreamHttpStatus(err, message);
        sendJson(res, status === 500 ? 502 : status, { error: { message } });
      } else res.end();
    }
    return;
  }
  sendJson(res, 400, { error: { message: `Unsupported model format: ${model.modelFormat}` } });
}
async function handleOpenAIChatCompletions(req, res, options, modelCache, plog) {
  const body = await readJson(req);
  if (!body) {
    sendJson(res, 400, { error: { message: "Invalid JSON body" } });
    return;
  }
  plog(() => `openai-chat-completions raw body: ${JSON.stringify(body).slice(0, 6e3)}`);
  plog(() => {
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const summary = messages.map((m, i) => {
      const msg = m;
      const contentType = msg.content === null ? "null" : Array.isArray(msg.content) ? "array" : typeof msg.content;
      let partShapes = "";
      if (Array.isArray(msg.content)) {
        partShapes = " parts=[" + msg.content.map((p8) => {
          const part = p8;
          const keys = Object.keys(part).join(",");
          const textLen = typeof part.text === "string" ? part.text.length : void 0;
          return `{type=${part.type} keys=${keys}${textLen !== void 0 ? ` textLen=${textLen}` : ""}}`;
        }).join(",") + "]";
      }
      return `#${i} role=${msg.role} hasContent=${"content" in msg} contentType=${contentType} toolCalls=${Array.isArray(msg.tool_calls) ? msg.tool_calls.length : 0}${partShapes}`;
    });
    return `openai-chat-completions message shapes: [${summary.join(" | ")}]`;
  });
  const model = lookupModel(res, options.catalog, body.model);
  if (!model) return;
  if (supportsDirectOpenAIChatCompletions(model)) {
    if (model.completionsUrl && !/^https?:\/\//i.test(model.completionsUrl)) {
      sendJson(res, 400, { error: { message: `Invalid provider completionsUrl: must be http:// or https://` } });
      return;
    }
    const completionsUrl = model.completionsUrl ? model.completionsUrl : `${backendFor(options, model).baseUrl}/v1/chat/completions`;
    const apiKey2 = model.apiKey ?? options.apiKey;
    const forwardBody = { ...body, model: upstreamModelId(model) };
    const upstreamHeaders = openCodeGoHeaders(
      model.providerId ?? model.sourceBackend,
      model.completionsUrl ?? model.apiBaseUrl,
      extractConversationId(req.headers, body),
      model.headers
    ) ?? model.headers;
    plog(() => `openai-direct-passthrough \u2192 ${completionsUrl} model=${forwardBody.model} stream=${Boolean(body.stream)}`);
    await relayAnthropicMessages(
      res,
      completionsUrl,
      forwardBody,
      apiKey2,
      Boolean(body.stream),
      void 0,
      void 0,
      (message) => plog(message),
      void 0,
      upstreamHeaders
    );
    return;
  }
  const npm = model.npm || (model.modelFormat === "anthropic" ? "@ai-sdk/anthropic" : void 0);
  if (!npm) {
    sendJson(res, 400, { error: { message: `No SDK provider for model: ${model.id}` } });
    return;
  }
  const apiKey = model.apiKey ?? options.apiKey;
  const baseURL = model.modelFormat === "anthropic" ? model.baseUrl : model.apiBaseUrl;
  const languageModel = await getOrInitLanguageModel(
    modelCache,
    model,
    npm,
    baseURL,
    apiKey,
    options.vertex,
    providerRefreshToken(model.providerId, model.authType)
  );
  const requestHeaders = openCodeGoHeaders(
    model.providerId ?? model.sourceBackend,
    baseURL,
    extractConversationId(req.headers, body),
    model.headers
  );
  const params = translateOpenAiRequest(body, requestHeaders);
  const clientWantsStream = Boolean(body.stream);
  const responseModelId = getResponseModelId(body.model, model, options);
  plog(() => `sdk-openai npm=${npm} upstream=${upstreamModelId(model)} responseModel=${responseModelId} stream=${clientWantsStream}`);
  try {
    if (clientWantsStream) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive"
      });
      await streamOpenAiResponse(languageModel, params, responseModelId, (chunk) => res.write(chunk), plog);
      res.end();
    } else {
      const response = await generateOpenAiResponse(languageModel, params, responseModelId);
      sendJson(res, 200, response);
    }
  } catch (err) {
    const message = formatUpstreamError(err);
    plog(`sdk error npm=${model.npm} upstream=${upstreamModelId(model)}: ${message}`);
    if (!res.headersSent) {
      const status = upstreamHttpStatus(err, message);
      sendJson(res, status === 500 ? 502 : status, { error: { message } });
    } else res.end();
  }
}
function lookupModel(res, catalog, modelId) {
  if (typeof modelId !== "string") {
    sendJson(res, 400, { error: { message: "Request body must include a model string" } });
    return null;
  }
  const model = catalog.get(modelId);
  if (!model) {
    sendJson(res, 400, { error: { message: `Unknown model: ${modelId}` } });
    return null;
  }
  return model;
}
function backendFor(options, model) {
  if (model.sourceBackend === "vertex") {
    throw new Error(`Vertex models route through the SDK adapter, not cloud backends: ${model.id}`);
  }
  if (model.sourceBackend === "zen") return options.backends.zen;
  if (model.sourceBackend === "go") return options.backends.go;
  throw new Error(`Provider ${model.sourceBackend} is not a cloud backend \u2014 model must set baseUrl/completionsUrl`);
}
async function getOrInitLanguageModel(modelCache, model, npm, baseURL, apiKey, vertex, refreshToken) {
  const cacheKey = [
    model.providerId ?? model.sourceBackend,
    model.id,
    upstreamModelId(model),
    npm,
    baseURL ?? ""
  ].join("");
  let languageModel = modelCache.get(cacheKey);
  if (!languageModel) {
    languageModel = await createLanguageModel({
      npm,
      modelId: upstreamModelId(model),
      apiKey,
      baseURL,
      providerId: model.providerId ?? model.sourceBackend,
      authType: model.authType,
      oauthAccountId: model.oauthAccountId,
      vertex,
      headers: model.headers,
      refreshToken,
      onTokenRefreshed: (refreshed) => {
        model.apiKey = refreshed;
      },
      useResponsesLite: model.useResponsesLite,
      preferWebSockets: model.preferWebSockets
    });
    modelCache.set(cacheKey, languageModel);
  }
  return languageModel;
}
function getResponseModelId(bodyModel, model, options) {
  return options.gateway?.maskGatewayIds ? gatewayDisplayName(model, options.gateway) : typeof bodyModel === "string" ? bodyModel : model.id;
}
async function readJson(req) {
  try {
    const raw = await readBody(req);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return null;
  }
}
function toRequest(req) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, sanitizeIncomingHeaderValue(item));
    } else if (value !== void 0) {
      headers.set(name, sanitizeIncomingHeaderValue(value));
    }
  }
  return new Request("http://localhost/", { headers });
}
function sanitizeIncomingHeaderValue(value) {
  return value.replace(/\r?\n/g, " ").trim();
}

// src/server/catalog-filter.ts
function filterServerModelsByProviders(models, providerIds) {
  if (!providerIds || providerIds.length === 0) return models;
  const allowed = new Set(providerIds);
  return models.filter((model) => model.providerId && allowed.has(model.providerId));
}
function filterServerModelsByFavorites(models, favorites) {
  if (favorites.length === 0) return [];
  const allowed = new Set(favorites.map((fav) => `${fav.providerId}:${fav.modelId}`));
  return models.filter((model) => model.providerId && allowed.has(`${model.providerId}:${model.id}`));
}
function filterServerModelsByFreeStatus(models) {
  return models.filter((model) => model.isFree || isFreeStatus(model.freeStatus));
}
function summarizeServerProviders(models) {
  const counts = /* @__PURE__ */ new Map();
  for (const model of models) {
    const key = model.providerLabel ?? model.providerId ?? "unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, count]) => `${name} (${count})`).join(", ");
}

// src/server/provider-select.ts
import pc3 from "picocolors";
import * as p3 from "@clack/prompts";
function isSelected(list, id) {
  return list.includes(id);
}
function resolveInitialServerProviders(initial, available) {
  if (!initial?.length) return [];
  return initial.filter((id) => available.some((provider) => provider.id === id));
}
async function selectServerProviders(available, initial) {
  if (available.length === 0) {
    p3.log.warn("No providers available to expose.");
    return null;
  }
  let selected = resolveInitialServerProviders(initial, available);
  const lookup = new Map(available.map((provider) => [provider.id, provider]));
  while (true) {
    const options = [];
    for (let i = 0; i < selected.length; i++) {
      const id = selected[i];
      const provider = lookup.get(id);
      const label = provider ? `\u2605 ${provider.name}` : pc3.dim(`\u2605 ${id} \u2014 provider gone`);
      const hint = provider ? `${provider.modelCount} model${provider.modelCount !== 1 ? "s" : ""}` : "select to remove";
      options.push({ value: `prov-${i}`, label, hint: "select to remove" });
    }
    const unselected = available.filter((provider) => !isSelected(selected, provider.id));
    options.push({
      value: "__add__",
      label: unselected.length === 0 ? pc3.dim("+ Add a provider \u2192 (all providers selected)") : "+ Add a provider \u2192",
      hint: unselected.length === 0 ? "" : `${unselected.length} more available`
    });
    options.push({ value: "__all__", label: "Expose all providers", hint: `${available.length} total` });
    if (selected.length > 0) {
      options.push({ value: "__clear__", label: "Clear all", hint: "start over" });
    }
    options.push({ value: "__done__", label: "Done", hint: "" });
    const header = selected.length === 0 ? `Exposed providers (0/${available.length}) \u2014 add providers to expose` : `Exposed providers (${selected.length}/${available.length}) \u2014 select to stop exposing`;
    const choice = await p3.select({
      message: header,
      options,
      initialValue: "__done__"
    });
    if (p3.isCancel(choice) || choice === "__done__") {
      if (selected.length === 0) {
        p3.log.warn("Select at least one provider to expose.");
        continue;
      }
      break;
    }
    if (choice === "__all__") {
      selected = available.map((provider) => provider.id);
      p3.log.success(`Exposing all ${available.length} providers.`);
      continue;
    }
    if (choice === "__clear__") {
      selected = [];
      p3.log.success("Cleared provider list \u2014 add the ones you want to expose.");
      continue;
    }
    if (choice === "__add__") {
      if (unselected.length === 0) continue;
      const picked = await p3.select({
        message: "Which provider?",
        options: unselected.map((provider) => ({
          value: provider.id,
          label: provider.name,
          hint: `${provider.modelCount} model${provider.modelCount !== 1 ? "s" : ""}`
        }))
      });
      if (p3.isCancel(picked)) continue;
      selected = [...selected, picked];
      continue;
    }
    if (choice.startsWith("prov-")) {
      const idx = parseInt(choice.slice(5), 10);
      const id = selected[idx];
      if (!id) continue;
      const provider = lookup.get(id);
      selected = selected.filter((_, i) => i !== idx);
      p3.log.success(`Removed ${provider?.name ?? id}.`);
    }
  }
  return selected;
}

// src/server/vertex-config.ts
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join as join2 } from "path";
var DEFAULT_VERTEX_MODELS = [
  { id: "claude-sonnet-4-6", display_name: "Claude Sonnet 4.6" },
  { id: "claude-opus-4-6", display_name: "Claude Opus 4.6" },
  { id: "claude-haiku-4-5", display_name: "Claude Haiku 4.5" }
];
var VERTEX_MODEL_SHORT_ALIASES = {
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5",
  opus: "claude-opus-4-6"
};
var VERTEX_ONE_M_MODEL_IDS = /* @__PURE__ */ new Set([
  "claude-sonnet-4-6",
  "claude-opus-4-6"
]);
function resolveVertexProject(env = process.env) {
  const project = env["ANTHROPIC_VERTEX_PROJECT_ID"] ?? env["GOOGLE_CLOUD_PROJECT"] ?? env["GOOGLE_VERTEX_PROJECT"];
  return project?.trim() || void 0;
}
function resolveVertexLocation(env = process.env) {
  const location = env["GOOGLE_CLOUD_LOCATION"] ?? env["CLOUD_ML_REGION"] ?? env["GOOGLE_VERTEX_LOCATION"] ?? "global";
  return location.trim() || "global";
}
function defaultAdcCredentialsPath(home = homedir()) {
  return join2(home, ".config", "gcloud", "application_default_credentials.json");
}
function hasApplicationDefaultCredentials(home = homedir(), adcPath = defaultAdcCredentialsPath(home), env = process.env) {
  const explicitPath = env["GOOGLE_APPLICATION_CREDENTIALS"]?.trim();
  if (explicitPath && existsSync(explicitPath)) return true;
  return existsSync(adcPath);
}
function loadVertexModelEntries(env = process.env) {
  const configPath = getVertexModelsPath(env);
  if (!existsSync(configPath)) return DEFAULT_VERTEX_MODELS;
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_VERTEX_MODELS;
    const models = parsed.filter(
      (entry) => !!entry && typeof entry === "object" && typeof entry.id === "string" && entry.id.length > 0 && typeof entry.display_name === "string" && entry.display_name.length > 0
    ).map((entry) => ({
      id: entry.id,
      display_name: entry.display_name,
      ...typeof entry.upstream_id === "string" && entry.upstream_id.length > 0 ? { upstream_id: entry.upstream_id } : {}
    }));
    return models.length > 0 ? models : DEFAULT_VERTEX_MODELS;
  } catch {
    return DEFAULT_VERTEX_MODELS;
  }
}
function buildVertexRuntimeConfig(env = process.env) {
  const project = resolveVertexProject(env);
  if (!project) return null;
  return {
    project,
    location: resolveVertexLocation(env),
    models: loadVertexModelEntries(env)
  };
}
function vertexModelsToServerModels(config) {
  return config.models.map((model) => {
    const caps = getReasoningCapabilities(VERTEX_ANTHROPIC_NPM, model.upstream_id ?? model.id);
    return {
      id: model.id,
      name: model.display_name,
      isFree: false,
      brand: "Anthropic",
      sourceBackend: "vertex",
      modelFormat: "openai",
      upstreamModelId: model.upstream_id ?? model.id,
      npm: VERTEX_ANTHROPIC_NPM,
      providerLabel: "Vertex AI",
      providerId: "vertex",
      contextWindow: resolveContextWindow(model.id),
      ...caps.defaultLevel ? { defaultEffort: caps.defaultLevel } : {}
    };
  });
}
function vertexClientModelLookupCandidates(modelId) {
  const candidates = [modelId];
  const without1m = modelId.replace(/\[1m\]$/i, "");
  if (without1m !== modelId) candidates.push(without1m);
  const withoutDate = without1m.replace(/-(\d{8})$/, "");
  if (withoutDate !== without1m) candidates.push(withoutDate);
  if (withoutDate !== without1m) {
    const datedWith1m = `${withoutDate}[1m]`;
    if (!candidates.includes(datedWith1m)) candidates.push(datedWith1m);
  }
  return [...new Set(candidates)];
}
function registerVertexCatalogAlias(byId, alias, model) {
  if (!byId.has(alias)) byId.set(alias, model);
}
function createVertexModelCatalog(models) {
  const catalog = createGatewayModelCatalog(models);
  const byId = /* @__PURE__ */ new Map();
  for (const model of models) {
    byId.set(model.id, model);
    for (const [alias, targetId] of Object.entries(VERTEX_MODEL_SHORT_ALIASES)) {
      if (model.id === targetId) {
        registerVertexCatalogAlias(byId, alias, model);
        if (VERTEX_ONE_M_MODEL_IDS.has(targetId)) {
          registerVertexCatalogAlias(byId, `${alias}[1m]`, model);
        }
      }
    }
    if (VERTEX_ONE_M_MODEL_IDS.has(model.id)) {
      registerVertexCatalogAlias(byId, `${model.id}[1m]`, model);
    }
  }
  return {
    get: (id) => {
      const requested1m = /\[1m\]$/i.test(id);
      for (const candidate of vertexClientModelLookupCandidates(id)) {
        const match = byId.get(candidate) ?? catalog.get(candidate);
        if (match) {
          if (requested1m && !VERTEX_ONE_M_MODEL_IDS.has(match.id)) return void 0;
          return match;
        }
      }
      return void 0;
    },
    list: () => catalog.list()
  };
}

// src/server/index.ts
function cappedWidth(values, label, cap) {
  return Math.max(label.length, ...values.map((value) => Math.min(value.length, cap)));
}
function formatModelCatalogLines(models, gateway) {
  if (models.length === 0) return [];
  const groups = /* @__PURE__ */ new Map();
  for (const model of models) {
    const label = gatewayProviderLabel(model);
    let list = groups.get(label);
    if (!list) {
      list = [];
      groups.set(label, list);
    }
    list.push(model);
  }
  const collisions = openAiIdCollisions(models);
  const lines = ["Model catalog:", ""];
  const sortedGroups = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [label, groupModels] of sortedGroups) {
    const rows = buildDedupedModelRows(groupModels, gateway, collisions);
    const hiddenDuplicates = groupModels.length - rows.length;
    const duplicateNote = hiddenDuplicates > 0 ? `, ${hiddenDuplicates} duplicate${hiddenDuplicates !== 1 ? "s" : ""} hidden` : "";
    const nameWidth = cappedWidth(rows.map((row) => row.name), "Model", 28);
    const anthropicWidth = cappedWidth(rows.map((row) => row.anthropicId), "Anthropic ID", 46);
    const indexWidth = Math.max(String(rows.length).length, 1);
    lines.push(`  ${label} (${rows.length}${duplicateNote})`);
    lines.push(`  ${"#".padStart(indexWidth)}  ${"Model".padEnd(nameWidth)}  ${"Anthropic ID".padEnd(anthropicWidth)}  OpenAI ID`);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      lines.push(`  ${String(i + 1).padStart(indexWidth)}  ${row.name.padEnd(nameWidth)}  ${row.anthropicId.padEnd(anthropicWidth)}  ${row.openaiId}`);
    }
    lines.push("");
  }
  return lines;
}
function printModelCatalog(models, gateway) {
  if (models.length === 0) return;
  for (const line of formatModelCatalogLines(models, gateway)) {
    if (line === "Model catalog:") {
      console.log(pc4.bold(line));
    } else if (/^  [^#\d\s].+\(\d+/.test(line)) {
      console.log(pc4.bold(line));
    } else if (/^  \s*#\s+Model\s+Anthropic ID\s+OpenAI ID/.test(line)) {
      console.log(pc4.dim(line));
    } else {
      console.log(line);
    }
  }
}
function providerOptionsFromCatalog(catalog) {
  const options = [];
  for (const provider of providersForTarget(catalog, "server")) {
    options.push({
      id: provider.id,
      name: provider.name,
      modelCount: provider.models.length
    });
  }
  return options.sort((a, b) => a.name.localeCompare(b.name, void 0, { sensitivity: "base", numeric: true }));
}
async function loadServerModels() {
  const catalog = await fetchProviderCatalog({ agent: "server" });
  const models = [];
  const serverProviders = providersForTarget(catalog, "server");
  if (serverProviders.length > 0) {
    models.push(...localProvidersToServerModels(serverProviders));
  }
  return models.map(enrichServerModelReasoning);
}
function enrichServerModelReasoning(model) {
  if (!model.npm || model.modelFormat !== "openai") return model;
  const caps = getReasoningCapabilities(model.npm, upstreamModelId(model), {
    providerId: model.providerId,
    apiBaseUrl: model.apiBaseUrl,
    supportedParameters: model.supportedParameters,
    reasoning: model.reasoning,
    interleavedReasoningField: model.interleavedReasoningField,
    reasoningEffortLevels: model.reasoningEffortLevels,
    reasoningEffortConflict: model.reasoningEffortConflict
  });
  if (!caps.defaultLevel) return model;
  return { ...model, defaultEffort: caps.defaultLevel };
}
function waitForShutdownSignal() {
  return new Promise((resolve) => {
    const cleanup = () => {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
    };
    const onSigint = () => {
      cleanup();
      resolve("SIGINT");
    };
    const onSigterm = () => {
      cleanup();
      resolve("SIGTERM");
    };
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);
  });
}
async function resolveServerShutdownDecision(signal, promptClose = () => p4.confirm({
  message: "Relay AI server is still running. Close it?",
  initialValue: true
})) {
  if (signal !== "SIGINT") return "close";
  const shouldClose = await promptClose();
  if (p4.isCancel(shouldClose)) return "close";
  return shouldClose ? "close" : "keep";
}
async function waitForShutdown() {
  while (true) {
    const signal = await waitForShutdownSignal();
    const decision = await resolveServerShutdownDecision(signal);
    if (decision === "close") return;
  }
}
async function getServerPasswordForMode(mode) {
  if (mode === "local") return { password: null, wasSaved: false };
  const savedPassword = await getSavedServerPassword();
  let serverPassword = null;
  let wasSaved = false;
  if (savedPassword) {
    const savedChoice = await askUseSavedServerPassword();
    if (!savedChoice) return void 0;
    if (savedChoice === "use-saved") {
      serverPassword = savedPassword;
      wasSaved = true;
    } else {
      serverPassword = await askServerPassword();
    }
  } else {
    serverPassword = await askServerPassword();
  }
  if (!serverPassword) return void 0;
  if (serverPassword !== savedPassword) {
    const savePassword = await askSaveServerPassword();
    if (savePassword === null) return void 0;
    if (savePassword) {
      await setSavedServerPassword(serverPassword);
      wasSaved = true;
    }
  }
  return { password: serverPassword, wasSaved };
}
async function getServerPasswordForQuickMode(mode, passwordOverride) {
  if (mode === "local") return { password: null, wasSaved: false };
  const trimmedOverride = passwordOverride?.trim();
  if (trimmedOverride) return { password: trimmedOverride, wasSaved: false };
  const fromEnv = getEnvServerPassword();
  if (fromEnv) return { password: fromEnv, wasSaved: false };
  const savedPassword = await getSavedServerPassword();
  if (savedPassword) return { password: savedPassword, wasSaved: true };
  p4.log.error("Network server quick-start needs a password via `--password`, `RELAY_AI_SERVER_PASSWORD`, or a saved server password.");
  p4.log.info("Run `relay-ai server` and choose Configure & start to save one, or pass a one-run password / env var.");
  return void 0;
}
function savedServerRunConfig() {
  return {
    exposedProviders: getServerExposedProviders(),
    maskGatewayIds: getServerMaskGatewayIds(),
    favoritesOnly: getServerFavoritesOnly(),
    freeModelsOnly: getServerFreeModelsOnly(),
    listenMode: getServerListenMode()
  };
}
function hasServerRunOverrides(options) {
  return options.listenMode !== void 0 || options.providersMode !== void 0 || options.freeOnly !== void 0 || options.maskGatewayIds !== void 0 || options.password !== void 0;
}
function applyServerRunOverrides(config, options) {
  const next = { ...config };
  if (options.listenMode) next.listenMode = options.listenMode;
  if (options.freeOnly !== void 0) next.freeModelsOnly = options.freeOnly;
  if (options.maskGatewayIds !== void 0) next.maskGatewayIds = options.maskGatewayIds;
  if (options.providersMode === "all") {
    next.favoritesOnly = false;
    next.exposedProviders = null;
  } else if (options.providersMode === "favorites") {
    next.favoritesOnly = true;
    next.exposedProviders = null;
  } else if (options.providersMode === "specific") {
    next.favoritesOnly = false;
    next.exposedProviders = options.providerIds ?? [];
  }
  return next;
}
function shouldUseQuickServerMode(options) {
  return Boolean(options.quick || hasServerRunOverrides(options) || !process.stdin.isTTY);
}
async function configureExposedProviders() {
  p4.log.info("Add providers to expose. Listed providers are removed when selected \u2014 like favorites.");
  const spinner3 = p4.spinner();
  spinner3.start("Loading providers...");
  const catalog = await fetchProviderCatalog({ agent: "server" });
  spinner3.stop("");
  const available = providerOptionsFromCatalog(catalog);
  const picked = await selectServerProviders(available, getServerExposedProviders() ?? void 0);
  if (!picked) return void 0;
  setServerExposedProviders(picked);
  p4.log.success(`Saved ${picked.length} provider${picked.length !== 1 ? "s" : ""} for future server runs.`);
  return picked;
}
async function runServerWizard() {
  relayIntro("Server");
  const startMode = await askServerStartMode();
  if (!startMode) return void 0;
  if (startMode === "quick") {
    return { runConfig: savedServerRunConfig(), promptForPassword: false };
  }
  const favoritesOnly = await askFavoritesOnly(getServerFavoritesOnly());
  if (favoritesOnly === null) return void 0;
  setServerFavoritesOnly(favoritesOnly);
  if (favoritesOnly) {
    p4.log.info("Manage favorites with `relay-ai models`.");
  }
  const freeModelsOnly = await askFreeModelsOnly(getServerFreeModelsOnly());
  if (freeModelsOnly === null) return void 0;
  setServerFreeModelsOnly(freeModelsOnly);
  let exposedProviders = null;
  if (!favoritesOnly) {
    exposedProviders = await configureExposedProviders();
    if (exposedProviders === void 0) return void 0;
  }
  const maskGatewayIds = await askMaskGatewayIds(getServerMaskGatewayIds());
  if (maskGatewayIds === null) return void 0;
  setServerMaskGatewayIds(maskGatewayIds);
  const listenMode = await askListenMode();
  if (!listenMode) return void 0;
  setServerListenMode(listenMode);
  return {
    runConfig: { exposedProviders, maskGatewayIds, favoritesOnly, freeModelsOnly, listenMode },
    promptForPassword: true
  };
}
async function runVertexServerCommand(options = {}) {
  relayIntro("Vertex Gateway");
  const vertexConfig = buildVertexRuntimeConfig();
  if (!vertexConfig) {
    p4.log.error("Set ANTHROPIC_VERTEX_PROJECT_ID or GOOGLE_CLOUD_PROJECT to your GCP project.");
    return 1;
  }
  if (!hasApplicationDefaultCredentials()) {
    p4.log.error("Google Application Default Credentials not found.");
    p4.log.info("Run: gcloud auth application-default login");
    return 1;
  }
  const mode = await askListenMode();
  if (!mode) return 0;
  const pwResult = await getServerPasswordForMode(mode);
  if (pwResult === void 0) return 0;
  const { password: serverPassword, wasSaved: passwordWasSaved } = pwResult;
  const host = mode === "network" ? "0.0.0.0" : "127.0.0.1";
  const models = vertexModelsToServerModels(vertexConfig);
  const debugLogPath = options.trace ? getServerDebugLogPath() : void 0;
  if (debugLogPath) p4.log.info(`Debug log: ${debugLogPath}`);
  const server = await startServer({
    host,
    port: 17645,
    apiKey: "vertex-local",
    serverPassword,
    catalog: createVertexModelCatalog(models),
    backends: BACKENDS,
    vertex: {
      project: vertexConfig.project,
      location: vertexConfig.location
    },
    debugLogPath
  });
  console.log("");
  console.log(pc4.bold(pc4.green("Vertex gateway running")));
  console.log(`  Anthropic:  http://127.0.0.1:${server.port}/anthropic`);
  console.log(`  Models:     ${models.map((model) => model.id).join(", ")}`);
  if (mode === "network") {
    const publicPort = resolveAdvertiseGatewayPort(server.port);
    for (const { name, address } of resolveAdvertiseAddresses()) {
      console.log(`  Network (${name}):  http://${address}:${publicPort}/anthropic`);
    }
    if (passwordWasSaved) {
      console.log("  API key:    saved, rotate with `relay-ai server` \u2192 Configure & start");
    } else {
      console.log(`  API key:    ${serverPassword}`);
    }
  } else {
    console.log("  API key:    any non-empty value");
  }
  console.log(pc4.dim("  Auth:       gcloud Application Default Credentials"));
  console.log("");
  printModelCatalog(models);
  console.log(pc4.dim("Press Ctrl+C to stop."));
  await waitForShutdown();
  await server.close();
  if (debugLogPath) printTraceLog(debugLogPath);
  return 0;
}
async function resolveServerUpstreamApiKey() {
  let apiKey = sanitizeCredential(resolveApiKey());
  if (apiKey) return apiKey;
  apiKey = sanitizeCredential(await readFromCredentialStore((reason) => {
    p4.log.warn(`Credential store unavailable \u2014 ${reason}`);
  }));
  if (apiKey) {
    const isMac = process.platform === "darwin";
    const isWindows = process.platform === "win32";
    const storeName = isMac ? "macOS Keychain" : isWindows ? "Windows Credential Manager" : "Secret Service";
    p4.log.success(`Found key in ${storeName}`);
    return apiKey;
  }
  const catalog = await fetchProviderCatalog({ agent: "server" });
  if (catalog.some((provider) => provider.apiKey.trim() || provider.models.length > 0)) {
    return "registry-local";
  }
  return null;
}
async function runServerCommand(options = {}) {
  if (options.vertex) {
    return runVertexServerCommand(options);
  }
  await ensureOpencodeCloudProviders();
  const apiKey = await resolveServerUpstreamApiKey();
  if (!apiKey) {
    p4.log.error("No providers configured. Run `relay-ai providers add` or import, or set OPENCODE_API_KEY for Zen/Go.");
    return 1;
  }
  const quickMode = shouldUseQuickServerMode(options);
  const resolved = quickMode ? {
    runConfig: applyServerRunOverrides(savedServerRunConfig(), options),
    promptForPassword: false
  } : await runServerWizard();
  if (!resolved) return 0;
  const { runConfig, promptForPassword } = resolved;
  const pwResult = promptForPassword ? await getServerPasswordForMode(runConfig.listenMode) : await getServerPasswordForQuickMode(runConfig.listenMode, options.password);
  if (pwResult === void 0) return promptForPassword ? 0 : 1;
  const { password: serverPassword, wasSaved: passwordWasSaved } = pwResult;
  const mode = runConfig.listenMode;
  const host = mode === "network" ? "0.0.0.0" : "127.0.0.1";
  const spinner3 = p4.spinner();
  spinner3.start("Fetching available models...");
  let models;
  try {
    models = await loadServerModels();
    if (runConfig.exposedProviders) {
      models = filterServerModelsByProviders(models, runConfig.exposedProviders);
    }
    if (runConfig.favoritesOnly) {
      const favorites = loadPreferences().favoriteModels ?? [];
      if (favorites.length === 0) {
        spinner3.stop(pc4.red("No favorite models configured"));
        p4.log.error("Run `relay-ai models` to add favorites, or turn off favorites-only in the server wizard.");
        return 1;
      }
      models = filterServerModelsByFavorites(models, favorites).slice(0, MAX_MODEL_CATALOG);
      if (models.length === 0) {
        spinner3.stop(pc4.red("No favorite models matched the current provider filter"));
        p4.log.error("Adjust favorites with `relay-ai models` or change exposed providers in the server wizard.");
        return 1;
      }
    }
    if (runConfig.freeModelsOnly) {
      models = filterServerModelsByFreeStatus(models);
      if (models.length === 0) {
        spinner3.stop(pc4.red("No free models matched the current server filters"));
        p4.log.error("Turn off free-models-only mode or add a provider with free models.");
        return 1;
      }
    }
    if (runConfig.favoritesOnly) {
      p4.log.info(
        `Favorites-only mode active \u2014 GET /anthropic/v1/models returns ${models.length} favorites.`
      );
      p4.log.info("Desktop/Cowork picker will only show these. Edit with `relay-ai models`.");
    }
    if (models.length === 0) {
      spinner3.stop(pc4.red("No models to expose"));
      p4.log.error("Add providers with `relay-ai providers add` or configure exposed providers in the server wizard.");
      return 1;
    }
    const localCount = models.filter((m) => m.apiKey !== void 0).length;
    const summary = summarizeServerProviders(models);
    const filterNote = runConfig.exposedProviders ? ` \u2014 ${runConfig.exposedProviders.length} provider${runConfig.exposedProviders.length !== 1 ? "s" : ""}` : "";
    const favoritesNote = runConfig.favoritesOnly ? " \u2014 favorites only" : "";
    const freeNote = runConfig.freeModelsOnly ? " \u2014 free models only" : "";
    const maskNote = runConfig.maskGatewayIds ? " \u2014 discovery ids masked" : "";
    spinner3.stop(`Loaded ${models.length} models (${localCount} from registry providers)${filterNote}${favoritesNote}${freeNote}${maskNote}`);
    if (summary) p4.log.info(summary);
  } catch (err) {
    spinner3.stop(pc4.red("Failed to load models"));
    console.error(pc4.red(String(err instanceof Error ? err.message : err)));
    return 1;
  }
  const gateway = runConfig.maskGatewayIds ? { maskGatewayIds: true } : void 0;
  const debugLogPath = options.trace ? getServerDebugLogPath() : void 0;
  if (debugLogPath) p4.log.info(`Debug log: ${debugLogPath}`);
  const server = await startServer({
    host,
    port: 17645,
    apiKey,
    serverPassword,
    catalog: createGatewayModelCatalog(models, gateway),
    backends: BACKENDS,
    gateway,
    debugLogPath
  });
  console.log("");
  console.log(pc4.bold(pc4.green("Relay AI server running")));
  const publicPort = resolveAdvertiseGatewayPort(server.port);
  console.log(`  Anthropic:  http://127.0.0.1:${publicPort}/anthropic`);
  console.log(`  OpenAI:     http://127.0.0.1:${publicPort}/openai/v1`);
  if (mode === "network") {
    for (const { name, address } of resolveAdvertiseAddresses()) {
      console.log(`  Network (${name}):`);
      console.log(`    Anthropic:  http://${address}:${publicPort}/anthropic`);
      console.log(`    OpenAI:     http://${address}:${publicPort}/openai/v1`);
    }
    if (passwordWasSaved) {
      console.log("  API key:    saved, rotate with `relay-ai server` \u2192 Configure & start");
    } else {
      console.log(`  API key:    ${serverPassword}`);
    }
  } else {
    console.log("  API key:    any non-empty value");
  }
  if (runConfig.exposedProviders) {
    console.log(pc4.dim(`  Providers:  ${runConfig.exposedProviders.join(", ")}`));
  }
  if (runConfig.favoritesOnly) {
    console.log(pc4.dim("  Catalog:    favorite models only"));
  }
  if (runConfig.freeModelsOnly) {
    console.log(pc4.dim("  Pricing:    free/free-access models only"));
  }
  if (runConfig.maskGatewayIds) {
    console.log(pc4.dim("  Discovery:  gateway ids masked for Claude Desktop / Cowork"));
  }
  console.log("");
  printModelCatalog(models, gateway);
  console.log(pc4.dim("Press Ctrl+C to stop."));
  await waitForShutdown();
  await server.close();
  if (debugLogPath) printTraceLog(debugLogPath);
  return 0;
}

// src/update-check.ts
import {
  chmodSync,
  mkdirSync,
  readFileSync as readFileSync2,
  renameSync,
  unlinkSync,
  writeFileSync as writeFileSync2
} from "fs";
import { join as join3 } from "path";
var UPDATE_CHECK_TTL_MS = 24 * 60 * 60 * 1e3;
var UPDATE_CHECK_TIMEOUT_MS = 2e3;
var UPDATE_COMMAND = "npm install -g @jacobbd/relay-ai@latest";
var REGISTRY_URL = "https://registry.npmjs.org/@jacobbd%2Frelay-ai/latest";
var SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
function parseVersion(version) {
  const match = SEMVER_PATTERN.exec(version);
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4]?.split(".") ?? []
  };
}
function comparePrerelease(current, latest) {
  if (current.length === 0 || latest.length === 0) {
    if (current.length === latest.length) return 0;
    return current.length === 0 ? -1 : 1;
  }
  const length = Math.max(current.length, latest.length);
  for (let i = 0; i < length; i++) {
    const currentPart = current[i];
    const latestPart = latest[i];
    if (currentPart === void 0) return 1;
    if (latestPart === void 0) return -1;
    if (currentPart === latestPart) continue;
    const currentNumber = /^\d+$/.test(currentPart) ? Number(currentPart) : null;
    const latestNumber = /^\d+$/.test(latestPart) ? Number(latestPart) : null;
    if (currentNumber !== null && latestNumber !== null) return latestNumber > currentNumber ? 1 : -1;
    if (currentNumber !== null) return 1;
    if (latestNumber !== null) return -1;
    return latestPart > currentPart ? 1 : -1;
  }
  return 0;
}
function isNewerVersion(currentVersion, latestVersion) {
  const current = parseVersion(currentVersion);
  const latest = parseVersion(latestVersion);
  if (!current || !latest) return false;
  for (let i = 0; i < current.core.length; i++) {
    if (current.core[i] === latest.core[i]) continue;
    return latest.core[i] > current.core[i];
  }
  return comparePrerelease(current.prerelease, latest.prerelease) > 0;
}
function cachePath() {
  return join3(getAppHome(), "update-check.json");
}
function readFreshCache(now) {
  try {
    const parsed = JSON.parse(readFileSync2(cachePath(), "utf8"));
    if (typeof parsed.latestVersion !== "string" || !parseVersion(parsed.latestVersion)) return null;
    if (typeof parsed.checkedAt !== "number" || !Number.isFinite(parsed.checkedAt)) return null;
    const age = now - parsed.checkedAt;
    if (age < 0 || age >= UPDATE_CHECK_TTL_MS) return null;
    return { latestVersion: parsed.latestVersion, checkedAt: parsed.checkedAt };
  } catch {
    return null;
  }
}
function writeCache(cache) {
  const directory = getAppHome();
  const path = cachePath();
  const temporaryPath = `${path}.${process.pid}.tmp`;
  try {
    mkdirSync(directory, { recursive: true, mode: 448 });
    writeFileSync2(temporaryPath, `${JSON.stringify(cache)}
`, { mode: 384 });
    renameSync(temporaryPath, path);
    try {
      chmodSync(path, 384);
    } catch {
    }
  } catch {
    try {
      unlinkSync(temporaryPath);
    } catch {
    }
  }
}
function statusFor(latestVersion) {
  return {
    currentVersion: VERSION,
    latestVersion,
    updateAvailable: latestVersion !== null && isNewerVersion(VERSION, latestVersion)
  };
}
async function checkForUpdates(options = {}) {
  const now = options.now ?? Date.now();
  const cached = readFreshCache(now);
  if (cached) return statusFor(cached.latestVersion);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? UPDATE_CHECK_TIMEOUT_MS);
  try {
    const response = await (options.fetchImpl ?? fetch)(REGISTRY_URL, {
      headers: { Accept: "application/json", "User-Agent": `relay-ai/${VERSION}` },
      signal: controller.signal
    });
    if (!response.ok) return statusFor(null);
    const body = await response.json();
    if (typeof body.version !== "string" || !parseVersion(body.version)) return statusFor(null);
    writeCache({ latestVersion: body.version, checkedAt: now });
    return statusFor(body.version);
  } catch {
    return statusFor(null);
  } finally {
    clearTimeout(timer);
  }
}
function formatUpdateNotification(currentVersion, latestVersion) {
  return `\u{1F514} Update available: ${currentVersion} \u2192 ${latestVersion}. Run ${UPDATE_COMMAND} to update.`;
}

// src/favorites.ts
function normalizeFavoriteModels(value, limit) {
  if (!Array.isArray(value) || limit <= 0) return [];
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item;
    const providerId = typeof record.providerId === "string" ? record.providerId.trim() : "";
    const modelId = typeof record.modelId === "string" ? record.modelId.trim() : "";
    if (!providerId || !modelId) continue;
    const key = `${providerId}\0${modelId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ providerId, modelId });
    if (out.length >= limit) break;
  }
  return out;
}
function isFavorite(list, fav) {
  return list.some((f) => f.providerId === fav.providerId && f.modelId === fav.modelId);
}
function addFavorite(list, fav, max = MAX_MODEL_CATALOG) {
  if (isFavorite(list, fav)) return { ok: false, reason: "duplicate" };
  if (list.length >= max) return { ok: false, reason: "cap" };
  return { ok: true, list: [...list, fav] };
}
function removeFavorite(list, fav) {
  return list.filter((f) => !(f.providerId === fav.providerId && f.modelId === fav.modelId));
}

// src/favorite-provider-display.ts
var OAUTH_FAVORITE_NAMES = {
  "claude-code": "Claude Code OAuth (Anthropic subscription)",
  antigravity: "Cloud Code Assist OAuth (Google)",
  "openai-oauth": "OpenAI OAuth (ChatGPT)",
  "xai-oauth": "xAI OAuth (SuperGrok)"
};
function favoriteProviderDisplayName(provider) {
  const explicit = OAUTH_FAVORITE_NAMES[provider.id];
  if (explicit) return explicit;
  if (provider.authType === "oauth" && !/\boauth\b/i.test(provider.name)) {
    return `${provider.name} OAuth`;
  }
  return provider.name;
}

// src/http-proxy/routes.ts
var HTTP_PROXY_MODEL_PREFIX = "relay:";
function httpProxyModelId(providerId, modelId) {
  return `${HTTP_PROXY_MODEL_PREFIX}${providerId}:${modelId}`;
}
function supportsClaudeTransparentMode(model) {
  if (model.modelFormat === "anthropic") return Boolean(model.baseUrl);
  return model.modelFormat === "openai" && isSdkMigratedNpm(model.npm);
}
function buildHttpProxyRoutes(providers, favorites, selected, max = MAX_MODEL_CATALOG) {
  const routes = [];
  const unavailable = [];
  const unsupported = [];
  const seen = /* @__PURE__ */ new Set();
  const requested = selected ? [selected, ...favorites] : favorites;
  for (const item of requested) {
    const requestKey = `${item.providerId}\0${item.modelId}`;
    if (seen.has(requestKey)) continue;
    seen.add(requestKey);
    if (routes.length >= max) break;
    const provider = providers.find((candidate) => candidate.id === item.providerId);
    const model = provider?.models.find((candidate) => candidate.id === item.modelId);
    if (!provider || !model) {
      unavailable.push(item);
      continue;
    }
    if (!supportsClaudeTransparentMode(model)) {
      unsupported.push(item);
      continue;
    }
    const route = localModelToRoute(provider, model);
    if (!route || !route.apiKey.trim()) {
      unavailable.push(item);
      continue;
    }
    const gatewayAliasId2 = claudeCodeClientModelId(
      aliasModelId(model.id, provider.id),
      model.contextWindow
    );
    routes.push({
      ...route,
      aliasId: claudeCodeClientModelId(
        httpProxyModelId(provider.id, model.id),
        model.contextWindow
      ),
      gatewayAliasId: gatewayAliasId2,
      displayName: `${model.name || model.id} (${provider.name})`
    });
  }
  return { routes, unavailable, unsupported };
}

// src/binary-lookup.ts
import { execFileSync } from "child_process";
import { existsSync as existsSync2 } from "fs";
function findBinaryOnPath(name, fallbackPaths, options = {}) {
  const isWindows = options.isWindows ?? process.platform === "win32";
  const exists = options.exists ?? existsSync2;
  const runWhich = options.runWhich ?? ((binary, win) => execFileSync(win ? "where.exe" : "which", [binary], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"]
  }));
  try {
    const lines = runWhich(name, isWindows).trim().split("\n").map((line) => line.trim()).filter(Boolean);
    const path = (isWindows ? lines.find((line) => line.toLowerCase().endsWith(".cmd")) : null) ?? lines[0];
    if (path && (!options.verifyWhichResult || exists(path))) return path;
  } catch {
  }
  for (const path of fallbackPaths) {
    if (exists(path)) return path;
  }
  return null;
}

// src/registry/add-template.ts
async function probeTemplatePackage(template) {
  if (!template.supported) return template.unsupportedReason ?? "Provider is not supported yet.";
  if (!template.npm) return "Template is missing an SDK package.";
  if (!isSdkMigratedNpm(template.npm) && template.npm !== "@ai-sdk/anthropic") {
    return `SDK package ${template.npm} is not available in relay-ai.`;
  }
  try {
    await import(template.npm);
    return null;
  } catch {
    return `Could not load ${template.npm}. Run npm install in your relay-ai checkout.`;
  }
}
function filterAnonymousFreeModels(models, template) {
  if (!template.anonymousFreeModels) return models;
  return models.filter((model) => isFreeStatus(classifyFreeStatus({
    model,
    providerId: template.id,
    templateId: template.id
  })));
}
async function addProviderFromTemplate(template, apiKey, opts) {
  const trimmedKey = apiKey.trim();
  if (!trimmedKey && !template.apiKeyOptional) {
    return { added: false, error: "API key cannot be empty." };
  }
  if (template.modelSource === "zen-go-api") {
    return addOpencodeCloudFromApiKey(trimmedKey);
  }
  const packageError = await probeTemplatePackage(template);
  if (packageError) {
    return { added: false, error: packageError };
  }
  const registry = loadRegistry();
  const existing = registry.providers.find((p8) => p8.id === template.id);
  if (existing && !opts?.replaceExisting) {
    return {
      added: false,
      error: `${template.name} is already configured.`,
      hint: `Remove it first with: relay-ai providers remove ${template.id}`
    };
  }
  let fetched;
  if (template.modelSource === "cline-recommended") {
    try {
      await validateClinePassApiKey(trimmedKey);
      fetched = {
        models: await fetchClinePassModels({ credential: trimmedKey, authType: "api" }),
        baseUrl: template.defaultBaseUrl ?? ""
      };
    } catch (err) {
      return {
        added: false,
        error: err instanceof Error ? err.message : String(err),
        hint: template.signupUrl ? `Verify your key at ${template.signupUrl}` : void 0
      };
    }
  } else if (template.modelSource === "commandcode") {
    try {
      const baseUrl = (opts?.baseUrl?.trim() || template.defaultBaseUrl || COMMANDCODE_BASE_URL).replace(/\/$/, "");
      fetched = { models: await fetchCommandCodeModels(baseUrl, trimmedKey), baseUrl };
    } catch (err) {
      return {
        added: false,
        error: err instanceof Error ? err.message : String(err),
        hint: template.signupUrl ? `Verify your key at ${template.signupUrl}` : void 0
      };
    }
  } else {
    fetched = await fetchTemplateModels(template, trimmedKey, opts?.baseUrl);
  }
  if (fetched.error || fetched.models.length === 0) {
    return {
      added: false,
      error: fetched.error ?? "No models returned.",
      hint: fetched.hint
    };
  }
  const usableModels = !trimmedKey && template.anonymousFreeModels ? filterAnonymousFreeModels(fetched.models, template) : fetched.models;
  if (usableModels.length === 0) {
    return {
      added: false,
      error: "No free models were returned for anonymous access.",
      hint: template.signupUrl ? `Add a ${template.name} API key from ${template.signupUrl} to use paid models.` : void 0
    };
  }
  const authRef = `keyring:provider:${template.id}`;
  const saved = trimmedKey ? await saveProviderCredential(authRef, trimmedKey) : true;
  if (!saved) {
    return {
      added: false,
      error: "Could not save API key to credential store.",
      hint: "Grant Keychain access, or ensure RELAY_AI_HOME is writable (file fallback)."
    };
  }
  const now = localIsoTimestamp();
  const pricingCache = loadPricingCache();
  const pricedModels = enrichModelsForProviderPricing(
    usableModels.map((m) => ({ ...m, apiUrl: fetched.baseUrl })),
    buildPricingIndex(pricingCache),
    template.id,
    template.id
  );
  const entry = {
    id: template.id,
    templateId: template.id,
    name: template.name,
    enabled: true,
    authRef,
    authType: template.authType,
    api: {
      npm: template.npm,
      url: fetched.baseUrl,
      ...template.headers ? { headers: template.headers } : {}
    },
    addedAt: existing?.addedAt ?? now,
    refreshedAt: now,
    modelsCache: {
      fetchedAt: now,
      models: pricedModels
    }
  };
  if (existing) {
    entry.manualModels = existing.manualModels;
    const idx = registry.providers.findIndex((p8) => p8.id === template.id);
    registry.providers[idx] = entry;
  } else {
    registry.providers.push(entry);
  }
  saveRegistry(registry);
  if (existing?.authRef && existing.authRef !== authRef) {
    await deleteProviderCredential(existing.authRef);
  }
  enrichPricingAsync();
  return { added: true, provider: entry, modelCount: pricedModels.length };
}

// src/registry/provider-auth.ts
import pc5 from "picocolors";
import * as p5 from "@clack/prompts";
import open from "open";
init_provider_templates();
var OPENAI_DISPLAY = "OpenAI ChatGPT Plus/Pro";
var PROVIDER_DISPLAY = {
  xai: "xAI Grok (SuperGrok)",
  "xai-oauth": "xAI Grok (SuperGrok)",
  openai: OPENAI_DISPLAY,
  "openai-oauth": OPENAI_DISPLAY,
  "github-copilot": "GitHub Copilot",
  "claude-code": "Claude Code (Anthropic subscription)",
  antigravity: "Cloud Code Assist OAuth (Google)",
  "cline-pass": "ClinePass"
};
function openBrowser(url) {
  open(url).catch(() => {
  });
}
async function runNativeDeviceCode(providerId) {
  const label = PROVIDER_DISPLAY[providerId];
  printOAuthStepsPanel(`${label} \u2014 Sign in`, label);
  const spinner3 = p5.spinner();
  spinner3.start("Waiting for authorization...");
  try {
    if (providerId === "xai" || providerId === "xai-oauth") {
      const tokens2 = await runXaiDeviceCodeFlow(({ url, userCode }) => {
        spinner3.stop("");
        p5.log.info(`Visit: ${pc5.cyan(url)}`);
        p5.log.info(`Enter code: ${pc5.bold(userCode)}`);
        openBrowser(url);
        spinner3.start("Waiting for authorization...");
      });
      spinner3.stop(pc5.green("Signed in to xAI"));
      return tokensToStoredCredential(tokens2);
    }
    if (providerId === "github-copilot") {
      const tokens2 = await runGithubDeviceCodeFlow(({ url, userCode }) => {
        spinner3.stop("");
        p5.log.info(`Visit: ${pc5.cyan(url)}`);
        p5.log.info(`Enter code: ${pc5.bold(userCode)}`);
        openBrowser(url);
        spinner3.start("Waiting for authorization...");
      });
      spinner3.stop(pc5.green("Signed in to GitHub Copilot"));
      return tokensToStoredCredential(tokens2);
    }
    if (providerId === "cline-pass") {
      const result = await runClinePassDeviceCodeFlow(({ url, userCode }) => {
        spinner3.stop("");
        p5.log.info(`Visit: ${pc5.cyan(url)}`);
        p5.log.info(`Enter code: ${pc5.bold(userCode)}`);
        openBrowser(url);
        spinner3.start("Waiting for authorization...");
      });
      spinner3.stop(pc5.green("Signed in to ClinePass"));
      return tokensToStoredCredential(result.tokens, void 0, result.accountId, result.providerData);
    }
    const { tokens, accountId } = await runOpenAiDeviceCodeFlow(({ url, userCode }) => {
      spinner3.stop("");
      p5.log.info(`Visit: ${pc5.cyan(url)}`);
      p5.log.info(`Enter code: ${pc5.bold(userCode)}`);
      openBrowser(url);
      spinner3.start("Waiting for authorization...");
    });
    spinner3.stop(pc5.green("Signed in to OpenAI ChatGPT"));
    return tokensToStoredCredential(tokens, void 0, accountId);
  } catch (err) {
    spinner3.stop("");
    throw err;
  }
}
async function runNativeBrowserOAuth(providerId) {
  if (providerId !== "claude-code" && providerId !== "antigravity") {
    throw new Error(`Browser OAuth for "${providerId}" is not yet implemented.`);
  }
  const confirmed = await confirmSubscriptionOAuthRisk(providerId);
  if (!confirmed) throw new Error("Cancelled");
  if (providerId === "claude-code") {
    const spinner4 = p5.spinner();
    spinner4.start("Opening browser for Anthropic sign-in\u2026");
    try {
      const { tokens, bootstrap } = await runClaudeCodeOAuthFlow((url) => {
        spinner4.stop("");
        p5.log.info(`Opening: ${pc5.cyan(url)}`);
      }, async () => {
        const code = await p5.text({
          message: "Paste the authorization code or callback URL from Anthropic",
          placeholder: "code from browser",
          validate: (value) => value.trim() ? void 0 : "Authorization code is required"
        });
        if (p5.isCancel(code)) throw new Error("Cancelled");
        spinner4.start("Exchanging authorization code\u2026");
        return code;
      });
      spinner4.stop(pc5.green("Signed in to Claude Code"));
      const providerData = { cliUserID: generateCliUserID() };
      if (bootstrap.accountId) providerData.accountUUID = bootstrap.accountId;
      if (bootstrap.organizationId) providerData.organizationUUID = bootstrap.organizationId;
      if (bootstrap.organizationName) providerData.organizationName = bootstrap.organizationName;
      if (bootstrap.plan) providerData.plan = bootstrap.plan;
      return tokensToStoredCredential(tokens, void 0, bootstrap.accountId, providerData);
    } catch (err) {
      spinner4.stop("");
      throw err;
    }
  }
  const spinner3 = p5.spinner();
  spinner3.start("Opening browser for Google sign-in\u2026");
  try {
    const { tokens, userInfo, projectId, tierId } = await runAntigravityOAuthFlow((url) => {
      spinner3.stop("");
      p5.log.info(`Opening: ${pc5.cyan(url)}`);
      spinner3.start("Waiting for authorization\u2026");
    });
    spinner3.stop(pc5.green("Signed in to Cloud Code Assist"));
    const providerData = {};
    if (projectId) providerData.projectId = projectId;
    if (tierId) providerData.tier = tierId;
    return tokensToStoredCredential(tokens, void 0, userInfo.email, providerData);
  } catch (err) {
    spinner3.stop("");
    throw err;
  }
}
async function saveNativeOAuthCredential(providerId, tokens, accountId, providerData) {
  const cred = tokensToStoredCredential(tokens, void 0, accountId, providerData);
  const registryId = toOAuthRegistryId(providerId);
  let diagMsg = "";
  const saved = await saveProviderCredential(
    oauthAuthRef(registryId),
    oauthCredentialToKeychainJson(cred),
    (msg) => {
      diagMsg = msg;
    }
  );
  if (!saved) throw new Error(`Could not save OAuth tokens to credential store${diagMsg ? ` \u2014 ${diagMsg}` : " \u2014 grant Keychain access or check RELAY_AI_HOME is writable"}`);
  await upsertOAuthProvider(providerId, cred);
}
function oauthDisplayName(registryId, fallbackName) {
  if (registryId === "openai-oauth") return "OpenAI (ChatGPT)";
  if (registryId === "xai-oauth") return "xAI (SuperGrok)";
  return fallbackName;
}
async function upsertOAuthProvider(providerId, cred) {
  const registryId = toOAuthRegistryId(providerId);
  const templateId = providerId.replace(/-oauth$/, "") || providerId;
  const registry = loadRegistry();
  const authRef = oauthAuthRef(registryId);
  const template = getTemplateById(templateId) ?? getTemplateById(registryId);
  let entry = registry.providers.find((pr) => pr.id === registryId);
  const previousAuthRef = entry?.authRef;
  if (!entry) {
    if (!template) {
      throw new Error(`Provider "${providerId}" is not in your registry and has no template`);
    }
    const displayName = oauthDisplayName(registryId, template.name);
    entry = {
      id: registryId,
      templateId: template.id,
      name: displayName,
      enabled: true,
      authRef,
      authType: "oauth",
      api: {
        npm: template.npm,
        url: template.defaultBaseUrl ?? "",
        ...template.headers ? { headers: template.headers } : {}
      },
      addedAt: localIsoTimestamp()
    };
  } else {
    entry = { ...entry, authType: "oauth", authRef, templateId: entry.templateId ?? templateId };
  }
  const idx = registry.providers.findIndex((pr) => pr.id === registryId);
  if (idx >= 0) registry.providers[idx] = entry;
  else registry.providers.push(entry);
  saveRegistry(registry);
  if (previousAuthRef && previousAuthRef !== authRef) {
    await deleteProviderCredential(previousAuthRef);
  }
  return entry;
}
async function authenticateProvider(providerId, options = {}) {
  const registryId = toOAuthRegistryId(providerId);
  if (!supportsNativeOAuth(providerId)) {
    throw new Error(
      `OAuth for "${providerId}" is not built into relay-ai. Add an API-key provider with relay-ai providers add, or run relay-ai providers import if you already configured it in the OpenCode CLI.`
    );
  }
  if (options.method === "broker") {
    throw new Error(
      "OpenCode auth broker is no longer used for providers. Use the built-in OAuth flow, or relay-ai providers import for OpenCode CLI configs."
    );
  }
  const cred = isBrowserRedirectOAuth(providerId) ? await runNativeBrowserOAuth(providerId) : await runNativeDeviceCode(providerId);
  let nativeDiagMsg = "";
  const saved = await saveProviderCredential(
    oauthAuthRef(registryId),
    oauthCredentialToKeychainJson(cred),
    (msg) => {
      nativeDiagMsg = msg;
    }
  );
  if (!saved) {
    p5.log.warn(`Could not save OAuth tokens \u2014 ${nativeDiagMsg || "session may not persist."}`);
  }
  const registryProvider = await upsertOAuthProvider(providerId, cred);
  const refreshSpinner = p5.spinner();
  refreshSpinner.start("Refreshing model list...");
  try {
    await refreshProviderModels(registryId, cred.access);
    refreshSpinner.stop("Models refreshed");
  } catch {
    refreshSpinner.stop("Could not refresh models \u2014 run relay-ai providers refresh-models later");
  }
  return { providerId: registryId, credential: cred, registryProvider };
}
function providerAuthHelpText() {
  return `${pc5.bold("relay-ai providers auth")} \u2014 sign in with OAuth

${pc5.bold("Usage:")}
  relay-ai providers auth <id>
  relay-ai providers auth xai-oauth
  relay-ai providers auth openai-oauth
  relay-ai providers auth github-copilot
  relay-ai providers auth cline-pass
  relay-ai providers auth antigravity

${pc5.bold("Device code (works on SSH/VPS):")}
  xai-oauth        SuperGrok / X Premium (device code at x.ai/device)
  openai-oauth     ChatGPT Plus/Pro (device code at auth.openai.com/codex/device)
  github-copilot   GitHub Copilot Free or paid (device code at github.com/login/device)
  cline-pass       ClinePass account (device code at app.cline.bot)

${pc5.bold("Browser sign-in:")}
  antigravity      Google Cloud Code Assist OAuth (opens Google sign-in)

${pc5.dim("OpenCode CLI configs: use")} relay-ai providers import${pc5.dim(" (optional one-time migration).")}`;
}

// src/codex/app-launch.ts
import { execFileSync as execFileSync3, execSync, spawn } from "child_process";
import { copyFileSync, existsSync as existsSync3, mkdirSync as mkdirSync2, readdirSync as readdirSync2, realpathSync, statSync } from "fs";
import { homedir as homedir2 } from "os";
import { dirname, join as join4, win32 as winPath } from "path";
import * as p6 from "@clack/prompts";

// src/linux-display.ts
import { execFileSync as execFileSync2 } from "child_process";
import { readdirSync } from "fs";
function displayHasWindow(display, windowId) {
  try {
    const output = execFileSync2("xprop", ["-display", display, "-id", windowId, "WM_CLASS"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    return /WM_CLASS(?:\(STRING\))?\s*=\s*"/.test(output);
  } catch {
    return false;
  }
}
function availableDisplays() {
  try {
    return readdirSync("/tmp/.X11-unix").filter((name) => /^X\d+$/.test(name)).map((name) => `:${name.slice(1)}`);
  } catch {
    return [];
  }
}
function resolveLinuxDisplay(env = process.env, probe = displayHasWindow, displays = availableDisplays()) {
  const configured = env.DISPLAY;
  const windowId = env.WINDOWID;
  if (!windowId) return configured;
  if (configured && probe(configured, windowId)) return configured;
  for (const display of displays) {
    if (display !== configured && probe(display, windowId)) return display;
  }
  return configured;
}
function linuxLaunchEnv(env = process.env) {
  const display = resolveLinuxDisplay(env);
  return display ? { ...env, DISPLAY: display } : { ...env };
}

// src/codex/app-launch.ts
var CODEX_BUNDLE_ID = "com.openai.codex";
var DARWIN_APP_NAMES = ["ChatGPT", "Codex"];
var WIN_APP_NAMES = ["ChatGPT", "Codex"];
function codexAppSupported(platform = process.platform) {
  if (platform !== "darwin" && platform !== "win32" && platform !== "linux") {
    throw new Error("Codex App launch is supported on macOS, Windows, and Linux.");
  }
}
function run(cmd, encoding = "utf8") {
  return execSync(cmd, { encoding, stdio: ["pipe", "pipe", "pipe"] }).trim();
}
function runPowerShell(script) {
  return run(`powershell.exe -NoProfile -Command ${JSON.stringify(script)}`);
}
function darwinAppCandidates() {
  return DARWIN_APP_NAMES.flatMap((name) => [
    `/Applications/${name}.app`,
    join4(homedir2(), "Applications", `${name}.app`)
  ]);
}
function linuxCodexAppCandidates(home = homedir2()) {
  return [
    "/usr/bin/chatgpt",
    "/usr/lib/chatgpt/ChatGPT",
    "/opt/chatgpt/ChatGPT",
    "/usr/local/lib/chatgpt/ChatGPT",
    join4(home, ".local", "bin", "chatgpt"),
    join4(home, ".local", "share", "chatgpt", "ChatGPT")
  ];
}
function linuxEmbeddedCodexCandidates(appPath) {
  const resolvedPath = (() => {
    try {
      return realpathSync(appPath);
    } catch {
      return appPath;
    }
  })();
  return [.../* @__PURE__ */ new Set([
    join4(dirname(resolvedPath), "resources", "codex"),
    join4(dirname(appPath), "resources", "codex")
  ])];
}
function winLocalAppData() {
  return process.env.LOCALAPPDATA ?? join4(homedir2(), "AppData", "Local");
}
function windowsEmbeddedCodexCandidates(appPath, packageInstallLocations) {
  const candidates = [];
  if (appPath && !appPath.startsWith("shell:AppsFolder\\")) {
    const appDir = winPath.dirname(appPath);
    candidates.push(
      winPath.join(appDir, "resources", "codex.exe"),
      winPath.join(appDir, "app", "resources", "codex.exe")
    );
  }
  for (const installLocation of packageInstallLocations) {
    if (!installLocation.trim()) continue;
    candidates.push(
      winPath.join(installLocation, "app", "resources", "codex.exe"),
      winPath.join(installLocation, "resources", "codex.exe")
    );
  }
  return [...new Set(candidates)];
}
function windowsEmbeddedCodexCachePath(sourcePath, home = homedir2()) {
  const normalized = sourcePath.replaceAll("/", "\\");
  const match = normalized.match(/\\WindowsApps\\([^\\]+)\\/i);
  if (!match) return null;
  const packageDirectory = match[1].replace(/[^a-zA-Z0-9._-]/g, "_");
  return winPath.join(home, ".relay-ai", "codex", "embedded-runtime", packageDirectory, "codex.exe");
}
function executableWindowsEmbeddedCodexPath(sourcePath) {
  const cachePath2 = windowsEmbeddedCodexCachePath(sourcePath);
  if (!cachePath2) return sourcePath;
  try {
    const sourceSize = statSync(sourcePath).size;
    if (existsSync3(cachePath2) && statSync(cachePath2).size === sourceSize) return cachePath2;
    mkdirSync2(winPath.dirname(cachePath2), { recursive: true });
    copyFileSync(sourcePath, cachePath2);
    return statSync(cachePath2).size === sourceSize ? cachePath2 : null;
  } catch {
    return null;
  }
}
function winCodexPackageInstallLocations() {
  try {
    const out = runPowerShell(
      "Get-AppxPackage -Name 'OpenAI.Codex' | Sort-Object Version -Descending | Select-Object -ExpandProperty InstallLocation"
    );
    return out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}
function winCodexExeCandidates() {
  const local = winLocalAppData();
  const bases = WIN_APP_NAMES.flatMap((name) => [
    join4(local, "Programs", name),
    join4(local, "Programs", `OpenAI ${name}`),
    join4(local, name),
    join4(local, `OpenAI ${name}`),
    join4(local, "OpenAI", name)
  ]);
  bases.push(join4(local, "openai-codex-electron"), join4(local, "openai-chatgpt-electron"));
  const out = [];
  for (const base of bases) {
    for (const name of WIN_APP_NAMES) {
      out.push(join4(base, `${name}.exe`));
    }
    try {
      if (existsSync3(base)) {
        for (const dir of readdirSync2(base)) {
          if (dir.startsWith("app-")) {
            for (const name of WIN_APP_NAMES) {
              out.push(join4(base, dir, `${name}.exe`));
            }
          }
        }
      }
    } catch {
    }
  }
  return out;
}
function mdfindCodexApp() {
  try {
    const out = run(`mdfind "kMDItemCFBundleIdentifier == '${CODEX_BUNDLE_ID}'"`);
    const first = out.split("\n").map((l) => l.trim()).find(Boolean);
    return first && existsSync3(first) ? first : null;
  } catch {
    return null;
  }
}
function findCodexApp(platform = process.platform) {
  if (platform === "darwin") {
    for (const path of darwinAppCandidates()) {
      if (existsSync3(path)) return path;
    }
    return mdfindCodexApp();
  }
  if (platform === "win32") {
    for (const path of winCodexExeCandidates()) {
      try {
        if (existsSync3(path) && statSync(path).isFile()) return path;
      } catch {
      }
    }
    try {
      const nameFilter = WIN_APP_NAMES.map((name) => `$_.Name -eq '${name}' -or $_.Name -like '${name}*'`).join(" -or ");
      const appId = runPowerShell(
        `(Get-StartApps | Where-Object { ${nameFilter} } | Select-Object -First 1 -ExpandProperty AppID)`
      );
      if (appId) return `shell:AppsFolder\\${appId}`;
    } catch {
    }
  }
  if (platform === "linux") {
    return linuxCodexAppCandidates().find((path) => existsSync3(path)) ?? null;
  }
  return null;
}
function findEmbeddedCodexBinary(platform = process.platform, appPath = findCodexApp(platform)) {
  if (platform === "darwin") {
    if (!appPath) return null;
    return [
      join4(appPath, "Contents", "Resources", "codex-cli", "bin", "codex"),
      join4(appPath, "Contents", "Resources", "codex")
    ].find((binary) => existsSync3(binary)) ?? null;
  }
  if (platform === "linux") {
    if (!appPath) return null;
    return linuxEmbeddedCodexCandidates(appPath).find((path) => existsSync3(path)) ?? null;
  }
  if (platform === "win32") {
    const sourcePath = windowsEmbeddedCodexCandidates(appPath, winCodexPackageInstallLocations()).find((path) => {
      try {
        return existsSync3(path) && statSync(path).isFile();
      } catch {
        return false;
      }
    });
    return sourcePath ? executableWindowsEmbeddedCodexPath(sourcePath) : null;
  }
  return null;
}
function darwinIsRunning() {
  return DARWIN_APP_NAMES.some((name) => {
    try {
      const out = run(`osascript -e 'tell application "System Events" to exists process "${name}"'`);
      return out.toLowerCase() === "true";
    } catch {
      return false;
    }
  });
}
function pgrepExact(names) {
  const pids = /* @__PURE__ */ new Set();
  for (const name of names) {
    try {
      for (const raw of run(`pgrep -x ${JSON.stringify(name)}`).split(/\s+/)) {
        const pid = Number.parseInt(raw, 10);
        if (Number.isFinite(pid) && pid > 0 && pid !== process.pid) pids.add(pid);
      }
    } catch {
    }
  }
  return [...pids];
}
function darwinMainExecutableCandidates(appPath) {
  return DARWIN_APP_NAMES.map((name) => join4(appPath, "Contents", "MacOS", name));
}
function darwinMainPidsFromProcessList(processList, commands, currentPid = process.pid) {
  const pids = /* @__PURE__ */ new Set();
  for (const line of processList.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(.+?)\s*$/);
    if (!match) continue;
    const pid = Number.parseInt(match[1], 10);
    const command = match[2];
    if (Number.isFinite(pid) && pid > 0 && pid !== currentPid && commands.some((candidate) => command === candidate || command.startsWith(`${candidate} `))) {
      pids.add(pid);
    }
  }
  return [...pids];
}
function darwinMatchingPids() {
  const appPath = findCodexApp("darwin");
  if (!appPath) return [];
  try {
    const processList = execFileSync3("ps", ["-axo", "pid=,command="], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"]
    });
    return darwinMainPidsFromProcessList(
      processList,
      darwinMainExecutableCandidates(appPath)
    );
  } catch {
    return [];
  }
}
function linuxIsRunning() {
  for (const name of ["ChatGPT", "chatgpt"]) {
    try {
      if (run(`pgrep -x ${name}`)) return true;
    } catch {
    }
  }
  return false;
}
function linuxMatchingPids() {
  return pgrepExact(["ChatGPT", "chatgpt"]);
}
function winMatchingPids() {
  try {
    const nameFilter = WIN_APP_NAMES.map((name) => `Name = '${name}.exe'`).join(" OR ");
    const mainProcessFilter = WIN_APP_NAMES.map((name) => `(($_.Name -ieq '${name}.exe') -and (($null -eq $_.CommandLine) -or ($_.CommandLine -notlike '* --type=*')))`).join(" -or ");
    const script = `$current = ${process.pid}; Get-CimInstance Win32_Process -Filter "${nameFilter} OR Name = 'codex.exe'" | Where-Object { $_.ProcessId -ne $current -and (${mainProcessFilter} -or (($_.Name -ieq 'codex.exe') -and ($_.CommandLine -like '*app-server*'))) } | Select-Object -ExpandProperty ProcessId`;
    const out = runPowerShell(script);
    return out.split(/\s+/).map((s) => Number.parseInt(s, 10)).filter((n) => Number.isFinite(n) && n > 0);
  } catch {
    return [];
  }
}
function winHasWindow() {
  try {
    const nameFilter = WIN_APP_NAMES.map((name) => `'${name}'`).join(",");
    const out = runPowerShell(
      `(Get-Process ${nameFilter} -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1).Id`
    );
    return out.length > 0 && Number.isFinite(Number.parseInt(out, 10));
  } catch {
    return false;
  }
}
function isCodexAppRunning() {
  if (process.platform === "darwin") return darwinIsRunning();
  if (process.platform === "win32") return winMatchingPids().length > 0 || winHasWindow();
  if (process.platform === "linux") return linuxIsRunning();
  return false;
}
function codexAppMainPids(platform = process.platform) {
  if (platform === "darwin") return darwinMatchingPids();
  if (platform === "win32") return winMatchingPids();
  if (platform === "linux") return linuxMatchingPids();
  return [];
}
function pidIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}
function sleep2(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function waitForOriginalCodexPids(originalPids, timeoutMs, alive = pidIsAlive) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (originalPids.every((pid) => !alive(pid))) return true;
    await sleep2(200);
  }
  return originalPids.every((pid) => !alive(pid));
}
async function waitForCodexAppQuit(timeoutMs = 5e3) {
  const originalPids = codexAppMainPids();
  if (originalPids.length > 0) {
    const exited = await waitForOriginalCodexPids(originalPids, timeoutMs);
    return exited && !isCodexAppRunning();
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isCodexAppRunning()) return true;
    await sleep2(200);
  }
  return !isCodexAppRunning();
}
function openCodexAppAt(path) {
  if (process.platform === "darwin") {
    if (path.endsWith(".app")) {
      execSync(`open ${JSON.stringify(path)}`, { stdio: "inherit" });
    } else {
      execSync(`open -b ${CODEX_BUNDLE_ID}`, { stdio: "inherit" });
    }
    return;
  }
  if (process.platform === "win32") {
    if (path.startsWith("shell:AppsFolder\\")) {
      spawn("cmd.exe", ["/c", "start", "", path], { stdio: "ignore", detached: true }).unref();
    } else {
      runPowerShell(`Start-Process -FilePath '${path.replace(/'/g, "''")}'`);
    }
    return;
  }
  if (process.platform === "linux") {
    spawn(path, [], { stdio: "ignore", detached: true, env: linuxLaunchEnv() }).unref();
  }
}
function openCodexApp() {
  const path = findCodexApp();
  if (!path) {
    throw new Error(
      "ChatGPT Desktop app not found. Install from https://developers.openai.com/codex/app then run relay-ai codex-app again."
    );
  }
  openCodexAppAt(path);
}
function darwinQuitAppleScript() {
  return `tell application id "${CODEX_BUNDLE_ID}" to quit`;
}
function darwinQuit() {
  execFileSync3("osascript", ["-e", darwinQuitAppleScript()], { stdio: "pipe" });
}
function winQuitGraceful() {
  const nameFilter = WIN_APP_NAMES.map((name) => `'${name}'`).join(",");
  runPowerShell(
    `Get-Process ${nameFilter} -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object { [void]$_.CloseMainWindow() }`
  );
}
function linuxQuitGraceful() {
  for (const name of ["ChatGPT", "chatgpt"]) {
    try {
      execSync(`pkill -TERM -x ${name}`, { stdio: "ignore" });
      return;
    } catch {
    }
  }
}
function quitCodexAppGracefully() {
  if (process.platform === "darwin") darwinQuit();
  else if (process.platform === "win32") winQuitGraceful();
  else if (process.platform === "linux") linuxQuitGraceful();
}
function winForceQuit(pids = winMatchingPids()) {
  if (pids.length === 0) return;
  runPowerShell(`Stop-Process -Id ${pids.join(",")} -Force -ErrorAction SilentlyContinue`);
}
function forceQuitCodexApp() {
  if (process.platform === "win32") winForceQuit();
}
function restartTimeoutAction(platform) {
  return platform === "win32" ? "force-quit" : "fail-closed";
}
function gracefulQuitTimeoutMs(platform) {
  return platform === "darwin" ? 3e4 : 5e3;
}
async function launchOrRestartCodexApp(prompt = "Restart ChatGPT Desktop to apply relay-ai settings?", assumeYes = false) {
  const appPath = findCodexApp();
  const originalPids = codexAppMainPids();
  if (!isCodexAppRunning()) {
    if (!appPath) {
      throw new Error(
        "ChatGPT Desktop app not found. Install from https://developers.openai.com/codex/app then run relay-ai codex-app again."
      );
    }
    openCodexAppAt(appPath);
    return;
  }
  if (originalPids.length === 0) {
    throw new Error("ChatGPT Desktop is running but Relay could not identify its main process; refusing an unsafe restart.");
  }
  if (process.platform === "linux") {
    p6.log.info("Restarting ChatGPT Desktop to apply relay-ai settings...");
    linuxQuitGraceful();
  } else if (assumeYes) {
    if (process.platform === "darwin") darwinQuit();
    else if (process.platform === "win32") winQuitGraceful();
  } else {
    const restart = await p6.confirm({ message: prompt, initialValue: true });
    if (p6.isCancel(restart) || !restart) {
      p6.log.info("Quit and reopen ChatGPT Desktop when you are ready for the new model to take effect.");
      return;
    }
    if (process.platform === "darwin") darwinQuit();
    else if (process.platform === "win32") winQuitGraceful();
  }
  const gracefulTimeout = gracefulQuitTimeoutMs(process.platform);
  if (!await waitForOriginalCodexPids(originalPids, gracefulTimeout)) {
    if (restartTimeoutAction(process.platform) === "force-quit") {
      winForceQuit(originalPids);
      if (!await waitForOriginalCodexPids(originalPids, 5e3)) {
        throw new Error("ChatGPT Desktop did not exit after its force-quit timeout; refusing to launch a duplicate process.");
      }
    } else {
      throw new Error("ChatGPT Desktop did not exit after graceful shutdown; refusing to relaunch or force-quit it.");
    }
  }
  if (isCodexAppRunning()) return;
  if (appPath) openCodexAppAt(appPath);
  else openCodexApp();
}
function codexAppInstallHint() {
  return "Install the ChatGPT desktop app (Codex mode) for macOS, Windows, or Linux: https://developers.openai.com/codex/app";
}

// src/claude-desktop/app-launch.ts
import { execSync as execSync2, spawn as spawn2 } from "child_process";
import { existsSync as existsSync4, readdirSync as readdirSync3, readFileSync as readFileSync3, statSync as statSync2 } from "fs";
import { homedir as homedir3 } from "os";
import { join as join5 } from "path";
import * as p7 from "@clack/prompts";
var CLAUDE_BUNDLE_ID = "com.anthropic.claudefordesktop";
function claudeAppSupported() {
  if (process.platform !== "darwin" && process.platform !== "win32" && process.platform !== "linux") {
    throw new Error("Claude Desktop launch is supported on macOS, Windows, and Linux only.");
  }
}
function run2(cmd, encoding = "utf8") {
  return execSync2(cmd, { encoding, stdio: ["pipe", "pipe", "pipe"] }).trim();
}
function runPowerShell2(script) {
  return run2(`powershell.exe -NoProfile -Command ${JSON.stringify(script)}`);
}
function darwinAppCandidates2() {
  return [
    "/Applications/Claude.app",
    join5(homedir3(), "Applications", "Claude.app")
  ];
}
function winLocalAppData2() {
  return process.env.LOCALAPPDATA ?? join5(homedir3(), "AppData", "Local");
}
function winClaudeExeCandidates() {
  const local = winLocalAppData2();
  const bases = [
    // Squirrel install folder used by the Anthropic Claude desktop installer.
    join5(local, "AnthropicClaude"),
    join5(local, "Programs", "Claude"),
    join5(local, "Claude")
  ];
  const out = [];
  for (const base of bases) {
    out.push(join5(base, "Claude.exe"));
    try {
      if (existsSync4(base)) {
        for (const name of readdirSync3(base)) {
          if (name.startsWith("app-")) {
            out.push(join5(base, name, "Claude.exe"));
          }
        }
      }
    } catch {
    }
  }
  return out;
}
function linuxClaudeCandidates() {
  return [
    // Wrapper launcher installed by the .deb/.rpm — sets up the Electron sandbox.
    "/usr/bin/claude-desktop",
    "/usr/lib/claude-desktop/claude-desktop",
    "/opt/Claude/claude-desktop",
    join5(homedir3(), ".local", "bin", "claude-desktop")
  ];
}
function linuxWhichClaude() {
  try {
    const out = run2("command -v claude-desktop");
    return out && existsSync4(out) ? out : null;
  } catch {
    return null;
  }
}
function linuxMatchingPids2() {
  try {
    const out = run2("pgrep -x claude-desktop");
    return out.split(/\s+/).map((s) => Number.parseInt(s, 10)).filter((n) => Number.isFinite(n) && n > 0);
  } catch {
    return [];
  }
}
function linuxMainPid() {
  const pids = linuxMatchingPids2();
  for (const pid of pids) {
    try {
      const cmdline = readFileSync3(`/proc/${pid}/cmdline`, "utf8");
      if (!cmdline.includes("--type=")) return pid;
    } catch {
    }
  }
  return pids[0] ?? null;
}
function linuxQuit() {
  const pid = linuxMainPid();
  if (pid === null) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
  }
}
function linuxForceQuit() {
  for (const pid of linuxMatchingPids2()) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
    }
  }
}
function mdfindClaudeApp() {
  try {
    const out = run2(`mdfind "kMDItemCFBundleIdentifier == '${CLAUDE_BUNDLE_ID}'"`);
    const first = out.split("\n").map((l) => l.trim()).find(Boolean);
    return first && existsSync4(first) ? first : null;
  } catch {
    return null;
  }
}
function findClaudeApp() {
  if (process.platform === "darwin") {
    for (const path of darwinAppCandidates2()) {
      if (existsSync4(path)) return path;
    }
    return mdfindClaudeApp();
  }
  if (process.platform === "win32") {
    for (const path of winClaudeExeCandidates()) {
      try {
        if (existsSync4(path) && statSync2(path).isFile()) return path;
      } catch {
      }
    }
    try {
      const appId = runPowerShell2(
        "(Get-StartApps Claude | Where-Object { $_.Name -eq 'Claude' -or $_.Name -like 'Claude*' } | Select-Object -First 1 -ExpandProperty AppID)"
      );
      if (appId) return `shell:AppsFolder\\${appId}`;
    } catch {
    }
  }
  if (process.platform === "linux") {
    for (const path of linuxClaudeCandidates()) {
      try {
        if (existsSync4(path)) return path;
      } catch {
      }
    }
    return linuxWhichClaude();
  }
  return null;
}
function darwinIsRunning2() {
  try {
    const out = run2(`osascript -e 'tell application "System Events" to exists process "Claude"'`);
    return out.toLowerCase() === "true";
  } catch {
    return false;
  }
}
function winMatchingPids2() {
  try {
    const script = `$current = ${process.pid}; Get-CimInstance Win32_Process -Filter "Name = 'Claude.exe' OR Name = 'claude.exe'" | Where-Object { $_.ProcessId -ne $current } | Select-Object -ExpandProperty ProcessId`;
    const out = runPowerShell2(script);
    return out.split(/\s+/).map((s) => Number.parseInt(s, 10)).filter((n) => Number.isFinite(n) && n > 0);
  } catch {
    return [];
  }
}
function winHasWindow2() {
  try {
    const out = runPowerShell2(
      "(Get-Process Claude -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1).Id"
    );
    return out.length > 0 && Number.isFinite(Number.parseInt(out, 10));
  } catch {
    return false;
  }
}
function isClaudeAppRunning() {
  if (process.platform === "darwin") return darwinIsRunning2();
  if (process.platform === "win32") return winMatchingPids2().length > 0 || winHasWindow2();
  if (process.platform === "linux") return linuxMatchingPids2().length > 0;
  return false;
}
function sleep3(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function waitForQuit(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (process.platform === "win32") {
      if (winMatchingPids2().length === 0) return true;
    } else if (process.platform === "linux") {
      if (linuxMatchingPids2().length === 0) return true;
    } else if (!darwinIsRunning2()) {
      return true;
    }
    await sleep3(200);
  }
  if (process.platform === "win32") return winMatchingPids2().length === 0;
  if (process.platform === "linux") return linuxMatchingPids2().length === 0;
  return !darwinIsRunning2();
}
function openClaudeAppAt(path) {
  if (process.platform === "darwin") {
    if (path.endsWith(".app")) {
      execSync2(`open ${JSON.stringify(path)}`, { stdio: "inherit" });
    } else {
      execSync2(`open -b ${CLAUDE_BUNDLE_ID}`, { stdio: "inherit" });
    }
    return;
  }
  if (process.platform === "win32") {
    if (path.startsWith("shell:AppsFolder\\")) {
      spawn2("cmd.exe", ["/c", "start", "", path], { stdio: "ignore", detached: true }).unref();
    } else {
      runPowerShell2(`Start-Process -FilePath '${path.replace(/'/g, "''")}'`);
    }
    return;
  }
  if (process.platform === "linux") {
    spawn2(path, [], { stdio: "ignore", detached: true, env: linuxLaunchEnv() }).unref();
  }
}
function openClaudeApp() {
  const path = findClaudeApp();
  if (!path) {
    throw new Error(
      "Claude Desktop App not found. Please install it first."
    );
  }
  openClaudeAppAt(path);
}
function darwinQuit2() {
  try {
    execSync2(`osascript -e 'tell application "Claude" to quit'`, { stdio: "pipe" });
  } catch {
    execSync2(`osascript -e 'tell application id "${CLAUDE_BUNDLE_ID}" to quit'`, { stdio: "pipe" });
  }
}
function winQuitGraceful2() {
  runPowerShell2(
    "Get-Process Claude -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object { [void]$_.CloseMainWindow() }"
  );
}
function quitClaudeAppGracefully() {
  if (process.platform === "darwin") darwinQuit2();
  else if (process.platform === "win32") winQuitGraceful2();
  else if (process.platform === "linux") linuxQuit();
}
function winForceQuit2() {
  const pids = winMatchingPids2();
  if (pids.length === 0) return;
  runPowerShell2(`Stop-Process -Id ${pids.join(",")} -Force -ErrorAction SilentlyContinue`);
}
async function launchOrRestartClaudeApp(prompt = "Restart Claude Desktop to apply relay-ai settings?") {
  const appPath = findClaudeApp();
  if (!isClaudeAppRunning()) {
    if (!appPath) {
      throw new Error("Claude Desktop App not found. Please install it first.");
    }
    openClaudeAppAt(appPath);
    return;
  }
  if (process.platform === "linux") {
    p7.log.info("Restarting Claude Desktop to apply relay-ai settings...");
    linuxQuit();
  } else {
    const restart = await p7.confirm({ message: prompt, initialValue: true });
    if (p7.isCancel(restart) || !restart) {
      p7.log.info("Quit and reopen Claude Desktop when you are ready for the new model to take effect.");
      return;
    }
    if (process.platform === "darwin") darwinQuit2();
    else if (process.platform === "win32") winQuitGraceful2();
  }
  if (!await waitForQuit(5e3)) {
    if (process.platform === "win32") winForceQuit2();
    else if (process.platform === "linux") linuxForceQuit();
    await waitForQuit(5e3);
  }
  if (appPath) openClaudeAppAt(appPath);
  else openClaudeApp();
}

export {
  renderMultiAgentV2Feature,
  supportsMultiAgentV2,
  CODEX_APP_PROVIDER_ID,
  PREVIEW_PROXY_PORT,
  CODEX_APP_AUTO_COMPACT_RATIO,
  codexAppModelSlug,
  parseCodexAppModelSlug,
  buildCodexAppRootConfig,
  formatCodexModelLabel,
  catalogEntryFromModel,
  buildCatalogFile,
  buildAppCatalogFile,
  serializeCatalog,
  printPanel,
  relayIntro,
  relayOutro,
  fmtModel,
  fmtProvider,
  fmtProviderBracket,
  fmtCommand,
  fmtUrl,
  fmtCount,
  fmtEnabledStar,
  providerSelectOption,
  modelSelectOption,
  navOption,
  logActiveModel,
  logProxy,
  logConnected,
  printWelcomePanel,
  printEnvConflictPanel,
  printApiKeyPanel,
  printDryRunPanel,
  printImportConflictPanel,
  printProviderDetailPanel,
  printCloudProviderPanel,
  findBinaryOnPath,
  shouldHideModel,
  zenRegistryStub,
  isLikelyPlaceholderKey,
  resolveRefreshCredential,
  oauthAuthRef,
  buildImportProviderList,
  isOAuthImportProvider,
  listCredentialSkippedProviders,
  endpointModelTimeoutMs,
  fetchAnthropicModels,
  fetchTemplateModels,
  resolveProviderTemplate,
  effectiveProviderBaseUrl,
  syntheticTemplate,
  resolveModelSource,
  readBody,
  extractApiKey,
  sendJson,
  formatAnthropicModelEntry,
  formatAnthropicModelList,
  gatewayProviderLabel,
  openAiIdCollisions,
  createGatewayModelCatalog,
  upstreamModelId,
  buildDedupedModelRows,
  anthropicModelsEndpoint,
  anthropicMessagesEndpoint,
  estimateAnthropicInputTokens,
  OPENCODE_SESSION_HEADER,
  extractConversationId,
  openCodeGoHeaders,
  aliasModelId,
  startProxyCatalog,
  startProxy,
  providerRefreshToken,
  makeRouteResolver,
  buildCatalogRoutes,
  hostFromHeader,
  resolveAdvertiseAddresses,
  resolveAdvertiseGatewayPort,
  formatGatewayUrls,
  cachedModelToLocal,
  copilotPlanTier,
  fetchProviderCatalog,
  providersForPicker,
  resolveLocalProviderApiKey,
  formatRegistryAuthLabel,
  resolveProvidersForDisplay,
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
  customEndpointKind,
  addCustomEndpointProvider,
  updateCustomEndpointProvider,
  refreshProviderModels,
  refreshProviderModelsBatch,
  refreshAllProviderModels,
  removeProviderFromRegistry,
  ensureOpencodeCloudProviders,
  addOpencodeCloudFromApiKey,
  toggleProviderEnabled,
  startServer,
  filterServerModelsByProviders,
  filterServerModelsByFavorites,
  filterServerModelsByFreeStatus,
  summarizeServerProviders,
  hasApplicationDefaultCredentials,
  buildVertexRuntimeConfig,
  providerOptionsFromCatalog,
  loadServerModels,
  resolveServerUpstreamApiKey,
  runServerCommand,
  checkForUpdates,
  formatUpdateNotification,
  normalizeFavoriteModels,
  isFavorite,
  addFavorite,
  removeFavorite,
  favoriteProviderDisplayName,
  addProviderFromTemplate,
  saveNativeOAuthCredential,
  authenticateProvider,
  providerAuthHelpText,
  codexAppSupported,
  findCodexApp,
  findEmbeddedCodexBinary,
  isCodexAppRunning,
  waitForCodexAppQuit,
  quitCodexAppGracefully,
  forceQuitCodexApp,
  launchOrRestartCodexApp,
  codexAppInstallHint,
  claudeAppSupported,
  findClaudeApp,
  isClaudeAppRunning,
  quitClaudeAppGracefully,
  launchOrRestartClaudeApp,
  httpProxyModelId,
  supportsClaudeTransparentMode,
  buildHttpProxyRoutes
};
//# sourceMappingURL=chunk-IGON3W5X.js.map