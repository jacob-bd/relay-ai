import { describe, it, expect } from 'vitest';
import {
  buildPricingIndex,
  applyPricingToRegistryProviders,
  enrichModelsWithPricing,
  enrichModelsForProviderPricing,
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

  it('applies Alibaba pricing to Qwen Cloud PAYG but never to Token Plan credits', () => {
    const cache = {
      models: [{
        model_id: 'qwen-coder',
        pricing: [{
          platform: 'alibaba',
          tier: 'standard',
          modality: 'text',
          input_per_1m_tokens: 1.25,
          output_per_1m_tokens: 2.5,
        }],
      }],
    };
    const model: CachedModel = {
      id: 'qwen-coder',
      name: 'Qwen Coder',
      upstreamModelId: 'qwen-coder',
      modelFormat: 'openai',
    };
    const registry = {
      schemaVersion: 1,
      providers: [
        {
          id: 'qwen-cloud-payg',
          templateId: 'qwen-cloud-payg',
          name: 'Qwen Cloud (Pay-As-You-Go)',
          enabled: true,
          authRef: 'keyring:provider:qwen-cloud-payg',
          api: { npm: '@ai-sdk/alibaba' },
          addedAt: '2026-07-19T00:00:00.000Z',
          modelsCache: { fetchedAt: '2026-07-19T00:00:00.000Z', models: [{ ...model }] },
        },
        {
          id: 'qwen-cloud-token-plan',
          templateId: 'qwen-cloud-token-plan',
          name: 'Qwen Cloud (Token Plan)',
          enabled: true,
          authRef: 'keyring:provider:qwen-cloud-token-plan',
          api: { npm: '@ai-sdk/alibaba' },
          addedAt: '2026-07-19T00:00:00.000Z',
          modelsCache: { fetchedAt: '2026-07-19T00:00:00.000Z', models: [{ ...model }] },
        },
      ],
    };

    applyPricingToRegistryProviders(registry, cache);

    expect(registry.providers[0]?.modelsCache?.models[0]).toMatchObject({
      cost: { input: 1.25, output: 2.5 },
      isFree: false,
      freeStatus: 'paid',
    });
    expect(registry.providers[1]?.modelsCache?.models[0]).not.toHaveProperty('cost');
    expect(registry.providers[1]?.modelsCache?.models[0]).not.toHaveProperty('isFree');
    expect(registry.providers[1]?.modelsCache?.models[0]).not.toHaveProperty('freeStatus');
  });

  it('keeps generic pricing fallback for other unmapped providers', () => {
    const index = buildPricingIndex({
      models: [{
        model_id: 'custom-model',
        pricing: [{
          tier: 'standard',
          modality: 'text',
          input_per_1m_tokens: 0.5,
          output_per_1m_tokens: 1,
        }],
      }],
    });

    const enriched = enrichModelsForProviderPricing([{
      id: 'custom-model',
      name: 'Custom Model',
      upstreamModelId: 'custom-model',
      modelFormat: 'openai',
    }], index, 'custom-provider', 'custom-provider');

    expect(enriched[0]?.cost).toEqual({ input: 0.5, output: 1 });
  });
});
