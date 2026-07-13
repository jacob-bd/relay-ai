// Short user-facing messages from SDK/upstream failures — no stack traces in Codex TUI.

import { APICallError, RetryError } from 'ai';

interface ApiCallLike {
  message?: string;
  statusCode?: number;
  responseBody?: string;
  data?: { error?: { message?: string; type?: string } };
  lastError?: { message?: string; statusCode?: number };
  errors?: Array<{ message?: string; statusCode?: number }>;
}

export interface SdkUpstreamErrorDetails {
  statusCode?: number;
  errorContent: string;
  isRetryable: boolean;
  attemptCount: number;
}

/** Extract the real HTTP failure from an AI SDK retry wrapper without relying on instanceof. */
export function sdkUpstreamErrorDetails(err: unknown): SdkUpstreamErrorDetails | undefined {
  const retry = RetryError.isInstance(err) ? err : undefined;
  const inner = retry?.lastError ?? err;
  if (!APICallError.isInstance(inner)) return undefined;

  let errorContent = inner.responseBody;
  if (!errorContent && inner.data !== undefined) {
    try {
      errorContent = JSON.stringify(inner.data);
    } catch {
      // Fall through to the SDK's safe message.
    }
  }

  return {
    statusCode: inner.statusCode,
    errorContent: errorContent || inner.message,
    isRetryable: inner.isRetryable,
    attemptCount: retry?.errors.length ?? 1,
  };
}

export function formatUpstreamError(err: unknown): string {
  if (!err || typeof err !== 'object') return 'Upstream model request failed.';

  const rec = err as ApiCallLike;

  if (rec.data?.error?.message) {
    const short = sanitizeMessage(rec.data.error.message);
    return rec.statusCode ? `${short} (HTTP ${rec.statusCode})` : short;
  }

  if (rec.responseBody) {
    try {
      const parsed = JSON.parse(rec.responseBody) as { error?: { message?: string } };
      if (parsed.error?.message) {
        const short = sanitizeMessage(parsed.error.message);
        return rec.statusCode ? `${short} (HTTP ${rec.statusCode})` : short;
      }
    } catch { /* ignore */ }
  }

  const last = rec.lastError;
  if (last?.message) {
    const code = last.statusCode;
    const short = sanitizeMessage(last.message);
    return code ? `${short} (HTTP ${code})` : short;
  }

  const fromList = rec.errors?.[rec.errors.length - 1];
  if (fromList?.message) {
    const short = sanitizeMessage(fromList.message);
    return fromList.statusCode ? `${short} (HTTP ${fromList.statusCode})` : short;
  }

  if (rec.message) {
    const short = sanitizeMessage(rec.message);
    if (short && !short.includes('file://') && !short.includes('APICallError') && short.length < 240) {
      return rec.statusCode ? `${short} (HTTP ${rec.statusCode})` : short;
    }
  }

  return 'Upstream model request failed.';
}

/** Real upstream HTTP status from an SDK error, falling back to sniffing the formatted message. */
export function upstreamHttpStatus(err: unknown, message: string): number {
  if (err && typeof err === 'object' && 'statusCode' in err) {
    const code = (err as { statusCode?: number }).statusCode;
    if (typeof code === 'number' && code >= 400 && code <= 599) return code;
  }
  if (message.includes('HTTP 429') || message.includes('429')) return 429;
  if (message.includes('HTTP 400')) return 400;
  return 500;
}

/** Anthropic SSE error `type` for a status code — lets clients tell retryable from terminal failures. */
export function anthropicErrorType(status: number): string {
  switch (status) {
    case 400: return 'invalid_request_error';
    case 401: return 'authentication_error';
    case 403: return 'permission_error';
    case 404: return 'not_found_error';
    case 429: return 'rate_limit_error';
    default: return 'api_error';
  }
}

function sanitizeMessage(message: string): string {
  const line = message.split('\n')[0]?.trim() ?? message;
  if (line.startsWith('RetryError') || line.includes('AI_RetryError')) {
    return 'Upstream model request failed after retries.';
  }
  return line;
}
