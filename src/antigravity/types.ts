/** A resolved Relay AI route for an Antigravity catalog entry. */
export interface AntigravityRoute {
  /** Opaque catalog ID — `relay-ai__<providerId>__<encoded-modelId>`. */
  catalogId: string;
  providerId: string;
  providerName: string;
  modelId: string;
  /** Upstream model ID used for actual API calls. */
  upstreamModelId: string;
  displayName: string;
  /** Vercel AI SDK npm package for the provider. */
  npm: string;
  /** Provider API key — never serialized into the catalog. */
  apiKey: string;
  /** Registry authentication mode, preserved so OAuth/API routes never share credentials. */
  authType?: 'api' | 'oauth' | 'none';
  oauthAccountId?: string;
  /** Provider base URL — never serialized into the catalog. */
  baseURL?: string;
  contextWindow?: number;
}

/** A minimal model entry from the Cloud Code fetchAvailableModels response. */
export interface CatalogModelEntry {
  displayName: string;
  model: string;
  /** Catalog route id — agy cascade uses this as RequestedModel when present. */
  requestedModelId?: string;
  modelVersion?: string;
  modelVersionId?: string;
  apiProvider?: string;
  modelProvider?: string;
  tokenizerType?: string;
  supportsImages?: boolean;
  supportsThinking?: boolean;
  thinkingBudget?: number;
  recommended?: boolean;
  maxTokens?: number;
  maxOutputTokens?: number;
  quotaInfo?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Shape of the fetchAvailableModels response. */
export interface CatalogFixture {
  models: Record<string, CatalogModelEntry>;
  defaultAgentModelId?: string;
  agentModelSorts?: Array<{
    displayName?: string;
    groups: Array<{
      modelIds: string[];
      modelLabels?: string[];
      groupName?: string;
      displayName?: string;
    }>;
  }>;
  commandModelIds?: string[];
  tabModelIds?: string[];
  imageGenerationModelIds?: string[];
  mqueryModelIds?: string[];
  webSearchModelIds?: string[];
  deprecatedModelIds?: Record<string, unknown>;
  commitMessageModelIds?: string[];
  audioTranscriptionModelIds?: string[];
  experimentIds?: Array<string | number>;
  tieredModelIds?: Record<string, unknown>;
  [key: string]: unknown;
}
