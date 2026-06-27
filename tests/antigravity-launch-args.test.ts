import { describe, it, expect } from 'vitest';
import {
  agyArgsAreNonInteractive,
  agyArgsIncludeModelFlag,
  buildAgyLaunchArgs,
  formatAgyCapacityWarning,
  resolveAntigravityBootModel,
} from '../src/antigravity.js';
import { buildAntigravityChildEnv } from '../src/env.js';
import type { LocalProvider } from '../src/types.js';

describe('agy launch args', () => {
  it('detects --model flag', () => {
    expect(agyArgsIncludeModelFlag(['--model', 'gemini-3.5-flash-low'])).toBe(true);
    expect(agyArgsIncludeModelFlag(['--model=relay-ai__zen__x'])).toBe(true);
    expect(agyArgsIncludeModelFlag(['-p', 'hello'])).toBe(false);
  });

  it('prepends the catalog display label when --model is absent', () => {
    expect(buildAgyLaunchArgs('deepseek-v4-flash (Relay)', ['-p', 'hi']))
      .toEqual(['--model', 'deepseek-v4-flash (Relay)', '-p', 'hi']);
  });

  it('preserves user --model override', () => {
    expect(buildAgyLaunchArgs('deepseek-v4-flash (Relay)', ['--model', 'custom-id']))
      .toEqual(['--model', 'custom-id']);
  });

  it('detects noninteractive AGY print/prompt args', () => {
    expect(agyArgsAreNonInteractive(['-p', 'hello'])).toBe(true);
    expect(agyArgsAreNonInteractive(['--prompt', 'hello'])).toBe(true);
    expect(agyArgsAreNonInteractive(['--prompt=hello'])).toBe(true);
    expect(agyArgsAreNonInteractive(['--print-timeout', '15s'])).toBe(false);
    expect(agyArgsAreNonInteractive([])).toBe(false);
  });

  it('formats validated-slot capacity warnings', () => {
    expect(formatAgyCapacityWarning(7, 8)).toBe(
      'AGY can switch among 7 validated model slots; 8 favorites were not exposed.',
    );
    expect(formatAgyCapacityWarning(1, 1)).toBe(
      'AGY can switch among 1 validated model slot; 1 favorite was not exposed.',
    );
  });

  it('matches AGY boot --model by exact ID, visible Relay label, or unique prefix', () => {
    const provider: LocalProvider = {
      id: 'xai-oauth',
      name: 'xAI SuperGrok',
      apiKey: 'token',
      models: [
        {
          id: 'grok-4.3',
          name: 'Grok 4.3',
          family: 'grok',
          brand: 'xAI',
          modelFormat: 'openai',
          upstreamModelId: 'grok-4.3-upstream',
        },
        {
          id: 'grok-code-fast',
          name: 'Grok Code Fast',
          family: 'grok',
          brand: 'xAI',
          modelFormat: 'openai',
          upstreamModelId: 'grok-code-fast',
        },
      ],
    };

    expect(resolveAntigravityBootModel(provider, 'grok-4.3').model?.id).toBe('grok-4.3');
    expect(resolveAntigravityBootModel(provider, 'Grok 4.3 (Relay - xAI SuperGrok)').model?.id).toBe('grok-4.3');
    expect(resolveAntigravityBootModel(provider, 'grok-code').model?.id).toBe('grok-code-fast');
  });

  it('fails closed when AGY boot --model prefix matching is ambiguous', () => {
    const provider: LocalProvider = {
      id: 'xai',
      name: 'xAI API',
      apiKey: 'token',
      models: [
        {
          id: 'grok-4.3',
          name: 'Grok 4.3',
          family: 'grok',
          brand: 'xAI',
          modelFormat: 'openai',
          upstreamModelId: 'grok-4.3',
        },
        {
          id: 'grok-4.3-mini',
          name: 'Grok 4.3 Mini',
          family: 'grok',
          brand: 'xAI',
          modelFormat: 'openai',
          upstreamModelId: 'grok-4.3-mini',
        },
      ],
    };

    const result = resolveAntigravityBootModel(provider, 'grok');
    expect(result.model).toBeNull();
    expect(result.error).toContain('ambiguous');
    expect(result.error).toContain('Did you mean');
  });
});

describe('buildAntigravityChildEnv', () => {
  it('sets CLOUD_CODE_URL without Anthropic proxy vars', () => {
    const env = buildAntigravityChildEnv('http://127.0.0.1:9999');
    expect(env['CLOUD_CODE_URL']).toBe('http://127.0.0.1:9999');
    expect(env['ANTHROPIC_BASE_URL']).toBeUndefined();
    expect(env['ANTHROPIC_API_KEY']).toBeUndefined();
    expect(env['ANTHROPIC_MODEL']).toBeUndefined();
  });
});
