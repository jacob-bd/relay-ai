import { describe, expect, it, vi } from 'vitest';
const captured: Array<Record<string, unknown>> = [];
vi.mock('../src/provider-catalog.js', () => ({ resolveLocalProviderApiKey: vi.fn(async () => 'fake') }));
vi.mock('../src/provider-factory.js', async importOriginal => ({ ...await importOriginal<object>(), createLanguageModel: vi.fn(async () => ({})) }));
vi.mock('../src/provider-runtime.js', () => ({ providerRefreshToken: () => undefined }));
vi.mock('../src/pool/sdk-route.js', () => ({
  sdkPoolRoute: (evidence: Record<string, unknown>, _model: unknown, request: Record<string, unknown>) => {
    captured.push(request);
    return { ...evidence, async open() { return (async function* () { yield { type: 'finish', finishReason: 'stop' }; })(); } };
  },
}));
import { CodexPoolRuntime, FREE_POOL_MODEL_ID, type CodexPoolRoute } from '../src/pool/codex-runtime.js';
import { prepareCodexPoolRoutes } from '../src/pool/codex-prepare.js';
import { decodeCompactionContent } from '../src/codex-responses-adapter.js';
import { poolEndpointRevision, type PoolCapabilityReceipt } from '../src/pool/capabilities.js';
import type { PoolHealthStore } from '../src/pool/health.js';
import type { LocalProvider } from '../src/types.js';

const member = { providerId: 'account', modelId: 'm' };
function route(text: string): CodexPoolRoute {
  return {
    member, revision: 'rev', identity: { account: 'account', endpointRevision: 'rev', model: 'm' },
    freeStatus: 'verified_free', catalogVerified: true, accessVerified: true, billingSafe: true,
    targets: ['codex'], toolsVerified: false, defaultEffortVerified: true, effortLevels: [],
    contextFits: true, contextVerified: true,
    async open() { return (async function* () {
      if (text) { yield { type: 'text-start', id: 't' }; yield { type: 'text-delta', id: 't', text }; yield { type: 'text-end', id: 't' }; }
      yield { type: 'finish', finishReason: 'stop' };
    })(); },
  };
}
const headers = (turn: string) => ({ 'x-codex-turn-metadata': JSON.stringify({ session_id: 's', thread_id: 't', turn_id: turn }) });
const signal = () => new AbortController().signal;
const trigger = { type: 'compaction_trigger' };
const history = [{ type: 'message', role: 'user', content: 'first question' }, { type: 'message', role: 'assistant', content: 'first answer' }];

describe('Codex pool remote compaction', () => {
  it('streams exactly one compaction item holding the summary', async () => {
    const runtime = new CodexPoolRuntime({ members: [member], effort: 'auto', receipts: [] }, async () => [route('  the summary ')]);
    const chunks: string[] = [];
    const response = await runtime.respond(headers('a'), { model: FREE_POOL_MODEL_ID, stream: true, input: [...history, trigger] }, signal(), c => chunks.push(c));
    const output = response.output as Array<{ type: string; encrypted_content: string }>;
    expect(output).toHaveLength(1);
    expect(output[0]!.type).toBe('compaction');
    expect(decodeCompactionContent(output[0]!.encrypted_content)).toBe('the summary');
    const text = chunks.join('');
    expect(text).toContain('response.completed');
    expect(text).not.toContain('output_text');
    expect(text.match(/"type":"compaction"/g)!.length).toBeGreaterThan(0);
  });
  it('returns the single item without streaming and continues from the summary only', async () => {
    const bodies: Record<string, unknown>[] = [];
    const runtime = new CodexPoolRuntime({ members: [member], effort: 'auto', receipts: [] }, async body => { bodies.push(body); return [route('summary text')]; });
    const response = await runtime.respond(headers('a'), { model: FREE_POOL_MODEL_ID, stream: false, input: [...history, trigger] }, signal(), () => {});
    expect((response.output as unknown[])).toHaveLength(1);
    await runtime.respond(headers('b'), { model: FREE_POOL_MODEL_ID, stream: false, previous_response_id: response.id, input: 'next' }, signal(), () => {});
    const next = JSON.stringify(bodies[1]!.input);
    expect(next).toContain('compaction');
    expect(next).toContain('next');
    expect(next).not.toContain('first question');
  });
  it('refuses an empty summary instead of wiping the history, and writes nothing', async () => {
    const runtime = new CodexPoolRuntime({ members: [member], effort: 'auto', receipts: [] }, async () => [route('')]);
    const chunks: string[] = [];
    await expect(runtime.respond(headers('a'), { model: FREE_POOL_MODEL_ID, stream: true, input: [...history, trigger] }, signal(), c => chunks.push(c))).rejects.toThrow('no summary');
    expect(chunks).toEqual([]);
  });
  it('asks each member for a short tool-free summary', async () => {
    captured.length = 0;
    const provider: LocalProvider = { id: 'account', name: 'A', apiKey: '', models: [{ id: 'm', name: 'm', family: '', brand: '',
      modelFormat: 'openai', upstreamModelId: 'm', npm: '@ai-sdk/openai-compatible', apiBaseUrl: 'http://127.0.0.1:1/v1', cost: { input: 0, output: 0 } }] };
    const receipt: PoolCapabilityReceipt = { member, endpointRevision: poolEndpointRevision({ providerId: 'account', npm: '@ai-sdk/openai-compatible',
      baseURL: 'http://127.0.0.1:1/v1', upstreamModelId: 'm' }), verifiedAt: 1, expiresAt: 2, targets: ['codex'], tools: true,
      maxOutputTokens: 8192, contextWindow: 128000, contextSource: 'provider', reasoningAccounting: 'inside-output', effortLevels: [], billingSafe: true };
    const routes = await prepareCodexPoolRoutes({
      pool: { members: [member], effort: 'auto', receipts: [] }, providers: [provider], receipts: [receipt], signal: signal(),
      health: { cooldownFor: async () => undefined, disabledFor: async () => undefined } as unknown as PoolHealthStore,
      body: { model: FREE_POOL_MODEL_ID, max_output_tokens: 50000, input: [...history, trigger],
        tools: [{ type: 'function', name: 'read', parameters: { type: 'object', properties: {} } }], tool_choice: 'auto' },
    });
    expect(await routes[0]!.admit?.(signal())).toBeUndefined();
    const request = captured[0]!;
    expect(request.tools).toBeUndefined();
    expect(request.toolChoice).toBeUndefined();
    expect(request.maxOutputTokens).toBe(4000);
    expect(JSON.stringify(request.messages).toLowerCase()).toContain('context checkpoint compaction');
  });
});
