import type { ModelCost } from './types.js';

export type FreeStatus = 'verified_free' | 'free_provider' | 'paid' | 'unknown';

const FREE_PROVIDER_IDS = new Set(['nvidia']);

function isZeroOrMissing(value: number | undefined): boolean {
  return value === undefined || value === 0;
}

export function isZeroCost(cost: ModelCost | undefined): boolean {
  if (!cost) return false;
  return cost.input === 0
    && cost.output === 0
    && isZeroOrMissing(cost.cache_read)
    && isZeroOrMissing(cost.cache_write);
}

export function isPaidCost(cost: ModelCost | undefined): boolean {
  if (!cost) return false;
  return cost.input > 0
    || cost.output > 0
    || (cost.cache_read ?? 0) > 0
    || (cost.cache_write ?? 0) > 0;
}

export function isFreeProviderAccess(providerId?: string, templateId?: string): boolean {
  return FREE_PROVIDER_IDS.has((providerId ?? '').toLowerCase())
    || FREE_PROVIDER_IDS.has((templateId ?? '').toLowerCase());
}

export function classifyFreeStatus(opts: {
  model: { cost?: ModelCost; isFree?: boolean; freeStatus?: FreeStatus };
  providerId?: string;
  templateId?: string;
  /**
   * The provider gives free access to this model despite a published list price
   * (e.g. Cloudflare's 10,000 free Neurons/day on standard models). Only set this
   * from a provider rule — a plain `isFree` flag must never outrank real pricing.
   */
  freeAccess?: boolean;
}): FreeStatus {
  if (opts.freeAccess === true) return 'free_provider';
  if (isFreeProviderAccess(opts.providerId, opts.templateId)) return 'free_provider';
  if (isZeroCost(opts.model.cost)) return 'verified_free';
  if (isPaidCost(opts.model.cost)) return 'paid';
  if (opts.model.freeStatus) return opts.model.freeStatus;
  if (opts.model.isFree === true) return 'verified_free';
  return 'unknown';
}

export function isFreeStatus(status: FreeStatus | undefined): boolean {
  return status === 'verified_free' || status === 'free_provider';
}

export function freeStatusLabel(status: FreeStatus | undefined): string {
  if (status === 'verified_free') return 'Free';
  if (status === 'free_provider') return 'Free dev access';
  if (status === 'paid') return 'Paid';
  return 'Unknown price';
}
