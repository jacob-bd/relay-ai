import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { streamText } from 'ai';
import { createLanguageModel } from '../src/provider-factory.js';
import { startCloudCodeGateway, type CloudCodeGatewayHandle } from '../src/antigravity/cloud-code-gateway.js';
import type { AntigravityRoute } from '../src/antigravity/types.js';
import { PoolHealthStore, poolAccountScope, poolEndpointScope } from '../src/pool/health.js';
import type { PoolLimits } from '../src/pool/attempt.js';
import type { LocalProvider, PoolCapabilityReceipt } from '../src/types.js';
import { buildAntigravityPoolRoutes } from '../src/pool/antigravity.js';
import { poolEndpointRevision } from '../src/pool/capabilities.js';
import { readPoolActivity } from '../src/pool/activity.js';

vi.mock('ai', () => ({
  streamText: vi.fn(),
  generateText: vi.fn(),
  jsonSchema: vi.fn(schema => schema),
  tool: vi.fn(def => def),
}));
vi.mock('../src/provider-factory.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/provider-factory.js')>()),
  createLanguageModel: vi.fn(),
  maxToolsForNpm: vi.fn().mockReturnValue(undefined),
}));

const LIMITS: PoolLimits = { attempts: 8, firstContentMs: 150, idleMs: 150, totalMs: 2000, bufferBytes: 65_536, cleanupMs: 100 };
const NOW = () => Date.now();
const revisionFor = (id: string) => (id + '0'.repeat(64)).slice(0, 64).replace(/[^0-9a-f]/g, 'a');

function receipt(providerId: string, modelId: string, revision: string, over: Partial<PoolCapabilityReceipt> = {}): PoolCapabilityReceipt {
  return {
    member: { providerId, modelId }, endpointRevision: revision,
    verifiedAt: NOW() - 1000, expiresAt: NOW() + 3_600_000,
    targets: ['antigravity'], tools: true, maxOutputTokens: 4096, contextWindow: 200_000,
    contextSource: 'provider', reasoningAccounting: 'inside-output', effortLevels: ['high'], billingSafe: true,
    ...over,
  };
}

function member(providerId: string, modelId: string, over: Partial<PoolCapabilityReceipt> = {}): AntigravityRoute {
  const revision = revisionFor(providerId + modelId);
  return {
    catalogId: 'member-' + modelId, providerId, providerName: providerId, modelId, upstreamModelId: modelId,
    displayName: modelId, npm: '@ai-sdk/openai-compatible', apiKey: 'k', baseURL: 'https://example.invalid',
    contextWindow: 200_000, reasoningEffort: 'high',
    poolEvidence: { revision, receipt: receipt(providerId, modelId, revision, over) },
  };
}

function row(members: AntigravityRoute[]): AntigravityRoute {
  return { ...members[0]!, catalogId: 'relay-free-pool-high', providerId: 'relay-free-pool', modelId: 'free-pool-high',
    displayName: 'Relay Free Pool High', reasoningEffort: 'high', poolMembers: members, poolEvidence: undefined };
}

type Script = (args: { abortSignal?: AbortSignal; toolChoice?: unknown }) => AsyncIterable<unknown>;
const scripts = new Map<string, Script>();
const calls: string[] = [];
const text = (value: string) => ({ type: 'text-delta', id: 't', text: value });
const finish = (reason = 'stop') => ({ type: 'finish', finishReason: reason, totalUsage: { inputTokens: 3, outputTokens: 4 } });
const answers = (value: string): Script => async function* () { yield text(value); yield finish(); };
const hangs: Script = ({ abortSignal }) => (async function* () {
  await new Promise<void>(resolve => { abortSignal?.addEventListener('abort', () => resolve(), { once: true }); });
})();

let root: string;
let health: PoolHealthStore;
let handles: CloudCodeGatewayHandle[] = [];

let previousHome: string | undefined;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'relay-agy-pool-'));
  previousHome = process.env.RELAY_AI_HOME;
  process.env.RELAY_AI_HOME = join(root, 'home');
  health = new PoolHealthStore({ root });
  scripts.clear();
  calls.length = 0;
  vi.mocked(createLanguageModel).mockImplementation((async (spec: { modelId: string }) => ({ modelId: spec.modelId })) as never);
  vi.mocked(streamText).mockImplementation(((args: { model: { modelId: string }; abortSignal?: AbortSignal; toolChoice?: unknown }) => {
    calls.push(args.model.modelId);
    const script = scripts.get(args.model.modelId);
    if (!script) throw new Error('no script for ' + args.model.modelId);
    return { stream: script(args) };
  }) as never);
});
afterEach(async () => {
  if (previousHome === undefined) delete process.env.RELAY_AI_HOME; else process.env.RELAY_AI_HOME = previousHome;
  await Promise.all(handles.map(handle => handle.close()));
  handles = [];
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
});

async function gateway(members: AntigravityRoute[], limits: PoolLimits = LIMITS) {
  const handle = await startCloudCodeGateway([row(members)], { templateKey: 'gemini-3.5-flash-low', poolHealth: health, poolLimits: limits });
  handles.push(handle);
  return handle;
}
const post = (handle: CloudCodeGatewayHandle, path: string, body: unknown, signal?: AbortSignal) => fetch(`http://127.0.0.1:${handle.port}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal,
});
const ask = (extra: Record<string, unknown> = {}) => ({
  model: 'relay-free-pool-high',
  request: { contents: [{ role: 'user', parts: [{ text: 'hello' }] }], ...extra },
});
const STREAM = '/v1internal:streamGenerateContent?alt=sse';
const UNARY = '/v1internal:generateContent';

describe('Antigravity free pool through the shared coordinator', () => {
  it('fails over before any byte reaches the client', async () => {
    const a = member('prov-a', 'm-a'), b = member('prov-b', 'm-b');
    scripts.set('m-a', async function* () { throw Object.assign(new Error('boom'), { statusCode: 500 }); });
    scripts.set('m-b', answers('from b'));
    const res = await post(await gateway([a, b]), STREAM, ask());
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).toContain('from b');
    expect(calls).toEqual(['m-a', 'm-b']);
  });

  it('times out a hung member, fails over, and persists a cooldown that the next request honours', async () => {
    const a = member('prov-a', 'm-a'), b = member('prov-b', 'm-b');
    scripts.set('m-a', hangs);
    scripts.set('m-b', answers('from b'));
    const handle = await gateway([a, b]);
    const first = await (await post(handle, STREAM, ask())).text();
    expect(first).toContain('from b');
    const scope = poolEndpointScope('prov-a', a.poolEvidence!.revision, 'm-a');
    expect(await health.cooldownFor({ id: a.poolEvidence!.revision, scopes: [scope] })).toBeGreaterThan(Date.now());
    calls.length = 0;
    vi.mocked(createLanguageModel).mockClear();
    const second = await (await post(handle, STREAM, ask())).text();
    expect(second).toContain('from b');
    expect(calls).toEqual(['m-b']);
    // A cooling member is not even prepared (no credential refresh, no model build).
    expect(vi.mocked(createLanguageModel).mock.calls.map(call => (call[0] as { modelId: string }).modelId)).toEqual(['m-b']);
  });

  it('does not fail over after content was sent, and ends the stream with a visible error', async () => {
    const a = member('prov-a', 'm-a'), b = member('prov-b', 'm-b');
    scripts.set('m-a', async function* () { yield text('partial'); throw new Error('stream broke'); });
    scripts.set('m-b', answers('from b'));
    const body = await (await post(await gateway([a, b]), STREAM, ask())).text();
    expect(body).toContain('partial');
    expect(body).toContain('stream broke');
    expect(body).not.toContain('from b');
    expect(calls).toEqual(['m-a']);
  });

  it('answers 502 with a gRPC error status when every member fails', async () => {
    const a = member('prov-a', 'm-a'), b = member('prov-b', 'm-b');
    scripts.set('m-a', async function* () { throw new Error('down a'); });
    scripts.set('m-b', async function* () { throw new Error('down b'); });
    const res = await post(await gateway([a, b]), STREAM, ask());
    expect(res.status).toBe(502);
    expect(res.headers.get('grpc-status')).toBe('13');
    expect(await res.text()).toContain('All free pool members failed');
  });

  it('treats a missing or unusable finish as a member failure, not an answer', async () => {
    const a = member('prov-a', 'm-a'), b = member('prov-b', 'm-b'), c = member('prov-c', 'm-c');
    scripts.set('m-a', async function* () { yield text('half'); });
    scripts.set('m-b', async function* () { yield text('filtered'); yield finish('content-filter'); });
    scripts.set('m-c', answers('from c'));
    const res = await post(await gateway([a, b, c]), UNARY, ask());
    const json = await res.json() as { response: { candidates: Array<{ content: { parts: Array<{ text?: string }> } }> } };
    expect(JSON.stringify(json)).toContain('from c');
    expect(JSON.stringify(json)).not.toContain('half');
  });

  it('serves the non-streaming path through the same coordinator', async () => {
    const a = member('prov-a', 'm-a'), b = member('prov-b', 'm-b');
    scripts.set('m-a', async function* () { throw Object.assign(new Error('rate limited'), { statusCode: 429 }); });
    scripts.set('m-b', answers('unary b'));
    const res = await post(await gateway([a, b]), UNARY, ask());
    expect(res.status).toBe(200);
    const json = await res.json() as { response: { candidates: Array<{ finishReason: string; content: { parts: Array<{ text?: string }> } }>; modelVersion: string; usageMetadata: { totalTokenCount: number } } };
    expect(json.response.candidates[0]!.content.parts[0]!.text).toBe('unary b');
    expect(json.response.candidates[0]!.finishReason).toBe('STOP');
    expect(json.response.modelVersion).toBe('relay-free-pool-high');
    expect(json.response.usageMetadata.totalTokenCount).toBe(7);
    // A 429 cools the whole provider account, not only the model.
    expect(await health.cooldownFor({ id: 'x', scopes: [poolAccountScope('prov-a')] })).toBeGreaterThan(Date.now());
  });

  it('cancels the in-flight attempt when the client disconnects', async () => {
    const a = member('prov-a', 'm-a');
    let aborted = false;
    scripts.set('m-a', ({ abortSignal }) => (async function* () {
      yield text('start');
      await new Promise<void>(resolve => abortSignal?.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true }));
    })());
    const controller = new AbortController();
    const res = await post(await gateway([a], { ...LIMITS, idleMs: 5000, totalMs: 10_000 }), STREAM, ask(), controller.signal);
    const reader = res.body!.getReader();
    await reader.read();
    controller.abort();
    await vi.waitFor(() => expect(aborted).toBe(true), { timeout: 2000 });
  });

  it('passes a forced tool choice to the member', async () => {
    const a = member('prov-a', 'm-a');
    let seen: unknown;
    scripts.set('m-a', args => { seen = args.toolChoice; return answers('ok')(args); });
    await (await post(await gateway([a]), STREAM, ask({
      tools: [{ functionDeclarations: [{ name: 'read', description: 'r', parameters: { type: 'object', properties: {} } }] }],
      toolConfig: { functionCallingConfig: { mode: 'ANY' } },
    }))).text();
    expect(seen).toBe('required');
  });

  it('refuses a member whose receipt is not billing safe', async () => {
    const stale = member('prov-a', 'm-a', { billingSafe: false });
    scripts.set('m-a', answers('should not run'));
    const res = await post(await gateway([stale]), STREAM, ask());
    expect(res.status).toBe(502);
    expect(await res.text()).toContain('No eligible free pool members');
    expect(calls).toEqual([]);
  });

  it('keeps serving a member whose Test is old: age alone never retires it', async () => {
    const old = member('prov-a', 'm-a', { verifiedAt: NOW() - 90 * 86_400_000, expiresAt: NOW() - 89 * 86_400_000 });
    scripts.set('m-a', answers('still fine'));
    const body = await (await post(await gateway([old]), STREAM, ask())).text();
    expect(body).toContain('still fine');
  });

  it('skips a member whose context window cannot hold the request', async () => {
    const small = member('prov-a', 'm-a', { contextWindow: 8000 });
    const big = member('prov-b', 'm-b');
    scripts.set('m-a', answers('small'));
    scripts.set('m-b', answers('big'));
    const body = await (await post(await gateway([small, big]), STREAM, ask({
      contents: [{ role: 'user', parts: [{ text: 'x'.repeat(40_000) }] }],
    }))).text();
    expect(body).toContain('big');
    expect(calls).toEqual(['m-b']);
  });

  it('keeps tool calls from the member that produced them and formats them as Cloud Code functionCall', async () => {
    const a = member('prov-a', 'm-a');
    scripts.set('m-a', async function* () {
      yield { type: 'tool-input-start', id: 'c1', toolName: 'read' };
      yield { type: 'tool-input-delta', id: 'c1', delta: '{"path":"a"}' };
      yield { type: 'tool-call', toolCallId: 'c1', toolName: 'read', input: { path: 'a' } };
      yield finish('tool-calls');
    });
    const body = await (await post(await gateway([a]), STREAM, ask({
      tools: [{ functionDeclarations: [{ name: 'read', description: 'r', parameters: { type: 'object', properties: { path: { type: 'string' } } } }] }],
    }))).text();
    expect(body).toContain('"functionCall"');
    expect(body).toContain('"name":"read"');
  });
});

describe('Antigravity free pool launch and logging', () => {
  const realProvider = (id: string, modelId: string): LocalProvider => ({
    id, name: id, apiKey: 'key-' + id,
    models: [{ id: modelId, name: modelId, family: '', brand: '', modelFormat: 'openai', upstreamModelId: modelId, npm: '@ai-sdk/openai-compatible',
      apiBaseUrl: 'http://127.0.0.1:1/v1', contextWindow: 200_000, reasoning: true, reasoningEffortLevels: ['medium', 'high'], cost: { input: 0, output: 0 } }],
  });
  const realRows = (specs: Array<[string, string]>) => {
    const providers = specs.map(([id, modelId]) => realProvider(id, modelId));
    const receipts = providers.map(item => {
      const model = item.models[0]!;
      return receipt(item.id, model.id, poolEndpointRevision({ providerId: item.id, npm: model.npm!, baseURL: model.apiBaseUrl, upstreamModelId: model.upstreamModelId! }));
    });
    const rows = buildAntigravityPoolRoutes({
      pool: { members: providers.map(item => ({ providerId: item.id, modelId: item.models[0]!.id })), effort: 'auto', receipts },
      providers, receipts, apiKeys: new Map(providers.map(item => [item.id, item.apiKey!])), effortMode: 'rows', maxRows: 3,
    });
    return { rows, receipts };
  };

  it('serves a row built by the real launch builder, and shares cooldown scopes with the other pools', async () => {
    const { rows, receipts } = realRows([['real-a', 'ma'], ['real-b', 'mb']]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.poolEvidence).toBeUndefined();
    scripts.set('ma', async function* () { throw Object.assign(new Error('limited'), { statusCode: 429 }); });
    scripts.set('mb', answers('real b'));
    const handle = await startCloudCodeGateway(rows, { templateKey: 'gemini-3.5-flash-low', poolHealth: health, poolLimits: LIMITS });
    handles.push(handle);
    const body = await (await post(handle, STREAM, { ...ask(), model: rows[0]!.catalogId })).text();
    expect(body).toContain('real b');
    expect(calls).toEqual(['ma', 'mb']);
    // The same scope the Codex and Claude pools record for this member.
    const revision = receipts[0]!.endpointRevision;
    expect(await health.cooldownFor({ id: revision, scopes: [poolEndpointScope('real-a', revision, 'ma')] })).toBeGreaterThan(Date.now());
  });

  it('releases a half-open recovery claim when the client disconnects', async () => {
    let clock = Date.now();
    const store = new PoolHealthStore({ root: join(root, 'half'), now: () => clock });
    const a = member('prov-a', 'm-a');
    const scopes = [poolEndpointScope('prov-a', a.poolEvidence!.revision, 'm-a')];
    await store.record(scopes, { kind: 'transient' });
    clock += 10 * 60_000;
    let aborted = false;
    scripts.set('m-a', ({ abortSignal }) => (async function* () {
      yield text('start');
      await new Promise<void>(resolve => abortSignal?.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true }));
    })());
    const handle = await startCloudCodeGateway([row([a])], { templateKey: 'gemini-3.5-flash-low', poolHealth: store, poolLimits: { ...LIMITS, idleMs: 5000, totalMs: 10_000 } });
    handles.push(handle);
    const controller = new AbortController();
    const res = await post(handle, STREAM, ask(), controller.signal);
    await res.body!.getReader().read();
    controller.abort();
    await vi.waitFor(() => expect(aborted).toBe(true), { timeout: 2000 });
    // The claim must be gone: another probe is admitted instead of being told one is in flight.
    await vi.waitFor(async () => {
      const decision = await store.acquire({ id: a.poolEvidence!.revision, scopes });
      expect(decision.ok).toBe(true);
      if (decision.ok) await decision.release();
    }, { timeout: 2000 });
  });

  it('logs a stream that broke after content as given up, never as served', async () => {
    const a = member('prov-a', 'm-a');
    scripts.set('m-a', async function* () { yield text('partial'); throw new Error('stream broke'); });
    await (await post(await gateway([a]), STREAM, ask())).text();
    const events = readPoolActivity().map(entry => entry.event);
    expect(events).toContain('failed');
    expect(events).toContain('gave-up');
    expect(events).not.toContain('served');
  });

  it('shows a passed-over member once, only ahead of the answerer, and never for a cooldown', async () => {
    const stale = member('prov-a', 'm-a', { billingSafe: false });
    const ok = member('prov-b', 'm-b');
    scripts.set('m-b', answers('b'));
    const handle = await gateway([stale, ok]);
    await (await post(handle, STREAM, ask())).text();
    await (await post(handle, STREAM, ask())).text();
    const skipped = readPoolActivity().filter(entry => entry.reason?.startsWith('skipped:'));
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.providerId).toBe('prov-a');
    expect(readPoolActivity().filter(entry => entry.event === 'served')).toHaveLength(2);
  });

  it('reports exhaustion, not a missing pool, when every member dies mid-answer without a finish', async () => {
    const a = member('prov-a', 'm-a'), b = member('prov-b', 'm-b');
    scripts.set('m-a', async function* () { yield text('half a'); });
    scripts.set('m-b', async function* () { yield text('half b'); });
    const res = await post(await gateway([a, b]), UNARY, ask());
    expect(res.status).toBe(502);
    expect(await res.text()).toContain('All free pool members failed');
    expect(calls).toEqual(['m-a', 'm-b']);
  });

  it('serves an Auto row built by the real launch builder and sends no effort to members', async () => {
    const providers = [realProvider('auto-a', 'ma'), realProvider('auto-b', 'mb')];
    // Fixed-effort models: nothing common to verify.
    for (const item of providers) { item.models[0]!.reasoning = false; item.models[0]!.reasoningEffortLevels = undefined; }
    const receipts = providers.map(item => {
      const model = item.models[0]!;
      return receipt(item.id, model.id, poolEndpointRevision({ providerId: item.id, npm: model.npm!, baseURL: model.apiBaseUrl, upstreamModelId: model.upstreamModelId! }), { effortLevels: [] });
    });
    const rows = buildAntigravityPoolRoutes({
      pool: { members: providers.map(item => ({ providerId: item.id, modelId: item.models[0]!.id })), effort: 'auto', receipts },
      providers, receipts, apiKeys: new Map(providers.map(item => [item.id, 'k'])), effortMode: 'rows', maxRows: 3,
    });
    expect(rows.map(item => item.catalogId)).toEqual(['relay-free-pool-auto']);
    scripts.set('ma', async function* () { throw Object.assign(new Error('down'), { statusCode: 500 }); });
    let options: unknown;
    scripts.set('mb', args => { options = (args as { providerOptions?: unknown }).providerOptions; return answers('auto b')(args); });
    vi.mocked(streamText).mockImplementation(((args: { model: { modelId: string }; abortSignal?: AbortSignal; providerOptions?: unknown }) => {
      calls.push(args.model.modelId);
      return { stream: scripts.get(args.model.modelId)!(args) };
    }) as never);
    const handle = await startCloudCodeGateway(rows, { templateKey: 'gemini-3.5-flash-low', poolHealth: health, poolLimits: LIMITS });
    handles.push(handle);
    const body = await (await post(handle, STREAM, { ...ask(), model: 'relay-free-pool-auto' })).text();
    expect(body).toContain('auto b');
    expect(calls).toEqual(['ma', 'mb']);
    expect(JSON.stringify(options ?? {})).not.toMatch(/reasoning|effort/i);
  });

  it('disables a member the provider says is gone, skips it afterwards, and logs it loudly', async () => {
    const a = member('prov-a', 'm-a'), b = member('prov-b', 'm-b');
    scripts.set('m-a', async function* () { throw Object.assign(new Error('The model `m-a` does not exist'), { statusCode: 404 }); });
    scripts.set('m-b', answers('from b'));
    const handle = await gateway([a, b]);
    expect(await (await post(handle, STREAM, ask())).text()).toContain('from b');
    const scope = poolEndpointScope('prov-a', a.poolEvidence!.revision, 'm-a');
    expect((await health.disabledFor([scope]))?.note).toBe('model no longer available');
    // Only that model: the account and its other models are untouched.
    expect(await health.disabledFor([poolAccountScope('prov-a')])).toBeUndefined();
    calls.length = 0;
    expect(await (await post(handle, STREAM, ask())).text()).toContain('from b');
    expect(calls).toEqual(['m-b']);
    const reasons = readPoolActivity().map(entry => entry.reason ?? '');
    expect(reasons.some(reason => /^DISABLED: model no longer available/.test(reason))).toBe(true);
    // A passing Test is the way back.
    await health.clear([scope]);
    calls.length = 0;
    scripts.set('m-a', answers('a is back'));
    expect(await (await post(handle, STREAM, ask())).text()).toContain('a is back');
    expect(calls[0]).toBe('m-a');
  });
});
