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

/** Loopback or private-network host: the user's own machine or LAN. */
export function isLocalEndpointUrl(url: string | undefined): boolean {
  if (!url) return false;
  let host: string;
  try { host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, ''); } catch { return false; }
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '0.0.0.0') return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (!m) return false;
  const a = Number(m[1]), b = Number(m[2]);
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

/** Ollama serves its hosted models through the local daemon under `*:cloud` / `*-cloud` ids; those are billed. */
export function isOllamaCloudModelId(modelId: string): boolean {
  return /(^|[:-])cloud$/i.test(modelId);
}

export function isFreeProviderAccess(providerId?: string, templateId?: string): boolean {
  return FREE_PROVIDER_IDS.has((providerId ?? '').toLowerCase())
    || FREE_PROVIDER_IDS.has((templateId ?? '').toLowerCase());
}

export function classifyFreeStatus(opts: {
  model: { cost?: ModelCost; isFree?: boolean; freeStatus?: FreeStatus; userMarkedFree?: boolean; localEndpoint?: boolean };
  providerId?: string;
  templateId?: string;
  /**
   * The provider gives free access to this model despite a published list price
   * (e.g. Cloudflare's 10,000 free Neurons/day on standard models). Only set this
   * from a provider rule — a plain `isFree` flag must never outrank real pricing.
   */
  freeAccess?: boolean;
}): FreeStatus {
  // The user's own declaration (stored override, never catalog data) outranks a listed price.
  if (opts.model.userMarkedFree === true) return 'verified_free';
  // Runs on the user's own machine or network: no per-token bill (set from the endpoint URL, never catalog data).
  if (opts.model.localEndpoint === true) return 'verified_free';
  if (opts.freeAccess === true) return 'free_provider';
  if (isFreeProviderAccess(opts.providerId, opts.templateId)) return 'free_provider';
  if (isZeroCost(opts.model.cost)) return 'verified_free';
  if (isPaidCost(opts.model.cost)) return 'paid';
  if (opts.model.freeStatus) return opts.model.freeStatus;
  if (opts.model.isFree === true) return 'verified_free';
  return 'unknown';
}

/**
 * Providers whose free access has no billing path: the account has no payment method,
 * so hitting a limit only means rate-limiting (the pool rotates away), never a charge.
 * Unlike Cloudflare's free Neurons, there is no overage to guard against. Add a provider
 * here only from a verified provider rule.
 */
const NO_BILLING_FREE_PROVIDER_IDS = new Set(['nvidia']);

/**
 * Free status as the Relay Free Pool judges it: provider-granted free access counts as
 * verified only for providers with an explicit no-billing rule.
 */
export function poolFreeStatus(opts: Parameters<typeof classifyFreeStatus>[0]): FreeStatus {
  const status = classifyFreeStatus(opts);
  if (status === 'free_provider'
    && NO_BILLING_FREE_PROVIDER_IDS.has((opts.providerId ?? '').toLowerCase())
    && !isPaidCost(opts.model.cost)) return 'verified_free';
  return status;
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
