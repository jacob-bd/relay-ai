import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/provider-catalog.js', () => ({ resolveLocalProviderApiKey: vi.fn(async () => 'fake') }));
vi.mock('../src/provider-factory.js', async importOriginal => ({ ...await importOriginal<object>(), createLanguageModel: vi.fn(async () => ({})) }));
vi.mock('../src/provider-runtime.js', () => ({ providerRefreshToken: () => undefined }));
import { omitPoolEffort, prepareCodexPoolRoutes, translatedEffortClaim } from '../src/pool/codex-prepare.js';
import { poolEndpointRevision, type PoolCapabilityReceipt } from '../src/pool/capabilities.js';
import { createLanguageModel } from '../src/provider-factory.js';
import { resolveLocalProviderApiKey } from '../src/provider-catalog.js';
import type { PoolHealthStore } from '../src/pool/health.js';
import type { LocalProvider } from '../src/types.js';
const provider: LocalProvider = { id: 'account-2', name: 'Account 2', apiKey: '', models: [{ id: 'm', name: 'm', family: '', brand: '', modelFormat: 'openai', upstreamModelId: 'm', npm: '@ai-sdk/openai-compatible', apiBaseUrl: 'http://127.0.0.1:12345/v1', cost: { input: 0, output: 0 } }] };
const member = { providerId: provider.id, modelId: 'm' };
const receipt: PoolCapabilityReceipt = {
  member, endpointRevision: poolEndpointRevision({ providerId: provider.id, npm: '@ai-sdk/openai-compatible', baseURL: provider.models[0].apiBaseUrl, upstreamModelId: 'm' }),
  verifiedAt: Date.now() - 1000, expiresAt: Date.now() + 60000, targets: ['codex'], tools: true,
  maxOutputTokens: 8192, contextWindow: 128000, contextSource: 'provider', reasoningAccounting: 'inside-output', defaultEffort: 'high', effortLevels: ['high'], billingSafe: true,
};
const base = () => ({ pool: { members: [member], effort: 'auto' as const, receipts: [] }, providers: [provider], receipts: [receipt], body: { input: 'hello', model: 'relay-free-pool' },
  signal: new AbortController().signal, sessionId: 'verified-session', health: { cooldownFor: async () => undefined } as unknown as PoolHealthStore,
  checkContext: async () => ({ verified: true, fits: true }),
});
describe('Codex pool route preparation', () => {
  it('resolves exact account credentials and creates per-route session model', async () => {
    const routes = await prepareCodexPoolRoutes(base());
    expect(routes).toHaveLength(1);
    expect(resolveLocalProviderApiKey).toHaveBeenCalledWith(provider);
    expect(createLanguageModel).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'account-2', sessionId: 'verified-session', apiKey: 'fake' }));
    expect(routes[0].identity.account).toBe('account-2');
  });
  it('does not create models for missing evidence, paid access or insufficient context', async () => {
    for (const patch of [{ receipts: [] }, { checkContext: async () => ({ verified: false, fits: true }) }, { providers: [{ ...provider, models: [{ ...provider.models[0], cost: { input: 1, output: 1 } }] }] }]) {
      vi.mocked(createLanguageModel).mockClear();
      expect(await prepareCodexPoolRoutes({ ...base(), ...patch })).toEqual([]);
      expect(createLanguageModel).not.toHaveBeenCalled();
    }
  });
});

describe('Auto is a verified omission contract', () => {
  const translatedBody = () => {
    const seen: Record<string, unknown>[] = [];
    const translate = ((body: Record<string, unknown>) => {
      seen.push(body);
      return { messages: [], providerOptions: undefined } as never;
    }) as never;
    return { seen, translate };
  };

  it('admits a receipt with no named default and no verified levels', async () => {
    const { members } = { members: [member] };
    const noDefault: PoolCapabilityReceipt = { ...receipt, effortLevels: [] };
    delete noDefault.defaultEffort;
    const { seen, translate } = translatedBody();
    const routes = await prepareCodexPoolRoutes({
      ...base(),
      pool: { members, effort: 'auto', receipts: [] },
      receipts: [noDefault],
      translate,
    });
    expect(routes).toHaveLength(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toHaveProperty('reasoning');
  });

  it('omits effort instead of forwarding a level when the client sends none', async () => {
    const { seen, translate } = translatedBody();
    await prepareCodexPoolRoutes({ ...base(), pool: { members: [member], effort: 'auto', receipts: [] }, translate });
    expect(seen[0]).not.toHaveProperty('reasoning.effort');
  });

  it('uses an explicit client level when the receipt verified it', async () => {
    const { seen, translate } = translatedBody();
    const routes = await prepareCodexPoolRoutes({
      ...base(),
      pool: { members: [member], effort: 'auto', receipts: [] },
      body: { input: 'hello', model: 'relay-free-pool', reasoning: { effort: 'high' } },
      translate,
    });
    expect(routes).toHaveLength(1);
    expect(seen[0].reasoning).toEqual({ effort: 'high' });
  });

  it('keeps the member and sends no effort when the receipt never verified the requested level', async () => {
    const { seen, translate } = translatedBody();
    const skipped: string[] = [];
    const routes = await prepareCodexPoolRoutes({
      ...base(),
      body: { input: 'hello', model: 'relay-free-pool', reasoning: { effort: 'low' } },
      translate,
      onSkip: (_member, reason) => skipped.push(reason),
    });
    // Codex always sends a level; dropping unverified members emptied the whole pool.
    expect(routes).toHaveLength(1);
    expect(skipped).toEqual([]);
    expect(seen[0].reasoning).toBeUndefined();
  });

  it('refuses the route when translation invents a level for Auto', async () => {
    const routes = await prepareCodexPoolRoutes({
      ...base(),
      pool: { members: [member], effort: 'auto', receipts: [] },
      translate: (() => ({ messages: [], providerOptions: { anthropic: { effort: 'high' } } })) as never,
    });
    expect(routes).toEqual([]);
  });
});

describe('omission helpers', () => {
  it('drops only the effort field and keeps the rest of the request intact', () => {
    const body = { input: 'x', reasoning: { effort: 'high', summary: 'auto' }, temperature: 0.5 };
    expect(omitPoolEffort(body, null)).toEqual({ input: 'x', reasoning: { summary: 'auto' }, temperature: 0.5 });
    expect(omitPoolEffort(body, 'low')).toEqual({ input: 'x', reasoning: { summary: 'auto', effort: 'low' }, temperature: 0.5 });
    expect(omitPoolEffort({ input: 'x', reasoning: { effort: 'high' } }, null)).toEqual({ input: 'x' });
    expect(body.reasoning.effort).toBe('high');
  });

  it('detects every translated level claim shape and ignores non-level options', () => {
    expect(translatedEffortClaim({ anthropic: { effort: 'high' } })).toBe('anthropic.effort');
    expect(translatedEffortClaim({ openrouter: { reasoning: { effort: 'max' } } })).toBe('openrouter.reasoning.effort');
    expect(translatedEffortClaim({ google: { thinkingConfig: { thinkingBudget: 8192 } } })).toBe('google.thinkingConfig.thinkingBudget');
    expect(translatedEffortClaim({ google: { thinkingConfig: { includeThoughts: true } } })).toBeUndefined();
    expect(translatedEffortClaim({ openai: { store: false, include: ['reasoning.encrypted_content'] } })).toBeUndefined();
    expect(translatedEffortClaim(undefined)).toBeUndefined();
  });
});

describe('Whatever effort the tool sends, the member is kept', () => {
  it.each(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'auto', 'something-new'])(
    'level %s never empties the pool',
    async level => {
      const routes = await prepareCodexPoolRoutes({
        ...base(),
        body: { input: 'hello', model: 'relay-free-pool', reasoning: { effort: level } },
      });
      expect(routes).toHaveLength(1);
    },
  );
});

describe('Tool limit', () => {
  it('asks the translator to keep at most 128 tools for every member', async () => {
    const calls: unknown[] = [];
    const translate = ((_b: unknown, _s: unknown, _i: unknown, _n: unknown, _m: unknown, options: unknown) => {
      calls.push(options);
      return { messages: [], providerOptions: undefined } as never;
    }) as never;
    await prepareCodexPoolRoutes({ ...base(), translate });
    expect(calls).toEqual([expect.objectContaining({ maxTools: 128 })]);
  });

  it('keeps the first 128 of 300 tools, so the tools Codex lists first survive', async () => {
    const { preparePoolHistory } = await import('../src/pool/continuation.js');
    const tools = Array.from({ length: 300 }, (_, i) => ({ type: 'function', name: 'tool_' + i, description: '', parameters: { type: 'object', properties: {} } }));
    const params = preparePoolHistory({ model: 'relay-free-pool', input: 'hi', tools }, undefined,
      { account: 'a', endpointRevision: 'r', model: 'm' }, '@ai-sdk/openai-compatible', undefined, { maxTools: 128 });
    const names = Object.keys(params.tools ?? {});
    expect(names).toHaveLength(128);
    expect(names[0]).toBe('tool_0');
    expect(names).not.toContain('tool_200');
  });
});
