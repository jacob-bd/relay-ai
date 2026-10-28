import { describe, expect, it, vi } from 'vitest';
import { classifyVertexAccess, filterVertexModelsByAccess } from '../src/registry/vertex-model-check.js';

vi.mock('@napi-rs/keyring', () => ({
  Entry: class { constructor() { throw new Error('isolated test keyring'); } },
}));

const entries = ['a', 'b', 'c', 'd'].map(id => ({ id, display_name: id.toUpperCase() }));

describe('Vertex model access check', () => {
  it('removes only explicit per-model refusals', () => {
    expect(classifyVertexAccess(200, '')).toBe('available');
    expect(classifyVertexAccess(404, 'Publisher model not found')).toMatchObject({ verdict: 'unavailable' });
    expect(classifyVertexAccess(400, 'Organization Policy constraint constraints/vertexai.allowedModels violated'))
      .toMatchObject({ verdict: 'unavailable', detail: "blocked by your organization's model policy" });
    expect(classifyVertexAccess(400, 'max_tokens is invalid')).toBe('unknown');
    for (const status of [0, 429, 500, 503]) expect(classifyVertexAccess(status, '')).toBe('unknown');
    for (const status of [401, 403]) expect(classifyVertexAccess(status, 'denied')).toMatchObject({ verdict: 'abort' });
  });

  it('keeps inconclusive models and reports which ones answered', async () => {
    const results: Record<string, { ok: boolean; status?: number; error?: string }> = {
      a: { ok: true },
      b: { ok: false, status: 400, error: 'Organization Policy constraint constraints/vertexai.allowedModels violated' },
      c: { ok: false, status: 429, error: 'Quota exceeded' },
      d: { ok: false, status: 404, error: 'not found' },
    };
    const outcome = await filterVertexModelsByAccess(entries, async id => results[id]!);
    expect(outcome.allowed.map(e => e.id)).toEqual(['a', 'c']);
    expect(outcome.removed.map(r => [r.entry.id, r.reason])).toEqual([
      ['b', "blocked by your organization's model policy"],
      ['d', 'not found or not enabled for your project'],
    ]);
    expect(outcome.confirmedIds).toEqual(['a']);
  });

  it('changes nothing on a credential or project-wide failure', async () => {
    const outcome = await filterVertexModelsByAccess(entries, async id =>
      id === 'b' ? { ok: false, status: 403, error: 'Vertex AI API has not been enabled' } : { ok: false, status: 404 });
    expect(outcome).toMatchObject({ aborted: true, removed: [], allowed: entries });
  });
});
