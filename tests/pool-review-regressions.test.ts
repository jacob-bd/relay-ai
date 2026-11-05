import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { dispatchFreePool, type DispatchRoute } from '../src/pool/dispatch.js';
import { retryPoolFailure } from '../src/pool/errors.js';
import { runPoolAttempts, type PoolEvent, type PoolLimits } from '../src/pool/attempt.js';
import { PoolHealthStore, poolModelScope } from '../src/pool/health.js';
import { sdkPoolRoute } from '../src/pool/sdk-route.js';
import { writeCodexPoolResponse } from '../src/pool/codex-response.js';
import { CodexPoolRuntime, FREE_POOL_MODEL_ID, type CodexPoolRoute } from '../src/pool/codex-runtime.js';
import { prepareClaudePoolRoutes } from '../src/pool/claude-prepare.js';
import { poolEndpointRevision, type PoolCapabilityReceipt } from '../src/pool/capabilities.js';
import type { LocalProvider } from '../src/types.js';

const limits: PoolLimits = {
  attempts: 3, firstContentMs: 100, idleMs: 100, totalMs: 2000, bufferBytes: 65_536, cleanupMs: 100,
};
const evidence = (providerId: string, modelId = 'm') => ({
  member: { providerId, modelId }, revision: 'rev-1', freeStatus: 'verified_free' as const,
  catalogVerified: true, accessVerified: true, billingSafe: true, targets: ['codex'] as const,
  toolsVerified: true, defaultEffortVerified: true, effortLevels: ['high'], contextFits: true, contextVerified: true,
});
const openOrder: string[] = [];
const okEvents: PoolEvent[] = [
  { type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', text: 'OK' },
  { type: 'text-end', id: 't' }, { type: 'finish', finishReason: 'stop' },
];
function dispatchRoute(providerId: string, events: PoolEvent[] | Error): DispatchRoute {
  return {
    ...evidence(providerId),
    async open() {
      openOrder.push(providerId);
      if (events instanceof Error) throw events;
      return (async function* () { yield* events; })();
    },
  };
}
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
});

describe('Codex pool post-byte failover', () => {
  it('must not emit response.created before the pool has selected an answering member', async () => {
    openOrder.length = 0;
    const first = dispatchRoute('account-a', new Error('connection reset before first event'));
    const second = dispatchRoute('account-b', okEvents);
    let opensAtFirstWrite = -1;
    const chunks: string[] = [];
    const response = await writeCodexPoolResponse(
      dispatchFreePool(
        { members: [first.member, second.member], effort: 'auto' },
        [first, second],
        { target: 'codex', tools: false, signal: new AbortController().signal },
        { limits, retryable: retryPoolFailure },
      ),
      FREE_POOL_MODEL_ID,
      chunk => { if (opensAtFirstWrite < 0) opensAtFirstWrite = openOrder.length; chunks.push(chunk); },
    );
    expect(openOrder).toEqual(['account-a', 'account-b']);
    expect(response.status).toBe('completed');
    expect(opensAtFirstWrite).toBe(2);
  });
});

describe('Claude pool tool cap', () => {
  it('must cap Claude tools at the same 128-tool provider limit as Codex', async () => {
    const captured: number[] = [];
    const server = createServer((req, res) => {
      let raw = '';
      req.on('data', chunk => { raw += String(chunk); });
      req.on('end', () => {
        const body = JSON.parse(raw) as { tools?: unknown[] };
        captured.push(body.tools?.length ?? 0);
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('data: ' + JSON.stringify({ id: 'f', object: 'chat.completion.chunk', created: 1, model: 'm',
          choices: [{ index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: null }] }) + '\n\n');
        res.write('data: ' + JSON.stringify({ id: 'f', object: 'chat.completion.chunk', created: 1, model: 'm',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\n');
        res.end('data: [DONE]\n\n');
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const baseURL = 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/v1';
    const root = mkdtempSync(join(tmpdir(), 'relay-pool-review-tools-'));
    roots.push(root);
    try {
      const provider: LocalProvider = {
        id: 'claude-account', name: 'Claude Account', apiKey: 'fake',
        models: [{ id: 'm', name: 'm', family: '', brand: '', modelFormat: 'openai', upstreamModelId: 'm',
          npm: '@ai-sdk/openai-compatible', apiBaseUrl: baseURL, contextWindow: 128_000,
          cost: { input: 0, output: 0 } }],
      };
      const member = { providerId: provider.id, modelId: 'm' };
      const receipt: PoolCapabilityReceipt = {
        member, endpointRevision: poolEndpointRevision({ providerId: provider.id, npm: provider.models[0]!.npm!,
          baseURL, upstreamModelId: 'm' }), verifiedAt: Date.now() - 1000, expiresAt: Date.now() + 60_000,
        targets: ['claude'], tools: true, maxOutputTokens: 4096, contextWindow: 128_000,
        contextSource: 'provider', reasoningAccounting: 'inside-output', effortLevels: [], billingSafe: true,
      };
      const tools = Array.from({ length: 300 }, (_, i) => ({
        name: 'tool_' + i, description: '', input_schema: { type: 'object', properties: {} },
      }));
      const health = new PoolHealthStore({ root });
      const routes = await prepareClaudePoolRoutes({
        pool: { members: [member], effort: 'auto', receipts: [] }, providers: [provider], receipts: [receipt],
        body: { model: 'claude-pool', max_tokens: 128, messages: [{ role: 'user', content: 'hi' }], tools },
        signal: new AbortController().signal, health,
      });
      expect(routes).toHaveLength(1);
      expect(await routes[0]!.admit?.(new AbortController().signal)).toBeUndefined();
      const stream = await routes[0]!.open(new AbortController().signal);
      for await (const _part of stream) { /* drain */ }
      expect(captured).toEqual([128]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});

describe('recovery cooldown precedence', () => {
  it('must not erase a newer authoritative Retry-After when the recovery reports success', async () => {
    const root = mkdtempSync(join(tmpdir(), 'relay-pool-review-health-'));
    roots.push(root);
    let clock = 1_800_000_000_000;
    const store = new PoolHealthStore({ root, now: () => clock });
    const scopes = [poolModelScope('acct', 'm')];
    const target = { id: 'rev', scopes };
    await store.record(scopes, { kind: 'rate-limit', status: 429, retryAt: clock + 120_000 });
    clock += 120_000;
    const claim = await store.acquire(target);
    if (!claim.ok) throw new Error('expected recovery claim');
    const newer = clock + 86_400_000;
    await store.record(scopes, { kind: 'rate-limit', status: 429, retryAt: newer });
    await claim.settle(true);
    expect(await store.cooldownFor(target)).toBe(newer);
  });
});

describe('post-terminal continuation persistence', () => {
  it('must not emit response.completed when an oversized history is rejected', async () => {
    const member = { providerId: 'account', modelId: 'm' };
    const route: CodexPoolRoute = {
      ...evidence('account'), member, identity: { account: 'account', endpointRevision: 'rev-1', model: 'm' },
      async open() { return (async function* () {
        yield { type: 'text-start', id: 't' } as PoolEvent;
        yield { type: 'text-delta', id: 't', text: 'OK' } as PoolEvent;
        yield { type: 'text-end', id: 't' } as PoolEvent;
        yield { type: 'finish', finishReason: 'stop' } as PoolEvent;
      })(); },
    };
    const runtime = new CodexPoolRuntime({ members: [member], effort: 'auto', receipts: [] }, async () => [route], limits);
    const headers = { 'x-codex-turn-metadata': JSON.stringify({ session_id: 's', thread_id: 't', turn_id: 'turn-1' }) };
    const body = {
      model: FREE_POOL_MODEL_ID, stream: true,
      input: Array.from({ length: 2000 }, (_, i) => ({ type: 'message', role: 'user', content: 'm' + i })),
    };
    const chunks: string[] = [];
    await expect(runtime.respond(headers, body, new AbortController().signal, chunk => chunks.push(chunk)))
      .rejects.toThrow('continuation-history-too-large');
    expect(chunks.join('')).not.toContain('event: response.completed');
  });
});

describe('timeout persistence', () => {
  it.each(['first', 'idle'])('cools a member after its own %s timeout', async mode => {
    const root = mkdtempSync(join(tmpdir(), 'relay-pool-review-timeout-'));
    roots.push(root);
    const server = createServer((req, res) => {
      req.resume();
      if (mode === 'idle') req.once('end', () => {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('data: ' + JSON.stringify({ id: 'f', object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: { role: 'assistant', content: 'hello' }, finish_reason: null }] }) + '\n\n');
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const baseURL = 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/v1';
    try {
      const clock = 1_800_000_000_000;
      const store = new PoolHealthStore({ root, now: () => clock });
      const scopes = [poolModelScope('acct', 'm')];
      const model = createOpenAICompatible({ name: 'a', apiKey: 'fake', baseURL }).chatModel('m');
      const route = sdkPoolRoute(evidence('acct'), model, {
        messages: [{ role: 'user', content: 'hi' }], maxOutputTokens: 32,
      }, { store, scopes });
      const failure = await (async () => {
        for await (const _part of runPoolAttempts([route], new AbortController().signal,
          { ...limits, attempts: 1, firstContentMs: mode === 'first' ? 50 : 500, idleMs: 50, totalMs: 1000 }, retryPoolFailure)) { /* drain */ }
      })().catch(error => error);
      expect(String(failure?.cause?.message ?? failure?.message)).toContain(mode === 'first' ? 'first-content-timeout' : 'idle-or-total-timeout');
      expect(await store.cooldownFor({ id: 'rev', scopes })).toBeGreaterThan(clock);
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});

describe('recovery terminal validation', () => {
  it('keeps a rejected SDK finish unhealthy and records the coordinator failure', async () => {
    const root = mkdtempSync(join(tmpdir(), 'relay-pool-review-invalid-finish-'));
    roots.push(root);
    let clock = 1_800_000_000_000;
    const store = new PoolHealthStore({ root, now: () => clock });
    const scopes = [poolModelScope('acct', 'm')];
    await store.record(scopes, { kind: 'rate-limit' });
    clock += 120_000;
    const server = createServer((req, res) => {
      req.resume();
      req.once('end', () => {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('data: ' + JSON.stringify({ id: 'f', object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: {}, finish_reason: 'unrecognized' }] }) + '\n\n');
        res.end('data: [DONE]\n\n');
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const model = createOpenAICompatible({ name: 'fixture', apiKey: 'fake',
        baseURL: 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/v1' }).chatModel('m');
      const route = sdkPoolRoute(evidence('acct'), model, {
        messages: [{ role: 'user', content: 'hi' }], maxOutputTokens: 32,
      }, { store, scopes });
      const fallback = dispatchRoute('fallback', okEvents);
      const output: PoolEvent[] = [];
      for await (const part of dispatchFreePool({ members: [route.member, fallback.member], effort: 'auto' }, [route, fallback],
        { target: 'codex', tools: false, signal: new AbortController().signal },
        { limits: { ...limits, firstContentMs: 1000 }, retryable: retryPoolFailure })) output.push(part);
      expect(output.some(part => part.text === 'OK')).toBe(true);
      expect(await store.cooldownFor({ id: 'rev', scopes })).toBeGreaterThan(clock);
      expect((await store.inspect({ id: 'rev', scopes }))[0]).toMatchObject({ recovering: false, reason: 'transient' });
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
