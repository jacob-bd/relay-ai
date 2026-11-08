import { appendCompactionInstruction } from '../codex-responses-adapter.js';
import { createLanguageModel } from '../provider-factory.js';
import { poolRequestFitsWindow } from './context.js';
import { resolveLocalProviderApiKey } from '../provider-catalog.js';
import { providerRefreshToken } from '../provider-runtime.js';
import { poolFreeStatus } from '../free-models.js';
import type { FreePoolPreferences, LocalProvider } from '../types.js';
import type { CodexSdkCallParams } from '../codex-responses-adapter.js';
import { preparePoolHistory, poolHistoryOrigins } from './continuation.js';
import { currentPoolReceipt, poolEndpointRevision, type PoolCapabilityReceipt } from './capabilities.js';
import { lazyPoolRoute } from './lazy-route.js';
import { sdkPoolRoute } from './sdk-route.js';
import { poolMemberEffort } from './effort.js';
import { poolOutputCap } from './output-limit.js';
import { poolProviderHeaders } from './session-id.js';
import type { CodexPoolRoute } from './codex-runtime.js';
import { PoolHealthStore, poolAccountScope, poolEndpointScope } from './health.js';

/**
 * Codex sends every connected MCP tool (often well over 128). OpenAI-style APIs, and most free providers behind
 * them, reject more than 128 with HTTP 400, which used to fail those members on every request. Codex lists its
 * own tools first, so keeping the first 128 keeps the core tools and drops MCP tools last.
 */
export const POOL_MAX_TOOLS = 128;

/** A compaction summary is a short paragraph; the cap also bounds a model that free-runs instead of stopping. */
export const POOL_COMPACTION_MAX_OUTPUT_TOKENS = 4_000;

/** Remote compaction v2 appends a bare `compaction_trigger` input item. */
export function isPoolCompactionRequest(body: Record<string, unknown>): boolean {
  return Array.isArray(body.input) && body.input.some(item =>
    item && typeof item === 'object' && (item as { type?: unknown }).type === 'compaction_trigger');
}

export interface PoolContextCheck {
  verified: boolean;
  fits: boolean;
}

/** Provider-option keys that would claim a specific reasoning level. */
const EFFORT_CLAIM_KEYS = new Set([
  'effort', 'reasoningEffort', 'reasoning_effort', 'thinkingLevel', 'thinkingBudget',
  'thinking_budget', 'effortLevel', 'budget_tokens',
]);

/**
 * Auto is a verified omission contract, not a named default rung.
 *
 * Relay sends no effort field at all and lets the provider apply its own
 * default, so nothing about that default has to be guessed or proven.
 * Passing null omits the field; a level is used only after the receipt already
 * verified that exact level.
 */
export function omitPoolEffort(
  body: Record<string, unknown>, level: string | null,
): Record<string, unknown> {
  const reasoning = { ...(body.reasoning as Record<string, unknown> | undefined) };
  delete reasoning.effort;
  if (level !== null) reasoning.effort = level;
  const next = { ...body };
  if (Object.keys(reasoning).length > 0) next.reasoning = reasoning;
  else delete next.reasoning;
  return next;
}

/**
 * Translation must not invent a level we never chose. If a provider option would
 * claim one, the omission contract is broken and the route is refused instead of
 * silently serving a different effort from the user's request.
 */
export function translatedEffortClaim(
  providerOptions: Record<string, Record<string, unknown>> | undefined,
): string | undefined {
  for (const [provider, value] of Object.entries(providerOptions ?? {})) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    for (const [key, nested] of Object.entries(value)) {
      if (EFFORT_CLAIM_KEYS.has(key)) return provider + '.' + key;
      if (!nested || typeof nested !== 'object' || Array.isArray(nested)) continue;
      for (const inner of Object.keys(nested as Record<string, unknown>)) {
        if (EFFORT_CLAIM_KEYS.has(inner)) return provider + '.' + key + '.' + inner;
      }
    }
  }
  return undefined;
}
/** Resolve each member independently; never share a model object by catalog alias. */
export async function prepareCodexPoolRoutes(options: {
  pool: FreePoolPreferences;
  providers: readonly LocalProvider[];
  receipts: readonly PoolCapabilityReceipt[];
  body: Record<string, unknown>;
  source?: string;
  signal: AbortSignal;
  sessionId?: string;
  health: PoolHealthStore;
  /** Called once per member that is left out, with a short fixed reason (no prompts, no keys). */
  onSkip?: (member: { providerId: string; modelId: string }, reason: string) => void;
  checkContext?: (params: CodexSdkCallParams, receipt: PoolCapabilityReceipt) => Promise<PoolContextCheck>;
  /** Test seam; production always uses the shared continuation translator. */
  translate?: typeof preparePoolHistory;
}): Promise<CodexPoolRoute[]> {
  const routes: CodexPoolRoute[] = [];
  const compaction = isPoolCompactionRequest(options.body);
  for (const member of options.pool.members) {
    options.signal.throwIfAborted();
    const skip = (reason: string) => options.onSkip?.(member, reason);
    const provider = options.providers.find(item => item.id === member.providerId);
    const model = provider?.models.find(item => item.id === member.modelId);
    if (!provider || !model || !model.npm || model.modelFormat === 'cloud-code') { skip('not available in the registry'); continue; }
    const revision = poolEndpointRevision({ providerId: provider.id, authRef: provider.authRef,
      npm: model.npm, baseURL: model.apiBaseUrl, upstreamModelId: model.upstreamModelId, headers: provider.headers });
    const receipt = currentPoolReceipt(options.receipts, member, revision, Date.now());
    if (!receipt) { skip('no fresh verification (run Test)'); continue; }
    const freeStatus = poolFreeStatus({ model, providerId: provider.id });
    if (freeStatus !== 'verified_free') { skip('not verified free'); continue; }
    if (!receipt.billingSafe || !receipt.targets.includes('codex')) { skip('not verified for Codex'); continue; }
    const npm = model.npm;
    const identity = { account: provider.id, endpointRevision: revision, model: model.id };
    routes.push(lazyPoolRoute<{ identity: typeof identity; toolContext?: CodexPoolRoute['toolContext'] }>({
      member, revision, freeStatus, catalogVerified: true, accessVerified: true,
      billingSafe: receipt.billingSafe, targets: receipt.targets, toolsVerified: receipt.tools,
      defaultEffortVerified: true, effortLevels: receipt.effortLevels,
      contextFits: true, contextVerified: true,
    }, async () => {
      const gone = (reason: string) => { skip(reason); return { skip: reason }; };
      try {
        const requested = (options.body.reasoning as { effort?: string } | undefined)?.effort ?? options.pool.effort;
        const auto = requested === 'auto';
        // An effort level this member has not verified is not sent (never claimed); the member runs on the
        // provider's default instead of being dropped. Codex always sends one (its footer shows e.g. "high"),
        // and dropping unverified members emptied the whole pool.
        const memberEffort = poolMemberEffort(auto ? 'auto' : requested, receipt);
        const memberAuto = memberEffort === null;
        const body = omitPoolEffort(options.body, memberEffort);
        const translate = options.translate ?? preparePoolHistory;
        const params = translate(body, options.source, identity, npm, {
          ...model, providerId: provider.id, apiBaseUrl: model.apiBaseUrl,
        }, { maxTools: POOL_MAX_TOOLS, npm: npm, forwardToolChoice: true }, poolHistoryOrigins(options.body));
        // Omission is only verified when translation claimed no level of its own.
        if (memberAuto && translatedEffortClaim(params.providerOptions)) { return gone('translation would set an effort'); }
        // Remote compaction: Codex needs one summary item back, so the member gets no tools and a summary instruction.
        if (compaction) Object.assign(params, appendCompactionInstruction(params), { toolChoice: undefined });
        const outputCap = poolOutputCap(provider.id, model.id, receipt.contextWindow);
        const askedOutput = typeof body.max_output_tokens === 'number' ? body.max_output_tokens : outputCap;
        if (!Number.isSafeInteger(askedOutput) || askedOutput <= 0) { return gone('invalid output limit'); }
        // Clamp to the model's own limit rather than dropping the member or using the receipt's chat-sized value.
        params.maxOutputTokens = Math.min(askedOutput, outputCap, compaction ? POOL_COMPACTION_MAX_OUTPUT_TOKENS : Infinity);
        const context = await (options.checkContext ?? defaultContextCheck)(params, receipt);
        if (!context.verified || !context.fits) { return gone(context.verified ? 'request too large for its context window' : 'context window not verified'); }
        const scopes = [poolEndpointScope(provider.id, revision, model.id)];
        const accountScopes = [poolAccountScope(provider.id)];
        const off = await options.health.disabledFor(scopes);
        if (off) { return gone('DISABLED: ' + off.note + ' (run Test to re-enable)'); }
        const unavailableUntil = await options.health.cooldownFor({ id: revision, scopes: [...scopes, ...accountScopes] });
        if (unavailableUntil !== undefined && unavailableUntil > Date.now()) { return gone('cooling down after a failure'); }
        const apiKey = await resolveLocalProviderApiKey(provider);
        if (apiKey === null || apiKey === undefined) { return gone('no credential'); }
        const languageModel = await createLanguageModel({
          npm: npm, modelId: model.upstreamModelId, apiKey,
          baseURL: model.apiBaseUrl, providerId: provider.id, authType: provider.authType,
          oauthAccountId: provider.oauthAccountId, providerData: provider.providerData,
          headers: poolProviderHeaders(provider, model, options.sessionId), sessionId: options.sessionId,
          refreshToken: providerRefreshToken(provider.id, provider.authType, provider.authRef),
        });
        const { toolContext: _toolContext, instructions, ...sdkParams } = params;
        const dispatch = sdkPoolRoute({ member, revision, freeStatus, catalogVerified: true,
          accessVerified: true, billingSafe: receipt.billingSafe, targets: receipt.targets,
          toolsVerified: receipt.tools,
          // Auto is constructively verified: Relay omits the field and any translator
          // claim is refused above, so no named default rung is required.
          defaultEffortVerified: true,
          effortLevels: receipt.effortLevels, contextFits: true, contextVerified: true,
        }, languageModel, { ...sdkParams, system: instructions, maxOutputTokens: params.maxOutputTokens! }, { store: options.health, scopes, accountScopes });
        return { route: dispatch, attach: { toolContext: params.toolContext } };
      } catch (error) {
        if (options.signal.aborted) throw options.signal.reason ?? error;
        return gone('could not be prepared: ' + (error instanceof Error ? error.message : String(error)));
      }
    }, { identity }));
  }
  return routes;
}

export async function defaultContextCheck(
  params: CodexSdkCallParams,
  receipt: PoolCapabilityReceipt,
): Promise<PoolContextCheck> {
  const { fits } = poolRequestFitsWindow({
    messages: params.messages,
    instructions: params.instructions,
    tools: params.tools,
  }, receipt.contextWindow, params.maxOutputTokens ?? receipt.maxOutputTokens);
  return { verified: receipt.contextSource === 'provider' || receipt.contextSource === 'observed' || receipt.contextSource === 'attested', fits };
}
