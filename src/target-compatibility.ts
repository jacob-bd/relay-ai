import { shouldHideModel, type CompatibilityAgent } from './model-compatibility.js';
import { MIN_CONTEXT_WINDOW } from './constants.js';
import { ANTIGRAVITY_MIN_CONTEXT_WINDOW } from './antigravity/catalog.js';
import type { LocalProvider, LocalProviderModel } from './types.js';

export type RelayLaunchTarget =
  | 'claude'
  | 'claude-app'
  | 'codex'
  | 'codex-app'
  | 'gemini'
  | 'server'
  | 'antigravity';

export interface TargetCompatibilityContext {
  target: RelayLaunchTarget;
  providerId: string;
  authType?: 'api' | 'oauth' | 'none';
  model: LocalProviderModel;
}

export interface TargetCompatibilityResult {
  compatible: boolean;
  reason?: string;
}

function blacklistAgentForTarget(target: RelayLaunchTarget): CompatibilityAgent {
  if (target === 'claude-app') return 'codex-app';
  return target;
}

/** Smallest context window a target can drive. The server target is a plain API gateway — callers own their prompt size, so no floor. */
export function contextFloorForTarget(target: RelayLaunchTarget): number {
  if (target === 'antigravity') return ANTIGRAVITY_MIN_CONTEXT_WINDOW;
  if (target === 'server') return 0;
  return MIN_CONTEXT_WINDOW;
}

/** Unknown context windows pass — registry metadata is often missing, not necessarily small. */
export function meetsContextFloor(target: RelayLaunchTarget, contextWindow?: number): boolean {
  return contextWindow === undefined || contextWindow >= contextFloorForTarget(target);
}

export function isTargetCompatibleModel(ctx: TargetCompatibilityContext): TargetCompatibilityResult {
  const blacklistAgent = blacklistAgentForTarget(ctx.target);
  if (shouldHideModel({ providerId: ctx.providerId, modelId: ctx.model.id, agent: blacklistAgent })) {
    return { compatible: false, reason: 'model is hidden by compatibility filters' };
  }

  if (!meetsContextFloor(ctx.target, ctx.model.contextWindow)) {
    const floor = contextFloorForTarget(ctx.target);
    return {
      compatible: false,
      reason: `${ctx.target} needs a ${Math.round(floor / 1000)}K+ context window; this model has ${Math.round(ctx.model.contextWindow! / 1000)}K`,
    };
  }

  if (ctx.model.modelFormat === 'cloud-code') {
    if (ctx.target === 'server') {
      return { compatible: false, reason: 'Cloud Code models are not supported for the server target yet' };
    }
    return { compatible: true };
  }

  if (ctx.model.modelFormat === 'anthropic') {
    return { compatible: true };
  }

  if (ctx.model.modelFormat === 'openai') {
    if (ctx.providerId === 'zen' || ctx.providerId === 'go') return { compatible: true };
    if (ctx.model.npm) return { compatible: true };
    return { compatible: false, reason: 'OpenAI-format model is missing an SDK provider package' };
  }

  return { compatible: false, reason: `Unsupported model format: ${ctx.model.modelFormat}` };
}

export function routableModelsForTarget(
  provider: LocalProvider,
  target: RelayLaunchTarget,
): LocalProviderModel[] {
  return provider.models.filter(model =>
    isTargetCompatibleModel({
      target,
      providerId: provider.id,
      authType: provider.authType,
      model,
    }).compatible,
  );
}

export function providerForTarget(provider: LocalProvider, target: RelayLaunchTarget): LocalProvider {
  return { ...provider, models: routableModelsForTarget(provider, target) };
}

export function providersForTarget(
  providers: LocalProvider[],
  target: RelayLaunchTarget,
): LocalProvider[] {
  return providers
    .map(provider => providerForTarget(provider, target))
    .filter(provider => provider.models.length > 0);
}

/** Models offered to Codex Sub-agents must be routable by both Codex targets. */
export function providersForCodexSubagents(providers: LocalProvider[]): LocalProvider[] {
  const cli = providersForTarget(providers, 'codex');
  const app = new Map(
    providersForTarget(providers, 'codex-app').map(provider => [
      provider.id,
      new Set(provider.models.map(model => model.id)),
    ]),
  );
  return cli
    .map(provider => ({
      ...provider,
      models: provider.models.filter(model => app.get(provider.id)?.has(model.id)),
    }))
    .filter(provider => provider.models.length > 0);
}
