import { MAX_MODEL_CATALOG } from '../constants.js';
import {
  buildFavoritesList,
  resolveFavorite,
  type ResolvedFavorite,
  type ResolveContext,
} from '../favorites-resolver.js';
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
