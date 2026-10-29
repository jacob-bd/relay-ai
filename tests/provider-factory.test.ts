import { describe, it, expect, vi } from 'vitest';
import { streamText } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import {
  applyAnthropicPromptCaching,
  createLanguageModel,
  createOpenRouterFetch,
  deepMergeProviderOptions,
  effortProviderOptions,
  getReasoningCapabilities,
  isSdkMigratedNpm,
  maxToolsForNpm,
  modelPrefersResponsesApi,
  resolveProviderNpm,
  shouldUseOpenAiResponsesEndpoint,
  thinkingProviderOptions,
  withProviderRequestDefaults,
} from '../src/provider-factory.js';
import { VERTEX_ANTHROPIC_NPM } from '../src/constants.js';
import { clearRememberedProtocols } from '../src/gateway-protocol.js';

describe('resolveProviderNpm', () => {
  it('routes the legacy Venice package through openai-compatible', () => {
    expect(resolveProviderNpm('venice-ai-sdk-provider')).toBe('@ai-sdk/openai-compatible');
    expect(resolveProviderNpm('@ai-sdk/groq')).toBe('@ai-sdk/groq');
  });
});

describe('isSdkMigratedNpm', () => {
  it('returns true for any OpenCode-assigned npm except anthropic', () => {
    expect(isSdkMigratedNpm('@ai-sdk/openai')).toBe(true);
    expect(isSdkMigratedNpm('@ai-sdk/cerebras')).toBe(true);
    expect(isSdkMigratedNpm('@ai-sdk/perplexity')).toBe(true);
    expect(isSdkMigratedNpm('@openrouter/ai-sdk-provider')).toBe(true);
    expect(isSdkMigratedNpm('gitlab-ai-provider')).toBe(true);
    expect(isSdkMigratedNpm(VERTEX_ANTHROPIC_NPM)).toBe(true);
  });

  it('returns false for anthropic passthrough and missing npm', () => {
    expect(isSdkMigratedNpm('@ai-sdk/anthropic')).toBe(false);
    expect(isSdkMigratedNpm(undefined)).toBe(false);
    expect(isSdkMigratedNpm('')).toBe(false);
  });
});

describe('modelPrefersResponsesApi', () => {
  it('detects OpenAI and xAI responses-only models', () => {
    expect(modelPrefersResponsesApi('gpt-5.5')).toBe(true);
    expect(modelPrefersResponsesApi('gpt-5.5-fast')).toBe(true);
    expect(modelPrefersResponsesApi('gpt-5.6')).toBe(true);
    expect(modelPrefersResponsesApi('gpt-5.6-fast')).toBe(true);
    expect(modelPrefersResponsesApi('gpt-5.6-sol')).toBe(true);
    expect(modelPrefersResponsesApi('gpt-5.6-terra')).toBe(true);
    expect(modelPrefersResponsesApi('gpt-5.6-luna')).toBe(true);
    expect(modelPrefersResponsesApi('gpt-5.2-pro')).toBe(true);
    expect(modelPrefersResponsesApi('grok-4.20-multi-agent')).toBe(true);
    expect(modelPrefersResponsesApi('gpt-4o')).toBe(false);
    expect(modelPrefersResponsesApi('gpt-5.2')).toBe(false);
  });
});

describe('shouldUseOpenAiResponsesEndpoint', () => {
  it('defaults every OpenAI model to the Responses endpoint', () => {
    expect(shouldUseOpenAiResponsesEndpoint('gpt-4o')).toBe(true);
    expect(shouldUseOpenAiResponsesEndpoint('gpt-3.5-turbo')).toBe(true);
    expect(shouldUseOpenAiResponsesEndpoint('gpt-5.6-sol')).toBe(true);
    expect(shouldUseOpenAiResponsesEndpoint('gpt-7-does-not-exist-yet')).toBe(true);
  });

  it('keeps pre-chat legacy completion models on Chat Completions', () => {
    expect(shouldUseOpenAiResponsesEndpoint('davinci-002')).toBe(false);
    expect(shouldUseOpenAiResponsesEndpoint('babbage-002')).toBe(false);
    expect(shouldUseOpenAiResponsesEndpoint('gpt-3.5-turbo-instruct')).toBe(false);
  });
});

describe('maxToolsForNpm', () => {
  it('caps Groq tool lists at 128', () => {
    expect(maxToolsForNpm('@ai-sdk/groq')).toBe(128);
  });

  it('does not cap non-Groq providers', () => {
    expect(maxToolsForNpm('@ai-sdk/openai')).toBeUndefined();
    expect(maxToolsForNpm(undefined)).toBeUndefined();
  });
});

describe('getReasoningCapabilities', () => {
  it('returns anthropic levels for claude-sonnet-4-6', () => {
    const caps = getReasoningCapabilities('@ai-sdk/anthropic', 'claude-sonnet-4-6');
    expect(caps.levels).toEqual(['low', 'medium', 'high']);
    expect(caps.defaultLevel).toBe('high');
    expect(caps.supportsSummaries).toBe(true);
  });

  it('returns anthropic levels for Vertex Claude models', () => {
    const caps = getReasoningCapabilities(VERTEX_ANTHROPIC_NPM, 'claude-sonnet-4-6');
    expect(caps.levels).toEqual(['low', 'medium', 'high']);
    expect(caps.defaultLevel).toBe('high');
    expect(caps.wireFormat).toEqual({ kind: 'anthropic-thinking' });
  });

  it('returns empty levels for non-reasoning anthropic model', () => {
    const caps = getReasoningCapabilities('@ai-sdk/anthropic', 'claude-haiku-4-5-20251001');
    expect(caps.levels).toEqual([]);
    expect(caps.defaultLevel).toBe('');
    expect(caps.supportsSummaries).toBe(false);
  });

  it('returns high/none only for mistral-large', () => {
    const caps = getReasoningCapabilities('@ai-sdk/mistral', 'mistral-large');
    expect(caps.levels).toEqual(['high', 'none']);
    expect(caps.defaultLevel).toBe('high');
  });

  it('returns budget-mapped levels for gemini-2.5-pro', () => {
    const caps = getReasoningCapabilities('@ai-sdk/google', 'gemini-2.5-pro');
    expect(caps.levels).toEqual(['low', 'medium', 'high']);
    expect(caps.defaultLevel).toBe('medium');
  });

  it('returns empty levels for unknown openai-compatible models', () => {
    const caps = getReasoningCapabilities('@ai-sdk/openai-compatible', 'unknown');
    expect(caps.levels).toEqual([]);
    expect(caps.defaultLevel).toBe('');
  });

  it('returns empty levels for grok-build-0.1 (internal reasoning only)', () => {
    const caps = getReasoningCapabilities('@ai-sdk/xai', 'grok-build-0.1');
    expect(caps.levels).toEqual([]);
  });

  // xAI ladders are per model (docs.x.ai). Metadata-less runs use the fallback
  // list; models.dev-declared levels win in the real pipeline.
  it('returns effort levels for grok-4.3, defaulting to low per xAI docs', () => {
    const caps = getReasoningCapabilities('@ai-sdk/xai', 'grok-4.3');
    expect(caps.levels).toEqual(['low', 'medium', 'high']);
    expect(caps.defaultLevel).toBe('low');
  });

  it('returns effort levels for grok-4.5, defaulting to high per xAI docs', () => {
    const caps = getReasoningCapabilities('@ai-sdk/xai', 'grok-4.5');
    expect(caps.levels).toEqual(['low', 'medium', 'high']);
    expect(caps.defaultLevel).toBe('high');
  });

  it('returns the xhigh ladder for grok-4.6/4.7 without metadata', () => {
    const caps = getReasoningCapabilities('@ai-sdk/xai', 'grok-4.7');
    expect(caps.levels).toEqual(['low', 'medium', 'high', 'xhigh']);
    expect(caps.defaultLevel).toBe('high');
  });

  it('prefers models.dev-declared xAI levels over the fallback list', () => {
    const metadata = { reasoningEffortLevels: ['low', 'medium', 'high', 'xhigh'] };
    const caps = getReasoningCapabilities('@ai-sdk/xai', 'grok-4.7', metadata);
    expect(caps.levels).toEqual(['low', 'medium', 'high', 'xhigh']);
    expect(caps.defaultLevel).toBe('high');
    expect(caps.source).toBe('provider-metadata');
    expect(effortProviderOptions('@ai-sdk/xai', 'xhigh', 'grok-4.7', metadata))
      .toEqual({ xai: { reasoningEffort: 'xhigh' } });
  });

  it('filters declared xAI levels down to what the adapter can send', () => {
    const caps = getReasoningCapabilities('@ai-sdk/xai', 'grok-4.7', {
      reasoningEffortLevels: ['none', 'low', 'high'],
    });
    expect(caps.levels).toEqual(['low', 'high']);
  });

  it('maps xAI effort values verbatim, including medium and xhigh', () => {
    expect(effortProviderOptions('@ai-sdk/xai', 'medium', 'grok-4.5'))
      .toEqual({ xai: { reasoningEffort: 'medium' } });
    expect(effortProviderOptions('@ai-sdk/xai', 'xhigh', 'grok-4.20-multi-agent'))
      .toEqual({ xai: { reasoningEffort: 'xhigh' } });
    expect(effortProviderOptions('@ai-sdk/xai', 'none', 'grok-4.5')).toBeUndefined();
  });

  it('offers the full ladder on the multi-agent model', () => {
    const responses = getReasoningCapabilities('@ai-sdk/xai', 'grok-4.20-multi-agent');
    expect(responses.levels).toEqual(['low', 'medium', 'high', 'xhigh']);
    expect(effortProviderOptions('@ai-sdk/xai', 'medium', 'grok-4.20-multi-agent'))
      .toEqual({ xai: { reasoningEffort: 'medium' } });
  });

  it('returns high/xhigh/none for deepseek-v4-flash', () => {
    const caps = getReasoningCapabilities('@ai-sdk/openai-compatible', 'deepseek-v4-flash');
    // `xhigh` is the label for the wire `max` value (Codex App drops `max`).
    expect(caps.levels).toEqual(['high', 'xhigh', 'none']);
    expect(caps.defaultLevel).toBe('high');
  });

  it('recognizes DeepSeek V4.1 ids on OpenCode Go with the native ladder', () => {
    const caps = getReasoningCapabilities('@ai-sdk/openai-compatible', 'deepseek-v4.1-flash', { providerId: 'go' });
    expect(caps.levels).toEqual(['low', 'medium', 'high', 'xhigh', 'none']);
    expect(caps.defaultLevel).toBe('high');
    expect(caps.wireFormat).toEqual({ kind: 'deepseek-thinking' });
  });

  it('keeps the legacy DeepSeek ladder away from OpenCode Go', () => {
    const caps = getReasoningCapabilities('@ai-sdk/openai-compatible', 'deepseek-v4.1-flash', { providerId: 'deepseek' });
    expect(caps.levels).toEqual(['high', 'xhigh', 'none']);
  });

  it('recognizes namespaced Command Code DeepSeek ids with the native ladder', () => {
    const caps = getReasoningCapabilities('@ai-sdk/openai-compatible', 'deepseek/deepseek-v4.1-flash', {
      providerId: 'commandcode',
      apiBaseUrl: 'https://api.commandcode.ai/provider/v1',
    });
    expect(caps.levels).toEqual(['low', 'medium', 'high', 'xhigh', 'none']);
    expect(caps.wireFormat).toEqual({ kind: 'deepseek-thinking' });
    expect(effortProviderOptions('@ai-sdk/openai-compatible', 'low', 'deepseek/deepseek-v4.1-flash', { providerId: 'commandcode' }))
      .toEqual({ commandcode: { reasoningEffort: 'low', thinking: { type: 'enabled' } } });
    expect(effortProviderOptions('@ai-sdk/openai-compatible', 'medium', 'deepseek/deepseek-v4-flash', {
      apiBaseUrl: 'https://api.commandcode.ai/provider/v1',
    })).toEqual({ openaiCompatible: { reasoningEffort: 'medium', thinking: { type: 'enabled' } } });
  });

  it('keeps a namespaced DeepSeek id on the legacy ladder off Command Code', () => {
    const caps = getReasoningCapabilities('@ai-sdk/openai-compatible', 'deepseek/deepseek-v4.1-flash', { providerId: 'deepseek' });
    expect(caps.levels).toEqual(['high', 'xhigh', 'none']);
  });

  it('recognizes namespaced Kimi ids', () => {
    const caps = getReasoningCapabilities('@ai-sdk/openai-compatible', 'moonshotai/Kimi-K3', { providerId: 'commandcode' });
    expect(caps.levels).toEqual(['low', 'medium', 'high']);
    expect(caps.defaultLevel).toBe('high');
    expect(effortProviderOptions('@ai-sdk/openai-compatible', 'low', 'moonshotai/Kimi-K3', { providerId: 'commandcode' }))
      .toEqual({ commandcode: { reasoningEffort: 'low' } });
  });

  it('recognizes GLM-5.3 ids on OpenCode Go', () => {
    const caps = getReasoningCapabilities('@ai-sdk/openai-compatible', 'glm-5.3-flash', { providerId: 'go' });
    expect(caps.levels).toEqual(['low', 'medium', 'high', 'xhigh']);
    expect(caps.defaultLevel).toBe('high');
    expect(caps.wireFormat).toEqual({ kind: 'openai-reasoning-effort' });
    expect(effortProviderOptions('@ai-sdk/openai-compatible', 'low', 'glm-5.3-flash', { providerId: 'go' }))
      .toEqual({ go: { reasoningEffort: 'low' } });
    expect(effortProviderOptions('@ai-sdk/openai-compatible', 'medium', 'glm-5.3-flash', { providerId: 'go' }))
      .toEqual({ go: { reasoningEffort: 'medium' } });
    expect(effortProviderOptions('@ai-sdk/openai-compatible', 'xhigh', 'glm-5.3-flash', { providerId: 'go' }))
      .toEqual({ go: { reasoningEffort: 'max' } });
  });

  it('keeps GLM-5.2 limited to its documented efforts', () => {
    const caps = getReasoningCapabilities('@ai-sdk/openai-compatible', 'glm-5.2', { providerId: 'go' });
    expect(caps.levels).toEqual(['high', 'xhigh']);
    expect(effortProviderOptions('@ai-sdk/openai-compatible', 'low', 'glm-5.2', { providerId: 'go' })).toBeUndefined();
  });

  it('returns documented GLM-5.2 reasoning levels for OpenAI-compatible routes', () => {
    const caps = getReasoningCapabilities('@ai-sdk/openai-compatible', 'glm-5.2');
    expect(caps.levels).toEqual(['high', 'xhigh']);
    expect(caps.defaultLevel).toBe('high');
    expect(caps.wireFormat).toEqual({ kind: 'openai-reasoning-effort' });
  });

  it('maps DeepSeek effort to the route provider key + thinking enabled', () => {
    // No provider id: falls back to the openai-compatible instance name.
    const merged = deepMergeProviderOptions(
      effortProviderOptions('@ai-sdk/openai-compatible', 'max', 'deepseek-v4-flash'),
    );
    expect(merged?.openaiCompatible).toMatchObject({
      reasoningEffort: 'max',
      thinking: { type: 'enabled' },
    });
    // OpenCode Go's SDK instance is named `go` — options keyed anything else are dropped.
    expect(effortProviderOptions('@ai-sdk/openai-compatible', 'max', 'deepseek-v4.1-flash', { providerId: 'go' }))
      .toEqual({ go: { reasoningEffort: 'max', thinking: { type: 'enabled' } } });
    // The advertised top rung is `xhigh` (slider vocabulary); it sends the wire `max`.
    expect(effortProviderOptions('@ai-sdk/openai-compatible', 'xhigh', 'deepseek-v4.1-flash', { providerId: 'go' }))
      .toEqual({ go: { reasoningEffort: 'max', thinking: { type: 'enabled' } } });
    // Go accepts DeepSeek's native low/medium (verified live); other routes collapse them.
    expect(effortProviderOptions('@ai-sdk/openai-compatible', 'low', 'deepseek-v4.1-flash', { providerId: 'go' }))
      .toEqual({ go: { reasoningEffort: 'low', thinking: { type: 'enabled' } } });
    expect(effortProviderOptions('@ai-sdk/openai-compatible', 'medium', 'deepseek-v4.1-flash', { providerId: 'go' }))
      .toEqual({ go: { reasoningEffort: 'medium', thinking: { type: 'enabled' } } });
    expect(effortProviderOptions('@ai-sdk/openai-compatible', 'low', 'deepseek-v4.1-flash', { providerId: 'deepseek' }))
      .toEqual({ deepseek: { reasoningEffort: 'high', thinking: { type: 'enabled' } } });
    // `none` is the advertised thinking-off level; `off` still maps for older catalogs.
    expect(effortProviderOptions('@ai-sdk/openai-compatible', 'none', 'deepseek-v4.1-flash', { providerId: 'go' }))
      .toEqual({ go: { thinking: { type: 'disabled' } } });
    expect(effortProviderOptions('@ai-sdk/openai-compatible', 'off', 'deepseek-v4.1-flash', { providerId: 'go' }))
      .toEqual({ go: { thinking: { type: 'disabled' } } });
  });

  it('maps Claude low effort to DeepSeek high', () => {
    const opts = effortProviderOptions('@ai-sdk/openai-compatible', 'low', 'deepseek-v4-pro');
    expect(opts?.openaiCompatible).toMatchObject({ reasoningEffort: 'high' });
  });

  it('maps GLM-5.2 effort to OpenAI-compatible reasoningEffort', () => {
    expect(effortProviderOptions('@ai-sdk/openai-compatible', 'xhigh', 'glm-5.2')).toEqual({
      openaiCompatible: { reasoningEffort: 'max' },
    });
    expect(effortProviderOptions('@ai-sdk/openai-compatible', 'low', 'glm-5.2')).toBeUndefined();
  });
});

describe('declared-first effort resolution', () => {
  // models.dev declares effort levels per model; where a declaration exists it
  // must drive the ladder (rule fallbacks stay for undeclared runs), and the
  // mapper must put exactly those values on the wire.

  it('gives Claude models their declared xhigh/max rungs and sends them top-level', () => {
    const metadata = { reasoningEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] };
    const caps = getReasoningCapabilities('@ai-sdk/anthropic', 'claude-opus-5', metadata);
    expect(caps.levels).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(caps.defaultLevel).toBe('high');
    expect(caps.source).toBe('provider-metadata');
    // The SDK emits providerOptions.anthropic.effort as output_config.effort;
    // nesting it under thinking was silently stripped by the option schema.
    expect(effortProviderOptions('@ai-sdk/anthropic', 'xhigh', 'claude-opus-5', metadata))
      .toEqual({ anthropic: { effort: 'xhigh', thinking: { type: 'adaptive' } } });
    expect(effortProviderOptions('@ai-sdk/anthropic', 'max', 'claude-opus-5', metadata))
      .toEqual({ anthropic: { effort: 'max', thinking: { type: 'adaptive' } } });
  });

  it('keeps the legacy Anthropic collapse for undeclared Claude models', () => {
    const caps = getReasoningCapabilities('@ai-sdk/anthropic', 'claude-sonnet-4-6');
    expect(caps.levels).toEqual(['low', 'medium', 'high']);
    expect(caps.source).toBe('provider-rule');
    expect(effortProviderOptions('@ai-sdk/anthropic', 'xhigh', 'claude-sonnet-4-6'))
      .toEqual({ anthropic: { effort: 'high', thinking: { type: 'adaptive' } } });
  });

  it('offers the max rung a Claude 4.6 model declares without inventing xhigh', () => {
    const caps = getReasoningCapabilities('@ai-sdk/anthropic', 'claude-opus-4-6', {
      reasoningEffortLevels: ['low', 'medium', 'high', 'max'],
    });
    expect(caps.levels).toEqual(['low', 'medium', 'high', 'max']);
    expect(effortProviderOptions('@ai-sdk/anthropic', 'max', 'claude-opus-4-6', {
      reasoningEffortLevels: ['low', 'medium', 'high', 'max'],
    })).toEqual({ anthropic: { effort: 'max', thinking: { type: 'adaptive' } } });
  });

  it('adds declared Gemini thinkingLevel values verbatim (minimal included)', () => {
    const metadata = { reasoningEffortLevels: ['minimal', 'low', 'medium', 'high'] };
    const caps = getReasoningCapabilities('@ai-sdk/google', 'gemini-3.6-flash', metadata);
    expect(caps.levels).toEqual(['minimal', 'low', 'medium', 'high']);
    expect(caps.source).toBe('provider-metadata');
    expect(effortProviderOptions('@ai-sdk/google', 'minimal', 'gemini-3.6-flash', metadata))
      .toEqual({ google: { thinkingConfig: { thinkingLevel: 'minimal', includeThoughts: true } } });
  });

  it('lets a declared Gemini set win over the name-rule ladder (image variants)', () => {
    const caps = getReasoningCapabilities('@ai-sdk/google', 'gemini-3-pro-image', {
      reasoningEffortLevels: ['low', 'high'],
    });
    expect(caps.levels).toEqual(['low', 'high']);
  });

  it('maps Gemini 4 Argon models to thinkingLevel rather than thinkingBudget', () => {
    const caps = getReasoningCapabilities('@ai-sdk/google', 'gemini-4-argon-medium');
    expect(caps.levels).toEqual(['low', 'medium', 'high']);
    expect(caps.source).toBe('provider-rule');
    expect(effortProviderOptions('@ai-sdk/google', 'high', 'gemini-4-argon-medium'))
      .toEqual({ google: { thinkingConfig: { thinkingLevel: 'high', includeThoughts: true } } });
  });

  it('keeps Gemini 2.5 on its budget mapping even when effort levels are declared', () => {
    const metadata = { reasoningEffortLevels: ['low', 'high'] };
    const caps = getReasoningCapabilities('@ai-sdk/google', 'gemini-2.5-pro', metadata);
    expect(caps.levels).toEqual(['low', 'medium', 'high']);
    expect(caps.source).toBe('provider-rule');
    expect(effortProviderOptions('@ai-sdk/google', 'low', 'gemini-2.5-pro', metadata))
      .toEqual({ google: { thinkingConfig: { thinkingBudget: 1024, includeThoughts: true } } });
  });

  it('adds Kimi declared top-rung max as xhigh and sends it back as max', () => {
    const metadata = { reasoningEffortLevels: ['low', 'high', 'max'] };
    const caps = getReasoningCapabilities('@ai-sdk/openai-compatible', 'kimi-k3', metadata);
    expect(caps.levels).toEqual(['low', 'medium', 'high', 'xhigh']);
    expect(effortProviderOptions('@ai-sdk/openai-compatible', 'xhigh', 'kimi-k3', metadata))
      .toEqual({ openaiCompatible: { reasoningEffort: 'max' } });
    expect(effortProviderOptions('@ai-sdk/openai-compatible', 'low', 'kimi-k3', metadata))
      .toEqual({ openaiCompatible: { reasoningEffort: 'low' } });
  });

  it('sends declared DeepSeek levels verbatim instead of collapsing them', () => {
    const metadata = { reasoningEffortLevels: ['low', 'high', 'max'] };
    const caps = getReasoningCapabilities('@ai-sdk/openai-compatible', 'deepseek-v4-flash', {
      providerId: 'deepseek',
      ...metadata,
    });
    // The rule keeps its label order for existing rungs; `low` surfaces as an
    // addition, and the top rung stays the rule's `xhigh` label.
    expect(caps.levels).toEqual(['low', 'high', 'xhigh', 'none']);
    expect(effortProviderOptions('@ai-sdk/openai-compatible', 'low', 'deepseek-v4-flash', {
      providerId: 'deepseek',
      ...metadata,
    })).toEqual({ deepseek: { reasoningEffort: 'low', thinking: { type: 'enabled' } } });
    expect(effortProviderOptions('@ai-sdk/openai-compatible', 'xhigh', 'deepseek-v4-flash', {
      providerId: 'deepseek',
      ...metadata,
    })).toEqual({ deepseek: { reasoningEffort: 'max', thinking: { type: 'enabled' } } });
  });

  it('keeps the native DeepSeek ladder untouched when declarations add nothing', () => {
    const caps = getReasoningCapabilities('@ai-sdk/openai-compatible', 'deepseek-v4-flash', {
      providerId: 'go',
      reasoningEffortLevels: ['low', 'high', 'max'],
    });
    expect(caps.levels).toEqual(['low', 'medium', 'high', 'xhigh', 'none']);
  });

  it('resolves Mistral declared efforts to the existing none/high ladder', () => {
    const metadata = { reasoningEffortLevels: ['none', 'high'] };
    const caps = getReasoningCapabilities('@ai-sdk/mistral', 'mistral-medium-latest', metadata);
    expect(caps.levels).toEqual(['high', 'none']);
    expect(caps.source).toBe('provider-metadata');
    expect(effortProviderOptions('@ai-sdk/mistral', 'none', 'mistral-medium-latest', metadata))
      .toEqual({ mistral: { reasoningEffort: 'none' } });
  });

  it('offers Groq and Cerebras declared efforts verbatim', () => {
    const metadata = { reasoningEffortLevels: ['none', 'low', 'medium', 'high'] };
    const groq = getReasoningCapabilities('@ai-sdk/groq', 'qwen/qwen3.8-27b', metadata);
    expect(groq.levels).toEqual(['none', 'low', 'medium', 'high']);
    expect(groq.source).toBe('provider-metadata');
    expect(effortProviderOptions('@ai-sdk/groq', 'low', 'qwen/qwen3.8-27b', metadata))
      .toEqual({ groq: { reasoningEffort: 'low' } });
    const cerebras = getReasoningCapabilities('@ai-sdk/cerebras', 'gpt-oss-120b', {
      reasoningEffortLevels: ['low', 'medium', 'high'],
    });
    expect(cerebras.levels).toEqual(['low', 'medium', 'high']);
    expect(effortProviderOptions('@ai-sdk/cerebras', 'high', 'gpt-oss-120b', {
      reasoningEffortLevels: ['low', 'medium', 'high'],
    })).toEqual({ cerebras: { reasoningEffort: 'high' } });
  });

  it('offers Perplexity declared efforts through the SDK-typed reasoning_effort', () => {
    const metadata = { reasoningEffortLevels: ['minimal', 'low', 'medium', 'high'] };
    const caps = getReasoningCapabilities('@ai-sdk/perplexity', 'sonar-deep-research', metadata);
    expect(caps.levels).toEqual(['minimal', 'low', 'medium', 'high']);
    expect(effortProviderOptions('@ai-sdk/perplexity', 'minimal', 'sonar-deep-research', metadata))
      .toEqual({ perplexity: { reasoning_effort: 'minimal' } });
  });

  it('never invents Groq levels without a declaration', () => {
    const caps = getReasoningCapabilities('@ai-sdk/groq', 'qwen/qwen3.8-27b');
    expect(caps.levels).toEqual([]);
  });

  it('suppresses declared sets when models.dev sources conflict', () => {
    const caps = getReasoningCapabilities('@ai-sdk/anthropic', 'claude-opus-5', {
      reasoningEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      reasoningEffortConflict: true,
    });
    expect(caps.levels).toEqual(['low', 'medium', 'high']);
    expect(caps.source).toBe('provider-rule');
  });
});

describe('effortProviderOptions + deepMergeProviderOptions', () => {
  it('merges OpenAI thinking + effort without dropping store/include', () => {
    const merged = deepMergeProviderOptions(
      thinkingProviderOptions('@ai-sdk/openai'),
      effortProviderOptions('@ai-sdk/openai', 'high', 'gpt-5.4'),
    );
    expect(merged?.openai).toMatchObject({
      store: false,
      include: ['reasoning.encrypted_content'],
      reasoningEffort: 'high',
    });
  });

  it('merges Google thinking + effort budget', () => {
    const merged = deepMergeProviderOptions(
      thinkingProviderOptions('@ai-sdk/google'),
      effortProviderOptions('@ai-sdk/google', 'high', 'gemini-2.5-pro'),
    );
    expect(merged?.google?.thinkingConfig).toMatchObject({
      includeThoughts: true,
      thinkingBudget: 8192,
    });
  });

  it('maps Vertex Claude effort to the top-level Anthropic effort option', () => {
    expect(effortProviderOptions(VERTEX_ANTHROPIC_NPM, 'medium', 'claude-sonnet-4-6')).toEqual({
      anthropic: { effort: 'medium', thinking: { type: 'adaptive' } },
    });
  });
});

describe('createLanguageModel', () => {
  it('retries a dual-protocol gateway through Messages after an early Chat failure', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = String(input);
      calls.push(url);
      if (calls.length === 1) return new Response('{"error":{"message":"Internal server error"}}', { status: 500 });
      return new Response(JSON.stringify({
        id: 'msg_union_alpha',
        type: 'message',
        role: 'assistant',
        model: 'union-alpha',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const model = await createLanguageModel({
        npm: '@ai-sdk/openai-compatible',
        modelId: 'union-alpha',
        apiKey: 'test-key',
        providerId: 'go',
        baseURL: 'https://opencode.ai/zen/go/v1',
      });
      const result = await (await import('ai')).generateText({
        model,
        messages: [{ role: 'user', content: 'hello' }],
      });
      expect(result.text).toBe('ok');
      expect(calls).toEqual([
        'https://opencode.ai/zen/go/v1/chat/completions',
        'https://opencode.ai/zen/go/v1/messages',
      ]);
    } finally {
      vi.unstubAllGlobals();
      clearRememberedProtocols();
    }
  });

  it('recovers a streaming request when the primary endpoint fails before headers', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn<typeof globalThis.fetch>(async (input) => {
      calls.push(String(input));
      if (calls.length === 1) return new Response('{"error":{"message":"Internal server error"}}', { status: 500 });
      const sse = [
        'event: message_start',
        'data: {"type":"message_start","message":{"id":"msg_union_alpha","type":"message","role":"assistant","content":[],"model":"union-alpha","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":0}}}',
        '',
        'event: content_block_start',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
        '',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}',
        '',
        'event: content_block_stop',
        'data: {"type":"content_block_stop","index":0}',
        '',
        'event: message_delta',
        'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":1}}',
        '',
        'event: message_stop',
        'data: {"type":"message_stop"}',
        '',
      ].join('\n');
      return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const model = await createLanguageModel({
        npm: '@ai-sdk/openai-compatible',
        modelId: 'union-alpha',
        apiKey: 'test-key',
        providerId: 'go',
        baseURL: 'https://opencode.ai/zen/go/v1',
      });
      const result = (await import('ai')).streamText({
        model,
        messages: [{ role: 'user', content: 'hello' }],
      });
      expect(await result.text).toBe('ok');
      expect(calls).toEqual([
        'https://opencode.ai/zen/go/v1/chat/completions',
        'https://opencode.ai/zen/go/v1/messages',
      ]);
    } finally {
      vi.unstubAllGlobals();
      clearRememberedProtocols();
    }
  });

  it('uses a protocol learned after the model was created', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/chat/completions')) {
        return new Response('{"error":{"message":"Internal server error"}}', { status: 500 });
      }
      return new Response(JSON.stringify({
        id: 'msg_union_alpha',
        type: 'message',
        role: 'assistant',
        model: 'union-alpha',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      // A long-lived server reuses one model instance for every request.
      const model = await createLanguageModel({
        npm: '@ai-sdk/openai-compatible',
        modelId: 'union-alpha',
        apiKey: 'test-key',
        providerId: 'go',
        baseURL: 'https://opencode.ai/zen/go/v1',
      });
      const { generateText } = await import('ai');
      await generateText({ model, messages: [{ role: 'user', content: 'one' }], maxRetries: 0 });
      await generateText({ model, messages: [{ role: 'user', content: 'two' }], maxRetries: 0 });
      expect(calls).toEqual([
        'https://opencode.ai/zen/go/v1/chat/completions',
        'https://opencode.ai/zen/go/v1/messages',
        'https://opencode.ai/zen/go/v1/messages',
      ]);
    } finally {
      vi.unstubAllGlobals();
      clearRememberedProtocols();
    }
  });

  it('pauses the alternate on a reused model and surfaces the primary error', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/messages')) {
        return new Response('{"error":{"message":"Unknown endpoint /v1/messages"}}', { status: 404 });
      }
      return new Response('{"error":{"message":"Internal server error"}}', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const model = await createLanguageModel({
        npm: '@ai-sdk/openai-compatible',
        modelId: 'deepseek-v4-flash',
        apiKey: 'test-key',
        providerId: 'go',
        baseURL: 'https://opencode.ai/zen/go/v1',
      });
      const { generateText } = await import('ai');
      const first = await generateText({ model, messages: [{ role: 'user', content: 'one' }], maxRetries: 0 })
        .catch((error: unknown) => error);
      // A wrong-endpoint 404 from the alternate must not hide the primary's
      // retryable outage.
      expect(first).toMatchObject({ statusCode: 500 });
      await generateText({ model, messages: [{ role: 'user', content: 'two' }], maxRetries: 0 })
        .catch(() => undefined);
      expect(calls).toEqual([
        'https://opencode.ai/zen/go/v1/chat/completions',
        'https://opencode.ai/zen/go/v1/messages',
        'https://opencode.ai/zen/go/v1/chat/completions',
      ]);
    } finally {
      vi.unstubAllGlobals();
      clearRememberedProtocols();
    }
  });

  it('removes Codex blind max_tokens at the OpenRouter HTTP boundary', async () => {
    const forwarded: Array<Record<string, unknown>> = [];
    const fetchImpl: typeof globalThis.fetch = async (_input, init) => {
      forwarded.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      return new Response('{}', { status: 200 });
    };
    const guardedFetch = createOpenRouterFetch(fetchImpl);

    await guardedFetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'meta/muse-spark-1.3-contributor', max_tokens: 65536 }),
    });
    await guardedFetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'meta/muse-spark-1.3-contributor', max_tokens: 4096 }),
    });

    expect(forwarded).toEqual([
      { model: 'meta/muse-spark-1.3-contributor' },
      { model: 'meta/muse-spark-1.3-contributor', max_tokens: 4096 },
    ]);
  });

  it('keeps the actual OpenRouter SDK request free of the blind cap', async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>(async () => new Response(
      'data: {"id":"x","choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const model = await createLanguageModel({
        npm: '@openrouter/ai-sdk-provider',
        modelId: 'meta/muse-spark-1.3-contributor',
        apiKey: 'test-key',
      });
      const result = streamText({
        model,
        messages: [{ role: 'user', content: 'whats ur name?' }],
        maxOutputTokens: 65536,
      });
      await result.text;

      const [, init] = fetchMock.mock.calls[0] ?? [];
      const outbound = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      expect(outbound.max_tokens).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('routes OpenAI OAuth through the ChatGPT Codex backend with the account header', async () => {
    const responses = vi.fn((modelId: string) => ({ modelId, provider: 'openai-responses' }));
    const chat = vi.fn((modelId: string) => ({ modelId, provider: 'openai-chat' }));
    const createOpenAI = vi.fn(() => ({ responses, chat }));
    vi.doMock('@ai-sdk/openai', () => ({ createOpenAI }));

    const header = Buffer.from('{}').toString('base64url');
    const payload = Buffer.from(JSON.stringify({ chatgpt_account_id: 'acct-123' })).toString('base64url');
    const accessToken = `${header}.${payload}.sig`;

    const { createLanguageModel: create } = await import('../src/provider-factory.js');
    await create({
      npm: '@ai-sdk/openai',
      modelId: 'gpt-5.5',
      apiKey: accessToken,
      authType: 'oauth',
      oauthAccountId: 'stored-acct-456',
    });

    expect(createOpenAI).toHaveBeenCalledWith({
      apiKey: accessToken,
      baseURL: 'https://chatgpt.com/backend-api/codex',
      headers: {
        'ChatGPT-Account-Id': 'stored-acct-456',
        originator: 'relay-ai',
      },
    });
    expect(responses).toHaveBeenCalledWith('gpt-5.5');
    vi.doUnmock('@ai-sdk/openai');
  });

  it('ChatGPT-login routes send a stable UUID-shaped session_id header derived from the session id', async () => {
    const createOpenAI = vi.fn(() => ({ responses: (m: string) => ({ m }), chat: (m: string) => ({ m }) }));
    vi.doMock('@ai-sdk/openai', () => ({ createOpenAI }));
    const { createLanguageModel: create } = await import('../src/provider-factory.js');
    const spec = { npm: '@ai-sdk/openai', modelId: 'gpt-5.5', apiKey: 'tok', authType: 'oauth' as const, oauthAccountId: 'acct' };

    await create({ ...spec, sessionId: 'chat-1' });
    await create({ ...spec, sessionId: 'chat-1' });
    await create({ ...spec, sessionId: 'chat-2' });
    await create(spec);

    const headersOf = (n: number) => (createOpenAI.mock.calls[n]![0] as { headers: Record<string, string> }).headers;
    expect(headersOf(0)['session_id']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(headersOf(0)['session_id']).toBe(headersOf(1)['session_id']);
    expect(headersOf(0)['session_id']).not.toBe(headersOf(2)['session_id']);
    expect(headersOf(0)['session_id']).not.toContain('chat-1');
    expect(headersOf(3)).not.toHaveProperty('session_id');
    vi.doUnmock('@ai-sdk/openai');
  });

  it('ignores baseURL for @ai-sdk/google (discovery URL is OpenAI-compatible only)', async () => {
    const createGoogleGenerativeAI = vi.fn(() => {
      const provider = vi.fn((modelId: string) => ({ modelId, provider: 'google' }));
      return provider;
    });
    vi.doMock('@ai-sdk/google', () => ({ createGoogleGenerativeAI }));

    const { createLanguageModel: create } = await import('../src/provider-factory.js');
    await create({
      npm: '@ai-sdk/google',
      modelId: 'gemini-3.5-flash',
      apiKey: 'test-key',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    });

    expect(createGoogleGenerativeAI).toHaveBeenCalledWith({ apiKey: 'test-key' });
    vi.doUnmock('@ai-sdk/google');
  });

  it('ignores discovery baseURL for @ai-sdk/anthropic (SDK default includes /v1)', async () => {
    const anthropicFactory = vi.fn((modelId: string) => ({ modelId, provider: 'anthropic' }));
    const createAnthropic = vi.fn(() => anthropicFactory);
    vi.doMock('@ai-sdk/anthropic', () => ({ createAnthropic }));

    const { createLanguageModel: create } = await import('../src/provider-factory.js');
    await create({
      npm: '@ai-sdk/anthropic',
      modelId: 'claude-sonnet-4-6',
      apiKey: 'test-key',
      baseURL: 'https://api.anthropic.com',
    });

    expect(createAnthropic).toHaveBeenCalledWith({ apiKey: 'test-key' });
    expect(createAnthropic).not.toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'https://api.anthropic.com' }),
    );
    vi.doUnmock('@ai-sdk/anthropic');
  });

  it('normalizes custom anthropic baseURL to include /v1', async () => {
    const anthropicFactory = vi.fn((modelId: string) => ({ modelId }));
    const createAnthropic = vi.fn(() => anthropicFactory);
    vi.doMock('@ai-sdk/anthropic', () => ({ createAnthropic }));

    const { createLanguageModel: create } = await import('../src/provider-factory.js');
    await create({
      npm: '@ai-sdk/anthropic',
      modelId: 'claude-sonnet-4-6',
      apiKey: 'test-key',
      baseURL: 'https://proxy.example.com',
    });

    expect(createAnthropic).toHaveBeenCalledWith({
      apiKey: 'test-key',
      baseURL: 'https://proxy.example.com/v1',
    });
    vi.doUnmock('@ai-sdk/anthropic');
  });

  it('routes Claude Code Anthropic OAuth through Bearer auth with compatibility headers', async () => {
    const anthropicFactory = vi.fn((modelId: string) => ({ modelId, provider: 'anthropic-oauth' }));
    const createAnthropic = vi.fn(() => anthropicFactory);
    vi.doMock('@ai-sdk/anthropic', () => ({ createAnthropic }));

    const { createLanguageModel: create } = await import('../src/provider-factory.js');
    await create({
      npm: '@ai-sdk/anthropic',
      modelId: 'claude-sonnet-4-6',
      apiKey: 'oauth-token',
      authType: 'oauth',
      providerId: 'claude-code',
      oauthAccountId: '11111111-1111-4111-8111-111111111111',
    });

    expect(createAnthropic).toHaveBeenCalledWith({
      authToken: 'oauth-token',
      headers: expect.objectContaining({
        'User-Agent': 'claude-cli/2.1.312 (external, cli)',
        'x-app': 'cli',
        'X-Claude-Code-Session-Id': expect.any(String),
      }),
    });
    expect(createAnthropic).not.toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'oauth-token' }),
    );
    expect(anthropicFactory).toHaveBeenCalledWith('claude-sonnet-4-6');
    vi.doUnmock('@ai-sdk/anthropic');
  });

  it('forwards custom headers for openai-compatible custom endpoints', async () => {
    const factory = vi.fn((modelId: string) => ({ modelId }));
    const createOpenAICompatible = vi.fn(() => factory);
    vi.doMock('@ai-sdk/openai-compatible', () => ({ createOpenAICompatible }));

    const { createLanguageModel: create } = await import('../src/provider-factory.js');
    await create({
      npm: '@ai-sdk/openai-compatible',
      modelId: 'glm-5.2',
      apiKey: 'sk-test',
      baseURL: 'https://api.z.ai/api/coding/paas/v4',
      providerId: 'custom-zai',
      headers: { 'X-Plan': 'coding' },
    });

    expect(createOpenAICompatible).toHaveBeenCalledWith({
      name: 'custom-zai',
      apiKey: 'sk-test',
      baseURL: 'https://api.z.ai/api/coding/paas/v4',
      headers: { 'X-Plan': 'coding' },
    });
    vi.doUnmock('@ai-sdk/openai-compatible');
  });

  it('formats ClinePass OAuth credentials only for the SDK runtime and installs a refresh fetch', async () => {
    const factory = vi.fn((modelId: string) => ({ modelId }));
    const createOpenAICompatible = vi.fn(() => factory);
    vi.doMock('@ai-sdk/openai-compatible', () => ({ createOpenAICompatible }));

    const { createLanguageModel: create } = await import('../src/provider-factory.js');
    await create({
      npm: '@ai-sdk/openai-compatible',
      modelId: 'cline-pass/qwen3.8-max',
      apiKey: 'raw-oauth-token',
      baseURL: 'https://api.cline.bot/api/v1',
      providerId: 'cline-pass',
      authType: 'oauth',
      headers: { 'X-Title': 'Cline' },
      refreshToken: vi.fn(async () => 'refreshed-token'),
      onTokenRefreshed: vi.fn(),
    });

    expect(createOpenAICompatible).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'workos:raw-oauth-token',
      baseURL: 'https://api.cline.bot/api/v1',
      headers: { 'X-Title': 'Cline' },
      fetch: expect.any(Function),
    }));
    vi.doUnmock('@ai-sdk/openai-compatible');
  });

  it('omits apiKey for anonymous openai-compatible providers', async () => {
    const factory = vi.fn((modelId: string) => ({ modelId }));
    const createOpenAICompatible = vi.fn(() => factory);
    vi.doMock('@ai-sdk/openai-compatible', () => ({ createOpenAICompatible }));

    const { createLanguageModel: create } = await import('../src/provider-factory.js');
    await create({
      npm: '@ai-sdk/openai-compatible',
      modelId: 'tencent/hy3:free',
      apiKey: '',
      baseURL: 'https://api.kilo.ai/api/gateway',
      providerId: 'kilo',
    });

    expect(createOpenAICompatible).toHaveBeenCalledWith({
      name: 'kilo',
      baseURL: 'https://api.kilo.ai/api/gateway',
    });
    vi.doUnmock('@ai-sdk/openai-compatible');
  });

  it('merges custom headers into a non-OAuth custom anthropic endpoint', async () => {
    const anthropicFactory = vi.fn((modelId: string) => ({ modelId }));
    const createAnthropic = vi.fn(() => anthropicFactory);
    vi.doMock('@ai-sdk/anthropic', () => ({ createAnthropic }));

    const { createLanguageModel: create } = await import('../src/provider-factory.js');
    await create({
      npm: '@ai-sdk/anthropic',
      modelId: 'glm-5.2',
      apiKey: 'sk-test',
      baseURL: 'https://api.z.ai/api/anthropic',
      headers: { 'X-Plan': 'coding' },
    });

    expect(createAnthropic).toHaveBeenCalledWith({
      apiKey: 'sk-test',
      baseURL: 'https://api.z.ai/api/anthropic/v1',
      headers: { 'X-Plan': 'coding' },
    });
    vi.doUnmock('@ai-sdk/anthropic');
  });
});

describe('OpenAI effort for models newer than the built-in table', () => {
  const meta = {
    providerId: 'openai-oauth',
    upstreamModelId: 'gpt-6-sol',
    reasoning: true,
    reasoningEffortLevels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  };

  it("uses models.dev's declared levels and sends each one as-is", () => {
    const caps = getReasoningCapabilities('@ai-sdk/openai', 'gpt-6-sol', meta);
    expect(caps.mode).toBe('controllable');
    expect(caps.levels).toEqual(['none', 'low', 'medium', 'high', 'xhigh', 'max']);
    expect(caps.defaultLevel).toBe('medium');
    for (const level of caps.levels) {
      expect(effortProviderOptions('@ai-sdk/openai', level, 'gpt-6-sol', meta)).toEqual({ openai: { reasoningEffort: level } });
    }
  });

  it('keeps the conservative default when models.dev declares nothing', () => {
    const caps = getReasoningCapabilities('@ai-sdk/openai', 'gpt-6-sol', { ...meta, reasoningEffortLevels: undefined });
    expect(caps.levels).toEqual(['low', 'medium', 'high']);
  });

  it('keeps the hand-written table for models it covers', () => {
    const caps = getReasoningCapabilities('@ai-sdk/openai', 'gpt-5.5-pro', { ...meta, upstreamModelId: 'gpt-5.5-pro' });
    expect(caps.levels).toEqual(['medium', 'high', 'xhigh']);
  });
});

describe('applyAnthropicPromptCaching', () => {
  const marked = (item: { providerOptions?: Record<string, Record<string, unknown>> }) =>
    item.providerOptions?.anthropic?.cacheControl !== undefined;
  const text = (t: string) => [{ type: 'text' as const, text: t }];

  it('skips assistant turns and stops at four breakpoints', () => {
    const out = applyAnthropicPromptCaching({
      prompt: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: text('u1') },
        { role: 'assistant', content: text('a1') },
        { role: 'user', content: text('u2') },
        { role: 'assistant', content: text('a2') },
        { role: 'tool', content: [] },
        { role: 'assistant', content: text('a3') },
      ],
      tools: [{ type: 'function', name: 'alpha', inputSchema: { type: 'object' } }],
    });
    expect(out.tools!.map(marked)).toEqual([true]);
    expect(out.prompt.map(marked)).toEqual([true, false, false, true, false, true, false]);
  });

  it('marks up to four user turns when there are no tools or system prompt', () => {
    const out = applyAnthropicPromptCaching({
      prompt: Array.from({ length: 6 }, (_, i) => ({ role: 'user' as const, content: text(`u${i}`) })),
    });
    expect(out.prompt.map(marked)).toEqual([false, false, true, true, true, true]);
  });

  it('applies to Vertex Claude routes through the shared request defaults', async () => {
    const inner = new MockLanguageModelV4({ doGenerate: async () => { throw new Error('captured'); } });
    const model = withProviderRequestDefaults(inner, { npm: VERTEX_ANTHROPIC_NPM, modelId: 'claude-sonnet-5-5', apiKey: '' });
    await expect((model as unknown as MockLanguageModelV4).doGenerate({
      prompt: [{ role: 'system', content: 'sys' }, { role: 'user', content: text('hi') }],
    })).rejects.toThrow('captured');
    expect(inner.doGenerateCalls[0]!.prompt.map(marked)).toEqual([true, true]);
  });
});

describe('OpenAI prompt cache key from the session id', () => {
  const text = (t: string) => [{ type: 'text' as const, text: t }];
  const send = async (spec: Parameters<typeof withProviderRequestDefaults>[1], providerOptions?: Record<string, Record<string, unknown>>) => {
    const inner = new MockLanguageModelV4({ doGenerate: async () => { throw new Error('captured'); } });
    const model = withProviderRequestDefaults(inner, spec);
    await expect((model as unknown as MockLanguageModelV4).doGenerate({
      prompt: [{ role: 'user', content: text('hi') }],
      ...(providerOptions ? { providerOptions } : {}),
    } as never)).rejects.toThrow('captured');
    return inner.doGenerateCalls[0]!.providerOptions as Record<string, Record<string, unknown>> | undefined;
  };
  const openai = { npm: '@ai-sdk/openai', modelId: 'gpt-5.6-terra', apiKey: 'k' };

  it('sends a stable cache key derived from the session id, and keeps the existing OpenAI defaults', async () => {
    const a = await send({ ...openai, sessionId: 'chat-1' });
    const b = await send({ ...openai, sessionId: 'chat-1' });
    const other = await send({ ...openai, sessionId: 'chat-2' });

    expect(a?.openai?.promptCacheKey).toMatch(/^[0-9a-f]{32}$/);
    expect(a?.openai?.promptCacheKey).toBe(b?.openai?.promptCacheKey);
    expect(a?.openai?.promptCacheKey).not.toBe(other?.openai?.promptCacheKey);
    expect(a?.openai?.promptCacheKey).not.toContain('chat-1');          // the raw session id is never sent upstream
    expect(a?.openai).toMatchObject({ store: false, include: ['reasoning.encrypted_content'] });
  });

  it('works for ChatGPT-login routes too (same npm)', async () => {
    const options = await send({ ...openai, authType: 'oauth', sessionId: 'chat-1' });
    expect(options?.openai?.promptCacheKey).toMatch(/^[0-9a-f]{32}$/);
  });

  it('sends no cache key without a session id', async () => {
    expect((await send(openai))?.openai).not.toHaveProperty('promptCacheKey');
  });

  it('lets a caller-supplied cache key win', async () => {
    const options = await send({ ...openai, sessionId: 'chat-1' }, { openai: { promptCacheKey: 'mine' } });
    expect(options?.openai?.promptCacheKey).toBe('mine');
  });

  it('does not add an OpenAI key to other providers', async () => {
    for (const npm of ['@ai-sdk/groq', '@ai-sdk/anthropic', '@ai-sdk/google', '@ai-sdk/openai-compatible']) {
      const options = await send({ npm, modelId: 'm', apiKey: 'k', sessionId: 'chat-1' });
      expect(options?.openai, npm).toBeUndefined();
    }
  });
});

describe('Vertex Claude config fallback', () => {
  it('reads project and location from the environment when the route carries none', async () => {
    const keys = ['ANTHROPIC_VERTEX_PROJECT_ID', 'GOOGLE_CLOUD_PROJECT', 'GOOGLE_VERTEX_PROJECT', 'CLOUD_ML_REGION'] as const;
    const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
    try {
      process.env.ANTHROPIC_VERTEX_PROJECT_ID = 'env-project';
      process.env.CLOUD_ML_REGION = 'us-east5';
      const model = await createLanguageModel({ npm: VERTEX_ANTHROPIC_NPM, modelId: 'claude-sonnet-5-5', apiKey: '' });
      expect(model).toBeTruthy();

      delete process.env.ANTHROPIC_VERTEX_PROJECT_ID;
      delete process.env.GOOGLE_CLOUD_PROJECT;
      delete process.env.GOOGLE_VERTEX_PROJECT;
      await expect(createLanguageModel({ npm: VERTEX_ANTHROPIC_NPM, modelId: 'claude-sonnet-5-5', apiKey: '' }))
        .rejects.toThrow(/ANTHROPIC_VERTEX_PROJECT_ID/);
    } finally {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  });
});
