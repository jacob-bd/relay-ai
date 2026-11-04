import { MessageStream } from '@anthropic-ai/sdk/lib/MessageStream';
import { writeAnthropicStream } from '../sdk-adapter.js';
import type { FreePoolPreferences } from '../types.js';
import { MAX_POOL_ATTEMPTS, type PoolLimits } from './attempt.js';
import { retryPoolFailure } from './errors.js';
import { describePoolFailure, poolRouteMember, recordPoolActivity } from './activity.js';
import { dispatchFreePool, type DispatchRoute } from './dispatch.js';
import { anthropicErrorType, formatUpstreamError, upstreamHttpStatus } from '../codex/upstream-error.js';

export const CLAUDE_POOL_MODEL_ID = 'claude-pool';

export interface ClaudePoolRequest {
  modelId: string;
  stream: boolean;
  signal: AbortSignal;
  estimatedInputTokens?: number;
  effort?: string;
  maxOutputBytes?: number;
}
export interface ClaudeProtocolError {
  type: string;
  message: string;
}
export type ClaudeServeResult =
  | { ok: true; message?: Record<string, unknown> }
  | { ok: false; status: number; error: ClaudeProtocolError; committed: boolean };

/**
 * Coarse duplicate suppression for Claude, keyed by a caller-supplied scope and
 * full-history hash. This is NOT turn identity and MUST NOT be described as one:
 * Claude session headers are client-supplied and are never used to infer a turn
 * or pin a branch. Failure embargos are local and process-scoped.
 */
export class ClaudeHistoryEmbargo {
  private readonly entries = new Map<string, { status: 'active' | 'failed'; expires: number }>();
  constructor(private readonly ttlMs = 60_000, private readonly maxEntries = 100, private readonly now = Date.now) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new Error('Invalid embargo TTL');
    if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) throw new Error('Invalid embargo capacity');
  }
  claim(scope: string, historyFingerprint: string): { kind: 'owner'; release(): void; fail(): void } | { kind: 'busy' } | { kind: 'blocked' } {
    if (!scope || !historyFingerprint) throw new Error('scope-and-history-required');
    const key = JSON.stringify([scope, historyFingerprint]);
    const now = this.now();
    for (const [stored, entry] of this.entries) {
      if (entry.expires <= now) this.entries.delete(stored);
    }
    const current = this.entries.get(key);
    if (current) return current.status === 'active' ? { kind: 'busy' } : { kind: 'blocked' };
    if (this.entries.size >= this.maxEntries) {
      // Never evict an in-flight request.
      return { kind: 'blocked' };
    }
    const entry = { status: 'active' as const, expires: this.now() + this.ttlMs };
    this.entries.set(key, entry);
    const settle = () => this.entries.get(key) === entry;
    return {
      kind: 'owner',
      release: () => { if (settle()) this.entries.delete(key); },
      fail: () => { if (settle()) this.entries.set(key, { status: 'failed', expires: this.now() + this.ttlMs }); },
    };
  }
}

export interface ClaudePoolOptions {
  pool: FreePoolPreferences;
  routes: readonly DispatchRoute[];
  request: ClaudePoolRequest;
  limits: PoolLimits;
  write?: (chunk: string) => void;
  retryable?: (error: unknown) => boolean;
  embargo?: ClaudeHistoryEmbargo;
  scope?: { value: string; historyFingerprint: string };
  /** Optional trace sink (the proxy's --trace log): one short line per attempt, failure and answer. */
  trace?: (line: string) => void;
}

function defaultRetryable(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : '';
  const message = formatUpstreamError(error) + ' ' + raw;
  const status = upstreamHttpStatus(error, message);
  return status === 429 || status >= 500 || /ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed/i.test(message);
}

function protocolStatus(error: unknown): { status: number; error: ClaudeProtocolError } {
  const message = formatUpstreamError(error);
  const status = upstreamHttpStatus(error, message);
  return { status, error: { type: anthropicErrorType(status), message } };
}

function sseError(error: ClaudeProtocolError): string {
  return 'event: error\ndata: ' + JSON.stringify({ type: 'error', error }) + '\n\n';
}

async function collectMessage(parts: AsyncIterable<{ type: string; [key: string]: unknown }>, model: string, maxBytes: number): Promise<Record<string, unknown>> {
  const lines: string[] = [];
  let bytes = 0;
  let sawError = false;
  await writeAnthropicStream(parts as Parameters<typeof writeAnthropicStream>[0], model, chunk => {
    if (chunk.includes('event: error')) sawError = true;
    bytes += Buffer.byteLength(chunk, 'utf8');
    if (bytes > maxBytes) throw new Error('nonstream-output-limit');
    for (const line of chunk.split('\n')) if (line.startsWith('data: {')) lines.push(line.slice(6));
  });
  if (sawError) throw new Error('provider error during nonstream aggregation');
  const encoded = new TextEncoder().encode(lines.join('\n') + '\n');
  const stream = MessageStream.fromReadableStream(new ReadableStream({
    start(controller) { controller.enqueue(encoded); controller.close(); },
  }));
  return await stream.finalMessage() as unknown as Record<string, unknown>;
}

/**
 * Serves one Claude Code request from the shared pool. Routes must carry
 * caller-prepared SDK evidence; this function never resolves credentials, tools,
 * sessions or branch identity. Tools are formatted for the client and never run.
 */
export async function serveClaudePool(options: ClaudePoolOptions): Promise<ClaudeServeResult> {
  const { pool, routes, request, limits, write, embargo, scope } = options;
  let owner: ReturnType<ClaudeHistoryEmbargo['claim']> | undefined;
  if (embargo && scope) {
    const claim = embargo.claim(scope.value, scope.historyFingerprint);
    if (claim.kind !== 'owner') {
      return { ok: false, status: 429, committed: false,
        error: { type: 'rate_limit_error', message: claim.kind === 'busy' ? 'A matching request is already in flight' : 'A matching request recently failed' } };
    }
    owner = claim;
  }
  // Which member answers is otherwise invisible: log each failed attempt and the member that served.
  let attemptedId: string | undefined;
  let attemptStarted = Date.now();
  const logServed = () => {
    const member = attemptedId ? poolRouteMember(attemptedId) : undefined;
    if (!member) return;
    recordPoolActivity({ target: 'claude', event: 'served', ...member, ms: Date.now() - attemptStarted });
    options.trace?.(`pool answered: ${member.providerId}/${member.modelId} in ${((Date.now() - attemptStarted) / 1000).toFixed(1)}s`);
  };
  options.trace?.(`pool request: ${routes.length} eligible member(s): ${routes.map(route => `${route.member.providerId}/${route.member.modelId}`).join(', ') || 'none'}`);
  const parts = dispatchFreePool(pool, routes, {
    target: 'claude', tools: true, effort: request.effort, signal: request.signal,
  }, {
    limits, retryable: options.retryable ?? defaultRetryable,
    onAttempt: id => {
      attemptedId = id;
      attemptStarted = Date.now();
      const member = poolRouteMember(id);
      if (member) options.trace?.(`pool attempt: ${member.providerId}/${member.modelId}`);
    },
    onFailure: (id, error) => {
      const member = poolRouteMember(id);
      if (!member) return;
      const reason = describePoolFailure(error);
      recordPoolActivity({ target: 'claude', event: 'failed', ...member, reason, ms: Date.now() - attemptStarted });
      options.trace?.(`pool failed: ${member.providerId}/${member.modelId} (${reason}) after ${((Date.now() - attemptStarted) / 1000).toFixed(1)}s`);
    },
  });
  try {
    if (!request.stream) {
      const message = await collectMessage(parts, request.modelId, request.maxOutputBytes ?? 65536);
      logServed();
      owner?.kind === 'owner' && owner.release();
      return { ok: true, message };
    }
    if (!write) throw new Error('stream-write-sink-required');
    let committed = false;
    let sawError = false;
    try {
      await writeAnthropicStream(parts as Parameters<typeof writeAnthropicStream>[0], request.modelId, chunk => {
        if (chunk.includes('event: error')) sawError = true;
        if (chunk.startsWith('event: message_start') || chunk.startsWith('event: content_block')) committed = true;
        write(chunk);
      }, undefined, request.estimatedInputTokens ?? 0);
    } catch (error) {
      const mapped = protocolStatus(error);
      if (!committed) {
        owner?.kind === 'owner' && owner.fail();
        return { ok: false, ...mapped, committed: false };
      }
      if (!sawError) write(sseError(mapped.error));
      owner?.kind === 'owner' && owner.fail();
      return { ok: false, ...mapped, committed: true };
    }
    if (sawError) {
      owner?.kind === 'owner' && owner.fail();
      return { ok: false, status: 502, committed, error: { type: 'api_error', message: 'Provider failed after response commitment' } };
    }
    logServed();
    owner?.kind === 'owner' && owner.release();
    return { ok: true };
  } catch (error) {
    owner?.kind === 'owner' && owner.fail();
    return { ok: false, ...protocolStatus(error), committed: false };
  }
}

/**
 * Shared Claude runtime. Translation and tool formatting reuse the SDK adapter;
 * Claude Code owns the tool loop, and no tool ever executes inside Relay.
 */
export class ClaudePoolRuntime {
  constructor(
    private readonly pool: FreePoolPreferences,
    private readonly prepare: (
      body: Record<string, unknown>,
      signal: AbortSignal,
      sessionId?: string,
    ) => Promise<DispatchRoute[]>,
    private readonly limits: PoolLimits = {
      attempts: MAX_POOL_ATTEMPTS, firstContentMs: 20_000, idleMs: 20_000,
      totalMs: 60_000, bufferBytes: 65_536, cleanupMs: 1000,
    },
  ) {}

  async serve(
    body: Record<string, unknown>,
    write: (chunk: string) => void,
    signal: AbortSignal,
    sessionId?: string,
    trace?: (line: string) => void,
  ): Promise<ClaudeServeResult> {
    const routes = await this.prepare(body, signal, sessionId);
    // Effort was resolved per member while preparing routes (verified level sent, otherwise omitted),
    // so admission must not re-reject members for an effort that was deliberately not sent.
    const effort = 'auto';
    return serveClaudePool({
      pool: this.pool,
      routes,
      request: {
        modelId: String(body.model ?? CLAUDE_POOL_MODEL_ID),
        stream: body.stream === true,
        signal,
        effort,
      },
      limits: this.limits,
      write,
      trace,
      retryable: retryPoolFailure,
    });
  }
}
