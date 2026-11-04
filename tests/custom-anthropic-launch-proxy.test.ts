import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { startProxy } from '../src/proxy.js';

let upstream: Server | undefined;
let close: (() => void) | undefined;
afterEach(() => { close?.(); upstream?.close(); });

describe('single-model launch to a custom Claude-style endpoint', () => {
  it('forwards the key as x-api-key and Bearer, plus the endpoint custom headers', async () => {
    let seen: IncomingHttpHeaders = {};
    upstream = createServer((req, res) => {
      seen = req.headers;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'm', content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }));
    });
    await new Promise<void>(resolve => upstream!.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;

    const handle = await startProxy(base, 'Qwen3-14B', false, 40_960, {
      providerId: 'custom-gw-anthropic', authType: 'api', modelFormat: 'anthropic', headers: { 'X-Plan': 'coding' },
    }, 'sk-test');
    close = () => handle.close();

    const response = await fetch(`http://127.0.0.1:${handle.port}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': handle.token, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'Qwen3-14B', max_tokens: 8, messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(response.status).toBe(200);
    expect(seen['x-api-key']).toBe('sk-test');
    expect(seen['authorization']).toBe('Bearer sk-test');
    expect(seen['x-plan']).toBe('coding');
  });
});
