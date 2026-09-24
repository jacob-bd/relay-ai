import type { ResolvedFavorite } from '../favorites-resolver.js';
import type { LocalProviderModel } from '../types.js';
import { getReasoningCapabilities } from '../provider-factory.js';
import {
  catalogEntryFromModel,
  type CodexCatalogFile,
  type CodexCatalogModel,
} from './catalog.js';

/** CLI favorites catalog slug — must match profile `model` and `codex -m`. */
export function codexCliFavoritesSlug(providerId: string, modelId: string): string {
  return `${providerId}__${modelId}`;
}

export function buildFavoritesCodexCatalog(
  starting: ResolvedFavorite | undefined,
  resolved: ResolvedFavorite[],
): CodexCatalogFile {
  const models: CodexCatalogModel[] = [];
  let priority = 0;

  if (starting) {
    models.push(buildEntry(starting, priority++));
  }

  for (const r of resolved) {
    models.push(buildEntry(r, priority++));
  }

  return { models };
}

function enrichFavoriteModel(r: ResolvedFavorite): LocalProviderModel {
  const model = r.model as LocalProviderModel;
  return {
    ...model,
    npm: model.npm ?? (model.modelFormat === 'anthropic' ? '@ai-sdk/anthropic' : '@ai-sdk/openai-compatible'),
    upstreamModelId: model.upstreamModelId || model.id,
  };
}

function buildEntry(r: ResolvedFavorite, priority: number): CodexCatalogModel {
  const model = enrichFavoriteModel(r);
  const slug = codexCliFavoritesSlug(r.providerId, model.id);
  return catalogEntryFromModel(model, r.providerName, priority, false, slug);
}

export function defaultReasoningEffortForFavorite(r: ResolvedFavorite): string {
  const model = enrichFavoriteModel(r);
  const caps = getReasoningCapabilities(model.npm ?? '', model.upstreamModelId ?? model.id, {
    providerId: r.providerId,
    apiBaseUrl: model.apiBaseUrl,
    supportedParameters: model.supportedParameters,
    reasoning: model.reasoning,
    interleavedReasoningField: model.interleavedReasoningField,
    reasoningEffortLevels: model.reasoningEffortLevels,
    reasoningEffortConflict: model.reasoningEffortConflict,
  });
  return caps.levels.length > 0 ? caps.defaultLevel : 'none';
}

export function buildFavoritesAppCatalog(
  resolved: ResolvedFavorite[],
): CodexCatalogFile {
  const models: CodexCatalogModel[] = [];
  let priority = 0;
  for (const r of resolved) {
    const model = enrichFavoriteModel(r);
    const slug = codexCliFavoritesSlug(r.providerId, model.id);
    models.push(catalogEntryFromModel(model, r.providerName, priority++, true, slug));
  }
  return { models };
}
