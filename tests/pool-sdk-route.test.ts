import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { tool, jsonSchema, type LanguageModel } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { sdkPoolRoute } from '../src/pool/sdk-route.js';
import type { PoolRouteEvidence } from '../src/pool/eligibility.js';
import { runPoolAttempts, type PoolEvent, type PoolLimits } from '../src/pool/attempt.js';
import { PoolHealthStore, poolModelScope } from '../src/pool/health.js';
import { poolFailure, retryPoolFailure } from '../src/pool/errors.js';
const evidence: PoolRouteEvidence = {
  member: { providerId: 'account-2', modelId: 'm' }, revision: '1', freeStatus: 'verified_free',
  catalogVerified: true, accessVerified: true, billingSafe: true, targets: ['codex'],
  toolsVerified: true, defaultEffortVerified: true, effortLevels: ['high'], contextFits: true, contextVerified: true,
};
let root: string;
let clock: number;
const now = () => clock;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'relay-pool-sdk-'));
  clock = 1_800_000_000_000;
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
});

describe('pool SDK transport', () => {
  it('requires explicit output reservation before opening a model', () => {
    expect(() => sdkPoolRoute(evidence, {} as LanguageModel, { messages: [], maxOutputTokens: 0 })).toThrow('bounded output');
  });
  it('refuses tools with execute handlers so Relay cannot run a second tool loop', () => {
    expect(() => sdkPoolRoute(evidence, {} as LanguageModel, {
      messages: [], maxOutputTokens: 128,
      tools: { dangerous: tool({ inputSchema: jsonSchema({ type: 'object' }), execute: async () => 'executed' }) },
    })).toThrow('must not execute');
  });

  it('classifies a synchronous SDK failure and records its rate limit', async () => {
    const syncError = Object.assign(new Error('synchronous quota failure'), { statusCode: 429 });
    const model = new Proxy({}, { get() { throw syncError; } }) as LanguageModel;
    const scopes = [poolModelScope('account-2', 'm')];
    const store = new PoolHealthStore({ root, now });
    await store.record(scopes, poolFailure(syncError, clock));
    clock += 2 * 60_000;

    const route = sdkPoolRoute(evidence, model, { messages: [], maxOutputTokens: 128 }, { store, scopes });
    const failures: unknown[] = [];
    const limits: PoolLimits = {
      attempts: 1, firstContentMs: 100, idleMs: 100, totalMs: 500, bufferBytes: 4096, cleanupMs: 100,
    };
    const failure = await (async () => {
      for await (const _part of runPoolAttempts([route], new AbortController().signal, limits, retryPoolFailure,
        () => {}, (_id, error) => { failures.push(error); })) { /* drain */ }
    })().catch(error => error);

    expect(failures).toEqual([syncError]);
    expect(failure).toMatchObject({ code: 'attempt-budget-exhausted' });
    expect(failure.cause).toBe(syncError);
    await expect(store.acquire({ id: evidence.revision, scopes })).resolves.toMatchObject({ ok: false, reason: 'cooldown' });
  });

  it('records a real installed-SDK 429 and cools only that account', async () => {
    const server = createServer((req, res) => {
      req.resume();
      req.once('end', () => {
        if (req.url?.startsWith('/a/')) {
          res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '60' });
          res.end(JSON.stringify({ error: { message: 'quota' } }));
          return;
        }
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: null }] }) + '\n\n');
        res.write('data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\n');
        res.end('data: [DONE]\n\n');
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const baseURL = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
    try {
      // Retry-After seconds are resolved by the real SDK transport clock.
      const store = new PoolHealthStore({ root });
      const accountA = [poolModelScope('account-a', 'm')];
      const accountB = [poolModelScope('account-b', 'm')];
      const model = (account: string) => createOpenAICompatible({
        name: account, apiKey: 'fixture', baseURL: baseURL + '/' + account + '/v1',
      }).chatModel('m');
      const routes = [
        sdkPoolRoute({ ...evidence, member: { providerId: 'account-a', modelId: 'm' }, revision: 'a' },
          model('a'), { messages: [{ role: 'user', content: 'hello' }], maxOutputTokens: 32 }, { store, scopes: accountA }),
        sdkPoolRoute({ ...evidence, member: { providerId: 'account-b', modelId: 'm' }, revision: 'b' },
          model('b'), { messages: [{ role: 'user', content: 'hello' }], maxOutputTokens: 32 }, { store, scopes: accountB }),
      ];
      const limits: PoolLimits = { attempts: 2, firstContentMs: 1000, idleMs: 1000, totalMs: 3000, bufferBytes: 8192, cleanupMs: 100 };
      const output: PoolEvent[] = [];
      for await (const part of runPoolAttempts(routes, new AbortController().signal, limits, retryPoolFailure)) {
        output.push(part);
      }
      expect(output.some(part => part.type === 'text-delta' && part.text === 'OK')).toBe(true);
      await expect(store.acquire({ id: 'a', scopes: accountA })).resolves.toMatchObject({ ok: false, reason: 'cooldown' });
      await expect(store.acquire({ id: 'b', scopes: accountB })).resolves.toMatchObject({ ok: true });
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
