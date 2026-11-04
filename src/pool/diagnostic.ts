import { formatUpstreamError } from '../codex/upstream-error.js';

/** Strips anything that looks like a credential, collapses whitespace and truncates. */
export function redactDiagnostic(text: string, max = 160): string | undefined {
  const redacted = text
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [redacted]')
    .replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{6,}/gi, '[redacted]')
    .replace(/\b(?:sk|pk|rk|api[-_]?key|token|secret|authorization)[-_A-Za-z0-9]*\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{6,}/gi,
      '[redacted]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim();
  return redacted ? redacted.slice(0, max) : undefined;
}

/**
 * What the backend said about a failed attempt, for the local pool log: the provider's own error message
 * (and HTTP status) with credentials redacted and the length capped.
 */
export function poolErrorDetail(error: unknown): string | undefined {
  try {
    const formatted = formatUpstreamError(error);
    const raw = error instanceof Error ? error.message : '';
    const text = formatted && formatted !== 'Upstream model request failed.' ? formatted : raw;
    return redactDiagnostic(text, 200);
  } catch {
    return undefined;
  }
}
