import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_MODEL_CATALOG } from '../src/constants.js';
import {
  buildClaudeAppServerCatalog,
  resolveClaudeAppCatalog,
} from '../src/claude-desktop/model-catalog.js';
import type { ResolvedFavorite } from '../src/favorites-resolver.js';
import type { FavoriteModel, LocalProvider, LocalProviderModel } from '../src/types.js';

const backendState = vi.hoisted(() => ({
  inputs: [] as Array<{ providerId: string; model: LocalProviderModel; apiKey: string }>,
}));

vi.mock('../src/provider-catalog.js', () => ({
  resolveLocalProviderApiKey: vi.fn(async (provider: LocalProvider) => {
    if (provider.authType === 'none') return 'anonymous';
    return provider.apiKey.trim() || null;
  }),
}));

vi.mock('../src/cloud-code-backend.js', () => ({
  partitionAndStartCloudCodeBackend: vi.fn(async (
    items: Array<{ providerId: string; model: LocalProviderModel; apiKey: string }>,
    toOutput: (route: { aliasId: string }, backend: any, item: any) => unknown,
  ) => {
    backendState.inputs = items;
    if (items.length === 0) return { backendItems: [], backend: null };
    const backend = {
      port: 19001,
      token: 'backend-token',
      handle: { close: vi.fn() },
    };
    return {
      backend,
      backendItems: items.map(item => toOutput({
        aliasId: `anthropic-${item.providerId}__${item.model.id}`,
      }, backend, item)),
    };
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

describe('buildClaudeAppServerCatalog', () => {
  beforeEach(() => {
    backendState.inputs = [];
    vi.clearAllMocks();
  });

  it('keeps mixed regular and Cloud Code entries in their original order', async () => {
    const selectedProvider = provider('regular-selected', [model('selected-model')]);
    const cloudModel: LocalProviderModel = {
      ...model('gemini-test'),
      modelFormat: 'cloud-code',
      upstreamModelId: 'gemini-upstream',
    };
    const cloudProvider = provider('antigravity', [cloudModel], 'oauth-token', 'oauth');
    const favoriteProvider = provider('regular-favorite', [model('favorite-model')]);
    const entries: ResolvedFavorite[] = [
      {
        providerId: selectedProvider.id,
        providerName: selectedProvider.name,
        model: selectedProvider.models[0]!,
        apiKey: 'selected-resolved-key',
      },
      {
        providerId: cloudProvider.id,
        providerName: cloudProvider.name,
        model: cloudModel,
        apiKey: 'cloud-resolved-key',
        authType: 'oauth',
        providerData: { refresh: 'data' },
      },
      {
        providerId: favoriteProvider.id,
        providerName: favoriteProvider.name,
        model: favoriteProvider.models[0]!,
        apiKey: 'favorite-resolved-key',
      },
    ];
    const providersById = new Map([
      [selectedProvider.id, selectedProvider],
      [cloudProvider.id, cloudProvider],
      [favoriteProvider.id, favoriteProvider],
    ]);

    const built = await buildClaudeAppServerCatalog(entries, providersById, false);

    expect(built.serverModels.map(serverModel => serverModel.providerId)).toEqual([
      'regular-selected',
      'antigravity',
      'regular-favorite',
    ]);
    expect(built.serverModels[1]).toMatchObject({
      modelFormat: 'anthropic',
      upstreamModelId: 'anthropic-antigravity__gemini-test',
      baseUrl: 'http://127.0.0.1:19001',
      apiKey: 'backend-token',
    });
    expect(built.backend).not.toBeNull();
    expect(backendState.inputs).toEqual([expect.objectContaining({
      providerId: cloudProvider.id,
      model: cloudModel,
      apiKey: 'cloud-resolved-key',
      providerData: { refresh: 'data' },
    })]);
  });

  it('does not start a backend and keeps each resolved key for regular entries', async () => {
    const selectedProvider = provider('selected', [model('selected-model')], 'stored-selected-key');
    const favoriteProvider = provider('favorite', [model('favorite-model')], 'stored-favorite-key');
    const entries: ResolvedFavorite[] = [
      {
        providerId: selectedProvider.id,
        providerName: selectedProvider.name,
        model: selectedProvider.models[0]!,
        apiKey: 'resolved-selected-key',
      },
      {
        providerId: favoriteProvider.id,
        providerName: favoriteProvider.name,
        model: favoriteProvider.models[0]!,
        apiKey: 'resolved-favorite-key',
      },
    ];

    const built = await buildClaudeAppServerCatalog(
      entries,
      new Map([
        [selectedProvider.id, selectedProvider],
        [favoriteProvider.id, favoriteProvider],
      ]),
    );

    expect(built.backend).toBeNull();
    expect(built.serverModels.map(serverModel => serverModel.apiKey)).toEqual([
      'resolved-selected-key',
      'resolved-favorite-key',
    ]);
  });
});
