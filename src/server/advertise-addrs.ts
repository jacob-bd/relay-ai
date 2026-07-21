// Resolve addresses to advertise for network-mode URLs (LAN / Docker).
// Inside containers, os.networkInterfaces() often only returns 172.x bridge IPs.
// Prefer explicit env and the browser Host header when available.

import { networkInterfaces } from 'node:os';

export function getLocalIps(): Array<{ name: string; address: string }> {
  const ifaces = networkInterfaces();
  const result: Array<{ name: string; address: string }> = [];
  for (const [name, iface] of Object.entries(ifaces)) {
    for (const addr of iface ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) {
        result.push({ name, address: addr.address });
      }
    }
  }
  return result;
}

export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0';
}

/** Strip optional port from an HTTP Host header (supports [ipv6]:port). */
export function hostFromHeader(hostHeader: string | undefined): string | undefined {
  if (!hostHeader?.trim()) return undefined;
  let host = hostHeader.trim();
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    if (end > 0) return host.slice(1, end) || undefined;
  }
  const colon = host.lastIndexOf(':');
  // Only strip :port when there is a single colon (IPv4 host:port), not bare IPv6.
  if (colon > 0 && host.indexOf(':') === colon) {
    host = host.slice(0, colon);
  }
  return host || undefined;
}

export function parseAdvertiseHostsFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.RELAY_AI_ADVERTISE_HOSTS ?? env.RELAY_AI_ADVERTISE_HOST ?? '';
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,\s]+/)) {
    const host = part.trim();
    if (!host || isLoopbackHost(host) || seen.has(host)) continue;
    seen.add(host);
    out.push(host);
  }
  return out;
}

/**
 * Addresses for network URL cards / CLI banners.
 * Prefer RELAY_AI_ADVERTISE_HOST(S) and optional request Host; else local NICs.
 */
export function resolveAdvertiseAddresses(opts?: {
  requestHost?: string;
  env?: NodeJS.ProcessEnv;
}): Array<{ name: string; address: string }> {
  const env = opts?.env ?? process.env;
  const hosts = parseAdvertiseHostsFromEnv(env);
  const req = opts?.requestHost?.trim();
  if (req && !isLoopbackHost(req) && !hosts.includes(req)) {
    hosts.push(req);
  }
  if (hosts.length > 0) {
    return hosts.map(address => ({
      name: hosts.length === 1 ? 'LAN' : address,
      address,
    }));
  }
  return getLocalIps();
}

/**
 * Port clients should use to reach the gateway.
 * Inside Docker the process listens on 17645, but Compose may publish a different
 * host port (`RELAY_AI_GATEWAY_HOST_PORT`). Prefer that for advertised URLs.
 */
export function resolveAdvertiseGatewayPort(
  listenPort: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.RELAY_AI_ADVERTISE_GATEWAY_PORT ?? env.RELAY_AI_GATEWAY_HOST_PORT;
  if (!raw?.trim()) return listenPort;
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n <= 0 || n > 65535) return listenPort;
  return Math.trunc(n);
}

export function formatGatewayUrls(host: string, port: number): {
  anthropicUrl: string;
  openaiUrl: string;
} {
  return {
    anthropicUrl: `http://${host}:${port}/anthropic`,
    openaiUrl: `http://${host}:${port}/openai/v1`,
  };
}
