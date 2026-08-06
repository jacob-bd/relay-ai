/** Shared ClinePass endpoint and runtime credential rules. */

export const CLINE_PASS_HOST = 'https://api.cline.bot';
export const CLINE_PASS_SDK_BASE_URL = `${CLINE_PASS_HOST}/api/v1`;
export const CLINE_PASS_CATALOG_URL = `${CLINE_PASS_HOST}/api/v1/ai/cline/recommended-models`;
export const CLINE_PASS_VALIDATION_URL = `${CLINE_PASS_HOST}/api/v1/models`;
export const CLINE_PASS_REGISTER_URL = `${CLINE_PASS_HOST}/api/v1/auth/register`;
export const CLINE_PASS_REFRESH_URL = `${CLINE_PASS_HOST}/api/v1/auth/refresh`;
export const CLINE_PASS_DEFAULT_CONTEXT_WINDOW = 131_072;
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
