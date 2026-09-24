import { describe, expect, it } from 'vitest';
import {
  extractReasoningEffortLevels,
  resolveModelsDevEffort,
  resolveModelReasoningMetadata,
  isModelsDevCacheStale,
  MODELS_DEV_STALE_AFTER_MS,
  isUsableModelsDevPayload,
  type ModelsDevCacheFile,
} from '../src/registry/models-dev.js';

describe('extractReasoningEffortLevels', () => {
  it('returns effort values', () => {
    expect(extractReasoningEffortLevels({ reasoning: true, reasoning_options: [{ type: 'effort', values: ['minimal', 'low', 'medium', 'high', 'xhigh'] }] } as never))
      .toEqual(['minimal', 'low', 'medium', 'high', 'xhigh']);
  });
  it('undefined when none / null / non-object', () => {
    expect(extractReasoningEffortLevels({ reasoning: true } as never)).toBeUndefined();
    expect(extractReasoningEffortLevels(null)).toBeUndefined();
    expect(extractReasoningEffortLevels(undefined)).toBeUndefined();
  });
  it('ignores non-effort option types', () => {
    expect(extractReasoningEffortLevels({ reasoning_options: [{ type: 'budget', values: ['low'] }] } as never)).toBeUndefined();
  });
  it('drops empty and non-string values', () => {
    expect(extractReasoningEffortLevels({ reasoning_options: [{ type: 'effort', values: ['low', '', 42, 'high'] }] } as never)).toEqual(['low', 'high']);
  });
});

const muse = (values: string[]) => ({ id: 'meta/muse-spark-1.3-contributor', reasoning: true, reasoning_options: [{ type: 'effort', values }] });
const CACHE_MUSE = {
  meta: { id: 'meta', models: { 'muse-spark-1.3': muse(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']) } }, // different id -> no match
  'nano-gpt': { id: 'nano-gpt', models: { 'meta/muse-spark-1.3-contributor': muse(['minimal', 'low', 'medium', 'high', 'xhigh']) } },
  kilo: { id: 'kilo', models: { 'meta/muse-spark-1.3-contributor': muse(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']) } },
} as unknown as ModelsDevCacheFile;

describe('resolveModelsDevEffort', () => {
  it('intersects full-id matches, canonically ordered (nano lacks max -> dropped)', () => {
    expect(resolveModelsDevEffort('meta/muse-spark-1.3-contributor', CACHE_MUSE)).toEqual({ kind: 'levels', levels: ['minimal', 'low', 'medium', 'high', 'xhigh'] });
  });
  it('unknown when no full-id match declares effort', () => {
    const cache = { deepinfra: { id: 'deepinfra', models: { 'Qwen/Qwen3.8-Max': { id: 'Qwen/Qwen3.8-Max', reasoning: false } } } } as unknown as ModelsDevCacheFile;
    expect(resolveModelsDevEffort('Qwen/Qwen3.8-Max', cache)).toEqual({ kind: 'unknown' });
  });
  it('conflict when matches declare disjoint sets', () => {
    const cache = {
      a: { id: 'a', models: { 'v/m': { id: 'v/m', reasoning: true, reasoning_options: [{ type: 'effort', values: ['low'] }] } } },
      b: { id: 'b', models: { 'v/m': { id: 'v/m', reasoning: true, reasoning_options: [{ type: 'effort', values: ['high'] }] } } },
    } as unknown as ModelsDevCacheFile;
    expect(resolveModelsDevEffort('v/m', cache)).toEqual({ kind: 'conflict' });
  });
  it('does NOT match bare id against namespaced key or vice versa', () => {
    const cache = { x: { id: 'x', models: { 'reasoner': { id: 'reasoner', reasoning: true, reasoning_options: [{ type: 'effort', values: ['high'] }] } } } } as unknown as ModelsDevCacheFile;
    expect(resolveModelsDevEffort('vendor-a/reasoner', cache)).toEqual({ kind: 'unknown' });
  });
  it('matches case-insensitively on the full id, symmetrically', () => {
    const cache = { x: { id: 'x', models: { 'Vendor/Model': { id: 'Vendor/Model', reasoning: true, reasoning_options: [{ type: 'effort', values: ['high'] }] } } } } as unknown as ModelsDevCacheFile;
    expect(resolveModelsDevEffort('vendor/model', cache)).toEqual({ kind: 'levels', levels: ['high'] });
  });
  it('is deterministic under bucket reordering', () => {
    const rev = { kilo: CACHE_MUSE.kilo, 'nano-gpt': CACHE_MUSE['nano-gpt'], meta: CACHE_MUSE.meta } as unknown as ModelsDevCacheFile;
    expect(resolveModelsDevEffort('meta/muse-spark-1.3-contributor', rev)).toEqual(resolveModelsDevEffort('meta/muse-spark-1.3-contributor', CACHE_MUSE));
  });
  it('null rows do not crash', () => {
    const cache = { x: { id: 'x', models: { 'v/m': null } } } as unknown as ModelsDevCacheFile;
    expect(resolveModelsDevEffort('v/m', cache)).toEqual({ kind: 'unknown' });
  });
});

describe('freshness gate', () => {
  it('24h threshold', () => expect(MODELS_DEV_STALE_AFTER_MS).toBe(24 * 60 * 60 * 1000));
  it('stale / fresh / garbage', () => {
    expect(isModelsDevCacheStale({ _relay_meta: { fetched_at: new Date(Date.now() - 25 * 3600e3).toISOString() } } as never)).toBe(true);
    expect(isModelsDevCacheStale({ _relay_meta: { fetched_at: new Date().toISOString() } } as never)).toBe(false);
    expect(isModelsDevCacheStale({} as never)).toBe(true);
    expect(isModelsDevCacheStale({ _relay_meta: { fetched_at: 'garbage' } } as never)).toBe(true);
  });
});

describe('resolveModelReasoningMetadata', () => {
  const cache = {
    foo: {
      id: 'foo',
      models: {
        'v/m': {
          id: 'v/m',
          reasoning: true,
          interleaved: { field: 'thinking' },
          reasoning_options: [{ type: 'effort', values: ['low', 'high'] }],
        },
      },
    },
  } as unknown as ModelsDevCacheFile;

  it('merges provider-bucket reasoning/interleaved with cross-bucket effort', () => {
    expect(resolveModelReasoningMetadata('foo', 'v/m', {}, cache)).toEqual({
      reasoning: true,
      interleavedReasoningField: 'thinking',
      reasoningEffortLevels: ['low', 'high'],
    });
  });
  it('cached overrides win over models.dev', () => {
    const r = resolveModelReasoningMetadata('foo', 'v/m', { reasoning: false, interleavedField: 'reasoning_content' }, cache);
    expect(r.reasoning).toBe(false);
    expect(r.interleavedReasoningField).toBe('reasoning_content');
  });
  it('effort conflict sets the flag, not levels', () => {
    const conflict = {
      a: { id: 'a', models: { 'v/m': { id: 'v/m', reasoning_options: [{ type: 'effort', values: ['low'] }] } } },
      b: { id: 'b', models: { 'v/m': { id: 'v/m', reasoning_options: [{ type: 'effort', values: ['high'] }] } } },
    } as unknown as ModelsDevCacheFile;
    const r = resolveModelReasoningMetadata('a', 'v/m', {}, conflict);
    expect(r.reasoningEffortConflict).toBe(true);
    expect(r.reasoningEffortLevels).toBeUndefined();
  });
});

describe('isUsableModelsDevPayload', () => {
  it('rejects empty / error / empty-tables / null-rows / array-rows', () => {
    for (const bad of [
      {}, [], { error: 'x' },
      { a: { models: {} }, b: { models: {} } },
      { a: { models: { x: null } }, b: { models: { y: null } } },
      { a: { models: { x: [] } }, b: { models: { y: {} } } }, // no real row
    ]) {
      expect(isUsableModelsDevPayload(bad)).toBe(false);
    }
  });
  it('accepts a real catalog (>=2 buckets with a real row each)', () => {
    expect(isUsableModelsDevPayload({ meta: { models: { x: { id: 'x' } } }, openai: { models: { y: { id: 'y' } } } })).toBe(true);
  });
});
