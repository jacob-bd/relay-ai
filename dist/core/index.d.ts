import { LanguageModel } from 'ai';

/** Unconditionally-scoped route id: `${providerId}::${modelId}`. Never bare. */
type RelayRouteId = `${string}::${string}`;
type RelayCoreErrorCode = 'INVALID_ROUTE_ID' | 'ROUTE_NOT_FOUND' | 'PROVIDER_DISABLED' | 'CREDENTIAL_UNAVAILABLE' | 'OAUTH_REFRESH_FAILED' | 'UNSUPPORTED_MODEL' | 'UNSUPPORTED_REASONING_LEVEL' | 'UNSUPPORTED_REGISTRY_VERSION' | 'PROVIDER_LOAD_FAILED';
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
type RelayReasoningLevel = 'off' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
interface CreateRelayModelOptions {
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
interface RelayModelDescriptor {
    routeId: RelayRouteId;
    providerId: string;
    providerName: string;
    modelId: string;
    upstreamModelId: string;
    displayName: string;
    authType: 'api' | 'oauth' | 'none';
    favorite: boolean;
    contextWindow?: number;
    pricing?: {
        input: number;
        output: number;
        cacheRead?: number;
        cacheWrite?: number;
    };
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

/**
 * List the credential-free model catalog: one descriptor per cached model of
 * every enabled provider. Never resolves credentials, refreshes OAuth, hits a
 * provider API, or writes to disk.
 */
declare function listRelayModels(registryPath?: string): RelayModelDescriptor[];

/**
 * Build a ready Vercel AI SDK `LanguageModel` for a `provider::model` route id.
 *
 * Re-reads the registry, credentials, and OAuth state on every call — nothing is
 * cached across calls, so a provider disabled or re-authenticated after the last
 * call takes effect without restarting the consumer process. Credentials are
 * resolved (and OAuth tokens refreshed) by Relay's existing machinery; the
 * credential and the intermediate spec never leave this function.
 */
declare function createRelayModel(routeId: RelayRouteId, options?: CreateRelayModelOptions): Promise<LanguageModel>;

/**
 * Build a route id from a provider id and a model id. The provider id must pass
 * the registry's `PROVIDER_ID_PATTERN`; the model id may contain `/` and `:`.
 */
declare function toRelayRouteId(providerId: string, modelId: string): RelayRouteId;
/**
 * Parse a route id back into its parts. Splits on the FIRST `::` only, so model
 * ids containing `/` or `:` (e.g. `openrouter::vendor/model:free`) survive.
 * A bare model id (no `::`) is rejected.
 */
declare function parseRelayRouteId(routeId: string): {
    providerId: string;
    modelId: string;
};

interface RelayCoreErrorOptions {
    retryable?: boolean;
    providerId?: string;
    routeId?: RelayRouteId;
    cause?: unknown;
}
/**
 * Error thrown by the embedded Core API. Carries only safe structured metadata —
 * never credential material. `cause` is retained for internal debugging but is
 * omitted from JSON serialization.
 */
declare class RelayCoreError extends Error {
    readonly code: RelayCoreErrorCode;
    readonly retryable: boolean;
    readonly providerId?: string;
    readonly routeId?: RelayRouteId;
    constructor(code: RelayCoreErrorCode, message: string, options?: RelayCoreErrorOptions);
    toJSON(): Record<string, unknown>;
}
declare function isRelayCoreError(err: unknown): err is RelayCoreError;

export { type CreateRelayModelOptions, RelayCoreError, type RelayCoreErrorCode, type RelayModelDescriptor, type RelayReasoningLevel, type RelayRouteId, createRelayModel, isRelayCoreError, listRelayModels, parseRelayRouteId, toRelayRouteId };
