import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateResponsesResponse } from '../src/codex-responses-adapter.js';
import { startCodexProxy, type CodexProxyHandle } from '../src/codex-proxy.js';

vi.mock('../src/provider-factory.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/provider-factory.js')>();
  return { ...actual, createLanguageModel: vi.fn().mockResolvedValue({}) };
});
vi.mock('../src/codex-responses-adapter.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/codex-responses-adapter.js')>();
  return { ...actual, generateResponsesResponse: vi.fn() };
});

describe('non-stream overflow error code (#95)', () => {
  let handle: CodexProxyHandle | undefined;
  afterEach(() => { handle?.close(); handle = undefined; vi.mocked(generateResponsesResponse).mockReset(); });

  it('returns context_length_exceeded for prompt-too-long', async () => {
    vi.mocked(generateResponsesResponse).mockRejectedValue(Object.assign(new Error('prompt is too long: 1207698 tokens > 1000000 maximum'), { statusCode: 400 }));
    handle = await startCodexProxy([{ modelId: 'm', npm: '@ai-sdk/anthropic', apiKey: 'x', upstreamModelId: 'claude-opus-5-5', providerId: 'anthropic' } as never], { requireAuth: false });
    const res = await fetch(`http://127.0.0.1:${handle.port}/v1/responses`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'm', input: 'hi', stream: false }),
    });
    const json = await res.json() as { error: { code: string; type: string } };
    expect(res.status).toBe(400);
    expect(json.error).toEqual(expect.objectContaining({ code: 'context_length_exceeded', type: 'invalid_request_error' }));
  });
});
