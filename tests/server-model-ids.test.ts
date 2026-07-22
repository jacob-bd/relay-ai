import { describe, expect, it } from 'vitest';
import {
  buildDedupedModelRows,
  createGatewayModelCatalog,
  createModelCatalog,
  formatOpenAIModels,
  openAiExposedId,
  openAiIdCollisions,
  type ServerModelInfo,
} from '../src/server/models.js';

// Mirrors a real collision observed on the live server: the same OpenAI-format
// model id ("grok-4.5") offered by three distinct providers, plus one unique
// id that must stay bare.
const collidingModels: ServerModelInfo[] = [
  {
    id: 'grok-4.5',
    name: 'Grok 4.5 (xAI)',
    isFree: false,
    brand: 'xAI',
    providerLabel: 'xAI',
    providerId: 'xai',
    sourceBackend: 'xai',
    modelFormat: 'openai',
    npm: '@ai-sdk/xai',
  },
  {
    id: 'grok-4.5',
    name: 'Grok 4.5 (Groq)',
    isFree: false,
    brand: 'xAI',
    providerLabel: 'Groq',
    providerId: 'groq',
    sourceBackend: 'groq',
    modelFormat: 'openai',
    npm: '@ai-sdk/groq',
  },
  {
    id: 'grok-4.5',
    name: 'Grok 4.5 (OpenRouter)',
    isFree: false,
    brand: 'xAI',
    providerLabel: 'OpenRouter',
    providerId: 'openrouter',
    sourceBackend: 'openrouter',
    modelFormat: 'openai',
    npm: '@openrouter/ai-sdk-provider',
  },
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max Preview',
    isFree: false,
    brand: 'Qwen',
    providerLabel: 'Qwen Cloud',
    providerId: 'qwen-cloud-token-plan',
    sourceBackend: 'qwen-cloud-token-plan',
    modelFormat: 'openai',
    npm: '@ai-sdk/alibaba',
  },
];

describe('openAiIdCollisions / openAiExposedId', () => {
  it('flags only ids shared by more than one model', () => {
    const collisions = openAiIdCollisions(collidingModels);
    expect(collisions.has('grok-4.5')).toBe(true);
    expect(collisions.has('qwen3.8-max-preview')).toBe(false);
  });

  it('scopes colliding ids as provider/model, leaves unique ids bare', () => {
    const collisions = openAiIdCollisions(collidingModels);
    expect(openAiExposedId(collidingModels[0]!, collisions)).toBe('xai/grok-4.5');
    expect(openAiExposedId(collidingModels[1]!, collisions)).toBe('groq/grok-4.5');
    expect(openAiExposedId(collidingModels[2]!, collisions)).toBe('openrouter/grok-4.5');
    expect(openAiExposedId(collidingModels[3]!, collisions)).toBe('qwen3.8-max-preview');
  });

  it('disambiguates ids that already contain a slash', () => {
    const slashModels: ServerModelInfo[] = [
      {
        id: 'poolside/laguna-xs-2.1:free',
        name: 'Laguna XS (Kilo)',
        isFree: true,
        brand: 'Poolside',
        providerId: 'kilo',
        sourceBackend: 'kilo',
        modelFormat: 'openai',
      },
      {
        id: 'poolside/laguna-xs-2.1:free',
        name: 'Laguna XS (OpenRouter)',
        isFree: true,
        brand: 'Poolside',
        providerId: 'openrouter',
        sourceBackend: 'openrouter',
        modelFormat: 'openai',
      },
    ];
    const collisions = openAiIdCollisions(slashModels);
    expect(openAiExposedId(slashModels[0]!, collisions)).toBe('kilo/poolside/laguna-xs-2.1:free');
    expect(openAiExposedId(slashModels[1]!, collisions)).toBe('openrouter/poolside/laguna-xs-2.1:free');
  });
});

describe('formatOpenAIModels with collisions', () => {
  it('emits unique ids for every model, scoping only the collisions', () => {
    const result = formatOpenAIModels(collidingModels);
    const ids = result.data.map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates
    expect(ids).toEqual(['xai/grok-4.5', 'groq/grok-4.5', 'openrouter/grok-4.5', 'qwen3.8-max-preview']);
  });
});

describe('catalog lookup with collisions', () => {
  it('createGatewayModelCatalog resolves each provider-scoped id to the correct model', () => {
    const catalog = createGatewayModelCatalog(collidingModels);
    expect(catalog.get('xai/grok-4.5')).toMatchObject({ providerId: 'xai' });
    expect(catalog.get('groq/grok-4.5')).toMatchObject({ providerId: 'groq' });
    expect(catalog.get('openrouter/grok-4.5')).toMatchObject({ providerId: 'openrouter' });
  });

  it('createGatewayModelCatalog resolves the unique bare id directly', () => {
    const catalog = createGatewayModelCatalog(collidingModels);
    expect(catalog.get('qwen3.8-max-preview')).toMatchObject({ providerId: 'qwen-cloud-token-plan' });
  });

  it('createGatewayModelCatalog resolves the colliding bare id deterministically (first-registered wins)', () => {
    const catalog = createGatewayModelCatalog(collidingModels);
    expect(catalog.get('grok-4.5')).toMatchObject({ providerId: 'xai' });
  });

  it('createModelCatalog applies the same scoped + bare-first-wins resolution', () => {
    const catalog = createModelCatalog(collidingModels);
    expect(catalog.get('groq/grok-4.5')).toMatchObject({ providerId: 'groq' });
    expect(catalog.get('grok-4.5')).toMatchObject({ providerId: 'xai' });
    expect(catalog.get('qwen3.8-max-preview')).toMatchObject({ providerId: 'qwen-cloud-token-plan' });
  });

  it('does not disturb Anthropic gateway alias resolution, which was already unique', () => {
    const catalog = createGatewayModelCatalog(collidingModels);
    expect(catalog.get('anthropic-xai__grok-4.5')).toMatchObject({ providerId: 'xai' });
    expect(catalog.get('anthropic-groq__grok-4.5')).toMatchObject({ providerId: 'groq' });
    expect(catalog.get('anthropic-openrouter__grok-4.5')).toMatchObject({ providerId: 'openrouter' });
  });
});

describe('buildDedupedModelRows with collisions', () => {
  it('surfaces the scoped OpenAI id in the openaiId column', () => {
    const rows = buildDedupedModelRows(collidingModels);
    const byName = new Map(rows.map(r => [r.name, r]));
    expect(byName.get('Grok 4.5 (xAI)')?.openaiId).toBe('xai/grok-4.5');
    expect(byName.get('Grok 4.5 (Groq)')?.openaiId).toBe('groq/grok-4.5');
    expect(byName.get('Grok 4.5 (OpenRouter)')?.openaiId).toBe('openrouter/grok-4.5');
    expect(byName.get('Qwen3.8 Max Preview')?.openaiId).toBe('qwen3.8-max-preview');
  });

  it('regression: a per-provider-group caller must pass precomputed collisions, or cross-provider clashes go undetected', () => {
    // This mirrors how src/ui/server-control.ts and src/server/index.ts group models by
    // provider label before calling buildDedupedModelRows once per group. If each group call
    // computes collisions from only its own (single-provider) subset, a cross-provider id
    // clash can never be seen — every group sees exactly one model per id.
    const xaiGroup = [collidingModels[0]!];
    const groqGroup = [collidingModels[1]!];

    const wrongXai = buildDedupedModelRows(xaiGroup); // no external collisions passed — bug reproduced
    const wrongGroq = buildDedupedModelRows(groqGroup);
    expect(wrongXai[0]?.openaiId).toBe('grok-4.5'); // wrongly left bare
    expect(wrongGroq[0]?.openaiId).toBe('grok-4.5'); // both providers show the same unscoped id

    const collisions = openAiIdCollisions(collidingModels); // computed over the FULL catalog
    const rightXai = buildDedupedModelRows(xaiGroup, undefined, collisions);
    const rightGroq = buildDedupedModelRows(groqGroup, undefined, collisions);
    expect(rightXai[0]?.openaiId).toBe('xai/grok-4.5');
    expect(rightGroq[0]?.openaiId).toBe('groq/grok-4.5');
  });
});
