import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/provider-catalog.js', () => ({ resolveLocalProviderApiKey: async () => 'fake' }));
vi.mock('../src/provider-factory.js', async original => ({ ...await original<object>(), createLanguageModel: async () => ({}) }));
vi.mock('../src/provider-runtime.js', () => ({ providerRefreshToken: () => undefined }));
import * as sdk from '../src/pool/sdk-route.js';
import { prepareClaudePoolRoutes } from '../src/pool/claude-prepare.js';
import { serveClaudePool } from '../src/pool/claude-runtime.js';
import { ClaudePoolSignatures } from '../src/pool/claude-signatures.js';
import { poolEndpointRevision } from '../src/pool/capabilities.js';
import type { LocalProvider } from '../src/types.js';
import type { PoolHealthStore } from '../src/pool/health.js';
import type { PoolEvent } from '../src/pool/attempt.js';
const account = (id: string, npm = '@ai-sdk/google'): LocalProvider => ({ id, name: id, apiKey: 'fake', models: [{
  id: 'm', name: 'm', family: '', brand: '', modelFormat: 'openai', upstreamModelId: 'm', npm,
  apiBaseUrl: 'http://127.0.0.1:1/v1', cost: { input: 0, output: 0 },
}] });
const revision = (p: LocalProvider) => poolEndpointRevision({ providerId: p.id, npm: p.models[0].npm!, baseURL: p.models[0].apiBaseUrl, upstreamModelId: 'm' });
const member = (p: LocalProvider) => ({ providerId: p.id, modelId: 'm' });
async function emit(p: LocalProvider, sig: string, thinking = false, stream = true) {
  const chunks: string[] = [];
  const events: PoolEvent[] = thinking ? [
    { type: 'reasoning-start', id: 'r' }, { type: 'reasoning-delta', id: 'r', text: 'thought' },
    { type: 'reasoning-end', id: 'r', providerMetadata: { anthropic: { signature: sig } } },
    { type: 'text-delta', text: 'OK' },
  ] : [{ type: 'tool-call', toolCallId: 'upstream_call', toolName: 'read', input: {}, providerMetadata: { google: { thoughtSignature: sig } } }];
  const result = await serveClaudePool({ pool: { members: [member(p)], effort: 'auto' }, routes: [{
    member: member(p), revision: revision(p), freeStatus: 'verified_free', catalogVerified: true,
    accessVerified: true, billingSafe: true, targets: ['claude'], toolsVerified: true, defaultEffortVerified: true,
    effortLevels: [], contextFits: true, contextVerified: true,
    async open() { return (async function* () { yield* events; yield { type: 'finish', finishReason: 'stop' }; })(); },
  }], request: { modelId: 'claude-pool', stream, signal: new AbortController().signal },
  limits: { attempts: 1, firstContentMs: 1000, idleMs: 1000, totalMs: 2000, bufferBytes: 65536, cleanupMs: 100 }, write: c => chunks.push(c) });
  expect(result.ok).toBe(true);
  if (!stream && result.ok) return (result.message!.content as Array<Record<string, unknown>>)[0];
  const records = chunks.join('').split(String.fromCharCode(10)).filter(l => l.startsWith('data:')).map(l => JSON.parse(l.slice(5)));
  if (thinking) return { type: 'thinking', thinking: 'thought', signature: records.find(r => r.delta?.type === 'signature_delta')?.delta.signature };
  return records.find(r => r.content_block?.type === 'tool_use').content_block;
}
async function prepare(p: LocalProvider, blocks: Array<Record<string, unknown>>) {
  const spy = vi.spyOn(sdk, 'sdkPoolRoute');
  try {
    await prepareClaudePoolRoutes({ pool: { members: [member(p)], effort: 'auto', receipts: [] }, providers: [p],
      receipts: [{ member: member(p), endpointRevision: revision(p), verifiedAt: Date.now()-1000, expiresAt: Date.now()+60000,
        targets: ['claude'], tools: true, billingSafe: true, effortLevels: [], maxOutputTokens: 8192,
        contextWindow: 128000, contextSource: 'provider', reasoningAccounting: 'inside-output' }],
      body: { model: 'claude-pool', max_tokens: 128, messages: [{ role: 'user', content: 'read' }, { role: 'assistant', content: blocks },
        { role: 'user', content: blocks.filter(b => b.type === 'tool_use').map(b => ({ type: 'tool_result', tool_use_id: b.id, content: 'ok' })) }] },
      signal: new AbortController().signal, health: { cooldownFor: async () => undefined, disabledFor: async () => undefined } as unknown as PoolHealthStore });
    return JSON.stringify(spy.mock.calls.at(-1)![2].messages);
  } finally { spy.mockRestore(); }
}
describe('Claude pool signature provenance', () => {
  it('keeps the same Gemini member signature across consecutive real prepared tool turns', async () => {
    const a = account('same'); const first = await emit(a, 'SIG_FIRST');
    expect(String(first.id)).toMatch(/^call_[a-f0-9]{32}$/);
    expect(await prepare(a, [first])).toContain('SIG_FIRST');
    const second = await emit(a, 'SIG_SECOND', false, false);
    expect(await prepare(a, [first, second])).toContain('SIG_SECOND');
    expect(await prepare(a, [first, second])).toContain('SIG_FIRST');
  });
  it('sends A signatures only to A even when B has the same package', async () => {
    const a = account('foreign-a'), b = account('foreign-b'); const call = await emit(a, 'SIG_A');
    expect(await prepare(a, [call])).toContain('SIG_A');
    expect(await prepare(b, [call])).not.toContain('SIG_A');
    const changed = structuredClone(a); changed.models[0].apiBaseUrl += '/changed';
    expect(await prepare(changed, [call])).not.toContain('SIG_A');
  });
  it('preserves proven native Anthropic thinking and strips it for other members or packages', async () => {
    const a = account('native', '@ai-sdk/anthropic'); const thought = await emit(a, 'NATIVE_THINK', true);
    expect(thought.signature).toBe('NATIVE_THINK');
    expect(await prepare(a, [thought])).toContain('NATIVE_THINK');
    expect(await prepare(account('other-native', '@ai-sdk/anthropic'), [thought])).not.toContain('NATIVE_THINK');
    expect(await prepare(account('other-google'), [thought])).not.toContain('NATIVE_THINK');
  });
  it('strips unknown or expired provenance while retaining a proven current call', async () => {
    const a = account('unknown'); const call = await emit(a, 'CURRENT');
    expect(await prepare(a, [call, { type: 'tool_use', id: 'legacy::ts::UNKNOWN', name: 'read', input: {} }])).toContain('CURRENT');
    expect(await prepare(a, [{ type: 'tool_use', id: 'legacy::ts::UNKNOWN', name: 'read', input: {} }])).not.toContain('UNKNOWN');
    let now = 0; const store = new ClaudePoolSignatures(() => now, 1, 10);
    const id = store.tool('a', 'old'); now = 11; expect(store.signature(id, 'a')).toBeUndefined();
  });
  it('keeps each producer separate through A to B to A', async () => {
    const a = account('chain-a'), b = account('chain-b');
    const ca = await emit(a, 'CHAIN_A'), cb = await emit(b, 'CHAIN_B');
    const toA = await prepare(a, [ca, cb]), toB = await prepare(b, [ca, cb]);
    expect(toA).toContain('CHAIN_A'); expect(toA).not.toContain('CHAIN_B');
    expect(toB).toContain('CHAIN_B'); expect(toB).not.toContain('CHAIN_A');
  });
});
