// src/core/index.ts — public barrel for the embedded @jacobbd/relay-ai/core surface.
//
// Side-effect-free: importing this module must never start a server, open a
// browser, print UI, parse CLI args, or write to disk.

export { listRelayModels } from './catalog.js';
export { createRelayModel } from './model.js';
export { RELAY_POOL_ROUTE_ID } from './pool-model.js';
export { parseRelayRouteId, toRelayRouteId } from './route-id.js';
export { RelayCoreError, isRelayCoreError } from './errors.js';
export { getRelayAccountUsage, readRelayAccountUsage, supportsAccountUsage } from './usage.js';
export type {
  GetRelayAccountUsageOptions,
  ReadRelayAccountUsageOptions,
  RelayAccountUsage,
  RelayUsageBalance,
  RelayUsageErrorCode,
  RelayUsageScope,
  RelayUsageWindow,
  RelayCoreErrorCode,
  RelayModelDescriptor,
  RelayReasoningLevel,
  RelayRouteId,
  CreateRelayModelOptions,
} from './types.js';
