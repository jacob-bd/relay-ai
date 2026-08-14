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
  | 'UNSUPPORTED_REASONING_LEVEL'
  | 'UNSUPPORTED_REGISTRY_VERSION'
  | 'PROVIDER_LOAD_FAILED';

/**
 * Provider-neutral reasoning level. Relay Core translates it into whatever
 * request shape the resolved route's provider actually wants — consumers never
 * write provider-specific `providerOptions` themselves.
 *
 * This union is exactly the vocabulary
 * `listRelayModels()[].capabilities.reasoningLevels` can contain, so a level
 * read off a descriptor is always assignable here. **Routes accept a subset**:
 * always check that descriptor before passing a level, since anything outside a
 * route's own list is rejected with `UNSUPPORTED_REASONING_LEVEL`.
 */
export type RelayReasoningLevel =
  | 'off'
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max';

export interface CreateRelayModelOptions {
  /**
   * Optional sanitized transport diagnostics. Messages contain event types,
   * field names, counts, and lengths — never credentials, prompts, or bodies.
   *
   * Supported by both Core transports: the generic SDK-provider path and the
   * specialized Cloud Code Assist path.
   */
  onDebug?: (message: string) => void;
  /**
   * Reasoning level to apply to every call made with the returned model.
   *
   * Throws `UNSUPPORTED_REASONING_LEVEL` when the route cannot express the
   * requested level, rather than quietly sending a weaker one. A per-call
   * `providerOptions` value passed to `streamText`/`generateText` still wins.
   */
  reasoning?: RelayReasoningLevel;
}

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
    /**
     * Always 'unknown' today — `CachedModel` carries no tools/vision metadata to
     * report from, and this API deliberately never guesses from the model name.
     * Will report a real boolean once that metadata exists upstream.
     */
    tools: boolean | 'unknown';
    /** See `tools` — same permanent-placeholder caveat. */
    vision: boolean | 'unknown';
    reasoning: 'none' | 'fixed' | 'adjustable' | 'unknown';
    /**
     * Exactly the levels this route accepts, when `reasoning === 'adjustable'`.
     * Typed as `RelayReasoningLevel[]` so a value read from here can be passed
     * straight to `CreateRelayModelOptions.reasoning` without a cast.
     */
    reasoningLevels?: RelayReasoningLevel[];
    defaultReasoningLevel?: RelayReasoningLevel;
  };
}
