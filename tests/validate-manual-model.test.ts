import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { validateManualModel } from '../src/registry/validate-manual-model.js';
import type { RegistryProvider } from '../src/registry/types.js';

let server: Server;
let provider: RegistryProvider;
let requests: Array<{ path?: string; body: any; authorization?: string; tenant?: string }>;
let mode: 'success' | 'error' | 'truncated' | 'bad-tool' | 'bad-result';
beforeEach(async () => {
  mode = 'success'; requests = [];
  server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push({ path: req.url, body, authorization: req.headers.authorization, tenant: req.headers['x-tenant'] as string });
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (mode === 'error') { res.end('data: {"error":{"message":"Model unavailable","type":"invalid_request_error","code":"invalid_model"}}\n\n'); return; }
    const emit = (delta: unknown, reason: string | null = null) => res.write(`data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: reason }] })}\n\n`);
    if (requests.length === 2) {
      const nonce = body.messages[0].content.match(/value "([^"]+)"/)[1];
      emit({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_test', type: 'function', function: { name: 'relay_validation', arguments: JSON.stringify({ value: mode === 'bad-tool' ? 'wrong' : nonce }) } }] });
      emit({}, 'tool_calls');
    } else {
      const receipt = requests.length === 3 ? body.messages.find((m: any) => m.role === 'tool').content : 'RELAY_OK';
      emit({ role: 'assistant', content: mode === 'bad-result' && requests.length === 3 ? 'Wrong result' : receipt });
      if (mode !== 'truncated') emit({}, 'stop');
    }
    res.end('data: [DONE]\n\n');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  provider = { id: 'custom-test', templateId: 'custom-openai', name: 'Test', enabled: true,
    authRef: 'unused', addedAt: '2026-09-08T00:00:00Z', api: { npm: '@ai-sdk/openai-compatible', url: `http://127.0.0.1:${address.port}/v1`, headers: { 'X-Tenant': 'test-tenant' } } };
});
afterEach(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });

describe('real SDK manual model validation against a local API fixture', () => {
  it('streams three requests to the exact model, forwards auth/headers, and returns the tool result', async () => {
    await validateManualModel(provider, 'unlisted/beta', 'test-key');
    expect(requests).toHaveLength(3);
    expect(requests.every(r => r.path === '/v1/chat/completions' && r.body.model === 'unlisted/beta' && r.body.stream === true)).toBe(true);
    expect(requests.every(r => r.authorization === 'Bearer test-key' && r.tenant === 'test-tenant')).toBe(true);
    expect(requests[1].body.tool_choice).toBe('auto');
    expect(requests[2].body.messages.find((m: any) => m.role === 'tool')).toMatchObject({ tool_call_id: 'call_test' });
  });
  it('rejects an error event inside an HTTP 200 response', async () => {
    mode = 'error';
    await expect(validateManualModel(provider, 'bad', 'test-key')).rejects.toThrow();
    expect(requests).toHaveLength(1);
  });
  it('rejects an incomplete stream even if it contains text', async () => {
    mode = 'truncated';
    await expect(validateManualModel(provider, 'bad', 'test-key')).rejects.toThrow();
    expect(requests).toHaveLength(1);
  });
  it('rejects a tool call whose arguments do not match the test', async () => {
    mode = 'bad-tool';
    await expect(validateManualModel(provider, 'bad', 'test-key')).rejects.toThrow('expected tool call');
    expect(requests).toHaveLength(2);
  });
  it('rejects a model that cannot use the tool result', async () => {
    mode = 'bad-result';
    await expect(validateManualModel(provider, 'bad', 'test-key')).rejects.toThrow('round-trip');
    expect(requests).toHaveLength(3);
  });
});
