// src/types.ts

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
  isAnthropicNative: boolean;
  cost?: ModelCost;
}

export interface UserPreferences {
  lastBackend?: 'zen' | 'go';
  lastModel?: string;
  subscriptionTier?: 'free' | 'zen' | 'go' | 'both';
  modelListCache?: {
    zen?: { models: ModelInfo[]; fetchedAt: string };
    go?: { models: ModelInfo[]; fetchedAt: string };
  };
}

export interface ParsedArgs {
  showHelp: boolean;
  showVersion: boolean;
  dryRun: boolean;
  setup: boolean;
  claudeArgs: string[];
}

export interface ConflictInfo {
  name: string;
  value: string;
}
