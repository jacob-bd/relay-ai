// src/types.ts

import type { FreeStatus } from './free-models.js';

export type ModelFormat = 'anthropic' | 'openai' | 'unsupported';

export type StarterCommand = 'root' | 'claude' | 'claude-app' | 'codex' | 'codex-app' | 'server' | 'models' | 'providers' | 'gemini' | 'agy' | 'antigravity' | 'antigravity-ide' | 'ui';

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
  freeStatus?: FreeStatus;
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
  /** Backend capability: model requires the Responses-Lite request shape (x-openai-internal-codex-responses-lite). */
  useResponsesLite?: boolean;
  /** Backend capability: model must use the WebSocket Responses transport instead of HTTP. */
  preferWebSockets?: boolean;
  /** OpenCode Zen free-tier models only. */
  isFree?: boolean;
  freeStatus?: FreeStatus;
  modalities?: ('text' | 'image')[];
}

export interface LocalProvider {
  id: string;
  name: string;
  apiKey: string;
  authType?: 'api' | 'oauth' | 'none';
  oauthAccountId?: string;
  providerData?: Record<string, unknown>;
  /** Static headers sent on every upstream request (e.g. a plan/auth-tracking header a custom endpoint requires). */
  headers?: Record<string, string>;
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
  appPathOverrides?: Record<string, string>;
  recentLaunchFolders?: string[];
  server?: {
    savedPassword?: string;
    /** Provider ids exposed by `relay-ai server` (zen, go, or local OpenCode provider ids). */
    exposedProviders?: string[];
    /** Reverse gateway ids for Claude Desktop / Cowork model discovery. */
    maskGatewayIds?: boolean;
    /** Expose only models saved via `relay-ai models`. */
    favoritesOnly?: boolean;
    /** Expose only verified-free or free-provider-access models. */
    freeModelsOnly?: boolean;
    /** Saved listen mode for one-step `relay-ai server --quick` launches. */
    listenMode?: 'local' | 'network';
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
  /** Start `relay-ai server` from saved/default settings without prompts. */
  serverQuick?: boolean;
  /** One-run listen override for `relay-ai server`. */
  serverListenMode?: 'local' | 'network';
  /** One-run provider exposure mode for `relay-ai server`. */
  serverProvidersMode?: 'all' | 'favorites' | 'specific';
  /** One-run provider ids when serverProvidersMode is `specific`. */
  serverProviderIds?: string[];
  /** One-run free/free-access model filter override. */
  serverFreeOnly?: boolean;
  /** One-run discovery id masking override. */
  serverMaskGatewayIds?: boolean;
  /** One-run network password for `relay-ai server`. */
  serverPassword?: string;
  /** Run Claude/server through the selective api.anthropic.com HTTP proxy. */
  httpProxy?: boolean;
  /** Print saved HTTP-proxy model names without opening the favorites manager. */
  favoritesList?: boolean;
  error?: string;
}

export interface ConflictInfo {
  name: string;
  value: string;
}
