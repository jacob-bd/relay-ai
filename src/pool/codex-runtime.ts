import { CodexRetryGuard, requestFingerprint } from './codex-retry.js';
import type { CodexToolContext } from '../codex-responses-adapter.js';
import type { IncomingHttpHeaders } from 'node:http';
import type { FreePoolPreferences } from '../types.js';
import type { PoolLimits } from './attempt.js';
import { codexPoolIdentity } from './codex-identity.js';
import { PoolContinuationStore, type PoolRouteIdentity } from './continuation.js';
import { dispatchFreePool, type DispatchRoute } from './dispatch.js';
import { retryPoolFailure } from './errors.js';
import { PoolSessionRoutes } from './session.js';
import { writeCodexPoolResponse } from './codex-response.js';

export const FREE_POOL_MODEL_ID = 'relay-free-pool';
export const DEFAULT_POOL_LIMITS: PoolLimits = {
  attempts: 3, firstContentMs: 20_000, idleMs: 20_000,
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
    private readonly prepare: (body: Record<string, unknown>, source: string | undefined, signal: AbortSignal, sessionId: string) => Promise<CodexPoolRoute[]>,
    private readonly limits = DEFAULT_POOL_LIMITS,
  ) {}
  async respond(
    headers: IncomingHttpHeaders,
    request: Record<string, unknown>,
    signal: AbortSignal,
    write: (chunk: string) => void,
  ): Promise<Record<string, unknown>> {
    if (request.model !== FREE_POOL_MODEL_ID) throw new Error('Pool runtime requires an explicit pool model');
    const identity = codexPoolIdentity(headers);
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
    try {
      const routes = await this.prepare(body, source, signal, identity.conversation);
      let served: CodexPoolRoute | undefined;
      const stream = dispatchFreePool(this.pool, routes, {
        target: 'codex', effort: (body.reasoning as { effort?: string } | undefined)?.effort,
        tools: Array.isArray(body.tools) && body.tools.length > 0,
        signal, conversationScope: identity.conversation,
      }, {
        limits: this.limits, sessions: this.sessions, retryable: retryPoolFailure,
        onAttempt: id => { served = routes.find(route => JSON.stringify([route.member.providerId, route.revision, route.member.modelId]) === id); },
      });
      const response = await writeCodexPoolResponse(stream, FREE_POOL_MODEL_ID, chunk => {
        committed = true;
        chunks.push(chunk);
        write(chunk);
      }, { nonstream: body.stream !== true, getToolContext: () => served?.toolContext });
      if (!served || typeof response.id !== 'string' || !Array.isArray(response.output)) throw new Error('Pool response missing route or history');
      this.history.remember(response.id, identity.conversation, body, response.output as Record<string, unknown>[], served.identity);
      lease.complete(JSON.stringify({ response, chunks }));
      return response;
    } catch (error) {
      if (signal.aborted) lease.release();
      else lease.fail('Pool request failed', committed);
      throw error;
    }
  }
}
