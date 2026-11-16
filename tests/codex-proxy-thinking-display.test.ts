import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateResponsesResponse } from '../src/codex-responses-adapter.js';
import { startCodexProxy, type CodexProxyHandle } from '../src/codex-proxy.js';

vi.mock('../src/provider-factory.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/provider-factory.js')>();
  return { ...actual, createLanguageModel: vi.fn().mockResolvedValue({}) };
});

vi.mock('../src/codex-responses-adapter.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/codex-responses-adapter.js')>();
  return {
    ...actual,
    generateResponsesResponse: vi.fn().mockResolvedValue({ id: 'resp_mock', object: 'response', output: [] }),
  };
});

describe('Codex proxy summarized thinking (#93)', () => {
  let handle: CodexProxyHandle | undefined;
  afterEach(() => { handle?.close(); handle = undefined; vi.mocked(generateResponsesResponse).mockClear(); });

  async function send(route: Record<string, unknown>) {
    handle = await startCodexProxy([route as never], { requireAuth: false });
    await fetch(`http://127.0.0.1:${handle.port}/v1/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: route.modelId, input: 'hi', stream: false }),
    });
    const params = vi.mocked(generateResponsesResponse).mock.calls[0]![1] as { providerOptions?: Record<string, Record<string, unknown>> };
    return params.providerOptions?.anthropic?.thinking as Record<string, unknown> | undefined;
  }

  it('asks Vertex Claude for summarized thinking', async () => {
    const thinking = await send({ modelId: 'vertex-anthropic__claude-opus-5-5', npm: '@ai-sdk/google-vertex/anthropic', apiKey: 'x', upstreamModelId: 'claude-opus-5-5', providerId: 'vertex-anthropic' });
    expect(thinking).toEqual(expect.objectContaining({ type: 'adaptive', display: 'summarized' }));
  });

  it('leaves third-party Claude gateways alone', async () => {
    const thinking = await send({ modelId: 'zen__claude-opus-5-5', npm: '@ai-sdk/anthropic', apiKey: 'x', upstreamModelId: 'claude-opus-5-5', providerId: 'zen' });
    expect(thinking?.display).toBeUndefined();
  });
});
