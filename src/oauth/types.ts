// oauth/types.ts — stored OAuth credential shape (matches OpenCode auth.json)

import type { OpencodeOAuthCredential } from '../registry/opencode-auth.js';

export type StoredOAuthCredential = OpencodeOAuthCredential;

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
}

export function tokensToStoredCredential(
  tokens: OAuthTokenResponse,
  existingRefresh?: string,
  accountId?: string,
  providerData?: Record<string, unknown>,
): StoredOAuthCredential {
  return {
    type: 'oauth',
    access: tokens.access_token,
    refresh: tokens.refresh_token ?? existingRefresh ?? '',
    expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    ...(accountId ? { accountId } : {}),
    ...(providerData ? { providerData } : {}),
  };
}

export function parseStoredOAuthCredential(raw: string | null): StoredOAuthCredential | null {
  if (!raw?.trim().startsWith('{')) return null;
  try {
    const parsed = JSON.parse(raw) as StoredOAuthCredential;
    if (parsed.type === 'oauth'
      && typeof parsed.access === 'string'
      && typeof parsed.refresh === 'string'
      && typeof parsed.expires === 'number') {
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

export const OAUTH_REFRESH_SKEW_MS = 120_000;

export function oauthCredentialNeedsRefresh(cred: StoredOAuthCredential, skewMs = OAUTH_REFRESH_SKEW_MS): boolean {
  return cred.expires <= Date.now() + Math.max(0, skewMs);
}

/** JWT exp claim — best-effort; opaque tokens return false (no proactive refresh). */
export function accessTokenIsExpiring(token: string | undefined, skewMs = OAUTH_REFRESH_SKEW_MS): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length < 2) return false;
  try {
    let payload = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
    while (payload.length % 4 !== 0) payload += '=';
    const claims = JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as { exp?: number };
    if (typeof claims.exp !== 'number') return false;
    return claims.exp * 1000 <= Date.now() + Math.max(0, skewMs);
  } catch {
    return false;
  }
}

export const NATIVE_OAUTH_PROVIDER_IDS = ['xai', 'xai-oauth', 'openai', 'openai-oauth', 'github-copilot', 'claude-code', 'antigravity'] as const;
export type NativeOAuthProviderId = typeof NATIVE_OAUTH_PROVIDER_IDS[number];

export function supportsNativeOAuth(providerId: string): providerId is NativeOAuthProviderId {
  return (NATIVE_OAUTH_PROVIDER_IDS as readonly string[]).includes(providerId);
}

/** Providers that use Authorization Code + PKCE (browser redirect), not device code polling. */
export const BROWSER_REDIRECT_OAUTH_IDS = ['claude-code', 'antigravity'] as const;
export type BrowserRedirectOAuthId = typeof BROWSER_REDIRECT_OAUTH_IDS[number];

export function isBrowserRedirectOAuth(id: string): id is BrowserRedirectOAuthId {
  return (BROWSER_REDIRECT_OAUTH_IDS as readonly string[]).includes(id);
}
