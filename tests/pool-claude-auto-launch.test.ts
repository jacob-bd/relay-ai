import { describe, expect, it } from 'vitest';
import { prepareClaudeAutoPool } from '../src/pool/claude-launch.js';
import { poolEndpointRevision } from '../src/pool/capabilities.js';
import type { LocalProvider, PoolCapabilityReceipt } from '../src/types.js';

const member = { providerId: 'account-2', modelId: 'm' };
const model = {
  id: 'm', name: 'Free Model', modelFormat: 'openai' as const,
  npm: '@ai-sdk/openai-compatible', upstreamModelId: 'm', contextWindow: 128000,
  cost: { input: 0, output: 0 },
};
const provider: LocalProvider = {
  id: 'account-2', name: 'Account 2', models: [model], authType: 'api', apiKey: 'key',
  baseUrl: 'https://example.test', completionsUrl: 'https://example.test/v1/chat/completions',
};
const revision = poolEndpointRevision({
  providerId: provider.id, authRef: provider.authRef, npm: model.npm,
  baseURL: model.apiBaseUrl, upstreamModelId: model.upstreamModelId, headers: provider.headers,
});
const receipt: PoolCapabilityReceipt = {
  member, endpointRevision: revision,
  verifiedAt: Date.now() - 1000, expiresAt: Date.now() + 3_600_000,
  targets: ['claude'], tools: true, maxOutputTokens: 4096,
  contextWindow: 128000, contextSource: 'provider',
  reasoningAccounting: 'inside-output', effortLevels: [], billingSafe: true,
};
function prefs(enabled: boolean, receipts: PoolCapabilityReceipt[] = [receipt]) {
  return { freePool: { enabled, members: [member], effort: 'auto' as const, receipts } };
}

describe('Claude auto pool gate', () => {
  it('adds Relay Free Pool when enabled and a fresh receipt is servable', () => {
    const pool = prepareClaudeAutoPool(prefs(true), [provider]);
    expect(pool?.displayName).toBe('Relay Free Pool');
    expect(pool?.contextWindow).toBeLessThan(128000);
    expect(pool?.runtime).toBeDefined();
  });
  it('stays out of the launch unless explicitly enabled', () => {
    expect(prepareClaudeAutoPool(prefs(false), [provider])).toBeUndefined();
    expect(prepareClaudeAutoPool({}, [provider])).toBeUndefined();
  });
  it('ignores non-Claude and unverified-tool receipts, and does not retire a member by age', () => {
    const stale = { ...receipt, expiresAt: Date.now() - 1 };
    expect(prepareClaudeAutoPool(prefs(true, [stale]), [provider])).toBeDefined();
    const codexOnly = { ...receipt, targets: ['codex'] as PoolCapabilityReceipt['targets'] };
    expect(prepareClaudeAutoPool(prefs(true, [codexOnly]), [provider])).toBeUndefined();
    const noTools = { ...receipt, tools: false };
    expect(prepareClaudeAutoPool(prefs(true, [noTools]), [provider])).toBeUndefined();
  });
  it('rejects paid and context-estimated members', () => {
    const paid: LocalProvider = { ...provider, models: [{ ...model, cost: { input: 1, output: 2 } }] };
    expect(prepareClaudeAutoPool(prefs(true), [paid])).toBeUndefined();
    const estimated: LocalProvider = { ...provider, models: [{ ...model, contextWindowEstimated: true }] };
    expect(prepareClaudeAutoPool(prefs(true), [estimated])).toBeUndefined();
  });
  it('rejects members missing from the live provider catalog', () => {
    expect(prepareClaudeAutoPool(prefs(true), [])).toBeUndefined();
  });
  it('treats malformed saved pool data as disabled', () => {
    expect(prepareClaudeAutoPool({ freePool: { members: 'nope' } } as never, [provider])).toBeUndefined();
  });
});
