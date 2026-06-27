import { describe, it, expect, vi } from 'vitest';
import {
  createLanguageModel,
  deepMergeProviderOptions,
  effortProviderOptions,
  getReasoningCapabilities,
  isSdkMigratedNpm,
  modelPrefersResponsesApi,
  thinkingProviderOptions,
} from '../src/provider-factory.js';
import { VERTEX_ANTHROPIC_NPM } from '../src/constants.js';

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
    expect(modelPrefersResponsesApi('grok-4.20-multi-agent')).toBe(true);
    expect(modelPrefersResponsesApi('gpt-4o')).toBe(false);
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

  it('returns high/off only for mistral-large', () => {
    const caps = getReasoningCapabilities('@ai-sdk/mistral', 'mistral-large');
    expect(caps.levels).toEqual(['high', 'off']);
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

  it('returns effort levels for grok-4.3', () => {
    const caps = getReasoningCapabilities('@ai-sdk/xai', 'grok-4.3');
    expect(caps.levels).toEqual(['none', 'low', 'medium', 'high']);
  });

  it('returns high/max/off for deepseek-v4-flash', () => {
    const caps = getReasoningCapabilities('@ai-sdk/openai-compatible', 'deepseek-v4-flash');
    expect(caps.levels).toEqual(['high', 'max', 'off']);
    expect(caps.defaultLevel).toBe('high');
  });

  it('returns documented GLM-5.2 reasoning levels for OpenAI-compatible routes', () => {
    const caps = getReasoningCapabilities('@ai-sdk/openai-compatible', 'glm-5.2');
    expect(caps.levels).toEqual(['high', 'xhigh']);
    expect(caps.defaultLevel).toBe('high');
    expect(caps.wireFormat).toEqual({ kind: 'openai-reasoning-effort' });
  });

  it('maps DeepSeek effort to openaiCompatible reasoningEffort + thinking enabled', () => {
    const merged = deepMergeProviderOptions(
      effortProviderOptions('@ai-sdk/openai-compatible', 'max', 'deepseek-v4-flash'),
    );
    expect(merged?.openaiCompatible).toMatchObject({ reasoningEffort: 'max' });
    expect(merged?.deepseek).toMatchObject({ thinking: { type: 'enabled' } });
  });

  it('maps Claude low effort to DeepSeek high', () => {
    const opts = effortProviderOptions('@ai-sdk/openai-compatible', 'low', 'deepseek-v4-pro');
    expect(opts?.openaiCompatible).toMatchObject({ reasoningEffort: 'high' });
  });

  it('maps GLM-5.2 effort to OpenAI-compatible reasoningEffort', () => {
    expect(effortProviderOptions('@ai-sdk/openai-compatible', 'xhigh', 'glm-5.2')).toEqual({
      openaiCompatible: { reasoningEffort: 'xhigh' },
    });
    expect(effortProviderOptions('@ai-sdk/openai-compatible', 'low', 'glm-5.2')).toBeUndefined();
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

  it('maps Vertex Claude effort to Anthropic thinking options', () => {
    expect(effortProviderOptions(VERTEX_ANTHROPIC_NPM, 'medium', 'claude-sonnet-4-6')).toEqual({
      anthropic: { thinking: { type: 'adaptive', effort: 'medium' } },
    });
  });
});

describe('createLanguageModel', () => {
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
});
