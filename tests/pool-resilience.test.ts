import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerResponse } from 'node:http';
import {
  ANTHROPIC_SSE_PING,
  GENERIC_SSE_KEEPALIVE,
  startPoolSseKeepalive,
  startPoolWsKeepalive,
} from '../src/pool/keepalive.js';
import { poolFailure } from '../src/pool/errors.js';
import { poolEndpointRevision } from '../src/pool/capabilities.js';
import { PoolHealthStore, poolEndpointScope } from '../src/pool/health.js';
import { clearPoolMemberHealth, disabledPoolMembers, recordTestPoolFailure } from '../src/pool/disabled.js';
import { poolView, handlePoolApi } from '../src/ui/pool-api.js';
import { runPoolCommand } from '../src/pool/command.js';
import { loadPreferences } from '../src/config.js';
import { DEFAULT_POOL_LIMITS } from '../src/pool/codex-runtime.js';
import { startProxyCatalog } from '../src/proxy.js';
import { CLAUDE_POOL_MODEL_ID, type ClaudePoolRuntime } from '../src/pool/claude-runtime.js';
import { createMockRequest } from './helpers/ui-api-test-utils.js';
import type { LocalProvider } from '../src/types.js';

function fakeServerResponse() {
  const emitter = new EventEmitter();
  const writes: string[] = [];
  let statusCode = 0;
  let headers: Record<string, string> = {};
  const res = Object.assign(emitter, {
    headersSent: false,
    destroyed: false,
    writableEnded: false,
    writable: true,
    writableNeedDrain: false,
    writeHead(code: number, hdrs: Record<string, string>) {
      if (this.headersSent) throw new Error('ERR_HTTP_HEADERS_SENT');
      this.headersSent = true;
      statusCode = code;
      headers = { ...hdrs };
      return this;
    },
    write(chunk: string) {
      writes.push(chunk);
      return true;
    },
    end(chunk?: string) {
      if (chunk) writes.push(chunk);
      this.writableEnded = true;
      return this;
    },
  });
  return {
    res: res as unknown as ServerResponse & typeof res,
    writes,
    get statusCode() { return statusCode; },
    get headers() { return headers; },
  };
}

describe('pool SSE and WebSocket keepalives', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('sends no headers or frames when stopped within the grace window', () => {
    const mock = fakeServerResponse();
    const keepalive = startPoolSseKeepalive(mock.res, {
      frame: ANTHROPIC_SSE_PING,
      delayMs: 1500,
      intervalMs: 4000,
    });
    vi.advanceTimersByTime(1000);
    keepalive.stop();
    vi.advanceTimersByTime(10_000);
    expect(keepalive.sent).toBe(false);
    expect(mock.res.headersSent).toBe(false);
    expect(mock.writes).toEqual([]);
    expect(mock.res.listenerCount('close')).toBe(0);
  });

  it('opens 200 SSE stream after delay, writes periodic pings, respects backpressure, and stops cleanly', () => {
    const mock = fakeServerResponse();
    const keepalive = startPoolSseKeepalive(mock.res, {
      frame: ANTHROPIC_SSE_PING,
      delayMs: 1500,
      intervalMs: 4000,
    });

    vi.advanceTimersByTime(1500);
    expect(keepalive.sent).toBe(true);
    expect(mock.statusCode).toBe(200);
    expect(mock.headers['Content-Type']).toBe('text/event-stream');
    expect(mock.writes).toEqual([ANTHROPIC_SSE_PING]);

    // Backpressure pauses writes without crashing or stopping future ticks.
    mock.res.writableNeedDrain = true;
    vi.advanceTimersByTime(4000);
    expect(mock.writes).toHaveLength(1);

    mock.res.writableNeedDrain = false;
    vi.advanceTimersByTime(4000);
    expect(mock.writes).toEqual([ANTHROPIC_SSE_PING, ANTHROPIC_SSE_PING]);

    keepalive.stop();
    vi.advanceTimersByTime(12_000);
    expect(mock.writes).toHaveLength(2);
    expect(mock.res.listenerCount('close')).toBe(0);
  });

  it('supports generic W3C SSE comment keepalive and WebSocket ping keepalive', () => {
    const mock = fakeServerResponse();
    const sse = startPoolSseKeepalive(mock.res, { delayMs: 1000, intervalMs: 2000 });
    vi.advanceTimersByTime(1000);
    expect(mock.writes).toEqual([GENERIC_SSE_KEEPALIVE]);
    sse.stop();

    let pings = 0;
    const ws = startPoolWsKeepalive(() => {
      pings += 1;
      return pings < 2;
    }, { delayMs: 1000, intervalMs: 2000 });
    vi.advanceTimersByTime(1000);
    expect(pings).toBe(1);
    expect(ws.sent).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(pings).toBe(2);
    // Returning false auto-stops the interval.
    vi.advanceTimersByTime(10_000);
    expect(pings).toBe(2);
  });
});

describe('pool limits and error classification hardening', () => {
  it('uses unified 15s first-content and 90s total limits', () => {
    expect(DEFAULT_POOL_LIMITS.firstContentMs).toBe(15_000);
    expect(DEFAULT_POOL_LIMITS.totalMs).toBe(90_000);
  });

  it('disables unambiguous invalid model IDs without false positives on OpenRouter 404 or 402 quota', () => {
    expect(poolFailure({ statusCode: 400, message: 'deepseek/bad is not a valid model ID' }).kind).toBe('disabled');
    expect(poolFailure({ statusCode: 404, message: 'Model ID is not valid' }).kind).toBe('disabled');
    // Must NOT disable healthy text models when an image request hits OpenRouter 404.
    expect(poolFailure({ statusCode: 404, message: 'No endpoints found that support image input' }).kind).toBe('missing');
    // Must keep 402 credit exhaustion on account-wide quota, never permanent disable.
    expect(poolFailure({ statusCode: 402, message: 'This request requires credits; upgrade your plan' }).kind).toBe('quota');
  });

  it('classifies context overflow from responseBody when message is generic Bad Request', () => {
    const res = poolFailure({
      statusCode: 400,
      message: 'Bad Request',
      responseBody: JSON.stringify({ error: { message: 'Request has too many tokens for this model' } }),
    });
    expect(res.kind).toBe('context');
  });
});

describe('disabled tracking, health cleanup, and CLI pool clean', () => {
  let home: string;
  let prevHome: string | undefined;
  let prevGroqKey: string | undefined;

  beforeEach(() => {
    prevHome = process.env.RELAY_AI_HOME;
    prevGroqKey = process.env.GROQ_API_KEY;
    home = mkdtempSync(join(tmpdir(), 'relay-pool-resilience-'));
    process.env.RELAY_AI_HOME = home;
    process.env.GROQ_API_KEY = 'test-groq-key';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (prevHome === undefined) delete process.env.RELAY_AI_HOME;
    else process.env.RELAY_AI_HOME = prevHome;
    if (prevGroqKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = prevGroqKey;
    rmSync(home, { recursive: true, force: true });
  });

  it('records permanent test failure as disabled and clears health.json when removed', async () => {
    const provider: LocalProvider = {
      id: 'groq',
      name: 'Groq',
      apiKey: 'k',
      authRef: 'env:GROQ_API_KEY',
      models: [{
        id: 'dead-model',
        name: 'Dead Model',
        family: '',
        brand: '',
        modelFormat: 'openai',
        npm: '@ai-sdk/openai-compatible',
        apiBaseUrl: 'http://127.0.0.1:9/v1',
        upstreamModelId: 'dead-model',
        contextWindow: 128000,
        cost: { input: 0, output: 0 },
      }],
    };
    const member = { providerId: 'groq', modelId: 'dead-model' };
    const store = new PoolHealthStore();

    const recorded = await recordTestPoolFailure(member, [provider], {
      kind: 'disabled',
      status: 404,
      note: 'model no longer available',
    }, store);
    expect(recorded).toEqual({ disabled: true, note: 'model no longer available' });

    const before = await disabledPoolMembers([provider], { members: [member] }, store);
    expect(before.has('groq/dead-model')).toBe(true);

    const view = poolView([provider], {
      enabled: true,
      effort: 'auto',
      members: [member, { providerId: 'ghost', modelId: 'missing-model' }],
      receipts: [],
    }, before);
    expect(view.disabled).toHaveLength(1);
    expect(view.disabled[0]!.modelId).toBe('dead-model');
    expect(view.unavailable).toHaveLength(1);
    expect(view.unavailable[0]!.modelId).toBe('missing-model');

    await clearPoolMemberHealth(member, [provider], [], store);
    const after = await disabledPoolMembers([provider], { members: [member] }, store);
    expect(after.size).toBe(0);
  });

  it('supports relay-ai pool clean with --dry-run, --disabled, and --unavailable', async () => {
    const providerId = 'groq';
    const deadModelId = 'dead-model';
    const liveModelId = 'live-model';
    const url = 'http://127.0.0.1:9/v1';
    const authRef = 'env:GROQ_API_KEY';

    writeFileSync(join(home, 'providers.json'), JSON.stringify({
      schemaVersion: 1,
      providers: [{
        id: providerId,
        templateId: 'groq',
        name: 'Groq',
        enabled: true,
        authType: 'api-key',
        authRef,
        api: { url, npm: '@ai-sdk/openai-compatible' },
        modelsCache: {
          fetchedAt: '2026-07-23T00:00:00Z',
          models: [
            { id: deadModelId, name: 'Dead', upstreamModelId: deadModelId, modelFormat: 'openai', contextWindow: 128000, contextWindowSource: 'provider', cost: { input: 0, output: 0 } },
            { id: liveModelId, name: 'Live', upstreamModelId: liveModelId, modelFormat: 'openai', contextWindow: 128000, contextWindowSource: 'provider', cost: { input: 0, output: 0 } },
          ],
        },
        addedAt: '2026-07-23T00:00:00Z',
      }],
    }));

    const deadRev = poolEndpointRevision({ providerId, authRef, npm: '@ai-sdk/openai-compatible', baseURL: url, upstreamModelId: deadModelId });
    const liveRev = poolEndpointRevision({ providerId, authRef, npm: '@ai-sdk/openai-compatible', baseURL: url, upstreamModelId: liveModelId });
    const store = new PoolHealthStore();
    await store.record([poolEndpointScope(providerId, deadRev, deadModelId)], {
      kind: 'disabled',
      status: 404,
      note: 'model no longer available',
    });

    writeFileSync(join(home, 'config.json'), JSON.stringify({
      freePool: {
        enabled: true,
        effort: 'auto',
        members: [
          { providerId, modelId: deadModelId },
          { providerId: 'ghost', modelId: 'gone-from-catalog' },
          { providerId, modelId: liveModelId },
        ],
        receipts: [{
          member: { providerId, modelId: liveModelId },
          endpointRevision: liveRev,
          verifiedAt: Date.now() - 1000,
          expiresAt: Date.now() + 60_000,
          targets: ['codex', 'claude', 'antigravity', 'core'],
          tools: true,
          maxOutputTokens: 4096,
          contextWindow: 128000,
          contextSource: 'provider',
          reasoningAccounting: 'inside-output',
          effortLevels: [],
          billingSafe: true,
        }],
      },
    }));

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    // Dry run keeps all 3 members intact.
    expect(await runPoolCommand(['clean', '--disabled', '--unavailable', '--dry-run'])).toBe(0);
    expect(loadPreferences().freePool?.members).toHaveLength(3);
    expect(log.mock.calls.flat().join('\n')).toContain('Dry run');

    // Default `pool clean` removes only Disabled, preserving Unavailable and Ready, and clears health.json.
    expect(await runPoolCommand(['clean'])).toBe(0);
    expect(loadPreferences().freePool?.members.map(m => m.modelId)).toEqual(['gone-from-catalog', liveModelId]);
    expect(await store.disabledFor([poolEndpointScope(providerId, deadRev, deadModelId)])).toBeUndefined();

    // `pool clean --unavailable` removes the catalog-missing ghost, leaving Ready intact.
    expect(await runPoolCommand(['clean', '--unavailable'])).toBe(0);
    expect(loadPreferences().freePool?.members.map(m => m.modelId)).toEqual([liveModelId]);
  });

  it('handles POST /api/pool remove-batch explicitly and clears disabled health state', async () => {
    const providerId = 'groq';
    const deadModelId = 'dead-model';
    const liveModelId = 'live-model';
    const url = 'http://127.0.0.1:9/v1';
    const authRef = 'env:GROQ_API_KEY';

    writeFileSync(join(home, 'providers.json'), JSON.stringify({
      schemaVersion: 1,
      providers: [{
        id: providerId,
        templateId: 'groq',
        name: 'Groq',
        enabled: true,
        authType: 'api-key',
        authRef,
        api: { url, npm: '@ai-sdk/openai-compatible' },
        modelsCache: {
          fetchedAt: '2026-07-23T00:00:00Z',
          models: [
            { id: deadModelId, name: 'Dead', upstreamModelId: deadModelId, modelFormat: 'openai', contextWindow: 128000, contextWindowSource: 'provider', cost: { input: 0, output: 0 } },
            { id: liveModelId, name: 'Live', upstreamModelId: liveModelId, modelFormat: 'openai', contextWindow: 128000, contextWindowSource: 'provider', cost: { input: 0, output: 0 } },
          ],
        },
        addedAt: '2026-07-23T00:00:00Z',
      }],
    }));

    const deadRev = poolEndpointRevision({ providerId, authRef, npm: '@ai-sdk/openai-compatible', baseURL: url, upstreamModelId: deadModelId });
    const store = new PoolHealthStore();
    await store.record([poolEndpointScope(providerId, deadRev, deadModelId)], {
      kind: 'disabled',
      status: 404,
      note: 'model no longer available',
    });

    writeFileSync(join(home, 'config.json'), JSON.stringify({
      freePool: {
        enabled: true,
        effort: 'auto',
        members: [
          { providerId, modelId: deadModelId },
          { providerId: 'ghost', modelId: 'missing-model' },
          { providerId, modelId: liveModelId },
        ],
        receipts: [],
      },
    }));

    const payload = JSON.stringify({
      action: 'remove-batch',
      members: [
        { providerId, modelId: deadModelId },
        { providerId: 'ghost', modelId: 'missing-model' },
      ],
    });
    const req = createMockRequest('POST', '/api/pool', payload);
    const mockRes = fakeServerResponse();
    await handlePoolApi(req, mockRes.res);

    expect(mockRes.statusCode).toBe(200);
    expect(JSON.parse(mockRes.writes.join(''))).toEqual({ ok: true, removed: 2 });
    expect(loadPreferences().freePool?.members.map(m => m.modelId)).toEqual([liveModelId]);
    expect(await store.disabledFor([poolEndpointScope(providerId, deadRev, deadModelId)])).toBeUndefined();
  });

  it('blocks adding a candidate to the pool when its latest test did not confirm tool calling', async () => {
    const providerId = 'groq';
    const modelId = 'chat-only-model';
    const url = 'http://127.0.0.1:9/v1';
    const authRef = 'env:GROQ_API_KEY';

    writeFileSync(join(home, 'providers.json'), JSON.stringify({
      schemaVersion: 1,
      providers: [{
        id: providerId,
        templateId: 'groq',
        name: 'Groq',
        enabled: true,
        authType: 'api-key',
        authRef,
        api: { url, npm: '@ai-sdk/openai-compatible' },
        modelsCache: {
          fetchedAt: '2026-07-23T00:00:00Z',
          models: [
            { id: modelId, name: 'Chat Only', upstreamModelId: modelId, modelFormat: 'openai', contextWindow: 128000, contextWindowSource: 'provider', cost: { input: 0, output: 0 } },
          ],
        },
        modelTestResults: {
          [modelId]: { ok: true, at: '2026-11-21T00:00:00Z', latencyMs: 1200, toolsPassed: false },
        },
        addedAt: '2026-07-23T00:00:00Z',
      }],
    }));

    const provider: LocalProvider = {
      id: providerId,
      name: 'Groq',
      apiKey: 'k',
      authRef,
      models: [{
        id: modelId,
        name: 'Chat Only',
        family: '',
        brand: '',
        modelFormat: 'openai',
        npm: '@ai-sdk/openai-compatible',
        apiBaseUrl: url,
        upstreamModelId: modelId,
        contextWindow: 128000,
        cost: { input: 0, output: 0 },
      }],
    };
    const view = poolView([provider], { enabled: true, effort: 'auto', members: [], receipts: [] });
    expect(view.candidates).toHaveLength(1);
    expect(view.candidates[0]!.canAdd).toBe(false);
    expect(view.candidates[0]!.addReason).toMatch(/Tool calling was not confirmed/);

    const addReq = createMockRequest('POST', '/api/pool', JSON.stringify({ action: 'add', providerId, modelId }));
    const addRes = fakeServerResponse();
    await handlePoolApi(addReq, addRes.res);
    expect(addRes.statusCode).toBe(400);
    expect(JSON.parse(addRes.writes.join('')).error).toMatch(/Tool calling was not confirmed/);
  });
});

describe('Claude proxy SSE keepalive integration', () => {
  it('emits event: ping while failover waits and cleanly emits event: error if all members fail after ping', async () => {
    let mode: 'succeed' | 'fail' = 'succeed';
    const fakeRuntime = {
      async serve(_body: Record<string, unknown>, write: (chunk: string) => void) {
        await new Promise(resolve => setTimeout(resolve, 1750));
        if (mode === 'succeed') {
          write('event: message_start\ndata: {"type":"message_start"}\n\n');
          write('event: message_stop\ndata: {"type":"message_stop"}\n\n');
          return { ok: true };
        }
        return {
          ok: false,
          status: 502,
          committed: false,
          error: { type: 'api_error', message: 'All free pool members failed' },
        };
      },
    } as unknown as ClaudePoolRuntime;

    const handle = await startProxyCatalog([], CLAUDE_POOL_MODEL_ID, false, {
      pool: { runtime: fakeRuntime, displayName: 'Relay Free Pool', contextWindow: 128000 },
    });
    try {
      // 1. Slow failover succeeds after ping -> receives ping then message_start + message_stop
      mode = 'succeed';
      const okRes = await fetch(`http://127.0.0.1:${handle.port}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': handle.token },
        body: JSON.stringify({ model: CLAUDE_POOL_MODEL_ID, stream: true, messages: [{ role: 'user', content: 'hi' }] }),
      });
      expect(okRes.status).toBe(200);
      const okText = await okRes.text();
      expect(okText).toContain('event: ping');
      expect(okText).toContain('event: message_start');
      expect(okText.indexOf('event: ping')).toBeLessThan(okText.indexOf('event: message_start'));

      // 2. Slow failover fails after ping -> receives ping then spec-compliant event: error SSE
      mode = 'fail';
      const errRes = await fetch(`http://127.0.0.1:${handle.port}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': handle.token },
        body: JSON.stringify({ model: CLAUDE_POOL_MODEL_ID, stream: true, messages: [{ role: 'user', content: 'hi' }] }),
      });
      expect(errRes.status).toBe(200);
      const errText = await errRes.text();
      expect(errText).toContain('event: ping');
      expect(errText).toContain('event: error');
      expect(errText).toContain('All free pool members failed');
    } finally {
      handle.close();
    }
  }, 15_000);
});
