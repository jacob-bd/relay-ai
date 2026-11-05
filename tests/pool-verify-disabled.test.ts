import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPoolCommand } from '../src/pool/command.js';
import { savePreferences, loadPreferences } from '../src/config.js';
import { PoolHealthStore, poolEndpointScope } from '../src/pool/health.js';
import { poolEndpointRevision } from '../src/pool/capabilities.js';
import type { LocalProvider } from '../src/types.js';

const fixture = vi.hoisted(() => ({
  provider: {
    id: 'account-2', name: 'Account 2', apiKey: 'k',
    models: [{
      id: 'free-model', name: 'Free model', family: '', brand: '', modelFormat: 'openai',
      upstreamModelId: 'free-model', npm: '@ai-sdk/openai-compatible',
      apiBaseUrl: 'http://127.0.0.1:1/v1', contextWindow: 128000, reasoning: false,
      cost: { input: 0, output: 0 },
    }],
  },
}));
const provider = fixture.provider as LocalProvider;
const probeResult = vi.hoisted(() => ({ ok: true }));

vi.mock('../src/provider-catalog.js', () => ({
  fetchProviderCatalog: vi.fn(async () => [fixture.provider]),
  resolveLocalProviderApiKey: vi.fn(async () => 'key'),
}));
vi.mock('../src/provider-factory.js', () => ({
  createLanguageModel: vi.fn(async () => ({})),
  effortProviderOptions: vi.fn(() => ({})),
}));
vi.mock('../src/provider-runtime.js', () => ({ providerRefreshToken: () => undefined }));
vi.mock('../src/pool/probe.js', () => ({
  probePoolModel: vi.fn(async () => probeResult.ok
    ? { text: 'passed' as const, tools: 'passed' as const }
    : { text: 'failed' as const, tools: 'failed' as const, failure: 'provider' as const }),
  probePoolEffort: vi.fn(async () => false),
}));

let home: string;
let previousHome: string | undefined;
beforeEach(() => {
  previousHome = process.env.RELAY_AI_HOME;
  home = mkdtempSync(join(tmpdir(), 'relay-pool-verify-disabled-'));
  process.env.RELAY_AI_HOME = home;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  if (previousHome === undefined) delete process.env.RELAY_AI_HOME; else process.env.RELAY_AI_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

describe('pool verify and a disabled member', () => {
  const model = fixture.provider.models[0]!;
  const revision = poolEndpointRevision({ providerId: 'account-2', npm: model.npm, baseURL: model.apiBaseUrl, upstreamModelId: 'free-model' });
  const scope = poolEndpointScope('account-2', revision, 'free-model');
  const receipt = { member: { providerId: 'account-2', modelId: 'free-model' }, endpointRevision: revision, verifiedAt: 1, expiresAt: 2,
    targets: ['codex' as const], tools: true, maxOutputTokens: 4096, contextWindow: 128000, contextSource: 'provider' as const,
    reasoningAccounting: 'inside-output' as const, effortLevels: [], billingSafe: true };

  it('tests a disabled member even though its saved result looks fine, and a pass re-enables it', async () => {
    savePreferences({ freePool: { members: [{ providerId: provider.id, modelId: 'free-model' }], effort: 'auto', receipts: [receipt] } });
    const store = new PoolHealthStore();
    await store.record([scope], { kind: 'disabled', note: 'model no longer available' });
    probeResult.ok = true;
    expect(await runPoolCommand(['verify'])).toBe(0);
    expect(await store.disabledFor([scope])).toBeUndefined();
    expect(loadPreferences().freePool?.receipts).toHaveLength(1);
  });

  it('leaves it disabled when the test still fails', async () => {
    savePreferences({ freePool: { members: [{ providerId: provider.id, modelId: 'free-model' }], effort: 'auto', receipts: [receipt] } });
    const store = new PoolHealthStore();
    await store.record([scope], { kind: 'disabled', note: 'model no longer available' });
    probeResult.ok = false;
    expect(await runPoolCommand(['verify'])).toBe(1);
    expect((await store.disabledFor([scope]))?.note).toBe('model no longer available');
  });
});
