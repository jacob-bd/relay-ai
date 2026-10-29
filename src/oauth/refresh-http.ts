import type { OAuthTokenResponse } from './types.js';

/** Codes a provider returns when a refresh token can never work again (spent, expired, revoked). */
const REVOKED_REFRESH_CODES = new Set([
  'invalid_grant',
  'refresh_token_reused',
  'refresh_token_expired',
  'refresh_token_invalidated',
]);

/** The provider rejected the refresh token for good — only signing in again helps. */
export class OAuthRefreshRevokedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthRefreshRevokedError';
  }
}

function isRevokedRefreshResponse(status: number, body: string): boolean {
  if (status !== 400 && status !== 401) return false;
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    const code = typeof parsed.error === 'string'
      ? parsed.error
      : (parsed.error as { code?: unknown } | undefined)?.code;
    return typeof code === 'string' && REVOKED_REFRESH_CODES.has(code);
  } catch {
    return false;
  }
}

export interface PostOAuthRefreshOptions {
  contentType: 'form' | 'json';
  errorPrefix: string;
  includeStatus?: boolean;
  includeBody?: boolean;
  headers?: Record<string, string>;
}

export async function postOAuthRefresh(
  url: string,
  body: URLSearchParams | Record<string, string>,
  options: PostOAuthRefreshOptions,
): Promise<OAuthTokenResponse> {
  const isJson = options.contentType === 'json';
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': isJson ? 'application/json' : 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      ...options.headers,
    },
    body: isJson ? JSON.stringify(body) : (body as URLSearchParams).toString(),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const detail = options.includeBody ? text : '';
    const status = options.includeStatus ? ` (${response.status})` : '';
    if (isRevokedRefreshResponse(response.status, text)) {
      throw new OAuthRefreshRevokedError(`${options.errorPrefix}${status}: this sign-in is no longer valid`);
    }
    throw new Error(`${options.errorPrefix}${status}${detail ? `: ${detail}` : ''}`);
  }

  return response.json() as Promise<OAuthTokenResponse>;
}
