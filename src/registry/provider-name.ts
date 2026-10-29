// src/registry/provider-name.ts — display-name rules shared by every add/rename path

export const MAX_PROVIDER_NAME_LENGTH = 60;

/** Trim and collapse inner whitespace so "My  GPT " and "My GPT" count as the same name. */
export function normalizeProviderName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

function nameKey(name: string): string {
  return normalizeProviderName(name).toLowerCase();
}

/** Returns an error message, or null when the name is acceptable. */
export function validateProviderName(name: string): string | null {
  const normalized = normalizeProviderName(name);
  if (!normalized) return 'Name cannot be empty.';
  if (normalized.length > MAX_PROVIDER_NAME_LENGTH) {
    return `Name must be at most ${MAX_PROVIDER_NAME_LENGTH} characters.`;
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(normalized)) return 'Name cannot contain control characters.';
  return null;
}

/** The provider already using this name (case/spacing-insensitive), ignoring `exceptId`. */
export function findProviderNameConflict<T extends { id: string; name: string }>(
  providers: readonly T[],
  name: string,
  exceptId?: string,
): T | undefined {
  const key = nameKey(name);
  return providers.find(p => p.id !== exceptId && nameKey(p.name) === key);
}

/** `name` itself when free, otherwise `name 2`, `name 3`, … — the default for second accounts. */
export function uniqueProviderName(
  providers: readonly { id: string; name: string }[],
  name: string,
  exceptId?: string,
): string {
  const base = normalizeProviderName(name);
  if (!findProviderNameConflict(providers, base, exceptId)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base} ${i}`;
    if (!findProviderNameConflict(providers, candidate, exceptId)) return candidate;
  }
}
