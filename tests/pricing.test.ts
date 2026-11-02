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

  it('labels generic pricing as a reference for unmapped providers', () => {
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

    expect(enriched[0]?.cost).toBeUndefined();
    expect(enriched[0]?.referencePrice?.cost).toEqual({ input: 0.5, output: 1 });
  });
});

describe('provider-aware combined pricing', () => {
  const model: CachedModel = { id: 'Example-1017', name: 'Example', upstreamModelId: 'Example-1017', modelFormat: 'openai' };
  const index = buildPricingIndex({ models: [{ model_id: 'example-1017', pricing: [
    { platform: 'other', input_per_1m_tokens: 8, output_per_1m_tokens: 16 },
    { platform: 'a2agent', input_per_1m_tokens: 2, output_per_1m_tokens: 4 },
  ] }] });
  const metadata = { a2agent: { models: { 'example-1017': { cost: { input: 1, output: 3 } } } } };
  it('preserves provider-reported prices above both catalogs', () => {
    const [result] = enrichModelsForProviderPricing([{ ...model, cost: { input: 0.5, output: 1 }, costSource: 'provider' }], index, 'a2agent', 'a2agent-2', metadata);
    expect(result.cost).toEqual({ input: 0.5, output: 1 });
    expect(result.costSource).toBe('provider');
  });
  it('uses models.dev for the serving provider ahead of the matching feed', () => {
    expect(enrichModelsForProviderPricing([model], index, 'a2agent', 'a2agent-2', metadata)[0]).toMatchObject({ cost: { input: 1, output: 3 }, costSource: 'models.dev' });
  });
  it('uses only the serving provider feed row when models.dev is missing', () => {
    expect(enrichModelsForProviderPricing([model], index, 'a2agent', 'a2agent', {})[0].cost).toEqual({ input: 2, output: 4 });
  });
  it('demotes legacy generic prices and never uses a subscription zero as a reference', () => {
    const feed = buildPricingIndex({ models: [{ model_id: 'example-1017', pricing: [{ platform: 'other', input_per_1m_tokens: 8, output_per_1m_tokens: 16 }] }] });
    const [result] = enrichModelsForProviderPricing([{ ...model, cost: { input: 8, output: 16 } }], feed, 'a2agent', 'a2agent', {
      'subscription-plan': { models: { 'example-1017': { cost: { input: 0, output: 0 } } } },
      vendor: { models: { 'example-1017': { cost: { input: 1, output: 2 } } } },
    });
    expect(result.cost).toBeUndefined();
    expect(result.referencePrice).toMatchObject({ cost: { input: 1, output: 2 }, provider: 'vendor' });
    expect(result.isFree).toBe(false);
    expect(result.freeStatus).toBe('unknown');
  });
  it('does not collapse dated or variant IDs', () => {
    const [result] = enrichModelsForProviderPricing([model], buildPricingIndex({}), 'a2agent', 'a2agent', {
      vendor: { models: { example: { cost: { input: 1, output: 2 } }, 'example-1017-uncensored': { cost: { input: 2, output: 3 } } } },
    });
    expect(result.referencePrice).toBeUndefined();
  });
});
