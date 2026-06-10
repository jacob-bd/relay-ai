// src/providers.ts
import type { LocalProvider, LocalProviderModel } from './types.js';
import { deriveBrand } from './models.js';
import { resolveContextWindow } from './context-window.js';
import { BLACKLISTED_LOCAL_MODEL_IDS } from './constants.js';

interface RawModel {
  id: string;
  name?: string;
  family?: string;
  api?: { id?: string; npm?: string; url?: string };
  cost?: { input: number; output: number };
  limit?: { context?: number; output?: number };
}

export interface RawProvider {
  id: string;
  name: string;
  key?: string;
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

export function normalizeProviders(raw: RawProvider[]): LocalProvider[] {
  const result: LocalProvider[] = [];

  for (const provider of raw) {
    // Skip OAuth/unconfigured providers
    if (!provider.key) continue;

    // Skip cloud backends handled separately
    if (provider.id === 'opencode' || provider.id === 'opencode-go') continue;

    const models: LocalProviderModel[] = [];

    for (const model of Object.values(provider.models ?? {})) {
      if (BLACKLISTED_LOCAL_MODEL_IDS.has(model.id)) continue;
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
      });
    }

    if (models.length === 0) continue;

    result.push({
      id: provider.id,
      name: provider.name,
      apiKey: provider.key,
      models,
    });
  }

  return result;
}
