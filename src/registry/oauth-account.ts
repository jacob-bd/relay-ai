// src/registry/oauth-account.ts — "who is signed in" line for an OAuth provider

import { readStoredOAuthCredential } from '../env.js';
import { describeOAuthAccount, formatOAuthAccount } from '../oauth/identity.js';
import type { RegistryProvider } from './types.js';

/** e.g. "you@example.com · plus" from the stored sign-in; undefined when unknown or unreadable. */
export async function readOAuthAccountLabel(
  provider: Pick<RegistryProvider, 'id' | 'authRef' | 'authType'>,
): Promise<string | undefined> {
  if (provider.authType !== 'oauth') return undefined;
  try {
    const cred = await readStoredOAuthCredential(provider.authRef);
    if (!cred) return undefined;
    return formatOAuthAccount(describeOAuthAccount({
      kind: provider.id,
      accountId: cred.accountId,
      providerData: cred.providerData,
      accessToken: cred.access,
    }));
  } catch {
    return undefined;
  }
}
