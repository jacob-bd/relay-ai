import { BACKENDS } from './constants.js';
import { getCachedModels, setCachedModels } from './config.js';
import { getModels } from './models.js';
import { fetchLocalProviders } from './providers.js';
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

export async function fetchProviderCatalog(opts?: { persistCache?: boolean }): Promise<ProviderCatalog> {
  const persistCache = opts?.persistCache ?? false;
  const [localProviders, zenGo] = await Promise.all([
    fetchLocalProviders().then(providers => providers ?? []),
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

export function localProvidersToServerModels(localProviders: LocalProvider[]): ServerModelInfo[] {
  const models: ServerModelInfo[] = [];
  for (const provider of localProviders) {
    for (const model of provider.models) {
      models.push({
        id: model.id,
        name: model.name,
        isFree: false,
        brand: model.brand,
        sourceBackend: 'zen',
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
  return models.map(model => {
    const base: ServerModelInfo = {
      id: model.id,
      name: model.name,
      isFree: model.isFree,
      brand: model.brand,
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
