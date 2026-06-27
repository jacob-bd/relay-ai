import { BACKENDS } from './constants.js';
import { readGlobalOpencodeCredential, resolveProviderCredential } from './env.js';
import type { CompatibilityAgent } from './model-compatibility.js';
import { getModels } from './models.js';
import { loadRegistry } from './registry/io.js';
import { loadRegistryProviders } from './registry/load.js';
import type { LocalProvider, ModelInfo } from './types.js';
import type { ServerModelInfo } from './server/models.js';

export interface ProviderCatalog {
  localProviders: LocalProvider[];
  zenModels: ModelInfo[];
  goModels: ModelInfo[];
}

export async function fetchZenGoModels(
  backends: Array<'zen' | 'go'>,
): Promise<{ zenModels: ModelInfo[]; goModels: ModelInfo[] }> {
  const results = await Promise.all(
    backends.map(async id => {
      const result = await getModels(BACKENDS[id]);
      return { id, models: result.models };
    }),
  );

  let zenModels: ModelInfo[] = [];
  let goModels: ModelInfo[] = [];
  for (const entry of results) {
    if (entry.id === 'zen') zenModels = entry.models;
    else goModels = entry.models;
  }
  return { zenModels, goModels };
}

/** Registry-first local provider resolution. */
export async function resolveLocalProviders(
  opts?: { agent?: CompatibilityAgent },
): Promise<LocalProvider[]> {
  return loadRegistryProviders(undefined, opts);
}

export async function fetchProviderCatalog(
  opts?: { agent?: CompatibilityAgent },
): Promise<ProviderCatalog> {
  const [localProviders, zenGo] = await Promise.all([
    resolveLocalProviders(opts),
    fetchZenGoModels(['zen', 'go']),
  ]);

  return {
    localProviders,
    zenModels: zenGo.zenModels,
    goModels: zenGo.goModels,
  };
}

export function zenGoAsLocalProvider(backendId: 'zen' | 'go', models: ModelInfo[]): LocalProvider {
  const name = backendId === 'zen' ? 'OpenCode Zen' : 'OpenCode Go';
  return {
    id: backendId,
    name,
    apiKey: '',
    models: models
      .filter(m => m.modelFormat !== 'unsupported')
      .map(m => ({
        id: m.id,
        name: m.name,
        family: m.brand,
        brand: m.brand,
        modelFormat: m.modelFormat as 'anthropic' | 'openai',
        upstreamModelId: m.id,
        contextWindow: m.contextWindow,
        cost: m.cost,
        isFree: m.isFree,
        reasoning: m.reasoning,
        interleavedReasoningField: m.interleavedReasoningField,
        ...(m.modelFormat === 'openai' ? {
          npm: '@ai-sdk/openai-compatible',
          apiBaseUrl: `${BACKENDS[backendId].baseUrl}/v1`,
        } : {}),
      })),
  };
}

export function providersForPicker(catalog: ProviderCatalog): LocalProvider[] {
  const registryIds = new Set(catalog.localProviders.map(p => p.id));
  const providers = [
    ...(catalog.zenModels.length > 0 && !registryIds.has('zen')
      ? [zenGoAsLocalProvider('zen', catalog.zenModels)]
      : []),
    ...(catalog.goModels.length > 0 && !registryIds.has('go')
      ? [zenGoAsLocalProvider('go', catalog.goModels)]
      : []),
    ...catalog.localProviders,
  ];

  for (const p of providers) {
    p.models.sort((a, b) => {
      const nameA = a.name || a.id;
      const nameB = b.name || b.id;
      return nameA.localeCompare(nameB, undefined, { sensitivity: 'base', numeric: true });
    });
  }

  return providers.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
}

/** Resolve API key when provider.apiKey is empty (registry authRef or global OpenCode key). */
export async function resolveLocalProviderApiKey(provider: LocalProvider): Promise<string | null> {
  const direct = provider.apiKey?.trim();
  if (direct) return direct;
  const reg = loadRegistry().providers.find(p => p.id === provider.id);
  const authRef = reg?.authRef
    ?? (provider.id === 'zen' || provider.id === 'go' ? 'keyring:global:opencode' : null);
  if (!authRef) return null;
  return resolveProviderCredential(provider.id, authRef);
}

/** Human-readable auth line for `providers list` and provider detail. */
export function formatRegistryAuthLabel(
  provider: Pick<import('./registry/types.js').RegistryProvider, 'authRef' | 'authType'>,
): string {
  if (provider.authType === 'oauth' || provider.authRef.includes('oauth:provider:')) {
    return 'keychain (OAuth)';
  }
  if (provider.authRef.startsWith('keyring:global:opencode')) {
    return 'keychain (OpenCode API key)';
  }
  if (provider.authType === 'none') {
    return 'gcloud / manual credentials';
  }
  if (provider.authRef.startsWith('keyring:')) {
    return 'keychain (API key)';
  }
  if (provider.authRef.startsWith('env:')) {
    return provider.authRef;
  }
  return provider.authRef;
}

/** Row for providers list / hub — merges registry entries with live Zen/Go cloud builtins. */
export interface ProviderDisplayEntry {
  id: string;
  name: string;
  modelCount: number;
  enabled: boolean;
  authLabel: string;
  inRegistry: boolean;
  /** Zen/Go active via OpenCode API key but not saved in providers.json */
  cloudBuiltin?: 'opencode';
}

function countUsableZenGoModels(models: ModelInfo[]): number {
  return models.filter(m => m.modelFormat !== 'unsupported').length;
}

/**
 * What relay-ai can actually use — registry providers plus Zen/Go when an OpenCode API key exists.
 * Matches what `relay-ai models` shows in its provider picker.
 */
export async function resolveProvidersForDisplay(): Promise<ProviderDisplayEntry[]> {
  const reg = loadRegistry();
  const entries: ProviderDisplayEntry[] = [];
  const cloudProviders = reg.providers.filter(provider => provider.id === 'zen' || provider.id === 'go');

  const opencodeKey = await readGlobalOpencodeCredential();
  let zenCount = 0;
  let goCount = 0;

  if (opencodeKey) {
    const zenGo = await fetchZenGoModels(['zen', 'go']);
    zenCount = countUsableZenGoModels(zenGo.zenModels);
    goCount = countUsableZenGoModels(zenGo.goModels);

  }

  if (cloudProviders.length > 0 || zenCount + goCount > 0) {
    entries.push({
      id: 'opencode-cloud',
      name: 'OpenCode Zen / Go',
      modelCount: zenCount + goCount || cloudProviders.reduce(
        (total, provider) => total + (provider.modelsCache?.models.length ?? 0),
        0,
      ),
      enabled: cloudProviders.length === 0 || cloudProviders.some(provider => provider.enabled),
      authLabel: cloudProviders[0]
        ? formatRegistryAuthLabel(cloudProviders[0])
        : 'keychain (OpenCode API key)',
      inRegistry: cloudProviders.length > 0,
      cloudBuiltin: 'opencode',
    });
  }

  for (const provider of reg.providers) {
    if (provider.id === 'zen' || provider.id === 'go') continue;

    entries.push({
      id: provider.id,
      name: provider.name,
      modelCount: provider.modelsCache?.models.length ?? 0,
      enabled: provider.enabled,
      authLabel: formatRegistryAuthLabel(provider),
      inRegistry: true,
    });
  }

  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

/** True when Zen/Go are already usable (registry entry or live OpenCode API key). */
export async function resolveZenGoAvailability(): Promise<{ zen: boolean; go: boolean }> {
  const reg = loadRegistry();
  const key = await readGlobalOpencodeCredential();
  if (!key) {
    return {
      zen: reg.providers.some(p => p.id === 'zen'),
      go: reg.providers.some(p => p.id === 'go'),
    };
  }

  const zenGo = await fetchZenGoModels(['zen', 'go']);
  return {
    zen: reg.providers.some(p => p.id === 'zen') || countUsableZenGoModels(zenGo.zenModels) > 0,
    go: reg.providers.some(p => p.id === 'go') || countUsableZenGoModels(zenGo.goModels) > 0,
  };
}

export function localProvidersToServerModels(localProviders: LocalProvider[]): ServerModelInfo[] {
  return localProviders.flatMap(provider => 
    provider.models.map(model => ({
      id: model.id,
      name: model.name,
      isFree: false,
      brand: model.brand,
      providerLabel: provider.name,
      providerId: provider.id,
      sourceBackend: provider.id,
      modelFormat: model.modelFormat,
      upstreamModelId: model.upstreamModelId,
      cost: model.cost,
      baseUrl: model.baseUrl,
      completionsUrl: model.completionsUrl,
      npm: model.modelFormat === 'openai' ? (model.npm || '@ai-sdk/openai-compatible') : model.npm,
      apiBaseUrl: model.apiBaseUrl,
      apiKey: provider.apiKey,
      authType: provider.authType,
      oauthAccountId: provider.oauthAccountId,
      contextWindow: model.contextWindow,
      supportedParameters: model.supportedParameters,
      reasoning: model.reasoning,
      interleavedReasoningField: model.interleavedReasoningField,
    }))
  );
}

// Cloud Zen/Go models. Anthropic-format models stay direct passthrough (no npm);
// openai-format models route through the SDK via @ai-sdk/openai-compatible with the
// backend's /v1 base URL — matching the CLI catalog's zenGoModelToRoute.
export function zenGoModelsToServerModels(models: ModelInfo[]): ServerModelInfo[] {
  return models.filter(m => m.modelFormat !== 'unsupported').map(model => {
    const base: ServerModelInfo = {
      id: model.id,
      name: model.name,
      isFree: model.isFree,
      brand: model.brand,
      providerLabel: model.sourceBackend === 'go' ? 'OpenCode Go' : 'OpenCode Zen',
      providerId: model.sourceBackend,
      sourceBackend: model.sourceBackend,
      modelFormat: model.modelFormat as 'anthropic' | 'openai',
      cost: model.cost,
      contextWindow: model.contextWindow,
      reasoning: model.reasoning,
      interleavedReasoningField: model.interleavedReasoningField,
    };
    if (model.modelFormat === 'openai') {
      base.npm = '@ai-sdk/openai-compatible';
      base.apiBaseUrl = `${BACKENDS[model.sourceBackend].baseUrl}/v1`;
    }
    return base;
  });
}
