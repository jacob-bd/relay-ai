// src/types.ts

export type ModelFormat = 'anthropic' | 'openai' | 'unsupported';

export type StarterCommand = 'root' | 'claude' | 'server';

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
}

export interface UserPreferences {
  lastBackend?: 'zen' | 'go';
  lastModel?: string;
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
