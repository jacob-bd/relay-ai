import { describe, it, expect } from 'vitest';
import { filterServerModelsByFavorites } from '../src/server/catalog-filter.js';
import { MAX_MODEL_CATALOG } from '../src/constants.js';
import { getServerFavoritesOnly, setServerFavoritesOnly } from '../src/config.js';
import type { ServerModelInfo } from '../src/server/models.js';
import type { FavoriteModel } from '../src/types.js';

describe('server favoritesOnly preference', () => {
  it('round-trips through setServerFavoritesOnly / getServerFavoritesOnly', () => {
    setServerFavoritesOnly(true);
    expect(getServerFavoritesOnly()).toBe(true);
    setServerFavoritesOnly(false);
    expect(getServerFavoritesOnly()).toBe(false);
  });
});

describe('server favorites-only catalog', () => {
  it('caps at MAX_MODEL_CATALOG', () => {
    const models: ServerModelInfo[] = Array.from({ length: 60 }, (_, i) => ({
      providerId: `p${i}`,
      id: `m${i}`,
      displayName: `Model ${i}`,
      contextWindow: 100000,
    }));
    const favorites: FavoriteModel[] = models.map(m => ({
      providerId: m.providerId!,
      modelId: m.id,
    }));

    const filtered = filterServerModelsByFavorites(models, favorites).slice(0, MAX_MODEL_CATALOG);

    expect(filtered).toHaveLength(MAX_MODEL_CATALOG);
  });
});
