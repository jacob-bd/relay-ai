/**
 * Relay stores a placeholder instead of a key for endpoints that need none: `local` for a custom
 * endpoint added with a blank key, `anonymous` for keyless providers such as Kilo Code. They are
 * internal markers, never credentials. Sending one as `Authorization: Bearer` is rejected by strict
 * servers (OVHcloud answers 403, Kilo answers 401 for `local`), so request code must drop them.
 * Dependency-free so provider-factory and the registry fetchers can both import it.
 */
const NO_KEY_SENTINELS = new Set(['local', 'anonymous']);

export function isNoKeySentinel(key: string | null | undefined): boolean {
  return NO_KEY_SENTINELS.has((key ?? '').trim().toLowerCase());
}

/** The key to put on the wire: empty when the value is blank or a no-key marker. */
export function wireApiKey(key: string | null | undefined): string {
  const trimmed = (key ?? '').trim();
  return isNoKeySentinel(trimmed) ? '' : trimmed;
}
