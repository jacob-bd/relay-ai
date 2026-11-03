import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type ServerResponse } from 'node:http';
import { streamText } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { PoolAttemptError, runPoolAttempts, type PoolEvent, type PoolLimits, type PoolRoute } from '../src/pool/attempt.js';
import { writeAnthropicStream } from '../src/sdk-adapter.js';
const limits: PoolLimits = { attempts: 3, firstContentMs: 100, idleMs: 100, totalMs: 1000, bufferBytes: 4096, cleanupMs: 100 };
describe('production pool attempt limits', () => {
  it('rejects invalid budgets before opening any upstream', async () => {
    let opened = false;
    const route: PoolRoute = { id: 'account/model/rev', async open() { opened = true; return (async function* () {})(); } };
    for (const attempts of [0, -1, NaN, Infinity, 1.5]) {
      const iterator = runPoolAttempts([route], new AbortController().signal, { ...limits, attempts }, () => true);
      await expect(iterator.next()).rejects.toThrow('Invalid pool limit');
    }
    expect(opened).toBe(false);
  });
});

function streamOf(parts: PoolEvent[], onClose: () => void = () => {}): PoolRoute {
  return {
    id: 'upstream',
    async open() {
      return (async function* () { try { yield* parts; } finally { onClose(); } })();
    },
  };
}

const signal = () => new AbortController().signal;
const finish: PoolEvent = { type: 'finish', finishReason: 'stop' };

describe('downstream consumer failures are not provider failures', () => {
  it('rethrows the consumer error without onFailure, retry or fallback', async () => {
    const attempted: string[] = [];
    const failures: Array<[string, unknown, boolean]> = [];
    let closed = 0;
    const routes: PoolRoute[] = [
      streamOf([{ type: 'text-delta', text: 'partial' }, finish], () => { closed += 1; }),
      { id: 'second-provider', async open() { attempted.push('second-provider'); return (async function* () { yield finish; })(); } },
    ];
    const iterator = runPoolAttempts(routes, signal(), limits, () => true,
      id => attempted.push(id), (id, error, committed) => failures.push([id, error, committed]));
    expect((await iterator.next()).value).toEqual({ type: 'text-delta', text: 'partial' });
    const consumerError = new Error('client socket closed');
    await expect(iterator.throw(consumerError)).rejects.toBe(consumerError);
    expect(failures).toEqual([]);
    expect(attempted).toEqual(['upstream']);
    expect(closed).toBe(1);
  });

  it('keeps a completed attempt successful when the upstream will not close', async () => {
    const unclosable: PoolRoute = {
      id: 'uncooperative-close',
      async open() {
        let sent = false;
        const iterator: AsyncIterator<PoolEvent> = {
          next: async () => (sent ? { done: true, value: undefined } : (sent = true, { done: false, value: finish })),
          return: () => new Promise(() => {}),
        };
        return { [Symbol.asyncIterator]: () => iterator };
      },
    };
    const failures: unknown[] = [];
    const output: PoolEvent[] = [];
    for await (const part of runPoolAttempts([unclosable], signal(), { ...limits, cleanupMs: 20 }, () => true,
      () => {}, (_id, error) => failures.push(error))) output.push(part);
    expect(output).toEqual([finish]);
    expect(failures).toEqual([]);
  });

  it('still refuses fallback when an unfinished attempt cannot close', async () => {
    const unclosable: PoolRoute = {
      id: 'uncooperative-open',
      async open() {
        return { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}), return: () => new Promise(() => {}) }) };
      },
    };
    let openedSecond = false;
    const second: PoolRoute = { id: 'second', async open() { openedSecond = true; return (async function* () { yield finish; })(); } };
    const failure = await (async () => {
      for await (const _part of runPoolAttempts([unclosable, second], signal(), { ...limits, firstContentMs: 20, cleanupMs: 20 }, () => true)) { /* drain */ }
    })().catch(error => error);
    expect(failure).toBeInstanceOf(PoolAttemptError);
    expect(failure).toMatchObject({ code: 'cleanup-failed', committed: false });
    expect(failure.cause).toBeInstanceOf(Error);
    expect((failure.cause as Error).message).toContain('first-content-timeout');
    expect(openedSecond).toBe(false);
  });

  it('keeps a terminal provider failure when cleanup also fails', async () => {
    const providerError = new Error('invalid schema');
    const unclosable: PoolRoute = {
      id: 'terminal-error',
      async open() {
        let sent = false;
        const iterator: AsyncIterator<PoolEvent> = {
          next: async () => (sent ? { done: true, value: undefined } : (sent = true, { done: false, value: { type: 'error', error: providerError } })),
          return: () => new Promise(() => {}),
        };
        return { [Symbol.asyncIterator]: () => iterator };
      },
    };

    const failure = await (async () => {
      for await (const _part of runPoolAttempts([unclosable], signal(), { ...limits, cleanupMs: 20 }, () => false)) { /* drain */ }
    })().catch(error => error);

    expect(failure).toBeInstanceOf(PoolAttemptError);
    expect(failure).toMatchObject({ code: 'attempt-failed', committed: false });
    expect(failure.cause).toBe(providerError);
  });
});

const integrationLimits: PoolLimits = {
  attempts: 3, firstContentMs: 150, idleMs: 100, totalMs: 1000, bufferBytes: 8192, cleanupMs: 150,
};

describe('real SDK and loopback transport integration', () => {
  const seen: string[] = [];
  const closed = new Set<string>();
  let baseURL: string;
  const integrationSignal = () => new AbortController().signal;
  const integrationFinish: PoolEvent = { type: 'finish', finishReason: 'stop' };
  function chunk(res: ServerResponse, delta: unknown, finish_reason: string | null = null) {
    res.write('data: ' + JSON.stringify({
      id: 'test', object: 'chat.completion.chunk', created: 1, model: 'test',
      choices: [{ index: 0, delta, finish_reason }],
    }) + '\n\n');
  }
  const server = createServer((req, res) => {
    const mode = req.url!.split('/')[1];
    req.resume();
    req.once('end', () => {
      seen.push(mode);
      res.once('close', () => closed.add(mode));
      if (mode === 'rate') {
        res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '60' });
        res.end(JSON.stringify({ error: { message: 'rate limited', type: 'rate_limit_error' } }));
        return;
      }
      if (mode === 'hang') return;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      chunk(res, { role: 'assistant' });
      if (mode === 'start-hang') return;
      if (mode === 'broken') { res.end('data: {invalid json}\n\n'); return; }
      if (mode !== 'empty') chunk(res, { content: 'OK' });
      if (mode === 'text-hang') return;
      if (mode === 'text-error') { res.end('data: {invalid json}\n\n'); return; }
      chunk(res, {}, 'stop');
      res.end('data: [DONE]\n\n');
    });
  });
  beforeAll(async () => {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    baseURL = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  function route(mode: string): PoolRoute {
    return {
      id: mode + '::account-2::revision-1',
      async open(abortSignal) {
        const model = createOpenAICompatible({
          name: 'fake', apiKey: 'fake', baseURL: baseURL + '/' + mode + '/v1',
        }).chatModel('test');
        const result = streamText({ model, prompt: 'Reply OK', maxRetries: 0, abortSignal, onError: () => {} });
        return result.stream as AsyncIterable<PoolEvent>;
      },
    };
  }
  function events(parts: PoolEvent[], id = 'synthetic'): PoolRoute {
    return { id, async open() { return (async function* () { yield* parts; })(); } };
  }
  async function collect(
    routes: PoolRoute[], options = integrationLimits,
    abortSignal = integrationSignal(), retryable = () => true,
  ) {
    const output: PoolEvent[] = [];
    const attempts: string[] = [];
    let error: unknown;
    try {
      for await (const part of runPoolAttempts(routes, abortSignal, options, retryable,
        id => attempts.push(id))) output.push(part);
    } catch (caught) { error = caught; }
    return { output, attempts, error };
  }

  it('reproduces a synthetic SDK start before a real upstream 429 with retries disabled', async () => {
    const before = seen.filter(mode => mode === 'rate').length;
    const parts: PoolEvent[] = [];
    for await (const part of await route('rate').open(integrationSignal())) parts.push(part);
    expect(parts[0].type).toBe('start');
    expect(parts.some(part => part.type === 'error')).toBe(true);
    expect(seen.filter(mode => mode === 'rate').length - before).toBe(1);
  });

  it('discards failed starts and exposes one successful Anthropic message', async () => {
    const attempts: string[] = [];
    const output: string[] = [];
    await writeAnthropicStream(runPoolAttempts(
      [route('rate'), route('ok')], integrationSignal(), integrationLimits,
      () => true, id => attempts.push(id),
    ), 'pool', text => output.push(text));
    expect(attempts).toHaveLength(2);
    expect(output.filter(text => text.startsWith('event: message_start\n'))).toHaveLength(1);
    expect(output.join('')).toContain('OK');
    expect(output.join('')).not.toContain('rate limited');
    expect(output.filter(text => text.startsWith('event: message_stop\n'))).toHaveLength(1);
  });

  it('handles malformed pre-content errors without exposing failed framing', async () => {
    const result = await collect([route('broken'), route('ok')]);
    expect(result.error).toBeUndefined();
    expect(result.attempts).toHaveLength(2);
    expect(result.output.filter(part => part.type === 'start')).toHaveLength(1);
  });

  it.each(['text-error', 'text-hang'])('never replays after real upstream content: %s', async mode => {
    const result = await collect([route(mode), route('ok')]);
    expect(result.output.some(part => part.type === 'text-delta' && part.text === 'OK')).toBe(true);
    expect(result.attempts).toHaveLength(1);
    expect(result.error).toMatchObject({ committed: true });
  });

  it.each(['hang', 'start-hang'])('bounds first-content wait and aborts %s before fallback', async mode => {
    const started = Date.now();
    const result = await collect([route(mode), route('ok')]);
    expect(result.error).toBeUndefined();
    expect(result.attempts).toHaveLength(2);
    expect(Date.now() - started).toBeLessThan(1500);
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(closed.has(mode)).toBe(true);
  });

  it('cancels a hanging fetch without trying the next provider', async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('user-cancel')), 40);
    const result = await collect([route('hang'), route('ok')], integrationLimits, controller.signal);
    clearTimeout(timer);
    expect(result.error).toMatchObject({ message: 'user-cancel' });
    expect(result.attempts).toHaveLength(1);
    expect(result.output).toEqual([]);
  });

  it('commits a valid empty stop rather than fabricating a provider failure', async () => {
    const result = await collect([route('empty'), route('ok')]);
    expect(result.error).toBeUndefined();
    expect(result.attempts).toHaveLength(1);
    expect(result.output.at(-1)).toMatchObject({ type: 'finish', finishReason: 'stop' });
  });

  it.each([
    { type: 'reasoning-delta', text: 'thinking' },
    { type: 'tool-input-start', id: 'call', toolName: 'read' },
    { type: 'tool-input-delta', delta: '{' },
    { type: 'tool-call', toolCallId: 'call', input: {} },
  ])('never retries after exposing $type', async content => {
    const result = await collect([
      events([{ type: 'start' }, content, { type: 'error', error: new Error('late') }]), route('ok'),
    ]);
    expect(result.attempts).toHaveLength(1);
    expect(result.error).toMatchObject({ committed: true });
  });

  it('rejects a stream that ends without a valid terminal event before commitment', async () => {
    const result = await collect([events([{ type: 'start' }]), events([integrationFinish], 'backup')]);
    expect(result.error).toBeUndefined();
    expect(result.attempts).toEqual(['synthetic', 'backup']);
    expect(result.output).toEqual([integrationFinish]);
  });

  it('bounds provisional bytes without exposing an oversized event', async () => {
    const result = await collect([
      events([{ type: 'start', padding: 'x'.repeat(1000) }]), events([integrationFinish], 'backup'),
    ], { ...integrationLimits, bufferBytes: 100 });
    expect(result.output).toEqual([integrationFinish]);
    expect(result.attempts).toHaveLength(2);
  });

  it('stops shared-schema failures without blind retries', async () => {
    const result = await collect([
      events([{ type: 'error', error: new Error('invalid schema') }]), route('ok'),
    ], integrationLimits, integrationSignal(), () => false);
    expect(result.attempts).toHaveLength(1);
    expect(result.error).toMatchObject({ committed: false });
  });

  it('bounds attempt count independently of membership size', async () => {
    const result = await collect(
      Array.from({ length: 20 }, (_, index) =>
        events([{ type: 'error', error: new Error('offline') }], String(index))),
      { ...integrationLimits, attempts: 2 },
    );
    expect(result.attempts).toEqual(['0', '1']);
    expect(result.error).toMatchObject({ code: 'attempt-budget-exhausted' });
  });

  it('total deadline prevents another attempt after the first consumes the budget', async () => {
    const result = await collect([route('hang'), route('ok')], { ...integrationLimits, totalMs: 40 });
    expect(result.attempts).toHaveLength(1);
    expect(result.error).toMatchObject({ code: 'total-deadline' });
  });

  it('refuses overlapping fallback if an iterator ignores abort and cannot close', async () => {
    const stuck: PoolRoute = { id: 'uncooperative', async open() {
      return { [Symbol.asyncIterator]() { return { next: () => new Promise(() => {}), return: () => new Promise(() => {}) }; } };
    } };
    const result = await collect([stuck, route('ok')], {
      ...integrationLimits, firstContentMs: 20, cleanupMs: 20,
    });
    expect(result.attempts).toHaveLength(1);
    expect(result.error).toMatchObject({ code: 'cleanup-failed' });
  });

  it('keeps completed request bodies alive but cancels abandoned responses', async () => {
    const outcomes: Array<{ aborted: boolean; attempts: number }> = [];
    let started!: () => void;
    let finished!: () => void;
    let startedPromise = new Promise<void>(resolve => { started = resolve; });
    let finishedPromise = new Promise<void>(resolve => { finished = resolve; });
    const gateway = createServer((req, res) => {
      const controller = new AbortController();
      res.once('close', () => { if (!res.writableFinished) controller.abort(new Error('disconnect')); });
      req.resume();
      req.once('end', () => {
        const upstream: PoolRoute = { id: 'delayed', async open(abortSignal) {
          return (async function* () {
            yield { type: 'start' };
            started();
            await new Promise<void>((resolve, reject) => {
              const timer = setTimeout(resolve, 40);
              abortSignal.addEventListener('abort', () => {
                clearTimeout(timer); reject(abortSignal.reason);
              }, { once: true });
            });
            yield { type: 'text-delta', text: 'OK' };
            yield integrationFinish;
          })();
        } };
        void (async () => {
          const result = await collect([upstream, route('ok')], integrationLimits, controller.signal);
          outcomes.push({ aborted: controller.signal.aborted, attempts: result.attempts.length });
          if (!res.destroyed) res.end(result.error ? 'error' : 'OK');
          finished();
        })();
      });
    });
    await new Promise<void>(resolve => gateway.listen(0, '127.0.0.1', resolve));
    const url = 'http://127.0.0.1:' + (gateway.address() as { port: number }).port;
    try {
      const normal = await fetch(url, { method: 'POST', body: '{}' });
      expect(await normal.text()).toBe('OK');
      await finishedPromise;
      expect(outcomes[0]).toEqual({ aborted: false, attempts: 1 });
      startedPromise = new Promise<void>(resolve => { started = resolve; });
      finishedPromise = new Promise<void>(resolve => { finished = resolve; });
      const client = new AbortController();
      const abandoned = fetch(url, { method: 'POST', body: '{}', signal: client.signal }).catch(() => undefined);
      await startedPromise;
      client.abort();
      await abandoned;
      await finishedPromise;
      expect(outcomes[1]).toEqual({ aborted: true, attempts: 1 });
    } finally {
      gateway.closeAllConnections();
      await new Promise<void>(resolve => gateway.close(() => resolve()));
    }
  });

  it('first-content deadline also bounds continuous provisional events', async () => {
    const busy: PoolRoute = { id: 'heartbeats', async open() {
      return (async function* () { while (true) yield { type: 'heartbeat' }; })();
    } };
    const result = await collect([busy, events([integrationFinish], 'backup')], {
      ...integrationLimits, firstContentMs: 10, bufferBytes: 100_000_000,
    });
    expect(result.attempts).toEqual(['heartbeats', 'backup']);
    expect(result.output).toEqual([integrationFinish]);
  });

  it('consumer failure closes the attempt without replaying another account', async () => {
    const attempts: string[] = [];
    let aborted = false;
    const upstream: PoolRoute = { id: 'account-1', async open(abortSignal) {
      abortSignal.addEventListener('abort', () => { aborted = true; });
      return (async function* () {
        yield { type: 'start' };
        yield { type: 'text-delta', text: 'hello' };
        yield integrationFinish;
      })();
    } };
    const operation = async () => {
      for await (const _part of runPoolAttempts(
        [upstream, route('ok')], integrationSignal(), integrationLimits,
        () => true, id => attempts.push(id),
      )) throw new Error('socket write failed');
    };
    await expect(operation()).rejects.toThrow('socket write failed');
    expect(attempts).toEqual(['account-1']);
    expect(aborted).toBe(true);
  });
});
