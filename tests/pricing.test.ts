import { describe, it, expect } from 'vitest';
import {
  buildPricingIndex,
  enrichModelsWithPricing,
  loadBundledPricingCache,
  lookupModelCost,
  normalizeModelIdCandidates,
  pickPricingRow,
  pricingPlatformForProvider,
} from '../src/registry/pricing.js';
import type { CachedModel } from '../src/registry/types.js';

describe('normalizeModelIdCandidates', () => {
  it('strips common provider prefixes', () => {
    const candidates = normalizeModelIdCandidates('moonshotai/kimi-k2.6');
    expect(candidates).toContain('moonshotai/kimi-k2.6');
    expect(candidates).toContain('kimi-k2.6');
  });
});

describe('pricing enrich', () => {
  it('loads bundled cache with sample models', () => {
    const cache = loadBundledPricingCache();
    expect(cache.models?.length).toBeGreaterThan(0);
  });

  it('enriches groq model cost from bundled cache', () => {
    const cache = loadBundledPricingCache();
    const index = buildPricingIndex(cache);
    const cost = lookupModelCost(index, 'llama-3.3-70b-versatile', 'groq');
    expect(cost?.input).toBe(0.59);
    expect(cost?.output).toBe(0.79);
  });

  it('enriches kimi alias ids', () => {
    const cache = loadBundledPricingCache();
    const index = buildPricingIndex(cache);
    const cost = lookupModelCost(index, 'moonshotai/kimi-k2.6', 'openrouter');
    expect(cost?.input).toBe(0.6);
  });

  it('applies cost to cached models', () => {
    const cache = loadBundledPricingCache();
    const index = buildPricingIndex(cache);
    const models: CachedModel[] = [{
      id: 'llama-3.3-70b-versatile',
      name: 'Llama 3.3 70B',
      upstreamModelId: 'llama-3.3-70b-versatile',
      modelFormat: 'openai',
    }];
    const enriched = enrichModelsWithPricing(models, index, 'groq');
    expect(enriched[0]?.cost?.input).toBe(0.59);
  });

  it('marks enriched zero-cost models as verified free', () => {
    const index = buildPricingIndex({
      models: [{
        model_id: 'vendor/free-model',
        pricing: [{
          platform: 'openrouter',
          tier: 'standard',
          modality: 'text',
          input_per_1m_tokens: 0,
          output_per_1m_tokens: 0,
        }],
      }],
    });
    const enriched = enrichModelsWithPricing([{
      id: 'vendor/free-model',
      name: 'Free Model',
      upstreamModelId: 'vendor/free-model',
      modelFormat: 'openai',
    }], index, 'openrouter');

    expect(enriched[0]).toMatchObject({
      cost: { input: 0, output: 0 },
      isFree: true,
      freeStatus: 'verified_free',
    });
  });

  it('uses Alibaba pricing for Qwen Cloud PAYG but not Token Plan credits', () => {
    expect(pricingPlatformForProvider('qwen-cloud-payg', 'qwen-cloud-payg')).toBe('alibaba');
    expect(pricingPlatformForProvider('qwen-cloud-token-plan', 'qwen-cloud-token-plan')).toBeUndefined();
  });
});
