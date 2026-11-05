// Antigravity adapter for the shared pool coordinator. The gateway owns Cloud Code formatting; this file
// owns eligibility, health and the SDK call, so the pool behaves like the Codex and Claude pools:
// bounded attempts, first-content/idle/total timeouts, finish validation, cooldowns, cancellation.
import type { LanguageModel, ToolSet } from 'ai';
import type { AntigravityRoute } from '../antigravity/types.js';
import type { FreePoolPreferences } from '../types.js';
import { currentPoolReceipt } from './capabilities.js';
import { poolRequestFitsWindow } from './context.js';
import type { DispatchRoute } from './dispatch.js';
import { poolAccountScope, poolEndpointScope, type PoolHealthStore } from './health.js';
import { poolOutputCap } from './output-limit.js';
import { sdkPoolRoute, type PoolSdkRequest } from './sdk-route.js';

/** What the gateway built for one member: the translated request and its language model. */
export interface PreparedAntigravityMember {
  model: LanguageModel;
  messages: PoolSdkRequest['messages'];
  tools?: ToolSet;
  system?: string;
  toolChoice?: PoolSdkRequest['toolChoice'];
  temperature?: number;
  providerOptions?: PoolSdkRequest['providerOptions'];
  headers?: Record<string, string>;
  /** The client's own output limit, when it sent one. */
  maxOutputTokens?: number;
}

export function antigravityPoolPreferences(members: readonly AntigravityRoute[], effort: string | undefined): FreePoolPreferences {
  return {
    enabled: true,
    members: members.map(member => ({ providerId: member.providerId, modelId: member.modelId })),
    effort: (effort === 'low' || effort === 'medium' || effort === 'high' ? effort : 'auto'),
    receipts: [],
  };
}

/**
 * One DispatchRoute per member that is still eligible right now. Receipts are rechecked for freshness on
 * every request (a launch can outlive them); a member that cannot be prepared is skipped, never fatal.
 */
export async function prepareAntigravityPoolRoutes(options: {
  members: readonly AntigravityRoute[];
  health: PoolHealthStore;
  build(member: AntigravityRoute): Promise<PreparedAntigravityMember>;
  onSkip?(member: AntigravityRoute, reason: string): void;
  now?: number;
}): Promise<{ routes: DispatchRoute[]; prepared: Map<AntigravityRoute, PreparedAntigravityMember> }> {
  const routes: DispatchRoute[] = [];
  const prepared = new Map<AntigravityRoute, PreparedAntigravityMember>();
  const now = options.now ?? Date.now();
  for (const member of options.members) {
    const skip = (reason: string) => options.onSkip?.(member, reason);
    const evidence = member.poolEvidence;
    if (!evidence) { skip('no verification attached'); continue; }
    const identity = { providerId: member.providerId, modelId: member.modelId };
    const receipt = currentPoolReceipt([evidence.receipt], identity, evidence.revision, now);
    if (!receipt || !receipt.billingSafe || !receipt.targets.includes('antigravity')) { skip('no verification for Antigravity (run Test)'); continue; }
    const scopes = [poolEndpointScope(member.providerId, evidence.revision, member.modelId)];
    const accountScopes = [poolAccountScope(member.providerId)];
    const off = await options.health.disabledFor(scopes);
    if (off) { skip('DISABLED: ' + off.note + ' (run Test to re-enable)'); continue; }
    const until = await options.health.cooldownFor({ id: evidence.revision, scopes: [...scopes, ...accountScopes] });
    if (until !== undefined && until > now) { skip('cooling down after a failure'); continue; }
    let built: PreparedAntigravityMember;
    try { built = await options.build(member); } catch (error) {
      skip('could not be prepared: ' + (error instanceof Error ? error.message : String(error)));
      continue;
    }
    const outputCap = poolOutputCap(member.providerId, member.modelId, receipt.contextWindow);
    const asked = built.maxOutputTokens ?? outputCap;
    if (!Number.isSafeInteger(asked) || asked <= 0) { skip('invalid output limit'); continue; }
    const requestedOutput = Math.min(asked, outputCap);
    if (!poolRequestFitsWindow({ messages: built.messages, instructions: built.system, tools: built.tools },
      receipt.contextWindow, requestedOutput).fits) { skip('request too large for its context window'); continue; }
    prepared.set(member, built);
    routes.push(sdkPoolRoute({
      member: identity, revision: evidence.revision,
      // The launch only builds pool rows from members it verified free.
      freeStatus: 'verified_free',
      catalogVerified: true, accessVerified: true, billingSafe: true, targets: receipt.targets,
      toolsVerified: receipt.tools, defaultEffortVerified: true, effortLevels: receipt.effortLevels,
      contextFits: true, contextVerified: true,
    }, built.model, {
      messages: built.messages, tools: built.tools, system: built.system, toolChoice: built.toolChoice,
      maxOutputTokens: requestedOutput, temperature: built.temperature,
      providerOptions: built.providerOptions, headers: built.headers,
    }, { store: options.health, scopes, accountScopes }));
  }
  return { routes, prepared };
}
