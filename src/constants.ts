// src/constants.ts
import { homedir } from 'node:os';
import { join } from 'node:path';
import pkg from '../package.json' with { type: 'json' };
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

// ChatGPT Codex Responses-Lite WebSocket transport (used by models the backend
// flags with prefer_websockets, e.g. gpt-5.6-luna).
export const CODEX_RESPONSES_LITE_WS_URL = 'wss://chatgpt.com/backend-api/codex/responses';
// `version` header the Codex backend expects on Responses-Lite requests. The
// official Codex CLI sends its own version here; OpenAI may require this to be
// bumped over time — confirm via --trace if Luna requests start failing.
export const CODEX_RESPONSES_LITE_VERSION = '0.144.1';
// OpenAI-Beta opt-in for the WebSocket Responses transport.
export const CODEX_RESPONSES_WEBSOCKETS_BETA = 'responses_websockets=2026-02-06';

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

// When relay-ai launches Claude Code from inside an existing Claude Code
// session (its own terminal, a Code tab, an agent's shell), these identity
// vars leak into the spawned child via process.env inheritance. The new
// process then misidentifies itself as a nested child of the outer session
// (e.g. CLAUDE_CODE_CHILD_SESSION disables transcript saving) even though
// it's meant to be a fresh top-level launch. Strip before spawning.
export const PARENT_SESSION_ENV_VARS = [
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_HOST_SESSION_ID',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_PID',
] as const;

// Optional enrichment from OpenCode CLI (~/.cache/opencode/models.json) — not a runtime dependency.
export const OPENCODE_CACHE_PATH = join(homedir(), '.cache', 'opencode', 'models.json');

/** Max models in favorites list and mid-session /model switch catalog. */
export const MAX_MODEL_CATALOG = 20;

/** Vercel AI SDK package for Anthropic Claude models on Google Vertex AI (ADC auth). */
export const VERTEX_ANTHROPIC_NPM = '@ai-sdk/google-vertex/anthropic';

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

export const VERSION = pkg.version;
