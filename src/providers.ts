// src/providers.ts
import type { LocalProvider, LocalProviderModel, ModelCost } from './types.js';
import { deriveBrand } from './models.js';
import { resolveContextWindow } from './context-window.js';
import { shouldHideModel, type CompatibilityAgent } from './model-compatibility.js';

interface RawModel {
  id: string;
  name?: string;
  family?: string;
  api?: { id?: string; npm?: string; url?: string };
  cost?: ModelCost;
  limit?: { context?: number; output?: number };
  supported_parameters?: string[];
  supportedParameters?: string[];
  reasoning?: boolean;
  interleaved?: { field?: string };
}

export interface RawProvider {
  id: string;
  name: string;
  key?: string;
  /** True when OpenCode v2 reports an active connection, even if it withholds the secret. */
  configured?: boolean;
  models?: Record<string, RawModel>;
}

export function resolveEndpoint(
  npm: string,
  apiUrl: string,
): { format: 'anthropic' | 'openai'; baseUrl?: string; completionsUrl?: string } | null {
  if (!npm) return null;
  if (npm === '@ai-sdk/anthropic') {
    return {
      format: 'anthropic',
      baseUrl: (apiUrl || 'https://api.anthropic.com').replace(/\/v1\/?$/, ''),
    };
  }
  if (npm === '@ai-sdk/openai-compatible') {
    if (!apiUrl) return null;
    return {
      format: 'openai',
      completionsUrl: apiUrl.replace(/\/$/, '') + '/chat/completions',
    };
  }
  // Any other npm OpenCode assigns — SDK adapter owns endpoints.
  return { format: 'openai' };
}

export function normalizeProviders(
  raw: RawProvider[],
  opts?: { includeOAuthPlaceholders?: boolean; agent?: CompatibilityAgent },
): LocalProvider[] {
  const agent = opts?.agent ?? 'claude';
  const result: LocalProvider[] = [];

  for (const provider of raw) {
    const hasKey = !!provider.key?.trim();
    if (!hasKey && !opts?.includeOAuthPlaceholders) continue;

    const models: LocalProviderModel[] = [];

    for (const model of Object.values(provider.models ?? {})) {
      if (shouldHideModel({ providerId: provider.id, modelId: model.id, agent })) continue;
      const endpoint = resolveEndpoint(model.api?.npm ?? '', model.api?.url ?? '');
      if (endpoint === null) continue;

      models.push({
        id: model.id,
        name: model.name ?? model.id,
        family: model.family ?? '',
        brand: deriveBrand(model.family ?? ''),
        modelFormat: endpoint.format,
        upstreamModelId: model.api?.id ?? model.id,
        baseUrl: endpoint.baseUrl,
        completionsUrl: endpoint.completionsUrl,
        npm: model.api?.npm,
        apiBaseUrl: model.api?.url,
        cost: model.cost,
        contextWindow: resolveContextWindow(model.id, model.limit?.context),
        supportedParameters: model.supportedParameters ?? model.supported_parameters,
        reasoning: model.reasoning,
        interleavedReasoningField: model.interleaved?.field,
      });
    }

    if (models.length === 0) continue;

    result.push({
      id: provider.id,
      name: provider.name,
      apiKey: provider.key?.trim() ?? '',
      models,
    });
  }

  return result;
}
