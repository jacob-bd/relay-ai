import { describe, expect, it } from 'vitest';
import { dispatchFreePool, type DispatchRoute } from '../src/pool/dispatch.js';
import type { PoolEvent } from '../src/pool/attempt.js';
const members = [{ providerId: 'account-a', modelId: 'm' }, { providerId: 'account-b', modelId: 'm' }];
const limits = { attempts: 3, firstContentMs: 100, idleMs: 100, totalMs: 1000, bufferBytes: 4096, cleanupMs: 100 };
function route(index: number, parts: PoolEvent[], opened: string[]): DispatchRoute {
  return {
    member: members[index], revision: 'rev1', freeStatus: 'verified_free', catalogVerified: true,
    accessVerified: true, billingSafe: true, targets: ['codex'], toolsVerified: true,
    defaultEffortVerified: true, effortLevels: ['high'], contextFits: true, contextVerified: true,
    async open() { opened.push(members[index].providerId); return (async function* () { yield* parts; })(); },
  };
}
const ok: PoolEvent[] = [{ type: 'text-delta', text: 'OK' }, { type: 'finish', finishReason: 'stop' }];
const request = () => ({ target: 'codex' as const, tools: true, signal: new AbortController().signal });
async function collect(routes: DispatchRoute[]) {
  const result = [];
  for await (const part of dispatchFreePool({ members, effort: 'high' }, routes, request(), { limits, retryable: () => true })) result.push(part);
  return result;
}
describe('production pool dispatch', () => {
  it('falls back between distinct accounts without leaking provisional output', async () => {
    const opened: string[] = [];
    const output = await collect([route(0, [{ type: 'start' }, { type: 'error', error: new Error('429') }], opened), route(1, ok, opened)]);
    expect(opened).toEqual(['account-a', 'account-b']);
    expect(output).toEqual(ok);
  });
  it('never opens a paid, undersized or unknown-effort fallback', async () => {
    for (const patch of [{ freeStatus: 'paid' as const }, { contextFits: false }, { effortLevels: ['medium'] }]) {
      const opened: string[] = [];
      const first = route(0, [{ type: 'error', error: new Error('429') }], opened);
      const second = { ...route(1, ok, opened), ...patch };
      await expect(collect([first, second])).rejects.toThrow('attempt-budget-exhausted');
      expect(opened).toEqual(['account-a']);
    }
  });
  it('refuses replay once content was exposed', async () => {
    const opened: string[] = [];
    await expect(collect([route(0, [{ type: 'text-delta', text: 'partial' }, { type: 'error', error: new Error('broken') }], opened), route(1, ok, opened)])).rejects.toMatchObject({ committed: true });
    expect(opened).toEqual(['account-a']);
  });
});
