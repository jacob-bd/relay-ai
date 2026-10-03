import ipaddr from 'ipaddr.js';

export function clampModelTimeoutMs(value: number, fallback: number): number {
  return Number.isFinite(value)
    ? Math.min(120_000, Math.max(1_000, Math.round(value)))
    : fallback;
}

function isLocalEndpoint(baseUrl: string): boolean {
  try {
    const hostname = new URL(baseUrl).hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;
    const range = ipaddr.process(hostname).range();
    return range === 'loopback' || range === 'private' || range === 'uniqueLocal';
  } catch {
    return false;
  }
}

/** Discovery policy only; URL security validation remains at the call sites. */
export function endpointModelTimeoutMs(templateId: string, baseUrl: string): number {
  const slowEndpoint = templateId.startsWith('custom-')
    || templateId === 'ollama' || templateId === 'lmstudio' || isLocalEndpoint(baseUrl);
  if (!slowEndpoint) return 10_000;
  const configured = process.env.RELAY_AI_CUSTOM_ENDPOINT_MODEL_TIMEOUT_MS?.trim();
  return configured ? clampModelTimeoutMs(Number(configured), 30_000) : 30_000;
}
