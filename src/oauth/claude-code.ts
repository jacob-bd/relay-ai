// src/oauth/claude-code.ts — Authorization Code + PKCE flow for Claude Code OAuth.
// Client ID is the public PKCE credential shipped in the Claude Code CLI binary.

import { randomBytes } from 'node:crypto';
import open from 'open';
import { generatePkce, generateOAuthState } from './pkce.js';
import { startCallbackServer } from './callback-server.js';
import type { OAuthTokenResponse } from './types.js';

export const CLAUDE_CODE_CLIENT_ID =
  process.env.CLAUDE_OAUTH_CLIENT_ID ?? '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

const AUTHORIZE_URL = 'https://claude.ai/oauth/authorize';
const TOKEN_URL = 'https://api.anthropic.com/v1/oauth/token';
const REDIRECT_URI =
  process.env.CLAUDE_CODE_REDIRECT_URI ?? 'https://platform.claude.com/oauth/code/callback';
const SCOPES =
  'org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers';

// Pinned to a captured claude-cli release — bump when Anthropic updates.
export const CLAUDE_CODE_CLI_VERSION = '2.1.187';

export interface ClaudeCodePkceParams {
  authUrl: string;
  codeVerifier: string;
  oauthState: string;
  redirectUri: string;
}

export async function buildClaudeCodeAuthUrl(redirectUri: string): Promise<ClaudeCodePkceParams> {
  const { verifier, challenge } = await generatePkce();
  const state = generateOAuthState();
  const params = new URLSearchParams({
    code: 'true',
    client_id: CLAUDE_CODE_CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    // Forces fresh auth — prevents session takeover that invalidates previous refresh tokens.
    prompt: 'login',
  });
  return { authUrl: `${AUTHORIZE_URL}?${params}`, codeVerifier: verifier, oauthState: state, redirectUri };
}

export async function exchangeClaudeCodeToken(
  code: string,
  codeVerifier: string,
  redirectUri: string,
  state: string,
): Promise<OAuthTokenResponse> {
  // Anthropic may return code as `authCode#stateValue` — split if needed.
  let authCode = code;
  let codeState = state;
  if (authCode.includes('#')) {
    const idx = authCode.indexOf('#');
    codeState = authCode.slice(idx + 1) || state;
    authCode = authCode.slice(0, idx);
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      code: authCode,
      state: codeState,
      grant_type: 'authorization_code',
      client_id: CLAUDE_CODE_CLIENT_ID,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });
  if (!res.ok) throw new Error(`Claude Code token exchange failed: ${await res.text()}`);
  return res.json() as Promise<OAuthTokenResponse>;
}

export async function refreshClaudeCodeToken(refreshToken: string): Promise<OAuthTokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: CLAUDE_CODE_CLIENT_ID,
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) throw new Error(`Claude Code token refresh failed: ${await res.text()}`);
  return res.json() as Promise<OAuthTokenResponse>;
}

export interface ClaudeBootstrapInfo {
  accountId?: string;
  email?: string;
  organizationId?: string;
  organizationName?: string;
  plan?: string;
}

export async function fetchClaudeBootstrap(accessToken: string): Promise<ClaudeBootstrapInfo> {
  try {
    const res = await fetch('https://api.anthropic.com/api/claude_cli/bootstrap', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'User-Agent': `claude-cli/${CLAUDE_CODE_CLI_VERSION} (external, cli)`,
        'anthropic-beta': 'oauth-2025-04-20',
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return {};
    const data = (await res.json()) as Record<string, unknown>;
    const acct = data.oauth_account as Record<string, unknown> | undefined;
    if (!acct) return {};
    return {
      accountId: typeof acct.account_uuid === 'string' ? acct.account_uuid : undefined,
      email: typeof acct.account_email === 'string' ? acct.account_email : undefined,
      organizationId: typeof acct.organization_uuid === 'string' ? acct.organization_uuid : undefined,
      organizationName: typeof acct.organization_name === 'string' ? acct.organization_name : undefined,
      plan: typeof acct.organization_rate_limit_tier === 'string' ? acct.organization_rate_limit_tier : undefined,
    };
  } catch {
    return {};
  }
}

/** Generate a new cliUserID — created once at provisioning and persisted in providerData. */
export function generateCliUserID(): string {
  return randomBytes(32).toString('hex');
}

/** Full CLI PKCE flow: starts local callback server, opens browser, exchanges code. */
export async function runClaudeCodeOAuthFlow(
  onAuthUrl: (url: string) => void,
): Promise<{ tokens: OAuthTokenResponse; bootstrap: ClaudeBootstrapInfo }> {
  const server = await startCallbackServer();
  try {
    const { authUrl, codeVerifier, oauthState, redirectUri } = await buildClaudeCodeAuthUrl(
      server.redirectUri,
    );
    onAuthUrl(authUrl);
    open(authUrl).catch(() => {});
    const { code, state } = await server.waitForCallback();
    if (!code) throw new Error('No authorization code received from Anthropic');
    const tokens = await exchangeClaudeCodeToken(code, codeVerifier, redirectUri, state);
    const bootstrap = await fetchClaudeBootstrap(tokens.access_token);
    return { tokens, bootstrap };
  } finally {
    server.close();
  }
}

/** For the GUI: complete token exchange given code received via /oauth/callback. */
export async function completeClaudeCodeExchange(
  code: string,
  codeVerifier: string,
  oauthState: string,
  redirectUri: string,
): Promise<{ tokens: OAuthTokenResponse; bootstrap: ClaudeBootstrapInfo }> {
  const tokens = await exchangeClaudeCodeToken(code, codeVerifier, redirectUri, oauthState);
  const bootstrap = await fetchClaudeBootstrap(tokens.access_token);
  return { tokens, bootstrap };
}

/** Redirect URI for the GUI callback (port extracted from Host header). */
export function guiCallbackRedirectUri(host: string): string {
  return `http://${host}/oauth/callback`;
}
