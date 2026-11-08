// The Relay Free Pool as one model in the API gateway.
//
// The pool stays opt-in (`freePool.enabled`, default off). When it is on and at
// least one member has a passing Test for Claude, the gateway advertises one
// synthetic model and routes Anthropic traffic through the same runtime Claude
// Desktop uses. The OpenAI Chat Completions route uses the Relay Core pool model
// because it already owns per-member failover, health and session pinning.

import type { LocalProvider } from '../types.js';
import { loadPreferences } from '../config.js';
import { prepareClaudeAutoPool } from '../pool/claude-launch.js';
import type { ServerPoolOptions } from './router.js';
import type { ServerModelInfo } from './models.js';

/** Gateway model id. Distinct from Claude Desktop's `claude-pool` so pickers read naturally. */
export const SERVER_POOL_MODEL_ID = 'relay-free-pool';

export interface ServerPoolSetup {
  model: ServerModelInfo;
  options: ServerPoolOptions;
}

/**
 * Build the gateway pool entry, or undefined when the pool is off, empty, or
 * has no member that passed a Test. Never throws on malformed saved state: the
 * ordinary server catalog must stay available.
 */
export function prepareServerPool(providers: readonly LocalProvider[]): ServerPoolSetup | undefined {
  const auto = prepareClaudeAutoPool(loadPreferences(), providers);
  if (!auto) return undefined;
  return {
    model: {
      id: SERVER_POOL_MODEL_ID,
      name: auto.displayName,
      isFree: true,
      brand: 'Relay',
      providerId: 'relay-free-pool',
      providerLabel: 'Relay',
      sourceBackend: 'relay',
      // Deliberately not a provider format: the router handles this id first and
      // never forwards it to an upstream endpoint.
      modelFormat: 'unsupported',
      contextWindow: auto.contextWindow,
    },
    options: {
      runtime: auto.runtime,
      displayName: auto.displayName,
      modelId: SERVER_POOL_MODEL_ID,
    },
  };
}
