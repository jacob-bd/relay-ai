import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { ClaudePoolRuntime } from '../src/pool/claude-runtime.js';
import { readPoolActivity } from '../src/pool/activity.js';
import type { DispatchRoute } from '../src/pool/dispatch.js';
import type { PoolEvent, PoolLimits } from '../src/pool/attempt.js';

const limits: PoolLimits = { attempts: 3, firstContentMs: 100, idleMs: 100, totalMs: 1000, bufferBytes: 8192, cleanupMs: 100 };
const ok: PoolEvent[] = [{ type: 'text-start' }, { type: 'text-delta', text: 'OK' }, { type: 'finish', finishReason: 'stop' }];
const pool = { members: ['first', 'second', 'third'].map(providerId => ({ providerId, modelId: 'm' })), effort: 'auto' as const };
function route(id: string): DispatchRoute {
  return {
    member: { providerId: id, modelId: 'm' }, revision: 'rev', freeStatus: 'verified_free',
    catalogVerified: true, accessVerified: true, billingSafe: true, targets: ['claude'],
    toolsVerified: true, defaultEffortVerified: true, effortLevels: [],
    contextFits: true, contextVerified: true,
    async open() { return (async function* () { yield* ok; })(); },
  };
}
const serve = (runtime: ClaudePoolRuntime) =>
  runtime.serve({ model: 'claude-pool', stream: true }, () => undefined, new AbortController().signal);

describe('why a preferred member was passed over', () => {
  beforeEach(() => { process.env['RELAY_AI_HOME'] = mkdtempSync(join(tmpdir(), 'relay-skiplog-')); });

  it('logs a skipped member that is ahead of the answerer, once, until the reason changes', async () => {
    let reason = 'request too large for its context window';
    const runtime = new ClaudePoolRuntime(pool, async (_b, _s, _id, onSkip) => {
      onSkip?.({ providerId: 'first', modelId: 'm' }, reason);
      onSkip?.({ providerId: 'third', modelId: 'm' }, 'no credential'); // behind the answerer: not shown
      return [route('second')];
    }, limits);
    await serve(runtime);
    await serve(runtime);
    const skips = () => readPoolActivity(20).filter(e => e.event === 'failed');
    expect(skips()).toHaveLength(1);
    expect(skips()[0]).toMatchObject({ providerId: 'first', reason: 'skipped: request too large for its context window' });
    reason = 'no credential';
    await serve(runtime);
    expect(skips()).toHaveLength(2);
  });

  it('does not repeat plain cooldowns, which already have their own failure entry', async () => {
    const runtime = new ClaudePoolRuntime(pool, async (_b, _s, _id, onSkip) => {
      onSkip?.({ providerId: 'first', modelId: 'm' }, 'cooling down after a failure');
      return [route('second')];
    }, limits);
    await serve(runtime);
    expect(readPoolActivity(20).filter(e => e.event === 'failed')).toEqual([]);
  });
});
