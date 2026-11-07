import { describe, expect, it, vi } from 'vitest';
import {
  buildIntelligenceLookup, fetchIntelligenceScores, intelligenceKey, isIntelligenceStale, IntelligenceError,
} from '../src/intelligence/artificial-analysis.js';

const page = (rows: unknown[], hasMore: boolean) => ({
  ok: true, status: 200,
  json: async () => ({ intelligence_index_version: 5, pagination: { has_more: hasMore }, data: rows }),
});
const row = (slug: string, score: number | null, creator = 'Z AI') => ({
  slug, name: slug.toUpperCase(), model_creator: { id: 'c', name: creator },
  evaluations: { artificial_analysis_intelligence_index: score },
});

describe('Artificial Analysis intelligence scores', () => {
  it('reads every page, keeps only scored models and sends the key as a header', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(page([row('glm-5-3', 31.7), row('glm-5', null)], true))
      .mockResolvedValueOnce(page([row('kimi-k3-1-pro', 46.5)], false));
    const cache = await fetchIntelligenceScores('secret-key', fetchMock as never);
    expect(cache.models.map(m => [m.slug, m.score])).toEqual([['glm-5-3', 31.7], ['kimi-k3-1-pro', 46.5]]);
    expect(cache.indexVersion).toBe(5);
    expect(fetchMock.mock.calls[0]![0]).toContain('/language/models/free?page=1');
    expect(fetchMock.mock.calls[0]![1].headers['x-api-key']).toBe('secret-key');
  });

  it.each([[401, 'rejected'], [403, 'rejected'], [429, 'rate-limit'], [500, 'bad-response']])('maps HTTP %i without leaking the key', async (status, code) => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status, json: async () => ({}) });
    const error = await fetchIntelligenceScores('secret-key', fetchMock as never).catch(e => e);
    expect(error).toBeInstanceOf(IntelligenceError);
    expect((error as IntelligenceError).code).toBe(code);
    expect(String(error.message)).not.toContain('secret-key');
  });

  it('reports a network failure without raw error text', async () => {
    const error = await fetchIntelligenceScores('k', vi.fn().mockRejectedValue(new Error('boom k')) as never).catch(e => e);
    expect((error as IntelligenceError).code).toBe('network');
  });

  it('turns provider model ids into Artificial Analysis slugs', () => {
    expect(intelligenceKey('cline-pass/glm-5.3')).toBe('glm-5-3');
    expect(intelligenceKey('nvidia/nemotron-3.5-lightning-free')).toBe('nemotron-3-5-lightning');
    expect(intelligenceKey('glm-5.1:cloud')).toBe('glm-5-1');
    expect(intelligenceKey('deepseek/deepseek-v4.1-flash:batch')).toBe('deepseek-v4-1-flash');
    expect(intelligenceKey('~deepseek/deepseek-flash-latest')).toBe('deepseek-flash-latest');
  });

  it('matches exact names only, never a similar one', () => {
    const lookup = buildIntelligenceLookup({ fetchedAt: new Date().toISOString(), models: [
      { slug: 'mimo-v2-6-pro', name: 'MiMo', score: 29.9 }, { slug: 'mimo-v2-6-pro-ultraspeed', name: 'Fast', score: 10 },
    ] });
    expect(lookup('xiaomi/mimo-v2.6-pro')?.score).toBe(29.9);
    expect(lookup('mimo-v2.6')).toBeUndefined();
  });

  it('bridges provider marketing ids to Artificial Analysis checkpoint dates (default effort only)', () => {
    const lookup = buildIntelligenceLookup({ fetchedAt: new Date().toISOString(), models: [
      { slug: 'deepseek-v4-1-flash-1017', name: 'Flash 1017 (Max)', score: 32.6 },
      { slug: 'deepseek-v4-1-flash-1017-high', name: 'Flash 1017 (High)', score: 28.6 },
      { slug: 'deepseek-v4-1-flash-1017-non-reasoning', name: 'Flash 1017 (NR)', score: 18.5 },
      { slug: 'deepseek-v4-pro', name: 'Pro (Max)', score: 23.1 },
      { slug: 'ling-3-1-flash-1019', name: 'Ling', score: 29.6 },
    ] });
    // NVIDIA / OpenRouter / Zen ship the marketing id; AA scores the dated checkpoint.
    expect(lookup('deepseek-ai/deepseek-v4.1-flash')).toMatchObject({ slug: 'deepseek-v4-1-flash-1017', score: 32.6 });
    expect(lookup('deepseek/deepseek-v4.1-flash:batch')).toMatchObject({ score: 32.6 });
    expect(lookup('ling-3.1-flash')?.score).toBe(29.6);
    // Provider kept the date; AA listed the bare default.
    expect(lookup('deepseek/deepseek-v4-pro-0813')?.score).toBe(23.1);
    // Never invent an effort: bare id must not pick -high / -non-reasoning.
    expect(lookup('deepseek-v4.1-flash')?.slug).toBe('deepseek-v4-1-flash-1017');
    expect(lookup('deepseek-v4.1-flash-high')).toBeUndefined();
    // Size / SKU suffixes stay unmatched (wrong score is worse than none).
    expect(lookup('nemotron-3-5-lightning-30b-a3b')).toBeUndefined();
  });

  it('is stale when missing, empty or older than a day', () => {
    const now = Date.parse('2026-11-06T12:00:00Z');
    const fresh = { fetchedAt: '2026-11-06T06:00:00Z', models: [{ slug: 'a', name: 'a', score: 1 }] };
    expect(isIntelligenceStale(null, now)).toBe(true);
    expect(isIntelligenceStale({ ...fresh, models: [] }, now)).toBe(true);
    expect(isIntelligenceStale(fresh, now)).toBe(false);
    expect(isIntelligenceStale({ ...fresh, fetchedAt: '2026-11-05T11:00:00Z' }, now)).toBe(true);
  });
});

import { sortByIntelligence } from '../src/ui/public/provider-model-browser.js';

describe('sorting the Intelligence column', () => {
  const items = [
    { id: 'a', intelligence: { score: 20 } }, { id: 'none' }, { id: 'b', intelligence: { score: 55.5 } }, { id: 'c', intelligence: { score: 20 } },
  ];
  it('puts the smartest first and keeps unscored models last', () => {
    expect(sortByIntelligence(items, 'desc').map(i => i.id)).toEqual(['b', 'a', 'c', 'none']);
  });
  it('lowest first still keeps unscored last, and ties keep their order', () => {
    expect(sortByIntelligence(items, 'asc').map(i => i.id)).toEqual(['a', 'c', 'b', 'none']);
  });
  it('leaves the order alone when sorting is off', () => {
    expect(sortByIntelligence(items, null)).toBe(items);
  });
});
