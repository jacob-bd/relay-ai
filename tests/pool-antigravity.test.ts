import { describe, expect, it } from 'vitest';
import {
  POOL_MODEL_ROWS,
  POOL_ROW_BUDGET,
  POOL_VARIANT_ROWS,
  planPoolAntigravity,
  type PoolAntigravityMember,
} from '../src/pool/antigravity.js';
import { normalizeFunctionCallArgs } from '../src/antigravity/response-adapter.js';
import type { AntigravityRoute } from '../src/antigravity/types.js';

function route(over: Partial<AntigravityRoute> = {}): AntigravityRoute {
  return {
    catalogId: 'relay-ai__groq-2__openai_gpt-oss-120b',
    providerId: 'groq-2',
    providerName: 'Groq 2',
    modelId: 'openai/gpt-oss-120b',
    upstreamModelId: 'openai/gpt-oss-120b',
    displayName: 'GPT OSS 120B (Relay)',
    modelFormat: 'openai',
    npm: '@ai-sdk/openai-compatible',
    apiKey: 'test-key',
    baseURL: 'https://api.groq.com/openai/v1',
    contextWindow: 131072,
    ...over,
  };
}

/** A member whose provider metadata declares concrete effort rungs. */
function member(providerId: string, levels?: string[], over: Partial<AntigravityRoute> = {}): PoolAntigravityMember {
  const modelId = 'openai/gpt-oss-120b';
  return {
    eligible: true,
    route: route({
      providerId,
      modelId,
      upstreamModelId: modelId,
      ...(levels
        ? { reasoningMetadata: { providerId, upstreamModelId: modelId, reasoningEffortLevels: levels } }
        : {}),
      ...over,
    }),
  };
}

describe('pool effort variants on Antigravity', () => {
  it('offers only rungs every eligible member can honor exactly', () => {
    const plan = planPoolAntigravity([
      member('account-a', ['low', 'medium', 'high']),
      member('account-b', ['medium', 'high', 'xhigh']),
    ]);

    expect(plan.commonEffortLevels).toEqual(['medium', 'high']);
    expect(plan.offeredLevels).toEqual(['medium', 'high']);
    expect(plan.routes.map(row => row.reasoningEffort)).toEqual(['medium', 'high']);
    expect(plan.unavailableReason).toBeUndefined();
  });

  it('curates at most three rows, starting at medium when it exists', () => {
    const four = planPoolAntigravity([member('account-a', ['low', 'medium', 'high', 'xhigh'])]);
    expect(four.offeredLevels).toEqual(['medium', 'high', 'xhigh']);

    const three = planPoolAntigravity([member('account-a', ['low', 'medium', 'high'])]);
    expect(three.offeredLevels).toEqual(['low', 'medium', 'high']);
  });

  it('reports members that cannot honor a concrete rung instead of dropping them silently', () => {
    const plan = planPoolAntigravity([
      member('fixed-account'),
      member('single-level-account', ['high']),
      member('usable-account', ['medium', 'high']),
    ]);

    expect(plan.excluded).toEqual([
      { providerId: 'fixed-account', modelId: 'openai/gpt-oss-120b', reason: 'no-verified-effort-control' },
      { providerId: 'single-level-account', modelId: 'openai/gpt-oss-120b', reason: 'insufficient-verified-levels' },
    ]);
    expect(plan.offeredLevels).toEqual(['medium', 'high']);
    expect(plan.routes).toHaveLength(2);
  });

  it('never widens the pool when members share no verified rung', () => {
    const plan = planPoolAntigravity([
      member('account-a', ['low', 'medium']),
      member('account-b', ['high', 'xhigh']),
    ]);
    expect(plan.routes).toEqual([]);
    expect(plan.offeredLevels).toEqual([]);
    expect(plan.unavailableReason).toBe('no-common-effort');
  });

  it('separates an empty pool from an ineligible one and refuses duplicate routes', () => {
    expect(planPoolAntigravity([]).unavailableReason).toBe('no-eligible-members');
    expect(planPoolAntigravity([{ ...member('account-a', ['medium', 'high']), eligible: false, reason: 'quota' }]))
      .toMatchObject({ routes: [], unavailableReason: 'no-eligible-members', excluded: [{ reason: 'quota' }] });

    const duplicate = planPoolAntigravity([
      member('account-a', ['medium', 'high']),
      member('account-a', ['medium', 'high']),
    ]);
    expect(duplicate.excluded).toEqual([
      { providerId: 'account-a', modelId: 'openai/gpt-oss-120b', reason: 'duplicate-route' },
    ]);
    expect(duplicate.routes).toHaveLength(2);
  });
});

describe('pool picker identity', () => {
  it('uses hyphen-only IDs even for hostile pool and model names', () => {
    const plan = planPoolAntigravity(
      [member('account_a.2', ['medium', 'high'], { modelId: 'openai/gpt_oss.120b', upstreamModelId: 'openai/gpt_oss.120b' })],
      { poolName: 'Free Pool: Groq_2 / 75%' },
    );

    expect(plan.routes).toHaveLength(2);
    for (const row of plan.routes) {
      expect(row.catalogId).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(row.catalogId).not.toContain('_');
      expect(row.catalogId).not.toContain('.');
    }
    expect(plan.routes.map(row => row.catalogId)).toEqual([
      'relay-pool-free-pool-groq-2-75-medium',
      'relay-pool-free-pool-groq-2-75-high',
    ]);
  });

  it('names rows the way each Antigravity surface folds them', () => {
    const input = [member('account-a', ['low', 'medium', 'high'])];
    expect(planPoolAntigravity(input).routes.map(row => row.displayName)).toEqual([
      'Free Pool Low (Relay)',
      'Free Pool Medium (Relay)',
      'Free Pool High (Relay)',
    ]);
    expect(planPoolAntigravity(input, { effortMode: 'slider' }).routes.map(row => row.displayName)).toEqual([
      'Free Pool (Relay)',
      'Free Pool Medium (Relay)',
      'Free Pool High (Relay)',
    ]);
    expect(planPoolAntigravity(input, { effortMode: 'submenu' }).routes.map(row => row.displayName)).toEqual([
      'Free Pool (Relay) (Low)',
      'Free Pool (Relay) (Medium)',
      'Free Pool (Relay) (High)',
    ]);
  });
});

describe('pool slot budget', () => {
  it('counts the pool as one model and never as one row per member', () => {
    const many = Array.from({ length: 75 }, (_unused, index) => member('account-' + index, ['medium', 'high']));
    const plan = planPoolAntigravity(many);

    expect(plan.excluded).toEqual([]);
    expect(plan.slotCost).toEqual({ modelRows: POOL_MODEL_ROWS, variantRows: 2 });
    expect(plan.routes).toHaveLength(2);
    expect(plan.routes.length).toBeLessThanOrEqual(POOL_ROW_BUDGET);
    expect(POOL_VARIANT_ROWS).toBe(3);
  });

  it('honors a smaller row budget and refuses an empty one', () => {
    const levels = ['low', 'medium', 'high'];
    expect(planPoolAntigravity([member('account-a', levels)], { maxRows: 2 }).routes).toHaveLength(2);
    expect(planPoolAntigravity([member('account-a', levels)], { maxRows: 1 }).routes).toHaveLength(1);
    expect(planPoolAntigravity([member('account-a', levels)], { maxRows: 99 }).routes).toHaveLength(3);

    expect(planPoolAntigravity([member('account-a', levels)], { maxRows: 0 })).toMatchObject({
      routes: [],
      unavailableReason: 'no-row-budget',
      slotCost: { modelRows: 0, variantRows: 0 },
    });
  });
});

describe('pool route fidelity', () => {
  it('copies the highest-priority member route without mutating it', () => {
    const first = member('account-a', ['medium', 'high']);
    const original = JSON.parse(JSON.stringify(first.route));
    const plan = planPoolAntigravity([first, member('account-b', ['medium', 'high'])]);

    for (const row of plan.routes) {
      expect(row.providerId).toBe('account-a');
      expect(row.npm).toBe('@ai-sdk/openai-compatible');
      expect(row.baseURL).toBe('https://api.groq.com/openai/v1');
      expect(row.modelFormat).toBe('openai');
      expect(row.contextWindow).toBe(131072);
      expect(row.reasoningMetadata?.reasoningEffortLevels).toEqual(['medium', 'high']);
    }
    expect(JSON.parse(JSON.stringify(first.route))).toEqual(original);
  });

  it('leaves tool normalization to the existing Antigravity formatter', () => {
    // The adapter returns ordinary routes, so the gateway keeps using its own
    // formatter. That formatter's repair of stringified Arguments is unchanged.
    expect(normalizeFunctionCallArgs({ Arguments: '{"path":"a.txt"}' } as never))
      .toEqual({ Arguments: { path: 'a.txt' } } as never);
    expect(normalizeFunctionCallArgs({ Arguments: 'not json' } as never))
      .toEqual({ Arguments: 'not json' } as never);

    const plan = planPoolAntigravity([member('account-a', ['medium', 'high'])]);
    expect(Object.keys(plan.routes[0]!).sort()).toEqual(
      Object.keys(route()).concat('reasoningEffort', 'reasoningMetadata').sort(),
    );
  });
});
