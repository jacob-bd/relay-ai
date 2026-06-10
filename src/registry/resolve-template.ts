// src/registry/resolve-template.ts — map imported OpenCode ids to builtin templates + default URLs

import { getTemplateById, type ProviderTemplate } from '../provider-templates.js';
import type { RegistryProvider } from './types.js';

/** OpenCode provider ids that differ from relay-ai template ids */
const TEMPLATE_ID_ALIASES: Record<string, string> = {
  'google-vertex': 'vertex',
};

const NPM_DEFAULT_BASE_URL: Record<string, string> = {
  '@ai-sdk/anthropic': 'https://api.anthropic.com',
};

export function resolveProviderTemplate(provider: RegistryProvider): ProviderTemplate | undefined {
  const candidates = [
    TEMPLATE_ID_ALIASES[provider.templateId],
    provider.templateId,
    TEMPLATE_ID_ALIASES[provider.id],
    provider.id,
  ].filter(Boolean) as string[];

  for (const id of candidates) {
    const template = getTemplateById(id);
    if (template) return template;
  }
  return undefined;
}

export function effectiveProviderBaseUrl(provider: RegistryProvider, template?: ProviderTemplate): string | undefined {
  const fromRegistry = provider.api.url?.trim();
  if (fromRegistry) return fromRegistry;
  if (template?.defaultBaseUrl?.trim()) return template.defaultBaseUrl.trim();
  const npm = provider.api.npm?.trim();
  if (npm && NPM_DEFAULT_BASE_URL[npm]) return NPM_DEFAULT_BASE_URL[npm];
  return undefined;
}

export function syntheticTemplate(provider: RegistryProvider, baseUrl?: string): ProviderTemplate {
  const npm = provider.api.npm ?? '@ai-sdk/openai-compatible';
  return {
    id: provider.id,
    name: provider.name,
    authType: 'api',
    npm,
    defaultBaseUrl: baseUrl,
    modelSource: 'api-list',
    supported: true,
  };
}
