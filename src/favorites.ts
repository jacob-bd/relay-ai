import { MAX_MODEL_CATALOG } from './constants.js';
import type { FavoriteModel } from './types.js';

/** Normalize persisted model references without importing one catalog into another. */
export function normalizeFavoriteModels(value: unknown, limit: number): FavoriteModel[] {
  if (!Array.isArray(value) || limit <= 0) return [];
  const out: FavoriteModel[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const providerId = typeof record.providerId === 'string' ? record.providerId.trim() : '';
    const modelId = typeof record.modelId === 'string' ? record.modelId.trim() : '';
    if (!providerId || !modelId) continue;
    const key = `${providerId}\u0000${modelId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ providerId, modelId });
    if (out.length >= limit) break;
  }
  return out;
}

export function isFavorite(list: FavoriteModel[], fav: FavoriteModel): boolean {
  return list.some(f => f.providerId === fav.providerId && f.modelId === fav.modelId);
}

export type AddFavoriteResult =
  | { ok: true; list: FavoriteModel[] }
  | { ok: false; reason: 'duplicate' | 'cap' };

export function addFavorite(
  list: FavoriteModel[],
  fav: FavoriteModel,
  max = MAX_MODEL_CATALOG,
): AddFavoriteResult {
  if (isFavorite(list, fav)) return { ok: false, reason: 'duplicate' };
  if (list.length >= max) return { ok: false, reason: 'cap' };
  return { ok: true, list: [...list, fav] };
}

export function removeFavorite(list: FavoriteModel[], fav: FavoriteModel): FavoriteModel[] {
  return list.filter(f => !(f.providerId === fav.providerId && f.modelId === fav.modelId));
}
