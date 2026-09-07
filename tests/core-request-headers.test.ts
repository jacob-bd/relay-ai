import { afterEach, describe, expect, it, vi } from 'vitest';

describe('Core request headers middleware', () => {
  afterEach(() => {
    vi.doUnmock('ai');
    vi.resetModules();
  });

  it('adds the OpenCode session header while preserving per-call overrides', async () => {
    const wrapLanguageModel = vi.fn(({ model, middleware }: any) => ({ model, middleware }));
    vi.doMock('ai', () => ({ wrapLanguageModel }));
    const { withRequestHeaders } = await import('../src/core/reasoning.js');
    const baseModel = { modelId: 'deepseek-v4-flash' } as any;

    const wrapped = await withRequestHeaders(baseModel, {
      'x-opencode-session': 'conversation-default',
      'User-Agent': 'relay-ai/test',
    });
    const transformParams = wrapLanguageModel.mock.calls[0]?.[0]?.middleware.transformParams;
    const result = await transformParams({
      params: { headers: { 'x-opencode-session': 'conversation-explicit', 'x-client': 'keep' } },
    });

    expect(wrapped.model).toBe(baseModel);
    expect(result.headers).toEqual({
      'x-opencode-session': 'conversation-explicit',
      'User-Agent': 'relay-ai/test',
      'x-client': 'keep',
    });
  });
});
