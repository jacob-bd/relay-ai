import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { formatAnthropicModelEntry } from '../server/models.js';
import type { ProxyRoute } from '../proxy.js';
import { RELAY_BASE_URL } from './anthropic-host.js';

// Must equal the ANTHROPIC_BASE_URL pinned in http-proxy/env.ts — Claude Code only
// reads the cache when its baseUrl matches the active base URL.
const GATEWAY_DISCOVERY_BASE_URL = RELAY_BASE_URL;
const CACHE_FILE = 'gateway-models.json';

function cachePath(baseEnv: NodeJS.ProcessEnv): string {
  const claudeDir = baseEnv['CLAUDE_CONFIG_DIR']?.trim() || path.join(os.homedir(), '.claude');
  return path.join(claudeDir, 'cache', CACHE_FILE);
}

/**
 * Seed Claude Code's gateway-model-discovery cache with the Relay routes so the
 * favorites appear in the `/model` picker. The picker's read path only checks the
 * discovery flag + a baseUrl match — it never re-validates credentials — so seeding
 * works even for OAuth users whose credential-gated discovery fetch silently no-ops.
 * Each entry reuses formatAnthropicModelEntry, i.e. the exact shape Claude Code writes
 * itself, so the cached file always passes its own reader.
 */
export function writeGatewayDiscoveryCache(
  baseEnv: NodeJS.ProcessEnv,
  routes: ProxyRoute[],
): void {
  try {
    const models = routes
      .filter(route => Boolean(route.gatewayAliasId))
      .map(route => formatAnthropicModelEntry(
        route.gatewayAliasId!,
        route.displayName,
        route.contextWindow,
      ));
    const file = cachePath(baseEnv);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({ baseUrl: GATEWAY_DISCOVERY_BASE_URL, fetchedAt: Date.now(), models }),
      { encoding: 'utf8', mode: 0o600 },
    );
  } catch {
    // Best-effort: a failed seed just leaves the picker without Relay entries.
  }
}
