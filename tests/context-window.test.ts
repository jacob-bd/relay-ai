import { describe, it, expect } from 'vitest';
import {
  resolveContextWindow,
  contextWindowFromHeuristics,
  buildContextWindowIndex,
  DEFAULT_CONTEXT_WINDOW,
} from '../src/context-window.js';

describe('contextWindowFromHeuristics', () => {
  it.each([
    ['gemini-3.5-flash', 1_000_000],
    ['gemini-2.5-pro', 2_000_000],
    ['claude-sonnet-4-6', 1_000_000],
    ['claude-opus-4-6', 1_000_000],
    ['claude-haiku-4-5', 200_000],
    ['claude-3-5-sonnet', 200_000],
    ['deepseek-v4-flash', 1_000_000],
    ['deepseek-chat', 64_000],
    ['gpt-5.4', 1_000_000],
    ['gpt-4o-mini', 128_000],
    ['qwen3.6-plus-free', 262_144],
    ['kimi-k2.6', 262_144],
    ['minimax-m2.7', 204_800],
    ['mistral-large', 262_144],
    ['llama-3.3-70b', 131_072],
    ['solar-mini', 32_768],
    ['totally-unknown-model-xyz', DEFAULT_CONTEXT_WINDOW],
  ])('%s → %i', (id, expected) => {
    expect(contextWindowFromHeuristics(id)).toBe(expected);
  });
});

describe('buildContextWindowIndex', () => {
  it('prefers opencode provider entries over other providers', () => {
    const index = buildContextWindowIndex({
      'github-copilot': { models: { 'claude-sonnet-4-6': { limit: { context: 200_000 } } } },
      opencode: { models: { 'claude-sonnet-4-6': { limit: { context: 1_000_000 } } } },
    });
    expect(index.get('claude-sonnet-4-6')).toBe(1_000_000);
  });

  it('uses max across providers when opencode keys are absent', () => {
    const index = buildContextWindowIndex({
      frogbot: { models: { 'gemini-2.5-flash': { limit: { context: 200_000 } } } },
      google: { models: { 'gemini-2.5-flash': { limit: { context: 1_048_576 } } } },
    });
    expect(index.get('gemini-2.5-flash')).toBe(1_048_576);
  });

  it('ignores entries without limit.context', () => {
    const index = buildContextWindowIndex({
      opencode: { models: { 'no-limit-model': { limit: {} } } },
    });
    expect(index.has('no-limit-model')).toBe(false);
  });
});

describe('resolveContextWindow', () => {
  it('falls back to heuristics for unknown models not in cache', () => {
    expect(resolveContextWindow('zzzz-nonexistent-model-id-99999')).toBe(DEFAULT_CONTEXT_WINDOW);
  });

  it('uses cache index values when present in fixture', () => {
    const index = buildContextWindowIndex({
      opencode: { models: { 'gemini-3.5-flash': { limit: { context: 1_048_576 } } } },
    });
    expect(index.get('gemini-3.5-flash')).toBe(1_048_576);
  });
});
