#!/usr/bin/env node
import {
  SubagentRouteRegistry,
  anthropicEffortFromRequest,
  claudeModelFamily,
  extractClaudeSessionId,
  generateAnthropicResponse,
  streamAnthropicResponse,
  translateRequest,
  writeAnthropicStream
} from "./chunk-E7FSS5M2.js";
import {
  normalizeToolSchemaForNpm
} from "./chunk-UR4QFFSQ.js";
import {
  describePoolFailure,
  extractApiKey,
  fetchProviderCatalog,
  forcedFailures,
  localProvidersToServerModels,
  poolErrorDetail,
  poolRouteMember,
  providersForTarget,
  readBody,
  recordPoolActivity,
  sendJson
} from "./chunk-P4KVRRWU.js";
import {
  COMMANDCODE_BASE_URL,
  addOpencodeCloudFromApiKey,
  ensureOpencodeCloudProviders,
  extractConversationId,
  fetchClinePassModels,
  fetchCommandCodeModels,
  fetchTemplateModels,
  filterModelsByAvailability,
  oauthAuthRef,
  openCodeGoHeaders,
  providerRefreshToken,
  refreshProviderModels,
  stripGoogleModelPrefix,
  toOAuthRegistryId,
  validateClinePassApiKey
} from "./chunk-4QAQ4MVE.js";
import {
  ANTIGRAVITY_BASE_URLS,
  ANTIGRAVITY_USER_AGENT,
  BACKENDS,
  CLAUDE_CODE_CLI_VERSION,
  MAX_MODEL_CATALOG,
  UpstreamUnreachableError,
  VERSION,
  VERTEX_ANTHROPIC_NPM,
  VERTEX_ANTHROPIC_PROVIDER_ID,
  anthropicErrorType,
  buildCodexReasoningLevels,
  buildPricingIndex,
  classifyFreeStatus,
  claudeCodeClientModelId,
  claudeCodeContextWindow,
  createLanguageModel,
  deepMergeProviderOptions,
  deleteProviderCredential,
  describeOAuthAccount,
  effortProviderOptions,
  encodeToolUseId,
  enrichModelsForProviderPricing,
  enrichPricingAsync,
  fetchWithOAuthRetry,
  formatOAuthAccount,
  formatUpstreamError,
  generateCliUserID,
  generateTextStreamingIfRequired,
  getEnvServerPassword,
  getProxyDebugLogPath,
  getReasoningCapabilities,
  getSavedServerPassword,
  getServerDebugLogPath,
  getServerExposedProviders,
  getServerFavoritesOnly,
  getServerFreeModelsOnly,
  getServerListenMode,
  getServerMaskGatewayIds,
  grabRoundTripSignature,
  injectClaudeCodeBillingSystemLine,
  injectClaudeIdentity,
  isAuthorized,
  isBrowserRedirectOAuth,
  isFreeStatus,
  isProviderKind,
  isSdkMigratedNpm,
  loadPreferences,
  loadPricingCache,
  loadRegistry,
  localIsoTimestamp,
  localTimestamp,
  maxToolsForNpm,
  nextInstanceId,
  oauthCredentialToKeychainJson,
  parseDsmlToolCalls,
  parseToolArguments,
  printTraceLog,
  providerKind,
  readFromCredentialStore,
  readStoredOAuthCredential,
  readStoredProviderCredential,
  redactTraceLine,
  relayAnthropicMessages,
  resetTraceLog,
  resolveApiKey,
  resolveContextWindow,
  resolveProviderCredential,
  routeLookupIds,
  runAntigravityOAuthFlow,
  runClaudeCodeOAuthFlow,
  runClinePassDeviceCodeFlow,
  runCodexCommandSync,
  runGithubDeviceCodeFlow,
  runOpenAiDeviceCodeFlow,
  runXaiDeviceCodeFlow,
  sameOAuthAccount,
  sanitizeCredential,
  saveProviderCredential,
  saveRegistry,
  selectBetaFlags,
  serializeToolResultContent,
  setSavedServerPassword,
  setServerExposedProviders,
  setServerFavoritesOnly,
  setServerFreeModelsOnly,
  setServerListenMode,
  setServerMaskGatewayIds,
  silenceSdkWarnings,
  splitToolUseId,
  sseChunk,
  streamActivity,
  stripOneMContextSuffix,
  supportsAdditionalOAuthAccounts,
  supportsNativeOAuth,
  thinkingProviderOptions,
  tokensToStoredCredential,
  uniqueProviderName,
  upstreamHttpStatus,
  vertexAnthropicCachedModels,
  vertexAnthropicSetupError,
  writeSecureLogLine
} from "./chunk-MNN6GZ3I.js";
import {
  getTemplateById,
  init_provider_templates,
  supportsAdditionalApiAccounts
} from "./chunk-RKRPDZVV.js";
import {
  getAppHome,
  hasApplicationDefaultCredentials,
  loadVertexModelEntries,
  resolveVertexLocation,
  resolveVertexProject,
  saveVertexModelEntries
} from "./chunk-KNCSTHR4.js";

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
var CODEX_APP_THREAD_UNLOAD_DELAY_SECS = 48 * 60 * 60;
function codexAppModelSlug(rawModelId) {
  return rawModelId.startsWith("models/") ? rawModelId.slice("models/".length) : rawModelId;
}
function parseCodexAppModelSlug(modelKey) {
  const prefix = `${CODEX_APP_PROVIDER_ID}/`;
  return modelKey.startsWith(prefix) ? modelKey.slice(prefix.length) : modelKey;
}
function buildCodexAppRootConfig(spec) {
  return {
    model: codexAppModelSlug(spec.route.modelId),
    model_provider: "openai",
    openai_base_url: spec.proxyBaseUrl ?? `http://127.0.0.1:${spec.proxyPort}/v1`,
    model_catalog_json: spec.catalogPath,
    thread_unload_delay_secs: CODEX_APP_THREAD_UNLOAD_DELAY_SECS,
    ...spec.multiAgentV2Enabled ? {
      features: { multi_agent_v2: CODEX_MULTI_AGENT_V2 }
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

// src/oauth/risk-notice.ts
function subscriptionOAuthRisk(providerId) {
  const isGoogle = providerId === "antigravity";
  return {
    providerLabel: isGoogle ? "Antigravity / Google" : "Claude Code",
    isGoogle,
    service: isGoogle ? "Google account (Gmail, Drive, YouTube, Workspace, and all tied services)" : "Anthropic account (Claude Pro / Max subscription)",
    enforcementNote: isGoogle ? "Community reports: Google has issued account bans for this usage." : "Anthropic actively enforces this \u2014 validating request shape and has taken legal action against other projects.",
    compatibilityNote: isGoogle ? void 0 : "For compatibility, relay-ai may reproduce Claude Code-style request metadata and attribution so Anthropic classifies traffic as Claude Code.",
    consequences: ["Token revocation", "Account suspension or permanent ban"],
    lossNote: isGoogle ? "Loss of ALL services tied to this Google account" : void 0,
    advice: isGoogle ? "Do not use your primary Google account. Use a throwaway account." : void 0,
    disclaimer: `relay-ai is not affiliated with ${isGoogle ? "Google" : "Anthropic"} and cannot protect you.`
  };
}
function subscriptionOAuthRiskLines(providerId) {
  const risk = subscriptionOAuthRisk(providerId);
  return {
    title: `Account risk \u2014 ${risk.providerLabel} OAuth`,
    lines: [
      `This extracts OAuth tokens from your ${risk.service}.`,
      "Routing subscription tokens through relay-ai to power other tools may violate the provider's Terms of Service.",
      risk.enforcementNote,
      ...risk.compatibilityNote ? [risk.compatibilityNote] : [],
      `Possible consequences: ${[...risk.consequences, ...risk.lossNote ? [risk.lossNote] : []].join("; ")}.`,
      ...risk.advice ? [risk.advice] : [],
      risk.disclaimer
    ]
  };
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
  switch (providerKind(providerId)) {
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
    } else if (model.referencePrice) {
      const { cost, provider } = model.referencePrice;
      defaultHint = pc.dim(`Reference estimate $${cost.input}/$${cost.output} 1M (${provider})`);
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
function fmtContextWindow(contextWindow) {
  if (!contextWindow) return "";
  const k = contextWindow >= 1e3 ? `${Math.round(contextWindow / 1e3)}k` : String(contextWindow);
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
function printProviderDetailPanel(name, modelCount, authLabel, account) {
  printPanel(fmtProvider(name), [
    `${pc.bold("Models")}  ${pc.cyan(String(modelCount))} cached`,
    `${pc.bold("Auth")}    ${pc.white(authLabel)}`,
    ...account ? [`${pc.bold("Account")} ${pc.white(account)}`] : []
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
  const risk = subscriptionOAuthRisk(providerId);
  printPanel(pc.red(`\u26A0  Account Risk \u2014 ${risk.providerLabel} OAuth`), [
    `${pc.white("This extracts OAuth tokens from your")} ${pc.bold(risk.service)}.`,
    "",
    `${pc.white("Routing subscription tokens through relay-ai to power other tools")}`,
    `${pc.white("may violate the provider's Terms of Service.")}`,
    "",
    `${pc.yellow(risk.enforcementNote)}`,
    ...risk.compatibilityNote ? [`${pc.yellow(risk.compatibilityNote)}`] : [],
    "",
    `${pc.white("Possible consequences:")}`,
    ...risk.consequences.map((item) => `  ${pc.dim("\u2022")} ${pc.white(item)}`),
    ...risk.lossNote ? [`  ${pc.dim("\u2022")} ${pc.red(pc.bold(risk.lossNote))}`] : [],
    "",
    ...risk.advice ? [`${pc.red(pc.bold("Do not use your primary Google account."))} ${pc.white("Use a throwaway account.")}`] : [],
    `${pc.dim(risk.disclaimer)}`
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

// src/pool/claude-runtime.ts
import { randomUUID } from "crypto";

// node_modules/@anthropic-ai/sdk/internal/tslib.mjs
function __classPrivateFieldSet(receiver, state, value, kind, f) {
  if (kind === "m")
    throw new TypeError("Private method is not writable");
  if (kind === "a" && !f)
    throw new TypeError("Private accessor was defined without a setter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver))
    throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
}
function __classPrivateFieldGet(receiver, state, kind, f) {
  if (kind === "a" && !f)
    throw new TypeError("Private accessor was defined without a getter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver))
    throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
}

// node_modules/@anthropic-ai/sdk/internal/errors.mjs
function isAbortError(err) {
  return typeof err === "object" && err !== null && // Spec-compliant fetch implementations
  ("name" in err && err.name === "AbortError" || // Expo fetch
  "message" in err && String(err.message).includes("FetchRequestCanceledException"));
}
var castToError = (err) => {
  if (err instanceof Error)
    return err;
  if (typeof err === "object" && err !== null) {
    try {
      if (Object.prototype.toString.call(err) === "[object Error]") {
        const error = new Error(err.message, err.cause ? { cause: err.cause } : {});
        if (err.stack)
          error.stack = err.stack;
        if (err.cause && !error.cause)
          error.cause = err.cause;
        if (err.name)
          error.name = err.name;
        return error;
      }
    } catch {
    }
    try {
      return new Error(JSON.stringify(err));
    } catch {
    }
  }
  return new Error(err);
};

// node_modules/@anthropic-ai/sdk/core/error.mjs
var AnthropicError = class extends Error {
};
var APIError = class _APIError extends AnthropicError {
  constructor(status, error, message, headers) {
    super(`${_APIError.makeMessage(status, error, message)}`);
    this.status = status;
    this.headers = headers;
    this.requestID = headers?.get("request-id");
    this.error = error;
  }
  static makeMessage(status, error, message) {
    const msg = error?.message ? typeof error.message === "string" ? error.message : JSON.stringify(error.message) : error ? JSON.stringify(error) : message;
    if (status && msg) {
      return `${status} ${msg}`;
    }
    if (status) {
      return `${status} status code (no body)`;
    }
    if (msg) {
      return msg;
    }
    return "(no status code or body)";
  }
  static generate(status, errorResponse, message, headers) {
    if (!status || !headers) {
      return new APIConnectionError({ message, cause: castToError(errorResponse) });
    }
    const error = errorResponse;
    if (status === 400) {
      return new BadRequestError(status, error, message, headers);
    }
    if (status === 401) {
      return new AuthenticationError(status, error, message, headers);
    }
    if (status === 403) {
      return new PermissionDeniedError(status, error, message, headers);
    }
    if (status === 404) {
      return new NotFoundError(status, error, message, headers);
    }
    if (status === 409) {
      return new ConflictError(status, error, message, headers);
    }
    if (status === 422) {
      return new UnprocessableEntityError(status, error, message, headers);
    }
    if (status === 429) {
      return new RateLimitError(status, error, message, headers);
    }
    if (status >= 500) {
      return new InternalServerError(status, error, message, headers);
    }
    return new _APIError(status, error, message, headers);
  }
};
var APIUserAbortError = class extends APIError {
  constructor({ message } = {}) {
    super(void 0, void 0, message || "Request was aborted.", void 0);
  }
};
var APIConnectionError = class extends APIError {
  constructor({ message, cause }) {
    super(void 0, void 0, message || "Connection error.", void 0);
    if (cause)
      this.cause = cause;
  }
};
var BadRequestError = class extends APIError {
};
var AuthenticationError = class extends APIError {
};
var PermissionDeniedError = class extends APIError {
};
var NotFoundError = class extends APIError {
};
var ConflictError = class extends APIError {
};
var UnprocessableEntityError = class extends APIError {
};
var RateLimitError = class extends APIError {
};
var InternalServerError = class extends APIError {
};

// node_modules/@anthropic-ai/sdk/internal/shims.mjs
function makeReadableStream(...args) {
  const ReadableStream2 = globalThis.ReadableStream;
  if (typeof ReadableStream2 === "undefined") {
    throw new Error("`ReadableStream` is not defined as a global; You will need to polyfill it, `globalThis.ReadableStream = ReadableStream`");
  }
  return new ReadableStream2(...args);
}
function ReadableStreamToAsyncIterable(stream) {
  if (stream[Symbol.asyncIterator])
    return stream;
  const reader = stream.getReader();
  return {
    async next() {
      try {
        const result = await reader.read();
        if (result?.done)
          reader.releaseLock();
        return result;
      } catch (e) {
        reader.releaseLock();
        throw e;
      }
    },
    async return() {
      const cancelPromise = reader.cancel();
      reader.releaseLock();
      await cancelPromise;
      return { done: true, value: void 0 };
    },
    [Symbol.asyncIterator]() {
      return this;
    }
  };
}

// node_modules/@anthropic-ai/sdk/internal/utils/bytes.mjs
function concatBytes(buffers) {
  let length = 0;
  for (const buffer of buffers) {
    length += buffer.length;
  }
  const output = new Uint8Array(length);
  let index = 0;
  for (const buffer of buffers) {
    output.set(buffer, index);
    index += buffer.length;
  }
  return output;
}
var encodeUTF8_;
function encodeUTF8(str) {
  let encoder;
  return (encodeUTF8_ ?? (encoder = new globalThis.TextEncoder(), encodeUTF8_ = encoder.encode.bind(encoder)))(str);
}
var decodeUTF8_;
function decodeUTF8(bytes) {
  let decoder;
  return (decodeUTF8_ ?? (decoder = new globalThis.TextDecoder(), decodeUTF8_ = decoder.decode.bind(decoder)))(bytes);
}

// node_modules/@anthropic-ai/sdk/internal/decoders/line.mjs
var _LineDecoder_buffer;
var _LineDecoder_carriageReturnIndex;
var LineDecoder = class {
  constructor() {
    _LineDecoder_buffer.set(this, void 0);
    _LineDecoder_carriageReturnIndex.set(this, void 0);
    __classPrivateFieldSet(this, _LineDecoder_buffer, new Uint8Array(), "f");
    __classPrivateFieldSet(this, _LineDecoder_carriageReturnIndex, null, "f");
  }
  decode(chunk) {
    if (chunk == null) {
      return [];
    }
    const binaryChunk = chunk instanceof ArrayBuffer ? new Uint8Array(chunk) : typeof chunk === "string" ? encodeUTF8(chunk) : chunk;
    __classPrivateFieldSet(this, _LineDecoder_buffer, concatBytes([__classPrivateFieldGet(this, _LineDecoder_buffer, "f"), binaryChunk]), "f");
    const lines = [];
    let patternIndex;
    while ((patternIndex = findNewlineIndex(__classPrivateFieldGet(this, _LineDecoder_buffer, "f"), __classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f"))) != null) {
      if (patternIndex.carriage && __classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f") == null) {
        __classPrivateFieldSet(this, _LineDecoder_carriageReturnIndex, patternIndex.index, "f");
        continue;
      }
      if (__classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f") != null && (patternIndex.index !== __classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f") + 1 || patternIndex.carriage)) {
        lines.push(decodeUTF8(__classPrivateFieldGet(this, _LineDecoder_buffer, "f").subarray(0, __classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f") - 1)));
        __classPrivateFieldSet(this, _LineDecoder_buffer, __classPrivateFieldGet(this, _LineDecoder_buffer, "f").subarray(__classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f")), "f");
        __classPrivateFieldSet(this, _LineDecoder_carriageReturnIndex, null, "f");
        continue;
      }
      const endIndex = __classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f") !== null ? patternIndex.preceding - 1 : patternIndex.preceding;
      const line = decodeUTF8(__classPrivateFieldGet(this, _LineDecoder_buffer, "f").subarray(0, endIndex));
      lines.push(line);
      __classPrivateFieldSet(this, _LineDecoder_buffer, __classPrivateFieldGet(this, _LineDecoder_buffer, "f").subarray(patternIndex.index), "f");
      __classPrivateFieldSet(this, _LineDecoder_carriageReturnIndex, null, "f");
    }
    return lines;
  }
  flush() {
    if (!__classPrivateFieldGet(this, _LineDecoder_buffer, "f").length) {
      return [];
    }
    return this.decode("\n");
  }
};
_LineDecoder_buffer = /* @__PURE__ */ new WeakMap(), _LineDecoder_carriageReturnIndex = /* @__PURE__ */ new WeakMap();
LineDecoder.NEWLINE_CHARS = /* @__PURE__ */ new Set(["\n", "\r"]);
LineDecoder.NEWLINE_REGEXP = /\r\n|[\n\r]/g;
function findNewlineIndex(buffer, startIndex) {
  const newline = 10;
  const carriage = 13;
  for (let i = startIndex ?? 0; i < buffer.length; i++) {
    if (buffer[i] === newline) {
      return { preceding: i, index: i + 1, carriage: false };
    }
    if (buffer[i] === carriage) {
      return { preceding: i, index: i + 1, carriage: true };
    }
  }
  return null;
}
function findDoubleNewlineIndex(buffer) {
  const newline = 10;
  const carriage = 13;
  for (let i = 0; i < buffer.length - 1; i++) {
    if (buffer[i] === newline && buffer[i + 1] === newline) {
      return i + 2;
    }
    if (buffer[i] === carriage && buffer[i + 1] === carriage) {
      return i + 2;
    }
    if (buffer[i] === carriage && buffer[i + 1] === newline && i + 3 < buffer.length && buffer[i + 2] === carriage && buffer[i + 3] === newline) {
      return i + 4;
    }
  }
  return -1;
}

// node_modules/@anthropic-ai/sdk/internal/utils/values.mjs
var safeJSON = (text4) => {
  try {
    return JSON.parse(text4);
  } catch (err) {
    return void 0;
  }
};

// node_modules/@anthropic-ai/sdk/internal/utils/log.mjs
var levelNumbers = {
  off: 0,
  error: 200,
  warn: 300,
  info: 400,
  debug: 500
};
function noop() {
}
function makeLogFn(fnLevel, logger, logLevel) {
  if (!logger || levelNumbers[fnLevel] > levelNumbers[logLevel]) {
    return noop;
  } else {
    return logger[fnLevel].bind(logger);
  }
}
var noopLogger = {
  error: noop,
  warn: noop,
  info: noop,
  debug: noop
};
var cachedLoggers = /* @__PURE__ */ new WeakMap();
function loggerFor(client) {
  const logger = client.logger;
  const logLevel = client.logLevel ?? "off";
  if (!logger) {
    return noopLogger;
  }
  const cachedLogger = cachedLoggers.get(logger);
  if (cachedLogger && cachedLogger[0] === logLevel) {
    return cachedLogger[1];
  }
  const levelLogger = {
    error: makeLogFn("error", logger, logLevel),
    warn: makeLogFn("warn", logger, logLevel),
    info: makeLogFn("info", logger, logLevel),
    debug: makeLogFn("debug", logger, logLevel)
  };
  cachedLoggers.set(logger, [logLevel, levelLogger]);
  return levelLogger;
}

// node_modules/@anthropic-ai/sdk/core/streaming.mjs
var _Stream_client;
var Stream = class _Stream {
  constructor(iterator, controller, client) {
    this.iterator = iterator;
    _Stream_client.set(this, void 0);
    this.controller = controller;
    __classPrivateFieldSet(this, _Stream_client, client, "f");
  }
  static fromSSEResponse(response, controller, client) {
    let consumed = false;
    const logger = client ? loggerFor(client) : console;
    async function* iterator() {
      if (consumed) {
        throw new AnthropicError("Cannot iterate over a consumed stream, use `.tee()` to split the stream.");
      }
      consumed = true;
      let done = false;
      try {
        for await (const sse of _iterSSEMessages(response, controller)) {
          if (sse.event === "completion") {
            try {
              yield JSON.parse(sse.data);
            } catch (e) {
              logger.error(`Could not parse message into JSON:`, sse.data);
              logger.error(`From chunk:`, sse.raw);
              throw e;
            }
          }
          if (sse.event === "message_start" || sse.event === "message_delta" || sse.event === "message_stop" || sse.event === "content_block_start" || sse.event === "content_block_delta" || sse.event === "content_block_stop") {
            try {
              yield JSON.parse(sse.data);
            } catch (e) {
              logger.error(`Could not parse message into JSON:`, sse.data);
              logger.error(`From chunk:`, sse.raw);
              throw e;
            }
          }
          if (sse.event === "ping") {
            continue;
          }
          if (sse.event === "error") {
            throw new APIError(void 0, safeJSON(sse.data) ?? sse.data, void 0, response.headers);
          }
        }
        done = true;
      } catch (e) {
        if (isAbortError(e))
          return;
        throw e;
      } finally {
        if (!done)
          controller.abort();
      }
    }
    return new _Stream(iterator, controller, client);
  }
  /**
   * Generates a Stream from a newline-separated ReadableStream
   * where each item is a JSON value.
   */
  static fromReadableStream(readableStream, controller, client) {
    let consumed = false;
    async function* iterLines() {
      const lineDecoder = new LineDecoder();
      const iter = ReadableStreamToAsyncIterable(readableStream);
      for await (const chunk of iter) {
        for (const line of lineDecoder.decode(chunk)) {
          yield line;
        }
      }
      for (const line of lineDecoder.flush()) {
        yield line;
      }
    }
    async function* iterator() {
      if (consumed) {
        throw new AnthropicError("Cannot iterate over a consumed stream, use `.tee()` to split the stream.");
      }
      consumed = true;
      let done = false;
      try {
        for await (const line of iterLines()) {
          if (done)
            continue;
          if (line)
            yield JSON.parse(line);
        }
        done = true;
      } catch (e) {
        if (isAbortError(e))
          return;
        throw e;
      } finally {
        if (!done)
          controller.abort();
      }
    }
    return new _Stream(iterator, controller, client);
  }
  [(_Stream_client = /* @__PURE__ */ new WeakMap(), Symbol.asyncIterator)]() {
    return this.iterator();
  }
  /**
   * Splits the stream into two streams which can be
   * independently read from at different speeds.
   */
  tee() {
    const left = [];
    const right = [];
    const iterator = this.iterator();
    const teeIterator = (queue) => {
      return {
        next: () => {
          if (queue.length === 0) {
            const result = iterator.next();
            left.push(result);
            right.push(result);
          }
          return queue.shift();
        }
      };
    };
    return [
      new _Stream(() => teeIterator(left), this.controller, __classPrivateFieldGet(this, _Stream_client, "f")),
      new _Stream(() => teeIterator(right), this.controller, __classPrivateFieldGet(this, _Stream_client, "f"))
    ];
  }
  /**
   * Converts this stream to a newline-separated ReadableStream of
   * JSON stringified values in the stream
   * which can be turned back into a Stream with `Stream.fromReadableStream()`.
   */
  toReadableStream() {
    const self = this;
    let iter;
    return makeReadableStream({
      async start() {
        iter = self[Symbol.asyncIterator]();
      },
      async pull(ctrl) {
        try {
          const { value, done } = await iter.next();
          if (done)
            return ctrl.close();
          const bytes = encodeUTF8(JSON.stringify(value) + "\n");
          ctrl.enqueue(bytes);
        } catch (err) {
          ctrl.error(err);
        }
      },
      async cancel() {
        await iter.return?.();
      }
    });
  }
};
async function* _iterSSEMessages(response, controller) {
  if (!response.body) {
    controller.abort();
    if (typeof globalThis.navigator !== "undefined" && globalThis.navigator.product === "ReactNative") {
      throw new AnthropicError(`The default react-native fetch implementation does not support streaming. Please use expo/fetch: https://docs.expo.dev/versions/latest/sdk/expo/#expofetch-api`);
    }
    throw new AnthropicError(`Attempted to iterate over a response with no body`);
  }
  const sseDecoder = new SSEDecoder();
  const lineDecoder = new LineDecoder();
  const iter = ReadableStreamToAsyncIterable(response.body);
  for await (const sseChunk2 of iterSSEChunks(iter)) {
    for (const line of lineDecoder.decode(sseChunk2)) {
      const sse = sseDecoder.decode(line);
      if (sse)
        yield sse;
    }
  }
  for (const line of lineDecoder.flush()) {
    const sse = sseDecoder.decode(line);
    if (sse)
      yield sse;
  }
}
async function* iterSSEChunks(iterator) {
  let data = new Uint8Array();
  for await (const chunk of iterator) {
    if (chunk == null) {
      continue;
    }
    const binaryChunk = chunk instanceof ArrayBuffer ? new Uint8Array(chunk) : typeof chunk === "string" ? encodeUTF8(chunk) : chunk;
    let newData = new Uint8Array(data.length + binaryChunk.length);
    newData.set(data);
    newData.set(binaryChunk, data.length);
    data = newData;
    let patternIndex;
    while ((patternIndex = findDoubleNewlineIndex(data)) !== -1) {
      yield data.slice(0, patternIndex);
      data = data.slice(patternIndex);
    }
  }
  if (data.length > 0) {
    yield data;
  }
}
var SSEDecoder = class {
  constructor() {
    this.event = null;
    this.data = [];
    this.chunks = [];
  }
  decode(line) {
    if (line.endsWith("\r")) {
      line = line.substring(0, line.length - 1);
    }
    if (!line) {
      if (!this.event && !this.data.length)
        return null;
      const sse = {
        event: this.event,
        data: this.data.join("\n"),
        raw: this.chunks
      };
      this.event = null;
      this.data = [];
      this.chunks = [];
      return sse;
    }
    this.chunks.push(line);
    if (line.startsWith(":")) {
      return null;
    }
    let [fieldname, _, value] = partition(line, ":");
    if (value.startsWith(" ")) {
      value = value.substring(1);
    }
    if (fieldname === "event") {
      this.event = value;
    } else if (fieldname === "data") {
      this.data.push(value);
    }
    return null;
  }
};
function partition(str, delimiter) {
  const index = str.indexOf(delimiter);
  if (index !== -1) {
    return [str.substring(0, index), delimiter, str.substring(index + delimiter.length)];
  }
  return [str, "", ""];
}

// node_modules/@anthropic-ai/sdk/_vendor/partial-json-parser/parser.mjs
var tokenize = (input) => {
  let current = 0;
  let tokens = [];
  while (current < input.length) {
    let char = input[current];
    if (char === "\\") {
      current++;
      continue;
    }
    if (char === "{") {
      tokens.push({
        type: "brace",
        value: "{"
      });
      current++;
      continue;
    }
    if (char === "}") {
      tokens.push({
        type: "brace",
        value: "}"
      });
      current++;
      continue;
    }
    if (char === "[") {
      tokens.push({
        type: "paren",
        value: "["
      });
      current++;
      continue;
    }
    if (char === "]") {
      tokens.push({
        type: "paren",
        value: "]"
      });
      current++;
      continue;
    }
    if (char === ":") {
      tokens.push({
        type: "separator",
        value: ":"
      });
      current++;
      continue;
    }
    if (char === ",") {
      tokens.push({
        type: "delimiter",
        value: ","
      });
      current++;
      continue;
    }
    if (char === '"') {
      let value = "";
      let danglingQuote = false;
      char = input[++current];
      while (char !== '"') {
        if (current === input.length) {
          danglingQuote = true;
          break;
        }
        if (char === "\\") {
          current++;
          if (current === input.length) {
            danglingQuote = true;
            break;
          }
          value += char + input[current];
          char = input[++current];
        } else {
          value += char;
          char = input[++current];
        }
      }
      char = input[++current];
      if (!danglingQuote) {
        tokens.push({
          type: "string",
          value
        });
      }
      continue;
    }
    let WHITESPACE = /\s/;
    if (char && WHITESPACE.test(char)) {
      current++;
      continue;
    }
    let NUMBERS = /[0-9]/;
    if (char && NUMBERS.test(char) || char === "-" || char === ".") {
      let value = "";
      if (char === "-") {
        value += char;
        char = input[++current];
      }
      while (char && NUMBERS.test(char) || char === ".") {
        value += char;
        char = input[++current];
      }
      tokens.push({
        type: "number",
        value
      });
      continue;
    }
    let LETTERS = /[a-z]/i;
    if (char && LETTERS.test(char)) {
      let value = "";
      while (char && LETTERS.test(char)) {
        if (current === input.length) {
          break;
        }
        value += char;
        char = input[++current];
      }
      if (value == "true" || value == "false" || value === "null") {
        tokens.push({
          type: "name",
          value
        });
      } else {
        current++;
        continue;
      }
      continue;
    }
    current++;
  }
  return tokens;
};
var strip = (tokens) => {
  if (tokens.length === 0) {
    return tokens;
  }
  let lastToken = tokens[tokens.length - 1];
  switch (lastToken.type) {
    case "separator":
      tokens = tokens.slice(0, tokens.length - 1);
      return strip(tokens);
      break;
    case "number":
      let lastCharacterOfLastToken = lastToken.value[lastToken.value.length - 1];
      if (lastCharacterOfLastToken === "." || lastCharacterOfLastToken === "-") {
        tokens = tokens.slice(0, tokens.length - 1);
        return strip(tokens);
      }
    case "string":
      let tokenBeforeTheLastToken = tokens[tokens.length - 2];
      if (tokenBeforeTheLastToken?.type === "delimiter") {
        tokens = tokens.slice(0, tokens.length - 1);
        return strip(tokens);
      } else if (tokenBeforeTheLastToken?.type === "brace" && tokenBeforeTheLastToken.value === "{") {
        tokens = tokens.slice(0, tokens.length - 1);
        return strip(tokens);
      }
      break;
    case "delimiter":
      tokens = tokens.slice(0, tokens.length - 1);
      return strip(tokens);
      break;
  }
  return tokens;
};
var unstrip = (tokens) => {
  let tail = [];
  tokens.map((token) => {
    if (token.type === "brace") {
      if (token.value === "{") {
        tail.push("}");
      } else {
        tail.splice(tail.lastIndexOf("}"), 1);
      }
    }
    if (token.type === "paren") {
      if (token.value === "[") {
        tail.push("]");
      } else {
        tail.splice(tail.lastIndexOf("]"), 1);
      }
    }
  });
  if (tail.length > 0) {
    tail.reverse().map((item) => {
      if (item === "}") {
        tokens.push({
          type: "brace",
          value: "}"
        });
      } else if (item === "]") {
        tokens.push({
          type: "paren",
          value: "]"
        });
      }
    });
  }
  return tokens;
};
var generate = (tokens) => {
  let output = "";
  tokens.map((token) => {
    switch (token.type) {
      case "string":
        output += '"' + token.value + '"';
        break;
      default:
        output += token.value;
        break;
    }
  });
  return output;
};
var partialParse = (input) => JSON.parse(generate(unstrip(strip(tokenize(input)))));

// node_modules/@anthropic-ai/sdk/lib/MessageStream.mjs
var _MessageStream_instances;
var _MessageStream_currentMessageSnapshot;
var _MessageStream_connectedPromise;
var _MessageStream_resolveConnectedPromise;
var _MessageStream_rejectConnectedPromise;
var _MessageStream_endPromise;
var _MessageStream_resolveEndPromise;
var _MessageStream_rejectEndPromise;
var _MessageStream_listeners;
var _MessageStream_ended;
var _MessageStream_errored;
var _MessageStream_aborted;
var _MessageStream_catchingPromiseCreated;
var _MessageStream_response;
var _MessageStream_request_id;
var _MessageStream_getFinalMessage;
var _MessageStream_getFinalText;
var _MessageStream_handleError;
var _MessageStream_beginRequest;
var _MessageStream_addStreamEvent;
var _MessageStream_endRequest;
var _MessageStream_accumulateMessage;
var JSON_BUF_PROPERTY = "__json_buf";
function tracksToolInput(content) {
  return content.type === "tool_use" || content.type === "server_tool_use";
}
var MessageStream = class _MessageStream {
  constructor() {
    _MessageStream_instances.add(this);
    this.messages = [];
    this.receivedMessages = [];
    _MessageStream_currentMessageSnapshot.set(this, void 0);
    this.controller = new AbortController();
    _MessageStream_connectedPromise.set(this, void 0);
    _MessageStream_resolveConnectedPromise.set(this, () => {
    });
    _MessageStream_rejectConnectedPromise.set(this, () => {
    });
    _MessageStream_endPromise.set(this, void 0);
    _MessageStream_resolveEndPromise.set(this, () => {
    });
    _MessageStream_rejectEndPromise.set(this, () => {
    });
    _MessageStream_listeners.set(this, {});
    _MessageStream_ended.set(this, false);
    _MessageStream_errored.set(this, false);
    _MessageStream_aborted.set(this, false);
    _MessageStream_catchingPromiseCreated.set(this, false);
    _MessageStream_response.set(this, void 0);
    _MessageStream_request_id.set(this, void 0);
    _MessageStream_handleError.set(this, (error) => {
      __classPrivateFieldSet(this, _MessageStream_errored, true, "f");
      if (isAbortError(error)) {
        error = new APIUserAbortError();
      }
      if (error instanceof APIUserAbortError) {
        __classPrivateFieldSet(this, _MessageStream_aborted, true, "f");
        return this._emit("abort", error);
      }
      if (error instanceof AnthropicError) {
        return this._emit("error", error);
      }
      if (error instanceof Error) {
        const anthropicError2 = new AnthropicError(error.message);
        anthropicError2.cause = error;
        return this._emit("error", anthropicError2);
      }
      return this._emit("error", new AnthropicError(String(error)));
    });
    __classPrivateFieldSet(this, _MessageStream_connectedPromise, new Promise((resolve, reject) => {
      __classPrivateFieldSet(this, _MessageStream_resolveConnectedPromise, resolve, "f");
      __classPrivateFieldSet(this, _MessageStream_rejectConnectedPromise, reject, "f");
    }), "f");
    __classPrivateFieldSet(this, _MessageStream_endPromise, new Promise((resolve, reject) => {
      __classPrivateFieldSet(this, _MessageStream_resolveEndPromise, resolve, "f");
      __classPrivateFieldSet(this, _MessageStream_rejectEndPromise, reject, "f");
    }), "f");
    __classPrivateFieldGet(this, _MessageStream_connectedPromise, "f").catch(() => {
    });
    __classPrivateFieldGet(this, _MessageStream_endPromise, "f").catch(() => {
    });
  }
  get response() {
    return __classPrivateFieldGet(this, _MessageStream_response, "f");
  }
  get request_id() {
    return __classPrivateFieldGet(this, _MessageStream_request_id, "f");
  }
  /**
   * Returns the `MessageStream` data, the raw `Response` instance and the ID of the request,
   * returned vie the `request-id` header which is useful for debugging requests and resporting
   * issues to Anthropic.
   *
   * This is the same as the `APIPromise.withResponse()` method.
   *
   * This method will raise an error if you created the stream using `MessageStream.fromReadableStream`
   * as no `Response` is available.
   */
  async withResponse() {
    __classPrivateFieldSet(this, _MessageStream_catchingPromiseCreated, true, "f");
    const response = await __classPrivateFieldGet(this, _MessageStream_connectedPromise, "f");
    if (!response) {
      throw new Error("Could not resolve a `Response` object");
    }
    return {
      data: this,
      response,
      request_id: response.headers.get("request-id")
    };
  }
  /**
   * Intended for use on the frontend, consuming a stream produced with
   * `.toReadableStream()` on the backend.
   *
   * Note that messages sent to the model do not appear in `.on('message')`
   * in this context.
   */
  static fromReadableStream(stream) {
    const runner = new _MessageStream();
    runner._run(() => runner._fromReadableStream(stream));
    return runner;
  }
  static createMessage(messages, params, options) {
    const runner = new _MessageStream();
    for (const message of params.messages) {
      runner._addMessageParam(message);
    }
    runner._run(() => runner._createMessage(messages, { ...params, stream: true }, { ...options, headers: { ...options?.headers, "X-Stainless-Helper-Method": "stream" } }));
    return runner;
  }
  _run(executor) {
    executor().then(() => {
      this._emitFinal();
      this._emit("end");
    }, __classPrivateFieldGet(this, _MessageStream_handleError, "f"));
  }
  _addMessageParam(message) {
    this.messages.push(message);
  }
  _addMessage(message, emit = true) {
    this.receivedMessages.push(message);
    if (emit) {
      this._emit("message", message);
    }
  }
  async _createMessage(messages, params, options) {
    const signal = options?.signal;
    let abortHandler;
    if (signal) {
      if (signal.aborted)
        this.controller.abort();
      abortHandler = this.controller.abort.bind(this.controller);
      signal.addEventListener("abort", abortHandler);
    }
    try {
      __classPrivateFieldGet(this, _MessageStream_instances, "m", _MessageStream_beginRequest).call(this);
      const { response, data: stream } = await messages.create({ ...params, stream: true }, { ...options, signal: this.controller.signal }).withResponse();
      this._connected(response);
      for await (const event of stream) {
        __classPrivateFieldGet(this, _MessageStream_instances, "m", _MessageStream_addStreamEvent).call(this, event);
      }
      if (stream.controller.signal?.aborted) {
        throw new APIUserAbortError();
      }
      __classPrivateFieldGet(this, _MessageStream_instances, "m", _MessageStream_endRequest).call(this);
    } finally {
      if (signal && abortHandler) {
        signal.removeEventListener("abort", abortHandler);
      }
    }
  }
  _connected(response) {
    if (this.ended)
      return;
    __classPrivateFieldSet(this, _MessageStream_response, response, "f");
    __classPrivateFieldSet(this, _MessageStream_request_id, response?.headers.get("request-id"), "f");
    __classPrivateFieldGet(this, _MessageStream_resolveConnectedPromise, "f").call(this, response);
    this._emit("connect");
  }
  get ended() {
    return __classPrivateFieldGet(this, _MessageStream_ended, "f");
  }
  get errored() {
    return __classPrivateFieldGet(this, _MessageStream_errored, "f");
  }
  get aborted() {
    return __classPrivateFieldGet(this, _MessageStream_aborted, "f");
  }
  abort() {
    this.controller.abort();
  }
  /**
   * Adds the listener function to the end of the listeners array for the event.
   * No checks are made to see if the listener has already been added. Multiple calls passing
   * the same combination of event and listener will result in the listener being added, and
   * called, multiple times.
   * @returns this MessageStream, so that calls can be chained
   */
  on(event, listener) {
    const listeners = __classPrivateFieldGet(this, _MessageStream_listeners, "f")[event] || (__classPrivateFieldGet(this, _MessageStream_listeners, "f")[event] = []);
    listeners.push({ listener });
    return this;
  }
  /**
   * Removes the specified listener from the listener array for the event.
   * off() will remove, at most, one instance of a listener from the listener array. If any single
   * listener has been added multiple times to the listener array for the specified event, then
   * off() must be called multiple times to remove each instance.
   * @returns this MessageStream, so that calls can be chained
   */
  off(event, listener) {
    const listeners = __classPrivateFieldGet(this, _MessageStream_listeners, "f")[event];
    if (!listeners)
      return this;
    const index = listeners.findIndex((l) => l.listener === listener);
    if (index >= 0)
      listeners.splice(index, 1);
    return this;
  }
  /**
   * Adds a one-time listener function for the event. The next time the event is triggered,
   * this listener is removed and then invoked.
   * @returns this MessageStream, so that calls can be chained
   */
  once(event, listener) {
    const listeners = __classPrivateFieldGet(this, _MessageStream_listeners, "f")[event] || (__classPrivateFieldGet(this, _MessageStream_listeners, "f")[event] = []);
    listeners.push({ listener, once: true });
    return this;
  }
  /**
   * This is similar to `.once()`, but returns a Promise that resolves the next time
   * the event is triggered, instead of calling a listener callback.
   * @returns a Promise that resolves the next time given event is triggered,
   * or rejects if an error is emitted.  (If you request the 'error' event,
   * returns a promise that resolves with the error).
   *
   * Example:
   *
   *   const message = await stream.emitted('message') // rejects if the stream errors
   */
  emitted(event) {
    return new Promise((resolve, reject) => {
      __classPrivateFieldSet(this, _MessageStream_catchingPromiseCreated, true, "f");
      if (event !== "error")
        this.once("error", reject);
      this.once(event, resolve);
    });
  }
  async done() {
    __classPrivateFieldSet(this, _MessageStream_catchingPromiseCreated, true, "f");
    await __classPrivateFieldGet(this, _MessageStream_endPromise, "f");
  }
  get currentMessage() {
    return __classPrivateFieldGet(this, _MessageStream_currentMessageSnapshot, "f");
  }
  /**
   * @returns a promise that resolves with the the final assistant Message response,
   * or rejects if an error occurred or the stream ended prematurely without producing a Message.
   */
  async finalMessage() {
    await this.done();
    return __classPrivateFieldGet(this, _MessageStream_instances, "m", _MessageStream_getFinalMessage).call(this);
  }
  /**
   * @returns a promise that resolves with the the final assistant Message's text response, concatenated
   * together if there are more than one text blocks.
   * Rejects if an error occurred or the stream ended prematurely without producing a Message.
   */
  async finalText() {
    await this.done();
    return __classPrivateFieldGet(this, _MessageStream_instances, "m", _MessageStream_getFinalText).call(this);
  }
  _emit(event, ...args) {
    if (__classPrivateFieldGet(this, _MessageStream_ended, "f"))
      return;
    if (event === "end") {
      __classPrivateFieldSet(this, _MessageStream_ended, true, "f");
      __classPrivateFieldGet(this, _MessageStream_resolveEndPromise, "f").call(this);
    }
    const listeners = __classPrivateFieldGet(this, _MessageStream_listeners, "f")[event];
    if (listeners) {
      __classPrivateFieldGet(this, _MessageStream_listeners, "f")[event] = listeners.filter((l) => !l.once);
      listeners.forEach(({ listener }) => listener(...args));
    }
    if (event === "abort") {
      const error = args[0];
      if (!__classPrivateFieldGet(this, _MessageStream_catchingPromiseCreated, "f") && !listeners?.length) {
        Promise.reject(error);
      }
      __classPrivateFieldGet(this, _MessageStream_rejectConnectedPromise, "f").call(this, error);
      __classPrivateFieldGet(this, _MessageStream_rejectEndPromise, "f").call(this, error);
      this._emit("end");
      return;
    }
    if (event === "error") {
      const error = args[0];
      if (!__classPrivateFieldGet(this, _MessageStream_catchingPromiseCreated, "f") && !listeners?.length) {
        Promise.reject(error);
      }
      __classPrivateFieldGet(this, _MessageStream_rejectConnectedPromise, "f").call(this, error);
      __classPrivateFieldGet(this, _MessageStream_rejectEndPromise, "f").call(this, error);
      this._emit("end");
    }
  }
  _emitFinal() {
    const finalMessage = this.receivedMessages.at(-1);
    if (finalMessage) {
      this._emit("finalMessage", __classPrivateFieldGet(this, _MessageStream_instances, "m", _MessageStream_getFinalMessage).call(this));
    }
  }
  async _fromReadableStream(readableStream, options) {
    const signal = options?.signal;
    let abortHandler;
    if (signal) {
      if (signal.aborted)
        this.controller.abort();
      abortHandler = this.controller.abort.bind(this.controller);
      signal.addEventListener("abort", abortHandler);
    }
    try {
      __classPrivateFieldGet(this, _MessageStream_instances, "m", _MessageStream_beginRequest).call(this);
      this._connected(null);
      const stream = Stream.fromReadableStream(readableStream, this.controller);
      for await (const event of stream) {
        __classPrivateFieldGet(this, _MessageStream_instances, "m", _MessageStream_addStreamEvent).call(this, event);
      }
      if (stream.controller.signal?.aborted) {
        throw new APIUserAbortError();
      }
      __classPrivateFieldGet(this, _MessageStream_instances, "m", _MessageStream_endRequest).call(this);
    } finally {
      if (signal && abortHandler) {
        signal.removeEventListener("abort", abortHandler);
      }
    }
  }
  [(_MessageStream_currentMessageSnapshot = /* @__PURE__ */ new WeakMap(), _MessageStream_connectedPromise = /* @__PURE__ */ new WeakMap(), _MessageStream_resolveConnectedPromise = /* @__PURE__ */ new WeakMap(), _MessageStream_rejectConnectedPromise = /* @__PURE__ */ new WeakMap(), _MessageStream_endPromise = /* @__PURE__ */ new WeakMap(), _MessageStream_resolveEndPromise = /* @__PURE__ */ new WeakMap(), _MessageStream_rejectEndPromise = /* @__PURE__ */ new WeakMap(), _MessageStream_listeners = /* @__PURE__ */ new WeakMap(), _MessageStream_ended = /* @__PURE__ */ new WeakMap(), _MessageStream_errored = /* @__PURE__ */ new WeakMap(), _MessageStream_aborted = /* @__PURE__ */ new WeakMap(), _MessageStream_catchingPromiseCreated = /* @__PURE__ */ new WeakMap(), _MessageStream_response = /* @__PURE__ */ new WeakMap(), _MessageStream_request_id = /* @__PURE__ */ new WeakMap(), _MessageStream_handleError = /* @__PURE__ */ new WeakMap(), _MessageStream_instances = /* @__PURE__ */ new WeakSet(), _MessageStream_getFinalMessage = function _MessageStream_getFinalMessage2() {
    if (this.receivedMessages.length === 0) {
      throw new AnthropicError("stream ended without producing a Message with role=assistant");
    }
    return this.receivedMessages.at(-1);
  }, _MessageStream_getFinalText = function _MessageStream_getFinalText2() {
    if (this.receivedMessages.length === 0) {
      throw new AnthropicError("stream ended without producing a Message with role=assistant");
    }
    const textBlocks = this.receivedMessages.at(-1).content.filter((block) => block.type === "text").map((block) => block.text);
    if (textBlocks.length === 0) {
      throw new AnthropicError("stream ended without producing a content block with type=text");
    }
    return textBlocks.join(" ");
  }, _MessageStream_beginRequest = function _MessageStream_beginRequest2() {
    if (this.ended)
      return;
    __classPrivateFieldSet(this, _MessageStream_currentMessageSnapshot, void 0, "f");
  }, _MessageStream_addStreamEvent = function _MessageStream_addStreamEvent2(event) {
    if (this.ended)
      return;
    const messageSnapshot = __classPrivateFieldGet(this, _MessageStream_instances, "m", _MessageStream_accumulateMessage).call(this, event);
    this._emit("streamEvent", event, messageSnapshot);
    switch (event.type) {
      case "content_block_delta": {
        const content = messageSnapshot.content.at(-1);
        switch (event.delta.type) {
          case "text_delta": {
            if (content.type === "text") {
              this._emit("text", event.delta.text, content.text || "");
            }
            break;
          }
          case "citations_delta": {
            if (content.type === "text") {
              this._emit("citation", event.delta.citation, content.citations ?? []);
            }
            break;
          }
          case "input_json_delta": {
            if (tracksToolInput(content) && content.input) {
              this._emit("inputJson", event.delta.partial_json, content.input);
            }
            break;
          }
          case "thinking_delta": {
            if (content.type === "thinking") {
              this._emit("thinking", event.delta.thinking, content.thinking);
            }
            break;
          }
          case "signature_delta": {
            if (content.type === "thinking") {
              this._emit("signature", content.signature);
            }
            break;
          }
          default:
            checkNever(event.delta);
        }
        break;
      }
      case "message_stop": {
        this._addMessageParam(messageSnapshot);
        this._addMessage(messageSnapshot, true);
        break;
      }
      case "content_block_stop": {
        this._emit("contentBlock", messageSnapshot.content.at(-1));
        break;
      }
      case "message_start": {
        __classPrivateFieldSet(this, _MessageStream_currentMessageSnapshot, messageSnapshot, "f");
        break;
      }
      case "content_block_start":
      case "message_delta":
        break;
    }
  }, _MessageStream_endRequest = function _MessageStream_endRequest2() {
    if (this.ended) {
      throw new AnthropicError(`stream has ended, this shouldn't happen`);
    }
    const snapshot = __classPrivateFieldGet(this, _MessageStream_currentMessageSnapshot, "f");
    if (!snapshot) {
      throw new AnthropicError(`request ended without sending any chunks`);
    }
    __classPrivateFieldSet(this, _MessageStream_currentMessageSnapshot, void 0, "f");
    return snapshot;
  }, _MessageStream_accumulateMessage = function _MessageStream_accumulateMessage2(event) {
    let snapshot = __classPrivateFieldGet(this, _MessageStream_currentMessageSnapshot, "f");
    if (event.type === "message_start") {
      if (snapshot) {
        throw new AnthropicError(`Unexpected event order, got ${event.type} before receiving "message_stop"`);
      }
      return event.message;
    }
    if (!snapshot) {
      throw new AnthropicError(`Unexpected event order, got ${event.type} before "message_start"`);
    }
    switch (event.type) {
      case "message_stop":
        return snapshot;
      case "message_delta":
        snapshot.stop_reason = event.delta.stop_reason;
        snapshot.stop_sequence = event.delta.stop_sequence;
        snapshot.usage.output_tokens = event.usage.output_tokens;
        if (event.usage.input_tokens != null) {
          snapshot.usage.input_tokens = event.usage.input_tokens;
        }
        if (event.usage.cache_creation_input_tokens != null) {
          snapshot.usage.cache_creation_input_tokens = event.usage.cache_creation_input_tokens;
        }
        if (event.usage.cache_read_input_tokens != null) {
          snapshot.usage.cache_read_input_tokens = event.usage.cache_read_input_tokens;
        }
        if (event.usage.server_tool_use != null) {
          snapshot.usage.server_tool_use = event.usage.server_tool_use;
        }
        return snapshot;
      case "content_block_start":
        snapshot.content.push({ ...event.content_block });
        return snapshot;
      case "content_block_delta": {
        const snapshotContent = snapshot.content.at(event.index);
        switch (event.delta.type) {
          case "text_delta": {
            if (snapshotContent?.type === "text") {
              snapshot.content[event.index] = {
                ...snapshotContent,
                text: (snapshotContent.text || "") + event.delta.text
              };
            }
            break;
          }
          case "citations_delta": {
            if (snapshotContent?.type === "text") {
              snapshot.content[event.index] = {
                ...snapshotContent,
                citations: [...snapshotContent.citations ?? [], event.delta.citation]
              };
            }
            break;
          }
          case "input_json_delta": {
            if (snapshotContent && tracksToolInput(snapshotContent)) {
              let jsonBuf = snapshotContent[JSON_BUF_PROPERTY] || "";
              jsonBuf += event.delta.partial_json;
              const newContent = { ...snapshotContent };
              Object.defineProperty(newContent, JSON_BUF_PROPERTY, {
                value: jsonBuf,
                enumerable: false,
                writable: true
              });
              if (jsonBuf) {
                newContent.input = partialParse(jsonBuf);
              }
              snapshot.content[event.index] = newContent;
            }
            break;
          }
          case "thinking_delta": {
            if (snapshotContent?.type === "thinking") {
              snapshot.content[event.index] = {
                ...snapshotContent,
                thinking: snapshotContent.thinking + event.delta.thinking
              };
            }
            break;
          }
          case "signature_delta": {
            if (snapshotContent?.type === "thinking") {
              snapshot.content[event.index] = {
                ...snapshotContent,
                signature: event.delta.signature
              };
            }
            break;
          }
          default:
            checkNever(event.delta);
        }
        return snapshot;
      }
      case "content_block_stop":
        return snapshot;
    }
  }, Symbol.asyncIterator)]() {
    const pushQueue = [];
    const readQueue = [];
    let done = false;
    this.on("streamEvent", (event) => {
      const reader = readQueue.shift();
      if (reader) {
        reader.resolve(event);
      } else {
        pushQueue.push(event);
      }
    });
    this.on("end", () => {
      done = true;
      for (const reader of readQueue) {
        reader.resolve(void 0);
      }
      readQueue.length = 0;
    });
    this.on("abort", (err) => {
      done = true;
      for (const reader of readQueue) {
        reader.reject(err);
      }
      readQueue.length = 0;
    });
    this.on("error", (err) => {
      done = true;
      for (const reader of readQueue) {
        reader.reject(err);
      }
      readQueue.length = 0;
    });
    return {
      next: async () => {
        if (!pushQueue.length) {
          if (done) {
            return { value: void 0, done: true };
          }
          return new Promise((resolve, reject) => readQueue.push({ resolve, reject })).then((chunk2) => chunk2 ? { value: chunk2, done: false } : { value: void 0, done: true });
        }
        const chunk = pushQueue.shift();
        return { value: chunk, done: false };
      },
      return: async () => {
        this.abort();
        return { value: void 0, done: true };
      }
    };
  }
  toReadableStream() {
    const stream = new Stream(this[Symbol.asyncIterator].bind(this), this.controller);
    return stream.toReadableStream();
  }
};
function checkNever(x) {
}

// src/pool/attempt.ts
var MAX_POOL_ATTEMPTS = 8;
var PoolAttemptError = class extends Error {
  constructor(code, committed, cause) {
    super(code);
    this.code = code;
    this.committed = committed;
    this.cause = cause;
  }
  code;
  committed;
  cause;
};
function meaningful(part) {
  return ["text-delta", "reasoning-delta"].includes(part.type) && Boolean(part.text) || part.type === "tool-input-delta" && Boolean(part.delta) || part.type === "tool-input-start" || part.type === "tool-call";
}
async function bounded(work, ms, signal, code) {
  signal.throwIfAborted();
  if (ms <= 0) throw new Error(code);
  let timer;
  let onAbort = () => {
  };
  const interrupted = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => reject(new Error(code)), Math.max(0, ms));
  });
  try {
    return await Promise.race([work, interrupted]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}
async function* runPoolAttempts(routes, signal, limits, retryable, onAttempt = () => {
}, onFailure = () => {
}) {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Invalid pool limit: " + name);
  }
  const deadline = Date.now() + limits.totalMs;
  let committed = false;
  let lastError;
  for (const route of routes.slice(0, limits.attempts)) {
    signal.throwIfAborted();
    if (Date.now() >= deadline) throw new PoolAttemptError("total-deadline", committed);
    const controller = new AbortController();
    const attemptSignal = AbortSignal.any([signal, controller.signal]);
    const firstDeadline = Math.min(deadline, Date.now() + limits.firstContentMs);
    let iterator;
    const buffered = [];
    let bytes = 0;
    let completed = false;
    let consumerThrew = false;
    let consumerError;
    let terminalThrown = false;
    onAttempt(route.id);
    try {
      const stream = await bounded(route.open(attemptSignal), firstDeadline - Date.now(), attemptSignal, "first-content-timeout");
      iterator = stream[Symbol.asyncIterator]();
      while (true) {
        const remaining = (committed ? Math.min(deadline, Date.now() + limits.idleMs) : firstDeadline) - Date.now();
        const next = await bounded(iterator.next(), remaining, attemptSignal, committed ? "idle-or-total-timeout" : "first-content-timeout");
        signal.throwIfAborted();
        if (next.done) throw new Error("missing-valid-finish");
        const part = next.value;
        if (part.type === "error") throw part.error ?? new Error("stream-error");
        const terminal = part.type === "finish";
        if (terminal && !["stop", "tool-calls", "length"].includes(part.finishReason ?? "")) throw new Error("invalid-finish");
        if (!committed) {
          bytes += Buffer.byteLength(JSON.stringify(part));
          if (bytes > limits.bufferBytes) throw new Error("provisional-buffer-limit");
          buffered.push(part);
          if (!meaningful(part) && !terminal) continue;
          committed = true;
          for (const pending of buffered) {
            signal.throwIfAborted();
            try {
              yield pending;
            } catch (error) {
              consumerThrew = true;
              consumerError = error;
              throw error;
            }
          }
          buffered.length = 0;
        } else {
          try {
            yield part;
          } catch (error) {
            consumerThrew = true;
            consumerError = error;
            throw error;
          }
        }
        if (terminal) {
          completed = true;
          return;
        }
      }
    } catch (error) {
      if (consumerThrew) {
        terminalThrown = true;
        throw consumerError;
      }
      lastError = error;
      if (!signal.aborted) await onFailure(route.id, error, committed);
      if (signal.aborted) {
        terminalThrown = true;
        throw signal.reason;
      }
      if (committed || !retryable(error)) {
        terminalThrown = true;
        throw new PoolAttemptError("attempt-failed", committed, error);
      }
    } finally {
      controller.abort();
      if (iterator?.return) {
        try {
          await bounded(iterator.return(), limits.cleanupMs, new AbortController().signal, "cleanup-timeout");
        } catch {
          if (!completed && !consumerThrew && !terminalThrown && !signal.aborted) {
            throw new PoolAttemptError("cleanup-failed", committed, lastError);
          }
        }
      }
    }
  }
  throw new PoolAttemptError("attempt-budget-exhausted", committed, lastError);
}

// src/pool/errors.ts
function poolFailure(error, now = Date.now()) {
  const value = error;
  if (value?.name === "AbortError" || value?.code === "ABORT_ERR") return { kind: "canceled" };
  const status = value?.statusCode;
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
  if ([401, 403, 404].includes(status ?? 0)) return { kind: "access", status };
  if (status === 400 && /context.{0,20}(length|window|exceed)|prompt.{0,20}too long/i.test(value?.message ?? "")) return { kind: "context", status };
  if (status === 400 || status === 422) return { kind: "invalid", status };
  if (status !== void 0 && status >= 500 || /ECONNRESET|ETIMEDOUT|ENOTFOUND|first-content-timeout|missing-valid-finish|invalid-finish|stream-error|Pool route entered cooldown/.test(value?.message ?? "")) return { kind: "transient", status };
  return { kind: "unknown", status };
}
function retryPoolFailure(error) {
  return poolFailure(error).kind !== "canceled";
}

// src/pool/eligibility.ts
function poolRouteIdentity(route) {
  return JSON.stringify([route.member.providerId, route.revision, route.member.modelId]);
}
function evaluatePoolMembers(pool, evidence, request) {
  return pool.members.map((member) => {
    const matches = evidence.filter((route2) => route2.member.providerId === member.providerId && route2.member.modelId === member.modelId);
    if (matches.length !== 1) return { member, reason: matches.length ? "ambiguous-route" : "unavailable" };
    const route = matches[0];
    const effort = request.effort ?? pool.effort;
    let reason;
    if (!route.revision) reason = "unverified-endpoint";
    else if (!route.catalogVerified) reason = "unverified-catalog";
    else if (route.freeStatus !== "verified_free") reason = "not-free";
    else if (!route.billingSafe) reason = "billing-risk";
    else if (!route.accessVerified) reason = "unverified-access";
    else if (!route.targets.includes(request.target)) reason = "unsupported-target";
    else if (request.tools && !route.toolsVerified) reason = "unverified-tools";
    else if (effort === "auto" ? !route.defaultEffortVerified : !route.effortLevels.includes(effort)) reason = "unsupported-effort";
    else if (!route.contextVerified) reason = "unverified-context";
    else if (!route.contextFits) reason = "context-limit";
    else if (route.unavailableUntil !== void 0 && (!Number.isFinite(route.unavailableUntil) || route.unavailableUntil > request.now)) reason = "cooldown";
    return { member, route, ...reason ? { reason } : {} };
  });
}

// src/pool/dispatch.ts
var SIMULATED_COOLDOWN_MS = 6e4;
var SIMULATED_FAILURE_MESSAGE = "Simulated failure (RELAY_POOL_FORCE_FAIL)";
async function* dispatchFreePool(pool, routes, request, policy) {
  const candidates = evaluatePoolMembers(pool, routes, { ...request, now: Date.now() });
  const eligible = candidates.filter((candidate) => !candidate.reason && candidate.route);
  if (!eligible.length) {
    throw new Error("No eligible free pool members: " + candidates.map((candidate) => candidate.member.providerId + "/" + candidate.member.modelId + ": " + candidate.reason).join("; "));
  }
  const attempts = eligible.map((candidate) => {
    const route = routes.find((item) => candidate.route && poolRouteIdentity(item) === poolRouteIdentity(candidate.route));
    if (!route) throw new Error("Pool route changed during admission");
    const forced = forcedFailures().has(route.member.providerId + "/" + route.member.modelId);
    const open2 = forced ? async () => {
      await route.recordFailure?.({ kind: "transient", retryAt: Date.now() + SIMULATED_COOLDOWN_MS });
      throw Object.assign(new Error(SIMULATED_FAILURE_MESSAGE), { statusCode: 429 });
    } : route.open;
    return { id: poolRouteIdentity(route), open: open2 };
  });
  const session = policy.sessions?.begin(request.conversationScope, attempts);
  let activeRoute;
  yield* runPoolAttempts(session?.routes ?? attempts, request.signal, policy.limits, policy.retryable, (id) => {
    activeRoute = id;
    policy.onAttempt?.(id);
  }, policy.onFailure);
  if (activeRoute) session?.succeed(activeRoute);
}

// src/pool/claude-runtime.ts
var CLAUDE_POOL_MODEL_ID = "claude-pool";
function defaultRetryable(error) {
  const raw = error instanceof Error ? error.message : "";
  const message = formatUpstreamError(error) + " " + raw;
  const status = upstreamHttpStatus(error, message);
  return status === 429 || status >= 500 || /ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed/i.test(message);
}
function protocolStatus(error) {
  const message = formatUpstreamError(error);
  const status = upstreamHttpStatus(error, message);
  return { status, error: { type: anthropicErrorType(status), message } };
}
function sseError(error) {
  return "event: error\ndata: " + JSON.stringify({ type: "error", error }) + "\n\n";
}
async function collectMessage(parts, model, maxBytes) {
  const lines = [];
  let bytes = 0;
  let sawError = false;
  await writeAnthropicStream(parts, model, (chunk) => {
    if (chunk.includes("event: error")) sawError = true;
    bytes += Buffer.byteLength(chunk, "utf8");
    if (bytes > maxBytes) throw new Error("nonstream-output-limit");
    for (const line of chunk.split("\n")) if (line.startsWith("data: {")) lines.push(line.slice(6));
  });
  if (sawError) throw new Error("provider error during nonstream aggregation");
  const encoded = new TextEncoder().encode(lines.join("\n") + "\n");
  const stream = MessageStream.fromReadableStream(new ReadableStream({
    start(controller) {
      controller.enqueue(encoded);
      controller.close();
    }
  }));
  return await stream.finalMessage();
}
async function serveClaudePool(options) {
  const state = { requestId: randomUUID().slice(0, 8), served: false, started: Date.now() };
  const result = await serveClaudePoolRequest(options, state);
  if (!result.ok && !state.served) {
    recordPoolActivity({ target: "claude", event: "gave-up", providerId: "pool", modelId: "none", requestId: state.requestId, ms: Date.now() - state.started });
  }
  return result;
}
async function serveClaudePoolRequest(options, state) {
  const { pool, routes, request, limits, write, embargo, scope } = options;
  let owner;
  if (embargo && scope) {
    const claim = embargo.claim(scope.value, scope.historyFingerprint);
    if (claim.kind !== "owner") {
      return {
        ok: false,
        status: 429,
        committed: false,
        error: { type: "rate_limit_error", message: claim.kind === "busy" ? "A matching request is already in flight" : "A matching request recently failed" }
      };
    }
    owner = claim;
  }
  let attemptedId;
  let attemptStarted = Date.now();
  const logServed = () => {
    const member = attemptedId ? poolRouteMember(attemptedId) : void 0;
    if (!member) return;
    state.served = true;
    recordPoolActivity({ target: "claude", event: "served", ...member, requestId: state.requestId, ms: Date.now() - attemptStarted });
    options.trace?.(`pool answered: ${member.providerId}/${member.modelId} in ${((Date.now() - attemptStarted) / 1e3).toFixed(1)}s`);
  };
  options.trace?.(`pool request: ${routes.length} eligible member(s): ${routes.map((route) => `${route.member.providerId}/${route.member.modelId}`).join(", ") || "none"}`);
  const parts = dispatchFreePool(pool, routes, {
    target: "claude",
    tools: true,
    effort: request.effort,
    signal: request.signal
  }, {
    limits,
    retryable: options.retryable ?? defaultRetryable,
    onAttempt: (id) => {
      attemptedId = id;
      attemptStarted = Date.now();
      const member = poolRouteMember(id);
      if (member) options.trace?.(`pool attempt: ${member.providerId}/${member.modelId}`);
    },
    onFailure: (id, error) => {
      const member = poolRouteMember(id);
      if (!member) return;
      const reason = describePoolFailure(error);
      const detail = reason.startsWith("simulated") ? void 0 : poolErrorDetail(error);
      recordPoolActivity({ target: "claude", event: "failed", ...member, requestId: state.requestId, reason, ...detail ? { detail } : {}, ms: Date.now() - attemptStarted });
      options.trace?.(`pool failed: ${member.providerId}/${member.modelId} (${reason}) after ${((Date.now() - attemptStarted) / 1e3).toFixed(1)}s${detail ? ": " + detail : ""}`);
    }
  });
  try {
    if (!request.stream) {
      const message = await collectMessage(parts, request.modelId, request.maxOutputBytes ?? 65536);
      logServed();
      owner?.kind === "owner" && owner.release();
      return { ok: true, message };
    }
    if (!write) throw new Error("stream-write-sink-required");
    let committed = false;
    let sawError = false;
    try {
      await writeAnthropicStream(parts, request.modelId, (chunk) => {
        if (chunk.includes("event: error")) sawError = true;
        if (chunk.startsWith("event: message_start") || chunk.startsWith("event: content_block")) committed = true;
        write(chunk);
      }, void 0, request.estimatedInputTokens ?? 0);
    } catch (error) {
      const mapped = protocolStatus(error);
      if (!committed) {
        owner?.kind === "owner" && owner.fail();
        return { ok: false, ...mapped, committed: false };
      }
      if (!sawError) write(sseError(mapped.error));
      owner?.kind === "owner" && owner.fail();
      return { ok: false, ...mapped, committed: true };
    }
    if (sawError) {
      owner?.kind === "owner" && owner.fail();
      return { ok: false, status: 502, committed, error: { type: "api_error", message: "Provider failed after response commitment" } };
    }
    logServed();
    owner?.kind === "owner" && owner.release();
    return { ok: true };
  } catch (error) {
    owner?.kind === "owner" && owner.fail();
    return { ok: false, ...protocolStatus(error), committed: false };
  }
}
var ClaudePoolRuntime = class {
  constructor(pool, prepare, limits = {
    attempts: MAX_POOL_ATTEMPTS,
    firstContentMs: 2e4,
    idleMs: 2e4,
    totalMs: 6e4,
    bufferBytes: 65536,
    cleanupMs: 1e3
  }) {
    this.pool = pool;
    this.prepare = prepare;
    this.limits = limits;
  }
  pool;
  prepare;
  limits;
  async serve(body, write, signal, sessionId, trace) {
    const routes = await this.prepare(body, signal, sessionId);
    const effort = "auto";
    return serveClaudePool({
      pool: this.pool,
      routes,
      request: {
        modelId: String(body.model ?? CLAUDE_POOL_MODEL_ID),
        stream: body.stream === true,
        signal,
        effort
      },
      limits: this.limits,
      write,
      trace,
      retryable: retryPoolFailure
    });
  }
};

// src/proxy.ts
import { createServer } from "http";
import { appendFileSync, openSync, writeSync, closeSync } from "fs";

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
function formatAnthropicModelEntry(id, displayName, contextWindow, options) {
  const maxInput = resolveContextWindow(id, contextWindow);
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
function formatAnthropicModelList(entries) {
  return {
    data: entries.map((entry) => formatAnthropicModelEntry(
      entry.id,
      entry.name,
      entry.contextWindow,
      { supportsOneM: entry.supportsOneM }
    )),
    has_more: false,
    first_id: entries[0]?.id ?? null,
    last_id: entries.at(-1)?.id ?? null
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
import { randomUUID as randomUUID2 } from "crypto";
var DEFAULT_SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" }
];
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
    requestId: randomUUID2(),
    model: realModelId,
    userAgent: ANTIGRAVITY_USER_AGENT,
    requestType: "agent",
    enabledCreditTypes: ["GOOGLE_ONE_AI"],
    request
  };
}

// src/antigravity/cloudcode-to-anthropic.ts
import { randomUUID as randomUUID3 } from "crypto";
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
    messageId: `msg_${randomUUID3().replace(/-/g, "").slice(0, 24)}`,
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
            const rawToolId = `toolu_${randomUUID3().replace(/-/g, "").slice(0, 16)}`;
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
  const messageId = `msg_${randomUUID3().replace(/-/g, "").slice(0, 24)}`;
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
        const rawToolId = `toolu_${randomUUID3().replace(/-/g, "").slice(0, 16)}`;
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
  const isNumberedAccount = providerKind(sanitized) !== sanitized;
  if (realId.startsWith("claude-") && !sanitized.startsWith("custom-") && sanitized !== "vertex-anthropic" && !isNumberedAccount) return realId;
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
function startProxyCatalog(routes, defaultAliasId, debug = false, options = {}) {
  const proxyToken = randomUUID4();
  silenceSdkWarnings();
  if (routes.length === 0 && !options.pool) {
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
  const catalogEntries = routes.map((r) => ({ id: r.aliasId, name: r.displayName, contextWindow: r.contextWindow }));
  if (options.pool) catalogEntries.push({
    id: CLAUDE_POOL_MODEL_ID,
    name: options.pool.displayName,
    contextWindow: options.pool.contextWindow
  });
  const modelsPayload = JSON.stringify(formatAnthropicModelList(catalogEntries));
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
        if (options.pool && routeLookupIds(id).includes(CLAUDE_POOL_MODEL_ID)) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(formatAnthropicModelEntry(CLAUDE_POOL_MODEL_ID, options.pool.displayName, options.pool.contextWindow)));
          return;
        }
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
      if (options.pool && (originalModel === CLAUDE_POOL_MODEL_ID || routeLookupIds(String(originalModel)).includes(CLAUDE_POOL_MODEL_ID))) {
        const abort = new AbortController();
        res.once("close", () => {
          if (!res.writableFinished) abort.abort();
        });
        try {
          const sessionId = extractConversationId(req.headers, anthropicBody);
          const result = await options.pool.runtime.serve(anthropicBody, (chunk) => {
            if (res.destroyed) throw new Error("Client disconnected");
            if (!res.headersSent) {
              res.writeHead(200, {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive"
              });
            }
            res.write(chunk);
          }, abort.signal, sessionId, (line) => plog(() => line));
          if (result.ok) {
            if (result.message) sendJson(res, 200, result.message);
            else res.end();
          } else if (result.committed) {
            res.end();
          } else {
            anthropicError(res, result.status, result.error.message);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!res.headersSent) anthropicError(res, 502, message);
          else if (!res.writableEnded) res.end();
        }
        return;
      }
      const correlatedRoute = correlatedSubagent ? routes.find((candidate) => (candidate.gatewayAliasId ?? candidate.aliasId) === correlatedSubagent.modelId) : void 0;
      const route = correlatedRoute ?? lookupRoute(byAlias, originalModel) ?? defaultRoute;
      if (!route) {
        anthropicError(res, 404, "Model not found");
        return;
      }
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
          if (route.providerId && isProviderKind(route.providerId, "claude-code")) injectClaudeCodeBillingSystemLine(forwardBody);
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
            sessionId,
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
            "User-Agent": ANTIGRAVITY_USER_AGENT
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
      plog(() => `started on port ${addr.port}, catalog=${routes.length} model(s), default=${defaultRoute?.aliasId ?? defaultAliasId}`);
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
function startProxy(completionsUrl, modelId, debug = false, contextWindow, sdk, apiKey) {
  const bareModelId = stripOneMContextSuffix(modelId);
  const clientModelId = claudeCodeClientModelId(modelId, contextWindow);
  return startProxyCatalog([{
    aliasId: clientModelId,
    realModelId: sdk?.upstreamModelId ?? bareModelId,
    displayName: bareModelId,
    upstreamUrl: completionsUrl,
    apiKey: apiKey ?? "",
    modelFormat: sdk?.modelFormat ?? "openai",
    contextWindow,
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

// src/pool/codex-retry.ts
import { createHash } from "crypto";
var DEFAULT_LIMITS = {
  ttlMs: 6e4,
  maxEntries: 128,
  maxResponseBytes: 2 * 1024 * 1024
};
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const record = value;
  return "{" + Object.keys(record).sort().map((key) => JSON.stringify(key) + ":" + canonical(record[key])).join(",") + "}";
}
function requestFingerprint(request) {
  return createHash("sha256").update(canonical(request)).digest("hex");
}
function checkLimit(name, value) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Invalid retry limit: " + name);
}
var CodexRetryGuard = class {
  constructor(limits = {}, now = Date.now) {
    this.now = now;
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    for (const [name, value] of Object.entries(this.limits)) checkLimit(name, value);
  }
  now;
  entries = /* @__PURE__ */ new Map();
  limits;
  /**
   * Claims one request operation. turnId must be the observed client turn;
   * fingerprint must hash the full translated request.
   */
  acquire(turnId, fingerprint) {
    if (!turnId || !fingerprint) throw new Error("turn-id-and-fingerprint-required");
    this.prune();
    const key = JSON.stringify([turnId, fingerprint]);
    const existing = this.entries.get(key);
    if (existing) {
      if (existing.status === "active") return { kind: "busy" };
      if (existing.status === "failed") return { kind: "blocked", reason: existing.reason ?? "previous-attempt-failed" };
      return { kind: "replay", response: existing.response };
    }
    if (this.entries.size >= this.limits.maxEntries) {
      return { kind: "blocked", reason: "retry-guard-capacity" };
    }
    const entry = { status: "active", token: /* @__PURE__ */ Symbol(), expires: this.now() + this.limits.ttlMs };
    this.entries.set(key, entry);
    const settle = (token) => this.entries.get(key)?.token === token;
    return {
      kind: "owner",
      complete: (response) => {
        if (!settle(entry.token)) return;
        if (typeof response !== "string" || Buffer.byteLength(response, "utf8") > this.limits.maxResponseBytes) {
          this.entries.set(key, { status: "failed", token: entry.token, expires: this.now() + this.limits.ttlMs, reason: "response-too-large" });
          return;
        }
        this.entries.set(key, { status: "succeeded", token: entry.token, expires: this.now() + this.limits.ttlMs, response });
      },
      fail: (reason, postcommit = false) => {
        if (!settle(entry.token)) return;
        this.entries.set(key, {
          status: "failed",
          token: entry.token,
          expires: this.now() + this.limits.ttlMs,
          reason: reason || "previous-attempt-failed",
          postcommit
        });
      },
      release: () => {
        if (settle(entry.token)) this.entries.delete(key);
      }
    };
  }
  prune() {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.status !== "active" && entry.expires <= now) this.entries.delete(key);
    }
  }
};

// src/pool/codex-identity.ts
var MAX_METADATA_BYTES = 8192;
function objectMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return void 0;
  return value;
}
function parseMetadata(value) {
  if (typeof value !== "string" || Buffer.byteLength(value) > MAX_METADATA_BYTES) return void 0;
  try {
    return objectMetadata(JSON.parse(value));
  } catch {
    return void 0;
  }
}
function identityFrom(metadata) {
  if (!metadata) return void 0;
  const valid = (value) => typeof value === "string" && value.length > 0 && value.length <= 256;
  if (!valid(metadata.session_id) || !valid(metadata.thread_id) || !valid(metadata.turn_id)) return void 0;
  const agent = metadata.agent_name;
  if (agent !== void 0 && !valid(agent)) return void 0;
  const conversation = JSON.stringify([metadata.session_id, metadata.thread_id, agent ?? ""]);
  return { conversation, turn: JSON.stringify([conversation, metadata.turn_id]) };
}
function codexPoolIdentity(headers, body) {
  const header = parseMetadata(headers["x-codex-turn-metadata"]);
  const client = objectMetadata(body?.client_metadata);
  const embedded = parseMetadata(client?.["x-codex-turn-metadata"]);
  for (const candidate of [embedded, client, header]) {
    const identity = identityFrom(candidate);
    if (identity) return identity;
  }
  return void 0;
}

// src/codex-responses-adapter.ts
import { createHash as createHash2 } from "crypto";
import { streamText, tool, jsonSchema } from "ai";
function createCodexToolContext() {
  return { namespaceByFlatName: /* @__PURE__ */ new Map(), customToolNames: /* @__PURE__ */ new Set() };
}
var TOOL_SEARCH_NAME = "tool_search";
var MAX_MODEL_TOOL_NAME_LENGTH = 64;
var TOOL_NAME_DIGEST_LENGTH = 10;
function flatNamespaceName(namespace, name) {
  const flat = `${namespace}__${name}`;
  if (flat.length <= MAX_MODEL_TOOL_NAME_LENGTH) return flat;
  const digest = createHash2("sha256").update(flat).digest("hex").slice(0, TOOL_NAME_DIGEST_LENGTH);
  const prefixLength = MAX_MODEL_TOOL_NAME_LENGTH - digest.length - 2;
  return `${flat.slice(0, prefixLength)}__${digest}`;
}
function ingestToolDefs(tools, ctx) {
  for (const t of tools ?? []) {
    if (!t || typeof t !== "object") continue;
    if (t.type === "namespace") {
      for (const sub of t.tools ?? []) {
        if (sub?.type === "custom" && sub.name) {
          ctx.customToolNames.add(sub.name);
        } else if (sub?.type === "function" && sub.name) {
          ctx.namespaceByFlatName.set(flatNamespaceName(t.name, sub.name), {
            namespace: t.name,
            name: sub.name,
            parameters: sub.parameters
          });
        }
      }
    } else if (t.type === "custom" && t.name) {
      ctx.customToolNames.add(t.name);
    }
  }
}
function flattenNamespaceTools(ns) {
  return (ns.tools ?? []).filter((sub) => (sub?.type === "function" || sub?.type === "custom") && !!sub.name).map((sub) => sub.type === "custom" ? sub : { ...sub, name: flatNamespaceName(ns.name, sub.name) });
}
function liftAdditionalToolsInput(input, tools) {
  let lifted = [];
  const keptInput = [];
  let changed = false;
  for (const item of input) {
    if (item && item.type === "additional_tools") {
      changed = true;
      if (Array.isArray(item.tools)) lifted = lifted.concat(item.tools);
      if (item.content !== void 0) {
        keptInput.push({ role: item.role ?? "developer", content: item.content });
      }
      continue;
    }
    keptInput.push(item);
  }
  if (!changed) return { input, tools };
  return { input: keptInput, tools: lifted.length ? [...tools, ...lifted] : tools };
}
function messageText(content) {
  if (typeof content === "string") return content;
  return (content ?? []).map((p8) => p8.type === "output_text" || p8.type === "input_text" || p8.type === "text" ? p8.text ?? "" : "").join("");
}
function messageContent(content) {
  if (typeof content === "string") return content;
  const parts = (content ?? []).flatMap((part) => {
    if (part.type === "output_text" || part.type === "input_text" || part.type === "text") {
      return typeof part.text === "string" ? [{ type: "text", text: part.text }] : [];
    }
    if (part.type === "input_image" && typeof part.image_url === "string" && part.image_url.trim()) {
      return [{ type: "image", image: part.image_url }];
    }
    return [];
  });
  return parts.length > 0 ? parts : [{ type: "text", text: "" }];
}
function splitToolOutputImages(output) {
  if (!Array.isArray(output)) return { content: serializeToolResultContent(output), images: [] };
  const images = [];
  const rest = [];
  for (const part of output) {
    const record = part && typeof part === "object" ? part : void 0;
    const imageUrl = record?.["type"] === "input_image" ? record["image_url"] : void 0;
    if (typeof imageUrl === "string" && imageUrl.trim()) images.push(imageUrl);
    else rest.push(part);
  }
  if (images.length === 0) return { content: serializeToolResultContent(output), images };
  return {
    content: rest.length > 0 ? serializeToolResultContent(rest) : "[image attached in the following message]",
    images
  };
}
function extractDeveloperAndInstructions(items2, instructions) {
  const developerParts = [];
  const remaining = [];
  for (const item of items2) {
    if ("role" in item && item.role === "developer") {
      const text4 = messageText(item.content);
      if (text4.trim()) developerParts.push(text4.trim());
    } else {
      remaining.push(item);
    }
  }
  const parts = [...developerParts];
  if (instructions?.trim()) parts.push(instructions.trim());
  const system = parts.length ? parts.join("\n") : void 0;
  return { system, remaining };
}
function annotateToolNamesFromCalls(items2) {
  const nameByCallId = /* @__PURE__ */ new Map();
  for (const item of items2) {
    if (item.type === "function_call") {
      const { rawId } = splitToolUseId(item.call_id);
      nameByCallId.set(rawId, item.namespace ? flatNamespaceName(item.namespace, item.name) : item.name);
    } else if (item.type === "tool_search_call") {
      const { rawId } = splitToolUseId(item.call_id);
      nameByCallId.set(rawId, TOOL_SEARCH_NAME);
    } else if (item.type === "custom_tool_call") {
      const { rawId } = splitToolUseId(item.call_id);
      nameByCallId.set(rawId, item.name);
    }
  }
  return nameByCallId;
}
function customToolInputFromArgs(name, args) {
  if (typeof args === "string") {
    const trimmed = args.trim();
    if (name === "apply_patch" && trimmed.startsWith("*** Begin Patch")) return args;
    try {
      return customToolInputFromArgs(name, JSON.parse(trimmed));
    } catch {
      return args;
    }
  }
  if (args && typeof args === "object") {
    const obj = args;
    if (Array.isArray(obj.command) && obj.command[0] === "apply_patch" && typeof obj.command[1] === "string") {
      return obj.command[1];
    }
    if (typeof obj.input === "string") return obj.input;
    for (const v of Object.values(obj)) {
      if (typeof v === "string") return v;
    }
  }
  return serializeToolResultContent(args);
}
function mergeConsecutiveMessages(messages) {
  if (messages.length <= 1) return messages;
  const out = [];
  for (const msg of messages) {
    const prev = out[out.length - 1];
    if (prev && prev.role === msg.role) {
      const prevContent = Array.isArray(prev.content) ? prev.content : [{ type: "text", text: String(prev.content ?? "") }];
      const msgContent = Array.isArray(msg.content) ? msg.content : [{ type: "text", text: String(msg.content ?? "") }];
      prev.content = [...prevContent, ...msgContent];
    } else {
      out.push(msg);
    }
  }
  return out;
}
function ensureUserFirst(messages) {
  if (messages.length === 0) return [{ role: "user", content: [{ type: "text", text: "(empty input)" }] }];
  if (messages[0].role === "assistant") {
    return [{ role: "user", content: [{ type: "text", text: "(conversation continued)" }] }, ...messages];
  }
  return messages;
}
function reasoningSummaryText(item) {
  return (item.summary ?? []).map((part) => part.type === "summary_text" ? part.text ?? "" : "").join("");
}
function makeReasoningOutputItem(id, text4) {
  return {
    id,
    type: "reasoning",
    summary: text4.trim() ? [{ type: "summary_text", text: text4 }] : []
  };
}
function translateResponsesInput(input, instructions, npm, toolContext = createCodexToolContext()) {
  if (typeof input === "string") {
    return {
      instructions: instructions?.trim() || void 0,
      messages: [{ role: "user", content: [{ type: "text", text: input }] }],
      deferredTools: []
    };
  }
  const { system, remaining } = extractDeveloperAndInstructions(input, instructions);
  const toolNames = annotateToolNamesFromCalls(remaining);
  const messages = [];
  const deferredTools = [];
  let pendingReasoning = "";
  for (const item of remaining) {
    if (item.type === "reasoning") {
      pendingReasoning += reasoningSummaryText(item);
      continue;
    }
    if (item.type === "function_call") {
      const { rawId, thoughtSignature } = splitToolUseId(item.call_id);
      const parts = [];
      if (pendingReasoning.trim()) {
        parts.push({ type: "reasoning", text: pendingReasoning });
        pendingReasoning = "";
      }
      const toolPart = {
        type: "tool-call",
        toolCallId: rawId,
        toolName: item.namespace ? flatNamespaceName(item.namespace, item.name) : item.name,
        input: parseToolArguments(item.arguments)
      };
      if (thoughtSignature && npm === "@ai-sdk/google") {
        toolPart.providerOptions = { google: { thoughtSignature } };
      }
      parts.push(toolPart);
      messages.push({ role: "assistant", content: parts });
    } else if (item.type === "function_call_output") {
      const { rawId } = splitToolUseId(item.call_id);
      const toolName = toolNames.get(rawId) ?? "unknown";
      const { content, images } = splitToolOutputImages(item.output);
      messages.push({
        role: "tool",
        content: [{
          type: "tool-result",
          toolCallId: rawId,
          toolName,
          output: { type: "text", value: content }
        }]
      });
      if (images.length > 0) {
        messages.push({
          role: "user",
          content: [
            { type: "text", text: `Image${images.length > 1 ? "s" : ""} returned by ${toolName} (${rawId}):` },
            ...images.map((image) => ({ type: "image", image }))
          ]
        });
      }
    } else if (item.type === "tool_search_call") {
      const { rawId, thoughtSignature } = splitToolUseId(item.call_id);
      const parts = [];
      if (pendingReasoning.trim()) {
        parts.push({ type: "reasoning", text: pendingReasoning });
        pendingReasoning = "";
      }
      parts.push({
        type: "tool-call",
        toolCallId: rawId,
        toolName: TOOL_SEARCH_NAME,
        input: parseToolArguments(item.arguments),
        ...thoughtSignature && npm === "@ai-sdk/google" ? { providerOptions: { google: { thoughtSignature } } } : {}
      });
      messages.push({ role: "assistant", content: parts });
    } else if (item.type === "tool_search_output") {
      const { rawId } = splitToolUseId(item.call_id);
      const surfacedTools = item.tools ?? [];
      ingestToolDefs(surfacedTools, toolContext);
      for (const t of surfacedTools) {
        if (t.type === "namespace") deferredTools.push(...flattenNamespaceTools(t));
        else if (t.type === "function" || t.type === "custom") deferredTools.push(t);
      }
      messages.push({
        role: "tool",
        content: [{
          type: "tool-result",
          toolCallId: rawId,
          toolName: TOOL_SEARCH_NAME,
          output: { type: "text", value: serializeToolResultContent(surfacedTools) }
        }]
      });
    } else if (item.type === "custom_tool_call") {
      const { rawId, thoughtSignature } = splitToolUseId(item.call_id);
      const parts = [];
      if (pendingReasoning.trim()) {
        parts.push({ type: "reasoning", text: pendingReasoning });
        pendingReasoning = "";
      }
      parts.push({
        type: "tool-call",
        toolCallId: rawId,
        toolName: item.name,
        input: { input: typeof item.input === "string" ? item.input : serializeToolResultContent(item.input) },
        ...thoughtSignature && npm === "@ai-sdk/google" ? { providerOptions: { google: { thoughtSignature } } } : {}
      });
      messages.push({ role: "assistant", content: parts });
    } else if (item.type === "custom_tool_call_output") {
      const { rawId } = splitToolUseId(item.call_id);
      messages.push({
        role: "tool",
        content: [{
          type: "tool-result",
          toolCallId: rawId,
          toolName: toolNames.get(rawId) ?? "unknown",
          output: { type: "text", value: serializeToolResultContent(item.output) }
        }]
      });
    } else if (item.type === "agent_message") {
      const text4 = messageText(item.content);
      if (text4.trim()) {
        messages.push({ role: "user", content: [{ type: "text", text: text4 }] });
      }
    } else if (item.type === "compaction" || item.type === "context_compaction") {
      const summary = decodeCompactionContent(item.encrypted_content) ?? "";
      if (summary.trim()) {
        messages.push({ role: "user", content: [{ type: "text", text: `[Summary of earlier conversation]
${summary}` }] });
      }
    } else if ("role" in item) {
      const role = item.role === "assistant" ? "assistant" : "user";
      const content = messageContent(item.content);
      messages.push({ role, content });
    }
  }
  return {
    instructions: system,
    messages: ensureUserFirst(mergeConsecutiveMessages(messages)),
    deferredTools
  };
}
var TOOL_SEARCH_DESCRIPTION = "Search the available deferred Codex tools, plugin tools, MCP namespaces, and connectors by query. Use this when a needed tool is not already present in the current tool list. Returns matching tool definitions for a follow-up call.";
var TOOL_SEARCH_PARAMETERS = {
  type: "object",
  properties: {
    query: { type: "string", description: "Search query describing the tool or capability needed." },
    limit: { type: "number", description: "Maximum number of matching tools to return. Defaults to 8." }
  },
  required: ["query"],
  additionalProperties: false
};
var CUSTOM_TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: { input: { type: "string", description: "Freeform input for this custom tool (e.g. a patch body)." } },
  required: ["input"],
  additionalProperties: false
};
function translateResponsesTools(tools, options = {}) {
  if (!tools?.length) return void 0;
  const out = {};
  let toolCount = 0;
  const addTool = (name, description, parameters) => {
    if (options.maxTools !== void 0 && toolCount >= options.maxTools) return;
    out[name] = tool({
      description: description ?? "",
      inputSchema: jsonSchema(normalizeToolSchemaForNpm(parameters ?? { type: "object", properties: {} }, options.npm))
    });
    toolCount++;
  };
  for (const t of tools) {
    if (!t || typeof t !== "object") continue;
    if (t.type === "namespace") {
      for (const nested of t.tools ?? []) {
        if (!nested.name) continue;
        if (nested.type === "custom") {
          addTool(nested.name, nested.description, CUSTOM_TOOL_INPUT_SCHEMA);
        } else if (nested.type === "function") {
          addTool(flatNamespaceName(t.name, nested.name), nested.description, nested.parameters);
        }
      }
      continue;
    }
    if (t.type === "custom") {
      if (!t.name) continue;
      addTool(t.name, t.description, CUSTOM_TOOL_INPUT_SCHEMA);
      continue;
    }
    if (t.type === "tool_search") {
      addTool(TOOL_SEARCH_NAME, TOOL_SEARCH_DESCRIPTION, TOOL_SEARCH_PARAMETERS);
      continue;
    }
    if (t.type !== "function" || !t.name) continue;
    addTool(t.name, t.description, t.parameters);
  }
  return Object.keys(out).length ? out : void 0;
}
function omitsMaxOutputTokens(metadata) {
  return metadata?.providerId !== void 0 && isProviderKind(metadata.providerId, "openrouter") || (metadata?.apiBaseUrl?.includes("openrouter.ai") ?? false);
}
function translateResponsesRequest(body, npm, metadata, options = {}) {
  const toolContext = createCodexToolContext();
  let effectiveTools = body.tools ?? [];
  let effectiveInput = body.input;
  if (Array.isArray(effectiveInput)) {
    const lifted = liftAdditionalToolsInput(effectiveInput, effectiveTools);
    effectiveInput = lifted.input;
    effectiveTools = lifted.tools;
  }
  ingestToolDefs(effectiveTools, toolContext);
  const { instructions: system, messages, deferredTools } = translateResponsesInput(effectiveInput, body.instructions, npm, toolContext);
  const effort = body.reasoning?.effort;
  const providerOptions = deepMergeProviderOptions(
    thinkingProviderOptions(npm),
    effortProviderOptions(npm, effort, metadata?.upstreamModelId ?? body.model, metadata)
  );
  const tools = translateResponsesTools([...effectiveTools, ...deferredTools], { ...options, npm });
  const bridgedGemini = npm === "@ai-sdk/anthropic" && metadata?.providerId !== void 0 && isProviderKind(metadata.providerId, "antigravity") && /(?:^|__)gemini-/.test(metadata.upstreamModelId ?? body.model);
  return {
    instructions: system,
    messages,
    tools,
    toolContext,
    maxOutputTokens: omitsMaxOutputTokens(metadata) ? void 0 : body.max_output_tokens ?? (bridgedGemini ? 65536 : void 0),
    temperature: body.temperature,
    providerOptions,
    headers: options.requestHeaders
  };
}
function newResponseId() {
  return `resp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
function newItemId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
function functionCallItemId(upstreamId) {
  return upstreamId.startsWith("fc_") ? upstreamId : newItemId("fc");
}
function usageFromPart(part) {
  const input = part.totalUsage?.inputTokens ?? 0;
  const output = part.totalUsage?.outputTokens ?? 0;
  const cached = part.totalUsage?.inputTokenDetails?.cacheReadTokens ?? 0;
  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: input + output,
    ...cached > 0 ? { input_tokens_details: { cached_tokens: cached } } : {}
  };
}
var CODEX_SUBAGENT_TOOL_NAMES = /* @__PURE__ */ new Set(["spawn_agent", "multi_agent_v1__spawn_agent"]);
function isCodexSubagentToolName(toolName) {
  return CODEX_SUBAGENT_TOOL_NAMES.has(toolName) || toolName.endsWith("__spawn_agent");
}
function normalizeCodexSubagentArguments(toolName, argsStr) {
  if (!isCodexSubagentToolName(toolName)) return argsStr;
  const args = parseToolArguments(argsStr);
  for (const key of ["model", "reasoning_effort", "service_tier"]) {
    if (args[key] === "") delete args[key];
  }
  const items2 = args.items;
  const message = args.message;
  if (Array.isArray(items2) && items2.length > 0) {
    delete args.message;
  } else if (typeof message === "string" && message.trim()) {
    delete args.items;
  } else if (Array.isArray(items2) && items2.length === 0) {
    delete args.items;
  }
  return JSON.stringify(args);
}
function resolveOutputKind(flatName, ctx) {
  if (!ctx) return { kind: "plain" };
  if (flatName === TOOL_SEARCH_NAME) return { kind: "tool_search" };
  if (ctx.customToolNames.has(flatName)) return { kind: "custom" };
  const ns = ctx.namespaceByFlatName.get(flatName);
  if (ns) return { kind: "namespace", namespace: ns.namespace, name: ns.name };
  return { kind: "plain" };
}
function toolItemId(kind, upstreamId) {
  switch (kind.kind) {
    case "tool_search":
      return upstreamId.startsWith("tsc_") ? upstreamId : newItemId("tsc");
    case "custom":
      return upstreamId.startsWith("ctc_") ? upstreamId : newItemId("ctc");
    default:
      return functionCallItemId(upstreamId);
  }
}
function buildFinalToolItem(kind, flatName, callId, itemId, argsStr) {
  argsStr = normalizeCodexSubagentArguments(flatName, argsStr);
  switch (kind.kind) {
    case "namespace":
      return { type: "function_call", id: itemId, call_id: callId, namespace: kind.namespace, name: kind.name, arguments: argsStr, status: "completed" };
    case "tool_search": {
      const args = parseToolArguments(argsStr);
      if (typeof args.limit === "string" && /^-?\d+$/.test(args.limit)) args.limit = Number(args.limit);
      return { type: "tool_search_call", id: itemId, call_id: callId, execution: "client", arguments: args, status: "completed" };
    }
    case "custom":
      return { type: "custom_tool_call", id: itemId, call_id: callId, name: flatName, input: customToolInputFromArgs(flatName, parseToolArguments(argsStr)), status: "completed" };
    default:
      return { type: "function_call", id: itemId, call_id: callId, name: flatName, arguments: argsStr, status: "completed" };
  }
}
function incompleteReasonForFinish(finishReason) {
  if (finishReason === "length") return "max_output_tokens";
  if (finishReason === "content-filter") return "content_filter";
  return void 0;
}
var PROGRESS_INTERVAL_MS = 3e3;
var REPEAT_TAIL_CHARS = 200;
var REPEAT_STREAK_LIMIT = 3;
var LOOP_NOTICE = "\n\n[relay-ai: generation stopped after detecting a repetition loop]";
var INITIAL_REPEAT_TRACKER = { tail: "", len: 0, streak: 0 };
function trackRepetition(current, prev) {
  const tail = current.length >= REPEAT_TAIL_CHARS ? current.slice(-REPEAT_TAIL_CHARS) : current;
  const grew = current.length - prev.len >= REPEAT_TAIL_CHARS;
  const stale = tail.length === REPEAT_TAIL_CHARS && tail === prev.tail && grew;
  return { tail, len: current.length, streak: stale ? prev.streak + 1 : 0 };
}
async function writeResponsesStream(fullStream, modelId, write, onDone, onProgress, options) {
  const emit = (type, data) => write(sseChunk(type, data));
  const responseId = newResponseId();
  const createdAt = Math.floor(Date.now() / 1e3);
  let usage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  emit("response.created", {
    type: "response.created",
    response: {
      id: responseId,
      object: "response",
      model: modelId,
      created_at: createdAt,
      status: "in_progress",
      output: []
    }
  });
  let outputIndex = 0;
  let textItemId = null;
  let textOutputIndex = 0;
  let textFull = "";
  const toolStates = [];
  const toolStatesById = /* @__PURE__ */ new Map();
  let currentToolState = null;
  const streamStartedAt = Date.now();
  let lastProgressAt = streamStartedAt;
  const recentPartCounts = /* @__PURE__ */ new Map();
  let reasoningItemId = null;
  let reasoningText = "";
  let reasoningOutputIndex = 0;
  const outputItems = [];
  let reasoningRepeat = INITIAL_REPEAT_TRACKER;
  let textRepeat = INITIAL_REPEAT_TRACKER;
  let loopDetected;
  let finishReason;
  const ensureTextItem = () => {
    if (!textItemId) {
      textItemId = newItemId("msg");
      textOutputIndex = outputIndex;
      outputIndex++;
      emit("response.output_item.added", {
        type: "response.output_item.added",
        output_index: textOutputIndex,
        item: { id: textItemId, type: "message", role: "assistant", status: "in_progress", content: [] }
      });
      emit("response.content_part.added", {
        type: "response.content_part.added",
        item_id: textItemId,
        output_index: textOutputIndex,
        content_index: 0,
        part: { type: "output_text", text: "" }
      });
    }
    return textItemId;
  };
  const rememberToolState = (state) => {
    toolStates.push(state);
    toolStatesById.set(state.itemId, state);
    toolStatesById.set(state.callId, state);
    currentToolState = state;
    return state;
  };
  const createToolState = (rawId, name, signature) => {
    const kind = resolveOutputKind(name ?? "", options?.toolContext);
    const upstreamId = rawId ?? newItemId("call");
    const itemId = toolItemId(kind, upstreamId);
    const state = rememberToolState({
      itemId,
      callId: encodeToolUseId(upstreamId, signature, false),
      name: name ?? "unknown",
      outputIndex: outputIndex++,
      args: "",
      kind
    });
    emit("response.output_item.added", {
      type: "response.output_item.added",
      output_index: state.outputIndex,
      item: {
        type: "function_call",
        id: state.itemId,
        call_id: state.callId,
        name: state.name,
        arguments: "",
        status: "in_progress"
      }
    });
    return state;
  };
  const findToolState = (part) => {
    const key = part.id ?? part.toolCallId;
    if (key) return toolStatesById.get(key) ?? currentToolState;
    return currentToolState;
  };
  const appendToolArgs = (state, delta) => {
    if (!delta) return;
    state.args += delta;
    emit("response.function_call_arguments.delta", {
      type: "response.function_call_arguments.delta",
      item_id: state.itemId,
      output_index: state.outputIndex,
      delta
    });
  };
  for await (const part of fullStream) {
    recentPartCounts.set(part.type, (recentPartCounts.get(part.type) ?? 0) + 1);
    switch (part.type) {
      case "reasoning-start":
        reasoningText = "";
        reasoningItemId = newItemId("rs");
        reasoningOutputIndex = outputIndex++;
        emit("response.output_item.added", {
          type: "response.output_item.added",
          output_index: reasoningOutputIndex,
          item: { id: reasoningItemId, type: "reasoning", summary: [] }
        });
        break;
      case "reasoning-delta":
        if (!reasoningItemId) {
          reasoningItemId = newItemId("rs");
          reasoningOutputIndex = outputIndex++;
          emit("response.output_item.added", {
            type: "response.output_item.added",
            output_index: reasoningOutputIndex,
            item: { id: reasoningItemId, type: "reasoning", summary: [] }
          });
        }
        reasoningText += part.text ?? "";
        break;
      case "reasoning-end":
        break;
      case "text-start":
        textFull = "";
        ensureTextItem();
        break;
      case "text-delta":
        ensureTextItem();
        textFull += part.text ?? "";
        emit("response.output_text.delta", {
          type: "response.output_text.delta",
          item_id: textItemId,
          output_index: textOutputIndex,
          content_index: 0,
          delta: part.text ?? ""
        });
        break;
      case "tool-input-start": {
        const sig = grabRoundTripSignature(part);
        createToolState(part.id ?? part.toolCallId, part.toolName, sig);
        break;
      }
      case "tool-input-delta": {
        const state = findToolState(part);
        if (state) appendToolArgs(state, part.delta ?? part.text ?? "");
        break;
      }
      case "tool-call": {
        const sig = grabRoundTripSignature(part);
        const key = part.toolCallId ?? part.id;
        const state = (key ? toolStatesById.get(key) : void 0) ?? createToolState(key, part.toolName, sig);
        if (!state.args) {
          appendToolArgs(state, JSON.stringify(part.input ?? {}));
        }
        break;
      }
      case "finish-step":
        if (part.finishReason) finishReason = part.finishReason;
        break;
      case "finish":
        if (part.finishReason) finishReason = part.finishReason;
        if (part.totalUsage) usage = usageFromPart(part);
        break;
      case "abort": {
        const msg = `stream aborted: ${part.reason ?? "no data received from provider"}`;
        process.stderr.write(`[relay-ai] ${localTimestamp()} ${options?.logLabel ?? modelId}: ${msg}
`);
        onDone?.({
          reasoningChars: reasoningText.length,
          reasoningPreview: reasoningText.slice(0, 200),
          textChars: textFull.length,
          toolCallCount: toolStates.length,
          toolNames: toolStates.map((t) => t.name),
          loopDetected,
          aborted: true
        });
        emit("response.failed", {
          type: "response.failed",
          response: {
            id: responseId,
            object: "response",
            model: modelId,
            created_at: createdAt,
            status: "failed",
            output: [],
            error: { message: msg, type: "api_error" }
          }
        });
        return;
      }
      case "error": {
        const msg = formatUpstreamError(part.error);
        const is429 = msg.includes("429") || part.error && typeof part.error === "object" && (part.error.statusCode === 429 || part.error.lastError?.statusCode === 429);
        process.stderr.write(`[relay-ai] ${localTimestamp()} ${options?.logLabel ?? modelId}: ${msg}
`);
        onDone?.({
          reasoningChars: reasoningText.length,
          reasoningPreview: reasoningText.slice(0, 200),
          textChars: textFull.length,
          toolCallCount: toolStates.length,
          toolNames: toolStates.map((t) => t.name),
          loopDetected,
          errorMessage: msg,
          errorStatus: part.error?.statusCode
        });
        emit("response.failed", {
          type: "response.failed",
          response: {
            id: responseId,
            object: "response",
            model: modelId,
            created_at: createdAt,
            status: "failed",
            output: [],
            error: { message: msg, type: is429 ? "rate_limit_error" : "api_error", ...is429 ? { code: "429" } : {} }
          }
        });
        return;
      }
      default:
        break;
    }
    const now = Date.now();
    if (now - lastProgressAt >= PROGRESS_INTERVAL_MS) {
      lastProgressAt = now;
      reasoningRepeat = trackRepetition(reasoningText, reasoningRepeat);
      textRepeat = trackRepetition(textFull, textRepeat);
      if (reasoningRepeat.streak >= REPEAT_STREAK_LIMIT) loopDetected = "reasoning";
      else if (textRepeat.streak >= REPEAT_STREAK_LIMIT) loopDetected = "text";
      if (onProgress) {
        onProgress({
          reasoningChars: reasoningText.length,
          reasoningTail: reasoningText.slice(-200),
          textChars: textFull.length,
          toolCallCount: toolStates.length,
          elapsedMs: now - streamStartedAt,
          recentPartTypes: [...recentPartCounts].map(([type, n]) => `${type}:${n}`).join(",")
        });
      }
      recentPartCounts.clear();
      if (loopDetected) {
        options?.onForceStop?.(`repetition loop detected (${loopDetected})`);
        break;
      }
    }
  }
  const incompleteReason = incompleteReasonForFinish(finishReason);
  if (loopDetected) {
    ensureTextItem();
    textFull += LOOP_NOTICE;
    emit("response.output_text.delta", {
      type: "response.output_text.delta",
      item_id: textItemId,
      output_index: textOutputIndex,
      content_index: 0,
      delta: LOOP_NOTICE
    });
  }
  const dsml = loopDetected || incompleteReason ? null : parseDsmlToolCalls(textFull);
  if (dsml) {
    if (dsml.leadingText && textItemId) {
      emit("response.output_text.done", {
        type: "response.output_text.done",
        item_id: textItemId,
        output_index: textOutputIndex,
        content_index: 0,
        text: dsml.leadingText
      });
      emit("response.content_part.done", {
        type: "response.content_part.done",
        item_id: textItemId,
        output_index: textOutputIndex,
        content_index: 0,
        part: { type: "output_text", text: dsml.leadingText }
      });
      const textItem = {
        id: textItemId,
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: dsml.leadingText }]
      };
      emit("response.output_item.done", {
        type: "response.output_item.done",
        output_index: textOutputIndex,
        item: textItem
      });
      outputItems.push(textItem);
    }
    for (const call of dsml.calls) {
      const itemId = newItemId("fc");
      const callId = encodeToolUseId(itemId, void 0, false);
      const idx = outputIndex++;
      const args = JSON.stringify(call.args);
      emit("response.output_item.added", {
        type: "response.output_item.added",
        output_index: idx,
        item: { type: "function_call", id: itemId, call_id: callId, name: call.name, arguments: "", status: "in_progress" }
      });
      emit("response.function_call_arguments.done", {
        type: "response.function_call_arguments.done",
        item_id: itemId,
        output_index: idx,
        arguments: args
      });
      const fcItem = { type: "function_call", id: itemId, call_id: callId, name: call.name, arguments: args, status: "completed" };
      emit("response.output_item.done", { type: "response.output_item.done", output_index: idx, item: fcItem });
      outputItems.push(fcItem);
    }
  } else if (textItemId) {
    emit("response.output_text.done", {
      type: "response.output_text.done",
      item_id: textItemId,
      output_index: textOutputIndex,
      content_index: 0,
      text: textFull
    });
    emit("response.content_part.done", {
      type: "response.content_part.done",
      item_id: textItemId,
      output_index: textOutputIndex,
      content_index: 0,
      part: { type: "output_text", text: textFull }
    });
    const textItem = {
      id: textItemId,
      type: "message",
      role: "assistant",
      status: incompleteReason ? "incomplete" : "completed",
      content: [{ type: "output_text", text: textFull }]
    };
    emit("response.output_item.done", {
      type: "response.output_item.done",
      output_index: textOutputIndex,
      item: textItem
    });
    outputItems.push(textItem);
  }
  if (reasoningItemId) {
    const reasoningItem = makeReasoningOutputItem(reasoningItemId, reasoningText);
    emit("response.output_item.done", {
      type: "response.output_item.done",
      output_index: reasoningOutputIndex,
      item: reasoningItem
    });
    outputItems.unshift(reasoningItem);
  }
  for (const tool3 of incompleteReason ? [] : toolStates) {
    const normalizedArgs = normalizeCodexSubagentArguments(tool3.name, tool3.args);
    emit("response.function_call_arguments.done", {
      type: "response.function_call_arguments.done",
      item_id: tool3.itemId,
      output_index: tool3.outputIndex,
      arguments: normalizedArgs
    });
    const fcItem = buildFinalToolItem(tool3.kind, tool3.name, tool3.callId, tool3.itemId, normalizedArgs);
    emit("response.output_item.done", {
      type: "response.output_item.done",
      output_index: tool3.outputIndex,
      item: fcItem
    });
    outputItems.push(fcItem);
  }
  if (outputItems.length === 0 && !incompleteReason) {
    outputItems.push({ id: newItemId("msg"), type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "(conversation context was too large to summarize)" }] });
  }
  onDone?.({
    reasoningChars: reasoningText.length,
    reasoningPreview: reasoningText.slice(0, 200),
    textChars: textFull.length,
    toolCallCount: toolStates.length,
    toolNames: toolStates.map((t) => t.name),
    loopDetected,
    dsmlToolCallsRecovered: dsml?.calls.length,
    finishReason,
    incompleteReason
  });
  const terminalEvent = incompleteReason ? "response.incomplete" : "response.completed";
  emit(terminalEvent, {
    type: terminalEvent,
    response: {
      id: responseId,
      object: "response",
      model: modelId,
      created_at: createdAt,
      status: incompleteReason ? "incomplete" : "completed",
      ...incompleteReason ? { incomplete_details: { reason: incompleteReason } } : {},
      output: outputItems,
      usage
    }
  });
}
var STREAM_IDLE_TIMEOUT_MS = 12e4;
async function streamResponsesResponse(model, params, modelId, write, onDone, onProgress, options) {
  const configuredTimeout = (name, fallback) => {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  const idleTimeoutMs = options?.idleTimeoutMs ?? configuredTimeout("RELAY_AI_STREAM_IDLE_TIMEOUT_MS", STREAM_IDLE_TIMEOUT_MS);
  const progressTimeoutMs = options?.progressTimeoutMs ?? configuredTimeout("RELAY_AI_STREAM_PROGRESS_TIMEOUT_MS", 6e5);
  const abort = new AbortController();
  let idleTimer = setTimeout(
    () => abort.abort(new Error(`no data received from provider for ${Math.round(idleTimeoutMs / 1e3)}s`)),
    idleTimeoutMs
  );
  let active = true;
  const resetLiveness = () => {
    if (!active) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => abort.abort(new Error("no data received from provider for " + idleTimeoutMs / 1e3 + "s")), idleTimeoutMs);
  };
  const resetProgress = () => {
    clearTimeout(progressTimer);
    progressTimer = setTimeout(() => abort.abort(new Error("no content progress from provider for " + progressTimeoutMs / 1e3 + "s")), progressTimeoutMs);
  };
  let progressTimer;
  resetProgress();
  return streamActivity.run(resetLiveness, async () => {
    try {
      const { toolContext, ...sdkParams } = params;
      const result = streamText({ model, ...sdkParams, maxRetries: 0, abortSignal: abort.signal, onError: () => {
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
      Promise.resolve(result.response).catch(() => {
      });
      const watchedStream = (async function* () {
        try {
          for await (const part of result.stream) {
            resetLiveness();
            if (["text-delta", "reasoning-delta"].includes(part.type) && Boolean(part.text) || part.type === "tool-input-delta" && Boolean(part.delta) || ["tool-call", "finish", "finish-step"].includes(part.type)) resetProgress();
            yield part;
          }
        } catch (error) {
          if (!abort.signal.aborted) throw error;
          yield { type: "abort", reason: String(abort.signal.reason) };
        } finally {
          clearTimeout(idleTimer);
          clearTimeout(progressTimer);
        }
      })();
      await writeResponsesStream(watchedStream, modelId, write, onDone, onProgress, {
        onForceStop: (reason) => abort.abort(new Error(reason)),
        toolContext,
        logLabel: options?.logLabel
      });
    } finally {
      active = false;
      clearTimeout(idleTimer);
      clearTimeout(progressTimer);
    }
  });
}
async function generateResponsesResponse(model, params, modelId) {
  const { toolContext, ...sdkParams } = params;
  const r = await generateTextStreamingIfRequired({ model, ...sdkParams, maxRetries: 0 });
  const incompleteReason = incompleteReasonForFinish(r.finishReason);
  const createdAt = Math.floor(Date.now() / 1e3);
  const responseId = newResponseId();
  const output = [];
  if (r.reasoningText?.trim()) {
    output.push(makeReasoningOutputItem(newItemId("rs"), r.reasoningText));
  }
  if (r.text !== null && r.text !== void 0) {
    output.push({
      id: newItemId("msg"),
      type: "message",
      role: "assistant",
      status: incompleteReason ? "incomplete" : "completed",
      content: [{ type: "output_text", text: r.text }]
    });
  }
  for (const tc of incompleteReason ? [] : r.toolCalls) {
    const encodedId = encodeToolUseId(tc.toolCallId, grabRoundTripSignature(tc), false);
    const argsStr = JSON.stringify(tc.input ?? {});
    const kind = resolveOutputKind(tc.toolName, toolContext);
    output.push(buildFinalToolItem(
      kind,
      tc.toolName,
      encodedId,
      toolItemId(kind, tc.toolCallId),
      argsStr
    ));
  }
  if (output.length === 0 && !incompleteReason) {
    output.push({ id: newItemId("msg"), type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "(conversation context was too large to summarize)" }] });
  }
  const inputTokens = r.usage?.inputTokens ?? 0;
  const outputTokens = r.usage?.outputTokens ?? 0;
  return {
    id: responseId,
    object: "response",
    model: modelId,
    created_at: createdAt,
    status: incompleteReason ? "incomplete" : "completed",
    ...incompleteReason ? { incomplete_details: { reason: incompleteReason } } : {},
    output,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens
    }
  };
}
var COMPACTION_SUMMARY_INSTRUCTION = "You are performing a CONTEXT CHECKPOINT COMPACTION. Summarize the conversation so far into a concise but complete summary that preserves the user's goals, key decisions and facts, the current state of the work, and any pending or in-progress tasks. Output only the summary text.";
function encodeCompactionContent(summary) {
  return Buffer.from(JSON.stringify({ v: 1, summary }), "utf8").toString("base64");
}
function decodeCompactionContent(encrypted) {
  if (!encrypted) return null;
  try {
    const obj = JSON.parse(Buffer.from(encrypted, "base64").toString("utf8"));
    return obj?.v === 1 && typeof obj.summary === "string" ? obj.summary : null;
  } catch {
    return null;
  }
}
function makeCompactionItem(summary) {
  return { type: "compaction", id: newItemId("cmp"), encrypted_content: encodeCompactionContent(summary) };
}
function appendCompactionInstruction(params) {
  return {
    ...params,
    tools: void 0,
    messages: [
      ...params.messages,
      { role: "user", content: [{ type: "text", text: COMPACTION_SUMMARY_INSTRUCTION }] }
    ]
  };
}
async function collectCompactionSummary(model, params) {
  const { toolContext: _toolContext, ...sdkParams } = params;
  void _toolContext;
  let firstStreamError;
  const result = streamText({
    model,
    ...sdkParams,
    maxRetries: 0,
    onError: (event) => {
      firstStreamError ??= event;
    }
  });
  Promise.resolve(result.toolResults).catch(() => {
  });
  let text4;
  try {
    text4 = await result.text ?? "";
  } catch (error) {
    throw firstStreamError ? firstStreamError.error : error;
  }
  if (firstStreamError) throw firstStreamError.error;
  return text4;
}
function buildCompactionResponseBody(summary, modelId) {
  return {
    id: newResponseId(),
    object: "response",
    model: modelId,
    created_at: Math.floor(Date.now() / 1e3),
    status: "completed",
    output: [makeCompactionItem(summary)]
  };
}
function writeCompactionSse(summary, modelId, write) {
  const emit = (type, data) => write(sseChunk(type, data));
  const responseId = newResponseId();
  const createdAt = Math.floor(Date.now() / 1e3);
  const item = makeCompactionItem(summary);
  emit("response.created", {
    type: "response.created",
    response: { id: responseId, object: "response", model: modelId, created_at: createdAt, status: "in_progress", output: [] }
  });
  emit("response.output_item.added", { type: "response.output_item.added", output_index: 0, item });
  emit("response.output_item.done", { type: "response.output_item.done", output_index: 0, item });
  emit("response.completed", {
    type: "response.completed",
    response: { id: responseId, object: "response", model: modelId, created_at: createdAt, status: "completed", output: [item] }
  });
}
async function generateCompactionResponse(model, params, modelId) {
  const text4 = await collectCompactionSummary(model, params);
  return buildCompactionResponseBody(text4.trim() || "(no summary produced)", modelId);
}
async function streamCompactionResponse(model, params, modelId, write) {
  const text4 = await collectCompactionSummary(model, params);
  writeCompactionSse(text4.trim() || "(no summary produced)", modelId, write);
}
function responsesErrorBody(modelId, message, statusCode = 401) {
  return {
    id: newResponseId(),
    object: "response",
    model: modelId,
    created_at: Math.floor(Date.now() / 1e3),
    status: "failed",
    output: [],
    error: { message, type: statusCode === 429 ? "rate_limit_error" : "api_error", code: String(statusCode) }
  };
}
function writeResponsesErrorStream(modelId, message, write, statusCode = 401) {
  write(sseChunk("response.failed", {
    type: "response.failed",
    response: responsesErrorBody(modelId, message, statusCode)
  }));
}

// src/pool/continuation.ts
function poolRouteKey(route) {
  return JSON.stringify([route.account, route.endpointRevision, route.model]);
}
var DEFAULT_LIMITS2 = {
  ttlMs: 6e4,
  maxEntries: 32,
  maxBytes: 4 * 1024 * 1024,
  maxItems: 2e3
};
function items(input) {
  if (typeof input === "string") return [{ type: "message", role: "user", content: input }];
  if (!Array.isArray(input)) throw new Error("unsupported-input");
  return structuredClone(input);
}
function checkLimit2(name, value) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Invalid continuation limit: " + name);
}
var PoolContinuationStore = class {
  constructor(limits = {}, now = Date.now) {
    this.now = now;
    this.limits = { ...DEFAULT_LIMITS2, ...limits };
    for (const [name, value] of Object.entries(this.limits)) checkLimit2(name, value);
  }
  now;
  states = /* @__PURE__ */ new Map();
  limits;
  remember(responseId, scope, request, output, source) {
    if (!responseId) throw new Error("response-id-required");
    if (!scope) throw new Error("real-session-and-branch-required");
    const storedInput = items(request.input);
    const storedOutput = structuredClone(output);
    if (storedInput.length + storedOutput.length > this.limits.maxItems) {
      throw new Error("continuation-history-too-large");
    }
    const state = {
      scope,
      input: storedInput,
      output: storedOutput,
      ...typeof request.instructions === "string" ? { instructions: request.instructions } : {},
      source: poolRouteKey(source),
      expires: this.now() + this.limits.ttlMs,
      bytes: 0
    };
    state.bytes = Buffer.byteLength(JSON.stringify(state), "utf8");
    if (state.bytes > this.limits.maxBytes) throw new Error("continuation-history-too-large");
    this.prune();
    this.states.set(JSON.stringify([scope, responseId]), state);
    while (this.states.size > this.limits.maxEntries) {
      this.states.delete(this.states.keys().next().value);
    }
  }
  resolve(scope, request) {
    const body = structuredClone(request);
    const previous = body.previous_response_id;
    if (previous === void 0 || previous === null) return { body };
    if (typeof previous !== "string" || !previous) throw new Error("unsupported-continuation: invalid response id");
    const state = this.states.get(JSON.stringify([scope, previous]));
    if (!scope || !state || state.expires <= this.now()) {
      throw new Error("unsupported-continuation: missing Relay-owned history");
    }
    body.input = [...structuredClone(state.input), ...structuredClone(state.output), ...items(body.input)];
    body.instructions ??= state.instructions;
    delete body.previous_response_id;
    return { body, source: state.source };
  }
  prune() {
    const now = this.now();
    for (const [key, state] of this.states) {
      if (state.expires <= now) this.states.delete(key);
    }
  }
};
function stripRouteParts(part) {
  if (part.type !== "tool-call" && part.type !== "tool-result") return part;
  const { providerOptions: _options, toolCallId, ...rest } = part;
  return {
    ...rest,
    ...typeof toolCallId === "string" ? { toolCallId: splitToolUseId(toolCallId).rawId } : {}
  };
}
function preparePoolHistory(body, source, target, npm, metadata) {
  const fresh = structuredClone(body);
  const input = items(fresh.input);
  if (input.some(
    (item) => (item.type === "compaction" || item.type === "context_compaction") && decodeCompactionContent(item.encrypted_content) === null || item.type === "reasoning" && typeof item.encrypted_content === "string"
  )) throw new Error("unsupported-continuation: opaque provider state requires original route");
  fresh.input = input;
  const params = translateResponsesRequest(fresh, npm, metadata);
  if (source !== poolRouteKey(target)) {
    params.messages = params.messages.map((message) => ({
      ...message,
      content: Array.isArray(message.content) ? message.content.filter((part) => part.type !== "reasoning").map((part) => stripRouteParts(part)) : message.content
    }));
  }
  return params;
}

// src/pool/session.ts
var PoolSessionRoutes = class {
  constructor(ttlMs = 36e5, capacity = 256, now = Date.now) {
    this.ttlMs = ttlMs;
    this.capacity = capacity;
    this.now = now;
  }
  ttlMs;
  capacity;
  now;
  states = /* @__PURE__ */ new Map();
  begin(scope, eligible) {
    const routes = [...eligible];
    if (!scope) return { routes, succeed: (_id) => {
    } };
    const previous = this.states.get(scope);
    const pinned = previous && previous.expires > this.now() ? previous.pinned : void 0;
    const state = { token: /* @__PURE__ */ Symbol(), pinned, expires: this.now() + this.ttlMs };
    this.states.delete(scope);
    this.states.set(scope, state);
    while (this.states.size > this.capacity) this.states.delete(this.states.keys().next().value);
    const index = routes.findIndex((route) => route.id === pinned);
    if (index > 0) routes.unshift(...routes.splice(index, 1));
    return {
      routes,
      succeed: (id) => {
        if (this.states.get(scope)?.token !== state.token || !routes.some((route) => route.id === id)) return;
        this.states.set(scope, { ...state, pinned: id, expires: this.now() + this.ttlMs });
      }
    };
  }
};

// src/pool/codex-response.ts
async function writeCodexPoolResponse(stream, modelId, write, options = {}) {
  let completed;
  let bytes = 0;
  const context = options.toolContext ?? { namespaceByFlatName: /* @__PURE__ */ new Map(), customToolNames: /* @__PURE__ */ new Set() };
  const contextualStream = (async function* () {
    for await (const part of stream) {
      const selected = options.getToolContext?.();
      if (selected) {
        context.namespaceByFlatName = selected.namespaceByFlatName;
        context.customToolNames = selected.customToolNames;
      }
      yield part;
    }
  })();
  await writeResponsesStream(contextualStream, modelId, (chunk) => {
    if (options.nonstream) {
      bytes += Buffer.byteLength(chunk);
      if (bytes > (options.maxResponseBytes ?? 4 * 1024 * 1024)) throw new Error("Pool response buffer exceeded");
    } else write(chunk);
    for (const line of chunk.split(String.fromCharCode(10))) {
      if (!line.startsWith("data:")) continue;
      const event = JSON.parse(line.slice(5));
      if (event.type === "response.completed" || event.type === "response.incomplete") completed = event.response;
      if (event.type === "response.failed") throw new Error("Pool response failed");
    }
  }, void 0, void 0, { toolContext: context });
  if (!completed) throw new Error("Pool response missing terminal result");
  return completed;
}

// src/pool/codex-runtime.ts
var FREE_POOL_MODEL_ID = "relay-free-pool";
var FREE_POOL_PROVIDER_ID = "relay-free-pool";
var DEFAULT_POOL_LIMITS = {
  attempts: MAX_POOL_ATTEMPTS,
  firstContentMs: 2e4,
  idleMs: 2e4,
  totalMs: 6e4,
  bufferBytes: 65536,
  cleanupMs: 1e3
};
var CodexPoolRuntime = class {
  constructor(pool, prepare, limits = DEFAULT_POOL_LIMITS) {
    this.pool = pool;
    this.prepare = prepare;
    this.limits = limits;
  }
  pool;
  prepare;
  limits;
  history = new PoolContinuationStore({ ttlMs: 36e5 });
  sessions = new PoolSessionRoutes();
  retries = new CodexRetryGuard();
  async respond(headers, request, signal, write) {
    if (request.model !== FREE_POOL_MODEL_ID) throw new Error("Pool runtime requires an explicit pool model");
    const identity = codexPoolIdentity(headers, request);
    if (!identity) throw new Error("Pool requires verified Codex conversation and turn metadata");
    const { body, source } = this.history.resolve(identity.conversation, request);
    const lease = this.retries.acquire(identity.turn, requestFingerprint(body));
    if (lease.kind === "replay") {
      const cached = JSON.parse(lease.response);
      if (body.stream === true) for (const chunk of cached.chunks) write(chunk);
      return cached.response;
    }
    if (lease.kind !== "owner") throw new Error("Pool retry " + lease.kind);
    const chunks = [];
    let committed = false;
    try {
      const routes = await this.prepare(body, source, signal, identity.conversation);
      let served;
      const stream = dispatchFreePool(this.pool, routes, {
        target: "codex",
        effort: body.reasoning?.effort,
        tools: Array.isArray(body.tools) && body.tools.length > 0,
        signal,
        conversationScope: identity.conversation
      }, {
        limits: this.limits,
        sessions: this.sessions,
        retryable: retryPoolFailure,
        onAttempt: (id) => {
          served = routes.find((route) => JSON.stringify([route.member.providerId, route.revision, route.member.modelId]) === id);
        }
      });
      const response = await writeCodexPoolResponse(stream, FREE_POOL_MODEL_ID, (chunk) => {
        committed = true;
        chunks.push(chunk);
        write(chunk);
      }, { nonstream: body.stream !== true, getToolContext: () => served?.toolContext });
      if (!served || typeof response.id !== "string" || !Array.isArray(response.output)) throw new Error("Pool response missing route or history");
      this.history.remember(response.id, identity.conversation, body, response.output, served.identity);
      lease.complete(JSON.stringify({ response, chunks }));
      return response;
    } catch (error) {
      if (signal.aborted) lease.release();
      else lease.fail("Pool request failed", committed);
      throw error;
    }
  }
};

// src/pool/catalog.ts
var ALIASES = {
  codex: FREE_POOL_MODEL_ID,
  claude: "claude-pool",
  antigravity: "free-pool"
};
function servable(receipt, target, now) {
  return Boolean(receipt && Number.isFinite(receipt.verifiedAt) && receipt.verifiedAt <= now && Number.isFinite(receipt.expiresAt) && receipt.expiresAt > now && receipt.targets.includes(target) && receipt.billingSafe && Number.isSafeInteger(receipt.contextWindow) && receipt.contextWindow > 0);
}
function poolCatalogEntry(pool, receipts, target, now = Date.now()) {
  const verified = pool.members.map((member) => receipts.find((receipt) => receipt.member.providerId === member.providerId && receipt.member.modelId === member.modelId)).filter((receipt) => servable(receipt, target, now));
  if (!verified.length) return void 0;
  const window = Math.min(...verified.map((receipt) => receipt.contextWindow));
  const reserve = Math.max(4096, Math.ceil(window * 0.1));
  const levels = verified[0].effortLevels.filter((level) => verified.every((receipt) => receipt.effortLevels.includes(level)));
  return {
    id: ALIASES[target],
    display_name: "Relay Free Pool",
    context_window: Math.max(1024, window - reserve),
    supported_reasoning_levels: levels.map((level) => ({ effort: level, description: level }))
  };
}
function codexPoolCatalogEntry(pool, receipts, now = Date.now()) {
  return poolCatalogEntry(pool, receipts, "codex", now);
}
function codexPoolCatalogModel(pool, receipts, options = {}) {
  const entry = poolCatalogEntry(pool, receipts, "codex", options.now);
  if (!entry) return void 0;
  const model = {
    id: FREE_POOL_MODEL_ID,
    name: entry.display_name,
    family: "",
    brand: "",
    modelFormat: "openai",
    npm: "@ai-sdk/openai-compatible",
    upstreamModelId: FREE_POOL_MODEL_ID,
    contextWindow: entry.context_window
  };
  const base = catalogEntryFromModel(
    model,
    entry.display_name,
    options.priority ?? 1,
    options.appCatalog === true,
    FREE_POOL_MODEL_ID
  );
  const levels = entry.supported_reasoning_levels.length > 0 ? entry.supported_reasoning_levels : [{ effort: "none", description: "none" }];
  return {
    ...base,
    supported_reasoning_levels: levels,
    default_reasoning_level: levels[0].effort,
    default_reasoning_summary: "none",
    supports_reasoning_summaries: false,
    support_verbosity: false,
    default_verbosity: null,
    context_window: entry.context_window,
    max_context_window: entry.context_window,
    truncation_policy: options.appCatalog === true ? base.truncation_policy : { mode: "tokens", limit: entry.context_window }
  };
}

// src/catalog.ts
function localModelToRoute(lp, model) {
  if (model.modelFormat === "anthropic" && !model.baseUrl) return null;
  if (model.modelFormat === "openai" && !isSdkMigratedNpm(model.npm) && !model.completionsUrl) return null;
  const upstreamUrl = model.modelFormat === "cloud-code" ? model.baseUrl ?? ANTIGRAVITY_BASE_URLS[0] : model.modelFormat === "anthropic" ? model.baseUrl : model.completionsUrl;
  const contextWindow = claudeCodeContextWindow(model);
  return {
    aliasId: claudeCodeClientModelId(aliasModelId(model.id, lp.id), contextWindow),
    realModelId: model.upstreamModelId,
    displayName: `${model.name || model.id} (${lp.name})`,
    upstreamUrl: upstreamUrl ?? "",
    apiKey: lp.apiKey,
    modelFormat: model.modelFormat,
    contextWindow: model.contextWindowEstimated ? contextWindow : model.contextWindow,
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
import { tool as tool2, jsonSchema as jsonSchema2, streamText as streamText2 } from "ai";
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
        const schema = t.function.parameters ? jsonSchema2(t.function.parameters) : void 0;
        tools[t.function.name] = tool2({
          description: t.function.description ?? "",
          inputSchema: schema ?? jsonSchema2({ type: "object", properties: {} })
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
function toOpenAiUsage(usage) {
  const prompt = usage?.inputTokens ?? usage?.promptTokens ?? 0;
  const completion = usage?.outputTokens ?? usage?.completionTokens ?? 0;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: usage?.totalTokens ?? prompt + completion,
    ...usage?.inputTokenDetails?.cacheReadTokens ? { prompt_tokens_details: { cached_tokens: usage.inputTokenDetails.cacheReadTokens } } : {}
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
  const result = await generateTextStreamingIfRequired({ model, ...params });
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
    usage: toOpenAiUsage(result.usage)
  };
}
async function streamOpenAiResponse(model, params, responseModelId, onChunk, log7) {
  const { stream } = streamText2({ model, ...params });
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
  let finishUsage;
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
        finishUsage = p8.totalUsage;
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
  if (finishUsage) {
    onChunk(`data: ${JSON.stringify({ ...baseData, choices: [], usage: toOpenAiUsage(finishUsage) })}

`);
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
      const models = options.catalog.list();
      const payload = formatGatewayAnthropicModels(models, options.gateway);
      const poolModel = options.pool ? models.find((model) => model.id === CLAUDE_POOL_MODEL_ID) : void 0;
      if (poolModel && options.pool) {
        const publicId = exposedGatewayAliasId(poolModel, options.gateway);
        for (const entry of payload.data) {
          if (entry.id === publicId) entry.display_name = options.pool.displayName;
        }
      }
      sendJson(res, 200, payload);
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
  if (options.pool && model.id === CLAUDE_POOL_MODEL_ID) {
    plog(`anthropic-messages pool=${model.id} stream=${body.stream === true}`);
    await serveAnthropicPool(req, res, options, body, plog);
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
      if (model.providerId && isProviderKind(model.providerId, "claude-code")) injectClaudeCodeBillingSystemLine(forwardBody);
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
    const sessionId = extractClaudeSessionId(req.headers, body);
    const languageModel = await getOrInitLanguageModel(
      modelCache,
      model,
      model.npm,
      model.apiBaseUrl,
      apiKey,
      options.vertex,
      providerRefreshToken(model.providerId, model.authType),
      sessionId
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
async function serveAnthropicPool(req, res, options, body, plog) {
  const pool = options.pool;
  if (!pool) return;
  const abort = new AbortController();
  res.once("close", () => {
    if (!res.writableFinished) abort.abort();
  });
  try {
    const sessionId = extractConversationId(req.headers, body);
    const result = await pool.runtime.serve(body, (chunk) => {
      if (res.destroyed) throw new Error("Client disconnected");
      if (!res.headersSent) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive"
        });
      }
      res.write(chunk);
    }, abort.signal, sessionId);
    if (result.ok) {
      if (result.message) sendJson(res, 200, result.message);
      else res.end();
      return;
    }
    plog(`pool error status=${result.status} committed=${result.committed}: ${result.error.message}`);
    if (result.committed || res.headersSent) {
      if (!res.writableEnded) res.end();
      return;
    }
    if (!res.destroyed) {
      sendJson(res, result.status, { type: "error", error: result.error });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    plog(`pool failure: ${message}`);
    if (res.destroyed || res.writableEnded) return;
    if (!res.headersSent) {
      sendJson(res, 502, { type: "error", error: { type: anthropicErrorType(502), message } });
    } else {
      res.end();
    }
  }
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
  const conversationId = extractConversationId(req.headers, body);
  const languageModel = await getOrInitLanguageModel(
    modelCache,
    model,
    npm,
    baseURL,
    apiKey,
    options.vertex,
    providerRefreshToken(model.providerId, model.authType),
    conversationId
  );
  const requestHeaders = openCodeGoHeaders(
    model.providerId ?? model.sourceBackend,
    baseURL,
    conversationId,
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
async function getOrInitLanguageModel(modelCache, model, npm, baseURL, apiKey, vertex, refreshToken, sessionId) {
  const cacheKey = [
    model.providerId ?? model.sourceBackend,
    model.id,
    upstreamModelId(model),
    npm,
    baseURL ?? "",
    sessionId ?? ""
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
      ...sessionId ? { sessionId } : {},
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
var VERTEX_MODEL_SHORT_ALIASES = {
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5",
  opus: "claude-opus-4-6"
};
function isVertexOneMModel(modelId) {
  return resolveContextWindow(modelId) >= 1e6;
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
        if (isVertexOneMModel(targetId)) {
          registerVertexCatalogAlias(byId, `${alias}[1m]`, model);
        }
      }
    }
    if (isVertexOneMModel(model.id)) {
      registerVertexCatalogAlias(byId, `${model.id}[1m]`, model);
    }
  }
  return {
    get: (id) => {
      const requested1m = /\[1m\]$/i.test(id);
      for (const candidate of vertexClientModelLookupCandidates(id)) {
        const match = byId.get(candidate) ?? catalog.get(candidate);
        if (match) {
          if (requested1m && !isVertexOneMModel(match.id)) return void 0;
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
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync as writeFileSync2
} from "fs";
import { join as join2 } from "path";
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
  return join2(getAppHome(), "update-check.json");
}
function readFreshCache(now) {
  try {
    const parsed = JSON.parse(readFileSync(cachePath(), "utf8"));
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
  if (provider.nameCustomized) return provider.name;
  const explicit = OAUTH_FAVORITE_NAMES[providerKind(provider.id)];
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
      claudeCodeContextWindow(model)
    );
    routes.push({
      ...route,
      aliasId: claudeCodeClientModelId(
        httpProxyModelId(provider.id, model.id),
        claudeCodeContextWindow(model)
      ),
      gatewayAliasId: gatewayAliasId2,
      displayName: `${model.name || model.id} (${provider.name})`
    });
  }
  return { routes, unavailable, unsupported };
}

// src/binary-lookup.ts
import { execFileSync } from "child_process";
import { existsSync } from "fs";
function findBinaryOnPath(name, fallbackPaths, options = {}) {
  const isWindows = options.isWindows ?? process.platform === "win32";
  const exists = options.exists ?? existsSync;
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

// src/registry/oauth-account.ts
async function readOAuthAccountLabel(provider) {
  if (provider.authType !== "oauth") return void 0;
  try {
    const cred = await readStoredOAuthCredential(provider.authRef);
    if (!cred) return void 0;
    return formatOAuthAccount(describeOAuthAccount({
      kind: provider.id,
      accountId: cred.accountId,
      providerData: cred.providerData,
      accessToken: cred.access
    }));
  } catch {
    return void 0;
  }
}

// src/registry/add-template.ts
init_provider_templates();

// src/registry/vertex-model-check.ts
import { generateText as generateText2 } from "ai";
function errorStatus(err) {
  const rec = err;
  return rec?.statusCode ?? rec?.lastError?.statusCode ?? 0;
}
async function checkVertexModelAccess(modelId) {
  try {
    const model = await createLanguageModel({
      npm: VERTEX_ANTHROPIC_NPM,
      modelId,
      apiKey: "",
      providerId: VERTEX_ANTHROPIC_PROVIDER_ID
    });
    await generateText2({
      model,
      prompt: "Reply with exactly OK.",
      maxOutputTokens: 16,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(6e4)
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, status: errorStatus(err), error: formatUpstreamError(err) };
  }
}
function classifyVertexAccess(status, message) {
  if (status === 200) return "available";
  if (status === 404) return { verdict: "unavailable", detail: "not found or not enabled for your project" };
  if (status === 400 && /allowedModels|Organization Policy/i.test(message)) {
    return { verdict: "unavailable", detail: "blocked by your organization's model policy" };
  }
  if (status === 401 || status === 403) return { verdict: "abort", detail: message };
  return "unknown";
}
async function filterVertexModelsByAccess(entries, check = checkVertexModelAccess) {
  const reasons = /* @__PURE__ */ new Map();
  const confirmed = /* @__PURE__ */ new Set();
  const candidates = entries.map((entry) => ({
    id: entry.id,
    name: entry.display_name,
    upstreamModelId: entry.upstream_id ?? entry.id,
    modelFormat: "openai"
  }));
  const outcome = await filterModelsByAvailability(candidates, {
    label: "vertex-access",
    concurrency: 4,
    probe: async (model) => {
      const access = await check(model.upstreamModelId);
      const status = access.ok ? 200 : access.status ?? 0;
      if (access.ok) confirmed.add(model.id);
      const verdict = classifyVertexAccess(status, access.error ?? "");
      if (typeof verdict === "object" && verdict.verdict === "unavailable" && verdict.detail) reasons.set(model.id, verdict.detail);
      return { status, body: access.error ?? "" };
    },
    classify: (status, body) => classifyVertexAccess(status, String(body))
  });
  if (outcome.aborted) return { allowed: entries, removed: [], confirmedIds: [], aborted: true, abortDetail: outcome.abortDetail };
  const removedIds = new Set(outcome.removedIds);
  return {
    allowed: entries.filter((entry) => !removedIds.has(entry.id)),
    removed: entries.filter((entry) => removedIds.has(entry.id)).map((entry) => ({ entry, reason: reasons.get(entry.id) ?? "not available to your project" })),
    confirmedIds: entries.filter((entry) => confirmed.has(entry.id)).map((entry) => entry.id),
    aborted: false
  };
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
function sameServer(a, b) {
  const normalize = (url) => (url ?? "").trim().replace(/\/+$/, "").toLowerCase();
  return normalize(a) === normalize(b);
}
async function findAccountWithSameKey(providers, templateId, key, baseUrl) {
  for (const other of providers) {
    if (providerKind(other.id) !== templateId || other.authType === "oauth") continue;
    if (!sameServer(other.api.url, baseUrl)) continue;
    if (await readStoredProviderCredential(other.authRef) === key) return other;
  }
  return void 0;
}
async function addProviderFromTemplate(template, apiKey, opts) {
  const trimmedKey = apiKey.trim();
  if (!trimmedKey && !template.apiKeyOptional) {
    return { added: false, error: "API key cannot be empty." };
  }
  const addAccount = opts?.addAccount === true;
  if (addAccount && !supportsAdditionalApiAccounts(template)) {
    return { added: false, error: `A second account is not available for ${template.name}.` };
  }
  if (template.modelSource === "zen-go-api") {
    return addOpencodeCloudFromApiKey(trimmedKey, addAccount ? { addAccount: true } : void 0);
  }
  const packageError = await probeTemplatePackage(template);
  if (packageError) {
    return { added: false, error: packageError };
  }
  const registry = loadRegistry();
  const takenIds = registry.providers.map((p8) => p8.id);
  const providerId = addAccount && takenIds.includes(template.id) ? nextInstanceId(template.id, takenIds) : template.id;
  const existing = addAccount ? void 0 : registry.providers.find((p8) => p8.id === template.id);
  if (existing && !opts?.replaceExisting) {
    return {
      added: false,
      error: `${template.name} is already configured.`,
      hint: `Remove it first with: relay-ai providers remove ${template.id}`
    };
  }
  let fetched;
  let notice;
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
  } else if (template.modelSource === "vertex-models-file") {
    const setupError = vertexAnthropicSetupError();
    if (setupError) return { added: false, ...setupError };
    const entries = loadVertexModelEntries();
    const access = await filterVertexModelsByAccess(entries);
    if (access.aborted) {
      return {
        added: false,
        error: access.abortDetail ?? "Vertex AI rejected the request.",
        hint: `Check that Vertex AI is enabled for project ${resolveVertexProject()} and your account can use it (role: Vertex AI User).`
      };
    }
    if (access.allowed.length === 0) {
      return {
        added: false,
        error: `None of the ${entries.length} Claude models are available to project ${resolveVertexProject()}.`,
        hint: `${access.removed[0]?.entry.id}: ${access.removed[0]?.reason}. Ask your Google Cloud admin to enable Claude models in Vertex AI Model Garden.`
      };
    }
    if (access.removed.length > 0) {
      saveVertexModelEntries(access.allowed);
      notice = `Skipped ${access.removed.length} model${access.removed.length === 1 ? "" : "s"} your project can't use: ` + access.removed.map((r) => `${r.entry.display_name} (${r.reason})`).join(", ") + ". Re-check later from relay-ai providers \u2192 Google Vertex AI (Claude) \u2192 Check model access.";
    }
    fetched = { models: vertexAnthropicCachedModels(), baseUrl: "" };
  } else {
    fetched = await fetchTemplateModels(template, trimmedKey, opts?.baseUrl);
  }
  if (fetched.error || fetched.models.length === 0) {
    return {
      added: false,
      error: fetched.error ?? "No models returned.",
      hint: fetched.hint,
      ...fetched.code ? { code: fetched.code } : {}
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
  if (addAccount && trimmedKey) {
    const clash = await findAccountWithSameKey(registry.providers, template.id, trimmedKey, fetched.baseUrl);
    if (clash) {
      return {
        added: false,
        error: `This key is already saved as "${clash.name}" for the same server.`,
        hint: 'Use "Change API key" on that provider, or add a different key.'
      };
    }
  }
  const authRef = `keyring:provider:${providerId}`;
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
  const providerName = existing?.nameCustomized ? existing.name : uniqueProviderName(registry.providers, template.name, existing?.id);
  const entry = {
    id: providerId,
    templateId: template.id,
    name: providerName,
    ...existing?.nameCustomized || providerName !== template.name ? { nameCustomized: true } : {},
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
  return { added: true, provider: entry, modelCount: pricedModels.length, ...notice ? { notice } : {} };
}

// src/oauth/claude-code-account.ts
function claudeCodeProviderData(bootstrap) {
  const data = { cliUserID: generateCliUserID() };
  if (bootstrap.accountId) data.accountUUID = bootstrap.accountId;
  if (bootstrap.organizationId) data.organizationUUID = bootstrap.organizationId;
  if (bootstrap.organizationName) data.organizationName = bootstrap.organizationName;
  if (bootstrap.plan) data.plan = bootstrap.plan;
  if (bootstrap.email) data.identity = { email: bootstrap.email };
  return data;
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
      return tokensToStoredCredential(tokens, void 0, bootstrap.accountId, claudeCodeProviderData(bootstrap));
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
var DuplicateOAuthAccountError = class extends Error {
  constructor(accountLabel, existingName) {
    super(
      `${accountLabel ? `This account (${accountLabel})` : "This account"} is already signed in as "${existingName}". Use "Sign in again" on that provider instead of adding it twice. If you meant to add a different account, switch accounts in your browser first (or use a private window) and try again.`
    );
    this.accountLabel = accountLabel;
    this.existingName = existingName;
    this.name = "DuplicateOAuthAccountError";
  }
  accountLabel;
  existingName;
};
function planOAuthAccount(providerId, addAccount = false, registry = loadRegistry()) {
  const kind = providerKind(toOAuthRegistryId(providerId));
  const base = toOAuthRegistryId(kind);
  const ids = registry.providers.map((pr) => pr.id);
  if (addAccount) {
    if (!supportsAdditionalOAuthAccounts(kind)) {
      throw new Error(`A second ${kind} account is not available yet.`);
    }
    return { kind, registryId: ids.includes(base) ? nextInstanceId(base, ids) : base };
  }
  const registryId = toOAuthRegistryId(providerId);
  if (registryId !== base && !ids.includes(registryId)) {
    throw new Error(`Provider not found: ${providerId}`);
  }
  return { kind, registryId };
}
async function assertNewOAuthAccount(plan, cred) {
  const registry = loadRegistry();
  for (const other of registry.providers) {
    if (other.id === plan.registryId || other.authType !== "oauth" || providerKind(other.id) !== plan.kind) continue;
    const stored = await readStoredOAuthCredential(other.authRef);
    if (stored && sameOAuthAccount(plan.kind, cred, stored)) {
      throw new DuplicateOAuthAccountError(
        formatOAuthAccount(describeOAuthAccount({ kind: plan.kind, accountId: cred.accountId, providerData: cred.providerData, accessToken: cred.access })),
        other.name
      );
    }
  }
}
async function saveNativeOAuthCredential(providerId, tokens, accountId, providerData, opts = {}) {
  const plan = planOAuthAccount(providerId, opts.addAccount === true);
  const cred = tokensToStoredCredential(tokens, void 0, accountId, providerData);
  await assertNewOAuthAccount(plan, cred);
  let diagMsg = "";
  const saved = await saveProviderCredential(
    oauthAuthRef(plan.registryId),
    oauthCredentialToKeychainJson(cred),
    (msg) => {
      diagMsg = msg;
    }
  );
  if (!saved) throw new Error(`Could not save OAuth tokens to credential store${diagMsg ? ` \u2014 ${diagMsg}` : " \u2014 grant Keychain access or check RELAY_AI_HOME is writable"}`);
  await upsertOAuthProvider(plan, cred);
  return plan.registryId;
}
function oauthDisplayName(registryId, fallbackName) {
  if (registryId === "openai-oauth") return "OpenAI (ChatGPT)";
  if (registryId === "xai-oauth") return "xAI (SuperGrok)";
  return fallbackName;
}
async function upsertOAuthProvider(plan, cred) {
  const { kind, registryId } = plan;
  const templateId = kind.replace(/-oauth$/, "") || kind;
  const registry = loadRegistry();
  const authRef = oauthAuthRef(registryId);
  const template = getTemplateById(templateId) ?? getTemplateById(registryId);
  let entry = registry.providers.find((pr) => pr.id === registryId);
  const previousAuthRef = entry?.authRef;
  if (!entry) {
    if (!template) {
      throw new Error(`Provider "${registryId}" is not in your registry and has no template`);
    }
    const stockName = oauthDisplayName(toOAuthRegistryId(kind), template.name);
    const displayName = uniqueProviderName(registry.providers, stockName);
    entry = {
      id: registryId,
      templateId: template.id,
      name: displayName,
      ...displayName !== stockName ? { nameCustomized: true } : {},
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
  const kind = providerKind(toOAuthRegistryId(providerId));
  if (!supportsNativeOAuth(kind)) {
    throw new Error(
      `OAuth for "${providerId}" is not built into relay-ai. Add an API-key provider with relay-ai providers add, or run relay-ai providers import if you already configured it in the OpenCode CLI.`
    );
  }
  if (options.method === "broker") {
    throw new Error(
      "OpenCode auth broker is no longer used for providers. Use the built-in OAuth flow, or relay-ai providers import for OpenCode CLI configs."
    );
  }
  const plan = planOAuthAccount(providerId, options.addAccount === true);
  const registryId = plan.registryId;
  const cred = isBrowserRedirectOAuth(kind) ? await runNativeBrowserOAuth(kind) : await runNativeDeviceCode(kind);
  await assertNewOAuthAccount(plan, cred);
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
  const registryProvider = await upsertOAuthProvider(plan, cred);
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
  relay-ai providers auth <id>          sign in (replaces that account if it already exists)
  relay-ai providers auth <id> --new    sign in an additional account (any provider below)
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
import { copyFileSync, existsSync as existsSync2, mkdirSync as mkdirSync2, readdirSync as readdirSync2, realpathSync, statSync } from "fs";
import { homedir } from "os";
import { dirname, join as join3, win32 as winPath } from "path";
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
    join3(homedir(), "Applications", `${name}.app`)
  ]);
}
function linuxCodexAppCandidates(home = homedir()) {
  return [
    "/usr/bin/chatgpt",
    "/usr/lib/chatgpt/ChatGPT",
    "/opt/chatgpt/ChatGPT",
    "/usr/local/lib/chatgpt/ChatGPT",
    join3(home, ".local", "bin", "chatgpt"),
    join3(home, ".local", "share", "chatgpt", "ChatGPT")
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
    join3(dirname(resolvedPath), "resources", "codex"),
    join3(dirname(appPath), "resources", "codex")
  ])];
}
function winLocalAppData() {
  return process.env.LOCALAPPDATA ?? join3(homedir(), "AppData", "Local");
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
function windowsEmbeddedCodexCachePath(sourcePath, home = homedir()) {
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
    if (existsSync2(cachePath2) && statSync(cachePath2).size === sourceSize) return cachePath2;
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
    join3(local, "Programs", name),
    join3(local, "Programs", `OpenAI ${name}`),
    join3(local, name),
    join3(local, `OpenAI ${name}`),
    join3(local, "OpenAI", name)
  ]);
  bases.push(join3(local, "openai-codex-electron"), join3(local, "openai-chatgpt-electron"));
  const out = [];
  for (const base of bases) {
    for (const name of WIN_APP_NAMES) {
      out.push(join3(base, `${name}.exe`));
    }
    try {
      if (existsSync2(base)) {
        for (const dir of readdirSync2(base)) {
          if (dir.startsWith("app-")) {
            for (const name of WIN_APP_NAMES) {
              out.push(join3(base, dir, `${name}.exe`));
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
    return first && existsSync2(first) ? first : null;
  } catch {
    return null;
  }
}
function findCodexApp(platform = process.platform) {
  if (platform === "darwin") {
    for (const path of darwinAppCandidates()) {
      if (existsSync2(path)) return path;
    }
    return mdfindCodexApp();
  }
  if (platform === "win32") {
    for (const path of winCodexExeCandidates()) {
      try {
        if (existsSync2(path) && statSync(path).isFile()) return path;
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
    return linuxCodexAppCandidates().find((path) => existsSync2(path)) ?? null;
  }
  return null;
}
function findEmbeddedCodexBinary(platform = process.platform, appPath = findCodexApp(platform)) {
  if (platform === "darwin") {
    if (!appPath) return null;
    return [
      join3(appPath, "Contents", "Resources", "codex-cli", "bin", "codex"),
      join3(appPath, "Contents", "Resources", "codex")
    ].find((binary) => existsSync2(binary)) ?? null;
  }
  if (platform === "linux") {
    if (!appPath) return null;
    return linuxEmbeddedCodexCandidates(appPath).find((path) => existsSync2(path)) ?? null;
  }
  if (platform === "win32") {
    const sourcePath = windowsEmbeddedCodexCandidates(appPath, winCodexPackageInstallLocations()).find((path) => {
      try {
        return existsSync2(path) && statSync(path).isFile();
      } catch {
        return false;
      }
    });
    return sourcePath ? executableWindowsEmbeddedCodexPath(sourcePath) : null;
  }
  return null;
}
function darwinIsRunning() {
  if (findCodexApp("darwin")) return darwinMatchingPids().length > 0;
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
  return DARWIN_APP_NAMES.map((name) => join3(appPath, "Contents", "MacOS", name));
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
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function waitForOriginalCodexPids(originalPids, timeoutMs, alive = pidIsAlive) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (originalPids.every((pid) => !alive(pid))) return true;
    await sleep(200);
  }
  return originalPids.every((pid) => !alive(pid));
}
async function waitForCodexAppQuit(timeoutMs = gracefulQuitTimeoutMs(process.platform)) {
  const originalPids = codexAppMainPids();
  if (originalPids.length > 0) {
    const exited = await waitForOriginalCodexPids(originalPids, timeoutMs);
    return exited && !isCodexAppRunning();
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isCodexAppRunning()) return true;
    await sleep(200);
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
import { existsSync as existsSync3, readdirSync as readdirSync3, readFileSync as readFileSync2, statSync as statSync2 } from "fs";
import { homedir as homedir2 } from "os";
import { join as join4 } from "path";
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
    join4(homedir2(), "Applications", "Claude.app")
  ];
}
function winLocalAppData2() {
  return process.env.LOCALAPPDATA ?? join4(homedir2(), "AppData", "Local");
}
function winClaudeExeCandidates() {
  const local = winLocalAppData2();
  const bases = [
    // Squirrel install folder used by the Anthropic Claude desktop installer.
    join4(local, "AnthropicClaude"),
    join4(local, "Programs", "Claude"),
    join4(local, "Claude")
  ];
  const out = [];
  for (const base of bases) {
    out.push(join4(base, "Claude.exe"));
    try {
      if (existsSync3(base)) {
        for (const name of readdirSync3(base)) {
          if (name.startsWith("app-")) {
            out.push(join4(base, name, "Claude.exe"));
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
    join4(homedir2(), ".local", "bin", "claude-desktop")
  ];
}
function linuxWhichClaude() {
  try {
    const out = run2("command -v claude-desktop");
    return out && existsSync3(out) ? out : null;
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
      const cmdline = readFileSync2(`/proc/${pid}/cmdline`, "utf8");
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
    return first && existsSync3(first) ? first : null;
  } catch {
    return null;
  }
}
function findClaudeApp() {
  if (process.platform === "darwin") {
    for (const path of darwinAppCandidates2()) {
      if (existsSync3(path)) return path;
    }
    return mdfindClaudeApp();
  }
  if (process.platform === "win32") {
    for (const path of winClaudeExeCandidates()) {
      try {
        if (existsSync3(path) && statSync2(path).isFile()) return path;
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
        if (existsSync3(path)) return path;
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
function sleep2(ms) {
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
    await sleep2(200);
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
  subscriptionOAuthRiskLines,
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
  fmtContextWindow,
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
  poolFailure,
  CLAUDE_POOL_MODEL_ID,
  ClaudePoolRuntime,
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
  aliasModelId,
  startProxyCatalog,
  startProxy,
  translateResponsesRequest,
  streamResponsesResponse,
  generateResponsesResponse,
  decodeCompactionContent,
  appendCompactionInstruction,
  generateCompactionResponse,
  streamCompactionResponse,
  writeResponsesErrorStream,
  preparePoolHistory,
  FREE_POOL_MODEL_ID,
  FREE_POOL_PROVIDER_ID,
  CodexPoolRuntime,
  poolCatalogEntry,
  codexPoolCatalogEntry,
  codexPoolCatalogModel,
  localModelToRoute,
  makeRouteResolver,
  buildCatalogRoutes,
  hostFromHeader,
  resolveAdvertiseAddresses,
  resolveAdvertiseGatewayPort,
  formatGatewayUrls,
  startServer,
  filterServerModelsByProviders,
  filterServerModelsByFavorites,
  filterServerModelsByFreeStatus,
  summarizeServerProviders,
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
  readOAuthAccountLabel,
  checkVertexModelAccess,
  filterVertexModelsByAccess,
  addProviderFromTemplate,
  claudeCodeProviderData,
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
//# sourceMappingURL=chunk-4RZRJRHO.js.map