// src/types.ts

export type ModelFormat = 'anthropic' | 'openai' | 'unsupported';

export type StarterCommand = 'root' | 'claude' | 'server' | 'models';

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
}

export interface LocalProviderModel {
  id: string;
  name: string;
  family: string;
  brand: string;
  modelFormat: 'anthropic' | 'openai';
  baseUrl?: string;        // set for anthropic-format models
  completionsUrl?: string; // set for openai-format models
  npm?: string;            // OpenCode api.npm package, e.g. @ai-sdk/xai (SDK routing)
  apiBaseUrl?: string;     // raw api.url, for openai-compatible/openrouter SDK base URL
  cost?: ModelCost;
  contextWindow?: number;
}

export interface LocalProvider {
  id: string;
  name: string;
  apiKey: string;
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
  recentModelsByProvider?: Record<string, string[]>;
  favoriteModels?: FavoriteModel[];
  subscriptionTier?: 'free' | 'zen' | 'go' | 'both';
  server?: {
    savedPassword?: string;
  };
  modelListCache?: {
    zen?: { models: ModelInfo[]; fetchedAt: string };
    go?: { models: ModelInfo[]; fetchedAt: string };
  };
}

export interface ParsedArgs {
  command: StarterCommand;
  showHelp: boolean;
  showVersion: boolean;
  dryRun: boolean;
  setup: boolean;
  trace: boolean;
  claudeArgs: string[];
  error?: string;
}

export interface ConflictInfo {
  name: string;
  value: string;
}
