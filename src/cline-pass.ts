/** Shared ClinePass endpoint and runtime credential rules. */

export const CLINE_PASS_HOST = 'https://api.cline.bot';
export const CLINE_PASS_SDK_BASE_URL = `${CLINE_PASS_HOST}/api/v1`;
export const CLINE_PASS_CATALOG_URL = `${CLINE_PASS_HOST}/api/v1/ai/cline/recommended-models`;
export const CLINE_PASS_VALIDATION_URL = `${CLINE_PASS_HOST}/api/v1/models`;
export const CLINE_PASS_REGISTER_URL = `${CLINE_PASS_HOST}/api/v1/auth/register`;
export const CLINE_PASS_REFRESH_URL = `${CLINE_PASS_HOST}/api/v1/auth/refresh`;
export const CLINE_PASS_WORKOS_PREFIX = 'workos:';

export function isClinePassOAuth(providerId?: string, authType?: string): boolean {
  return providerId === 'cline-pass' && authType === 'oauth';
}

/** Format only ClinePass OAuth access tokens; API keys remain raw. */
export function formatClineRuntimeCredential(
  providerId: string | undefined,
  authType: 'api' | 'oauth' | 'none' | undefined,
  key: string,
): string {
  if (!isClinePassOAuth(providerId, authType)) return key;
  return key.toLowerCase().startsWith(CLINE_PASS_WORKOS_PREFIX)
    ? key
    : `${CLINE_PASS_WORKOS_PREFIX}${key}`;
}

/**
 * Wrap the SDK fetch used by ClinePass OAuth routes.
 *
 * WorkOS access tokens are stored without the runtime marker. ClinePass
 * requires `workos:` on the wire, and an expired token gets one retry after
 * the caller refreshes it. The request is cloned so a POST body can safely be
 * sent a second time, and the wrapper never retries more than once.
 */
export function createClinePassOAuthFetch(
  initialRuntimeCredential: string,
  refreshToken: () => Promise<string | null>,
  onTokenRefreshed?: (rawToken: string) => void,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): typeof globalThis.fetch {
  let currentRuntimeCredential = initialRuntimeCredential;

  return async (input, init) => {
    const request = new Request(input, init);
    const send = (runtimeCredential: string) => {
      const headers = new Headers(request.headers);
      headers.set('Authorization', `Bearer ${runtimeCredential}`);
      return fetchImpl(request.clone(), { headers });
    };

    const response = await send(currentRuntimeCredential);
    if (response.status !== 401) return response;

    const refreshedRawToken = await refreshToken().catch(() => null);
    const refreshedRuntimeCredential = refreshedRawToken
      ? formatClineRuntimeCredential('cline-pass', 'oauth', refreshedRawToken)
      : null;
    if (!refreshedRawToken || !refreshedRuntimeCredential || refreshedRuntimeCredential === currentRuntimeCredential) {
      return response;
    }

    currentRuntimeCredential = refreshedRuntimeCredential;
    onTokenRefreshed?.(refreshedRawToken);
    return send(currentRuntimeCredential);
  };
}
