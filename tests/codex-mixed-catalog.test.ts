import { describe, expect, it } from 'vitest';
import { composeMixedCodexCatalog } from '../src/codex/mixed-catalog.js';
import type { ResolvedFavorite } from '../src/favorites-resolver.js';
import type { LocalProviderModel } from '../src/types.js';

const native = {
  slug: 'gpt-5.5', display_name: 'GPT-5.5', supported_reasoning_levels: [],
  default_reasoning_level: 'high', default_reasoning_summary: 'auto', shell_type: 'default',
  visibility: 'list', supported_in_api: true, priority: 1, availability_nux: null, upgrade: null,
  base_instructions: 'native', supports_reasoning_summaries: true, support_verbosity: false,
  default_verbosity: null, apply_patch_tool_type: null, truncation_policy: { mode: 'tokens', limit: 1000 },
  supports_parallel_tool_calls: true, experimental_supported_tools: [], multi_agent_version: 'v2',
  nested_unknown: { stable: true },
};

function favorite(providerId: string, modelId: string): ResolvedFavorite {
  const model: LocalProviderModel = {
    id: modelId, name: modelId, modelFormat: 'openai', npm: '@ai-sdk/openai-compatible',
    upstreamModelId: modelId, contextWindow: 128000,
  };
  return { providerId, providerName: providerId, model, apiKey: 'relay-key' };
}

describe('mixed Codex catalog composition', () => {
  it('preserves native objects and exposes configured sub-agent routes', () => {
    const catalog = composeMixedCodexCatalog({
      nativeModels: [native],
      visibleRelay: [{ resolved: favorite('kilo', 'auto'), slug: 'kilo__auto' }],
      subagentRelay: [{ resolved: favorite('google', 'gemini'), slug: 'google__gemini' }],
      selectedSlug: 'kilo__auto',
      externalMultiAgentVersion: 'v2',
    });
    expect(catalog.models[0]).toEqual(native);
    expect(catalog.models.find(m => m.slug === 'kilo__auto')?.visibility).toBe('list');
    expect(catalog.models.find(m => m.slug === 'google__gemini')?.visibility).toBe('list');
    expect(catalog.models.find(m => m.slug === 'kilo__auto')?.multi_agent_version).toBe('v2');
    expect(catalog.models.find(m => m.slug === 'google__gemini')?.multi_agent_version).toBe('v2');
    expect(catalog.models.find(m => m.slug === 'kilo__auto')?.nested_unknown).toEqual({ stable: true });
  });

  it('deduplicates a sub-agent entry already visible', () => {
    const catalog = composeMixedCodexCatalog({
      nativeModels: [native],
      visibleRelay: [{ resolved: favorite('kilo', 'auto'), slug: 'kilo__auto' }],
      subagentRelay: [{ resolved: favorite('kilo', 'auto'), slug: 'kilo__auto' }],
      selectedSlug: 'kilo__auto',
      externalMultiAgentVersion: 'v1',
    });
    expect(catalog.models.filter(m => m.slug === 'kilo__auto')).toHaveLength(1);
    expect(catalog.models.find(m => m.slug === 'kilo__auto')?.visibility).toBe('list');
  });
});
