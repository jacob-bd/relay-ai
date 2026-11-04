import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRegistry, saveRegistry } from '../src/registry/io.js';
import { setContextWindowOverride } from '../src/registry/crud.js';
import { materializeRegistry } from '../src/registry/materialize.js';
import { parseContextLimit } from '../src/test-model.js';
import { parseContextSizeInput } from '../src/providers-command.js';
import type { RegistryProvider } from '../src/registry/types.js';

let dir: string;

function provider(id = 'custom-gw'): RegistryProvider {
  return {
    id, templateId: 'custom-openai', name: id, enabled: true,
    api: { npm: '@ai-sdk/openai-compatible', url: 'https://gw.example.com/v1' },
    authRef: `keyring:provider:${id}`, addedAt: '2026-11-03T00:00:00Z',
    modelsCache: {
      fetchedAt: '2026-11-03T00:00:00Z',
      models: [
        { id: 'qwen3-14b', name: 'Qwen3 14B', upstreamModelId: 'qwen3-14b', modelFormat: 'openai', contextWindow: 262_144 },
        { id: 'other', name: 'Other', upstreamModelId: 'other', modelFormat: 'openai', contextWindow: 131_072 },
      ],
    },
  };
}

const sizes = (id = 'custom-gw') => Object.fromEntries(
  materializeRegistry(loadRegistry(), () => 'key', { agent: 'server' })
    .find(p => p.id === id)!.models.map(m => [m.id, m.contextWindow]),
);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'relay-ctx-override-'));
  vi.stubEnv('RELAY_AI_HOME', dir);
  saveRegistry({ schemaVersion: 1, providers: [provider(), provider('untouched')] });
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); });

describe('context window override', () => {
  it('uses a saved size everywhere the model is read', () => {
    expect(setContextWindowOverride('custom-gw', 'qwen3-14b', 40_960)).toEqual({ ok: true, contextWindow: 40_960, source: 'user' });
    expect(sizes()).toEqual({ 'qwen3-14b': 40_960, other: 131_072 });
  });

  it('survives a model refresh that replaces the downloaded list', () => {
    setContextWindowOverride('custom-gw', 'qwen3-14b', 40_960);
    const registry = loadRegistry();
    registry.providers[0]!.modelsCache = provider().modelsCache;
    saveRegistry(registry);
    expect(sizes()['qwen3-14b']).toBe(40_960);
    expect(loadRegistry().providers[0]!.modelsCache!.models[0]!.contextWindow).toBe(262_144);
  });

  it('reset brings back the provider size', () => {
    setContextWindowOverride('custom-gw', 'qwen3-14b', 40_960);
    expect(setContextWindowOverride('custom-gw', 'qwen3-14b', null)).toEqual({ ok: true, contextWindow: null });
    expect(sizes()['qwen3-14b']).toBe(262_144);
    expect(loadRegistry().providers[0]!.contextWindowOverrides).toBeUndefined();
  });

  it('a measured size never replaces one the user typed', () => {
    setContextWindowOverride('custom-gw', 'qwen3-14b', 50_000, 'user');
    expect(setContextWindowOverride('custom-gw', 'qwen3-14b', 40_960, 'measured')).toEqual({ ok: true, contextWindow: 50_000, source: 'user' });
    expect(sizes()['qwen3-14b']).toBe(50_000);
  });

  it('a typed size replaces a measured one', () => {
    setContextWindowOverride('custom-gw', 'qwen3-14b', 40_960, 'measured');
    setContextWindowOverride('custom-gw', 'qwen3-14b', 32_000, 'user');
    expect(loadRegistry().providers[0]!.contextWindowOverrides).toEqual({ 'qwen3-14b': { contextWindow: 32_000, source: 'user' } });
  });

  it('leaves providers nobody touched exactly as they were', () => {
    setContextWindowOverride('custom-gw', 'qwen3-14b', 40_960);
    expect(sizes('untouched')).toEqual({ 'qwen3-14b': 262_144, other: 131_072 });
  });

  it('rejects bad sizes, unknown providers and unknown models', () => {
    expect(setContextWindowOverride('custom-gw', 'qwen3-14b', 10)).toMatchObject({ ok: false });
    expect(setContextWindowOverride('custom-gw', 'qwen3-14b', 1.5)).toMatchObject({ ok: false });
    expect(setContextWindowOverride('nope', 'qwen3-14b', 40_960)).toMatchObject({ ok: false });
    expect(setContextWindowOverride('custom-gw', 'nope', 40_960)).toMatchObject({ ok: false });
    expect(loadRegistry().providers[0]!.contextWindowOverrides).toBeUndefined();
  });

  it('drops malformed saved entries on load', () => {
    const registry = loadRegistry();
    (registry.providers[0] as unknown as Record<string, unknown>).contextWindowOverrides = {
      'qwen3-14b': { contextWindow: 40_960, source: 'user' },
      other: { contextWindow: 'big', source: 'user' },
    };
    saveRegistry(registry);
    expect(loadRegistry().providers[0]!.contextWindowOverrides).toEqual({ 'qwen3-14b': { contextWindow: 40_960, source: 'user' } });
  });
});

describe('parseContextLimit (free size check)', () => {
  it('reads vLLM gateway wording', () => {
    expect(parseContextLimit('max_tokens=100000000 cannot be greater than max_model_len=max_total_tokens=40960. Please request fewer output tokens.')).toBe(40_960);
  });
  it('reads OpenAI wording', () => {
    expect(parseContextLimit("This model's maximum context length is 128000 tokens. However, you requested 100000000 tokens")).toBe(128_000);
  });
  it('ignores output-token limits', () => {
    expect(parseContextLimit('max_tokens: 100000000 > 64000, which is the maximum allowed number of output tokens')).toBeUndefined();
  });
  it('returns undefined when no limit is stated', () => {
    expect(parseContextLimit('Unknown model: foo')).toBeUndefined();
  });
});

describe('parseContextSizeInput (CLI)', () => {
  it.each([['128K', 128_000], ['1m', 1_000_000], ['1.5M', 1_500_000], ['40960', 40_960], [' 41k ', 41_000]])('%s → %i', (text, expected) => {
    expect(parseContextSizeInput(text)).toBe(expected);
  });
  it.each(['', 'abc', '-5k', '12G'])('rejects %j', text => {
    expect(parseContextSizeInput(text)).toBeUndefined();
  });
});
