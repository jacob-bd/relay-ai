import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_MODEL_CATALOG } from '../src/constants.js';
import {
  resolveClaudeAppCatalog,
} from '../src/claude-desktop/model-catalog.js';
import type { FavoriteModel, LocalProvider, LocalProviderModel } from '../src/types.js';

vi.mock('../src/provider-catalog.js', () => ({
  resolveLocalProviderApiKey: vi.fn(async (provider: LocalProvider) => {
    if (provider.authType === 'none') return 'anonymous';
    return provider.apiKey.trim() || null;
  }),
}));

function model(id: string): LocalProviderModel {
  return {
    id,
    name: id,
    family: 'test',
    brand: 'Test',
    modelFormat: 'anthropic',
    upstreamModelId: id,
    baseUrl: 'https://example.test',
  };
}

function provider(
  id: string,
  models: LocalProviderModel[],
  apiKey = `${id}-key`,
  authType: LocalProvider['authType'] = 'api',
): LocalProvider {
  return { id, name: id, apiKey, authType, models };
}

describe('resolveClaudeAppCatalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('puts the selected model first and appends favorites in saved order', async () => {
    const selected = provider('selected', [model('selected-model')]);
    const firstFavorite = provider('favorite-a', [model('favorite-a-model')]);
    const secondFavorite = provider('favorite-b', [model('favorite-b-model')]);
    const favorites: FavoriteModel[] = [
      { providerId: firstFavorite.id, modelId: firstFavorite.models[0]!.id },
      { providerId: secondFavorite.id, modelId: secondFavorite.models[0]!.id },
    ];

    const result = await resolveClaudeAppCatalog(
      selected,
      selected.models[0]!,
      [selected, firstFavorite, secondFavorite],
      favorites,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.entries.map(entry => `${entry.providerId}/${entry.model.id}`)).toEqual([
      'selected/selected-model',
      'favorite-a/favorite-a-model',
      'favorite-b/favorite-b-model',
    ]);
  });

  it('deduplicates the selected model when it is also a favorite', async () => {
    const selected = provider('selected', [model('selected-model')]);

    const result = await resolveClaudeAppCatalog(
      selected,
      selected.models[0]!,
      [selected],
      [{ providerId: selected.id, modelId: selected.models[0]!.id }],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.model.id).toBe('selected-model');
  });

  it('counts the selected model toward the catalog capacity', async () => {
    const selectedModel = model('selected-model');
    const favoriteModels = Array.from(
      { length: MAX_MODEL_CATALOG },
      (_, index) => model(`favorite-${index}`),
    );
    const selected = provider('selected', [selectedModel, ...favoriteModels]);
    const favorites = favoriteModels.map(favorite => ({
      providerId: selected.id,
      modelId: favorite.id,
    }));

    const result = await resolveClaudeAppCatalog(
      selected,
      selectedModel,
      [selected],
      favorites,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.entries).toHaveLength(MAX_MODEL_CATALOG);
    expect(result.entries[0]?.model.id).toBe(selectedModel.id);
    expect(result.capacitySkippedFavorites).toEqual([
      { providerId: selected.id, modelId: `favorite-${MAX_MODEL_CATALOG - 1}` },
    ]);
  });

  it('drops a favorite that has no usable credential', async () => {
    const selected = provider('selected', [model('selected-model')]);
    const missingKey = provider('missing-key', [model('missing-key-model')], '');
    const missingFavorite = { providerId: missingKey.id, modelId: missingKey.models[0]!.id };

    const result = await resolveClaudeAppCatalog(
      selected,
      selected.models[0]!,
      [selected, missingKey],
      [missingFavorite],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.entries).toHaveLength(1);
    expect(result.droppedFavorites).toContainEqual(missingFavorite);
  });

  it('keeps an anonymous provider favorite without a stored key', async () => {
    const selected = provider('selected', [model('selected-model')]);
    const anonymous = provider('anonymous', [model('anonymous-model')], '', 'none');

    const result = await resolveClaudeAppCatalog(
      selected,
      selected.models[0]!,
      [selected, anonymous],
      [{ providerId: anonymous.id, modelId: anonymous.models[0]!.id }],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.entries.some(entry => entry.providerId === anonymous.id)).toBe(true);
    expect(result.entries.find(entry => entry.providerId === anonymous.id)?.apiKey).toBe('anonymous');
  });

  it('fails when the selected model has no usable credential', async () => {
    const selected = provider('selected', [model('selected-model')], '');

    const result = await resolveClaudeAppCatalog(
      selected,
      selected.models[0]!,
      [selected],
      [],
    );

    expect(result).toEqual({
      ok: false,
      error: 'No credential for selected. Run relay-ai providers auth selected.',
    });
  });
});
