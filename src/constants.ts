// src/constants.ts
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { BackendConfig } from './types.js';

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

// Models confirmed broken on OpenCode — hidden until fixed upstream.
// Tested 2026-06-05 against /v1/messages with Anthropic message format.
// 401 = promotion ended. 400 = translation layer rejects Anthropic format.
export const BLOCKED_MODELS = new Set([
  // Zen free
  'qwen3.6-plus-free',       // 401 — free promotion ended
  'deepseek-v4-flash-free',  // 400 — DeepSeek rejects Anthropic message format
  'mimo-v2.5-free',          // 400 — rejects Anthropic message format
  'nemotron-3-super-free',   // 400 — rejects Anthropic message format
  'nemotron-3-ultra-free',   // 400 — rejects Anthropic message format
  // Go
  'kimi-k2.6',               // 400 — rejects Anthropic message format
  'kimi-k2.5',               // 400 — rejects Anthropic message format
  'deepseek-v4-pro',         // 400 — DeepSeek rejects Anthropic message format
  'deepseek-v4-flash',       // 400 — DeepSeek rejects Anthropic message format
  'mimo-v2-pro',             // 400 — rejects Anthropic message format
  'mimo-v2-omni',            // 400 — rejects Anthropic message format
  'mimo-v2.5-pro',           // 400 — rejects Anthropic message format
  'mimo-v2.5',               // 400 — rejects Anthropic message format
  'hy3-preview',             // 400 — rejects Anthropic message format
]);

export const VERSION = '0.1.0';
