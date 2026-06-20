// tests/prompts.test.ts
import { describe, it, expect } from 'vitest';
import {
  filterModelsBySearch,
  sliceModelPage,
  MODEL_SEARCH_THRESHOLD,
  MODEL_PAGE_SIZE,
} from '../src/prompts.js';

describe('filterModelsBySearch', () => {
  const models = [
    { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', brand: 'Claude' },
    { id: 'llama-3.3-70b', name: 'Llama 3.3 70B', brand: 'Other' },
    { id: 'gpt-4o', name: 'GPT-4o', brand: 'GPT' },
    { id: 'qwen3-7b', name: 'Qwen 3 7B', brand: 'Alibaba' },
    { id: 'qwen/qwen2.5-coder-32b', name: 'Qwen 2.5 Coder 32B', brand: 'Alibaba' },
  ];

  it('matches id, name, and brand case-insensitively', () => {
    expect(filterModelsBySearch(models, 'SONNET').map(m => m.id)).toEqual(['claude-sonnet-4']);
    expect(filterModelsBySearch(models, 'llama').map(m => m.id)).toEqual(['llama-3.3-70b']);
    expect(filterModelsBySearch(models, 'gpt').map(m => m.id)).toEqual(['gpt-4o']);
  });

  it('returns empty for blank query', () => {
    expect(filterModelsBySearch(models, '')).toEqual([]);
    expect(filterModelsBySearch(models, '   ')).toEqual([]);
  });

  it('multi-token: "QWEN 3.7" matches qwen3-7b', () => {
    const result = filterModelsBySearch(models, 'QWEN 3.7');
    expect(result.map(m => m.id)).toContain('qwen3-7b');
  });

  it('multi-token: "qwen 2.5 32" matches qwen2.5-coder-32b', () => {
    const result = filterModelsBySearch(models, 'qwen 2.5 32');
    expect(result.map(m => m.id)).toContain('qwen/qwen2.5-coder-32b');
  });

  it('multi-token: "llama 70" matches llama-3.3-70b', () => {
    const result = filterModelsBySearch(models, 'llama 70');
    expect(result.map(m => m.id)).toEqual(['llama-3.3-70b']);
  });

  it('multi-token AND: all tokens must match, not any', () => {
    // "sonnet gpt" should match nothing — no model has both in its fields
    expect(filterModelsBySearch(models, 'sonnet gpt')).toEqual([]);
  });

  it('punctuation-normalized: "qwen3.7" matches qwen3-7b', () => {
    const result = filterModelsBySearch(models, 'qwen3.7');
    expect(result.map(m => m.id)).toContain('qwen3-7b');
  });

  it('exports search threshold of 25', () => {
    expect(MODEL_SEARCH_THRESHOLD).toBe(25);
  });
});

describe('sliceModelPage', () => {
  const items = Array.from({ length: 32 }, (_, i) => `model-${i}`);

  it('pages 15 items at a time', () => {
    expect(MODEL_PAGE_SIZE).toBe(15);
    expect(sliceModelPage(items, 0).items).toHaveLength(15);
    expect(sliceModelPage(items, 0).totalPages).toBe(3);
    expect(sliceModelPage(items, 1).items[0]).toBe('model-15');
    expect(sliceModelPage(items, 2).items).toHaveLength(2);
  });

  it('clamps out-of-range page numbers', () => {
    expect(sliceModelPage(items, 99).page).toBe(2);
    expect(sliceModelPage(items, -3).page).toBe(0);
  });
});
