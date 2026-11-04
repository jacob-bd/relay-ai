import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { startCodexProxy } from '../src/codex-proxy.js';
import { CodexPoolRuntime, FREE_POOL_MODEL_ID, type CodexPoolRoute } from '../src/pool/codex-runtime.js';
const member = { providerId: 'account', modelId: 'm' };
const route: CodexPoolRoute = {
  member, revision: 'rev', identity: { account: 'account', endpointRevision: 'rev', model: 'm' },
  freeStatus: 'verified_free', catalogVerified: true, accessVerified: true, billingSafe: true,
  targets: ['codex'], toolsVerified: true, defaultEffortVerified: true, effortLevels: ['high'], contextFits: true, contextVerified: true,
  async open() { return (async function* () {
    yield { type: 'text-start', id: 't' }; yield { type: 'text-delta', id: 't', text: 'OK' };
    yield { type: 'text-end', id: 't' }; yield { type: 'finish', finishReason: 'stop' };
  })(); },
};
describe('Codex proxy pool integration', () => {
  it('serves explicit authenticated pool HTTP requests through production runtime', async () => {
    const runtime = new CodexPoolRuntime({ members: [member], effort: 'auto', receipts: [] }, async () => [route]);
    const proxy = await startCodexProxy([], { requireAuth: true, pool: runtime });
    try {
      const response = await fetch('http://127.0.0.1:' + proxy.port + '/v1/responses', {
        method: 'POST', headers: { authorization: 'Bearer proxy-local', 'content-type': 'application/json',
          'x-codex-turn-metadata': JSON.stringify({ session_id: 's', thread_id: 't', turn_id: '1' }) },
        body: JSON.stringify({ model: FREE_POOL_MODEL_ID, input: 'hi', stream: false }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ model: FREE_POOL_MODEL_ID, status: 'completed', output: [{ content: [{ text: 'OK' }] }] });
    } finally { proxy.close(); }
  });
  it('never substitutes a concrete route when the pool runtime is absent', async () => {
    const proxy = await startCodexProxy([], { requireAuth: true });
    try {
      const response = await fetch('http://127.0.0.1:' + proxy.port + '/v1/responses', {
        method: 'POST', headers: { authorization: 'Bearer proxy-local', 'content-type': 'application/json' },
        body: JSON.stringify({ model: FREE_POOL_MODEL_ID, input: 'hi' }),
      });
      expect(response.status).toBe(400);
    } finally { proxy.close(); }
  });
  it('does not treat an unknown model as a pool fallback', async () => {
    const runtime = new CodexPoolRuntime({ members: [member], effort: 'auto', receipts: [] }, async () => [route]);
    const proxy = await startCodexProxy([], { requireAuth: true, pool: runtime });
    try {
      const response = await fetch('http://127.0.0.1:' + proxy.port + '/v1/responses', {
        method: 'POST', headers: { authorization: 'Bearer proxy-local', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'not-the-pool', input: 'hi' }),
      });
      expect(response.status).toBe(404);
    } finally { proxy.close(); }
  });
});

it('cancels a pool request when the HTTP caller disconnects', async () => {
  let aborted = false;
  const runtime = new CodexPoolRuntime({ members: [member], effort: 'auto', receipts: [] }, async () => [{
    ...route,
    async open(signal) {
      return (async function* () {
        yield { type: 'text-delta', text: 'first' };
        await new Promise<void>(resolve => {
          if (signal.aborted) { aborted = true; resolve(); }
          else signal.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true });
        });
      })();
    },
  }]);
  const proxy = await startCodexProxy([], { requireAuth: true, pool: runtime });
  try {
    const response = await fetch('http://127.0.0.1:' + proxy.port + '/v1/responses', {
      method: 'POST', headers: { authorization: 'Bearer proxy-local', 'content-type': 'application/json',
        'x-codex-turn-metadata': JSON.stringify({ session_id: 's', thread_id: 'cancel', turn_id: '1' }) },
      body: JSON.stringify({ model: FREE_POOL_MODEL_ID, input: 'hi', stream: true }),
    });
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    for (let i = 0; i < 50 && !aborted; i++) await new Promise(resolve => setTimeout(resolve, 10));
    expect(aborted).toBe(true);
  } finally { proxy.close(); }
});

it('lists the single pool model only when a pool runtime is configured', async () => {
  const runtime = new CodexPoolRuntime({ members: [member], effort: 'auto', receipts: [] }, async () => [route]);
  const withPool = await startCodexProxy([], { requireAuth: true, pool: runtime });
  try {
    const body = await (await fetch('http://127.0.0.1:' + withPool.port + '/v1/models')).json() as { data: Array<{ id: string }> };
    expect(body.data.map(model => model.id)).toEqual(['relay-free-pool']);
  } finally { withPool.close(); }
  const withoutPool = await startCodexProxy([], { requireAuth: true });
  try {
    const body = await (await fetch('http://127.0.0.1:' + withoutPool.port + '/v1/models')).json() as { data: Array<{ id: string }> };
    expect(body.data).toEqual([]);
  } finally { withoutPool.close(); }
});

it('serves pool turns over WebSocket using per-frame client metadata', async () => {
  const runtime = new CodexPoolRuntime({ members: [member], effort: 'auto', receipts: [] }, async () => [route]);
  const proxy = await startCodexProxy([], { pool: runtime, requireAuth: false });
  try {
    const events = await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
      const client = new WebSocket('ws://127.0.0.1:' + proxy.port + '/v1/responses');
      const seen: Array<Record<string, unknown>> = [];
      const timer = setTimeout(() => { client.terminate(); reject(new Error('WS pool timeout')); }, 3000);
      client.on('open', () => client.send(JSON.stringify({
        model: FREE_POOL_MODEL_ID,
        input: 'hi',
        stream: true,
        client_metadata: { session_id: 's', thread_id: 'ws-thread', turn_id: 'turn-1' },
      })));
      client.on('message', data => {
        const event = JSON.parse(data.toString()) as Record<string, unknown>;
        seen.push(event);
        if (['response.completed', 'response.failed', 'error'].includes(String(event.type))) client.close();
      });
      client.on('close', () => { clearTimeout(timer); resolve(seen); });
      client.on('error', reject);
    });
    const completed = events.find(event => event.type === 'response.completed') as
      { response?: { model?: string; output?: Array<{ content?: Array<{ text?: string }> }> } } | undefined;
    expect(completed?.response?.model).toBe(FREE_POOL_MODEL_ID);
    expect(completed?.response?.output?.[0]?.content?.[0]?.text).toBe('OK');
  } finally { proxy.close(); }
});

it('keeps the pool unavailable on WebSocket when no runtime is configured', async () => {
  const proxy = await startCodexProxy([], { requireAuth: false });
  try {
    const events = await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
      const client = new WebSocket('ws://127.0.0.1:' + proxy.port + '/v1/responses');
      const seen: Array<Record<string, unknown>> = [];
      const timer = setTimeout(() => { client.terminate(); reject(new Error('WS pool timeout')); }, 3000);
      client.on('open', () => client.send(JSON.stringify({ model: FREE_POOL_MODEL_ID, input: 'hi', stream: true })));
      client.on('message', data => {
        const event = JSON.parse(data.toString()) as Record<string, unknown>;
        seen.push(event);
        if (['response.completed', 'response.failed', 'error'].includes(String(event.type))) client.close();
      });
      client.on('close', () => { clearTimeout(timer); resolve(seen); });
      client.on('error', reject);
    });
    expect(JSON.stringify(events)).toContain('Free pool is not configured for this proxy');
  } finally { proxy.close(); }
});

it('serves the pool on an unauthenticated loopback proxy only when explicitly configured', async () => {
  const runtime = new CodexPoolRuntime({ members: [member], effort: 'auto', receipts: [] }, async () => [route]);
  const proxy = await startCodexProxy([], { pool: runtime, requireAuth: false });
  try {
    const response = await fetch('http://127.0.0.1:' + proxy.port + '/v1/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:5173' },
      body: JSON.stringify({
        model: FREE_POOL_MODEL_ID,
        input: 'hi',
        stream: false,
        client_metadata: { session_id: 's', thread_id: 'desktop', turn_id: '1' },
      }),
    });
    expect(response.status).toBe(200);
  } finally { proxy.close(); }
});

it('lists and serves the pool alongside a concrete route', async () => {
  const runtime = new CodexPoolRuntime({ members: [member], effort: 'auto', receipts: [] }, async () => [route]);
  const concrete = {
    modelId: 'concrete-model',
    upstreamModelId: 'concrete-model',
    providerId: 'account',
    npm: '@ai-sdk/openai-compatible',
    apiKey: 'fake',
    baseURL: 'http://127.0.0.1:1/v1',
  };
  const proxy = await startCodexProxy([concrete], { requireAuth: true, pool: runtime });
  try {
    const models = await (await fetch('http://127.0.0.1:' + proxy.port + '/v1/models')).json() as { data: Array<{ id: string }> };
    expect(models.data.map(item => item.id)).toEqual(expect.arrayContaining(['concrete-model', 'relay-free-pool']));
    const response = await fetch('http://127.0.0.1:' + proxy.port + '/v1/responses', {
      method: 'POST',
      headers: {
        authorization: 'Bearer proxy-local',
        'content-type': 'application/json',
        'x-codex-turn-metadata': JSON.stringify({ session_id: 's', thread_id: 'together', turn_id: '1' }),
      },
      body: JSON.stringify({ model: FREE_POOL_MODEL_ID, input: 'hi', stream: false }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).model).toBe(FREE_POOL_MODEL_ID);
  } finally { proxy.close(); }
});
