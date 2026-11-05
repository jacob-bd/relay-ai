import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoolEvent } from '../src/pool/attempt.js';

const calls = { translate: 0, model: 0, key: 0, route: [] as string[] };
const failing = new Set<string>();
vi.mock('../src/provider-catalog.js', () => ({ resolveLocalProviderApiKey: vi.fn(async () => { calls.key += 1; return 'fake'; }) }));
vi.mock('../src/provider-factory.js', async importOriginal => ({
  ...await importOriginal<object>(),
  createLanguageModel: vi.fn(async (o: { providerId: string }) => { calls.model += 1; return { id: o.providerId }; }),
}));
vi.mock('../src/provider-runtime.js', () => ({ providerRefreshToken: () => undefined }));
vi.mock('../src/sdk-adapter.js', async importOriginal => {
  const original = await importOriginal<typeof import('../src/sdk-adapter.js')>();
  return { ...original, translateRequest: ((...args: Parameters<typeof original.translateRequest>) => { calls.translate += 1; return original.translateRequest(...args); }) as typeof original.translateRequest };
});
vi.mock('../src/pool/sdk-route.js', () => ({
  sdkPoolRoute: (evidence: Record<string, unknown>, model: { id: string }) => ({
    ...evidence,
    async open() {
      calls.route.push(model.id);
      return (async function* (): AsyncGenerator<PoolEvent> {
        if (failing.has(model.id)) { yield { type: 'error', error: new Error('429') } as PoolEvent; return; }
        yield { type: 'text-delta', text: 'OK' } as PoolEvent;
        yield { type: 'finish', finishReason: 'stop' } as PoolEvent;
      })();
    },
  }),
}));
import { prepareClaudePoolRoutes } from '../src/pool/claude-prepare.js';
import { dispatchFreePool } from '../src/pool/dispatch.js';
import { poolEndpointRevision, type PoolCapabilityReceipt } from '../src/pool/capabilities.js';
import type { PoolHealthStore } from '../src/pool/health.js';
import type { LocalProvider } from '../src/types.js';

const limits = { attempts: 8, firstContentMs: 1000, idleMs: 1000, totalMs: 5000, bufferBytes: 4096, cleanupMs: 100 };
const health = { cooldownFor: async () => undefined, disabledFor: async () => undefined } as unknown as PoolHealthStore;
function setup(count: number, windows: (index: number) => number = () => 128000) {
  const providers: LocalProvider[] = []; const receipts: PoolCapabilityReceipt[] = []; const members = [];
  for (let i = 0; i < count; i += 1) {
    const provider: LocalProvider = { id: 'p' + i, name: 'P' + i, apiKey: '', models: [{
      id: 'm', name: 'm', family: '', brand: '', modelFormat: 'openai', upstreamModelId: 'm',
      npm: '@ai-sdk/openai-compatible', apiBaseUrl: 'http://127.0.0.1:1/v1', cost: { input: 0, output: 0 } }] };
    const member = { providerId: provider.id, modelId: 'm' };
    providers.push(provider); members.push(member);
    receipts.push({ member, endpointRevision: poolEndpointRevision({ providerId: provider.id, npm: '@ai-sdk/openai-compatible',
      baseURL: 'http://127.0.0.1:1/v1', upstreamModelId: 'm' }), verifiedAt: 1, expiresAt: 2, targets: ['claude'], tools: true,
      maxOutputTokens: 1024, contextWindow: windows(i), contextSource: 'provider', reasoningAccounting: 'inside-output',
      effortLevels: [], billingSafe: true });
  }
  return { providers, receipts, members };
}
async function run(count: number, text = 'hello', windows?: (i: number) => number) {
  const { providers, receipts, members } = setup(count, windows);
  const skips: string[] = [];
  const routes = await prepareClaudePoolRoutes({
    pool: { members, effort: 'auto', receipts: [] }, providers, receipts,
    body: { model: 'claude-pool', max_tokens: 64, messages: [{ role: 'user', content: text }] },
    signal: new AbortController().signal, health, onSkip: (m, reason) => skips.push(m.providerId + ': ' + reason),
  });
  const out: PoolEvent[] = [];
  try {
    for await (const part of dispatchFreePool({ members, effort: 'auto' }, routes,
      { target: 'claude', tools: false, effort: 'auto', signal: new AbortController().signal }, { limits, retryable: () => true })) out.push(part);
  } catch (error) { return { error: error as Error, skips, out }; }
  return { skips, out };
}
beforeEach(() => { calls.translate = 0; calls.model = 0; calls.key = 0; calls.route = []; failing.clear(); });

describe('lazy pool member preparation', () => {
  it('prepares only the member that answers', async () => {
    const result = await run(5);
    expect(result.error).toBeUndefined();
    expect(calls).toMatchObject({ translate: 1, model: 1, key: 1, route: ['p0'] });
  });
  it('prepares the next member only after the first fails', async () => {
    failing.add('p0');
    await run(5);
    expect(calls).toMatchObject({ translate: 2, model: 2, key: 2, route: ['p0', 'p1'] });
  });
  it('skips an oversized member at admission without using an attempt, so a ninth member is still tried', async () => {
    const big = 'word '.repeat(4000);
    const result = await run(9, big, i => (i < 8 ? 4096 : 200000));
    expect(result.error).toBeUndefined();
    expect(calls.route).toEqual(['p8']);
    expect(result.skips.filter(s => s.includes('too large'))).toHaveLength(8);
  });
  it('still reports "No eligible free pool members" when every member is skipped', async () => {
    const result = await run(3, 'word '.repeat(4000), () => 4096);
    expect(result.error?.message).toMatch(/^No eligible free pool members/);
    expect(calls.route).toEqual([]);
  });
});
