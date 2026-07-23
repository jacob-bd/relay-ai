// src/core/route-id.ts — `provider::model` route ids (unconditionally scoped).

import { isValidProviderId } from '../registry/validate.js';
import { RelayCoreError } from './errors.js';
import type { RelayRouteId } from './types.js';

const SEPARATOR = '::';

/**
 * Build a route id from a provider id and a model id. The provider id must pass
 * the registry's `PROVIDER_ID_PATTERN`; the model id may contain `/` and `:`.
 */
export function toRelayRouteId(providerId: string, modelId: string): RelayRouteId {
  if (!isValidProviderId(providerId)) {
    throw new RelayCoreError('INVALID_ROUTE_ID', `Invalid provider id for route id: ${JSON.stringify(providerId)}`, {});
  }
  if (!modelId) {
    throw new RelayCoreError('INVALID_ROUTE_ID', 'Model id must be non-empty for a route id', { providerId });
  }
  return `${providerId}${SEPARATOR}${modelId}`;
}

/**
 * Parse a route id back into its parts. Splits on the FIRST `::` only, so model
 * ids containing `/` or `:` (e.g. `openrouter::vendor/model:free`) survive.
 * A bare model id (no `::`) is rejected.
 */
export function parseRelayRouteId(routeId: string): { providerId: string; modelId: string } {
  const idx = typeof routeId === 'string' ? routeId.indexOf(SEPARATOR) : -1;
  if (idx <= 0 || idx === routeId.length - SEPARATOR.length) {
    throw new RelayCoreError('INVALID_ROUTE_ID', `Route id must be "provider::model", got: ${JSON.stringify(routeId)}`);
  }
  const providerId = routeId.slice(0, idx);
  const modelId = routeId.slice(idx + SEPARATOR.length);
  if (!isValidProviderId(providerId)) {
    throw new RelayCoreError('INVALID_ROUTE_ID', `Invalid provider id in route id: ${JSON.stringify(routeId)}`);
  }
  return { providerId, modelId };
}
