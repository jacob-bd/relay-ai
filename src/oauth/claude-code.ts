// src/oauth/claude-code.ts — Authorization Code + PKCE flow for Claude Code OAuth.
// Client ID is the public PKCE credential shipped in the Claude Code CLI binary.

import { randomBytes } from 'node:crypto';
import open from 'open';
import { generatePkce, generateOAuthState } from './pkce.js';
import type { OAuthTokenResponse } from './types.js';
import { postOAuthRefresh } from './refresh-http.js';

export const CLAUDE_CODE_CLIENT_ID =
  process.env.CLAUDE_OAUTH_CLIENT_ID ?? '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

const AUTHORIZE_URL = 'https://claude.ai/oauth/authorize';
const TOKEN_URL = 'https://api.anthropic.com/v1/oauth/token';
const REDIRECT_URI =
  process.env.CLAUDE_CODE_REDIRECT_URI ?? 'https://platform.claude.com/oauth/code/callback';
const SCOPES =
  'org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers';

// Pinned to a captured claude-cli release — bump when Anthropic updates.
export const CLAUDE_CODE_CLI_VERSION = '2.1.195';

export interface ClaudeCodePkceParams {
  authUrl: string;
  codeVerifier: string;
  oauthState: string;
  redirectUri: string;
}

export async function buildClaudeCodeAuthUrl(redirectUri = REDIRECT_URI): Promise<ClaudeCodePkceParams> {
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
  // Anthropic may return the code as `authCode#stateValue`, or a full callback URL with `state=`.
  // Whatever state came back must be the one this sign-in sent; the request always carries ours.
  const { code: authCode, state: returnedState } = parseClaudeAuthInput(code);
  if (returnedState && returnedState !== state) {
    throw new Error('Anthropic returned an unexpected state — start the sign-in again');
  }
  const codeState = state;

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

/** Split what the user pasted into the code and, when present, the state that came with it. */
export function parseClaudeAuthInput(input: string): { code: string; state?: string } {
  let code = extractClaudeAuthCode(input);
  let state: string | undefined;
  try {
    state = new URL(input.trim()).searchParams.get('state') ?? undefined;
  } catch {
    const trimmed = input.trim();
    if (trimmed.startsWith('?') || trimmed.includes('code=')) {
      state = new URLSearchParams(trimmed.startsWith('?') ? trimmed.slice(1) : trimmed).get('state') ?? undefined;
    }
  }
  const hash = code.indexOf('#');
  if (hash >= 0) {
    state = code.slice(hash + 1) || state;
    code = code.slice(0, hash);
  }
  return { code, ...(state ? { state } : {}) };
}

export function extractClaudeAuthCode(input: string): string {
  const trimmed = input.trim();
  try {
    const parsed = new URL(trimmed);
    return parsed.searchParams.get('code') ?? trimmed;
  } catch {
    if (trimmed.startsWith('?') || trimmed.includes('code=')) {
      const query = trimmed.startsWith('?') ? trimmed.slice(1) : trimmed;
      return new URLSearchParams(query).get('code') ?? trimmed;
    }
    return trimmed;
  }
}

export async function refreshClaudeCodeToken(refreshToken: string): Promise<OAuthTokenResponse> {
  return postOAuthRefresh(
    TOKEN_URL,
    {
      grant_type: 'refresh_token',
      client_id: CLAUDE_CODE_CLIENT_ID,
      refresh_token: refreshToken,
    },
    {
      contentType: 'json',
      errorPrefix: 'Claude Code token refresh failed',
      includeBody: true,
    },
  );
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

/** Full CLI PKCE flow: opens browser, accepts Anthropic's returned code, exchanges it. */
export async function runClaudeCodeOAuthFlow(
  onAuthUrl: (url: string) => void,
  readAuthCode: () => Promise<string>,
): Promise<{ tokens: OAuthTokenResponse; bootstrap: ClaudeBootstrapInfo }> {
  const { authUrl, codeVerifier, oauthState, redirectUri } = await buildClaudeCodeAuthUrl();
  onAuthUrl(authUrl);
  open(authUrl).catch(() => {});
  const code = (await readAuthCode()).trim();
  if (!code) throw new Error('No authorization code received from Anthropic');
  const tokens = await exchangeClaudeCodeToken(code, codeVerifier, redirectUri, oauthState);
  const bootstrap = await fetchClaudeBootstrap(tokens.access_token);
  return { tokens, bootstrap };
}

export interface ClaudeCodeModelEntry {
  id: string;
  displayName: string;
  maxInputTokens?: number;
  maxTokens?: number;
}

export async function fetchClaudeCodeModels(accessToken: string): Promise<ClaudeCodeModelEntry[]> {
  const res = await fetch('https://api.anthropic.com/v1/models', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'anthropic-version': '2023-06-01',
      Accept: 'application/json',
      'User-Agent': `claude-cli/${CLAUDE_CODE_CLI_VERSION} (external, cli)`,
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`Claude Code model discovery failed (HTTP ${res.status}): ${await res.text().catch(() => '')}`);
  }
  const body = (await res.json()) as { data?: Array<Record<string, unknown>> };
  const entries = (body.data ?? [])
    .filter((m): m is Record<string, unknown> & { id: string } =>
      typeof m.id === 'string' && m.id.length > 0)
    .map(m => ({
      id: m.id as string,
      displayName: (typeof m.display_name === 'string' ? m.display_name : m.id) as string,
      maxInputTokens: typeof m.max_input_tokens === 'number' ? m.max_input_tokens : undefined,
      maxTokens: typeof m.max_tokens === 'number' ? m.max_tokens : undefined,
    }));
  if (entries.length === 0) {
    throw new Error('Claude Code model discovery returned no models');
  }
  return entries;
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
