import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startProxyCatalog } from '../src/proxy.js';
import { CLAUDE_POOL_MODEL_ID, ClaudePoolRuntime } from '../src/pool/claude-runtime.js';
import type { DispatchRoute } from '../src/pool/dispatch.js';
const member = { providerId: 'account', modelId: 'm' };
const route: DispatchRoute = {
  member, revision: 'rev', freeStatus: 'verified_free', catalogVerified: true,
  accessVerified: true, billingSafe: true, targets: ['claude'], toolsVerified: true,
  defaultEffortVerified: true, effortLevels: [], contextFits: true, contextVerified: true,
  async open() {
    return (async function* () {
      yield { type: 'text-start', id: 't' };
      yield { type: 'text-delta', id: 't', text: 'POOL_OK' };
      yield { type: 'text-end', id: 't' };
      yield { type: 'finish', finishReason: 'stop' };
    })();
  },
};
const pool = { members: [member], effort: 'auto' as const, receipts: [] };
let handle: Awaited<ReturnType<typeof startProxyCatalog>>;
let preparedSessionId: string | undefined;
beforeAll(async () => {
  const runtime = new ClaudePoolRuntime(pool, async (_body, _signal, sessionId) => {
    preparedSessionId = sessionId;
    return [route];
  });
  handle = await startProxyCatalog([], CLAUDE_POOL_MODEL_ID, false, {
    pool: { runtime, displayName: 'Free model pool', contextWindow: 128000 },
  });
});
afterAll(() => handle?.close());
const auth = () => ({ authorization: 'Bearer ' + handle.token, 'content-type': 'application/json' });
describe('Claude pool proxy integration', () => {
  it('advertises exactly one pool model on an otherwise empty catalog', async () => {
    const body = await (await fetch('http://127.0.0.1:' + handle.port + '/v1/models')).json() as { data: Array<{ id: string }> };
    expect(body.data.map(model => model.id)).toEqual([CLAUDE_POOL_MODEL_ID]);
  });
  it('serves a nonstream Anthropic message through the shared pool', async () => {
    const res = await fetch('http://127.0.0.1:' + handle.port + '/v1/messages', {
      method: 'POST', headers: auth(),
      body: JSON.stringify({ model: CLAUDE_POOL_MODEL_ID, max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { content: Array<{ type: string; text?: string }> };
    expect(body.content.some(part => part.type === 'text' && part.text === 'POOL_OK')).toBe(true);
  });
  it('streams a protocol-valid Anthropic response', async () => {
    const res = await fetch('http://127.0.0.1:' + handle.port + '/v1/messages', {
      method: 'POST', headers: auth(),
      body: JSON.stringify({ model: CLAUDE_POOL_MODEL_ID, max_tokens: 64, stream: true, messages: [{ role: 'user', content: 'hi' }] }),
    });
    const text = await res.text();
    expect(text).toContain('event: message_start');
    expect(text).toContain('POOL_OK');
    expect(text).toContain('event: message_stop');
  });
  it('passes the client conversation id into per-route model creation', async () => {
    preparedSessionId = undefined;
    const res = await fetch('http://127.0.0.1:' + handle.port + '/v1/messages', {
      method: 'POST',
      headers: { ...auth(), 'x-claude-code-session-id': 'claude-conversation-1' },
      body: JSON.stringify({ model: CLAUDE_POOL_MODEL_ID, max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(res.status).toBe(200);
    expect(preparedSessionId).toBe('claude-conversation-1');
  });
});
