// Claude Code's `/model` gateway-discovery picker only reads the seeded models
// cache when ANTHROPIC_BASE_URL's host is NOT api.anthropic.com. Pointing the
// child at this sentinel host (still MITM-intercepted and forwarded to real
// Anthropic) satisfies that check without touching OAuth/subscription auth,
// which is gated separately and does not depend on the base-URL host.
export const ANTHROPIC_UPSTREAM_HOST = 'api.anthropic.com';
export const RELAY_SENTINEL_HOST = 'api.anthropic.com.relay.invalid';
export const RELAY_BASE_URL = `https://${RELAY_SENTINEL_HOST}`;
