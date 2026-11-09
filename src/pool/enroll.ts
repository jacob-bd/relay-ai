import type { LanguageModel } from 'ai';
import { poolFreeStatus } from '../free-models.js';
import type { FavoriteModel, LocalProvider, PoolCapabilityReceipt } from '../types.js';
import { NO_RECEIPT_EXPIRY, poolEndpointRevision } from './capabilities.js';
import { type PoolProbeResult } from './probe.js';

/** Conservative reservation; a provider that accepts less fails pre-commit and falls back. */
export const ENROLL_MAX_OUTPUT_TOKENS = 4096;

export interface EnrollDeps {
  createModel(provider: LocalProvider, model: LocalProvider['models'][number], apiKey: string): Promise<LanguageModel>;
  resolveKey(provider: LocalProvider): Promise<string | null>;
  probe(model: LanguageModel, signal: AbortSignal): Promise<PoolProbeResult>;
  /** Optional: one tiny call per candidate rung. Only observed success is kept. */
  probeEffort?(model: LanguageModel, level: string, signal: AbortSignal): Promise<boolean>;
}

export type EnrollResult =
  | { member: FavoriteModel; status: 'verified'; receipt: PoolCapabilityReceipt }
  | { member: FavoriteModel; status: 'skipped'; reason: string; diagnostic?: string };

/** One explicit capability request; optional effort probes run only when supplied. */
export async function verifyPoolMember(
  member: FavoriteModel,
  providers: readonly LocalProvider[],
  signal: AbortSignal,
  deps: EnrollDeps,
  now = Date.now(),
): Promise<EnrollResult> {
  const provider = providers.find(item => item.id === member.providerId);
  const model = provider?.models.find(item => item.id === member.modelId);
  if (!provider || !model) return { member, status: 'skipped', reason: 'unavailable' };
  if (!model.npm || model.modelFormat === 'cloud-code') return { member, status: 'skipped', reason: 'unsupported-transport' };
  // A guessed size (0.19 custom endpoints estimate one) is not routing evidence.
  if (model.contextWindowEstimated
    || !Number.isSafeInteger(model.contextWindow) || !model.contextWindow || model.contextWindow <= 0) {
    return { member, status: 'skipped', reason: 'unverified-context-window' };
  }
  const freeStatus = poolFreeStatus({ model, providerId: provider.id });
  if (freeStatus !== 'verified_free' && freeStatus !== 'free_provider') {
    return { member, status: 'skipped', reason: 'not-free' };
  }
  if (freeStatus !== 'verified_free') {
    // Provider-granted free access can still incur overage without an explicit rule.
    return { member, status: 'skipped', reason: 'billing-safeguard-unverified' };
  }
  const apiKey = await deps.resolveKey(provider);
  if (!apiKey) return { member, status: 'skipped', reason: 'missing-credential' };
  const languageModel = await deps.createModel(provider, model, apiKey);
  const probe = await deps.probe(languageModel, signal);
  if (probe.text !== 'passed' || probe.tools !== 'passed') {
    return { member, status: 'skipped', reason: 'probe-' + (probe.failure ?? 'failed') };
  }
  // Antigravity always has the Auto row (no effort sent); verified effort rungs only add rows on top of it.
  const targets: ('codex' | 'claude' | 'antigravity' | 'core')[] = ['codex', 'claude', 'antigravity', 'core'];
  const effortLevels: string[] = [];
  if (deps.probeEffort && model.reasoning) {
    const declared = (model.reasoningEffortLevels ?? []).filter(level =>
      ['low', 'medium', 'high', 'xhigh', 'max'].includes(level));
    const candidates = [...new Set(declared.length > 0 ? declared : ['high'])].slice(0, 4);
    for (const level of candidates) {
      if (await deps.probeEffort(languageModel, level, signal)) effortLevels.push(level);
    }
  }
  const revision = poolEndpointRevision({
    providerId: provider.id, authRef: provider.authRef, npm: model.npm,
    baseURL: model.apiBaseUrl, upstreamModelId: model.upstreamModelId, headers: provider.headers,
  });
  return {
    member,
    status: 'verified',
    receipt: {
      member: { providerId: member.providerId, modelId: member.modelId },
      endpointRevision: revision,
      verifiedAt: now,
      expiresAt: NO_RECEIPT_EXPIRY,
      targets,
      tools: true,
      maxOutputTokens: ENROLL_MAX_OUTPUT_TOKENS,
      contextWindow: model.contextWindow,
      contextSource: 'provider',
      reasoningAccounting: 'inside-output',
      effortLevels,
      billingSafe: true,
    },
  };
}
