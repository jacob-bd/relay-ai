import { describe, expect, it } from 'vitest';
import {
  copilotPlanTier,
  filterCachedCopilotModels,
  normalizeCopilotModels,
} from '../src/registry/copilot-models.js';
import type { CachedModel } from '../src/registry/types.js';

describe('Copilot plan-aware model catalog', () => {
  it('reads Free, paid, and unknown plan tiers from stored provider metadata', () => {
    expect(copilotPlanTier({ copilot: { is_free_plan: true } })).toBe('free');
    expect(copilotPlanTier({ copilot: { is_free_plan: false } })).toBe('paid');
    expect(copilotPlanTier({ copilot: { lookup_status: 'unknown' } })).toBe('unknown');
    expect(copilotPlanTier()).toBe('unknown');
  });

  it.each(['free', 'unknown'] as const)('restricts a %s plan to verified Free chat models', (tier) => {
    const models = normalizeCopilotModels([
      { id: 'gpt-4.1', supported_endpoints: ['/chat/completions'], billing: { multiplier: 1 } },
      { id: 'gpt-5-mini', supported_endpoints: ['/chat/completions'], billing: { multiplier: 0 } },
      { id: 'gemini-premium', supported_endpoints: ['/chat/completions'] },
      { id: 'gpt-4.1-free-auto', supported_endpoints: ['/chat/completions'] },
    ], tier);

    expect(models.map(model => model.id)).toEqual(['gpt-4.1']);
    expect(models[0]).toMatchObject({
      name: 'gpt-4.1 [Copilot]',
      isFree: true,
      freeStatus: 'verified_free',
    });
  });

  it('keeps the paid chat catalog while removing non-callable entries', () => {
    const models = normalizeCopilotModels([
      { id: 'claude-sonnet-4', supported_endpoints: ['/chat/completions'] },
      { id: 'gpt-4.1', supported_endpoints: ['/chat/completions'], billing: { multiplier: 0 } },
      { id: 'auto', supported_endpoints: ['/chat/completions'] },
      { id: 'premium-auto', supported_endpoints: ['/chat/completions'] },
      { id: 'text-embedding-3-small' },
      { id: 'responses-only', supported_endpoints: ['/responses'] },
      { id: 'picker-disabled', model_picker_enabled: false },
      { id: 'policy-disabled', policy: { state: 'disabled' } },
      { id: 'embedding-family', capabilities: { family: 'embedding' } },
    ], 'paid');

    expect(models.map(model => model.id)).toEqual(['claude-sonnet-4', 'gpt-4.1']);
    expect(models.find(model => model.id === 'gpt-4.1')).toMatchObject({
      isFree: true,
      freeStatus: 'verified_free',
    });
    expect(models.find(model => model.id === 'claude-sonnet-4')).toMatchObject({
      isFree: false,
      freeStatus: 'unknown',
    });
  });

  it('removes premium and Auto models from an old cache when the plan is unknown', () => {
    const cached: CachedModel[] = [
      makeCachedModel('gpt-4.1'),
      makeCachedModel('gemini-premium'),
      makeCachedModel('gpt-4.1-free-auto'),
    ];

    expect(filterCachedCopilotModels(cached, 'unknown')).toEqual([
      expect.objectContaining({
        id: 'gpt-4.1',
        isFree: true,
        freeStatus: 'verified_free',
      }),
    ]);
  });

  it('keeps concrete cached models for a confirmed paid plan', () => {
    const cached = [
      makeCachedModel('claude-sonnet-4'),
      makeCachedModel('premium-auto'),
    ];

    expect(filterCachedCopilotModels(cached, 'paid').map(model => model.id)).toEqual(['claude-sonnet-4']);
  });
});

function makeCachedModel(id: string): CachedModel {
  return {
    id,
    name: id,
    upstreamModelId: id,
    family: id.split('-')[0],
    brand: 'Other',
    contextWindow: 128_000,
    modelFormat: 'openai',
    npm: '@ai-sdk/openai-compatible',
  };
}
