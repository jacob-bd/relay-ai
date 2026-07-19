// src/registry/load.ts — materialize registry into runtime LocalProvider[]

import { resolveProviderCredential, resolveProviderOAuthAccountId, resolveProviderOAuthProviderData } from '../env.js';
import type { CompatibilityAgent } from '../model-compatibility.js';
import type { LocalProvider } from '../types.js';
import { materializeRegistry } from './materialize.js';
import { loadRegistry } from './io.js';
import { copilotPlanTier, filterCachedCopilotModels } from './copilot-models.js';

/** Load enabled providers from ~/.relay-ai/providers.json with resolved credentials. */
export async function loadRegistryProviders(
  diag?: (msg: string) => void,
  opts?: { agent?: CompatibilityAgent },
): Promise<LocalProvider[]> {
  const registry = loadRegistry();
  const keys = new Map<string, string>();
  const oauthAccountIds = new Map<string, string>();
  const oauthProviderData = new Map<string, Record<string, unknown>>();
  await Promise.all(registry.providers.map(async provider => {
    try {
      const key = await resolveProviderCredential(provider.id, provider.authRef, diag);
      if (key) keys.set(provider.id, key);
    } catch (err) {
      diag?.(`${provider.id}: credential unavailable — ${err instanceof Error ? err.message : String(err)}`);
    }
    if (provider.authType === 'oauth') {
      try {
        const accountId = await resolveProviderOAuthAccountId(provider.authRef, diag);
        if (accountId) oauthAccountIds.set(provider.id, accountId);
        const pd = await resolveProviderOAuthProviderData(provider.authRef, diag);
        if (pd) oauthProviderData.set(provider.id, pd);
      } catch {
        // OAuth metadata is best-effort; credential failure already logged above.
      }
    }
  }));
  const runtimeRegistry = {
    ...registry,
    providers: registry.providers.map(provider => {
      if (provider.id !== 'github-copilot' || !provider.modelsCache) return provider;
      return {
        ...provider,
        modelsCache: {
          ...provider.modelsCache,
          models: filterCachedCopilotModels(
            provider.modelsCache.models,
            copilotPlanTier(oauthProviderData.get(provider.id)),
          ),
        },
      };
    }),
  };
  return materializeRegistry(runtimeRegistry, provider => keys.get(provider.id) ?? null, opts)
    .map(provider => ({
      ...provider,
      oauthAccountId: oauthAccountIds.get(provider.id),
      providerData: oauthProviderData.get(provider.id),
    }));
}

/** Sync variant when credentials are already resolved (tests). */
export function loadRegistryProvidersSync(
  resolveKey: (providerId: string, authRef: string) => string | null,
  opts?: { agent?: CompatibilityAgent },
): LocalProvider[] {
  const registry = loadRegistry();
  return materializeRegistry(registry, provider => resolveKey(provider.id, provider.authRef), opts);
}
