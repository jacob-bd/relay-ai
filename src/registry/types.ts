import type { ModelKind } from './model-kind.js';
// src/registry/types.ts — native provider registry schema (no secrets)

import type { ReferencePrice } from '../types.js';
import type { FreeStatus } from '../free-models.js';

export const REGISTRY_SCHEMA_VERSION = 1;

export type RegistrySubscriptionFilter = 'free' | 'zen' | 'go';

export interface ModelTestResult {
  ok: boolean;
  /** ISO time of the test. */
  at: string;
  latencyMs?: number;
  toolsPassed?: boolean;
  /** Relay's own fixed message (never raw upstream text). */
  error?: string;
  /** Failure caused by limits, timeouts or the network, not by the model; never blocks adding it. */
  transient?: boolean;
}

export interface CachedModel {
  /** User-owned addition, kept separately from the downloaded catalog. */
  source?: 'manual';
  id: string;
  name: string;
  upstreamModelId: string;
  family?: string;
  brand?: string;
  contextWindow?: number;
  /** Distinguishes provider-reported context from legacy Relay guesses; 'models.dev' = looked up there for a custom endpoint (still an estimate). */
  contextWindowSource?: 'provider' | 'user' | 'models.dev';
  cost?: { input: number; output: number; cache_read?: number; cache_write?: number };
  costSource?: 'provider' | 'models.dev' | 'pricing-feed';
  referencePrice?: ReferencePrice;
  isFree?: boolean;
  freeStatus?: FreeStatus;
  /** Set only from the provider's `freeModelIds` (the user declared it free); never from catalog data. */
  userMarkedFree?: boolean;
  /** Derived from a local/private endpoint URL in getProviderModels; never stored. */
  localEndpoint?: boolean;
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
  /** Backend capability: model requires the Responses-Lite request shape (x-openai-internal-codex-responses-lite). */
  useResponsesLite?: boolean;
  /** Backend capability: model must use the WebSocket Responses transport instead of HTTP. */
  preferWebSockets?: boolean;
}

export interface ManualModel extends CachedModel {
  source: 'manual';
  /** Time generation, streaming and a harmless tool round-trip last passed. */
  validatedAt: string;
}

export interface RegistryProvider {
  id: string;
  templateId: string;
  name: string;
  /** True once the user renamed the provider — pickers then show `name` exactly as typed. */
  nameCustomized?: boolean;
  enabled: boolean;
  authRef: string;
  authType?: 'api' | 'oauth' | 'none';
  subscriptionFilter?: RegistrySubscriptionFilter;
  api: {
    npm?: string;
    url?: string;
    id?: string;
    /** Static headers sent on every upstream request (e.g. a plan/auth-tracking header a custom endpoint requires). */
    headers?: Record<string, string>;
  };
  modelsCache?: {
    fetchedAt: string;
    models: CachedModel[];
  };
  manualModels?: ManualModel[];
  /** Model ids the user hid; kept apart from modelsCache so a refresh never un-hides them. */
  hiddenModelIds?: string[];
  /** Model ids the user declared free (their own risk); kept apart from modelsCache so a refresh never drops them. */
  freeModelIds?: string[];
  /** Latest explicit Test per model (local log); kept apart from modelsCache so a refresh never drops it. */
  modelTestResults?: Record<string, ModelTestResult>;
  /** Context sizes the user typed or a model Test measured; kept apart from modelsCache so a refresh never drops them. */
  contextWindowOverrides?: Record<string, ContextWindowOverride>;
  /** Model ids a Test/Measure found are not chat models (the server refused the chat request). */
  nonChatModelIds?: string[];
  /** Model ids a Test/Measure got a chat reply from. */
  chatModelIds?: string[];
  /** Model types the user picked by hand; they win over models.dev and test results. */
  modelKindOverrides?: Record<string, ModelKind>;
  addedAt: string;
  refreshedAt?: string;
}

export interface ContextWindowOverride {
  contextWindow: number;
  /** 'user' = typed by hand (a later Test never replaces it); 'measured' = stated by the server during a Test. */
  source: 'user' | 'measured';
}

export interface ProviderRegistry {
  schemaVersion: number;
  providers: RegistryProvider[];
  importedAt?: string;
  pricingCacheAt?: string;
}
