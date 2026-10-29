// oauth/refresh.ts — refresh OAuth tokens before inference

import { refreshOpenAiAccessToken } from './openai.js';
import { refreshGithubCopilotToken } from './github.js';
import type { StoredOAuthCredential } from './types.js';
import { accessTokenIsExpiring, NATIVE_OAUTH_PROVIDER_IDS, oauthCredentialNeedsRefresh, tokensToStoredCredential } from './types.js';
import { refreshXaiAccessToken } from './xai.js';
import { refreshClaudeCodeToken } from './claude-code.js';
import { refreshAntigravityToken } from './antigravity-oauth.js';
import { refreshClinePassAccessToken } from './cline-pass.js';
import { providerKind } from '../registry/provider-kind.js';

export function oauthCredentialShouldRefresh(
  cred: StoredOAuthCredential,
  providerId: string,
): boolean {
  if (oauthCredentialNeedsRefresh(cred)) return true;
  // All native OAuth providers use short-lived access tokens — check expiry proactively
  if ((NATIVE_OAUTH_PROVIDER_IDS as readonly string[]).includes(providerKind(providerId)) && accessTokenIsExpiring(cred.access)) return true;
  return false;
}

export async function refreshStoredOAuthCredential(
  providerId: string,
  cred: StoredOAuthCredential,
): Promise<StoredOAuthCredential> {
  if (!cred.refresh) {
    throw new Error(`${providerId}: OAuth refresh token missing — run relay-ai providers auth ${providerId}`);
  }

  const kind = providerKind(providerId);
  let tokens;
  if (kind === 'openai' || kind === 'openai-oauth') {
    tokens = await refreshOpenAiAccessToken(cred.refresh);
  } else if (kind === 'xai' || kind === 'xai-oauth') {
    tokens = await refreshXaiAccessToken(cred.refresh);
  } else if (kind === 'github-copilot') {
    // cred.refresh is the long-lived ghu_ token; re-exchange for a new Copilot session token
    tokens = await refreshGithubCopilotToken(cred.refresh);
  } else if (kind === 'claude-code') {
    tokens = await refreshClaudeCodeToken(cred.refresh);
  } else if (kind === 'antigravity') {
    tokens = await refreshAntigravityToken(cred.refresh);
  } else if (kind === 'cline-pass') {
    tokens = await refreshClinePassAccessToken(cred.refresh);
  } else {
    throw new Error(`OAuth refresh not implemented for provider "${providerId}"`);
  }

  const accountId = kind === 'cline-pass' && typeof tokens.providerData?.clineUserId === 'string'
    ? tokens.providerData.clineUserId
    : cred.accountId;
  return tokensToStoredCredential(tokens, cred.refresh, accountId, cred.providerData);
}
