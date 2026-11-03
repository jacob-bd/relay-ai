import { describe, expect, it } from 'vitest';
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
