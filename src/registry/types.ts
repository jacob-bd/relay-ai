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
  modelFormat: 'anthropic' | 'openai' | 'cloud-code';
  /** Per-model override — wins over provider-level api.npm */
  npm?: string;
  /** Per-model override — wins over provider-level api.url */
  apiUrl?: string;
  sourceBackend?: string;
  /** Provider-reported request parameters, e.g. OpenRouter supported_parameters. */
  supportedParameters?: string[];
  /** Broad model metadata: model can produce reasoning/thinking output. */
  reasoning?: boolean;
  /** Streaming/interleaved reasoning field name from metadata, e.g. reasoning_content. */
  interleavedReasoningField?: string;
}

export interface RegistryProvider {
  id: string;
  templateId: string;
  name: string;
  enabled: boolean;
  authRef: string;
  authType?: 'api' | 'oauth' | 'none';
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
