import { describe, it, expect } from 'vitest';
import {
  buildRelayCatalogEntry,
  injectRelayModels,
  planRelayCatalogSlots,
  resolveRelayCatalogSlots,
  buildAntigravityRoutes,
  favoriteEffortLevels,
  buildListModelConfigsResponse,
  buildListExperimentsResponse,
  RELAY_CASCADE_PLAN_MODEL,
  RELAY_AGENT_PLACEHOLDER,
  RELAY_CASCADE_ANCHOR_ID,
  RELAY_CASCADE_FALLBACK_ID,
  RELAY_CASCADE_PLAN_ANCHOR_ID,
  ANTIGRAVITY_MIN_CONTEXT_WINDOW,
  type AntigravityRoute,
  type CatalogFixture,
} from '../src/antigravity/catalog.js';
import catalogFixtureRaw from '../src/antigravity/fixtures/fetchAvailableModels.json' with { type: 'json' };

// Minimal fixture derived from the captured Antigravity IDE 2.1.1 catalog shape.
const fixture: CatalogFixture = {
  models: {
    'gemini-3.5-flash-low': {
      displayName: 'Gemini 3.5 Flash (Medium)',
      model: 'MODEL_PLACEHOLDER_M20',
      apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
      modelProvider: 'MODEL_PROVIDER_GOOGLE',
      maxTokens: 1048576,
      maxOutputTokens: 65536,
      tokenizerType: 'LLAMA_WITH_SPECIAL',
      quotaInfo: { remainingFraction: 1, resetTime: '2026-06-23T02:00:57Z' },
    },
    'gemini-3-flash-agent': {
      displayName: 'Gemini 3.5 Flash (High)',
      model: 'MODEL_PLACEHOLDER_M132',
      apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
      modelProvider: 'MODEL_PROVIDER_GOOGLE',
      recommended: true,
      maxTokens: 1048576,
      maxOutputTokens: 65536,
      tokenizerType: 'LLAMA_WITH_SPECIAL',
      quotaInfo: { remainingFraction: 1, resetTime: '2026-06-23T02:00:57Z' },
    },
    'claude-sonnet-4-6': {
      displayName: 'Claude Sonnet 4.6 (Thinking)',
      model: 'MODEL_PLACEHOLDER_M35',
      apiProvider: 'API_PROVIDER_ANTHROPIC_VERTEX',
      modelProvider: 'MODEL_PROVIDER_ANTHROPIC',
      supportsImages: true,
      supportsThinking: true,
      thinkingBudget: 1024,
      maxTokens: 250000,
      maxOutputTokens: 64000,
      tokenizerType: 'LLAMA_WITH_SPECIAL',
      quotaInfo: { remainingFraction: 0.15, resetTime: '2026-06-26T16:48:02Z' },
    },
  },
  defaultAgentModelId: 'gemini-3.5-flash-low',
  agentModelSorts: [
    {
      displayName: 'Recommended',
      groups: [
        {
          modelIds: ['gemini-3.5-flash-low', 'claude-sonnet-4-6'],
        },
      ],
    },
  ],
};

const routes: AntigravityRoute[] = [
  {
    catalogId: 'relay-ai__zen__deepseek-v4-flash-free',
    providerId: 'zen',
    providerName: 'OpenCode Zen',
    modelId: 'deepseek-v4-flash-free',
    upstreamModelId: 'deepseek-v4-flash-free',
    displayName: 'DeepSeek V4 Flash (Relay)',
    npm: '@ai-sdk/openai-compatible',
    apiKey: 'secret-key-123',
    baseURL: 'https://api.example.com',
    contextWindow: 128000,
  },
  {
    catalogId: 'relay-ai__groq__llama-3.3-70b',
    providerId: 'groq',
    providerName: 'Groq',
    modelId: 'llama-3.3-70b',
    upstreamModelId: 'llama-3.3-70b',
    displayName: 'Llama 3.3 70B (Relay)',
    npm: '@ai-sdk/openai-compatible',
    apiKey: 'another-secret-key',
    baseURL: 'https://api.groq.com',
    contextWindow: 32768,
  },
];

describe('antigravity catalog', () => {
  it('keeps the checked-in fixture aligned with Antigravity IDE 2.1.1 model enums', () => {
    const fixture = catalogFixtureRaw as CatalogFixture;
    expect(Object.keys(fixture.models)).toHaveLength(20);
    expect(fixture.defaultAgentModelId).toBe('gemini-3.5-flash-low');
    expect(fixture.models['gemini-3.5-flash-low']?.model).toBe('MODEL_PLACEHOLDER_M20');
    expect(fixture.models['gemini-3-flash-agent']?.model).toBe('MODEL_PLACEHOLDER_M132');
    expect(fixture.models['claude-sonnet-4-6']?.vertexModelId).toBe('claude-sonnet-4-6@default');
    expect(fixture.models['gpt-oss-120b-medium']?.vertexModelId).toBe('openai/gpt-oss-120b-maas');
  });

  it('builds a relay catalog entry by cloning a template', () => {
    const entry = buildRelayCatalogEntry(
      routes[0]!,
      fixture.models['gemini-3.5-flash-low']!,
    );
    expect(entry.displayName).toBe('DeepSeek V4 Flash (Relay)');
    expect(entry.model).toBe(RELAY_AGENT_PLACEHOLDER);
    expect(entry.requestedModelId).toBe('relay-ai__zen__deepseek-v4-flash-free');
    expect(entry.apiProvider).toBe('API_PROVIDER_GOOGLE_GEMINI'); // cloned
    expect(entry.modelVersion).toBe('relay-ai__zen__deepseek-v4-flash-free');
    expect(entry.modelVersionId).toBe('relay-ai__zen__deepseek-v4-flash-free');
    expect(entry.maxTokens).toBe(128000);
    expect(entry.maxOutputTokens).toBe(8192);
    expect(entry.quotaInfo).toEqual({ remainingFraction: 1, resetTime: '2026-06-23T02:00:57Z' });
  });

  it('adds a cascade checkpointer bounded by the relay model context window', () => {
    const entry = buildRelayCatalogEntry(
      routes[0]!,
      fixture.models['gemini-3.5-flash-low']!,
    );
    expect(entry.modelExperiments).toBeDefined();
    const experiments = (entry.modelExperiments as {
      experiments: Record<string, { stringValue: string }>;
    }).experiments;
    const config = JSON.parse(experiments.CASCADE_USE_EXPERIMENT_CHECKPOINTER!.stringValue);
    expect(config.max_token_limit).toBe('119808');
    expect(config.token_threshold).toBe('50000');
    expect(config.enabled).toBe(true);
  });

  it('caps large relay contexts to the planner-safe 128K checkpoint budget', () => {
    const entry = buildRelayCatalogEntry(
      { ...routes[0]!, contextWindow: 1000000 },
      fixture.models['gemini-3.5-flash-low']!,
    );
    const modelExperiments = entry.modelExperiments as {
      experiments: Record<string, { stringValue: string }>;
    };
    const config = JSON.parse(
      modelExperiments.experiments.CASCADE_USE_EXPERIMENT_CHECKPOINTER!.stringValue,
    );
    expect(config.max_token_limit).toBe('128000');
  });

  it('reserves the input room agy demands for mid-sized context windows', () => {
    // agy only starts when contextWindow - maxOutputTokens >= 128000.
    for (const contextWindow of [ANTIGRAVITY_MIN_CONTEXT_WINDOW, 160000, 256000]) {
      const entry = buildRelayCatalogEntry(
        { ...routes[0]!, contextWindow },
        fixture.models['gemini-3.5-flash-low']!,
      );
      expect(entry.maxTokens! - entry.maxOutputTokens!, String(contextWindow))
        .toBeGreaterThanOrEqual(128000);
    }
  });

  it('injects relay models into the catalog', () => {
    const result = injectRelayModels(fixture, routes, 'gemini-3.5-flash-low');
    expect(result.models['relay-ai__zen__deepseek-v4-flash-free']).toBeDefined();
    expect(result.models['relay-ai__groq__llama-3.3-70b']).toBeDefined();
    expect(result.models['relay-ai__zen__deepseek-v4-flash-free']!.displayName).toBe('DeepSeek V4 Flash (Relay)');
  });

  it('preserves the native registry while keeping helper anchors out of the picker', () => {
    const result = injectRelayModels(fixture, routes, 'gemini-3.5-flash-low');
    expect(result.models[RELAY_CASCADE_ANCHOR_ID]).toBeDefined();
    expect(result.models[RELAY_CASCADE_FALLBACK_ID]).toBeDefined();
    expect(result.models['gemini-2.5-flash']).toBeDefined();
    expect(result.models[RELAY_CASCADE_PLAN_ANCHOR_ID]).toBeDefined();
    expect(result.models['claude-sonnet-4-6']).toBeDefined();
    expect(result.models['relay-ai__zen__deepseek-v4-flash-free']).toBeDefined();
    expect(result.models['relay-ai__groq__llama-3.3-70b']).toBeDefined();
    const modelIds = result.agentModelSorts[0]!.groups[0]!.modelIds;
    expect(modelIds).not.toContain(RELAY_CASCADE_FALLBACK_ID);
    expect(modelIds).not.toContain('gemini-2.5-flash');
    expect(modelIds).not.toContain(RELAY_CASCADE_PLAN_ANCHOR_ID);
    expect(modelIds).toContain(RELAY_CASCADE_ANCHOR_ID);
    expect(modelIds).toContain('claude-sonnet-4-6');
    expect(modelIds).not.toContain('relay-ai__groq__llama-3.3-70b');
  });

  it('preserves the current gemini-3-flash-agent M132 anchor model', () => {
    const result = injectRelayModels(fixture, routes, 'gemini-3.5-flash-low');
    const planAnchor = result.models[RELAY_CASCADE_PLAN_ANCHOR_ID];
    expect(planAnchor).toBeDefined();
    expect(planAnchor!.model).toBe('MODEL_PLACEHOLDER_M132');
    expect(planAnchor!.displayName).toBe('Gemini 3.5 Flash (High)');
  });

  it('uses native Antigravity slots for launch and model switching', () => {
    const result = injectRelayModels(fixture, routes, 'gemini-3.5-flash-low');
    const group = result.agentModelSorts[0]!.groups[0]!;
    expect(group.modelIds).toEqual([
      RELAY_CASCADE_ANCHOR_ID,
      'claude-sonnet-4-6',
    ]);
    expect(result.models[RELAY_CASCADE_ANCHOR_ID]!.displayName).toBe('DeepSeek V4 Flash (Relay)');
    expect(result.models['claude-sonnet-4-6']!.displayName).toBe('Llama 3.3 70B (Relay)');
    expect(result.models['relay-ai__zen__deepseek-v4-flash-free']!.model).toBe(RELAY_AGENT_PLACEHOLDER);
    expect(result.models['relay-ai__groq__llama-3.3-70b']!.model).not.toBe(RELAY_AGENT_PLACEHOLDER);
  });

  it('resolves native picker slots back to relay routes', () => {
    const result = injectRelayModels(fixture, routes, 'gemini-3.5-flash-low');
    expect(resolveRelayCatalogSlots(result, routes, 'gemini-3.5-flash-low')).toEqual([
      { slotId: RELAY_CASCADE_ANCHOR_ID, route: routes[0] },
      { slotId: 'claude-sonnet-4-6', route: routes[1] },
    ]);
  });

  it('bounds the native M20 anchor checkpointer to the selected relay context', () => {
    const result = injectRelayModels(
      catalogFixtureRaw as CatalogFixture,
      [{ ...routes[0]!, contextWindow: 200000 }],
      'gemini-3.5-flash-low',
    );
    const modelExperiments = result.models[RELAY_CASCADE_ANCHOR_ID]!.modelExperiments as {
      experiments: Record<string, { stringValue: string }>;
    };
    const config = JSON.parse(
      modelExperiments.experiments.CASCADE_USE_EXPERIMENT_CHECKPOINTER!.stringValue,
    );
    expect(result.models[RELAY_CASCADE_ANCHOR_ID]!.maxTokens).toBe(200000);
    expect(result.models[RELAY_CASCADE_ANCHOR_ID]!.maxOutputTokens).toBe(65536);
    expect(config.max_token_limit).toBe('128000');
    expect(config.token_threshold).toBe('50000');
  });

  it('does not leak provider API keys in serialized output', () => {
    const result = injectRelayModels(fixture, routes, 'gemini-3.5-flash-low');
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('secret-key-123');
    expect(serialized).not.toContain('another-secret-key');
  });

  it('does not leak provider base URLs in serialized output', () => {
    const result = injectRelayModels(fixture, routes, 'gemini-3.5-flash-low');
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('api.example.com');
    expect(serialized).not.toContain('api.groq.com');
  });

  it('rejects catalog ID collisions', () => {
    const dupRoutes: AntigravityRoute[] = [
      routes[0]!,
      { ...routes[0]! }, // same catalogId
    ];
    expect(() => injectRelayModels(fixture, dupRoutes, 'gemini-3.5-flash-low')).toThrow(/collision/i);
  });

  it('skips duplicate routes', () => {
    const dupRoutes: AntigravityRoute[] = [
      routes[0]!,
      { ...routes[0]!, displayName: 'Duplicate' },
    ];
    // Same catalogId = collision, should throw
    expect(() => injectRelayModels(fixture, dupRoutes, 'gemini-3.5-flash-low')).toThrow();
  });

  it('handles empty routes gracefully', () => {
    const result = injectRelayModels(fixture, [], 'gemini-3.5-flash-low');
    expect(result.agentModelSorts[0]!.groups[0]!.modelIds).toEqual([
      'gemini-3.5-flash-low',
      'claude-sonnet-4-6',
    ]);
  });

  it('sets defaultAgentModelId to the native M20 launch anchor', () => {
    const result = injectRelayModels(fixture, routes, 'gemini-3.5-flash-low');
    expect(result.defaultAgentModelId).toBe(RELAY_CASCADE_ANCHOR_ID);
  });

  it('retains the hidden Flash Lite cascade fallback required by agy', () => {
    const result = injectRelayModels(fixture, routes, 'gemini-3.5-flash-low');
    expect(result.models['gemini-2.5-flash-lite']).toMatchObject({
      model: 'MODEL_GOOGLE_GEMINI_2_5_FLASH_LITE',
      apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
      modelProvider: 'MODEL_PROVIDER_GOOGLE',
    });
    expect(result.agentModelSorts[0]?.groups[0]?.modelIds)
      .not.toContain('gemini-2.5-flash-lite');
  });

  it('retains the hidden Flash intent model required by agy', () => {
    const result = injectRelayModels(fixture, routes, 'gemini-3.5-flash-low');
    expect(result.models['gemini-2.5-flash']).toMatchObject({
      model: 'MODEL_GOOGLE_GEMINI_2_5_FLASH',
      apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
      modelProvider: 'MODEL_PROVIDER_GOOGLE',
    });
    expect(result.agentModelSorts[0]?.groups[0]?.modelIds)
      .not.toContain('gemini-2.5-flash');
  });

  it('gives hidden cascade models a nonzero checkpointer limit', () => {
    const result = injectRelayModels(fixture, routes, 'gemini-3.5-flash-low');
    for (const modelId of ['gemini-2.5-flash-lite', 'gemini-2.5-flash']) {
      expect(result.models[modelId]!.modelExperiments).toBeDefined();
      const modelExperiments = result.models[modelId]!.modelExperiments as {
        experiments: Record<string, { stringValue: string }>;
      };
      const config = JSON.parse(
        modelExperiments.experiments.CASCADE_USE_EXPERIMENT_CHECKPOINTER!.stringValue,
      );
      expect(config.max_token_limit).toBe('128000');
      expect(config.enabled).toBe(true);
    }
  });

  it('builds listExperiments using the current numeric experimentIds format', () => {
    const response = buildListExperimentsResponse();
    expect(response).not.toHaveProperty('experiments');
    const experimentIds = response.experimentIds as number[];
    expect(experimentIds.length).toBeGreaterThan(50);
    expect(experimentIds.every(id => Number.isInteger(id))).toBe(true);
    expect(experimentIds).toContain(105979552);
    expect(experimentIds).toContain(106121604);
  });

  it('builds listModelConfigs for every selectable relay route', () => {
    const catalog = injectRelayModels(fixture, routes, 'gemini-3.5-flash-low');
    const response = buildListModelConfigsResponse(routes, catalog);
    expect(response.allowedModelConfigs).toEqual([
      { requestedModelId: RELAY_CASCADE_ANCHOR_ID, planModel: RELAY_CASCADE_PLAN_MODEL, requestedModel: RELAY_AGENT_PLACEHOLDER },
      {
        requestedModelId: 'claude-sonnet-4-6',
        planModel: RELAY_CASCADE_PLAN_MODEL,
        requestedModel: catalog.models['claude-sonnet-4-6']!.model,
      },
    ]);
    expect(response.defaultAgentModelConfig).toEqual({
      requestedModelId: RELAY_CASCADE_ANCHOR_ID,
      planModel: RELAY_CASCADE_PLAN_MODEL,
      requestedModel: RELAY_AGENT_PLACEHOLDER,
    });
    expect(response.clientModelConfigs).toMatchObject([
      {
        label: 'DeepSeek V4 Flash (Relay)',
        modelOrAlias: {
          alias: RELAY_CASCADE_ANCHOR_ID,
          choice: { case: 'alias', value: RELAY_CASCADE_ANCHOR_ID },
        },
        disabled: false,
      },
      {
        label: 'Llama 3.3 70B (Relay)',
        modelOrAlias: {
          alias: 'claude-sonnet-4-6',
          choice: { case: 'alias', value: 'claude-sonnet-4-6' },
        },
        disabled: false,
      },
    ]);
    expect(response.clientModelSorts).toEqual([
      {
        name: 'Recommended',
        groups: [
          {
            groupName: '',
            modelLabels: [
              'DeepSeek V4 Flash (Relay)',
              'Llama 3.3 70B (Relay)',
            ],
          },
        ],
      },
    ]);
  });

  const NATIVE_SLOT_IDS = [
    'gemini-3.5-flash-low',
    'gemini-3.5-flash-extra-low',
    'gemini-3.1-pro-low',
    'gemini-pro-agent',
    'claude-sonnet-4-6',
    'claude-opus-4-6-thinking',
    'gpt-oss-120b-medium',
  ];

  it('fills validated native slots first, then lists the rest as Relay-only entries', () => {
    const manyRoutes = Array.from({ length: 25 }, (_, i) => ({
      ...routes[0]!,
      catalogId: `relay-ai__zen__model_${i}`,
      modelId: `model_${i}`,
      upstreamModelId: `model_${i}`,
      displayName: `Model ${i} (Relay)`,
    }));

    const plan = planRelayCatalogSlots(
      catalogFixtureRaw as CatalogFixture,
      manyRoutes,
      'gemini-3.5-flash-low',
    );

    const slotIds = plan.slots.map(slot => slot.slotId);
    expect(slotIds.slice(0, 7)).toEqual(NATIVE_SLOT_IDS);
    // The IDE hides picker IDs containing underscores.
    expect(slotIds[7]).toBe('relay-ai-zen-model-7');
    for (const id of slotIds) expect(id).not.toContain('_');
    expect(new Set(slotIds).size).toBe(25);
    expect(plan.switchableRoutes).toHaveLength(25);
    expect(plan.skippedRoutes).toHaveLength(0);

    const enums = plan.slots.slice(7).map(slot => slot.extraModelEnum);
    expect(new Set(enums).size).toBe(18);
    const nativeEnums = new Set(Object.values((catalogFixtureRaw as CatalogFixture).models).map(m => m.model));
    for (const value of enums) expect(nativeEnums.has(value!)).toBe(false);
  });

  it('nativeSlots: false lists every route as a Relay-only entry (agy)', () => {
    const manyRoutes = Array.from({ length: 10 }, (_, i) => ({
      ...routes[0]!,
      catalogId: `relay-ai__zen__model-${i}`,
      displayName: `Model ${i} (Relay)`,
    }));
    const raw = catalogFixtureRaw as CatalogFixture;
    const plan = planRelayCatalogSlots(raw, manyRoutes, 'gemini-3.5-flash-low', { nativeSlots: false });
    const slotIds = plan.slots.map(slot => slot.slotId);
    expect(slotIds[0]).toBe('relay-ai-zen-model-0');
    for (const id of slotIds) expect(NATIVE_SLOT_IDS).not.toContain(id);
    for (const slot of plan.slots) expect(slot.extraModelEnum).toBeDefined();
    expect(plan.switchableRoutes).toHaveLength(10);

    // Every later pass (gateway routing, model configs) must agree on the same IDs.
    const injected = injectRelayModels(raw, manyRoutes, 'gemini-3.5-flash-low', { nativeSlots: false });
    expect(injected.agentModelSorts[0]!.groups[0]!.modelIds).toEqual(slotIds);
    const again = resolveRelayCatalogSlots(injected, manyRoutes, 'gemini-3.5-flash-low', { nativeSlots: false });
    expect(again.map(slot => slot.slotId)).toEqual(slotIds);
    const configIds = (buildListModelConfigsResponse(manyRoutes, injected, 'gemini-3.5-flash-low', { nativeSlots: false })
      .allowedModelConfigs as any[]).map(config => config.requestedModelId);
    expect(configIds).toEqual(slotIds);
  });

  it('lists every route in the picker and model configs, past the native slots', () => {
    const manyRoutes = Array.from({ length: 25 }, (_, i) => ({
      ...routes[0]!,
      catalogId: `relay-ai__zen__model-${i}`,
      modelId: `model-${i}`,
      upstreamModelId: `model-${i}`,
      displayName: `Model ${i} (Relay)`,
    }));

    const catalog = injectRelayModels(catalogFixtureRaw as CatalogFixture, manyRoutes, 'gemini-3.5-flash-low');
    const configs = buildListModelConfigsResponse(manyRoutes, catalog);

    const pickerIds = catalog.agentModelSorts[0]!.groups[0]!.modelIds;
    expect(pickerIds).toHaveLength(25);
    expect(pickerIds.slice(0, 7)).toEqual(NATIVE_SLOT_IDS);
    expect(pickerIds).toContain('relay-ai-zen-model-7');
    expect(catalog.models['relay-ai-zen-model-7']!.displayName).toBe('Model 7 (Relay)');
    expect((configs.allowedModelConfigs as unknown[])).toHaveLength(25);
    expect((configs.clientModelConfigs as unknown[])).toHaveLength(25);
    expect(((configs.clientModelSorts as any[])[0].groups[0].modelLabels as string[])).toHaveLength(25);
  });

  it('plans the same slot IDs when run again on the injected catalog', () => {
    // The gateway routes requests and builds listModelConfigs by planning against
    // the catalog it already injected. Drift here means requests to Relay-only
    // entries miss the route map and get rejected.
    const manyRoutes = Array.from({ length: 12 }, (_, i) => ({
      ...routes[0]!,
      catalogId: `relay-ai__zen__model_${i}`,
      modelId: `model_${i}`,
      upstreamModelId: `model_${i}`,
      displayName: `Model ${i} (Relay)`,
    }));
    const raw = catalogFixtureRaw as CatalogFixture;
    const injected = injectRelayModels(raw, manyRoutes, 'gemini-3.5-flash-low');

    const first = planRelayCatalogSlots(raw, manyRoutes, 'gemini-3.5-flash-low').slots;
    const again = planRelayCatalogSlots(injected, manyRoutes, 'gemini-3.5-flash-low').slots;
    expect(again.map(slot => slot.slotId)).toEqual(first.map(slot => slot.slotId));
    expect(again.map(slot => slot.extraModelEnum)).toEqual(first.map(slot => slot.extraModelEnum));

    const pickerIds = injected.agentModelSorts[0]!.groups[0]!.modelIds;
    const configIds = (buildListModelConfigsResponse(manyRoutes, injected).allowedModelConfigs as any[])
      .map(config => config.requestedModelId);
    expect(configIds).toEqual(pickerIds);
  });

  it('does not advertise audio support for relay-backed Antigravity models', () => {
    const catalog = injectRelayModels(
      catalogFixtureRaw as CatalogFixture,
      routes,
      'gemini-3.5-flash-low',
    );
    const configs = buildListModelConfigsResponse(routes, catalog);
    const routeMimeTypes = catalog.models[routes[0]!.catalogId]!.supportedMimeTypes as Record<string, boolean>;
    const slotMimeTypes = catalog.models['gemini-3.5-flash-low']!.supportedMimeTypes as Record<string, boolean>;
    const clientMimeTypes = (configs.clientModelConfigs as any[])[0]!.supportedMimeTypes as Record<string, boolean>;

    for (const mimeTypes of [routeMimeTypes, slotMimeTypes, clientMimeTypes]) {
      expect(Object.keys(mimeTypes).some(mime => mime.toLowerCase().includes('audio/'))).toBe(false);
      expect(mimeTypes['image/png']).toBe(true);
    }
    expect(catalog.audioTranscriptionModelIds).toEqual([]);
  });

  it('uses unique route labels consistently for duplicate dropdown model names', () => {
    const duplicateRoutes = buildAntigravityRoutes([
      {
        providerId: 'xai-oauth',
        providerName: 'xAI SuperGrok',
        authType: 'oauth',
        oauthAccountId: 'acct-123',
        model: {
          id: 'grok-build-0.1',
          name: 'Grok Build',
          upstreamModelId: 'grok-build-0.1',
          npm: '@ai-sdk/xai',
        },
        apiKey: 'oauth-token',
      },
      {
        providerId: 'xai',
        providerName: 'xAI API',
        authType: 'api',
        model: {
          id: 'grok-build-0.1',
          name: 'Grok Build',
          upstreamModelId: 'grok-build-0.1',
          npm: '@ai-sdk/xai',
        },
        apiKey: 'api-key',
      },
    ] as any[]);
    const catalog = injectRelayModels(fixture, duplicateRoutes, 'gemini-3.5-flash-low');
    const configs = buildListModelConfigsResponse(duplicateRoutes, catalog);

    expect(catalog.models[RELAY_CASCADE_ANCHOR_ID]!.displayName).toBe('Grok Build (Relay - xAI SuperGrok)');
    expect(catalog.models['claude-sonnet-4-6']!.displayName).toBe('Grok Build (Relay - xAI API)');
    expect((configs.clientModelConfigs as any[]).map(config => config.label)).toEqual([
      'Grok Build (Relay - xAI SuperGrok)',
      'Grok Build (Relay - xAI API)',
    ]);
  });

  it('preserves unknown fields from the fixture', () => {
    const fixtureWithExtra: CatalogFixture = {
      ...fixture,
      commandModelIds: ['gemini-3.5-flash-low'],
      tabModelIds: ['chat_20706'],
      experimentIds: ['exp1'],
    };
    const result = injectRelayModels(fixtureWithExtra, routes, 'gemini-3.5-flash-low');
    expect(result.commandModelIds).toEqual(['gemini-3.5-flash-low']);
    expect(result.tabModelIds).toEqual(['chat_20706']);
    expect(result.experimentIds).toEqual(['exp1']);
  });
});

describe('antigravity route resolution', () => {
  it('builds antigravity routes from resolved favorites', () => {
    const favorites = [
      {
        providerId: 'zen',
        providerName: 'OpenCode Zen',
        model: { id: 'llama-3.1-8b', name: 'Llama 8B' },
        apiKey: 'key-1',
      },
      {
        providerId: 'groq',
        providerName: 'Groq',
        model: { id: 'llama-3.3-70b', name: 'Llama' },
        apiKey: 'key-2',
      },
    ] as any[];

    const result = buildAntigravityRoutes(favorites);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      catalogId: 'relay-ai__zen__llama-3_1-8b',
      providerId: 'zen',
      providerName: 'OpenCode Zen',
      modelId: 'llama-3.1-8b',
      upstreamModelId: 'llama-3.1-8b',
      displayName: 'Llama 8B (Relay - OpenCode Zen)',
      npm: '@ai-sdk/openai-compatible',
      apiKey: 'key-1',
      baseURL: undefined,
      contextWindow: undefined,
    });
  });

  it('keeps same-named OAuth and API-key models as separate AGY routes', () => {
    const result = buildAntigravityRoutes([
      {
        providerId: 'xai-oauth',
        providerName: 'xAI SuperGrok',
        authType: 'oauth',
        oauthAccountId: 'acct-123',
        model: {
          id: 'grok-build-0.1',
          name: 'Grok Build',
          upstreamModelId: 'grok-build-0.1',
          npm: '@ai-sdk/xai',
        },
        apiKey: 'oauth-token',
      },
      {
        providerId: 'xai',
        providerName: 'xAI API',
        authType: 'api',
        model: {
          id: 'grok-build-0.1',
          name: 'Grok Build',
          upstreamModelId: 'grok-build-0.1',
          npm: '@ai-sdk/xai',
        },
        apiKey: 'api-key',
      },
    ] as any[]);

    expect(result).toMatchObject([
      {
        catalogId: 'relay-ai__xai-oauth__grok-build-0_1',
        providerId: 'xai-oauth',
        displayName: 'Grok Build (Relay - xAI SuperGrok)',
        apiKey: 'oauth-token',
        authType: 'oauth',
        oauthAccountId: 'acct-123',
      },
      {
        catalogId: 'relay-ai__xai__grok-build-0_1',
        providerId: 'xai',
        displayName: 'Grok Build (Relay - xAI API)',
        apiKey: 'api-key',
        authType: 'api',
      },
    ]);
  });

  it('limits routes to MAX_MODEL_CATALOG', () => {
    const favorites = Array.from({ length: 25 }, (_, i) => ({
      providerId: 'groq',
      providerName: 'Groq',
      model: { id: `llama-${i}`, name: `Llama-${i}` },
      apiKey: 'key',
    })) as any[];

    const result = buildAntigravityRoutes(favorites, 20);
    expect(result).toHaveLength(20);
  });
});

describe('antigravity effort variants', () => {
  const gpt = (id: string, name: string) => ({
    id,
    name,
    upstreamModelId: id,
    npm: '@ai-sdk/openai',
    reasoning: true,
    reasoningEffortLevels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  });
  const fav = (providerId: string, model: object) => ({ providerId, providerName: providerId, model, apiKey: 'k' });

  it('picks medium and the two levels above it for favorites, topping up from below', () => {
    expect(favoriteEffortLevels(['none', 'low', 'medium', 'high', 'xhigh', 'max'], 'medium')).toEqual(['medium', 'high', 'xhigh']);
    expect(favoriteEffortLevels(['low', 'medium', 'high'], 'medium')).toEqual(['low', 'medium', 'high']);
    expect(favoriteEffortLevels(['low', 'high'], 'high')).toEqual(['low', 'high']);
    expect(favoriteEffortLevels(['low', 'high', 'xhigh', 'max'], 'high')).toEqual(['high', 'xhigh', 'max']);
  });

  it('lists the launch model at every level and favorites at three', () => {
    const routes = buildAntigravityRoutes([
      fav('openai-oauth', gpt('gpt-6-sol', 'GPT-6 Sol')),
      fav('openai', gpt('gpt-6-luna', 'GPT-6 Luna')),
      fav('groq', { id: 'llama-3.1-8b', name: 'Llama 8B' }),
    ] as any[]);

    expect(routes.map(route => [route.displayName, route.reasoningEffort])).toEqual([
      ['GPT-6 Sol None (Relay - openai-oauth)', 'none'],
      ['GPT-6 Sol Low (Relay - openai-oauth)', 'low'],
      ['GPT-6 Sol Medium (Relay - openai-oauth)', 'medium'],
      ['GPT-6 Sol High (Relay - openai-oauth)', 'high'],
      ['GPT-6 Sol XHigh (Relay - openai-oauth)', 'xhigh'],
      ['GPT-6 Sol Max (Relay - openai-oauth)', 'max'],
      ['GPT-6 Luna Medium (Relay - openai)', 'medium'],
      ['GPT-6 Luna High (Relay - openai)', 'high'],
      ['GPT-6 Luna XHigh (Relay - openai)', 'xhigh'],
      ['Llama 8B (Relay - groq)', undefined],
    ]);
    expect(routes[0]!.catalogId).toBe('relay-ai__openai-oauth__gpt-6-sol__effort_none');
    expect(new Set(routes.map(route => route.catalogId)).size).toBe(routes.length);
  });

  it('agy: low/medium/high/max for the slider, plus an XHigh row where supported', () => {
    const routes = buildAntigravityRoutes([
      fav('openai-oauth', gpt('gpt-6-sol', 'GPT-6 Sol')),
      fav('zai', { ...gpt('glm-5', 'GLM 5'), npm: '@ai-sdk/openai-compatible', reasoningEffortLevels: ['low', 'medium', 'high'] }),
      fav('groq', { id: 'llama-3.1-8b', name: 'Llama 8B' }),
    ] as any[], undefined, { effortSlider: true });

    // agy names the slider row after its first entry, so that one carries no level.
    expect(routes.map(route => [route.displayName, route.reasoningEffort])).toEqual([
      ['GPT-6 Sol (Relay - openai-oauth)', 'low'],
      ['GPT-6 Sol Medium (Relay - openai-oauth)', 'medium'],
      ['GPT-6 Sol High (Relay - openai-oauth)', 'high'],
      ['GPT-6 Sol XHigh (Relay - openai-oauth)', 'xhigh'],
      ['GPT-6 Sol Max (Relay - openai-oauth)', 'max'],
      ['GLM 5 (Relay - zai)', 'low'],
      ['GLM 5 Medium (Relay - zai)', 'medium'],
      ['GLM 5 High (Relay - zai)', 'high'],
      ['Llama 8B (Relay - groq)', undefined],
    ]);
  });

  it('keeps Cloud Code routes as a single entry', () => {
    const routes = buildAntigravityRoutes([
      fav('antigravity', { ...gpt('gemini-3.8-flash', 'Gemini 3.8 Flash'), modelFormat: 'cloud-code' }),
    ] as any[]);
    expect(routes).toHaveLength(1);
    expect(routes[0]!.reasoningEffort).toBeUndefined();
  });

  it('counts effort variants against the catalog cap', () => {
    const routes = buildAntigravityRoutes([
      fav('openai-oauth', gpt('gpt-6-sol', 'GPT-6 Sol')),
      fav('openai', gpt('gpt-6-luna', 'GPT-6 Luna')),
    ] as any[], 7);
    expect(routes).toHaveLength(7);
    expect(routes.at(-1)!.displayName).toBe('GPT-6 Luna Medium (Relay - openai)');
  });
});
