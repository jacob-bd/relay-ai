// Short user-facing messages from SDK/upstream failures — no stack traces in Codex TUI.

interface ApiCallLike {
  name?: string;
  message?: string;
  statusCode?: number;
  responseBody?: string;
  data?: { error?: { message?: string; type?: string } };
  lastError?: { message?: string; statusCode?: number };
  errors?: Array<{ message?: string; statusCode?: number }>;
  cause?: unknown;
}

const TRACE_FIELD_LIMIT = 4_000;

function clipTraceField(value: string): string {
  return value.length <= TRACE_FIELD_LIMIT ? value : `${value.slice(0, TRACE_FIELD_LIMIT)}…`;
}

function safeUpstreamErrorFields(err: unknown, includeCause: boolean): Record<string, unknown> {
  if (!err || typeof err !== 'object') {
    return { message: clipTraceField(String(err)) };
  }

  const rec = err as ApiCallLike;
  const result: Record<string, unknown> = {};
  if (rec.name) result.name = rec.name;
  if (rec.message) result.message = clipTraceField(rec.message);
  if (rec.statusCode !== undefined) result.statusCode = rec.statusCode;
  if (rec.responseBody) result.responseBody = clipTraceField(rec.responseBody);
  if (rec.data?.error) {
    result.data = {
      error: {
        ...(rec.data.error.type ? { type: rec.data.error.type } : {}),
        ...(rec.data.error.message
          ? { message: clipTraceField(rec.data.error.message) }
          : {}),
      },
    };
  }
  if (rec.lastError) {
    result.lastError = {
      ...(rec.lastError.message
        ? { message: clipTraceField(rec.lastError.message) }
        : {}),
      ...(rec.lastError.statusCode !== undefined
        ? { statusCode: rec.lastError.statusCode }
        : {}),
    };
  }
  if (rec.errors?.length) {
    result.errors = rec.errors.map(item => ({
      ...(item.message ? { message: clipTraceField(item.message) } : {}),
      ...(item.statusCode !== undefined ? { statusCode: item.statusCode } : {}),
    }));
  }
  if (includeCause && rec.cause !== undefined) {
    result.cause = safeUpstreamErrorFields(rec.cause, false);
  }
  return result;
}

/** Safe diagnostic fields for trace logs; deliberately excludes request data and headers. */
export function formatUpstreamErrorTrace(err: unknown): string {
  return JSON.stringify(safeUpstreamErrorFields(err, true));
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
    if (code === 400 || code === 401 || code === 403 || code === 404 || code === 429) return code;
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
