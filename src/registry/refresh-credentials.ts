// src/registry/refresh-credentials.ts — keys for refresh-models (OpenCode placeholders, env fallbacks)

import type { RegistryProvider } from './types.js';

/** OpenCode uses these when OAuth/env supplies the real credential at runtime. */
const PLACEHOLDER_KEYS = new Set([
  'anything',
  'local',
  'ollama',
  'none',
  'n/a',
  'na',
  'placeholder',
  'test',
  'no-key',
]);

const ENV_FALLBACK_BY_PROVIDER: Record<string, string[]> = {
  anthropic: ['ANTHROPIC_API_KEY'],
  openai: ['OPENAI_API_KEY'],
};

export function isPlaceholderProviderKey(key: string | null | undefined): boolean {
  if (!key?.trim()) return true;
  return PLACEHOLDER_KEYS.has(key.trim().toLowerCase());
}

export function isLikelyPlaceholderKey(key: string | null | undefined): boolean {
  if (isPlaceholderProviderKey(key)) return true;
  const trimmed = key?.trim() ?? '';
  if (trimmed.length <= 2) return true;
  return false;
}

export function cachedModelCount(provider: RegistryProvider): number {
  return provider.modelsCache?.models.length ?? 0;
}

export function skipWithCachedModels(
  provider: RegistryProvider,
  reason: string,
): { id: string; name: string; ok: true; skipped: true; modelCount?: number; reason: string } {
  const count = cachedModelCount(provider);
  return {
    id: provider.id,
    name: provider.name,
    ok: true,
    skipped: true,
    modelCount: count > 0 ? count : undefined,
    reason,
  };
}

export async function resolveRefreshCredential(
  provider: RegistryProvider,
  resolveKey: (provider: RegistryProvider) => Promise<string | null>,
): Promise<string | null> {
  let key = await resolveKey(provider);
  if (!isLikelyPlaceholderKey(key)) return key;

  for (const envVar of ENV_FALLBACK_BY_PROVIDER[provider.id] ?? []) {
    const fromEnv = process.env[envVar]?.trim();
    if (fromEnv && !isLikelyPlaceholderKey(fromEnv)) return fromEnv;
  }
  return key;
}
