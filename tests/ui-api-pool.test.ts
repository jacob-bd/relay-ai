import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handlePoolApi } from '../src/ui/pool-api.js';
import { createMockRequest, createMockResponse } from './helpers/ui-api-test-utils.js';
import { loadPreferences, savePreferences } from '../src/config.js';
import { poolEndpointRevision } from '../src/pool/capabilities.js';
import { getRelayLaunchCommand } from '../src/native-launcher.js';
const fixture = vi.hoisted(() => ({ providers: [] as any[], verify: vi.fn() }));
vi.mock('../src/provider-catalog.js', () => ({ fetchProviderCatalog: async () => fixture.providers }));
vi.mock('../src/pool/verify.js', () => ({ verifyConfiguredPoolMember: (...args: unknown[]) => fixture.verify(...args) }));
let root: string, previous: string | undefined;
const member = { providerId: 'free-account', modelId: 'free' };
const model = { id: 'free', name: 'Free', npm: '@ai-sdk/openai-compatible', upstreamModelId: 'free', contextWindow: 128000, cost: { input: 0, output: 0 } };
async function call(body?: unknown) {
  const req = createMockRequest(body ? 'POST' : 'GET', '/api/pool', body ? JSON.stringify(body) : undefined);
  const response = createMockResponse();
  Object.assign(response.res, { once() { return this; }, removeListener() { return this; } });
  await handlePoolApi(req, response.res);
  return { code: response.result.code, body: JSON.parse(response.result.data) };
}
beforeEach(() => {
  previous = process.env.RELAY_AI_HOME; root = mkdtempSync(join(tmpdir(), 'relay-ui-pool-')); process.env.RELAY_AI_HOME = root;
  fixture.providers = [{ id: member.providerId, name: 'Free Account', models: [model, { ...model, id: 'paid', cost: { input: 1, output: 1 } }, { ...model, id: 'guess', contextWindowEstimated: true }] }];
  fixture.verify.mockReset();
});
afterEach(() => { if (previous === undefined) delete process.env.RELAY_AI_HOME; else process.env.RELAY_AI_HOME = previous; rmSync(root, { recursive: true, force: true }); });
describe('free pool UI API', () => {
  it('lists only eligible candidates and saves membership independently of favorites', async () => {
    savePreferences({ favoriteModels: [{ providerId: 'paid', modelId: 'm' }] });
    expect((await call()).body.candidates.map((m: any) => m.modelId)).toEqual(['free']);
    expect((await call({ action: 'add', ...member })).code).toBe(200);
    expect((await call()).body.members[0].status).toBe('Needs verification');
    expect(loadPreferences().favoriteModels).toEqual([{ providerId: 'paid', modelId: 'm' }]);
    expect((await call({ action: 'add', ...member, modelId: 'paid' })).code).toBe(400);
    expect((await call({ action: 'add', ...member, receipts: [] })).code).toBe(400);
  });
  it('mints receipts only through verification and invalidates failed rechecks', async () => {
    await call({ action: 'add', ...member });
    const receipt = { member, endpointRevision: poolEndpointRevision({ providerId: member.providerId, npm: model.npm, upstreamModelId: model.id }), verifiedAt: Date.now(), expiresAt: Date.now() + 86400000, targets: ['claude', 'codex'], tools: true, maxOutputTokens: 4096, contextWindow: 128000, contextSource: 'provider', reasoningAccounting: 'inside-output', effortLevels: [], billingSafe: true };
    fixture.verify.mockResolvedValueOnce({ status: 'verified', receipt });
    expect((await call({ action: 'verify', ...member })).body.ok).toBe(true);
    expect((await call()).body.members[0].status).toBe('Verified');
    fixture.verify.mockResolvedValueOnce({ status: 'skipped', reason: 'probe-provider' });
    expect((await call({ action: 'verify', ...member })).body.ok).toBe(false);
    expect(loadPreferences().freePool?.receipts).toEqual([]);
  });
  it('preserves a concurrent removal and does not resurrect it after verification', async () => {
    await call({ action: 'add', ...member });
    fixture.verify.mockImplementationOnce(async () => {
      savePreferences({ freePool: { members: [], effort: 'auto', receipts: [] } });
      return { status: 'skipped', reason: 'probe-provider' };
    });
    expect((await call({ action: 'verify', ...member })).code).toBe(400);
    expect(loadPreferences().freePool?.members).toEqual([]);
  });
  it('builds explicit pool launches and rejects desktop or mixed selections', () => {
    const command = getRelayLaunchCommand('claude', { pool: true });
    if (process.platform === 'darwin') expect(readFileSync(command.split(' ').at(-1)!, 'utf8')).toContain('--pool');
    else expect(command).toContain('--pool');
    expect(getRelayLaunchCommand('codex', { pool: true })).toBeTruthy();
    expect(() => getRelayLaunchCommand('codex-app', { pool: true })).toThrow('Free pool');
    expect(() => getRelayLaunchCommand('claude', { pool: true, httpProxy: true })).toThrow('Free pool');
  });
});
