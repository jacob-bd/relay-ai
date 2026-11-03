import { expect, it } from 'vitest';
import { startFakeAnthropicGateway } from './support/fake-anthropic-gateway.js';

it('contains simultaneous failed-history requests before either provider attempt completes', async () => {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const gateway = await startFakeAnthropicGateway({ pool: true, guard: true, failures: ['rate', 'rate'], beforeAttempt: async () => { enter(); await gate; } });
  const body = { model: 'claude-pool', stream: true, messages: [{ role: 'user', content: 'synthetic concurrent prompt' }] };
  const send = (value = body, session = 'fixture/session/branch') => fetch(`http://127.0.0.1:${gateway.port}/v1/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-claude-code-session-id': session }, body: JSON.stringify(value), signal: AbortSignal.timeout(3000),
  });
  const first = send();
  try {
    await entered;
    const duplicate = await send();
    expect(duplicate.status).toBe(400); // Fixture error choice, not production policy.
    expect(await duplicate.text()).toContain('already in flight');
    expect(gateway.attempts).toHaveLength(1);
    const changed = send({ ...body, messages: [...body.messages, { role: 'user', content: 'different history' }] });
    const otherSession = send(body, 'other/session');
    // Wait for both distinct requests to reach their first provider attempt.
    await expect.poll(() => gateway.attempts.length).toBe(3);
    release();
    for (const response of await Promise.all([first, changed, otherSession])) expect(await response.text()).toContain('No pool models available');
    expect(gateway.attempts).toHaveLength(6);
    const retry = await send({ ...body, stream: false });
    expect(await retry.text()).toContain('A matching request recently failed');
    expect(gateway.attempts).toHaveLength(6);
    const withResult = { ...body, messages: [...body.messages, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'fixture_call', content: 'synthetic result' }] }] };
    const toolResponse = await send(withResult as typeof body);
    expect(await toolResponse.text()).toContain('No pool models available');
    expect(gateway.attempts).toHaveLength(8);
  } finally { release(); await first.catch(() => {}); await gateway.close(); }
});

it('buffers interrupted tool arguments and contains later nonstream replay without fallback', async () => {
  const gateway = await startFakeAnthropicGateway({ pool: true, guard: true, failures: ['tool-error', 'ok'] });
  const body = { model: 'claude-pool', stream: true, messages: [{ role: 'user', content: 'synthetic partial tool' }] };
  const send = (stream: boolean) => fetch(`http://127.0.0.1:${gateway.port}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-claude-code-session-id': 'fixture/tool-branch' }, body: JSON.stringify({ ...body, stream }) });
  try {
    const output = await (await send(true)).text();
    // The 0.18.1 formatter emits tool blocks only after arguments are complete.
    expect(output).toContain('event: message_start');
    expect(output).not.toContain('call_interrupted_fixture');
    expect(output).not.toContain('input_json_delta');
    expect(output).toContain('event: error');
    expect(output).not.toContain('event: message_stop');
    expect(gateway.attempts).toHaveLength(1);
    const retry = await send(false);
    expect(retry.headers.get('content-type')).toBe('application/json');
    expect((await retry.json()).error.message).toContain('recently failed');
    expect(gateway.attempts).toHaveLength(1);
  } finally { await gateway.close(); }
});

it('releases a cancelled owner after cleanup without a failed-history embargo or fallback', async () => {
  let entered!: () => void, cleaned!: () => void;
  const opened = new Promise<void>(resolve => { entered = resolve; });
  const closed = new Promise<void>(resolve => { cleaned = resolve; });
  let opens = 0;
  const gateway = await startFakeAnthropicGateway({ pool: true, guard: true, routes: () => [{ id: 'cancel-fixture', async open(signal) {
    const index = ++opens;
    return (async function* () {
      try {
        yield { type: 'start' };
        if (index === 1) {
          entered();
          await new Promise<void>((_, reject) => {
            if (signal.aborted) reject(signal.reason);
            else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          });
        }
        yield { type: 'text-delta', text: 'RELAY_CLIENT_OK' };
        yield { type: 'finish', finishReason: 'stop' };
      } finally { if (index === 1) cleaned(); }
    })();
  } }] });
  const abort = new AbortController();
  const send = (signal?: AbortSignal) => fetch(`http://127.0.0.1:${gateway.port}/v1/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-claude-code-session-id': 'cancel/session' }, signal,
    body: JSON.stringify({ model: 'claude-pool', stream: true, messages: [{ role: 'user', content: 'synthetic cancel' }] }),
  });
  const first = send(abort.signal).catch(() => undefined);
  try {
    await opened; abort.abort(); await first; await closed;
    await expect.poll(async () => (await send()).text()).toContain('RELAY_CLIENT_OK');
    expect(gateway.attempts).toHaveLength(2); // One cancelled owner, one explicit later request.
  } finally { abort.abort(); await gateway.close(); }
});
