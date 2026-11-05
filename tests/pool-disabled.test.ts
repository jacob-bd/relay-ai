import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { poolFailure } from '../src/pool/errors.js';
import { PoolHealthStore, poolAccountScope, poolEndpointScope } from '../src/pool/health.js';
import { clearDisabledPoolMember, disabledMessage, disabledPoolMembers, warnDisabledPoolMembers } from '../src/pool/disabled.js';
import { describePoolFailure, formatPoolRequestLines } from '../src/pool/activity.js';
import { poolView } from '../src/ui/pool-api.js';
import { poolEndpointRevision } from '../src/pool/capabilities.js';
import type { LocalProvider } from '../src/types.js';

const http = (statusCode: number, message: string, responseBody?: string) =>
  Object.assign(new Error(message), { statusCode, ...(responseBody ? { responseBody } : {}) });

describe('which errors disable a pool member', () => {
  it.each([
    [404, 'The model `foo` does not exist', undefined],
    [404, 'Not found', '{"error":{"code":"model_not_found","message":"x"}}'],
    [400, 'The model foo has been deprecated', undefined],
    [404, 'This model was decommissioned on 2026-10-01', undefined],
    [410, 'model has been retired', undefined],
    [403, 'forbidden', '{"code":"MODEL_NOT_IN_PLAN"}'],
    [403, 'This model is not included in your current plan', undefined],
    [402, 'The free promotion has ended for this model', undefined],
    [404, 'Free access to this model is no longer available', undefined],
  ])('disables on %i: %s', (status, message, body) => {
    expect(poolFailure(http(status, message, body)).kind).toBe('disabled');
  });

  it.each([
    [400, 'max_tokens is deprecated, use max_completion_tokens'],
    [400, 'This model does not support tools'],
    [400, 'This model does not support the temperature parameter'],
    [400, 'Invalid request: unknown field'],
    [503, 'The model is currently overloaded'],
    [500, 'The model foo does not exist'],
    [401, 'Invalid API key'],
    [400, 'The beta header is no longer supported'],
    [403, 'Image input requires a paid plan'],
    [402, 'Your free trial has expired'],
    [400, 'Preview mode is not enabled for this request'],
  ])('does not disable on %i: %s', (status, message) => {
    expect(poolFailure(http(status, message)).kind).not.toBe('disabled');
  });

  it('never disables on a rate limit, whatever the text says', () => {
    expect(poolFailure(http(429, 'model deprecated, free promotion ended')).kind).toBe('rate-limit');
  });

  it('treats a bare 404 or 410 as unconfirmed, not as a verdict', () => {
    expect(poolFailure(http(404, 'Not Found')).kind).toBe('missing');
    expect(poolFailure(http(410, 'Gone')).kind).toBe('missing');
  });

  it('describes a disabling failure as DISABLED in the log, with what to do', () => {
    const reason = describePoolFailure(http(404, 'The model `foo` does not exist'));
    expect(reason).toMatch(/^DISABLED: model no longer available/);
    expect(reason).toContain('Test');
  });
});

describe('disabled state in the health store', () => {
  let root: string;
  let clock: number;
  let store: PoolHealthStore;
  const scope = poolEndpointScope('prov', 'rev', 'm');
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'relay-disabled-'));
    clock = 1_800_000_000_000;
    store = new PoolHealthStore({ root, now: () => clock });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 }));

  it('disables on a verdict, keeps it across restarts and across years, and reports why', async () => {
    const result = await store.record([scope], { kind: 'disabled', status: 404, note: 'model no longer available' });
    expect(result).toMatchObject({ recorded: true, disabled: true, note: 'model no longer available' });
    clock += 3 * 365 * 86_400_000;
    const reopened = new PoolHealthStore({ root, now: () => clock });
    expect(await reopened.disabledFor([scope])).toMatchObject({ note: 'model no longer available' });
    expect(await reopened.cooldownFor({ id: 'rev', scopes: [scope] })).toBeGreaterThan(clock);
  });

  it('is not softened by later failures or by a healthy mark', async () => {
    await store.record([scope], { kind: 'disabled', note: 'model no longer available' });
    await store.record([scope], { kind: 'transient' });
    await store.record([scope], { kind: 'rate-limit', retryAt: clock + 1000 });
    await store.markHealthy([scope]);
    expect((await store.disabledFor([scope]))?.note).toBe('model no longer available');
  });

  it('is cleared only by an explicit clear (a passing Test)', async () => {
    await store.record([scope], { kind: 'disabled', note: 'x' });
    await clearDisabledPoolMember({ providerId: 'prov', modelId: 'm' }, 'rev', store);
    expect(await store.disabledFor([scope])).toBeUndefined();
    expect(await store.cooldownFor({ id: 'rev', scopes: [scope] })).toBeUndefined();
  });

  it('needs a second bare 404 from the recovery probe before it disables, and a success in between starts over', async () => {
    const first = await store.record([scope], { kind: 'missing', status: 404 });
    expect(first.disabled).toBeUndefined();
    expect(await store.disabledFor([scope])).toBeUndefined();
    expect(await store.cooldownFor({ id: 'rev', scopes: [scope] })).toBeGreaterThan(clock);
    // A parallel request that was already in flight is the same outage, not a confirmation.
    clock += 50;
    expect((await store.record([scope], { kind: 'missing', status: 404 })).disabled).toBeUndefined();
    expect(await store.disabledFor([scope])).toBeUndefined();
    // The recovery probe after the cooldown ended is.
    clock = (await store.cooldownFor({ id: 'rev', scopes: [scope] }))! + 1;
    expect(await store.record([scope], { kind: 'missing', status: 404 })).toMatchObject({ disabled: true });
    expect((await store.disabledFor([scope]))?.note).toBe('model not found (404)');

    const other = poolEndpointScope('prov', 'rev', 'other');
    await store.record([other], { kind: 'missing', status: 404 });
    await store.markHealthy([other]);
    clock += 10 * 60_000;
    expect((await store.record([other], { kind: 'missing', status: 404 })).disabled).toBeUndefined();
  });

  it('only touches the model, never the sibling models on the account', async () => {
    await store.record([scope], { kind: 'disabled', note: 'x' });
    const sibling = poolEndpointScope('prov', 'rev', 'sibling');
    expect(await store.disabledFor([sibling, poolAccountScope('prov')])).toBeUndefined();
  });

  it('a changed endpoint is a different member: the old disabled state does not follow it', async () => {
    await store.record([scope], { kind: 'disabled', note: 'x' });
    expect(await store.disabledFor([poolEndpointScope('prov', 'new-rev', 'm')])).toBeUndefined();
  });
});

describe('showing a disabled member', () => {
  const model = { id: 'm', name: 'M', family: '', brand: '', modelFormat: 'openai' as const, upstreamModelId: 'm', npm: '@ai-sdk/openai-compatible',
    apiBaseUrl: 'http://127.0.0.1:1/v1', contextWindow: 200000, cost: { input: 0, output: 0 } };
  const provider: LocalProvider = { id: 'prov', name: 'Prov', apiKey: 'k', models: [model] };
  const revision = poolEndpointRevision({ providerId: 'prov', npm: model.npm, baseURL: model.apiBaseUrl, upstreamModelId: 'm' });
  const pool = { members: [{ providerId: 'prov', modelId: 'm' }], effort: 'auto' as const, receipts: [{
    member: { providerId: 'prov', modelId: 'm' }, endpointRevision: revision, verifiedAt: 1, expiresAt: 2, targets: ['codex' as const],
    tools: true, maxOutputTokens: 4096, contextWindow: 200000, contextSource: 'provider' as const, reasoningAccounting: 'inside-output' as const,
    effortLevels: [], billingSafe: true }] };

  it('lists it as Disabled with the reason and what to do, instead of Ready', () => {
    const ready = poolView([provider], pool).members[0]!;
    expect(ready.status).toBe('Ready');
    const view = poolView([provider], pool, new Map([['prov/m', { note: 'model no longer available', since: 1 }]]));
    expect(view.members[0]).toMatchObject({ status: 'Disabled', reason: disabledMessage('model no longer available') });
    expect(view.members[0]!.reason).toMatch(/Test it again/);
  });

  it('shows each member\'s context window, flags an estimate, and notes when routing still uses an older size', () => {
    const plain = poolView([provider], pool).members[0]!;
    expect(plain).toMatchObject({ contextWindow: 200000, routingContextWindow: 200000 });
    const estimated = { ...provider, models: [{ ...model, contextWindowEstimated: true }] };
    expect(poolView([estimated], pool).members[0]).toMatchObject({ contextSource: 'estimate' });
    const newer = { ...provider, models: [{ ...model, contextWindow: 262144 }] };
    expect(poolView([newer], pool).members[0]).toMatchObject({ contextWindow: 262144, routingContextWindow: 200000 });
  });

  it('finds disabled members through the real health store and prints a glaring launch warning', async () => {
    const root = mkdtempSync(join(tmpdir(), 'relay-disabled-ui-'));
    try {
      const store = new PoolHealthStore({ root });
      await store.record([poolEndpointScope('prov', revision, 'm')], { kind: 'disabled', note: 'model no longer available' });
      const found = await disabledPoolMembers([provider], pool, store);
      expect(found.get('prov/m')?.note).toBe('model no longer available');
      const lines: string[] = [];
      expect(await warnDisabledPoolMembers([provider], pool, store, line => lines.push(line))).toBe(1);
      expect(lines.join('\n')).toContain('prov/m');
      expect(lines.join('\n')).toContain('disabled');
    } finally { rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 }); }
  });

  it('renders a disabled skip in the log as a bold red line', () => {
    const text = formatPoolRequestLines({ at: new Date().toISOString(), outcome: 'answered', answeredBy: { providerId: 'b', modelId: 'y' },
      tried: [{ providerId: 'prov', modelId: 'm', reason: 'skipped: DISABLED: model no longer available (run Test to re-enable)' }] });
    expect(text).toContain('⛔');
    expect(text).toContain('DISABLED');
    expect(text).not.toContain('skipped:');
  });
});
