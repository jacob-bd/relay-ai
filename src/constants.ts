// src/constants.ts
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { BackendConfig, ModelFormat } from './types.js';

export const BACKENDS: Record<'zen' | 'go', BackendConfig> = {
  zen: {
    id: 'zen',
    name: 'OpenCode Zen',
    // No /v1 suffix — the Anthropic SDK appends /v1/messages automatically
    baseUrl: 'https://opencode.ai/zen',
  },
  go: {
    id: 'go',
    name: 'OpenCode Go',
    baseUrl: 'https://opencode.ai/zen/go',
  },
};

// These must be removed from the child process environment to avoid conflicts
// with Vertex AI, Bedrock, AWS, Foundry, and any stale Anthropic config.
export const CONFLICTING_ENV_VARS = [
  'CLAUDE_CODE_USE_VERTEX',
  'ANTHROPIC_VERTEX_PROJECT_ID',
  'ANTHROPIC_VERTEX_BASE_URL',
  'CLOUD_ML_REGION',
  'ANTHROPIC_BEDROCK_BASE_URL',
  'ANTHROPIC_AWS_BASE_URL',
  'ANTHROPIC_AWS_API_KEY',
  'ANTHROPIC_AWS_WORKSPACE_ID',
  'ANTHROPIC_FOUNDRY_API_KEY',
  'ANTHROPIC_FOUNDRY_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
] as const;

export type ConflictingEnvVar = (typeof CONFLICTING_ENV_VARS)[number];

export const OPENCODE_CACHE_PATH = join(homedir(), '.cache', 'opencode', 'models.json');

export const MODELS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Max models in favorites list and mid-session /model switch catalog. */
export const MAX_MODEL_CATALOG = 20;

/** Vercel AI SDK package for Anthropic Claude models on Google Vertex AI (ADC auth). */
export const VERTEX_ANTHROPIC_NPM = '@ai-sdk/google-vertex/anthropic';

// Local provider model ids that return 410 / are gated behind separate approval.
// Listed in catalog but reject inference — filter to avoid bad probe results.
export const BLACKLISTED_LOCAL_MODEL_IDS = new Set([
  'z-ai/glm4.7',              // NVIDIA NIM: requires separate access approval
]);

// Models whose "free" status is stale — promotion ended but API still lists them.
// Filtered to avoid misleading users into selecting a non-functional free model.
export const STALE_FREE_MODELS = new Set([
  'qwen3.6-plus-free',       // 401 — free promotion ended
  'mimo-v2-pro',             // 400 — deprecated, migrate to mimo-v2.5-pro
  'mimo-v2-omni',            // 400 — deprecated, migrate to mimo-v2.5
]);

// Classify a model's API format based on cache provider data or ID heuristics.
// Used to decide whether to route directly or through the translation proxy.
export function classifyModelFormat(
  modelId: string,
  providerNpm: string | undefined,
): ModelFormat {
  if (providerNpm === '@ai-sdk/anthropic') return 'anthropic';
  if (providerNpm === '@ai-sdk/openai') return 'unsupported';
  if (providerNpm === '@ai-sdk/google') return 'unsupported';

  // Fallback: ID-prefix heuristics for models not in cache
  const lower = modelId.toLowerCase();
  if (lower.startsWith('claude-')) return 'anthropic';
  if (lower.startsWith('gpt-')) return 'unsupported';
  if (lower.startsWith('gemini-')) return 'unsupported';

  return 'openai';
}

export const VERSION = '1.0.0';
