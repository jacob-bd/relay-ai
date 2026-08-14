// src/core/reasoning.ts — translate a provider-neutral reasoning level into the
// resolved route's own AI SDK request options.
//
// This is the whole point of the contract: a consumer says `'xhigh'`, and Relay
// Core decides whether that means `openai.reasoningEffort`, a Gemini
// `thinkingConfig`, an Anthropic `thinking` block, and so on. Consumers must
// never have to write provider-specific `providerOptions` themselves.

import type { LanguageModel } from 'ai';
import {
  deepMergeProviderOptions,
  effortProviderOptions,
  getReasoningCapabilities,
  type ReasoningMetadata,
} from '../provider-factory.js';
import type { CachedModel, RegistryProvider } from '../registry/types.js';
import { RelayCoreError } from './errors.js';
import type { RelayReasoningLevel, RelayRouteId } from './types.js';

/** Runtime mirror of `RelayReasoningLevel` — the whole catalog vocabulary. */
export const RELAY_REASONING_LEVELS: readonly RelayReasoningLevel[] = [
  'off', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max',
];

export type RelayProviderOptions = Record<string, Record<string, unknown>>;

export function isRelayReasoningLevel(value: unknown): value is RelayReasoningLevel {
  return typeof value === 'string' && (RELAY_REASONING_LEVELS as readonly string[]).includes(value);
}

/**
 * The SDK package that actually serves this route. Cloud Code Assist models are
 * served by a specialized native Google transport rather than the generic
 * factory, so their reasoning options are Gemini-shaped even though the
 * registry entry carries no npm package of its own.
 */
export function reasoningNpmForRoute(provider: RegistryProvider, model: CachedModel): string {
  if (model.modelFormat === 'cloud-code') return '@ai-sdk/google';
  return model.npm ?? provider.api.npm ?? '';
}

/**
 * Resolve a reasoning level into route-specific AI SDK `providerOptions`.
 *
 * Throws `UNSUPPORTED_REASONING_LEVEL` when the level is not a known level, or
 * when this route has no way to express it — never returns a silently weaker
 * setting than the caller asked for.
 */
export function resolveReasoningProviderOptions(
  level: RelayReasoningLevel,
  provider: RegistryProvider,
  model: CachedModel,
  routeId: RelayRouteId,
): RelayProviderOptions {
  if (!isRelayReasoningLevel(level)) {
    throw new RelayCoreError(
      'UNSUPPORTED_REASONING_LEVEL',
      `Unknown reasoning level "${String(level)}" — expected one of: ${RELAY_REASONING_LEVELS.join(', ')}.`,
      { providerId: provider.id, routeId },
    );
  }

  const npm = reasoningNpmForRoute(provider, model);
  const upstreamModelId = model.upstreamModelId ?? model.id;
  const metadata: ReasoningMetadata = {
    providerId: provider.id,
    upstreamModelId,
    ...(model.apiUrl ?? provider.api.url ? { apiBaseUrl: model.apiUrl ?? provider.api.url } : {}),
    ...(model.supportedParameters ? { supportedParameters: model.supportedParameters } : {}),
    ...(model.reasoning !== undefined ? { reasoning: model.reasoning } : {}),
    ...(model.interleavedReasoningField ? { interleavedReasoningField: model.interleavedReasoningField } : {}),
  };

  // `effortProviderOptions` is the CLI picker's mapper: it deliberately
  // substitutes the nearest available value (Gemini has no `xhigh`, so `xhigh`
  // would arrive as `high`). Core promises the opposite, so gate on the route's
  // own advertised vocabulary *before* mapping — anything outside it would be a
  // substitution, not a translation.
  const caps = getReasoningCapabilities(npm, upstreamModelId, metadata);
  if (caps.mode !== 'controllable' || !caps.levels.includes(level)) {
    const available = caps.levels.length > 0 ? caps.levels.join(', ') : 'none';
    throw new RelayCoreError(
      'UNSUPPORTED_REASONING_LEVEL',
      `Model "${model.id}" on provider "${provider.name}" does not support reasoning level "${level}" `
      + `— available levels: ${available}. See capabilities.reasoningLevels from listRelayModels().`,
      { providerId: provider.id, routeId },
    );
  }

  const resolved = effortProviderOptions(npm, level, upstreamModelId, metadata);
  if (!resolved) {
    throw new RelayCoreError(
      'UNSUPPORTED_REASONING_LEVEL',
      `Model "${model.id}" on provider "${provider.name}" advertises reasoning level "${level}" but `
      + `Relay has no request mapping for it — this is a relay-ai bug, please report it.`,
      { providerId: provider.id, routeId },
    );
  }
  return resolved;
}

/**
 * Wrap a model so every call carries the resolved reasoning options.
 *
 * Merged *under* whatever the caller passes per call, so an explicit
 * `providerOptions` on `streamText`/`generateText` still wins.
 */
export async function withReasoningProviderOptions(
  model: LanguageModel,
  providerOptions: RelayProviderOptions,
): Promise<LanguageModel> {
  const { wrapLanguageModel } = await import('ai');
  type WrapArgs = Parameters<typeof wrapLanguageModel>[0];
  return wrapLanguageModel({
    // `LanguageModel` also admits a bare model-id string and the legacy v2
    // interface; everything Core builds is a concrete current-spec model.
    model: model as WrapArgs['model'],
    middleware: {
      specificationVersion: 'v3',
      transformParams: async ({ params }) => ({
        ...params,
        providerOptions: deepMergeProviderOptions(
          providerOptions,
          params.providerOptions as RelayProviderOptions | undefined,
        ) as typeof params.providerOptions,
      }),
    },
  });
}
