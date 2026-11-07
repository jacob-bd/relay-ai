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
     * Optional stable conversation identifier for OpenCode Go. Relay sends this
     * as `x-opencode-session` on every upstream model call for the returned model.
     * The value is treated as opaque and bounded to OpenCode's 256-character
     * header limit. Per-call `headers` supplied to the AI SDK take precedence.
     */
    sessionId?: string;
    /**
     * Optional sanitized transport diagnostics. Messages contain event types,
     * field names, counts, and lengths — never credentials, prompts, or bodies.
     *
     * Supported by both Core transports: the generic SDK-provider path and the
     * specialized Cloud Code Assist path.
     */
    onDebug?: (message: string) => void;
    /**
     * Custom upstream fetch for Antigravity Cloud Code routes (other routes ignore it).
     * Used for every inference attempt, including failover and OAuth retries.
     * Trusted transport: receives OAuth credentials, project metadata and full bodies.
     * Credential refresh itself still uses Relay's OAuth machinery.
     */
    fetchImpl?: typeof globalThis.fetch;
    /**
     * Reasoning level to apply to every call made with the returned model.
     *
     * Throws `UNSUPPORTED_REASONING_LEVEL` when the route cannot express the
     * requested level, rather than quietly sending a weaker one. A per-call
     * `providerOptions` value passed to `streamText`/`generateText` still wins.
     */
    reasoning?: RelayReasoningLevel;
}
/** What a usage window counts against: the whole account, or a group of models with their own allowance. */
type RelayUsageScope = {
    type: 'account';
} | {
    type: 'model';
    modelId: string;
}
/** `modelIds` may be empty when the provider names the group (e.g. Claude's weekly Opus limit) but not its models. */
 | {
    type: 'model-group';
    family: string;
    modelIds: string[];
};
interface RelayUsageWindow {
    /** Stable within a provider kind: `5h`, `7d`, `30d`, `credits`, `monthly:premium_interactions`, `models:gemini-4:<reset>` … */
    id: string;
    label: string;
    /** 0–100, or null when the provider reports the window without a reading. */
    usedPercent: number | null;
    /** ISO timestamp, or null when the provider does not say. */
    resetsAt: string | null;
    windowSeconds?: number;
    /** Absolute allowance and what is left of it, when the provider reports counts. */
    limit?: number;
    remaining?: number;
    scope: RelayUsageScope;
}
/** Money left on the account outside the plan allowance (e.g. xAI extra usage credits). */
interface RelayUsageBalance {
    id: string;
    label: string;
    amount: number;
    currency: 'USD';
}
type RelayUsageErrorCode = 'credential_unavailable' | 'reauth_required' | 'access_denied' | 'rate_limited' | 'unavailable' | 'unsupported_payload';
interface RelayAccountUsage {
    providerId: string;
    providerKind: string;
    providerName: string;
    /**
     * `unsupported`: Relay has no usage source for this provider kind.
     * `unchecked`: supported, but never checked yet (`readRelayAccountUsage` without `fetchMissing`).
     * `error`: the last check failed; `windows`/`fetchedAt` still hold the last good reading, if any.
     */
    status: 'ok' | 'unsupported' | 'unchecked' | 'error';
    windows: RelayUsageWindow[];
    /** Balances reported beside the windows (no percentage; shown as amounts). */
    balances?: RelayUsageBalance[];
    /** True when the provider says the account is currently blocked by a limit. */
    limitReached?: boolean;
    /** When `windows` were read from the provider; null when never read. */
    fetchedAt: string | null;
    error?: {
        code: RelayUsageErrorCode;
        message: string;
    };
}
interface GetRelayAccountUsageOptions {
    /** Only these provider ids. Default: every enabled OAuth account. */
    providerIds?: string[];
    registryPath?: string;
    /** Saved-usage file. Default `<RELAY_AI_HOME>/usage.json`. */
    usageStorePath?: string;
    /** Save results for later reads. Default true. */
    persist?: boolean;
    fetchImpl?: typeof globalThis.fetch;
    /** Per-request timeout. Default 10s. */
    timeoutMs?: number;
}
interface ReadRelayAccountUsageOptions extends GetRelayAccountUsageOptions {
    /** Check accounts that have never been checked (once each). Default false: no network. */
    fetchMissing?: boolean;
}
interface RelayModelDescriptor {
    routeId: RelayRouteId;
    providerId: string;
    providerName: string;
    providerShortName: string;
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

declare const RELAY_POOL_ROUTE_ID: RelayRouteId;

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

/** Kinds `getRelayAccountUsage` can read usage for. */
declare function supportsAccountUsage(providerId: string): boolean;
/**
 * Check usage now, per enabled OAuth account, as a list of windows (percent used, reset time, scope).
 * Makes one live request per account (Antigravity: one per Cloud Code endpoint) and may refresh OAuth
 * tokens; nothing in Relay calls this on a timer. Results are saved for `readRelayAccountUsage`.
 * Never throws for a single account's failure: that account comes back with `status: 'error'`
 * and keeps its last good windows.
 */
declare function getRelayAccountUsage(opts?: GetRelayAccountUsageOptions): Promise<RelayAccountUsage[]>;
/**
 * The last saved usage per enabled OAuth account, without network requests. Accounts never checked
 * come back as `status: 'unchecked'`, unless `fetchMissing` is set, which checks just those accounts once.
 */
declare function readRelayAccountUsage(opts?: ReadRelayAccountUsageOptions): Promise<RelayAccountUsage[]>;

export { type CreateRelayModelOptions, type GetRelayAccountUsageOptions, RELAY_POOL_ROUTE_ID, type ReadRelayAccountUsageOptions, type RelayAccountUsage, RelayCoreError, type RelayCoreErrorCode, type RelayModelDescriptor, type RelayReasoningLevel, type RelayRouteId, type RelayUsageBalance, type RelayUsageErrorCode, type RelayUsageScope, type RelayUsageWindow, createRelayModel, getRelayAccountUsage, isRelayCoreError, listRelayModels, parseRelayRouteId, readRelayAccountUsage, supportsAccountUsage, toRelayRouteId };
