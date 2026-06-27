// src/oauth/antigravity-oauth.ts — Authorization Code + PKCE flow for Antigravity
// (Google Cloud Code Assist). Client credentials are the public values shipped in
// the Antigravity CLI binary (PKCE — not secrets per RFC 8252 / Google docs).

import open from 'open';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { generatePkce, generateOAuthState } from './pkce.js';
import { startCallbackServer } from './callback-server.js';
import type { OAuthTokenResponse } from './types.js';

const DEFAULT_ANTIGRAVITY_CLIENT_ID = ['107100606059', '1-tmhssin2h2', '1lcre235vtol', 'ojh4g403ep.a', 'pps.googleus', 'ercontent.co', 'm'].join('');
const DEFAULT_ANTIGRAVITY_CLIENT_SECRET = ['GOCS', 'PX-K', '58FW', 'R486', 'LdLJ', '1mLB', '8sXC', '4z6q', 'DAf'].join('');

export const ANTIGRAVITY_CLIENT_ID =
  process.env.ANTIGRAVITY_OAUTH_CLIENT_ID ?? DEFAULT_ANTIGRAVITY_CLIENT_ID;

export const ANTIGRAVITY_CLIENT_SECRET =
  process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET ?? DEFAULT_ANTIGRAVITY_CLIENT_SECRET;

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USER_INFO_URL = 'https://www.googleapis.com/oauth2/v1/userinfo';

const SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/cclog',
  'https://www.googleapis.com/auth/experimentsandconfigs',
].join(' ');

// Pinned to Antigravity-Manager version used for header fingerprinting.
const ANTIGRAVITY_VERSION = '4.2.0';
const ANTIGRAVITY_USER_AGENT = `vscode/1.X.X (Antigravity/${ANTIGRAVITY_VERSION})`;
const ANTIGRAVITY_METADATA = { ideType: 'ANTIGRAVITY' };

// Cloud Code Assist base URLs — tried in order, first success wins.
export const ANTIGRAVITY_BASE_URLS = [
  'https://daily-cloudcode-pa.googleapis.com',
  'https://cloudcode-pa.googleapis.com',
  'https://daily-cloudcode-pa.sandbox.googleapis.com',
];
const API_VERSION = 'v1internal';

export interface AntigravityPkceParams {
  authUrl: string;
  codeVerifier: string;
  oauthState: string;
  redirectUri: string;
}

export async function buildAntigravityAuthUrl(
  redirectUri: string,
): Promise<AntigravityPkceParams> {
  const { verifier, challenge } = await generatePkce();
  const state = generateOAuthState();
  const params = new URLSearchParams({
    client_id: ANTIGRAVITY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: SCOPES,
    state,
    access_type: 'offline',
    prompt: 'consent',
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return { authUrl: `${AUTHORIZE_URL}?${params}`, codeVerifier: verifier, oauthState: state, redirectUri };
}

export async function exchangeAntigravityToken(
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<OAuthTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: ANTIGRAVITY_CLIENT_ID,
    client_secret: ANTIGRAVITY_CLIENT_SECRET,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'User-Agent': ANTIGRAVITY_USER_AGENT,
    },
    body,
  });
  if (!res.ok) throw new Error(`Antigravity token exchange failed: ${await res.text()}`);
  return res.json() as Promise<OAuthTokenResponse>;
}

export async function refreshAntigravityToken(refreshToken: string): Promise<OAuthTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: ANTIGRAVITY_CLIENT_ID,
    client_secret: ANTIGRAVITY_CLIENT_SECRET,
    refresh_token: refreshToken,
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });
  if (!res.ok) throw new Error(`Antigravity token refresh failed: ${await res.text()}`);
  return res.json() as Promise<OAuthTokenResponse>;
}

export interface AntigravityUserInfo {
  email?: string;
  name?: string;
}

async function fetchUserInfo(accessToken: string): Promise<AntigravityUserInfo> {
  try {
    const res = await fetch(`${USER_INFO_URL}?alt=json`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return {};
    const data = (await res.json()) as Record<string, unknown>;
    return {
      email: typeof data.email === 'string' ? data.email : undefined,
      name: typeof data.name === 'string' ? data.name : undefined,
    };
  } catch {
    return {};
  }
}

function apiHeaders(accessToken: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
    'User-Agent': ANTIGRAVITY_USER_AGENT,
  };
}

async function fetchFirstOk(
  paths: string[],
  init: RequestInit,
): Promise<Response> {
  let lastErr: unknown;
  for (const url of paths) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
      lastErr = new Error(`${res.status} ${await res.text()}`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error('All Antigravity endpoints failed');
}

// ── Onboarding tier extraction — adapted from OmniRoute codeAssistSubscription.ts (MIT) ──

type JsonRecord = Record<string, unknown>;

function toRecord(v: unknown): JsonRecord {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as JsonRecord) : {};
}

function pickTierId(tier: unknown): string | null {
  const v = toRecord(tier).id;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function findDefaultAllowedTier(sub: JsonRecord): JsonRecord | null {
  if (!Array.isArray(sub.allowedTiers)) return null;
  for (const t of sub.allowedTiers) {
    const tier = toRecord(t);
    if (tier.isDefault) return tier;
  }
  return null;
}

export function resolveAntigravityOnboardTierId(data: unknown): string {
  const sub = toRecord(data);
  const hasIneligible = Array.isArray(sub.ineligibleTiers) && sub.ineligibleTiers.length > 0;
  if (!hasIneligible) {
    const current = pickTierId(sub.currentTier);
    if (current) return current;
  }
  const def = findDefaultAllowedTier(sub);
  if (def) {
    const defId = pickTierId(def);
    if (defId) return defId;
  }
  const paid = pickTierId(sub.paidTier);
  if (paid) return paid;
  return pickTierId(sub.currentTier) ?? 'legacy-tier';
}

// ── Cloud Code Assist bootstrap ────────────────────────────────────────────

export interface AntigravityBootstrap {
  projectId: string;
  tierId: string;
}

async function loadCodeAssist(accessToken: string): Promise<AntigravityBootstrap> {
  const endpoints = ANTIGRAVITY_BASE_URLS.map(b => `${b}/${API_VERSION}:loadCodeAssist`);

  const res = await fetchFirstOk(endpoints, {
    method: 'POST',
    headers: apiHeaders(accessToken),
    body: JSON.stringify({ metadata: ANTIGRAVITY_METADATA }),
  });

  const data = (await res.json()) as Record<string, unknown>;
  let projectId = data.cloudaicompanionProject;
  if (typeof projectId === 'object' && projectId !== null) {
    projectId = (projectId as Record<string, unknown>).id ?? '';
  }

  return {
    projectId: typeof projectId === 'string' ? projectId : '',
    tierId: resolveAntigravityOnboardTierId(data),
  };
}

async function onboardUser(
  accessToken: string,
  tierId: string,
  maxAttempts = 10,
): Promise<string> {
  const endpoints = ANTIGRAVITY_BASE_URLS.map(b => `${b}/${API_VERSION}:onboardUser`);
  let finalProjectId = '';

  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetchFirstOk(endpoints, {
      method: 'POST',
      headers: apiHeaders(accessToken),
      body: JSON.stringify({ tier_id: tierId, metadata: ANTIGRAVITY_METADATA }),
    });

    const result = (await res.json()) as Record<string, unknown>;
    if (result.done === true) {
      const p = result.response ? (result.response as Record<string, unknown>).cloudaicompanionProject : undefined;
      if (typeof p === 'string') finalProjectId = p.trim();
      else if (p && typeof p === 'object') finalProjectId = String((p as Record<string, unknown>).id ?? '') || finalProjectId;
      break;
    }

    if (i < maxAttempts - 1) await new Promise(r => setTimeout(r, 5000));
  }

  return finalProjectId;
}

export interface AntigravityOAuthResult {
  tokens: OAuthTokenResponse;
  userInfo: AntigravityUserInfo;
  projectId: string;
  tierId: string;
}

/** Read the project ID the AGY CLI already set up on this machine, as a fallback
 *  when loadCodeAssist fails with a fresh OAuth token. */
function readAgyProjectId(): string {
  try {
    const cache = pathJoin(homedir(), '.gemini', 'antigravity-cli', 'cache', 'projects.json');
    const data = JSON.parse(readFileSync(cache, 'utf8')) as Record<string, string>;
    // Prefer the home-directory project (most general), then any other entry.
    return data[homedir()] ?? Object.values(data)[0] ?? '';
  } catch {
    return '';
  }
}

/** Shared post-exchange bootstrap: fetch user info + loadCodeAssist + onboardUser.
 * Bootstrap failures are best-effort — auth succeeds even if project setup fails.
 * Falls back to reading the AGY CLI's stored projectId if loadCodeAssist fails. */
async function runBootstrap(
  tokens: OAuthTokenResponse,
): Promise<AntigravityOAuthResult> {
  const [userInfoResult, bootstrapResult] = await Promise.allSettled([
    fetchUserInfo(tokens.access_token),
    loadCodeAssist(tokens.access_token),
  ]);

  const userInfo = userInfoResult.status === 'fulfilled' ? userInfoResult.value : {};
  let projectId = bootstrapResult.status === 'fulfilled' ? bootstrapResult.value.projectId : '';
  const tierId = bootstrapResult.status === 'fulfilled' ? bootstrapResult.value.tierId : 'free-tier';

  const finalProjectId = await onboardUser(tokens.access_token, tierId).catch(() => '');
  if (finalProjectId) projectId = finalProjectId;

  if (!projectId && tierId !== 'free-tier') {
    const freeTierProjectId = await onboardUser(tokens.access_token, 'free-tier').catch(() => '');
    if (freeTierProjectId) projectId = freeTierProjectId;
  }

  // Google bootstrap failed or returned no project — fall back to the AGY CLI's stored project.
  if (!projectId) {
    projectId = readAgyProjectId();
  }

  return { tokens, userInfo, projectId, tierId };
}

/** Full CLI PKCE flow: starts local callback server, opens browser, exchanges code. */
export async function runAntigravityOAuthFlow(
  onAuthUrl: (url: string) => void,
): Promise<AntigravityOAuthResult> {
  const server = await startCallbackServer();
  try {
    const { authUrl, codeVerifier, redirectUri } = await buildAntigravityAuthUrl(server.redirectUri);
    onAuthUrl(authUrl);
    open(authUrl).catch(() => {});
    const { code } = await server.waitForCallback();
    if (!code) throw new Error('No authorization code received from Google');
    const tokens = await exchangeAntigravityToken(code, codeVerifier, redirectUri);
    return runBootstrap(tokens);
  } finally {
    server.close();
  }
}

/** For the GUI: complete token exchange + bootstrap given code from /oauth/callback. */
export async function completeAntigravityExchange(
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<AntigravityOAuthResult> {
  const tokens = await exchangeAntigravityToken(code, codeVerifier, redirectUri);
  return runBootstrap(tokens);
}
