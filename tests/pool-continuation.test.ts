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

  it('strips opaque reasoning and undecodable compaction when readable history and images are present', () => {
    const imageUrl = 'data:image/png;base64,' + 'A'.repeat(5 * 1024 * 1024);
    const body = {
      model: 'pool',
      input: [
        { type: 'compaction', encrypted_content: 'native-opaque-compaction' },
        { type: 'reasoning', summary: [{ type: 'summary_text', text: 'earlier thought' }], encrypted_content: 'native-opaque-reasoning' },
        {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: 'check this screenshot' },
            { type: 'input_image', image_url: imageUrl },
          ],
        },
      ],
    };
    const params = preparePoolHistory(body, undefined, a, '@ai-sdk/openai-compatible');
    const serialized = JSON.stringify(params);
    expect(serialized).toContain('check this screenshot');
    expect(serialized).not.toContain('native-opaque-compaction');
    expect(serialized).not.toContain('native-opaque-reasoning');

    const store = new PoolContinuationStore();
    expect(() => store.remember('resp-img-1', 'session/branch', body, output, a)).not.toThrow();
    const resolved = store.resolve('session/branch', { ...delta, previous_response_id: 'resp-img-1' });
    const nextParams = preparePoolHistory(resolved.body, resolved.source, b, '@ai-sdk/openai-compatible');
    expect(JSON.stringify(nextParams)).toContain('check this screenshot');
    expect(JSON.stringify(nextParams)).toContain('RESULT');
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

it('retains a live conversation across more than 32 other responses within the budget', () => {
  const store = new PoolContinuationStore();
  store.remember('response1', 'live', original, output, a);
  for (let index = 0; index < 40; index++) {
    store.remember('response-' + index, 'other', { input: 'small' }, [], b);
  }
  expect(store.resolve('live', delta).body.input).toHaveLength(3);
});

it('refreshes recently read branches when the entry count is reached', () => {
  const store = new PoolContinuationStore({ maxEntries: 3 });
  store.remember('response1', 'live', original, output, a);
  store.remember('old', 'other', original, output, b);
  store.remember('new', 'other', original, output, b);
  store.resolve('live', delta);
  store.remember('newest', 'other', original, output, b);
  expect(() => store.resolve('live', delta)).not.toThrow();
  expect(() => store.resolve('other', { ...delta, previous_response_id: 'old' })).toThrow('missing Relay-owned history');
});

it('bounds total memory, least recently used first, and never evicts the snapshot just stored', () => {
  const store = new PoolContinuationStore({ maxTotalBytes: 1000 });
  const request = { input: 'x'.repeat(400) };
  store.remember('old', 'scope', request, [], a);
  store.remember('new', 'scope', request, [], a);
  store.remember('newest', 'scope', request, [], a);
  expect(() => store.resolve('scope', { input: [], previous_response_id: 'old' })).toThrow('missing Relay-owned history');
  expect(() => store.resolve('scope', { input: [], previous_response_id: 'newest' })).not.toThrow();
  const tiny = new PoolContinuationStore({ maxTotalBytes: 10 });
  tiny.remember('only', 'scope', request, [], a);
  expect(() => tiny.resolve('scope', { input: [], previous_response_id: 'only' })).not.toThrow();
});

describe('sessions that run side by side', () => {
  const src = { account: 'a', endpointRevision: 'r', model: 'm' };
  const turns = (count: number, tag: string, filler = '') => Array.from({ length: count },
    (_, index) => ({ type: 'message', role: 'user', content: tag + index + filler }));
  const resumes = (store: PoolContinuationStore, scope: string, id: string): boolean => {
    try { store.resolve(scope, { previous_response_id: id, input: [] }); return true; } catch { return false; }
  };

  it('keeps an idle session resumable while another works, with histories of about 1 MB', () => {
    const store = new PoolContinuationStore({ ttlMs: 3_600_000 });
    store.remember('A1', 'sessionA', { input: turns(600, 'a', 'x'.repeat(1500)) }, [], src);
    for (let index = 1; index <= 6; index++) {
      store.remember('B' + index, 'sessionB', { input: turns(600, 'b' + index, 'x'.repeat(1500)) }, [], src);
    }
    expect(resumes(store, 'sessionA', 'A1')).toBe(true);
  });

  it('keeps two long sessions of 1,200 items each resumable together', () => {
    const store = new PoolContinuationStore({ ttlMs: 3_600_000 });
    store.remember('A1', 'sessionA', { input: turns(1200, 'a') }, [], src);
    store.remember('B1', 'sessionB', { input: turns(1200, 'b') }, [], src);
    expect(resumes(store, 'sessionA', 'A1')).toBe(true);
    expect(resumes(store, 'sessionB', 'B1')).toBe(true);
  });
});
