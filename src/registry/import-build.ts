// import-opencode.ts — merge API-key and OAuth providers for OpenCode import

import type { LocalProvider } from '../types.js';
import { normalizeProviders, type RawProvider } from '../providers.js';
import {
  isOpencodeOAuth,
  type OpencodeAuthEntry,
  type OpencodeOAuthCredential,
} from './opencode-auth.js';
import { isLikelyPlaceholderKey } from './refresh-credentials.js';

export interface OAuthImportContext {
  oauthByProviderId: Map<string, OpencodeOAuthCredential>;
}

export function oauthAuthRef(providerId: string): string {
  return `keyring:oauth:provider:${providerId}`;
}

/** Maps a canonical OAuth provider ID to its registry slot (openai → openai-oauth; others unchanged). */
export function toOAuthRegistryId(id: string): string {
  if (id === 'openai') return 'openai-oauth';
  if (id === 'xai') return 'xai-oauth';
  return id;
}

function normalizeImportProviderIdentity(provider: LocalProvider): LocalProvider {
  if (provider.id === 'opencode') {
    return { ...provider, id: 'zen', name: 'OpenCode Zen' };
  }
  if (provider.id === 'opencode-go') {
    return { ...provider, id: 'go', name: 'OpenCode Go' };
  }
  return provider;
}

/** Merge API-key providers from serve with OAuth providers backed by auth.json. */
export function buildImportProviderList(
  raw: RawProvider[],
  authEntries: Record<string, OpencodeAuthEntry>,
): { providers: LocalProvider[]; oauth: OAuthImportContext } {
  const oauthByProviderId = new Map<string, OpencodeOAuthCredential>();
  const covered = new Set<string>();
  const merged: LocalProvider[] = [];

  for (const provider of normalizeProviders(raw)) {
    const normalized = normalizeImportProviderIdentity(provider);
    if (covered.has(normalized.id)) continue;
    merged.push(normalized);
    covered.add(normalized.id);
  }

  for (const provider of raw) {
    if (provider.id === 'opencode' || provider.id === 'opencode-go') continue;
    if (covered.has(provider.id)) continue;

    const authEntry = authEntries[provider.id];
    if (!isOpencodeOAuth(authEntry)) continue;

    const oauthProviders = normalizeProviders(
      [{ ...provider, key: authEntry.access }],
      { includeOAuthPlaceholders: true },
    );
    if (oauthProviders.length === 0) continue;

    const registryId = toOAuthRegistryId(provider.id);
    oauthByProviderId.set(registryId, authEntry);
    merged.push({ ...oauthProviders[0]!, id: registryId, apiKey: '' });
    covered.add(registryId);
    covered.add(provider.id);
  }

  return { providers: merged, oauth: { oauthByProviderId } };
}

export function isOAuthImportProvider(providerId: string, oauth: OAuthImportContext): boolean {
  return oauth.oauthByProviderId.has(providerId);
}

/** OpenCode provider ids that authenticate via OAuth (not API keys). */
export const OPENCODE_OAUTH_PROVIDER_IDS = new Set([
  'xai',
  'openai',
  'github',
  'gitlab',
  'kimi',
  'moonshot',
]);

/** OpenCode stubs that use gcloud/AWS/Azure — never API key or OAuth import. */
export const OPENCODE_MANUAL_ONLY_IDS = new Set([
  'google-vertex',
  'vertex',
  'bedrock',
  'azure',
]);

export type CredentialGapReason = 'oauth-no-token' | 'no-api-key' | 'manual-only';

export function classifyOpencodeCredentialGap(providerId: string): CredentialGapReason {
  if (OPENCODE_MANUAL_ONLY_IDS.has(providerId)) return 'manual-only';
  if (OPENCODE_OAUTH_PROVIDER_IDS.has(providerId)) return 'oauth-no-token';
  return 'no-api-key';
}

/**
 * Providers in OpenCode /config/providers with models but no importable credential.
 * Not all gaps are OAuth — Anthropic/Google often mean "no API key in OpenCode".
 */
export function listCredentialSkippedProviders(
  raw: RawProvider[],
  authEntries: Record<string, OpencodeAuthEntry>,
  importedIds: Set<string>,
  alreadyReportedIds: Set<string> = new Set(),
  registryProviderIds: Set<string> = new Set(),
): Array<{ id: string; name: string; reason: CredentialGapReason }> {
  const skipped: Array<{ id: string; name: string; reason: CredentialGapReason }> = [];
  for (const provider of raw) {
    if (provider.id === 'opencode' || provider.id === 'opencode-go') continue;
    if (importedIds.has(provider.id)) continue;
    if (alreadyReportedIds.has(provider.id)) continue;
    const hasApiKey = !!provider.key?.trim() && !isLikelyPlaceholderKey(provider.key);
    if (hasApiKey) continue;
    if (isOpencodeOAuth(authEntries[provider.id])) continue;
    if (!provider.models || Object.keys(provider.models).length === 0) continue;

    const reason = classifyOpencodeCredentialGap(provider.id);
    // Only surface actionable gaps: OAuth sign-in needed, or a provider you already
    // use in relay-ai that OpenCode still has without credentials. Skip random OpenCode
    // catalog stubs (e.g. Google with models but no key) the user never configured.
    if (reason !== 'oauth-no-token' && !registryProviderIds.has(provider.id)) continue;

    skipped.push({ id: provider.id, name: provider.name, reason });
  }
  return skipped;
}

/** @deprecated Use listCredentialSkippedProviders */
export const listOAuthSkippedProviders = listCredentialSkippedProviders;
