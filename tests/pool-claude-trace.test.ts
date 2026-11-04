import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startProxyCatalog } from '../src/proxy.js';
import { CLAUDE_POOL_MODEL_ID, ClaudePoolRuntime } from '../src/pool/claude-runtime.js';
import type { DispatchRoute } from '../src/pool/dispatch.js';
import { getProxyDebugLogPath } from '../src/trace-log.js';
import { readPoolActivity } from '../src/pool/activity.js';

const base = {
  revision: 'rev', freeStatus: 'verified_free' as const, catalogVerified: true, accessVerified: true,
  billingSafe: true, targets: ['claude' as const], toolsVerified: true, defaultEffortVerified: true,
  effortLevels: [], contextFits: true, contextVerified: true,
};
const failing: DispatchRoute = { ...base, member: { providerId: 'kilo', modelId: 'first' },
  async open() { throw Object.assign(new Error('slow down'), { statusCode: 429 }); } };
const working: DispatchRoute = { ...base, member: { providerId: 'nvidia', modelId: 'second' },
  async open() {
    return (async function* () {
      yield { type: 'text-start', id: 't' };
      yield { type: 'text-delta', id: 't', text: 'OK' };
      yield { type: 'text-end', id: 't' };
      yield { type: 'finish', finishReason: 'stop' };
    })();
  } };

let handle: Awaited<ReturnType<typeof startProxyCatalog>>;
beforeAll(async () => {
  process.env['RELAY_AI_HOME'] = mkdtempSync(join(tmpdir(), 'relay-pool-trace-'));
  const pool = { members: [failing.member, working.member], effort: 'auto' as const, receipts: [] };
  const runtime = new ClaudePoolRuntime(pool, async () => [failing, working]);
  handle = await startProxyCatalog([], CLAUDE_POOL_MODEL_ID, true, {
    pool: { runtime, displayName: 'Relay Free Pool', contextWindow: 128000 },
  });
});
afterAll(() => handle?.close());

describe('pool attempts in the trace log and activity log', () => {
  it('records the failed member, the fallback and the answering member', async () => {
    const res = await fetch('http://127.0.0.1:' + handle.port + '/v1/messages', {
      method: 'POST', headers: { authorization: 'Bearer ' + handle.token, 'content-type': 'application/json' },
      body: JSON.stringify({ model: CLAUDE_POOL_MODEL_ID, max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(res.status).toBe(200);
    const trace = readFileSync(getProxyDebugLogPath(), 'utf8');
    expect(trace).toContain('pool request: 2 eligible member(s): kilo/first, nvidia/second');
    expect(trace).toContain('pool attempt: kilo/first');
    expect(trace).toContain('pool failed: kilo/first (rate limit (429))');
    expect(trace).toContain('pool answered: nvidia/second');
    const activity = readPoolActivity(5);
    expect(activity.map(e => `${e.event}:${e.providerId}`)).toEqual(['served:nvidia', 'failed:kilo']);
  });
});

describe('RELAY_POOL_FORCE_FAIL test switch', () => {
  it('fails the named member without calling it and lets the next member answer', async () => {
    process.env['RELAY_POOL_FORCE_FAIL'] = 'nvidia/second';
    let calls = 0;
    const counting: DispatchRoute = { ...working, open: async (...args) => { calls++; return working.open(...args); } };
    const pool = { members: [counting.member, failing.member], effort: 'auto' as const, receipts: [] };
    const okFirst: DispatchRoute = { ...base, member: { providerId: 'kilo', modelId: 'fine' },
      async open() { return (async function* () {
        yield { type: 'text-start', id: 't' }; yield { type: 'text-delta', id: 't', text: 'FALLBACK_OK' };
        yield { type: 'text-end', id: 't' }; yield { type: 'finish', finishReason: 'stop' };
      })(); } };
    const runtime = new ClaudePoolRuntime({ ...pool, members: [counting.member, okFirst.member] }, async () => [counting, okFirst]);
    const out: string[] = [];
    const result = await runtime.serve({ model: CLAUDE_POOL_MODEL_ID, max_tokens: 64, stream: true, messages: [{ role: 'user', content: 'hi' }] },
      chunk => { out.push(chunk); }, new AbortController().signal);
    delete process.env['RELAY_POOL_FORCE_FAIL'];
    expect(result.ok).toBe(true);
    expect(out.join('')).toContain('FALLBACK_OK');
    expect(calls).toBe(0);
    const [served, failed] = readPoolActivity(2);
    expect(served).toMatchObject({ event: 'served', providerId: 'kilo' });
    expect(failed).toMatchObject({ event: 'failed', providerId: 'nvidia', reason: 'simulated failure (test switch)' });
  });
});

describe('a member that is cooling down is skipped, not fatal', () => {
  it('moves on to the next member when the first is cooling down', async () => {
    const cooling: DispatchRoute = { ...base, member: { providerId: 'nvidia', modelId: 'cooling' },
      async open() { throw new Error('Pool route entered cooldown'); } };
    const fine: DispatchRoute = { ...working, member: { providerId: 'go', modelId: 'fine' } };
    const runtime = new ClaudePoolRuntime({ members: [cooling.member, fine.member], effort: 'auto', receipts: [] }, async () => [cooling, fine]);
    const out: string[] = [];
    const result = await runtime.serve({ model: CLAUDE_POOL_MODEL_ID, max_tokens: 64, stream: true, messages: [{ role: 'user', content: 'hi' }] },
      chunk => { out.push(chunk); }, new AbortController().signal);
    expect(result.ok).toBe(true);
    expect(out.join('')).toContain('OK');
    const [served, failed] = readPoolActivity(2);
    expect(served).toMatchObject({ event: 'served', providerId: 'go' });
    expect(failed).toMatchObject({ event: 'failed', providerId: 'nvidia', reason: 'skipped: cooling down after a recent failure' });
  });
});

describe('every member is tried before the request gives up', () => {
  const failWith = (providerId: string, modelId: string, error: unknown): DispatchRoute => ({
    ...base, member: { providerId, modelId }, async open() { throw error; },
  });

  it('keeps going past a 400, an unknown error and a rate limit until a later member answers', async () => {
    const members = [
      failWith('kilo', 'a', Object.assign(new Error('bad request'), { statusCode: 400 })),
      failWith('nvidia', 'b', new Error('something unrecognised')),
      failWith('go', 'c', Object.assign(new Error('slow down'), { statusCode: 429 })),
      { ...working, member: { providerId: 'github-copilot', modelId: 'd' } },
    ];
    const runtime = new ClaudePoolRuntime({ members: members.map(m => m.member), effort: 'auto', receipts: [] }, async () => members);
    const out: string[] = [];
    const result = await runtime.serve({ model: CLAUDE_POOL_MODEL_ID, max_tokens: 64, stream: true, messages: [{ role: 'user', content: 'hi' }] },
      chunk => { out.push(chunk); }, new AbortController().signal);
    expect(result.ok).toBe(true);
    expect(out.join('')).toContain('OK');
    const events = readPoolActivity(4).reverse().map(e => `${e.event}:${e.providerId}`);
    expect(events).toEqual(['failed:kilo', 'failed:nvidia', 'failed:go', 'served:github-copilot']);
  });
});
