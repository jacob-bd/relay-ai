import { describe, expect, it } from 'vitest';
import { buildCodexMixedLaunchPlan } from '../src/codex/mixed-launch.js';
import { resolveCodexFavorites, resolveCodexMixedModels } from '../src/codex/favorites-launch.js';
import type { NativeCodexCatalogSnapshot } from '../src/codex/native-catalog.js';

const nativeCatalog: NativeCodexCatalogSnapshot = {
  schemaVersion: 1, target: 'cli', binaryPath: '/tmp/codex', codexVersion: '0.147.0', capturedAt: new Date().toISOString(), source: 'refreshed',
  models: [{ slug: 'gpt-5.5', display_name: 'GPT-5.5', supported_reasoning_levels: [], default_reasoning_level: 'high', default_reasoning_summary: 'auto', shell_type: 'default', visibility: 'list', supported_in_api: true, priority: 1, availability_nux: null, upgrade: null, base_instructions: '', supports_reasoning_summaries: true, support_verbosity: false, default_verbosity: null, apply_patch_tool_type: null, truncation_policy: { mode: 'tokens', limit: 1000 }, supports_parallel_tool_calls: true, experimental_supported_tools: [], multi_agent_version: 'v2' }],
};

const model = (id: string) => ({ id, name: id, family: '', brand: '', modelFormat: 'openai' as const, npm: '@ai-sdk/openai-compatible', upstreamModelId: id, contextWindow: 200_000 });
const provider = { id: 'groq', name: 'Groq', authType: 'none' as const, models: [model('a'), model('b'), model('c')] };

describe('Codex session that starts on the Relay Free Pool', () => {
  it('lists only the favorites when there is no Relay starting model (mixed)', async () => {
    const result = await resolveCodexMixedModels({
      activeProvider: provider,
      compatible: [provider],
      generalFavorites: [{ providerId: 'groq', modelId: 'b' }],
      subagentFavorites: [],
    });
    expect(result.selected).toBeUndefined();
    expect(result.visible.map(entry => entry.model.id)).toEqual(['b']);
  });

  it('adds no unrelated model from the starting provider (favorites)', async () => {
    const { resolvedFavorites } = await resolveCodexFavorites(
      undefined, undefined, [provider], [{ providerId: 'groq', modelId: 'c' }], 'codex',
    );
    expect(resolvedFavorites.map(entry => entry.model.id)).toEqual(['c']);
  });

  it('opens the mixed session on the pool slug, with native models and favorites listed', async () => {
    const models = await resolveCodexMixedModels({
      activeProvider: provider,
      compatible: [provider],
      generalFavorites: [{ providerId: 'groq', modelId: 'b' }],
      subagentFavorites: [],
    });
    const plan = buildCodexMixedLaunchPlan({ nativeCatalog, models, multiAgentV2Supported: true, startSlug: 'relay-free-pool' });
    expect(plan.selectedSlug).toBe('relay-free-pool');
    expect(plan.nativeModelIds).toEqual(new Set(['gpt-5.5']));
    expect(plan.catalog.models.map(entry => entry.slug)).toContain('groq__b');
    expect(plan.catalog.models.map(entry => entry.slug)).toContain('gpt-5.5');
  });

  it('refuses a mixed plan that has neither a Relay starting model nor a start slug', async () => {
    const models = await resolveCodexMixedModels({
      activeProvider: provider, compatible: [provider], generalFavorites: [], subagentFavorites: [],
    });
    expect(() => buildCodexMixedLaunchPlan({ nativeCatalog, models })).toThrowError('Mixed Codex mode needs a starting model');
  });
});
