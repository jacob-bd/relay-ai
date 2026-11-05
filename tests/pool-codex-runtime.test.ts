import { describe, expect, it } from 'vitest';
import { CodexPoolRuntime, FREE_POOL_MODEL_ID, type CodexPoolRoute } from '../src/pool/codex-runtime.js';
const member = { providerId: 'account', modelId: 'm' };
function route(): CodexPoolRoute {
  return {
    member, revision: 'rev', identity: { account: 'account', endpointRevision: 'rev', model: 'm' },
    freeStatus: 'verified_free', catalogVerified: true, accessVerified: true, billingSafe: true,
    targets: ['codex'], toolsVerified: true, defaultEffortVerified: true, effortLevels: ['high'],
    contextFits: true, contextVerified: true,
    async open() { return (async function* () {
      yield { type: 'text-start', id: 't' };
      yield { type: 'text-delta', id: 't', text: 'OK' };
      yield { type: 'text-end', id: 't' };
      yield { type: 'finish', finishReason: 'stop' };
    })(); },
  };
}
const headers = (thread = 'thread', turn = 'turn') => ({ 'x-codex-turn-metadata': JSON.stringify({ session_id: 'session', thread_id: thread, turn_id: turn }) });
const signal = () => new AbortController().signal;
describe('Codex pool runtime continuity', () => {
  it('reconstructs HTTP delta history before route preparation and refuses cross-branch references', async () => {
    const bodies: Record<string, unknown>[] = [];
    const runtime = new CodexPoolRuntime({ members: [member], effort: 'auto', receipts: [] }, async body => { bodies.push(body); return [route()]; });
    const response = await runtime.respond(headers(), { model: FREE_POOL_MODEL_ID, input: 'first', stream: false }, signal(), () => {});
    await runtime.respond(headers('thread', 'turn2'), { model: FREE_POOL_MODEL_ID, previous_response_id: response.id, input: 'second', stream: false }, signal(), () => {});
    expect(JSON.stringify(bodies[1].input)).toContain('first');
    expect(JSON.stringify(bodies[1].input)).toContain('OK');
    expect(JSON.stringify(bodies[1].input)).toContain('second');
    await expect(runtime.respond(headers('fork'), { model: FREE_POOL_MODEL_ID, previous_response_id: response.id, input: 'fork' }, signal(), () => {})).rejects.toThrow('missing Relay-owned history');
  });
  it('requires real turn metadata and explicit pool selection before route preparation', async () => {
    let prepared = false;
    const runtime = new CodexPoolRuntime({ members: [member], effort: 'auto', receipts: [] }, async () => { prepared = true; return [route()]; });
    await expect(runtime.respond({}, { model: FREE_POOL_MODEL_ID, input: 'hi' }, signal(), () => {})).rejects.toThrow('metadata');
    await expect(runtime.respond(headers(), { model: 'concrete', input: 'hi' }, signal(), () => {})).rejects.toThrow('explicit pool');
    expect(prepared).toBe(false);
  });
});

it('replays a successful duplicate without opening a provider again', async () => {
  let prepared = 0;
  const runtime = new CodexPoolRuntime({ members: [member], effort: 'auto', receipts: [] }, async () => { prepared++; return [route()]; });
  const body = { model: FREE_POOL_MODEL_ID, input: 'same', stream: false };
  const first = await runtime.respond(headers(), body, signal(), () => {});
  const second = await runtime.respond(headers(), body, signal(), () => {});
  expect(second).toEqual(first);
  expect(prepared).toBe(1);
});

it('allows an identical retry after a failure that reached no client and produced no answer', async () => {
  let prepared = 0;
  const runtime = new CodexPoolRuntime({ members: [member], effort: 'auto', receipts: [] }, async () => { prepared++; throw new Error('all unavailable'); });
  const body = { model: FREE_POOL_MODEL_ID, input: [{ type: 'function_call_output', call_id: 'call', output: 'first' }], stream: false };
  await expect(runtime.respond(headers(), body, signal(), () => {})).rejects.toThrow('all unavailable');
  await expect(runtime.respond(headers(), body, signal(), () => {})).rejects.toThrow('all unavailable');
  expect(prepared).toBe(2);
});

it.each([true, false])('still blocks an identical retry once an answer existed but could not be stored (stream=%s)', async stream => {
  let prepared = 0;
  const runtime = new CodexPoolRuntime({ members: [member], effort: 'auto', receipts: [] }, async () => { prepared++; return [route()]; });
  const body = { model: FREE_POOL_MODEL_ID, stream, input: 'hi', instructions: 'x'.repeat(4 * 1024 * 1024) };
  await expect(runtime.respond(headers(), body, signal(), () => {})).rejects.toThrow('continuation-history-too-large');
  await expect(runtime.respond(headers(), body, signal(), () => {})).rejects.toThrow('retry blocked');
  expect(prepared).toBe(1);
});

it('releases cancelled stream ownership even after response preamble bytes were written', async () => {
  let attempts = 0;
  const runtime = new CodexPoolRuntime({ members: [member], effort: 'auto', receipts: [] }, async () => {
    attempts++;
    return [route()];
  });
  const controller = new AbortController();
  const body = { model: FREE_POOL_MODEL_ID, input: 'cancelled', stream: true };
  let writes = 0;
  await expect(runtime.respond(headers(), body, controller.signal, () => {
    writes++;
    controller.abort(new Error('client disconnected'));
    throw controller.signal.reason;
  })).rejects.toThrow('client disconnected');
  expect(writes).toBeGreaterThan(0);
  const response = await runtime.respond(headers(), body, signal(), () => {});
  expect(response.status).toBe('completed');
  expect(attempts).toBe(2);
});


it('continues a live branch after 40 responses in another chat', async () => {
  const runtime = new CodexPoolRuntime({ members: [member], effort: 'auto', receipts: [] }, async () => [route()]);
  const first = await runtime.respond(headers('live', '1'), { model: FREE_POOL_MODEL_ID, input: 'first' }, signal(), () => {});
  for (let index = 0; index < 40; index++) {
    await runtime.respond(headers('other', String(index)), { model: FREE_POOL_MODEL_ID, input: 'other' }, signal(), () => {});
  }
  await expect(runtime.respond(headers('live', '2'), { model: FREE_POOL_MODEL_ID, input: 'next', previous_response_id: first.id },
    signal(), () => {})).resolves.toMatchObject({ status: 'completed' });
});

it.each([true, false])('refuses oversized history before completing tool output (stream=%s)', async stream => {
  const toolRoute = route();
  toolRoute.open = async () => (async function* () {
    yield { type: 'tool-input-start', id: 'call', toolName: 'read' };
    yield { type: 'tool-call', toolCallId: 'call', toolName: 'read', input: {} };
    yield { type: 'finish', finishReason: 'tool-calls' };
  })();
  const runtime = new CodexPoolRuntime({ members: [member], effort: 'auto', receipts: [] }, async () => [toolRoute]);
  const chunks: string[] = [];
  await expect(runtime.respond(headers(), { model: FREE_POOL_MODEL_ID, stream,
    input: Array.from({ length: 2000 }, () => ({ role: 'user', content: 'hi' })),
  }, signal(), chunk => chunks.push(chunk))).rejects.toThrow('continuation-history-too-large');
  expect(chunks.some(chunk => chunk.includes('event: response.output_item.done'))).toBe(false);
  expect(chunks.some(chunk => chunk.includes('event: response.completed'))).toBe(false);
});


it('refuses a history beyond 4MB without a terminal success', async () => {
  const runtime = new CodexPoolRuntime({ members: [member], effort: 'auto', receipts: [] }, async () => [route()]);
  const chunks: string[] = [];
  await expect(runtime.respond(headers(), { model: FREE_POOL_MODEL_ID, stream: true, input: 'hi',
    instructions: 'x'.repeat(4 * 1024 * 1024),
  }, signal(), chunk => chunks.push(chunk))).rejects.toThrow('continuation-history-too-large');
  expect(chunks.some(chunk => chunk.includes('event: response.completed'))).toBe(false);
});

it('stores successful history before delivering its terminal event', async () => {
  const runtime = new CodexPoolRuntime({ members: [member], effort: 'auto', receipts: [] }, async () => [route()]);
  let continued: Promise<Record<string, unknown>> | undefined;
  await runtime.respond(headers(), { model: FREE_POOL_MODEL_ID, stream: true, input: 'first' }, signal(), chunk => {
    if (!chunk.startsWith('event: response.completed')) return;
    const event = JSON.parse(chunk.split('data: ')[1]);
    continued = runtime.respond(headers('thread', 'next'), { model: FREE_POOL_MODEL_ID, input: 'next', previous_response_id: event.response.id }, signal(), () => {});
  });
  expect(continued).toBeDefined();
  await expect(continued).resolves.toMatchObject({ status: 'completed' });
});
