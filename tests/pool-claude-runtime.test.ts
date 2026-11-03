import { describe, expect, it } from 'vitest';
import { ClaudeHistoryEmbargo, serveClaudePool } from '../src/pool/claude-runtime.js';
import type { DispatchRoute } from '../src/pool/dispatch.js';
import type { PoolEvent, PoolLimits } from '../src/pool/attempt.js';

const limits: PoolLimits = { attempts: 3, firstContentMs: 100, idleMs: 100, totalMs: 1000, bufferBytes: 8192, cleanupMs: 100 };
const member = { providerId: 'account-a', modelId: 'claude-target' };
const pool = { members: [member], effort: 'auto' as const };
function poolWith(...ids: string[]) {
  return { members: ids.map(providerId => ({ ...member, providerId })), effort: 'auto' as const };
}
function route(events: PoolEvent[], opened: string[], id = 'account-a'): DispatchRoute {
  return {
    member: { ...member, providerId: id }, revision: 'rev1', freeStatus: 'verified_free',
    catalogVerified: true, accessVerified: true, billingSafe: true, targets: ['claude'],
    toolsVerified: true, defaultEffortVerified: true, effortLevels: ['high'],
    contextFits: true, contextVerified: true,
    async open() { opened.push(id); return (async function* () { yield* events; })(); },
  };
}
const ok: PoolEvent[] = [{ type: 'text-start' }, { type: 'text-delta', text: 'RELAY_OK' }, { type: 'finish', finishReason: 'stop' }];
function request(stream = true) {
  return { modelId: 'claude-pool', stream, signal: new AbortController().signal };
}

describe('Claude pool runtime', () => {
  it('streams one protocol-valid message through bounded failover', async () => {
    const opened: string[] = [];
    const output: string[] = [];
    const result = await serveClaudePool({
      pool: poolWith('account-a', 'account-b'),
      routes: [route([{ type: 'error', error: new Error('HTTP 429') }], opened, 'account-a'), route(ok, opened, 'account-b')],
      request: request(), limits, write: chunk => output.push(chunk),
    });
    expect(result.ok).toBe(true);
    expect(opened).toEqual(['account-a', 'account-b']);
    const text = output.join('');
    expect(text.match(/event: message_start/g)).toHaveLength(1);
    expect(text.match(/event: message_stop/g)).toHaveLength(1);
    expect(text).toContain('RELAY_OK');
  });

  it('never replays after content was committed and emits one protocol error', async () => {
    const opened: string[] = [];
    const output: string[] = [];
    const result = await serveClaudePool({
      pool: poolWith('account-a', 'account-b'),
      routes: [route([{ type: 'text-delta', text: 'PARTIAL' }, { type: 'error', error: new Error('broken') }], opened, 'account-a'), route(ok, opened, 'account-b')],
      request: request(), limits, write: chunk => output.push(chunk),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.committed).toBe(true);
    expect(opened).toEqual(['account-a']);
    const text = output.join('');
    expect(text).toContain('PARTIAL');
    expect(text.match(/event: error/g)).toHaveLength(1);
  });

  it('returns a protocol error before commitment when nothing is eligible', async () => {
    const write: string[] = [];
    const result = await serveClaudePool({
      pool: { members: [member], effort: 'auto' },
      routes: [{ ...route(ok, []), freeStatus: 'paid' }],
      request: request(), limits, write: chunk => write.push(chunk),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.committed).toBe(false);
    expect(result.error.type).toBe('api_error');
    expect(result.error.message).toContain('No eligible free pool members');
    expect(write).toEqual([]);
  });

  it('serves bounded nonstream JSON with the installed Anthropic parser', async () => {
    const result = await serveClaudePool({
      pool, routes: [route(ok, [])], request: request(false), limits,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.message?.content).toEqual([{ type: 'text', text: 'RELAY_OK' }]);
    expect(result.message?.stop_reason).toBe('end_turn');
  });

  it('formats a complete tool call without executing it', async () => {
    let executed = false;
    const result = await serveClaudePool({
      pool,
      routes: [route([
        { type: 'tool-input-start', id: 'tool-1', toolName: 'read_file' },
        { type: 'tool-input-delta', id: 'tool-1', delta: '{"path":"x"}' },
        { type: 'tool-call', toolCallId: 'tool-1', toolName: 'read_file', input: { path: 'x' }, execute: () => { executed = true; } } as PoolEvent,
        { type: 'finish', finishReason: 'tool-calls' },
      ], [])],
      request: request(false), limits,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.message?.content).toEqual([{ type: 'tool_use', id: 'tool-1', name: 'read_file', input: { path: 'x' } }]);
    expect(result.message?.stop_reason).toBe('tool_use');
    expect(executed).toBe(false);
  });

  it('bounds nonstream wire bytes without opening a fallback', async () => {
    const opened: string[] = [];
    const result = await serveClaudePool({
      pool: poolWith('account-a', 'account-b'),
      routes: [route([{ type: 'text-delta', text: 'x'.repeat(2048) }, { type: 'finish', finishReason: 'stop' }], opened, 'account-a'), route(ok, opened, 'account-b')],
      request: { ...request(false), maxOutputBytes: 800 }, limits,
    });
    expect(result.ok).toBe(false);
    expect(opened).toEqual(['account-a']);
  });
});

describe('explicitly approximate history embargo', () => {
  it('rejects in-flight duplicates, blocks failures and allows changed history', () => {
    const embargo = new ClaudeHistoryEmbargo(1000, 10, () => 0);
    const first = embargo.claim('session/branch', 'history-a');
    expect(first.kind).toBe('owner');
    expect(embargo.claim('session/branch', 'history-a')).toEqual({ kind: 'busy' });
    expect(embargo.claim('session/branch', 'history-b').kind).toBe('owner');
    if (first.kind !== 'owner') throw new Error('unreachable');
    first.fail();
    expect(embargo.claim('session/branch', 'history-a')).toEqual({ kind: 'blocked' });
  });

  it('never evicts an active claim at capacity and expires terminal claims', () => {
    let now = 0;
    const embargo = new ClaudeHistoryEmbargo(10, 1, () => now);
    const owner = embargo.claim('scope', 'h1');
    expect(owner.kind).toBe('owner');
    expect(embargo.claim('scope', 'h2')).toEqual({ kind: 'blocked' });
    if (owner.kind !== 'owner') throw new Error('unreachable');
    owner.fail();
    now = 11;
    expect(embargo.claim('scope', 'h2').kind).toBe('owner');
    expect(() => embargo.claim('', 'h')).toThrow('scope-and-history-required');
  });
});
