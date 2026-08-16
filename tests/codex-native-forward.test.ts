import { describe, expect, it, vi } from 'vitest';
import { buildCompactionResponseBody } from '../src/codex-responses-adapter.js';
import { forwardNativeCodexHttp, nativeResponsesWebSocketOptions, prepareNativeCodexBody, NATIVE_FORWARD_HEADERS } from '../src/codex/native-forward.js';

describe('native Codex forwarding', () => {
  it('converts Relay compaction into readable native history without touching native compaction', () => {
    const relayCompaction = (
      buildCompactionResponseBody('fixed the parser', 'relay-model').output as Record<string, unknown>[]
    )[0]!;
    const nativeCompaction = {
      type: 'compaction',
      id: 'cmp_native',
      encrypted_content: `gAAAAA${'A'.repeat(40)}`,
    };
    const original = {
      model: 'gpt-5.6-luna',
      input: [relayCompaction, nativeCompaction, { type: 'message', role: 'user', content: 'continue' }],
    };

    const prepared = prepareNativeCodexBody(original);

    expect(prepared).not.toBe(original);
    expect(prepared.input[0]).toEqual({
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: '[Summary of earlier conversation]\nfixed the parser' }],
    });
    expect(prepared.input[1]).toBe(nativeCompaction);
    expect(original.input[0]).toBe(relayCompaction);
  });

  it('rewrites Relay compaction before HTTP native forwarding', async () => {
    const relayCompaction = (
      buildCompactionResponseBody('preserve this context', 'relay-model').output as Record<string, unknown>[]
    )[0]!;
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { input: Array<Record<string, unknown>> };
      expect(body.input).toEqual([{
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '[Summary of earlier conversation]\npreserve this context' }],
      }]);
      return new Response('ok');
    });

    await forwardNativeCodexHttp({
      body: JSON.stringify({ model: 'gpt-5.6-luna', input: [relayCompaction] }),
      inboundHeaders: {},
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('forwards only allowlisted native identity headers with manual redirects', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      expect(_url).toBe('https://chatgpt.com/backend-api/codex/responses');
      expect(init.redirect).toBe('manual');
      expect(init.headers).toEqual({
        authorization: 'Bearer native',
        'ChatGPT-Account-Id': 'acct',
        originator: 'codex_cli_rs',
        'content-type': 'application/json',
      });
      return new Response('native-body', { status: 201, headers: { 'content-type': 'text/event-stream' } });
    });
    const result = await forwardNativeCodexHttp({
      body: '{"model":"gpt-5.5"}',
      inboundHeaders: {
        authorization: 'Bearer native',
        'chatgpt-account-id': 'acct',
        originator: 'codex_cli_rs',
        host: '127.0.0.1',
        'content-length': '20',
        'x-provider-key': 'relay-secret',
      },
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(result.status).toBe(201);
    expect(await result.text()).toBe('native-body');
    expect(NATIVE_FORWARD_HEADERS.has('x-provider-key')).toBe(false);
  });

  it('adds the required native Responses WebSocket protocol headers without exposing secrets', () => {
    const result = nativeResponsesWebSocketOptions({
      wsUrl: 'wss://example.test/responses',
      headers: {
        authorization: 'Bearer native',
        'chatgpt-account-id': 'acct',
        'x-codex-turn-metadata': '{"turn_id":"turn-1"}',
        'x-provider-key': 'relay-secret',
      },
    });
    expect(result.url).toBe('wss://example.test/responses');
    expect(result.headers).toMatchObject({
      authorization: 'Bearer native',
      'ChatGPT-Account-Id': 'acct',
      'OpenAI-Beta': 'responses_websockets=2026-02-06',
      version: '0.144.1',
      originator: 'codex_cli_rs',
      'x-codex-turn-metadata': '{"turn_id":"turn-1"}',
    });
    expect(JSON.stringify(result.headers)).not.toContain('relay-secret');
  });

  it('preserves newer protocol header values supplied by the native client', () => {
    const result = nativeResponsesWebSocketOptions({
      headers: {
        'openai-beta': 'responses_websockets=custom',
        version: '0.147.0-alpha.6.5',
        originator: 'codex_vscode',
        'x-openai-internal-codex-responses-lite': 'true',
      },
    });
    expect(result.headers['OpenAI-Beta']).toBe('responses_websockets=custom');
    expect(result.headers.version).toBe('0.147.0-alpha.6.5');
    expect(result.headers.originator).toBe('codex_vscode');
    expect(result.headers['x-openai-internal-codex-responses-lite']).toBe('true');
  });
});
