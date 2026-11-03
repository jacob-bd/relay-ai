import { describe, expect, it } from 'vitest';
import { createLanguageModel } from '../src/provider-factory.js';
import { encodeToolUseId } from '../src/proxy-shared.js';
import {
  PoolContinuationStore,
  poolRouteKey,
  preparePoolHistory,
  type PoolRouteIdentity,
} from '../src/pool/continuation.js';
const a: PoolRouteIdentity = { account: 'groq', endpointRevision: 'endpoint-v1', model: 'same-model' };
const b: PoolRouteIdentity = { ...a, account: 'groq-2' };
const original = { model: 'pool', input: 'ORIGINAL_HISTORY', instructions: 'KEEP_INSTRUCTIONS' };
const output = [{ type: 'function_call', call_id: 'call1', name: 'read', arguments: '{}' }];
const delta = { model: 'pool', previous_response_id: 'response1', input: [{ type: 'function_call_output', call_id: 'call1', output: 'RESULT' }] };

describe('scoped pool continuation', () => {
  it('reconstructs identical history for repeated reads and switching accounts', () => {
    const store = new PoolContinuationStore();
    store.remember('response1', 'session/branch', original, output, a);
    const http = store.resolve('session/branch', delta);
    const ws = store.resolve('session/branch', delta);
    expect(http).toEqual(ws);
    expect(http.body.previous_response_id).toBeUndefined();
    expect(http.body.instructions).toBe('KEEP_INSTRUCTIONS');
    const params = preparePoolHistory(http.body, http.source, b, '@ai-sdk/openai-compatible');
    expect(params.messages.map(x => x.role)).toEqual(['user', 'assistant', 'tool']);
    expect(JSON.stringify(params)).toContain('ORIGINAL_HISTORY');
    expect(JSON.stringify(params)).toContain('RESULT');
  });

  it('never consumes or shares mutable history between branches', () => {
    const store = new PoolContinuationStore();
    store.remember('response1', 'session/branch-a', original, output, a);
    const left = store.resolve('session/branch-a', delta);
    left.body.input[0].content = 'MUTATED';
    expect(JSON.stringify(store.resolve('session/branch-a', delta))).toContain('ORIGINAL_HISTORY');
    expect(original.input).toBe('ORIGINAL_HISTORY');
    expect(() => store.resolve('session/branch-b', delta)).toThrow('missing Relay-owned history');
  });

  it('refuses unknown, expired, evicted and untariffed ids instead of replaying partial history', () => {
    let now = 0;
    const store = new PoolContinuationStore({ maxEntries: 1, ttlMs: 10 }, () => now);
    store.remember('response1', 'scope', original, output, a);
    expect(() => store.resolve('other-session', delta)).toThrow('missing Relay-owned history');
    now = 11;
    store.remember('response2', 'scope', original, output, a);
    expect(() => store.resolve('scope', delta)).toThrow('missing Relay-owned history');
    expect(() => store.resolve('scope', { ...delta, input: output })).toThrow('missing Relay-owned history');
    expect(() => store.resolve('scope', { ...delta, previous_response_id: '' })).toThrow('invalid response id');
  });

  it('bounds bytes and item counts, and requires a real session branch', () => {
    const state = { model: 'pool', input: 'x'.repeat(200) };
    expect(() => new PoolContinuationStore({ maxBytes: 100 }).remember('id', 'scope', state, output, a)).toThrow('too-large');
    expect(() => new PoolContinuationStore({ maxItems: 1 }).remember('id', 'scope', state, output, a)).toThrow('too-large');
    expect(() => new PoolContinuationStore().remember('id', '', state, output, a)).toThrow('session-and-branch');
    expect(() => new PoolContinuationStore({ ttlMs: 0 })).toThrow('Invalid continuation limit');
  });
});

describe('route-bound signatures and opaque state', () => {
  it.each(['inline', 'legacy', 'registry'])('normalizes paired %s ids and strips foreign signatures without mutating history', mode => {
    const signature = 'route-owned-signature';
    const id = mode === 'legacy' ? 'call1::ts::' + signature : encodeToolUseId('call1-' + mode, signature, mode !== 'registry');
    const rawId = mode === 'legacy' ? 'call1' : 'call1-' + mode;
    const body = { model: 'pool', input: [
      { type: 'message', role: 'user', content: 'keep text __ts__ literally' },
      { type: 'function_call', call_id: id, name: 'read', arguments: '{}' },
      { type: 'function_call_output', call_id: id, output: 'result' },
    ] };
    const snapshot = structuredClone(body);
    const same = preparePoolHistory(body, poolRouteKey(a), a, '@ai-sdk/google');
    expect(JSON.stringify(same)).toContain(signature);
    const switched = preparePoolHistory(body, poolRouteKey(a), b, '@ai-sdk/google');
    expect(JSON.stringify(switched)).not.toContain(signature);
    const parts = switched.messages.flatMap(m => Array.isArray(m.content) ? m.content : []);
    expect(parts.filter(p => p.type === 'tool-call' || p.type === 'tool-result').map(p => p.toolCallId)).toEqual([rawId, rawId]);
    expect(JSON.stringify(switched)).toContain('keep text __ts__ literally');
    expect(body).toEqual(snapshot);
  });

  it.each(['compaction', 'context_compaction', 'reasoning'])('refuses opaque %s before translation can lose it', type => {
    expect(() => preparePoolHistory({ model: 'pool', input: [{ type, encrypted_content: 'native-opaque' }] }, poolRouteKey(a), b, '@ai-sdk/google')).toThrow('opaque provider state');
  });

  it('preserves Relay-readable compaction', () => {
    const encrypted_content = Buffer.from(JSON.stringify({ v: 1, summary: 'KEEP_SUMMARY' })).toString('base64');
    const params = preparePoolHistory({ model: 'pool', input: [{ type: 'compaction', encrypted_content }] }, poolRouteKey(a), b, '@ai-sdk/google');
    expect(JSON.stringify(params)).toContain('KEEP_SUMMARY');
  });
});

describe('account identity', () => {
  it('keeps same-model accounts and endpoint revisions distinct', async () => {
    const models = new Map();
    for (const route of [a, b]) models.set(poolRouteKey(route), await createLanguageModel({
      npm: '@ai-sdk/openai-compatible', modelId: route.model, providerId: route.account,
      apiKey: 'fake-' + route.account, baseURL: 'http://127.0.0.1:1/' + route.account + '/v1',
    }));
    expect(models.size).toBe(2);
    expect(models.get(poolRouteKey(a))).not.toBe(models.get(poolRouteKey(b)));
    expect(poolRouteKey(a)).not.toBe(poolRouteKey({ ...a, endpointRevision: 'endpoint-v2' }));
    expect(poolRouteKey(a)).not.toBe(poolRouteKey({ ...a, model: 'other-model' }));
  });
});
