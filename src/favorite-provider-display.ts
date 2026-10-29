import type { LocalProvider } from './types.js';

const OAUTH_FAVORITE_NAMES: Record<string, string> = {
  'claude-code': 'Claude Code OAuth (Anthropic subscription)',
  antigravity: 'Cloud Code Assist OAuth (Google)',
  'openai-oauth': 'OpenAI OAuth (ChatGPT)',
  'xai-oauth': 'xAI OAuth (SuperGrok)',
};

export function favoriteProviderDisplayName(
  provider: Pick<LocalProvider, 'id' | 'name' | 'authType' | 'nameCustomized'>,
): string {
  if (provider.nameCustomized) return provider.name;
  const explicit = OAUTH_FAVORITE_NAMES[provider.id];
  if (explicit) return explicit;
  if (provider.authType === 'oauth' && !/\boauth\b/i.test(provider.name)) {
    return `${provider.name} OAuth`;
  }
  return provider.name;
}
