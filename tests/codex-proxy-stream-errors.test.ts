import { afterEach, describe, expect, it, vi } from 'vitest';
import { translateResponsesRequest } from '../src/codex-responses-adapter.js';
import { startCodexProxy, type CodexProxyHandle } from '../src/codex-proxy.js';

vi.mock('../src/provider-factory.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/provider-factory.js')>();
  return { ...actual, createLanguageModel: vi.fn().mockResolvedValue({}) };
});
vi.mock('../src/codex-responses-adapter.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/codex-responses-adapter.js')>();
  return { ...actual, translateResponsesRequest: vi.fn(() => { throw new Error('translate exploded'); }) };
});

describe('stream path errors after headers (review fix)', () => {
  let handle: CodexProxyHandle | undefined;
  afterEach(() => { handle?.close(); handle = undefined; vi.mocked(translateResponsesRequest).mockClear(); });

  it('ends the stream with response.failed when building the request throws', async () => {
    handle = await startCodexProxy([{ modelId: 'm', npm: '@ai-sdk/anthropic', apiKey: 'x', upstreamModelId: 'claude-opus-5-5', providerId: 'anthropic' } as never], { requireAuth: false });
    const res = await fetch(`http://127.0.0.1:${handle.port}/v1/responses`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'm', input: 'hi', stream: true }),
      signal: AbortSignal.timeout(4_000),
    });
    const text = await res.text();
    expect(text).toContain('event: response.failed');
    expect(text).toContain('translate exploded');
  }, 10_000);
});
