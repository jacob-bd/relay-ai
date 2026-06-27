// src/favorites-resolver.ts
import type { FavoriteModel, LocalProvider, LocalProviderModel, ModelInfo } from './types.js';
import type { ServerModelInfo } from './server/models.js';
import { shouldHideModel, type CompatibilityAgent } from './model-compatibility.js';

export interface ResolvedFavorite {
  providerId: string;
  providerName: string;
  model: LocalProviderModel | ServerModelInfo;
  apiKey: string;
  authType?: 'api' | 'oauth' | 'none';
  oauthAccountId?: string;
  /** Zen/Go only — which backend this favorite came from. */
  sourceBackend?: 'zen' | 'go';
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
  /** Claude: Zen free models (for the favorite pointing to zen). */
  zenModels?: ModelInfo[];
  /** Claude: Go paid models (for the favorite pointing to go). */
  goModels?: ModelInfo[];
  /** Claude: shared Zen/Go API key. */
  zenGoApiKey?: string | null;
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

export function resolveFavorite(
  fav: FavoriteModel,
  ctx: ResolveContext,
): ResolvedFavorite | undefined {
  if (fav.providerId === 'zen' || fav.providerId === 'go') {
    if (!ctx.zenGoApiKey) return undefined;
    const models = fav.providerId === 'zen' ? ctx.zenModels : ctx.goModels;
    const model = models?.find(m => m.id === fav.modelId);
    if (!model) return undefined;
    return {
      providerId: fav.providerId,
      providerName: ZEN_GO_PROVIDER_NAME[fav.providerId],
      model,
      apiKey: ctx.zenGoApiKey,
      sourceBackend: fav.providerId,
    };
  }

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
      apiKey: found.provider.apiKey,
      authType: found.provider.authType,
      oauthAccountId: found.provider.oauthAccountId,
    };
  }

  return undefined;
}

export function buildFavoritesList(
  starting: ResolvedFavorite | undefined,
  favorites: FavoriteModel[],
  ctx: ResolveContext,
  max = 20,
): { resolved: ResolvedFavorite[]; droppedFavorites: FavoriteModel[] } {
  const droppedFavorites: FavoriteModel[] = [];
  const seen = new Set<string>();
  const out: ResolvedFavorite[] = [];

  if (starting) {
    seen.add(`${starting.providerId}::${starting.model.id}`);
    out.push(starting);
  }

  for (const fav of favorites) {
    if (out.length >= max) break;
    const key = `${fav.providerId}::${fav.modelId}`;
    if (seen.has(key)) continue;
    const resolved = resolveFavorite(fav, ctx);
    if (!resolved) {
      droppedFavorites.push(fav);
      continue;
    }
    seen.add(key);
    out.push(resolved);
  }

  return { resolved: out, droppedFavorites };
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
