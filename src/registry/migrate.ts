import type { ProviderRegistry } from './types.js';

const LEGACY_CLOUD_PROVIDER_IDS = [
  { legacyId: 'opencode', id: 'zen', name: 'OpenCode Zen' },
  { legacyId: 'opencode-go', id: 'go', name: 'OpenCode Go' },
] as const;

export function migrateLegacyCloudProviders(registry: ProviderRegistry): boolean {
  let changed = false;

  for (const { legacyId, id, name } of LEGACY_CLOUD_PROVIDER_IDS) {
    const legacyIdx = registry.providers.findIndex(provider => provider.id === legacyId);
    if (legacyIdx < 0) continue;

    if (registry.providers.some(provider => provider.id === id)) {
      registry.providers.splice(legacyIdx, 1);
    } else {
      registry.providers[legacyIdx] = {
        ...registry.providers[legacyIdx]!,
        id,
        templateId: id,
        name,
        api: {},
      };
    }
    changed = true;
  }

  return changed;
}

// Rename {id:'openai', authType:'oauth'} → {id:'openai-oauth'} so it can coexist
// with the API-key 'openai' provider. Preserves the original authRef so the
// keyring credential isn't orphaned.
export function migrateOAuthOpenAiProvider(registry: ProviderRegistry): boolean {
  if (registry.providers.some(p => p.id === 'openai-oauth')) return false;

  const idx = registry.providers.findIndex(
    p => p.id === 'openai' && p.authType === 'oauth',
  );
  if (idx < 0) return false;

  const existing = registry.providers[idx]!;
  registry.providers[idx] = {
    ...existing,
    id: 'openai-oauth',
    templateId: existing.templateId || 'openai',
    name: existing.name === 'OpenAI' ? 'OpenAI (ChatGPT)' : existing.name,
  };
  return true;
}

// Rename {id:'xai', authType:'oauth'} → {id:'xai-oauth'}
export function migrateOAuthXaiProvider(registry: ProviderRegistry): boolean {
  if (registry.providers.some(p => p.id === 'xai-oauth')) return false;

  const idx = registry.providers.findIndex(
    p => p.id === 'xai' && p.authType === 'oauth',
  );
  if (idx < 0) return false;

  const existing = registry.providers[idx]!;
  registry.providers[idx] = {
    ...existing,
    id: 'xai-oauth',
    templateId: existing.templateId || 'xai',
    name: existing.name === 'xAI' ? 'xAI Grok (SuperGrok)' : existing.name,
  };
  return true;
}

/** Clarify the stock China DashScope entry without altering custom configurations. */
export function migrateAlibabaDashScopeChinaLabel(registry: ProviderRegistry): boolean {
  const provider = registry.providers.find(p =>
    p.id === 'alibaba' &&
    p.templateId === 'alibaba' &&
    p.name === 'Alibaba DashScope' &&
    p.api.url === 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  );
  if (!provider) return false;

  provider.name = 'Alibaba DashScope (China)';
  return true;
}
