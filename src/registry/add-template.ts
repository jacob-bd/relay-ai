// src/registry/add-template.ts — add a provider from a builtin template

import { saveProviderCredential } from '../env.js';
import { isSdkMigratedNpm } from '../provider-factory.js';
import type { ProviderTemplate } from '../provider-templates.js';
import { classifyFreeStatus, isFreeStatus } from '../free-models.js';
import { addOpencodeCloudFromApiKey } from './crud.js';
import { fetchTemplateModels } from './fetch-template-models.js';
import { loadRegistry, saveRegistry } from './io.js';
import {
  buildPricingIndex,
  enrichModelsForProviderPricing,
  enrichPricingAsync,
  loadPricingCache,
} from './pricing.js';
import type { RegistryProvider } from './types.js';

export interface AddTemplateResult {
  added: boolean;
  provider?: RegistryProvider;
  modelCount?: number;
  error?: string;
  hint?: string;
}

async function probeTemplatePackage(template: ProviderTemplate): Promise<string | null> {
  if (!template.supported) return template.unsupportedReason ?? 'Provider is not supported yet.';
  if (!template.npm) return 'Template is missing an SDK package.';
  if (!isSdkMigratedNpm(template.npm) && template.npm !== '@ai-sdk/anthropic') {
    return `SDK package ${template.npm} is not available in relay-ai.`;
  }
  try {
    await import(template.npm);
    return null;
  } catch {
    return `Could not load ${template.npm}. Run npm install in your relay-ai checkout.`;
  }
}

function filterAnonymousFreeModels<T extends { cost?: { input: number; output: number }; isFree?: boolean; freeStatus?: ReturnType<typeof classifyFreeStatus> }>(
  models: T[],
  template: ProviderTemplate,
): T[] {
  if (!template.anonymousFreeModels) return models;
  return models.filter(model => isFreeStatus(classifyFreeStatus({
    model,
    providerId: template.id,
    templateId: template.id,
  })));
}

/** Test API key, persist credential + registry entry. */
export async function addProviderFromTemplate(
  template: ProviderTemplate,
  apiKey: string,
  opts?: { replaceExisting?: boolean; baseUrl?: string },
): Promise<AddTemplateResult> {
  const trimmedKey = apiKey.trim();
  if (!trimmedKey && !template.apiKeyOptional) {
    return { added: false, error: 'API key cannot be empty.' };
  }

  // OpenCode Zen/Go use fixed backends + a global key — never ask for a base URL.
  if (template.modelSource === 'zen-go-api') {
    return addOpencodeCloudFromApiKey(trimmedKey);
  }

  const packageError = await probeTemplatePackage(template);
  if (packageError) {
    return { added: false, error: packageError };
  }

  const registry = loadRegistry();
  const existing = registry.providers.find(p => p.id === template.id);
  if (existing && !opts?.replaceExisting) {
    return {
      added: false,
      error: `${template.name} is already configured.`,
      hint: `Remove it first with: relay-ai providers remove ${template.id}`,
    };
  }

  const fetched = await fetchTemplateModels(template, trimmedKey, opts?.baseUrl);
  if (fetched.error || fetched.models.length === 0) {
    return {
      added: false,
      error: fetched.error ?? 'No models returned.',
      hint: fetched.hint,
    };
  }
  const usableModels = !trimmedKey && template.anonymousFreeModels
    ? filterAnonymousFreeModels(fetched.models, template)
    : fetched.models;
  if (usableModels.length === 0) {
    return {
      added: false,
      error: 'No free models were returned for anonymous access.',
      hint: template.signupUrl ? `Add a ${template.name} API key from ${template.signupUrl} to use paid models.` : undefined,
    };
  }

  const authRef = `keyring:provider:${template.id}`;
  const saved = trimmedKey ? await saveProviderCredential(authRef, trimmedKey) : true;
  if (!saved) {
    return {
      added: false,
      error: 'Could not save API key to credential store.',
      hint: 'Grant Keychain access, or ensure RELAY_AI_HOME is writable (file fallback).',
    };
  }

  const now = new Date().toISOString();
  const pricingCache = loadPricingCache();
  const pricedModels = enrichModelsForProviderPricing(
    usableModels.map(m => ({ ...m, apiUrl: fetched.baseUrl })),
    buildPricingIndex(pricingCache),
    template.id,
    template.id,
  );
  const entry: RegistryProvider = {
    id: template.id,
    templateId: template.id,
    name: template.name,
    enabled: true,
    authRef,
    authType: template.authType,
    api: {
      npm: template.npm,
      url: fetched.baseUrl,
    },
    addedAt: existing?.addedAt ?? now,
    refreshedAt: now,
    modelsCache: {
      fetchedAt: now,
      models: pricedModels,
    },
  };

  if (existing) {
    const idx = registry.providers.findIndex(p => p.id === template.id);
    registry.providers[idx] = entry;
  } else {
    registry.providers.push(entry);
  }
  saveRegistry(registry);
  enrichPricingAsync();

  return { added: true, provider: entry, modelCount: pricedModels.length };
}
