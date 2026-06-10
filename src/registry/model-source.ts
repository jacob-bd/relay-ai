// src/registry/model-source.ts — resolve how a registry provider refreshes its model list

import { getTemplateById, type ProviderModelSource } from '../provider-templates.js';
import { resolveProviderTemplate } from './resolve-template.js';
import type { RegistryProvider } from './types.js';

const MANUAL_ONLY_TEMPLATE_IDS = new Set(['vertex', 'bedrock', 'azure']);
const MANUAL_ONLY_PROVIDER_IDS = new Set(['google-vertex', 'vertex', 'bedrock', 'azure']);
const MANUAL_ONLY_NPMS = new Set([
  '@ai-sdk/google-vertex',
  '@ai-sdk/amazon-bedrock',
  '@ai-sdk/azure',
]);

export function resolveModelSource(provider: RegistryProvider): ProviderModelSource {
  if (provider.id === 'zen' || provider.id === 'go' || provider.templateId === 'zen' || provider.templateId === 'go') {
    return 'zen-go-api';
  }
  if (
    MANUAL_ONLY_PROVIDER_IDS.has(provider.id) ||
    MANUAL_ONLY_PROVIDER_IDS.has(provider.templateId) ||
    MANUAL_ONLY_TEMPLATE_IDS.has(provider.templateId) ||
    (provider.api.npm && MANUAL_ONLY_NPMS.has(provider.api.npm))
  ) {
    return 'manual-only';
  }
  const template = resolveProviderTemplate(provider) ?? getTemplateById(provider.templateId);
  if (template) return template.modelSource;
  if (provider.templateId === 'custom-openai' || provider.templateId === 'custom-anthropic') {
    return 'api-list';
  }
  return 'api-list';
}
