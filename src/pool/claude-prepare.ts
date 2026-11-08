import { createLanguageModel } from '../provider-factory.js';
import { resolveLocalProviderApiKey } from '../provider-catalog.js';
import { providerRefreshToken } from '../provider-runtime.js';
import { poolFreeStatus } from '../free-models.js';
import type { FreePoolPreferences, LocalProvider } from '../types.js';
import { translateRequest, type AnthropicRequest, type SdkCallParams } from '../sdk-adapter.js';
import { currentPoolReceipt, poolEndpointRevision, type PoolCapabilityReceipt } from './capabilities.js';
import { lazyPoolRoute } from './lazy-route.js';
import { sdkPoolRoute } from './sdk-route.js';
import type { DispatchRoute } from './dispatch.js';
import type { PoolHealthStore } from './health.js';
import { poolAccountScope, poolEndpointScope } from './health.js';
import { poolRequestFitsWindow } from './context.js';
import { POOL_MAX_TOOLS, translatedEffortClaim } from './codex-prepare.js';
import { poolMemberEffort } from './effort.js';
import { poolOutputCap } from './output-limit.js';
import { claudePoolSignatures } from './claude-signatures.js';
import { poolRouteKey } from './continuation.js';
import { splitToolUseId } from '../proxy-shared.js';
import { poolProviderHeaders } from './session-id.js';

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
  /** Called once per member left out, with a short fixed reason (no prompts, no keys). */
  onSkip?: (member: { providerId: string; modelId: string }, reason: string) => void;
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
    const skip = (reason: string) => options.onSkip?.(member, reason);
    const provider = options.providers.find(item => item.id === member.providerId);
    const model = provider?.models.find(item => item.id === member.modelId);
    if (!provider || !model || !model.npm || model.modelFormat === 'cloud-code') { skip('not available in the registry'); continue; }
    const revision = poolEndpointRevision({
      providerId: provider.id, authRef: provider.authRef, npm: model.npm,
      baseURL: model.apiBaseUrl, upstreamModelId: model.upstreamModelId, headers: provider.headers,
    });
    const receipt = currentPoolReceipt(options.receipts, member, revision, Date.now());
    if (!receipt || !receipt.billingSafe || !receipt.targets.includes('claude')) { skip('no fresh verification for Claude (run Test)'); continue; }
    const freeStatus = poolFreeStatus({ model, providerId: provider.id });
    if (freeStatus !== 'verified_free') { skip('not verified free'); continue; }
    const npm = model.npm;
    routes.push(lazyPoolRoute({
      member, revision, freeStatus, catalogVerified: true, accessVerified: true,
      billingSafe: true, targets: receipt.targets, toolsVerified: receipt.tools,
      defaultEffortVerified: true, effortLevels: receipt.effortLevels,
      contextFits: true, contextVerified: true,
    }, async () => {
      const gone = (reason: string) => { skip(reason); return { skip: reason }; };
      try {
        // An effort level this member has not verified is not sent (never claimed); the member runs on the
        // provider's default instead of being dropped. Claude Code always sends an effort (e.g. medium), and
        // dropping unverified members emptied the whole pool.
        const memberEffort = poolMemberEffort(auto ? 'auto' : requested, receipt);
        const memberAuto = memberEffort === null;
        const body = omitClaudeEffort(options.body, memberEffort);
        const params: SdkCallParams = translateRequest(body as unknown as AnthropicRequest, npm, {
          maxTools: POOL_MAX_TOOLS,
          reasoningMetadata: {
            ...model, providerId: provider.id, apiBaseUrl: model.apiBaseUrl,
          },
        });
        const routeKey = poolRouteKey({ account: provider.id, endpointRevision: revision, model: model.id });
        const thinking = (Array.isArray(body.messages) ? body.messages : []).flatMap(message => {
          const content = (message as { content?: unknown }).content;
          return Array.isArray(content) ? content as Array<{ thinking?: string; signature?: string }> : [];
        });
        params.messages = params.messages.map(message => ({ ...message,
          content: Array.isArray(message.content) ? message.content.map(part => {
            if (part.type !== 'reasoning' && part.type !== 'tool-call') return part;
            const { providerOptions: _routeState, ...clean } = part;
            if (part.type === 'tool-call') {
              const signature = claudePoolSignatures.signature(splitToolUseId(part.toolCallId).rawId, routeKey);
              return signature && npm === '@ai-sdk/google'
                ? { ...clean, providerOptions: { google: { thoughtSignature: signature } } } : clean;
            }
            const native = thinking.find(block => block.thinking === part.text
              && typeof block.signature === 'string' && claudePoolSignatures.ownsThinking(block.signature, routeKey));
            if (!native?.signature) return clean;
            if (npm === '@ai-sdk/anthropic') return { ...clean, providerOptions: { anthropic: { signature: native.signature } } };
            return part;
          }) : message.content,
        })) as typeof params.messages;
        if (memberAuto && translatedEffortClaim(params.providerOptions)) { return gone('translation would set an effort'); }
        // Coding turns need long outputs. Clamp to the model's own limit (never drop the member, never
        // use the receipt's chat-sized reservation).
        const outputCap = poolOutputCap(provider.id, model.id, receipt.contextWindow);
        const askedOutput = typeof body.max_tokens === 'number' ? body.max_tokens : outputCap;
        if (!Number.isSafeInteger(askedOutput) || askedOutput <= 0) { return gone('invalid output limit'); }
        const requestedOutput = Math.min(askedOutput, outputCap);
        params.maxOutputTokens = requestedOutput;
        const fits = poolRequestFitsWindow({
          messages: params.messages, instructions: params.instructions, tools: params.tools,
        }, receipt.contextWindow, requestedOutput).fits;
        if (!fits) { return gone('request too large for its context window'); }
        const scopes = [poolEndpointScope(provider.id, revision, model.id)];
        // A rate limit cools the whole provider account (free-tier limits are per account), so sibling models wait too.
        const accountScopes = [poolAccountScope(provider.id)];
        const off = await options.health.disabledFor(scopes);
        if (off) { return gone('DISABLED: ' + off.note + ' (run Test to re-enable)'); }
        const until = await options.health.cooldownFor({ id: revision, scopes: [...scopes, ...accountScopes] });
        if (until !== undefined && until > Date.now()) { return gone('cooling down after a failure'); }
        const apiKey = await resolveLocalProviderApiKey(provider);
        if (!apiKey) { return gone('no credential'); }
        const languageModel = await createLanguageModel({
          npm: npm, modelId: model.upstreamModelId, apiKey,
          baseURL: model.apiBaseUrl, providerId: provider.id, authType: provider.authType,
          oauthAccountId: provider.oauthAccountId, providerData: provider.providerData,
          headers: poolProviderHeaders(provider, model, options.sessionId), sessionId: options.sessionId,
          refreshToken: providerRefreshToken(provider.id, provider.authType, provider.authRef),
        });
        return { route: sdkPoolRoute({
          member, revision, freeStatus, catalogVerified: true, accessVerified: true,
          billingSafe: true, targets: receipt.targets, toolsVerified: receipt.tools,
          defaultEffortVerified: true, effortLevels: receipt.effortLevels,
          contextFits: true, contextVerified: true,
        }, languageModel, {
          messages: params.messages, tools: params.tools, system: params.instructions,
          maxOutputTokens: requestedOutput, temperature: params.temperature,
          toolChoice: params.toolChoice,
          providerOptions: params.providerOptions, headers: params.headers,
        }, { store: options.health, scopes, accountScopes }) };
      } catch (error) {
        if (options.signal.aborted) throw options.signal.reason ?? error;
        return gone('could not be prepared: ' + (error instanceof Error ? error.message : String(error)));
      }
    }));
  }
  return routes;
}
