import { BACKENDS } from './constants.js';
import { getCachedModels, setCachedModels } from './config.js';
import { readGlobalOpencodeCredential } from './env.js';
import { getModels } from './models.js';
import { loadRegistry } from './registry/io.js';
import { loadRegistryProviders } from './registry/load.js';
import { fetchLocalProviders } from './opencode-serve.js';
import type { LocalProvider, ModelInfo } from './types.js';
import type { ServerModelInfo } from './server/models.js';

export interface ProviderCatalog {
  localProviders: LocalProvider[];
  zenModels: ModelInfo[];
  goModels: ModelInfo[];
}

export async function fetchZenGoModels(
  backends: Array<'zen' | 'go'>,
  persistCache = false,
): Promise<{ zenModels: ModelInfo[]; goModels: ModelInfo[] }> {
  const results = await Promise.all(
    backends.map(async id => {
      const result = await getModels(BACKENDS[id], getCachedModels(id) ?? undefined);
      if (!result.fromCache && persistCache) setCachedModels(id, result.models);
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

/** Registry-first local provider resolution; optional legacy OpenCode serve fallback. */
export async function resolveLocalProviders(): Promise<LocalProvider[]> {
  const fromRegistry = await loadRegistryProviders();
  if (fromRegistry.length > 0) return fromRegistry;
  if (process.env['RELAY_AI_LEGACY_SERVE'] === '0') return [];
  const fromOpencode = await fetchLocalProviders();
  return fromOpencode ?? [];
}

export async function fetchProviderCatalog(opts?: { persistCache?: boolean }): Promise<ProviderCatalog> {
  const persistCache = opts?.persistCache ?? false;
  const [localProviders, zenGo] = await Promise.all([
    resolveLocalProviders(),
    fetchZenGoModels(['zen', 'go'], persistCache),
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
      })),
  };
}

export function providersForPicker(catalog: ProviderCatalog): LocalProvider[] {
  return [
    ...(catalog.zenModels.length > 0 ? [zenGoAsLocalProvider('zen', catalog.zenModels)] : []),
    ...(catalog.goModels.length > 0 ? [zenGoAsLocalProvider('go', catalog.goModels)] : []),
    ...catalog.localProviders,
  ];
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
  cloudBuiltin?: 'zen' | 'go';
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
  const registryIds = new Set(reg.providers.map(p => p.id));
  const entries: ProviderDisplayEntry[] = [];

  const opencodeKey = await readGlobalOpencodeCredential();
  let zenCount = 0;
  let goCount = 0;

  if (opencodeKey) {
    const zenGo = await fetchZenGoModels(['zen', 'go']);
    zenCount = countUsableZenGoModels(zenGo.zenModels);
    goCount = countUsableZenGoModels(zenGo.goModels);

    if (!registryIds.has('zen') && zenCount > 0) {
      entries.push({
        id: 'zen',
        name: 'OpenCode Zen',
        modelCount: zenCount,
        enabled: true,
        authLabel: 'keychain (OpenCode API key)',
        inRegistry: false,
        cloudBuiltin: 'zen',
      });
    }
    if (!registryIds.has('go') && goCount > 0) {
      entries.push({
        id: 'go',
        name: 'OpenCode Go',
        modelCount: goCount,
        enabled: true,
        authLabel: 'keychain (OpenCode API key)',
        inRegistry: false,
        cloudBuiltin: 'go',
      });
    }
  }

  for (const provider of reg.providers) {
    let modelCount = provider.modelsCache?.models.length ?? 0;
    if (provider.id === 'zen' && zenCount > 0) modelCount = zenCount;
    if (provider.id === 'go' && goCount > 0) modelCount = goCount;

    entries.push({
      id: provider.id,
      name: provider.name,
      modelCount,
      enabled: provider.enabled,
      authLabel: provider.authRef.startsWith('keyring:global:opencode')
        ? 'keychain (OpenCode API key)'
        : provider.authRef.startsWith('keyring:')
          ? 'keychain'
          : provider.authRef,
      inRegistry: true,
    });
  }

  return entries;
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
  const models: ServerModelInfo[] = [];
  for (const provider of localProviders) {
    for (const model of provider.models) {
      models.push({
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
        npm: model.npm,
        apiBaseUrl: model.apiBaseUrl,
        apiKey: provider.apiKey,
        contextWindow: model.contextWindow,
      });
    }
  }
  return models;
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
    };
    if (model.modelFormat === 'openai') {
      base.npm = '@ai-sdk/openai-compatible';
      base.apiBaseUrl = `${BACKENDS[model.sourceBackend].baseUrl}/v1`;
    }
    return base;
  });
}
