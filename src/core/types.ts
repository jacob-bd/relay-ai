// src/core/types.ts — public contracts for the embedded @jacobbd/relay-ai/core surface.

/** Unconditionally-scoped route id: `${providerId}::${modelId}`. Never bare. */
export type RelayRouteId = `${string}::${string}`;

export type RelayCoreErrorCode =
  | 'INVALID_ROUTE_ID'
  | 'ROUTE_NOT_FOUND'
  | 'PROVIDER_DISABLED'
  | 'CREDENTIAL_UNAVAILABLE'
  | 'OAUTH_REFRESH_FAILED'
  | 'UNSUPPORTED_MODEL'
  | 'UNSUPPORTED_REGISTRY_VERSION'
  | 'PROVIDER_LOAD_FAILED';

export interface RelayModelDescriptor {
  routeId: RelayRouteId;
  providerId: string;
  providerName: string;
  modelId: string;
  upstreamModelId: string;
  displayName: string;
  authType: 'api' | 'oauth' | 'none';
  favorite: boolean;
  contextWindow?: number;
  pricing?: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
  capabilities: {
    tools: boolean | 'unknown';
    vision: boolean | 'unknown';
    reasoning: 'none' | 'fixed' | 'adjustable' | 'unknown';
    reasoningLevels?: string[];
    defaultReasoningLevel?: string;
  };
}
