import { describe, expect, it, vi } from 'vitest';
import { forwardNativeCodexHttp, nativeResponsesWebSocketOptions, NATIVE_FORWARD_HEADERS } from '../src/codex/native-forward.js';

describe('native Codex forwarding', () => {
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
