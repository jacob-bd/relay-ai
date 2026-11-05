// Shared bounded attempt coordinator. Protocol adapters own eligibility and formatting.
export interface PoolEvent {
  type: string;
  text?: string;
  delta?: string;
  finishReason?: string;
  error?: unknown;
  [key: string]: unknown;
}
export interface PoolRoute {
  // Includes account and endpoint/config revision, never just modelId.
  id: string;
  open(signal: AbortSignal): Promise<AsyncIterable<PoolEvent>>;
  recordAttemptFailure?(error: unknown): Promise<void>;
  /**
   * Lazy preparation: runs right before this route would be attempted, never for routes the request does not
   * reach. Returns a reason to pass the route over (no attempt is used, nothing is recorded as a failure), or
   * undefined to go ahead. Routes without it are always admitted.
   */
  admit?(signal: AbortSignal): Promise<string | undefined>;
}
/** Members tried per request, in priority order. Failures are usually fast; the total time limit still bounds slow ones. */
export const MAX_POOL_ATTEMPTS = 8;

export interface PoolLimits {
  attempts: number;
  firstContentMs: number;
  idleMs: number;
  totalMs: number;
  bufferBytes: number;
  cleanupMs: number;
}
export class PoolAttemptError extends Error {
  constructor(readonly code: string, readonly committed: boolean, readonly cause?: unknown) {
    super(code);
  }
}
export function validPoolFinish(part: PoolEvent): boolean {
  return part.type === 'finish' && ['stop', 'tool-calls', 'length'].includes(part.finishReason ?? '');
}
class PoolCoordinatorError extends Error {
  /**
   * True when the shared request budget ended the wait, not this member's own first-content or idle limit.
   * The member never got its full allowance, so the timeout says nothing about its health.
   */
  constructor(message: string, readonly budget = false) { super(message); }
}
function meaningful(part: PoolEvent): boolean {
  return (['text-delta', 'reasoning-delta'].includes(part.type) && Boolean(part.text))
    || (part.type === 'tool-input-delta' && Boolean(part.delta))
    || part.type === 'tool-input-start' || part.type === 'tool-call';
}
async function bounded<T>(work: PromiseLike<T>, ms: number, signal: AbortSignal, code: string, budget = false): Promise<T> {
  signal.throwIfAborted();
  if (ms <= 0) throw new PoolCoordinatorError(code, budget);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: () => void = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => reject(new PoolCoordinatorError(code, budget)), Math.max(0, ms));
  });
  try { return await Promise.race([work, interrupted]); }
  finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}
export async function* runPoolAttempts(
  routes: readonly PoolRoute[], signal: AbortSignal, limits: PoolLimits,
  retryable: (error: unknown) => boolean,
  onAttempt: (id: string) => void = () => {},
  onFailure: (id: string, error: unknown, committed: boolean) => void = () => {},
  onSkip: (id: string, reason: string) => void = () => {},
): AsyncGenerator<PoolEvent> {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid pool limit: ' + name);
  }
  const deadline = Date.now() + limits.totalMs;
  let committed = false;
  let lastError: unknown;
  // Only routes that are really opened use up an attempt: a route passed over at admission costs none.
  let opened = 0;
  for (const route of routes) {
    if (opened >= limits.attempts) break;
    signal.throwIfAborted();
    if (Date.now() >= deadline) throw new PoolAttemptError('total-deadline', committed);
    if (route.admit) {
      let reason: string | undefined;
      try {
        reason = await route.admit(signal);
      } catch (error) {
        if (signal.aborted) throw signal.reason ?? error;
        reason = 'could not be prepared: ' + (error instanceof Error ? error.message : String(error));
      }
      if (reason) { onSkip(route.id, reason); continue; }
    }
    opened += 1;
    const controller = new AbortController();
    const attemptSignal = AbortSignal.any([signal, controller.signal]);
    const attemptStart = Date.now();
    const firstDeadline = Math.min(deadline, attemptStart + limits.firstContentMs);
    // The request budget, not this member's own allowance, is what will end the wait.
    const firstBudget = deadline < attemptStart + limits.firstContentMs;
    let iterator: AsyncIterator<PoolEvent> | undefined;
    const buffered: PoolEvent[] = [];
    let bytes = 0;
    // The provider delivered a valid terminal event, so this attempt succeeded.
    let completed = false;
    // A consumer exception is injected at the yield point. It is never a provider
    // failure: it is not reported through onFailure, not retried on another route,
    // and cannot fail closed on cleanup. Replaying into a broken consumer would
    // double-spend and duplicate work.
    let consumerThrew = false;
    let consumerError: unknown;
    // A chosen terminal error must not be replaced by a cleanup error in finally.
    // A retryable failure still refuses fallback when cleanup cannot close the stream;
    // that cleanup error carries the original as its cause.
    let terminalThrown = false;
    onAttempt(route.id);
    try {
      const stream = await bounded(route.open(attemptSignal), firstDeadline - Date.now(), attemptSignal, 'first-content-timeout', firstBudget);
      iterator = stream[Symbol.asyncIterator]();
      while (true) {
        const now = Date.now();
        const remaining = (committed ? Math.min(deadline, now + limits.idleMs) : firstDeadline) - now;
        const budget = committed ? deadline < now + limits.idleMs : firstBudget;
        const next = await bounded(iterator.next(), remaining, attemptSignal, committed ? 'idle-or-total-timeout' : 'first-content-timeout', budget);
        signal.throwIfAborted();
        if (next.done) throw new PoolCoordinatorError('missing-valid-finish');
        const part = next.value;
        if (part.type === 'error') throw part.error ?? new Error('stream-error');
        const terminal = part.type === 'finish';
        if (terminal && !validPoolFinish(part)) throw new PoolCoordinatorError('invalid-finish');
        if (!committed) {
          bytes += Buffer.byteLength(JSON.stringify(part));
          if (bytes > limits.bufferBytes) throw new PoolCoordinatorError('provisional-buffer-limit');
          buffered.push(part);
          if (!meaningful(part) && !terminal) continue;
          // Set before exposing even a provisional event. Formatter/socket errors
          // must never cause a second provider request.
          committed = true;
          for (const pending of buffered) {
            // Cancellation is not a provider failure: stop before handing over
            // events that were already received but not yet delivered.
            signal.throwIfAborted();
            try {
              yield pending;
            } catch (error) {
              consumerThrew = true;
              consumerError = error;
              throw error;
            }
          }
          buffered.length = 0;
        } else {
          try {
            yield part;
          } catch (error) {
            consumerThrew = true;
            consumerError = error;
            throw error;
          }
        }
        if (terminal) {
          completed = true;
          return;
        }
      }
    } catch (error) {
      if (consumerThrew) {
        terminalThrown = true;
        throw consumerError;
      }
      lastError = error;
      if (!signal.aborted) {
        // A wait cut short by the shared budget is not a verdict on the member: it is not cooled.
        if (error instanceof PoolCoordinatorError && !error.budget) await route.recordAttemptFailure?.(error);
        await onFailure(route.id, error, committed);
      }
      if (signal.aborted) {
        terminalThrown = true;
        throw signal.reason;
      }
      if (committed || !retryable(error)) {
        terminalThrown = true;
        throw new PoolAttemptError('attempt-failed', committed, error);
      }
    } finally {
      controller.abort();
      // Abort before cleanup; refuse fallback if the transport will not close.
      if (iterator?.return) {
        try {
          await bounded(iterator.return(), limits.cleanupMs, new AbortController().signal, 'cleanup-timeout');
        } catch {
          // A completed attempt stays completed: a slow or uncooperative close
          // after the terminal event is transport cleanup, not a failed answer.
          // A departed consumer cannot receive an error either.
          if (!completed && !consumerThrew && !terminalThrown && !signal.aborted) {
            throw new PoolAttemptError('cleanup-failed', committed, lastError);
          }
        }
      }
    }
  }
  if (opened === 0) throw new PoolAttemptError('no-admitted-route', false, lastError);
  throw new PoolAttemptError('attempt-budget-exhausted', committed, lastError);
}
