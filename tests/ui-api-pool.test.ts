import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handlePoolApi, invalidateUiPoolMember, verifyUiPoolMember } from '../src/ui/pool-api.js';
import { createMockRequest, createMockResponse } from './helpers/ui-api-test-utils.js';
import { loadPreferences, savePreferences } from '../src/config.js';
import { poolEndpointRevision } from '../src/pool/capabilities.js';

const fixture = vi.hoisted(() => ({ providers: [] as any[], verify: vi.fn() }));
vi.mock('../src/provider-catalog.js', () => ({ fetchProviderCatalog: async () => fixture.providers }));
vi.mock('../src/pool/verify.js', async importOriginal => {
  const original = await importOriginal<typeof import('../src/pool/verify.js')>();
  return {
    ...original,
    verifyConfiguredPoolMember: (...args: unknown[]) => fixture.verify(...args),
  };
});

let root: string;
let previous: string | undefined;
const member = { providerId: 'free-account', modelId: 'free' };
const baseModel = {
  id: 'free', name: 'Free', npm: '@ai-sdk/openai-compatible', upstreamModelId: 'free',
  contextWindow: 128000, cost: { input: 0, output: 0 },
};
const model = (over: Record<string, unknown>) => ({ ...baseModel, ...over });
const receiptFor = (over: Record<string, unknown> = {}) => ({
  member,
  endpointRevision: poolEndpointRevision({ providerId: member.providerId, npm: baseModel.npm, upstreamModelId: baseModel.id }),
  verifiedAt: Date.now(), expiresAt: Date.now() + 86_400_000,
  targets: ['claude', 'codex'], tools: true, maxOutputTokens: 4096,
  contextWindow: 128000, contextSource: 'provider', reasoningAccounting: 'inside-output',
  effortLevels: [], billingSafe: true, ...over,
});

async function call(body?: unknown) {
  const req = createMockRequest(body ? 'POST' : 'GET', '/api/pool', body ? JSON.stringify(body) : undefined);
  const response = createMockResponse();
  Object.assign(response.res, { once() { return this; }, removeListener() { return this; } });
  await handlePoolApi(req, response.res);
  return { code: response.result.code, body: JSON.parse(response.result.data) };
}

beforeEach(() => {
  previous = process.env.RELAY_AI_HOME;
  root = mkdtempSync(join(tmpdir(), 'relay-ui-pool-'));
  process.env.RELAY_AI_HOME = root;
  fixture.providers = [{
    id: member.providerId, name: 'Free Account', models: [
      model({}),
      model({ id: 'guess', contextWindowEstimated: true }),
      model({ id: 'provider-free', cost: { input: 1, output: 1 }, freeStatus: 'free_provider' }),
      model({ id: 'unsupported', npm: undefined, modelFormat: 'cloud-code' }),
      model({ id: 'paid', cost: { input: 1, output: 1 } }),
      model({ id: 'hidden-free', hidden: true }),
    ],
  }, {
    id: 'second-account', name: 'Second Free Account', models: [model({ id: 'second-free' })],
  }];
  fixture.verify.mockReset();
});
afterEach(() => {
  if (previous === undefined) delete process.env.RELAY_AI_HOME;
  else process.env.RELAY_AI_HOME = previous;
  rmSync(root, { recursive: true, force: true });
});

describe('free pool UI API', () => {
  it('shows the complete free-only catalog with table metadata and account names', async () => {
    const result = await call();
    expect(result.body.candidates.map((item: any) => item.modelId)).toEqual([
      'free', 'guess', 'provider-free', 'unsupported', 'second-free',
    ]);
    const free = result.body.candidates.find((item: any) => item.modelId === 'free');
    expect(free).toMatchObject({
      providerName: 'Free Account', name: 'Free', contextWindow: 128000,
      freeStatus: 'verified_free', canAdd: true, canRouteUntilTested: true,
    });
    expect(free.cost).toEqual({ input: 0, output: 0 });
    expect(result.body.candidates.find((item: any) => item.modelId === 'guess'))
      .toMatchObject({ contextWindowEstimated: true, canAdd: true, canRouteUntilTested: false });
    expect(result.body.candidates.find((item: any) => item.modelId === 'provider-free'))
      .toMatchObject({ canAdd: false, addReason: 'Requires verified zero pricing' });
    expect(result.body.candidates.find((item: any) => item.modelId === 'unsupported'))
      .toMatchObject({ canAdd: false, addReason: 'Unsupported pool transport' });
    expect(result.body.candidates.find((item: any) => item.modelId === 'second-free'))
      .toMatchObject({ providerName: 'Second Free Account' });
  });

  it('adds without testing, persists the enabled toggle and keeps Favorites separate', async () => {
    savePreferences({ favoriteModels: [{ providerId: 'paid', modelId: 'm' }] });
    expect((await call({ action: 'enabled', enabled: true })).code).toBe(200);
    expect((await call({ action: 'add', ...member })).code).toBe(200);
    const result = await call();
    expect(result.body.enabled).toBe(true);
    expect(result.body.members[0]).toMatchObject({ status: 'Needs test', targets: [] });
    expect(loadPreferences().favoriteModels).toEqual([{ providerId: 'paid', modelId: 'm' }]);
    expect((await call({ action: 'add', ...member, modelId: 'guess' })).code).toBe(200);
    expect((await call()).body.members[1]).toMatchObject({ status: 'Needs test', reason: expect.stringMatching(/context size/) });
    expect((await call({ action: 'add', ...member, modelId: 'paid' })).code).toBe(400);
    expect((await call({ action: 'add', ...member, receipts: [] })).code).toBe(400);
  });

  it('reuses a successful Test before Add by storing its receipt, then Add carries it forward', async () => {
    fixture.verify.mockResolvedValueOnce({ status: 'verified', receipt: receiptFor() });
    const tested = await verifyUiPoolMember(member.providerId, member.modelId, new AbortController().signal);
    expect(tested).toMatchObject({ ok: true, status: 'verified' });
    expect(loadPreferences().freePool?.members).toEqual([]);
    expect(loadPreferences().freePool?.receipts).toHaveLength(1);

    await call({ action: 'add', ...member });
    const result = await call();
    expect(result.body.members[0]).toMatchObject({ status: 'Ready' });
    expect(result.body.members[0].targets).toEqual(expect.arrayContaining(['claude', 'codex', 'antigravity']));
    expect(loadPreferences().freePool?.receipts).toHaveLength(1);
  });

  it('fails closed after a later Test failure without removing membership', async () => {
    savePreferences({ freePool: { enabled: true, members: [member], effort: 'auto', receipts: [receiptFor()] } });
    fixture.verify.mockResolvedValueOnce({ status: 'skipped', reason: 'probe-provider' });
    expect(await verifyUiPoolMember(member.providerId, member.modelId, new AbortController().signal))
      .toMatchObject({ ok: false, status: 'skipped', reason: 'probe-provider' });
    const result = await call();
    expect(result.body.members[0]).toMatchObject({ status: 'Needs test', targets: [] });
    expect(loadPreferences().freePool?.members).toEqual([member]);
    expect(loadPreferences().freePool?.receipts).toEqual([]);
  });

  it('preserves a concurrent removal and ignores non-pool free entries', async () => {
    savePreferences({ freePool: { enabled: true, members: [member], effort: 'auto', receipts: [] } });
    fixture.verify.mockImplementationOnce(async () => {
      savePreferences({ freePool: { enabled: true, members: [], effort: 'auto', receipts: [] } });
      return { status: 'verified', receipt: receiptFor() };
    });
    await verifyUiPoolMember(member.providerId, member.modelId, new AbortController().signal);
    expect(loadPreferences().freePool?.members).toEqual([]);
    expect(await verifyUiPoolMember(member.providerId, 'provider-free', new AbortController().signal)).toBeUndefined();
    expect(await verifyUiPoolMember(member.providerId, 'unsupported', new AbortController().signal)).toBeUndefined();
  });

  it('skips a guessed context size before any provider probe', async () => {
    fixture.verify.mockClear();
    expect(await verifyUiPoolMember(member.providerId, 'guess', new AbortController().signal))
      .toMatchObject({ ok: false, status: 'skipped', reason: 'unverified-context-window' });
    expect(fixture.verify).not.toHaveBeenCalled();
    // Paid models are outside the pool: Test returns no pool result and no probe runs.
    expect(await verifyUiPoolMember(member.providerId, 'paid', new AbortController().signal)).toBeUndefined();
    expect(fixture.verify).not.toHaveBeenCalled();
  });

  it('reports pool probe failures without throwing and clears stale receipts on demand', async () => {
    savePreferences({ freePool: { enabled: true, members: [member], effort: 'auto', receipts: [receiptFor()] } });
    fixture.verify.mockRejectedValueOnce(new Error('upstream said no (key sk-test-secret-1234567890)'));
    const failed = await verifyUiPoolMember(member.providerId, member.modelId, new AbortController().signal);
    expect(failed).toMatchObject({ ok: false, status: 'skipped', reason: 'pool-verification-failed' });
    expect(failed?.diagnostic).not.toMatch(/sk-test-secret/);
    expect(loadPreferences().freePool?.receipts).toHaveLength(1);

    expect(invalidateUiPoolMember(member.providerId, member.modelId)).toBe(true);
    expect(loadPreferences().freePool?.members).toEqual([member]);
    expect(loadPreferences().freePool?.receipts).toEqual([]);
    expect((await call()).body.members[0].status).toBe('Needs test');
    expect(invalidateUiPoolMember(member.providerId, member.modelId)).toBe(false);
  });

  it('keeps a failed receipt save from throwing out of the helper', async () => {
    fixture.verify.mockResolvedValueOnce({ status: 'verified', receipt: receiptFor({ endpointRevision: 'not-a-hash' }) });
    const result = await verifyUiPoolMember(member.providerId, member.modelId, new AbortController().signal);
    expect(result).toMatchObject({ ok: false, status: 'skipped', reason: 'receipt-save-failed' });
  });

  it('keeps the explicit verify API backward compatible', async () => {
    await call({ action: 'add', ...member });
    fixture.verify.mockResolvedValueOnce({ status: 'verified', receipt: receiptFor() });
    expect((await call({ action: 'verify', ...member })).code).toBe(200);
    expect((await call()).body.members[0].status).toBe('Ready');
  });

  it('reorders by direction and by absolute index', async () => {
    await call({ action: 'add', ...member });
    await call({ action: 'add', providerId: member.providerId, modelId: 'guess' });
    await call({ action: 'add', providerId: 'second-account', modelId: 'second-free' });
    expect((await call()).body.members.map((m: any) => m.modelId)).toEqual(['free', 'guess', 'second-free']);

    expect((await call({ action: 'move', ...member, direction: 1 })).code).toBe(200);
    expect((await call()).body.members.map((m: any) => m.modelId)).toEqual(['guess', 'free', 'second-free']);

    expect((await call({ action: 'move', ...member, toIndex: 2 })).code).toBe(200);
    expect((await call()).body.members.map((m: any) => m.modelId)).toEqual(['guess', 'second-free', 'free']);

    expect((await call({ action: 'move', ...member, toIndex: 9 })).code).toBe(400);
    expect((await call({ action: 'move', ...member })).code).toBe(400);
  });
});
