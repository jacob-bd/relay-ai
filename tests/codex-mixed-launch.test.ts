import { describe, expect, it } from 'vitest';
import { buildCodexMixedLaunchPlan } from '../src/codex/mixed-launch.js';
import { assertConfiguredCodexSubagentsResolved, resolveCodexMixedModels } from '../src/codex/favorites-launch.js';
import { codexLaunchModeOptions } from '../src/codex/prompts.js';
import type { NativeCodexCatalogSnapshot } from '../src/codex/native-catalog.js';
import type { ResolvedCodexMixedModels } from '../src/codex/favorites-launch.js';

const nativeCatalog: NativeCodexCatalogSnapshot = {
  schemaVersion: 1, target: 'cli', binaryPath: '/tmp/codex', codexVersion: '0.147.0', capturedAt: new Date().toISOString(), source: 'refreshed',
  models: [{ slug: 'gpt-5.5', display_name: 'GPT-5.5', supported_reasoning_levels: [], default_reasoning_level: 'high', default_reasoning_summary: 'auto', shell_type: 'default', visibility: 'list', supported_in_api: true, priority: 1, availability_nux: null, upgrade: null, base_instructions: '', supports_reasoning_summaries: true, support_verbosity: false, default_verbosity: null, apply_patch_tool_type: null, truncation_policy: { mode: 'tokens', limit: 1000 }, supports_parallel_tool_calls: true, experimental_supported_tools: [], multi_agent_version: 'v2' }],
};

const relay = (providerId: string, id: string) => ({ providerId, providerName: providerId, apiKey: 'key', model: { id, name: id, modelFormat: 'openai', npm: '@ai-sdk/openai-compatible', upstreamModelId: id } }) as never;

describe('Codex mixed launch planning', () => {
  it('reports a favorite excluded because the selected model consumes a catalog slot', async () => {
    const models = Array.from({ length: 21 }, (_, index) => ({
      id: `test-model-${index}`,
      name: `Test Model ${index}`,
      modelFormat: 'openai' as const,
      npm: '@ai-sdk/openai-compatible',
      upstreamModelId: `test-model-${index}`,
      contextWindow: 200_000,
    }));
    const provider = {
      id: 'test-provider',
      name: 'Test Provider',
      authType: 'none' as const,
      models,
    };
    const favorites = models.slice(1).map(model => ({
      providerId: provider.id,
      modelId: model.id,
    }));

    const result = await resolveCodexMixedModels({
      activeProvider: provider,
      selectedModel: models[0]!,
      compatible: [provider],
      generalFavorites: favorites,
      subagentFavorites: [],
    });

    expect(result.visible).toHaveLength(20);
    expect(result.capacitySkipped).toEqual([
      { providerId: provider.id, modelId: 'test-model-20' },
    ]);
  });

  it('rejects a mixed launch when configured Codex Sub-agents disappear during resolution', () => {
    expect(() => assertConfiguredCodexSubagentsResolved(
      [{ providerId: 'google', modelId: 'gemini-3.5-flash' }],
      { subagents: [] },
    )).toThrowError(
      'Configured Codex Sub-agent model(s) are unavailable for this launch: google:gemini-3.5-flash',
    );
  });

  it('accepts a mixed launch when every configured Codex Sub-agent resolves', () => {
    expect(() => assertConfiguredCodexSubagentsResolved(
      [{ providerId: 'google', modelId: 'gemini-3.5-flash' }],
      { subagents: [{ providerId: 'google', model: { id: 'gemini-3.5-flash' } } as never] },
    )).not.toThrow();
  });

  it('offers an explicit Relay-only default before enabling native models', () => {
    expect(codexLaunchModeOptions()).toEqual([
      expect.objectContaining({ value: 'relay-only', label: expect.stringContaining('Relay models only') }),
      expect.objectContaining({ value: 'mixed', label: expect.stringContaining('native Codex models') }),
    ]);
  });

  it('plans one route set containing the configured sub-agent catalog', () => {
    const selected = relay('kilo', 'auto');
    const general = relay('openrouter', 'general');
    const subagent = relay('google', 'gemini');
    const models: ResolvedCodexMixedModels = {
      selected,
      visible: [selected, general],
      subagents: [subagent],
      all: [selected, general, subagent],
      providersById: new Map([
        ['kilo', { id: 'kilo', name: 'kilo', models: [selected.model as never], authType: 'api' } as never],
        ['openrouter', { id: 'openrouter', name: 'openrouter', models: [general.model as never], authType: 'api' } as never],
        ['google', { id: 'google', name: 'google', models: [subagent.model as never], authType: 'api' } as never],
      ]),
      dropped: [],
      capacitySkipped: [],
    };
    const plan = buildCodexMixedLaunchPlan({ nativeCatalog, models, multiAgentV2Supported: true });
    expect(plan.nativeModelIds).toEqual(new Set(['gpt-5.5']));
    expect(plan.relayRoutes.map(route => route.modelId)).toEqual([
      'kilo__auto', 'openrouter__general', 'google__gemini',
    ]);
    expect(plan.subagentModelCount).toBe(1);
    expect(plan.subagentRouteModelId).toBe('google__gemini');
    expect(plan).not.toHaveProperty('subagentRouteModelIds');
    expect(plan.multiAgentV2Enabled).toBe(true);
    expect(plan.catalog.models.find(model => model.slug === 'google__gemini')?.visibility).toBe('list');
    expect(plan.catalog.models.find(model => model.slug === 'google__gemini')?.multi_agent_version).toBe('v2');
    expect(plan).not.toHaveProperty('subagentProfiles');
    expect(plan.selectedSlug).toBe('kilo__auto');
    expect(plan.capability).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('rejects more than one resolved Codex Sub-agent model', () => {
    const selected = relay('kilo', 'auto');
    const first = relay('deepseek', 'deepseek-v4-flash');
    const second = relay('google', 'gemini-3.5-flash');
    const models: ResolvedCodexMixedModels = {
      selected,
      visible: [selected],
      subagents: [first, second],
      all: [selected, first, second],
      providersById: new Map([
        ['kilo', { id: 'kilo', name: 'kilo', models: [selected.model as never], authType: 'api' } as never],
        ['deepseek', { id: 'deepseek', name: 'deepseek', models: [first.model as never], authType: 'api' } as never],
        ['google', { id: 'google', name: 'google', models: [second.model as never], authType: 'api' } as never],
      ]),
      dropped: [],
      capacitySkipped: [],
    };

    expect(() => buildCodexMixedLaunchPlan({ nativeCatalog, models, multiAgentV2Supported: true }))
      .toThrowError('Codex mixed mode supports exactly one Relay Sub-agent model');
  });
});
