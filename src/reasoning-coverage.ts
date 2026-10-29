// src/reasoning-coverage.ts — resolution coverage report for effort controls.
//
// Walks every models.dev bucket Relay supports and reports, for each model that
// declares reasoning-effort levels, what the capability pipeline actually
// advertises. Consumed by tests/reasoning-coverage.test.ts as the alarm that
// replaces per-model whack-a-mole: a newly shipped model whose declared levels
// Relay cannot offer fails the check with its own row, instead of surfacing in
// the field as a missing slider.

import { isProviderKind, providerKind } from './registry/provider-kind.js';
import {
  getReasoningCapabilities,
  type ReasoningMode,
  type ReasoningSource,
} from './provider-factory.js';
import {
  EFFORT_RANK,
  extractReasoningEffortLevels,
  loadModelsDevCache,
  REGISTRY_TO_MODELS_DEV,
  resolveModelReasoningMetadata,
  stripModelsDevCacheMeta,
  type ModelsDevCacheFile,
} from './registry/models-dev.js';

/**
 * The npm package each registry provider actually serves its models with.
 * Mirrors the provider templates — this is the class of route the coverage
 * check evaluates, so it must stay aligned with src/provider-templates.ts.
 */
const COVERAGE_NPM: Record<string, string> = {
  zen: '@ai-sdk/openai-compatible',
  go: '@ai-sdk/openai-compatible',
  google: '@ai-sdk/google',
  openai: '@ai-sdk/openai',
  'openai-oauth': '@ai-sdk/openai',
  groq: '@ai-sdk/groq',
  mistral: '@ai-sdk/mistral',
  togetherai: '@ai-sdk/togetherai',
  cerebras: '@ai-sdk/cerebras',
  deepinfra: '@ai-sdk/deepinfra',
  xai: '@ai-sdk/xai',
  'xai-oauth': '@ai-sdk/xai',
  perplexity: '@ai-sdk/perplexity',
  cohere: '@ai-sdk/cohere',
  alibaba: '@ai-sdk/alibaba',
  'qwen-cloud-token-plan': '@ai-sdk/alibaba',
  'qwen-cloud-payg': '@ai-sdk/alibaba',
  openrouter: '@openrouter/ai-sdk-provider',
  anthropic: '@ai-sdk/anthropic',
  nvidia: '@ai-sdk/openai-compatible',
  venice: '@ai-sdk/openai-compatible',
  'claude-code': '@ai-sdk/anthropic',
  moonshot: '@ai-sdk/openai-compatible',
  'moonshot-global': '@ai-sdk/openai-compatible',
  'kimi-code': '@ai-sdk/openai-compatible',
  zhipu: '@ai-sdk/openai-compatible',
  'cline-pass': '@ai-sdk/openai-compatible',
  kilo: '@ai-sdk/openai-compatible',
  cloudflare: '@ai-sdk/openai-compatible',
  'github-copilot': '@ai-sdk/openai-compatible',
};

/** Zen/Go serve Claude through the Anthropic package, everything else generically. */
function npmForModel(providerId: string, modelId: string): string {
  if ((isProviderKind(providerId, 'zen') || isProviderKind(providerId, 'go')) && modelId.toLowerCase().startsWith('claude-')) {
    return '@ai-sdk/anthropic';
  }
  return COVERAGE_NPM[providerKind(providerId)] ?? '@ai-sdk/openai-compatible';
}

export interface ReasoningCoverageRow {
  providerId: string;
  bucket: string;
  npm: string;
  modelId: string;
  /** Declared values in rank vocabulary, in canonical order. */
  declared: string[];
  /** Relay's resolved ladder for the route (post mapper filter). */
  levels: string[];
  mode: ReasoningMode;
  source: ReasoningSource;
}

/**
 * Every supported provider × model row that declares effort values. Rows whose
 * declaration is only outside the known vocabulary (e.g. Groq's `default`) are
 * skipped — there is nothing to offer. Declared levels come from the provider's
 * own bucket when present (the same resolution the runtime uses).
 */
export function scanReasoningCoverage(
  cache: ModelsDevCacheFile = loadModelsDevCache(),
): ReasoningCoverageRow[] {
  const providers = stripModelsDevCacheMeta(cache);
  const rows: ReasoningCoverageRow[] = [];

  for (const providerId of Object.keys(REGISTRY_TO_MODELS_DEV)) {
    const bucketKey = REGISTRY_TO_MODELS_DEV[providerId]!;
    const bucket = providers[bucketKey];
    if (!bucket?.models) continue;

    for (const [modelId, entry] of Object.entries(bucket.models)) {
      const declaredRaw = extractReasoningEffortLevels(entry);
      if (!declaredRaw) continue;
      const declared = EFFORT_RANK.filter(rank => declaredRaw.map(v => v.trim().toLowerCase()).includes(rank));
      if (declared.length === 0) continue;

      const npm = npmForModel(providerId, modelId);
      const metadata = {
        ...resolveModelReasoningMetadata(providerId, modelId, {}, cache),
        // OpenRouter advertises which capabilities a model takes on its own
        // /models payload; the registry cache carries it as supportedParameters.
        // The bucket rows that declare effort are exactly the reasoning-capable
        // ones, so the check states that explicitly instead of relying on a
        // live refresh it cannot perform.
        ...(npm === '@openrouter/ai-sdk-provider' ? { supportedParameters: ['reasoning'] } : {}),
      };
      const caps = getReasoningCapabilities(npm, modelId, metadata);
      rows.push({
        providerId,
        bucket: bucketKey,
        npm,
        modelId,
        declared,
        levels: caps.levels,
        mode: caps.mode,
        source: caps.source,
      });
    }
  }

  return rows;
}
