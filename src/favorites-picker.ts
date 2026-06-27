// Global cross-provider search for relay-ai models (favorites manager).
import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { FavoriteModel, LocalProvider, LocalProviderModel } from './types.js';
import { isFavorite } from './favorites.js';
import {
  pickModelFromPagedList,
} from './prompts.js';
import { fmtModel, fmtProviderBracket, formatModelLabel } from './ui.js';
import { scoreModelSearch } from './model-search.js';

export interface GlobalFavoritePick {
  providerId: string;
  providerName: string;
  model: LocalProviderModel;
}

const ADD_BY_PROVIDER = '__browse_by_provider__';

export function globalFavoritePickKey(entry: GlobalFavoritePick): string {
  return `${entry.providerId}::${entry.model.id}`;
}

export function buildGlobalFavoriteIndex(providers: LocalProvider[]): GlobalFavoritePick[] {
  const out: GlobalFavoritePick[] = [];
  for (const provider of providers) {
    for (const model of provider.models) {
      out.push({
        providerId: provider.id,
        providerName: provider.name,
        model,
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

function favoriteSearchScore(entry: GlobalFavoritePick, query: string): number {
  const m = entry.model;
  return scoreModelSearch(query, [
    { value: m.name, weight: 800 },
    { value: m.id, weight: 700 },
    { value: m.upstreamModelId, weight: 650 },
    { value: m.brand, weight: 350 },
    { value: m.family, weight: 300 },
    { value: entry.providerName, weight: 240 },
    { value: entry.providerId, weight: 220 },
  ]);
}

export function filterGlobalFavoriteIndex(
  entries: GlobalFavoritePick[],
  query: string,
): GlobalFavoritePick[] {
  if (!query.trim()) return [];
  return entries
    .map((entry, index) => ({ entry, index, score: favoriteSearchScore(entry, query) }))
    .filter(result => result.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    })
    .map(result => result.entry);
}

export function globalFavoriteSelectOption(
  entry: GlobalFavoritePick,
  favorites: FavoriteModel[],
) {
  const label = formatModelLabel(entry.model);
  const favorited = isFavorite(favorites, { providerId: entry.providerId, modelId: entry.model.id });
  const providerTag = fmtProviderBracket(entry.providerId, entry.providerName, entry.model.isFree);
  return {
    value: globalFavoritePickKey(entry),
    label: `${fmtModel(label, entry.model.id)} ${providerTag}`,
    hint: favorited ? pc.dim('already in favorites') : '',
  };
}

function parseGlobalFavoritePickKey(
  key: string,
  index: GlobalFavoritePick[],
): GlobalFavoritePick | undefined {
  return index.find(e => globalFavoritePickKey(e) === key);
}

/** Search all providers; returns null if user cancels or chooses browse-by-provider. */
export async function pickGlobalFavoriteModel(
  providers: LocalProvider[],
  favorites: FavoriteModel[],
): Promise<GlobalFavoritePick | typeof ADD_BY_PROVIDER | null> {
  const index = buildGlobalFavoriteIndex(providers);
  if (index.length === 0) return null;

  while (true) {
    const searchInput = await p.text({
      message: `Search all providers (${index.length} models):`,
      placeholder: 'e.g. deepseek, claude, sonnet',
    });

    if (p.isCancel(searchInput)) {
      const fallback = await p.select({
        message: 'Add a favorite',
        options: [
          { value: 'back', label: pc.cyan('← Back to favorites'), hint: '' },
          { value: ADD_BY_PROVIDER, label: pc.cyan('Browse by provider →'), hint: 'Pick one provider first' },
        ],
      });
      if (p.isCancel(fallback) || fallback === 'back') return null;
      if (fallback === ADD_BY_PROVIDER) return ADD_BY_PROVIDER;
      continue;
    }

    const matched = filterGlobalFavoriteIndex(index, String(searchInput));
    if (matched.length === 0) {
      p.log.warn('No models match — try a different search');
      continue;
    }

    const result = await pickModelFromPagedList(
      matched.map(e => ({ ...e, id: globalFavoritePickKey(e) })),
      e => globalFavoriteSelectOption(
        { providerId: e.providerId, providerName: e.providerName, model: e.model },
        favorites,
      ),
      matched.length === 1 ? 'Match found' : `Select model (${matched.length} matches)`,
      undefined,
      { newSearch: true },
    );

    if (result === 'search') continue;
    if (result === 'browse' || result === 'menu') continue;

    const picked = parseGlobalFavoritePickKey(result.id, matched);
    if (!picked) continue;

    if (isFavorite(favorites, { providerId: picked.providerId, modelId: picked.model.id })) {
      p.log.warn(`${picked.model.name || picked.model.id} (${picked.providerName}) is already in your favorites.`);
      continue;
    }

    return picked;
  }
}

export { ADD_BY_PROVIDER as browseByProviderChoice };
