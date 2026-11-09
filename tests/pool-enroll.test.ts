import { describe, expect, it, vi } from 'vitest';
import { verifyPoolMember, type EnrollDeps } from '../src/pool/enroll.js';
import { poolEndpointRevision } from '../src/pool/capabilities.js';
import type { LocalProvider } from '../src/types.js';
const member = { providerId: 'account-2', modelId: 'm' };
const provider: LocalProvider = {
  id: 'account-2', name: 'Account 2', apiKey: '', authRef: 'keyring:x',
  models: [{ id: 'm', name: 'm', family: '', brand: '', modelFormat: 'openai', upstreamModelId: 'm', npm: '@ai-sdk/openai-compatible', apiBaseUrl: 'http://127.0.0.1:1/v1', contextWindow: 128000, cost: { input: 0, output: 0 } }],
};
const deps = (probePasses = true): EnrollDeps => ({
  resolveKey: vi.fn(async () => 'fake'),
  createModel: vi.fn(async () => ({}) as never),
  probe: vi.fn(async () => probePasses ? { text: 'passed', tools: 'passed' } : { text: 'passed', tools: 'failed', failure: 'provider' }),
});
describe('pool enrollment receipts', () => {
  it('mints a never-expiring receipt only after real text and tool probes pass', async () => {
    const result = await verifyPoolMember(member, [provider], new AbortController().signal, deps(), 1000);
    expect(result.status).toBe('verified');
    if (result.status !== 'verified') return;
    expect(result.receipt).toMatchObject({
      member, verifiedAt: 1000, expiresAt: Number.MAX_SAFE_INTEGER, tools: true,
      contextWindow: 128000, contextSource: 'provider', targets: ['codex', 'claude', 'antigravity', 'core'],
      effortLevels: [], billingSafe: true,
    });
    expect(result.receipt.endpointRevision).toBe(poolEndpointRevision({
      providerId: provider.id, authRef: provider.authRef, npm: provider.models[0].npm,
      baseURL: provider.models[0].apiBaseUrl, upstreamModelId: 'm', headers: undefined,
    }));
  });
  it('mints nothing when a probe fails, credentials are missing, or the model is paid', async () => {
    expect(await verifyPoolMember(member, [provider], new AbortController().signal, deps(false))).toMatchObject({ status: 'skipped', reason: 'probe-provider' });
    const noKey = { ...deps(), resolveKey: async () => null };
    expect(await verifyPoolMember(member, [provider], new AbortController().signal, noKey)).toMatchObject({ status: 'skipped', reason: 'missing-credential' });
    const paid = [{ ...provider, models: [{ ...provider.models[0], cost: { input: 1, output: 1 } }] }];
    expect(await verifyPoolMember(member, paid, new AbortController().signal, deps())).toMatchObject({ status: 'skipped', reason: 'not-free' });
  });
  it('records only effort rungs that actually passed a probe', async () => {
    const reasoning = [{
      ...provider,
      models: [{ ...provider.models[0], reasoning: true, reasoningEffortLevels: ['medium', 'high'] }],
    }];
    const withEffort: EnrollDeps = {
      ...deps(),
      probeEffort: async (_model, level) => level === 'high',
    };
    const result = await verifyPoolMember(member, reasoning, new AbortController().signal, withEffort, 1000);
    expect(result.status).toBe('verified');
    if (result.status !== 'verified') return;
    expect(result.receipt.effortLevels).toEqual(['high']);
    expect(result.receipt.targets).toEqual(['codex', 'claude', 'antigravity', 'core']);
  });

  it('refuses to guess a missing context window or an unsupported transport', async () => {
    const noWindow = [{ ...provider, models: [{ ...provider.models[0], contextWindow: undefined }] }];
    expect(await verifyPoolMember(member, noWindow, new AbortController().signal, deps())).toMatchObject({ status: 'skipped', reason: 'unverified-context-window' });
    const cloud = [{ ...provider, models: [{ ...provider.models[0], modelFormat: 'cloud-code' as const }] }];
    expect(await verifyPoolMember(member, cloud, new AbortController().signal, deps())).toMatchObject({ status: 'skipped', reason: 'unsupported-transport' });
  });
});
