// src/models.ts
import type { ModelInfo, BackendConfig } from './types.js';
import { classifyModelFormat } from './constants.js';
import { shouldHideModel } from './model-compatibility.js';
import { contextWindowFromHeuristics } from './context-window.js';
import {
  loadModelsDevCache,
  resolveModelsDevSlug,
  type ModelsDevCacheFile,
} from './registry/models-dev.js';

const BRAND_MAP: Array<[string, string]> = [
  ['claude', 'Claude'],
  ['gpt', 'GPT'],
  ['gemini', 'Gemini'],
  ['deepseek', 'DeepSeek'],
  ['qwen', 'Qwen'],
  ['minimax', 'MiniMax'],
  ['kimi', 'Kimi'],
  ['glm', 'GLM'],
  ['mimo', 'MiMo'],
  ['grok', 'Grok'],
  ['nemotron', 'Nemotron'],
];

export function deriveBrand(family: string): string {
  const lower = family.toLowerCase();
  for (const [prefix, brand] of BRAND_MAP) {
    if (lower.startsWith(prefix)) return brand;
  }
  return 'Other';
}

export function readModelsFromModelsDev(
  backendId: 'zen' | 'go',
  cache: ModelsDevCacheFile = loadModelsDevCache(),
): Map<string, ModelInfo> | null {
  const providerKey = resolveModelsDevSlug(backendId);
  const providerData = cache[providerKey];
  if (!providerData?.models) return null;

  const result = new Map<string, ModelInfo>();
  for (const [modelKey, entry] of Object.entries(providerData.models)) {
    const id = entry.id ?? modelKey;
    if (entry.status === 'deprecated') continue;
    const isFree =
      entry.cost !== undefined &&
      entry.cost.input === 0 &&
      entry.cost.output === 0;
    const rawFormat = classifyModelFormat(id, entry.provider?.npm);
    // Go is an OpenAI-compatible gateway; @ai-sdk/anthropic in the cache is a metadata error.
    const modelFormat = backendId === 'go' && rawFormat === 'anthropic' ? 'openai' : rawFormat;
    result.set(id, {
      id,
      name: entry.name ?? id,
      isFree,
      brand: deriveBrand(entry.family ?? id),
      sourceBackend: backendId,
      modelFormat,
      cost: entry.cost,
      contextWindow: entry.limit?.context ?? contextWindowFromHeuristics(id),
      reasoning: entry.reasoning,
      interleavedReasoningField: entry.interleaved?.field,
    });
  }
  return result;
}

interface ApiModelsResponse {
  data: Array<{ id: string }>;
}

export async function fetchModelsFromApi(backend: BackendConfig): Promise<string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${backend.baseUrl}/v1/models`, {
      signal: controller.signal,
      headers: { Authorization: 'Bearer test' },
    });
    if (!res.ok) throw new Error(`API returned HTTP ${res.status}`);
    const body = (await res.json()) as ApiModelsResponse;
    return body.data.map(m => m.id);
  } finally {
    clearTimeout(timer);
  }
}

export function mergeModels(
  apiIds: string[],
  cache: Map<string, ModelInfo> | null,
  backendId: 'zen' | 'go',
): ModelInfo[] {
  const uniqueIds = Array.from(new Set(apiIds));
  return uniqueIds
    .filter(id => !shouldHideModel({ providerId: backendId, modelId: id, agent: 'claude' }))
    .map(id => {
      const cached = cache?.get(id);
      if (cached) {
        const modelFormat = backendId === 'go' && cached.modelFormat === 'anthropic' ? 'openai' : cached.modelFormat;
        return { ...cached, sourceBackend: backendId, modelFormat };
      }
      const modelFormat = classifyModelFormat(id, undefined);
      return {
        id,
        name: id,
        isFree: false,
        brand: 'Other',
        sourceBackend: backendId,
        modelFormat,
        contextWindow: contextWindowFromHeuristics(id),
      };
    });
}

export function groupModels(models: ModelInfo[]): {
  free: ModelInfo[];
  byBrand: Map<string, ModelInfo[]>;
} {
  const free = models
    .filter(m => m.isFree)
    .sort((a, b) => a.id.localeCompare(b.id));

  const byBrand = new Map<string, ModelInfo[]>();
  for (const m of models.filter(m => !m.isFree)) {
    const list = byBrand.get(m.brand) ?? [];
    list.push(m);
    byBrand.set(m.brand, list);
  }
  for (const [brand, list] of byBrand) {
    byBrand.set(brand, list.sort((a, b) => a.id.localeCompare(b.id)));
  }
  return { free, byBrand };
}

export async function getModels(
  backend: BackendConfig,
  fallbackModels?: ModelInfo[],
): Promise<{ models: ModelInfo[]; fromCache: boolean }> {
  const cache = readModelsFromModelsDev(backend.id);

  try {
    const apiIds = await fetchModelsFromApi(backend);
    return { models: mergeModels(apiIds, cache, backend.id), fromCache: false };
  } catch {
    if (cache && cache.size > 0) {
      return { models: [...cache.values()], fromCache: true };
    }
    if (fallbackModels && fallbackModels.length > 0) {
      return { models: fallbackModels, fromCache: true };
    }
    throw new Error(
      'Cannot fetch models. Check your network and https://opencode.ai status.',
    );
  }
}
