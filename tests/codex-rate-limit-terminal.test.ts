import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { startCodexProxy } from '../src/codex-proxy.js';
import { createOpenAI } from '@ai-sdk/openai';
import { streamResponsesResponse, generateResponsesResponse } from '../src/codex-responses-adapter.js';

let upstreamRequests = 0;
let baseURL = '';
const server = createServer((req, res) => {
  upstreamRequests++;
  req.resume();
  req.once('end', () => {
    res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '60' });
    res.end(JSON.stringify({ error: { message: 'The usage limit has been reached', type: 'rate_limit_error' } }));
  });
});
beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  baseURL = 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/v1';
});
afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });

describe('Codex OpenAI OAuth usage-limit handling', () => {
  it('does not retry a 429 inside Relay and returns one terminal failed stream', async () => {
    const proxy = await startCodexProxy([{
      modelId: 'oauth-model', npm: '@ai-sdk/openai-compatible', apiKey: 'fake',
      baseURL, upstreamModelId: 'oauth-model', providerId: 'openai-oauth',
    }], { requireAuth: true });
    try {
      const before = upstreamRequests;
      const res = await fetch('http://127.0.0.1:' + proxy.port + '/v1/responses', {
        method: 'POST',
        headers: { authorization: 'Bearer proxy-local', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'oauth-model', input: 'hi', stream: true }),
      });
      const body = await res.text();
      expect(res.status).toBe(200);
      expect(body).toContain('response.failed');
      expect(body).toContain('rate_limit_error');
      expect(body).not.toContain('response.completed');
      expect(upstreamRequests - before).toBe(1);
    } finally { proxy.close(); }
  });

  it('returns HTTP 429 without a synthetic successful assistant message', async () => {
    const proxy = await startCodexProxy([{
      modelId: 'oauth-model', npm: '@ai-sdk/openai-compatible', apiKey: 'fake',
      baseURL, upstreamModelId: 'oauth-model', providerId: 'openai-oauth',
    }], { requireAuth: true });
    try {
      const before = upstreamRequests;
      const res = await fetch('http://127.0.0.1:' + proxy.port + '/v1/responses', {
        method: 'POST',
        headers: { authorization: 'Bearer proxy-local', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'oauth-model', input: 'hi', stream: false }),
      });
      const body = await res.json();
      expect(res.status).toBe(429);
      expect(body).toMatchObject({ error: { type: 'rate_limit_error' } });
      expect(body.output).toBeUndefined();
      expect(upstreamRequests - before).toBe(1);
    } finally { proxy.close(); }
  });
});


it('makes one attempt on the native OpenAI Responses SDK path used by ChatGPT login', async () => {
  let calls = 0;
  const model = createOpenAI({ apiKey: 'isolated-fake-token', fetch: async () => {
    calls++;
    return new Response(JSON.stringify({ error: { message: 'The usage limit has been reached', type: 'usage_limit_reached', code: 'usage_limit_reached' } }), {
      status: 429, headers: { 'content-type': 'application/json', 'retry-after': '60' },
    });
  } }).responses('gpt-5.5');
  const params = { messages: [{ role: 'user' as const, content: 'hi' }] };
  const chunks: string[] = [];
  await streamResponsesResponse(model, params, 'oauth-model', chunk => chunks.push(chunk));
  expect(calls).toBe(1);
  expect(chunks.join('')).toContain('response.failed');
  expect(chunks.join('')).toContain('rate_limit_error');
  expect(chunks.join('')).not.toContain('response.completed');
  await expect(generateResponsesResponse(model, params, 'oauth-model')).rejects.toMatchObject({ statusCode: 429 });
  expect(calls).toBe(2);
});
