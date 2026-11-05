export type PoolFailureKind = 'rate-limit' | 'quota' | 'access' | 'context' | 'invalid' | 'transient' | 'canceled' | 'unknown'
  /** The model is gone, retired, or no longer free for this account: it is disabled until re-tested. */
  | 'disabled'
  /** A bare 404/410 with no explanation. Confirmed once more before it disables the model. */
  | 'missing';
export interface PoolFailure {
  kind: PoolFailureKind;
  status?: number;
  retryAt?: number;
  /** Short fixed label for a disabling failure, shown to the user. Never upstream text. */
  note?: string;
}

/**
 * Responses that mean this model will not work again until something changes. Matching is deliberately narrow:
 * a model that "does not support a parameter" or "is overloaded" is not gone, and a rejected request says nothing
 * about the model. Only statuses that can carry such a verdict are examined.
 */
const GONE_PATTERN = new RegExp([
  String.raw`model[_ -]?not[_ -]?found`,
  String.raw`model\b[^.\n]{0,60}\b(?:does not exist|doesn't exist|no longer (?:available|supported|exists?)|has been (?:deprecated|retired|removed|discontinued|decommissioned|shut down)|is (?:deprecated|decommissioned|discontinued|retired))`,
  String.raw`\b(?:deprecated|decommissioned|discontinued|retired|sunset)\b[^.\n]{0,20}\bmodel\b`,
  String.raw`\bthis model (?:was|has been|is) (?:deprecated|decommissioned|discontinued|retired|removed|shut down)`,
  String.raw`\bunknown model\b`,
].join('|'), 'i');
const PROMO_PATTERN = new RegExp([
  // The model's own free access ended. "free trial expired" is account-wide and is a quota matter, not a verdict on one model.
  String.raw`\bmodel\b[^.\n]{0,60}\b(?:free|promo(?:tion(?:al)?)?)\b[^.\n]{0,40}\b(?:ended|expired|is over|no longer)`,
  String.raw`\b(?:free|promo(?:tion(?:al)?)?)\b[^.\n]{0,40}\b(?:access|period|offer|pricing)\b[^.\n]{0,40}\b(?:ended|expired|is over)`,
  String.raw`\bpromo(?:tion(?:al)?)?\b[^.\n]{0,50}\b(?:ended|expired|is over|no longer)`,
  String.raw`\bno longer (?:free|available for free)`,
  String.raw`\bnot (?:included )?in (?:your|the) (?:current )?(?:plan|tier|subscription)`,
  String.raw`MODEL_NOT_IN_PLAN`,
].join('|'), 'i');
const VERDICT_STATUSES = new Set([400, 402, 403, 404, 410]);
export const DISABLED_GONE_NOTE = 'model no longer available';
export const DISABLED_PROMO_NOTE = 'free access ended or not included in the plan';

function disablingNote(status: number | undefined, text: string): string | undefined {
  if (status === undefined || !VERDICT_STATUSES.has(status) || !text) return undefined;
  if (PROMO_PATTERN.test(text)) return DISABLED_PROMO_NOTE;
  if (GONE_PATTERN.test(text)) return DISABLED_GONE_NOTE;
  return undefined;
}
export function poolFailure(error: unknown, now = Date.now()): PoolFailure {
  const value = error as { name?: string; code?: string; statusCode?: number; responseHeaders?: Record<string, string>; message?: string; responseBody?: unknown } | null;
  if (value?.name === 'AbortError' || value?.code === 'ABORT_ERR') return { kind: 'canceled' };
  const status = value?.statusCode;
  const text = ((value?.message ?? '') + ' ' + (typeof value?.responseBody === 'string' ? value.responseBody.slice(0, 2000) : '')).trim();
  if (status !== 429) {
    const note = disablingNote(status, text);
    if (note) return { kind: 'disabled', status, note };
  }
  if (status === 429) {
    const raw = Object.entries(value?.responseHeaders ?? {}).find(([key]) => key.toLowerCase() === 'retry-after')?.[1];
    let retryAt: number | undefined;
    if (raw?.trim()) {
      const seconds = Number(raw);
      if (Number.isFinite(seconds) && seconds >= 0) retryAt = now + Math.ceil(seconds * 1000);
      else { const parsed = Date.parse(raw); if (Number.isFinite(parsed)) retryAt = Math.max(now, parsed); }
    }
    return { kind: 'rate-limit', status, retryAt };
  }
  // 402 means the account's credit is exhausted: retrying another model on the same account cannot help.
  if (status === 402) return { kind: 'quota', status };
  if (status === 404 || status === 410) return { kind: 'missing', status };
  if ([401, 403, 404].includes(status ?? 0)) return { kind: 'access', status };
  if (status === 400 && /context.{0,20}(length|window|exceed)|prompt.{0,20}too long/i.test(value?.message ?? '')) return { kind: 'context', status };
  if (status === 400 || status === 422) return { kind: 'invalid', status };
  if ((status !== undefined && status >= 500) || /ECONNRESET|ETIMEDOUT|ENOTFOUND|first-content-timeout|idle-or-total-timeout|provisional-buffer-limit|missing-valid-finish|invalid-finish|stream-error|Pool route entered cooldown/.test(value?.message ?? '')) return { kind: 'transient', status };
  return { kind: 'unknown', status };
}
/**
 * Whether to try the next member after this failure. This only applies before any output was delivered
 * (after that the attempt loop never replays). Every kind of failure of one member says nothing about the
 * next one - a provider-specific 400, a missing header, an unknown error - so everything falls through
 * except a cancellation, which is the caller leaving. The attempt cap and total time limit still bound it.
 */
export function retryPoolFailure(error: unknown): boolean {
  return poolFailure(error).kind !== 'canceled';
}
