import { describe, expect, it } from 'vitest';
import {
  effortProviderOptions,
  resolveReasoningCapabilities,
} from '../src/reasoning-capabilities.js';
import { RELAY_REASONING_LEVELS } from '../src/core/reasoning.js';

/** One route per reasoning wire format, covering the whole advertised vocabulary. */
const REPRESENTATIVE_ROUTES: Array<{ npm: string; modelId: string; metadata?: Record<string, unknown> }> = [
  { npm: '@ai-sdk/openai', modelId: 'gpt-5.1-codex-max' },
  { npm: '@ai-sdk/openai', modelId: 'gpt-5-pro' },
  { npm: '@ai-sdk/openai', modelId: 'gpt-5.6-luna', metadata: { useResponsesLite: true } },
  { npm: '@ai-sdk/google', modelId: 'gemini-3.7-flash-high' },
  { npm: '@ai-sdk/google', modelId: 'gemini-2.5-pro' },
  { npm: '@ai-sdk/anthropic', modelId: 'claude-sonnet-4-5' },
  { npm: '@ai-sdk/xai', modelId: 'grok-4.5' },
  { npm: '@ai-sdk/xai', modelId: 'grok-4.3' },
  { npm: '@ai-sdk/xai', modelId: 'grok-4.20-multi-agent' },
  { npm: '@ai-sdk/mistral', modelId: 'magistral-medium' },
  // Reasoning-capable model ids served by a provider package that has no
  // reasoning mapping — the shape that advertised 25 dead choices locally.
  { npm: '@ai-sdk/alibaba', modelId: 'glm-5.2', metadata: { providerId: 'qwen-cloud-payg' } },
  { npm: '@ai-sdk/alibaba', modelId: 'deepseek-v4-pro', metadata: { providerId: 'qwen-cloud-payg' } },
  { npm: '@ai-sdk/alibaba', modelId: 'kimi-k2.7-code', metadata: { providerId: 'qwen-cloud-payg' } },
  { npm: '@ai-sdk/openai-compatible', modelId: 'glm-5.2', metadata: { providerId: 'opencode-go' } },
  { npm: '@ai-sdk/openai-compatible', modelId: 'deepseek-v4' },
  // Metadata-driven route: levels come from supported_parameters, not a model rule.
  {
    npm: '@ai-sdk/openai-compatible',
    modelId: 'some-reasoning-model',
    metadata: { providerId: 'generic', supportedParameters: ['reasoning_effort'] },
  },
  { npm: '@ai-sdk/openai', modelId: 'gpt-5.2' },
  { npm: '@ai-sdk/openai', modelId: 'gpt-5.4' },
  { npm: '@ai-sdk/openai', modelId: 'gpt-5.5' },
  { npm: '@ai-sdk/openai', modelId: 'gpt-5.6' },
  {
    npm: '@openrouter/ai-sdk-provider',
    modelId: 'z-ai/glm-5.2',
    metadata: { providerId: 'openrouter', supportedParameters: ['reasoning'] },
  },
];

describe('reasoning vocabulary', () => {
  // The public RelayReasoningLevel union and the catalog's advertised levels
  // must be one vocabulary, or a consumer can read a level off a descriptor
  // that the public API refuses to accept.
  it('advertises only levels that are valid RelayReasoningLevel values', () => {
    for (const route of REPRESENTATIVE_ROUTES) {
      const caps = resolveReasoningCapabilities({
        npm: route.npm,
        modelId: route.modelId,
        ...(route.metadata ?? {}),
      } as never);
      for (const level of caps.levels) {
        expect(
          RELAY_REASONING_LEVELS as readonly string[],
          `${route.npm} ${route.modelId} advertises "${level}"`,
        ).toContain(level);
      }
    }
  });

  // Every advertised level must map to an actual request, and to a *distinct*
  // one. A missing mapping means the picker offers a level that does nothing
  // (and that Core rejects); a duplicate means a silent substitution.
  it('maps every advertised level to a distinct, non-empty request shape', () => {
    for (const route of REPRESENTATIVE_ROUTES) {
      const caps = resolveReasoningCapabilities({
        npm: route.npm,
        modelId: route.modelId,
        ...(route.metadata ?? {}),
      } as never);
      if (caps.mode !== 'controllable') continue;
      expect(caps.levels.length, `${route.npm} ${route.modelId} is controllable with no levels`).toBeGreaterThan(0);
      expect(caps.levels, `${route.npm} ${route.modelId} default not in levels`).toContain(caps.defaultLevel);
      const byWire = new Map<string, string>();
      for (const level of caps.levels) {
        const mapped = effortProviderOptions(route.npm, level, route.modelId, route.metadata as never);
        expect(
          mapped,
          `${route.npm} ${route.modelId} advertises "${level}" but it maps to no request`,
        ).toBeDefined();
        const wire = JSON.stringify(mapped);
        const collidesWith = byWire.get(wire);
        expect(
          collidesWith,
          `${route.npm} ${route.modelId}: "${level}" and "${collidesWith}" both send ${wire}`,
        ).toBeUndefined();
        byWire.set(wire, level);
      }
    }
  });
});

describe('resolveReasoningCapabilities', () => {
  it('uses OpenRouter supported_parameters as the source for controllable reasoning', () => {
    const caps = resolveReasoningCapabilities({
      providerId: 'openrouter',
      npm: '@openrouter/ai-sdk-provider',
      modelId: 'z-ai/glm-5.2',
      supportedParameters: ['tools', 'reasoning', 'include_reasoning'],
    });

    expect(caps.mode).toBe('controllable');
    expect(caps.source).toBe('provider-metadata');
    expect(caps.confidence).toBe('documented');
    expect(caps.levels).toEqual(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);
    expect(caps.defaultLevel).toBe('medium');
    expect(caps.supportsSummaries).toBe(false);
    expect(caps.wireFormat).toEqual({ kind: 'openrouter-reasoning' });
  });

  it('does not expose controls for OpenRouter models without the reasoning parameter', () => {
    const caps = resolveReasoningCapabilities({
      providerId: 'openrouter',
      npm: '@openrouter/ai-sdk-provider',
      modelId: 'openrouter/fusion',
      supportedParameters: ['tools'],
    });

    expect(caps.mode).toBe('none');
    expect(caps.levels).toEqual([]);
    expect(caps.defaultLevel).toBe('');
  });

  it('exposes GLM-5.2 high/xhigh controls for OpenCode Go style routes', () => {
    const caps = resolveReasoningCapabilities({
      providerId: 'go',
      npm: '@ai-sdk/openai-compatible',
      modelId: 'glm-5.2',
      reasoning: true,
      interleavedReasoningField: 'reasoning_content',
    });

    expect(caps.mode).toBe('controllable');
    expect(caps.source).toBe('provider-rule');
    expect(caps.confidence).toBe('documented');
    expect(caps.levels).toEqual(['high', 'xhigh']);
    expect(caps.defaultLevel).toBe('high');
  });
});

describe('effortProviderOptions', () => {
  it('maps OpenRouter effort to providerOptions.openrouter.reasoning', () => {
    expect(
      effortProviderOptions('@openrouter/ai-sdk-provider', 'high', 'z-ai/glm-5.2', {
        providerId: 'openrouter',
        supportedParameters: ['reasoning'],
      }),
    ).toEqual({
      openrouter: {
        reasoning: {
          effort: 'high',
          exclude: false,
        },
      },
    });
  });

  // "Uses the Responses API" is not the same capability as "accepts xhigh":
  // o-series and gpt-5-pro are Responses-only but documented as high-max.
  it('sends xhigh unchanged for Codex-family OpenAI models', () => {
    expect(effortProviderOptions('@ai-sdk/openai', 'xhigh', 'gpt-5.1-codex-max'))
      .toEqual({ openai: { reasoningEffort: 'xhigh' } });
    expect(resolveReasoningCapabilities({ npm: '@ai-sdk/openai', modelId: 'gpt-5.1-codex-max' }).levels)
      .toContain('xhigh');
  });

  // Per-model sets sourced from developers.openai.com (verified 2026-08-14),
  // not from the installed adapter's docs, which are behind. Every *named*
  // descendant is listed separately: a base-model prefix must never classify a
  // Pro / Codex / chat variant, because their effort sets genuinely differ.
  const OPENAI_DOCUMENTED = [
    ['gpt-5-pro', ['high'], 'high'],
    ['gpt-5.1', ['none', 'low', 'medium', 'high'], 'none'],
    ['gpt-5.2', ['none', 'low', 'medium', 'high', 'xhigh'], 'none'],
    ['gpt-5.2-pro', ['medium', 'high', 'xhigh'], 'medium'],
    ['gpt-5.2-codex', ['low', 'medium', 'high', 'xhigh'], 'medium'],
    ['gpt-5.3-codex', ['low', 'medium', 'high', 'xhigh'], 'medium'],
    ['gpt-5.4', ['none', 'low', 'medium', 'high', 'xhigh'], 'none'],
    ['gpt-5.4-mini', ['none', 'low', 'medium', 'high', 'xhigh'], 'none'],
    ['gpt-5.4-nano', ['none', 'low', 'medium', 'high', 'xhigh'], 'none'],
    ['gpt-5.4-pro', ['medium', 'high', 'xhigh'], 'medium'],
    ['gpt-5.5', ['none', 'low', 'medium', 'high', 'xhigh'], 'medium'],
    ['gpt-5.5-pro', ['medium', 'high', 'xhigh'], 'high'],
    ['gpt-5.6-luna', ['none', 'low', 'medium', 'high', 'xhigh', 'max'], 'medium'],
    ['gpt-5.6-sol', ['none', 'low', 'medium', 'high', 'xhigh', 'max'], 'medium'],
    ['gpt-5.6-terra', ['none', 'low', 'medium', 'high', 'xhigh', 'max'], 'medium'],
    ['gpt-5.1-codex-max', ['low', 'medium', 'high', 'xhigh'], 'medium'],
  ] as const;

  it.each(OPENAI_DOCUMENTED)(
    'offers exactly the documented reasoning levels for %s',
    (modelId, levels, defaultLevel) => {
      const caps = resolveReasoningCapabilities({ npm: '@ai-sdk/openai', modelId });
      expect(caps.levels).toEqual([...levels]);
      expect(caps.defaultLevel).toBe(defaultLevel);
      for (const level of levels) {
        expect(effortProviderOptions('@ai-sdk/openai', level, modelId))
          .toEqual({ openai: { reasoningEffort: level } });
      }
    },
  );

  // A dated snapshot is the same model; a named descendant is not.
  it.each(OPENAI_DOCUMENTED)('treats a dated snapshot of %s as the same model', (modelId, levels) => {
    const caps = resolveReasoningCapabilities({ npm: '@ai-sdk/openai', modelId: `${modelId}-2026-04-23` });
    expect(caps.levels).toEqual([...levels]);
  });

  it.each([
    ['gpt-5.2-pro', 'none'],
    ['gpt-5.2-pro', 'low'],
    ['gpt-5.4-pro', 'none'],
    ['gpt-5.4-pro', 'low'],
    ['gpt-5.5-pro', 'none'],
    ['gpt-5.5-pro', 'low'],
    ['gpt-5.2-codex', 'none'],
  ])('does not leak base-model level %s#%s into the descendant', (modelId, level) => {
    expect(resolveReasoningCapabilities({ npm: '@ai-sdk/openai', modelId }).levels).not.toContain(level);
    expect(effortProviderOptions('@ai-sdk/openai', level, modelId)).toBeUndefined();
  });

  // These share a base-model prefix with a reasoning model but are chat models
  // with no reasoning at all. Prefix matching would hand them the base set.
  it.each(['gpt-5.2-chat-latest', 'gpt-5.1-chat-latest', 'gpt-5.3-chat-latest'])(
    'does not treat a base-model prefix as covering the non-reasoning variant %s',
    modelId => {
      expect(resolveReasoningCapabilities({ npm: '@ai-sdk/openai', modelId }).mode).toBe('none');
      expect(effortProviderOptions('@ai-sdk/openai', 'high', modelId)).toBeUndefined();
    },
  );

  // The bundled models.dev cache marks some chat ids reasoning-capable. The
  // documented contract has to win, or these routes advertise and send an
  // effort the model does not accept.
  it.each(['gpt-5.2-chat-latest', 'gpt-5.1-chat-latest', 'gpt-5.3-chat-latest', 'gpt-5-chat-latest', 'chat-latest'])(
    'keeps %s non-reasoning even when metadata claims reasoning: true',
    modelId => {
      const caps = resolveReasoningCapabilities({ npm: '@ai-sdk/openai', modelId, reasoning: true });
      expect(caps.mode).toBe('none');
      expect(caps.levels).toEqual([]);
      expect(effortProviderOptions('@ai-sdk/openai', 'high', modelId, { reasoning: true })).toBeUndefined();
    },
  );

  // Catalog ids can differ from the id actually sent upstream (e.g. OpenCode's
  // `gpt-5.5-fast` → `gpt-5.5`). The profile belongs to the upstream model.
  it('resolves the profile from upstreamModelId, not the catalog alias', () => {
    const meta = { upstreamModelId: 'gpt-5.5' };
    const caps = resolveReasoningCapabilities({ npm: '@ai-sdk/openai', modelId: 'gpt-5.5-fast', ...meta });
    expect(caps.levels).toEqual(['none', 'low', 'medium', 'high', 'xhigh']);
    expect(caps.defaultLevel).toBe('medium');
    expect(effortProviderOptions('@ai-sdk/openai', 'xhigh', 'gpt-5.5-fast', meta))
      .toEqual({ openai: { reasoningEffort: 'xhigh' } });
  });

  it('honours an upstream alias that points at a restricted variant', () => {
    const meta = { upstreamModelId: 'gpt-5.5-pro' };
    const caps = resolveReasoningCapabilities({ npm: '@ai-sdk/openai', modelId: 'my-pro-alias', ...meta });
    expect(caps.levels).toEqual(['medium', 'high', 'xhigh']);
    expect(caps.defaultLevel).toBe('high');
    expect(effortProviderOptions('@ai-sdk/openai', 'none', 'my-pro-alias', meta)).toBeUndefined();
  });

  it('resolves a non-reasoning upstream alias as non-reasoning', () => {
    const meta = { upstreamModelId: 'gpt-5.2-chat-latest', reasoning: true };
    expect(resolveReasoningCapabilities({ npm: '@ai-sdk/openai', modelId: 'chat-alias', ...meta }).mode)
      .toBe('none');
  });

  // The table cannot list descendants that do not exist yet. An unlisted named
  // variant must fall back conservatively, never inherit its base model's set.
  it('does not inherit a base-model profile into an unlisted named descendant', () => {
    const caps = resolveReasoningCapabilities({ npm: '@ai-sdk/openai', modelId: 'gpt-5.6-someday' });
    expect(caps.levels).not.toContain('max');
    expect(caps.levels).not.toContain('none');
    expect(effortProviderOptions('@ai-sdk/openai', 'max', 'gpt-5.6-someday')).toBeUndefined();
  });

  it('sends max unchanged on models that document it', () => {
    expect(effortProviderOptions('@ai-sdk/openai', 'max', 'gpt-5.6-luna'))
      .toEqual({ openai: { reasoningEffort: 'max' } });
  });

  it('never downgrades an undocumented level into a weaker documented one', () => {
    // gpt-5-pro only supports 'high' — asking for anything else must not
    // silently become 'high'.
    expect(effortProviderOptions('@ai-sdk/openai', 'xhigh', 'gpt-5-pro')).toBeUndefined();
    expect(effortProviderOptions('@ai-sdk/openai', 'low', 'gpt-5-pro')).toBeUndefined();
  });

  // gpt-5.2 is served over Responses but is not matched by the narrower
  // "prefers responses" rule, so it used to lose every level.
  it.each(['gpt-5.2', 'gpt-5.4'])('keeps %s adjustable rather than internal-only', modelId => {
    const caps = resolveReasoningCapabilities({ npm: '@ai-sdk/openai', modelId });
    expect(caps.mode).toBe('controllable');
    expect(caps.levels).toContain('high');
  });

  it('does not advertise reasoning for non-reasoning OpenAI models', () => {
    expect(resolveReasoningCapabilities({ npm: '@ai-sdk/openai', modelId: 'gpt-4.1' }).mode).toBe('none');
  });

  it('keeps the conservative xhigh collapse for metadata-inferred openai-compatible routes', () => {
    expect(
      effortProviderOptions('@ai-sdk/openai-compatible', 'xhigh', 'some-model', {
        supportedParameters: ['reasoning_effort'],
      }),
    ).toEqual({
      openai: { reasoningEffort: 'high' },
      openaiCompatible: { reasoningEffort: 'high' },
    });
  });

  it('maps GLM-5.2 effort to providerOptions with correct camel-cased key and wire value', () => {
    expect(
      effortProviderOptions('@ai-sdk/openai-compatible', 'xhigh', 'glm-5.2', {
        providerId: 'opencode-go',
      }),
    ).toEqual({
      opencodeGo: {
        reasoningEffort: 'max',
      },
    });
  });

  it('maps Kimi effort to providerOptions with correct camel-cased key', () => {
    expect(
      effortProviderOptions('@ai-sdk/openai-compatible', 'high', 'kimi-k2.7-code', {
        providerId: 'kimi-code',
      }),
    ).toEqual({
      kimiCode: {
        reasoningEffort: 'high',
      },
    });
  });
});
