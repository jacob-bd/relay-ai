import type { LanguageModel } from 'ai';
import { classifyFreeStatus } from '../free-models.js';
import type { FavoriteModel, LocalProvider, PoolCapabilityReceipt } from '../types.js';
import { poolEndpointRevision } from './capabilities.js';
import { probePoolModel, type PoolProbeResult } from './probe.js';

export const RECEIPT_TTL_MS = 24 * 60 * 60 * 1000;
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
  | { member: FavoriteModel; status: 'skipped'; reason: string };

/**
 * One opt-in enrollment call per member: text plus a synthetic tool call, never a
 * tool loop. Only observed evidence is recorded. Effort levels stay empty, so
 * Auto's omission contract is the only reasoning behavior admitted until a real
 * effort probe is added.
 */
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
  if (!Number.isSafeInteger(model.contextWindow) || !model.contextWindow || model.contextWindow <= 0) {
    return { member, status: 'skipped', reason: 'unverified-context-window' };
  }
  const freeStatus = classifyFreeStatus({ model, providerId: provider.id });
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
  const targets: ('codex' | 'claude' | 'antigravity')[] = ['codex', 'claude'];
  const effortLevels: string[] = [];
  if (deps.probeEffort && model.reasoning) {
    const declared = (model.reasoningEffortLevels ?? []).filter(level =>
      ['low', 'medium', 'high', 'xhigh', 'max'].includes(level));
    const candidates = [...new Set(declared.length > 0 ? declared : ['high'])].slice(0, 4);
    for (const level of candidates) {
      if (await deps.probeEffort(languageModel, level, signal)) effortLevels.push(level);
    }
    if (effortLevels.length > 0) targets.push('antigravity');
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
      expiresAt: now + RECEIPT_TTL_MS,
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
