// src/favorites-resolver.ts
import type { FavoriteModel, LocalProvider, LocalProviderModel, ModelInfo } from './types.js';
import type { ServerModelInfo } from './server/models.js';
import { shouldHideModel, type CompatibilityAgent } from './model-compatibility.js';
import { resolveLocalProviderApiKey } from './provider-catalog.js';
import { providerRefreshToken } from './provider-runtime.js';

export interface ResolvedFavorite {
  providerId: string;
  providerName: string;
  model: LocalProviderModel | ServerModelInfo;
  apiKey: string;
  authType?: 'api' | 'oauth' | 'none';
  oauthAccountId?: string;
  providerData?: Record<string, unknown>;
  headers?: Record<string, string>;
  refreshToken?: () => Promise<string | null>;
}

/**
 * Per-surface resolution context. Each surface (Claude, Codex, Server) builds
 * its own context and passes it to resolveFavorite / buildFavoritesList.
 * The resolver is route-shape-agnostic — each caller builds its own route type.
 */
export interface ResolveContext {
  /** When set, call shouldHideModel with this agent to filter blacklisted favorites. */
  agent?: CompatibilityAgent;
  /** Claude: registry providers from opencode. */
  localProviders?: LocalProvider[];
  /** Server: pre-loaded server model list. */
  serverModels?: ServerModelInfo[];
  /** Lookup function for a registry model. Returns the model + its parent provider. */
  findLocalModel?: LocalModelLookup;
}

export interface LocalModelLookupResult {
  provider: LocalProvider;
  model: LocalProviderModel;
}

export type LocalModelLookup =
  (providerId: string, modelId: string) => LocalModelLookupResult | undefined;

const ZEN_GO_PROVIDER_NAME: Record<'zen' | 'go', string> = {
  zen: 'OpenCode Zen',
  go: 'OpenCode Go',
};

export async function resolveFavorite(
  fav: FavoriteModel,
  ctx: ResolveContext,
): Promise<ResolvedFavorite | undefined> {
  if (ctx.findLocalModel) {
    const found = ctx.findLocalModel(fav.providerId, fav.modelId);
    if (!found) return undefined;
    if (ctx.agent && shouldHideModel({ providerId: fav.providerId, modelId: fav.modelId, agent: ctx.agent })) {
      return undefined;
    }
    return {
      providerId: fav.providerId,
      providerName: found.provider.name,
      model: found.model,
      apiKey: (await resolveLocalProviderApiKey(found.provider)) ?? '',
      authType: found.provider.authType,
      oauthAccountId: found.provider.oauthAccountId,
      providerData: found.provider.providerData,
      headers: found.provider.headers,
      refreshToken: providerRefreshToken(found.provider.id, found.provider.authType, found.provider.authRef),
    };
  }

  return undefined;
}

export interface BuildFavoritesListOptions {
  dropEmptyApiKey?: boolean;
  trackCapacitySkipped?: boolean;
}

export async function buildFavoritesList(
  starting: ResolvedFavorite | undefined,
  favorites: FavoriteModel[],
  ctx: ResolveContext,
  max = 20,
  options: BuildFavoritesListOptions = {},
): Promise<{
  resolved: ResolvedFavorite[];
  droppedFavorites: FavoriteModel[];
  capacitySkippedFavorites: FavoriteModel[];
}> {
  const seen = new Set<string>();
  const out: ResolvedFavorite[] = [];

  if (starting) {
    seen.add(`${starting.providerId}::${starting.model.id}`);
    out.push(starting);
  }

  const uniqueFavorites = favorites.filter(fav => {
    const key = `${fav.providerId}::${fav.modelId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const resolutions = await Promise.all(uniqueFavorites.map(fav => resolveFavorite(fav, ctx)));

  const droppedFavorites: FavoriteModel[] = [];
  const capacitySkippedFavorites: FavoriteModel[] = [];
  for (let i = 0; i < uniqueFavorites.length; i++) {
    const resolved = resolutions[i];
    if (!resolved || (options.dropEmptyApiKey && !resolved.apiKey.trim())) {
      droppedFavorites.push(uniqueFavorites[i]!);
      continue;
    }
    if (out.length < max) {
      out.push(resolved);
    } else if (options.trackCapacitySkipped) {
      capacitySkippedFavorites.push(uniqueFavorites[i]!);
    }
  }

  return { resolved: out, droppedFavorites, capacitySkippedFavorites };
}

export function resolveFirstAvailableFavorite(
  favorites: FavoriteModel[],
  providers: LocalProvider[],
): LocalModelLookupResult | undefined {
  for (const fav of favorites) {
    const provider = providers.find(lp => lp.id === fav.providerId);
    const model = provider?.models.find(m => m.id === fav.modelId);
    if (provider && model) return { provider, model };
  }
  return undefined;
}
