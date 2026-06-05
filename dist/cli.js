#!/usr/bin/env node

// src/cli.ts
import pc2 from "picocolors";
import * as p2 from "@clack/prompts";
import { appendFileSync, readFileSync as readFileSync2, existsSync as existsSync2 } from "fs";
import { homedir as homedir3, tmpdir } from "os";
import { join as join3 } from "path";
import { execSync as execSync2 } from "child_process";

// src/launch.ts
import { execSync, spawn } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
var FALLBACK_PATHS = [
  join(homedir(), ".local", "bin", "claude"),
  join(homedir(), ".npm", "bin", "claude"),
  "/usr/local/bin/claude",
  "/opt/homebrew/bin/claude"
];
function findClaudeBinary() {
  try {
    const result = execSync("which claude", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"]
    });
    const path = result.trim();
    if (path) return path;
  } catch {
  }
  for (const path of FALLBACK_PATHS) {
    if (existsSync(path)) return path;
  }
  return null;
}
function launchClaude(env, model, extraArgs) {
  return new Promise((resolve) => {
    const claudePath = findClaudeBinary();
    const args = ["--model", model, ...extraArgs];
    const child = spawn(claudePath, args, {
      stdio: "inherit",
      env
    });
    const forward = (signal) => {
      child.kill(signal);
    };
    process.once("SIGINT", () => forward("SIGINT"));
    process.once("SIGTERM", () => forward("SIGTERM"));
    child.on("exit", (code) => {
      resolve(code ?? 0);
    });
  });
}

// src/constants.ts
import { homedir as homedir2 } from "os";
import { join as join2 } from "path";
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
var OPENCODE_CACHE_PATH = join2(homedir2(), ".cache", "opencode", "models.json");
var MODELS_CACHE_TTL_MS = 60 * 60 * 1e3;
var VERSION = "0.1.0";

// src/env.ts
function detectConflicts() {
  return CONFLICTING_ENV_VARS.filter((name) => process.env[name] !== void 0).map((name) => ({ name, value: process.env[name] }));
}
function resolveApiKey() {
  const key = process.env["OPENCODE_API_KEY"];
  return key?.trim() || null;
}
function buildChildEnv(backend, model, apiKey) {
  const env = { ...process.env };
  for (const name of CONFLICTING_ENV_VARS) {
    delete env[name];
  }
  env["ANTHROPIC_BASE_URL"] = backend.baseUrl;
  env["ANTHROPIC_API_KEY"] = apiKey;
  env["ANTHROPIC_MODEL"] = model;
  return env;
}

// src/models.ts
import { readFileSync } from "fs";
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
function readModelsFromCache(backendId) {
  try {
    const raw = readFileSync(OPENCODE_CACHE_PATH, "utf8");
    const cache = JSON.parse(raw);
    const providerKey = backendId === "zen" ? "opencode" : "opencode-go";
    const providerData = cache[providerKey];
    if (!providerData?.models) return null;
    const result = /* @__PURE__ */ new Map();
    for (const entry of Object.values(providerData.models)) {
      if (entry.status === "deprecated") continue;
      const isFree = entry.cost !== void 0 && entry.cost.input === 0 && entry.cost.output === 0;
      const isAnthropicNative = entry.provider?.npm === "@ai-sdk/anthropic";
      result.set(entry.id, {
        id: entry.id,
        name: entry.name ?? entry.id,
        isFree,
        brand: deriveBrand(entry.family ?? ""),
        isAnthropicNative,
        sourceBackend: backendId,
        cost: entry.cost
      });
    }
    return result;
  } catch {
    return null;
  }
}
async function fetchModelsFromApi(backend) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5e3);
  try {
    const res = await fetch(`${backend.baseUrl}/models`, {
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
  return apiIds.map((id) => {
    const cached = cache?.get(id);
    return cached ?? {
      id,
      name: id,
      isFree: false,
      brand: "Other",
      isAnthropicNative: false,
      sourceBackend: backendId
    };
  });
}
function groupModels(models) {
  const free = models.filter((m) => m.isFree).sort((a, b) => a.id.localeCompare(b.id));
  const byBrand = /* @__PURE__ */ new Map();
  for (const m of models.filter((m2) => !m2.isFree)) {
    const list = byBrand.get(m.brand) ?? [];
    list.push(m);
    byBrand.set(m.brand, list);
  }
  for (const [brand, list] of byBrand) {
    byBrand.set(brand, list.sort((a, b) => a.id.localeCompare(b.id)));
  }
  return { free, byBrand };
}
async function getModels(backend, fallbackModels) {
  const cache = readModelsFromCache(backend.id);
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

// src/config.ts
import Conf from "conf";
var store = new Conf({
  projectName: "opencode-starter",
  defaults: {}
});
function loadPreferences() {
  return {
    lastBackend: store.get("lastBackend"),
    lastModel: store.get("lastModel"),
    modelListCache: store.get("modelListCache")
  };
}
function savePreferences(prefs) {
  if (prefs.lastBackend !== void 0) store.set("lastBackend", prefs.lastBackend);
  if (prefs.lastModel !== void 0) store.set("lastModel", prefs.lastModel);
}
function getCachedModels(backendId) {
  const modelListCache = store.get("modelListCache");
  const entry = modelListCache?.[backendId];
  if (!entry) return null;
  const age = Date.now() - new Date(entry.fetchedAt).getTime();
  if (age > MODELS_CACHE_TTL_MS) return null;
  return entry.models;
}
function setCachedModels(backendId, models) {
  const existing = store.get("modelListCache") ?? {};
  store.set("modelListCache", {
    ...existing,
    [backendId]: { models, fetchedAt: (/* @__PURE__ */ new Date()).toISOString() }
  });
}
function getSubscriptionTier() {
  return store.get("subscriptionTier") ?? null;
}
function setSubscriptionTier(tier) {
  store.set("subscriptionTier", tier);
}

// src/prompts.ts
import * as p from "@clack/prompts";
import pc from "picocolors";
function modelLabel(model, showBackendBadge = false) {
  if (model.isFree) {
    const tag = showBackendBadge ? "(free \xB7 Zen)" : "(free)";
    return pc.green(`${model.name} ${tag}`);
  }
  return model.name;
}
function modelHint(model) {
  const parts = [];
  if (!model.isAnthropicNative) parts.push("translated");
  if (!model.isFree) parts.push(`${model.brand} \xB7 ${model.id}`);
  else parts.push(model.id);
  return parts.join(" \xB7 ");
}
async function askSubscriptionTier() {
  const tier = await p.select({
    message: "What OpenCode subscription do you have?",
    options: [
      {
        value: "free",
        label: "Free only",
        hint: "Zen free models only \u2014 no subscription needed"
      },
      {
        value: "zen",
        label: "Zen subscription",
        hint: "All Zen models (paid + free)"
      },
      {
        value: "go",
        label: "Go subscription",
        hint: "All Go models"
      },
      {
        value: "both",
        label: "Both (Zen + Go)",
        hint: "All Go models + all Zen models \u2014 choose backend each launch"
      }
    ],
    initialValue: "free"
  });
  if (p.isCancel(tier)) {
    p.cancel("Cancelled.");
    return null;
  }
  return tier;
}
async function runWizard(prefs, modelsByBackend, conflicts, tier) {
  p.intro(pc.bold("  OpenCode Starter"));
  let selectorBackendId = null;
  if (tier === "both") {
    const backendId = await p.select({
      message: "Which backend?",
      options: [
        { value: "zen", label: "OpenCode Zen", hint: "66+ models, free tier available" },
        { value: "go", label: "OpenCode Go", hint: "17 models, subscription ($10/mo)" }
      ],
      initialValue: prefs.lastBackend ?? "zen"
    });
    if (p.isCancel(backendId)) {
      p.cancel("Cancelled.");
      return null;
    }
    selectorBackendId = backendId;
  }
  const showBackendBadge = tier === "go";
  let models;
  if (tier === "free") {
    models = modelsByBackend.zen.filter((m) => m.isFree);
  } else if (tier === "zen") {
    models = modelsByBackend.zen;
  } else if (tier === "go") {
    const zenFree = modelsByBackend.zen.filter((m) => m.isFree);
    models = [...zenFree, ...modelsByBackend.go];
  } else {
    models = selectorBackendId === "go" ? modelsByBackend.go : modelsByBackend.zen;
  }
  const { free, byBrand } = groupModels(models);
  const options = [];
  for (const m of free) {
    options.push({ value: m.id, label: modelLabel(m, showBackendBadge), hint: modelHint(m) });
  }
  const brandOrder = ["Claude", "GPT", "Gemini", "DeepSeek", "Qwen", "MiniMax", "Kimi", "GLM", "MiMo", "Grok", "Nemotron", "Other"];
  const sortedBrands = [...byBrand.keys()].sort(
    (a, b) => (brandOrder.indexOf(a) !== -1 ? brandOrder.indexOf(a) : 99) - (brandOrder.indexOf(b) !== -1 ? brandOrder.indexOf(b) : 99)
  );
  for (const brand of sortedBrands) {
    for (const m of byBrand.get(brand) ?? []) {
      options.push({ value: m.id, label: modelLabel(m), hint: modelHint(m) });
    }
  }
  if (options.length === 0) {
    p.cancel("No models available for this backend and subscription tier.");
    return null;
  }
  const defaultModel = prefs.lastModel && options.some((o) => o.value === prefs.lastModel) ? prefs.lastModel : options[0]?.value;
  const modelId = await p.select({
    message: "Which model?",
    options,
    initialValue: defaultModel
  });
  if (p.isCancel(modelId)) {
    p.cancel("Cancelled.");
    return null;
  }
  const selectedModel = models.find((m) => m.id === String(modelId));
  const backend = BACKENDS[selectedModel.sourceBackend];
  if (conflicts.length > 0) {
    const lines = conflicts.map((c) => `  ${pc.dim(c.name)}=${pc.dim(c.value)}`).join("\n");
    p.note(lines, pc.yellow("Env vars that will be temporarily overridden:"));
  }
  const confirmed = await p.confirm({
    message: `Launch Claude Code \xB7 ${pc.bold(String(modelId))} via ${pc.bold(backend.name)}?`,
    initialValue: true
  });
  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel("Cancelled.");
    return null;
  }
  p.outro(pc.green("Launching..."));
  return { backend, model: selectedModel };
}

// src/cli.ts
function parseArgs(args) {
  if (args.includes("--help") || args.includes("-h")) {
    return { showHelp: true, showVersion: false, dryRun: false, setup: false, trace: false, claudeArgs: [] };
  }
  if (args.includes("--version") || args.includes("-v")) {
    return { showVersion: true, showHelp: false, dryRun: false, setup: false, trace: false, claudeArgs: [] };
  }
  const dryRun = args.includes("--dry-run");
  const setup = args.includes("--setup");
  const trace = args.includes("--trace");
  const filteredArgs = args.filter((a) => a !== "--dry-run" && a !== "--setup" && a !== "--trace");
  const sep = filteredArgs.indexOf("--");
  return {
    showHelp: false,
    showVersion: false,
    dryRun,
    setup,
    trace,
    claudeArgs: sep >= 0 ? filteredArgs.slice(sep + 1) : []
  };
}
function printHelp() {
  console.log(`
${pc2.bold("opencode-starter")} v${VERSION}
Launch Claude Code with OpenCode Zen or Go as the Anthropic API backend.

${pc2.bold("Usage:")}
  opencode-starter [--dry-run] [--setup] [-- <claude-flags>]
  opencode-starter --help
  opencode-starter --version

${pc2.bold("Flags:")}
  --dry-run    Run the wizard but show a preview instead of launching Claude Code
  --setup      Re-configure your subscription tier
  --trace      Write Claude Code debug logs to /tmp/opencode-starter-debug.log and show errors on exit

${pc2.bold("Setup:")}
  Get your API key at https://opencode.ai/settings/keys
  Then run: export OPENCODE_API_KEY="your-key"

${pc2.bold("Examples:")}
  opencode-starter
  opencode-starter --dry-run
  opencode-starter --setup
  opencode-starter -- --print "hello"
  opencode-starter -- --dangerously-skip-permissions
`);
}
function printDryRun(backendName, modelId, baseUrl, claudeArgs, conflicts, disableExperimentalBetas) {
  console.log("");
  console.log(pc2.bold(pc2.cyan("  DRY RUN \u2014 would execute:")));
  console.log("");
  const claudeCmd = ["claude", "--model", modelId, ...claudeArgs].join(" ");
  console.log(`  ${pc2.bold("Command:")}  ${claudeCmd}`);
  console.log(`  ${pc2.bold("Backend:")}  ${backendName}`);
  console.log("");
  console.log(`  ${pc2.bold("Env vars SET:")}`);
  console.log(`    ANTHROPIC_BASE_URL=${baseUrl}`);
  console.log(`    ANTHROPIC_API_KEY=<your OPENCODE_API_KEY>`);
  console.log(`    ANTHROPIC_MODEL=${modelId}`);
  if (disableExperimentalBetas) {
    console.log(`    CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1  ${pc2.dim("(auto-set: model uses protocol translation)")}`);
  }
  console.log("");
  if (conflicts.length > 0) {
    console.log(`  ${pc2.bold("Env vars REMOVED:")}`);
    for (const c of conflicts) {
      console.log(`    ${pc2.dim(c.name)}=${pc2.dim(c.value)}`);
    }
    console.log("");
  }
  console.log(pc2.dim("  (dry run complete \u2014 Claude Code was NOT launched)"));
  console.log("");
}
function detectShellProfile() {
  const shell = process.env["SHELL"] ?? "";
  if (shell.includes("zsh")) return { display: "~/.zshrc", path: `${homedir3()}/.zshrc` };
  if (shell.includes("bash")) {
    const profile = process.platform === "darwin" ? ".bash_profile" : ".bashrc";
    return { display: `~/${profile}`, path: `${homedir3()}/${profile}` };
  }
  return { display: "~/.profile", path: `${homedir3()}/.profile` };
}
function readFromKeychain() {
  try {
    const result = execSync2(
      "security find-generic-password -s opencode-starter -a opencode-starter -w",
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
    );
    return result.trim() || null;
  } catch {
    return null;
  }
}
function saveToKeychain(key) {
  try {
    execSync2(
      `security add-generic-password -s opencode-starter -a opencode-starter -w ${JSON.stringify(key)} -U`,
      { stdio: ["pipe", "pipe", "pipe"] }
    );
    return true;
  } catch {
    return false;
  }
}
async function resolveOrCollectApiKey(simulate = false) {
  if (!simulate) {
    const existing = resolveApiKey();
    if (existing) return existing;
  }
  const isMac = process.platform === "darwin";
  if (simulate) {
    p2.note(
      "Running in dry-run mode \u2014 no keys will be read from or written to your system.",
      "Simulating first-run onboarding"
    );
  }
  if (isMac && !simulate) {
    const checkKeychain = await p2.confirm({
      message: "OPENCODE_API_KEY not found. Check macOS Keychain for a stored key?",
      initialValue: true
    });
    if (p2.isCancel(checkKeychain)) {
      p2.cancel("Cancelled.");
      return null;
    }
    if (checkKeychain) {
      const keychainKey = readFromKeychain();
      if (keychainKey) {
        p2.log.success("Found key in macOS Keychain");
        process.env["OPENCODE_API_KEY"] = keychainKey;
        return keychainKey;
      }
      p2.log.info("No key found in Keychain \u2014 let's set one up");
    }
  }
  p2.note("Get your free key at: https://opencode.ai/settings/keys", "OpenCode API key");
  const key = await p2.password({
    message: "Paste your OPENCODE_API_KEY:",
    validate: (val) => val.trim() ? void 0 : "Key cannot be empty"
  });
  if (p2.isCancel(key)) {
    p2.cancel("Cancelled.");
    return null;
  }
  const trimmedKey = key.trim();
  const { display, path } = detectShellProfile();
  const saveOptions = isMac ? [
    {
      value: "keychain",
      label: `Keychain + ${display} auto-load`,
      hint: "Key stored encrypted in Keychain; shell reads it at startup via ~/.zshrc"
    },
    {
      value: "profile",
      label: `${display} only (plaintext)`,
      hint: "Key written directly to your shell profile \u2014 simpler but less secure"
    },
    {
      value: "session",
      label: "This session only",
      hint: "Not saved anywhere \u2014 you'll be asked again next time"
    }
  ] : [
    { value: "profile", label: display, hint: "Saved to your shell profile" },
    { value: "session", label: "This session only", hint: "Not saved \u2014 you'll be asked again next time" }
  ];
  const saveChoice = await p2.select({
    message: "Where should we save the key?",
    options: saveOptions,
    initialValue: isMac ? "keychain" : "profile"
  });
  if (p2.isCancel(saveChoice)) {
    p2.cancel("Cancelled.");
    return null;
  }
  if (simulate) {
    if (saveChoice === "keychain") {
      p2.log.info(`[dry-run] Would save key to macOS Keychain and add auto-load to ${display}`);
    } else if (saveChoice === "profile") {
      p2.log.info(`[dry-run] Would append OPENCODE_API_KEY export to ${display}`);
    } else {
      p2.log.info("[dry-run] Would use key for this session only");
    }
  } else if (saveChoice === "keychain") {
    if (saveToKeychain(trimmedKey)) {
      try {
        const autoLoadLine = `export OPENCODE_API_KEY="$(security find-generic-password -s opencode-starter -a opencode-starter -w 2>/dev/null)"`;
        const existing = readFileSync2(path, "utf8");
        if (!existing.includes(autoLoadLine)) {
          appendFileSync(path, `
# opencode-starter: load API key from macOS Keychain
${autoLoadLine}
`);
          p2.log.success(`Key saved to Keychain + auto-load added to ${display}`);
          p2.log.info(`Open a new terminal (or run \`source ${display}\`) to activate`);
        } else {
          p2.log.success("Key saved to Keychain");
          p2.log.info(`Auto-load line already exists in ${display}`);
        }
      } catch {
        p2.log.success("Key saved to Keychain");
        p2.log.warn(`Could not write auto-load line to ${display} \u2014 run \`source ${display}\` manually`);
      }
    } else {
      p2.log.warn("Could not write to Keychain \u2014 key will be used for this session only");
    }
  } else if (saveChoice === "profile") {
    try {
      appendFileSync(path, `
export OPENCODE_API_KEY="${trimmedKey}"
`);
      p2.log.success(`Saved to ${display} \u2014 open a new terminal to pick it up automatically`);
    } catch {
      p2.log.warn(`Could not write to ${display} \u2014 key will be used for this session only`);
    }
  }
  if (!simulate) process.env["OPENCODE_API_KEY"] = trimmedKey;
  return trimmedKey;
}
async function main() {
  const { showHelp, showVersion, dryRun, setup, trace, claudeArgs } = parseArgs(process.argv.slice(2));
  if (showHelp) {
    printHelp();
    return;
  }
  if (showVersion) {
    console.log(VERSION);
    return;
  }
  const claudePath = findClaudeBinary();
  if (!claudePath) {
    console.error(pc2.red("\nError: claude binary not found on PATH.\n"));
    console.error("Install Claude Code:");
    console.error("  npm install -g @anthropic-ai/claude-code\n");
    process.exit(1);
  }
  const apiKey = await resolveOrCollectApiKey(dryRun);
  if (!apiKey && !dryRun) process.exit(0);
  const effectiveKey = apiKey ?? "dry-run-placeholder";
  const prefs = dryRun ? {} : loadPreferences();
  const conflicts = detectConflicts();
  let tier = dryRun ? null : getSubscriptionTier();
  if (!tier || setup) {
    tier = await askSubscriptionTier();
    if (!tier) process.exit(0);
    if (!dryRun) setSubscriptionTier(tier);
  }
  const needsZen = tier === "free" || tier === "zen" || tier === "go" || tier === "both";
  const needsGo = tier === "go" || tier === "both";
  const spinner2 = p2.spinner();
  spinner2.start("Fetching available models...");
  let zenModels = [];
  let goModels = [];
  try {
    if (needsZen) {
      const cachedZen = getCachedModels("zen") ?? void 0;
      const result = await getModels(BACKENDS.zen, cachedZen);
      zenModels = result.models;
      if (!result.fromCache && !dryRun) setCachedModels("zen", zenModels);
    }
    if (needsGo) {
      const cachedGo = getCachedModels("go") ?? void 0;
      const result = await getModels(BACKENDS.go, cachedGo);
      goModels = result.models;
      if (!result.fromCache && !dryRun) setCachedModels("go", goModels);
    }
    const total = zenModels.length + goModels.length;
    spinner2.stop(`Loaded ${total} models`);
  } catch (err) {
    spinner2.stop(pc2.red("Failed to load models"));
    console.error(pc2.red(String(err instanceof Error ? err.message : err)));
    process.exit(1);
  }
  const selection = await runWizard(prefs, { zen: zenModels, go: goModels }, conflicts, tier);
  if (!selection) process.exit(0);
  if (!dryRun) savePreferences({ lastBackend: selection.backend.id, lastModel: selection.model.id });
  const disableExperimentalBetas = true;
  if (dryRun) {
    printDryRun(
      selection.backend.name,
      selection.model.id,
      selection.backend.baseUrl,
      claudeArgs,
      conflicts,
      disableExperimentalBetas
    );
    return;
  }
  const childEnv = buildChildEnv(selection.backend, selection.model.id, effectiveKey);
  childEnv["CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS"] = "1";
  const debugLogPath = join3(tmpdir(), "opencode-starter-debug.log");
  const traceArgs = trace ? ["--debug-file", debugLogPath] : [];
  if (trace) {
    p2.log.info(`Debug log: ${debugLogPath}`);
  }
  const exitCode = await launchClaude(childEnv, selection.model.id, [...traceArgs, ...claudeArgs]);
  if (trace && existsSync2(debugLogPath)) {
    const log2 = readFileSync2(debugLogPath, "utf8");
    const errorLines = log2.split("\n").filter(
      (l) => l.includes("error") || l.includes("Error") || l.includes('"type":"error"') || l.includes("status")
    );
    console.log("\n" + pc2.bold(pc2.cyan("\u2500\u2500 Debug trace \u2500\u2500")));
    if (errorLines.length > 0) {
      errorLines.slice(0, 30).forEach((l) => console.log(pc2.dim(l)));
    } else {
      console.log(pc2.dim("(no errors found in debug log)"));
    }
    console.log(pc2.dim(`Full log: ${debugLogPath}`));
  }
  process.exit(exitCode);
}
main().catch((err) => {
  if (err === /* @__PURE__ */ Symbol.for("clack:cancel")) {
    process.exit(0);
  }
  console.error(pc2.red("\nUnexpected error:"), err);
  process.exit(1);
});
//# sourceMappingURL=cli.js.map