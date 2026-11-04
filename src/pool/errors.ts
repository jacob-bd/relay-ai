export type PoolFailureKind = 'rate-limit' | 'access' | 'context' | 'invalid' | 'transient' | 'canceled' | 'unknown';
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
  if ([401, 403, 404].includes(status ?? 0)) return { kind: 'access', status };
  if (status === 400 && /context.{0,20}(length|window|exceed)|prompt.{0,20}too long/i.test(value?.message ?? '')) return { kind: 'context', status };
  if (status === 400 || status === 422) return { kind: 'invalid', status };
  if ((status !== undefined && status >= 500) || /ECONNRESET|ETIMEDOUT|ENOTFOUND|first-content-timeout|missing-valid-finish|invalid-finish|stream-error|Pool route entered cooldown/.test(value?.message ?? '')) return { kind: 'transient', status };
  return { kind: 'unknown', status };
}
export function retryPoolFailure(error: unknown): boolean {
  return ['rate-limit', 'access', 'context', 'transient'].includes(poolFailure(error).kind);
}
