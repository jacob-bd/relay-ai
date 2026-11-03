// End-to-end pool path over real HTTP and the installed SDK: production
// sdkPoolRoute + dispatchFreePool + writeCodexPoolResponse. No credentials.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type ServerResponse } from 'node:http';
import { tool, jsonSchema, type ToolSet } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { dispatchFreePool } from '../src/pool/dispatch.js';
import { sdkPoolRoute } from '../src/pool/sdk-route.js';
import { writeCodexPoolResponse } from '../src/pool/codex-response.js';
import { poolFailure, retryPoolFailure } from '../src/pool/errors.js';
import type { PoolLimits } from '../src/pool/attempt.js';
import type { PoolRouteEvidence } from '../src/pool/eligibility.js';

const limits: PoolLimits = {
  attempts: 3, firstContentMs: 3000, idleMs: 1000, totalMs: 20_000, bufferBytes: 65_536, cleanupMs: 1000,
};
const requests: string[] = [];
const toolExecutions: string[] = [];
let baseURL = '';

function chunk(res: ServerResponse, delta: unknown, finishReason: string | null = null) {
  res.write('data: ' + JSON.stringify({
    id: 'fake', object: 'chat.completion.chunk', created: 1, model: 'test',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  }) + String.fromCharCode(10, 10));
}

const server = createServer((req, res) => {
  const mode = req.url!.split('/')[1]!;
  requests.push(mode);
  req.resume();
  req.once('end', () => {
    if (mode === 'rate') {
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '60' });
      res.end(JSON.stringify({ error: { message: 'rate limited', type: 'rate_limit_error' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (mode === 'ok') {
      chunk(res, { role: 'assistant' });
      chunk(res, { content: 'OK' });
      chunk(res, {}, 'stop');
      res.end('data: [DONE]' + String.fromCharCode(10, 10));
      return;
    }
    if (mode === 'tool') {
      chunk(res, { role: 'assistant' });
      chunk(res, {
        tool_calls: [{
          index: 0, id: 'call_probe', type: 'function',
          function: { name: 'relay_probe', arguments: '{"value":"ok"}' },
        }],
      });
      chunk(res, {}, 'tool_calls');
      res.end('data: [DONE]' + String.fromCharCode(10, 10));
      return;
    }
    if (mode === 'broken') {
      // Committed text, then a real upstream error event: no replay is allowed.
      chunk(res, { content: 'partial' });
      res.write('data: ' + JSON.stringify({ error: { message: 'upstream crashed', type: 'server_error' } }) + String.fromCharCode(10, 10));
      res.end();
      return;
    }
    // 'slow': commit content, then hold the connection open until cleanup aborts it.
    chunk(res, { content: 'partial' });
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
beforeEach(() => { requests.length = 0; });

function evidence(account: string): PoolRouteEvidence {
  return {
    member: { providerId: account, modelId: 'free-model' },
    revision: 'rev-1', freeStatus: 'verified_free', catalogVerified: true,
    accessVerified: true, billingSafe: true, targets: ['codex'], toolsVerified: true,
    defaultEffortVerified: true, effortLevels: ['high'], contextFits: true, contextVerified: true,
  };
}

function routeFor(mode: string, tools?: ToolSet) {
  const model = createOpenAICompatible({
    name: mode, apiKey: 'fake', baseURL: baseURL + '/' + mode + '/v1',
  }).chatModel('test');
  return sdkPoolRoute(evidence('account-' + mode), model, {
    messages: [{ role: 'user', content: 'Reply OK' }],
    maxOutputTokens: 256,
    ...(tools ? { tools } : {}),
  });
}

const abortSignal = () => new AbortController().signal;

describe('pool dispatch over real SDK and fake HTTP upstreams', () => {
  it('fails over from a real 429 to a healthy account and formats one Codex response', async () => {
    const rate = routeFor('rate');
    const ok = routeFor('ok');
    const failures: Array<{ id: string; committed: boolean; kind: string; retryAt?: number }> = [];
    const chunks: string[] = [];
    const before = Date.now();
    const response = await writeCodexPoolResponse(
      dispatchFreePool(
        { members: [rate.member, ok.member], effort: 'high' },
        [rate, ok],
        { target: 'codex', tools: false, signal: abortSignal() },
        {
          limits, retryable: retryPoolFailure,
          onFailure: (id, error, committed) => {
            failures.push({ id, committed, kind: poolFailure(error).kind, retryAt: poolFailure(error).retryAt });
          },
        },
      ),
      'relay-pool',
      chunk => chunks.push(chunk),
    );

    expect(requests).toEqual(['rate', 'ok']);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ id: JSON.stringify(['account-rate', 'rev-1', 'free-model']), committed: false, kind: 'rate-limit' });
    expect(failures[0]!.retryAt).toBeGreaterThanOrEqual(before + 59_000);
    expect(response.status).toBe('completed');
    const output = chunks.join('');
    expect(output.match(/event: response.created/g)).toHaveLength(1);
    expect(output.match(/event: response.output_text.delta/g)).toHaveLength(1);
    expect(output).toContain('"delta":"OK"');
    expect(output).toContain('event: response.completed');
    expect(output).not.toContain('rate limited');
    expect(output).not.toContain('response.failed');
  });

  it('returns a tool call for the client to execute and never executes it in Relay', async () => {
    const definitions: ToolSet = {
      relay_probe: tool({
        description: 'probe',
        inputSchema: jsonSchema({
          type: 'object', properties: { value: { type: 'string' } }, required: ['value'],
        }),
        execute: async () => { toolExecutions.push('relay_probe'); return 'ran'; },
      }),
    };
    // Relay refuses any tool that would execute inside its own loop.
    expect(() => routeFor('tool', definitions)).toThrow('must not execute');
    expect(toolExecutions).toEqual([]);

    const executableFree: ToolSet = {
      relay_probe: tool({
        description: 'probe',
        inputSchema: jsonSchema({
          type: 'object', properties: { value: { type: 'string' } }, required: ['value'],
        }),
      }),
    };
    const route = routeFor('tool', executableFree);
    const chunks: string[] = [];
    const response = await writeCodexPoolResponse(
      dispatchFreePool(
        { members: [route.member], effort: 'high' },
        [route],
        { target: 'codex', tools: true, signal: abortSignal() },
        { limits, retryable: retryPoolFailure },
      ),
      'relay-pool',
      chunk => chunks.push(chunk),
    );

    const output = chunks.join('');
    expect(requests).toEqual(['tool']);
    expect(toolExecutions).toEqual([]);
    expect(output).toContain('"type":"function_call"');
    expect(output).toContain('"name":"relay_probe"');
    expect(output).toContain('event: response.function_call_arguments.done');
    expect(output).not.toContain('function_call_output');
    expect(response.status).toBe('completed');
    expect(JSON.stringify(response.output)).toContain('relay_probe');
  });

  it('does not replay a committed response into another account after a broken stream', async () => {
    const broken = routeFor('broken');
    const ok = routeFor('ok');
    const chunks: string[] = [];
    await expect(writeCodexPoolResponse(
      dispatchFreePool(
        { members: [broken.member, ok.member], effort: 'high' },
        [broken, ok],
        { target: 'codex', tools: false, signal: abortSignal() },
        { limits, retryable: retryPoolFailure },
      ),
      'relay-pool',
      chunk => chunks.push(chunk),
    )).rejects.toThrow();
    expect(requests).toEqual(['broken']);
    expect(chunks.join('')).toContain('partial');
  });

  it('stops without another provider call when the consumer abandons the stream', async () => {
    const slow = routeFor('slow');
    const ok = routeFor('ok');
    const stream = dispatchFreePool(
      { members: [slow.member, ok.member], effort: 'high' },
      [slow, ok],
      { target: 'codex', tools: false, signal: abortSignal() },
      { limits, retryable: retryPoolFailure },
    );
    const iterator = stream[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.done).toBe(false);
    await iterator.return?.(undefined);
    expect(requests).toEqual(['slow']);
  });

  it('propagates cancellation and never falls back to a second provider', async () => {
    const slow = routeFor('slow');
    const ok = routeFor('ok');
    const controller = new AbortController();
    const iterator = dispatchFreePool(
      { members: [slow.member, ok.member], effort: 'high' },
      [slow, ok],
      { target: 'codex', tools: false, signal: controller.signal },
      { limits, retryable: retryPoolFailure },
    )[Symbol.asyncIterator]();
    await iterator.next();
    controller.abort(new Error('client canceled'));
    await expect(iterator.next()).rejects.toThrow('client canceled');
    expect(requests).toEqual(['slow']);
  }, 20_000);
});
