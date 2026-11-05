import { describe, expect, it } from 'vitest';
import { codexPoolCatalogEntry } from '../src/pool/catalog.js';
import type { PoolCapabilityReceipt } from '../src/pool/capabilities.js';
const members = [{ providerId: 'a', modelId: 'm' }, { providerId: 'b', modelId: 'm' }];
const receipts: PoolCapabilityReceipt[] = members.map((member, i) => ({
  member, endpointRevision: 'r', verifiedAt: 0, expiresAt: 100, targets: ['codex'], tools: true,
  maxOutputTokens: 8192, contextWindow: i ? 128000 : 256000, contextSource: 'provider',
  reasoningAccounting: 'inside-output', effortLevels: i ? ['high'] : ['medium', 'high'], billingSafe: true,
}));
const pool = { members, effort: 'auto' as const, receipts: [] };
describe('shared pool catalog entry', () => {
  it('advertises one model with the minimum context minus its reserve and common efforts', () => {
    expect(codexPoolCatalogEntry(pool, receipts, 10)).toMatchObject({
      id: 'relay-free-pool',
      context_window: 115200,
      supported_reasoning_levels: [{ effort: 'high', description: 'high' }],
    });
  });
  it('keeps advertising while one member is verified and refuses when none are', () => {
    expect(codexPoolCatalogEntry(pool, receipts.slice(0, 1), 10)).toMatchObject({ context_window: 230400 });
    expect(codexPoolCatalogEntry({ members: [], effort: 'auto', receipts: [] }, [], 10)).toBeUndefined();
    // Time alone never retires a verified member.
    expect(codexPoolCatalogEntry(pool, receipts, 100)).toMatchObject({ context_window: 115200 });
  });
  it('refuses receipts with a future verification time', () => {
    expect(codexPoolCatalogEntry(pool, receipts.map(item => ({ ...item, verifiedAt: 11 })), 10)).toBeUndefined();
  });
});
