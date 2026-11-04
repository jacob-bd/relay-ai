import { createLanguageModel } from '../provider-factory.js';
import { poolRequestFitsWindow } from './context.js';
import { resolveLocalProviderApiKey } from '../provider-catalog.js';
import { providerRefreshToken } from '../provider-runtime.js';
import { poolFreeStatus } from '../free-models.js';
import type { FreePoolPreferences, LocalProvider } from '../types.js';
import type { CodexSdkCallParams } from '../codex-responses-adapter.js';
import { preparePoolHistory } from './continuation.js';
import { currentPoolReceipt, poolEndpointRevision, type PoolCapabilityReceipt } from './capabilities.js';
import { sdkPoolRoute } from './sdk-route.js';
import { poolOutputCap } from './output-limit.js';
import { poolSessionId } from './session-id.js';
import type { CodexPoolRoute } from './codex-runtime.js';
import { PoolHealthStore, poolEndpointScope } from './health.js';

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
  checkContext?: (params: CodexSdkCallParams, receipt: PoolCapabilityReceipt) => Promise<PoolContextCheck>;
  /** Test seam; production always uses the shared continuation translator. */
  translate?: typeof preparePoolHistory;
}): Promise<CodexPoolRoute[]> {
  const routes: CodexPoolRoute[] = [];
  for (const member of options.pool.members) {
    options.signal.throwIfAborted();
    const provider = options.providers.find(item => item.id === member.providerId);
    const model = provider?.models.find(item => item.id === member.modelId);
    if (!provider || !model || !model.npm || model.modelFormat === 'cloud-code') continue;
    const revision = poolEndpointRevision({ providerId: provider.id, authRef: provider.authRef,
      npm: model.npm, baseURL: model.apiBaseUrl, upstreamModelId: model.upstreamModelId, headers: provider.headers });
    const receipt = currentPoolReceipt(options.receipts, member, revision, Date.now());
    if (!receipt) continue;
    const freeStatus = poolFreeStatus({ model, providerId: provider.id });
    if (freeStatus !== 'verified_free') continue;
    if (!receipt.billingSafe || !receipt.targets.includes('codex')) continue;
    const identity = { account: provider.id, endpointRevision: revision, model: model.id };
    const requested = (options.body.reasoning as { effort?: string } | undefined)?.effort ?? options.pool.effort;
    const auto = requested === 'auto';
    // An explicit level is used only when the receipt verified that exact rung.
    if (!auto && !receipt.effortLevels.includes(requested)) continue;
    const body = omitPoolEffort(options.body, auto ? null : requested);
    const translate = options.translate ?? preparePoolHistory;
    const params = translate(body, options.source, identity, model.npm, {
      ...model, providerId: provider.id, apiBaseUrl: model.apiBaseUrl,
    });
    // Omission is only verified when translation claimed no level of its own.
    if (auto && translatedEffortClaim(params.providerOptions)) continue;
    const outputCap = poolOutputCap(provider.id, model.id, receipt.contextWindow);
    const askedOutput = typeof body.max_output_tokens === 'number' ? body.max_output_tokens : outputCap;
    if (!Number.isSafeInteger(askedOutput) || askedOutput <= 0) continue;
    // Clamp to the model's own limit rather than dropping the member or using the receipt's chat-sized value.
    params.maxOutputTokens = Math.min(askedOutput, outputCap);
    const context = await (options.checkContext ?? defaultContextCheck)(params, receipt);
    if (!context.verified || !context.fits) continue;
    const scopes = [poolEndpointScope(provider.id, revision, model.id)];
    const unavailableUntil = await options.health.cooldownFor({ id: revision, scopes });
    if (unavailableUntil !== undefined && unavailableUntil > Date.now()) continue;
    const apiKey = await resolveLocalProviderApiKey(provider);
    if (apiKey === null || apiKey === undefined) continue;
    const languageModel = await createLanguageModel({
      npm: model.npm, modelId: model.upstreamModelId, apiKey,
      baseURL: model.apiBaseUrl, providerId: provider.id, authType: provider.authType,
      oauthAccountId: provider.oauthAccountId, providerData: provider.providerData,
      headers: provider.headers, sessionId: poolSessionId(provider.id, options.sessionId),
      refreshToken: providerRefreshToken(provider.id, provider.authType, provider.authRef),
    });
    const { toolContext: _toolContext, instructions, ...sdkParams } = params;
    const dispatch = sdkPoolRoute({ member, revision, freeStatus, catalogVerified: true,
      accessVerified: true, billingSafe: receipt.billingSafe, targets: receipt.targets,
      toolsVerified: receipt.tools,
      // Auto is constructively verified: Relay omits the field and any translator
      // claim is refused above, so no named default rung is required.
      defaultEffortVerified: true,
      effortLevels: receipt.effortLevels, contextFits: context.fits, contextVerified: context.verified,
    }, languageModel, { ...sdkParams, system: instructions, maxOutputTokens: params.maxOutputTokens! }, { store: options.health, scopes });
    routes.push({ ...dispatch, identity, toolContext: params.toolContext });
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
