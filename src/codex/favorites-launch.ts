import * as p from '@clack/prompts';
import type { CodexProxyRoute } from '../codex-proxy.js';
import { buildFavoritesList, resolveFavorite } from '../favorites-resolver.js';
import type { ResolveContext, ResolvedFavorite } from '../favorites-resolver.js';
import { shouldHideModel, type CompatibilityAgent } from '../model-compatibility.js';
import { resolveCodexRoute } from './routing.js';
import type { LocalProvider, LocalProviderModel, FavoriteModel, UserPreferences } from '../types.js';
import { codexCliFavoritesSlug } from './favorites-catalog.js';
import { pickProviderModel } from '../prompts.js';

export type BootSelectionResult =
  | { provider: LocalProvider; model: LocalProviderModel }
  | { error: string };

type ProviderWrapper = (provider: LocalProvider) => LocalProvider;

const identityProvider: ProviderWrapper = provider => provider;

/** Synthetic provider id used by the favorites starting-model picker. */
const FAVORITES_PICKER_PROVIDER_ID = '__favorites_catalog__';
const FAVORITES_PICKER_RECENT_CAP = 3;

export interface FavoriteStartChoice {
  provider: LocalProvider;
  model: LocalProviderModel;
}

/**
 * Resolve the currently available favorites for `agent`, in saved order.
 * Providers are passed through `wrapProvider` so agent-specific views (e.g.
 * Codex routable-model filtering) are applied before matching.
 */
export function listAvailableFavorites(
  compatible: LocalProvider[],
  favorites: FavoriteModel[],
  agent: CompatibilityAgent,
  wrapProvider: ProviderWrapper = identityProvider,
): FavoriteStartChoice[] {
  const favoriteProviders = compatible.map(wrapProvider);
  const available: FavoriteStartChoice[] = [];
  for (const fav of favorites) {
    if (shouldHideModel({ providerId: fav.providerId, modelId: fav.modelId, agent })) {
      continue;
    }
    const provider = favoriteProviders.find(lp => lp.id === fav.providerId);
    const model = provider?.models.find(m => m.id === fav.modelId);
    if (provider && model) available.push({ provider, model });
  }
  return available;
}

/**
 * Recently used favorites, newest first, as picker keys (`provider::model`).
 * Built from the per-provider recent lists so a favorite used on any tool is
 * pre-selected the next time Favorites Catalog is opened.
 */
function favoriteRecentKeys(available: FavoriteStartChoice[], prefs: UserPreferences): string[] {
  const ranks = new Map<string, number>();
  for (const [providerId, modelIds] of Object.entries(prefs.recentModelsByProvider ?? {})) {
    modelIds.forEach((modelId, index) => {
      ranks.set(`${providerId}::${modelId}`, index);
    });
  }
  return available
    .map((entry, index) => ({ key: `${entry.provider.id}::${entry.model.id}`, index }))
    .filter(entry => ranks.has(entry.key))
    .sort((a, b) => (ranks.get(a.key)! - ranks.get(b.key)!) || a.index - b.index)
    .slice(0, FAVORITES_PICKER_RECENT_CAP)
    .map(entry => entry.key);
}

/**
 * Interactive starting-model picker for the Favorites Catalog: the same
 * "Which model?" experience as a provider (recently used first, browse all with
 * search, refresh, go back), but scoped to saved favorites. Returns the chosen
 * provider + model, 'back' when the user wants to pick another provider, or
 * null when no favorite is currently available.
 */
export async function pickFavoriteStartModel(
  compatible: LocalProvider[],
  favorites: FavoriteModel[],
  agent: CompatibilityAgent,
  prefs: UserPreferences,
  refresh?: () => Promise<void>,
  wrapProvider: ProviderWrapper = identityProvider,
): Promise<FavoriteStartChoice | 'back' | null> {
  const byKey = new Map<string, FavoriteStartChoice>();

  const buildProvider = (): LocalProvider | null => {
    byKey.clear();
    const available = listAvailableFavorites(compatible, favorites, agent, wrapProvider);
    if (available.length === 0) return null;
    const models: LocalProviderModel[] = [];
    for (const entry of available) {
      const key = `${entry.provider.id}::${entry.model.id}`;
      byKey.set(key, entry);
      models.push({ ...entry.model, id: key });
    }
    return { id: FAVORITES_PICKER_PROVIDER_ID, name: 'Favorites Catalog', apiKey: 'favorites-picker', models };
  };

  while (true) {
    const provider = buildProvider();
    if (!provider) return null;
    const recents = favoriteRecentKeys(
      Array.from(byKey.values()),
      prefs,
    );
    const pickerPrefs: UserPreferences = {
      ...prefs,
      recentModelsByProvider: {
        ...(prefs.recentModelsByProvider ?? {}),
        [FAVORITES_PICKER_PROVIDER_ID]: recents,
        // The synthetic provider is the only list shown, so a stale real-model
        // lastModel must not preselect a different entry.
      },
      lastModel: undefined,
    };
    let didRefresh = false;
    const picked = await pickProviderModel(provider, pickerPrefs, {
      message: 'Which model?',
      maxRecent: FAVORITES_PICKER_RECENT_CAP,
      refresh: refresh && (async () => {
        await refresh();
        didRefresh = true;
      }),
    });
    if (didRefresh) continue;
    if (picked === 'back') return 'back';
    if (!picked) return null;
    return byKey.get(picked.id) ?? null;
  }
}

export function resolveBootSelection(
  compatible: LocalProvider[],
  launchProvider: string,
  launchModel: string,
  wrapProvider: ProviderWrapper = identityProvider,
): BootSelectionResult {
  const foundProvider = compatible.find(provider => provider.id === launchProvider);
  if (!foundProvider) {
    return { error: `Provider not found: ${launchProvider}` };
  }

  const provider = wrapProvider(foundProvider);
  const model = provider.models.find(m => m.id === launchModel);
  if (!model) {
    return { error: `Model ${launchModel} not found on provider ${foundProvider.name}` };
  }

  return { provider, model };
}

export function buildCodexProxyRoutesFromResolved(
  resolved: ResolvedFavorite[],
  providersById: Map<string, LocalProvider>,
): CodexProxyRoute[] {
  const skippedOAuth: string[] = [];
  const routes = resolved
    .map(r => {
      const provider = providersById.get(r.providerId);
      if (!provider) return undefined;
      const model = r.model as LocalProviderModel;

      // Skip if OAuth provider has empty apiKey (OAuth refresh flows not supported in favorites proxy)
      if (!r.apiKey && provider.authType === 'oauth') {
        skippedOAuth.push(`${r.providerId}/${model.id}`);
        return undefined;
      }

      const route = resolveCodexRoute(provider, model, r.apiKey);
      return {
        modelId: codexCliFavoritesSlug(r.providerId, model.id),
        npm: route.npm,
        apiKey: route.apiKey,
        baseURL: route.baseURL,
        upstreamModelId: route.upstreamModelId,
        providerId: route.providerId,
        authType: route.authType,
        oauthAccountId: route.oauthAccountId,
        providerData: route.providerData,
        contextWindow: route.contextWindow,
        // Reasoning metadata decides whether a picked effort can be translated
        // at all (e.g. OpenRouter's supportedParameters gate). Dropping these
        // silently turned every effort selection into a no-op on the wire.
        supportedParameters: route.supportedParameters,
        reasoning: route.reasoning,
        interleavedReasoningField: route.interleavedReasoningField,
        reasoningEffortLevels: route.reasoningEffortLevels,
        reasoningEffortConflict: route.reasoningEffortConflict,
        headers: route.headers,
      } as CodexProxyRoute;
    })
    .filter((r): r is CodexProxyRoute => r !== undefined);

  if (skippedOAuth.length > 0) {
    p.log.warn(
      `Skipped ${skippedOAuth.length} OAuth favorite(s) (OAuth auth not supported in favorites catalog): ${skippedOAuth.join(', ')}`,
    );
  }

  return routes;
}


export async function resolveCodexFavorites(
  activeProvider: LocalProvider,
  selectedModel: LocalProviderModel,
  compatible: LocalProvider[],
  favorites: FavoriteModel[],
  agent: CompatibilityAgent,
): Promise<{
  resolvedFavorites: ResolvedFavorite[];
  providersById: Map<string, LocalProvider>;
}> {
  const ctx: ResolveContext = {
    agent,
    localProviders: compatible,
    findLocalModel: (pid, mid) => {
      const provider = compatible.find(lp => lp.id === pid);
      const model = provider?.models.find(m => m.id === mid);
      return provider && model ? { provider, model } : undefined;
    },
  };
  const startingResolved = await resolveFavorite(
    { providerId: activeProvider.id, modelId: selectedModel.id },
    ctx,
  );
  const { resolved, droppedFavorites } = await buildFavoritesList(
    startingResolved,
    favorites,
    ctx,
  );
  if (droppedFavorites.length > 0) {
    p.log.warn(
      `Skipped ${droppedFavorites.length} stale/unauthorized favorite(s): ${droppedFavorites.map(f => `${f.providerId}:${f.modelId}`).join(', ')}`,
    );
  }
  return {
    resolvedFavorites: resolved,
    providersById: new Map(compatible.map(lp => [lp.id, lp])),
  };
}

export interface ResolvedCodexMixedModels {
  selected: ResolvedFavorite;
  visible: ResolvedFavorite[];
  subagents: ResolvedFavorite[];
  all: ResolvedFavorite[];
  providersById: Map<string, LocalProvider>;
  dropped: FavoriteModel[];
  capacitySkipped: FavoriteModel[];
}

/**
 * Mixed mode must not silently fall back to native sub-agents when a configured
 * Relay Sub-agent cannot be resolved. The catalog is user-controlled, so every
 * configured entry is part of the launch contract.
 */
export function assertConfiguredCodexSubagentsResolved(
  configured: FavoriteModel[],
  resolved: Pick<ResolvedCodexMixedModels, 'subagents'>,
): void {
  const resolvedKeys = new Set(
    resolved.subagents.map(entry => `${entry.providerId}:${entry.model.id}`),
  );
  const missing = configured.filter(entry => !resolvedKeys.has(`${entry.providerId}:${entry.modelId}`));
  if (missing.length === 0) return;

  throw new Error(
    `Configured Codex Sub-agent model(s) are unavailable for this launch: ${missing.map(entry => `${entry.providerId}:${entry.modelId}`).join(', ')}. `
      + 'Check the provider credential and refresh the provider model catalog. Mixed mode was not started.',
  );
}

export async function resolveCodexMixedModels(input: {
  activeProvider: LocalProvider;
  selectedModel: LocalProviderModel;
  compatible: LocalProvider[];
  generalFavorites: FavoriteModel[];
  subagentFavorites: FavoriteModel[];
}): Promise<ResolvedCodexMixedModels> {
  const ctx: ResolveContext = {
    agent: 'codex',
    localProviders: input.compatible,
    findLocalModel: (providerId, modelId) => {
      const provider = input.compatible.find(lp => lp.id === providerId);
      const model = provider?.models.find(m => m.id === modelId);
      return provider && model ? { provider, model } : undefined;
    },
  };
  const selected = await resolveFavorite(
    { providerId: input.activeProvider.id, modelId: input.selectedModel.id },
    ctx,
  );
  if (!selected) throw new Error('Selected Codex model is no longer available');
  const visibleResult = await buildFavoritesList(selected, input.generalFavorites, ctx, 20, { trackCapacitySkipped: true });
  const subagentResult = await buildFavoritesList(undefined, input.subagentFavorites, ctx, 20, { trackCapacitySkipped: true });
  const all: ResolvedFavorite[] = [...visibleResult.resolved];
  for (const entry of subagentResult.resolved) {
    const key = `${entry.providerId}\0${entry.model.id}`;
    if (!all.some(existing => `${existing.providerId}\0${existing.model.id}` === key)) all.push(entry);
  }
  return {
    selected,
    visible: visibleResult.resolved,
    subagents: subagentResult.resolved,
    all,
    providersById: new Map(input.compatible.map(provider => [provider.id, provider])),
    dropped: [...visibleResult.droppedFavorites, ...subagentResult.droppedFavorites],
    capacitySkipped: [...visibleResult.capacitySkippedFavorites, ...subagentResult.capacitySkippedFavorites],
  };
}
