import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LanguageModel } from 'ai';
import { encodeToolUseId } from '../src/proxy-shared.js';
import { PoolContinuationStore, preparePoolHistory } from '../src/pool/continuation.js';
import { prepareCodexPoolRoutes } from '../src/pool/codex-prepare.js';
import { prepareClaudePoolRoutes } from '../src/pool/claude-prepare.js';
import { poolEndpointRevision, type PoolCapabilityReceipt } from '../src/pool/capabilities.js';
import { poolFailure, retryPoolFailure } from '../src/pool/errors.js';
import { PoolHealthStore, poolAccountScope, poolModelScope } from '../src/pool/health.js';
import { runPoolAttempts } from '../src/pool/attempt.js';
import * as sdkRoutes from '../src/pool/sdk-route.js';
import { sdkPoolRoute } from '../src/pool/sdk-route.js';
import type { LocalProvider } from '../src/types.js';

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
});

const model = {
  id: 'm', name: 'm', family: '', brand: '', modelFormat: 'openai' as const,
  upstreamModelId: 'm', npm: '@ai-sdk/openai-compatible', cost: { input: 0, output: 0 },
};
const provider = (baseURL: string): LocalProvider => ({
  id: 'account', name: 'Account', apiKey: 'fake', models: [{ ...model, apiBaseUrl: baseURL }],
});
const receipt = (providerValue: LocalProvider, target: 'codex' | 'claude'): PoolCapabilityReceipt => ({
  member: { providerId: providerValue.id, modelId: 'm' },
  endpointRevision: poolEndpointRevision({
    providerId: providerValue.id, npm: providerValue.models[0]!.npm!,
    baseURL: providerValue.models[0]!.apiBaseUrl, upstreamModelId: 'm',
  }),
  verifiedAt: Date.now() - 1000, expiresAt: Date.now() + 60_000,
  targets: [target], tools: true, maxOutputTokens: 8192, contextWindow: 128_000,
  contextSource: 'provider', reasoningAccounting: 'inside-output', effortLevels: [], billingSafe: true,
});
async function fixture() {
  const bodies: Array<Record<string, unknown>> = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += String(chunk); });
    req.on('end', () => {
      bodies.push(JSON.parse(raw) as Record<string, unknown>);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: ' + JSON.stringify({ id: 'f', object: 'chat.completion.chunk', created: 1, model: 'm',
        choices: [{ index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: null }] }) + '\n\n');
      res.write('data: ' + JSON.stringify({ id: 'f', object: 'chat.completion.chunk', created: 1, model: 'm',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\n');
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    bodies,
    baseURL: 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/v1',
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}
async function drain(route: Awaited<ReturnType<typeof prepareClaudePoolRoutes>>[number]) {
  const stream = await route.open(new AbortController().signal);
  for await (const _part of stream) { /* drain */ }
}
const noHealth = () => ({
  cooldownFor: async () => undefined,
  disabledFor: async () => undefined,
  acquire: async () => ({ ok: true, mode: 'normal', settle: async () => {}, release: async () => {} }),
}) as unknown as PoolHealthStore;

describe('round-two route regressions', () => {
  it('passes a forced Claude tool choice through real preparation instead of auto', async () => {
    const upstream = await fixture();
    try {
      const account = provider(upstream.baseURL);
      const routes = await prepareClaudePoolRoutes({
        pool: { members: [{ providerId: 'account', modelId: 'm' }], effort: 'auto', receipts: [] },
        providers: [account], receipts: [receipt(account, 'claude')],
        body: {
          model: 'claude-pool', max_tokens: 128,
          messages: [{ role: 'user', content: 'use read' }],
          tools: [{ name: 'read', description: '', input_schema: { type: 'object', properties: {} } }],
          tool_choice: { type: 'tool', name: 'read' },
        },
        signal: new AbortController().signal,
        health: noHealth(),
      });
      expect(routes).toHaveLength(1);
      await drain(routes[0]!);
      expect(JSON.stringify(upstream.bodies[0]?.tool_choice)).toContain('read');
      expect(upstream.bodies[0]?.tool_choice).not.toBe('auto');
    } finally {
      await upstream.close();
    }
  });

  it('passes a forced Codex tool choice through real preparation', async () => {
    const upstream = await fixture();
    try {
      const account = provider(upstream.baseURL);
      const routes = await prepareCodexPoolRoutes({
        pool: { members: [{ providerId: account.id, modelId: 'm' }], effort: 'auto', receipts: [] },
        providers: [account], receipts: [receipt(account, 'codex')],
        body: { model: 'relay-free-pool', input: 'use read',
          tools: [{ type: 'function', name: 'read', parameters: { type: 'object', properties: {} } }],
          tool_choice: { type: 'function', name: 'read' } },
        signal: new AbortController().signal, health: noHealth(),
      });
      expect(routes).toHaveLength(1);
      await drain(routes[0]!);
      expect(upstream.bodies[0]?.tool_choice).toEqual({ type: 'function', function: { name: 'read' } });
    } finally { await upstream.close(); }
  });

  it('strips foreign thinking and tool signatures from Claude pool history', async () => {
    const upstream = await fixture();
    try {
      const account = provider(upstream.baseURL);
      const captured = vi.spyOn(sdkRoutes, 'sdkPoolRoute');
      const encoded = encodeToolUseId('call-1', 'foreign-tool-signature', true);
      const routes = await prepareClaudePoolRoutes({
        pool: { members: [{ providerId: 'account', modelId: 'm' }], effort: 'auto', receipts: [] },
        providers: [account], receipts: [receipt(account, 'claude')],
        body: {
          model: 'claude-pool', max_tokens: 128,
          messages: [
            { role: 'user', content: 'start' },
            { role: 'assistant', content: [
              { type: 'thinking', thinking: 'private reasoning', signature: 'foreign-thinking-signature' },
              { type: 'tool_use', id: encoded, name: 'read', input: {} },
            ] },
            { role: 'user', content: [{ type: 'tool_result', tool_use_id: encoded, content: 'ok' }] },
          ],
        },
        signal: new AbortController().signal,
        health: noHealth(),
      });
      expect(routes).toHaveLength(1);
      await drain(routes[0]!);
      const sent = JSON.stringify(captured.mock.calls[0]![2].messages);
      expect(sent).not.toContain('foreign-thinking-signature');
      expect(sent).not.toContain('foreign-tool-signature');
      expect(sent).toContain('private reasoning');
    } finally {
      await upstream.close();
    }
  });

  it('keeps call provenance through real Codex preparation after effort omission', async () => {
    const upstream = await fixture();
    try {
      const account = provider(upstream.baseURL);
      const b = { account: account.id, endpointRevision: receipt(account, 'codex').endpointRevision, model: 'm' };
      const a = { account: 'other', endpointRevision: 'ra', model: 'm' };
      const foreign = encodeToolUseId('foreign-call', 'FOREIGN_SIGNATURE', true);
      const own = encodeToolUseId('own-call', 'OWN_SIGNATURE', true);
      const store = new PoolContinuationStore();
      store.remember('a', 'branch', { input: 'hi' }, [
        { type: 'function_call', call_id: foreign, name: 'read', arguments: '{}' },
      ], a);
      const first = store.resolve('branch', { previous_response_id: 'a', input: [
        { type: 'function_call_output', call_id: foreign, output: 'ok' },
      ] });
      store.remember('b', 'branch', first.body, [
        { type: 'function_call', call_id: own, name: 'read', arguments: '{}' },
      ], b);
      const next = store.resolve('branch', { previous_response_id: 'b', input: [
        { type: 'function_call_output', call_id: own, output: 'ok' },
      ] });
      // A changed effort body is a new object. Preparation must carry provenance across it.
      const captured = vi.spyOn(sdkRoutes, 'sdkPoolRoute');
      await prepareCodexPoolRoutes({
        pool: { members: [{ providerId: account.id, modelId: 'm' }], effort: 'auto', receipts: [] },
        providers: [account], receipts: [receipt(account, 'codex')],
        body: next.body, source: next.source, signal: new AbortController().signal,
        health: noHealth(),
        translate: ((body, source, target, _npm, metadata, options, origins) =>
          preparePoolHistory(body, source, target, '@ai-sdk/google', metadata, options, origins)),
      });
      const sent = JSON.stringify(captured.mock.calls[0]![2].messages);
      expect(sent).not.toContain('FOREIGN_SIGNATURE');
      expect(sent).toContain('OWN_SIGNATURE');
      // Cleaning B's request must not change the still-live A branch.
      expect(JSON.stringify(preparePoolHistory(first.body, first.source, a, '@ai-sdk/google')))
        .toContain('FOREIGN_SIGNATURE');
    } finally { await upstream.close(); }
  });

  it('cools the whole account for exhausted credit and leaves access failures model-scoped', async () => {
    const root = mkdtempSync(join(tmpdir(), 'relay-pool-quota-'));
    roots.push(root);
    const clock = 1_800_000_000_000;
    const store = new PoolHealthStore({ root, now: () => clock });
    const scopes = [poolModelScope('account', 'm')];
    const accountScopes = [poolAccountScope('account')];
    const failure = Object.assign(new Error('credits exhausted'), { statusCode: 402 });
    expect(poolFailure(failure, clock).kind).toBe('quota');
    expect(poolFailure({ statusCode: 401 }, clock).kind).toBe('access');
    expect(poolFailure({ statusCode: 403 }, clock).kind).toBe('access');
    // A bare 404 is cooled like an access failure and confirmed once more before it disables the model.
    expect(poolFailure({ statusCode: 404 }, clock).kind).toBe('missing');

    const route = sdkPoolRoute({
      member: { providerId: 'account', modelId: 'm' }, revision: 'rev',
      freeStatus: 'verified_free', catalogVerified: true, accessVerified: true,
      billingSafe: true, targets: ['codex'], toolsVerified: true,
      defaultEffortVerified: true, effortLevels: [], contextFits: true, contextVerified: true,
    }, new Proxy({}, { get() { throw failure; } }) as LanguageModel,
    { messages: [], maxOutputTokens: 128 }, { store, scopes, accountScopes });
    await (async () => {
      for await (const _part of runPoolAttempts([{ ...route, id: 'rev' }], new AbortController().signal,
        { attempts: 1, firstContentMs: 100, idleMs: 100, totalMs: 500, bufferBytes: 4096, cleanupMs: 100 },
        retryPoolFailure)) { /* drain */ }
    })().catch(() => undefined);

    expect(await store.cooldownFor({ id: 'rev', scopes })).toBeGreaterThan(clock);
    expect(await store.cooldownFor({ id: 'rev', scopes: accountScopes })).toBeGreaterThanOrEqual(clock + 120_000);
    expect(await store.cooldownFor({ id: 'sibling', scopes: [poolModelScope('account', 'sibling'), ...accountScopes] }))
      .toBeGreaterThanOrEqual(clock + 120_000);
  });
});

describe('regular Codex routes keep their request shape', () => {
  it('does not add tool_choice to the SDK params unless the pool asks for it', async () => {
    const { translateResponsesRequest } = await import('../src/codex-responses-adapter.js');
    const body = { model: 'm', input: 'hi', tool_choice: 'required' as const,
      tools: [{ type: 'function' as const, name: 'read', description: 'r', parameters: { type: 'object', properties: {} } }] };
    expect('toolChoice' in translateResponsesRequest(body as never, '@ai-sdk/openai-compatible')).toBe(false);
    expect(translateResponsesRequest(body as never, '@ai-sdk/openai-compatible', undefined, { forwardToolChoice: true }).toolChoice).toBe('required');
  });
});
