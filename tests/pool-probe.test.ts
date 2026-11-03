import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { probePoolModel } from '../src/pool/probe.js';
let calls = 0;
let executed = false;
const server = createServer((req, res) => {
  let raw = '';
  req.on('data', chunk => raw += String(chunk));
  req.on('end', () => {
    calls++;
    const body = JSON.parse(raw);
    executed ||= body.messages.some((message: { role: string }) => message.role === 'tool');
    const tools = Boolean(body.tools?.length);
    const delta = tools
      ? { tool_calls: [{ index: 0, id: 'probe', type: 'function', function: { name: 'relay_pool_probe', arguments: '{"value":"ok"}' } }] }
      : { content: 'OK' };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const [part, finish] of [[delta, null], [{}, tools ? 'tool_calls' : 'stop']]) {
      res.write('data: ' + JSON.stringify({ id: 'p', object: 'chat.completion.chunk', created: 1, model: 'p', choices: [{ index: 0, delta: part, finish_reason: finish }] }) + String.fromCharCode(10, 10));
    }
    res.end('data: [DONE]' + String.fromCharCode(10, 10));
  });
});
let baseURL: string;
beforeAll(async () => { await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); baseURL = 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/v1'; });
afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
describe('bounded pool enrollment probes', () => {
  it('performs two one-shot calls and never executes a tool loop', async () => {
    const model = createOpenAICompatible({ name: 'fake', apiKey: 'fake', baseURL }).chatModel('probe');
    expect(await probePoolModel(model, new AbortController().signal)).toEqual({ text: 'passed', tools: 'passed' });
    expect(calls).toBe(2);
    expect(executed).toBe(false);
  });
  it('reports the underlying provider failure when debug tracing is requested', async () => {
    const model = createOpenAICompatible({ name: 'fake', apiKey: 'fake', baseURL: 'http://127.0.0.1:1/v1' }).chatModel('probe');
    const debug = vi.fn();
    expect(await probePoolModel(model, new AbortController().signal, 1000, debug)).toMatchObject({ failure: 'provider' });
    expect(debug).toHaveBeenCalled();
  });
});
