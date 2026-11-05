import { describe, expect, it } from 'vitest';
import { ClaudeHistoryEmbargo, ClaudePoolRuntime } from '../src/pool/claude-runtime.js';
import type { DispatchRoute } from '../src/pool/dispatch.js';
import type { PoolEvent, PoolLimits } from '../src/pool/attempt.js';

const limits: PoolLimits = {
  attempts: 1, firstContentMs: 1_000, idleMs: 1_000, totalMs: 2_000,
  bufferBytes: 8192, cleanupMs: 100,
};
const member = { providerId: 'account', modelId: 'm' };
const base = {
  member, revision: 'rev', freeStatus: 'verified_free' as const, catalogVerified: true,
  accessVerified: true, billingSafe: true, targets: ['claude' as const], toolsVerified: true,
  defaultEffortVerified: true, effortLevels: [], contextFits: true, contextVerified: true,
};
const ok: PoolEvent[] = [
  { type: 'text-start', id: 't' },
  { type: 'text-delta', id: 't', text: 'OK' },
  { type: 'text-end', id: 't' },
  { type: 'finish', finishReason: 'stop' },
];
const body = (text = 'same request') => ({
  model: 'claude-pool', max_tokens: 64, stream: true,
  messages: [{ role: 'user', content: text }],
});
const pool = { members: [member], effort: 'auto' as const, receipts: [] };
const signal = () => new AbortController().signal;

function runtime(
  open: (call: number, signal: AbortSignal) => Promise<AsyncIterable<PoolEvent>>,
  log: { opens: number },
): ClaudePoolRuntime {
  const route: DispatchRoute = {
    ...base,
    open(signal) {
      log.opens += 1;
      return open(log.opens, signal);
    },
  };
  return new ClaudePoolRuntime(pool, async () => [route], limits);
}

async function waitFor(value: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !value(); attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  if (!value()) throw new Error('condition not reached');
}

describe('Claude pool duplicate guard', () => {
  it('rejects an identical concurrent request but lets a different body through', async () => {
    let releaseFirst!: () => void;
    const gate = new Promise<void>(resolve => { releaseFirst = resolve; });
    const log = { opens: 0 };
    const rt = runtime(async (call, signal) => {
      if (call === 1) await gate;
      return (async function* () { yield* ok; })();
    }, log);

    const first = rt.serve(body(), () => {}, signal(), 'session-1');
    await waitFor(() => log.opens === 1);
    let identical: Awaited<ReturnType<typeof rt.serve>>;
    let different: Awaited<ReturnType<typeof rt.serve>>;
    try {
      identical = await rt.serve(body(), () => {}, signal(), 'session-1');
      different = await rt.serve(body('different prompt'), () => {}, signal(), 'session-1');
    } finally {
      releaseFirst();
      await first.catch(() => undefined);
    }

    expect(identical).toMatchObject({
      ok: false,
      status: 429,
      committed: false,
      error: { type: 'rate_limit_error', message: 'A matching request is already in flight' },
    });
    expect(different).toMatchObject({ ok: true });
    expect(log.opens).toBe(2);
  });

  it('allows a pre-commit retry and cancellation, but blocks a post-commit retry', async () => {
    const log = { opens: 0 };
    const rt = runtime(async (call, abortSignal) => {
      if (call === 1) throw Object.assign(new Error('slow down'), { statusCode: 429 });
      if (call === 2) return (async function* () { yield* ok; })();
      if (call === 3) return (async function* () {
        yield { type: 'text-start', id: 't' } as PoolEvent;
        yield { type: 'text-delta', id: 't', text: 'PARTIAL' } as PoolEvent;
        yield { type: 'error', error: new Error('upstream broke') } as PoolEvent;
      })();
      if (call === 5) return (async function* () { yield* ok; })();
      return (async function* () {
        yield { type: 'text-start', id: 't' } as PoolEvent;
        yield { type: 'text-delta', id: 't', text: 'PARTIAL' } as PoolEvent;
        await new Promise<void>((_, reject) => {
          if (abortSignal.aborted) return reject(abortSignal.reason);
          abortSignal.addEventListener('abort', () => reject(abortSignal.reason), { once: true });
        });
      })();
    }, log);

    const failed = await rt.serve(body(), () => {}, signal(), 'session-retry');
    expect(failed).toMatchObject({ ok: false, committed: false });
    const retried = await rt.serve(body(), () => {}, signal(), 'session-retry');
    expect(retried).toMatchObject({ ok: true });

    const committed = await rt.serve(body(), () => {}, signal(), 'session-postcommit');
    expect(committed).toMatchObject({ ok: false, committed: true });
    const blocked = await rt.serve(body(), () => {}, signal(), 'session-postcommit');
    expect(blocked).toMatchObject({
      ok: false,
      status: 429,
      committed: false,
      error: { type: 'rate_limit_error', message: 'A matching request recently failed' },
    });

    const controller = new AbortController();
    const cancelled = rt.serve(body(), () => {}, controller.signal, 'session-cancel');
    await waitFor(() => log.opens === 4);
    controller.abort(new Error('client disconnected'));
    await expect(cancelled).resolves.toMatchObject({ ok: false, committed: true });
    const cancelRetry = await rt.serve(body(), () => {}, signal(), 'session-cancel');
    expect(cancelRetry).toMatchObject({ ok: true });
    expect(log.opens).toBe(5);
  });

  it('keeps a post-commit embargo when the error write throws', async () => {
    const log = { opens: 0 };
    const rt = runtime(async () => (async function* () {
      yield { type: 'text-start', id: 't' } as PoolEvent;
      yield { type: 'text-delta', id: 't', text: 'PARTIAL' } as PoolEvent;
      yield { type: 'error', error: new Error('upstream broke') } as PoolEvent;
    })(), log);
    const write = (chunk: string) => {
      if (chunk.includes('event: error')) throw new Error('socket closed');
    };

    const first = await rt.serve(body(), write, signal(), 'session-socket');
    expect(first).toMatchObject({ ok: false });
    const retried = await rt.serve(body(), () => {}, signal(), 'session-socket');
    expect(retried).toMatchObject({
      ok: false,
      status: 429,
      error: { type: 'rate_limit_error', message: 'A matching request recently failed' },
    });
    expect(log.opens).toBe(1);
  });

  it('keeps an active claim past its terminal TTL and expires only failures', () => {
    let now = 0;
    const embargo = new ClaudeHistoryEmbargo(10, 10, () => now);
    const active = embargo.claim('scope', 'active');
    expect(active.kind).toBe('owner');
    now = 60_000;
    expect(embargo.claim('scope', 'active')).toEqual({ kind: 'busy' });
    if (active.kind !== 'owner') throw new Error('unreachable');
    active.fail();
    now += 11;
    expect(embargo.claim('scope', 'active').kind).toBe('owner');
  });
});
