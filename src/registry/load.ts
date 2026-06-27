// src/registry/load.ts — materialize registry into runtime LocalProvider[]

import { resolveProviderCredential, resolveProviderOAuthAccountId, resolveProviderOAuthProviderData } from '../env.js';
import type { CompatibilityAgent } from '../model-compatibility.js';
import type { LocalProvider } from '../types.js';
import { materializeRegistry } from './materialize.js';
import { loadRegistry } from './io.js';

/** Load enabled providers from ~/.relay-ai/providers.json with resolved credentials. */
export async function loadRegistryProviders(
  diag?: (msg: string) => void,
  opts?: { agent?: CompatibilityAgent },
): Promise<LocalProvider[]> {
  const registry = loadRegistry();
  const keys = new Map<string, string>();
  const oauthAccountIds = new Map<string, string>();
  const oauthProviderData = new Map<string, Record<string, unknown>>();
  for (const provider of registry.providers) {
    const key = await resolveProviderCredential(provider.id, provider.authRef, diag);
    if (key) keys.set(provider.id, key);
    if (provider.authType === 'oauth') {
      const accountId = await resolveProviderOAuthAccountId(provider.authRef, diag);
      if (accountId) oauthAccountIds.set(provider.id, accountId);
      const pd = await resolveProviderOAuthProviderData(provider.authRef, diag);
      if (pd) oauthProviderData.set(provider.id, pd);
    }
  }
  return materializeRegistry(registry, provider => keys.get(provider.id) ?? null, opts)
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
