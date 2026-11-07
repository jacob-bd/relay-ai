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
export type RelayUsageScope =
  | { type: 'account' }
  | { type: 'model'; modelId: string }
  /** `modelIds` may be empty when the provider names the group (e.g. Claude's weekly Opus limit) but not its models. */
  | { type: 'model-group'; family: string; modelIds: string[] };

export interface RelayUsageWindow {
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
export interface RelayUsageBalance {
  id: string;
  label: string;
  amount: number;
  currency: 'USD';
}

export type RelayUsageErrorCode =
  | 'credential_unavailable' | 'reauth_required' | 'access_denied' | 'rate_limited'
  | 'unavailable' | 'unsupported_payload';

export interface RelayAccountUsage {
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
  error?: { code: RelayUsageErrorCode; message: string };
}

export interface GetRelayAccountUsageOptions {
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

export interface ReadRelayAccountUsageOptions extends GetRelayAccountUsageOptions {
  /** Check accounts that have never been checked (once each). Default false: no network. */
  fetchMissing?: boolean;
}

export interface RelayModelDescriptor {
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
