import { CodexRetryGuard, requestFingerprint } from './codex-retry.js';
import type { CodexToolContext } from '../codex-responses-adapter.js';
import type { IncomingHttpHeaders } from 'node:http';
import type { FreePoolPreferences } from '../types.js';
import { MAX_POOL_ATTEMPTS, type PoolLimits } from './attempt.js';
import { codexPoolIdentity } from './codex-identity.js';
import { PoolContinuationStore, type PoolRouteIdentity } from './continuation.js';
import { dispatchFreePool, type DispatchRoute } from './dispatch.js';
import { retryPoolFailure } from './errors.js';
import { PoolSessionRoutes } from './session.js';
import { writeCodexPoolResponse } from './codex-response.js';
import { randomUUID } from 'node:crypto';
import { describePoolFailure, poolRouteMember, recordPoolActivity } from './activity.js';
import { poolErrorDetail } from './diagnostic.js';

export const FREE_POOL_MODEL_ID = 'relay-free-pool';
export const FREE_POOL_PROVIDER_ID = 'relay-free-pool';
export const DEFAULT_POOL_LIMITS: PoolLimits = {
  attempts: MAX_POOL_ATTEMPTS, firstContentMs: 20_000, idleMs: 20_000,
  totalMs: 60_000, bufferBytes: 65_536, cleanupMs: 1000,
};
export interface CodexPoolRoute extends DispatchRoute { identity: PoolRouteIdentity; toolContext?: CodexToolContext; }
/** Shared runtime for HTTP and WebSocket adapters. Neither transport owns pool history. */
export class CodexPoolRuntime {
  private readonly history = new PoolContinuationStore({ ttlMs: 3_600_000 });
  private readonly sessions = new PoolSessionRoutes();
  private readonly retries = new CodexRetryGuard();
  constructor(
    private readonly pool: FreePoolPreferences,
    private readonly prepare: (body: Record<string, unknown>, source: string | undefined, signal: AbortSignal, sessionId: string,
      onSkip?: (member: { providerId: string; modelId: string }, reason: string) => void) => Promise<CodexPoolRoute[]>,
    private readonly limits = DEFAULT_POOL_LIMITS,
  ) {}
  async respond(
    headers: IncomingHttpHeaders,
    request: Record<string, unknown>,
    signal: AbortSignal,
    write: (chunk: string) => void,
  ): Promise<Record<string, unknown>> {
    if (request.model !== FREE_POOL_MODEL_ID) throw new Error('Pool runtime requires an explicit pool model');
    const identity = codexPoolIdentity(headers, request);
    if (!identity) throw new Error('Pool requires verified Codex conversation and turn metadata');
    const { body, source } = this.history.resolve(identity.conversation, request);
    const lease = this.retries.acquire(identity.turn, requestFingerprint(body));
    if (lease.kind === 'replay') {
      const cached = JSON.parse(lease.response) as { response: Record<string, unknown>; chunks: string[] };
      if (body.stream === true) for (const chunk of cached.chunks) write(chunk);
      return cached.response;
    }
    if (lease.kind !== 'owner') throw new Error('Pool retry ' + lease.kind);
    const chunks: string[] = [];
    let committed = false;
    // Which member answers is otherwise invisible: log it like the Claude runtime does.
    const requestId = randomUUID().slice(0, 8);
    const started = Date.now();
    let attemptStarted = started;
    let attemptedId: string | undefined;
    let logged = false;
    const skipped: Array<{ providerId: string; modelId: string; reason: string }> = [];
    try {
      const routes = await this.prepare(body, source, signal, identity.conversation,
        (member, reason) => skipped.push({ ...member, reason }));
      let served: CodexPoolRoute | undefined;
      const stream = dispatchFreePool(this.pool, routes, {
        // Members that have not verified the requested level run on the provider default (see prepareCodexPoolRoutes),
        // so admission must not re-reject them for an effort that was deliberately not sent.
        target: 'codex', effort: 'auto',
        tools: Array.isArray(body.tools) && body.tools.length > 0,
        signal, conversationScope: identity.conversation,
      }, {
        limits: this.limits, sessions: this.sessions, retryable: retryPoolFailure,
        onAttempt: id => {
          attemptedId = id;
          attemptStarted = Date.now();
          served = routes.find(route => JSON.stringify([route.member.providerId, route.revision, route.member.modelId]) === id);
        },
        onFailure: (id, error) => {
          const member = poolRouteMember(id);
          if (!member) return;
          const reason = describePoolFailure(error);
          const detail = reason.startsWith('simulated') ? undefined : poolErrorDetail(error);
          recordPoolActivity({ target: 'codex', event: 'failed', ...member, requestId, reason, ...(detail ? { detail } : {}), ms: Date.now() - attemptStarted });
        },
      });
      const response = await writeCodexPoolResponse(stream, FREE_POOL_MODEL_ID, chunk => {
        committed = true;
        chunks.push(chunk);
        write(chunk);
      }, { nonstream: body.stream !== true, getToolContext: () => served?.toolContext });
      const answered = attemptedId ? poolRouteMember(attemptedId) : undefined;
      if (answered) {
        logged = true;
        recordPoolActivity({ target: 'codex', event: 'served', ...answered, requestId, ms: Date.now() - attemptStarted });
      }
      if (!served || typeof response.id !== 'string' || !Array.isArray(response.output)) throw new Error('Pool response missing route or history');
      this.history.remember(response.id, identity.conversation, body, response.output as Record<string, unknown>[], served.identity);
      lease.complete(JSON.stringify({ response, chunks }));
      return response;
    } catch (error) {
      if (!logged && !signal.aborted) {
        // Closes the request in the log. Members left out before dispatch are listed here, so an empty pool says why.
        for (const item of skipped) {
          recordPoolActivity({ target: 'codex', event: 'failed', providerId: item.providerId, modelId: item.modelId, requestId, reason: 'skipped: ' + item.reason });
        }
        recordPoolActivity({ target: 'codex', event: 'gave-up', providerId: 'pool', modelId: 'none', requestId, ms: Date.now() - started });
      }
      if (signal.aborted) lease.release();
      else lease.fail('Pool request failed', committed);
      throw error;
    }
  }
}
