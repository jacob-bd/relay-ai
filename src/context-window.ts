// Context window resolution for proxy /v1/models and Claude Code child env.
//
// Priority:
//   1. OpenCode models.json cache (limit.context) — `opencode` / `opencode-go` file keys first
//   2. ID-pattern heuristics for models not in cache
//   3. 200K default (Claude Code's own fallback for unknown models)
import { readFileSync } from 'node:fs';
import { OPENCODE_CACHE_PATH } from './constants.js';

export const DEFAULT_CONTEXT_WINDOW = 200_000;

/** OpenCode cache file provider keys for Zen/Go (not relay-ai registry ids). */
const CACHE_PROVIDER_PRIORITY = new Set(['opencode', 'opencode-go']);

export interface OpencodeCacheModel {
  id?: string;
  name?: string;
  family?: string;
  status?: string;
  provider?: { npm?: string };
  cost?: { input: number; output: number };
  limit?: { context?: number; output?: number };
  reasoning?: boolean;
  interleaved?: { field?: string };
}

export type OpencodeCacheFile = Record<string, { models?: Record<string, OpencodeCacheModel> }>;

// Ordered by specificity — first match wins.
const HEURISTIC_RULES: Array<[RegExp, number]> = [
  [/gemini-2\.5-pro|gemini-1\.5-pro|gemini-3-pro/i, 2_000_000],
  [/gemini/i, 1_000_000],
  [/claude-opus-4-[678]|claude-sonnet-4-[678]/i, 1_000_000],
  [/claude-haiku-4-[567]/i, 200_000],
  [/claude.*\[1m\]/i, 1_000_000],
  [/claude-opus-4-[56]|claude-sonnet-4-[45]|claude-3/i, 200_000],
  [/claude/i, 200_000],
  [/deepseek-v4|deepseek-r1|deepseek-reasoner/i, 1_000_000],
  [/deepseek/i, 64_000],
  [/gpt-5|gpt-4\.1|o3-|o4-/i, 1_000_000],
  [/gpt-4o|gpt-4-turbo|gpt-4/i, 128_000],
  [/gpt-oss/i, 131_072],
  [/qwen3|qwen-3|qwen2\.5-72b|qwen2\.5-32b|qwen-coder/i, 262_144],
  [/qwen/i, 131_072],
  [/kimi-k2|kimi-k2\.5|moonshot/i, 262_144],
  [/minimax-m2/i, 204_800],
  [/minimax/i, 128_000],
  [/mistral-large|ministral|mistral/i, 262_144],
  [/llama-3\.[23]|llama3/i, 131_072],
  [/grok-3|grok-4/i, 131_072],
  [/nemotron/i, 131_072],
  [/glm-4/i, 128_000],
  [/solar-pro3/i, 131_072],
  [/solar-pro2/i, 65_536],
  [/solar/i, 32_768],
];

let parsedCache: OpencodeCacheFile | null | undefined;
let cacheIndex: Map<string, number> | undefined;
const heuristicCache = new Map<string, number>();

/** Shared parse of ~/.cache/opencode/models.json — used by model list and context lookup. */
export function loadOpencodeCache(): OpencodeCacheFile | null {
  if (parsedCache === undefined) {
    try {
      parsedCache = JSON.parse(readFileSync(OPENCODE_CACHE_PATH, 'utf8')) as OpencodeCacheFile;
    } catch {
      parsedCache = null;
    }
  }
  return parsedCache;
}

/** Build a model-id → context-window map from OpenCode cache data. Exported for tests. */
export function buildContextWindowIndex(cache: OpencodeCacheFile): Map<string, number> {
  const index = new Map<string, number>();
  const allLimits = new Map<string, number[]>();

  for (const [providerKey, providerData] of Object.entries(cache)) {
    const models = providerData?.models;
    if (!models) continue;
    for (const [modelId, entry] of Object.entries(models)) {
      const ctx = entry.limit?.context;
      if (typeof ctx !== 'number' || ctx <= 0) continue;

      const limits = allLimits.get(modelId) ?? [];
      limits.push(ctx);
      allLimits.set(modelId, limits);

      if (CACHE_PROVIDER_PRIORITY.has(providerKey)) {
        index.set(modelId, ctx);
      }
    }
  }

  for (const [modelId, limits] of allLimits) {
    if (!index.has(modelId)) {
      index.set(modelId, Math.max(...limits));
    }
  }

  return index;
}

function getCacheIndex(): Map<string, number> {
  if (cacheIndex === undefined) {
    const cache = loadOpencodeCache();
    cacheIndex = cache ? buildContextWindowIndex(cache) : new Map();
  }
  return cacheIndex;
}

export function contextWindowFromHeuristics(modelId: string): number {
  const cached = heuristicCache.get(modelId);
  if (cached !== undefined) return cached;
  for (const [pattern, size] of HEURISTIC_RULES) {
    if (pattern.test(modelId)) {
      heuristicCache.set(modelId, size);
      return size;
    }
  }
  heuristicCache.set(modelId, DEFAULT_CONTEXT_WINDOW);
  return DEFAULT_CONTEXT_WINDOW;
}

export function lookupContextWindow(modelId: string): number {
  return getCacheIndex().get(modelId) ?? contextWindowFromHeuristics(modelId);
}

/** Prefer an explicit limit.context (or pre-resolved value), else resolve from cache/heuristics. */
export function resolveContextWindow(modelId: string, explicit?: number): number {
  if (typeof explicit === 'number' && explicit > 0) return explicit;
  return lookupContextWindow(modelId);
}
