import { createLanguageModel } from '../provider-factory.js';
import { resolveLocalProviderApiKey } from '../provider-catalog.js';
import { providerRefreshToken } from '../provider-runtime.js';
import { classifyFreeStatus } from '../free-models.js';
import type { FreePoolPreferences, LocalProvider } from '../types.js';
import { translateRequest, type AnthropicRequest, type SdkCallParams } from '../sdk-adapter.js';
import { currentPoolReceipt, poolEndpointRevision, type PoolCapabilityReceipt } from './capabilities.js';
import { sdkPoolRoute } from './sdk-route.js';
import type { DispatchRoute } from './dispatch.js';
import type { PoolHealthStore } from './health.js';
import { poolEndpointScope } from './health.js';
import { poolRequestFitsWindow } from './context.js';
import { translatedEffortClaim } from './codex-prepare.js';

export function omitClaudeEffort(
  body: Record<string, unknown>, level: string | null,
): Record<string, unknown> {
  const output = { ...(body.output_config as Record<string, unknown> | undefined) };
  delete output.effort;
  if (level !== null) output.effort = level;
  const next = { ...body };
  if (Object.keys(output).length > 0) next.output_config = output;
  else delete next.output_config;
  return next;
}

export interface ClaudeRouteOptions {
  pool: FreePoolPreferences;
  providers: readonly LocalProvider[];
  receipts: readonly PoolCapabilityReceipt[];
  body: Record<string, unknown>;
  signal: AbortSignal;
  sessionId?: string;
  health: PoolHealthStore;
}

/** Per-member Anthropic request translation. Never shares a model by catalog alias. */
export async function prepareClaudePoolRoutes(options: ClaudeRouteOptions): Promise<DispatchRoute[]> {
  const routes: DispatchRoute[] = [];
  if (options.body.thinking && typeof options.body.thinking === 'object') {
    const budget = (options.body.thinking as { budget_tokens?: unknown }).budget_tokens;
    // A fixed thinking budget is an explicit client requirement we have not verified.
    if (typeof budget === 'number' && budget > 0) return routes;
  }
  const clientEffort = (options.body.output_config as { effort?: string } | undefined)?.effort;
  const requested = clientEffort ?? options.pool.effort;
  const auto = requested === 'auto';
  for (const member of options.pool.members) {
    options.signal.throwIfAborted();
    const provider = options.providers.find(item => item.id === member.providerId);
    const model = provider?.models.find(item => item.id === member.modelId);
    if (!provider || !model || !model.npm || model.modelFormat === 'cloud-code') continue;
    const revision = poolEndpointRevision({
      providerId: provider.id, authRef: provider.authRef, npm: model.npm,
      baseURL: model.apiBaseUrl, upstreamModelId: model.upstreamModelId, headers: provider.headers,
    });
    const receipt = currentPoolReceipt(options.receipts, member, revision, Date.now());
    if (!receipt || !receipt.billingSafe || !receipt.targets.includes('claude')) continue;
    const freeStatus = classifyFreeStatus({ model, providerId: provider.id });
    if (freeStatus !== 'verified_free') continue;
    if (!auto && !receipt.effortLevels.includes(requested)) continue;
    const body = omitClaudeEffort(options.body, auto ? null : requested);
    const params: SdkCallParams = translateRequest(body as unknown as AnthropicRequest, model.npm, {
      reasoningMetadata: {
        ...model, providerId: provider.id, apiBaseUrl: model.apiBaseUrl,
      },
    });
    if (auto && translatedEffortClaim(params.providerOptions)) continue;
    const requestedOutput = typeof body.max_tokens === 'number' ? body.max_tokens : receipt.maxOutputTokens;
    if (!Number.isSafeInteger(requestedOutput) || requestedOutput <= 0 || requestedOutput > receipt.maxOutputTokens) continue;
    params.maxOutputTokens = requestedOutput;
    const fits = poolRequestFitsWindow({
      messages: params.messages, instructions: params.instructions, tools: params.tools,
    }, receipt.contextWindow, requestedOutput).fits;
    if (!fits) continue;
    const scopes = [poolEndpointScope(provider.id, revision, model.id)];
    const until = await options.health.cooldownFor({ id: revision, scopes });
    if (until !== undefined && until > Date.now()) continue;
    const apiKey = await resolveLocalProviderApiKey(provider);
    if (!apiKey) continue;
    const languageModel = await createLanguageModel({
      npm: model.npm, modelId: model.upstreamModelId, apiKey,
      baseURL: model.apiBaseUrl, providerId: provider.id, authType: provider.authType,
      oauthAccountId: provider.oauthAccountId, providerData: provider.providerData,
      headers: provider.headers, sessionId: options.sessionId,
      refreshToken: providerRefreshToken(provider.id, provider.authType, provider.authRef),
    });
    routes.push(sdkPoolRoute({
      member, revision, freeStatus, catalogVerified: true, accessVerified: true,
      billingSafe: true, targets: receipt.targets, toolsVerified: receipt.tools,
      defaultEffortVerified: true, effortLevels: receipt.effortLevels,
      contextFits: true, contextVerified: true,
    }, languageModel, {
      messages: params.messages, tools: params.tools, system: params.instructions,
      maxOutputTokens: requestedOutput, temperature: params.temperature,
      providerOptions: params.providerOptions, headers: params.headers,
    }, { store: options.health, scopes }));
  }
  return routes;
}
