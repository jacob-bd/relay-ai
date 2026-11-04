import { describe, it, expect } from 'vitest';
import {
  claudeCodeClientModelId,
  claudeCodeContextWindow,
  routeLookupIds,
  stripOneMContextSuffix,
} from '../src/context-model-id.js';

describe('claudeCodeClientModelId', () => {
  it('appends [1m] for 1M+ windows', () => {
    expect(claudeCodeClientModelId('gemini-3.5-flash', 1_000_000)).toBe('gemini-3.5-flash[1m]');
    expect(claudeCodeClientModelId('glm-5-3', 1_048_576)).toBe('glm-5-3[1m]');
  });

  it('does not tag windows between 200K and 1M, so Claude Code never overshoots them', () => {
    expect(claudeCodeClientModelId('Qwen3.8-27B-FP8', 262_144)).toBe('Qwen3.8-27B-FP8');
    expect(claudeCodeClientModelId('Qwen3.8-27B-FP8[1m]', 262_144)).toBe('Qwen3.8-27B-FP8');
  });

  it('leaves 200K models unchanged', () => {
    expect(claudeCodeClientModelId('claude-haiku-4-5', 200_000)).toBe('claude-haiku-4-5');
  });

  it('is idempotent when [1m] is already present', () => {
    expect(claudeCodeClientModelId('gemini-3.5-flash[1m]', 1_000_000)).toBe('gemini-3.5-flash[1m]');
  });
});

describe('claudeCodeContextWindow', () => {
  it('keeps confirmed sizes as they are', () => {
    expect(claudeCodeContextWindow({ id: 'm', contextWindow: 262_144 })).toBe(262_144);
    expect(claudeCodeContextWindow({ id: 'm', contextWindow: 1_048_576 })).toBe(1_048_576);
  });

  it('caps estimated sizes at 200K, so an estimated 1M model gets no [1m]', () => {
    const window = claudeCodeContextWindow({ id: 'claude-sonnet-5.5', contextWindow: 1_000_000, contextWindowEstimated: true });
    expect(window).toBe(200_000);
    expect(claudeCodeClientModelId('claude-sonnet-5.5', window)).toBe('claude-sonnet-5.5');
    expect(claudeCodeContextWindow({ id: 'm', contextWindow: 131_072, contextWindowEstimated: true })).toBe(131_072);
  });
});

describe('routeLookupIds', () => {
  it('includes [1m] and legacy models/ variants', () => {
    const ids = routeLookupIds('gemini-3.5-flash');
    expect(ids).toContain('gemini-3.5-flash[1m]');
    expect(ids).toContain('models/gemini-3.5-flash');
  });
});

describe('stripOneMContextSuffix', () => {
  it('removes suffix case-insensitively', () => {
    expect(stripOneMContextSuffix('sonnet[1M]')).toBe('sonnet');
  });
});
