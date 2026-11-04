import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRegistry, saveRegistry } from '../src/registry/io.js';
import { setContextWindowOverride } from '../src/registry/crud.js';
import { checkContextWindow, testModel } from '../src/test-model.js';

vi.mock('../src/core/model.js', () => ({ createRelayModel: vi.fn(async () => ({})) }));
let probeReply: { error?: unknown } = {};
vi.mock('ai', () => ({
  streamText: vi.fn((opts: { maxOutputTokens: number }) => ({
    stream: (async function* () {
      if (opts.maxOutputTokens > 1_000_000) {
        if (probeReply.error) yield { type: 'error', error: probeReply.error };
        else { yield { type: 'text-delta', text: 'OK' }; yield { type: 'finish' }; }
        return;
      }
      yield { type: 'text-delta', text: 'OK' };
      yield { type: 'finish' };
    })(),
  })),
}));

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'relay-test-model-ctx-'));
  vi.stubEnv('RELAY_AI_HOME', dir);
  saveRegistry({ schemaVersion: 1, providers: [{
    id: 'custom-gw', templateId: 'custom-openai', name: 'GW', enabled: true,
    api: { npm: '@ai-sdk/openai-compatible', url: 'https://gw.example.com/v1' },
    authRef: 'keyring:provider:custom-gw', addedAt: '2026-11-03T00:00:00Z',
    modelsCache: { fetchedAt: '2026-11-03T00:00:00Z', models: [
      { id: 'qwen3-14b', name: 'Qwen3 14B', upstreamModelId: 'qwen3-14b', modelFormat: 'openai', contextWindow: 262_144 },
    ] },
  }] });
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); probeReply = {}; });

const vllmError = { message: 'Bad Request', responseBody: '{"error":{"message":"max_tokens=100000000 cannot be greater than max_model_len=max_total_tokens=40960."}}' };

describe('Test also checks the context size', () => {
  it('saves a measured size that differs from the shown one', async () => {
    probeReply = { error: vllmError };
    const result = await testModel('custom-gw', 'qwen3-14b');
    expect(result).toMatchObject({ ok: true, context: { measured: 40_960, previous: 262_144, updated: true, keptManual: false } });
    expect(loadRegistry().providers[0]!.contextWindowOverrides).toEqual({ 'qwen3-14b': { contextWindow: 40_960, source: 'measured' } });
  });

  it('keeps a hand-typed size', async () => {
    setContextWindowOverride('custom-gw', 'qwen3-14b', 50_000, 'user');
    probeReply = { error: vllmError };
    const result = await testModel('custom-gw', 'qwen3-14b');
    expect(result).toMatchObject({ ok: true, context: { measured: 40_960, updated: false, keptManual: true } });
    expect(loadRegistry().providers[0]!.contextWindowOverrides!['qwen3-14b']).toEqual({ contextWindow: 50_000, source: 'user' });
  });

  it('changes nothing when the server states no size', async () => {
    const result = await testModel('custom-gw', 'qwen3-14b');
    expect(result).toMatchObject({ ok: true, context: { updated: false } });
    expect(loadRegistry().providers[0]!.contextWindowOverrides).toBeUndefined();
  });

  it('saves a confirmed guess as measured, so it stops being an estimate', async () => {
    probeReply = { error: { message: 'max_model_len=262144' } };
    const result = await testModel('custom-gw', 'qwen3-14b');
    expect(result).toMatchObject({ ok: true, context: { measured: 262_144, updated: false, saved: true } });
    expect(loadRegistry().providers[0]!.contextWindowOverrides).toEqual({ 'qwen3-14b': { contextWindow: 262_144, source: 'measured' } });
  });

  it('Measure learns "not chat" when the server refuses the chat request; a passing Test records chat', async () => {
    probeReply = { error: { statusCode: 404, responseBody: '{"detail":"Not Found"}' } };
    expect(await checkContextWindow('custom-gw', 'qwen3-14b')).toMatchObject({ notChat: true });
    expect(loadRegistry().providers[0]!.nonChatModelIds).toEqual(['qwen3-14b']);
    // A text reply proves chat even if the follow-up size check is refused.
    const result = await testModel('custom-gw', 'qwen3-14b');
    expect(result).toMatchObject({ ok: true, notChat: false, context: { notChat: false } });
    expect(loadRegistry().providers[0]!.nonChatModelIds).toBeUndefined();
    expect(loadRegistry().providers[0]!.chatModelIds).toEqual(['qwen3-14b']);
  });

  it('a confirmed models.dev estimate also becomes measured', async () => {
    const registry = loadRegistry();
    registry.providers[0]!.modelsCache!.models[0]!.contextWindowSource = 'models.dev';
    saveRegistry(registry);
    probeReply = { error: { message: 'max_model_len=262144' } };
    const result = await testModel('custom-gw', 'qwen3-14b');
    expect(result).toMatchObject({ ok: true, context: { measured: 262_144, saved: true } });
  });

  it('does not write when it matches a size the provider already reported', async () => {
    const registry = loadRegistry();
    registry.providers[0]!.modelsCache!.models[0]!.contextWindowSource = 'provider';
    saveRegistry(registry);
    probeReply = { error: { message: 'max_model_len=262144' } };
    const result = await testModel('custom-gw', 'qwen3-14b');
    expect(result).toMatchObject({ ok: true, context: { measured: 262_144, updated: false } });
    expect(loadRegistry().providers[0]!.contextWindowOverrides).toBeUndefined();
  });

  it('a measured size survives a refresh and a reload', async () => {
    probeReply = { error: vllmError };
    await testModel('custom-gw', 'qwen3-14b');
    const registry = loadRegistry();
    registry.providers[0]!.modelsCache = { fetchedAt: 'later', models: [
      { id: 'qwen3-14b', name: 'Qwen3 14B', upstreamModelId: 'qwen3-14b', modelFormat: 'openai', contextWindow: 262_144 },
    ] };
    saveRegistry(registry);
    expect(loadRegistry().providers[0]!.contextWindowOverrides).toEqual({ 'qwen3-14b': { contextWindow: 40_960, source: 'measured' } });
  });
});
