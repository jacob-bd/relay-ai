import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateText } from 'ai';
import { createLanguageModel } from '../src/provider-factory.js';

const anthropicReply = () => new Response(JSON.stringify({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'm',
  content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn', stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1 },
}), { status: 200, headers: { 'content-type': 'application/json' } });

async function sentHeaders(providerId: string, baseURL: string): Promise<Headers> {
  const fetchMock = vi.fn(async () => anthropicReply());
  vi.stubGlobal('fetch', fetchMock);
  const model = await createLanguageModel({ npm: '@ai-sdk/anthropic', modelId: 'm', apiKey: 'sk-test', baseURL, providerId });
  await generateText({ model, prompt: 'hi', maxRetries: 0 });
  const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
  return new Headers(init.headers);
}

describe('Claude-style auth header', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('custom endpoints send the key both as x-api-key and Bearer (some gateways need Bearer)', async () => {
    const headers = await sentHeaders('custom-gw-anthropic', 'https://gateway.example.com');
    expect(headers.get('x-api-key')).toBe('sk-test');
    expect(headers.get('authorization')).toBe('Bearer sk-test');
  });

  it('built-in Anthropic keeps sending x-api-key only', async () => {
    const headers = await sentHeaders('anthropic', 'https://api.anthropic.com');
    expect(headers.get('x-api-key')).toBe('sk-test');
    expect(headers.get('authorization')).toBeNull();
  });
});
