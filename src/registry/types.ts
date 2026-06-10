// src/registry/types.ts — native provider registry schema (no secrets)

export const REGISTRY_SCHEMA_VERSION = 1;

export type RegistrySubscriptionFilter = 'free' | 'zen' | 'go';

export interface CachedModel {
  id: string;
  name: string;
  upstreamModelId: string;
  family?: string;
  brand?: string;
  contextWindow?: number;
  cost?: { input: number; output: number };
  modelFormat: 'anthropic' | 'openai';
  /** Per-model override — wins over provider-level api.npm */
  npm?: string;
  /** Per-model override — wins over provider-level api.url */
  apiUrl?: string;
  sourceBackend?: string;
}

export interface RegistryProvider {
  id: string;
  templateId: string;
  name: string;
  enabled: boolean;
  authRef: string;
  subscriptionFilter?: RegistrySubscriptionFilter;
  api: {
    npm?: string;
    url?: string;
    id?: string;
  };
  modelsCache?: {
    fetchedAt: string;
    models: CachedModel[];
  };
  addedAt: string;
  refreshedAt?: string;
}

export interface ProviderRegistry {
  schemaVersion: number;
  providers: RegistryProvider[];
  importedAt?: string;
  pricingCacheAt?: string;
}
