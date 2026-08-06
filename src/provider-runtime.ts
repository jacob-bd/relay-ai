import { forceRefreshProviderCredential } from './env.js';
import { oauthAuthRef } from './registry/import-build.js';

/**
 * Resolve the current raw OAuth access token for a registry provider.
 * `resolveProviderCredential` also performs the existing proactive refresh
 * and persists the refreshed credential when the stored token is expiring.
 */
export function providerRefreshToken(
  providerId: string | undefined,
  authType: 'api' | 'oauth' | 'none' | undefined,
  authRef?: string,
): (() => Promise<string | null>) | undefined {
  if (authType !== 'oauth' || !providerId) return undefined;
  return () => forceRefreshProviderCredential(providerId, authRef ?? oauthAuthRef(providerId));
}
