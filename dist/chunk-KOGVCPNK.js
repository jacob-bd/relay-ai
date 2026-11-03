#!/usr/bin/env node
import {
  copilotPlanTier,
  filterCachedCopilotModels,
  materializeRegistry,
  oauthAuthRef
} from "./chunk-LXTF7TOF.js";
import {
  getAgentProviderModels,
  loadRegistry,
  providerKind,
  resolveProviderCredential,
  resolveProviderOAuthAccountId,
  resolveProviderOAuthProviderData
} from "./chunk-IBEBOL44.js";
import {
  getTemplateById,
  init_provider_templates
} from "./chunk-RKRPDZVV.js";

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

export {
  fetchProviderCatalog,
  launchModelsForProvider,
  providersForPicker,
  resolveLocalProviderApiKey,
  formatRegistryAuthLabel,
  resolveProvidersForDisplay,
  localProvidersToServerModels
};
//# sourceMappingURL=chunk-KOGVCPNK.js.map