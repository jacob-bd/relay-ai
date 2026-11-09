import { describe, expect, it, vi, afterEach } from 'vitest';
import { isNoKeySentinel, wireApiKey } from '../src/no-key-sentinel.js';
import { fetchTemplateModels } from '../src/registry/fetch-template-models.js';

describe('no-key sentinels', () => {
  it('recognises the internal markers, not real keys', () => {
    expect(isNoKeySentinel('local')).toBe(true);
    expect(isNoKeySentinel(' Anonymous ')).toBe(true);
    expect(isNoKeySentinel('sk-abc')).toBe(false);
    expect(wireApiKey('local')).toBe('');
    expect(wireApiKey('  ')).toBe('');
    expect(wireApiKey(' sk-abc ')).toBe('sk-abc');
  });
});

describe('fetchTemplateModels with a no-key marker', () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each(['local', 'anonymous', ''])('sends no Authorization header for %j', async key => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'm1' }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await fetchTemplateModels(
      { id: 'custom-openai-x', name: 'X', authType: 'none', npm: '@ai-sdk/openai-compatible',
        defaultBaseUrl: 'https://example.invalid/v1', modelSource: 'api-list', supported: true } as never,
      key, 'https://example.invalid/v1');
    const headers = (fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }])[1].headers;
    expect(headers['Authorization']).toBeUndefined();
  });
});
