// src/core/errors.ts — RelayCoreError: safe, structured errors for embedded consumers.

import type { RelayCoreErrorCode, RelayRouteId } from './types.js';

const DEFAULT_RETRYABLE: Record<RelayCoreErrorCode, boolean> = {
  INVALID_ROUTE_ID: false,
  ROUTE_NOT_FOUND: false,
  PROVIDER_DISABLED: false,
  CREDENTIAL_UNAVAILABLE: false,
  OAUTH_REFRESH_FAILED: true,
  UNSUPPORTED_MODEL: false,
  UNSUPPORTED_REGISTRY_VERSION: false,
  PROVIDER_LOAD_FAILED: true,
};

export interface RelayCoreErrorOptions {
  retryable?: boolean;
  providerId?: string;
  routeId?: RelayRouteId;
  cause?: unknown;
}

/**
 * Error thrown by the embedded Core API. Carries only safe structured metadata —
 * never credential material. `cause` is retained for internal debugging but is
 * omitted from JSON serialization.
 */
export class RelayCoreError extends Error {
  readonly code: RelayCoreErrorCode;
  readonly retryable: boolean;
  readonly providerId?: string;
  readonly routeId?: RelayRouteId;

  constructor(code: RelayCoreErrorCode, message: string, options: RelayCoreErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'RelayCoreError';
    this.code = code;
    this.retryable = options.retryable ?? DEFAULT_RETRYABLE[code];
    if (options.providerId !== undefined) this.providerId = options.providerId;
    if (options.routeId !== undefined) this.routeId = options.routeId;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.providerId !== undefined ? { providerId: this.providerId } : {}),
      ...(this.routeId !== undefined ? { routeId: this.routeId } : {}),
    };
  }
}

export function isRelayCoreError(err: unknown): err is RelayCoreError {
  return err instanceof RelayCoreError;
}
