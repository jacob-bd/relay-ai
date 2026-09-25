import { MAX_MODEL_CATALOG } from '../constants.js';
import {
  buildFavoritesList,
  resolveFavorite,
  type ResolvedFavorite,
  type ResolveContext,
} from '../favorites-resolver.js';
import {
  partitionAndStartCloudCodeBackend,
  type CloudCodeBackend,
} from '../cloud-code-backend.js';
import { upstreamModelId, type ServerModelInfo } from '../server/models.js';
import { getReasoningCapabilities } from '../provider-factory.js';
import { effortLabel, favoriteEffortLevels } from '../antigravity/catalog.js';
import { EFFORT_RANK } from '../registry/models-dev.js';
import type { FavoriteModel, LocalProvider, LocalProviderModel } from '../types.js';

export type ClaudeAppCatalogResolution =
  | {
      ok: true;
      entries: ResolvedFavorite[];
      providersById: Map<string, LocalProvider>;
      droppedFavorites: FavoriteModel[];
      capacitySkippedFavorites: FavoriteModel[];
    }
  | { ok: false; error: string };

export async function resolveClaudeAppCatalog(
  selectedProvider: LocalProvider,
  selectedModel: LocalProviderModel,
  compatibleProviders: LocalProvider[],
  favorites: FavoriteModel[],
  max = MAX_MODEL_CATALOG,
): Promise<ClaudeAppCatalogResolution> {
  const providersById = new Map(
    compatibleProviders.map(provider => [provider.id, provider]),
  );
  const context: ResolveContext = {
    agent: 'codex-app',
    localProviders: compatibleProviders,
    findLocalModel: (providerId, modelId) => {
      const provider = providersById.get(providerId);
      const model = provider?.models.find(candidate => candidate.id === modelId);
      return provider && model ? { provider, model } : undefined;
    },
  };
  const starting = await resolveFavorite(
    { providerId: selectedProvider.id, modelId: selectedModel.id },
    context,
  );

  if (!starting) {
    return {
      ok: false,
      error: `Model ${selectedModel.id} is no longer available on ${selectedProvider.name}.`,
    };
  }
  if (!starting.apiKey.trim()) {
    return {
      ok: false,
      error: `No credential for ${selectedProvider.name}. Run relay-ai providers auth ${selectedProvider.id}.`,
    };
  }

  const {
    resolved,
    droppedFavorites,
    capacitySkippedFavorites,
  } = await buildFavoritesList(starting, favorites, context, max, {
    dropEmptyApiKey: true,
    trackCapacitySkipped: true,
  });

  return {
    ok: true,
    entries: resolved,
    providersById,
    droppedFavorites,
    capacitySkippedFavorites,
  };
}

export function modelToServerModelInfo(
  model: LocalProviderModel,
  provider: LocalProvider,
  overrides: Partial<ServerModelInfo> = {},
): ServerModelInfo {
  return {
    id: model.id,
    name: model.name,
    isFree: model.isFree ?? false,
    freeStatus: model.freeStatus,
    brand: model.brand ?? '',
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
    providerData: provider.providerData,
    ...overrides,
  };
}

function entryKey(entry: ResolvedFavorite): string {
  return `${entry.providerId}::${entry.model.id}`;
}

export async function buildClaudeAppServerCatalog(
  entries: ResolvedFavorite[],
  providersById: Map<string, LocalProvider>,
  trace?: boolean,
): Promise<{ serverModels: ServerModelInfo[]; backend: CloudCodeBackend | null }> {
  const convertedByKey = new Map<string, ServerModelInfo>();
  const cloudCodeEntries = entries.filter(entry => entry.model.modelFormat === 'cloud-code');
  const regularEntries = entries.filter(entry => entry.model.modelFormat !== 'cloud-code');

  for (const entry of regularEntries) {
    const provider = providersById.get(entry.providerId);
    if (!provider) {
      throw new Error(`Internal error: provider ${entry.providerId} is missing from the Claude App catalog.`);
    }
    const resolvedProvider = { ...provider, apiKey: entry.apiKey };
    convertedByKey.set(
      entryKey(entry),
      modelToServerModelInfo(entry.model as LocalProviderModel, resolvedProvider),
    );
  }

  const { backendItems, backend } = await partitionAndStartCloudCodeBackend(
    cloudCodeEntries.map(entry => ({
      providerId: entry.providerId,
      model: entry.model as LocalProviderModel,
      apiKey: entry.apiKey,
      providerData: entry.providerData,
      entry,
    })),
    (proxyRoute, cloudCodeBackend, original) => {
      const provider = providersById.get(original.providerId);
      if (!provider) {
        throw new Error(`Internal error: provider ${original.providerId} is missing from the Claude App catalog.`);
      }
      const converted = modelToServerModelInfo(original.model, {
        ...provider,
        apiKey: original.apiKey,
      }, {
        modelFormat: 'anthropic',
        upstreamModelId: proxyRoute.aliasId,
        baseUrl: `http://127.0.0.1:${cloudCodeBackend.port}`,
        completionsUrl: undefined,
        npm: undefined,
        apiBaseUrl: undefined,
        apiKey: cloudCodeBackend.token,
        authType: undefined,
        oauthAccountId: undefined,
        headers: undefined,
      });
      return { key: entryKey(original.entry), converted };
    },
    trace,
  );

  for (const item of backendItems) {
    convertedByKey.set(item.key, item.converted);
  }

  const serverModels = entries.map(entry => {
    const converted = convertedByKey.get(entryKey(entry));
    if (!converted) {
      throw new Error(`Internal error: model ${entry.providerId}/${entry.model.id} was not converted for Claude App.`);
    }
    return converted;
  });

  return { serverModels, backend };
}

/**
 * Claude Desktop shows an effort slider only for Claude models, so every other
 * model with adjustable effort is listed once per level (same rule as
 * Antigravity): every level for the launch model (first entry), medium and the
 * two above it for favorites. Each entry forces its level on every request.
 */
export function expandClaudeAppEffortVariants(
  models: ServerModelInfo[],
  max = MAX_MODEL_CATALOG,
): ServerModelInfo[] {
  const out = models.flatMap((model, index) => {
    if (model.modelFormat !== 'openai' || !model.npm) return [model];
    const caps = getReasoningCapabilities(model.npm, upstreamModelId(model), {
      providerId: model.providerId,
      apiBaseUrl: model.apiBaseUrl,
      supportedParameters: model.supportedParameters,
      reasoning: model.reasoning,
      interleavedReasoningField: model.interleavedReasoningField,
      reasoningEffortLevels: model.reasoningEffortLevels,
      reasoningEffortConflict: model.reasoningEffortConflict,
    });
    if (caps.mode !== 'controllable' || caps.levels.length < 2) return [model];
    const rank = (level: string) => {
      const at = EFFORT_RANK.indexOf(level);
      return at < 0 ? EFFORT_RANK.length : at;
    };
    const ordered = [...caps.levels].sort((a, b) => rank(a) - rank(b));
    const levels = index === 0 ? ordered : favoriteEffortLevels(ordered, caps.defaultLevel);
    return levels.map(level => ({
      ...model,
      id: `${model.id}-effort-${level}`,
      name: `${model.name} ${effortLabel(level)}`,
      upstreamModelId: model.upstreamModelId ?? model.id,
      fixedEffort: level,
    }));
  });
  return out.slice(0, max);
}
