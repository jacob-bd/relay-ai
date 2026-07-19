import { describe, it, expect } from 'vitest';
import { mergeModels } from '../src/models.js';
import { materializeRegistry } from '../src/registry/materialize.js';
import {
  findBlacklistEntry,
  hideReason,
  shouldHideModel,
} from '../src/model-compatibility.js';
import {
  findModelsDevModel,
  loadBundledModelsDevCache,
  readModelsDevCacheMeta,
  resolveModelsDevSlug,
  shouldHideByModelsDevCapabilities,
  stripModelsDevCacheMeta,
} from '../src/registry/models-dev.js';
import { isRoutableModel } from '../src/codex/routing.js';
import { normalizeProviders } from '../src/providers.js';
import type { LocalProviderModel } from '../src/types.js';

describe('shouldHideModel', () => {
  it('allows unknown models by default', () => {
    expect(shouldHideModel({
      providerId: 'google',
      modelId: 'gemini-4-flash-hypothetical',
      agent: 'codex-app',
    })).toBe(false);
  });

  it('hides antigravity on google provider', () => {
    const ctx = {
      providerId: 'google',
      modelId: 'antigravity-preview-05-2026',
      agent: 'codex-app' as const,
    };
    expect(shouldHideModel(ctx)).toBe(true);
    expect(hideReason(ctx)).toContain('managed_agent');
  });

  it('hides global blacklist ids regardless of provider', () => {
    expect(shouldHideModel({
      providerId: 'nvidia',
      modelId: 'z-ai/glm4.7',
      agent: 'claude',
    })).toBe(true);
  });

  it('respects agent scope on blacklist entries', () => {
    const entry = findBlacklistEntry({
      providerId: 'google',
      modelId: 'antigravity-preview-05-2026',
      agent: 'codex',
    });
    expect(entry).not.toBeNull();
    expect(entry?.agents).toBeUndefined();
  });

  it('hides unvalidated Antigravity OAuth Cloud Code slots', () => {
    expect(shouldHideModel({
      providerId: 'antigravity',
      modelId: 'gemini-2.5-pro',
      agent: 'claude',
    })).toBe(true);
    expect(hideReason({
      providerId: 'antigravity',
      modelId: 'gemini-2.5-pro',
      agent: 'claude',
    })).toContain('not a validated');
  });

  it('keeps validated Antigravity OAuth agent slots visible', () => {
    const validated = [
      'gemini-3.5-flash-low',
      'gemini-3.5-flash-extra-low',
      'gemini-3.1-pro-low',
      'gemini-pro-agent',
      'claude-sonnet-4-6',
      'claude-opus-4-6-thinking',
      'gpt-oss-120b-medium',
    ];

    for (const modelId of validated) {
      expect(shouldHideModel({ providerId: 'antigravity', modelId, agent: 'claude' }), modelId).toBe(false);
    }
  });

  it('does not apply the Antigravity OAuth allowlist to normal Google API models', () => {
    expect(shouldHideModel({
      providerId: 'google',
      modelId: 'gemini-2.5-pro',
      agent: 'claude',
    })).toBe(false);
  });
});

describe('models.dev capability rules', () => {
  const cache = loadBundledModelsDevCache();

  it('ships a bundled snapshot with metadata', () => {
    const meta = readModelsDevCacheMeta(cache);
    expect(meta?.source).toBe('https://models.dev/api.json');
    expect((meta?.provider_count ?? 0) > 50).toBe(true);
    expect(stripModelsDevCacheMeta(cache).google?.models).toBeDefined();
  });

  it('hides audio-only output when catalogued', () => {
    const entry = findModelsDevModel('google', 'gemini-2.5-flash-preview-tts', cache);
    expect(entry).not.toBeNull();
    expect(shouldHideByModelsDevCapabilities(entry!)).toBe(true);
    expect(shouldHideModel({
      providerId: 'google',
      modelId: 'gemini-2.5-flash-preview-tts',
      agent: 'codex',
    })).toBe(true);
  });

  it('does not hide text-output models with missing tool_call field', () => {
    const entry = findModelsDevModel('google', 'gemini-2.5-pro', cache);
    expect(entry).not.toBeNull();
    expect(shouldHideByModelsDevCapabilities(entry!)).toBe(false);
  });

  it('maps Qwen Cloud variants to their models.dev catalogs and hides incompatible rows', () => {
    expect(resolveModelsDevSlug('qwen-cloud-token-plan')).toBe('alibaba-token-plan');
    expect(resolveModelsDevSlug('qwen-cloud-payg')).toBe('alibaba');

    const tokenPlanImage = findModelsDevModel('qwen-cloud-token-plan', 'wan2.7-image-pro', cache);
    expect(tokenPlanImage).not.toBeNull();
    expect(shouldHideByModelsDevCapabilities(tokenPlanImage!)).toBe(true);
  });
});

describe('mergeModels', () => {
  it('filters stale free and deprecated ids', () => {
    const merged = mergeModels(
      ['qwen3.6-plus-free', 'mimo-v2-pro', 'claude-sonnet'],
      null,
      'zen',
    );
    expect(merged.map(m => m.id)).toEqual(['claude-sonnet']);
  });
});

describe('materializeRegistry', () => {
  it('drops blacklisted models from provider cache', () => {
    const registry = {
      schema_version: '1' as const,
      providers: [{
        id: 'google',
        templateId: 'google',
        name: 'Google',
        enabled: true,
        authRef: 'keyring:provider:google',
        api: { npm: '@ai-sdk/google' },
        addedAt: '2026-06-10T00:00:00.000Z',
        modelsCache: {
          fetchedAt: '2026-06-10T00:00:00.000Z',
          models: [
            {
              id: 'antigravity-preview-05-2026',
              name: 'Antigravity',
              upstreamModelId: 'antigravity-preview-05-2026',
              modelFormat: 'openai' as const,
              npm: '@ai-sdk/google',
            },
            {
              id: 'gemini-2.5-flash',
              name: 'Gemini 2.5 Flash',
              upstreamModelId: 'gemini-2.5-flash',
              modelFormat: 'openai' as const,
              npm: '@ai-sdk/google',
            },
          ],
        },
      }],
    };
    const locals = materializeRegistry(registry, () => 'key', { agent: 'codex-app' });
    expect(locals).toHaveLength(1);
    expect(locals[0]?.models.map(m => m.id)).toEqual(['gemini-2.5-flash']);
  });
});

describe('normalizeProviders', () => {
  it('skips globally blacklisted model ids', () => {
    const result = normalizeProviders([{
      id: 'openrouter',
      name: 'OpenRouter',
      key: 'sk-test',
      models: {
        gated: {
          id: 'z-ai/glm4.7',
          name: 'GLM 4.7',
          family: 'glm',
          api: { npm: '@ai-sdk/openai-compatible', url: 'https://openrouter.ai/api/v1' },
        },
        ok: {
          id: 'gpt-4o',
          name: 'GPT-4o',
          family: 'gpt',
          api: { npm: '@ai-sdk/openai', url: '' },
        },
      },
    }]);
    expect(result[0]?.models.map(m => m.id)).toEqual(['gpt-4o']);
  });
});

describe('Google raw API deny list', () => {
  const codingModels = [
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gemini-3.5-flash',
    'gemini-3.1-pro-preview',
    'gemma-4-31b-it',
  ];
  const nonCodingModels = [
    'imagen-4.0-generate-001',
    'veo-3.0-generate-001',
    'gemini-embedding-2',
    'gemini-3-pro-image',
    'gemini-3-pro-preview',
    'gemini-2.5-flash-preview-tts',
    'deep-research-max-preview-04-2026',
    'gemini-robotics-er-1.5-preview',
  ];

  it('hides non-coding Google API models', () => {
    for (const modelId of nonCodingModels) {
      expect(shouldHideModel({ providerId: 'google', modelId, agent: 'codex-app' }), modelId).toBe(true);
    }
  });

  it('keeps coding Gemini/Gemma models visible', () => {
    for (const modelId of codingModels) {
      expect(shouldHideModel({ providerId: 'google', modelId, agent: 'codex-app' }), modelId).toBe(false);
    }
  });
});

describe('isRoutableModel', () => {
  const openaiModel: LocalProviderModel = {
    id: 'gpt-4o',
    name: 'GPT-4o',
    family: 'gpt',
    brand: 'GPT',
    modelFormat: 'openai',
    upstreamModelId: 'gpt-4o',
    npm: '@ai-sdk/openai',
  };

  it('rejects blacklisted models even when format is routable', () => {
    const antigravity: LocalProviderModel = {
      ...openaiModel,
      id: 'antigravity-preview-05-2026',
      upstreamModelId: 'antigravity-preview-05-2026',
      npm: '@ai-sdk/google',
    };
    expect(isRoutableModel(antigravity, 'google', 'codex-app')).toBe(false);
    expect(isRoutableModel(openaiModel, 'openai', 'codex')).toBe(true);
  });
});
