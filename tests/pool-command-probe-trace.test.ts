import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPoolCommand } from '../src/pool/command.js';
import { savePreferences } from '../src/config.js';
import type { LocalProvider } from '../src/types.js';

const fixture = vi.hoisted(() => ({
  provider: {
    id: 'account-2', name: 'Account 2', apiKey: '',
    models: [{
      id: 'free-model', name: 'Free model', family: '', brand: '', modelFormat: 'openai',
      upstreamModelId: 'free-model', npm: '@ai-sdk/openai-compatible',
      apiBaseUrl: 'http://127.0.0.1:1/v1', contextWindow: 128000, reasoning: false,
      cost: { input: 0, output: 0 },
    }],
  },
}));
const provider = fixture.provider as LocalProvider;

const probe = vi.hoisted(() => vi.fn(async (
  _model: unknown,
  _signal: AbortSignal,
  _timeout: number,
  onError?: (error: unknown) => void,
) => {
  onError?.(new Error('provider schema rejected the probe'));
  return { text: 'failed' as const, tools: 'failed' as const, failure: 'provider' as const };
}));

vi.mock('../src/provider-catalog.js', () => ({
  fetchProviderCatalog: vi.fn(async () => [fixture.provider]),
  resolveLocalProviderApiKey: vi.fn(async () => 'key'),
}));
vi.mock('../src/provider-factory.js', () => ({
  createLanguageModel: vi.fn(async () => ({})),
  effortProviderOptions: vi.fn(() => ({})),
}));
vi.mock('../src/provider-runtime.js', () => ({ providerRefreshToken: () => undefined }));
vi.mock('../src/pool/probe.js', () => ({ probePoolModel: probe, probePoolEffort: vi.fn(async () => false) }));

let home: string;
let previousHome: string | undefined;
let previousTrace: string | undefined;

beforeEach(() => {
  previousHome = process.env.RELAY_AI_HOME;
  previousTrace = process.env.RELAY_AI_TRACE;
  home = mkdtempSync(join(tmpdir(), 'relay-pool-trace-'));
  process.env.RELAY_AI_HOME = home;
  process.env.RELAY_AI_TRACE = '1';
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  if (previousHome === undefined) delete process.env.RELAY_AI_HOME;
  else process.env.RELAY_AI_HOME = previousHome;
  if (previousTrace === undefined) delete process.env.RELAY_AI_TRACE;
  else process.env.RELAY_AI_TRACE = previousTrace;
  rmSync(home, { recursive: true, force: true });
});

describe('pool verify diagnostics', () => {
  it('prints the underlying probe error in trace mode', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    savePreferences({
      freePool: {
        members: [{ providerId: provider.id, modelId: 'free-model' }],
        effort: 'auto', receipts: [],
      },
    });

    expect(await runPoolCommand(['verify'])).toBe(1);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('provider schema rejected the probe'));
  });
});
