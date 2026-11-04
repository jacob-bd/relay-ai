import { describe, expect, it } from 'vitest';
import { buildAntigravityPoolRoutes } from '../src/pool/antigravity.js';
import { poolEndpointRevision } from '../src/pool/capabilities.js';
import type { LocalProvider, PoolCapabilityReceipt } from '../src/types.js';
function provider(id: string, window: number | undefined, levels = ['medium', 'high']): LocalProvider {
  return {
    id, name: id, apiKey: 'key-' + id,
    models: [{ id: 'm', name: 'm', family: '', brand: '', modelFormat: 'openai', upstreamModelId: 'm', npm: '@ai-sdk/openai-compatible', apiBaseUrl: 'http://127.0.0.1:1/v1', ...(window === undefined ? {} : { contextWindow: window }), reasoning: true, reasoningEffortLevels: levels, cost: { input: 0, output: 0 } }],
  };
}
const providers = [provider('a', 200000), provider('b', 300000)];
const members = providers.map(item => ({ providerId: item.id, modelId: 'm' }));
const receipts: PoolCapabilityReceipt[] = providers.map(item => ({
  member: { providerId: item.id, modelId: 'm' },
  endpointRevision: poolEndpointRevision({ providerId: item.id, npm: item.models[0].npm, baseURL: item.models[0].apiBaseUrl, upstreamModelId: 'm' }),
  verifiedAt: 0, expiresAt: 100, targets: ['codex', 'claude', 'antigravity'], tools: true,
  maxOutputTokens: 4096, contextWindow: item.models[0].contextWindow!, contextSource: 'provider',
  reasoningAccounting: 'inside-output', effortLevels: ['high'], billingSafe: true,
}));
const apiKeys = new Map([['a', 'key-a'], ['b', 'key-b']]);
describe('Antigravity pool launch rows', () => {
  it('builds one hyphen-only row carrying both member routes for failover', () => {
    const rows = buildAntigravityPoolRoutes({
      pool: { members, effort: 'auto', receipts }, providers, receipts, apiKeys,
      effortMode: 'rows', maxRows: 3, now: 10,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      catalogId: 'relay-free-pool-high', providerId: 'relay-free-pool', reasoningEffort: 'high',
      displayName: 'Relay Free Pool High', contextWindow: 200000,
    });
    expect(rows[0].poolMembers).toHaveLength(2);
    expect(rows[0].catalogId).not.toMatch(/[_.]/);
  });
  it('returns nothing when receipts are stale or effort evidence is missing', () => {
    expect(buildAntigravityPoolRoutes({
      pool: { members, effort: 'auto', receipts }, providers, receipts, apiKeys,
      effortMode: 'rows', maxRows: 3, now: 100,
    })).toEqual([]);
    const noEffort = receipts.map(receipt => ({ ...receipt, effortLevels: [] }));
    expect(buildAntigravityPoolRoutes({
      pool: { members, effort: 'auto', receipts: noEffort }, providers, receipts: noEffort, apiKeys,
      effortMode: 'rows', maxRows: 3, now: 10,
    })).toEqual([]);
  });
  it('excludes an unknown context window instead of inventing a floor', () => {
    const unknown = provider('unknown', undefined);
    const rows = buildAntigravityPoolRoutes({
      pool: { members, effort: 'auto', receipts }, providers: [unknown, providers[1]!], receipts, apiKeys,
      effortMode: 'rows', maxRows: 3, now: 10,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.contextWindow).toBe(300000);
    expect(rows[0]!.poolMembers?.map(member => member.providerId)).toEqual(['b']);

    expect(buildAntigravityPoolRoutes({
      pool: { members, effort: 'auto', receipts }, providers: [unknown], receipts, apiKeys,
      effortMode: 'rows', maxRows: 3, now: 10,
    })).toEqual([]);
  });
  it('uses the same medium effort anchor as pool planning', () => {
    const levels = ['low', 'medium', 'high', 'xhigh', 'max'];
    const wide = [provider('a', 200000, levels), provider('b', 300000, levels)];
    const wideReceipts = receipts.map(receipt => ({ ...receipt, effortLevels: levels }));
    const rows = buildAntigravityPoolRoutes({
      pool: { members, effort: 'auto', receipts: wideReceipts }, providers: wide, receipts: wideReceipts, apiKeys,
      effortMode: 'rows', maxRows: 3, now: 10,
    });
    expect(rows.map(row => row.reasoningEffort)).toEqual(['medium', 'high', 'xhigh']);
  });
});
