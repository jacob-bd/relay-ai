import { afterEach, describe, expect, it, vi } from 'vitest';

describe('Core tool schema middleware', () => {
  afterEach(() => {
    vi.doUnmock('ai');
    vi.resetModules();
  });

  async function loadTransform(npm: string) {
    const wrapLanguageModel = vi.fn(({ model, middleware }: any) => ({ model, middleware }));
    vi.doMock('ai', () => ({ wrapLanguageModel }));
    const { withPortableToolSchemas } = await import('../src/core/model.js');
    await withPortableToolSchemas({ modelId: 'deepseek/deepseek-v4.1-flash' } as any, npm);
    return wrapLanguageModel.mock.calls[0]?.[0]?.middleware.transformParams as (arg: unknown) => Promise<any>;
  }

  it('rewrites NUL pattern escapes before tools reach the provider', async () => {
    const transformParams = await loadTransform('@ai-sdk/openai-compatible');
    const result = await transformParams({
      params: {
        tools: [
          {
            type: 'function',
            name: 'Artifact',
            inputSchema: {
              type: 'object',
              properties: {
                file_paths: {
                  type: 'array',
                  items: { type: 'string', pattern: '^[^\\0]*$' },
                },
              },
            },
          },
          { type: 'provider', name: 'web_search' },
        ],
      },
    });

    expect(result.tools[0].inputSchema.properties.file_paths.items.pattern).toBe('^[^\\x00]*$');
    expect(result.tools[1]).toEqual({ type: 'provider', name: 'web_search' });
  });

  it('leaves the tool list untouched when no pattern needs rewriting', async () => {
    const transformParams = await loadTransform('@ai-sdk/openai-compatible');
    const tools = [{ type: 'function', name: 'Read', inputSchema: { type: 'object', properties: {} } }];
    const result = await transformParams({ params: { tools } });
    expect(result.tools).toBe(tools);
  });
});
