import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LanguageModel } from 'ai';
import { sdkPoolRoute } from '../src/pool/sdk-route.js';
import { runPoolAttempts, type PoolEvent, type PoolLimits, type PoolRoute } from '../src/pool/attempt.js';
import { writeCodexPoolResponse } from '../src/pool/codex-response.js';
import { PoolHealthStore, poolAccountScope } from '../src/pool/health.js';
import type { PoolHealthStore as HealthStore } from '../src/pool/health.js';
import { retryPoolFailure } from '../src/pool/errors.js';
import type { PoolRouteEvidence } from '../src/pool/eligibility.js';
import { ClaudePoolRuntime } from '../src/pool/claude-runtime.js';
import type { DispatchRoute } from '../src/pool/dispatch.js';
import { PoolContinuationStore, poolRouteKey, preparePoolHistory } from '../src/pool/continuation.js';
import { encodeToolUseId } from '../src/proxy-shared.js';

const evidence = (providerId = 'account-2', revision = 'rev'): PoolRouteEvidence => ({
  member: { providerId, modelId: 'm' }, revision,
  freeStatus: 'verified_free', catalogVerified: true, accessVerified: true,
  billingSafe: true, targets: ['codex'], toolsVerified: true,
  defaultEffortVerified: true, effortLevels: ['high'],
  contextFits: true, contextVerified: true,
});
const limits: PoolLimits = {
  attempts: 1, firstContentMs: 100, idleMs: 100, totalMs: 500,
  bufferBytes: 4096, cleanupMs: 100,
};
const routeId = (route: DispatchRoute) => JSON.stringify([
  route.member.providerId, route.revision, route.member.modelId,
]);
const drain = async (route: DispatchRoute, signal = new AbortController().signal) => {
  const runnable: PoolRoute = { ...route, id: routeId(route) };
  for await (const _part of runPoolAttempts([runnable], signal, limits, retryPoolFailure)) { /* drain */ }
};
let root: string;
let clock: number;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'relay-pool-round2-'));
  clock = 1_800_000_000_000;
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
});

describe('round-two pool gaps', () => {
  it('releases a recovery claim that resolves after the client cancels', async () => {
    let finishAcquire!: (decision: unknown) => void;
    let released = 0;
    const health = { acquire: () => new Promise(resolve => { finishAcquire = resolve; }) } as unknown as HealthStore;
    const route = sdkPoolRoute(evidence(), {} as LanguageModel,
      { messages: [], maxOutputTokens: 128 }, { store: health, scopes: ['scope'] });
    const controller = new AbortController();
    const operation = drain(route, controller.signal).catch(error => error);
    await new Promise(resolve => setTimeout(resolve, 10));
    controller.abort(new Error('client disconnected during acquire'));
    await expect(operation).resolves.toMatchObject({ message: 'client disconnected during acquire' });
    finishAcquire({ ok: true, mode: 'recovery', settle: async () => {}, release: async () => { released += 1; } });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(released).toBe(1);
  });

  it('never lets a shorter concurrent failure replace an authoritative rate limit', async () => {
    const store = new PoolHealthStore({ root, now: () => clock });
    const scopes = [poolAccountScope('account-2')];
    const authoritative = clock + 7 * 24 * 60 * 60_000;
    await store.record(scopes, { kind: 'rate-limit', status: 429, retryAt: authoritative });
    await store.record(scopes, { kind: 'rate-limit', status: 429 });
    expect(await store.cooldownFor({ id: 'rev', scopes })).toBe(authoritative);
  });

  it('buffers a formatter-synthesized completion so history failure cannot execute a tool batch', async () => {
    let now = 1_800_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const stream = (async function* (): AsyncGenerator<PoolEvent> {
      yield { type: 'text-start', id: 't' };
      yield { type: 'tool-input-start', id: 'call', toolName: 'shell' };
      yield { type: 'tool-call', toolCallId: 'call', toolName: 'shell', input: {} };
      for (let index = 0; index < 5; index += 1) {
        now += 3_000;
        yield { type: 'text-delta', id: 't', text: 'A'.repeat(250) };
      }
    })();
    const chunks: string[] = [];
    await expect(writeCodexPoolResponse(stream, 'relay-free-pool', chunk => chunks.push(chunk), {
      beforeComplete: () => { throw new Error('continuation-history-too-large'); },
    })).rejects.toThrow('continuation-history-too-large');
    const events = chunks.join('').split('\n')
      .filter(line => line.startsWith('data:'))
      .map(line => JSON.parse(line.slice(5)) as { type?: string; item?: { type?: string; name?: string } });
    expect(events.some(event => event.type === 'response.output_item.done'
      && event.item?.type === 'function_call' && event.item.name === 'shell')).toBe(false);
  });

  it('keeps an old route signature out of a later same-route turn after a failover', () => {
    const a = { account: 'a', endpointRevision: 'ra', model: 'm' };
    const b = { account: 'b', endpointRevision: 'rb', model: 'm' };
    const signature = 'SIGNATURE-FROM-ROUTE-A';
    const encoded = encodeToolUseId('call-from-a', signature, true);
    const store = new PoolContinuationStore({ ttlMs: 3_600_000 });
    store.remember('response-a', 'branch', {
      model: 'relay-free-pool',
      input: [{ type: 'function_call', call_id: encoded, name: 'read', arguments: '{}' }],
    }, [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'read it' }] }], a);

    const turnB = store.resolve('branch', {
      model: 'relay-free-pool', previous_response_id: 'response-a',
      input: [{ type: 'function_call_output', call_id: encoded, output: 'ok' }],
    });
    const switched = preparePoolHistory(turnB.body, turnB.source, b, '@ai-sdk/google');
    expect(JSON.stringify(switched)).not.toContain(signature);
    store.remember('response-b', 'branch', turnB.body,
      [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'done' }] }], b);

    const turnC = store.resolve('branch', { model: 'relay-free-pool', previous_response_id: 'response-b', input: [] });
    const sameRoute = preparePoolHistory(turnC.body, turnC.source, b, '@ai-sdk/google');
    expect(turnC.source).toBe(poolRouteKey(b));
    expect(JSON.stringify(sameRoute)).not.toContain(signature);
  });

  it('rejects an identical concurrent Claude request while the first is still in flight', async () => {
    let opens = 0;
    let releaseFirst!: () => void;
    const gate = new Promise<void>(resolve => { releaseFirst = resolve; });
    const route = (): DispatchRoute => ({
      ...evidence(), targets: ['claude'],
      recordFailure: async () => {},
      async open() {
        opens += 1;
        const mine = opens;
        return (async function* () {
          if (mine === 1) await gate;
          yield { type: 'text-start', id: 't' } as PoolEvent;
          yield { type: 'text-delta', id: 't', text: 'OK' } as PoolEvent;
          yield { type: 'text-end', id: 't' } as PoolEvent;
          yield { type: 'finish', finishReason: 'stop' } as PoolEvent;
        })();
      },
    });
    const runtime = new ClaudePoolRuntime(
      { members: [evidence().member], effort: 'auto', receipts: [] },
      async () => [route()],
      { ...limits, attempts: 1, totalMs: 2_000, firstContentMs: 1_000, idleMs: 1_000 },
    );
    const body = { model: 'claude-pool', max_tokens: 64, stream: true,
      messages: [{ role: 'user', content: 'same request' }] };
    const first = runtime.serve(body, () => {}, new AbortController().signal, 'same-claude-session');
    while (opens === 0) await new Promise(resolve => setTimeout(resolve, 5));
    const secondPromise = runtime.serve(body, () => {}, new AbortController().signal, 'same-claude-session');
    let second: unknown;
    try {
      second = await Promise.race([
        secondPromise,
        new Promise(resolve => setTimeout(() => resolve('still-open'), 200)),
      ]);
      expect(second).toMatchObject({ ok: false, status: 429 });
    } finally {
      releaseFirst();
      await first.catch(() => undefined);
      await secondPromise.catch(() => undefined);
    }
    expect(opens).toBe(1);
  });
});
