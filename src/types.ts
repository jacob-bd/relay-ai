// src/types.ts

export type ModelFormat = 'anthropic' | 'openai' | 'unsupported';

export type StarterCommand = 'root' | 'claude' | 'claude-app' | 'codex' | 'codex-app' | 'server' | 'models' | 'providers' | 'gemini' | 'agy' | 'antigravity-ide' | 'ui';

export interface BackendConfig {
  id: 'zen' | 'go';
  name: string;
  baseUrl: string;
}

export interface ModelCost {
  input: number;
  output: number;
  cache_read?: number;
  cache_write?: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  isFree: boolean;
  brand: string;
  sourceBackend: 'zen' | 'go';
  modelFormat: ModelFormat;
  cost?: ModelCost;
  contextWindow?: number;
  /** Broad model metadata: model can produce reasoning/thinking output. */
  reasoning?: boolean;
  /** Streaming/interleaved reasoning field name from metadata, e.g. reasoning_content. */
  interleavedReasoningField?: string;
}

export interface LocalProviderModel {
  id: string;
  name: string;
  family: string;
  brand: string;
  modelFormat: 'anthropic' | 'openai' | 'cloud-code';
  /** Wire id sent to the upstream API (OpenCode api.id); may differ from catalog id, e.g. gpt-5.5-fast → gpt-5.5. */
  upstreamModelId: string;
  baseUrl?: string;        // set for anthropic-format models
  completionsUrl?: string; // set for openai-format models
  npm?: string;            // OpenCode api.npm package, e.g. @ai-sdk/xai (SDK routing)
  apiBaseUrl?: string;     // raw api.url, for openai-compatible/openrouter SDK base URL
  cost?: ModelCost;
  contextWindow?: number;
  /** Provider-reported request parameters, e.g. OpenRouter supported_parameters. */
  supportedParameters?: string[];
  /** Broad model metadata: model can produce reasoning/thinking output. */
  reasoning?: boolean;
  /** Streaming/interleaved reasoning field name from metadata, e.g. reasoning_content. */
  interleavedReasoningField?: string;
  /** OpenCode Zen free-tier models only. */
  isFree?: boolean;
  modalities?: ('text' | 'image')[];
}

export interface LocalProvider {
  id: string;
  name: string;
  apiKey: string;
  authType?: 'api' | 'oauth' | 'none';
  oauthAccountId?: string;
  providerData?: Record<string, unknown>;
  models: LocalProviderModel[];
}

export interface FavoriteModel {
  providerId: string;
  modelId: string;
}

export interface UserPreferences {
  lastBackend?: 'zen' | 'go';
  lastModel?: string;
  lastProvider?: string;
  lastCodexProvider?: string;
  lastCodexModel?: string;
  lastGeminiProvider?: string;
  lastGeminiModel?: string;
  lastAntigravityProvider?: string;
  lastAntigravityModel?: string;
  recentModelsByProvider?: Record<string, string[]>;
  favoriteModels?: FavoriteModel[];
  antigravityCliFavoriteModels?: FavoriteModel[];
  antigravityCliFavoritesHintShown?: boolean;
  server?: {
    savedPassword?: string;
    /** Provider ids exposed by `relay-ai server` (zen, go, or local OpenCode provider ids). */
    exposedProviders?: string[];
    /** Reverse gateway ids for Claude Desktop / Cowork model discovery. */
    maskGatewayIds?: boolean;
    /** Expose only models saved via `relay-ai models`. */
    favoritesOnly?: boolean;
  };
}

export interface ParsedArgs {
  command: StarterCommand;
  showHelp: boolean;
  showVersion: boolean;
  dryRun: boolean;
  setup: boolean;
  trace: boolean;
  vertex: boolean;
  claudeArgs: string[];
  /** relay-ai boot provider (claude/codex); not passed to child CLI */
  launchProvider?: string;
  /** relay-ai boot model (claude/codex); not passed to child CLI */
  launchModel?: string;
  /** Print comprehensive AI agent reference (relay-ai --ai) */
  showAi?: boolean;
  /** Install --ai SKILL.md to agent skill directories */
  aiInstall?: boolean;
  /** Reinstall skill even when version already matches */
  aiInstallForce?: boolean;
  /** Manage the AGY-specific favorites list instead of global favorites. */
  favoritesAgy?: boolean;
  error?: string;
}

export interface ConflictInfo {
  name: string;
  value: string;
}
