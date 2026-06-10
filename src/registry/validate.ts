// src/registry/validate.ts

/** Stable provider slug: lowercase alphanumeric + internal hyphens. */
export const PROVIDER_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export function isValidProviderId(id: string): boolean {
  return PROVIDER_ID_PATTERN.test(id);
}

export function slugifyProviderId(displayName: string): string {
  const base = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!base) return 'custom-provider';
  if (isValidProviderId(base)) return base;
  const trimmed = base.replace(/^-+|-+$/g, '');
  return isValidProviderId(trimmed) ? trimmed : `custom-${trimmed.slice(0, 40)}`;
}
