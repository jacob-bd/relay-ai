// Shared keepalives for free-pool failover (HTTP SSE and WebSocket).
//
// While the pool is trying slow or failing members before any content commits,
// the client connection would otherwise sit completely silent (not even HTTP 200
// headers), causing SDK headers/read timeouts to abort the request before a
// later healthy member can answer.
//
// After a short grace period (default 1.5s, so instant errors still return HTTP
// 502/503 JSON and fast responses emit zero keepalives), the SSE helper opens
// the 200 SSE stream and writes periodic spec-compliant keepalive frames until
// `stop()` is called on first content or request completion.
import type { ServerResponse } from 'node:http';

export const DEFAULT_KEEPALIVE_DELAY_MS = 1_500;
export const DEFAULT_KEEPALIVE_INTERVAL_MS = 4_000;

/** Anthropic Messages SSE spec-defined keepalive event. */
export const ANTHROPIC_SSE_PING = 'event: ping\ndata: {"type":"ping"}\n\n';
/** Standard W3C EventSource comment keepalive (ignored by OpenAI/Codex SSE parsers). */
export const GENERIC_SSE_KEEPALIVE = ': keepalive\n\n';

export interface PoolSseKeepaliveOptions {
  /** Frame written on each keepalive tick. Defaults to GENERIC_SSE_KEEPALIVE. */
  frame?: string;
  /** Grace period before sending headers + first keepalive. Defaults to 1500ms. */
  delayMs?: number;
  /** Repeat interval after the first keepalive. Defaults to 4000ms. */
  intervalMs?: number;
  /** Extra headers merged into the 200 SSE response when opened by keepalive. */
  headers?: Record<string, string>;
}

export interface PoolKeepaliveHandle {
  /** Stops all pending timers and detaches listeners immediately. Idempotent. */
  stop(): void;
  /** True once this keepalive has sent at least one frame. */
  readonly sent: boolean;
}

export function startPoolSseKeepalive(
  res: ServerResponse,
  options: PoolSseKeepaliveOptions = {},
): PoolKeepaliveHandle {
  const frame = options.frame ?? GENERIC_SSE_KEEPALIVE;
  const delayMs = Number.isFinite(options.delayMs) && (options.delayMs ?? 0) > 0
    ? Math.floor(options.delayMs!)
    : DEFAULT_KEEPALIVE_DELAY_MS;
  const intervalMs = Number.isFinite(options.intervalMs) && (options.intervalMs ?? 0) > 0
    ? Math.floor(options.intervalMs!)
    : DEFAULT_KEEPALIVE_INTERVAL_MS;
  const sseHeaders: Record<string, string> = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    ...options.headers,
  };

  let stopped = false;
  let sent = false;
  let delayTimer: ReturnType<typeof setTimeout> | undefined;
  let intervalTimer: ReturnType<typeof setInterval> | undefined;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    res.off('close', stop);
    if (delayTimer) clearTimeout(delayTimer);
    if (intervalTimer) clearInterval(intervalTimer);
    delayTimer = undefined;
    intervalTimer = undefined;
  };

  const tick = () => {
    if (stopped || res.destroyed || res.writableEnded || !res.writable) {
      stop();
      return;
    }
    // Avoid unbounded buffering on a stalled client socket.
    if (res.writableNeedDrain) return;
    try {
      if (!res.headersSent) {
        res.writeHead(200, sseHeaders);
      }
      res.write(frame);
      sent = true;
    } catch {
      stop();
    }
  };

  res.once('close', stop);
  delayTimer = setTimeout(() => {
    delayTimer = undefined;
    tick();
    if (!stopped) {
      intervalTimer = setInterval(tick, intervalMs);
      intervalTimer.unref?.();
    }
  }, delayMs);
  delayTimer.unref?.();

  return {
    stop,
    get sent() {
      return sent;
    },
  };
}

/**
 * Periodic WebSocket Ping keepalive (RFC 6455 control frame) while a pool
 * request is waiting for first content before committing any application event.
 */
export function startPoolWsKeepalive(
  sendPing: () => boolean,
  options: { delayMs?: number; intervalMs?: number } = {},
): PoolKeepaliveHandle {
  const delayMs = Number.isFinite(options.delayMs) && (options.delayMs ?? 0) > 0
    ? Math.floor(options.delayMs!)
    : DEFAULT_KEEPALIVE_DELAY_MS;
  const intervalMs = Number.isFinite(options.intervalMs) && (options.intervalMs ?? 0) > 0
    ? Math.floor(options.intervalMs!)
    : DEFAULT_KEEPALIVE_INTERVAL_MS;

  let stopped = false;
  let sent = false;
  let delayTimer: ReturnType<typeof setTimeout> | undefined;
  let intervalTimer: ReturnType<typeof setInterval> | undefined;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (delayTimer) clearTimeout(delayTimer);
    if (intervalTimer) clearInterval(intervalTimer);
    delayTimer = undefined;
    intervalTimer = undefined;
  };

  const tick = () => {
    if (stopped) return;
    try {
      if (sendPing()) sent = true;
      else stop();
    } catch {
      stop();
    }
  };

  delayTimer = setTimeout(() => {
    delayTimer = undefined;
    tick();
    if (!stopped) {
      intervalTimer = setInterval(tick, intervalMs);
      intervalTimer.unref?.();
    }
  }, delayMs);
  delayTimer.unref?.();

  return {
    stop,
    get sent() {
      return sent;
    },
  };
}
