// Characterizations of the current concrete proxy, not pool acceptance tests.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { streamText } from 'ai';
import { createLanguageModel } from '../src/provider-factory.js';
import {
  PoolContinuationStore,
  poolRouteKey,
  preparePoolHistory,
} from '../src/pool/continuation.js';
import { startCodexProxy, type CodexProxyHandle, type CodexProxyRoute } from '../src/codex-proxy.js';

const requests: Array<{ path: string; authorization?: string; body: Record<string, any> }> = [];
const provider = createServer((req, res) => {
  const buffers: Buffer[] = [];
  req.on('data', chunk => buffers.push(Buffer.from(chunk)));
  req.on('end', () => {
    requests.push({ path: req.url!, authorization: req.headers.authorization, body: JSON.parse(Buffer.concat(buffers).toString()) });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const chunk = (delta: unknown, finish_reason: string | null) => res.write('data: ' + JSON.stringify({
      id: 'fake', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason }],
    }) + '\n\n');
    chunk({ role: 'assistant', content: 'FIRST_REPLY' }, null);
    chunk({}, 'stop');
    res.end('data: [DONE]\n\n');
  });
});
let baseURL: string;
let proxy: CodexProxyHandle;
beforeAll(async () => {
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
  baseURL = 'http://127.0.0.1:' + (provider.address() as { port: number }).port;
  const route = (id: string): CodexProxyRoute => ({
    modelId: 'same-model', upstreamModelId: 'same-model', providerId: id,
    npm: '@ai-sdk/openai-compatible', apiKey: 'fake-' + id, baseURL: baseURL + '/' + id + '/v1',
  });
  proxy = await startCodexProxy([route('groq'), route('groq-2')], { requireAuth: false });
});
afterAll(async () => {
  proxy?.close();
  provider.closeAllConnections();
  await new Promise<void>(resolve => provider.close(() => resolve()));
});
async function http(body: Record<string, unknown>) {
  const response = await fetch('http://127.0.0.1:' + proxy.port + '/v1/responses', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stream: true, ...body }),
  });
  const events = (await response.text()).split('\n').filter(x => x.startsWith('data: {')).map(x => JSON.parse(x.slice(6)));
  return { response, events };
}
async function wsTurn(body: Record<string, unknown>) {
  return new Promise<any[]>((resolve, reject) => {
    const client = new WebSocket('ws://127.0.0.1:' + proxy.port + '/v1/responses');
    const events: any[] = [];
    const timer = setTimeout(() => { client.terminate(); reject(new Error('WS contract timeout')); }, 2500);
    client.on('open', () => client.send(JSON.stringify({ stream: true, ...body })));
    client.on('message', data => {
      const event = JSON.parse(data.toString());
      events.push(event);
      if (['response.completed', 'response.failed', 'error'].includes(event.type)) client.close();
    });
    client.on('close', () => { clearTimeout(timer); resolve(events); });
    client.on('error', reject);
  });
}

describe('current Codex proxy boundaries that pool integration must change', () => {
  it('reproduces same-model account collision even with provider-qualified selection', async () => {
    const before = requests.length;
    await http({ model: 'groq__same-model', input: 'select first account' });
    const captured = requests[before];
    // Lookup chooses the first route, but modelId-keyed clients were overwritten
    // by the second route. This passing characterization records a defect.
    expect(captured.path).toContain('/groq-2/');
    expect(captured.authorization).toBe('Bearer fake-groq-2');
  });

  it('reproduces HTTP continuation history loss rather than certifying portability', async () => {
    const first = await http({ model: 'groq__same-model', input: 'ORIGINAL_HISTORY' });
    const completed = first.events.find(x => x.type === 'response.completed');
    expect(completed?.response.id).toBeTruthy();
    const before = requests.length;
    const second = await http({ model: 'groq-2__same-model', previous_response_id: completed.response.id, input: 'DELTA_ONLY' });
    expect(second.events.some(x => x.type === 'response.completed')).toBe(true);
    const captured = JSON.stringify(requests[before].body);
    expect(captured).toContain('DELTA_ONLY');
    expect(captured).not.toContain('ORIGINAL_HISTORY');
    expect(captured).not.toContain('FIRST_REPLY');
    expect(requests[before].body.previous_response_id).toBeUndefined();
  });

  it('rejects a WS delta after reconnect, without sending an orphan upstream', async () => {
    const first = await wsTurn({ model: 'groq__same-model', input: 'socket-local history' });
    const completed = first.find(x => x.type === 'response.completed');
    expect(completed?.response.id).toBeTruthy();
    const before = requests.length;
    const next = await wsTurn({ model: 'groq-2__same-model', previous_response_id: completed.response.id, input: 'follow up' });
    expect(JSON.stringify(next)).toContain('Unknown or expired previous_response_id');
    expect(requests).toHaveLength(before);
  });
});


describe('prototype corrective contracts through actual SDK HTTP requests', () => {
  it('sends each account its own credentials and reconstructs history on account switch', async () => {
    const first = { account: 'groq', endpointRevision: 'v1', model: 'same-model' };
    const second = { ...first, account: 'groq-2' };
    const clients = new Map();
    for (const identity of [first, second]) clients.set(poolRouteKey(identity), await createLanguageModel({
      npm: '@ai-sdk/openai-compatible', modelId: identity.model, providerId: identity.account,
      apiKey: 'fake-' + identity.account, baseURL: baseURL + '/' + identity.account + '/v1',
    }));
    const body = { model: 'pool', input: 'PORTABLE_HISTORY', instructions: 'KEEP_RULES' };
    const before = requests.length;
    const run = async (identity: typeof first, params: ReturnType<typeof preparePoolHistory>) => {
      const { toolContext: _toolContext, ...call } = params;
      const result = streamText({ model: clients.get(poolRouteKey(identity)), ...call, maxRetries: 0, onError: () => {} });
      const parts = [];
      for await (const part of result.stream) parts.push(part);
      expect(parts.some(p => p.type === 'error')).toBe(false);
      expect(parts.some(p => p.type === 'finish')).toBe(true);
    };
    await run(first, preparePoolHistory(body, undefined, first, '@ai-sdk/openai-compatible'));
    const store = new PoolContinuationStore();
    store.remember('owned-response', 'session/branch', body, [{ type: 'function_call', call_id: 'read1', name: 'read', arguments: '{}' }], first);
    const resolved = store.resolve('session/branch', { model: 'pool', previous_response_id: 'owned-response', input: [{ type: 'function_call_output', call_id: 'read1', output: 'FILE_CONTENT' }] });
    await run(second, preparePoolHistory(resolved.body, resolved.source, second, '@ai-sdk/openai-compatible'));
    expect(requests[before].path).toContain('/groq/v1/');
    expect(requests[before].authorization).toBe('Bearer fake-groq');
    expect(requests[before + 1].path).toContain('/groq-2/v1/');
    expect(requests[before + 1].authorization).toBe('Bearer fake-groq-2');
    const sent = requests[before + 1].body;
    expect(sent.messages.map((m: any) => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
    expect(JSON.stringify(sent)).toContain('PORTABLE_HISTORY');
    expect(JSON.stringify(sent)).toContain('KEEP_RULES');
    expect(JSON.stringify(sent)).toContain('FILE_CONTENT');
    expect(sent.previous_response_id).toBeUndefined();
  });
});
