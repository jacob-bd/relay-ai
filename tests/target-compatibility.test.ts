import { describe, expect, it } from 'vitest';
import {
  isTargetCompatibleModel,
  providersForTarget,
  routableModelsForTarget,
} from '../src/target-compatibility.js';
import type { LocalProvider, LocalProviderModel } from '../src/types.js';

const openAiModel: LocalProviderModel = {
  id: 'gpt-4o',
  name: 'GPT-4o',
  family: 'gpt',
  brand: 'GPT',
  modelFormat: 'openai',
  upstreamModelId: 'gpt-4o',
  npm: '@ai-sdk/openai',
};

const anthropicModel: LocalProviderModel = {
  id: 'claude-sonnet-4-6',
  name: 'Claude Sonnet 4.6',
  family: 'claude',
  brand: 'Claude',
  modelFormat: 'anthropic',
  upstreamModelId: 'claude-sonnet-4-6',
  npm: '@ai-sdk/anthropic',
};

const cloudCodeModel: LocalProviderModel = {
  id: 'gemini-3.5-flash-low',
  name: 'Gemini 3.5 Flash',
  family: 'gemini',
  brand: 'Google',
  modelFormat: 'cloud-code',
  upstreamModelId: 'gemini-3.5-flash-low',
};

describe('target compatibility matrix', () => {
  it('keeps normal API-key OpenAI and Anthropic routes broadly compatible', () => {
    expect(isTargetCompatibleModel({
      target: 'codex',
      providerId: 'openai',
      authType: 'api',
      model: openAiModel,
    }).compatible).toBe(true);
    expect(isTargetCompatibleModel({
      target: 'claude-app',
      providerId: 'anthropic',
      authType: 'api',
      model: anthropicModel,
    }).compatible).toBe(true);
  });

  it('allows Claude OAuth for all targets', () => {
    for (const target of ['claude', 'codex', 'codex-app', 'claude-app', 'gemini', 'server', 'antigravity'] as const) {
      expect(isTargetCompatibleModel({
        target,
        providerId: 'claude-code',
        authType: 'oauth',
        model: anthropicModel,
      }).compatible, target).toBe(true);
    }
  });

  it('keeps both Qwen Cloud variants visible across every Relay target including server', () => {
    const qwenProviders: LocalProvider[] = [
      { id: 'qwen-cloud-token-plan', name: 'Qwen Cloud (Token Plan)', apiKey: 'test-key', authType: 'api', models: [{ ...openAiModel, npm: '@ai-sdk/alibaba' }] },
      { id: 'qwen-cloud-payg', name: 'Qwen Cloud (Pay-As-You-Go)', apiKey: 'test-key', authType: 'api', models: [{ ...openAiModel, npm: '@ai-sdk/alibaba' }] },
    ];

    for (const target of ['claude', 'codex', 'codex-app', 'claude-app', 'gemini', 'server', 'antigravity'] as const) {
      expect(providersForTarget(qwenProviders, target).map(provider => provider.id), target).toEqual([
        'qwen-cloud-token-plan',
        'qwen-cloud-payg',
      ]);
    }
  });

  it('allows Antigravity OAuth Cloud Code for all targets except server', () => {
    for (const target of ['claude', 'codex', 'codex-app', 'claude-app', 'gemini', 'antigravity'] as const) {
      expect(isTargetCompatibleModel({
        target,
        providerId: 'antigravity',
        authType: 'oauth',
        model: cloudCodeModel,
      }).compatible, target).toBe(true);
    }
    expect(isTargetCompatibleModel({
      target: 'server',
      providerId: 'antigravity',
      authType: 'oauth',
      model: cloudCodeModel,
    }).compatible).toBe(false);
  });

  it('filters providers and models per target', () => {
    const providers: LocalProvider[] = [
      { id: 'openai', name: 'OpenAI', apiKey: 'k', authType: 'api', models: [openAiModel] },
      { id: 'claude-code', name: 'Claude Code OAuth', apiKey: 'tok', authType: 'oauth', models: [anthropicModel] },
      { id: 'antigravity', name: 'Antigravity OAuth', apiKey: 'tok', authType: 'oauth', models: [cloudCodeModel] },
    ];

    const allThree = ['antigravity', 'claude-code', 'openai'];
    for (const target of ['claude', 'codex', 'codex-app', 'claude-app', 'gemini'] as const) {
      expect(providersForTarget(providers, target).map(p => p.id).sort(), target).toEqual(allThree);
    }
    expect(routableModelsForTarget(providers[2]!, 'antigravity').length).toBeGreaterThan(0);
  });
});
