import { CLINE_PASS_REFRESH_URL, CLINE_PASS_REGISTER_URL } from '../cline-pass.js';
import { positiveSecondsToMs, sleepMs } from './pkce.js';
import type { OAuthTokenResponse } from './types.js';

const WORKOS_CLIENT_ID = 'client_01K3A541FN8TA3EPPHTD2325AR';
const WORKOS_DEVICE_URL = 'https://api.workos.com/user_management/authorize/device';
const WORKOS_TOKEN_URL = 'https://api.workos.com/user_management/authenticate';
const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';
const DEFAULT_INTERVAL_MS = 5_000;
const SLOW_DOWN_INCREMENT_MS = 1_000;
const DEFAULT_EXPIRES_MS = 10 * 60 * 1000;

export interface ClinePassDeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in?: number;
  interval?: number;
}

export interface ClinePassOAuthResult {
  tokens: OAuthTokenResponse;
  accountId?: string;
  providerData?: Record<string, unknown>;
}

interface ClineAuthData {
  accessToken?: unknown;
  refreshToken?: unknown;
  expiresAt?: unknown;
  userInfo?: unknown;
}

function formHeaders(): Record<string, string> {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/x-www-form-urlencoded',
  };
}

function jsonHeaders(): Record<string, string> {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

function expiresInFromIso(expiresAt: unknown): number {
  if (typeof expiresAt !== 'string') throw new Error('ClinePass response is missing a valid expiresAt');
  const timestamp = Date.parse(expiresAt);
  if (!Number.isFinite(timestamp)) throw new Error('ClinePass response is missing a valid expiresAt');
  return Math.max(1, Math.floor((timestamp - Date.now()) / 1000));
}

function toOAuthResult(data: ClineAuthData): ClinePassOAuthResult {
  if (typeof data.accessToken !== 'string' || !data.accessToken) {
    throw new Error('ClinePass response is missing accessToken');
  }
  const userInfo = data.userInfo && typeof data.userInfo === 'object' && !Array.isArray(data.userInfo)
    ? data.userInfo as Record<string, unknown>
    : undefined;
  const accountId = typeof userInfo?.clineUserId === 'string' ? userInfo.clineUserId : undefined;
  return {
    tokens: {
      access_token: data.accessToken,
      ...(typeof data.refreshToken === 'string' ? { refresh_token: data.refreshToken } : {}),
      expires_in: expiresInFromIso(data.expiresAt),
      ...(userInfo ? { providerData: userInfo } : {}),
    },
    ...(accountId ? { accountId } : {}),
    ...(userInfo ? { providerData: userInfo } : {}),
  };
}

async function readError(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  if (!text) return `HTTP ${response.status}`;
  try {
    const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
    const detail = typeof parsed.error === 'string' ? parsed.error : typeof parsed.message === 'string' ? parsed.message : '';
    return detail || `HTTP ${response.status}`;
  } catch {
    return text.slice(0, 120);
  }
}

export async function requestClinePassDeviceCode(): Promise<ClinePassDeviceCodeResponse> {
  const response = await fetch(WORKOS_DEVICE_URL, {
    method: 'POST',
    headers: formHeaders(),
    body: new URLSearchParams({ client_id: WORKOS_CLIENT_ID }).toString(),
  });
  if (!response.ok) throw new Error(`ClinePass device code request failed (${response.status})`);
  const json = await response.json() as ClinePassDeviceCodeResponse;
  if (!json.device_code || !json.user_code || !json.verification_uri) {
    throw new Error('ClinePass device code response is missing required fields');
  }
  return json;
}

export async function registerClinePassTokens(
  accessToken: string,
  refreshToken: string,
): Promise<ClinePassOAuthResult> {
  const response = await fetch(CLINE_PASS_REGISTER_URL, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ accessToken, refreshToken }),
  });
  if (!response.ok) throw new Error(`ClinePass registration failed (${response.status})`);
  const body = await response.json() as { success?: unknown; data?: ClineAuthData; error?: unknown; message?: unknown };
  if (body.success !== true || !body.data) {
    const detail = typeof body.error === 'string' ? body.error : typeof body.message === 'string' ? body.message : 'unsuccessful response';
    throw new Error(`ClinePass registration failed: ${detail}`);
  }
  return toOAuthResult(body.data);
}

export async function pollClinePassDeviceCode(
  device: ClinePassDeviceCodeResponse,
  opts?: { sleep?: (ms: number) => Promise<void>; now?: () => number },
): Promise<ClinePassOAuthResult> {
  const sleep = opts?.sleep ?? sleepMs;
  const now = opts?.now ?? (() => Date.now());
  const deadline = now() + positiveSecondsToMs(device.expires_in, DEFAULT_EXPIRES_MS);
  let intervalMs = Math.max(positiveSecondsToMs(device.interval, DEFAULT_INTERVAL_MS), 1_000);

  while (now() < deadline) {
    const response = await fetch(WORKOS_TOKEN_URL, {
      method: 'POST',
      headers: formHeaders(),
      body: new URLSearchParams({
        grant_type: DEVICE_GRANT_TYPE,
        client_id: WORKOS_CLIENT_ID,
        device_code: device.device_code,
      }).toString(),
    });
    if (response.ok) {
      const workos = await response.json() as { access_token?: string; refresh_token?: string };
      if (!workos.access_token || !workos.refresh_token) {
        throw new Error('ClinePass WorkOS response is missing required tokens');
      }
      return registerClinePassTokens(workos.access_token, workos.refresh_token);
    }

    const body = await response.json().catch(() => ({})) as { error?: string };
    const remaining = Math.max(0, deadline - now());
    if (body.error === 'authorization_pending') {
      await sleep(Math.min(intervalMs, remaining));
      continue;
    }
    if (body.error === 'slow_down') {
      intervalMs += SLOW_DOWN_INCREMENT_MS;
      await sleep(Math.min(intervalMs, remaining));
      continue;
    }
    throw new Error(`ClinePass device authorization failed${body.error ? `: ${body.error}` : ''}`);
  }
  throw new Error('ClinePass device authorization timed out');
}

export async function runClinePassDeviceCodeFlow(
  onDeviceCode: (info: { url: string; userCode: string }) => void,
  opts?: { sleep?: (ms: number) => Promise<void>; now?: () => number },
): Promise<ClinePassOAuthResult> {
  const device = await requestClinePassDeviceCode();
  onDeviceCode({
    url: device.verification_uri_complete ?? device.verification_uri,
    userCode: device.user_code,
  });
  return pollClinePassDeviceCode(device, opts);
}

export async function refreshClinePassAccessToken(refreshToken: string): Promise<OAuthTokenResponse> {
  const response = await fetch(CLINE_PASS_REFRESH_URL, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ refreshToken, grantType: 'refresh_token' }),
  });
  if (!response.ok) {
    const detail = await readError(response);
    throw new Error(`ClinePass token refresh failed (${response.status}): ${detail}`);
  }
  const body = await response.json() as { success?: unknown; data?: ClineAuthData; error?: unknown; message?: unknown };
  if (body.success !== true || !body.data) {
    const detail = typeof body.error === 'string' ? body.error : typeof body.message === 'string' ? body.message : 'unsuccessful response';
    throw new Error(`ClinePass token refresh failed: ${detail}`);
  }
  return toOAuthResult(body.data).tokens;
}
