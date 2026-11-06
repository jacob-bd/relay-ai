// The Relay Free Pool exposed through Core: catalog entry + a LanguageModel that fails over across real members.
// Real registry, real createRelayModel, real @ai-sdk/openai-compatible against local fake upstreams.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateText, streamText, tool } from 'ai';
import { z } from 'zod';

vi.mock('@napi-rs/keyring', () => ({ Entry: class { constructor() { throw new Error('keyring unavailable in test'); } } }));
const built: Array<{ providerId?: string; sessionId?: string }> = [];
vi.mock('../src/provider-factory.js', async importOriginal => {
  const original = await importOriginal<typeof import('../src/provider-factory.js')>();
  return { ...original, createLanguageModel: vi.fn(async (spec: Parameters<typeof original.createLanguageModel>[0]) => {
    built.push({ providerId: spec.providerId, sessionId: spec.sessionId });
    return original.createLanguageModel(spec);
  }) };
});

const { listRelayModels } = await import('../src/core/catalog.js');
const { createRelayModel } = await import('../src/core/model.js');
const { isRelayCoreError } = await import('../src/core/errors.js');
const { RELAY_POOL_ROUTE_ID } = await import('../src/core/pool-model.js');
const { poolEndpointRevision } = await import('../src/pool/capabilities.js');
const { materializeRegistry } = await import('../src/registry/materialize.js');
const { loadRegistry } = await import('../src/registry/io.js');
const { setForceFail, clearForceFail } = await import('../src/pool/force-fail.js');
const { isolateHistory, tagPart, servableMembers } = await import('../src/core/pool-model.js');

interface Upstream { server: Server; url: string; hits: Array<Record<string, unknown>>; mode: { current: 'ok' | '429' | 'cut' }; text: string }
const servers: Upstream[] = [];
async function upstream(text: string): Promise<Upstream> {
  const hits: Array<Record<string, unknown>> = [];
  const mode = { current: 'ok' as 'ok' | '429' | 'cut' };
  const chunk = (delta: Record<string, unknown>, finish: string | null) => 'data: ' + JSON.stringify({
    id: 'f', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta, finish_reason: finish }] }) + '\n\n';
  const server = createServer((req: IncomingMessage, res) => {
    let raw = '';
    req.on('data', c => { raw += String(c); });
    req.on('end', () => {
      hits.push(JSON.parse(raw || '{}') as Record<string, unknown>);
      if (mode.current === '429') { res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '120' }); res.end('{"error":{"message":"rate limited"}}'); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (mode.current === 'cut') { res.write(chunk({ role: 'assistant', content: 'partial' }, null)); setTimeout(() => res.destroy(), 30); return; }
      res.write(chunk({ role: 'assistant', content: text }, null));
      res.write(chunk({}, 'stop'));
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const entry = { server, url: 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/v1', hits, mode, text };
  servers.push(entry);
  return entry;
}

let home: string;
let prevHome: string | undefined;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'relay-core-pool-'));
  prevHome = process.env.RELAY_AI_HOME;
  process.env.RELAY_AI_HOME = home;
  built.length = 0;
});
afterEach(async () => {
  clearForceFail();
  if (prevHome === undefined) delete process.env.RELAY_AI_HOME; else process.env.RELAY_AI_HOME = prevHome;
  for (const s of servers.splice(0)) { s.server.closeAllConnections(); await new Promise<void>(r => s.server.close(() => r())); }
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
});

const IDS = ['groq', 'groq-2', 'groq-3'];
interface Options { copilot?: boolean; windows?: number[]; effortLevels?: string[][]; enabled?: boolean; noReceipts?: boolean }
/** Registry + preferences for N zero-price members, each served by one fake upstream. */
function setup(urls: string[], options: Options = {}) {
  const providers = urls.map((url, i) => ({
    id: options.copilot ? 'github-copilot' : IDS[i], templateId: options.copilot ? 'github-copilot' : 'groq', name: 'Free ' + i, enabled: true, authRef: 'keychain:' + (options.copilot ? 'github-copilot' : IDS[i]), authType: 'none',
    api: { npm: '@ai-sdk/openai-compatible', url },
    modelsCache: { fetchedAt: '2026-07-23T00:00:00Z', models: [{
      id: 'm', name: 'M', upstreamModelId: 'm', modelFormat: 'openai', contextWindow: options.windows?.[i] ?? 128000,
      contextWindowSource: 'provider', ...(options.copilot ? {} : { cost: { input: 0, output: 0 } }) }] },
    addedAt: '2026-07-23T00:00:00Z',
  }));
  writeFileSync(join(home, 'providers.json'), JSON.stringify({ schemaVersion: 1, providers }));
  const local = materializeRegistry(loadRegistry(undefined, { persist: false }), () => 'x', { agent: 'codex' });
  const receipts = local.map((p, i) => ({
    member: { providerId: p.id, modelId: 'm' },
    endpointRevision: poolEndpointRevision({ providerId: p.id, authRef: p.authRef, npm: p.models[0]!.npm!,
      baseURL: p.models[0]!.apiBaseUrl, upstreamModelId: 'm', headers: p.headers }),
    verifiedAt: Date.now() - 1000, expiresAt: Date.now() + 60_000,
    // Saved before Core existed: the parser adds the Core target, so no re-test is needed.
    targets: ['codex', 'claude', 'antigravity'],
    tools: true, maxOutputTokens: 8192, contextWindow: options.windows?.[i] ?? 128000, contextSource: 'provider',
    reasoningAccounting: 'inside-output', effortLevels: options.effortLevels?.[i] ?? [], billingSafe: true,
  }));
  writeFileSync(join(home, 'config.json'), JSON.stringify({ freePool: {
    enabled: options.enabled ?? true, effort: 'auto',
    members: local.map(p => ({ providerId: p.id, modelId: 'm' })), receipts: options.noReceipts ? [] : receipts } }));
}

describe('Relay Free Pool in Core: catalog', () => {
  it('lists one "Relay Free Pool" entry, sorted like any other, with the largest member window minus the 10% reserve', async () => {
    const a = await upstream('A'); const b = await upstream('B');
    setup([a.url, b.url], { windows: [200000, 128000] });
    const list = listRelayModels();
    expect(list.find(item => item.routeId === RELAY_POOL_ROUTE_ID)).toMatchObject({ routeId: RELAY_POOL_ROUTE_ID, displayName: 'Relay Free Pool', contextWindow: 180000, pricing: { input: 0, output: 0 } });
    expect(list.filter(item => item.routeId === RELAY_POOL_ROUTE_ID)).toHaveLength(1);
  });
  it.each([
    ['the pool is not enabled', { enabled: false }],
    ['no member has a saved Test', { noReceipts: true }],
  ])('is not listed when %s', async (_name, options) => {
    const a = await upstream('A');
    setup([a.url], options);
    expect(listRelayModels().some(item => item.routeId === RELAY_POOL_ROUTE_ID)).toBe(false);
  });
  it('lists the pool from Test results saved before Core existed (no re-test needed)', async () => {
    const a = await upstream('A');
    setup([a.url]);
    expect(listRelayModels().some(item => item.routeId === RELAY_POOL_ROUTE_ID)).toBe(true);
  });
  it('counts a Copilot member from its saved Test when its plan is not known, and re-checks it when it is', () => {
    const model = { id: 'gpt-4.1', name: 'x', family: '', brand: '', modelFormat: 'openai' as const, upstreamModelId: 'gpt-4.1',
      npm: '@ai-sdk/openai-compatible', apiBaseUrl: 'https://copilot.example/v1', contextWindow: 128000 };
    const provider = { id: 'github-copilot', name: 'Copilot', apiKey: '', authRef: 'keychain:github-copilot', models: [model] };
    const member = { providerId: provider.id, modelId: model.id };
    const receipt = {
      member, endpointRevision: poolEndpointRevision({ providerId: provider.id, authRef: provider.authRef, npm: model.npm,
        baseURL: model.apiBaseUrl, upstreamModelId: model.upstreamModelId }),
      verifiedAt: Date.now() - 1000, expiresAt: Date.now() + 60_000, targets: ['core' as const], tools: true, maxOutputTokens: 8192,
      contextWindow: 128000, contextSource: 'provider' as const, reasoningAccounting: 'inside-output' as const, effortLevels: [], billingSafe: true,
    };
    const state = { pool: { enabled: true, effort: 'auto' as const, members: [member], receipts: [receipt] }, providers: [provider] };
    expect(servableMembers(state, Date.now(), false)).toHaveLength(1);
    expect(servableMembers(state, Date.now(), true)).toHaveLength(0);
  });
  it('lists effort levels only when every member verified them', async () => {
    const a = await upstream('A'); const b = await upstream('B');
    setup([a.url, b.url], { effortLevels: [['low', 'high'], ['high']] });
    expect(listRelayModels().find(item => item.routeId === RELAY_POOL_ROUTE_ID)!.capabilities).toMatchObject({ reasoning: 'adjustable', reasoningLevels: ['high'] });
  });
});

describe('Relay Free Pool in Core: model', () => {
  it('answers from the first member and prepares only that member', async () => {
    const a = await upstream('from A'); const b = await upstream('from B');
    setup([a.url, b.url]);
    const model = await createRelayModel(RELAY_POOL_ROUTE_ID, { sessionId: 'conv-1' });
    const result = await generateText({ model, prompt: 'hi' });
    expect(result.text).toBe('from A');
    expect(a.hits).toHaveLength(1);
    expect(b.hits).toHaveLength(0);
    expect(built.map(item => item.providerId)).toEqual(['groq']);
  });
  it('fails over before any output, and a cooled member is skipped on the next call', async () => {
    const a = await upstream('from A'); const b = await upstream('from B');
    a.mode.current = '429';
    setup([a.url, b.url]);
    const model = await createRelayModel(RELAY_POOL_ROUTE_ID);
    const streamed = streamText({ model, prompt: 'hi' });
    let text = '';
    for await (const part of streamed.textStream) text += part;
    expect(text).toBe('from B');
    expect(a.hits).toHaveLength(1);
    const again = await generateText({ model, prompt: 'again' });
    expect(again.text).toBe('from B');
    expect(a.hits).toHaveLength(1);
  });
  it('does not fail over once output has started', async () => {
    const a = await upstream('from A'); const b = await upstream('from B');
    a.mode.current = 'cut';
    setup([a.url, b.url]);
    const model = await createRelayModel(RELAY_POOL_ROUTE_ID);
    await expect((async () => {
      const streamed = streamText({ model, prompt: 'hi', onError: () => {} });
      for await (const _part of streamed.fullStream) { /* drain */ }
      await streamed.text;
    })()).rejects.toBeDefined();
    expect(b.hits).toHaveLength(0);
  });
  it('sends at most 128 tools to a member', async () => {
    const a = await upstream('A');
    setup([a.url]);
    const model = await createRelayModel(RELAY_POOL_ROUTE_ID);
    const tools = Object.fromEntries(Array.from({ length: 140 }, (_v, i) => [`t${i}`, tool({ description: 'x', inputSchema: z.object({}) })]));
    await generateText({ model, prompt: 'hi', tools });
    expect((a.hits[0]!.tools as unknown[]).length).toBe(128);
  });
  it('never sends a reasoning level the member did not verify, and refuses one the pool cannot honor', async () => {
    const a = await upstream('A');
    setup([a.url], { effortLevels: [[]] });
    const model = await createRelayModel(RELAY_POOL_ROUTE_ID);
    await generateText({ model, prompt: 'hi', providerOptions: { openaiCompatible: { reasoningEffort: 'high' } } });
    expect(JSON.stringify(a.hits[0])).not.toContain('reasoning_effort');
    await expect(createRelayModel(RELAY_POOL_ROUTE_ID, { reasoning: 'high' })).rejects.toSatisfy(
      (error: unknown) => isRelayCoreError(error) && error.code === 'UNSUPPORTED_REASONING_LEVEL');
  });
  it('keeps a conversation on the member that last answered it, while a new conversation starts at the top', async () => {
    const a = await upstream('from A'); const b = await upstream('from B');
    a.mode.current = '429';
    setup([a.url, b.url]);
    const pinned = await createRelayModel(RELAY_POOL_ROUTE_ID, { sessionId: 'pinned-conversation' });
    expect((await generateText({ model: pinned, prompt: 'one' })).text).toBe('from B');
    // A recovers (cooldown file removed) but the conversation stays where it was answered.
    rmSync(join(home, 'pool'), { recursive: true, force: true });
    a.mode.current = 'ok';
    const hitsBefore = a.hits.length;
    expect((await generateText({ model: pinned, prompt: 'two' })).text).toBe('from B');
    expect(a.hits.length).toBe(hitsBefore);
    const fresh = await createRelayModel(RELAY_POOL_ROUTE_ID, { sessionId: 'another-conversation' });
    expect((await generateText({ model: fresh, prompt: 'new' })).text).toBe('from A');
  });
  it('honours the force-fail switch like the apps do', async () => {
    const a = await upstream('from A'); const b = await upstream('from B');
    setup([a.url, b.url]);
    setForceFail(['groq/m'], 5);
    const model = await createRelayModel(RELAY_POOL_ROUTE_ID);
    expect((await generateText({ model, prompt: 'hi' })).text).toBe('from B');
    expect(a.hits).toHaveLength(0);
  });
  it('gives every member a session id even when the host passes none (Go and Zen need one)', async () => {
    const a = await upstream('A');
    setup([a.url]);
    const model = await createRelayModel(RELAY_POOL_ROUTE_ID);
    await generateText({ model, prompt: 'hi' });
    expect(built[0]!.sessionId).toMatch(/[0-9a-f-]{36}/);
  });
  it('passes over a small member for a big request and answers from a large one, without a failure', async () => {
    const small = await upstream('from small'); const large = await upstream('from large');
    setup([small.url, large.url], { windows: [128000, 1048576] });
    expect(listRelayModels().find(item => item.routeId === RELAY_POOL_ROUTE_ID)!.contextWindow).toBe(1048576 - 104858);
    const model = await createRelayModel(RELAY_POOL_ROUTE_ID);
    const result = await generateText({ model, prompt: 'word '.repeat(150000) });
    expect(result.text).toBe('from large');
    expect(small.hits).toHaveLength(0);
  });
  it('fails with a Core error when no member can serve the request', async () => {
    const a = await upstream('A');
    setup([a.url], { windows: [128000] });
    const model = await createRelayModel(RELAY_POOL_ROUTE_ID);
    const huge = 'word '.repeat(80000);
    await expect(generateText({ model, prompt: huge })).rejects.toThrow(/No eligible free pool members/);
    expect(a.hits).toHaveLength(0);
  });
  it('reports a Core error when every member fails before output, through streamText', async () => {
    const a = await upstream('A'); const b = await upstream('B');
    a.mode.current = '429'; b.mode.current = '429';
    setup([a.url, b.url]);
    const model = await createRelayModel(RELAY_POOL_ROUTE_ID);
    const streamed = streamText({ model, prompt: 'hi', onError: () => {} });
    let failure: unknown;
    for await (const part of streamed.fullStream) if (part.type === 'error') failure = part.error;
    expect(isRelayCoreError(failure)).toBe(true);
    expect((failure as { message: string }).message).toMatch(/^All free pool members failed/);
    expect((failure as { retryable: boolean }).retryable).toBe(true);
    expect(a.hits).toHaveLength(1);
    expect(b.hits).toHaveLength(1);
  });
  it('treats reasoning "off" like any other level: it must be one every member verified', async () => {
    const a = await upstream('A');
    setup([a.url], { effortLevels: [['low']] });
    await expect(createRelayModel(RELAY_POOL_ROUTE_ID, { reasoning: 'off' })).rejects.toSatisfy(
      (error: unknown) => isRelayCoreError(error) && error.code === 'UNSUPPORTED_REASONING_LEVEL');
  });
  it('keeps listing the other models when the pool entry cannot be built', async () => {
    const a = await upstream('A');
    setup([a.url]);
    writeFileSync(join(home, 'config.json'), '{ not json');
    expect(listRelayModels().some(item => item.providerId === 'groq')).toBe(true);
  });
  it('is refused with a clear error when the pool is not set up', async () => {
    const a = await upstream('A');
    setup([a.url], { enabled: false });
    await expect(createRelayModel(RELAY_POOL_ROUTE_ID)).rejects.toSatisfy((error: unknown) => isRelayCoreError(error) && error.code === 'UNSUPPORTED_MODEL');
  });
});

describe('Relay Free Pool in Core: provider state never crosses members', () => {
  const prompt = (origin: string | undefined) => [{ role: 'assistant' as const, content: [
    { type: 'reasoning' as const, text: 'thought', providerOptions: { anthropic: { signature: 'SIG' }, ...(origin ? { 'relay-pool': { route: origin } } : {}) } },
    { type: 'text' as const, text: 'plain' },
  ] }];
  const parts = (value: ReturnType<typeof isolateHistory>) => (value[0] as { content: Array<{ providerOptions?: Record<string, unknown> }> }).content;
  it('keeps what the same member produced, minus the bookkeeping tag', () => {
    expect(parts(isolateHistory(prompt('mine') as never, 'mine'))[0]!.providerOptions).toEqual({ anthropic: { signature: 'SIG' } });
  });
  it('drops what another member produced', () => {
    expect(parts(isolateHistory(prompt('theirs') as never, 'mine'))[0]!.providerOptions).toBeUndefined();
  });
  it('drops state with no recorded origin', () => {
    expect(parts(isolateHistory(prompt(undefined) as never, 'mine'))[0]!.providerOptions).toBeUndefined();
  });
});

describe('Relay Free Pool in Core: origin tag on output', () => {
  it('marks parts that carry provider state with the member that produced them, and leaves other parts alone', () => {
    expect(tagPart({ type: 'reasoning-end', id: 'r', providerMetadata: { anthropic: { signature: 'S' } } }, 'k').providerMetadata)
      .toEqual({ anthropic: { signature: 'S' }, 'relay-pool': { route: 'k' } });
    const bare = { type: 'text-delta', id: 't', delta: 'x' };
    expect(tagPart(bare, 'k')).toBe(bare);
  });
});
