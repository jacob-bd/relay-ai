// src/registry/add-template.ts — add a provider from a builtin template

import { deleteProviderCredential, saveProviderCredential } from '../env.js';
import { localIsoTimestamp } from '../trace-log.js';
import { isSdkMigratedNpm } from '../provider-factory.js';
import type { ProviderTemplate } from '../provider-templates.js';
import { classifyFreeStatus, isFreeStatus } from '../free-models.js';
import { addOpencodeCloudFromApiKey } from './crud.js';
import { fetchTemplateModels } from './fetch-template-models.js';
import { fetchClinePassModels, validateClinePassApiKey } from './fetch-cline-pass-models.js';
import { fetchCommandCodeModels, COMMANDCODE_BASE_URL } from './fetch-commandcode-models.js';
import { loadRegistry, saveRegistry } from './io.js';
import {
  buildPricingIndex,
  enrichModelsForProviderPricing,
  enrichPricingAsync,
  loadPricingCache,
} from './pricing.js';
import { uniqueProviderName } from './provider-name.js';
import type { CachedModel, RegistryProvider } from './types.js';
import { vertexAnthropicCachedModels, vertexAnthropicSetupError } from './vertex-anthropic.js';
import { filterVertexModelsByAccess } from './vertex-model-check.js';
import { loadVertexModelEntries, resolveVertexProject, saveVertexModelEntries } from '../vertex-env.js';

export interface AddTemplateResult {
  added: boolean;
  provider?: RegistryProvider;
  modelCount?: number;
  error?: string;
  hint?: string;
  /** Non-fatal information about the added provider (e.g. models skipped). */
  notice?: string;
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

  let fetched: { models: CachedModel[]; baseUrl: string; error?: string; hint?: string };
  let notice: string | undefined;
  if (template.modelSource === 'cline-recommended') {
    try {
      await validateClinePassApiKey(trimmedKey);
      fetched = {
        models: await fetchClinePassModels({ credential: trimmedKey, authType: 'api' }),
        baseUrl: template.defaultBaseUrl ?? '',
      };
    } catch (err) {
      return {
        added: false,
        error: err instanceof Error ? err.message : String(err),
        hint: template.signupUrl ? `Verify your key at ${template.signupUrl}` : undefined,
      };
    }
  } else if (template.modelSource === 'commandcode') {
    try {
      const baseUrl = (opts?.baseUrl?.trim() || template.defaultBaseUrl || COMMANDCODE_BASE_URL).replace(/\/$/, '');
      fetched = { models: await fetchCommandCodeModels(baseUrl, trimmedKey), baseUrl };
    } catch (err) {
      return {
        added: false,
        error: err instanceof Error ? err.message : String(err),
        hint: template.signupUrl ? `Verify your key at ${template.signupUrl}` : undefined,
      };
    }
  } else if (template.modelSource === 'vertex-models-file') {
    const setupError = vertexAnthropicSetupError();
    if (setupError) return { added: false, ...setupError };
    // Projects enable different Claude models; keep only the ones this one can use.
    const entries = loadVertexModelEntries();
    const access = await filterVertexModelsByAccess(entries);
    if (access.aborted) {
      return {
        added: false,
        error: access.abortDetail ?? 'Vertex AI rejected the request.',
        hint: `Check that Vertex AI is enabled for project ${resolveVertexProject()} and your account can use it (role: Vertex AI User).`,
      };
    }
    if (access.allowed.length === 0) {
      return {
        added: false,
        error: `None of the ${entries.length} Claude models are available to project ${resolveVertexProject()}.`,
        hint: `${access.removed[0]?.entry.id}: ${access.removed[0]?.reason}. Ask your Google Cloud admin to enable Claude models in Vertex AI Model Garden.`,
      };
    }
    if (access.removed.length > 0) {
      saveVertexModelEntries(access.allowed);
      notice = `Skipped ${access.removed.length} model${access.removed.length === 1 ? '' : 's'} your project can't use: `
        + access.removed.map(r => `${r.entry.display_name} (${r.reason})`).join(', ')
        + '. Re-check later from relay-ai providers → Google Vertex AI (Claude) → Check model access.';
    }
    fetched = { models: vertexAnthropicCachedModels(), baseUrl: '' };
  } else {
    fetched = await fetchTemplateModels(template, trimmedKey, opts?.baseUrl);
  }
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

  const now = localIsoTimestamp();
  const pricingCache = loadPricingCache();
  const pricedModels = enrichModelsForProviderPricing(
    usableModels.map(m => ({ ...m, apiUrl: fetched.baseUrl })),
    buildPricingIndex(pricingCache),
    template.id,
    template.id,
  );
  // A user rename survives replacing; otherwise the template name is used,
  // numbered if another provider already has it.
  const providerName = existing?.nameCustomized
    ? existing.name
    : uniqueProviderName(registry.providers, template.name, existing?.id);
  const entry: RegistryProvider = {
    id: template.id,
    templateId: template.id,
    name: providerName,
    ...(existing?.nameCustomized || providerName !== template.name ? { nameCustomized: true } : {}),
    enabled: true,
    authRef,
    authType: template.authType,
    api: {
      npm: template.npm,
      url: fetched.baseUrl,
      ...(template.headers ? { headers: template.headers } : {}),
    },
    addedAt: existing?.addedAt ?? now,
    refreshedAt: now,
    modelsCache: {
      fetchedAt: now,
      models: pricedModels,
    },
  };

  if (existing) {
    entry.manualModels = existing.manualModels;
    const idx = registry.providers.findIndex(p => p.id === template.id);
    registry.providers[idx] = entry;
  } else {
    registry.providers.push(entry);
  }
  saveRegistry(registry);
  if (existing?.authRef && existing.authRef !== authRef) {
    await deleteProviderCredential(existing.authRef);
  }
  enrichPricingAsync();

  return { added: true, provider: entry, modelCount: pricedModels.length, ...(notice ? { notice } : {}) };
}
