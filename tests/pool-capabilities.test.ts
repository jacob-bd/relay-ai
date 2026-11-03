import { describe, expect, it } from 'vitest';
import { currentPoolReceipt, poolEndpointRevision, type PoolCapabilityReceipt } from '../src/pool/capabilities.js';
const member = { providerId: 'account-2', modelId: 'm' };
const receipt: PoolCapabilityReceipt = {
  member, endpointRevision: 'rev', verifiedAt: 10, expiresAt: 100, targets: ['codex'], tools: true,
  maxOutputTokens: 8192, contextWindow: 128000, contextSource: 'provider', reasoningAccounting: 'inside-output',
  defaultEffort: 'high', effortLevels: ['high'], billingSafe: true,
};
describe('pool capability receipts', () => {
  it('does not reuse evidence after expiry, account or endpoint changes', () => {
    expect(currentPoolReceipt([receipt], member, 'rev', 20)).toEqual(receipt);
    expect(currentPoolReceipt([receipt], member, 'changed', 20)).toBeUndefined();
    expect(currentPoolReceipt([receipt], { ...member, providerId: 'account' }, 'rev', 20)).toBeUndefined();
    expect(currentPoolReceipt([receipt], member, 'rev', 100)).toBeUndefined();
    expect(currentPoolReceipt([receipt, receipt], member, 'rev', 20)).toBeUndefined();
  });
  it('treats a named default as optional diagnostic evidence, never an Auto prerequisite', () => {
    const diagnostic = { ...receipt, effortLevels: [] as string[] };
    delete (diagnostic as { defaultEffort?: string }).defaultEffort;
    expect(currentPoolReceipt([diagnostic], member, 'rev', 20)).toEqual(diagnostic);
    expect(currentPoolReceipt([{ ...receipt, defaultEffort: '' }], member, 'rev', 20)).toBeUndefined();
    expect(currentPoolReceipt([{ ...receipt, defaultEffort: ' high' }], member, 'rev', 20)).toBeUndefined();
  });
  it('rejects duplicate or padded effort levels instead of guessing a rung', () => {
    expect(currentPoolReceipt([{ ...receipt, effortLevels: ['high', 'high'] }], member, 'rev', 20)).toBeUndefined();
    expect(currentPoolReceipt([{ ...receipt, effortLevels: [' high'] }], member, 'rev', 20)).toBeUndefined();
    expect(currentPoolReceipt([{ ...receipt, effortLevels: ['low', 'high'] }], member, 'rev', 20)).toBeTruthy();
  });
  it('hashes endpoint/auth/header revisions deterministically without exposing headers', () => {
    const config = { providerId: 'account-2', npm: '@ai-sdk/openai-compatible', upstreamModelId: 'm', headers: { secret: 'test-only' } };
    const first = poolEndpointRevision(config);
    expect(first).not.toContain('test-only');
    expect(first).not.toBe(poolEndpointRevision({ ...config, authRef: 'new-account-key' }));
    expect(first).not.toBe(poolEndpointRevision({ ...config, baseURL: 'http://localhost' }));
  });
});
