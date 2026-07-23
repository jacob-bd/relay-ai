// src/core/index.ts — public barrel for the embedded @jacobbd/relay-ai/core surface.
//
// Side-effect-free: importing this module must never start a server, open a
// browser, print UI, parse CLI args, or write to disk.

export { listRelayModels } from './catalog.js';
export { createRelayModel } from './model.js';
export { parseRelayRouteId, toRelayRouteId } from './route-id.js';
export { RelayCoreError, isRelayCoreError } from './errors.js';
export type { RelayCoreErrorCode, RelayModelDescriptor, RelayRouteId } from './types.js';
