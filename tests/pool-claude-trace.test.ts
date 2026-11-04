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
