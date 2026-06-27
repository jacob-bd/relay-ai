#!/usr/bin/env node
import {
  ANTIGRAVITY_BASE_URLS,
  BACKENDS,
  CODEX_APP_PROVIDER_ID,
  GLOBAL_OPENCODE_KEYRING_ACCOUNT,
  MAX_MODEL_CATALOG,
  PREVIEW_PROXY_PORT,
  VERSION,
  VERTEX_ANTHROPIC_NPM,
  addCustomEndpointProvider,
  addGoRegistryStub,
  addProviderFromTemplate,
  addZenRegistryStub,
  authenticateProvider,
  buildAntigravityChildEnv,
  buildAppCatalogFile,
  buildCatalogFile,
  buildChildEnv,
  buildCodexAppRootConfig,
  buildImportProviderList,
  catalogEntryFromModel,
  claudeCodeClientModelId,
  codexAppModelSlug,
  confirmLaunchMessage,
  createLanguageModel,
  deepMergeProviderOptions,
  detectConflicts,
  effectiveProviderBaseUrl,
  effortProviderOptions,
  extractApiKey,
  fetchAnthropicModels,
  fetchProviderCatalog,
  fetchRawOpencodeProviders,
  fetchTemplateModels,
  findClaudeBinary,
  findOpencodeBinary,
  fmtCommand,
  fmtCount,
  fmtEnabledStar,
  fmtModel,
  fmtProvider,
  fmtProviderBracket,
  fmtUrl,
  formatCodexModelLabel,
  formatRegistryAuthLabel,
  getAppHome,
  getClaudeDebugLogPath,
  getCodexProxyDebugLogPath,
  getConfigPath,
  getGeminiProxyDebugLogPath,
  getProvidersPath,
  getProxyDebugLogPath,
  getReasoningCapabilities,
  getSavedServerPassword,
  getServerExposedProviders,
  getServerFavoritesOnly,
  getServerMaskGatewayIds,
  getVertexModelsPath,
  isLikelyPlaceholderKey,
  isOAuthImportProvider,
  isSdkMigratedNpm,
  isSecretServiceAvailable,
  isValidProviderId,
  launchClaude,
  listCredentialSkippedProviders,
  loadPreferences,
  loadRegistry,
  localProviderToRegistry,
  localProvidersToServerModels,
  logActiveModel,
  logConnected,
  logProxy,
  makeTraceLogger,
  migrateGlobalOpencodeCredential,
  migrateLegacyCloudProviders,
  modelSelectOption,
  navOption,
  oauthAuthRef,
  oauthCredentialToKeychainJson,
  parseCodexAppModelSlug,
  prepareClaudeTraceLog,
  printApiKeyPanel,
  printCloudProviderPanel,
  printDryRunPanel,
  printEnvConflictPanel,
  printFavoritesOnlyPanel,
  printImportConflictPanel,
  printNetworkWarningPanel,
  printPanel,
  printProviderDetailPanel,
  printTraceLog,
  printWelcomePanel,
  providerAuthHelpText,
  providerSelectOption,
  providersForPicker,
  readBody,
  readFromCredentialStore,
  readGlobalOpencodeCredential,
  readOpencodeAuthFile,
  recordLaunchSelection,
  redactTraceLine,
  refreshAllProviderModels,
  refreshModelsDevCacheAsync,
  refreshProviderModels,
  relayIntro,
  relayOutro,
  removeProviderFromRegistry,
  resetTraceLog,
  resolveApiKey,
  resolveContextWindow,
  resolveLocalProviderApiKey,
  resolveModelSource,
  resolveProviderCredential,
  resolveProviderTemplate,
  resolveProvidersForDisplay,
  resolveRefreshCredential,
  routeLookupIds,
  savePreferences,
  saveProviderCredential,
  saveRegistry,
  saveToCredentialStore,
  sendJson,
  serializeCatalog,
  setSavedServerPassword,
  setServerExposedProviders,
  setServerFavoritesOnly,
  setServerMaskGatewayIds,
  shouldHideModel,
  stripOneMContextSuffix,
  supportsNativeOAuth,
  syntheticTemplate,
  thinkingProviderOptions,
  toggleProviderEnabled,
  validateCustomEndpointUrl,
  writeSecureLogLine,
  zenGoModelsToServerModels,
  zenRegistryStub
} from "./chunk-A3XL2JCU.js";
import {
  filterTemplates,
  listAddableTemplates,
  listSupportedTemplates
} from "./chunk-WDZWORL4.js";

// src/cli.ts
import pc15 from "picocolors";
import * as p19 from "@clack/prompts";
import { realpathSync } from "fs";
import { fileURLToPath } from "url";

// src/first-run.ts
import pc from "picocolors";
import * as p2 from "@clack/prompts";

// src/registry/validate-import-key.ts
function reject(reason, detail) {
  return { canImport: false, reason, detail };
}
async function validateImportKey(lp, entry) {
  if (entry.authType === "oauth") {
    return { canImport: true };
  }
  const key = lp.apiKey?.trim() ?? "";
  if (!key) {
    return reject("invalid-key", "No API key in OpenCode config.");
  }
  const source = resolveModelSource(entry);
  if (source === "manual-only") {
    return reject(
      "untested-manual",
      "Provider uses gcloud/AWS/Azure auth \u2014 configure via OpenCode env auth, not API key import."
    );
  }
  if (source === "zen-go-api") {
    return { canImport: true };
  }
  const placeholder = isLikelyPlaceholderKey(key);
  const npm = entry.api.npm ?? lp.models[0]?.npm ?? "@ai-sdk/openai-compatible";
  const catalogTemplate = resolveProviderTemplate(entry);
  const baseUrl = effectiveProviderBaseUrl(entry, catalogTemplate);
  if (!baseUrl) {
    if (placeholder) {
      return reject(
        "placeholder-key",
        "OpenCode has a placeholder key and no API URL \u2014 provider not imported."
      );
    }
    return reject("invalid-key", "No API base URL \u2014 cannot verify key.");
  }
  let safeBaseUrl = baseUrl;
  const configuredUrl = entry.api.url?.trim();
  const templateDefault = catalogTemplate?.defaultBaseUrl?.trim();
  if (configuredUrl && configuredUrl !== templateDefault) {
    const urlCheck = await validateCustomEndpointUrl(baseUrl, {
      allowInsecureLocal: catalogTemplate?.apiKeyOptional === true
    });
    if (!urlCheck.ok || !urlCheck.normalizedUrl) {
      return reject("invalid-key", `${urlCheck.error ?? "Invalid API base URL."} ${urlCheck.hint ?? ""}`.trim());
    }
    safeBaseUrl = urlCheck.normalizedUrl;
  }
  if (npm === "@ai-sdk/anthropic") {
    const result2 = await fetchAnthropicModels(safeBaseUrl, key);
    if (result2.error) {
      return reject(
        placeholder ? "placeholder-key" : "invalid-key",
        placeholder ? "OpenCode has a placeholder key \u2014 API rejected it; provider not imported." : result2.error
      );
    }
    return { canImport: true };
  }
  const template = catalogTemplate ?? syntheticTemplate(entry, safeBaseUrl);
  const result = await fetchTemplateModels(template, key, safeBaseUrl);
  if (result.error) {
    return reject(
      placeholder ? "placeholder-key" : "invalid-key",
      placeholder ? "OpenCode has a placeholder key \u2014 API rejected it; provider not imported." : result.error
    );
  }
  return { canImport: true };
}

// src/registry/import-opencode.ts
async function saveProviderKey(provider) {
  if (!provider.apiKey?.trim()) return false;
  return saveProviderCredential(`keyring:provider:${provider.id}`, provider.apiKey);
}
async function saveOAuthKey(providerId, oauth) {
  const cred = oauth.oauthByProviderId.get(providerId);
  if (!cred) return false;
  return saveProviderCredential(oauthAuthRef(providerId), oauthCredentialToKeychainJson(cred));
}
function importValidationSkipReason(reason) {
  if (reason === "untested-manual") return "manual-only";
  if (reason === "placeholder-key") return "placeholder-key";
  if (reason === "invalid-key") return "invalid-key";
  return "no-api-key";
}
async function keyHint(providerId, authRef, opts) {
  if (opts?.oauth) return "Signed in via OAuth (OpenCode)";
  const fromStore = await resolveProviderCredential(providerId, authRef);
  const key = fromStore ?? opts?.fallbackKey ?? "";
  if (!key) return "no key";
  if (key.length <= 5) return "\xB7\xB7\xB7\xB7" + key;
  return "\xB7\xB7\xB7\xB7" + key.slice(-5);
}
async function importFromOpencode(options = {}) {
  const raw = await fetchRawOpencodeProviders();
  if (raw === null) {
    return {
      imported: [],
      skipped: [],
      keysSkipped: [],
      keysSaved: 0,
      oauthImported: 0,
      error: "OpenCode CLI not found or failed to start. Install from https://opencode.ai"
    };
  }
  const authFile = readOpencodeAuthFile();
  const authEntries = authFile?.entries ?? {};
  const { providers: fetched, oauth } = buildImportProviderList(raw, authEntries);
  const registry = loadRegistry();
  migrateLegacyCloudProviders(registry);
  const imported = [];
  const skipped = [];
  const keysSkipped = [];
  let keysSaved = 0;
  let oauthImported = 0;
  const importedIds = /* @__PURE__ */ new Set();
  for (const lp of fetched) {
    if (!lp.models.length) {
      skipped.push({ id: lp.id, name: lp.name, reason: "no-models" });
      continue;
    }
    const isOAuth = isOAuthImportProvider(lp.id, oauth);
    const entry = localProviderToRegistry(lp, isOAuth ? { authType: "oauth", authRef: oauthAuthRef(lp.id) } : void 0);
    if (!entry) {
      skipped.push({
        id: lp.id,
        name: lp.name,
        reason: isValidProviderId(lp.id) ? "convert-failed" : "invalid-id"
      });
      continue;
    }
    const keyCheck = await validateImportKey(lp, entry);
    if (!keyCheck.canImport) {
      skipped.push({
        id: lp.id,
        name: lp.name,
        reason: importValidationSkipReason(keyCheck.reason)
      });
      if (keyCheck.detail) {
        keysSkipped.push({
          id: lp.id,
          name: lp.name,
          reason: keyCheck.reason ?? "invalid-key",
          detail: keyCheck.detail
        });
      }
      continue;
    }
    const existingIdx = registry.providers.findIndex((p20) => p20.id === entry.id);
    const existing = existingIdx >= 0 ? registry.providers[existingIdx] : void 0;
    if (existing && options.resolveConflict) {
      const choice = await options.resolveConflict({
        existing,
        incoming: entry,
        incomingProvider: lp,
        existingKeyHint: await keyHint(existing.id, existing.authRef, { oauth: existing.authType === "oauth" }),
        incomingKeyHint: await keyHint(entry.id, entry.authRef, {
          fallbackKey: lp.apiKey,
          oauth: isOAuth
        })
      });
      if (choice === "skip") {
        skipped.push({ id: lp.id, name: lp.name, reason: "user-skipped" });
        continue;
      }
      if (choice === "keep") {
        skipped.push({ id: lp.id, name: lp.name, reason: "conflict-kept" });
        continue;
      }
    }
    const saved = isOAuth ? await saveOAuthKey(lp.id, oauth) : await saveProviderKey(lp);
    if (!saved) {
      skipped.push({ id: lp.id, name: lp.name, reason: "credential-save-failed" });
      continue;
    }
    if (existingIdx >= 0) {
      registry.providers[existingIdx] = { ...entry, addedAt: registry.providers[existingIdx].addedAt };
    } else {
      registry.providers.push(entry);
    }
    imported.push(entry);
    importedIds.add(lp.id);
    keysSaved += 1;
    if (isOAuth) oauthImported += 1;
  }
  const alreadyReportedIds = new Set(skipped.map((s) => s.id));
  const registryProviderIds = new Set(registry.providers.map((p20) => p20.id));
  for (const provider of listCredentialSkippedProviders(
    raw,
    authEntries,
    importedIds,
    alreadyReportedIds,
    registryProviderIds
  )) {
    skipped.push({ id: provider.id, name: provider.name, reason: provider.reason });
  }
  registry.importedAt = (/* @__PURE__ */ new Date()).toISOString();
  saveRegistry(registry);
  return {
    imported,
    skipped,
    keysSkipped,
    keysSaved,
    oauthImported,
    authFileWarning: authFile?.permissionWarning
  };
}

// src/key-setup.ts
import * as p from "@clack/prompts";
import { appendFileSync, readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { spawnSync } from "child_process";
function detectShellProfile() {
  const shell = process.env["SHELL"] ?? "";
  if (process.platform === "darwin") {
    if (shell.includes("zsh")) return { display: "~/.zshrc", path: `${homedir()}/.zshrc` };
    if (shell.includes("bash")) return { display: "~/.bash_profile", path: `${homedir()}/.bash_profile` };
    return { display: "~/.profile", path: `${homedir()}/.profile` };
  }
  if (process.platform === "linux") {
    if (shell.includes("zsh")) return { display: "~/.zshrc", path: `${homedir()}/.zshrc` };
    if (shell.includes("bash")) return { display: "~/.bashrc", path: `${homedir()}/.bashrc` };
    return { display: "~/.profile", path: `${homedir()}/.profile` };
  }
  if (shell.includes("bash")) return { display: "~/.bashrc", path: `${homedir()}/.bashrc` };
  return { display: "~/.profile", path: `${homedir()}/.profile` };
}
async function resolveOrCollectApiKey(simulate = false, trace = false) {
  if (!simulate) {
    const existing = resolveApiKey();
    if (existing) return existing;
  }
  const isMac = process.platform === "darwin";
  const isWindows4 = process.platform === "win32";
  const isLinux = process.platform === "linux";
  if (simulate) {
    printDryRunPanel();
  }
  if (!simulate) {
    const keyDiag = (reason) => {
      p.log.warn(`Credential store unavailable \u2014 ${reason}`);
      if (trace) {
        writeSecureLogLine(getClaudeDebugLogPath(), `keyring: ${reason}`);
      }
    };
    const storedKey = await readFromCredentialStore(keyDiag);
    if (storedKey) {
      const storeName = isMac ? "macOS Keychain" : isWindows4 ? "Windows Credential Manager" : "Secret Service";
      p.log.success(`Found key in ${storeName}`);
      process.env["OPENCODE_API_KEY"] = storedKey;
      return storedKey;
    }
  }
  printApiKeyPanel("https://opencode.ai/auth");
  const key = await p.password({
    message: "Paste your OPENCODE_API_KEY:",
    validate: (val) => val.trim() ? void 0 : "Key cannot be empty"
  });
  if (p.isCancel(key)) {
    p.cancel("Cancelled.");
    return null;
  }
  const trimmedKey = key.trim();
  let secretServiceAvailable = false;
  if (isLinux && !simulate) {
    secretServiceAvailable = await isSecretServiceAvailable();
  }
  const { display, path: path2 } = detectShellProfile();
  const saveOptions = (() => {
    if (isMac) {
      return [
        { value: "keychain", label: "Keychain only", hint: "Key stored encrypted in Keychain; relay-ai reads it automatically next time" },
        { value: "keychain-autoload", label: `Keychain + ${display} auto-load`, hint: `Key in Keychain; ${display} also exports it so all terminal tools can see it` },
        { value: "profile", label: `${display} only (plaintext)`, hint: "Key written directly to your shell profile \u2014 simpler but less secure" },
        { value: "session", label: "This session only", hint: "Not saved anywhere \u2014 you'll be asked again next time" }
      ];
    }
    if (isWindows4) {
      return [
        { value: "credential-manager", label: "Windows Credential Manager", hint: "Key stored securely; relay-ai reads it automatically next time" },
        { value: "setx", label: "Persistent environment variable (plaintext)", hint: "Runs setx \u2014 key visible in System Properties \u2192 Environment Variables" },
        { value: "session", label: "This session only", hint: "Not saved anywhere \u2014 you'll be asked again next time" }
      ];
    }
    const opts = [];
    if (secretServiceAvailable) {
      opts.push({ value: "secret-service", label: "Secret Service (GNOME Keyring / KWallet)", hint: "Key stored securely in your desktop keyring; relay-ai reads it automatically next time" });
    } else if (!simulate) {
      p.log.info("No keyring daemon detected \u2014 secure storage requires GNOME Keyring or KWallet running.");
    }
    opts.push(
      { value: "profile", label: `${display} (plaintext)`, hint: "Key written directly to your shell profile" },
      { value: "session", label: "This session only", hint: "Not saved anywhere \u2014 you'll be asked again next time" }
    );
    return opts;
  })();
  const saveChoice = await p.select({
    message: "Where should we save the key?",
    options: saveOptions,
    initialValue: isMac ? "keychain" : isWindows4 ? "credential-manager" : secretServiceAvailable ? "secret-service" : "profile"
  });
  if (p.isCancel(saveChoice)) {
    p.cancel("Cancelled.");
    return null;
  }
  if (simulate) {
    const dryRunMessages = {
      keychain: "Would save key to macOS Keychain",
      "keychain-autoload": `Would save key to macOS Keychain and add auto-load to ${display}`,
      "credential-manager": "Would save key to Windows Credential Manager",
      setx: "Would run: setx OPENCODE_API_KEY ***",
      "secret-service": "Would save key to Secret Service (GNOME Keyring / KWallet)",
      profile: `Would append OPENCODE_API_KEY export to ${display}`,
      session: "Would use key for this session only"
    };
    p.log.info(`[dry-run] ${dryRunMessages[saveChoice]}`);
  } else if (saveChoice === "keychain") {
    if (await saveToCredentialStore(trimmedKey)) {
      p.log.success("Key saved to macOS Keychain \u2014 active now and automatically loaded next time.");
    } else {
      p.log.warn("Could not write to Keychain \u2014 key will be used for this session only");
    }
  } else if (saveChoice === "keychain-autoload") {
    if (await saveToCredentialStore(trimmedKey)) {
      try {
        const autoLoadLine = `export OPENCODE_API_KEY="$(security find-generic-password -s relay-ai -a ${GLOBAL_OPENCODE_KEYRING_ACCOUNT} -w 2>/dev/null)"`;
        const existing = existsSync(path2) ? readFileSync(path2, "utf8") : "";
        if (!existing.includes(autoLoadLine)) {
          appendFileSync(path2, `
# relay-ai: load API key from macOS Keychain
${autoLoadLine}
`);
        }
        p.log.success(`Key saved to Keychain and auto-load added to ${display} \u2014 active now and in all future terminals.`);
      } catch {
        p.log.success("Key saved to Keychain \u2014 active now and automatically loaded next time.");
        p.log.warn(`Could not write auto-load line to ${display}`);
      }
    } else {
      p.log.warn("Could not write to Keychain \u2014 key will be used for this session only");
    }
  } else if (saveChoice === "credential-manager") {
    if (await saveToCredentialStore(trimmedKey)) {
      p.log.success("Key saved to Windows Credential Manager \u2014 active now and automatically loaded next time.");
    } else {
      p.log.warn("Could not write to Credential Manager \u2014 key will be used for this session only");
    }
  } else if (saveChoice === "setx") {
    try {
      const result = spawnSync("setx", ["OPENCODE_API_KEY", trimmedKey], { stdio: ["pipe", "pipe", "pipe"] });
      if (result.status !== 0) throw new Error("setx exited with non-zero status");
      p.log.success("Key saved as a user environment variable \u2014 active now and in all future terminals.");
    } catch {
      p.log.warn("Could not run setx \u2014 key will be used for this session only");
    }
  } else if (saveChoice === "secret-service") {
    if (await saveToCredentialStore(trimmedKey)) {
      p.log.success("Key saved to Secret Service \u2014 active now and automatically loaded next time.");
    } else {
      p.log.warn("Could not write to Secret Service \u2014 key will be used for this session only");
    }
  } else if (saveChoice === "profile") {
    try {
      if (!existsSync(path2)) appendFileSync(path2, "");
      const escapedKey = trimmedKey.replace(/'/g, "'\\''");
      appendFileSync(path2, `
export OPENCODE_API_KEY='${escapedKey}'
`);
      p.log.success(`Key saved to ${display} \u2014 active now and in all future terminals.`);
    } catch {
      p.log.warn(`Could not write to ${display} \u2014 key will be used for this session only`);
    }
  }
  if (!simulate) process.env["OPENCODE_API_KEY"] = trimmedKey;
  return trimmedKey;
}

// src/first-run.ts
async function needsFirstRunSetup() {
  const registry = loadRegistry();
  if (registry.providers.length > 0) return false;
  const key = await readGlobalOpencodeCredential();
  return !key;
}
function ensureZenRegistryStub() {
  const registry = loadRegistry();
  if (registry.providers.some((pr) => pr.id === "zen")) return;
  registry.providers.push(zenRegistryStub("free"));
  saveRegistry(registry);
}
async function runFirstRunWizard(trace = false) {
  printWelcomePanel();
  const hasOpencode = findOpencodeBinary() !== null;
  const options = [
    {
      value: "zen",
      label: pc.cyan("Quick start with OpenCode Zen (free)"),
      hint: "Enter your API key and pick a model \u2014 launches Claude Code"
    },
    {
      value: "providers",
      label: pc.cyan("Set up your own AI provider"),
      hint: hasOpencode ? "Import providers you configured in OpenCode" : "Import from OpenCode or add providers via relay-ai providers"
    }
  ];
  if (hasOpencode) {
    options.push({
      value: "import",
      label: pc.cyan("Bring settings from OpenCode"),
      hint: "One-time import of your OpenCode provider config"
    });
  }
  const choice = await p2.select({
    message: "How do you want to get started?",
    options
  });
  if (p2.isCancel(choice)) {
    p2.cancel("Cancelled.");
    return "cancel";
  }
  if (choice === "zen") {
    const apiKey = await resolveOrCollectApiKey(false, trace);
    if (!apiKey) return "cancel";
    await migrateGlobalOpencodeCredential();
    ensureZenRegistryStub();
    p2.log.success("OpenCode Zen ready \u2014 picking a model next.");
    return "continue";
  }
  if (choice === "import" || choice === "providers") {
    if (!hasOpencode && choice === "import") {
      p2.log.error("OpenCode CLI not found. Install from https://opencode.ai");
      return runFirstRunWizard(trace);
    }
    if (!hasOpencode) {
      p2.log.info("Run relay-ai providers to add providers, then relay-ai claude again.");
      p2.log.info("Quick start with Zen is the fastest path if you have an OpenCode API key.");
      const retry = await p2.select({
        message: "What next?",
        options: [
          { value: "zen", label: "Quick start with OpenCode Zen", hint: "" },
          { value: "cancel", label: "Cancel", hint: "" }
        ]
      });
      if (p2.isCancel(retry) || retry === "cancel") return "cancel";
      return runFirstRunWizard(trace);
    }
    const spinner10 = p2.spinner();
    spinner10.start("Importing from OpenCode...");
    const result = await importFromOpencode();
    spinner10.stop("");
    if (result.error) {
      p2.log.error(result.error);
      return runFirstRunWizard(trace);
    }
    if (result.imported.length === 0) {
      p2.log.warn("No providers imported. Configure providers in OpenCode first, or use Quick start with Zen.");
      return runFirstRunWizard(trace);
    }
    p2.log.success(
      `Imported ${result.imported.length} provider${result.imported.length === 1 ? "" : "s"}.`
    );
    return "continue";
  }
  return "continue";
}

// src/proxy.ts
import { createServer } from "http";
import { appendFileSync as appendFileSync2, openSync, writeSync, closeSync } from "fs";

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
function formatAnthropicModelEntry(id, displayName, contextWindow) {
  const maxInput = resolveContextWindow(id, contextWindow);
  return {
    id,
    type: "model",
    display_name: displayName,
    created_at: CREATED_AT_ISO,
    context_window: maxInput,
    max_input_tokens: maxInput
  };
}
function formatAnthropicModelList(entries) {
  return {
    data: entries.map((entry) => formatAnthropicModelEntry(entry.id, entry.name, entry.contextWindow)),
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
function exposedGatewayAliasId(model, opts) {
  const alias = gatewayAliasId(model);
  return opts?.maskGatewayIds ? maskGatewayModelId(alias) : alias;
}
function gatewayDisplayName(model, opts) {
  if (!opts?.maskGatewayIds) return model.name;
  return `${model.name} (${gatewayProviderLabel(model)})`;
}
function formatGatewayAnthropicModels(models, opts) {
  return formatAnthropicModelList(
    models.map((model) => ({
      id: exposedGatewayAliasId(model, opts),
      name: gatewayDisplayName(model, opts),
      contextWindow: model.contextWindow
    }))
  );
}
function createGatewayModelCatalog(models, opts) {
  const byId = /* @__PURE__ */ new Map();
  for (const model of models) {
    byId.set(model.id, model);
    const alias = exposedGatewayAliasId(model, opts);
    if (alias !== model.id) byId.set(alias, model);
    if (opts?.maskGatewayIds) {
      const rawAlias = gatewayAliasId(model);
      if (rawAlias !== alias) byId.set(rawAlias, model);
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
function supportsDirectOpenAIChatCompletions(model) {
  return model.modelFormat === "openai" && (!!model.completionsUrl || model.sourceBackend === "zen" || model.sourceBackend === "go");
}
function formatOpenAIModels(models) {
  return {
    object: "list",
    data: models.map((model) => ({
      id: model.id,
      object: "model",
      created: CREATED_AT_UNIX,
      owned_by: model.sourceBackend
    }))
  };
}

// src/upstream-forward.ts
import { Readable } from "stream";

// src/server/auth.ts
function sanitizeCredential(value) {
  if (!value) return null;
  const firstLine = value.trim().split(/\r?\n/)[0]?.trim();
  return firstLine || null;
}
function isAuthorized(request, serverPassword) {
  if (serverPassword === null) return true;
  const bearerToken = extractBearerToken(request.headers.get("authorization"));
  if (bearerToken === serverPassword) return true;
  return sanitizeCredential(request.headers.get("x-api-key")) === serverPassword;
}
function extractBearerToken(value) {
  if (!value) return null;
  const normalized = value.replace(/\r?\n/g, " ").trim();
  const match = /^Bearer\s+(\S+)/i.exec(normalized);
  return sanitizeCredential(match?.[1]);
}

// src/oauth/claude-identity.ts
import { createHash, randomUUID } from "crypto";
var CLAUDE_CODE_CLI_VERSION = "2.1.187";
var CLAUDE_CODE_USER_AGENT = `claude-cli/${CLAUDE_CODE_CLI_VERSION} (external, cli)`;
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
}

// src/upstream-forward.ts
function anthropicUpstreamHeaders(apiKey, stream = false, inboundBeta, authType) {
  const key = sanitizeCredential(apiKey) ?? apiKey.trim();
  const isOAuth = authType === "oauth";
  const headers = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
    Authorization: `Bearer ${key}`,
    ...isOAuth ? {} : { "x-api-key": key },
    ...isOAuth ? { "User-Agent": CLAUDE_CODE_USER_AGENT } : {},
    ...stream ? { Accept: "text/event-stream" } : {}
  };
  if (inboundBeta) {
    headers["anthropic-beta"] = inboundBeta;
  }
  return headers;
}
async function postJsonUpstream(url, body, apiKey, inboundBeta) {
  const response = await fetch(url, {
    method: "POST",
    headers: anthropicUpstreamHeaders(apiKey, false, inboundBeta),
    body: JSON.stringify(body)
  });
  const text5 = await response.text();
  let parsed = null;
  if (text5) {
    try {
      parsed = JSON.parse(text5);
    } catch {
      parsed = text5;
    }
  }
  return { status: response.status, body: parsed };
}
var UpstreamUnreachableError = class extends Error {
  constructor(cause) {
    super(`Upstream unreachable: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "UpstreamUnreachableError";
  }
};
async function relayAnthropicMessages(res, messagesUrl, body, apiKey, clientWantsStream, inboundBeta, authType) {
  let upstreamRes;
  try {
    upstreamRes = await fetch(messagesUrl, {
      method: "POST",
      headers: anthropicUpstreamHeaders(apiKey, clientWantsStream, inboundBeta, authType),
      body: JSON.stringify(body)
    });
  } catch (err) {
    throw new UpstreamUnreachableError(err);
  }
  if (!upstreamRes.ok) {
    const errBody = await upstreamRes.text();
    res.writeHead(upstreamRes.status, { "Content-Type": upstreamRes.headers.get("content-type") || "application/json" });
    res.end(errBody);
    return;
  }
  if (clientWantsStream && upstreamRes.body) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    });
    Readable.fromWeb(upstreamRes.body).on("error", () => res.destroy()).pipe(res);
    return;
  }
  if (!upstreamRes.body) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "Upstream returned empty response body" } }));
    return;
  }
  const text5 = await upstreamRes.text();
  try {
    JSON.parse(text5);
  } catch {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "Upstream response was not valid JSON" } }));
    return;
  }
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(text5).toString()
  });
  res.end(text5);
}

// src/antigravity/anthropic-to-cloudcode.ts
import { randomUUID as randomUUID3 } from "crypto";

// src/antigravity/request-adapter.ts
import { randomUUID as randomUUID2 } from "crypto";
import { tool, jsonSchema } from "ai";
var JSON_SCHEMA_TYPES = /* @__PURE__ */ new Map([
  ["ARRAY", "array"],
  ["BOOLEAN", "boolean"],
  ["INTEGER", "integer"],
  ["NULL", "null"],
  ["NUMBER", "number"],
  ["OBJECT", "object"],
  ["STRING", "string"]
]);
function expandTextWithThinking(text5) {
  if (!text5.includes("<thinking>")) {
    return [{ type: "text", text: text5 }];
  }
  const out = [];
  const tokens = text5.split(/<thinking>([\s\S]*?)<\/thinking>/);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? "";
    if (!token.trim()) continue;
    out.push({ type: i % 2 === 1 ? "reasoning" : "text", text: token });
  }
  return out.length > 0 ? out : [{ type: "text", text: text5 }];
}
function normalizeSchemaType(value) {
  if (typeof value === "string") {
    return JSON_SCHEMA_TYPES.get(value) ?? value;
  }
  if (Array.isArray(value)) {
    return value.map(normalizeSchemaType);
  }
  return value;
}
function normalizeJsonSchema(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeJsonSchema);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      key === "type" ? normalizeSchemaType(child) : normalizeJsonSchema(child)
    ])
  );
}
function translateTools(ccTools) {
  if (!ccTools?.length) return void 0;
  const tools = {};
  for (const t of ccTools) {
    if (t.functionDeclarations) {
      for (const fd of t.functionDeclarations) {
        tools[fd.name] = tool({
          description: fd.description || "",
          inputSchema: jsonSchema(
            normalizeJsonSchema(fd.parameters || { type: "object", properties: {} })
          )
        });
      }
    }
  }
  return Object.keys(tools).length > 0 ? tools : void 0;
}
function translateRequest(ccReq, options = {}) {
  const systemInstructions = [];
  const sdkMessages = [];
  const nameToIdList = /* @__PURE__ */ new Map();
  const fallbackAssistantReasoning = [...options.fallbackAssistantReasoning ?? []];
  const request = ccReq.request || {};
  if (request.systemInstruction?.parts) {
    for (const part of request.systemInstruction.parts) {
      if (part.text) {
        systemInstructions.push(part.text);
      }
    }
  }
  const contents = request.contents || [];
  for (const msg of contents) {
    const role = msg.role;
    if (role === "system") {
      for (const part of msg.parts) {
        if (part.text) {
          systemInstructions.push(part.text);
        }
      }
      continue;
    }
    const sdkRole = role === "model" ? "assistant" : "user";
    const hasFunctionCall = msg.parts.some((p20) => p20.functionCall);
    const hasAssistantReasoning = role === "model" && msg.parts.some((p20) => p20.thought || p20.text?.includes("<thinking>"));
    const hasComplexParts = msg.parts.some((p20) => p20.thought || p20.inlineData || p20.functionCall || p20.functionResponse);
    const singleText = msg.parts.length === 1 ? msg.parts[0]?.text : void 0;
    if (!hasComplexParts && singleText !== void 0 && !singleText.includes("<thinking>")) {
      sdkMessages.push({
        role: sdkRole,
        content: singleText
      });
      continue;
    }
    const contentParts = [];
    const toolResults = [];
    if (role === "model" && hasFunctionCall && !hasAssistantReasoning) {
      const fallback = fallbackAssistantReasoning.shift();
      if (fallback?.trim()) {
        contentParts.push({ type: "reasoning", text: fallback });
      }
    }
    for (const part of msg.parts) {
      if (part.text !== void 0) {
        if (part.thought) {
          contentParts.push({ type: "reasoning", text: part.text });
        } else {
          for (const piece of expandTextWithThinking(part.text)) {
            contentParts.push(piece);
          }
        }
      } else if (part.inlineData) {
        contentParts.push({
          type: "image",
          image: part.inlineData.data,
          mimeType: part.inlineData.mimeType
        });
      } else if (part.functionCall) {
        const id = "call_" + randomUUID2().replace(/-/g, "");
        const name = part.functionCall.name;
        if (!nameToIdList.has(name)) nameToIdList.set(name, []);
        nameToIdList.get(name).push(id);
        contentParts.push({
          type: "tool-call",
          toolCallId: id,
          toolName: name,
          input: part.functionCall.args || {}
        });
      } else if (part.functionResponse) {
        const name = part.functionResponse.name;
        const idList = nameToIdList.get(name) || [];
        const id = idList.shift() || "call_" + randomUUID2().replace(/-/g, "");
        toolResults.push({
          type: "tool-result",
          toolCallId: id,
          toolName: name,
          output: {
            type: "text",
            value: typeof part.functionResponse.response === "string" ? part.functionResponse.response : JSON.stringify(part.functionResponse.response || {})
          }
        });
      }
    }
    if (toolResults.length > 0) {
      sdkMessages.push({
        role: "tool",
        content: toolResults
      });
    }
    if (contentParts.length > 0) {
      sdkMessages.push({
        role: sdkRole,
        content: contentParts
      });
    }
  }
  const system = systemInstructions.length > 0 ? systemInstructions.join("\n\n") : void 0;
  const tools = translateTools(request.tools);
  let toolChoice;
  const mode = request.toolConfig?.functionCallingConfig?.mode;
  if (mode === "ANY") {
    toolChoice = "required";
  } else if (mode === "AUTO" || tools) {
    toolChoice = "auto";
  }
  return {
    system,
    messages: sdkMessages,
    tools,
    toolChoice
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
function encodeToolUseId(rawId, thoughtSignature) {
  if (!thoughtSignature) return rawId;
  rememberToolSignature(rawId, thoughtSignature);
  if (Buffer.byteLength(thoughtSignature, "utf8") > MAX_INLINE_TOOL_SIGNATURE_BYTES) {
    return rawId;
  }
  const encoded = Buffer.from(thoughtSignature, "utf8").toString("base64url");
  return `${rawId}${TOOL_USE_SIG_SEP}${encoded}`;
}
function serializeToolResultContent(content) {
  return typeof content === "string" ? content : JSON.stringify(content);
}

// src/antigravity/anthropic-to-cloudcode.ts
var DEFAULT_SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" }
];
var ANTIGRAVITY_USER_AGENT = "vscode/1.X.X (Antigravity/4.2.0)";
var MIN_ANTIGRAVITY_OUTPUT_TOKENS = 1024;
var DISABLE_CLOUD_CODE_THINKING = { thinkingBudget: 0, includeThoughts: false };
var STRIP_KEYS = /* @__PURE__ */ new Set([
  "$schema",
  "$defs",
  "definitions",
  "$ref",
  "$comment",
  "additionalProperties",
  "propertyNames",
  "patternProperties",
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
  "deprecated"
]);
function stripDraftMeta(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(stripDraftMeta);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (STRIP_KEYS.has(k) || k.startsWith("x-")) continue;
    out[k] = stripDraftMeta(v);
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
function stringToParts(text5) {
  return [{ text: text5 }];
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
      if (thoughtSignature) part.thoughtSignature = thoughtSignature;
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
    const text5 = system.filter((b) => b.type === "text").map((b) => b.text).join("\n");
    return text5 ? { parts: [{ text: text5 }] } : void 0;
  }
  return void 0;
}
function translateTools2(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return void 0;
  const decls = [];
  for (const t of tools) {
    if (typeof t.name !== "string") continue;
    decls.push({
      name: t.name,
      description: typeof t.description === "string" ? t.description : "",
      parameters: stripDraftMeta(normalizeJsonSchema(t.input_schema ?? { type: "object", properties: {} }))
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
  generationConfig.thinkingConfig = DISABLE_CLOUD_CODE_THINKING;
  const ccTools = translateTools2(body.tools);
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
    requestId: randomUUID3(),
    model: realModelId,
    userAgent: ANTIGRAVITY_USER_AGENT,
    requestType: "agent",
    enabledCreditTypes: ["GOOGLE_ONE_AI"],
    request
  };
}

// src/antigravity/cloudcode-to-anthropic.ts
import { randomUUID as randomUUID4 } from "crypto";
function writeEvent(res, event, data) {
  res.write(`event: ${event}
data: ${JSON.stringify(data)}

`);
}
function parseCloudCodeChunk(line) {
  const text5 = line.startsWith("data: ") ? line.slice(6).trim() : line.trim();
  if (!text5 || text5 === "[DONE]") return null;
  try {
    return JSON.parse(text5);
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
async function streamCloudCodeToAnthropic(res, upstreamRes, model, log18) {
  const state = {
    messageId: `msg_${randomUUID4().replace(/-/g, "").slice(0, 24)}`,
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
          log18?.(() => {
            const toolNames = state.toolCalls.map((tc) => tc.name).filter(Boolean).join(",");
            return `cloud-code stream finish=${finishReason} mapped=${finalStopReason} ${summarizeParts(parts)} emittedTextChars=${state.emittedTextChars} suppressedThoughtChars=${state.suppressedThoughtChars} queuedToolCalls=${state.toolCalls.length} queuedToolNames=${toolNames || "-"} outputTokens=${state.usage.output}`;
          });
          if (state.textBlockOpen) {
            closeBlock(res, state);
          }
          for (const tc of state.toolCalls) {
            const rawToolId = `toolu_${randomUUID4().replace(/-/g, "").slice(0, 16)}`;
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
async function collectCloudCodeToAnthropic(upstreamRes, model, log18) {
  const text5 = await upstreamRes.text();
  const messageId = `msg_${randomUUID4().replace(/-/g, "").slice(0, 24)}`;
  const content = [];
  let stopReason = "end_turn";
  let inputTokens = 0;
  let outputTokens = 0;
  let pendingThoughtSignature;
  let suppressedThoughtChars = 0;
  for (const line of text5.split("\n")) {
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
        const rawToolId = `toolu_${randomUUID4().replace(/-/g, "").slice(0, 16)}`;
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
      log18?.(() => {
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
import { randomUUID as randomUUID5 } from "crypto";

// src/sdk-adapter.ts
import { streamText, generateText, tool as tool2, jsonSchema as jsonSchema2 } from "ai";

// src/tool-search.ts
var TOOL_SEARCH_TYPE_PREFIX = "tool_search_tool";
function isToolSearchTool(tool6) {
  if (typeof tool6.type === "string" && tool6.type.startsWith(TOOL_SEARCH_TYPE_PREFIX)) return true;
  const name = tool6.name ?? "";
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
  for (const tool6 of tools) {
    if (isToolSearchTool(tool6)) {
      upstream.push(tool6);
      continue;
    }
    if (tool6.defer_loading === true) {
      if (referenced.has(tool6.name)) upstream.push(tool6);
      continue;
    }
    upstream.push(tool6);
  }
  return upstream;
}

// src/sdk-adapter.ts
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
    const text5 = typeof msg.content === "string" ? msg.content : msg.content.map((b) => b.text ?? "").join("\n");
    if (text5.trim()) parts.push(text5.trim());
  }
  return parts;
}
function imagePart(block) {
  const src = block.source;
  if (!src) return null;
  if (src.type === "base64" && src.data) {
    return { type: "image", image: Buffer.from(src.data, "base64"), mediaType: src.media_type };
  }
  if (src.type === "url" && src.url) {
    return { type: "image", image: new URL(src.url) };
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
  const text5 = block.thinking ?? "";
  if (npm === "@ai-sdk/openai" && !block.signature && !text5.trim()) return null;
  const part = { type: "reasoning", text: text5 };
  if (block.signature) {
    if (npm === "@ai-sdk/google") {
      part.providerOptions = { google: { thoughtSignature: block.signature } };
    } else if (npm === "@ai-sdk/openai" || npm === "@ai-sdk/openai-compatible") {
      part.providerOptions = { openai: { reasoningEncryptedContent: block.signature } };
    }
  }
  return part;
}
function translateMessages(messages, npm) {
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
          const p20 = imagePart(b);
          if (p20) parts.push(p20);
        }
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
  return out;
}
function translateTools3(anthropicTools) {
  if (!anthropicTools?.length) return void 0;
  const tools = {};
  for (const t of anthropicTools) {
    if (!t.name || !t.input_schema) continue;
    tools[t.name] = tool2({ description: t.description ?? "", inputSchema: jsonSchema2(t.input_schema) });
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
function translateRequest2(body, npm, options) {
  const messages = body.messages ?? [];
  annotateToolNames(messages);
  const baseSystem = systemToString(body.system);
  const inlineParts = inlineSystemText(messages);
  const systemText = [baseSystem, ...inlineParts].filter((s) => s && s.trim()).join("\n\n") || (options?.openAiOAuth ? "You are a coding assistant." : void 0);
  const upstreamTools = resolveUpstreamTools(
    body.tools,
    messages
  );
  const effort = anthropicEffortFromRequest(body) ?? options?.defaultEffort;
  let providerOptions = deepMergeProviderOptions(
    thinkingProviderOptions(npm),
    effortProviderOptions(npm, effort, body.model, options?.reasoningMetadata)
  );
  if (options?.openAiOAuth && systemText) {
    providerOptions = deepMergeProviderOptions(providerOptions, {
      openai: { instructions: systemText }
    });
  }
  return {
    system: options?.openAiOAuth ? void 0 : systemText,
    messages: translateMessages(messages, npm),
    tools: translateTools3(upstreamTools.length ? upstreamTools : void 0),
    toolChoice: translateToolChoice(body.tool_choice),
    maxOutputTokens: options?.openAiOAuth ? void 0 : body.max_tokens,
    temperature: body.temperature,
    providerOptions
  };
}
async function writeAnthropicStream(fullStream, modelId, write, log18) {
  const messageId = "msg_" + Date.now();
  let blockIndex = -1;
  let started = false;
  let openType = null;
  let pendingThinkingSig;
  const idToBlock = /* @__PURE__ */ new Map();
  let finishReason = "end_turn";
  let usage = { input_tokens: 0, output_tokens: 0 };
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
        usage: { input_tokens: 0, output_tokens: 0 }
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
        break;
      }
      case "tool-input-delta":
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
        if (!idToBlock.has(part.toolCallId ?? "") && openType !== "tool") {
          const sig = grabRoundTripSignature(part);
          openBlock("tool", {
            type: "tool_use",
            id: encodeToolUseId(part.toolCallId ?? "", sig),
            name: part.toolName,
            input: {}
          });
          emit("content_block_delta", {
            type: "content_block_delta",
            index: blockIndex,
            delta: { type: "input_json_delta", partial_json: JSON.stringify(part.input ?? {}) }
          });
        }
        break;
      }
      case "finish":
        if (part.totalUsage) {
          usage = {
            input_tokens: part.totalUsage.inputTokens ?? 0,
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
        log18?.(() => `sdk stream error: ${errMsg}`);
        closeOpen();
        emit("error", { type: "error", error: { type: "api_error", message: errMsg } });
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
async function streamAnthropicResponse(model, params, modelId, write, log18) {
  const result = streamText({ model, ...params, onError: () => {
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
  await writeAnthropicStream(result.fullStream, modelId, write, log18);
}
async function generateAnthropicResponse(model, params, modelId) {
  const r = await generateText({ model, ...params });
  return {
    id: "msg_" + Date.now(),
    type: "message",
    role: "assistant",
    model: modelId,
    content: [
      ...r.text ? [{ type: "text", text: r.text }] : [],
      ...r.toolCalls.map((tc) => ({
        type: "tool_use",
        id: encodeToolUseId(tc.toolCallId, grabRoundTripSignature(tc)),
        name: tc.toolName,
        input: tc.input
      }))
    ],
    stop_reason: r.finishReason === "tool-calls" ? "tool_use" : "end_turn",
    usage: { input_tokens: r.usage?.inputTokens ?? 0, output_tokens: r.usage?.outputTokens ?? 0 }
  };
}

// src/proxy.ts
function appendSecureLog(logPath, line) {
  const redacted = redactTraceLine(line);
  try {
    const fd = openSync(logPath, "a", 384);
    try {
      writeSync(fd, `${(/* @__PURE__ */ new Date()).toISOString()} ${redacted}
`);
    } finally {
      closeSync(fd);
    }
  } catch {
    try {
      appendFileSync2(logPath, `${(/* @__PURE__ */ new Date()).toISOString()} ${redacted}
`);
    } catch {
    }
  }
}
function makeProxyLog(debug, logPath) {
  if (!debug) return () => {
  };
  const path2 = logPath ?? getProxyDebugLogPath();
  resetTraceLog(path2);
  return (message) => {
    const line = typeof message === "function" ? message() : message;
    appendSecureLog(path2, line);
  };
}
function anthropicError(res, status, message) {
  sendJson(res, status, {
    type: "error",
    error: { type: "api_error", message }
  });
}
function aliasModelId(realId, providerId) {
  if (realId.startsWith("claude-")) return realId;
  const sanitized = providerId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `anthropic-${sanitized}__${realId}`;
}
function lookupRoute(byAlias, id) {
  for (const key of routeLookupIds(id)) {
    const route = byAlias.get(key);
    if (route) return route;
  }
  return void 0;
}
function startProxyCatalog(routes, defaultAliasId, debug = false) {
  const proxyToken = randomUUID5();
  silenceSdkWarnings();
  if (routes.length === 0) {
    return Promise.reject(new Error("Proxy catalog requires at least one route"));
  }
  const byAlias = new Map(routes.map((r) => [r.aliasId, r]));
  const defaultRoute = byAlias.get(defaultAliasId) ?? routes[0];
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
      const originalModel = anthropicBody.model;
      const clientWantsStream = Boolean(anthropicBody.stream);
      const route = lookupRoute(byAlias, originalModel) ?? defaultRoute;
      const apiKey = route.apiKey;
      const upstreamUrl = route.upstreamUrl;
      plog(
        () => `POST /v1/messages - alias=${originalModel} route=${route.realModelId} format=${route.modelFormat} key=${apiKey ? `len:${apiKey.length}` : "MISSING"}`
      );
      if (!apiKey) {
        anthropicError(res, 401, "Missing API key");
        return;
      }
      if (route.modelFormat === "anthropic") {
        const betaHeaderRaw = req.headers["anthropic-beta"];
        const inboundBeta = Array.isArray(betaHeaderRaw) ? betaHeaderRaw.join(",") : betaHeaderRaw;
        const forwardBody = { ...anthropicBody, model: route.realModelId };
        const targetUrl = `${upstreamUrl}/v1/messages`;
        const isOAuth = route.authType === "oauth";
        let effectiveBeta = inboundBeta;
        if (isOAuth) {
          const seed = route.providerId ?? route.realModelId;
          injectClaudeIdentity(forwardBody, route.providerData, seed);
          effectiveBeta = selectBetaFlags(forwardBody, route.realModelId, inboundBeta);
          plog(() => `anthropic-oauth: model=${route.realModelId}, beta=${effectiveBeta}`);
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
            isOAuth ? "oauth" : "api"
          );
        } catch (err) {
          const message = err instanceof UpstreamUnreachableError ? err.message : String(err);
          plog(() => `anthropic-passthrough error: ${message}`);
          anthropicError(res, 502, message);
        }
        return;
      }
      if (isSdkMigratedNpm(route.npm)) {
        const params = translateRequest2(anthropicBody, route.npm, {
          openAiOAuth: route.npm === "@ai-sdk/openai" && route.authType === "oauth",
          reasoningMetadata: {
            providerId: route.providerId,
            apiBaseUrl: route.baseURL,
            supportedParameters: route.supportedParameters,
            reasoning: route.reasoning,
            interleavedReasoningField: route.interleavedReasoningField
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
            providerId: route.aliasId,
            authType: route.authType,
            oauthAccountId: route.oauthAccountId
          });
          if (clientWantsStream) {
            res.writeHead(200, {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              "Connection": "keep-alive"
            });
            await streamAnthropicResponse(model, params, originalModel, (c) => res.write(c), plog);
            res.end();
          } else {
            const anthropicResponse = await generateAnthropicResponse(model, params, originalModel);
            sendJson(res, 200, anthropicResponse);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const body = err && typeof err === "object" && "responseBody" in err ? err.responseBody : void 0;
          plog(() => `sdk error: ${message}${body ? ` \u2014 body: ${body}` : ""}`);
          if (!res.headersSent) {
            anthropicError(res, 502, message);
          } else {
            res.write(`event: error
data: ${JSON.stringify({ type: "error", error: { type: "api_error", message } })}

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
        const cloudToolResults = cloudContents.reduce((count, msg) => count + (msg.parts ?? []).filter((p20) => p20.functionResponse).length, 0);
        const cloudToolCalls = cloudContents.reduce((count, msg) => count + (msg.parts ?? []).filter((p20) => p20.functionCall).length, 0);
        const cloudTools = envelope.request.tools?.length ?? 0;
        const cloudMaxOutput = envelope.request.generationConfig?.maxOutputTokens;
        const baseUrl = upstreamUrl.replace(/\/+$/, "");
        const cloudCodeUrl = `${baseUrl}/v1internal:streamGenerateContent?alt=sse`;
        plog(() => `cloud-code: model=${route.realModelId}, project=${projectId.slice(0, 8)}\u2026 msgs=${cloudContents.length} toolCalls=${cloudToolCalls} toolResults=${cloudToolResults} tools=${cloudTools} maxOutput=${cloudMaxOutput ?? "unset"} stream=${clientWantsStream}`);
        try {
          const upstream = await fetch(cloudCodeUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
              "User-Agent": "vscode/1.X.X (Antigravity/4.2.0)"
            },
            body: JSON.stringify(envelope)
          });
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
  return new Promise((resolve, reject2) => {
    server.on("error", reject2);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject2(new Error("Failed to bind proxy"));
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
    supportedParameters: sdk?.supportedParameters,
    reasoning: sdk?.reasoning,
    interleavedReasoningField: sdk?.interleavedReasoningField
  }], clientModelId, debug);
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
    supportedParameters: model.supportedParameters,
    reasoning: model.reasoning,
    interleavedReasoningField: model.interleavedReasoningField
  };
}
function zenGoModelToRoute(model, apiKey) {
  if (model.modelFormat === "unsupported") return null;
  const backend = BACKENDS[model.sourceBackend];
  const isAnthropic = model.modelFormat === "anthropic";
  return {
    aliasId: claudeCodeClientModelId(aliasModelId(model.id, model.sourceBackend), model.contextWindow),
    realModelId: model.id,
    displayName: `${model.name} (${backend.name})`,
    upstreamUrl: isAnthropic ? backend.baseUrl : `${backend.baseUrl}/v1/chat/completions`,
    apiKey,
    modelFormat: model.modelFormat,
    contextWindow: model.contextWindow,
    // openai-format Zen/Go models route through the SDK (openai-compatible);
    // anthropic models stay direct passthrough (no npm).
    npm: isAnthropic ? void 0 : "@ai-sdk/openai-compatible",
    baseURL: isAnthropic ? void 0 : `${backend.baseUrl}/v1`,
    providerId: model.sourceBackend,
    reasoning: model.reasoning,
    interleavedReasoningField: model.interleavedReasoningField
  };
}
function makeRouteResolver(localProviders, zenModels, goModels, zenGoApiKey) {
  return (providerId, modelId) => {
    if (providerId === "zen" || providerId === "go") {
      if (!zenGoApiKey) return void 0;
      const model2 = (providerId === "zen" ? zenModels : goModels).find((m) => m.id === modelId);
      return model2 ? zenGoModelToRoute(model2, zenGoApiKey) ?? void 0 : void 0;
    }
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
import { networkInterfaces } from "os";
import * as p5 from "@clack/prompts";

// src/server/prompts.ts
import * as p3 from "@clack/prompts";
import pc2 from "picocolors";
async function askServerStartMode() {
  const mode = await p3.select({
    message: "How do you want to start the server?",
    options: [
      { value: "configure", label: pc2.cyan("Configure & start"), hint: "Providers, discovery masking, listen mode" },
      { value: "quick", label: pc2.cyan("Start with saved settings"), hint: "Use last server configuration" }
    ],
    initialValue: "configure"
  });
  if (p3.isCancel(mode)) {
    p3.cancel("Cancelled.");
    return null;
  }
  return mode;
}
async function askMaskGatewayIds(initialValue) {
  const mask = await p3.confirm({
    message: "Mask gateway model ids for discovery? (Needed for Claude Desktop / Cowork)",
    initialValue
  });
  if (p3.isCancel(mask)) {
    p3.cancel("Cancelled.");
    return null;
  }
  return Boolean(mask);
}
async function askFavoritesOnly(initialValue) {
  printFavoritesOnlyPanel();
  const favoritesOnly = await p3.confirm({
    message: "Expose only favorite models?",
    initialValue
  });
  if (p3.isCancel(favoritesOnly)) {
    p3.cancel("Cancelled.");
    return null;
  }
  return Boolean(favoritesOnly);
}
async function askListenMode() {
  const mode = await p3.select({
    message: "Where should the server listen?",
    options: [
      { value: "local", label: pc2.cyan("Local only"), hint: "Only this computer can use it" },
      { value: "network", label: pc2.cyan("Network"), hint: "Other computers on your network can use it" }
    ],
    initialValue: "local"
  });
  if (p3.isCancel(mode)) {
    p3.cancel("Cancelled.");
    return null;
  }
  return mode;
}
async function askServerPassword() {
  printNetworkWarningPanel();
  const password3 = await p3.text({
    message: "Choose a server password for this run:",
    validate: (value) => value.trim() ? void 0 : "Password cannot be empty"
  });
  if (p3.isCancel(password3)) {
    p3.cancel("Cancelled.");
    return null;
  }
  return String(password3).trim();
}
async function askUseSavedServerPassword() {
  const choice = await p3.select({
    message: "Use saved server password?",
    options: [
      { value: "use-saved", label: pc2.cyan("Use saved password") },
      { value: "new-password", label: pc2.cyan("Enter a new password") }
    ],
    initialValue: "use-saved"
  });
  if (p3.isCancel(choice)) {
    p3.cancel("Cancelled.");
    return null;
  }
  return choice;
}
async function askSaveServerPassword() {
  const save = await p3.confirm({
    message: "Save this server password for future server runs?",
    initialValue: false
  });
  if (p3.isCancel(save)) {
    p3.cancel("Cancelled.");
    return null;
  }
  return Boolean(save);
}

// src/server/router.ts
import { createServer as createServer2 } from "http";

// src/openai-adapter.ts
import { tool as tool3, jsonSchema as jsonSchema3, streamText as streamText2, generateText as generateText2 } from "ai";
function translateOpenAiRequest(body) {
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
        if (typeof msg.content === "string" && msg.content) {
          parts.push({ type: "text", text: msg.content });
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
        const schema = t.function.parameters ? jsonSchema3(t.function.parameters) : void 0;
        tools[t.function.name] = tool3({
          description: t.function.description ?? "",
          inputSchema: schema ?? jsonSchema3({ type: "object", properties: {} })
        });
      }
    }
  }
  return {
    system,
    messages,
    tools,
    toolChoice: sdkToolChoice,
    temperature: body.temperature,
    maxOutputTokens: body.max_completion_tokens ?? body.max_tokens
  };
}
async function generateOpenAiResponse(model, params, responseModelId) {
  const result = await generateText2({ model, ...params });
  const message = { role: "assistant", content: result.text || null };
  if (result.toolCalls?.length) {
    message.tool_calls = result.toolCalls.map((tc) => ({
      id: tc.toolCallId,
      type: "function",
      function: { name: tc.toolName, arguments: JSON.stringify(tc.args) }
    }));
  }
  return {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1e3),
    model: responseModelId,
    choices: [{ index: 0, message, finish_reason: result.finishReason || "stop" }],
    usage: {
      prompt_tokens: result.usage?.promptTokens ?? 0,
      completion_tokens: result.usage?.completionTokens ?? 0,
      total_tokens: result.usage?.totalTokens ?? 0
    }
  };
}
async function streamOpenAiResponse(model, params, responseModelId, onChunk) {
  const { fullStream } = streamText2({ model, ...params });
  const baseData = {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1e3),
    model: responseModelId
  };
  const send = (delta, finish_reason = null) => onChunk(`data: ${JSON.stringify({ ...baseData, choices: [{ index: 0, delta, finish_reason }] })}

`);
  for await (const part of fullStream) {
    const p20 = part;
    switch (p20.type) {
      case "text-delta":
        send({ role: "assistant", content: p20.textDelta ?? p20.text ?? "" });
        break;
      case "tool-input-start":
      case "tool-call-streaming-start":
        send({ role: "assistant", tool_calls: [{ index: 0, id: p20.id ?? p20.toolCallId, type: "function", function: { name: p20.toolName, arguments: "" } }] });
        break;
      case "tool-input-delta":
      case "tool-call-delta":
        send({ tool_calls: [{ index: 0, function: { arguments: p20.delta ?? p20.text ?? p20.argsTextDelta ?? "" } }] });
        break;
      case "finish":
        send({}, p20.finishReason || "stop");
        break;
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
  const server = createServer2((req, res) => {
    void routeRequest(req, res, options, languageModelCache, plog);
  });
  await new Promise((resolve, reject2) => {
    server.once("error", reject2);
    server.listen(options.port, options.host, () => {
      server.off("error", reject2);
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
    close: () => new Promise((resolve, reject2) => {
      server.close((err) => err ? reject2(err) : resolve());
    })
  };
}
async function routeRequest(req, res, options, modelCache, plog) {
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
      sendJson(res, 200, { models: options.catalog.list().map(({ apiKey: _apiKey, ...rest }) => rest) });
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
      await handleAnthropicMessages(req, res, options, modelCache, plog);
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
async function handleAnthropicMessages(req, res, options, modelCache, plog) {
  const body = await readJson(req);
  if (!body) {
    sendJson(res, 400, { error: { message: "Invalid JSON body" } });
    return;
  }
  const model = lookupModel(res, options.catalog, body.model);
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
    plog(() => `anthropic-passthrough \u2192 ${messagesUrl}`);
    await forwardJson(res, messagesUrl, { ...body, model: upstreamModelId(model) }, apiKey, inboundBeta);
    return;
  }
  if (model.modelFormat === "openai") {
    if (!isSdkMigratedNpm(model.npm)) {
      sendJson(res, 400, { error: { message: `No SDK provider for model: ${model.id}` } });
      return;
    }
    const apiKey = model.apiKey ?? options.apiKey;
    const languageModel = await getOrInitLanguageModel(modelCache, model, model.npm, model.apiBaseUrl, apiKey, options.vertex);
    const params = translateRequest2(body, model.npm, {
      defaultEffort: anthropicEffortFromRequest(body) ? void 0 : model.defaultEffort,
      openAiOAuth: model.npm === "@ai-sdk/openai" && model.authType === "oauth",
      reasoningMetadata: {
        providerId: model.providerId,
        apiBaseUrl: model.apiBaseUrl,
        supportedParameters: model.supportedParameters,
        reasoning: model.reasoning,
        interleavedReasoningField: model.interleavedReasoningField
      }
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
        await streamAnthropicResponse(languageModel, params, responseModelId, (chunk) => res.write(chunk));
        res.end();
      } else {
        const anthropicResponse = await generateAnthropicResponse(languageModel, params, responseModelId);
        sendJson(res, 200, anthropicResponse);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) sendJson(res, 502, { error: { message } });
      else res.end();
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
  const model = lookupModel(res, options.catalog, body.model);
  if (!model) return;
  if (supportsDirectOpenAIChatCompletions(model)) {
    if (model.completionsUrl && !/^https?:\/\//i.test(model.completionsUrl)) {
      sendJson(res, 400, { error: { message: `Invalid provider completionsUrl: must be http:// or https://` } });
      return;
    }
    const completionsUrl = model.completionsUrl ? model.completionsUrl : `${backendFor(options, model).baseUrl}/v1/chat/completions`;
    const apiKey2 = model.apiKey ?? options.apiKey;
    await relayAnthropicMessages(res, completionsUrl, body, apiKey2, Boolean(body.stream));
    return;
  }
  const npm = model.npm || (model.modelFormat === "anthropic" ? "@ai-sdk/anthropic" : void 0);
  if (!npm) {
    sendJson(res, 400, { error: { message: `No SDK provider for model: ${model.id}` } });
    return;
  }
  const apiKey = model.apiKey ?? options.apiKey;
  const baseURL = model.modelFormat === "anthropic" ? model.baseUrl : model.apiBaseUrl;
  const languageModel = await getOrInitLanguageModel(modelCache, model, npm, baseURL, apiKey, options.vertex);
  const params = translateOpenAiRequest(body);
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
      await streamOpenAiResponse(languageModel, params, responseModelId, (chunk) => res.write(chunk));
      res.end();
    } else {
      const response = await generateOpenAiResponse(languageModel, params, responseModelId);
      sendJson(res, 200, response);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!res.headersSent) sendJson(res, 502, { error: { message } });
    else res.end();
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
async function getOrInitLanguageModel(modelCache, model, npm, baseURL, apiKey, vertex) {
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
      vertex
    });
    modelCache.set(cacheKey, languageModel);
  }
  return languageModel;
}
function getResponseModelId(bodyModel, model, options) {
  return options.gateway?.maskGatewayIds ? gatewayDisplayName(model, options.gateway) : typeof bodyModel === "string" ? bodyModel : model.id;
}
async function forwardJson(res, url, body, apiKey, inboundBeta) {
  const upstream = await postJsonUpstream(url, body, apiKey, inboundBeta);
  sendJson(res, upstream.status, upstream.body);
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
import * as p4 from "@clack/prompts";
function isSelected(list, id) {
  return list.includes(id);
}
function resolveInitialServerProviders(initial, available) {
  if (!initial?.length) return [];
  return initial.filter((id) => available.some((provider) => provider.id === id));
}
async function selectServerProviders(available, initial) {
  if (available.length === 0) {
    p4.log.warn("No providers available to expose.");
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
    const choice = await p4.select({
      message: header,
      options,
      initialValue: "__done__"
    });
    if (p4.isCancel(choice) || choice === "__done__") {
      if (selected.length === 0) {
        p4.log.warn("Select at least one provider to expose.");
        continue;
      }
      break;
    }
    if (choice === "__all__") {
      selected = available.map((provider) => provider.id);
      p4.log.success(`Exposing all ${available.length} providers.`);
      continue;
    }
    if (choice === "__clear__") {
      selected = [];
      p4.log.success("Cleared provider list \u2014 add the ones you want to expose.");
      continue;
    }
    if (choice === "__add__") {
      if (unselected.length === 0) continue;
      const picked = await p4.select({
        message: "Which provider?",
        options: unselected.map((provider) => ({
          value: provider.id,
          label: provider.name,
          hint: `${provider.modelCount} model${provider.modelCount !== 1 ? "s" : ""}`
        }))
      });
      if (p4.isCancel(picked)) continue;
      selected = [...selected, picked];
      continue;
    }
    if (choice.startsWith("prov-")) {
      const idx = parseInt(choice.slice(5), 10);
      const id = selected[idx];
      if (!id) continue;
      const provider = lookup.get(id);
      selected = selected.filter((_, i) => i !== idx);
      p4.log.success(`Removed ${provider?.name ?? id}.`);
    }
  }
  return selected;
}

// src/server/vertex-config.ts
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "fs";
import { homedir as homedir2 } from "os";
import { join } from "path";
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
function defaultAdcCredentialsPath(home = homedir2()) {
  return join(home, ".config", "gcloud", "application_default_credentials.json");
}
function hasApplicationDefaultCredentials(home = homedir2(), adcPath = defaultAdcCredentialsPath(home), env = process.env) {
  const explicitPath = env["GOOGLE_APPLICATION_CREDENTIALS"]?.trim();
  if (explicitPath && existsSync2(explicitPath)) return true;
  return existsSync2(adcPath);
}
function loadVertexModelEntries(env = process.env) {
  const configPath = getVertexModelsPath(env);
  if (!existsSync2(configPath)) return DEFAULT_VERTEX_MODELS;
  try {
    const parsed = JSON.parse(readFileSync2(configPath, "utf8"));
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
function compactRows(models, gateway) {
  const seen = /* @__PURE__ */ new Set();
  const rows = [];
  for (const model of [...models].sort((a, b) => a.name.localeCompare(b.name))) {
    const row = {
      name: model.name,
      anthropicId: exposedGatewayAliasId(model, gateway),
      openaiId: model.id
    };
    const key = `${row.name}\0${row.anthropicId}\0${row.openaiId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }
  return rows;
}
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
  const lines = ["Model catalog:", ""];
  const sortedGroups = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [label, groupModels] of sortedGroups) {
    const rows = compactRows(groupModels, gateway);
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
function filterZenModelsForServer(models) {
  const zenProvider = loadRegistry().providers.find((entry) => entry.id === "zen" && entry.enabled);
  if (zenProvider?.subscriptionFilter === "free") {
    return models.filter((model) => model.isFree);
  }
  return models;
}
function usableGoModels(models) {
  return models.filter((model) => model.modelFormat !== "unsupported");
}
function providerOptionsFromCatalog(catalog) {
  const options = [];
  const zenModels = filterZenModelsForServer(catalog.zenModels);
  if (zenModels.length > 0) {
    options.push({
      id: "zen",
      name: "OpenCode Zen",
      modelCount: zenModels.length
    });
  }
  const goModels = usableGoModels(catalog.goModels);
  if (goModels.length > 0) {
    options.push({
      id: "go",
      name: "OpenCode Go",
      modelCount: goModels.length
    });
  }
  for (const provider of catalog.localProviders) {
    options.push({
      id: provider.id,
      name: provider.name,
      modelCount: provider.models.length
    });
  }
  return options;
}
async function loadServerModels() {
  const catalog = await fetchProviderCatalog({ agent: "server" });
  const models = [];
  const zenModels = filterZenModelsForServer(catalog.zenModels);
  if (zenModels.length > 0) {
    models.push(...zenGoModelsToServerModels(zenModels));
  }
  const goModels = usableGoModels(catalog.goModels);
  if (goModels.length > 0) {
    models.push(...zenGoModelsToServerModels(goModels));
  }
  if (catalog.localProviders.length > 0) {
    models.push(...localProvidersToServerModels(catalog.localProviders));
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
    interleavedReasoningField: model.interleavedReasoningField
  });
  if (!caps.defaultLevel) return model;
  return { ...model, defaultEffort: caps.defaultLevel };
}
function waitForShutdown() {
  return new Promise((resolve) => {
    const cleanup = () => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
    };
    const onSignal = () => {
      cleanup();
      resolve();
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
  });
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
async function configureExposedProviders() {
  p5.log.info("Add providers to expose. Listed providers are removed when selected \u2014 like favorites.");
  const spinner10 = p5.spinner();
  spinner10.start("Loading providers...");
  const catalog = await fetchProviderCatalog({ agent: "server" });
  spinner10.stop("");
  const available = providerOptionsFromCatalog(catalog);
  const picked = await selectServerProviders(available, getServerExposedProviders() ?? void 0);
  if (!picked) return void 0;
  setServerExposedProviders(picked);
  p5.log.success(`Saved ${picked.length} provider${picked.length !== 1 ? "s" : ""} for future server runs.`);
  return picked;
}
async function runServerWizard() {
  relayIntro("Server");
  const startMode = await askServerStartMode();
  if (!startMode) return void 0;
  if (startMode === "quick") {
    return {
      exposedProviders: getServerExposedProviders(),
      maskGatewayIds: getServerMaskGatewayIds(),
      favoritesOnly: getServerFavoritesOnly()
    };
  }
  const favoritesOnly = await askFavoritesOnly(getServerFavoritesOnly());
  if (favoritesOnly === null) return void 0;
  setServerFavoritesOnly(favoritesOnly);
  if (favoritesOnly) {
    p5.log.info("Manage favorites with `relay-ai models`.");
  }
  let exposedProviders = null;
  if (!favoritesOnly) {
    exposedProviders = await configureExposedProviders();
    if (exposedProviders === void 0) return void 0;
  }
  const maskGatewayIds = await askMaskGatewayIds(getServerMaskGatewayIds());
  if (maskGatewayIds === null) return void 0;
  setServerMaskGatewayIds(maskGatewayIds);
  return { exposedProviders, maskGatewayIds, favoritesOnly };
}
async function runVertexServerCommand() {
  relayIntro("Vertex Gateway");
  const vertexConfig = buildVertexRuntimeConfig();
  if (!vertexConfig) {
    p5.log.error("Set ANTHROPIC_VERTEX_PROJECT_ID or GOOGLE_CLOUD_PROJECT to your GCP project.");
    return 1;
  }
  if (!hasApplicationDefaultCredentials()) {
    p5.log.error("Google Application Default Credentials not found.");
    p5.log.info("Run: gcloud auth application-default login");
    return 1;
  }
  const mode = await askListenMode();
  if (!mode) return 0;
  const pwResult = await getServerPasswordForMode(mode);
  if (pwResult === void 0) return 0;
  const { password: serverPassword, wasSaved: passwordWasSaved } = pwResult;
  const host = mode === "network" ? "0.0.0.0" : "127.0.0.1";
  const models = vertexModelsToServerModels(vertexConfig);
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
    }
  });
  console.log("");
  console.log(pc4.bold(pc4.green("Vertex gateway running")));
  console.log(`  Anthropic:  http://127.0.0.1:${server.port}/anthropic`);
  console.log(`  Models:     ${models.map((model) => model.id).join(", ")}`);
  if (mode === "network") {
    for (const { name, address } of getLocalIps()) {
      console.log(`  Network (${name}):  http://${address}:${server.port}/anthropic`);
    }
    if (passwordWasSaved) {
      console.log("  API key:    saved, rotate with `relay-ai server --setup`");
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
  return 0;
}
async function resolveServerUpstreamApiKey() {
  let apiKey = sanitizeCredential(resolveApiKey());
  if (apiKey) return apiKey;
  apiKey = sanitizeCredential(await readFromCredentialStore((reason) => {
    p5.log.warn(`Credential store unavailable \u2014 ${reason}`);
  }));
  if (apiKey) {
    const isMac = process.platform === "darwin";
    const isWindows4 = process.platform === "win32";
    const storeName = isMac ? "macOS Keychain" : isWindows4 ? "Windows Credential Manager" : "Secret Service";
    p5.log.success(`Found key in ${storeName}`);
    return apiKey;
  }
  const catalog = await fetchProviderCatalog({ agent: "server" });
  if (catalog.localProviders.some((provider) => provider.apiKey.trim())) {
    return "registry-local";
  }
  return null;
}
async function runServerCommand(options = {}) {
  if (options.vertex) {
    return runVertexServerCommand();
  }
  const apiKey = await resolveServerUpstreamApiKey();
  if (!apiKey) {
    p5.log.error("No providers configured. Run `relay-ai providers add` or import, or set OPENCODE_API_KEY for Zen/Go.");
    return 1;
  }
  const runConfig = await runServerWizard();
  if (!runConfig) return 0;
  const mode = await askListenMode();
  if (!mode) return 0;
  const pwResult = await getServerPasswordForMode(mode);
  if (pwResult === void 0) return 0;
  const { password: serverPassword, wasSaved: passwordWasSaved } = pwResult;
  const host = mode === "network" ? "0.0.0.0" : "127.0.0.1";
  const spinner10 = p5.spinner();
  spinner10.start("Fetching available models...");
  let models;
  try {
    models = await loadServerModels();
    if (runConfig.exposedProviders) {
      models = filterServerModelsByProviders(models, runConfig.exposedProviders);
    }
    if (runConfig.favoritesOnly) {
      const favorites = loadPreferences().favoriteModels ?? [];
      if (favorites.length === 0) {
        spinner10.stop(pc4.red("No favorite models configured"));
        p5.log.error("Run `relay-ai models` to add favorites, or turn off favorites-only in the server wizard.");
        return 1;
      }
      models = filterServerModelsByFavorites(models, favorites).slice(0, MAX_MODEL_CATALOG);
      if (models.length === 0) {
        spinner10.stop(pc4.red("No favorite models matched the current provider filter"));
        p5.log.error("Adjust favorites with `relay-ai models` or change exposed providers in the server wizard.");
        return 1;
      }
    }
    if (runConfig.favoritesOnly) {
      p5.log.info(
        `Favorites-only mode active \u2014 GET /anthropic/v1/models returns ${models.length} favorites.`
      );
      p5.log.info("Desktop/Cowork picker will only show these. Edit with `relay-ai models`.");
    }
    if (models.length === 0) {
      spinner10.stop(pc4.red("No models to expose"));
      p5.log.error("Add providers with `relay-ai providers add` or configure exposed providers in the server wizard.");
      return 1;
    }
    const localCount = models.filter((m) => m.apiKey !== void 0).length;
    const summary = summarizeServerProviders(models);
    const filterNote = runConfig.exposedProviders ? ` \u2014 ${runConfig.exposedProviders.length} provider${runConfig.exposedProviders.length !== 1 ? "s" : ""}` : "";
    const favoritesNote = runConfig.favoritesOnly ? " \u2014 favorites only" : "";
    const maskNote = runConfig.maskGatewayIds ? " \u2014 discovery ids masked" : "";
    spinner10.stop(`Loaded ${models.length} models (${localCount} from registry providers)${filterNote}${favoritesNote}${maskNote}`);
    if (summary) p5.log.info(summary);
  } catch (err) {
    spinner10.stop(pc4.red("Failed to load models"));
    console.error(pc4.red(String(err instanceof Error ? err.message : err)));
    return 1;
  }
  const gateway = runConfig.maskGatewayIds ? { maskGatewayIds: true } : void 0;
  const server = await startServer({
    host,
    port: 17645,
    apiKey,
    serverPassword,
    catalog: createGatewayModelCatalog(models, gateway),
    backends: BACKENDS,
    gateway
  });
  console.log("");
  console.log(pc4.bold(pc4.green("Relay AI server running")));
  console.log(`  Anthropic:  http://127.0.0.1:${server.port}/anthropic`);
  console.log(`  OpenAI:     http://127.0.0.1:${server.port}/openai/v1`);
  if (mode === "network") {
    for (const { name, address } of getLocalIps()) {
      console.log(`  Network (${name}):`);
      console.log(`    Anthropic:  http://${address}:${server.port}/anthropic`);
      console.log(`    OpenAI:     http://${address}:${server.port}/openai/v1`);
    }
    if (passwordWasSaved) {
      console.log("  API key:    saved, rotate with `relay-ai server --setup`");
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
  if (runConfig.maskGatewayIds) {
    console.log(pc4.dim("  Discovery:  gateway ids masked for Claude Desktop / Cowork"));
  }
  console.log("");
  printModelCatalog(models, gateway);
  console.log(pc4.dim("Press Ctrl+C to stop."));
  await waitForShutdown();
  await server.close();
  return 0;
}

// src/prompts.ts
import * as p6 from "@clack/prompts";
import pc5 from "picocolors";

// src/model-search.ts
function normalizeModelSearchText(value) {
  return value.toLowerCase().replace(/([a-z])([0-9])/g, "$1 $2").replace(/([0-9])([a-z])/g, "$1 $2").replace(/[\s\-._/:]+/g, " ").trim();
}
function scoreModelSearch(query, fields) {
  const normalizedQuery = normalizeModelSearchText(query);
  const compactQuery = normalizedQuery.replace(/\s+/g, "");
  if (!normalizedQuery || !compactQuery) return 0;
  const searchableFields = fields.filter((field) => field.value).map((field) => {
    const normalized = normalizeModelSearchText(field.value);
    return { normalized, compact: normalized.replace(/\s+/g, ""), weight: field.weight };
  });
  const tokens = normalizedQuery.split(" ").filter(Boolean);
  if (!tokens.every((token) => searchableFields.some((field) => field.normalized.includes(token) || field.compact.includes(token)))) {
    return 0;
  }
  let score = 1;
  for (const field of searchableFields) {
    if (field.normalized === normalizedQuery) score = Math.max(score, field.weight + 300);
    else if (field.compact === compactQuery) score = Math.max(score, field.weight + 260);
    else if (field.normalized.startsWith(normalizedQuery)) score = Math.max(score, field.weight + 180);
    else if (field.compact.startsWith(compactQuery)) score = Math.max(score, field.weight + 150);
    else if (field.normalized.includes(normalizedQuery)) score = Math.max(score, field.weight + 90);
    else if (field.compact.includes(compactQuery)) score = Math.max(score, field.weight + 70);
  }
  return score + tokens.reduce((sum, token) => sum + searchableFields.reduce((best, field) => {
    if (field.normalized.split(" ").includes(token)) return Math.max(best, 30);
    if (field.normalized.includes(token) || field.compact.includes(token)) return Math.max(best, 12);
    return best;
  }, 0), 0);
}

// src/prompts.ts
var BROWSE_ALL = "__browse_all__";
var MAX_RECENT = 3;
var MODEL_SEARCH_THRESHOLD = 25;
var MODEL_PAGE_SIZE = 15;
var PAGE_PREV = "__page_prev__";
var PAGE_NEXT = "__page_next__";
var SWITCH_SEARCH = "__switch_search__";
var SWITCH_BROWSE = "__switch_browse__";
var MODE_SEARCH = "search";
var MODE_BROWSE = "browse";
function sortModelsByBrand(models) {
  return [...models].sort((a, b) => {
    const brandCmp = a.brand.localeCompare(b.brand, void 0, { sensitivity: "base" });
    if (brandCmp !== 0) return brandCmp;
    const nameA = a.name || a.id;
    const nameB = b.name || b.id;
    return nameA.localeCompare(nameB, void 0, { sensitivity: "base", numeric: true });
  });
}
function filterModelsBySearch(models, query) {
  if (!query.trim()) return [];
  return models.map((model, index) => ({
    model,
    index,
    score: scoreModelSearch(query, [
      { value: model.name, weight: 800 },
      { value: model.id, weight: 700 },
      { value: model.brand, weight: 350 }
    ])
  })).filter((result) => result.score > 0).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.index - b.index;
  }).map((result) => result.model);
}
function sliceModelPage(items, page, pageSize = MODEL_PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const clampedPage = Math.min(Math.max(0, page), totalPages - 1);
  const start = clampedPage * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page: clampedPage,
    totalPages
  };
}
function isSelectedModel(value) {
  return value !== "search" && value !== "browse" && value !== "menu";
}
async function pickModelFromPagedList(list, toOption, messagePrefix, initialModelId, links) {
  let page = 0;
  if (initialModelId) {
    const idx = list.findIndex((m) => m.id === initialModelId);
    if (idx >= 0) page = Math.floor(idx / MODEL_PAGE_SIZE);
  }
  while (true) {
    const { items: pageItems, page: currentPage, totalPages } = sliceModelPage(list, page);
    const options = [];
    if (currentPage > 0) {
      options.push(navOption(PAGE_PREV, "\u2190 Previous page", `Page ${currentPage} of ${totalPages}`));
    }
    options.push(...pageItems.map(toOption));
    if (currentPage < totalPages - 1) {
      options.push(navOption(PAGE_NEXT, "Next page \u2192", `Page ${currentPage + 2} of ${totalPages}`));
    }
    if (links?.search) {
      options.push(navOption(SWITCH_SEARCH, "Search instead \u2192", ""));
    }
    if (links?.browse) {
      options.push(navOption(SWITCH_BROWSE, "Browse all instead \u2192", ""));
    }
    if (links?.newSearch) {
      options.push(navOption(SWITCH_SEARCH, "\u2190 New search", ""));
    }
    const initialValue = (initialModelId && pageItems.some((m) => m.id === initialModelId) ? initialModelId : pageItems[0]?.id) ?? options[0]?.value;
    const picked = await p6.select({
      message: `${messagePrefix} (page ${currentPage + 1} of ${totalPages})`,
      options,
      initialValue
    });
    if (p6.isCancel(picked)) return "menu";
    const choice = String(picked);
    if (choice === PAGE_PREV) {
      page = currentPage - 1;
      continue;
    }
    if (choice === PAGE_NEXT) {
      page = currentPage + 1;
      continue;
    }
    if (choice === SWITCH_SEARCH) return "search";
    if (choice === SWITCH_BROWSE) return "browse";
    const selected = list.find((m) => m.id === choice);
    if (selected) return selected;
    continue;
  }
}
async function selectLargeCatalog(models, browseList, toOption, message, initialModelId) {
  let mode = "choose";
  while (true) {
    if (mode === "choose") {
      const method = await p6.select({
        message: `${message} (${models.length} available)`,
        options: [
          { value: MODE_SEARCH, label: pc5.cyan("Search models"), hint: "Filter by name, id, or brand" },
          {
            value: MODE_BROWSE,
            label: pc5.cyan("Browse all models"),
            hint: `${MODEL_PAGE_SIZE} per page \xB7 ${Math.ceil(browseList.length / MODEL_PAGE_SIZE)} pages`
          },
          navOption("__back__", "\u2190 Go back", "Select a different provider")
        ]
      });
      if (p6.isCancel(method) || String(method) === "__back__") {
        return "back";
      }
      mode = method === MODE_BROWSE ? "browse" : "search";
      continue;
    }
    if (mode === "browse") {
      const picked = await pickModelFromPagedList(
        browseList,
        toOption,
        message,
        initialModelId,
        { search: true }
      );
      if (picked === "search") {
        mode = "search";
        continue;
      }
      if (picked === "menu") {
        mode = "choose";
        continue;
      }
      if (isSelectedModel(picked)) return picked;
      continue;
    }
    const searchInput = await p6.text({
      message: `Search models (${models.length} available):`,
      placeholder: "e.g. claude, sonnet, llama"
    });
    if (p6.isCancel(searchInput)) {
      mode = "choose";
      continue;
    }
    const matched = filterModelsBySearch(browseList, String(searchInput));
    if (matched.length === 0) {
      p6.log.warn("No models match \u2014 try a different search");
      continue;
    }
    const result = await pickModelFromPagedList(
      matched,
      toOption,
      matched.length === 1 ? "Match found" : `Select model (${matched.length} matches)`,
      initialModelId,
      { browse: true, newSearch: true }
    );
    if (result === "search") continue;
    if (result === "browse") {
      mode = "browse";
      continue;
    }
    if (result === "menu") {
      mode = "choose";
      continue;
    }
    if (isSelectedModel(result)) return result;
  }
}
async function selectModelWithSearch(models, toOption, message, initialModelId, browseList) {
  if (models.length === 0) return null;
  const orderedBrowse = browseList ?? sortModelsByBrand(models);
  if (models.length <= MODEL_SEARCH_THRESHOLD) {
    const options = [
      ...models.map(toOption),
      navOption("__back__", "\u2190 Go back", "")
    ];
    const initialValue = initialModelId && options.some((o) => o.value === initialModelId) ? initialModelId : options[0]?.value;
    const picked = await p6.select({
      message,
      options,
      initialValue
    });
    if (p6.isCancel(picked) || String(picked) === "__back__") {
      return "back";
    }
    const selected = models.find((m) => m.id === String(picked));
    if (!selected) return null;
    return selected;
  }
  return selectLargeCatalog(models, orderedBrowse, toOption, message, initialModelId);
}
function noteEnvConflicts(conflicts) {
  printEnvConflictPanel(conflicts);
}
function modelToOption(model, hint) {
  return modelSelectOption(model, hint);
}
async function browseAllModels(provider, prefs) {
  return selectModelWithSearch(
    provider.models,
    (m) => modelToOption(m),
    "Which model?",
    prefs.lastModel
  );
}
async function pickLocalModel(provider, conflicts, prefs) {
  const recentIds = (prefs.recentModelsByProvider?.[provider.id] ?? []).slice(0, MAX_RECENT);
  const recentModels = recentIds.map((id) => provider.models.find((m) => m.id === id)).filter((m) => m !== void 0);
  let selectedModel = null;
  while (true) {
    if (recentModels.length > 0) {
      const options = [
        ...recentModels.map((m) => modelToOption(m, "recent")),
        navOption(BROWSE_ALL, "Browse all models \u2192", `${provider.models.length} available`),
        navOption("__back__", "\u2190 Go back", "Select a different provider")
      ];
      const picked = await p6.select({
        message: "Which model?",
        options,
        initialValue: recentModels[0].id
      });
      if (p6.isCancel(picked) || String(picked) === "__back__") {
        return "back";
      }
      if (String(picked) === BROWSE_ALL) {
        const browsed = await browseAllModels(provider, prefs);
        if (browsed === "back") {
          continue;
        }
        if (!browsed) return null;
        selectedModel = browsed;
        break;
      } else {
        selectedModel = recentModels.find((m) => m.id === String(picked));
        break;
      }
    } else {
      const browsed = await browseAllModels(provider, prefs);
      if (browsed === "back") {
        return "back";
      }
      if (!browsed) return null;
      selectedModel = browsed;
      break;
    }
  }
  noteEnvConflicts(conflicts);
  const modelLabel = formatCodexModelLabel(selectedModel);
  const confirmed = await p6.confirm({
    message: confirmLaunchMessage("Claude Code", modelLabel, selectedModel.id, provider.name),
    initialValue: true
  });
  if (p6.isCancel(confirmed) || !confirmed) {
    p6.cancel("Cancelled.");
    return null;
  }
  relayOutro("Launching", fmtModel(modelLabel, selectedModel.id));
  return selectedModel;
}

// src/favorites.ts
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

// src/favorites-picker.ts
import * as p7 from "@clack/prompts";
import pc6 from "picocolors";
var ADD_BY_PROVIDER = "__browse_by_provider__";
function globalFavoritePickKey(entry) {
  return `${entry.providerId}::${entry.model.id}`;
}
function buildGlobalFavoriteIndex(providers) {
  const out = [];
  for (const provider of providers) {
    for (const model of provider.models) {
      out.push({
        providerId: provider.id,
        providerName: provider.name,
        model
      });
    }
  }
  return out.sort((a, b) => {
    const brandCmp = a.model.brand.localeCompare(b.model.brand);
    if (brandCmp !== 0) return brandCmp;
    const providerCmp = a.providerName.localeCompare(b.providerName);
    if (providerCmp !== 0) return providerCmp;
    return a.model.id.localeCompare(b.model.id);
  });
}
function favoriteSearchScore(entry, query) {
  const m = entry.model;
  return scoreModelSearch(query, [
    { value: m.name, weight: 800 },
    { value: m.id, weight: 700 },
    { value: m.upstreamModelId, weight: 650 },
    { value: m.brand, weight: 350 },
    { value: m.family, weight: 300 },
    { value: entry.providerName, weight: 240 },
    { value: entry.providerId, weight: 220 }
  ]);
}
function filterGlobalFavoriteIndex(entries, query) {
  if (!query.trim()) return [];
  return entries.map((entry, index) => ({ entry, index, score: favoriteSearchScore(entry, query) })).filter((result) => result.score > 0).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.index - b.index;
  }).map((result) => result.entry);
}
function globalFavoriteSelectOption(entry, favorites) {
  const label = formatCodexModelLabel(entry.model);
  const favorited = isFavorite(favorites, { providerId: entry.providerId, modelId: entry.model.id });
  const providerTag = fmtProviderBracket(entry.providerId, entry.providerName, entry.model.isFree);
  return {
    value: globalFavoritePickKey(entry),
    label: `${fmtModel(label, entry.model.id)} ${providerTag}`,
    hint: favorited ? pc6.dim("already in favorites") : ""
  };
}
function parseGlobalFavoritePickKey(key, index) {
  return index.find((e) => globalFavoritePickKey(e) === key);
}
async function pickGlobalFavoriteModel(providers, favorites) {
  const index = buildGlobalFavoriteIndex(providers);
  if (index.length === 0) return null;
  while (true) {
    const searchInput = await p7.text({
      message: `Search all providers (${index.length} models):`,
      placeholder: "e.g. deepseek, claude, sonnet"
    });
    if (p7.isCancel(searchInput)) {
      const fallback = await p7.select({
        message: "Add a favorite",
        options: [
          { value: "back", label: pc6.cyan("\u2190 Back to favorites"), hint: "" },
          { value: ADD_BY_PROVIDER, label: pc6.cyan("Browse by provider \u2192"), hint: "Pick one provider first" }
        ]
      });
      if (p7.isCancel(fallback) || fallback === "back") return null;
      if (fallback === ADD_BY_PROVIDER) return ADD_BY_PROVIDER;
      continue;
    }
    const matched = filterGlobalFavoriteIndex(index, String(searchInput));
    if (matched.length === 0) {
      p7.log.warn("No models match \u2014 try a different search");
      continue;
    }
    const result = await pickModelFromPagedList(
      matched.map((e) => ({ ...e, id: globalFavoritePickKey(e) })),
      (e) => globalFavoriteSelectOption(
        { providerId: e.providerId, providerName: e.providerName, model: e.model },
        favorites
      ),
      matched.length === 1 ? "Match found" : `Select model (${matched.length} matches)`,
      void 0,
      { newSearch: true }
    );
    if (result === "search") continue;
    if (result === "browse" || result === "menu") continue;
    const picked = parseGlobalFavoritePickKey(result.id, matched);
    if (!picked) continue;
    if (isFavorite(favorites, { providerId: picked.providerId, modelId: picked.model.id })) {
      p7.log.warn(`${picked.model.name || picked.model.id} (${picked.providerName}) is already in your favorites.`);
      continue;
    }
    return picked;
  }
}

// src/providers-command.ts
import pc7 from "picocolors";
import * as p8 from "@clack/prompts";
function parseProvidersArgs(args) {
  if (args.length === 0) return { subcommand: "hub", showHelp: false };
  const [first, ...rest] = args;
  if (first === "--help" || first === "-h") return { subcommand: "help", showHelp: true };
  if (first === "add") {
    if (rest.length > 0) return { subcommand: "add", showHelp: false, error: `Unknown add option: ${rest[0]}` };
    return { subcommand: "add", showHelp: false };
  }
  if (first === "import") {
    if (rest.length > 0) return { subcommand: "import", showHelp: false, error: `Unknown import option: ${rest[0]}` };
    return { subcommand: "import", showHelp: false };
  }
  if (first === "list") {
    if (rest.length > 0) return { subcommand: "list", showHelp: false, error: `Unknown list option: ${rest[0]}` };
    return { subcommand: "list", showHelp: false };
  }
  if (first === "auth") {
    if (rest.length === 0) return { subcommand: "auth", showHelp: true };
    let authMethod;
    const positional = [];
    for (const arg of rest) {
      if (arg === "--native") authMethod = "native";
      else if (arg === "--broker") authMethod = "broker";
      else if (arg.startsWith("-")) {
        return { subcommand: "auth", showHelp: false, error: `Unknown auth option: ${arg}` };
      } else {
        positional.push(arg);
      }
    }
    if (positional.length !== 1) {
      return { subcommand: "auth", showHelp: false, error: "Usage: relay-ai providers auth <id> [--native|--broker]" };
    }
    return { subcommand: "auth", showHelp: false, removeId: positional[0], authMethod };
  }
  if (first === "remove") {
    if (rest.length === 0) return { subcommand: "remove", showHelp: false, error: "Usage: relay-ai providers remove <id>" };
    if (rest.length > 1) return { subcommand: "remove", showHelp: false, error: `Unknown remove option: ${rest[1]}` };
    return { subcommand: "remove", showHelp: false, removeId: rest[0] };
  }
  if (first === "refresh-models") {
    if (rest.length === 0) return { subcommand: "refresh-models", showHelp: false };
    if (rest.length > 1) return { subcommand: "refresh-models", showHelp: false, error: `Unknown refresh-models option: ${rest[1]}` };
    return { subcommand: "refresh-models", showHelp: false, removeId: rest[0] };
  }
  return { subcommand: "hub", showHelp: false, error: `Unknown providers subcommand: ${first}` };
}
function providersHelpText() {
  return `${pc7.bold("relay-ai providers")} \u2014 manage your AI providers

${pc7.bold("Usage:")}
  relay-ai providers
  relay-ai providers add
  relay-ai providers import
  relay-ai providers list
  relay-ai providers remove <id>
  relay-ai providers refresh-models [id]
  relay-ai providers auth <id> [--native|--broker]

${pc7.bold("Subcommands:")}
  (none)      Provider hub wizard ${pc7.dim("[Phase 1.1]")}
  add         Add a provider (Groq, Mistral, Together AI, \u2026) ${pc7.dim("[Phase 1.1]")}
  import      Import providers from OpenCode CLI (one-time) ${pc7.dim("[Phase 1.0]")}
  auth        Sign in with OAuth (GitHub Copilot, xAI, OpenAI, Claude Code, Antigravity)
  list        Show configured providers ${pc7.dim("[Phase 1.0]")}
  remove      Remove a provider by id ${pc7.dim("[Phase 1.1]")}
  refresh-models  Update cached model lists ${pc7.dim("[Phase 1.2]")}`;
}
function providerLabel(name, modelCount, enabled) {
  return `${fmtEnabledStar(enabled)} ${fmtProvider(name)} ${pc7.dim(`(${modelCount} model${modelCount === 1 ? "" : "s"})`)}`;
}
async function runProvidersImport() {
  const registry = loadRegistry();
  const hasExisting = registry.providers.length > 0;
  const resolveConflict = hasExisting ? async (ctx) => {
    printImportConflictPanel(ctx.existing.name, ctx.existingKeyHint, ctx.incomingKeyHint);
    const choice = await p8.select({
      message: "Which configuration should we keep?",
      options: [
        { value: "keep", label: pc7.cyan("Keep mine"), hint: "Leave your current relay-ai config unchanged" },
        { value: "import", label: pc7.cyan("Use imported"), hint: "Replace with OpenCode settings and refresh models" },
        { value: "skip", label: pc7.dim("Skip this provider"), hint: "" }
      ]
    });
    if (p8.isCancel(choice)) return "skip";
    return choice;
  } : void 0;
  const spinner10 = p8.spinner();
  spinner10.start("Importing from OpenCode...");
  const result = await importFromOpencode({ resolveConflict });
  spinner10.stop("");
  if (result.error) {
    p8.log.error(result.error);
    return 1;
  }
  if (result.imported.length === 0 && result.skipped.length === 0) {
    p8.log.warn("No configured providers found in OpenCode.");
    p8.log.info("Add providers in OpenCode first, or use relay-ai providers add.");
    return 0;
  }
  if (result.authFileWarning) {
    p8.log.warn(result.authFileWarning);
  }
  const importedNames = result.imported.map((pr) => pr.name).join(", ");
  const modelTotal = result.imported.reduce((n, pr) => n + (pr.modelsCache?.models.length ?? 0), 0);
  const credNote = result.oauthImported > 0 ? ` (${result.oauthImported} via OAuth)` : "";
  p8.log.success(
    `Imported ${importedNames} \u2014 ${modelTotal} model${modelTotal === 1 ? "" : "s"}, ${result.keysSaved} credential${result.keysSaved === 1 ? "" : "s"} saved to Keychain${credNote}.`
  );
  if (result.skipped.length > 0) {
    for (const s of result.skipped) {
      const reason = s.reason === "user-skipped" ? "skipped by you" : s.reason === "conflict-kept" ? "kept your existing config" : s.reason === "oauth-no-token" ? "OAuth provider in OpenCode but not signed in \u2014 run relay-ai providers auth" : s.reason === "no-api-key" ? "no API key in OpenCode \u2014 add key there or use relay-ai providers add" : s.reason === "manual-only" ? "uses gcloud/AWS credentials \u2014 not importable via API key" : s.reason === "placeholder-key" ? "placeholder API key \u2014 provider not imported" : s.reason === "invalid-key" ? "API key failed verification \u2014 provider not imported" : s.reason === "credential-save-failed" ? "could not save credential \u2014 provider not imported" : s.reason;
      p8.log.warn(`Skipped ${s.name} (${s.id}): ${reason}`);
    }
  }
  if (result.keysSkipped.length > 0) {
    for (const k of result.keysSkipped) {
      if (k.detail) {
        p8.log.info(`${k.name} (${k.id}): ${k.detail}`);
      }
    }
  }
  if (result.imported.length > 0) {
    const refreshSpinner = p8.spinner();
    refreshSpinner.start("Fetching model capabilities from providers...");
    const registry2 = loadRegistry();
    for (const provider of result.imported) {
      const key = await resolveRefreshCredential(
        provider,
        async (pr) => resolveProviderCredential(pr.id, pr.authRef)
      );
      await refreshProviderModels(provider.id, key, registry2);
    }
    refreshSpinner.stop("Model capabilities refreshed.");
  }
  return 0;
}
async function runProvidersAuth(providerId, method) {
  try {
    const result = await authenticateProvider(providerId, { method });
    p8.log.success(`Signed in to ${result.registryProvider.name} \u2014 credential saved to Keychain.`);
    return 0;
  } catch (err) {
    if (err instanceof Error && err.message === "Cancelled") {
      p8.cancel("Cancelled.");
      return 0;
    }
    p8.log.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}
async function runProvidersRefreshModels(providerId) {
  const resolveKey = async (provider) => resolveProviderCredential(provider.id, provider.authRef);
  if (providerId) {
    const registry = loadRegistry();
    const provider = registry.providers.find((p20) => p20.id === providerId);
    if (!provider) {
      p8.log.error(`Provider not found: ${providerId}`);
      return 1;
    }
    const spinner11 = p8.spinner();
    spinner11.start(`Refreshing ${provider.name}...`);
    const key = await resolveRefreshCredential(
      provider,
      async (p20) => resolveProviderCredential(p20.id, p20.authRef)
    );
    const result = await refreshProviderModels(providerId, key);
    spinner11.stop("");
    if (result.skipped) {
      const countNote = result.modelCount ? ` (${result.modelCount} cached models kept)` : "";
      p8.log.warn(`${result.name}: ${result.reason}${countNote}`);
      return 0;
    }
    if (!result.ok) {
      p8.log.error(`${result.name}: ${result.reason ?? "Refresh failed."}`);
      return 1;
    }
    const diff = result.previousModelCount === void 0 ? 0 : (result.modelCount ?? 0) - result.previousModelCount;
    const diffStr = result.previousModelCount === void 0 ? "" : diff > 0 ? ` (+${diff})` : diff < 0 ? ` (${diff})` : "";
    p8.log.success(`${result.name}: ${result.modelCount} model${result.modelCount === 1 ? "" : "s"} updated${diffStr}.`);
    return 0;
  }
  const spinner10 = p8.spinner();
  spinner10.start("Refreshing model lists...");
  const { refreshed } = await refreshAllProviderModels(resolveKey);
  spinner10.stop("");
  const ok = refreshed.filter((r) => r.ok && !r.skipped);
  const skipped = refreshed.filter((r) => r.skipped);
  const failed = refreshed.filter((r) => !r.ok);
  if (ok.length > 0) {
    p8.log.success(`Updated ${ok.length} provider${ok.length === 1 ? "" : "s"}.`);
    for (const r of ok) {
      const diff = r.previousModelCount === void 0 ? 0 : (r.modelCount ?? 0) - r.previousModelCount;
      const diffStr = r.previousModelCount === void 0 ? "" : diff > 0 ? ` (+${diff})` : diff < 0 ? ` (${diff})` : "";
      p8.log.info(`  ${r.name}: ${r.modelCount} model${r.modelCount === 1 ? "" : "s"}${diffStr}`);
    }
  }
  for (const r of skipped) {
    const countNote = r.modelCount ? ` (${r.modelCount} cached models kept)` : "";
    p8.log.warn(`Skipped ${r.name}: ${r.reason}${countNote}`);
  }
  for (const r of failed) {
    p8.log.error(`${r.name}: ${r.reason ?? "Refresh failed."}`);
  }
  return failed.length > 0 ? 1 : 0;
}
async function runProvidersList() {
  const entries = await resolveProvidersForDisplay();
  if (entries.length === 0) {
    p8.log.info("No providers configured. Run relay-ai providers add or import.");
    return 0;
  }
  console.log("");
  for (const entry of entries) {
    const status = entry.enabled ? pc7.green("\u25CF") : pc7.dim("\u25CB");
    console.log(
      `  ${status} ${pc7.bold(entry.name)} ${pc7.dim(`(${entry.id})`)} \u2014 ${entry.modelCount} model${entry.modelCount === 1 ? "" : "s"}, auth: ${entry.authLabel}`
    );
  }
  console.log("");
  return 0;
}
async function pickTemplateFromCatalog() {
  while (true) {
    const registry = loadRegistry();
    const configuredIds = new Set(registry.providers.map((p20) => p20.id));
    const templates = listAddableTemplates(configuredIds);
    if (templates.length === 0) return null;
    const method = await p8.select({
      message: `Choose a provider (${templates.length} available)`,
      options: [
        { value: "search", label: "Search providers", hint: "e.g. gro, mistral, together" },
        { value: "browse", label: "Browse all providers", hint: "Scroll the full list" },
        { value: "back", label: "Back", hint: "" }
      ]
    });
    if (p8.isCancel(method) || method === "back") return null;
    if (method === "browse") {
      const options2 = templates.map((t) => ({
        value: t.id,
        label: t.name,
        hint: t.npm
      }));
      const picked2 = await p8.select({ message: "Select a provider", options: options2 });
      if (p8.isCancel(picked2)) continue;
      const template2 = templates.find((t) => t.id === picked2);
      if (template2) return template2;
      continue;
    }
    const searchInput = await p8.text({
      message: "Search providers:",
      placeholder: "e.g. groq, mistral, openrouter"
    });
    if (p8.isCancel(searchInput)) continue;
    const query = String(searchInput);
    const matched = filterTemplates(templates, query);
    if (matched.length === 0) {
      const alreadyAdded = filterTemplates(listSupportedTemplates(), query).filter((t) => configuredIds.has(t.id));
      if (alreadyAdded.length > 0) {
        p8.log.info(`Already configured: ${alreadyAdded.map((t) => t.name).join(", ")}`);
      } else {
        p8.log.warn("No providers match \u2014 try a different search");
      }
      continue;
    }
    const options = matched.map((t) => ({
      value: t.id,
      label: t.name,
      hint: t.npm
    }));
    const picked = await p8.select({
      message: matched.length === 1 ? "Match found" : `Select provider (${matched.length} matches)`,
      options
    });
    if (p8.isCancel(picked)) continue;
    const template = matched.find((t) => t.id === picked);
    if (template) return template;
  }
}
async function runTemplateAddFlow() {
  if (listAddableTemplates(loadRegistry().providers.map((p20) => p20.id)).length === 0) {
    p8.log.info("All catalog providers are already configured.");
    return 0;
  }
  const template = await pickTemplateFromCatalog();
  if (!template) return 0;
  if (template.modelSource === "zen-go-api") {
    const existingKey = await readGlobalOpencodeCredential();
    let apiKey2 = existingKey;
    if (!apiKey2) {
      printPanel(pc7.cyan("OpenCode cloud"), [
        `${pc7.white("Get an API key at:")} ${fmtUrl("https://opencode.ai/auth")}`,
        `${pc7.dim("Uses OpenCode Zen / Go cloud models \u2014 not the same as importing from the OpenCode CLI.")}`
      ]);
      const collected = await resolveOrCollectApiKey(false, false);
      if (!collected) {
        p8.cancel("Cancelled.");
        return 0;
      }
      apiKey2 = collected;
    }
    await migrateGlobalOpencodeCredential();
    const spinner11 = p8.spinner();
    spinner11.start(`Adding ${template.name}...`);
    const zenStub = addZenRegistryStub();
    const goStub = addGoRegistryStub();
    if (!zenStub.added && !goStub.added) {
      spinner11.stop("");
      p8.log.warn("OpenCode Zen / Go is already configured.");
      return 0;
    }
    const registry = loadRegistry();
    const refreshResults = [
      await refreshProviderModels("zen", apiKey2, registry),
      await refreshProviderModels("go", apiKey2, registry)
    ];
    spinner11.stop("");
    const modelCount = refreshResults.reduce((total, result2) => total + (result2.modelCount ?? 0), 0);
    const failed = refreshResults.filter((result2) => !result2.ok);
    if (failed.length === 0) {
      p8.log.success(`Added ${template.name} \u2014 ${fmtCount(modelCount, "model")} updated.`);
    } else {
      p8.log.warn(`Added ${template.name}, but ${failed.length} catalog refresh${failed.length === 1 ? "" : "es"} failed.`);
    }
    return 0;
  }
  if (template.signupUrl) {
    printPanel(fmtProvider(template.name), [
      `${pc7.white("Get an API key at:")} ${fmtUrl(template.signupUrl)}`
    ]);
  }
  let baseUrlOverride;
  if (template.urlPrompt) {
    const urlInput = await p8.text({
      message: template.urlPrompt,
      initialValue: template.defaultBaseUrl,
      validate: (v) => v.trim() ? void 0 : "URL is required"
    });
    if (p8.isCancel(urlInput)) return 0;
    baseUrlOverride = String(urlInput).trim();
    const usesHttp = /^http:\/\//i.test(baseUrlOverride);
    if (usesHttp) {
      p8.log.warn("HTTP is not encrypted. Use it only for trusted local or LAN servers, like Ollama on your own network.");
    }
    const valid = await validateCustomEndpointUrl(baseUrlOverride, { allowInsecureLocal: usesHttp });
    if (!valid.ok) {
      p8.log.error(valid.error ?? "Invalid URL");
      if (valid.hint) p8.log.info(valid.hint);
      return 1;
    }
  }
  const apiKeyMsg = template.apiKeyOptional ? `API key (leave empty for local servers without auth):` : `Paste your ${template.name} API key:`;
  const apiKeyInput = await p8.password({
    message: apiKeyMsg,
    validate: (val) => template.apiKeyOptional ? void 0 : val.trim() ? void 0 : "Key cannot be empty"
  });
  if (p8.isCancel(apiKeyInput)) {
    p8.cancel("Cancelled.");
    return 0;
  }
  const rawKey = String(apiKeyInput).trim();
  const apiKey = template.apiKeyOptional && !rawKey ? template.id : rawKey;
  const spinner10 = p8.spinner();
  spinner10.start(`Testing connection to ${template.name}...`);
  const result = await addProviderFromTemplate(template, apiKey, { baseUrl: baseUrlOverride });
  spinner10.stop("");
  if (!result.added) {
    p8.log.error(result.error ?? "Could not add provider.");
    if (result.hint) p8.log.info(result.hint);
    return 1;
  }
  logConnected(template.name, result.modelCount ?? 0);
  return 0;
}
async function runCustomEndpointAddFlow() {
  const kindChoice = await p8.select({
    message: "Custom server type",
    options: [
      {
        value: "openai",
        label: "Works with most AI services",
        hint: "OpenAI-compatible API (Together, vLLM, Ollama, \u2026)"
      },
      {
        value: "anthropic",
        label: "Claude-style API servers",
        hint: "Anthropic-compatible /v1/messages passthrough"
      },
      { value: "back", label: "Back", hint: "" }
    ]
  });
  if (p8.isCancel(kindChoice) || kindChoice === "back") return 0;
  const displayName = await p8.text({
    message: "Display name:",
    placeholder: "My Work LLM",
    validate: (v) => v.trim() ? void 0 : "Name is required"
  });
  if (p8.isCancel(displayName)) return 0;
  const baseUrl = await p8.text({
    message: "Base URL:",
    placeholder: kindChoice === "openai" ? "https://api.together.xyz/v1" : "https://api.anthropic.com",
    validate: (v) => v.trim() ? void 0 : "URL is required"
  });
  if (p8.isCancel(baseUrl)) return 0;
  const usesHttp = /^http:\/\//i.test(String(baseUrl).trim());
  let allowInsecureHttp = false;
  if (usesHttp) {
    p8.log.warn("HTTP is not encrypted. Only use it for a trusted local or LAN server, like Ollama on your own network.");
    const allowLocal = await p8.confirm({
      message: "Allow insecure HTTP for this local/LAN server?",
      initialValue: true
    });
    if (p8.isCancel(allowLocal)) return 0;
    allowInsecureHttp = allowLocal === true;
  }
  const apiKey = await p8.password({
    message: "API key (leave empty for local servers without auth):"
  });
  if (p8.isCancel(apiKey)) return 0;
  const spinner10 = p8.spinner();
  spinner10.start("Testing connection...");
  const result = await addCustomEndpointProvider({
    displayName: String(displayName).trim(),
    baseUrl: String(baseUrl).trim(),
    apiKey: String(apiKey ?? "").trim(),
    kind: kindChoice,
    allowInsecureLocal: allowInsecureHttp
  });
  spinner10.stop("");
  if (!result.added) {
    p8.log.error(result.error ?? "Could not add custom provider.");
    if (result.hint) p8.log.info(result.hint);
    return 1;
  }
  logConnected(result.provider?.name ?? "Provider", result.modelCount ?? 0);
  return 0;
}
async function runProvidersAdd() {
  const registry = loadRegistry();
  const hasOpencode = findOpencodeBinary() !== null;
  const options = [
    {
      value: "import",
      label: "Import providers from OpenCode CLI",
      hint: hasOpencode ? "Import Groq, OpenAI, etc. from your OpenCode config" : "Requires OpenCode CLI"
    }
  ];
  const addableTemplates = listAddableTemplates(registry.providers.map((p20) => p20.id));
  if (addableTemplates.length > 0) {
    options.push({
      value: "templates",
      label: "Add Groq, Mistral, Together AI, \u2026",
      hint: `${addableTemplates.length} provider${addableTemplates.length === 1 ? "" : "s"} available`
    });
  }
  options.push({
    value: "custom",
    label: "Custom server (Advanced)",
    hint: "OpenAI-compatible or Claude-style API URL"
  });
  const choice = await p8.select({ message: "Add a provider", options });
  if (p8.isCancel(choice)) {
    p8.cancel("Cancelled.");
    return 0;
  }
  if (choice === "import") {
    if (!hasOpencode) {
      p8.log.error("OpenCode CLI not found. Install from https://opencode.ai");
      return 1;
    }
    return runProvidersImport();
  }
  if (choice === "templates") return runTemplateAddFlow();
  if (choice === "custom") return runCustomEndpointAddFlow();
  return 0;
}
async function runProvidersRemove(id, interactive = false) {
  const registry = loadRegistry();
  const provider = registry.providers.find((pr) => pr.id === id);
  if (!provider) {
    p8.log.error(`Provider not found: ${id}`);
    return 1;
  }
  if (interactive) {
    const confirm11 = await p8.confirm({
      message: `Remove ${provider.name} (${id})?`,
      initialValue: false
    });
    if (p8.isCancel(confirm11) || !confirm11) {
      p8.cancel("Cancelled.");
      return 0;
    }
  }
  const result = await removeProviderFromRegistry(id);
  if (!result.removed) {
    p8.log.error(result.error ?? `Could not remove ${id}`);
    return 1;
  }
  p8.log.success(`Removed ${result.name ?? id}.`);
  if (result.credentialDeleted) {
    p8.log.info("Provider API key removed from Keychain.");
  }
  return 0;
}
async function runOpenCodeCloudDetail() {
  const registry = loadRegistry();
  const routes = registry.providers.filter((provider) => provider.id === "zen" || provider.id === "go");
  printCloudProviderPanel("OpenCode Zen / Go");
  if (routes.length === 0) return "back";
  const choice = await p8.select({
    message: "Manage an OpenCode catalog",
    options: [
      ...routes.map((provider) => ({
        value: provider.id,
        label: provider.name,
        hint: `${provider.modelsCache?.models.length ?? 0} cached models`
      })),
      { value: "back", label: "Back", hint: "" }
    ]
  });
  if (!p8.isCancel(choice) && choice !== "back") {
    await runProviderDetail(String(choice));
  }
  return "back";
}
function providerHubChoiceValue(entry) {
  return entry.cloudBuiltin ? `cloud:${entry.cloudBuiltin}` : `provider:${entry.id}`;
}
async function runProviderDetail(id) {
  const registry = loadRegistry();
  const provider = registry.providers.find((pr) => pr.id === id);
  if (!provider) return "back";
  const modelCount = provider.modelsCache?.models.length ?? 0;
  const authLabel = formatRegistryAuthLabel(provider);
  printProviderDetailPanel(provider.name, modelCount, authLabel);
  const detailOptions = [
    {
      value: "refresh",
      label: "Refresh model list",
      hint: "Fetch latest models from the provider API"
    }
  ];
  if (supportsNativeOAuth(id) || provider.authType === "oauth") {
    detailOptions.push({
      value: "auth",
      label: "Sign in again (OAuth)",
      hint: "Refresh OAuth tokens or switch accounts"
    });
  }
  detailOptions.push(
    {
      value: "toggle",
      label: provider.enabled ? "Disable provider" : "Enable provider",
      hint: provider.enabled ? "Hide from relay-ai claude picker" : "Show in relay-ai claude picker"
    },
    { value: "remove", label: "Remove provider", hint: "Delete from registry and Keychain when safe" },
    { value: "back", label: "Back", hint: "" }
  );
  const action = await p8.select({
    message: "What would you like to do?",
    options: detailOptions
  });
  if (p8.isCancel(action) || action === "back") return "back";
  if (action === "refresh") {
    await runProvidersRefreshModels(id);
    return "back";
  }
  if (action === "auth") {
    await runProvidersAuth(id);
    return "back";
  }
  if (action === "toggle") {
    const result = toggleProviderEnabled(id);
    if (result.toggled) {
      p8.log.success(`${provider.name} ${result.enabled ? "enabled" : "disabled"}.`);
    }
    return "back";
  }
  const code = await runProvidersRemove(id, true);
  return code === 0 ? "removed" : "back";
}
async function runProvidersHub() {
  const hasOpencode = findOpencodeBinary() !== null;
  while (true) {
    const entries = await resolveProvidersForDisplay();
    const options = [
      { value: "add", label: pc7.bold("+ Add a provider"), hint: "" }
    ];
    for (const entry of entries) {
      const hint = entry.id;
      const value = providerHubChoiceValue(entry);
      options.push({
        value,
        label: providerLabel(entry.name, entry.modelCount, entry.enabled),
        hint
      });
    }
    options.push({ value: "auth-menu", label: "\u2192 Sign in with OAuth", hint: "GitHub Copilot \xB7 xAI \xB7 OpenAI \xB7 Claude Code \xB7 Antigravity" });
    if (entries.length > 0) {
      options.push({ value: "refresh-all", label: "\u21BA Refresh all models", hint: "Update model lists for all providers" });
    }
    if (hasOpencode) {
      options.push({ value: "import", label: "\u2192 Import providers from OpenCode CLI", hint: "One-time import" });
    }
    options.push({ value: "done", label: "Done", hint: "" });
    const choice = await p8.select({
      message: entries.length > 0 ? "Your AI providers" : "Get started",
      options
    });
    if (p8.isCancel(choice) || choice === "done") {
      return 0;
    }
    if (choice === "add") {
      await runProvidersAdd();
      continue;
    }
    if (choice === "import") {
      await runProvidersImport();
      continue;
    }
    if (choice === "refresh-all") {
      await runProvidersRefreshModels();
      continue;
    }
    if (choice === "auth-menu") {
      const providerId = await p8.select({
        message: "Which provider?",
        options: [
          { value: "github-copilot", label: "GitHub Copilot", hint: "device code" },
          { value: "xai", label: "xAI Grok (SuperGrok)", hint: "device code" },
          { value: "openai", label: "OpenAI ChatGPT Plus/Pro", hint: "device code" },
          { value: "claude-code", label: "Claude Code (Anthropic subscription)", hint: "\u26A0\uFE0F  account risk" },
          { value: "antigravity", label: "Antigravity (Google Cloud Code Assist)", hint: "\u26A0\uFE0F  account risk" }
        ]
      });
      if (!p8.isCancel(providerId)) await runProvidersAuth(providerId);
      continue;
    }
    if (typeof choice === "string" && choice.startsWith("cloud:")) {
      const id = choice.slice("cloud:".length);
      if (id === "opencode") await runOpenCodeCloudDetail();
      continue;
    }
    if (typeof choice === "string" && choice.startsWith("provider:")) {
      const id = choice.slice("provider:".length);
      const outcome = await runProviderDetail(id);
      if (outcome === "removed") continue;
    }
  }
}
async function runProvidersCommand(args) {
  const parsed = parseProvidersArgs(args);
  if (parsed.error) {
    p8.log.error(parsed.error);
    return 1;
  }
  if (parsed.showHelp) {
    console.log(providersHelpText());
    return 0;
  }
  if (parsed.subcommand === "import") return runProvidersImport();
  if (parsed.subcommand === "list") return runProvidersList();
  if (parsed.subcommand === "add") return runProvidersAdd();
  if (parsed.subcommand === "remove" && parsed.removeId) return runProvidersRemove(parsed.removeId);
  if (parsed.subcommand === "refresh-models") return runProvidersRefreshModels(parsed.removeId);
  if (parsed.subcommand === "auth") {
    if (parsed.showHelp || !parsed.removeId) {
      console.log(providerAuthHelpText());
      return 0;
    }
    return runProvidersAuth(parsed.removeId, parsed.authMethod);
  }
  relayIntro("Your AI providers");
  return runProvidersHub();
}

// src/codex.ts
import pc10 from "picocolors";
import * as p11 from "@clack/prompts";

// src/codex-proxy.ts
import { createHash as createHash2 } from "crypto";
import { createServer as createServer3 } from "http";

// src/codex-responses-adapter.ts
import { streamText as streamText3, generateText as generateText3, tool as tool4, jsonSchema as jsonSchema4 } from "ai";

// src/codex/upstream-error.ts
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
function sanitizeMessage(message) {
  const line = message.split("\n")[0]?.trim() ?? message;
  if (line.startsWith("RetryError") || line.includes("AI_RetryError")) {
    return "Upstream model request failed after retries.";
  }
  return line;
}

// src/codex-responses-adapter.ts
function messageText(content) {
  if (typeof content === "string") return content;
  return (content ?? []).map((p20) => p20.type === "output_text" || p20.type === "input_text" || p20.type === "text" ? p20.text ?? "" : "").join("");
}
function extractDeveloperAndInstructions(items, instructions) {
  const developerParts = [];
  const remaining = [];
  for (const item of items) {
    if ("role" in item && item.role === "developer") {
      const text5 = messageText(item.content);
      if (text5.trim()) developerParts.push(text5.trim());
    } else {
      remaining.push(item);
    }
  }
  const parts = [...developerParts];
  if (instructions?.trim()) parts.push(instructions.trim());
  const system = parts.length ? parts.join("\n") : void 0;
  return { system, remaining };
}
function annotateToolNamesFromCalls(items) {
  const nameByCallId = /* @__PURE__ */ new Map();
  for (const item of items) {
    if (item.type === "function_call") {
      const { rawId } = splitToolUseId(item.call_id);
      nameByCallId.set(rawId, item.name);
    }
  }
  return nameByCallId;
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
function makeReasoningOutputItem(id, text5) {
  return {
    id,
    type: "reasoning",
    summary: text5.trim() ? [{ type: "summary_text", text: text5 }] : []
  };
}
function translateResponsesInput(input, instructions, npm) {
  if (typeof input === "string") {
    return {
      system: instructions?.trim() || void 0,
      messages: [{ role: "user", content: [{ type: "text", text: input }] }]
    };
  }
  const { system, remaining } = extractDeveloperAndInstructions(input, instructions);
  const toolNames = annotateToolNamesFromCalls(remaining);
  const messages = [];
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
        toolName: item.name,
        input: parseToolArguments(item.arguments)
      };
      if (thoughtSignature && npm === "@ai-sdk/google") {
        toolPart.providerOptions = { google: { thoughtSignature } };
      }
      parts.push(toolPart);
      messages.push({ role: "assistant", content: parts });
    } else if (item.type === "function_call_output") {
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
    } else if ("role" in item) {
      const role = item.role === "assistant" ? "assistant" : "user";
      const text5 = messageText(item.content);
      messages.push({ role, content: [{ type: "text", text: text5 }] });
    }
  }
  return {
    system,
    messages: ensureUserFirst(mergeConsecutiveMessages(messages))
  };
}
function translateResponsesTools(tools) {
  if (!tools?.length) return void 0;
  const out = {};
  for (const t of tools) {
    if (t.type !== "function" || !t.name) continue;
    out[t.name] = tool4({
      description: t.description ?? "",
      inputSchema: jsonSchema4(t.parameters ?? { type: "object", properties: {} })
    });
  }
  return Object.keys(out).length ? out : void 0;
}
function translateResponsesRequest(body, npm, metadata) {
  const { system, messages } = translateResponsesInput(body.input, body.instructions, npm);
  const effort = body.reasoning?.effort;
  const providerOptions = deepMergeProviderOptions(
    thinkingProviderOptions(npm),
    effortProviderOptions(npm, effort, body.model, metadata)
  );
  return {
    system,
    messages,
    tools: translateResponsesTools(body.tools),
    maxOutputTokens: body.max_output_tokens,
    temperature: body.temperature,
    providerOptions
  };
}
function newResponseId() {
  return `resp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
function newItemId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
function usageFromPart(part) {
  const input = part.totalUsage?.inputTokens ?? 0;
  const output = part.totalUsage?.outputTokens ?? 0;
  return { input_tokens: input, output_tokens: output, total_tokens: input + output };
}
async function writeResponsesStream(fullStream, modelId, write) {
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
  let reasoningItemId = null;
  let reasoningText = "";
  let reasoningOutputIndex = 0;
  const outputItems = [];
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
    const itemId = rawId ?? newItemId("fc");
    const state = rememberToolState({
      itemId,
      callId: encodeToolUseId(itemId, signature),
      name: name ?? "unknown",
      outputIndex: outputIndex++,
      args: ""
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
      case "finish":
        if (part.totalUsage) usage = usageFromPart(part);
        break;
      case "error": {
        const msg = formatUpstreamError(part.error);
        const is429 = msg.includes("429") || part.error && typeof part.error === "object" && (part.error.statusCode === 429 || part.error.lastError?.statusCode === 429);
        process.stderr.write(`[relay-ai] ${modelId}: ${msg}
`);
        writeResponsesRateLimitStream(modelId, is429 ? msg : "(conversation context was too large to summarize)", write);
        return;
      }
      default:
        break;
    }
  }
  if (textItemId) {
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
      status: "completed",
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
  for (const tool6 of toolStates) {
    emit("response.function_call_arguments.done", {
      type: "response.function_call_arguments.done",
      item_id: tool6.itemId,
      output_index: tool6.outputIndex,
      arguments: tool6.args
    });
    const fcItem = {
      type: "function_call",
      id: tool6.itemId,
      call_id: tool6.callId,
      name: tool6.name,
      arguments: tool6.args,
      status: "completed"
    };
    emit("response.output_item.done", {
      type: "response.output_item.done",
      output_index: tool6.outputIndex,
      item: fcItem
    });
    outputItems.push(fcItem);
  }
  if (outputItems.length === 0) {
    outputItems.push({ id: newItemId("msg"), type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "(conversation context was too large to summarize)" }] });
  }
  emit("response.completed", {
    type: "response.completed",
    response: {
      id: responseId,
      object: "response",
      model: modelId,
      created_at: createdAt,
      status: "completed",
      output: outputItems,
      usage
    }
  });
}
async function streamResponsesResponse(model, params, modelId, write) {
  const result = streamText3({ model, ...params, onError: () => {
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
  await writeResponsesStream(result.fullStream, modelId, write);
}
async function generateResponsesResponse(model, params, modelId) {
  let r;
  try {
    r = await generateText3({ model, ...params });
  } catch {
    return {
      id: newResponseId(),
      object: "response",
      model: modelId,
      created_at: Math.floor(Date.now() / 1e3),
      status: "completed",
      output: [{ id: newItemId("msg"), type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "(conversation context was too large to summarize)" }] }],
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }
    };
  }
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
      status: "completed",
      content: [{ type: "output_text", text: r.text }]
    });
  }
  for (const tc of r.toolCalls) {
    const encodedId = encodeToolUseId(tc.toolCallId, grabRoundTripSignature(tc));
    output.push({
      type: "function_call",
      id: tc.toolCallId,
      call_id: encodedId,
      name: tc.toolName,
      arguments: JSON.stringify(tc.input ?? {}),
      status: "completed"
    });
  }
  if (output.length === 0) {
    output.push({ id: newItemId("msg"), type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "(conversation context was too large to summarize)" }] });
  }
  const inputTokens = r.usage?.inputTokens ?? 0;
  const outputTokens = r.usage?.outputTokens ?? 0;
  return {
    id: responseId,
    object: "response",
    model: modelId,
    created_at: createdAt,
    status: "completed",
    output,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens
    }
  };
}
function writeResponsesErrorStream(modelId, _message, write, _statusCode = 401) {
  writeResponsesRateLimitStream(modelId, "(conversation context was too large to summarize)", write);
}
function writeResponsesRateLimitStream(modelId, message, write) {
  const responseId = newResponseId();
  const itemId = newItemId("msg");
  const createdAt = Math.floor(Date.now() / 1e3);
  const content = [{ type: "output_text", text: message }];
  write(sseChunk("response.output_item.added", {
    type: "response.output_item.added",
    output_index: 0,
    item: { id: itemId, type: "message", role: "assistant", status: "in_progress", content: [] }
  }));
  write(sseChunk("response.content_part.added", {
    type: "response.content_part.added",
    item_id: itemId,
    output_index: 0,
    content_index: 0,
    part: { type: "output_text", text: "" }
  }));
  write(sseChunk("response.output_text.delta", {
    type: "response.output_text.delta",
    item_id: itemId,
    output_index: 0,
    content_index: 0,
    delta: message
  }));
  write(sseChunk("response.output_text.done", {
    type: "response.output_text.done",
    item_id: itemId,
    output_index: 0,
    content_index: 0,
    text: message
  }));
  write(sseChunk("response.content_part.done", {
    type: "response.content_part.done",
    item_id: itemId,
    output_index: 0,
    content_index: 0,
    part: { type: "output_text", text: message }
  }));
  write(sseChunk("response.output_item.done", {
    type: "response.output_item.done",
    output_index: 0,
    item: { id: itemId, type: "message", role: "assistant", status: "completed", content }
  }));
  write(sseChunk("response.completed", {
    type: "response.completed",
    response: {
      id: responseId,
      object: "response",
      model: modelId,
      created_at: createdAt,
      status: "completed",
      output: [{ id: itemId, type: "message", role: "assistant", status: "completed", content }]
    }
  }));
}
function responsesRateLimitBody(modelId, message) {
  const itemId = newItemId("msg");
  const content = [{ type: "output_text", text: message }];
  return {
    id: newResponseId(),
    object: "response",
    model: modelId,
    created_at: Math.floor(Date.now() / 1e3),
    status: "completed",
    output: [{ id: itemId, type: "message", role: "assistant", status: "completed", content }]
  };
}

// src/codex-proxy.ts
function estimateMessageChars(params) {
  let chars = (params.system ?? "").length;
  for (const msg of params.messages) {
    if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (!part || typeof part !== "object") continue;
        const p20 = part;
        if (typeof p20["text"] === "string") {
          chars += p20["text"].length;
        } else {
          chars += JSON.stringify(part).length;
        }
      }
    } else if (typeof msg.content === "string") {
      chars += msg.content.length;
    }
  }
  return chars;
}
function clipTextForContext(text5, maxChars) {
  if (text5.length <= maxChars) return text5;
  const edge = Math.floor(maxChars / 2);
  const omitted = text5.length - edge * 2;
  return `${text5.slice(0, edge)}

[... ${omitted} chars omitted from oversized context item ...]

${text5.slice(-edge)}`;
}
function clipLargeTextParts(params, maxCharsPerPart) {
  const messages = params.messages.map((msg) => {
    if (typeof msg.content === "string") {
      return { ...msg, content: clipTextForContext(msg.content, maxCharsPerPart) };
    }
    if (!Array.isArray(msg.content)) return msg;
    return {
      ...msg,
      content: msg.content.map((part) => {
        if (!part || typeof part !== "object") return part;
        const p20 = part;
        if (typeof p20.text !== "string") return part;
        return { ...p20, text: clipTextForContext(p20.text, maxCharsPerPart) };
      })
    };
  });
  return {
    ...params,
    messages
  };
}
function trimToContextLimit(params, contextWindow, charLimit = Math.floor(contextWindow * 0.85) * 3) {
  if (estimateMessageChars(params) <= charLimit) return params;
  let messages = [...params.messages];
  while (messages.length > 1 && estimateMessageChars({ ...params, messages }) > charLimit) {
    messages = messages.slice(1);
    while (messages.length > 1 && messages[0].role !== "user") {
      messages = messages.slice(1);
    }
  }
  const firstAssistant = messages.findIndex((m) => m.role === "assistant");
  if (firstAssistant > 0) {
    messages = messages.filter((m, i) => i >= firstAssistant || m.role !== "tool");
  }
  if (messages.length < 3 && params.messages.length >= 3) {
    return params;
  }
  if (messages.length === 0) {
    messages = [{ role: "user", content: [{ type: "text", text: "" }] }];
  }
  return { ...params, messages };
}
function isCompactionSizedRequest(body, params, contextWindow) {
  const inputItems = Array.isArray(body.input) ? body.input.length : typeof body.input === "string" ? 1 : 0;
  return inputItems > 200 && params.messages.length > 50 && estimateMessageChars(params) > contextWindow;
}
var PROXY_PLACEHOLDER_KEY = "proxy-local";
function codexRouteLookupIds(requestedModel) {
  const ids = routeLookupIds(requestedModel);
  const bare = parseCodexAppModelSlug(requestedModel);
  if (bare !== requestedModel) {
    ids.push(bare, ...routeLookupIds(bare));
  }
  const slash = requestedModel.indexOf("/");
  if (slash >= 0) {
    const afterProvider = requestedModel.slice(slash + 1);
    ids.push(afterProvider, ...routeLookupIds(afterProvider));
  }
  const doubleUnderscore = requestedModel.indexOf("__");
  if (doubleUnderscore >= 0) {
    const afterProvider = requestedModel.slice(doubleUnderscore + 2);
    ids.push(afterProvider, ...routeLookupIds(afterProvider));
  }
  return [...new Set(ids)];
}
function findCodexProxyRoute(routes, requestedModel) {
  const ids = codexRouteLookupIds(requestedModel);
  for (const id of ids) {
    const route = routes.find(
      (r) => r.modelId === id || codexAppModelSlug(r.modelId) === id
    );
    if (route) return route;
  }
  return void 0;
}
function upstreamHttpStatus(err, msg) {
  if (err && typeof err === "object" && "statusCode" in err) {
    const code = err.statusCode;
    if (code === 400 || code === 401 || code === 403 || code === 404 || code === 429) return code;
  }
  if (msg.includes("HTTP 429") || msg.includes("429")) return 429;
  if (msg.includes("HTTP 400")) return 400;
  return 500;
}
function resolveModel(routes, models, requestedModel) {
  const route = findCodexProxyRoute(routes, requestedModel);
  if (!route) return void 0;
  const languageModel = models.get(route.modelId);
  if (!languageModel) return void 0;
  return { route, languageModel };
}
async function startCodexProxy(routes, options = {}) {
  const opts = typeof options === "boolean" ? { debug: options } : options;
  const debug = opts.debug ?? false;
  const requireAuth = opts.requireAuth ?? true;
  silenceSdkWarnings();
  const models = /* @__PURE__ */ new Map();
  for (const route of routes) {
    models.set(route.modelId, await createLanguageModel({
      npm: route.npm,
      modelId: route.upstreamModelId,
      apiKey: route.apiKey,
      baseURL: route.baseURL,
      providerId: route.modelId,
      authType: route.authType,
      oauthAccountId: route.oauthAccountId,
      vertex: route.vertex
    }));
  }
  return new Promise((resolve, reject2) => {
    const log18 = debug ? makeTraceLogger(getCodexProxyDebugLogPath()) : () => {
    };
    const onRejection = (reason) => {
      if (debug) log18(`unhandled-rejection: ${formatUpstreamError(reason)}`);
    };
    process.on("unhandledRejection", onRejection);
    const server = createServer3(async (req, res) => {
      const url = req.url ?? "/";
      if (debug) {
        log18(`-> ${req.method} ${url} content-type=${req.headers["content-type"] ?? "(none)"} content-encoding=${req.headers["content-encoding"] ?? "(none)"} content-length=${req.headers["content-length"] ?? "(none)"}`);
      }
      if (!requireAuth && req.method === "POST") {
        const origin = req.headers.origin;
        const referer = req.headers.referer;
        const isValidLoopback = (uStr) => {
          if (!uStr) return true;
          try {
            const parsed = new URL(Array.isArray(uStr) ? uStr[0] : uStr);
            const h = parsed.hostname;
            return h === "127.0.0.1" || h === "localhost" || h === "::1";
          } catch {
            return false;
          }
        };
        if (!isValidLoopback(origin) || !isValidLoopback(referer)) {
          sendJson(res, 403, { error: { message: "Forbidden origin", type: "invalid_request_error" } });
          return;
        }
      }
      if (req.method === "GET" && url === "/health") {
        sendJson(res, 200, { ok: true });
        return;
      }
      if (req.method === "GET" && url === "/v1/models") {
        const data = [];
        const seenIds = /* @__PURE__ */ new Set();
        const addModel = (id, providerId) => {
          if (seenIds.has(id)) return;
          seenIds.add(id);
          data.push({
            id,
            object: "model",
            created: Math.floor(Date.now() / 1e3),
            owned_by: providerId || "relay-ai"
          });
        };
        for (const route of routes) {
          addModel(route.modelId, route.providerId);
          addModel(codexAppModelSlug(route.modelId), route.providerId);
          if (route.providerId) {
            addModel(`${route.providerId}__${route.modelId}`, route.providerId);
          }
        }
        sendJson(res, 200, {
          object: "list",
          data
        });
        return;
      }
      if (req.method === "GET" && url.startsWith("/v1/models/")) {
        const id = url.slice("/v1/models/".length);
        const route = findCodexProxyRoute(routes, id);
        if (!route) {
          sendJson(res, 404, { error: { message: `Model not found: ${id}`, type: "invalid_request_error" } });
          return;
        }
        sendJson(res, 200, {
          id,
          object: "model",
          created: Math.floor(Date.now() / 1e3),
          owned_by: route.providerId || "relay-ai"
        });
        return;
      }
      if (req.method === "POST" && url === "/v1/responses") {
        if (requireAuth) {
          const inboundKey = extractApiKey(req);
          if (!inboundKey || inboundKey !== PROXY_PLACEHOLDER_KEY) {
            sendJson(res, 401, { error: { message: "Unauthorized", type: "invalid_api_key" } });
            return;
          }
        }
        let rawBody;
        try {
          rawBody = await readBody(req);
        } catch (err) {
          if (debug) {
            log18(`Error: failed to read/decode request body on POST ${url}: ${formatUpstreamError(err)} content-encoding=${req.headers["content-encoding"] ?? "(none)"}`);
          }
          sendJson(res, 400, { error: { message: "Invalid request body", type: "invalid_request_error" } });
          return;
        }
        let body;
        try {
          body = JSON.parse(rawBody);
        } catch (err) {
          if (debug) {
            const headers = JSON.stringify(req.headers);
            log18(`Error: Invalid JSON body on POST ${url}: ${formatUpstreamError(err)} headers=${headers} rawBody=${JSON.stringify(rawBody.slice(0, 2e3))}`);
          }
          sendJson(res, 400, { error: { message: "Invalid JSON body", type: "invalid_request_error" } });
          return;
        }
        if (debug) {
          const prevId = body.previous_response_id ?? null;
          const inputItems = Array.isArray(body.input) ? body.input.length : typeof body.input === "string" ? 1 : 0;
          log18(`request: model=${String(body.model ?? "")} previous_response_id=${prevId ?? "(none)"} input_items=${inputItems} body_bytes=${rawBody.length}`);
        }
        const modelId = String(body.model ?? "");
        let resolved = resolveModel(routes, models, modelId);
        if (!resolved) {
          const fallbackRoute = routes[0];
          const fallbackLm = fallbackRoute ? models.get(fallbackRoute.modelId) : void 0;
          if (fallbackRoute && fallbackLm) {
            if (debug) {
              log18(`resolveModel fallback: requested="${modelId}" \u2192 ${fallbackRoute.modelId}`);
            }
            resolved = { route: fallbackRoute, languageModel: fallbackLm };
          } else {
            if (debug) {
              log18(`resolveModel failed: requested="${modelId}" known=[${routes.map((r) => r.modelId).join(", ")}]`);
            }
            sendJson(res, 404, { error: { message: `Unknown model: ${modelId}`, type: "invalid_request_error" } });
            return;
          }
        }
        const { route, languageModel } = resolved;
        try {
          let params = translateResponsesRequest(
            body,
            route.npm,
            {
              providerId: route.providerId,
              apiBaseUrl: route.baseURL,
              supportedParameters: route.supportedParameters,
              reasoning: route.reasoning,
              interleavedReasoningField: route.interleavedReasoningField
            }
          );
          if (route.contextWindow && route.contextWindow > 0) {
            const before = params.messages.length;
            let charLimit = Math.floor(route.contextWindow * 0.85) * 3;
            let estimatedChars = estimateMessageChars(params);
            if (debug) log18(`context check: model=${route.modelId} window=${route.contextWindow} chars=${estimatedChars} limit=${charLimit} messages=${before}`);
            if (isCompactionSizedRequest(body, params, route.contextWindow)) {
              params = clipLargeTextParts(params, 12e3);
              charLimit = route.contextWindow;
              estimatedChars = estimateMessageChars(params);
              if (debug) log18(`context clip: model=${route.modelId} chars=${estimatedChars} limit=${charLimit} messages=${params.messages.length}`);
            }
            params = trimToContextLimit(params, route.contextWindow, charLimit);
            if (debug && params.messages.length < before) {
              log18(`context trim: model=${route.modelId} window=${route.contextWindow} kept=${params.messages.length}/${before} messages`);
            }
          }
          if (debug) {
            const effort = body.reasoning?.effort;
            log18(`model=${route.modelId} effort=${effort ?? "(none)"} providerOptions=${JSON.stringify(params.providerOptions)}`);
          }
          if (body.stream) {
            res.writeHead(200, {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive"
            });
            const write = (chunk) => res.write(chunk);
            try {
              await streamResponsesResponse(languageModel, params, modelId, write);
            } catch (err) {
              const msg = formatUpstreamError(err);
              const status = upstreamHttpStatus(err, msg);
              if (debug) log18(`sdk error: ${route.modelId}: ${msg}`);
              if (status === 429) {
                writeResponsesRateLimitStream(modelId, msg, write);
              } else {
                writeResponsesErrorStream(modelId, msg, write, status);
              }
            }
            res.end();
          } else {
            try {
              const response = await generateResponsesResponse(languageModel, params, modelId);
              sendJson(res, 200, response);
            } catch (err) {
              const msg = formatUpstreamError(err);
              const status = upstreamHttpStatus(err, msg);
              if (debug) log18(`sdk error: ${route.modelId}: ${msg}`);
              if (status === 429) {
                sendJson(res, 200, responsesRateLimitBody(modelId, msg));
              } else {
                sendJson(res, status, { error: { message: msg, type: "api_error" } });
              }
            }
          }
        } catch (err) {
          const msg = formatUpstreamError(err);
          log18(`handler error: ${msg}`);
          sendJson(res, 500, { error: { message: msg, type: "api_error" } });
        }
        return;
      }
      if (req.method === "GET" && url === "/v1/responses") {
        sendJson(res, 200, { object: "list", data: [] });
        return;
      }
      sendJson(res, 404, { error: { message: "Not found", type: "invalid_request_error" } });
    });
    function wsAcceptKey(clientKey) {
      return createHash2("sha1").update(clientKey + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    }
    function wsDecodeFrame(buf) {
      if (buf.length < 2) return null;
      const b0 = buf[0];
      const b1 = buf[1];
      const masked = (b1 & 128) !== 0;
      let payloadLen = b1 & 127;
      let offset = 2;
      if (payloadLen === 126) {
        if (buf.length < 4) return null;
        payloadLen = buf.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (buf.length < 10) return null;
        payloadLen = Number(buf.readBigUInt64BE(2));
        offset = 10;
      }
      const maskLen = masked ? 4 : 0;
      if (buf.length < offset + maskLen + payloadLen) return null;
      const mask = masked ? buf.slice(offset, offset + 4) : null;
      offset += maskLen;
      const payload = Buffer.allocUnsafe(payloadLen);
      for (let i = 0; i < payloadLen; i++) {
        payload[i] = buf[offset + i] ^ (mask ? mask[i % 4] : 0);
      }
      const opcode = b0 & 15;
      if (opcode !== 1) return null;
      return { text: payload.toString("utf8"), complete: true };
    }
    function wsEncodeTextFrame(text5) {
      const payload = Buffer.from(text5, "utf8");
      const len = payload.length;
      let header;
      if (len < 126) {
        header = Buffer.from([129, len]);
      } else if (len < 65536) {
        header = Buffer.allocUnsafe(4);
        header[0] = 129;
        header[1] = 126;
        header.writeUInt16BE(len, 2);
      } else {
        header = Buffer.allocUnsafe(10);
        header[0] = 129;
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(len), 2);
      }
      return Buffer.concat([header, payload]);
    }
    function wsCloseFrame() {
      return Buffer.from([136, 0]);
    }
    server.on("upgrade", async (req, socket, head) => {
      const upgradeUrl = req.url ?? "/";
      if (upgradeUrl !== "/v1/responses") {
        socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
        socket.destroy();
        return;
      }
      if (requireAuth) {
        const auth = req.headers["authorization"] ?? "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : auth;
        if (!token || token !== PROXY_PLACEHOLDER_KEY) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }
      }
      const clientKey = req.headers["sec-websocket-key"];
      if (!clientKey || typeof clientKey !== "string") {
        socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
        socket.destroy();
        return;
      }
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r
Upgrade: websocket\r
Connection: Upgrade\r
Sec-WebSocket-Accept: ${wsAcceptKey(clientKey)}\r
\r
`
      );
      if (debug) log18(`ws upgrade: /v1/responses`);
      let buf = head.length > 0 ? head : Buffer.alloc(0);
      let frameText = null;
      await new Promise((resolveWs) => {
        const onData = (chunk) => {
          buf = Buffer.concat([buf, chunk]);
          const decoded = wsDecodeFrame(buf);
          if (!decoded) return;
          frameText = decoded.text;
          socket.off("data", onData);
          resolveWs();
        };
        socket.on("data", onData);
        socket.once("error", () => resolveWs());
        socket.once("close", () => resolveWs());
      });
      if (!frameText || socket.destroyed) return;
      let body;
      try {
        body = JSON.parse(frameText);
      } catch {
        socket.write(wsCloseFrame());
        socket.destroy();
        return;
      }
      if (debug) {
        const prevId = body["previous_response_id"] ?? null;
        const inputItems = Array.isArray(body["input"]) ? body["input"].length : typeof body["input"] === "string" ? 1 : 0;
        log18(`ws request: model=${String(body["model"] ?? "")} previous_response_id=${prevId ?? "(none)"} input_items=${inputItems}`);
      }
      const modelId = String(body["model"] ?? "");
      let resolved = resolveModel(routes, models, modelId);
      if (!resolved) {
        const fallbackRoute = routes[0];
        const fallbackLm = fallbackRoute ? models.get(fallbackRoute.modelId) : void 0;
        if (fallbackRoute && fallbackLm) {
          if (debug) log18(`ws resolveModel fallback: requested="${modelId}" \u2192 ${fallbackRoute.modelId}`);
          resolved = { route: fallbackRoute, languageModel: fallbackLm };
        } else {
          socket.write(wsCloseFrame());
          socket.destroy();
          return;
        }
      }
      const { route, languageModel } = resolved;
      try {
        let params = translateResponsesRequest(
          body,
          route.npm,
          {
            providerId: route.providerId,
            apiBaseUrl: route.baseURL,
            supportedParameters: route.supportedParameters,
            reasoning: route.reasoning,
            interleavedReasoningField: route.interleavedReasoningField
          }
        );
        if (route.contextWindow && route.contextWindow > 0) {
          const before = params.messages.length;
          let charLimit = Math.floor(route.contextWindow * 0.85) * 3;
          let estimatedChars = estimateMessageChars(params);
          if (debug) log18(`ws context check: model=${route.modelId} window=${route.contextWindow} chars=${estimatedChars} limit=${charLimit} messages=${before}`);
          if (isCompactionSizedRequest(body, params, route.contextWindow)) {
            params = clipLargeTextParts(params, 12e3);
            charLimit = route.contextWindow;
            estimatedChars = estimateMessageChars(params);
            if (debug) log18(`ws context clip: model=${route.modelId} chars=${estimatedChars} limit=${charLimit} messages=${params.messages.length}`);
          }
          params = trimToContextLimit(params, route.contextWindow, charLimit);
          if (debug && params.messages.length < before) {
            log18(`ws context trim: model=${route.modelId} window=${route.contextWindow} kept=${params.messages.length}/${before} messages`);
          }
        }
        if (debug) {
          const effort = body["reasoning"]?.effort;
          log18(`ws model=${route.modelId} effort=${effort ?? "(none)"} providerOptions=${JSON.stringify(params.providerOptions)}`);
        }
        const write = (chunk) => {
          if (!socket.destroyed) socket.write(wsEncodeTextFrame(chunk));
        };
        try {
          await streamResponsesResponse(languageModel, params, modelId, write);
        } catch (err) {
          const msg = formatUpstreamError(err);
          const status = upstreamHttpStatus(err, msg);
          if (debug) log18(`ws sdk error: ${route.modelId}: ${msg}`);
          if (status === 429) {
            writeResponsesRateLimitStream(modelId, msg, write);
          } else {
            writeResponsesErrorStream(modelId, msg, write, status);
          }
        }
      } catch (err) {
        if (debug) log18(`ws handler error: ${formatUpstreamError(err)}`);
      }
      if (!socket.destroyed) {
        socket.write(wsCloseFrame());
        socket.end();
      }
    });
    server.on("error", reject2);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject2(new Error("Failed to bind codex proxy"));
        return;
      }
      resolve({
        port: addr.port,
        close: () => {
          process.off("unhandledRejection", onRejection);
          server.close();
        }
      });
    });
  });
}

// src/codex/profile.ts
import { join as join3 } from "path";

// src/codex/routing.ts
function isRoutableModel(model, providerId, agent = "codex") {
  if (shouldHideModel({ providerId, modelId: model.id, agent })) return false;
  if (model.modelFormat === "anthropic") return true;
  if (model.modelFormat === "openai") {
    if (providerId === "zen" || providerId === "go") return true;
    if (model.npm) return true;
  }
  return false;
}
function codexCompatibleProviders(providers, agent = "codex") {
  return providers.filter(
    (lp) => lp.models.some((m) => isRoutableModel(m, lp.id, agent))
  );
}
function resolveBaseURL(model, provider) {
  if (provider.id === "zen" || provider.id === "go") {
    const isAnthropic = model.modelFormat === "anthropic";
    const baseUrl = BACKENDS[provider.id].baseUrl;
    return isAnthropic ? baseUrl : `${baseUrl}/v1`;
  }
  return model.apiBaseUrl ?? model.completionsUrl?.replace(/\/chat\/completions$/, "") ?? model.baseUrl;
}
function resolveCodexRoute(provider, model, apiKey) {
  const upstreamModelId2 = model.upstreamModelId || model.id;
  const inferredNpm = model.modelFormat === "anthropic" ? "@ai-sdk/anthropic" : "@ai-sdk/openai-compatible";
  const isZenGo = provider.id === "zen" || provider.id === "go";
  const base = {
    npm: isZenGo ? inferredNpm : model.npm ?? inferredNpm,
    baseURL: resolveBaseURL(model, provider),
    upstreamModelId: upstreamModelId2,
    apiKey,
    contextWindow: model.contextWindow,
    modelId: model.id,
    providerId: provider.id,
    authType: provider.authType,
    oauthAccountId: provider.oauthAccountId,
    supportedParameters: model.supportedParameters,
    reasoning: model.reasoning,
    interleavedReasoningField: model.interleavedReasoningField
  };
  if (model.npm === "@ai-sdk/openai" && provider.authType !== "oauth" && model.modelFormat === "openai") {
    return { tier: "direct", ...base };
  }
  return { tier: "proxy", ...base };
}
function routableModelsForProvider(provider, agent = "codex") {
  return provider.models.filter((m) => isRoutableModel(m, provider.id, agent));
}
function buildCodexProxyRoutesForProvider(provider, apiKey, selectedModelId, agent = "codex") {
  const routable = routableModelsForProvider(provider, agent);
  const ordered = selectedModelId ? [
    ...routable.filter((m) => m.id === selectedModelId),
    ...routable.filter((m) => m.id !== selectedModelId)
  ] : routable;
  return ordered.map((model) => {
    const route = resolveCodexRoute(provider, model, apiKey);
    return {
      modelId: route.modelId,
      npm: route.npm,
      apiKey: route.apiKey,
      baseURL: route.baseURL,
      upstreamModelId: route.upstreamModelId,
      providerId: route.providerId,
      authType: route.authType,
      oauthAccountId: route.oauthAccountId,
      supportedParameters: route.supportedParameters,
      reasoning: route.reasoning,
      interleavedReasoningField: route.interleavedReasoningField,
      contextWindow: route.contextWindow
    };
  });
}
function codexProviderEnvKey(providerId) {
  const known = {
    openai: "OPENAI_API_KEY",
    xai: "XAI_API_KEY",
    "xai-oauth": "XAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    google: "GEMINI_API_KEY"
  };
  return known[providerId] ?? `${providerId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
}

// src/codex/session.ts
import {
  copyFileSync,
  existsSync as existsSync3,
  mkdirSync,
  readdirSync,
  readFileSync as readFileSync3,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "fs";
import { homedir as homedir3 } from "os";
import { basename, dirname, join as join2 } from "path";
var CODEX_PROFILE_NAME = "relay-ai-launch";
var STALE_SESSION_MS = 5 * 60 * 1e3;
var MAX_BACKUPS = 5;
function getCodexHome() {
  return join2(homedir3(), ".codex");
}
function getCodexProfilePath() {
  return join2(getCodexHome(), `${CODEX_PROFILE_NAME}.config.toml`);
}
function getRelayAiCodexDir(env = process.env) {
  return join2(getAppHome(env), "codex");
}
function getSessionLockPath(env = process.env) {
  return join2(getRelayAiCodexDir(env), "session.json");
}
function getBackupsDir(env = process.env) {
  return join2(getRelayAiCodexDir(env), "backups");
}
function getCatalogPath(providerId, env = process.env) {
  return join2(getRelayAiCodexDir(env), `models-${providerId}.json`);
}
function ownedOverlayPaths(env = process.env) {
  const paths = [getCodexProfilePath(), getSessionLockPath(env)];
  const codexDir = getRelayAiCodexDir(env);
  if (existsSync3(codexDir)) {
    for (const name of readdirSync(codexDir)) {
      if (name.startsWith("models-") && name.endsWith(".json")) {
        paths.push(join2(codexDir, name));
      }
    }
  }
  return paths;
}
function atomicWriteFile(path2, content) {
  mkdirSync(dirname(path2), { recursive: true });
  const tmp = `${path2}.tmp.${process.pid}`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, path2);
}
function rotateBackups(filePath, env = process.env) {
  if (!existsSync3(filePath)) return;
  const backupsDir = getBackupsDir(env);
  mkdirSync(backupsDir, { recursive: true });
  const base = basename(filePath);
  const stamp = Date.now();
  const backupPath = join2(backupsDir, `${base}.${stamp}.bak`);
  copyFileSync(filePath, backupPath);
  const backups = readdirSync(backupsDir).filter((n) => n.startsWith(`${base}.`) && n.endsWith(".bak")).map((n) => ({ name: n, mtime: statSync(join2(backupsDir, n)).mtimeMs })).sort((a, b) => b.mtime - a.mtime);
  for (const old of backups.slice(MAX_BACKUPS)) {
    try {
      unlinkSync(join2(backupsDir, old.name));
    } catch {
    }
  }
}
function writeOverlayFile(path2, content, env = process.env) {
  rotateBackups(path2, env);
  atomicWriteFile(path2, content);
}
function readSessionLock(env = process.env) {
  const path2 = getSessionLockPath(env);
  if (!existsSync3(path2)) return null;
  try {
    const parsed = JSON.parse(readFileSync3(path2, "utf8"));
    if (typeof parsed.pid === "number" && typeof parsed.startedAt === "string") return parsed;
  } catch {
  }
  return null;
}
function writeSessionLock(lock, env = process.env) {
  const path2 = getSessionLockPath(env);
  mkdirSync(getRelayAiCodexDir(env), { recursive: true });
  atomicWriteFile(path2, `${JSON.stringify(lock, null, 2)}
`);
}
function isProcessAlive(pid) {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function isConcurrentSession(lock) {
  return isProcessAlive(lock.pid);
}
function restoreCodexOverlay(env = process.env) {
  const removed = [];
  for (const path2 of ownedOverlayPaths(env)) {
    if (!existsSync3(path2)) continue;
    try {
      rmSync(path2, { force: true });
      removed.push(path2);
    } catch {
    }
  }
  return removed;
}
function remainingOverlayPaths(env = process.env) {
  return ownedOverlayPaths(env).filter((p20) => existsSync3(p20));
}
function recoverInterruptedCodexSession(env = process.env) {
  const before = remainingOverlayPaths(env);
  if (before.length === 0) return { recovered: false };
  const lock = readSessionLock(env);
  if (lock && isConcurrentSession(lock)) {
    return { recovered: false };
  }
  restoreCodexOverlay(env);
  return {
    recovered: true,
    removedCount: before.length,
    reason: lock ? "dead-session" : "orphan-files"
  };
}
function checkSessionLock(isTty, env = process.env) {
  if (!isTty) return { ok: false, reason: "non_tty" };
  const lock = readSessionLock(env);
  if (lock && isConcurrentSession(lock)) {
    return { ok: false, reason: "concurrent", lock };
  }
  return { ok: true };
}

// src/codex/profile.ts
var CODEX_LAUNCH_SANDBOX = "danger-full-access";
function profileReasoningLine(effort) {
  return effort ? `model_reasoning_effort = ${tomlString(effort)}
` : "";
}
function profileSandboxLine() {
  return `sandbox = ${tomlString(CODEX_LAUNCH_SANDBOX)}
`;
}
function tomlString(value) {
  return JSON.stringify(value);
}
function buildCodexProfileToml(spec) {
  const { route, proxyPort, catalogPath, modelReasoningEffort } = spec;
  const model = route.modelId;
  const reasoning = profileReasoningLine(modelReasoningEffort);
  if (route.tier === "direct") {
    const envKey = codexProviderEnvKey(route.providerId);
    const baseUrl = route.baseURL ?? "https://api.openai.com/v1";
    return `# Generated by relay-ai \u2014 do not edit
${profileSandboxLine()}model = ${tomlString(model)}
model_provider = ${tomlString(route.providerId)}
model_catalog_json = ${tomlString(catalogPath)}
${reasoning}
[model_providers.${route.providerId}]
name = ${tomlString(route.providerId)}
base_url = ${tomlString(baseUrl)}
env_key = ${tomlString(envKey)}
wire_api = "responses"
`;
  }
  const proxyBase = `http://127.0.0.1:${proxyPort}/v1`;
  return `# Generated by relay-ai \u2014 do not edit
${profileSandboxLine()}model = ${tomlString(model)}
model_provider = "relay-ai-proxy"
model_catalog_json = ${tomlString(catalogPath)}
${reasoning}
[model_providers.relay-ai-proxy]
name = "relay-ai"
base_url = ${tomlString(proxyBase)}
env_key = "RELAY_AI_CODEX_KEY"
wire_api = "responses"
`;
}
function getProfileOutputPath() {
  return getCodexProfilePath();
}
function getCatalogOutputPath(providerId) {
  return getCatalogPath(providerId);
}
function getFavoritesCatalogPath() {
  return join3(getRelayAiCodexDir(), "models-favorites.json");
}
function getFavoritesAppCatalogPath() {
  return join3(getRelayAiCodexDir(), "app-models-favorites.json");
}
function profileName() {
  return CODEX_PROFILE_NAME;
}

// src/codex/launch.ts
import { execSync, spawn } from "child_process";
import { existsSync as existsSync4 } from "fs";
import { homedir as homedir4 } from "os";
import { join as join4 } from "path";
var isWindows = process.platform === "win32";
var CODEX_CI_ENV_VARS = [
  "CI",
  "CODEX_CI",
  "CONTINUOUS_INTEGRATION",
  "GITHUB_ACTIONS",
  "GITLAB_CI",
  "CIRCLECI",
  "JENKINS_URL",
  "TF_BUILD",
  "BUILD_BUILDID"
];
function stripCodexInheritedEnv(env) {
  const out = { ...env };
  for (const name of CODEX_CI_ENV_VARS) {
    delete out[name];
  }
  return out;
}
var CODEX_FALLBACK_PATHS = isWindows ? [
  join4(process.env["APPDATA"] ?? homedir4(), "npm", "codex.cmd"),
  join4(process.env["APPDATA"] ?? homedir4(), "npm", "codex")
] : [
  join4(homedir4(), ".local", "bin", "codex"),
  join4(homedir4(), ".npm", "bin", "codex"),
  "/usr/local/bin/codex",
  "/opt/homebrew/bin/codex"
];
function findCodexBinary() {
  try {
    const result = execSync(isWindows ? "where.exe codex" : "which codex", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"]
    });
    const path2 = result.trim().split("\n")[0]?.trim();
    if (path2) return path2;
  } catch {
  }
  for (const path2 of CODEX_FALLBACK_PATHS) {
    if (existsSync4(path2)) return path2;
  }
  return null;
}
function codexArgsIncludeSandboxFlag(args) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-s" || arg === "--sandbox" || arg === "--dangerously-bypass-approvals-and-sandbox") {
      return true;
    }
    if (arg.startsWith("--sandbox=")) return true;
  }
  return false;
}
function ensureCodexSandboxArgs(extraArgs) {
  if (codexArgsIncludeSandboxFlag(extraArgs)) return extraArgs;
  return ["-s", CODEX_LAUNCH_SANDBOX, ...extraArgs];
}
function buildCodexChildEnv(route, proxyPort) {
  const env = stripCodexInheritedEnv(process.env);
  if (route.tier === "proxy" && proxyPort) {
    env["RELAY_AI_CODEX_KEY"] = PROXY_PLACEHOLDER_KEY;
  } else {
    const envKey = codexProviderEnvKey(route.providerId);
    env[envKey] = route.apiKey;
  }
  return env;
}
function launchCodex(modelId, env, extraArgs) {
  return new Promise((resolve) => {
    const codexPath = findCodexBinary();
    const args = ["--profile", profileName(), "-m", modelId, ...ensureCodexSandboxArgs(extraArgs)];
    const child = spawn(codexPath, args, {
      stdio: "inherit",
      env,
      shell: isWindows
    });
    const forward = (signal) => {
      child.kill(signal);
    };
    process.once("SIGINT", () => forward("SIGINT"));
    process.once("SIGTERM", () => forward("SIGTERM"));
    child.on("exit", (code) => resolve(code ?? 0));
  });
}

// src/codex/prompts.ts
import pc8 from "picocolors";
import * as p9 from "@clack/prompts";
async function pickCodexProvider(providers, prefs, hasFavorites = false, initialProviderId) {
  if (providers.length === 0 && !hasFavorites) return null;
  const options = providers.map((lp) => providerSelectOption(lp));
  if (hasFavorites) {
    options.unshift({
      value: "__favorites__",
      label: "\u2B50 Favorites Catalog",
      hint: `${prefs.favoriteModels?.length ?? 0} saved favorites`
    });
  }
  const initial = initialProviderId && options.some((o) => o.value === initialProviderId) ? initialProviderId : prefs.lastCodexProvider && options.some((o) => o.value === prefs.lastCodexProvider) ? prefs.lastCodexProvider : options[0].value;
  const chosen = await p9.select({
    message: "Which provider for Codex?",
    options,
    initialValue: initial
  });
  if (p9.isCancel(chosen)) {
    p9.cancel("Cancelled.");
    return null;
  }
  if (chosen === "__favorites__") return "__favorites__";
  return providers.find((lp) => lp.id === chosen) ?? null;
}
async function pickCodexModel(provider, prefs) {
  const recentIds = (prefs.recentModelsByProvider?.[provider.id] ?? []).slice(0, 3);
  const recentModels = recentIds.map((id) => provider.models.find((m) => m.id === id)).filter((m) => m !== void 0);
  let selectedModel = null;
  while (true) {
    if (recentModels.length > 0) {
      const options = [
        ...recentModels.map((m) => modelSelectOption(m, "recent")),
        navOption("__browse_all__", "Browse all models \u2192", `${provider.models.length} available`),
        navOption("__back__", "\u2190 Go back", "Select a different provider")
      ];
      const picked = await p9.select({
        message: `Model for ${provider.name}?`,
        options,
        initialValue: recentModels[0].id
      });
      if (p9.isCancel(picked) || String(picked) === "__back__") {
        return "back";
      }
      if (String(picked) === "__browse_all__") {
        const browsed = await browseAllModels(provider, prefs);
        if (browsed === "back") {
          continue;
        }
        if (!browsed) return null;
        selectedModel = browsed;
        break;
      } else {
        selectedModel = recentModels.find((m) => m.id === String(picked));
        break;
      }
    } else {
      const browsed = await browseAllModels(provider, prefs);
      if (browsed === "back") {
        return "back";
      }
      if (!browsed) return null;
      selectedModel = browsed;
      break;
    }
  }
  return selectedModel;
}
function confirmCodexLaunch(providerName, modelLabel, modelId, route) {
  const via = route.tier === "direct" ? pc8.green("direct") : `${pc8.dim("via")} ${pc8.yellow("relay-ai proxy")}`;
  return p9.confirm({
    message: `${confirmLaunchMessage("Codex", modelLabel, modelId, providerName)} ${pc8.dim("(")}${via}${pc8.dim(")")}`,
    initialValue: true
  }).then((answer) => {
    if (p9.isCancel(answer)) {
      p9.cancel("Cancelled.");
      return false;
    }
    return answer;
  });
}
function rejectManagedFlags(codexArgs) {
  const blocked = /* @__PURE__ */ new Set(["--profile", "-m", "--model", "--provider", "--trace", "-p"]);
  const takesValue = /* @__PURE__ */ new Set(["--profile", "-m", "--model", "--provider", "-p"]);
  const out = [];
  for (let i = 0; i < codexArgs.length; i++) {
    const arg = codexArgs[i];
    if (blocked.has(arg)) {
      if (takesValue.has(arg)) i++;
      continue;
    }
    if (arg.startsWith("--profile=") || arg.startsWith("--model=") || arg.startsWith("--provider=") || arg.startsWith("-m=")) continue;
    out.push(arg);
  }
  return out;
}

// src/codex/ui.ts
import pc9 from "picocolors";
function codexAppIntro() {
  relayIntro("Codex App");
}
function codexCliIntro() {
  relayIntro("Codex");
}
function printCodexAppSessionPanel(opts) {
  printPanel(pc9.cyan("Foreground session"), [
    `${pc9.bold("Model")}     ${fmtModel(opts.modelLabel, opts.modelId)}`,
    `${pc9.bold("Provider")}  ${fmtProvider(opts.providerName)}`,
    "",
    `${pc9.yellow(pc9.bold("Keep this terminal open"))}${pc9.white(" while you use Codex.")}`,
    `${pc9.white("Press ")}${pc9.bold(pc9.red("Ctrl+C"))}${pc9.white(" to stop the proxy and restore ")}${fmtCommand("~/.codex/config.toml")}${pc9.white(".")}`,
    `${pc9.dim("Codex may show ")}${pc9.yellow('"Custom"')}${pc9.dim(" if the desktop picker cannot resolve registry models \u2014 check the terminal line above. After restart, pick your model from the picker if it appears.")}`,
    `${pc9.dim("If Codex asks you to sign in after restart: choose API key and enter any character \u2014 that unlocks the model picker for registry providers.")}`,
    `${pc9.dim("Stuck? Run ")}${fmtCommand(opts.restoreCommand)}${pc9.dim(".")}`
  ]);
}
function printCodexCliCleanupPanel(restoreCommand) {
  printPanel(pc9.cyan("While Codex runs"), [
    `${pc9.white("Temporary profile: ")}${fmtCommand("~/.codex/relay-ai-launch.config.toml")}`,
    `${pc9.white("Removed automatically when Codex exits.")}`,
    `${pc9.dim("After a crash: ")}${fmtCommand(restoreCommand)}${pc9.dim(".")}`
  ]);
}
function codexAppOutro(modelLabel) {
  relayOutro("Codex App", fmtModel(modelLabel));
}
function codexCliOutro(providerName, modelLabel, modelId) {
  relayOutro(
    "Launching Codex",
    `${fmtProvider(providerName)} ${pc9.dim("/")} ${fmtModel(modelLabel, modelId)}`
  );
}

// src/codex/favorites-catalog.ts
function codexCliFavoritesSlug(providerId, modelId) {
  return `${providerId}__${modelId}`;
}
function buildFavoritesCodexCatalog(starting, resolved) {
  const models = [];
  let priority = 0;
  if (starting) {
    models.push(buildEntry(starting, priority++));
  }
  for (const r of resolved) {
    models.push(buildEntry(r, priority++));
  }
  return { models };
}
function enrichFavoriteModel(r) {
  const model = r.model;
  return {
    ...model,
    npm: model.npm ?? (model.modelFormat === "anthropic" ? "@ai-sdk/anthropic" : "@ai-sdk/openai-compatible"),
    upstreamModelId: model.upstreamModelId || model.id
  };
}
function buildEntry(r, priority) {
  const model = enrichFavoriteModel(r);
  const slug = codexCliFavoritesSlug(r.providerId, model.id);
  return catalogEntryFromModel(model, r.providerName, priority, false, slug);
}
function defaultReasoningEffortForFavorite(r) {
  const model = enrichFavoriteModel(r);
  const caps = getReasoningCapabilities(model.npm ?? "", model.upstreamModelId ?? model.id, {
    providerId: r.providerId,
    apiBaseUrl: model.apiBaseUrl,
    supportedParameters: model.supportedParameters,
    reasoning: model.reasoning,
    interleavedReasoningField: model.interleavedReasoningField
  });
  return caps.levels.length > 0 ? caps.defaultLevel : "none";
}
function buildFavoritesAppCatalog(resolved) {
  const models = [];
  let priority = 0;
  for (const r of resolved) {
    const model = enrichFavoriteModel(r);
    const slug = codexCliFavoritesSlug(r.providerId, model.id);
    models.push(catalogEntryFromModel(model, r.providerName, priority++, true, slug));
  }
  return { models };
}

// src/codex/favorites-launch.ts
import * as p10 from "@clack/prompts";

// src/favorites-resolver.ts
var ZEN_GO_PROVIDER_NAME = {
  zen: "OpenCode Zen",
  go: "OpenCode Go"
};
function resolveFavorite(fav, ctx) {
  if (fav.providerId === "zen" || fav.providerId === "go") {
    if (!ctx.zenGoApiKey) return void 0;
    const models = fav.providerId === "zen" ? ctx.zenModels : ctx.goModels;
    const model = models?.find((m) => m.id === fav.modelId);
    if (!model) return void 0;
    return {
      providerId: fav.providerId,
      providerName: ZEN_GO_PROVIDER_NAME[fav.providerId],
      model,
      apiKey: ctx.zenGoApiKey,
      sourceBackend: fav.providerId
    };
  }
  if (ctx.findLocalModel) {
    const found = ctx.findLocalModel(fav.providerId, fav.modelId);
    if (!found) return void 0;
    if (ctx.agent && shouldHideModel({ providerId: fav.providerId, modelId: fav.modelId, agent: ctx.agent })) {
      return void 0;
    }
    return {
      providerId: fav.providerId,
      providerName: found.provider.name,
      model: found.model,
      apiKey: found.provider.apiKey,
      authType: found.provider.authType,
      oauthAccountId: found.provider.oauthAccountId
    };
  }
  return void 0;
}
function buildFavoritesList(starting, favorites, ctx, max = 20) {
  const droppedFavorites = [];
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  if (starting) {
    seen.add(`${starting.providerId}::${starting.model.id}`);
    out.push(starting);
  }
  for (const fav of favorites) {
    if (out.length >= max) break;
    const key = `${fav.providerId}::${fav.modelId}`;
    if (seen.has(key)) continue;
    const resolved = resolveFavorite(fav, ctx);
    if (!resolved) {
      droppedFavorites.push(fav);
      continue;
    }
    seen.add(key);
    out.push(resolved);
  }
  return { resolved: out, droppedFavorites };
}

// src/codex/favorites-launch.ts
function buildCodexProxyRoutesFromResolved(resolved, providersById) {
  const skippedOAuth = [];
  const routes = resolved.map((r) => {
    const provider = providersById.get(r.providerId);
    if (!provider) return void 0;
    const model = r.model;
    if (!r.apiKey && provider.authType === "oauth") {
      skippedOAuth.push(`${r.providerId}/${model.id}`);
      return void 0;
    }
    const route = resolveCodexRoute(provider, model, r.apiKey);
    return {
      modelId: codexCliFavoritesSlug(r.providerId, model.id),
      npm: route.npm,
      apiKey: route.apiKey,
      baseURL: route.baseURL,
      upstreamModelId: route.upstreamModelId,
      providerId: route.providerId,
      authType: route.authType,
      oauthAccountId: route.oauthAccountId,
      contextWindow: route.contextWindow
    };
  }).filter((r) => r !== void 0);
  if (skippedOAuth.length > 0) {
    p10.log.warn(
      `Skipped ${skippedOAuth.length} OAuth favorite(s) (OAuth auth not supported in favorites catalog): ${skippedOAuth.join(", ")}`
    );
  }
  return routes;
}
function resolveCodexFavorites(activeProvider, selectedModel, compatible, favorites, agent, zenGoApiKey) {
  const ctx = {
    agent,
    localProviders: compatible,
    zenGoApiKey,
    zenModels: compatible.find((p20) => p20.id === "zen")?.models,
    goModels: compatible.find((p20) => p20.id === "go")?.models,
    findLocalModel: (pid, mid) => {
      const provider = compatible.find((lp) => lp.id === pid);
      const model = provider?.models.find((m) => m.id === mid);
      return provider && model ? { provider, model } : void 0;
    }
  };
  const startingResolved = resolveFavorite(
    { providerId: activeProvider.id, modelId: selectedModel.id },
    ctx
  );
  const { resolved, droppedFavorites } = buildFavoritesList(
    startingResolved,
    favorites,
    ctx
  );
  if (droppedFavorites.length > 0) {
    p10.log.warn(
      `Skipped ${droppedFavorites.length} stale/unauthorized favorite(s): ${droppedFavorites.map((f) => `${f.providerId}:${f.modelId}`).join(", ")}`
    );
  }
  return {
    resolvedFavorites: resolved,
    providersById: new Map(compatible.map((lp) => [lp.id, lp]))
  };
}

// src/agent-io.ts
var agentStdoutMode = false;
function setAgentStdoutMode(enabled) {
  agentStdoutMode = enabled;
}
function isAgentStdoutMode() {
  return agentStdoutMode;
}

// src/launch-target.ts
function parseModelSlug(modelRef) {
  const idx = modelRef.indexOf("__");
  if (idx > 0) {
    return { providerId: modelRef.slice(0, idx), modelId: modelRef.slice(idx + 2) };
  }
  return { modelId: modelRef };
}
function isClaudePrintMode(args) {
  for (const arg of args) {
    if (arg === "--print" || arg === "-p") return true;
    if (arg.startsWith("--print=")) return true;
  }
  return false;
}
function readFlagValue(args, flag) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === flag) return args[i + 1];
    if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
  }
  return void 0;
}
function hasFlag(args, flag) {
  return args.some((arg) => arg === flag || arg.startsWith(`${flag}=`));
}
function isClaudeMachineReadableOutput(args) {
  if (!isClaudePrintMode(args)) return false;
  const outFmt = readFlagValue(args, "--output-format");
  if (outFmt === "stream-json" || outFmt === "json") return true;
  const inFmt = readFlagValue(args, "--input-format");
  return inFmt === "stream-json";
}
function isCodexMachineReadableOutput(args) {
  return args.includes("--json");
}
function isGeminiNonInteractive(args) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") return false;
    if (arg === "-p" || arg === "--prompt" || arg === "-i" || arg === "--prompt-interactive") return true;
    if (arg.startsWith("-")) {
      i = skipAttachedFlagValue(args, i);
      continue;
    }
    return true;
  }
  return false;
}
function wantsCleanAgentStdout(agent, childArgs) {
  if (agent === "claude") return isClaudeMachineReadableOutput(childArgs);
  if (agent === "codex") return isCodexMachineReadableOutput(childArgs);
  if (agent === "antigravity") return false;
  const outFmt = readFlagValue(childArgs, "-o") || readFlagValue(childArgs, "--output-format");
  return outFmt === "json" || outFmt === "stream-json";
}
function normalizeClaudeAgentArgs(args) {
  const out = [...args];
  const streamOut = readFlagValue(out, "--output-format") === "stream-json";
  const streamIn = readFlagValue(out, "--input-format") === "stream-json";
  if ((streamOut || streamIn) && isClaudePrintMode(out) && !hasFlag(out, "--verbose")) {
    out.push("--verbose");
  }
  return out;
}
function skipAttachedFlagValue(args, index) {
  const arg = args[index];
  if (!arg.startsWith("-") || arg === "--" || arg.includes("=")) return index;
  const next = args[index + 1];
  if (next && !next.startsWith("-")) return index + 1;
  return index;
}
function isCodexNonInteractive(args) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") return false;
    if (arg.startsWith("-")) {
      i = skipAttachedFlagValue(args, i);
      continue;
    }
    return true;
  }
  return false;
}
function resolveLaunchTarget(explicit, prefs, agent) {
  const slug = explicit.modelId ? parseModelSlug(explicit.modelId) : null;
  const providerId = explicit.providerId ?? slug?.providerId ?? (agent === "claude" ? prefs.lastProvider : agent === "codex" ? prefs.lastCodexProvider : agent === "antigravity" ? prefs.lastAntigravityProvider : prefs.lastGeminiProvider);
  const modelId = slug?.modelId ?? explicit.modelId ?? (agent === "claude" ? prefs.lastModel : agent === "codex" ? prefs.lastCodexModel : agent === "antigravity" ? prefs.lastAntigravityModel : prefs.lastGeminiModel);
  if (!providerId || !modelId) return null;
  return { providerId, modelId };
}
function findProviderAndModel(providers, target) {
  if (!target.providerId || !target.modelId) return null;
  const provider = providers.find((p20) => p20.id === target.providerId);
  if (!provider) return null;
  const model = provider.models.find((m) => m.id === target.modelId);
  if (!model) return null;
  return { provider, model };
}
function hasCompleteExplicitLaunch(explicit) {
  if (explicit.providerId && explicit.modelId) return true;
  if (explicit.modelId) {
    const slug = parseModelSlug(explicit.modelId);
    return !!slug.providerId;
  }
  return false;
}
function planLaunchWizard(opts) {
  const { explicit, childArgs, agent, prefs } = opts;
  const explicitComplete = hasCompleteExplicitLaunch(explicit);
  const nonInteractive = agent === "claude" ? isClaudePrintMode(childArgs) : agent === "codex" ? isCodexNonInteractive(childArgs) : agent === "antigravity" ? isAntigravityNonInteractive(childArgs) : isGeminiNonInteractive(childArgs);
  if (explicitComplete) {
    const target = resolveLaunchTarget(explicit, prefs, agent);
    if (!target) {
      return {
        skip: false,
        target: null,
        error: "Both --provider and --model are required (or use provider__model slug with --model)."
      };
    }
    return { skip: true, target };
  }
  if (explicit.providerId || explicit.modelId) {
    return {
      skip: false,
      target: null,
      error: "Both --provider and --model are required (or use provider__model slug with --model)."
    };
  }
  if (nonInteractive) {
    const target = resolveLaunchTarget(explicit, prefs, agent);
    if (!target) {
      return {
        skip: false,
        target: null,
        error: nonInteractiveLaunchError(agent)
      };
    }
    return { skip: true, target };
  }
  return { skip: false, target: null };
}
function nonInteractiveLaunchError(agent) {
  if (agent === "claude") return "Print mode requires --provider and --model, or saved preferences from a prior launch.";
  if (agent === "codex") return "Non-interactive Codex launch requires --provider and --model, or saved preferences from a prior launch.";
  if (agent === "antigravity") return "Non-interactive Antigravity launch requires --provider and --model, or saved preferences from a prior launch.";
  return "Non-interactive Gemini launch requires --provider and --model, or saved preferences from a prior launch.";
}
function isAntigravityNonInteractive(args) {
  for (const arg of args) {
    if (arg === "--") return false;
    if (arg === "-p" || arg === "--prompt" || arg === "--print") return true;
  }
  return false;
}

// src/codex.ts
function codexHelpText() {
  return `${pc10.bold("relay-ai codex")} \u2014 launch OpenAI Codex CLI with your registry providers

${pc10.bold("Usage:")}
  relay-ai codex [options] [codex-flags]
  relay-ai codex --vertex
  relay-ai codex --restore
  relay-ai codex --config
  relay-ai codex --help
  relay-ai codex --version

${pc10.bold("Options:")}
  --trace      Write proxy debug logs to ~/.relay-ai/logs/ and show errors on exit
  --provider   Boot provider id (skip wizard when paired with --model or non-interactive)
  --model      Boot model id (skip wizard when paired with --provider or non-interactive)
  --vertex     Use Claude models through Google Vertex AI
  --restore    Remove interrupted-session overlay files
  --config     Preview/write launch configuration without starting Codex
  --help       Show this command help
  --version    Show version

${pc10.bold("Description:")}
  Picks a provider and model from ~/.relay-ai/providers.json, writes a temporary
  relay-ai-launch profile (never touches ~/.codex/config.toml), and launches Codex.
  Overlay files are removed automatically when Codex exits; use --restore after a crash.
  Anthropic and other registry models route through a local Responses API proxy.

${pc10.bold("Prerequisites:")}
  npm install -g @openai/codex

${pc10.bold("Cleanup:")}
  Temporary files: ~/.codex/relay-ai-launch.config.toml and ~/.relay-ai/codex/*
  Auto-removed on normal exit. After crash or force-quit: relay-ai codex --restore

${pc10.bold("Passing flags to Codex:")}
  Add Codex flags directly \u2014 no "--" separator needed.
  relay-ai launches with sandbox disabled (danger-full-access) by default so shell
  tools can reach the network. Override with your own -s flag if you want a tighter sandbox.
  relay-ai manages --profile, -m, -p (profile), --provider, and --model; other flags go to Codex.
  See docs/CODEX.md for sandbox, network, and troubleshooting.

${pc10.bold("OAuth:")}
  For ChatGPT Plus/Pro, run relay-ai providers auth openai first.

${pc10.bold("Examples:")}
  relay-ai codex
  relay-ai codex --trace
  relay-ai codex --provider zen --model deepseek-v4-flash-free
  relay-ai codex --provider zen --model deepseek-v4-flash-free exec "fix the bug"
  relay-ai codex -s workspace-write
  relay-ai codex --restore
  relay-ai codex --help
${pc10.bold("Favorites:")}
  When you have saved favorites via ${pc10.cyan("relay-ai models")}, the Codex
  picker will show your starting model + favorites for mid-session switching.
  Zen/Go favorites are included when an OpenCode API key is available.`;
}
async function writeLaunchArtifacts(route, selectedModel, providerName, proxyPort) {
  const catalogPath = getCatalogOutputPath(route.providerId);
  const catalog = buildCatalogFile([selectedModel], providerName);
  writeOverlayFile(catalogPath, serializeCatalog(catalog));
  const profilePath = getProfileOutputPath();
  const caps = getReasoningCapabilities(route.npm, route.upstreamModelId, {
    providerId: route.providerId,
    apiBaseUrl: route.baseURL,
    supportedParameters: route.supportedParameters,
    reasoning: route.reasoning,
    interleavedReasoningField: route.interleavedReasoningField
  });
  writeOverlayFile(profilePath, buildCodexProfileToml({
    route,
    proxyPort,
    catalogPath,
    modelReasoningEffort: caps.defaultLevel || void 0
  }));
  return { profilePath, catalogPath };
}
async function writeFavoritesLaunchArtifacts(resolved, starting, proxyPort) {
  const catalogPath = getFavoritesCatalogPath();
  const catalog = buildFavoritesCodexCatalog(void 0, resolved);
  writeOverlayFile(catalogPath, serializeCatalog(catalog));
  const profilePath = getProfileOutputPath();
  const model = starting.model;
  const dummyRoute = {
    tier: "proxy",
    modelId: codexCliFavoritesSlug(starting.providerId, model.id),
    providerId: "relay-ai-proxy",
    npm: model.npm ?? "@ai-sdk/openai-compatible",
    upstreamModelId: model.upstreamModelId || model.id,
    apiKey: ""
  };
  writeOverlayFile(profilePath, buildCodexProfileToml({
    route: dummyRoute,
    proxyPort,
    catalogPath,
    modelReasoningEffort: defaultReasoningEffortForFavorite(starting)
  }));
  return { profilePath, catalogPath };
}
function printCodexCleanupReminder(hadProxy) {
  if (isAgentStdoutMode()) return;
  const left = remainingOverlayPaths();
  if (left.length > 0) {
    p11.log.warn("Temporary Codex overlay files may still be on disk.");
    p11.log.info("Run: relay-ai codex --restore");
    return;
  }
  const parts = ["Temporary Codex profile removed."];
  if (hadProxy) parts.push("Local Responses proxy stopped.");
  parts.push("If a future session acts stuck: relay-ai codex --restore");
  p11.log.info(parts.join(" "));
}
function vertexEntryToLocalModel(entry) {
  return {
    id: entry.id,
    name: entry.display_name,
    family: "claude",
    brand: "Anthropic",
    modelFormat: "openai",
    upstreamModelId: entry.upstream_id ?? entry.id,
    baseUrl: "",
    npm: VERTEX_ANTHROPIC_NPM,
    contextWindow: resolveContextWindow(entry.id)
  };
}
async function runCodexVertexLaunch(passthroughArgs, trace) {
  if (!hasApplicationDefaultCredentials()) {
    p11.log.error("Google Application Default Credentials not found.");
    p11.log.info("Run: gcloud auth application-default login");
    return 1;
  }
  const config = buildVertexRuntimeConfig();
  if (!config) {
    p11.log.error("ANTHROPIC_VERTEX_PROJECT_ID (or GOOGLE_CLOUD_PROJECT) is not set.");
    p11.log.info("Set your project: export ANTHROPIC_VERTEX_PROJECT_ID=your-project-id");
    return 1;
  }
  let selectedEntry;
  if (config.models.length === 1) {
    selectedEntry = config.models[0];
  } else {
    const choice = await p11.select({
      message: "Select a Vertex AI model:",
      options: config.models.map((m) => ({ value: m, label: m.display_name, hint: m.id }))
    });
    if (p11.isCancel(choice)) {
      p11.cancel("Cancelled.");
      return 0;
    }
    selectedEntry = choice;
  }
  process.env["ANTHROPIC_VERTEX_PROJECT_ID"] = config.project;
  process.env["GOOGLE_CLOUD_LOCATION"] = config.location;
  const vertexConfig = { project: config.project, location: config.location };
  const allModels = config.models.map(vertexEntryToLocalModel);
  const allRoutes = allModels.map((m) => ({
    modelId: m.id,
    upstreamModelId: m.upstreamModelId,
    npm: VERTEX_ANTHROPIC_NPM,
    apiKey: "",
    providerId: "vertex",
    vertex: vertexConfig
  }));
  const startingRoute = {
    tier: "proxy",
    modelId: selectedEntry.id,
    upstreamModelId: selectedEntry.upstream_id ?? selectedEntry.id,
    npm: VERTEX_ANTHROPIC_NPM,
    apiKey: "",
    providerId: "vertex"
  };
  const debugLogPath = getCodexProxyDebugLogPath();
  let proxyHandle = null;
  try {
    p11.log.info(`Vertex AI \xB7 ${selectedEntry.display_name} \u2014 project: ${config.project} / location: ${config.location}`);
    proxyHandle = await startCodexProxy(allRoutes, { debug: trace });
    const proxyPort = proxyHandle.port;
    const catalogPath = getCatalogOutputPath("vertex");
    writeOverlayFile(catalogPath, serializeCatalog(buildCatalogFile(allModels, "Vertex AI")));
    const profilePath = getProfileOutputPath();
    const caps = getReasoningCapabilities(VERTEX_ANTHROPIC_NPM, selectedEntry.id);
    writeOverlayFile(profilePath, buildCodexProfileToml({
      route: startingRoute,
      proxyPort,
      catalogPath,
      modelReasoningEffort: caps.defaultLevel || void 0
    }));
    writeSessionLock({
      pid: process.pid,
      startedAt: (/* @__PURE__ */ new Date()).toISOString(),
      profilePath,
      catalogPaths: [catalogPath],
      proxyPort
    });
    if (!isAgentStdoutMode()) {
      logProxy(proxyPort);
      logActiveModel(selectedEntry.display_name, selectedEntry.id);
      printCodexCliCleanupPanel("relay-ai codex --restore");
    }
    const childEnv = buildCodexChildEnv(startingRoute, proxyPort);
    const exitCode = await launchCodex(selectedEntry.id, childEnv, passthroughArgs);
    if (trace) printTraceLog(debugLogPath);
    printCodexCleanupReminder(true);
    return exitCode;
  } finally {
    proxyHandle?.close();
    restoreCodexOverlay();
  }
}
async function runCodexCommand(codexArgs, trace = false, launch = {}) {
  if (codexArgs.includes("--help") || codexArgs.includes("-h")) {
    console.log(codexHelpText());
    return 0;
  }
  if (codexArgs.includes("--restore")) {
    const removed = restoreCodexOverlay();
    if (removed.length) {
      console.log(`Restored: removed ${removed.length} relay-ai Codex overlay file(s).`);
    } else {
      console.log("Nothing to restore.");
    }
    return 0;
  }
  const codexPath = findCodexBinary();
  if (!codexPath) {
    console.error(pc10.red("\nError: codex binary not found on PATH.\n"));
    console.error("Install OpenAI Codex CLI:");
    console.error("  npm install -g @openai/codex\n");
    return 1;
  }
  const interrupted = recoverInterruptedCodexSession();
  const configOnly = codexArgs.includes("--config");
  const passthroughArgs = rejectManagedFlags(codexArgs.filter((a) => a !== "--config"));
  const agentStdout = wantsCleanAgentStdout("codex", passthroughArgs);
  setAgentStdoutMode(agentStdout);
  const debugLogPath = getCodexProxyDebugLogPath();
  if (trace && !configOnly) {
    p11.log.info(`Debug log: ${debugLogPath}`);
  }
  const isTty = Boolean(process.stdin.isTTY);
  if (launch.vertex) {
    if (!configOnly) {
      const sessionCheck = checkSessionLock(isTty);
      if (!sessionCheck.ok) {
        if (sessionCheck.reason === "non_tty") {
          console.error(pc10.red("relay-ai codex --vertex requires an interactive terminal."));
          return 1;
        }
        console.error(pc10.yellow(`Another relay-ai codex session may be running (pid ${sessionCheck.lock.pid}).`));
        console.error("Run relay-ai codex --restore to clean up, or wait for it to finish.");
        return 1;
      }
    }
    return runCodexVertexLaunch(passthroughArgs, trace);
  }
  const prefs = loadPreferences();
  const launchPlan = planLaunchWizard({
    explicit: { providerId: launch.launchProvider, modelId: launch.launchModel },
    childArgs: passthroughArgs,
    agent: "codex",
    prefs
  });
  if (launchPlan.error) {
    console.error(pc10.red(`
Error: ${launchPlan.error}
`));
    return 1;
  }
  const allowNonTty = !!(launchPlan.skip && launchPlan.target);
  if (!configOnly) {
    const sessionCheck = checkSessionLock(isTty || allowNonTty);
    if (!sessionCheck.ok) {
      if (sessionCheck.reason === "non_tty") {
        console.error(pc10.red(
          "relay-ai codex requires an interactive terminal (or use --provider and --model for non-interactive launch)."
        ));
        return 1;
      }
      console.error(pc10.yellow(`Another relay-ai codex session may be running (pid ${sessionCheck.lock.pid}).`));
      console.error("Run relay-ai codex --restore to clean up, or wait for it to finish.");
      return 1;
    }
  }
  if (!configOnly) {
    if (!agentStdout) codexCliIntro();
    if (interrupted.recovered && !agentStdout) {
      p11.log.warn(
        "Found leftover Codex files from an interrupted session (closed terminal, crash, or force-quit)."
      );
      p11.log.info(
        `Removed ${interrupted.removedCount ?? "those"} file(s) automatically. If anything still looks wrong: relay-ai codex --restore`
      );
    }
  }
  let catalog;
  if (agentStdout) {
    try {
      catalog = await fetchProviderCatalog({ agent: "codex" });
    } catch (err) {
      console.error(pc10.red(String(err instanceof Error ? err.message : err)));
      return 1;
    }
  } else {
    const catalogSpinner = p11.spinner();
    catalogSpinner.start("Loading your providers...");
    try {
      catalog = await fetchProviderCatalog({ agent: "codex" });
    } catch (err) {
      catalogSpinner.stop("");
      console.error(pc10.red(String(err instanceof Error ? err.message : err)));
      return 1;
    }
    catalogSpinner.stop("");
  }
  const compatible = codexCompatibleProviders(providersForPicker(catalog), "codex");
  if (compatible.length === 0) {
    if (!configOnly) {
      p11.log.warn("No Codex-compatible providers in your registry.");
      p11.log.info("Add a provider with relay-ai providers add, or sign in with relay-ai providers auth openai.");
    }
    return 0;
  }
  const favorites = prefs.favoriteModels ?? [];
  const favoritesActive = favorites.length > 0 && !launchPlan.skip;
  if (favoritesActive && !configOnly) {
    p11.log.info(
      `Favorites mode active \u2014 Codex picker will show ${favorites.length + 1} models (1 starting + ${favorites.length} favorites).`
    );
    p11.log.info("Edit with `relay-ai models`.");
  }
  let activeProvider = compatible.find((lp) => lp.id === prefs.lastCodexProvider) ?? compatible[0];
  let selectedModel = activeProvider.models.find((m) => m.id === prefs.lastCodexModel) ?? activeProvider.models[0];
  if (!configOnly && launchPlan.skip && launchPlan.target) {
    const resolved = findProviderAndModel(compatible, launchPlan.target);
    if (!resolved) {
      p11.log.error(
        `Provider/model not found: ${launchPlan.target.providerId} / ${launchPlan.target.modelId}`
      );
      return 1;
    }
    activeProvider = resolved.provider;
    selectedModel = resolved.model;
    if (!agentStdout) {
      p11.log.step(`Using ${selectedModel.name || selectedModel.id} (${activeProvider.name})`);
    }
  } else if (!configOnly) {
    let currentInitialProvider = prefs.lastCodexProvider && compatible.some((o) => o.id === prefs.lastCodexProvider) ? prefs.lastCodexProvider : compatible[0].id;
    while (true) {
      const pickedProvider = await pickCodexProvider(compatible, prefs, favoritesActive, currentInitialProvider);
      if (!pickedProvider) return 0;
      if (pickedProvider === "__favorites__") {
        const favoriteProviders = compatible.map((provider) => ({
          ...provider,
          models: routableModelsForProvider(provider, "codex")
        }));
        const available = [];
        for (const fav of favorites) {
          const prov = favoriteProviders.find((lp) => lp.id === fav.providerId);
          const mod = prov?.models.find((m) => m.id === fav.modelId);
          if (prov && mod) available.push({ provider: prov, model: mod });
        }
        if (available.length === 0) {
          p11.log.warn("No saved Codex favorites are currently available.");
          return 0;
        }
        const favOptions = available.map((f, i) => ({
          value: String(i),
          label: `${f.model.name || f.model.id} \u2014 ${f.provider.name}`,
          hint: f.model.id
        }));
        const pickedIdx = await p11.select({
          message: "Starting model?",
          options: favOptions,
          initialValue: "0"
        });
        if (p11.isCancel(pickedIdx)) {
          p11.cancel("Cancelled.");
          return 0;
        }
        const sel = available[Number(pickedIdx)];
        activeProvider = sel.provider;
        selectedModel = sel.model;
        break;
      } else {
        activeProvider = pickedProvider;
        const pickedModelResult = await pickCodexModel(activeProvider, prefs);
        if (pickedModelResult === "back") {
          currentInitialProvider = activeProvider.id;
          continue;
        }
        if (!pickedModelResult) return 0;
        selectedModel = pickedModelResult;
        break;
      }
    }
  }
  let resolvedFavorites = [];
  let providersById = /* @__PURE__ */ new Map();
  if (favoritesActive) {
    let zenGoApiKey = null;
    const hasZenGo = favorites.some((f) => f.providerId === "zen" || f.providerId === "go") || activeProvider.id === "zen" || activeProvider.id === "go";
    if (hasZenGo) {
      if (!configOnly) {
        zenGoApiKey = await resolveOrCollectApiKey(false, trace);
      } else {
        const existing = resolveApiKey();
        if (existing) {
          zenGoApiKey = existing;
        } else {
          const stored = await readFromCredentialStore(() => {
          });
          if (stored) zenGoApiKey = stored;
        }
      }
    }
    const res = resolveCodexFavorites(
      activeProvider,
      selectedModel,
      compatible,
      favorites,
      "codex",
      zenGoApiKey
    );
    resolvedFavorites = res.resolvedFavorites;
    providersById = res.providersById;
  }
  const regEntry = loadRegistry().providers.find((p20) => p20.id === activeProvider.id);
  const authRef = regEntry?.authRef ?? (activeProvider.apiKey ? `keyring:provider:${activeProvider.id}` : oauthAuthRef(activeProvider.id));
  const apiKey = activeProvider.apiKey?.trim() || await resolveProviderCredential(activeProvider.id, authRef);
  if (!apiKey) {
    if (!configOnly) {
      p11.log.error(`No credential for ${activeProvider.name}. Run relay-ai providers auth ${activeProvider.id} or add an API key.`);
    }
    return 1;
  }
  const route = resolveCodexRoute(activeProvider, selectedModel, apiKey);
  if (!configOnly && !(launchPlan.skip && launchPlan.target)) {
    const modelLabel = formatCodexModelLabel(selectedModel);
    const confirmed = await confirmCodexLaunch(
      activeProvider.name,
      modelLabel,
      selectedModel.id,
      route
    );
    if (!confirmed) return 0;
  }
  let proxyHandle = null;
  try {
    let proxyPort;
    if (favoritesActive && resolvedFavorites.length > 0) {
      const routes = buildCodexProxyRoutesFromResolved(resolvedFavorites, providersById);
      proxyHandle = await startCodexProxy(routes, { requireAuth: true, debug: trace });
      proxyPort = proxyHandle.port;
    } else if (route.tier === "proxy") {
      proxyHandle = await startCodexProxy([{
        modelId: route.modelId,
        npm: route.npm,
        apiKey: route.apiKey,
        baseURL: route.baseURL,
        upstreamModelId: route.upstreamModelId,
        providerId: route.providerId,
        supportedParameters: route.supportedParameters,
        reasoning: route.reasoning,
        interleavedReasoningField: route.interleavedReasoningField
      }], { debug: trace });
      proxyPort = proxyHandle.port;
    }
    const startingFavorite = resolvedFavorites.find(
      (r) => r.providerId === activeProvider.id && r.model.id === selectedModel.id
    ) ?? resolvedFavorites[0];
    const { profilePath, catalogPath } = favoritesActive && resolvedFavorites.length > 0 && proxyPort && startingFavorite ? await writeFavoritesLaunchArtifacts(resolvedFavorites, startingFavorite, proxyPort) : await writeLaunchArtifacts(route, selectedModel, activeProvider.name, proxyPort);
    writeSessionLock({
      pid: process.pid,
      startedAt: (/* @__PURE__ */ new Date()).toISOString(),
      profilePath,
      catalogPaths: [catalogPath],
      proxyPort
    });
    if (configOnly) {
      const home = process.env["HOME"] ?? "";
      const shortenPath = (p20) => home ? p20.replace(home, "~") : p20;
      console.log("");
      console.log(pc10.bold(pc10.cyan("  CONFIG PREVIEW \u2014 relay-ai codex")));
      console.log("");
      if (favoritesActive && resolvedFavorites.length > 0) {
        console.log(`  ${pc10.bold("Mode:")}     Favorites Catalog (${resolvedFavorites.length} model${resolvedFavorites.length !== 1 ? "s" : ""})`);
        console.log("");
        console.log(`  ${pc10.bold("Models:")}`);
        for (const r of resolvedFavorites) {
          console.log(`    ${pc10.cyan(r.model.id)}  ${pc10.dim(`(${r.providerName})`)}`);
        }
      } else {
        console.log(`  ${pc10.bold("Mode:")}     Single model`);
        console.log(`  ${pc10.bold("Provider:")} ${activeProvider.name}`);
        console.log(`  ${pc10.bold("Model:")}    ${selectedModel.id}`);
      }
      console.log("");
      console.log(`  ${pc10.bold("Files written:")}`);
      console.log(`    ${pc10.dim(shortenPath(profilePath))}`);
      console.log(`    ${pc10.dim(shortenPath(catalogPath))}`);
      console.log("");
      console.log(pc10.dim("  No Codex process was started."));
      console.log(pc10.dim("  Run ") + pc10.cyan("relay-ai codex") + pc10.dim(" to launch."));
      console.log("");
      restoreCodexOverlay();
      return 0;
    }
    recordLaunchSelection("codex", activeProvider.id, selectedModel.id, prefs);
    const modelLabel = formatCodexModelLabel(selectedModel);
    if (!agentStdout) {
      if (route.tier === "proxy" && proxyPort) {
        logProxy(proxyPort);
      }
    }
    const favoritesLaunch = favoritesActive && resolvedFavorites.length > 0;
    const launchModelId = favoritesLaunch ? codexCliFavoritesSlug(activeProvider.id, selectedModel.id) : selectedModel.id;
    if (!agentStdout) {
      logActiveModel(modelLabel, launchModelId);
      printCodexCliCleanupPanel("relay-ai codex --restore");
      codexCliOutro(activeProvider.name, modelLabel, launchModelId);
    }
    const dummyRoute = {
      tier: "proxy",
      modelId: launchModelId,
      providerId: "relay-ai-proxy",
      npm: selectedModel.npm ?? "@ai-sdk/openai-compatible",
      upstreamModelId: selectedModel.upstreamModelId || selectedModel.id,
      apiKey: ""
    };
    const childEnv = buildCodexChildEnv(
      favoritesLaunch ? dummyRoute : route,
      proxyPort
    );
    const hadProxy = (route.tier === "proxy" || favoritesLaunch) && !!proxyPort;
    const exitCode = await launchCodex(launchModelId, childEnv, passthroughArgs);
    if (trace) printTraceLog(debugLogPath);
    printCodexCleanupReminder(hadProxy);
    return exitCode;
  } finally {
    proxyHandle?.close();
    restoreCodexOverlay();
  }
}

// src/gemini.ts
import pc11 from "picocolors";
import * as p13 from "@clack/prompts";

// src/gemini/launch.ts
import { execSync as execSync2, spawn as spawn2 } from "child_process";
import { existsSync as existsSync5 } from "fs";
import { homedir as homedir5 } from "os";
import { join as join5 } from "path";
var isWindows2 = process.platform === "win32";
var GEMINI_FALLBACK_PATHS = isWindows2 ? [
  join5(process.env["APPDATA"] ?? homedir5(), "npm", "gemini.cmd"),
  join5(process.env["APPDATA"] ?? homedir5(), "npm", "gemini")
] : [
  join5(homedir5(), ".local", "bin", "gemini"),
  join5(homedir5(), ".npm", "bin", "gemini"),
  "/usr/local/bin/gemini",
  "/opt/homebrew/bin/gemini"
];
function findGeminiBinary() {
  try {
    const result = execSync2(isWindows2 ? "where.exe gemini" : "which gemini", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"]
    });
    const path2 = result.trim().split("\n")[0]?.trim();
    if (path2) return path2;
  } catch {
  }
  for (const path2 of GEMINI_FALLBACK_PATHS) {
    if (existsSync5(path2)) return path2;
  }
  return null;
}
function buildGeminiChildEnv(proxyPort, proxyToken) {
  const env = { ...process.env };
  delete env["GOOGLE_GEMINI_BASE_URL"];
  delete env["GEMINI_API_KEY"];
  delete env["GOOGLE_API_KEY"];
  delete env["GOOGLE_GENAI_API_KEY"];
  env["GOOGLE_GEMINI_BASE_URL"] = `http://127.0.0.1:${proxyPort}`;
  env["GEMINI_API_KEY"] = proxyToken;
  return env;
}
function launchGemini(geminiPath, modelId, env, extraArgs) {
  return new Promise((resolve) => {
    const args = ["-m", modelId, ...extraArgs];
    const child = spawn2(geminiPath, args, {
      stdio: "inherit",
      env,
      shell: isWindows2
    });
    const onSigInt = () => child.kill("SIGINT");
    const onSigTerm = () => child.kill("SIGTERM");
    process.once("SIGINT", onSigInt);
    process.once("SIGTERM", onSigTerm);
    const done = (code) => {
      process.off("SIGINT", onSigInt);
      process.off("SIGTERM", onSigTerm);
      resolve(code);
    };
    child.on("error", () => done(1));
    child.on("exit", (code) => done(code ?? 0));
  });
}

// src/gemini/prompts.ts
import * as p12 from "@clack/prompts";
async function pickGeminiProvider(providers, prefs, hasFavorites = false, initialProviderId) {
  if (providers.length === 0 && !hasFavorites) return null;
  const options = providers.map((lp) => providerSelectOption(lp));
  if (hasFavorites) {
    options.unshift({
      value: "__favorites__",
      label: "\u2B50 Favorites Catalog",
      hint: `${prefs.favoriteModels?.length ?? 0} saved favorites`
    });
  }
  const initial = initialProviderId && options.some((o) => o.value === initialProviderId) ? initialProviderId : prefs.lastGeminiProvider && options.some((o) => o.value === prefs.lastGeminiProvider) ? prefs.lastGeminiProvider : options[0].value;
  const chosen = await p12.select({
    message: "Which provider for Gemini CLI?",
    options,
    initialValue: initial
  });
  if (p12.isCancel(chosen)) {
    p12.cancel("Cancelled.");
    return null;
  }
  if (chosen === "__favorites__") return "__favorites__";
  return providers.find((lp) => lp.id === chosen) ?? null;
}
async function pickGeminiModel(provider, prefs) {
  const recentIds = (prefs.recentModelsByProvider?.[provider.id] ?? []).slice(0, 3);
  const recentModels = recentIds.map((id) => provider.models.find((m) => m.id === id)).filter((m) => m !== void 0);
  let selectedModel = null;
  while (true) {
    if (recentModels.length > 0) {
      const options = [
        ...recentModels.map((m) => modelSelectOption(m, "recent")),
        navOption("__browse_all__", "Browse all models \u2192", `${provider.models.length} available`),
        navOption("__back__", "\u2190 Go back", "Select a different provider")
      ];
      const picked = await p12.select({
        message: `Model for ${provider.name}?`,
        options,
        initialValue: recentModels[0].id
      });
      if (p12.isCancel(picked) || String(picked) === "__back__") {
        return "back";
      }
      if (String(picked) === "__browse_all__") {
        const browsed = await browseAllModels(provider, prefs);
        if (browsed === "back") {
          continue;
        }
        if (!browsed) return null;
        selectedModel = browsed;
        break;
      } else {
        selectedModel = recentModels.find((m) => m.id === String(picked));
        break;
      }
    } else {
      const browsed = await browseAllModels(provider, prefs);
      if (browsed === "back") {
        return "back";
      }
      if (!browsed) return null;
      selectedModel = browsed;
      break;
    }
  }
  return selectedModel;
}
function confirmGeminiLaunch(providerName, modelLabel, modelId) {
  return p12.confirm({
    message: confirmLaunchMessage("Gemini CLI", modelLabel, modelId, providerName),
    initialValue: true
  }).then((answer) => {
    if (p12.isCancel(answer)) {
      p12.cancel("Cancelled.");
      return false;
    }
    return answer;
  });
}
async function pickGeminiFavoriteModel(providers, favorites) {
  const favList = [];
  for (const fav of favorites) {
    const provider2 = providers.find((lp) => lp.id === fav.providerId);
    const model2 = provider2?.models.find((m) => m.id === fav.modelId);
    if (provider2 && model2) favList.push({ provider: provider2, model: model2 });
  }
  if (favList.length === 0) {
    p12.log.warn("None of your saved favorites are available in the current registry.");
    return null;
  }
  const options = [
    ...favList.map(({ provider: provider2, model: model2 }) => ({
      value: `${provider2.id}::${model2.id}`,
      label: model2.name || model2.id,
      hint: provider2.name
    })),
    { value: "__back__", label: "\u2190 Go back", hint: "Select a different provider" }
  ];
  const picked = await p12.select({
    message: "Pick a favorite model for Gemini CLI:",
    options,
    initialValue: options[0].value
  });
  if (p12.isCancel(picked) || String(picked) === "__back__") return "back";
  const [pickedProviderId, pickedModelId] = picked.split("::");
  const provider = providers.find((lp) => lp.id === pickedProviderId);
  const model = provider?.models.find((m) => m.id === pickedModelId);
  if (!provider || !model) return null;
  return { provider, model };
}
function rejectGeminiManagedFlags(geminiArgs) {
  const blocked = /* @__PURE__ */ new Set(["--provider", "--model", "-m", "--trace"]);
  const takesValue = /* @__PURE__ */ new Set(["--provider", "--model", "-m"]);
  const out = [];
  for (let i = 0; i < geminiArgs.length; i++) {
    const arg = geminiArgs[i];
    if (blocked.has(arg)) {
      if (takesValue.has(arg)) i++;
      continue;
    }
    if (arg.startsWith("--model=") || arg.startsWith("--provider=") || arg.startsWith("-m=")) continue;
    out.push(arg);
  }
  return out;
}

// src/gemini-proxy.ts
import { createServer as createServer4 } from "http";
import { randomUUID as randomUUID6 } from "crypto";
import { streamText as streamText4, generateText as generateText4, tool as tool5, jsonSchema as jsonSchema5 } from "ai";
function mapFinishReason(reason) {
  if (reason === "stop" || reason === "tool-calls") return "STOP";
  if (reason === "length") return "MAX_TOKENS";
  if (reason === "content-filter") return "SAFETY";
  return "OTHER";
}
function lookupGeminiRoute(routes, requestedModel) {
  const ids = [requestedModel, ...routeLookupIds(requestedModel)];
  const slashIdx = requestedModel.indexOf("/");
  if (slashIdx >= 0) {
    const after = requestedModel.slice(slashIdx + 1);
    ids.push(after, ...routeLookupIds(after));
  }
  const doubleUnderscore = requestedModel.indexOf("__");
  if (doubleUnderscore >= 0) {
    const after = requestedModel.slice(doubleUnderscore + 2);
    ids.push(after, ...routeLookupIds(after));
  }
  const uniqueIds = [...new Set(ids)];
  for (const id of uniqueIds) {
    const route = routes.find((r) => r.aliasId === id || r.realModelId === id);
    if (route) return route;
  }
  return void 0;
}
function mergeConsecutiveMessages2(messages) {
  const merged = [];
  for (const msg of messages) {
    if (merged.length === 0) {
      merged.push(msg);
      continue;
    }
    const last = merged[merged.length - 1];
    if (last.role === msg.role) {
      const lastContent = Array.isArray(last.content) ? last.content : [{ type: "text", text: last.content }];
      const nextContent = Array.isArray(msg.content) ? msg.content : [{ type: "text", text: msg.content }];
      last.content = [...lastContent, ...nextContent];
    } else {
      merged.push(msg);
    }
  }
  return merged;
}
function stripGeminiIdentity(text5) {
  return text5.replace(/You are Gemini CLI[\s\S]*?(?=\n\n|$)/gi, "").replace(/I'm Gemini CLI[\s\S]*?(?=\n\n|$)/gi, "").replace(/Gemini CLI/gi, "AI CLI");
}
function translateGeminiRequest(body) {
  let system;
  if (body.systemInstruction?.parts) {
    const rawSystem = body.systemInstruction.parts.map((p20) => p20.text || "").join("\n");
    system = stripGeminiIdentity(rawSystem).trim();
  }
  const messages = [];
  const nameToIdList = /* @__PURE__ */ new Map();
  const contents = body.contents || [];
  for (const turn of contents) {
    const role = turn.role === "model" ? "assistant" : "user";
    const parts = [];
    const toolResults = [];
    const turnParts = turn.parts || [];
    for (const p20 of turnParts) {
      if (p20.text !== void 0) {
        const text5 = stripGeminiIdentity(p20.text);
        if (text5.includes("<thinking>")) {
          const tokens = text5.split(/<thinking>([\s\S]*?)<\/thinking>/);
          for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i].trim();
            if (!token) continue;
            parts.push({ type: i % 2 === 1 ? "reasoning" : "text", text: token });
          }
        } else {
          parts.push({ type: "text", text: text5 });
        }
      } else if (p20.inlineData) {
        parts.push({
          type: "image",
          image: Buffer.from(p20.inlineData.data, "base64"),
          mediaType: p20.inlineData.mimeType
        });
      } else if (p20.functionCall) {
        const id = "call_" + randomUUID6().replace(/-/g, "");
        const name = p20.functionCall.name;
        if (!nameToIdList.has(name)) nameToIdList.set(name, []);
        nameToIdList.get(name).push(id);
        parts.push({
          type: "tool-call",
          toolCallId: id,
          toolName: name,
          input: p20.functionCall.args || {}
        });
      } else if (p20.functionResponse) {
        const name = p20.functionResponse.name;
        const idList = nameToIdList.get(name) || [];
        const id = idList.shift() || "call_" + randomUUID6().replace(/-/g, "");
        toolResults.push({
          type: "tool-result",
          toolCallId: id,
          toolName: name,
          output: {
            type: "text",
            value: typeof p20.functionResponse.response === "string" ? p20.functionResponse.response : JSON.stringify(p20.functionResponse.response || {})
          }
        });
      }
    }
    if (toolResults.length > 0) {
      messages.push({
        role: "tool",
        content: toolResults
      });
    }
    if (parts.length > 0) {
      messages.push({
        role,
        content: parts
      });
    }
  }
  const mergedMessages = mergeConsecutiveMessages2(messages);
  let tools;
  if (body.tools) {
    tools = {};
    for (const t of body.tools) {
      if (t.functionDeclarations) {
        for (const fd of t.functionDeclarations) {
          tools[fd.name] = tool5({
            description: fd.description || "",
            inputSchema: jsonSchema5(fd.parameters || { type: "object", properties: {} })
          });
        }
      }
    }
  }
  let toolChoice;
  const mode = body.toolConfig?.functionCallingConfig?.mode;
  if (mode === "ANY") {
    toolChoice = "required";
  } else if (mode === "AUTO") {
    toolChoice = "auto";
  }
  const generationConfig = body.generationConfig || {};
  let responseFormat;
  if (generationConfig.responseMimeType === "application/json") {
    responseFormat = { type: "json" };
  }
  return {
    system,
    messages: mergedMessages,
    tools: tools && Object.keys(tools).length > 0 ? tools : void 0,
    toolChoice,
    maxOutputTokens: generationConfig.maxOutputTokens,
    temperature: generationConfig.temperature,
    responseFormat
  };
}
async function startGeminiProxy(routes, debug = false) {
  const proxyToken = randomUUID6();
  silenceSdkWarnings();
  if (routes.length === 0) {
    return Promise.reject(new Error("Gemini proxy requires at least one route"));
  }
  const defaultRoute = routes[0];
  const models = /* @__PURE__ */ new Map();
  const plog = debug ? makeTraceLogger(getGeminiProxyDebugLogPath()) : () => {
  };
  const onRejection = (reason) => {
    plog(`Unhandled Rejection: ${reason instanceof Error ? reason.stack || reason.message : String(reason)}`);
  };
  const onException = (error) => {
    plog(`Uncaught Exception: ${error.stack || error.message}`);
  };
  const getOrInitModel = async (route) => {
    let m = models.get(route.aliasId);
    if (!m) {
      m = await createLanguageModel({
        npm: route.npm || "@ai-sdk/openai-compatible",
        modelId: route.realModelId,
        apiKey: route.apiKey,
        baseURL: route.baseURL,
        providerId: route.aliasId,
        authType: route.authType,
        oauthAccountId: route.oauthAccountId
      });
      models.set(route.aliasId, m);
    }
    return m;
  };
  const formatGeminiModel = (route) => ({
    name: `models/${route.aliasId}`,
    version: "1.0",
    displayName: route.displayName,
    description: "Registry model routed through relay-ai proxy",
    inputTokenLimit: route.contextWindow || 1e6,
    outputTokenLimit: 8192,
    supportedGenerationMethods: ["generateContent", "streamGenerateContent"]
  });
  let sessionRouteOverride = void 0;
  const server = createServer4(async (req, res) => {
    try {
      const url = req.url ?? "";
      plog(`${req.method} ${url}`);
      if (req.method === "GET" && (url.endsWith("/models") || url.includes("/models?"))) {
        plog("GET models list");
        res.writeHead(200, { "Content-Type": "application/json" });
        const payload = JSON.stringify({
          models: routes.map(formatGeminiModel)
        });
        plog(`Response: ${payload}`);
        res.end(payload);
        return;
      }
      if (req.method === "GET" && url.includes("/models/")) {
        const modelMatch = url.match(/\/models\/([^?]+)/);
        if (modelMatch) {
          const modelId = decodeURIComponent(modelMatch[1]);
          const route = lookupGeminiRoute(routes, modelId) ?? defaultRoute;
          plog(`GET model details: ${modelId} -> mapped to route ${route.aliasId}`);
          res.writeHead(200, { "Content-Type": "application/json" });
          const payload = JSON.stringify(formatGeminiModel(route));
          plog(`Response: ${payload}`);
          res.end(payload);
          return;
        }
      }
      if (req.method === "POST" && url.includes(":")) {
        const isStream = url.includes("streamGenerateContent");
        const rawBody = await readBody(req);
        plog(`Request body:
${rawBody}`);
        let body;
        try {
          body = JSON.parse(rawBody);
        } catch {
          plog("Error: Invalid JSON body");
          res.writeHead(400);
          res.end("Invalid JSON");
          return;
        }
        const modelMatch = url.match(/\/models\/([^:]+)/);
        const requestedModel = modelMatch ? decodeURIComponent(modelMatch[1]) : defaultRoute.aliasId;
        const lastUserTurn = findLastUserTurn(body.contents || []);
        const modelCommand = parseModelCommand(lastUserTurn);
        if (modelCommand !== null) {
          if (modelCommand === "") {
            const current = sessionRouteOverride ?? (lookupGeminiRoute(routes, requestedModel) ?? defaultRoute);
            const availableList = routes.map((r) => `  - ${r.aliasId} (${r.displayName})`).join("\n");
            const exampleId = routes.length > 1 ? routes[1].aliasId : routes[0]?.aliasId ?? "deepseek-v4";
            const text5 = `Current model: ${current.displayName} (${current.aliasId})

Available models:
${availableList}

\u{1F4A1} To switch models, type: .model <id>
Example: .model ${exampleId}`;
            sendMockGeminiResponse(res, text5, isStream);
            return;
          }
          const targetRoute = lookupGeminiRoute(routes, modelCommand);
          if (targetRoute) {
            sessionRouteOverride = targetRoute;
            plog(`.model switch: ${targetRoute.aliasId} (${targetRoute.realModelId})`);
            sendMockGeminiResponse(res, `\u2705 Switched model to ${targetRoute.displayName} (${targetRoute.aliasId})`, isStream);
          } else {
            const available = routes.map((r) => r.aliasId).join(", ");
            sendMockGeminiResponse(res, `\u274C Model '${modelCommand}' not found.

Available: ${available}`, isStream);
          }
          return;
        }
        const route = sessionRouteOverride ?? (lookupGeminiRoute(routes, requestedModel) ?? defaultRoute);
        plog(`Route selected: ${route.aliasId} (upstream model: ${route.realModelId})`);
        body.contents = sanitizeModelSwitchTurns(body.contents || []);
        const languageModel = await getOrInitModel(route);
        const params = translateGeminiRequest(body);
        plog(`Translated SDK params:
${JSON.stringify(params, null, 2)}`);
        if (isStream) {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive"
          });
          plog("Starting streamText...");
          const { fullStream } = streamText4({
            model: languageModel,
            ...params
          });
          const toolCallBuffers = /* @__PURE__ */ new Map();
          let isThinking = false;
          for await (const part of fullStream) {
            const p20 = part;
            plog(`Stream chunk type: ${p20.type}`);
            if (isThinking && (p20.type === "tool-input-start" || p20.type === "tool-call" || p20.type === "finish")) {
              isThinking = false;
              const chunk = {
                candidates: [{ content: { role: "model", parts: [{ text: `
</thinking>

` }] } }]
              };
              res.write(`data: ${JSON.stringify(chunk)}

`);
            }
            if (p20.type === "reasoning") {
              let text5 = p20.textDelta ?? p20.text ?? "";
              if (!isThinking) {
                isThinking = true;
                text5 = `<thinking>
` + text5;
              }
              const chunk = {
                candidates: [{ content: { role: "model", parts: [{ text: text5 }] } }]
              };
              res.write(`data: ${JSON.stringify(chunk)}

`);
            } else if (p20.type === "text-delta") {
              let text5 = p20.textDelta ?? p20.text ?? "";
              if (isThinking) {
                isThinking = false;
                text5 = `
</thinking>

` + text5;
              }
              const chunk = {
                candidates: [{
                  content: {
                    role: "model",
                    parts: [{ text: text5 }]
                  }
                }]
              };
              const data = `data: ${JSON.stringify(chunk)}

`;
              plog(`Streaming text delta: ${p20.textDelta}`);
              res.write(data);
            } else if (p20.type === "tool-input-start") {
              toolCallBuffers.set(p20.toolCallId, { name: p20.toolName, json: "" });
            } else if (p20.type === "tool-input-delta") {
              const buf = toolCallBuffers.get(p20.toolCallId);
              if (buf) buf.json += p20.delta;
            } else if (p20.type === "tool-call") {
              const buf = toolCallBuffers.get(p20.toolCallId);
              const args = buf ? JSON.parse(buf.json || "{}") : p20.input || {};
              const name = buf ? buf.name : p20.toolName;
              plog(`Streaming tool call: ${name} with args: ${JSON.stringify(args)}`);
              const chunk = {
                candidates: [{
                  content: {
                    role: "model",
                    parts: [{
                      functionCall: { name, args }
                    }]
                  }
                }]
              };
              res.write(`data: ${JSON.stringify(chunk)}

`);
            } else if (p20.type === "finish") {
              const chunk = {
                candidates: [{
                  finishReason: mapFinishReason(p20.finishReason ?? "")
                }],
                usageMetadata: {
                  promptTokenCount: p20.totalUsage?.inputTokens || 0,
                  candidatesTokenCount: p20.totalUsage?.outputTokens || 0
                }
              };
              plog(`Stream finish. Reason: ${p20.finishReason}`);
              res.write(`data: ${JSON.stringify(chunk)}

`);
            }
          }
          res.end();
          plog("Stream ended.");
        } else {
          plog("Starting generateText...");
          const result = await generateText4({
            model: languageModel,
            ...params
          });
          plog("generateText finished.");
          const parts = [];
          if (result.reasoning) {
            parts.push({ text: `<thinking>
${result.reasoning}
</thinking>

` });
          }
          if (result.text) {
            parts.push({ text: result.text });
          }
          if (result.toolCalls?.length) {
            for (const tc of result.toolCalls) {
              parts.push({
                functionCall: { name: tc.toolName, args: tc.args }
              });
            }
          }
          const response = {
            candidates: [{
              content: {
                role: "model",
                parts
              },
              finishReason: mapFinishReason(result.finishReason ?? "")
            }],
            usageMetadata: {
              promptTokenCount: result.usage?.inputTokens || 0,
              candidatesTokenCount: result.usage?.outputTokens || 0
            }
          };
          plog(`Response:
${JSON.stringify(response, null, 2)}`);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(response));
        }
        return;
      }
      plog(`404 Not Found: ${url}`);
      res.writeHead(404);
      res.end("Not Found");
    } catch (err) {
      plog(`Error handling request: ${err instanceof Error ? err.stack || err.message : String(err)}`);
      if (debug) {
        console.error("[Gemini Proxy] Critical error in handler:", err);
      }
      const errMsg = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: errMsg } }));
      } else {
        try {
          res.write(`data: ${JSON.stringify({ error: { message: errMsg } })}

`);
        } catch {
        }
        res.end();
      }
    }
  });
  process.on("unhandledRejection", onRejection);
  process.on("uncaughtException", onException);
  const cleanup = () => {
    process.off("unhandledRejection", onRejection);
    process.off("uncaughtException", onException);
  };
  return new Promise((resolve, reject2) => {
    server.on("error", (err) => {
      cleanup();
      reject2(err);
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        cleanup();
        reject2(new Error("Failed to bind gemini proxy"));
        return;
      }
      resolve({
        port: addr.port,
        token: proxyToken,
        close: () => {
          cleanup();
          server.close();
        }
      });
    });
  });
}
function sanitizeModelSwitchTurns(contents) {
  const cleaned = [];
  let i = 0;
  while (i < contents.length) {
    const turn = contents[i];
    if (isModelSwitchTurn(turn)) {
      i += 1;
      if (i < contents.length && contents[i]?.role === "model") {
        i += 1;
      }
      continue;
    }
    cleaned.push(turn);
    i += 1;
  }
  return cleaned;
}
function isModelSwitchTurn(turn) {
  if (turn?.role !== "user") return false;
  const parts = turn.parts || [];
  if (parts.length === 0) return false;
  const firstText = parts[0]?.text;
  if (typeof firstText !== "string") return false;
  return firstText.trim().startsWith(".model");
}
function findLastUserTurn(contents) {
  for (let i = contents.length - 1; i >= 0; i--) {
    if (contents[i]?.role === "user") return contents[i];
  }
  return void 0;
}
function parseModelCommand(turn) {
  if (!turn || turn.role !== "user") return null;
  const parts = turn.parts || [];
  if (parts.length !== 1) return null;
  const text5 = parts[0]?.text;
  if (typeof text5 !== "string") return null;
  const trimmed = text5.trim();
  if (!trimmed.startsWith(".model")) return null;
  if (trimmed === ".model") return "";
  if (trimmed.charAt(6) !== " ") return null;
  return trimmed.slice(7).trim();
}
function sendMockGeminiResponse(res, text5, isStream) {
  if (isStream) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    });
    const chunk = {
      candidates: [{
        content: { role: "model", parts: [{ text: text5 }] },
        finishReason: "STOP"
      }],
      usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0 }
    };
    res.write(`data: ${JSON.stringify(chunk)}

`);
    const finishChunk = {
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0 }
    };
    res.write(`data: ${JSON.stringify(finishChunk)}

`);
    res.end();
  } else {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      candidates: [{
        content: { role: "model", parts: [{ text: text5 }] },
        finishReason: "STOP"
      }],
      usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0 }
    }));
  }
}

// src/gemini.ts
function geminiHelpText() {
  return `${pc11.bold("relay-ai gemini")} v${VERSION}
Launch Google Gemini CLI with OpenCode Zen / Go or local registry providers.

${pc11.bold("Usage:")}
  relay-ai gemini [options] [gemini-flags]
  relay-ai gemini --help
  relay-ai gemini --version

${pc11.bold("Options:")}
  --trace      Write proxy debug logs to ~/.relay-ai/logs/ and show errors on exit
  --provider   Boot provider id (skip wizard when paired with --model or non-interactive)
  --model      Boot model id (skip wizard when paired with --provider or non-interactive)
  --help       Show this command help
  --version    Show version

${pc11.bold("Description:")}
  Picks a provider and model from ~/.relay-ai/providers.json, starts a local Gemini-to-SDK translation
  proxy, and launches the Gemini CLI.
  All registry models (Anthropic, OpenAI, custom endpoints, etc.) route through the local translation proxy.

${pc11.bold("Prerequisites:")}
  npm install -g @google/gemini-cli

${pc11.bold("Passing flags to Gemini CLI:")}
  Add Gemini flags directly \u2014 no "--" separator needed.
  relay-ai manages -m / --model and -p / --prompt; other flags go to Gemini CLI.

${pc11.bold("Examples:")}
  relay-ai gemini
  relay-ai gemini --trace
  relay-ai gemini --provider zen --model gemini-2.5-flash
  relay-ai gemini -p "review this file"`;
}
async function runGeminiCommand(geminiArgs, trace = false, launch = {}) {
  if (geminiArgs.includes("--help") || geminiArgs.includes("-h")) {
    console.log(geminiHelpText());
    return 0;
  }
  const geminiPath = findGeminiBinary();
  if (!geminiPath) {
    console.error(pc11.red("\nError: gemini binary not found on PATH.\n"));
    console.error("Install Google Gemini CLI:");
    console.error("  npm install -g @google/gemini-cli\n");
    return 1;
  }
  const passthroughArgs = rejectGeminiManagedFlags(geminiArgs);
  const agentStdout = wantsCleanAgentStdout("gemini", passthroughArgs);
  setAgentStdoutMode(agentStdout);
  const prefs = loadPreferences();
  const launchPlan = planLaunchWizard({
    explicit: { providerId: launch.launchProvider, modelId: launch.launchModel },
    childArgs: passthroughArgs,
    agent: "gemini",
    prefs
  });
  if (launchPlan.error) {
    console.error(pc11.red(`
Error: ${launchPlan.error}
`));
    return 1;
  }
  let catalog;
  if (agentStdout) {
    try {
      catalog = await fetchProviderCatalog({ agent: "gemini" });
    } catch (err) {
      console.error(pc11.red(String(err instanceof Error ? err.message : err)));
      return 1;
    }
  } else {
    const catalogSpinner = p13.spinner();
    catalogSpinner.start("Loading your providers...");
    try {
      catalog = await fetchProviderCatalog({ agent: "gemini" });
    } catch (err) {
      catalogSpinner.stop("");
      console.error(pc11.red(String(err instanceof Error ? err.message : err)));
      return 1;
    }
    catalogSpinner.stop("");
  }
  const compatible = providersForPicker(catalog);
  if (compatible.length === 0) {
    p13.log.warn("No Gemini-compatible providers in your registry.");
    p13.log.info("Add a provider with relay-ai providers add, or sign in with relay-ai providers auth openai.");
    return 0;
  }
  let activeProvider = compatible.find((lp) => lp.id === prefs.lastGeminiProvider) ?? compatible[0];
  let selectedModel = activeProvider.models.find((m) => m.id === prefs.lastGeminiModel) ?? activeProvider.models[0];
  if (!selectedModel) {
    p13.log.error(`Provider "${activeProvider.name}" has no models available.`);
    return 1;
  }
  ;
  if (launchPlan.skip && launchPlan.target) {
    const resolved = findProviderAndModel(compatible, launchPlan.target);
    if (!resolved) {
      p13.log.error(
        `Provider/model not found: ${launchPlan.target.providerId} / ${launchPlan.target.modelId}`
      );
      return 1;
    }
    activeProvider = resolved.provider;
    selectedModel = resolved.model;
    if (!agentStdout) {
      p13.log.step(`Using ${selectedModel.name || selectedModel.id} (${activeProvider.name})`);
    }
  } else {
    if (!agentStdout) {
      console.log("");
      p13.log.info(`Launching ${pc11.bold("Gemini CLI")} with relay-ai`);
    }
    const chosenProvider = await pickGeminiProvider(
      compatible,
      prefs,
      (prefs.favoriteModels ?? []).length > 0,
      launch.launchProvider
    );
    if (!chosenProvider) return 0;
    if (chosenProvider === "__favorites__") {
      const favPick = await pickGeminiFavoriteModel(compatible, prefs.favoriteModels ?? []);
      if (!favPick || favPick === "back") return 0;
      activeProvider = favPick.provider;
      selectedModel = favPick.model;
    } else {
      activeProvider = chosenProvider;
      const chosenModel = await pickGeminiModel(activeProvider, prefs);
      if (!chosenModel || chosenModel === "back") return 0;
      selectedModel = chosenModel;
    }
    if (!agentStdout) {
      const ok = await confirmGeminiLaunch(
        activeProvider.name,
        selectedModel.name || selectedModel.id,
        selectedModel.id
      );
      if (!ok) return 0;
    }
  }
  recordLaunchSelection("gemini", activeProvider.id, selectedModel.id, prefs);
  const launchApiKey = await resolveLocalProviderApiKey(activeProvider);
  if (!launchApiKey?.trim()) {
    p13.log.error(
      `No API key found for ${activeProvider.name}. Set it with relay-ai providers add.`
    );
    return 1;
  }
  const providerRoutes = activeProvider.models.map((m) => ({
    aliasId: m.id,
    realModelId: m.upstreamModelId || m.id,
    displayName: m.name || m.id,
    upstreamUrl: m.baseUrl || m.apiBaseUrl || "",
    apiKey: launchApiKey,
    modelFormat: m.modelFormat,
    contextWindow: m.contextWindow,
    npm: m.npm,
    baseURL: m.apiBaseUrl,
    providerId: activeProvider.id,
    authType: activeProvider.authType,
    oauthAccountId: activeProvider.oauthAccountId,
    supportedParameters: m.supportedParameters,
    reasoning: m.reasoning,
    interleavedReasoningField: m.interleavedReasoningField
  }));
  const resolvedFavs = [];
  const favorites = prefs.favoriteModels ?? [];
  for (const fav of favorites) {
    const provider = compatible.find((lp) => lp.id === fav.providerId);
    const model = provider?.models.find((m) => m.id === fav.modelId);
    if (provider && model) {
      const apiKey = await resolveLocalProviderApiKey(provider);
      if (apiKey) {
        resolvedFavs.push({
          aliasId: model.id,
          realModelId: model.upstreamModelId || model.id,
          displayName: model.name || model.id,
          upstreamUrl: model.baseUrl || model.apiBaseUrl || "",
          apiKey,
          modelFormat: model.modelFormat,
          contextWindow: model.contextWindow,
          npm: model.npm,
          baseURL: model.apiBaseUrl,
          providerId: provider.id,
          authType: provider.authType,
          oauthAccountId: provider.oauthAccountId,
          supportedParameters: model.supportedParameters,
          reasoning: model.reasoning,
          interleavedReasoningField: model.interleavedReasoningField
        });
      }
    }
  }
  const routesMap = /* @__PURE__ */ new Map();
  for (const route of providerRoutes) {
    routesMap.set(route.aliasId, route);
  }
  for (const route of resolvedFavs) {
    if (!routesMap.has(route.aliasId)) {
      routesMap.set(route.aliasId, route);
    }
  }
  const startingRoute = routesMap.get(selectedModel.id);
  if (!startingRoute) {
    routesMap.set(selectedModel.id, {
      aliasId: selectedModel.id,
      realModelId: selectedModel.upstreamModelId || selectedModel.id,
      displayName: selectedModel.name || selectedModel.id,
      upstreamUrl: selectedModel.baseUrl || selectedModel.apiBaseUrl || "",
      apiKey: launchApiKey,
      modelFormat: selectedModel.modelFormat,
      contextWindow: selectedModel.contextWindow,
      npm: selectedModel.npm,
      baseURL: selectedModel.apiBaseUrl,
      providerId: activeProvider.id,
      authType: activeProvider.authType,
      oauthAccountId: activeProvider.oauthAccountId,
      supportedParameters: selectedModel.supportedParameters,
      reasoning: selectedModel.reasoning,
      interleavedReasoningField: selectedModel.interleavedReasoningField
    });
  }
  const finalRoutes = [...routesMap.values()];
  let proxyHandle = null;
  try {
    proxyHandle = await startGeminiProxy(finalRoutes, trace);
  } catch (err) {
    p13.log.error(`Failed to start Gemini proxy: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  const childEnv = buildGeminiChildEnv(proxyHandle.port, proxyHandle.token);
  if (!agentStdout) {
    p13.log.info(`Gemini proxy started on port ${proxyHandle.port}`);
    p13.log.info(`\u{1F4A1} Type ${pc11.bold(".model <id>")} in the chat to switch models mid-session.`);
  }
  const exitCode = await launchGemini(geminiPath, selectedModel.id, childEnv, passthroughArgs);
  proxyHandle.close();
  if (!agentStdout) {
    p13.log.info("Gemini proxy stopped.");
  }
  if (trace) {
    printTraceLog(getGeminiProxyDebugLogPath());
  }
  return exitCode;
}

// src/antigravity.ts
import pc12 from "picocolors";
import * as p14 from "@clack/prompts";
import { appendFileSync as appendFileSync3 } from "fs";

// src/antigravity/cloud-code-gateway.ts
import http from "http";
import { streamText as streamText5, generateText as generateText5 } from "ai";

// src/antigravity/response-adapter.ts
function mapFinishReason2(reason) {
  if (reason === "stop" || reason === "tool-calls") return "STOP";
  if (reason === "length") return "MAX_TOKENS";
  if (reason === "content-filter") return "SAFETY";
  return "OTHER";
}
function formatCloudCodeChunk(opts) {
  const parts = [];
  if (opts.thought !== void 0 && opts.thought !== "") {
    parts.push({ text: opts.thought, thought: true });
  }
  if (opts.text !== void 0 && opts.text !== "") {
    parts.push({ text: opts.text });
  }
  if (opts.functionCall) {
    parts.push({ functionCall: opts.functionCall });
  }
  if (parts.length === 0 && !opts.finishReason) {
    parts.push({ text: "" });
  }
  const candidate = {};
  if (parts.length > 0 || opts.finishReason) {
    candidate.content = {
      role: "model",
      parts
    };
  }
  if (opts.finishReason) {
    candidate.finishReason = opts.finishReason;
  }
  const response = {
    candidates: [candidate],
    modelVersion: opts.modelVersion,
    responseId: opts.responseId
  };
  if (opts.usage) {
    response.usageMetadata = {
      promptTokenCount: opts.usage.promptTokens,
      candidatesTokenCount: opts.usage.completionTokens,
      totalTokenCount: opts.usage.promptTokens + opts.usage.completionTokens
    };
  }
  return {
    response,
    traceId: "relay-trace",
    metadata: {}
  };
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
var KNOWN_COMPATIBLE_AGY_VERSIONS = /* @__PURE__ */ new Set(["1.0.10"]);
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
    warnings.push(`Unvalidated AGY version ${opts.version}; fixture shape matches, so multi-model switching remains enabled.`);
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
function applyRouteContextBounds(entry, route) {
  const maxTokenLimit = route.contextWindow ?? 128e3;
  const maxOutputTokens = Math.min(entry.maxOutputTokens ?? 65536, maxTokenLimit);
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
function planRelayCatalogSlots(catalog, routes, templateKey) {
  const validation = validateAgySlotRegistry(catalog);
  const switchSlots = getValidatedAgySwitchSlots(catalog);
  const templateSlot = switchSlots.find((slot) => slot.slotId === templateKey);
  const orderedSlots = templateSlot ? [templateSlot, ...switchSlots.filter((slot) => slot.slotId !== templateKey)] : switchSlots;
  if (routes.length > 0 && orderedSlots.length === 0) {
    throw new Error("No validated AGY switch slots are available for the selected launch route");
  }
  const switchableRoutes = routes.slice(0, orderedSlots.length);
  const skippedRoutes = routes.slice(orderedSlots.length);
  const slots = switchableRoutes.map((route, index) => ({
    slotId: orderedSlots[index].slotId,
    route
  }));
  return {
    slots,
    switchableRoutes,
    skippedRoutes,
    validation
  };
}
function resolveRelayCatalogSlots(catalog, routes, templateKey) {
  return planRelayCatalogSlots(catalog, routes, templateKey).slots;
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
function injectRelayModels(fixture, routes, templateKey) {
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
    const slotPlan = planRelayCatalogSlots(result, routes, templateKey);
    const slots = slotPlan.slots;
    for (const { slotId, route } of slots) {
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
function buildAntigravityRoutes(resolvedFavorites, maxRoutes = MAX_MODEL_CATALOG) {
  const routes = [];
  const seen = /* @__PURE__ */ new Set();
  for (const fav of resolvedFavorites) {
    if (routes.length >= maxRoutes) break;
    const favModel = fav.model;
    const modelId = favModel.id;
    const catalogId = `relay-ai__${fav.providerId}__${modelId}`;
    if (seen.has(catalogId)) continue;
    seen.add(catalogId);
    const npm = favModel.npm || "@ai-sdk/openai-compatible";
    const upstreamModelId2 = favModel.upstreamModelId || modelId;
    const baseURL = favModel.apiBaseUrl || favModel.completionsUrl || void 0;
    const contextWindow = favModel.contextWindow;
    routes.push({
      catalogId,
      providerId: fav.providerId,
      providerName: fav.providerName,
      modelId,
      upstreamModelId: upstreamModelId2,
      displayName: `${favModel.name} (Relay)`,
      npm,
      apiKey: fav.apiKey,
      ...fav.authType ? { authType: fav.authType } : {},
      ...fav.oauthAccountId ? { oauthAccountId: fav.oauthAccountId } : {},
      baseURL,
      contextWindow
    });
  }
  return applyUniqueAntigravityRouteLabels(routes);
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
  const baseNameCounts = duplicateCounts(baseNames);
  const upstreamCounts = duplicateCounts(routes.map((route) => route.upstreamModelId));
  const providerNameCounts = duplicateCounts(routes.map((route) => route.providerName));
  const labeled = routes.map((route, index) => {
    const baseName = baseNames[index];
    const needsSuffix = (baseNameCounts.get(baseName) ?? 0) > 1 || (upstreamCounts.get(route.upstreamModelId) ?? 0) > 1;
    if (!needsSuffix) {
      return { ...route, displayName: `${baseName} (Relay)` };
    }
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
function buildListModelConfigsResponse(routes, catalog, templateKey = RELAY_CASCADE_ANCHOR_ID) {
  const catalogRoutes = routes.slice(0, MAX_MODEL_CATALOG);
  const slots = catalog ? resolveRelayCatalogSlots(catalog, catalogRoutes, templateKey) : catalogRoutes.map((route) => ({ slotId: route.catalogId, route }));
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

// src/antigravity/fixtures/loadCodeAssist.json
var loadCodeAssist_default = {
  currentTier: {
    id: "free-tier",
    name: "Antigravity",
    description: "Gemini-powered code suggestions and chat in multiple IDEs",
    privacyNotice: {
      showNotice: false,
      noticeText: ""
    },
    upgradeSubscriptionUri: "https://codeassist.google.com/upgrade",
    upgradeSubscriptionText: "Upgrade to get higher rate limits",
    upgradeSubscriptionType: "GDP_HELIUM"
  },
  allowedTiers: [
    {
      id: "free-tier",
      name: "Antigravity",
      description: "Gemini-powered code suggestions and chat in multiple IDEs",
      isDefault: true
    },
    {
      id: "standard-tier",
      name: "Antigravity",
      description: "Unlimited coding assistant",
      userDefinedCloudaicompanionProject: true,
      usesGcpTos: true
    }
  ],
  cloudaicompanionProject: "relay-ai-local-project",
  gcpManaged: false,
  upgradeSubscriptionUri: "https://codeassist.google.com/upgrade",
  paidTier: {
    id: "g1-pro-tier",
    name: "Google AI Pro",
    description: "Google AI Pro",
    upgradeSubscriptionUri: "https://antigravity.google/g1-upgrade",
    availableCredits: [
      {
        creditType: "GOOGLE_ONE_AI",
        minimumCreditAmountForUsage: "50"
      }
    ]
  }
};

// src/antigravity/fixtures/fetchAvailableModels.json
var fetchAvailableModels_default = {
  models: {
    "gpt-oss-120b-medium": {
      displayName: "GPT-OSS 120B (Medium)",
      supportsThinking: true,
      thinkingBudget: 8192,
      recommended: true,
      maxTokens: 131072,
      maxOutputTokens: 32768,
      tokenizerType: "LLAMA_WITH_SPECIAL",
      quotaInfo: {
        remainingFraction: 0.15333453,
        resetTime: "2026-06-26T16:48:02Z"
      },
      model: "MODEL_OPENAI_GPT_OSS_120B_MEDIUM",
      apiProvider: "API_PROVIDER_OPENAI_VERTEX",
      modelProvider: "MODEL_PROVIDER_OPENAI",
      modelExperiments: {
        experiments: {
          CASCADE_USE_EXPERIMENT_CHECKPOINTER: {
            stringValue: '{\n    "strategy": "CHECKPOINT_STRATEGY_UNSPECIFIED",\n    "max_token_limit": "80000",\n    "token_threshold": "50000",\n    "max_overhead_ratio": "0.15",\n    "moving_window_size": "1",\n    "enabled": true,\n    "max_output_tokens": "8192",\n    "checkpoint_model": "MODEL_PLACEHOLDER_M50",\n    "use_last_planner_model": false,\n    "is_sync": false,\n    "max_user_requests": 10,\n    "include_last_user_message": false,\n    "include_conversation_log": true,\n    "include_running_task_snapshots": true,\n    "include_subagent_snapshots": true,\n    "include_artifact_snapshots": true,\n    "retry_config": {\n        "max_retries": 0,\n        "initial_sleep_duration_ms": 1000,\n        "exponential_multiplier": 2,\n        "include_error_feedback": false\n    }\n}'
          }
        }
      },
      vertexModelId: "openai/gpt-oss-120b-maas"
    },
    "gemini-3-flash-agent": {
      displayName: "Gemini 3.5 Flash (High)",
      supportsImages: true,
      supportsThinking: true,
      thinkingBudget: 1e4,
      minThinkingBudget: 32,
      recommended: true,
      maxTokens: 1048576,
      maxOutputTokens: 65536,
      tokenizerType: "LLAMA_WITH_SPECIAL",
      quotaInfo: {
        remainingFraction: 1,
        resetTime: "2026-06-24T06:22:06Z"
      },
      model: "MODEL_PLACEHOLDER_M132",
      apiProvider: "API_PROVIDER_GOOGLE_GEMINI",
      modelProvider: "MODEL_PROVIDER_GOOGLE",
      supportsVideo: true,
      tagTitle: "Fast",
      tagDescription: "Limited time",
      supportedMimeTypes: {
        "application/x-python-code": true,
        "image/heif": true,
        "video/audio/wav": true,
        "audio/webm;codecs=opus": true,
        "application/pdf": true,
        "text/markdown": true,
        "application/json": true,
        "text/css": true,
        "text/javascript": true,
        "text/csv": true,
        "application/x-typescript": true,
        "text/plain": true,
        "video/text/timestamp": true,
        "video/mp4": true,
        "image/jpeg": true,
        "application/rtf": true,
        "application/x-javascript": true,
        "image/webp": true,
        "video/webm": true,
        "text/rtf": true,
        "video/audio/s16le": true,
        "text/x-python": true,
        "image/png": true,
        "video/jpeg2000": true,
        "application/x-ipynb+json": true,
        "text/x-python-script": true,
        "image/heic": true,
        "video/videoframe/jpeg2000": true,
        "text/html": true,
        "text/xml": true,
        "text/x-typescript": true
      },
      modelExperiments: {
        experiments: {
          CASCADE_USE_EXPERIMENT_CHECKPOINTER: {
            stringValue: '{\n    "strategy": "CHECKPOINT_STRATEGY_SAME_MODEL",\n    "max_token_limit": "256000",\n    "token_threshold": "100000",\n    "max_overhead_ratio": "0.15",\n    "moving_window_size": "1",\n    "enabled": true,\n    "max_output_tokens": "16384",\n    "checkpoint_model": "MODEL_PLACEHOLDER_M50",\n    "use_last_planner_model": true,\n    "is_sync": true,\n    "max_user_requests": 10,\n    "include_last_user_message": true,\n    "include_conversation_log": false,\n    "include_running_task_snapshots": true,\n    "include_subagent_snapshots": true,\n    "include_artifact_snapshots": true,\n    "retry_config": {\n        "max_retries": 0,\n        "initial_sleep_duration_ms": 1000,\n        "exponential_multiplier": 2,\n        "include_error_feedback": false\n    }\n}'
          },
          template__system_prompts__identity: {
            stringValue: "You are Antigravity, a powerful agentic AI coding assistant designed by the Google DeepMind team working on Advanced Agentic Coding.\nYou are pair programming with a USER to solve their coding task. The task may require creating a new codebase, modifying or debugging an existing codebase, or simply answering a question.\nThe USER will send you requests, which you must always prioritize addressing. User requests are enclosed within <USER_REQUEST> tags. Along with each USER request, we will attach additional metadata about their current state, such as what files they have open and where their cursor is.\nThis information may or may not be relevant to the coding task, it is up for you to decide."
          },
          template__system_prompts__planning_mode_artifacts: {
            stringValue: "When in planning mode, you will work with three special artifacts.\n\n# Tasks\nPath: {{ArtifactDirectoryPath}}/task.md\n\n**Purpose**: A TODO list to organize your work during execution. Create this artifact after receiving user approval on your implementation plan. Break down complex tasks into component-level items and track progress as a living document.\n\n**Format**:\n```markdown\n- `[ ]` uncompleted tasks\n- `[/]` in progress tasks (custom notation)\n- `[x]` completed tasks\n- Use indented lists for sub-items\n```\n\n**Updating task.md**: Mark items as `[/]` when starting work on them, and `[x]` when completed. Update task.md as you make progress through your checklist.\n\n# Implementation Plan\nPath: {{ArtifactDirectoryPath}}/implementation_plan.md\n\n**Purpose**: A detailed design document to present your technical implementation plan to the user for feedback and approval.\nAfter reading the document, the user should understand the key technical details of your plan, and be able to make an informed decision on whether to approve it.\n\n**Format**: Use the following format, omitting any irrelevant sections.\n```markdown\n# [Goal Description]\n\nProvide a brief description of the problem, any background context, and what the change accomplishes.\n\n## User Review Required\n\nDocument anything that requires user review or feedback, for example, breaking changes or significant design decisions. Use GitHub alerts (IMPORTANT/WARNING/CAUTION) to highlight critical items.\n\n## Open Questions\n\nAny clarifying or design questions for the user that will impact the implementation plan. Use GitHub alerts (IMPORTANT/WARNING/CAUTION) to highlight critical items.\n\n## Proposed Changes\n\nGroup files by component (e.g., package, feature area, dependency layer) and order logically (dependencies first). Separate components with horizontal rules for visual clarity.\n\n### [Component Name]\n\nSummary of what will change in this component, separated by files. For specific files, Use [NEW] and [DELETE] to demarcate new and deleted files, for example:\n\n#### [MODIFY] [file basename](file:///absolute/path/to/modifiedfile)\n#### [NEW] [file basename](file:///absolute/path/to/newfile)\n#### [DELETE] [file basename](file:///absolute/path/to/deletedfile)\n\n## Verification Plan\n\nSummary of how you will verify that your changes have the desired effects.\n\n### Automated Tests\n- The commands of any automated tests you'll run.\n\n### Manual Verification\n- Asking the user to deploy to staging and testing, verifying UI changes on an iOS app etc.\n```\n\n# Walkthrough\nPath: {{ArtifactDirectoryPath}}/walkthrough.md\n\n**Purpose**: After completing work, summarize what you accomplished. Update an existing walkthrough for related follow-up work rather than creating a new one.\n\n**Document**:\n- Changes made\n- What was tested\n- Validation results\n\nEmbed screenshots and recordings to visually demonstrate UI changes and user flows.\n"
          }
        }
      }
    },
    tab_jump_flash_lite_preview: {
      maxTokens: 16384,
      maxOutputTokens: 4096,
      tokenizerType: "LLAMA_WITH_SPECIAL",
      quotaInfo: {
        remainingFraction: 1
      },
      model: "MODEL_PLACEHOLDER_M28",
      apiProvider: "API_PROVIDER_GOOGLE_GEMINI",
      modelProvider: "MODEL_PROVIDER_GOOGLE",
      supportsCumulativeContext: true,
      tabJumpPrintLineRange: true,
      supportsEstimateTokenCounter: true,
      addCursorToFindReplaceTarget: true,
      toolFormatterType: "TOOL_FORMATTER_TYPE_XML",
      requiresLeadInGeneration: true,
      requiresNoXmlToolExamples: true
    },
    tab_flash_lite_preview: {
      maxTokens: 16384,
      maxOutputTokens: 4096,
      tokenizerType: "LLAMA_WITH_SPECIAL",
      quotaInfo: {
        remainingFraction: 1
      },
      model: "MODEL_PLACEHOLDER_M19",
      apiProvider: "API_PROVIDER_GOOGLE_GEMINI",
      modelProvider: "MODEL_PROVIDER_GOOGLE",
      supportsCumulativeContext: true,
      supportsEstimateTokenCounter: true,
      toolFormatterType: "TOOL_FORMATTER_TYPE_XML",
      requiresLeadInGeneration: true
    },
    "gemini-3-flash": {
      displayName: "Gemini 3 Flash",
      supportsImages: true,
      supportsThinking: true,
      thinkingBudget: -1,
      minThinkingBudget: 32,
      recommended: true,
      maxTokens: 1048576,
      maxOutputTokens: 65536,
      tokenizerType: "LLAMA_WITH_SPECIAL",
      quotaInfo: {
        remainingFraction: 1,
        resetTime: "2026-06-24T06:22:06Z"
      },
      model: "MODEL_PLACEHOLDER_M18",
      apiProvider: "API_PROVIDER_GOOGLE_GEMINI",
      modelProvider: "MODEL_PROVIDER_GOOGLE",
      supportsVideo: true,
      supportedMimeTypes: {
        "application/x-ipynb+json": true,
        "text/x-python": true,
        "text/css": true,
        "application/rtf": true,
        "text/csv": true,
        "application/x-javascript": true,
        "video/mp4": true,
        "video/audio/wav": true,
        "application/json": true,
        "video/webm": true,
        "text/xml": true,
        "text/x-python-script": true,
        "text/markdown": true,
        "text/html": true,
        "application/x-typescript": true,
        "image/jpeg": true,
        "image/heic": true,
        "image/heif": true,
        "audio/webm;codecs=opus": true,
        "video/videoframe/jpeg2000": true,
        "application/pdf": true,
        "text/x-typescript": true,
        "image/webp": true,
        "application/x-python-code": true,
        "text/plain": true,
        "video/text/timestamp": true,
        "text/rtf": true,
        "image/png": true,
        "video/audio/s16le": true,
        "video/jpeg2000": true,
        "text/javascript": true
      },
      modelExperiments: {
        experiments: {
          CASCADE_USE_EXPERIMENT_CHECKPOINTER: {
            stringValue: '{\n    "strategy": "CHECKPOINT_STRATEGY_SINGLE_PROMPT",\n    "max_token_limit": "128000",\n    "token_threshold": "50000",\n    "max_overhead_ratio": "0.15",\n    "moving_window_size": "1",\n    "enabled": true,\n    "max_output_tokens": "16384",\n    "checkpoint_model": "MODEL_PLACEHOLDER_M50",\n    "use_last_planner_model": false,\n    "is_sync": false,\n    "max_user_requests": 10,\n    "include_last_user_message": false,\n    "include_conversation_log": true,\n    "include_running_task_snapshots": true,\n    "include_subagent_snapshots": true,\n    "include_artifact_snapshots": true,\n    "retry_config": {\n        "max_retries": 0,\n        "initial_sleep_duration_ms": 1000,\n        "exponential_multiplier": 2,\n        "include_error_feedback": false\n    }\n}'
          },
          template__system_prompts__communication_style: {
            stringValue: '- Keep your responses concise.\n- Provide a summary of your work when you end your turn. Ground your response in the work you did. Keep your tone professional and avoid overconfident language, bragging, or overclaiming success.\n- AVOID using superlatives such as "perfectly", "flawlessly", "100% correct", "Summary of Accomplishments" etc. to summarize your work for the user. Be humble.\n- AVOID over-the-top politeness or complimenting the user excessively.\n- Format your responses in github-style markdown.'
          }
        }
      }
    },
    "gemini-2.5-flash": {
      displayName: "Gemini 3.1 Flash Lite",
      maxTokens: 1048576,
      maxOutputTokens: 65535,
      tokenizerType: "LLAMA_WITH_SPECIAL",
      quotaInfo: {
        remainingFraction: 1,
        resetTime: "2026-06-24T06:22:06Z"
      },
      model: "MODEL_GOOGLE_GEMINI_2_5_FLASH",
      apiProvider: "API_PROVIDER_GOOGLE_GEMINI",
      modelProvider: "MODEL_PROVIDER_GOOGLE",
      modelExperiments: {
        experiments: {
          CASCADE_USE_EXPERIMENT_CHECKPOINTER: {
            stringValue: '{\n    "strategy": "CHECKPOINT_STRATEGY_SINGLE_PROMPT",\n    "max_token_limit": "128000",\n    "token_threshold": "50000",\n    "max_overhead_ratio": "0.15",\n    "moving_window_size": "1",\n    "enabled": true,\n    "max_output_tokens": "16384",\n    "checkpoint_model": "MODEL_PLACEHOLDER_M50",\n    "use_last_planner_model": false,\n    "is_sync": false,\n    "max_user_requests": 10,\n    "include_last_user_message": false,\n    "include_conversation_log": true,\n    "include_running_task_snapshots": true,\n    "include_subagent_snapshots": true,\n    "include_artifact_snapshots": true,\n    "retry_config": {\n        "max_retries": 0,\n        "initial_sleep_duration_ms": 1000,\n        "exponential_multiplier": 2,\n        "include_error_feedback": false\n    }\n}'
          }
        }
      }
    },
    "gemini-3.5-flash-low": {
      displayName: "Gemini 3.5 Flash (Medium)",
      supportsImages: true,
      supportsThinking: true,
      thinkingBudget: 4e3,
      minThinkingBudget: 32,
      recommended: true,
      maxTokens: 1048576,
      maxOutputTokens: 65536,
      tokenizerType: "LLAMA_WITH_SPECIAL",
      quotaInfo: {
        remainingFraction: 1,
        resetTime: "2026-06-24T06:22:06Z"
      },
      model: "MODEL_PLACEHOLDER_M20",
      apiProvider: "API_PROVIDER_GOOGLE_GEMINI",
      modelProvider: "MODEL_PROVIDER_GOOGLE",
      supportsVideo: true,
      tagTitle: "Fast",
      tagDescription: "Limited time",
      supportedMimeTypes: {
        "video/mp4": true,
        "application/json": true,
        "video/audio/wav": true,
        "audio/webm;codecs=opus": true,
        "video/audio/s16le": true,
        "image/jpeg": true,
        "image/heic": true,
        "text/javascript": true,
        "text/x-python": true,
        "video/text/timestamp": true,
        "text/xml": true,
        "application/x-python-code": true,
        "text/html": true,
        "text/x-python-script": true,
        "application/pdf": true,
        "video/videoframe/jpeg2000": true,
        "text/rtf": true,
        "text/csv": true,
        "image/png": true,
        "application/rtf": true,
        "video/jpeg2000": true,
        "application/x-javascript": true,
        "image/webp": true,
        "application/x-typescript": true,
        "text/x-typescript": true,
        "video/webm": true,
        "text/plain": true,
        "image/heif": true,
        "text/markdown": true,
        "application/x-ipynb+json": true,
        "text/css": true
      },
      modelExperiments: {
        experiments: {
          template__system_prompts__planning_mode_artifacts: {
            stringValue: "When in planning mode, you will work with three special artifacts.\n\n# Tasks\nPath: {{ArtifactDirectoryPath}}/task.md\n\n**Purpose**: A TODO list to organize your work during execution. Create this artifact after receiving user approval on your implementation plan. Break down complex tasks into component-level items and track progress as a living document.\n\n**Format**:\n```markdown\n- `[ ]` uncompleted tasks\n- `[/]` in progress tasks (custom notation)\n- `[x]` completed tasks\n- Use indented lists for sub-items\n```\n\n**Updating task.md**: Mark items as `[/]` when starting work on them, and `[x]` when completed. Update task.md as you make progress through your checklist.\n\n# Implementation Plan\nPath: {{ArtifactDirectoryPath}}/implementation_plan.md\n\n**Purpose**: A detailed design document to present your technical implementation plan to the user for feedback and approval.\nAfter reading the document, the user should understand the key technical details of your plan, and be able to make an informed decision on whether to approve it.\n\n**Format**: Use the following format, omitting any irrelevant sections.\n```markdown\n# [Goal Description]\n\nProvide a brief description of the problem, any background context, and what the change accomplishes.\n\n## User Review Required\n\nDocument anything that requires user review or feedback, for example, breaking changes or significant design decisions. Use GitHub alerts (IMPORTANT/WARNING/CAUTION) to highlight critical items.\n\n## Open Questions\n\nAny clarifying or design questions for the user that will impact the implementation plan. Use GitHub alerts (IMPORTANT/WARNING/CAUTION) to highlight critical items.\n\n## Proposed Changes\n\nGroup files by component (e.g., package, feature area, dependency layer) and order logically (dependencies first). Separate components with horizontal rules for visual clarity.\n\n### [Component Name]\n\nSummary of what will change in this component, separated by files. For specific files, Use [NEW] and [DELETE] to demarcate new and deleted files, for example:\n\n#### [MODIFY] [file basename](file:///absolute/path/to/modifiedfile)\n#### [NEW] [file basename](file:///absolute/path/to/newfile)\n#### [DELETE] [file basename](file:///absolute/path/to/deletedfile)\n\n## Verification Plan\n\nSummary of how you will verify that your changes have the desired effects.\n\n### Automated Tests\n- The commands of any automated tests you'll run.\n\n### Manual Verification\n- Asking the user to deploy to staging and testing, verifying UI changes on an iOS app etc.\n```\n\n# Walkthrough\nPath: {{ArtifactDirectoryPath}}/walkthrough.md\n\n**Purpose**: After completing work, summarize what you accomplished. Update an existing walkthrough for related follow-up work rather than creating a new one.\n\n**Document**:\n- Changes made\n- What was tested\n- Validation results\n\nEmbed screenshots and recordings to visually demonstrate UI changes and user flows.\n"
          },
          CASCADE_USE_EXPERIMENT_CHECKPOINTER: {
            stringValue: '{\n    "strategy": "CHECKPOINT_STRATEGY_SAME_MODEL",\n    "max_token_limit": "256000",\n    "token_threshold": "100000",\n    "max_overhead_ratio": "0.15",\n    "moving_window_size": "1",\n    "enabled": true,\n    "max_output_tokens": "16384",\n    "checkpoint_model": "MODEL_PLACEHOLDER_M50",\n    "use_last_planner_model": true,\n    "is_sync": true,\n    "max_user_requests": 10,\n    "include_last_user_message": true,\n    "include_conversation_log": false,\n    "include_running_task_snapshots": true,\n    "include_subagent_snapshots": true,\n    "include_artifact_snapshots": true,\n    "retry_config": {\n        "max_retries": 0,\n        "initial_sleep_duration_ms": 1000,\n        "exponential_multiplier": 2,\n        "include_error_feedback": false\n    }\n}'
          },
          template__system_prompts__identity: {
            stringValue: "You are Antigravity, a powerful agentic AI coding assistant designed by the Google DeepMind team working on Advanced Agentic Coding.\nYou are pair programming with a USER to solve their coding task. The task may require creating a new codebase, modifying or debugging an existing codebase, or simply answering a question.\nThe USER will send you requests, which you must always prioritize addressing. User requests are enclosed within <USER_REQUEST> tags. Along with each USER request, we will attach additional metadata about their current state, such as what files they have open and where their cursor is.\nThis information may or may not be relevant to the coding task, it is up for you to decide."
          }
        }
      }
    },
    "gemini-2.5-flash-thinking": {
      displayName: "Gemini 3.1 Flash Lite",
      maxTokens: 1048576,
      maxOutputTokens: 65535,
      tokenizerType: "LLAMA_WITH_SPECIAL",
      quotaInfo: {
        remainingFraction: 1,
        resetTime: "2026-06-24T06:22:06Z"
      },
      model: "MODEL_GOOGLE_GEMINI_2_5_FLASH_THINKING",
      apiProvider: "API_PROVIDER_GOOGLE_GEMINI",
      modelProvider: "MODEL_PROVIDER_GOOGLE",
      modelExperiments: {
        experiments: {
          CASCADE_USE_EXPERIMENT_CHECKPOINTER: {
            stringValue: '{\n    "strategy": "CHECKPOINT_STRATEGY_SINGLE_PROMPT",\n    "max_token_limit": "128000",\n    "token_threshold": "50000",\n    "max_overhead_ratio": "0.15",\n    "moving_window_size": "1",\n    "enabled": true,\n    "max_output_tokens": "16384",\n    "checkpoint_model": "MODEL_PLACEHOLDER_M50",\n    "use_last_planner_model": false,\n    "is_sync": false,\n    "max_user_requests": 10,\n    "include_last_user_message": false,\n    "include_conversation_log": true,\n    "include_running_task_snapshots": true,\n    "include_subagent_snapshots": true,\n    "include_artifact_snapshots": true,\n    "retry_config": {\n        "max_retries": 0,\n        "initial_sleep_duration_ms": 1000,\n        "exponential_multiplier": 2,\n        "include_error_feedback": false\n    }\n}'
          }
        }
      }
    },
    "gemini-3.1-flash-lite": {
      displayName: "Gemini 3.1 Flash Lite",
      maxTokens: 1048576,
      maxOutputTokens: 65535,
      tokenizerType: "LLAMA_WITH_SPECIAL",
      quotaInfo: {
        remainingFraction: 1,
        resetTime: "2026-06-24T06:22:06Z"
      },
      model: "MODEL_PLACEHOLDER_M50",
      apiProvider: "API_PROVIDER_GOOGLE_GEMINI",
      modelProvider: "MODEL_PROVIDER_GOOGLE",
      modelExperiments: {
        experiments: {
          CASCADE_USE_EXPERIMENT_CHECKPOINTER: {
            stringValue: '{\n    "strategy": "CHECKPOINT_STRATEGY_SINGLE_PROMPT",\n    "max_token_limit": "128000",\n    "token_threshold": "50000",\n    "max_overhead_ratio": "0.15",\n    "moving_window_size": "1",\n    "enabled": true,\n    "max_output_tokens": "16384",\n    "checkpoint_model": "MODEL_PLACEHOLDER_M50",\n    "use_last_planner_model": false,\n    "is_sync": false,\n    "max_user_requests": 10,\n    "include_last_user_message": false,\n    "include_conversation_log": true,\n    "include_running_task_snapshots": true,\n    "include_subagent_snapshots": true,\n    "include_artifact_snapshots": true,\n    "retry_config": {\n        "max_retries": 0,\n        "initial_sleep_duration_ms": 1000,\n        "exponential_multiplier": 2,\n        "include_error_feedback": false\n    }\n}'
          }
        }
      }
    },
    "gemini-3.1-pro-high": {
      displayName: "Gemini 3.1 Pro (High)",
      supportsImages: true,
      supportsThinking: true,
      thinkingBudget: 10001,
      minThinkingBudget: 128,
      recommended: true,
      maxTokens: 1048576,
      maxOutputTokens: 65535,
      tokenizerType: "LLAMA_WITH_SPECIAL",
      quotaInfo: {
        remainingFraction: 1,
        resetTime: "2026-06-24T06:22:06Z"
      },
      model: "MODEL_PLACEHOLDER_M37",
      apiProvider: "API_PROVIDER_GOOGLE_GEMINI",
      modelProvider: "MODEL_PROVIDER_GOOGLE",
      supportsVideo: true,
      tagTitle: "New",
      supportedMimeTypes: {
        "text/css": true,
        "application/pdf": true,
        "video/videoframe/jpeg2000": true,
        "text/csv": true,
        "video/jpeg2000": true,
        "text/javascript": true,
        "video/webm": true,
        "text/html": true,
        "text/x-python": true,
        "image/jpeg": true,
        "application/x-javascript": true,
        "application/json": true,
        "application/x-typescript": true,
        "text/xml": true,
        "image/png": true,
        "video/audio/wav": true,
        "image/heic": true,
        "video/audio/s16le": true,
        "text/x-python-script": true,
        "application/x-ipynb+json": true,
        "application/rtf": true,
        "text/markdown": true,
        "video/text/timestamp": true,
        "application/x-python-code": true,
        "text/x-typescript": true,
        "video/mp4": true,
        "audio/webm;codecs=opus": true,
        "image/webp": true,
        "text/rtf": true,
        "text/plain": true,
        "image/heif": true
      },
      modelExperiments: {
        experiments: {
          CASCADE_USE_EXPERIMENT_CHECKPOINTER: {
            stringValue: '{\n    "strategy": "CHECKPOINT_STRATEGY_SINGLE_PROMPT",\n    "max_token_limit": "128000",\n    "token_threshold": "50000",\n    "max_overhead_ratio": "0.15",\n    "moving_window_size": "1",\n    "enabled": true,\n    "max_output_tokens": "16384",\n    "checkpoint_model": "MODEL_PLACEHOLDER_M50",\n    "use_last_planner_model": false,\n    "is_sync": false,\n    "max_user_requests": 10,\n    "include_last_user_message": false,\n    "include_conversation_log": true,\n    "include_running_task_snapshots": true,\n    "include_subagent_snapshots": true,\n    "include_artifact_snapshots": true,\n    "retry_config": {\n        "max_retries": 0,\n        "initial_sleep_duration_ms": 1000,\n        "exponential_multiplier": 2,\n        "include_error_feedback": false\n    }\n}'
          },
          "cascade-include-ephemeral-message": {
            stringValue: '{\n    "enabled": true,\n    "disabledHeuristics": ["running_tasks_reminder"],\n    "staticMessages": [],\n    "useAllowlist": false,\n    "enabledHeuristics": []\n}'
          },
          template__system_prompts__communication_style: {
            stringValue: "- Keep your responses concise.\n- Provide a summary of your work when you end your turn.\n- Format your responses in github-style markdown.\n- If you're unsure about the user's intent, ask for clarification rather than making assumptions.\n- You MUST create clickable links for all files and code symbols (classes, types, functions, structs). Use github style markdown links with the `file://` scheme (e.g., [filename](file:///path/to/file) or [ClassName](file:///path/to/file#L10-L20)`). For Windows, use forward slashes for paths.\n\nCRITICAL INSTRUCTION 1: You may have access to a variety of tools at your disposal. Some tools may be for a specific task such as 'view_file' (for viewing contents of a file). Others may be very broadly applicable such as the ability to run a command on a terminal. Always prioritize using the most specific tool you can for the task at hand. Here are some rules: (a) NEVER run cat inside a bash command to create a new file or append to an existing file. (b) ALWAYS use grep_search instead of running grep inside a bash command unless absolutely needed. (c) DO NOT use ls for listing, cat for viewing, grep for finding, sed for replacing.\nCRITICAL INSTRUCTION 2: Before making tool calls T, think and explicitly list out any related tools for the task at hand. You can only execute a set of tools T if all other tools in the list are either more generic or cannot be used for the task at hand. ALWAYS START your thought with recalling critical instructions 1 and 2. In particular, the format for the start of your thought block must be '...94>thought\\nCRITICAL INSTRUCTION 1: ...\\nCRITICAL INSTRUCTION 2: ...'."
          },
          template__system_prompts__identity: {
            stringValue: "You are Antigravity, a powerful agentic AI coding assistant designed by the Google DeepMind team working on Advanced Agentic Coding.\nYou are pair programming with a USER to solve their coding task. The task may require creating a new codebase, modifying or debugging an existing codebase, or simply answering a question.\nThe USER will send you requests, which you must always prioritize addressing. User requests are enclosed within <USER_REQUEST> tags. Along with each USER request, we will attach additional metadata about their current state, such as what files they have open and where their cursor is.\nThis information may or may not be relevant to the coding task, it is up for you to decide."
          },
          template__system_prompts__planning_mode_artifacts: {
            stringValue: "When in planning mode, you will work with three special artifacts.\n\n# Tasks\nPath: {{ArtifactDirectoryPath}}/task.md\n\n**Purpose**: A TODO list to organize your work during execution. Create this artifact after receiving user approval on your implementation plan. Break down complex tasks into component-level items and track progress as a living document.\n\n**Format**:\n```markdown\n- `[ ]` uncompleted tasks\n- `[/]` in progress tasks (custom notation)\n- `[x]` completed tasks\n- Use indented lists for sub-items\n```\n\n**Updating task.md**: Mark items as `[/]` when starting work on them, and `[x]` when completed. Update task.md as you make progress through your checklist.\n\n# Implementation Plan\nPath: {{ArtifactDirectoryPath}}/implementation_plan.md\n\n**Purpose**: A detailed design document to present your technical implementation plan to the user for feedback and approval.\nAfter reading the document, the user should understand the key technical details of your plan, and be able to make an informed decision on whether to approve it.\n\n**Format**: Use the following format, omitting any irrelevant sections.\n```markdown\n# [Goal Description]\n\nProvide a brief description of the problem, any background context, and what the change accomplishes.\n\n## User Review Required\n\nDocument anything that requires user review or feedback, for example, breaking changes or significant design decisions. Use GitHub alerts (IMPORTANT/WARNING/CAUTION) to highlight critical items.\n\n## Open Questions\n\nAny clarifying or design questions for the user that will impact the implementation plan. Use GitHub alerts (IMPORTANT/WARNING/CAUTION) to highlight critical items.\n\n## Proposed Changes\n\nGroup files by component (e.g., package, feature area, dependency layer) and order logically (dependencies first). Separate components with horizontal rules for visual clarity.\n\n### [Component Name]\n\nSummary of what will change in this component, separated by files. For specific files, Use [NEW] and [DELETE] to demarcate new and deleted files, for example:\n\n#### [MODIFY] [file basename](file:///absolute/path/to/modifiedfile)\n#### [NEW] [file basename](file:///absolute/path/to/newfile)\n#### [DELETE] [file basename](file:///absolute/path/to/deletedfile)\n\n## Verification Plan\n\nSummary of how you will verify that your changes have the desired effects.\n\n### Automated Tests\n- The commands of any automated tests you'll run.\n\n### Manual Verification\n- Asking the user to deploy to staging and testing, verifying UI changes on an iOS app etc.\n```\n\n# Walkthrough\nPath: {{ArtifactDirectoryPath}}/walkthrough.md\n\n**Purpose**: After completing work, summarize what you accomplished. Update an existing walkthrough for related follow-up work rather than creating a new one.\n\n**Document**:\n- Changes made\n- What was tested\n- Validation results\n\nEmbed screenshots and recordings to visually demonstrate UI changes and user flows.\n"
          }
        }
      }
    },
    "gemini-2.5-pro": {
      displayName: "Gemini 2.5 Pro",
      supportsImages: true,
      supportsThinking: true,
      thinkingBudget: 1024,
      minThinkingBudget: 128,
      recommended: true,
      maxTokens: 1048576,
      maxOutputTokens: 65535,
      tokenizerType: "LLAMA_WITH_SPECIAL",
      quotaInfo: {
        remainingFraction: 1,
        resetTime: "2026-06-24T06:22:06Z"
      },
      model: "MODEL_GOOGLE_GEMINI_2_5_PRO",
      apiProvider: "API_PROVIDER_GOOGLE_GEMINI",
      modelProvider: "MODEL_PROVIDER_GOOGLE",
      supportedMimeTypes: {
        "video/mp4": true,
        "text/html": true,
        "text/javascript": true,
        "image/heif": true,
        "text/x-python-script": true,
        "text/x-typescript": true,
        "video/text/timestamp": true,
        "text/xml": true,
        "text/x-python": true,
        "video/jpeg2000": true,
        "text/plain": true,
        "application/x-ipynb+json": true,
        "image/webp": true,
        "video/audio/wav": true,
        "application/x-python-code": true,
        "text/csv": true,
        "text/rtf": true,
        "application/x-typescript": true,
        "image/png": true,
        "video/audio/s16le": true,
        "application/rtf": true,
        "application/pdf": true,
        "application/json": true,
        "application/x-javascript": true,
        "text/css": true,
        "video/videoframe/jpeg2000": true,
        "audio/webm;codecs=opus": true,
        "text/markdown": true,
        "image/heic": true,
        "image/jpeg": true,
        "video/webm": true
      },
      requiresImageOutputOutsideFunctionResponses: true,
      modelExperiments: {
        experiments: {
          CASCADE_USE_EXPERIMENT_CHECKPOINTER: {
            stringValue: '{\n    "strategy": "CHECKPOINT_STRATEGY_SINGLE_PROMPT",\n    "max_token_limit": "128000",\n    "token_threshold": "50000",\n    "max_overhead_ratio": "0.15",\n    "moving_window_size": "1",\n    "enabled": true,\n    "max_output_tokens": "16384",\n    "checkpoint_model": "MODEL_PLACEHOLDER_M50",\n    "use_last_planner_model": false,\n    "is_sync": false,\n    "max_user_requests": 10,\n    "include_last_user_message": false,\n    "include_conversation_log": true,\n    "include_running_task_snapshots": true,\n    "include_subagent_snapshots": true,\n    "include_artifact_snapshots": true,\n    "retry_config": {\n        "max_retries": 0,\n        "initial_sleep_duration_ms": 1000,\n        "exponential_multiplier": 2,\n        "include_error_feedback": false\n    }\n}'
          }
        }
      }
    },
    "claude-opus-4-6-thinking": {
      displayName: "Claude Opus 4.6 (Thinking)",
      supportsImages: true,
      supportsThinking: true,
      thinkingBudget: 1024,
      recommended: true,
      maxTokens: 25e4,
      maxOutputTokens: 64e3,
      tokenizerType: "LLAMA_WITH_SPECIAL",
      quotaInfo: {
        remainingFraction: 0.15333453,
        resetTime: "2026-06-26T16:48:02Z"
      },
      model: "MODEL_PLACEHOLDER_M26",
      apiProvider: "API_PROVIDER_ANTHROPIC_VERTEX",
      modelProvider: "MODEL_PROVIDER_ANTHROPIC",
      supportedMimeTypes: {
        "video/jpeg2000": true,
        "video/videoframe/jpeg2000": true,
        "image/heic": true,
        "image/heif": true,
        "image/jpeg": true,
        "image/png": true,
        "image/webp": true
      },
      modelExperiments: {
        experiments: {
          CASCADE_USE_EXPERIMENT_CHECKPOINTER: {
            stringValue: '{\n    "strategy": "CHECKPOINT_STRATEGY_UNSPECIFIED",\n    "max_token_limit": "160000",\n    "token_threshold": "50000",\n    "max_overhead_ratio": "0.15",\n    "moving_window_size": "1",\n    "enabled": true,\n    "max_output_tokens": "16384",\n    "checkpoint_model": "MODEL_PLACEHOLDER_M50",\n    "use_last_planner_model": false,\n    "is_sync": false,\n    "max_user_requests": 10,\n    "include_last_user_message": false,\n    "include_conversation_log": true,\n    "include_running_task_snapshots": true,\n    "include_subagent_snapshots": true,\n    "include_artifact_snapshots": true,\n    "retry_config": {\n        "max_retries": 0,\n        "initial_sleep_duration_ms": 1000,\n        "exponential_multiplier": 2,\n        "include_error_feedback": false\n    }\n}'
          },
          template__system_prompts__planning_mode_artifacts: {
            stringValue: "When in planning mode, you will work with three special artifacts.\n\n# Tasks\nPath: {{ArtifactDirectoryPath}}/task.md\n\n**Purpose**: A TODO list to organize your work during execution. Create this artifact after receiving user approval on your implementation plan. Break down complex tasks into component-level items and track progress as a living document.\n\n**Format**:\n```markdown\n- `[ ]` uncompleted tasks\n- `[/]` in progress tasks (custom notation)\n- `[x]` completed tasks\n- Use indented lists for sub-items\n```\n\n**Updating task.md**: Mark items as `[/]` when starting work on them, and `[x]` when completed. Update task.md as you make progress through your checklist.\n\n# Implementation Plan\nPath: {{ArtifactDirectoryPath}}/implementation_plan.md\n\n**Purpose**: A detailed design document to present your technical implementation plan to the user for feedback and approval.\nAfter reading the document, the user should understand the key technical details of your plan, and be able to make an informed decision on whether to approve it.\n\n**Format**: Use the following format, omitting any irrelevant sections.\n```markdown\n# [Goal Description]\n\nProvide a brief description of the problem, any background context, and what the change accomplishes.\n\n## User Review Required\n\nDocument anything that requires user review or feedback, for example, breaking changes or significant design decisions. Use GitHub alerts (IMPORTANT/WARNING/CAUTION) to highlight critical items.\n\n## Open Questions\n\nAny clarifying or design questions for the user that will impact the implementation plan. Use GitHub alerts (IMPORTANT/WARNING/CAUTION) to highlight critical items.\n\n## Proposed Changes\n\nGroup files by component (e.g., package, feature area, dependency layer) and order logically (dependencies first). Separate components with horizontal rules for visual clarity.\n\n### [Component Name]\n\nSummary of what will change in this component, separated by files. For specific files, Use [NEW] and [DELETE] to demarcate new and deleted files, for example:\n\n#### [MODIFY] [file basename](file:///absolute/path/to/modifiedfile)\n#### [NEW] [file basename](file:///absolute/path/to/newfile)\n#### [DELETE] [file basename](file:///absolute/path/to/deletedfile)\n\n## Verification Plan\n\nSummary of how you will verify that your changes have the desired effects.\n\n### Automated Tests\n- The commands of any automated tests you'll run.\n\n### Manual Verification\n- Asking the user to deploy to staging and testing, verifying UI changes on an iOS app etc.\n```\n\n# Walkthrough\nPath: {{ArtifactDirectoryPath}}/walkthrough.md\n\n**Purpose**: After completing work, summarize what you accomplished. Update an existing walkthrough for related follow-up work rather than creating a new one.\n\n**Document**:\n- Changes made\n- What was tested\n- Validation results\n\nEmbed screenshots and recordings to visually demonstrate UI changes and user flows.\n"
          }
        }
      },
      vertexModelId: "claude-opus-4-6@default"
    },
    "gemini-3.1-pro-low": {
      displayName: "Gemini 3.1 Pro (Low)",
      supportsImages: true,
      supportsThinking: true,
      thinkingBudget: 1001,
      minThinkingBudget: 128,
      recommended: true,
      maxTokens: 1048576,
      maxOutputTokens: 65535,
      tokenizerType: "LLAMA_WITH_SPECIAL",
      quotaInfo: {
        remainingFraction: 1,
        resetTime: "2026-06-24T06:22:06Z"
      },
      model: "MODEL_PLACEHOLDER_M36",
      apiProvider: "API_PROVIDER_GOOGLE_GEMINI",
      modelProvider: "MODEL_PROVIDER_GOOGLE",
      supportsVideo: true,
      supportedMimeTypes: {
        "text/x-python-script": true,
        "application/pdf": true,
        "image/webp": true,
        "audio/webm;codecs=opus": true,
        "video/jpeg2000": true,
        "application/x-typescript": true,
        "image/heif": true,
        "text/markdown": true,
        "text/rtf": true,
        "video/audio/s16le": true,
        "text/plain": true,
        "video/mp4": true,
        "text/x-typescript": true,
        "application/json": true,
        "video/videoframe/jpeg2000": true,
        "video/webm": true,
        "video/audio/wav": true,
        "text/html": true,
        "application/rtf": true,
        "text/x-python": true,
        "image/png": true,
        "text/xml": true,
        "application/x-javascript": true,
        "image/jpeg": true,
        "text/csv": true,
        "application/x-python-code": true,
        "text/css": true,
        "application/x-ipynb+json": true,
        "text/javascript": true,
        "video/text/timestamp": true,
        "image/heic": true
      },
      modelExperiments: {
        experiments: {
          template__system_prompts__communication_style: {
            stringValue: "- Keep your responses concise.\n- Provide a summary of your work when you end your turn.\n- Format your responses in github-style markdown.\n- If you're unsure about the user's intent, ask for clarification rather than making assumptions.\n- You MUST create clickable links for all files and code symbols (classes, types, functions, structs). Use github style markdown links with the `file://` scheme (e.g., [filename](file:///path/to/file) or [ClassName](file:///path/to/file#L10-L20)`). For Windows, use forward slashes for paths.\n\nCRITICAL INSTRUCTION 1: You may have access to a variety of tools at your disposal. Some tools may be for a specific task such as 'view_file' (for viewing contents of a file). Others may be very broadly applicable such as the ability to run a command on a terminal. Always prioritize using the most specific tool you can for the task at hand. Here are some rules: (a) NEVER run cat inside a bash command to create a new file or append to an existing file. (b) ALWAYS use grep_search instead of running grep inside a bash command unless absolutely needed. (c) DO NOT use ls for listing, cat for viewing, grep for finding, sed for replacing.\nCRITICAL INSTRUCTION 2: Before making tool calls T, think and explicitly list out any related tools for the task at hand. You can only execute a set of tools T if all other tools in the list are either more generic or cannot be used for the task at hand. ALWAYS START your thought with recalling critical instructions 1 and 2. In particular, the format for the start of your thought block must be '...94>thought\\nCRITICAL INSTRUCTION 1: ...\\nCRITICAL INSTRUCTION 2: ...'."
          },
          template__system_prompts__identity: {
            stringValue: "You are Antigravity, a powerful agentic AI coding assistant designed by the Google DeepMind team working on Advanced Agentic Coding.\nYou are pair programming with a USER to solve their coding task. The task may require creating a new codebase, modifying or debugging an existing codebase, or simply answering a question.\nThe USER will send you requests, which you must always prioritize addressing. User requests are enclosed within <USER_REQUEST> tags. Along with each USER request, we will attach additional metadata about their current state, such as what files they have open and where their cursor is.\nThis information may or may not be relevant to the coding task, it is up for you to decide."
          },
          template__system_prompts__planning_mode_artifacts: {
            stringValue: "When in planning mode, you will work with three special artifacts.\n\n# Tasks\nPath: {{ArtifactDirectoryPath}}/task.md\n\n**Purpose**: A TODO list to organize your work during execution. Create this artifact after receiving user approval on your implementation plan. Break down complex tasks into component-level items and track progress as a living document.\n\n**Format**:\n```markdown\n- `[ ]` uncompleted tasks\n- `[/]` in progress tasks (custom notation)\n- `[x]` completed tasks\n- Use indented lists for sub-items\n```\n\n**Updating task.md**: Mark items as `[/]` when starting work on them, and `[x]` when completed. Update task.md as you make progress through your checklist.\n\n# Implementation Plan\nPath: {{ArtifactDirectoryPath}}/implementation_plan.md\n\n**Purpose**: A detailed design document to present your technical implementation plan to the user for feedback and approval.\nAfter reading the document, the user should understand the key technical details of your plan, and be able to make an informed decision on whether to approve it.\n\n**Format**: Use the following format, omitting any irrelevant sections.\n```markdown\n# [Goal Description]\n\nProvide a brief description of the problem, any background context, and what the change accomplishes.\n\n## User Review Required\n\nDocument anything that requires user review or feedback, for example, breaking changes or significant design decisions. Use GitHub alerts (IMPORTANT/WARNING/CAUTION) to highlight critical items.\n\n## Open Questions\n\nAny clarifying or design questions for the user that will impact the implementation plan. Use GitHub alerts (IMPORTANT/WARNING/CAUTION) to highlight critical items.\n\n## Proposed Changes\n\nGroup files by component (e.g., package, feature area, dependency layer) and order logically (dependencies first). Separate components with horizontal rules for visual clarity.\n\n### [Component Name]\n\nSummary of what will change in this component, separated by files. For specific files, Use [NEW] and [DELETE] to demarcate new and deleted files, for example:\n\n#### [MODIFY] [file basename](file:///absolute/path/to/modifiedfile)\n#### [NEW] [file basename](file:///absolute/path/to/newfile)\n#### [DELETE] [file basename](file:///absolute/path/to/deletedfile)\n\n## Verification Plan\n\nSummary of how you will verify that your changes have the desired effects.\n\n### Automated Tests\n- The commands of any automated tests you'll run.\n\n### Manual Verification\n- Asking the user to deploy to staging and testing, verifying UI changes on an iOS app etc.\n```\n\n# Walkthrough\nPath: {{ArtifactDirectoryPath}}/walkthrough.md\n\n**Purpose**: After completing work, summarize what you accomplished. Update an existing walkthrough for related follow-up work rather than creating a new one.\n\n**Document**:\n- Changes made\n- What was tested\n- Validation results\n\nEmbed screenshots and recordings to visually demonstrate UI changes and user flows.\n"
          },
          CASCADE_USE_EXPERIMENT_CHECKPOINTER: {
            stringValue: '{\n    "strategy": "CHECKPOINT_STRATEGY_SINGLE_PROMPT",\n    "max_token_limit": "128000",\n    "token_threshold": "50000",\n    "max_overhead_ratio": "0.15",\n    "moving_window_size": "1",\n    "enabled": true,\n    "max_output_tokens": "16384",\n    "checkpoint_model": "MODEL_PLACEHOLDER_M50",\n    "use_last_planner_model": false,\n    "is_sync": false,\n    "max_user_requests": 10,\n    "include_last_user_message": false,\n    "include_conversation_log": true,\n    "include_running_task_snapshots": true,\n    "include_subagent_snapshots": true,\n    "include_artifact_snapshots": true,\n    "retry_config": {\n        "max_retries": 0,\n        "initial_sleep_duration_ms": 1000,\n        "exponential_multiplier": 2,\n        "include_error_feedback": false\n    }\n}'
          },
          "cascade-include-ephemeral-message": {
            stringValue: '{\n    "enabled": true,\n    "disabledHeuristics": ["running_tasks_reminder"],\n    "staticMessages": [],\n    "useAllowlist": false,\n    "enabledHeuristics": []\n}'
          }
        }
      }
    },
    "claude-sonnet-4-6": {
      displayName: "Claude Sonnet 4.6 (Thinking)",
      supportsImages: true,
      supportsThinking: true,
      thinkingBudget: 1024,
      recommended: true,
      maxTokens: 25e4,
      maxOutputTokens: 64e3,
      tokenizerType: "LLAMA_WITH_SPECIAL",
      quotaInfo: {
        remainingFraction: 0.15333453,
        resetTime: "2026-06-26T16:48:02Z"
      },
      model: "MODEL_PLACEHOLDER_M35",
      apiProvider: "API_PROVIDER_ANTHROPIC_VERTEX",
      modelProvider: "MODEL_PROVIDER_ANTHROPIC",
      supportedMimeTypes: {
        "image/png": true,
        "image/webp": true,
        "video/jpeg2000": true,
        "video/videoframe/jpeg2000": true,
        "image/heic": true,
        "image/heif": true,
        "image/jpeg": true
      },
      modelExperiments: {
        experiments: {
          template__system_prompts__identity: {
            stringValue: "You are Antigravity, a powerful agentic AI coding assistant designed by the Google DeepMind team working on Advanced Agentic Coding.\nYou are pair programming with a USER to solve their coding task. The task may require creating a new codebase, modifying or debugging an existing codebase, or simply answering a question.\nThe USER will send you requests, which you must always prioritize addressing. User requests are enclosed within <USER_REQUEST> tags. Along with each USER request, we will attach additional metadata about their current state, such as what files they have open and where their cursor is.\nThis information may or may not be relevant to the coding task, it is up for you to decide."
          },
          template__system_prompts__planning_mode_artifacts: {
            stringValue: "When in planning mode, you will work with three special artifacts.\n\n# Tasks\nPath: {{ArtifactDirectoryPath}}/task.md\n\n**Purpose**: A TODO list to organize your work during execution. Create this artifact after receiving user approval on your implementation plan. Break down complex tasks into component-level items and track progress as a living document.\n\n**Format**:\n```markdown\n- `[ ]` uncompleted tasks\n- `[/]` in progress tasks (custom notation)\n- `[x]` completed tasks\n- Use indented lists for sub-items\n```\n\n**Updating task.md**: Mark items as `[/]` when starting work on them, and `[x]` when completed. Update task.md as you make progress through your checklist.\n\n# Implementation Plan\nPath: {{ArtifactDirectoryPath}}/implementation_plan.md\n\n**Purpose**: A detailed design document to present your technical implementation plan to the user for feedback and approval.\nAfter reading the document, the user should understand the key technical details of your plan, and be able to make an informed decision on whether to approve it.\n\n**Format**: Use the following format, omitting any irrelevant sections.\n```markdown\n# [Goal Description]\n\nProvide a brief description of the problem, any background context, and what the change accomplishes.\n\n## User Review Required\n\nDocument anything that requires user review or feedback, for example, breaking changes or significant design decisions. Use GitHub alerts (IMPORTANT/WARNING/CAUTION) to highlight critical items.\n\n## Open Questions\n\nAny clarifying or design questions for the user that will impact the implementation plan. Use GitHub alerts (IMPORTANT/WARNING/CAUTION) to highlight critical items.\n\n## Proposed Changes\n\nGroup files by component (e.g., package, feature area, dependency layer) and order logically (dependencies first). Separate components with horizontal rules for visual clarity.\n\n### [Component Name]\n\nSummary of what will change in this component, separated by files. For specific files, Use [NEW] and [DELETE] to demarcate new and deleted files, for example:\n\n#### [MODIFY] [file basename](file:///absolute/path/to/modifiedfile)\n#### [NEW] [file basename](file:///absolute/path/to/newfile)\n#### [DELETE] [file basename](file:///absolute/path/to/deletedfile)\n\n## Verification Plan\n\nSummary of how you will verify that your changes have the desired effects.\n\n### Automated Tests\n- The commands of any automated tests you'll run.\n\n### Manual Verification\n- Asking the user to deploy to staging and testing, verifying UI changes on an iOS app etc.\n```\n\n# Walkthrough\nPath: {{ArtifactDirectoryPath}}/walkthrough.md\n\n**Purpose**: After completing work, summarize what you accomplished. Update an existing walkthrough for related follow-up work rather than creating a new one.\n\n**Document**:\n- Changes made\n- What was tested\n- Validation results\n\nEmbed screenshots and recordings to visually demonstrate UI changes and user flows.\n"
          },
          CASCADE_USE_EXPERIMENT_CHECKPOINTER: {
            stringValue: '{\n    "strategy": "CHECKPOINT_STRATEGY_UNSPECIFIED",\n    "max_token_limit": "160000",\n    "token_threshold": "50000",\n    "max_overhead_ratio": "0.15",\n    "moving_window_size": "1",\n    "enabled": true,\n    "max_output_tokens": "16384",\n    "checkpoint_model": "MODEL_PLACEHOLDER_M50",\n    "use_last_planner_model": false,\n    "is_sync": false,\n    "max_user_requests": 10,\n    "include_last_user_message": false,\n    "include_conversation_log": true,\n    "include_running_task_snapshots": true,\n    "include_subagent_snapshots": true,\n    "include_artifact_snapshots": true,\n    "retry_config": {\n        "max_retries": 0,\n        "initial_sleep_duration_ms": 1000,\n        "exponential_multiplier": 2,\n        "include_error_feedback": false\n    }\n}'
          }
        }
      },
      vertexModelId: "claude-sonnet-4-6@default"
    },
    "gemini-3.1-flash-image": {
      displayName: "Gemini 3.1 Flash Image",
      tokenizerType: "LLAMA_WITH_SPECIAL",
      quotaInfo: {
        remainingFraction: 1,
        resetTime: "2026-06-24T06:22:06Z"
      },
      model: "MODEL_PLACEHOLDER_M21",
      apiProvider: "API_PROVIDER_GOOGLE_GEMINI",
      modelProvider: "MODEL_PROVIDER_GOOGLE"
    },
    "gemini-3.5-flash-extra-low": {
      displayName: "Gemini 3.5 Flash (Low)",
      supportsImages: true,
      supportsThinking: true,
      thinkingBudget: 1e3,
      minThinkingBudget: 32,
      recommended: true,
      maxTokens: 1048576,
      maxOutputTokens: 65536,
      tokenizerType: "LLAMA_WITH_SPECIAL",
      quotaInfo: {
        remainingFraction: 1,
        resetTime: "2026-06-24T06:22:06Z"
      },
      model: "MODEL_PLACEHOLDER_M187",
      apiProvider: "API_PROVIDER_GOOGLE_GEMINI",
      modelProvider: "MODEL_PROVIDER_GOOGLE",
      supportsVideo: true,
      tagTitle: "Fast",
      tagDescription: "Limited time",
      supportedMimeTypes: {
        "text/xml": true,
        "application/x-ipynb+json": true,
        "text/javascript": true,
        "text/csv": true,
        "video/audio/wav": true,
        "image/jpeg": true,
        "application/x-typescript": true,
        "text/html": true,
        "text/x-python": true,
        "text/css": true,
        "text/markdown": true,
        "video/jpeg2000": true,
        "image/heic": true,
        "text/rtf": true,
        "application/x-javascript": true,
        "text/x-python-script": true,
        "application/x-python-code": true,
        "image/png": true,
        "application/pdf": true,
        "text/x-typescript": true,
        "image/heif": true,
        "image/webp": true,
        "video/webm": true,
        "video/videoframe/jpeg2000": true,
        "video/text/timestamp": true,
        "text/plain": true,
        "video/mp4": true,
        "audio/webm;codecs=opus": true,
        "video/audio/s16le": true,
        "application/json": true,
        "application/rtf": true
      },
      modelExperiments: {
        experiments: {
          template__system_prompts__planning_mode_artifacts: {
            stringValue: "When in planning mode, you will work with three special artifacts.\n\n# Tasks\nPath: {{ArtifactDirectoryPath}}/task.md\n\n**Purpose**: A TODO list to organize your work during execution. Create this artifact after receiving user approval on your implementation plan. Break down complex tasks into component-level items and track progress as a living document.\n\n**Format**:\n```markdown\n- `[ ]` uncompleted tasks\n- `[/]` in progress tasks (custom notation)\n- `[x]` completed tasks\n- Use indented lists for sub-items\n```\n\n**Updating task.md**: Mark items as `[/]` when starting work on them, and `[x]` when completed. Update task.md as you make progress through your checklist.\n\n# Implementation Plan\nPath: {{ArtifactDirectoryPath}}/implementation_plan.md\n\n**Purpose**: A detailed design document to present your technical implementation plan to the user for feedback and approval.\nAfter reading the document, the user should understand the key technical details of your plan, and be able to make an informed decision on whether to approve it.\n\n**Format**: Use the following format, omitting any irrelevant sections.\n```markdown\n# [Goal Description]\n\nProvide a brief description of the problem, any background context, and what the change accomplishes.\n\n## User Review Required\n\nDocument anything that requires user review or feedback, for example, breaking changes or significant design decisions. Use GitHub alerts (IMPORTANT/WARNING/CAUTION) to highlight critical items.\n\n## Open Questions\n\nAny clarifying or design questions for the user that will impact the implementation plan. Use GitHub alerts (IMPORTANT/WARNING/CAUTION) to highlight critical items.\n\n## Proposed Changes\n\nGroup files by component (e.g., package, feature area, dependency layer) and order logically (dependencies first). Separate components with horizontal rules for visual clarity.\n\n### [Component Name]\n\nSummary of what will change in this component, separated by files. For specific files, Use [NEW] and [DELETE] to demarcate new and deleted files, for example:\n\n#### [MODIFY] [file basename](file:///absolute/path/to/modifiedfile)\n#### [NEW] [file basename](file:///absolute/path/to/newfile)\n#### [DELETE] [file basename](file:///absolute/path/to/deletedfile)\n\n## Verification Plan\n\nSummary of how you will verify that your changes have the desired effects.\n\n### Automated Tests\n- The commands of any automated tests you'll run.\n\n### Manual Verification\n- Asking the user to deploy to staging and testing, verifying UI changes on an iOS app etc.\n```\n\n# Walkthrough\nPath: {{ArtifactDirectoryPath}}/walkthrough.md\n\n**Purpose**: After completing work, summarize what you accomplished. Update an existing walkthrough for related follow-up work rather than creating a new one.\n\n**Document**:\n- Changes made\n- What was tested\n- Validation results\n\nEmbed screenshots and recordings to visually demonstrate UI changes and user flows.\n"
          },
          CASCADE_USE_EXPERIMENT_CHECKPOINTER: {
            stringValue: '{\n    "strategy": "CHECKPOINT_STRATEGY_SAME_MODEL",\n    "max_token_limit": "256000",\n    "token_threshold": "100000",\n    "max_overhead_ratio": "0.15",\n    "moving_window_size": "1",\n    "enabled": true,\n    "max_output_tokens": "16384",\n    "checkpoint_model": "MODEL_PLACEHOLDER_M50",\n    "use_last_planner_model": true,\n    "is_sync": true,\n    "max_user_requests": 10,\n    "include_last_user_message": true,\n    "include_conversation_log": false,\n    "include_running_task_snapshots": true,\n    "include_subagent_snapshots": true,\n    "include_artifact_snapshots": true,\n    "retry_config": {\n        "max_retries": 0,\n        "initial_sleep_duration_ms": 1000,\n        "exponential_multiplier": 2,\n        "include_error_feedback": false\n    }\n}'
          },
          template__system_prompts__identity: {
            stringValue: "You are Antigravity, a powerful agentic AI coding assistant designed by the Google DeepMind team working on Advanced Agentic Coding.\nYou are pair programming with a USER to solve their coding task. The task may require creating a new codebase, modifying or debugging an existing codebase, or simply answering a question.\nThe USER will send you requests, which you must always prioritize addressing. User requests are enclosed within <USER_REQUEST> tags. Along with each USER request, we will attach additional metadata about their current state, such as what files they have open and where their cursor is.\nThis information may or may not be relevant to the coding task, it is up for you to decide."
          }
        }
      }
    },
    chat_20706: {
      maxTokens: 16384,
      tokenizerType: "QWEN2",
      quotaInfo: {
        remainingFraction: 1
      },
      model: "MODEL_CHAT_20706",
      apiProvider: "API_PROVIDER_INTERNAL",
      modelProvider: "MODEL_PROVIDER_GOOGLE",
      supportsCumulativeContext: true,
      tabJumpPrintLineRange: true,
      supportsEstimateTokenCounter: true,
      isInternal: true,
      addCursorToFindReplaceTarget: true,
      promptTemplaterType: "PROMPT_TEMPLATER_TYPE_CHATML",
      toolFormatterType: "TOOL_FORMATTER_TYPE_XML",
      requiresLeadInGeneration: true
    },
    "gemini-2.5-flash-lite": {
      displayName: "Gemini 3.1 Flash Lite",
      maxTokens: 1048576,
      maxOutputTokens: 65535,
      tokenizerType: "LLAMA_WITH_SPECIAL",
      quotaInfo: {
        remainingFraction: 1,
        resetTime: "2026-06-24T06:22:06Z"
      },
      model: "MODEL_GOOGLE_GEMINI_2_5_FLASH_LITE",
      apiProvider: "API_PROVIDER_GOOGLE_GEMINI",
      modelProvider: "MODEL_PROVIDER_GOOGLE",
      modelExperiments: {
        experiments: {
          CASCADE_USE_EXPERIMENT_CHECKPOINTER: {
            stringValue: '{\n    "strategy": "CHECKPOINT_STRATEGY_SINGLE_PROMPT",\n    "max_token_limit": "128000",\n    "token_threshold": "50000",\n    "max_overhead_ratio": "0.15",\n    "moving_window_size": "1",\n    "enabled": true,\n    "max_output_tokens": "16384",\n    "checkpoint_model": "MODEL_PLACEHOLDER_M50",\n    "use_last_planner_model": false,\n    "is_sync": false,\n    "max_user_requests": 10,\n    "include_last_user_message": false,\n    "include_conversation_log": true,\n    "include_running_task_snapshots": true,\n    "include_subagent_snapshots": true,\n    "include_artifact_snapshots": true,\n    "retry_config": {\n        "max_retries": 0,\n        "initial_sleep_duration_ms": 1000,\n        "exponential_multiplier": 2,\n        "include_error_feedback": false\n    }\n}'
          }
        }
      }
    },
    chat_23310: {
      maxTokens: 32768,
      tokenizerType: "QWEN2",
      quotaInfo: {
        remainingFraction: 1
      },
      model: "MODEL_CHAT_23310",
      apiProvider: "API_PROVIDER_INTERNAL",
      modelProvider: "MODEL_PROVIDER_GOOGLE",
      supportsCumulativeContext: true,
      supportsEstimateTokenCounter: true,
      isInternal: true,
      promptTemplaterType: "PROMPT_TEMPLATER_TYPE_CHATML",
      toolFormatterType: "TOOL_FORMATTER_TYPE_XML",
      requiresLeadInGeneration: true
    },
    "gemini-pro-agent": {
      displayName: "Gemini 3.1 Pro (High)",
      supportsImages: true,
      supportsThinking: true,
      thinkingBudget: 10001,
      minThinkingBudget: 128,
      recommended: true,
      maxTokens: 1048576,
      maxOutputTokens: 65535,
      tokenizerType: "LLAMA_WITH_SPECIAL",
      quotaInfo: {
        remainingFraction: 1,
        resetTime: "2026-06-24T06:22:06Z"
      },
      model: "MODEL_PLACEHOLDER_M16",
      apiProvider: "API_PROVIDER_GOOGLE_GEMINI",
      modelProvider: "MODEL_PROVIDER_GOOGLE",
      supportsVideo: true,
      supportedMimeTypes: {
        "image/png": true,
        "image/heic": true,
        "video/audio/wav": true,
        "text/xml": true,
        "application/json": true,
        "video/jpeg2000": true,
        "text/html": true,
        "application/x-javascript": true,
        "text/plain": true,
        "video/text/timestamp": true,
        "application/x-ipynb+json": true,
        "text/javascript": true,
        "application/x-python-code": true,
        "video/videoframe/jpeg2000": true,
        "audio/webm;codecs=opus": true,
        "image/jpeg": true,
        "text/markdown": true,
        "video/webm": true,
        "text/x-python-script": true,
        "video/mp4": true,
        "text/x-typescript": true,
        "text/x-python": true,
        "text/css": true,
        "video/audio/s16le": true,
        "application/x-typescript": true,
        "application/pdf": true,
        "text/csv": true,
        "image/webp": true,
        "image/heif": true,
        "application/rtf": true,
        "text/rtf": true
      },
      modelExperiments: {
        experiments: {
          template__system_prompts__planning_mode_artifacts: {
            stringValue: "When in planning mode, you will work with three special artifacts.\n\n# Tasks\nPath: {{ArtifactDirectoryPath}}/task.md\n\n**Purpose**: A TODO list to organize your work during execution. Create this artifact after receiving user approval on your implementation plan. Break down complex tasks into component-level items and track progress as a living document.\n\n**Format**:\n```markdown\n- `[ ]` uncompleted tasks\n- `[/]` in progress tasks (custom notation)\n- `[x]` completed tasks\n- Use indented lists for sub-items\n```\n\n**Updating task.md**: Mark items as `[/]` when starting work on them, and `[x]` when completed. Update task.md as you make progress through your checklist.\n\n# Implementation Plan\nPath: {{ArtifactDirectoryPath}}/implementation_plan.md\n\n**Purpose**: A detailed design document to present your technical implementation plan to the user for feedback and approval.\nAfter reading the document, the user should understand the key technical details of your plan, and be able to make an informed decision on whether to approve it.\n\n**Format**: Use the following format, omitting any irrelevant sections.\n```markdown\n# [Goal Description]\n\nProvide a brief description of the problem, any background context, and what the change accomplishes.\n\n## User Review Required\n\nDocument anything that requires user review or feedback, for example, breaking changes or significant design decisions. Use GitHub alerts (IMPORTANT/WARNING/CAUTION) to highlight critical items.\n\n## Open Questions\n\nAny clarifying or design questions for the user that will impact the implementation plan. Use GitHub alerts (IMPORTANT/WARNING/CAUTION) to highlight critical items.\n\n## Proposed Changes\n\nGroup files by component (e.g., package, feature area, dependency layer) and order logically (dependencies first). Separate components with horizontal rules for visual clarity.\n\n### [Component Name]\n\nSummary of what will change in this component, separated by files. For specific files, Use [NEW] and [DELETE] to demarcate new and deleted files, for example:\n\n#### [MODIFY] [file basename](file:///absolute/path/to/modifiedfile)\n#### [NEW] [file basename](file:///absolute/path/to/newfile)\n#### [DELETE] [file basename](file:///absolute/path/to/deletedfile)\n\n## Verification Plan\n\nSummary of how you will verify that your changes have the desired effects.\n\n### Automated Tests\n- The commands of any automated tests you'll run.\n\n### Manual Verification\n- Asking the user to deploy to staging and testing, verifying UI changes on an iOS app etc.\n```\n\n# Walkthrough\nPath: {{ArtifactDirectoryPath}}/walkthrough.md\n\n**Purpose**: After completing work, summarize what you accomplished. Update an existing walkthrough for related follow-up work rather than creating a new one.\n\n**Document**:\n- Changes made\n- What was tested\n- Validation results\n\nEmbed screenshots and recordings to visually demonstrate UI changes and user flows.\n"
          },
          CASCADE_USE_EXPERIMENT_CHECKPOINTER: {
            stringValue: '{\n    "strategy": "CHECKPOINT_STRATEGY_SINGLE_PROMPT",\n    "max_token_limit": "128000",\n    "token_threshold": "50000",\n    "max_overhead_ratio": "0.15",\n    "moving_window_size": "1",\n    "enabled": true,\n    "max_output_tokens": "16384",\n    "checkpoint_model": "MODEL_PLACEHOLDER_M50",\n    "use_last_planner_model": false,\n    "is_sync": false,\n    "max_user_requests": 10,\n    "include_last_user_message": false,\n    "include_conversation_log": true,\n    "include_running_task_snapshots": true,\n    "include_subagent_snapshots": true,\n    "include_artifact_snapshots": true,\n    "retry_config": {\n        "max_retries": 0,\n        "initial_sleep_duration_ms": 1000,\n        "exponential_multiplier": 2,\n        "include_error_feedback": false\n    }\n}'
          },
          "cascade-include-ephemeral-message": {
            stringValue: '{\n    "enabled": true,\n    "disabledHeuristics": ["running_tasks_reminder"],\n    "staticMessages": [],\n    "useAllowlist": false,\n    "enabledHeuristics": []\n}'
          },
          template__system_prompts__communication_style: {
            stringValue: "- Keep your responses concise.\n- Provide a summary of your work when you end your turn.\n- Format your responses in github-style markdown.\n- If you're unsure about the user's intent, ask for clarification rather than making assumptions.\n- You MUST create clickable links for all files and code symbols (classes, types, functions, structs). Use github style markdown links with the `file://` scheme (e.g., [filename](file:///path/to/file) or [ClassName](file:///path/to/file#L10-L20)`). For Windows, use forward slashes for paths.\n\nCRITICAL INSTRUCTION 1: You may have access to a variety of tools at your disposal. Some tools may be for a specific task such as 'view_file' (for viewing contents of a file). Others may be very broadly applicable such as the ability to run a command on a terminal. Always prioritize using the most specific tool you can for the task at hand. Here are some rules: (a) NEVER run cat inside a bash command to create a new file or append to an existing file. (b) ALWAYS use grep_search instead of running grep inside a bash command unless absolutely needed. (c) DO NOT use ls for listing, cat for viewing, grep for finding, sed for replacing.\nCRITICAL INSTRUCTION 2: Before making tool calls T, think and explicitly list out any related tools for the task at hand. You can only execute a set of tools T if all other tools in the list are either more generic or cannot be used for the task at hand. ALWAYS START your thought with recalling critical instructions 1 and 2. In particular, the format for the start of your thought block must be '...94>thought\\nCRITICAL INSTRUCTION 1: ...\\nCRITICAL INSTRUCTION 2: ...'."
          },
          template__system_prompts__identity: {
            stringValue: "You are Antigravity, a powerful agentic AI coding assistant designed by the Google DeepMind team working on Advanced Agentic Coding.\nYou are pair programming with a USER to solve their coding task. The task may require creating a new codebase, modifying or debugging an existing codebase, or simply answering a question.\nThe USER will send you requests, which you must always prioritize addressing. User requests are enclosed within <USER_REQUEST> tags. Along with each USER request, we will attach additional metadata about their current state, such as what files they have open and where their cursor is.\nThis information may or may not be relevant to the coding task, it is up for you to decide."
          }
        }
      }
    }
  },
  defaultAgentModelId: "gemini-3.5-flash-low",
  agentModelSorts: [
    {
      displayName: "Recommended",
      groups: [
        {
          modelIds: [
            "gemini-3.5-flash-low",
            "gemini-3-flash-agent",
            "gemini-3.5-flash-extra-low",
            "gemini-3.1-pro-low",
            "gemini-pro-agent",
            "claude-sonnet-4-6",
            "claude-opus-4-6-thinking",
            "gpt-oss-120b-medium"
          ]
        }
      ]
    }
  ],
  commandModelIds: [
    "gemini-3-flash"
  ],
  tabModelIds: [
    "chat_20706",
    "chat_23310"
  ],
  imageGenerationModelIds: [
    "gemini-3.1-flash-image"
  ],
  mqueryModelIds: [
    "gemini-3.1-flash-lite"
  ],
  webSearchModelIds: [
    "gemini-3.1-flash-lite"
  ],
  deprecatedModelIds: {
    "gemini-3.1-pro-high": {
      newModelId: "gemini-pro-agent",
      oldModelEnum: "MODEL_PLACEHOLDER_M37",
      newModelEnum: "MODEL_PLACEHOLDER_M16"
    }
  },
  commitMessageModelIds: [
    "gemini-3.1-flash-lite"
  ],
  audioTranscriptionModelIds: [
    "models/proactive-observer"
  ],
  experimentIds: [
    106101246,
    106329230,
    106366579,
    105979552,
    105979574,
    106015333,
    105979579,
    105867471,
    106123599,
    106076629,
    106121401,
    106100625,
    106143956,
    105879567,
    105856899,
    106312323,
    106064030,
    105757908,
    106240758,
    106106760,
    106021688,
    106014288,
    105887299,
    106283618,
    106278607,
    106380926,
    106212376,
    106309520,
    106281951,
    106264532,
    106222835,
    106044947,
    106032303,
    106228452,
    106121607,
    105979531,
    105979553,
    106015328,
    105867469,
    106123597,
    106121399,
    106100654,
    106064028,
    106240748,
    106283614,
    106038164,
    106032301,
    106121604
  ],
  tieredModelIds: {
    flashLite: [
      "gemini-3.1-flash-lite"
    ],
    flash: [
      "gemini-3-flash-agent"
    ],
    pro: [
      "gemini-3.1-pro-low"
    ]
  }
};

// src/antigravity/cloud-code-gateway.ts
var HELPER_ROUTE_POLICIES = /* @__PURE__ */ new Map([
  ["gemini-2.5-flash", "launch-or-active"],
  ["gemini-2.5-flash-lite", "launch"],
  ["gemini-3-flash-agent", "launch"],
  ["gemini-3.1-flash-lite", "launch"]
]);
var MAX_REASONING_ECHOES_PER_CONVERSATION = 20;
function isUserTurnRequest(parsed) {
  return typeof parsed?.requestId === "string" && parsed.requestId.startsWith("agent/");
}
async function startCloudCodeGateway(routes, opts = {}) {
  silenceSdkWarnings();
  const templateKey = opts.templateKey ?? "gemini-3.5-flash-low";
  const trace = opts.trace ?? false;
  const trackActiveRoute = opts.trackActiveRoute ?? false;
  const log18 = opts.logFn ?? (() => {
  });
  const catalogFixture = fetchAvailableModels_default;
  const injectedCatalog = injectRelayModels(catalogFixture, routes, templateKey);
  const selectedSlotRoutes = resolveRelayCatalogSlots(injectedCatalog, routes, templateKey);
  const selectedSlotIds = /* @__PURE__ */ new Set();
  const routeMap = /* @__PURE__ */ new Map();
  const reasoningEchoesByConversation = /* @__PURE__ */ new Map();
  for (const { slotId, route } of selectedSlotRoutes) {
    selectedSlotIds.add(slotId);
    routeMap.set(slotId, route);
    routeMap.set(route.catalogId, route);
  }
  let activeRoute;
  const launchRoute = selectedSlotRoutes[0]?.route ?? routes[0];
  const resolveRouteForModel = (model) => {
    if (!model) return void 0;
    const directRoute = routeMap.get(model);
    if (directRoute) return directRoute;
    const helperPolicy = HELPER_ROUTE_POLICIES.get(model);
    if (!helperPolicy || !launchRoute) return void 0;
    if (helperPolicy === "launch-or-active" && trackActiveRoute && activeRoute) {
      return activeRoute;
    }
    return launchRoute;
  };
  const providerOptionsCache = /* @__PURE__ */ new Map();
  for (const route of routes) {
    providerOptionsCache.set(route.catalogId, effortProviderOptions(route.npm, "high", route.upstreamModelId));
  }
  const experimentsResponse = buildListExperimentsResponse();
  const modelConfigsResponse = buildListModelConfigsResponse(routes, injectedCatalog, templateKey);
  const userSettings = {
    telemetryEnabled: false,
    userDataCollectionForceDisabled: true,
    marketingEmailsEnabled: false
  };
  const server = http.createServer((req, res) => {
    readBody(req).then((bodyStr) => {
      const url = req.url || "";
      const method = req.method || "GET";
      const contentType = (req.headers["content-type"] ?? "").toLowerCase();
      const lowerUrl = url.toLowerCase();
      if (trace) {
        log18(`[gateway] ${method} ${url}`);
        log18(`[gateway]   content-type: ${contentType}`);
        log18(`[gateway]   body-size: ${bodyStr.length}`);
      }
      if (contentType.includes("proto") || contentType.includes("grpc") && !contentType.includes("json")) {
        log18(`[gateway] UNSUPPORTED content-type: ${contentType}`);
        respondJson(res, 415, {
          error: {
            code: 415,
            message: `Gateway only supports JSON. Received: ${contentType}`
          }
        });
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(bodyStr);
      } catch {
      }
      if (trace && parsed) {
        const preview = JSON.stringify(parsed).slice(0, 500);
        log18(`[gateway]   body-preview: ${preview}`);
      }
      if (lowerUrl.includes("loadcodeassist")) {
        if (trace) log18("[gateway] \u2192 loadCodeAssist");
        respondJson(res, 200, loadCodeAssist_default);
        return;
      }
      if (lowerUrl.includes("fetchavailablemodels") || lowerUrl.includes("getavailablemodels")) {
        if (trace) log18("[gateway] \u2192 fetchAvailableModels");
        respondJson(res, 200, injectedCatalog);
        return;
      }
      if (lowerUrl.includes("modelconfigs")) {
        if (trace) log18("[gateway] \u2192 listModelConfigs");
        respondJson(res, 200, modelConfigsResponse);
        return;
      }
      if (lowerUrl.includes("generatecontent") || lowerUrl.includes("generatechat")) {
        const model = parsed?.model;
        if (trace) log18(`[gateway]   extracted model: ${model ?? "N/A"}`);
        const route = resolveRouteForModel(model);
        if (route) {
          if (trackActiveRoute && selectedSlotIds.has(model ?? "") && isUserTurnRequest(parsed)) {
            activeRoute = route;
            if (trace) log18(`[gateway]   active route: ${route.catalogId} via ${model}`);
          }
          const providerOptions = providerOptionsCache.get(route.catalogId);
          const isStream = lowerUrl.includes("stream");
          const conversationKey = conversationKeyFromRequest(parsed);
          const requestOptions = reasoningEchoOptionsForRoute(route, parsed, reasoningEchoesByConversation);
          const rememberReasoning = (reasoning) => {
            if (!shouldEchoReasoningForRoute(route)) return;
            rememberReasoningEcho(reasoningEchoesByConversation, conversationKey, reasoning);
          };
          if (isStream) {
            handleStreamingRequest(res, route, providerOptions, parsed, log18, {
              requestOptions,
              onReasoningWithToolCall: rememberReasoning
            }).catch((err) => {
              log18(`[gateway] stream error: ${err instanceof Error ? err.stack || err.message : String(err)}`);
              if (!res.headersSent) {
                respondJson(res, 500, { error: { code: 500, message: formatUpstreamError(err) } });
              } else if (!res.writableEnded) {
                res.end();
              }
            });
          } else {
            handleUnaryRequest(res, route, providerOptions, parsed, log18, {
              requestOptions,
              onReasoningWithToolCall: rememberReasoning
            }).catch((err) => {
              log18(`[gateway] unary error: ${err instanceof Error ? err.stack || err.message : String(err)}`);
              if (!res.headersSent) {
                respondJson(res, 500, { error: { code: 500, message: formatUpstreamError(err) } });
              }
            });
          }
          return;
        }
        respondJson(res, 403, {
          error: {
            code: 403,
            message: `Non-Relay model "${model ?? "unknown"}" rejected in privacy mode`
          }
        });
        return;
      }
      if (lowerUrl.includes("fetchadmincontrols")) {
        respondJson(res, 200, {});
        return;
      }
      if (lowerUrl.includes("userquota")) {
        respondJson(res, 200, { quotaSummary: { remainingQueries: 9999, totalQueries: 9999, quotaType: "RELAY_UNLIMITED" } });
        return;
      }
      if (lowerUrl.includes("userinfo")) {
        respondJson(res, 200, {
          userSettings,
          regionCode: "US"
        });
        return;
      }
      if (lowerUrl.includes("usersettings")) {
        respondJson(res, 200, { userSettings });
        return;
      }
      if (lowerUrl.includes("experiments") || lowerUrl.includes("experimentstatus")) {
        respondJson(res, 200, experimentsResponse);
        return;
      }
      if (lowerUrl.includes("onboarduser")) {
        respondJson(res, 200, {
          name: "operations/cmpf.DONE_OPERATION",
          done: true,
          response: {
            "@type": "type.googleapis.com/google.internal.cloud.code.v1internal.OnboardUserResponse",
            cloudaicompanionProject: {
              id: "relay-ai-local-project",
              name: "relay-ai-local-project",
              projectNumber: "0"
            },
            status: {
              statusCode: "NOTICE",
              displayMessage: "You've successfully connected your Google Account and can now get started with Gemini Code Assist",
              messageTitle: "Welcome to Gemini Code Assist"
            }
          }
        });
        return;
      }
      if (lowerUrl.includes("record") || lowerUrl.includes("feedback") || lowerUrl.includes("metrics")) {
        respondJson(res, 200, {});
        return;
      }
      if (lowerUrl.includes("snippet")) {
        respondJson(res, 200, { snippets: [] });
        return;
      }
      if (lowerUrl.includes("cascadenux") || lowerUrl.includes("listcascade")) {
        respondJson(res, 200, { cascadeNuxes: [] });
        return;
      }
      if (lowerUrl.includes("denylist") || lowerUrl.includes("checkurl")) {
        respondJson(res, 200, { denied: false });
        return;
      }
      if (lowerUrl.includes("plugin")) {
        respondJson(res, 200, { plugins: [] });
        return;
      }
      if (lowerUrl.includes("counttokens")) {
        respondJson(res, 200, { tokenCount: 0, totalTokens: 0 });
        return;
      }
      if (lowerUrl.includes("listremote") || lowerUrl.includes("listcloudai") || lowerUrl.includes("companionproject")) {
        respondJson(res, 200, { projects: [] });
        return;
      }
      if (lowerUrl.includes("migrate")) {
        respondJson(res, 200, {});
        return;
      }
      if (url === "/" || lowerUrl.includes("health")) {
        respondJson(res, 200, { status: "ok" });
        return;
      }
      if (trace) {
        log18(`[gateway] unknown endpoint: ${url}`);
      }
      respondJson(res, 200, {});
    }).catch((err) => {
      respondJson(res, 400, { error: { code: 400, message: `Failed to read request: ${err instanceof Error ? err.message : String(err)}` } });
    });
  });
  return new Promise((resolve, reject2) => {
    server.on("error", reject2);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        resolve({
          port,
          url: `http://127.0.0.1:${port}`,
          close: () => new Promise((res, rej) => {
            server.close((err) => {
              const code = err?.code;
              if (err && code !== "ERR_SERVER_NOT_RUNNING") {
                rej(err);
              } else {
                res();
              }
            });
          })
        });
      } else {
        reject2(new Error("Failed to get server address"));
      }
    });
  });
}
function reasoningDeltaText(part) {
  return String(part.text ?? part.textDelta ?? part.delta ?? "");
}
function reasoningOutputText(reasoning) {
  if (typeof reasoning === "string") return reasoning;
  if (Array.isArray(reasoning)) {
    return reasoning.map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && "text" in item) {
        return String(item.text ?? "");
      }
      return "";
    }).filter(Boolean).join("");
  }
  if (reasoning && typeof reasoning === "object" && "text" in reasoning) {
    return String(reasoning.text ?? "");
  }
  return "";
}
function conversationKeyFromRequest(parsed) {
  const requestId = typeof parsed?.requestId === "string" ? parsed.requestId : "";
  const segments = requestId.split("/");
  if (segments.length >= 2 && segments[0] && segments[1]) {
    return `${segments[0]}/${segments[1]}`;
  }
  return "global";
}
function shouldEchoReasoningForRoute(route) {
  if (route.npm !== "@ai-sdk/openai-compatible") return false;
  const routeIdentity = [
    route.providerId,
    route.providerName,
    route.catalogId,
    route.modelId,
    route.upstreamModelId,
    route.displayName,
    route.baseURL
  ].join(" ");
  return /deepseek/i.test(routeIdentity);
}
function reasoningEchoOptionsForRoute(route, parsed, cache) {
  if (!shouldEchoReasoningForRoute(route)) return {};
  const existing = cache.get(conversationKeyFromRequest(parsed));
  return existing?.length ? { fallbackAssistantReasoning: existing } : {};
}
function rememberReasoningEcho(cache, key, reasoning) {
  const normalized = reasoning.trim();
  if (!normalized) return;
  const existing = cache.get(key) ?? [];
  existing.push(normalized);
  cache.set(key, existing.slice(-MAX_REASONING_ECHOES_PER_CONVERSATION));
}
function emitThinkingDelta(res, route, responseId, text5, startSse) {
  if (!text5) return;
  startSse();
  const chunk = formatCloudCodeChunk({
    thought: text5,
    modelVersion: route.catalogId,
    responseId
  });
  res.write(`data: ${JSON.stringify(chunk)}

`);
}
function emitStreamError(res, route, responseId, message, startSse) {
  startSse();
  const chunk = formatCloudCodeChunk({
    text: `

\u26A0 ${message}
`,
    modelVersion: route.catalogId,
    responseId,
    finishReason: "OTHER"
  });
  res.write(`data: ${JSON.stringify(chunk)}

`);
}
function respondJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": String(Buffer.byteLength(body)),
    "grpc-status": status < 400 ? "0" : "13"
  });
  res.end(body);
}
async function handleStreamingRequest(res, route, providerOptions, parsed, log18, options = {}) {
  const sdkParams = translateRequest(parsed, options.requestOptions);
  const langModel = await createLanguageModel({
    npm: route.npm,
    modelId: route.upstreamModelId,
    apiKey: route.apiKey,
    baseURL: route.baseURL,
    providerId: route.providerId,
    authType: route.authType,
    oauthAccountId: route.oauthAccountId
  });
  const responseId = `relay-${Date.now()}`;
  const { fullStream } = streamText5({
    model: langModel,
    system: sdkParams.system,
    messages: sdkParams.messages,
    tools: sdkParams.tools,
    toolChoice: sdkParams.toolChoice,
    providerOptions
  });
  const startSse = () => {
    if (res.headersSent) return;
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "grpc-status": "0"
    });
  };
  const toolCallBuffers = /* @__PURE__ */ new Map();
  let responseReasoning = "";
  let sawToolCall = false;
  for await (const part of fullStream) {
    const p20 = part;
    if (p20.type === "reasoning-delta" || p20.type === "reasoning") {
      const reasoning = reasoningDeltaText(p20);
      responseReasoning += reasoning;
      emitThinkingDelta(res, route, responseId, reasoning, startSse);
      continue;
    }
    if (p20.type === "text-delta") {
      const text5 = reasoningDeltaText(p20);
      log18(`[gateway] text-delta: ${JSON.stringify(text5.slice(0, 500))}`);
      startSse();
      const chunk = formatCloudCodeChunk({
        text: text5,
        modelVersion: route.catalogId,
        responseId
      });
      res.write(`data: ${JSON.stringify(chunk)}

`);
    } else if (p20.type === "tool-input-start") {
      const id = p20.id ?? p20.toolCallId;
      toolCallBuffers.set(id, { name: p20.toolName, json: "" });
    } else if (p20.type === "tool-input-delta") {
      const id = p20.id ?? p20.toolCallId;
      const buf = toolCallBuffers.get(id);
      if (buf) buf.json += p20.delta;
    } else if (p20.type === "tool-call") {
      sawToolCall = true;
      const id = p20.toolCallId ?? p20.id;
      const buf = toolCallBuffers.get(id);
      let args = {};
      try {
        args = buf ? JSON.parse(buf.json || "{}") : p20.input || {};
      } catch {
        args = p20.input || {};
      }
      const name = buf ? buf.name : p20.toolName;
      log18(`[gateway] tool-call: ${name}`);
      startSse();
      const chunk = formatCloudCodeChunk({
        functionCall: { name, args },
        modelVersion: route.catalogId,
        responseId
      });
      res.write(`data: ${JSON.stringify(chunk)}

`);
    } else if (p20.type === "finish") {
      log18(`[gateway] finish: ${p20.finishReason ?? "unknown"}`);
      startSse();
      const reason = mapFinishReason2(p20.finishReason ?? "");
      const chunk = formatCloudCodeChunk({
        modelVersion: route.catalogId,
        responseId,
        finishReason: reason,
        usage: {
          promptTokens: p20.totalUsage?.inputTokens || 0,
          completionTokens: p20.totalUsage?.outputTokens || 0
        }
      });
      res.write(`data: ${JSON.stringify(chunk)}

`);
    } else if (p20.type === "error") {
      const message = formatUpstreamError(p20.error);
      log18(`[gateway] stream provider error: ${message}`);
      emitStreamError(res, route, responseId, message, startSse);
      break;
    } else if (p20.type === "reasoning-start" || p20.type === "reasoning-end") {
      log18(`[gateway] ${p20.type}`);
    }
  }
  if (!res.headersSent) {
    throw new Error("Provider returned an empty stream");
  }
  if (sawToolCall && responseReasoning.trim()) {
    options.onReasoningWithToolCall?.(responseReasoning);
  }
  res.end();
}
async function handleUnaryRequest(res, route, providerOptions, parsed, _log, options = {}) {
  const sdkParams = translateRequest(parsed, options.requestOptions);
  const langModel = await createLanguageModel({
    npm: route.npm,
    modelId: route.upstreamModelId,
    apiKey: route.apiKey,
    baseURL: route.baseURL,
    providerId: route.providerId,
    authType: route.authType,
    oauthAccountId: route.oauthAccountId
  });
  const responseId = `relay-${Date.now()}`;
  const result = await generateText5({
    model: langModel,
    system: sdkParams.system,
    messages: sdkParams.messages,
    tools: sdkParams.tools,
    toolChoice: sdkParams.toolChoice,
    providerOptions
  });
  const parts = [];
  const reasoning = reasoningOutputText(result.reasoning);
  if (reasoning) {
    parts.push({ text: reasoning, thought: true });
  }
  if (result.text) {
    parts.push({ text: result.text });
  }
  if (result.toolCalls?.length) {
    for (const tc of result.toolCalls) {
      parts.push({
        functionCall: { name: tc.toolName, args: tc.args }
      });
    }
  }
  if (reasoning && result.toolCalls?.length) {
    options.onReasoningWithToolCall?.(reasoning);
  }
  if (parts.length === 0) {
    parts.push({ text: "" });
  }
  const response = {
    candidates: [{
      content: { role: "model", parts },
      finishReason: mapFinishReason2(result.finishReason ?? "")
    }],
    usageMetadata: {
      promptTokenCount: result.usage?.inputTokens || 0,
      candidatesTokenCount: result.usage?.outputTokens || 0,
      totalTokenCount: (result.usage?.inputTokens || 0) + (result.usage?.outputTokens || 0)
    },
    modelVersion: route.catalogId,
    responseId
  };
  respondJson(res, 200, { response, traceId: "relay-trace", metadata: {} });
}

// src/antigravity/launch-routes.ts
async function resolveAntigravityLaunchRoutes(opts) {
  const maxRoutes = opts.maxRoutes ?? MAX_MODEL_CATALOG;
  const apiKey = await resolveLocalProviderApiKey(opts.provider);
  if (!apiKey) return null;
  const droppedFavorites = [];
  const capacitySkippedFavorites = [];
  const seen = /* @__PURE__ */ new Set([`${opts.provider.id}::${opts.model.id}`]);
  const resolved = [{
    providerId: opts.provider.id,
    providerName: opts.provider.name,
    model: opts.model,
    apiKey,
    authType: opts.provider.authType,
    oauthAccountId: opts.provider.oauthAccountId
  }];
  for (const favorite of opts.favorites ?? []) {
    const key = `${favorite.providerId}::${favorite.modelId}`;
    if (seen.has(key)) continue;
    if (resolved.length >= maxRoutes) {
      capacitySkippedFavorites.push(favorite);
      continue;
    }
    const favoriteProvider = opts.allProviders.find((provider) => provider.id === favorite.providerId);
    const favoriteModel = favoriteProvider?.models.find((model) => model.id === favorite.modelId);
    if (!favoriteProvider || !favoriteModel || shouldHideModel({
      providerId: favorite.providerId,
      modelId: favorite.modelId,
      agent: "antigravity"
    })) {
      droppedFavorites.push(favorite);
      continue;
    }
    const favoriteApiKey = await resolveLocalProviderApiKey(favoriteProvider);
    if (!favoriteApiKey) {
      droppedFavorites.push(favorite);
      continue;
    }
    seen.add(key);
    resolved.push({
      providerId: favoriteProvider.id,
      providerName: favoriteProvider.name,
      model: favoriteModel,
      apiKey: favoriteApiKey,
      authType: favoriteProvider.authType,
      oauthAccountId: favoriteProvider.oauthAccountId
    });
  }
  return {
    routes: buildAntigravityRoutes(resolved, maxRoutes),
    apiKey,
    droppedFavorites,
    capacitySkippedFavorites
  };
}

// src/antigravity/launch-cli.ts
import { execFileSync, execSync as execSync3, spawn as spawn3 } from "child_process";
import { existsSync as existsSync6 } from "fs";
import { homedir as homedir6 } from "os";
import { join as join6 } from "path";
var isWindows3 = process.platform === "win32";
var FALLBACK_PATHS = isWindows3 ? [
  join6(process.env["APPDATA"] ?? homedir6(), "npm", "agy.cmd"),
  join6(process.env["APPDATA"] ?? homedir6(), "npm", "agy"),
  join6(homedir6(), "AppData", "Roaming", "npm", "agy.cmd")
] : [
  join6(homedir6(), ".local", "bin", "agy"),
  join6(homedir6(), ".npm", "bin", "agy"),
  "/usr/local/bin/agy",
  "/opt/homebrew/bin/agy"
];
function findAntigravityCliBinary() {
  try {
    const result = execSync3(isWindows3 ? "where.exe agy" : "which agy", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"]
    });
    const path2 = result.trim().split("\n")[0]?.trim();
    if (path2) return path2;
  } catch {
  }
  for (const path2 of FALLBACK_PATHS) {
    if (existsSync6(path2)) return path2;
  }
  return null;
}
function readAntigravityCliVersion(binaryPath = findAntigravityCliBinary() ?? void 0) {
  if (!binaryPath) {
    return { version: null, error: 'Antigravity CLI binary "agy" not found' };
  }
  try {
    const raw = execFileSync(binaryPath, ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
    const version = raw.match(/\d+\.\d+\.\d+/)?.[0] ?? null;
    return version ? { version, raw } : { version: null, raw, error: `Unexpected agy --version output: ${raw}` };
  } catch (err) {
    return {
      version: null,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
function launchAntigravityCli(env, extraArgs) {
  return new Promise((resolve) => {
    const binaryPath = findAntigravityCliBinary();
    if (!binaryPath) {
      console.error('Antigravity CLI binary "agy" not found.');
      resolve(127);
      return;
    }
    const child = spawn3(binaryPath, extraArgs, {
      stdio: "inherit",
      env,
      shell: isWindows3
    });
    const forward = (signal) => {
      child.kill(signal);
    };
    const handleSIGINT = () => forward("SIGINT");
    const handleSIGTERM = () => forward("SIGTERM");
    const cleanup = () => {
      process.removeListener("SIGINT", handleSIGINT);
      process.removeListener("SIGTERM", handleSIGTERM);
    };
    process.once("SIGINT", handleSIGINT);
    process.once("SIGTERM", handleSIGTERM);
    child.on("exit", (code) => {
      cleanup();
      resolve(code ?? 1);
    });
    child.on("error", (err) => {
      cleanup();
      console.error(`Failed to launch Antigravity CLI: ${err.message}`);
      resolve(1);
    });
  });
}

// src/antigravity/launch-ide.ts
import { execFileSync as execFileSync2, spawn as spawn4 } from "child_process";
import { existsSync as existsSync7 } from "fs";
import { homedir as homedir7 } from "os";
import { join as join7 } from "path";

// src/antigravity/ide-profile.ts
import fs from "fs";
import path from "path";
function readIdeSettings(settingsPath) {
  if (!fs.existsSync(settingsPath)) return {};
  try {
    const raw = fs.readFileSync(settingsPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
function writeIdeSettings(settingsPath, settings) {
  const tempPath = `${settingsPath}.tmp-${Date.now()}`;
  fs.writeFileSync(tempPath, JSON.stringify(settings, null, 2), "utf8");
  fs.renameSync(tempPath, settingsPath);
}
function prepareIdeProfile(profileDir, gatewayUrl) {
  fs.mkdirSync(profileDir, { recursive: true, mode: 448 });
  const userDir = path.join(profileDir, "User");
  fs.mkdirSync(userDir, { recursive: true });
  const settingsPath = path.join(userDir, "settings.json");
  const settings = readIdeSettings(settingsPath);
  settings["jetski.cloudCodeUrl"] = gatewayUrl;
  settings["telemetry.telemetryLevel"] = "off";
  settings["telemetry.enableTelemetry"] = false;
  settings["telemetry.enableCrashReporter"] = false;
  writeIdeSettings(settingsPath, settings);
  return profileDir;
}

// src/antigravity/launch-ide.ts
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function defaultProcessList() {
  if (process.platform !== "darwin") return "";
  return execFileSync2("ps", ["-axo", "pid=,command="], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 1024 * 1024 * 4
  });
}
function isAntigravityIdeRunning(profileDir, processList = defaultProcessList) {
  const output = processList();
  return output.split("\n").some((line) => line.includes("Antigravity IDE.app") && line.includes(`--user-data-dir=${profileDir}`));
}
async function waitForAntigravityIdeQuit(profileDir, options = {}) {
  const processList = options.processList ?? defaultProcessList;
  const deadline = Date.now() + (options.timeoutMs ?? 5e3);
  const pollIntervalMs = options.pollIntervalMs ?? 200;
  while (Date.now() < deadline) {
    if (!isAntigravityIdeRunning(profileDir, processList)) return true;
    await sleep(pollIntervalMs);
  }
  return !isAntigravityIdeRunning(profileDir, processList);
}
function quitAntigravityIdeGracefully() {
  if (process.platform !== "darwin") return;
  try {
    execFileSync2("osascript", ["-e", 'tell application "Antigravity IDE" to quit'], {
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch {
    execFileSync2("osascript", ["-e", 'tell application id "com.google.antigravity-ide" to quit'], {
      stdio: ["ignore", "pipe", "pipe"]
    });
  }
}
function findAntigravityIdeBinary() {
  if (process.platform !== "darwin") return null;
  const defaultPath = "/Applications/Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide";
  if (existsSync7(defaultPath)) return defaultPath;
  const homePath = join7(homedir7(), "Applications", "Antigravity IDE.app", "Contents", "Resources", "app", "bin", "antigravity-ide");
  if (existsSync7(homePath)) return homePath;
  return null;
}
function launchAntigravityIde(env, profileDir, gatewayUrl, extraArgs) {
  return new Promise((resolve) => {
    const binaryPath = findAntigravityIdeBinary();
    if (!binaryPath) {
      console.error('Antigravity IDE app bundle not found at "/Applications/Antigravity IDE.app".');
      console.error("Please make sure Antigravity IDE is installed on your Mac.");
      resolve(127);
      return;
    }
    prepareIdeProfile(profileDir, gatewayUrl);
    const relayExtensionsDir = join7(homedir7(), ".relay-ai", "antigravity", "extensions");
    const args = [
      `--user-data-dir=${profileDir}`,
      `--extensions-dir=${relayExtensionsDir}`,
      ...extraArgs
    ];
    const child = spawn4(binaryPath, args, {
      stdio: "inherit",
      env
    });
    child.on("exit", (code) => {
      resolve(code ?? 1);
    });
    child.on("error", (err) => {
      console.error(`Failed to launch Antigravity IDE: ${err.message}`);
      resolve(1);
    });
  });
}

// src/antigravity.ts
import { homedir as homedir8 } from "os";
import { join as join8 } from "path";
var AGY_FAVORITES_PROVIDER_ID = "__relay_agy_favorites__";
var AGY_FAVORITES_PROVIDER_LABEL = "\u2605 Antigravity CLI Favorites";
function agyArgsIncludeModelFlag(args) {
  return args.some((arg) => arg === "--model" || arg.startsWith("--model="));
}
function buildAgyLaunchArgs(modelLabel, childArgs) {
  if (agyArgsIncludeModelFlag(childArgs)) return childArgs;
  return ["--model", modelLabel, ...childArgs];
}
function agyArgsAreNonInteractive(args) {
  return args.some((arg) => arg === "-p" || arg === "--prompt" || arg.startsWith("--prompt="));
}
function formatAgyCapacityWarning(validatedSlotCount, skippedFavoriteCount) {
  const slotWord = validatedSlotCount === 1 ? "slot" : "slots";
  const favoritePhrase = skippedFavoriteCount === 1 ? "1 favorite was not exposed" : `${skippedFavoriteCount} favorites were not exposed`;
  return `AGY can switch among ${validatedSlotCount} validated model ${slotWord}; ${favoritePhrase}.`;
}
function isInteractiveTerminal() {
  return !!process.stdin.isTTY && !!process.stdout.isTTY;
}
function resolveFavoriteModel(favorite, allProviders) {
  const provider = allProviders.find((candidate) => candidate.id === favorite.providerId);
  const model = provider?.models.find((candidate) => candidate.id === favorite.modelId);
  return provider && model ? { provider, model } : null;
}
function normalizeAgyModelSelector(value) {
  return value.trim().replace(/\s*\(Relay(?: - .*)?\)\s*$/i, "").toLowerCase();
}
function resolveAntigravityBootModel(provider, modelSelector) {
  const selector = normalizeAgyModelSelector(modelSelector);
  const exact = provider.models.filter(
    (model) => normalizeAgyModelSelector(model.id) === selector || normalizeAgyModelSelector(model.name) === selector || normalizeAgyModelSelector(model.upstreamModelId) === selector
  );
  if (exact.length === 1) return { model: exact[0] };
  const prefix = provider.models.filter(
    (model) => normalizeAgyModelSelector(model.id).startsWith(selector) || normalizeAgyModelSelector(model.name).startsWith(selector) || normalizeAgyModelSelector(model.upstreamModelId).startsWith(selector)
  );
  if (prefix.length === 1) return { model: prefix[0] };
  const candidates = (exact.length > 1 ? exact : prefix).slice(0, 5);
  const candidateText = candidates.length > 0 ? ` Did you mean: ${candidates.map((model) => `${model.name || model.id} (${model.id})`).join(", ")}?` : "";
  return {
    model: null,
    error: exact.length > 1 || prefix.length > 1 ? `Model selector is ambiguous: ${modelSelector}.${candidateText}` : `Model not found: ${modelSelector} on provider ${provider.name}.${candidateText}`
  };
}
async function pickAntigravityCliFavoriteLaunchModel(favorites, allProviders) {
  const resolved = favorites.map((favorite) => resolveFavoriteModel(favorite, allProviders)).filter((entry) => entry !== null);
  if (resolved.length === 0) {
    p14.log.warn("No Antigravity CLI favorites are available.");
    p14.log.info(pc12.dim("Manage them with `relay-ai favorites --agy`."));
    return null;
  }
  const picked = await p14.select({
    message: "Launch from Antigravity CLI favorites",
    options: resolved.map(({ provider, model }) => ({
      value: `${provider.id}:${model.id}`,
      label: formatCodexModelLabel(model),
      hint: provider.name
    })),
    initialValue: `${resolved[0].provider.id}:${resolved[0].model.id}`
  });
  if (p14.isCancel(picked)) {
    p14.cancel("Cancelled.");
    return null;
  }
  const [providerId, ...modelParts] = picked.split(":");
  const modelId = modelParts.join(":");
  return resolved.find((entry) => entry.provider.id === providerId && entry.model.id === modelId) ?? null;
}
async function resolveAntigravityLaunch(prefs, boot) {
  let catalog;
  const catalogSpinner = p14.spinner();
  catalogSpinner.start("Loading providers...");
  try {
    catalog = await fetchProviderCatalog();
  } catch (err) {
    catalogSpinner.stop("");
    p14.log.error(String(err instanceof Error ? err.message : err));
    return null;
  }
  catalogSpinner.stop("");
  const allProviders = providersForPicker(catalog);
  if (allProviders.length === 0) {
    p14.log.warn("No providers available.");
    p14.log.info(pc12.dim("Run relay-ai providers add or import to get started."));
    return null;
  }
  if (boot?.launchProvider && boot?.launchModel) {
    const provider = allProviders.find((p20) => p20.id === boot.launchProvider);
    if (!provider) {
      p14.log.error(`Provider not found: ${boot.launchProvider}`);
      return null;
    }
    const { model, error } = resolveAntigravityBootModel(provider, boot.launchModel);
    if (!model) {
      p14.log.error(error ?? `Model not found: ${boot.launchModel} on provider ${provider.name}`);
      return null;
    }
    return { provider, model, allProviders };
  }
  const providerOptions = [
    {
      value: AGY_FAVORITES_PROVIDER_ID,
      label: pc12.cyan(AGY_FAVORITES_PROVIDER_LABEL),
      hint: `${prefs.antigravityCliFavoriteModels?.length ?? 0}/6 saved \xB7 manage with relay-ai favorites --agy`
    },
    ...allProviders.map((lp) => providerSelectOption(lp))
  ];
  const initialProvider = prefs.lastAntigravityProvider && providerOptions.some((o) => o.value === prefs.lastAntigravityProvider) ? prefs.lastAntigravityProvider : providerOptions[0].value;
  const conflicts = detectConflicts();
  let currentInitialProvider = initialProvider;
  while (true) {
    const chosen = await p14.select({
      message: "Which provider?",
      options: providerOptions,
      initialValue: currentInitialProvider
    });
    if (p14.isCancel(chosen)) {
      p14.cancel("Cancelled.");
      return null;
    }
    if (chosen === AGY_FAVORITES_PROVIDER_ID) {
      const favoriteSelection = await pickAntigravityCliFavoriteLaunchModel(
        prefs.antigravityCliFavoriteModels ?? [],
        allProviders
      );
      if (!favoriteSelection) {
        currentInitialProvider = AGY_FAVORITES_PROVIDER_ID;
        continue;
      }
      return { ...favoriteSelection, allProviders };
    }
    const activeProvider = allProviders.find((lp) => lp.id === chosen);
    const pickedModelResult = await pickLocalModel(activeProvider, conflicts, prefs);
    if (pickedModelResult === "back") {
      currentInitialProvider = activeProvider.id;
      continue;
    }
    if (!pickedModelResult) return null;
    return { provider: activeProvider, model: pickedModelResult, allProviders };
  }
}
async function resolveAndBuildRoutes(provider, model, allProviders, prefs, opts) {
  const result = await resolveAntigravityLaunchRoutes({
    provider,
    model,
    allProviders,
    favorites: prefs.antigravityCliFavoriteModels ?? [],
    maxRoutes: opts.maxRoutes
  });
  if (!result) {
    p14.log.error(`No credential for ${provider.name}. Run: relay-ai providers auth ${provider.id} or add an API key.`);
    return null;
  }
  if (result.routes.length > 1) {
    p14.log.info(
      `Favorites mode active \u2014 Antigravity picker will show ${result.routes.length} models.`
    );
    p14.log.info("Edit with `relay-ai favorites --agy`.");
  }
  if (result.droppedFavorites.length > 0) {
    p14.log.warn(
      `Skipped ${result.droppedFavorites.length} stale/unauthorized favorite(s): ` + result.droppedFavorites.map((fav) => `${fav.providerId}:${fav.modelId}`).join(", ")
    );
  }
  if (result.capacitySkippedFavorites.length > 0) {
    p14.log.warn(formatAgyCapacityWarning(opts.validatedSlotCount, result.capacitySkippedFavorites.length));
    p14.log.warn(
      "Not exposed: " + result.capacitySkippedFavorites.map((fav) => `${fav.providerId}:${fav.modelId}`).join(", ")
    );
    if (opts.pauseForCapacityWarning && isInteractiveTerminal() && !agyArgsAreNonInteractive(opts.childArgs)) {
      const proceed = await p14.confirm({
        message: "Continue with the validated AGY switch catalog?",
        initialValue: true
      });
      if (p14.isCancel(proceed) || !proceed) {
        p14.cancel("Cancelled.");
        return null;
      }
    }
  }
  return { routes: result.routes, apiKey: result.apiKey };
}
function waitForShutdown2() {
  return new Promise((resolve) => {
    const cleanup = () => {
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
      process.removeListener("SIGHUP", onSighup);
    };
    const onSigint = () => {
      cleanup();
      resolve("sigint");
    };
    const onSigterm = () => {
      cleanup();
      resolve("sigterm");
    };
    const onSighup = () => {
      cleanup();
      resolve("sighup");
    };
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);
    process.once("SIGHUP", onSighup);
  });
}
async function promptToCloseAntigravityIde(profileDir) {
  if (!isAntigravityIdeRunning(profileDir)) return;
  const shouldClose = await p14.confirm({
    message: "Antigravity IDE is still running. Close it?",
    initialValue: true
  });
  if (p14.isCancel(shouldClose) || shouldClose) {
    p14.log.step("Stopping Antigravity IDE...");
    quitAntigravityIdeGracefully();
    await waitForAntigravityIdeQuit(profileDir);
  }
}
async function runAntigravityCommand(intro, tracePrefix, trace, boot, launch, opts = {}) {
  const prefs = loadPreferences();
  relayIntro(intro);
  if (tracePrefix === "agy" && (prefs.favoriteModels?.length ?? 0) > 0 && (prefs.antigravityCliFavoriteModels?.length ?? 0) === 0 && !prefs.antigravityCliFavoritesHintShown) {
    p14.log.info("Tip: AGY uses its own favorites list. Run `relay-ai favorites --agy` to set up switching.");
    savePreferences({ antigravityCliFavoritesHintShown: true });
  }
  const selection = await resolveAntigravityLaunch(prefs, boot);
  if (!selection) return 1;
  const { provider, model, allProviders } = selection;
  const versionResult = opts.versionGuard ? readAntigravityCliVersion() : { version: "1.0.10" };
  const compatibility = evaluateAgySwitchCompatibility({
    version: versionResult.version,
    versionReadError: "error" in versionResult ? versionResult.error : void 0,
    fixture: fetchAvailableModels_default
  });
  for (const warning of compatibility.warnings) {
    p14.log.warn(warning);
  }
  const routeLimit = compatibility.mode === "multi-model" ? compatibility.validatedSwitchSlotCount : 1;
  const routeResult = await resolveAndBuildRoutes(provider, model, allProviders, prefs, {
    maxRoutes: routeLimit,
    validatedSlotCount: routeLimit,
    pauseForCapacityWarning: opts.pauseForCapacityWarning ?? false,
    childArgs: opts.childArgs ?? []
  });
  if (!routeResult) return 1;
  savePreferences({
    lastAntigravityProvider: provider.id,
    lastAntigravityModel: model.id
  });
  const traceLogPath = `/tmp/relay-ai-${tracePrefix}-trace-${Date.now()}.log`;
  const logFn = trace ? (msg) => {
    try {
      appendFileSync3(traceLogPath, `${msg}
`);
    } catch {
    }
  } : void 0;
  let gatewayHandle;
  try {
    gatewayHandle = await startCloudCodeGateway(routeResult.routes, { trace, logFn });
  } catch (err) {
    p14.log.error(`Failed to start Cloud Code gateway: ${err}`);
    return 1;
  }
  p14.log.info(`Cloud Code gateway on ${pc12.cyan(`127.0.0.1:${gatewayHandle.port}`)}`);
  p14.log.success(`Active model: ${formatCodexModelLabel(model)} ${pc12.dim("via")} ${provider.name}`);
  if (trace) p14.log.info(`Gateway trace \u2192 ${pc12.dim(traceLogPath)}`);
  relayOutro("Launching", `${formatCodexModelLabel(model)} (${provider.name})`);
  try {
    const cleanEnv = buildAntigravityChildEnv(gatewayHandle.url);
    return await launch(cleanEnv, routeResult.routes, gatewayHandle);
  } finally {
    await gatewayHandle.close();
  }
}
async function runAgyCommand(childArgs, trace = false, boot) {
  return runAntigravityCommand(
    "relay-ai agy \u2014 Antigravity CLI",
    "agy",
    trace,
    boot,
    (env, routes) => launchAntigravityCli(env, buildAgyLaunchArgs(routes[0].displayName, childArgs)),
    { childArgs, versionGuard: true, pauseForCapacityWarning: true }
  );
}
async function runAntigravityIdeCommand(childArgs, trace = false, boot) {
  return runAntigravityCommand(
    "relay-ai antigravity-ide \u2014 Antigravity IDE",
    "ide",
    trace,
    boot,
    async (env, _routes, gatewayHandle) => {
      const profileDir = join8(homedir8(), ".relay-ai", "antigravity", "profile");
      if (isAntigravityIdeRunning(profileDir)) {
        const restart = await p14.confirm({
          message: "Restart Antigravity IDE to apply this Relay gateway?",
          initialValue: true
        });
        if (p14.isCancel(restart) || !restart) {
          p14.log.info("Quit and reopen Antigravity IDE when you are ready for the new gateway to take effect.");
          return 0;
        }
        quitAntigravityIdeGracefully();
        await waitForAntigravityIdeQuit(profileDir);
      }
      const launchCode = await launchAntigravityIde(env, profileDir, gatewayHandle.url, childArgs);
      if (launchCode !== 0) return launchCode;
      p14.log.info("Antigravity IDE is using the Relay Cloud Code gateway.");
      p14.log.info(pc12.cyan("Press Ctrl+C to stop the gateway."));
      await waitForShutdown2();
      console.log("");
      await promptToCloseAntigravityIde(profileDir);
      return 0;
    },
    { childArgs, versionGuard: false, pauseForCapacityWarning: false }
  );
}

// src/codex-app.ts
import pc13 from "picocolors";
import * as p16 from "@clack/prompts";

// src/codex/app-config.ts
import { existsSync as existsSync8, readFileSync as readFileSync4, rmSync as rmSync2, writeFileSync as writeFileSync2, mkdirSync as mkdirSync2 } from "fs";
import { dirname as dirname2, join as join9 } from "path";
import { parse, stringify } from "smol-toml";
function getCodexConfigPath() {
  return join9(getCodexHome(), "config.toml");
}
function getCodexAppSidecarProfilePath() {
  return join9(getCodexHome(), `${CODEX_APP_PROVIDER_ID}.config.toml`);
}
function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function rootString(config, key) {
  if (!(key in config)) return { had: false, value: "" };
  const v = config[key];
  return { had: true, value: typeof v === "string" ? v : String(v ?? "") };
}
function rootNumber(config, key) {
  if (!(key in config)) return { had: false };
  const v = config[key];
  return { had: true, value: typeof v === "number" ? v : void 0 };
}
function applyRestoreNumber(config, key, had, value) {
  if (had && value !== void 0) {
    config[key] = value;
  } else {
    delete config[key];
  }
}
function readCodexConfigText(path2 = getCodexConfigPath()) {
  if (!existsSync8(path2)) return "";
  return readFileSync4(path2, "utf8");
}
function parseCodexConfig(text5) {
  if (!text5.trim()) return {};
  return asRecord(parse(text5));
}
function captureRestoreState(text5) {
  const config = parseCodexConfig(text5);
  const profile = rootString(config, "profile");
  const model = rootString(config, "model");
  const modelProvider = rootString(config, "model_provider");
  const modelCatalog = rootString(config, "model_catalog_json");
  const openAIBaseUrl = rootString(config, "openai_base_url");
  const reasoning = rootString(config, "model_reasoning_effort");
  const contextWindow = rootNumber(config, "model_context_window");
  const autoCompact = rootNumber(config, "model_auto_compact_token_limit");
  return {
    hadProfile: profile.had,
    profile: profile.value,
    hadModel: model.had,
    model: model.value,
    hadModelProvider: modelProvider.had,
    modelProvider: modelProvider.value,
    hadModelCatalogJson: modelCatalog.had,
    modelCatalogJson: modelCatalog.value,
    hadOpenAIBaseUrl: openAIBaseUrl.had,
    openAIBaseUrl: openAIBaseUrl.value,
    hadModelReasoningEffort: reasoning.had,
    modelReasoningEffort: reasoning.value,
    hadModelContextWindow: contextWindow.had,
    modelContextWindow: contextWindow.value,
    hadModelAutoCompactTokenLimit: autoCompact.had,
    modelAutoCompactTokenLimit: autoCompact.value
  };
}
function isAppManagedConfig(text5) {
  const config = parseCodexConfig(text5);
  const mp = rootString(config, "model_provider");
  if (mp.had && mp.value === CODEX_APP_PROVIDER_ID) return true;
  const baseUrl = rootString(config, "openai_base_url");
  const catalog = rootString(config, "model_catalog_json");
  return mp.value === "openai" && /^http:\/\/127\.0\.0\.1:\d+\/v1$/.test(baseUrl.value) && /(?:^|[\\/])app-models-[^\\/]+\.json$/.test(catalog.value);
}
function mergeAppConfig(existing, spec) {
  const patch = buildCodexAppRootConfig(spec);
  const out = { ...existing };
  delete out.profile;
  out.model = patch.model;
  out.model_provider = patch.model_provider;
  out.openai_base_url = patch.openai_base_url;
  out.model_catalog_json = patch.model_catalog_json;
  if (patch.model_context_window !== void 0) {
    out.model_context_window = patch.model_context_window;
  } else {
    delete out.model_context_window;
  }
  if (patch.model_auto_compact_token_limit !== void 0) {
    out.model_auto_compact_token_limit = patch.model_auto_compact_token_limit;
  } else {
    delete out.model_auto_compact_token_limit;
  }
  const providers = asRecord(out.model_providers);
  delete providers[CODEX_APP_PROVIDER_ID];
  const profiles = asRecord(out.profiles);
  delete profiles[CODEX_APP_PROVIDER_ID];
  if (Object.keys(profiles).length === 0) {
    delete out.profiles;
  } else {
    out.profiles = profiles;
  }
  if (Object.keys(providers).length === 0) {
    delete out.model_providers;
  } else {
    out.model_providers = providers;
  }
  const existingEffort = typeof out.model_reasoning_effort === "string" ? out.model_reasoning_effort : void 0;
  if (existingEffort !== void 0) {
    const caps = getReasoningCapabilities(spec.route.npm, spec.route.modelId, {
      providerId: spec.route.providerId,
      apiBaseUrl: spec.route.baseURL,
      supportedParameters: spec.route.supportedParameters,
      reasoning: spec.route.reasoning,
      interleavedReasoningField: spec.route.interleavedReasoningField
    });
    if (caps.levels.length === 0 || !caps.levels.includes(existingEffort)) {
      if (caps.levels.length > 0 && caps.defaultLevel) {
        out.model_reasoning_effort = caps.defaultLevel;
      } else {
        delete out.model_reasoning_effort;
      }
    }
  }
  return out;
}
function validateAppConfigText(text5, spec) {
  const config = parseCodexConfig(text5);
  if ("profile" in config) {
    throw new Error("Generated config still contains legacy root profile key");
  }
  const profiles = asRecord(config.profiles);
  if (profiles[CODEX_APP_PROVIDER_ID]) {
    throw new Error("Generated config still contains legacy profiles table");
  }
  const mp = rootString(config, "model_provider");
  if (mp.value !== "openai") {
    throw new Error("Generated config must keep the built-in OpenAI model_provider");
  }
  const baseUrl = rootString(config, "openai_base_url");
  if (baseUrl.value !== `http://127.0.0.1:${spec.proxyPort}/v1`) {
    throw new Error("Generated config openai_base_url mismatch");
  }
  const catalog = rootString(config, "model_catalog_json");
  if (catalog.value !== spec.catalogPath) {
    throw new Error("Generated config model_catalog_json mismatch");
  }
}
function applyAppConfigPatch(spec, configPath = getCodexConfigPath()) {
  const existingText = readCodexConfigText(configPath);
  let existing;
  try {
    existing = parseCodexConfig(existingText);
  } catch (err) {
    throw new Error(`Invalid existing Codex config at ${configPath}: ${err instanceof Error ? err.message : err}`);
  }
  const merged = mergeAppConfig(existing, spec);
  const text5 = `${stringify(merged)}
`;
  validateAppConfigText(text5, spec);
  mkdirSync2(dirname2(configPath), { recursive: true });
  writeFileSync2(configPath, text5, "utf8");
  return text5;
}
function applyRestoreKey(config, key, had, value) {
  if (had && value !== void 0) {
    config[key] = value;
  } else {
    delete config[key];
  }
}
function restoreConfigFromState(state, configPath = getCodexConfigPath()) {
  const existingText = readCodexConfigText(configPath);
  const config = parseCodexConfig(existingText);
  const providers = asRecord(config.model_providers);
  delete providers[CODEX_APP_PROVIDER_ID];
  if (Object.keys(providers).length === 0) {
    delete config.model_providers;
  } else {
    config.model_providers = providers;
  }
  if (state.hadProfile && state.profile) {
    config.profile = state.profile;
  } else {
    delete config.profile;
  }
  applyRestoreKey(config, "model", state.hadModel, state.model);
  applyRestoreKey(config, "model_provider", state.hadModelProvider, state.modelProvider);
  applyRestoreKey(config, "model_catalog_json", state.hadModelCatalogJson, state.modelCatalogJson);
  if ("hadOpenAIBaseUrl" in state) {
    applyRestoreKey(config, "openai_base_url", Boolean(state.hadOpenAIBaseUrl), state.openAIBaseUrl);
  }
  applyRestoreKey(config, "model_reasoning_effort", state.hadModelReasoningEffort, state.modelReasoningEffort);
  applyRestoreNumber(config, "model_context_window", state.hadModelContextWindow ?? false, state.modelContextWindow);
  applyRestoreNumber(config, "model_auto_compact_token_limit", state.hadModelAutoCompactTokenLimit ?? false, state.modelAutoCompactTokenLimit);
  const sidecar = getCodexAppSidecarProfilePath();
  if (existsSync8(sidecar)) {
    try {
      rmSync2(sidecar, { force: true });
    } catch {
    }
  }
  const hadFile = existsSync8(configPath);
  const empty = Object.keys(config).length === 0 || Object.keys(config).length === 1 && "model_providers" in config && Object.keys(asRecord(config.model_providers)).length === 0;
  if (!hadFile && empty) return false;
  if (empty) {
    rmSync2(configPath, { force: true });
    return true;
  }
  writeFileSync2(configPath, `${stringify(config)}
`, "utf8");
  return true;
}
function previewAppConfigToml(spec) {
  const text5 = `${stringify(buildCodexAppRootConfig(spec))}
`;
  validateAppConfigText(text5, spec);
  return text5;
}

// src/codex/app-session.ts
import {
  copyFileSync as copyFileSync2,
  existsSync as existsSync9,
  mkdirSync as mkdirSync3,
  readdirSync as readdirSync2,
  readFileSync as readFileSync5,
  rmSync as rmSync3
} from "fs";
import { basename as basename2, join as join10 } from "path";
function getAppSessionLockPath(env = process.env) {
  return join10(getRelayAiCodexDir(env), "session-app.json");
}
function getAppRestoreStatePath(env = process.env) {
  return join10(getRelayAiCodexDir(env), "app-restore-state.json");
}
function getAppCatalogPath(providerId, env = process.env) {
  return join10(getRelayAiCodexDir(env), `app-models-${providerId}.json`);
}
function readAppSessionLock(env = process.env) {
  const path2 = getAppSessionLockPath(env);
  if (!existsSync9(path2)) return null;
  try {
    const parsed = JSON.parse(readFileSync5(path2, "utf8"));
    if (typeof parsed.pid === "number" && typeof parsed.startedAt === "string") return parsed;
  } catch {
  }
  return null;
}
function writeAppSessionLock(lock, env = process.env) {
  atomicWriteFile(getAppSessionLockPath(env), `${JSON.stringify(lock, null, 2)}
`);
}
function clearAppSessionLock(env = process.env) {
  const path2 = getAppSessionLockPath(env);
  if (existsSync9(path2)) rmSync3(path2, { force: true });
}
function readAppRestoreState(env = process.env) {
  const path2 = getAppRestoreStatePath(env);
  if (!existsSync9(path2)) return null;
  try {
    return JSON.parse(readFileSync5(path2, "utf8"));
  } catch {
    return null;
  }
}
function writeAppRestoreState(state, env = process.env) {
  rotateBackups(getAppRestoreStatePath(env), env);
  atomicWriteFile(getAppRestoreStatePath(env), `${JSON.stringify(state, null, 2)}
`);
}
function clearAppRestoreState(env = process.env) {
  const path2 = getAppRestoreStatePath(env);
  if (existsSync9(path2)) rmSync3(path2, { force: true });
}
function backupConfigToml(env = process.env) {
  const configPath = getCodexConfigPath();
  if (!existsSync9(configPath)) return void 0;
  rotateBackups(configPath, env);
  const backupsDir = getBackupsDir(env);
  mkdirSync3(backupsDir, { recursive: true });
  const base = basename2(configPath);
  const backupPath = join10(backupsDir, `${base}.${Date.now()}.bak`);
  copyFileSync2(configPath, backupPath);
  return backupPath;
}
function saveAppRestoreStateBeforePatch(env = process.env) {
  const text5 = readCodexConfigText();
  const existing = readAppRestoreState(env);
  if (existing && isAppManagedConfig(text5)) {
    return existing;
  }
  const state = captureRestoreState(text5);
  writeAppRestoreState(state, env);
  return state;
}
function ownedAppCatalogPaths(env = process.env) {
  const codexDir = getRelayAiCodexDir(env);
  if (!existsSync9(codexDir)) return [];
  return readdirSync2(codexDir).filter((n) => n.startsWith("app-models-") && n.endsWith(".json")).map((n) => join10(codexDir, n));
}
function removeAppCatalogs(env = process.env) {
  const removed = [];
  for (const path2 of ownedAppCatalogPaths(env)) {
    try {
      rmSync3(path2, { force: true });
      removed.push(path2);
    } catch {
    }
  }
  return removed;
}
function restoreCodexAppOverlay(env = process.env) {
  const lock = readAppSessionLock(env);
  if (lock && lock.pid !== process.pid && isConcurrentSession(lock)) {
    return {
      restored: false,
      liveSession: true,
      message: `Another relay-ai codex-app session is running (pid ${lock.pid}). Ctrl+C it first, then run --restore.`
    };
  }
  const text5 = readCodexConfigText();
  const managed = isAppManagedConfig(text5);
  const restoreState = readAppRestoreState(env);
  if (!managed && !restoreState && !lock) {
    removeAppCatalogs(env);
    clearAppSessionLock(env);
    return { restored: false, message: "Nothing to restore." };
  }
  if (restoreState) {
    restoreConfigFromState(restoreState);
  } else if (lock?.backupPath && existsSync9(lock.backupPath)) {
    copyFileSync2(lock.backupPath, getCodexConfigPath());
  }
  removeAppCatalogs(env);
  clearAppRestoreState(env);
  clearAppSessionLock(env);
  return { restored: true, message: "Restored Codex App config and removed relay-ai app files." };
}
function recoverInterruptedCodexAppSession(env = process.env) {
  const lock = readAppSessionLock(env);
  const managed = isAppManagedConfig(readCodexConfigText());
  if (!lock && !managed) return { recovered: false };
  if (lock && lock.pid !== process.pid && isConcurrentSession(lock)) {
    return { recovered: false };
  }
  restoreCodexAppOverlay(env);
  return { recovered: true };
}
function checkAppSessionLock(isTty, env = process.env) {
  if (!isTty) return { ok: false, reason: "non_tty" };
  const lock = readAppSessionLock(env);
  if (lock && lock.pid !== process.pid && isConcurrentSession(lock)) {
    return { ok: false, reason: "concurrent", lock };
  }
  return { ok: true };
}
function waitForShutdown3() {
  return new Promise((resolve) => {
    const cleanup = () => {
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
      process.removeListener("SIGHUP", onSighup);
    };
    const onSigint = () => {
      cleanup();
      resolve("sigint");
    };
    const onSigterm = () => {
      cleanup();
      resolve("sigterm");
    };
    const onSighup = () => {
      cleanup();
      resolve("sighup");
    };
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);
    process.once("SIGHUP", onSighup);
  });
}

// src/codex/app-launch.ts
import { execSync as execSync4 } from "child_process";
import { existsSync as existsSync10, readdirSync as readdirSync3, statSync as statSync2 } from "fs";
import { homedir as homedir9 } from "os";
import { join as join11 } from "path";
import * as p15 from "@clack/prompts";
var CODEX_BUNDLE_ID = "com.openai.codex";
function codexAppSupported() {
  if (process.platform !== "darwin" && process.platform !== "win32") {
    throw new Error("Codex App launch is supported on macOS and Windows only.");
  }
}
function run(cmd, encoding = "utf8") {
  return execSync4(cmd, { encoding, stdio: ["pipe", "pipe", "pipe"] }).trim();
}
function runPowerShell(script) {
  return run(`powershell.exe -NoProfile -Command ${JSON.stringify(script)}`);
}
function darwinAppCandidates() {
  return [
    "/Applications/Codex.app",
    join11(homedir9(), "Applications", "Codex.app")
  ];
}
function winLocalAppData() {
  return process.env.LOCALAPPDATA ?? join11(homedir9(), "AppData", "Local");
}
function winCodexExeCandidates() {
  const local = winLocalAppData();
  const bases = [
    join11(local, "Programs", "Codex"),
    join11(local, "Programs", "OpenAI Codex"),
    join11(local, "Codex"),
    join11(local, "OpenAI Codex"),
    join11(local, "OpenAI", "Codex"),
    join11(local, "openai-codex-electron")
  ];
  const out = [];
  for (const base of bases) {
    out.push(join11(base, "Codex.exe"));
    try {
      if (existsSync10(base)) {
        for (const name of readdirSync3(base)) {
          if (name.startsWith("app-")) {
            out.push(join11(base, name, "Codex.exe"));
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
    return first && existsSync10(first) ? first : null;
  } catch {
    return null;
  }
}
function findCodexApp() {
  if (process.platform === "darwin") {
    for (const path2 of darwinAppCandidates()) {
      if (existsSync10(path2)) return path2;
    }
    return mdfindCodexApp();
  }
  if (process.platform === "win32") {
    for (const path2 of winCodexExeCandidates()) {
      try {
        if (existsSync10(path2) && statSync2(path2).isFile()) return path2;
      } catch {
      }
    }
    try {
      const appId = runPowerShell(
        "(Get-StartApps Codex | Where-Object { $_.Name -eq 'Codex' -or $_.Name -like 'Codex*' } | Select-Object -First 1 -ExpandProperty AppID)"
      );
      if (appId) return `shell:AppsFolder\\${appId}`;
    } catch {
    }
  }
  return null;
}
function darwinIsRunning() {
  try {
    const out = run(`osascript -e 'tell application "System Events" to exists process "Codex"'`);
    return out.toLowerCase() === "true";
  } catch {
    return false;
  }
}
function winMatchingPids() {
  try {
    const script = `$current = ${process.pid}; Get-CimInstance Win32_Process -Filter "Name = 'Codex.exe' OR Name = 'codex.exe'" | Where-Object { $_.ProcessId -ne $current -and ((($_.Name -ieq 'Codex.exe') -and (($null -eq $_.CommandLine) -or ($_.CommandLine -notlike '* --type=*'))) -or (($_.Name -ieq 'codex.exe') -and ($_.CommandLine -like '*app-server*'))) } | Select-Object -ExpandProperty ProcessId`;
    const out = runPowerShell(script);
    return out.split(/\s+/).map((s) => Number.parseInt(s, 10)).filter((n) => Number.isFinite(n) && n > 0);
  } catch {
    return [];
  }
}
function winHasWindow() {
  try {
    const out = runPowerShell(
      "(Get-Process Codex -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1).Id"
    );
    return out.length > 0 && Number.isFinite(Number.parseInt(out, 10));
  } catch {
    return false;
  }
}
function isCodexAppRunning() {
  if (process.platform === "darwin") return darwinIsRunning();
  if (process.platform === "win32") return winMatchingPids().length > 0 || winHasWindow();
  return false;
}
function sleep2(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function waitForQuit(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (process.platform === "win32") {
      if (!winHasWindow()) return true;
    } else if (!darwinIsRunning()) {
      return true;
    }
    await sleep2(200);
  }
  return process.platform === "win32" ? !winHasWindow() : !darwinIsRunning();
}
function openCodexAppAt(path2) {
  if (process.platform === "darwin") {
    if (path2.endsWith(".app")) {
      execSync4(`open ${JSON.stringify(path2)}`, { stdio: "inherit" });
    } else {
      execSync4(`open -b ${CODEX_BUNDLE_ID}`, { stdio: "inherit" });
    }
    return;
  }
  if (process.platform === "win32") {
    if (path2.startsWith("shell:AppsFolder\\")) {
      runPowerShell(`Start-Process '${path2.replace(/'/g, "''")}'`);
    } else {
      runPowerShell(`Start-Process -FilePath '${path2.replace(/'/g, "''")}'`);
    }
  }
}
function openCodexApp() {
  const path2 = findCodexApp();
  if (!path2) {
    throw new Error(
      "Codex App not found. Install from https://developers.openai.com/codex/cli then run relay-ai codex-app again."
    );
  }
  openCodexAppAt(path2);
}
function darwinQuit() {
  try {
    execSync4(`osascript -e 'tell application "Codex" to quit'`, { stdio: "pipe" });
  } catch {
    execSync4(`osascript -e 'tell application id "${CODEX_BUNDLE_ID}" to quit'`, { stdio: "pipe" });
  }
}
function winQuitGraceful() {
  runPowerShell(
    "Get-Process Codex -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object { [void]$_.CloseMainWindow() }"
  );
}
function quitCodexAppGracefully() {
  if (process.platform === "darwin") darwinQuit();
  else if (process.platform === "win32") winQuitGraceful();
}
function winForceQuit() {
  const pids = winMatchingPids();
  if (pids.length === 0) return;
  runPowerShell(`Stop-Process -Id ${pids.join(",")} -Force -ErrorAction SilentlyContinue`);
}
async function launchOrRestartCodexApp(prompt = "Restart Codex to apply relay-ai settings?") {
  const appPath = findCodexApp();
  if (!isCodexAppRunning()) {
    if (!appPath) {
      throw new Error(
        "Codex App not found. Install from https://developers.openai.com/codex/cli then run relay-ai codex-app again."
      );
    }
    openCodexAppAt(appPath);
    return;
  }
  const restart = await p15.confirm({ message: prompt, initialValue: true });
  if (p15.isCancel(restart) || !restart) {
    p15.log.info("Quit and reopen Codex when you are ready for the new model to take effect.");
    return;
  }
  if (process.platform === "darwin") darwinQuit();
  else winQuitGraceful();
  if (!await waitForQuit(5e3)) {
    if (process.platform === "win32") winForceQuit();
    await waitForQuit(5e3);
  }
  if (appPath) openCodexAppAt(appPath);
  else openCodexApp();
}
function codexAppInstallHint() {
  return "Install the Codex desktop app for macOS or Windows: https://developers.openai.com/codex/cli";
}

// src/codex-app.ts
async function waitForShutdownWithConfirm() {
  while (true) {
    const signal = await waitForShutdown3();
    if (signal !== "sigint") break;
    console.log("");
    const choice = await p16.select({
      message: "Close Codex Desktop and restore your Codex config?",
      options: [
        { value: "yes", label: "Yes, close Codex and restore config" },
        { value: "no", label: "No, keep session running" }
      ]
    });
    if (p16.isCancel(choice) || choice === "yes") break;
  }
}
function codexAppHelpText() {
  return `${pc13.bold("relay-ai codex-app")} \u2014 launch Codex desktop app with your registry providers

${pc13.bold("Usage:")}
  relay-ai codex-app [options]
  relay-ai codex-app --vertex
  relay-ai codex-app --restore
  relay-ai codex-app --config
  relay-ai codex-app --help
  relay-ai codex-app --version

${pc13.bold("Options:")}
  --vertex     Use Claude models through Google Vertex AI
  --restore    Restore Codex config after an interrupted app session
  --config     Preview the generated Codex app configuration without launching
  --trace      Write proxy debug logs to ~/.relay-ai/logs/ and show errors on exit
  --help       Show this command help
  --version    Show version

${pc13.bold("Description:")}
  Picks a provider and model from ~/.relay-ai/providers.json, patches ~/.codex/config.toml
  (with backup + restore on Ctrl+C), starts a local Responses proxy, and opens the
  Codex desktop app. Keep this terminal open while using Codex.

${pc13.bold("Platforms:")}
  macOS and Windows. Linux is not supported (no Codex desktop app).

${pc13.bold("Cleanup:")}
  Ctrl+C stops the proxy and restores your previous Codex config.
  After crash: relay-ai codex-app --restore

${pc13.bold("Preview (no writes):")}
  relay-ai codex-app --config

  See docs/CODEX.md for CLI vs app, files touched, and restore.

${pc13.bold("Examples:")}
  relay-ai codex-app
  relay-ai codex-app --vertex
  relay-ai codex-app --config
  relay-ai codex-app --restore
  
${pc13.bold("Favorites:")}
  When you have saved favorites via ${pc13.cyan("relay-ai models")}, the Codex App
  picker will show your starting model + favorites for mid-session switching.
  Zen/Go favorites are included when an OpenCode API key is available.`;
}
function providerForCodexPicker(provider) {
  return { ...provider, models: routableModelsForProvider(provider, "codex-app") };
}
function vertexEntryToLocalModel2(entry) {
  return {
    id: entry.id,
    name: entry.display_name,
    family: "claude",
    brand: "Anthropic",
    modelFormat: "openai",
    upstreamModelId: entry.upstream_id ?? entry.id,
    baseUrl: "",
    npm: VERTEX_ANTHROPIC_NPM,
    contextWindow: resolveContextWindow(entry.id)
  };
}
async function runCodexAppVertexLaunch(configOnly, trace = false) {
  if (!hasApplicationDefaultCredentials()) {
    p16.log.error("Google Application Default Credentials not found.");
    p16.log.info("Run: gcloud auth application-default login");
    return 1;
  }
  const config = buildVertexRuntimeConfig();
  if (!config) {
    p16.log.error("ANTHROPIC_VERTEX_PROJECT_ID (or GOOGLE_CLOUD_PROJECT) is not set.");
    p16.log.info("Set your project: export ANTHROPIC_VERTEX_PROJECT_ID=your-project-id");
    return 1;
  }
  let selectedEntry;
  if (config.models.length === 1) {
    selectedEntry = config.models[0];
  } else {
    const choice = await p16.select({
      message: "Select a starting Vertex AI model:",
      options: config.models.map((m) => ({ value: m, label: m.display_name, hint: m.id }))
    });
    if (p16.isCancel(choice)) {
      p16.cancel("Cancelled.");
      return 0;
    }
    selectedEntry = choice;
  }
  process.env["ANTHROPIC_VERTEX_PROJECT_ID"] = config.project;
  process.env["GOOGLE_CLOUD_LOCATION"] = config.location;
  const vertexConfig = { project: config.project, location: config.location };
  const vertexModels = config.models.map(vertexEntryToLocalModel2);
  const catalogPath = getAppCatalogPath("vertex");
  const route = {
    tier: "proxy",
    modelId: selectedEntry.id,
    upstreamModelId: selectedEntry.upstream_id ?? selectedEntry.id,
    npm: VERTEX_ANTHROPIC_NPM,
    apiKey: "",
    providerId: "vertex",
    contextWindow: resolveContextWindow(selectedEntry.id)
  };
  if (configOnly) {
    const home = process.env["HOME"] ?? "";
    const shortenPath = (fp) => home ? fp.replace(home, "~") : fp;
    console.log("");
    console.log(pc13.bold(pc13.cyan("  CONFIG PREVIEW \u2014 relay-ai codex-app --vertex")));
    console.log("");
    console.log(`  ${pc13.bold("Mode:")}     Vertex AI`);
    console.log(`  ${pc13.bold("Project:")} ${config.project}`);
    console.log(`  ${pc13.bold("Location:")} ${config.location}`);
    console.log(`  ${pc13.bold("Model:")}    ${selectedEntry.display_name}`);
    console.log(`  ${pc13.bold("Catalog:")} ${vertexModels.length} model${vertexModels.length !== 1 ? "s" : ""} available`);
    console.log("");
    console.log(`  ${pc13.bold("Catalog file:")}`);
    console.log(`    ${pc13.dim(shortenPath(catalogPath))}`);
    console.log("");
    console.log(pc13.dim("  No app was launched."));
    console.log(pc13.dim("  Run ") + pc13.cyan("relay-ai codex-app --vertex") + pc13.dim(" to launch."));
    console.log("");
    return 0;
  }
  let proxyHandle = null;
  let sessionActive = false;
  try {
    proxyHandle = await startCodexProxy(
      vertexModels.map((m) => ({
        modelId: m.id,
        upstreamModelId: m.upstreamModelId,
        npm: VERTEX_ANTHROPIC_NPM,
        apiKey: "",
        providerId: "vertex",
        vertex: vertexConfig,
        contextWindow: m.contextWindow
      })),
      { requireAuth: false, debug: trace }
    );
    const proxyPort = proxyHandle.port;
    const catalogFile = buildAppCatalogFile(vertexModels, "Vertex AI", selectedEntry.id);
    writeOverlayFile(catalogPath, serializeCatalog(catalogFile));
    const spec = {
      route,
      proxyPort,
      catalogPath
    };
    saveAppRestoreStateBeforePatch();
    const backupPath = backupConfigToml();
    applyAppConfigPatch(spec);
    writeAppSessionLock({
      pid: process.pid,
      startedAt: (/* @__PURE__ */ new Date()).toISOString(),
      configPath: getCodexConfigPath(),
      catalogPaths: [catalogPath],
      restoreStatePath: getAppRestoreStatePath(),
      backupPath,
      proxyPort
    });
    sessionActive = true;
    p16.log.info(`Vertex AI \xB7 ${selectedEntry.display_name} \u2014 project: ${config.project} / location: ${config.location}`);
    logProxy(proxyPort);
    logActiveModel(selectedEntry.display_name, selectedEntry.id);
    try {
      await launchOrRestartCodexApp();
    } catch (err) {
      p16.log.warn(String(err instanceof Error ? err.message : err));
      p16.log.info(codexAppInstallHint());
    }
    printCodexAppSessionPanel({
      modelLabel: selectedEntry.display_name,
      modelId: selectedEntry.id,
      providerName: "Vertex AI",
      restoreCommand: "relay-ai codex-app --restore"
    });
    codexAppOutro(selectedEntry.display_name);
    await waitForShutdownWithConfirm();
    console.log("");
    if (isCodexAppRunning()) {
      p16.log.step("Stopping Codex Desktop...");
      quitCodexAppGracefully();
    }
    if (sessionActive) {
      restoreCodexAppOverlay();
      sessionActive = false;
    }
    return 0;
  } finally {
    proxyHandle?.close();
    if (sessionActive) restoreCodexAppOverlay();
  }
}
async function runCodexAppCommand(args, opts = {}) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(codexAppHelpText());
    return 0;
  }
  if (args.includes("--restore")) {
    const result = restoreCodexAppOverlay();
    console.log(result.message);
    return result.liveSession ? 1 : 0;
  }
  try {
    codexAppSupported();
  } catch (err) {
    console.error(pc13.red(String(err instanceof Error ? err.message : err)));
    return 1;
  }
  const interrupted = recoverInterruptedCodexAppSession();
  const configOnly = args.includes("--config");
  const trace = args.includes("--trace");
  const debugLogPath = getCodexProxyDebugLogPath();
  if (trace && !configOnly) {
    p16.log.info(`Debug log: ${debugLogPath}`);
  }
  const isTty = Boolean(process.stdin.isTTY);
  if (!configOnly) {
    const sessionCheck = checkAppSessionLock(isTty);
    if (!sessionCheck.ok) {
      if (sessionCheck.reason === "non_tty") {
        console.error(pc13.red("relay-ai codex-app requires an interactive terminal."));
        return 1;
      }
      console.error(pc13.yellow(`Another relay-ai codex-app session may be running (pid ${sessionCheck.lock.pid}).`));
      console.error("Stop it with Ctrl+C in that terminal, or run relay-ai codex-app --restore after it exits.");
      return 1;
    }
  }
  if (!configOnly) {
    codexAppIntro();
    if (interrupted.recovered) {
      p16.log.warn("Recovered from an interrupted codex-app session (restored Codex config).");
    }
  }
  if (opts.vertex) {
    return runCodexAppVertexLaunch(configOnly, trace);
  }
  const catalogSpinner = p16.spinner();
  catalogSpinner.start("Loading your providers...");
  let catalog;
  try {
    catalog = await fetchProviderCatalog({ agent: "codex-app" });
  } catch (err) {
    catalogSpinner.stop("");
    console.error(pc13.red(String(err instanceof Error ? err.message : err)));
    return 1;
  }
  catalogSpinner.stop("");
  const compatible = codexCompatibleProviders(providersForPicker(catalog), "codex-app");
  if (compatible.length === 0) {
    if (!configOnly) {
      p16.log.warn("No Codex-compatible providers in your registry.");
      p16.log.info("Add a provider with relay-ai providers add.");
    }
    return 0;
  }
  const prefs = loadPreferences();
  const favorites = prefs.favoriteModels ?? [];
  const favoritesActive = favorites.length > 0;
  if (favoritesActive && !configOnly) {
    p16.log.info(
      `Favorites mode active \u2014 Codex App picker will show ${favorites.length + 1} models (1 starting + ${favorites.length} favorites).`
    );
    p16.log.info("Edit with `relay-ai models`.");
  }
  let activeProvider = providerForCodexPicker(
    compatible.find((lp) => lp.id === prefs.lastCodexProvider) ?? compatible[0]
  );
  let selectedModel = activeProvider.models.find((m) => m.id === prefs.lastCodexModel) ?? activeProvider.models[0];
  if (!configOnly) {
    let currentInitialProvider = prefs.lastCodexProvider && compatible.some((o) => o.id === prefs.lastCodexProvider) ? prefs.lastCodexProvider : compatible[0].id;
    while (true) {
      const pickedProvider = await pickCodexProvider(compatible, prefs, favoritesActive, currentInitialProvider);
      if (!pickedProvider) return 0;
      if (pickedProvider === "__favorites__") {
        const favoriteProviders = compatible.map(providerForCodexPicker);
        const available = [];
        for (const fav of favorites) {
          const prov = favoriteProviders.find((lp) => lp.id === fav.providerId);
          const mod = prov?.models.find((m) => m.id === fav.modelId);
          if (prov && mod) available.push({ provider: prov, model: mod });
        }
        if (available.length === 0) {
          p16.log.warn("No saved Codex App favorites are currently available.");
          return 0;
        }
        const favOptions = available.map((f, i) => ({
          value: String(i),
          label: `${f.model.name || f.model.id} \u2014 ${f.provider.name}`,
          hint: f.model.id
        }));
        const pickedIdx = await p16.select({
          message: "Starting model?",
          options: favOptions,
          initialValue: "0"
        });
        if (p16.isCancel(pickedIdx)) {
          p16.cancel("Cancelled.");
          return 0;
        }
        const sel = available[Number(pickedIdx)];
        activeProvider = sel.provider;
        selectedModel = sel.model;
        break;
      } else {
        activeProvider = providerForCodexPicker(pickedProvider);
        const pickedModelResult = await pickCodexModel(activeProvider, prefs);
        if (pickedModelResult === "back") {
          currentInitialProvider = activeProvider.id;
          continue;
        }
        if (!pickedModelResult) return 0;
        selectedModel = pickedModelResult;
        break;
      }
    }
  }
  const regEntry = loadRegistry().providers.find((pr) => pr.id === activeProvider.id);
  const authRef = regEntry?.authRef ?? (activeProvider.apiKey ? `keyring:provider:${activeProvider.id}` : oauthAuthRef(activeProvider.id));
  const apiKey = activeProvider.apiKey?.trim() || await resolveProviderCredential(activeProvider.id, authRef);
  if (!apiKey) {
    if (!configOnly) {
      p16.log.error(`No credential for ${activeProvider.name}. Run relay-ai providers auth ${activeProvider.id}.`);
    }
    return 1;
  }
  activeProvider.apiKey = apiKey;
  const route = resolveCodexRoute(activeProvider, selectedModel, apiKey);
  const appRoute = { ...route, tier: "proxy" };
  const routable = routableModelsForProvider(activeProvider, "codex-app");
  let resolvedFavorites = [];
  let providersById = /* @__PURE__ */ new Map();
  if (favoritesActive) {
    let zenGoApiKey = null;
    const hasZenGo = favorites.some((f) => f.providerId === "zen" || f.providerId === "go") || activeProvider.id === "zen" || activeProvider.id === "go";
    if (hasZenGo) {
      if (!configOnly) {
        zenGoApiKey = await resolveOrCollectApiKey(false, false);
      } else {
        const existing = resolveApiKey();
        if (existing) {
          zenGoApiKey = existing;
        } else {
          const stored = await readFromCredentialStore(() => {
          });
          if (stored) {
            zenGoApiKey = stored;
          }
        }
      }
    }
    const res = resolveCodexFavorites(activeProvider, selectedModel, compatible, favorites, "codex-app", zenGoApiKey);
    resolvedFavorites = res.resolvedFavorites;
    providersById = res.providersById;
  }
  if (!configOnly) {
    const modelLabel = formatCodexModelLabel(selectedModel);
    const confirmed = await confirmCodexLaunch(
      activeProvider.name,
      modelLabel,
      selectedModel.id,
      appRoute
    );
    if (!confirmed) return 0;
  }
  let proxyHandle = null;
  let sessionActive = false;
  try {
    const catalogPath = favoritesActive && resolvedFavorites.length > 0 ? getFavoritesAppCatalogPath() : getAppCatalogPath(route.providerId);
    const activeRoute = favoritesActive && resolvedFavorites.length > 0 ? {
      tier: "proxy",
      modelId: codexCliFavoritesSlug(activeProvider.id, selectedModel.id),
      providerId: activeProvider.id,
      npm: "",
      upstreamModelId: "",
      apiKey: "",
      contextWindow: selectedModel.contextWindow
    } : appRoute;
    const specBase = { route: activeRoute, catalogPath };
    if (configOnly) {
      const home = process.env["HOME"] ?? "";
      const shortenPath = (fp) => home ? fp.replace(home, "~") : fp;
      console.log("");
      console.log(pc13.bold(pc13.cyan("  CONFIG PREVIEW \u2014 relay-ai codex-app")));
      console.log("");
      if (favoritesActive) {
        console.log(`  ${pc13.bold("Mode:")}     Favorites Catalog (${resolvedFavorites.length} model${resolvedFavorites.length !== 1 ? "s" : ""})`);
        console.log("");
        console.log(`  ${pc13.bold("Models:")}`);
        for (const r of resolvedFavorites) {
          console.log(`    ${pc13.cyan(r.model.id)}  ${pc13.dim(`(${r.providerName})`)}`);
        }
      } else {
        console.log(`  ${pc13.bold("Mode:")}     Single model`);
        console.log(`  ${pc13.bold("Provider:")} ${activeProvider.name}`);
        console.log(`  ${pc13.bold("Model:")}    ${formatCodexModelLabel(selectedModel)}`);
        console.log(`  ${pc13.bold("Catalog:")}  ${routable.length} model${routable.length !== 1 ? "s" : ""} available`);
      }
      console.log("");
      console.log(`  ${pc13.bold("config.toml patch preview:")}`);
      const tomlPreview = previewAppConfigToml({
        ...specBase,
        proxyPort: PREVIEW_PROXY_PORT
      });
      for (const line of tomlPreview.split("\n")) {
        console.log(`    ${pc13.dim(line)}`);
      }
      console.log("");
      console.log(`  ${pc13.bold("Catalog file:")}`);
      console.log(`    ${pc13.dim(shortenPath(catalogPath))}`);
      console.log("");
      console.log(pc13.dim("  No app was launched."));
      console.log(pc13.dim("  Run ") + pc13.cyan("relay-ai codex-app") + pc13.dim(" to launch."));
      console.log("");
      return 0;
    }
    const proxyPort = favoritesActive && resolvedFavorites.length > 0 ? (proxyHandle = await startCodexProxy(
      buildCodexProxyRoutesFromResolved(resolvedFavorites, providersById),
      { requireAuth: false, debug: trace }
    )).port : (proxyHandle = await startCodexProxy(
      buildCodexProxyRoutesForProvider(activeProvider, apiKey, selectedModel.id, "codex-app"),
      { requireAuth: false, debug: trace }
    )).port;
    const modelLabel = formatCodexModelLabel(selectedModel);
    const catalogFile = favoritesActive && resolvedFavorites.length > 0 ? buildFavoritesAppCatalog(resolvedFavorites) : buildAppCatalogFile(routable, activeProvider.name, selectedModel.id);
    writeOverlayFile(catalogPath, serializeCatalog(catalogFile));
    const spec = {
      route: activeRoute,
      proxyPort,
      catalogPath
    };
    saveAppRestoreStateBeforePatch();
    const backupPath = backupConfigToml();
    applyAppConfigPatch(spec);
    writeAppSessionLock({
      pid: process.pid,
      startedAt: (/* @__PURE__ */ new Date()).toISOString(),
      configPath: getCodexConfigPath(),
      catalogPaths: [catalogPath],
      restoreStatePath: getAppRestoreStatePath(),
      backupPath,
      proxyPort
    });
    sessionActive = true;
    const prevRecent = prefs.recentModelsByProvider?.[activeProvider.id] ?? [];
    const updatedRecent = [selectedModel.id, ...prevRecent.filter((id) => id !== selectedModel.id)].slice(0, 3);
    savePreferences({
      lastCodexProvider: activeProvider.id,
      lastCodexModel: selectedModel.id,
      recentModelsByProvider: { ...prefs.recentModelsByProvider, [activeProvider.id]: updatedRecent }
    });
    logProxy(proxyPort);
    logActiveModel(modelLabel, selectedModel.id);
    try {
      await launchOrRestartCodexApp();
    } catch (err) {
      p16.log.warn(String(err instanceof Error ? err.message : err));
      p16.log.info(codexAppInstallHint());
    }
    printCodexAppSessionPanel({
      modelLabel,
      modelId: selectedModel.id,
      providerName: activeProvider.name,
      restoreCommand: "relay-ai codex-app --restore"
    });
    codexAppOutro(modelLabel);
    await waitForShutdownWithConfirm();
    if (trace) printTraceLog(debugLogPath);
    console.log("");
    if (isCodexAppRunning()) {
      p16.log.step("Stopping Codex Desktop...");
      quitCodexAppGracefully();
    }
    if (sessionActive) {
      restoreCodexAppOverlay();
      sessionActive = false;
    }
    return 0;
  } finally {
    proxyHandle?.close();
    if (sessionActive) restoreCodexAppOverlay();
  }
}

// src/claude-app.ts
import pc14 from "picocolors";
import * as p18 from "@clack/prompts";

// src/claude-desktop/app-config.ts
import { existsSync as existsSync11, readFileSync as readFileSync6, writeFileSync as writeFileSync3, mkdirSync as mkdirSync4 } from "fs";
import { homedir as homedir10 } from "os";
import { join as join12, dirname as dirname3 } from "path";
import { randomUUID as randomUUID7 } from "crypto";
function getClaudeDesktopHome() {
  if (process.platform === "win32") {
    return join12(process.env.APPDATA || join12(homedir10(), "AppData", "Roaming"), "Claude-3p");
  }
  return join12(homedir10(), "Library", "Application Support", "Claude-3p");
}
function getConfigLibraryPath() {
  return join12(getClaudeDesktopHome(), "configLibrary");
}
function getMetaJsonPath() {
  return join12(getConfigLibraryPath(), "_meta.json");
}
function readMetaJson() {
  const metaPath = getMetaJsonPath();
  if (!existsSync11(metaPath)) return null;
  try {
    return JSON.parse(readFileSync6(metaPath, "utf8"));
  } catch {
    return null;
  }
}
function writeMetaJson(meta) {
  const metaPath = getMetaJsonPath();
  mkdirSync4(dirname3(metaPath), { recursive: true });
  writeFileSync3(metaPath, `${JSON.stringify(meta, null, 2)}
`, "utf8");
}
function buildRelayAiConfig(proxyPort) {
  return {
    inferenceProvider: "gateway",
    inferenceGatewayBaseUrl: `http://127.0.0.1:${proxyPort}/anthropic`,
    inferenceGatewayApiKey: "dummy",
    inferenceGatewayAuthScheme: "bearer",
    coworkEgressAllowedHosts: ["*"]
  };
}
function writeRelayAiConfig(proxyPort) {
  const uuid = randomUUID7();
  const configPath = join12(getConfigLibraryPath(), `${uuid}.json`);
  const config = buildRelayAiConfig(proxyPort);
  mkdirSync4(dirname3(configPath), { recursive: true });
  writeFileSync3(configPath, `${JSON.stringify(config, null, 2)}
`, "utf8");
  const meta = readMetaJson() || { appliedId: "", entries: [] };
  meta.appliedId = uuid;
  if (!meta.entries.some((e) => e.id === uuid)) {
    meta.entries.push({ id: uuid, name: "Relay AI Gateway" });
  }
  writeMetaJson(meta);
  return uuid;
}

// src/claude-desktop/app-session.ts
import { existsSync as existsSync12, readFileSync as readFileSync7, rmSync as rmSync4, writeFileSync as writeFileSync4, copyFileSync as copyFileSync3, unlinkSync as unlinkSync2 } from "fs";
import { join as join13 } from "path";
function getSessionLockPath2() {
  return join13(getClaudeDesktopHome(), ".relay-ai.lock");
}
function readSessionLock2() {
  const path2 = getSessionLockPath2();
  if (!existsSync12(path2)) return null;
  try {
    const parsed = JSON.parse(readFileSync7(path2, "utf8"));
    if (typeof parsed.pid === "number" && typeof parsed.startedAt === "string") return parsed;
  } catch {
  }
  return null;
}
function writeSessionLock2(lock) {
  const path2 = getSessionLockPath2();
  writeFileSync4(path2, `${JSON.stringify(lock, null, 2)}
`, "utf8");
}
function isProcessAlive3(pid) {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function backupMetaJson() {
  const metaPath = getMetaJsonPath();
  const backupPath = `${metaPath}.bak`;
  if (existsSync12(metaPath)) {
    copyFileSync3(metaPath, backupPath);
  }
}
function restoreMetaJson() {
  const metaPath = getMetaJsonPath();
  const backupPath = `${metaPath}.bak`;
  if (existsSync12(backupPath)) {
    copyFileSync3(backupPath, metaPath);
    unlinkSync2(backupPath);
  }
}
function removeRelayAiConfig(uuid) {
  const configPath = join13(getConfigLibraryPath(), `${uuid}.json`);
  if (existsSync12(configPath)) {
    try {
      rmSync4(configPath, { force: true });
    } catch {
    }
  }
}
function hasStaleSession() {
  const lock = readSessionLock2();
  if (!lock) return false;
  if (!isProcessAlive3(lock.pid)) {
    return true;
  }
  return false;
}
function isConcurrentLiveSession() {
  const lock = readSessionLock2();
  if (!lock) return false;
  return isProcessAlive3(lock.pid);
}
function recoverSession() {
  const lock = readSessionLock2();
  if (lock) {
    restoreMetaJson();
    removeRelayAiConfig(lock.uuid);
    try {
      rmSync4(getSessionLockPath2(), { force: true });
    } catch {
    }
  } else {
    restoreMetaJson();
  }
}
function waitForShutdown4() {
  return new Promise((resolve) => {
    const cleanup = () => {
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
    };
    const onSigint = () => {
      cleanup();
      resolve("sigint");
    };
    const onSigterm = () => {
      cleanup();
      resolve("sigterm");
    };
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);
  });
}
function cleanupSession(uuid) {
  restoreMetaJson();
  removeRelayAiConfig(uuid);
  try {
    rmSync4(getSessionLockPath2(), { force: true });
  } catch {
  }
}
function setupExitCleanup(uuid) {
  process.on("exit", () => cleanupSession(uuid));
}

// src/claude-desktop/app-launch.ts
import { execSync as execSync5 } from "child_process";
import { existsSync as existsSync13, readdirSync as readdirSync4, statSync as statSync3 } from "fs";
import { homedir as homedir11 } from "os";
import { join as join14 } from "path";
import * as p17 from "@clack/prompts";
var CLAUDE_BUNDLE_ID = "com.anthropic.claudefordesktop";
function claudeAppSupported() {
  if (process.platform !== "darwin" && process.platform !== "win32") {
    throw new Error("Claude Desktop launch is supported on macOS and Windows only.");
  }
}
function run2(cmd, encoding = "utf8") {
  return execSync5(cmd, { encoding, stdio: ["pipe", "pipe", "pipe"] }).trim();
}
function runPowerShell2(script) {
  return run2(`powershell.exe -NoProfile -Command ${JSON.stringify(script)}`);
}
function darwinAppCandidates2() {
  return [
    "/Applications/Claude.app",
    join14(homedir11(), "Applications", "Claude.app")
  ];
}
function winLocalAppData2() {
  return process.env.LOCALAPPDATA ?? join14(homedir11(), "AppData", "Local");
}
function winClaudeExeCandidates() {
  const local = winLocalAppData2();
  const bases = [
    join14(local, "Programs", "Claude"),
    join14(local, "Claude")
  ];
  const out = [];
  for (const base of bases) {
    out.push(join14(base, "Claude.exe"));
    try {
      if (existsSync13(base)) {
        for (const name of readdirSync4(base)) {
          if (name.startsWith("app-")) {
            out.push(join14(base, name, "Claude.exe"));
          }
        }
      }
    } catch {
    }
  }
  return out;
}
function mdfindClaudeApp() {
  try {
    const out = run2(`mdfind "kMDItemCFBundleIdentifier == '${CLAUDE_BUNDLE_ID}'"`);
    const first = out.split("\n").map((l) => l.trim()).find(Boolean);
    return first && existsSync13(first) ? first : null;
  } catch {
    return null;
  }
}
function findClaudeApp() {
  if (process.platform === "darwin") {
    for (const path2 of darwinAppCandidates2()) {
      if (existsSync13(path2)) return path2;
    }
    return mdfindClaudeApp();
  }
  if (process.platform === "win32") {
    for (const path2 of winClaudeExeCandidates()) {
      try {
        if (existsSync13(path2) && statSync3(path2).isFile()) return path2;
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
  return false;
}
function sleep3(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function waitForQuit2(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (process.platform === "win32") {
      if (!winHasWindow2()) return true;
    } else if (!darwinIsRunning2()) {
      return true;
    }
    await sleep3(200);
  }
  return process.platform === "win32" ? !winHasWindow2() : !darwinIsRunning2();
}
function openClaudeAppAt(path2) {
  if (process.platform === "darwin") {
    if (path2.endsWith(".app")) {
      execSync5(`open ${JSON.stringify(path2)}`, { stdio: "inherit" });
    } else {
      execSync5(`open -b ${CLAUDE_BUNDLE_ID}`, { stdio: "inherit" });
    }
    return;
  }
  if (process.platform === "win32") {
    if (path2.startsWith("shell:AppsFolder\\")) {
      runPowerShell2(`Start-Process '${path2.replace(/'/g, "''")}'`);
    } else {
      runPowerShell2(`Start-Process -FilePath '${path2.replace(/'/g, "''")}'`);
    }
  }
}
function openClaudeApp() {
  const path2 = findClaudeApp();
  if (!path2) {
    throw new Error(
      "Claude Desktop App not found. Please install it first."
    );
  }
  openClaudeAppAt(path2);
}
function darwinQuit2() {
  try {
    execSync5(`osascript -e 'tell application "Claude" to quit'`, { stdio: "pipe" });
  } catch {
    execSync5(`osascript -e 'tell application id "${CLAUDE_BUNDLE_ID}" to quit'`, { stdio: "pipe" });
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
  const restart = await p17.confirm({ message: prompt, initialValue: true });
  if (p17.isCancel(restart) || !restart) {
    p17.log.info("Quit and reopen Claude Desktop when you are ready for the new model to take effect.");
    return;
  }
  if (process.platform === "darwin") darwinQuit2();
  else winQuitGraceful2();
  if (!await waitForQuit2(5e3)) {
    if (process.platform === "win32") winForceQuit2();
    await waitForQuit2(5e3);
  }
  if (appPath) openClaudeAppAt(appPath);
  else openClaudeApp();
}

// src/claude-app.ts
function claudeAppHelpText() {
  return `${pc14.bold("relay-ai claude-app")} \u2014 launch Claude Desktop app in 3P mode with your registry providers

${pc14.bold("Usage:")}
  relay-ai claude-app [options]
  relay-ai claude-app --trace
  relay-ai claude-app --restore
  relay-ai claude-app --help
  relay-ai claude-app --version

${pc14.bold("Options:")}
  --trace      Write proxy debug logs to ~/.relay-ai/logs/
  --restore    Restore Claude Desktop config after an interrupted app session
  --help       Show this command help
  --version    Show version

${pc14.bold("Description:")}
  Picks a provider and model from ~/.relay-ai/providers.json, patches Claude Desktop config
  (with backup + restore on Ctrl+C), starts a local Responses proxy, and opens
  the Claude Desktop app. Keep this terminal open while using Claude.

${pc14.bold("Platforms:")}
  macOS and Windows. Linux is not supported.

${pc14.bold("Cleanup:")}
  Ctrl+C stops the proxy and restores your previous Claude config.
  After a crash: relay-ai claude-app --restore
`;
}
function providerForClaudePicker(provider) {
  return { ...provider, models: routableModelsForProvider(provider, "codex-app") };
}
async function runClaudeAppCommand(args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(claudeAppHelpText());
    return 0;
  }
  if (args.includes("--restore")) {
    recoverSession();
    console.log("Restored Claude Desktop relay-ai config.");
    return 0;
  }
  const trace = args.includes("--trace");
  const debugLogPath = trace ? getProxyDebugLogPath() : void 0;
  if (trace) console.log(`Debug log: ${debugLogPath}`);
  try {
    claudeAppSupported();
  } catch (err) {
    console.error(pc14.red(String(err instanceof Error ? err.message : err)));
    return 1;
  }
  const isTty = Boolean(process.stdin.isTTY);
  if (!isTty) {
    console.error(pc14.red("relay-ai claude-app requires an interactive terminal."));
    return 1;
  }
  if (isConcurrentLiveSession()) {
    console.error(pc14.yellow(`Another relay-ai claude-app session may be running.`));
    console.error("Stop it with Ctrl+C in that terminal.");
    return 1;
  }
  if (hasStaleSession()) {
    p18.log.warn("Recovered from an interrupted claude-app session.");
    recoverSession();
  }
  const catalogSpinner = p18.spinner();
  catalogSpinner.start("Loading your providers...");
  let catalog;
  try {
    catalog = await fetchProviderCatalog({ agent: "codex-app" });
  } catch (err) {
    catalogSpinner.stop("");
    console.error(pc14.red(String(err instanceof Error ? err.message : err)));
    return 1;
  }
  catalogSpinner.stop("");
  const compatible = codexCompatibleProviders(providersForPicker(catalog), "codex-app");
  if (compatible.length === 0) {
    p18.log.warn("No compatible providers in your registry.");
    return 0;
  }
  const prefs = loadPreferences();
  const favorites = prefs.favoriteModels ?? [];
  const hasFavorites = favorites.length > 0;
  let activeProvider = null;
  let selectedModel = null;
  let useFavorites = false;
  const pickedProvider = await pickCodexProvider(compatible, prefs, hasFavorites);
  if (!pickedProvider) return 0;
  if (pickedProvider === "__favorites__") {
    useFavorites = true;
  } else {
    activeProvider = providerForClaudePicker(pickedProvider);
    const pickedModel = await pickCodexModel(activeProvider, prefs);
    if (!pickedModel) return 0;
    selectedModel = pickedModel;
    const regEntry = loadRegistry().providers.find((pr) => pr.id === activeProvider?.id);
    const authRef = regEntry?.authRef ?? (activeProvider.apiKey ? `keyring:provider:${activeProvider.id}` : oauthAuthRef(activeProvider.id));
    const apiKey = activeProvider.apiKey?.trim() || await resolveProviderCredential(activeProvider.id, authRef);
    if (!apiKey) {
      p18.log.error(`No credential for ${activeProvider.name}. Run relay-ai providers auth ${activeProvider.id}.`);
      return 1;
    }
    activeProvider.apiKey = apiKey;
  }
  let serverModels = [];
  if (useFavorites) {
    const allModels = await loadServerModels();
    serverModels = filterServerModelsByFavorites(allModels, favorites);
  } else {
    serverModels = [{
      id: selectedModel.id,
      name: selectedModel.name,
      isFree: selectedModel.isFree ?? false,
      brand: selectedModel.brand ?? "",
      providerLabel: activeProvider.name,
      providerId: activeProvider.id,
      sourceBackend: activeProvider.id,
      modelFormat: selectedModel.modelFormat,
      upstreamModelId: selectedModel.upstreamModelId,
      cost: selectedModel.cost,
      baseUrl: selectedModel.baseUrl,
      completionsUrl: selectedModel.completionsUrl,
      npm: selectedModel.npm,
      apiBaseUrl: selectedModel.apiBaseUrl,
      apiKey: activeProvider.apiKey,
      contextWindow: selectedModel.contextWindow
    }];
  }
  let proxyHandle = null;
  let sessionActive = false;
  try {
    backupMetaJson();
    proxyHandle = await startServer({
      host: "127.0.0.1",
      port: 0,
      // random port
      apiKey: "dummy",
      serverPassword: null,
      catalog: createGatewayModelCatalog(serverModels, { maskGatewayIds: true }),
      backends: BACKENDS,
      gateway: { maskGatewayIds: true },
      debugLogPath
    });
    const uuid = writeRelayAiConfig(proxyHandle.port);
    writeSessionLock2({
      pid: process.pid,
      startedAt: (/* @__PURE__ */ new Date()).toISOString(),
      uuid,
      proxyPort: proxyHandle.port
    });
    sessionActive = true;
    setupExitCleanup(uuid);
    if (!useFavorites) {
      const prevRecent = prefs.recentModelsByProvider?.[activeProvider.id] ?? [];
      const updatedRecent = [selectedModel.id, ...prevRecent.filter((id) => id !== selectedModel.id)].slice(0, 3);
      savePreferences({
        lastCodexProvider: activeProvider.id,
        lastCodexModel: selectedModel.id,
        recentModelsByProvider: { ...prefs.recentModelsByProvider, [activeProvider.id]: updatedRecent }
      });
    }
    console.log(`
${pc14.green("\u2714")} Proxy started on port ${proxyHandle.port}`);
    try {
      await launchOrRestartClaudeApp();
    } catch (err) {
      p18.log.warn(String(err instanceof Error ? err.message : err));
    }
    console.log(`
${pc14.bold("Claude Desktop 3P Mode Active")}`);
    if (useFavorites) {
      console.log(`${pc14.dim("Catalog:")}  Favorite models only`);
    } else {
      console.log(`${pc14.dim("Model:")}    ${selectedModel.id}`);
      console.log(`${pc14.dim("Provider:")} ${activeProvider.name}`);
    }
    console.log(`${pc14.cyan("Press Ctrl+C to stop and restore config.")}`);
    await waitForShutdown4();
    console.log("");
    cleanupSession(uuid);
    sessionActive = false;
    if (isClaudeAppRunning()) {
      const shouldClose = await p18.confirm({ message: "Claude Desktop is still running. Close it?" });
      if (shouldClose && !p18.isCancel(shouldClose)) {
        quitClaudeAppGracefully();
      }
    }
    return 0;
  } catch (err) {
    if (proxyHandle) await proxyHandle.close();
    if (sessionActive && proxyHandle) {
      cleanupSession(proxyHandle.port.toString());
    }
    return 1;
  }
}

// src/ai-doc.ts
import { existsSync as existsSync14, mkdirSync as mkdirSync5, readFileSync as readFileSync8, writeFileSync as writeFileSync5 } from "fs";
import { homedir as homedir12 } from "os";
import { join as join15 } from "path";
var SKILL_DIR_NAME = "relay-ai-cli";
var SKILL_INSTALL_DIRS = [
  join15(getAppHome(), "skills"),
  join15(homedir12(), ".claude", "skills"),
  join15(homedir12(), ".agents", "skills"),
  join15(homedir12(), ".codex", "skills"),
  join15(homedir12(), ".cursor", "skills"),
  join15(homedir12(), ".cursor", "skills-cursor")
];
function parseSkillVersion(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  for (const line of match[1].split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("version:")) continue;
    const raw = trimmed.slice("version:".length).trim();
    return raw.replace(/^["']|["']$/g, "");
  }
  return null;
}
function readInstalledSkillVersion(skillDir) {
  const skillPath = join15(skillDir, "SKILL.md");
  if (!existsSync14(skillPath)) return null;
  try {
    const head = readFileSync8(skillPath, "utf-8").slice(0, 1024);
    return parseSkillVersion(head.includes("---", 4) ? head : `${head}
---
`);
  } catch {
    return null;
  }
}
function skillInstallTargets() {
  return SKILL_INSTALL_DIRS.map((dir) => {
    const skillDir = join15(dir, SKILL_DIR_NAME);
    return { skillDir, skillPath: join15(skillDir, "SKILL.md") };
  });
}
function formatProviderModels(provider) {
  const models = provider.modelsCache?.models ?? [];
  if (models.length === 0) return `  (no cached models \u2014 run: relay-ai providers refresh-models ${provider.id})`;
  const lines = models.slice(0, 40).map((m) => `    ${m.id}${m.name !== m.id ? `  (${m.name})` : ""}`);
  if (models.length > 40) lines.push(`    ... and ${models.length - 40} more`);
  return lines.join("\n");
}
function buildLiveStateSection() {
  const prefs = loadPreferences();
  const registry = loadRegistry();
  const enabled = registry.providers.filter((p20) => p20.enabled);
  const prefLines = [];
  if (prefs.lastProvider || prefs.lastModel) {
    prefLines.push(`  Claude last launch: provider=${prefs.lastProvider ?? "(none)"} model=${prefs.lastModel ?? "(none)"}`);
  }
  if (prefs.lastCodexProvider || prefs.lastCodexModel) {
    prefLines.push(`  Codex last launch:  provider=${prefs.lastCodexProvider ?? "(none)"} model=${prefs.lastCodexModel ?? "(none)"}`);
  }
  if (prefs.lastGeminiProvider || prefs.lastGeminiModel) {
    prefLines.push(`  Gemini last launch: provider=${prefs.lastGeminiProvider ?? "(none)"} model=${prefs.lastGeminiModel ?? "(none)"}`);
  }
  if (prefs.favoriteModels?.length) {
    prefLines.push(`  Favorites (${prefs.favoriteModels.length}/${MAX_MODEL_CATALOG}):`);
    for (const f of prefs.favoriteModels) {
      prefLines.push(`    ${f.providerId} / ${f.modelId}`);
    }
  }
  const providerBlocks = enabled.length === 0 ? ["  No registry providers configured. Built-in cloud: zen, go (OpenCode Zen/Go)."] : enabled.map((p20) => [
    `  ${p20.name} (${p20.id}) \u2014 ${p20.modelsCache?.models.length ?? 0} cached model(s)`,
    formatProviderModels(p20)
  ].join("\n"));
  return `
================================================================================
CURRENT LOCAL STATE (from disk \u2014 no network)
================================================================================

Config:     ${getConfigPath()}
Providers:  ${getProvidersPath()}

Saved preferences:
${prefLines.length ? prefLines.join("\n") : "  (none \u2014 run an interactive launch first or pass --provider / --model)"}

Registry providers (enabled):
${providerBlocks.join("\n\n")}

Built-in cloud providers (always available when OPENCODE_API_KEY is set):
  zen  \u2014 OpenCode Zen (free + paid models)
  go   \u2014 OpenCode Go (paid models)

To refresh model lists after adding providers:
  relay-ai providers refresh-models
  relay-ai providers refresh-models <provider-id>

Zen/Go model IDs are fetched live at launch; run relay-ai claude --dry-run or
relay-ai codex --config to preview without starting a session.
`.trimEnd();
}
var cachedStaticAiDocBody = null;
function staticAiDocBody() {
  if (cachedStaticAiDocBody?.version === VERSION) return cachedStaticAiDocBody.body;
  const body = `
================================================================================
RELAY-AI \u2014 AI AGENT REFERENCE (v${VERSION})
================================================================================

relay-ai launches Claude Code, OpenAI Codex, Google Gemini CLI, and desktop apps
against YOUR provider registry (Groq, Mistral, OpenAI, Zen/Go, Ollama, custom endpoints, \u2026).
It handles API translation, local proxies, env isolation, and model routing.

SKILL VERSIONING
  The installed skill version matches relay-ai --version (currently v${VERSION}).
  After upgrading relay-ai, run:
    relay-ai --ai --install
  Installs are skipped when the skill is already at the current version.
  Use --force to rewrite anyway (e.g. after editing providers without a release).

WHEN UNSURE: run \`relay-ai --ai\` before exploring or guessing commands.

================================================================================
QUICK START FOR AI AGENTS
================================================================================

1. Discover providers and model IDs (see DISCOVERY section below).
2. Launch non-interactively with boot flags \u2014 skip all wizards:
     relay-ai claude --provider <id> --model <model-id> -p "<prompt>"
     relay-ai codex --provider <id> --model <model-id> exec "<prompt>"
3. To query many models/tools in a loop, call relay-ai once per model with -p
   (Claude) or exec (Codex). Each invocation is a separate one-shot session.
4. For a persistent HTTP gateway (scripts, other tools): relay-ai server

================================================================================
DISCOVERY \u2014 PROVIDERS AND MODELS
================================================================================

LIST CONFIGURED PROVIDERS (human-readable):
  relay-ai providers list

MACHINE-READABLE MODEL CATALOG (recommended for agents):
  Read ~/.relay-ai/providers.json
    \u2192 providers[].id          provider id for --provider
    \u2192 providers[].modelsCache.models[].id   model id for --model
    \u2192 providers[].enabled     skip if false

REFRESH STALE MODEL LISTS:
  relay-ai providers refresh-models
  relay-ai providers refresh-models groq

BUILT-IN CLOUD PROVIDERS (not in providers.json):
  Provider id: zen   (OpenCode Zen \u2014 requires OPENCODE_API_KEY)
  Provider id: go    (OpenCode Go \u2014 requires OPENCODE_API_KEY)

PREVIEW LAUNCH WITHOUT STARTING A SESSION:
  relay-ai claude --dry-run --provider groq --model <model-id>
  relay-ai codex --config --provider zen --model <model-id>

INTERACTIVE BROWSE (requires TTY \u2014 avoid in agent scripts):
  relay-ai claude          provider + model wizard
  relay-ai codex           provider + model wizard
  relay-ai gemini          provider + model wizard
  relay-ai providers       provider management hub

================================================================================
AGENT PLATFORM PATTERNS \u2014 MULTI-MODEL / ONE-SHOT QUERIES
================================================================================

relay-ai is designed so agents can use Claude Code, Codex, or Gemini CLI as a PLATFORM:
run many models sequentially or in parallel shell jobs, each with a focused
prompt, without interactive wizards.

CLAUDE CODE \u2014 PRINT MODE (-p / --print)
  Skips the provider/model wizard when:
    \u2022 Both --provider and --model are set, OR
    \u2022 Print mode (-p / --print) and saved preferences exist from a prior launch

  Examples:
    relay-ai claude --provider groq --model llama-3.3-70b-versatile -p "Summarize README.md"
    relay-ai claude --provider zen --model deepseek-v4-flash-free -p "Review this diff"
    relay-ai claude -p "quick question"    # uses lastProvider + lastModel from config

  Pass additional Claude Code flags after relay-ai flags:
    relay-ai claude --provider groq --model llama-3.3-70b-versatile -p "task" --output-format json

  Machine-readable stdout (relay-ai stays silent on stdout \u2014 boot UI goes to stderr):
    relay-ai claude --provider zen --model deepseek-v4-flash-free -p "task" --output-format stream-json
    relay-ai codex --provider zen --model deepseek-v4-flash-free exec --json "task"

  Triggers clean stdout:
    Claude: -p/--print + (--output-format stream-json|json OR --input-format stream-json)
    Codex:  exec subcommand + --json

  relay-ai auto-adds --verbose when Claude uses stream-json without it.
  Interactive TTY launches (no stream-json / exec --json) still show normal human UI.

  Boot flags (relay-ai \u2014 NOT passed to Claude):
    --provider <id>     Provider id (from providers list or providers.json)
    --model <id>        Model id, or slug form: provider__model-id

OPENAI CODEX \u2014 NON-INTERACTIVE (exec / positional prompt)
  Skips the provider/model wizard when:
    \u2022 Both --provider and --model are set, OR
    \u2022 Non-interactive args (exec subcommand or positional prompt) and saved prefs exist

  Examples:
    relay-ai codex --provider zen --model deepseek-v4-flash-free exec "fix the failing test"
    relay-ai codex --model zen__deepseek-v4-flash-free exec "fix the bug"
    relay-ai codex --provider openai --model gpt-5.4 exec "implement feature X"

  Codex does NOT use -p for print \u2014 relay-ai blocks -p (Codex uses it for --profile).

  Boot flags (relay-ai \u2014 NOT passed to Codex):
    --provider <id>
    --model <id>        or provider__model-id slug

GOOGLE GEMINI CLI \u2014 NON-INTERACTIVE (-p / --prompt)
  Skips the provider/model wizard when:
    \u2022 Both --provider and --model are set, OR
    \u2022 Non-interactive args (-p / --prompt, -i / --prompt-interactive, or positional query)
      and saved preferences exist

  Examples:
    relay-ai gemini --provider google --model gemini-2.5-flash -p "Review this file"
    relay-ai gemini -p "What is the capital of France?"

  Machine-readable stdout:
    relay-ai gemini --provider google --model gemini-2.5-flash -p "task" -o json
    relay-ai gemini --provider google --model gemini-2.5-flash -p "task" -o stream-json

  Boot flags (relay-ai \u2014 NOT passed to Gemini):
    --provider <id>
    --model <id>        or provider__model-id slug

MULTI-MODEL LOOP (shell pattern):
  for model in llama-3.3-70b-versatile mixtral-8x7b-32768; do
    relay-ai claude --provider groq --model "$model" -p "Same prompt for all models"
  done

  for model in deepseek-v4-flash-free qwen3.6-plus-free; do
    relay-ai codex --provider zen --model "$model" exec "Same task"
  done

  for model in gemini-2.5-flash gemini-2.5-pro; do
    relay-ai gemini --provider google --model "$model" -p "Same task"
  done

FAVORITES / MID-SESSION SWITCHING:
  relay-ai models              interactive favorites manager (max ${MAX_MODEL_CATALOG})
  When favorites exist, interactive claude/codex/gemini launches expose /model switching.
  Boot flags (--provider + --model) or print/exec/-p mode use SINGLE-MODEL launch
  (favorites catalog is skipped \u2014 better for agent one-shots).

================================================================================
COMMANDS
================================================================================

ROOT
  relay-ai --ai              Print this reference (stdout)
  relay-ai --ai --install    Install or upgrade SKILL.md when relay-ai version changed
  relay-ai --ai --install --force  Reinstall skill even if version already matches
  relay-ai --help            Short human help
  relay-ai --version         Version string

CLAUDE CODE
  relay-ai claude [relay-options] [claude-flags]

  Relay options:
    --provider <id>    Boot provider (skip wizard with --model)
    --model <id>       Boot model id or provider__model slug
    --dry-run          Preview launch, do not start Claude
    --trace            Debug logs in ~/.relay-ai/logs/
    --setup            Hint to use relay-ai providers

  Common Claude flags (passed through):
    -p, --print         One-shot print mode (agent-friendly)
    -c                  Continue previous session
    --resume <id>       Resume session
    --model <id>        Claude's own model flag (overridden by relay-ai at launch)

  Examples:
    relay-ai claude
    relay-ai claude --provider anthropic --model claude-sonnet-4-6 -p "review file.ts"
    relay-ai claude --dry-run --provider groq --model llama-3.3-70b-versatile

GOOGLE GEMINI CLI
  relay-ai gemini [relay-options] [gemini-flags]

  Relay options:
    --provider <id>    Boot provider (skip wizard with --model)
    --model <id>       Boot model id or provider__model slug
    --trace            Debug logs in ~/.relay-ai/logs/

  Examples:
    relay-ai gemini
    relay-ai gemini --provider google --model gemini-2.5-flash -p "What is the capital of France?"

OPENAI CODEX CLI
  relay-ai codex [relay-options] [codex-flags]

  Relay options:
    --provider <id>
    --model <id>
    --trace
    --restore          Remove leftover overlay files after crash
    --config           Write profile/catalog files and exit (no Codex process)

  relay-ai manages: --profile, -m, -p (profile), --provider, --model
  Sandbox defaults to danger-full-access (profile + -s flag) for network shell tools.
  Override with -s workspace-write or pass --dangerously-bypass-approvals-and-sandbox.

  Examples:
    relay-ai codex
    relay-ai codex --provider zen --model deepseek-v4-flash-free exec "fix bug"
    relay-ai codex --provider zen --model deepseek-v4-flash-free exec --json "fix bug"
    relay-ai codex -s workspace-write exec "locked down"
    relay-ai codex --trace
    relay-ai codex --restore

PROVIDERS REGISTRY
  relay-ai providers              interactive hub
  relay-ai providers add          add Groq, Mistral, OpenAI, custom URL, \u2026
  relay-ai providers import       one-time import from OpenCode config
  relay-ai providers list         show provider ids and model counts
  relay-ai providers remove <id>
  relay-ai providers refresh-models [id]
  relay-ai providers auth <id>    OAuth (OpenAI ChatGPT, xAI, \u2026)

MODELS / FAVORITES
  relay-ai models                 manage favoriteModels in config (alias: favorites)
  Used for mid-session /model switching in interactive Claude/Codex/Gemini sessions.

API GATEWAY (for tools that speak Anthropic/OpenAI HTTP)
  relay-ai server                 foreground gateway on port 17645
  relay-ai server --vertex        Vertex AI gateway (gcloud ADC)

DESKTOP APPS
  relay-ai codex-app              Codex desktop (macOS/Windows)
  relay-ai claude-app             Claude desktop (macOS/Windows)

================================================================================
CONFIGURATION PATHS
================================================================================

  ~/.relay-ai/config.json         preferences (lastProvider, lastModel, favorites, \u2026)
  ~/.relay-ai/providers.json      provider registry + cached model lists (no secrets)
  ~/.relay-ai/logs/               trace/debug logs when --trace is used
  OPENCODE_API_KEY                required for zen/go cloud providers
  RELAY_AI_HOME                   override ~/.relay-ai

Credentials live in OS keychain (macOS/Windows/Linux Secret Service), not in
providers.json. Use relay-ai providers auth or add flows to configure keys.

================================================================================
AGENT RULES OF THUMB
================================================================================

DO:
  \u2022 Run relay-ai --ai when unsure about commands or model ids
  \u2022 Use --provider + --model for every non-interactive agent invocation
  \u2022 Use Claude -p / Codex exec for one-shot tasks that must exit
  \u2022 Read providers.json for authoritative model id lists
  \u2022 Run relay-ai providers refresh-models after adding providers

DO NOT:
  \u2022 Rely on interactive wizards in CI, scripts, or headless agent loops
  \u2022 Pass --provider / --model to Claude, Codex, or Gemini directly \u2014 relay-ai consumes them
  \u2022 Use Codex -p expecting print mode (it means --profile in Codex)
  \u2022 Assume favorites catalog in print/exec/-p mode \u2014 use explicit boot flags
  \u2022 Mutate settings files (e.g. ~/.claude/settings.json, ~/.codex/config.toml, ~/.gemini/config/config.json) \u2014 relay-ai uses env +
    temporary overlay profiles only

NON-TTY:
  relay-ai codex requires --provider + --model (or saved prefs) when stdin is not
  a TTY. relay-ai claude print mode (-p) skips wizard with prefs or boot flags.

================================================================================
TROUBLESHOOTING
================================================================================

  relay-ai codex --restore         clean stale overlay after crash
  relay-ai claude --trace          proxy + Claude debug logs
  relay-ai codex --trace           proxy debug log on exit
  relay-ai gemini --trace          proxy debug log on exit
  relay-ai providers list          verify provider ids
  relay-ai providers refresh-models  repopulate model cache

Common errors:
  "Provider/model not found"       wrong id \u2014 check providers.json or providers list
  "Print mode requires \u2026"          set --provider and --model, or run interactive once
  "requires an interactive terminal"  add --provider and --model for codex in CI
  JSON parse error on stdout line 1  missing stream-json (Claude) or exec --json (Codex)
  404 unknown model (Codex favs)   ensure zen/go routes \u2014 use --provider zen explicitly
  DeepSeek tool loop 400           update relay-ai \u2014 reasoning round-trip in Codex proxy
  Codex shell network blocked      default is danger-full-access; check relay-ai codex --config

Human-readable guide: docs/AI-AGENTS.md in the relay-ai repo.

================================================================================
ALEF AGENT INTEGRATION
================================================================================

alef-agent shells out to relay-ai to run Claude Code, Codex, or Gemini CLI against any
provider in ~/.relay-ai/providers.json. relay-ai is a launcher + proxy; the
child CLI owns NDJSON/JSONL on stdout.

WHEN TO USE RELAY-AI AS THE EXECUTABLE
  Instead of spawning claude or codex directly, spawn relay-ai with boot flags
  prepended. alef parses stdout as JSONL; relay-ai must not pollute stdout.

STDOUT / STDERR CONTRACT
  Machine-readable mode (Claude stream-json/json, Codex exec --json):
    stdout \u2192 child JSON only (every non-empty line must parse as JSON)
    stderr \u2192 relay-ai boot messages and errors (log or discard; do not parse)
    exit code \u2192 relay-ai launch failure OR child exit code

  Human interactive mode (relay-ai claude with no -p):
    stdout \u2192 normal TUI (do not parse as JSON)

RECOMMENDED SPAWN \u2014 CLAUDE BACKEND (NDJSON)
  relay-ai claude \\
    --provider <provider-id> \\
    --model <model-id> \\
    -p "<prompt>" \\
    --output-format stream-json \\
    [--verbose] \\
    [--max-turns N] \\
    [--permission-mode bypassPermissions] \\
    [--allow-dangerously-skip-permissions] \\
    [--allowed-tools tool1,tool2]

  Slug alternative:
    relay-ai claude --model zen__deepseek-v4-flash-free -p "..." --output-format stream-json

  relay-ai injects --verbose automatically when stream-json is used without it.

RECOMMENDED SPAWN \u2014 CODEX BACKEND (JSONL)
  relay-ai codex \\
    --provider <provider-id> \\
    --model <model-id> \\
    exec --json "<prompt>"

  Slug alternative:
    relay-ai codex --model zen__deepseek-v4-flash-free exec --json "..."

  Do NOT use -p for Codex print \u2014 Codex -p means --profile (relay-ai blocks it).

PROVIDER / MODEL DISCOVERY FOR ALEF CONFIG
  1. relay-ai providers list
  2. Read ~/.relay-ai/providers.json \u2192 providers[].id, modelsCache.models[].id
  3. relay-ai providers refresh-models  (after adding providers)
  4. Built-ins: zen, go (require OPENCODE_API_KEY in env or keychain)
  5. relay-ai --ai  (includes live state section at bottom of output)

ALEF CHECKLIST
  \u25A1 relay-ai on PATH (npm install -g @jacobbd/relay-ai; dev: npm link after builds)
  \u25A1 Always pass --provider + --model (or provider__model slug) \u2014 never rely on wizard
  \u25A1 Claude: --output-format stream-json (or json) with -p
  \u25A1 Codex: exec --json (not bare codex exec without --json if parsing stdout)
  \u25A1 Gemini: -o json (or stream-json) with -p
  \u25A1 Parse stdout only; ignore stderr for JSONL/NDJSON stream
  \u25A1 Zen/Go: --provider zen explicitly + OPENCODE_API_KEY available
  \u25A1 Codex network: default danger-full-access \u2014 no extra -s needed for nlm/curl/npm
  \u25A1 MCP (Claude): --allowed-tools mcp__server__tool on claude args after relay-ai flags
  \u25A1 MCP (Codex): configure in ~/.codex/config.toml (relay-ai does not inject MCP list)
  \u25A1 Install skill for agents: relay-ai --ai --install

VERIFY CLEAN STDOUT (run before wiring alef backend)
  relay-ai claude --provider zen --model deepseek-v4-flash-free \\
    -p "PONG" --output-format stream-json 2>/dev/null \\
    | node -e "process.stdin.on('data',d=>d.toString().split('\\\\n').filter(Boolean).forEach(l=>JSON.parse(l))); console.log('claude ok')"

  relay-ai codex --provider zen --model deepseek-v4-flash-free \\
    exec --json "PONG" 2>/dev/null \\
    | node -e "process.stdin.on('data',d=>d.toString().split('\\\\n').filter(Boolean).forEach(l=>JSON.parse(l))); console.log('codex ok')"

MULTI-MODEL ALEF LOOPS
  Each relay-ai invocation is one session. Loop in alef/shell with different --model values.
  Favorites catalog is NOT used in print/exec mode \u2014 always explicit boot flags.

TOOL CALLING EXAMPLE (Claude + MCP)
  relay-ai claude --provider google --model gemini-2.5-flash \\
    -p "How many notebooks?" \\
    --output-format stream-json \\
    --allowed-tools mcp__notebooklm-mcp__notebook_list

RELATED DOCS
  docs/AI-AGENTS.md     human-readable agent guide (this repo)
  docs/CODEX.md         Codex CLI, sandbox, restore, routing
  relay-ai --ai         full reference + live provider state
`.trimEnd();
  cachedStaticAiDocBody = { version: VERSION, body };
  return body;
}
function generateAiDoc() {
  const frontmatter = `---
name: relay-ai-cli
description: "Launch Claude Code and OpenAI Codex against your AI provider registry. Use for alef-agent, multi-model agent workflows, NDJSON stream-json, and non-interactive codex exec --json."
version: "${VERSION}"
type: tool
status: approved
---

# relay-ai CLI Reference (v${VERSION})

`;
  return frontmatter + staticAiDocBody() + "\n\n" + buildLiveStateSection() + "\n";
}
function installAiDoc(opts = {}) {
  const version = VERSION;
  const result = {
    version,
    installed: [],
    updated: [],
    skipped: [],
    failed: []
  };
  const targets = skillInstallTargets();
  if (!opts.force && targets.every(({ skillDir }) => readInstalledSkillVersion(skillDir) === version)) {
    result.skipped.push(...targets.map((t) => t.skillPath));
    return result;
  }
  const doc = generateAiDoc();
  for (const { skillDir, skillPath } of targets) {
    try {
      const previous = readInstalledSkillVersion(skillDir);
      if (!opts.force && previous === version) {
        result.skipped.push(skillPath);
        continue;
      }
      mkdirSync5(skillDir, { recursive: true });
      writeFileSync5(skillPath, doc, "utf-8");
      if (previous) {
        result.updated.push({ path: skillPath, fromVersion: previous });
      } else {
        result.installed.push(skillPath);
      }
    } catch {
      result.failed.push(skillPath);
    }
  }
  return result;
}
function printAiInstallResult(result) {
  console.error(`relay-ai agent skill target version: v${result.version}`);
  if (result.installed.length > 0) {
    console.error(`Installed ${result.installed.length} new skill(s):`);
    for (const path2 of result.installed) console.error(`  \u2713 ${path2}`);
  }
  if (result.updated.length > 0) {
    console.error(`Updated ${result.updated.length} skill(s):`);
    for (const { path: path2, fromVersion } of result.updated) {
      const from = fromVersion ? `v${fromVersion}` : "unknown";
      console.error(`  \u2713 ${path2} (${from} \u2192 v${result.version})`);
    }
  }
  if (result.skipped.length > 0) {
    console.error(`Skipped ${result.skipped.length} (already v${result.version}):`);
    for (const path2 of result.skipped) console.error(`  \xB7 ${path2}`);
  }
  if (result.failed.length > 0) {
    console.error(`Failed ${result.failed.length}:`);
    for (const path2 of result.failed) console.error(`  \u2717 ${path2}`);
  }
  return result.failed.length > 0 ? 1 : 0;
}

// src/cli.ts
var STARTER_CLAUDE_FLAGS = /* @__PURE__ */ new Set(["--dry-run", "--setup", "--trace", "--help", "-h", "--version", "-v"]);
var RELAY_LAUNCH_FLAGS = /* @__PURE__ */ new Set(["--provider", "--model"]);
function parseRelayLaunchFlag(arg, rest, index, parsed) {
  if (arg === "--provider" || arg === "--model") {
    const value = rest[index + 1];
    if (!value || value.startsWith("-")) {
      parsed.error = `Missing value for ${arg}`;
      return "error";
    }
    if (arg === "--provider") parsed.launchProvider = value;
    else parsed.launchModel = value;
    return index + 1;
  }
  if (arg.startsWith("--provider=")) {
    parsed.launchProvider = arg.slice("--provider=".length);
    return index;
  }
  if (arg.startsWith("--model=")) {
    parsed.launchModel = arg.slice("--model=".length);
    return index;
  }
  return index;
}
function tryConsumeRelayLaunchFlag(arg, rest, index, parsed) {
  if (!RELAY_LAUNCH_FLAGS.has(arg) && !arg.startsWith("--provider=") && !arg.startsWith("--model=")) {
    return null;
  }
  const next = parseRelayLaunchFlag(arg, rest, index, parsed);
  if (next === "error") return { error: true };
  return { next };
}
function emptyParsed(command) {
  return {
    command,
    showHelp: false,
    showVersion: false,
    dryRun: false,
    setup: false,
    trace: false,
    vertex: false,
    claudeArgs: []
  };
}
function parseArgs(args) {
  if (args.includes("--ai")) {
    return {
      ...emptyParsed("root"),
      showAi: true,
      aiInstall: args.includes("--install"),
      aiInstallForce: args.includes("--force")
    };
  }
  if (args.length === 0) return { ...emptyParsed("root"), showHelp: true };
  const [first, ...rest] = args;
  if (first === "--help" || first === "-h") {
    return { ...emptyParsed("root"), showHelp: true };
  }
  if (first === "--version" || first === "-v") {
    return { ...emptyParsed("root"), showVersion: true };
  }
  if (first === "server") {
    const parsed2 = emptyParsed("server");
    for (const arg of rest) {
      if (arg === "--help" || arg === "-h") parsed2.showHelp = true;
      else if (arg === "--version" || arg === "-v") parsed2.showVersion = true;
      else if (arg === "--vertex") parsed2.vertex = true;
      else if (!parsed2.error) parsed2.error = `Unknown server option: ${arg}`;
    }
    return parsed2;
  }
  if (first === "models" || first === "favorites") {
    const parsed2 = emptyParsed("models");
    for (const arg of rest) {
      if (arg === "--help" || arg === "-h") parsed2.showHelp = true;
      else if (arg === "--version" || arg === "-v") parsed2.showVersion = true;
      else if (arg === "--agy") parsed2.favoritesAgy = true;
      else if (!parsed2.error) parsed2.error = `Unknown models option: ${arg}`;
    }
    return parsed2;
  }
  if (first === "providers") {
    const parsed2 = emptyParsed("providers");
    parsed2.claudeArgs = [];
    for (const arg of rest) {
      if (arg === "--trace") parsed2.trace = true;
      else if (arg === "--help" || arg === "-h") parsed2.showHelp = true;
      else if (arg === "--version" || arg === "-v") parsed2.showVersion = true;
      else parsed2.claudeArgs.push(arg);
    }
    return parsed2;
  }
  if (first === "ui") {
    const parsed2 = emptyParsed("ui");
    for (const arg of rest) {
      if (arg === "--help" || arg === "-h") parsed2.showHelp = true;
      else if (arg === "--version" || arg === "-v") parsed2.showVersion = true;
      else if (!parsed2.error) parsed2.error = `Unknown ui option: ${arg}`;
    }
    return parsed2;
  }
  if (first === "codex-app") {
    const parsed2 = emptyParsed("codex-app");
    parsed2.claudeArgs = rest;
    for (const arg of rest) {
      if (arg === "--help" || arg === "-h") parsed2.showHelp = true;
      else if (arg === "--version" || arg === "-v") parsed2.showVersion = true;
      else if (arg === "--vertex") parsed2.vertex = true;
    }
    return parsed2;
  }
  if (first === "claude-app") {
    const parsed2 = emptyParsed("claude-app");
    parsed2.claudeArgs = rest;
    for (const arg of rest) {
      if (arg === "--help" || arg === "-h") parsed2.showHelp = true;
      else if (arg === "--version" || arg === "-v") parsed2.showVersion = true;
    }
    return parsed2;
  }
  if (first === "codex") {
    const parsed2 = emptyParsed("codex");
    for (let i = 0; i < rest.length; i += 1) {
      const arg = rest[i];
      if (arg === "--trace") {
        parsed2.trace = true;
        continue;
      }
      if (arg === "--vertex") {
        parsed2.vertex = true;
        continue;
      }
      if (arg === "--help" || arg === "-h") {
        parsed2.showHelp = true;
        continue;
      }
      if (arg === "--version" || arg === "-v") {
        parsed2.showVersion = true;
        continue;
      }
      const consumed = tryConsumeRelayLaunchFlag(arg, rest, i, parsed2);
      if (consumed !== null) {
        if ("error" in consumed) return parsed2;
        i = consumed.next;
        continue;
      }
      parsed2.claudeArgs.push(arg);
    }
    return parsed2;
  }
  if (first === "gemini") {
    const parsed2 = emptyParsed("gemini");
    for (let i = 0; i < rest.length; i += 1) {
      const arg = rest[i];
      if (arg === "--trace") {
        parsed2.trace = true;
        continue;
      }
      if (arg === "--help" || arg === "-h") {
        parsed2.showHelp = true;
        continue;
      }
      if (arg === "--version" || arg === "-v") {
        parsed2.showVersion = true;
        continue;
      }
      const consumed = tryConsumeRelayLaunchFlag(arg, rest, i, parsed2);
      if (consumed !== null) {
        if ("error" in consumed) return parsed2;
        i = consumed.next;
        continue;
      }
      parsed2.claudeArgs.push(arg);
    }
    return parsed2;
  }
  if (first === "agy") {
    const parsed2 = emptyParsed("agy");
    for (let i = 0; i < rest.length; i += 1) {
      const arg = rest[i];
      if (arg === "--") {
        parsed2.claudeArgs.push(...rest.slice(i + 1));
        break;
      }
      if (arg === "--trace") {
        parsed2.trace = true;
        continue;
      }
      if (arg === "--help" || arg === "-h") {
        parsed2.showHelp = true;
        continue;
      }
      if (arg === "--version" || arg === "-v") {
        parsed2.showVersion = true;
        continue;
      }
      const consumed = tryConsumeRelayLaunchFlag(arg, rest, i, parsed2);
      if (consumed !== null) {
        if ("error" in consumed) return parsed2;
        i = consumed.next;
        continue;
      }
      parsed2.claudeArgs.push(arg);
    }
    return parsed2;
  }
  if (first === "antigravity-ide") {
    const parsed2 = emptyParsed("antigravity-ide");
    for (let i = 0; i < rest.length; i += 1) {
      const arg = rest[i];
      if (arg === "--") {
        parsed2.claudeArgs.push(...rest.slice(i + 1));
        break;
      }
      if (arg === "--trace") {
        parsed2.trace = true;
        continue;
      }
      if (arg === "--help" || arg === "-h") {
        parsed2.showHelp = true;
        continue;
      }
      if (arg === "--version" || arg === "-v") {
        parsed2.showVersion = true;
        continue;
      }
      const consumed = tryConsumeRelayLaunchFlag(arg, rest, i, parsed2);
      if (consumed !== null) {
        if ("error" in consumed) return parsed2;
        i = consumed.next;
        continue;
      }
      parsed2.claudeArgs.push(arg);
    }
    return parsed2;
  }
  if (first !== "claude") {
    return {
      ...emptyParsed("root"),
      error: first.startsWith("-") ? `Unknown root option: ${first}` : `Unknown command: ${first}`
    };
  }
  const parsed = emptyParsed("claude");
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--") {
      parsed.claudeArgs.push(...rest.slice(i + 1));
      break;
    }
    const consumed = tryConsumeRelayLaunchFlag(arg, rest, i, parsed);
    if (consumed !== null) {
      if ("error" in consumed) return parsed;
      i = consumed.next;
      continue;
    }
    if (!STARTER_CLAUDE_FLAGS.has(arg)) {
      parsed.claudeArgs.push(arg);
      continue;
    }
    if (arg === "--dry-run") parsed.dryRun = true;
    if (arg === "--setup") parsed.setup = true;
    if (arg === "--trace") parsed.trace = true;
    if (arg === "--help" || arg === "-h") parsed.showHelp = true;
    if (arg === "--version" || arg === "-v") parsed.showVersion = true;
  }
  return parsed;
}
function rootHelpText() {
  return `${pc15.bold("relay-ai")} v${VERSION}
Launch AI coding tools with OpenCode Zen / Go or local providers (Groq, Mistral,
OpenAI, Gemini, Ollama, and more).

${pc15.bold("Usage:")}
  relay-ai claude [options] [claude-flags]
  relay-ai claude-app [options]
  relay-ai codex [options] [codex-flags]
  relay-ai codex-app [options]
  relay-ai gemini [options] [gemini-flags]
  relay-ai agy [options] [agy-flags]
  relay-ai antigravity-ide [options]
  relay-ai server [options]
  relay-ai ui
  relay-ai models
  relay-ai favorites
  relay-ai providers
  relay-ai --help
  relay-ai --version
  relay-ai --ai              Full reference for AI agents (run this when unsure)
  relay-ai --ai --install    Install or upgrade agent skill when version changed
  relay-ai --ai --install --force  Reinstall skill even if already current

${pc15.bold("Root options:")}
  -h, --help       Show this help
  -v, --version    Show version
  --ai             Print the full reference for AI agents
  --ai --install   Install or upgrade the relay-ai agent skill
  --force          Reinstall the agent skill when used with --ai --install

${pc15.bold("Commands:")}
  claude      Launch Claude Code \u2014 pick a provider from your registry
  models      Manage favorite models for mid-session /model switching (max ${MAX_MODEL_CATALOG})
  favorites   Alias for models
  providers   Add, import, and manage your AI providers
  server      Run a foreground API gateway (OpenCode Zen / Go and local providers)
  codex       Launch OpenAI Codex CLI with registry providers
  gemini      Launch Google Gemini CLI with registry providers
  agy         Launch Antigravity CLI with registry providers
  antigravity-ide  Launch Antigravity IDE with registry providers (macOS)
  codex-app   Launch Codex desktop app with registry providers (macOS + Windows)
  claude-app  Launch Claude Desktop app with registry providers (macOS + Windows)

${pc15.bold("Migration:")}
  Bare relay-ai prints this help instead of launching Claude Code.
  Use relay-ai claude for the wizard and launcher.

${pc15.bold("Examples:")}
  relay-ai claude
  relay-ai models
  relay-ai providers
  relay-ai codex
  relay-ai gemini
  relay-ai agy
  relay-ai antigravity-ide
  relay-ai codex-app
  relay-ai claude-app
  relay-ai server
  relay-ai claude -c
  relay-ai claude --resume abc-123
  relay-ai claude -- --print "hello"`;
}
function claudeHelpText() {
  return `${pc15.bold("relay-ai claude")} v${VERSION}
Launch Claude Code with OpenCode Zen, Go, or local providers as the API backend.

${pc15.bold("Usage:")}
  relay-ai claude [options] [claude-flags]
  relay-ai claude --help
  relay-ai claude --version

${pc15.bold("Options:")}
  --dry-run    Run the wizard but show a preview instead of launching Claude Code
  --setup      Hint: use relay-ai providers to add or manage providers
  --trace      Write debug logs to ~/.relay-ai/logs/ and show errors on exit
  --provider   Boot provider id (skip wizard when paired with --model or in print mode)
  --model      Boot model id (skip wizard when paired with --provider or in print mode)
  --help       Show this command help
  --version    Show version

${pc15.bold("Providers:")}
  Cloud (Zen/Go)  Requires OPENCODE_API_KEY \u2014 get one at https://opencode.ai/auth
  Registry        Configure with relay-ai providers add or import (Groq, Mistral,
                  Nvidia, DeepSeek, OpenAI, custom endpoints, etc.).

${pc15.bold("Model switching:")}
  Run relay-ai models to save favorites (max ${MAX_MODEL_CATALOG}).
  When favorites exist, launch starts a multi-route proxy and Claude Code /model
  lists your starting model plus favorites for live switching.
  With no favorites, launch uses a single model as before.

${pc15.bold("Note:")}
  Claude Code may save the launched model to ~/.claude/settings.json.
  Bare claude later can still show that model \u2014 reset with claude --model sonnet.

${pc15.bold("Examples:")}
  relay-ai claude
  relay-ai claude -c
  relay-ai claude --resume abc-123
  relay-ai claude abc-123
  relay-ai claude --dry-run -c
  relay-ai claude --setup
  relay-ai claude --trace --resume abc-123
  relay-ai claude --provider groq --model llama-3.3-70b-versatile
  relay-ai claude --provider groq --model llama-3.3-70b-versatile -p "review this file"
  relay-ai claude -- --print "hello"
  relay-ai claude -- --dangerously-skip-permissions`;
}
function serverHelpText() {
  return `${pc15.bold("relay-ai server")} v${VERSION}
Run a foreground API gateway for registry providers, Zen/Go, or Vertex AI.

${pc15.bold("Usage:")}
  relay-ai server
  relay-ai server --vertex
  relay-ai server --help
  relay-ai server --version

${pc15.bold("Behavior:")}
  Default: interactive wizard for exposed providers, discovery id masking (for
  Claude Desktop / Cowork), optional favorites-only catalog, then listen mode.
  --vertex: Anthropic-compatible gateway to Claude on Google Vertex AI using
  local gcloud Application Default Credentials (no OpenCode API key).
  Binds to port 17645. Network mode asks for a server password.

${pc15.bold("Vertex env:")}
  ANTHROPIC_VERTEX_PROJECT_ID or GOOGLE_CLOUD_PROJECT \u2014 your GCP project
  GOOGLE_CLOUD_LOCATION or CLOUD_ML_REGION \u2014 region (default: global)
  Optional catalog: ~/.relay-ai/vertex-models.json (see assets/vertex-models.example.json)

${pc15.bold("Endpoints:")}
  Anthropic-compatible:  ANTHROPIC_BASE_URL=http://127.0.0.1:17645/anthropic
  OpenAI-compatible:     OPENAI_BASE_URL=http://127.0.0.1:17645/openai/v1
  API key: use anything locally; use the server password in network mode.`;
}
function modelsHelpText() {
  return `${pc15.bold("relay-ai favorites")} v${VERSION}
Manage favorite models for mid-session switching.

${pc15.bold("Usage:")}
  relay-ai favorites
  relay-ai favorites --agy
  relay-ai models
  relay-ai favorites --help
  relay-ai favorites --version

${pc15.bold("Behavior:")}
  Opens an interactive manager to add or remove favorites.
  Search all providers at once (paginated results) or browse one provider at a time.
  Pick from Zen, Go, or any provider in your registry.
  Global favorites are saved to ~/.relay-ai/config.json (max ${MAX_MODEL_CATALOG}).
  --agy manages Antigravity CLI favorites only (max 6).

${pc15.bold("How it works:")}
  Claude/Codex/Gemini/server use the global favorites list.
  Favorites appear in supported /model switch menus.
  relay-ai agy uses only Antigravity CLI favorites so its limited native
  switch slots stay predictable: one selected launch model plus up to 6
  Antigravity CLI favorites.

${pc15.bold("Examples:")}
  relay-ai favorites
  relay-ai favorites --agy
  relay-ai claude    # switch menu active when favorites are set`;
}
function antigravityCliHelpText() {
  return `${pc15.bold("relay-ai agy")} v${VERSION}
Launch Antigravity CLI with Relay AI provider registry.

${pc15.bold("Usage:")}
  relay-ai agy [options] [agy-flags]
  relay-ai agy --help
  relay-ai agy --version

${pc15.bold("Relay options:")}
  --provider <id>    Use a specific provider (skip picker)
  --model <id>       Use a specific model (skip picker)
  --trace            Write debug log to /tmp/relay-ai-debug.log
  -h, --help         Show this help
  -v, --version      Show version

${pc15.bold("How it works:")}
  Starts a local Cloud Code gateway, points agy at it via CLOUD_CODE_URL,
  and injects Relay AI models into Antigravity's native model picker.
  All Cloud Code traffic routes through Relay \u2014 no Google Cloud Code upstream.

${pc15.bold("Examples:")}
  relay-ai agy
  relay-ai agy --provider zen --model deepseek-v4-flash-free
  relay-ai agy -p "fix this bug"`;
}
function antigravityIdeHelpText() {
  return `${pc15.bold("relay-ai antigravity-ide")} v${VERSION}
Launch Antigravity IDE with Relay AI provider registry.

${pc15.bold("Usage:")}
  relay-ai antigravity-ide [options]
  relay-ai antigravity-ide --help
  relay-ai antigravity-ide --version

${pc15.bold("Relay options:")}
  --provider <id>    Use a specific provider (skip picker)
  --model <id>       Use a specific model (skip picker)
  --trace            Write debug log to /tmp/relay-ai-debug.log
  -h, --help         Show this help
  -v, --version      Show version

${pc15.bold("How it works:")}
  Creates an isolated Relay-managed IDE profile, starts a local Cloud Code
  gateway, and injects Relay AI models into Antigravity's native picker.
  The normal IDE profile is never modified.

${pc15.bold("Platform:")}
  macOS (Apple Silicon) \u2014 other platforms coming after testing.

${pc15.bold("Examples:")}
  relay-ai antigravity-ide
  relay-ai antigravity-ide --provider zen --model deepseek-v4-flash-free`;
}
function printHelp(text5) {
  console.log(`
${text5}
`);
}
async function launchClaudeViaCatalog(catalogRoutes, startingRoute, contextWindow, trace, claudeArgs) {
  let proxyHandle;
  try {
    proxyHandle = await startProxyCatalog(catalogRoutes, startingRoute.aliasId, trace);
    p19.log.info(
      `Switch menu active \u2014 proxy on port ${proxyHandle.port} ` + pc15.dim(`(${catalogRoutes.length} model${catalogRoutes.length !== 1 ? "s" : ""} in /model)`)
    );
  } catch (err) {
    p19.log.error(`Failed to start proxy: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  const childEnv = buildChildEnv(
    `http://127.0.0.1:${proxyHandle.port}`,
    startingRoute.aliasId,
    proxyHandle.token,
    proxyHandle.port,
    contextWindow,
    true
  );
  const debugLogPath = prepareClaudeTraceLog();
  const traceArgs = trace ? ["--debug-file", debugLogPath] : [];
  if (trace) p19.log.info(`Debug log: ${debugLogPath}`);
  const exitCode = await launchClaude(
    childEnv,
    claudeCodeClientModelId(startingRoute.aliasId, contextWindow),
    [...traceArgs, ...claudeArgs]
  );
  proxyHandle.close();
  if (trace) printTraceLog(debugLogPath);
  return exitCode;
}
var AGY_CLI_FAVORITES_CAP = 6;
async function runModelsCommand(opts = {}) {
  const scope = opts.scope ?? "global";
  const maxFavorites = scope === "agy" ? AGY_CLI_FAVORITES_CAP : MAX_MODEL_CATALOG;
  const scopeName = scope === "agy" ? "Antigravity CLI Favorites" : "Favorite Models";
  const configKey = scope === "agy" ? "antigravityCliFavoriteModels" : "favoriteModels";
  relayIntro(scopeName);
  const spinner10 = p19.spinner();
  spinner10.start("Loading providers...");
  const catalog = await fetchProviderCatalog();
  spinner10.stop("");
  const allProviders = providersForPicker(catalog);
  if (allProviders.length === 0) {
    p19.log.warn("No providers found.");
    p19.log.info(`${pc15.dim("OpenCode Zen/Go is always available. Add providers with ")}${pc15.cyan("relay-ai providers")}${pc15.dim(".")}`);
    relayOutro("Done");
    return 0;
  }
  const modelLookup = /* @__PURE__ */ new Map();
  for (const ap of allProviders) {
    for (const m of ap.models) {
      modelLookup.set(`${ap.id}:${m.id}`, { modelName: m.name || m.id, providerName: ap.name });
    }
  }
  const prefs = loadPreferences();
  let favorites = scope === "agy" ? prefs.antigravityCliFavoriteModels ?? [] : prefs.favoriteModels ?? [];
  let favoritesDirty = false;
  while (true) {
    const options = [];
    for (let i = 0; i < favorites.length; i++) {
      const fav = favorites[i];
      const entry = modelLookup.get(`${fav.providerId}:${fav.modelId}`);
      const label = entry ? `${fmtEnabledStar(true)} ${fmtModel(entry.modelName)} ${pc15.dim(`(${entry.providerName})`)}` : pc15.dim(`\u2605 ${fav.modelId} \u2014 provider gone`);
      options.push({ value: `fav-${i}`, label, hint: "select to remove" });
    }
    const atCap = favorites.length >= maxFavorites;
    options.push({
      value: "__add__",
      label: atCap ? pc15.dim(`+ Add a model \u2192 (limit of ${maxFavorites} reached)`) : pc15.cyan("+ Add a model \u2192"),
      hint: atCap ? "Remove a favorite first to make room" : `${allProviders.length} provider${allProviders.length !== 1 ? "s" : ""} available`
    });
    options.push({ value: "__done__", label: "Done", hint: "" });
    const header = favorites.length === 0 ? `${scopeName} (0/${maxFavorites})` : `${scopeName} (${favorites.length}/${maxFavorites}) \u2014 select to remove`;
    const choice = await p19.select({
      message: header,
      options,
      initialValue: "__done__"
    });
    if (p19.isCancel(choice) || choice === "__done__") break;
    if (choice === "__add__") {
      if (atCap) {
        p19.log.warn(`Limit of ${maxFavorites} favorites reached \u2014 remove one first.`);
        continue;
      }
      const globalCount = buildGlobalFavoriteIndex(allProviders).length;
      const addPath = await p19.select({
        message: "Add a favorite",
        options: [
          {
            value: "global",
            label: pc15.cyan("Search all providers"),
            hint: `${globalCount} models \xB7 ${allProviders.length} provider${allProviders.length !== 1 ? "s" : ""}`
          },
          {
            value: "provider",
            label: pc15.cyan("Browse by provider \u2192"),
            hint: "Pick one provider first"
          }
        ]
      });
      if (p19.isCancel(addPath)) continue;
      let provider;
      let browsedMultiple = [];
      if (addPath === "global") {
        const globalPick = await pickGlobalFavoriteModel(allProviders, favorites);
        if (globalPick === null) continue;
        if (globalPick !== ADD_BY_PROVIDER) {
          provider = allProviders.find((ap) => ap.id === globalPick.providerId);
          browsedMultiple = [globalPick.model];
        }
      }
      if (browsedMultiple.length === 0) {
        let currentInitialProvider = void 0;
        while (true) {
          const providerOptions = allProviders.map((ap) => providerSelectOption(ap));
          const pickedProviderId = await p19.select({
            message: "Which provider?",
            options: providerOptions,
            initialValue: currentInitialProvider
          });
          if (p19.isCancel(pickedProviderId)) break;
          provider = allProviders.find((ap) => ap.id === pickedProviderId);
          const options2 = provider.models.map((m) => {
            const favorited = isFavorite(favorites, { providerId: provider.id, modelId: m.id });
            const label = formatCodexModelLabel(m);
            return {
              value: m.id,
              label: fmtModel(label, m.id),
              hint: favorited ? pc15.yellow("\u2605 already favorite") : ""
            };
          });
          const pickedModelIds = await p19.multiselect({
            message: `Select models to add from ${provider.name} ${pc15.dim("(Space to select, Enter to confirm)")}`,
            options: options2,
            required: false
          });
          if (p19.isCancel(pickedModelIds)) {
            currentInitialProvider = provider.id;
            continue;
          }
          if (pickedModelIds.length === 0) {
            currentInitialProvider = provider.id;
            continue;
          }
          browsedMultiple = provider.models.filter((m) => pickedModelIds.includes(m.id));
          break;
        }
        if (browsedMultiple.length === 0) continue;
      }
      const addedModels = [];
      let duplicateCount = 0;
      let limitReached = false;
      for (const model of browsedMultiple) {
        const fav = { providerId: provider.id, modelId: model.id };
        const result = addFavorite(favorites, fav, maxFavorites);
        if (!result.ok) {
          if (result.reason === "duplicate") {
            duplicateCount++;
          } else {
            limitReached = true;
            break;
          }
        } else {
          favorites = result.list;
          favoritesDirty = true;
          addedModels.push(model);
        }
      }
      if (addedModels.length > 0) {
        if (addedModels.length === 1) {
          const modelName = addedModels[0].name || addedModels[0].id;
          p19.log.success(`Added ${modelName} (${provider.name}) to favorites.`);
        } else {
          p19.log.success(`Added ${addedModels.length} models from ${provider.name} to favorites.`);
        }
      }
      if (duplicateCount > 0) {
        p19.log.warn(`${duplicateCount} selected model(s) were already in your favorites.`);
      }
      if (limitReached) {
        p19.log.warn(`Limit of ${maxFavorites} favorites reached \u2014 some selected models could not be added.`);
      }
    } else if (choice.startsWith("fav-")) {
      const idx = parseInt(choice.slice(4), 10);
      const fav = favorites[idx];
      const entry = modelLookup.get(`${fav.providerId}:${fav.modelId}`);
      const label = entry ? `${entry.modelName} (${entry.providerName})` : fav.modelId;
      const confirmed = await p19.confirm({ message: `Remove ${label} from favorites?` });
      if (p19.isCancel(confirmed) || !confirmed) continue;
      favorites = removeFavorite(favorites, fav);
      favoritesDirty = true;
      p19.log.success(`Removed ${label} from favorites.`);
    }
  }
  if (favoritesDirty) {
    savePreferences({ [configKey]: favorites });
  }
  const favLabel = scope === "agy" ? "Antigravity CLI " : "";
  relayOutro(
    favorites.length === 0 ? `No ${favLabel}favorites saved` : `${favorites.length} ${favLabel}favorite${favorites.length !== 1 ? "s" : ""} saved`,
    favorites.length === 0 ? pc15.dim("Launch uses single-model mode") : pc15.cyan("/model menu ready on next launch")
  );
  return 0;
}
async function runClaudeCommand(parsed) {
  const { dryRun, setup, trace, launchProvider, launchModel } = parsed;
  const claudeArgs = normalizeClaudeAgentArgs(parsed.claudeArgs);
  const agentStdout = wantsCleanAgentStdout("claude", claudeArgs);
  setAgentStdoutMode(agentStdout);
  const claudePath = findClaudeBinary();
  if (!claudePath) {
    console.error(pc15.red("\nError: claude binary not found on PATH.\n"));
    console.error("Install Claude Code:");
    console.error("  npm install -g @anthropic-ai/claude-code\n");
    return 1;
  }
  const prefs = dryRun ? {} : loadPreferences();
  const conflicts = detectConflicts();
  const favorites = dryRun ? [] : prefs.favoriteModels ?? [];
  const launchPlan = planLaunchWizard({
    explicit: { providerId: launchProvider, modelId: launchModel },
    childArgs: claudeArgs,
    agent: "claude",
    prefs
  });
  if (launchPlan.error) {
    console.error(pc15.red(`
Error: ${launchPlan.error}
`));
    return 1;
  }
  const switchMenuActive = favorites.length > 0 && !launchPlan.skip;
  if (!agentStdout) relayIntro("Claude Code");
  if (setup && !dryRun && !agentStdout) {
    p19.log.info("Provider setup now lives in relay-ai providers \u2014 opening that next is recommended.");
  }
  if (!dryRun && await needsFirstRunSetup()) {
    const firstRun = await runFirstRunWizard(trace);
    if (firstRun === "cancel") return 0;
  }
  let catalog;
  if (agentStdout) {
    try {
      catalog = await fetchProviderCatalog();
    } catch (err) {
      console.error(pc15.red(String(err instanceof Error ? err.message : err)));
      return 1;
    }
  } else {
    const catalogSpinner = p19.spinner();
    catalogSpinner.start("Loading your providers...");
    try {
      catalog = await fetchProviderCatalog();
    } catch (err) {
      catalogSpinner.stop("");
      console.error(pc15.red(String(err instanceof Error ? err.message : err)));
      return 1;
    }
    catalogSpinner.stop("");
  }
  const allProviders = providersForPicker(catalog);
  if (allProviders.length === 0) {
    p19.log.warn("No providers available.");
    p19.log.info(pc15.dim("Run relay-ai providers add or import to get started."));
    return 0;
  }
  const providerOptions = allProviders.map((lp) => providerSelectOption(lp));
  if (switchMenuActive) {
    providerOptions.unshift({
      value: "__favorites__",
      label: "\u2B50 Favorites Catalog",
      hint: `${favorites.length} saved favorites`
    });
  }
  const initialProvider = prefs.lastProvider && providerOptions.some((o) => o.value === prefs.lastProvider) ? prefs.lastProvider : providerOptions[0].value;
  let activeProvider;
  let selectedModel;
  if (launchPlan.skip && launchPlan.target) {
    const resolved = findProviderAndModel(allProviders, launchPlan.target);
    if (!resolved) {
      p19.log.error(
        `Provider/model not found: ${launchPlan.target.providerId} / ${launchPlan.target.modelId}`
      );
      return 1;
    }
    activeProvider = resolved.provider;
    selectedModel = resolved.model;
    if (!agentStdout) {
      p19.log.step(`Using ${selectedModel.name || selectedModel.id} (${activeProvider.name})`);
    }
    if (!dryRun) recordLaunchSelection("claude", activeProvider.id, selectedModel.id, prefs);
  } else {
    let currentInitialProvider = initialProvider;
    while (true) {
      const chosen = await p19.select({
        message: "Which provider?",
        options: providerOptions,
        initialValue: currentInitialProvider
      });
      if (p19.isCancel(chosen)) {
        p19.cancel("Cancelled.");
        return 0;
      }
      const providerChoice = chosen;
      if (providerChoice === "__favorites__") {
        const available = [];
        for (const fav of favorites) {
          const prov = allProviders.find((lp) => lp.id === fav.providerId);
          const mod = prov?.models.find((m) => m.id === fav.modelId);
          if (prov && mod) available.push({ provider: prov, model: mod });
        }
        if (available.length === 0) {
          p19.log.warn("No saved favorites are currently available.");
          return 0;
        }
        const favOptions = available.map((f, i) => ({
          value: String(i),
          label: `${f.model.name || f.model.id} \u2014 ${f.provider.name}`,
          hint: f.model.id
        }));
        const pickedIdx = await p19.select({
          message: "Starting model?",
          options: favOptions,
          initialValue: "0"
        });
        if (p19.isCancel(pickedIdx)) {
          p19.cancel("Cancelled.");
          return 0;
        }
        const sel = available[Number(pickedIdx)];
        activeProvider = sel.provider;
        selectedModel = sel.model;
        if (!dryRun) recordLaunchSelection("claude", activeProvider.id, selectedModel.id, prefs);
        break;
      } else {
        activeProvider = allProviders.find((lp) => lp.id === providerChoice);
        const pickedModelResult = await pickLocalModel(activeProvider, conflicts, prefs);
        if (pickedModelResult === "back") {
          currentInitialProvider = activeProvider.id;
          continue;
        }
        if (!pickedModelResult) return 0;
        selectedModel = pickedModelResult;
        if (!dryRun) recordLaunchSelection("claude", activeProvider.id, selectedModel.id, prefs);
        break;
      }
    }
  }
  const localProviders = catalog.localProviders.length > 0 ? catalog.localProviders : null;
  const zenGoApiKey = dryRun ? null : await readGlobalOpencodeCredential();
  if (switchMenuActive) {
    const resolveRoute = makeRouteResolver(
      localProviders,
      catalog.zenModels,
      catalog.goModels,
      zenGoApiKey
    );
    const startingRoute = resolveRoute(activeProvider.id, selectedModel.id) ?? null;
    if (!startingRoute) {
      p19.log.error("Could not resolve a proxy route for the selected model.");
      return 1;
    }
    const { routes: catalogRoutes, droppedFavorites } = buildCatalogRoutes(startingRoute, favorites, resolveRoute);
    if (droppedFavorites.length > 0) {
      p19.log.warn(
        `Skipping ${droppedFavorites.length} favorite${droppedFavorites.length === 1 ? "" : "s"} that are no longer available in /model`
      );
    }
    if (dryRun) {
      const endpoint = selectedModel.baseUrl ?? selectedModel.completionsUrl ?? "(unknown)";
      console.log("");
      console.log(pc15.bold(pc15.cyan("  DRY RUN \u2014 would execute (switch-menu mode):")));
      console.log("");
      console.log(`  ${pc15.bold("Provider:")}      ${activeProvider.name}`);
      console.log(`  ${pc15.bold("Starting model:")} ${selectedModel.id}`);
      console.log(`  ${pc15.bold("Endpoint:")}      ${endpoint}`);
      console.log(`  ${pc15.bold("/model catalog:")} ${catalogRoutes.length} model(s)`);
      catalogRoutes.forEach((r) => console.log(`    ${pc15.dim(r.displayName)}`));
      console.log("");
      console.log(pc15.dim("  (dry run complete \u2014 Claude Code was NOT launched)"));
      console.log("");
      return 0;
    }
    return launchClaudeViaCatalog(
      catalogRoutes,
      startingRoute,
      selectedModel.contextWindow,
      trace,
      claudeArgs
    );
  }
  if (dryRun) {
    const formatDesc = selectedModel.modelFormat === "anthropic" ? "direct passthrough" : "via SDK adapter proxy";
    const endpoint = selectedModel.modelFormat === "anthropic" ? selectedModel.baseUrl ?? "(unknown)" : selectedModel.npm ?? "SDK";
    console.log("");
    console.log(pc15.bold(pc15.cyan("  DRY RUN \u2014 would execute:")));
    console.log("");
    console.log(`  ${pc15.bold("Provider:")}  ${activeProvider.name}`);
    console.log(`  ${pc15.bold("Model:")}     ${selectedModel.id}`);
    console.log(`  ${pc15.bold("Format:")}    ${selectedModel.modelFormat} (${formatDesc})`);
    console.log(`  ${pc15.bold(selectedModel.modelFormat === "anthropic" ? "Endpoint:" : "SDK npm:")} ${endpoint}`);
    console.log(`  ${pc15.bold("Key:")}       ${activeProvider.name} provider key`);
    console.log("");
    console.log(pc15.dim("  (dry run complete \u2014 Claude Code was NOT launched)"));
    console.log("");
    return 0;
  }
  const launchApiKey = await resolveLocalProviderApiKey(activeProvider);
  if (!launchApiKey?.trim()) {
    p19.log.error(
      `No credential found for ${activeProvider.name}. Add a key with relay-ai providers or set OPENCODE_API_KEY.`
    );
    return 1;
  }
  let proxyHandle = null;
  let childEnv;
  const isAntigravityOAuth = activeProvider.id === "antigravity" && activeProvider.authType === "oauth";
  const isOAuthAnthropic = selectedModel.modelFormat === "anthropic" && activeProvider.authType === "oauth" && !isAntigravityOAuth;
  if (isAntigravityOAuth) {
    try {
      proxyHandle = await startProxy(
        ANTIGRAVITY_BASE_URLS[0],
        selectedModel.id,
        trace,
        selectedModel.contextWindow,
        {
          providerId: activeProvider.id,
          authType: "oauth",
          providerData: activeProvider.providerData,
          modelFormat: "cloud-code"
        },
        launchApiKey
      );
      if (!isAgentStdoutMode()) p19.log.info(`Cloud Code proxy started on port ${proxyHandle.port}`);
    } catch (err) {
      p19.log.error(`Failed to start Cloud Code proxy: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
    childEnv = buildChildEnv(
      `http://127.0.0.1:${proxyHandle.port}`,
      selectedModel.id,
      proxyHandle.token,
      proxyHandle.port,
      selectedModel.contextWindow
    );
  } else if (isOAuthAnthropic) {
    try {
      proxyHandle = await startProxy(
        selectedModel.baseUrl ?? "https://api.anthropic.com",
        selectedModel.id,
        trace,
        selectedModel.contextWindow,
        {
          providerId: activeProvider.id,
          authType: "oauth",
          oauthAccountId: activeProvider.oauthAccountId,
          providerData: activeProvider.providerData,
          modelFormat: "anthropic"
        },
        launchApiKey
      );
      if (!isAgentStdoutMode()) p19.log.info(`OAuth proxy started on port ${proxyHandle.port}`);
    } catch (err) {
      p19.log.error(`Failed to start OAuth proxy: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
    childEnv = buildChildEnv(
      `http://127.0.0.1:${proxyHandle.port}`,
      selectedModel.id,
      proxyHandle.token,
      proxyHandle.port,
      selectedModel.contextWindow
    );
  } else if (selectedModel.modelFormat === "anthropic") {
    childEnv = buildChildEnv(
      selectedModel.baseUrl,
      selectedModel.id,
      launchApiKey,
      void 0,
      selectedModel.contextWindow
    );
  } else {
    try {
      proxyHandle = await startProxy(
        selectedModel.completionsUrl ?? "",
        selectedModel.id,
        trace,
        selectedModel.contextWindow,
        {
          npm: selectedModel.npm,
          baseURL: selectedModel.apiBaseUrl,
          upstreamModelId: selectedModel.upstreamModelId,
          providerId: activeProvider.id,
          authType: activeProvider.authType,
          oauthAccountId: activeProvider.oauthAccountId,
          supportedParameters: selectedModel.supportedParameters,
          reasoning: selectedModel.reasoning,
          interleavedReasoningField: selectedModel.interleavedReasoningField
        },
        launchApiKey
      );
      if (!isAgentStdoutMode()) {
        p19.log.info(
          `SDK adapter proxy started on port ${proxyHandle.port}` + (selectedModel.npm ? pc15.dim(` (${selectedModel.npm})`) : "")
        );
      }
    } catch (err) {
      p19.log.error(`Failed to start SDK adapter proxy: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
    childEnv = buildChildEnv(
      `http://127.0.0.1:${proxyHandle.port}`,
      selectedModel.id,
      proxyHandle.token,
      proxyHandle.port,
      selectedModel.contextWindow
    );
  }
  if (selectedModel.modelFormat === "anthropic" && !isOAuthAnthropic) {
    childEnv["CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS"] = "1";
  }
  const debugLogPath = prepareClaudeTraceLog();
  const traceArgs = trace ? ["--debug-file", debugLogPath] : [];
  if (trace) p19.log.info(`Debug log: ${debugLogPath}`);
  const exitCode = await launchClaude(
    childEnv,
    claudeCodeClientModelId(selectedModel.id, selectedModel.contextWindow),
    [...traceArgs, ...claudeArgs]
  );
  proxyHandle?.close();
  if (trace) printTraceLog(debugLogPath);
  return exitCode;
}
async function main(args = process.argv.slice(2)) {
  const parsed = parseArgs(args);
  if (parsed.error) {
    console.error(pc15.red(`
Error: ${parsed.error}
`));
    printHelp(rootHelpText());
    return 1;
  }
  if (!parsed.showVersion && !parsed.showAi) {
    refreshModelsDevCacheAsync();
  }
  if (parsed.command === "root") {
    if (parsed.showAi) {
      if (parsed.aiInstall) {
        return printAiInstallResult(installAiDoc({ force: parsed.aiInstallForce }));
      }
      console.log(generateAiDoc());
      return 0;
    }
    if (parsed.showVersion) {
      console.log(VERSION);
    } else {
      printHelp(rootHelpText());
    }
    return 0;
  }
  if (parsed.command === "server") {
    if (parsed.showVersion) {
      console.log(VERSION);
      return 0;
    }
    if (parsed.showHelp) {
      printHelp(serverHelpText());
      return 0;
    }
    return runServerCommand({ vertex: parsed.vertex });
  }
  if (parsed.command === "ui") {
    if (parsed.showVersion) {
      console.log(VERSION);
      return 0;
    }
    if (parsed.showHelp) {
      console.log("Usage: relay-ai ui\n\nOpen the settings UI in your browser.");
      return 0;
    }
    const { runUiCommand } = await import("./ui-command-3YMS6F6B.js");
    return runUiCommand();
  }
  if (parsed.command === "models") {
    if (parsed.showVersion) {
      console.log(VERSION);
      return 0;
    }
    if (parsed.showHelp) {
      printHelp(modelsHelpText());
      return 0;
    }
    return runModelsCommand({ scope: parsed.favoritesAgy ? "agy" : "global" });
  }
  if (parsed.command === "providers") {
    if (parsed.showVersion) {
      console.log(VERSION);
      return 0;
    }
    if (parsed.showHelp) {
      printHelp(providersHelpText());
      return 0;
    }
    if (parsed.trace) {
      process.env.RELAY_AI_TRACE = "1";
    }
    return runProvidersCommand(parsed.claudeArgs);
  }
  if (parsed.command === "codex-app") {
    if (parsed.showVersion) {
      console.log(VERSION);
      return 0;
    }
    return runCodexAppCommand(parsed.claudeArgs, { vertex: parsed.vertex });
  }
  if (parsed.command === "claude-app") {
    if (parsed.showVersion) {
      console.log(VERSION);
      return 0;
    }
    return runClaudeAppCommand(parsed.claudeArgs);
  }
  if (parsed.command === "codex") {
    if (parsed.showVersion) {
      console.log(VERSION);
      return 0;
    }
    if (parsed.showHelp) {
      console.log(codexHelpText());
      return 0;
    }
    return runCodexCommand(parsed.claudeArgs, parsed.trace, {
      launchProvider: parsed.launchProvider,
      launchModel: parsed.launchModel,
      vertex: parsed.vertex
    });
  }
  if (parsed.command === "gemini") {
    if (parsed.showVersion) {
      console.log(VERSION);
      return 0;
    }
    if (parsed.showHelp) {
      console.log(geminiHelpText());
      return 0;
    }
    return runGeminiCommand(parsed.claudeArgs, parsed.trace, {
      launchProvider: parsed.launchProvider,
      launchModel: parsed.launchModel
    });
  }
  if (parsed.command === "agy") {
    if (parsed.showVersion) {
      console.log(VERSION);
      return 0;
    }
    if (parsed.showHelp) {
      console.log(antigravityCliHelpText());
      return 0;
    }
    return runAgyCommand(parsed.claudeArgs, parsed.trace, {
      launchProvider: parsed.launchProvider,
      launchModel: parsed.launchModel
    });
  }
  if (parsed.command === "antigravity-ide") {
    if (parsed.showVersion) {
      console.log(VERSION);
      return 0;
    }
    if (parsed.showHelp) {
      console.log(antigravityIdeHelpText());
      return 0;
    }
    return runAntigravityIdeCommand(parsed.claudeArgs, parsed.trace, {
      launchProvider: parsed.launchProvider,
      launchModel: parsed.launchModel
    });
  }
  if (parsed.showVersion) {
    console.log(VERSION);
    return 0;
  }
  if (parsed.showHelp) {
    printHelp(claudeHelpText());
    return 0;
  }
  return runClaudeCommand(parsed);
}
function isCliEntryPoint() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}
if (isCliEntryPoint()) {
  main().then((exitCode) => {
    process.exit(exitCode);
  }).catch((err) => {
    if (err === /* @__PURE__ */ Symbol.for("clack:cancel")) {
      process.exit(0);
    }
    console.error(pc15.red("\nUnexpected error:"), err);
    process.exit(1);
  });
}
export {
  antigravityCliHelpText,
  antigravityIdeHelpText,
  claudeHelpText,
  main,
  modelsHelpText,
  parseArgs,
  rootHelpText,
  runClaudeCommand,
  runModelsCommand,
  serverHelpText
};
//# sourceMappingURL=cli.js.map