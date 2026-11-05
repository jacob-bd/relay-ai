export type PoolFailureKind = 'rate-limit' | 'quota' | 'access' | 'context' | 'invalid' | 'transient' | 'canceled' | 'unknown';
export interface PoolFailure { kind: PoolFailureKind; status?: number; retryAt?: number; }
export function poolFailure(error: unknown, now = Date.now()): PoolFailure {
  const value = error as { name?: string; code?: string; statusCode?: number; responseHeaders?: Record<string, string>; message?: string } | null;
  if (value?.name === 'AbortError' || value?.code === 'ABORT_ERR') return { kind: 'canceled' };
  const status = value?.statusCode;
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
