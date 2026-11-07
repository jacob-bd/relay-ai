import type { FavoriteModel, FreePoolPreferences, PoolCapabilityReceipt } from '../types.js';
import { parsePoolReceipt } from './capabilities.js';

export function parseFreePool(value: unknown): FreePoolPreferences {
  if (value === undefined) return { members: [], effort: 'auto', receipts: [] };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid free pool configuration');
  const { members, effort, receipts, enabled } = value as Record<string, unknown>;
  if (enabled !== undefined && typeof enabled !== 'boolean') throw new Error('Invalid free pool enabled setting');
  if (!Array.isArray(members) || !['auto', 'low', 'medium', 'high'].includes(String(effort))) {
    throw new Error('Invalid free pool members or effort');
  }
  const result: FavoriteModel[] = [];
  const seen = new Set<string>();
  for (const member of members) {
    if (!member || typeof member !== 'object' || Array.isArray(member)) throw new Error('Invalid free pool member');
    const { providerId, modelId } = member as Record<string, unknown>;
    if (typeof providerId !== 'string' || !providerId.trim() || providerId !== providerId.trim()
      || typeof modelId !== 'string' || !modelId.trim() || modelId !== modelId.trim()) {
      throw new Error('Free pool members require a provider account and model');
    }
    const key = JSON.stringify([providerId, modelId]);
    if (seen.has(key)) throw new Error('Duplicate free pool member');
    seen.add(key);
    result.push({ providerId, modelId });
  }
  const parsedReceipts: PoolCapabilityReceipt[] = [];
  if (receipts !== undefined) {
    if (!Array.isArray(receipts)) throw new Error('Invalid free pool receipts');
    const seenReceipts = new Set<string>();
    for (const raw of receipts) {
      const receipt = parsePoolReceipt(raw);
      if (!receipt) throw new Error('Invalid free pool receipt');
      const key = JSON.stringify([receipt.member.providerId, receipt.member.modelId, receipt.endpointRevision]);
      if (seenReceipts.has(key)) throw new Error('Duplicate free pool receipt');
      seenReceipts.add(key);
      parsedReceipts.push(receipt);
    }
  }
  return { ...(enabled === undefined ? {} : { enabled: enabled as boolean }), members: result, effort: effort as FreePoolPreferences['effort'], receipts: parsedReceipts };
}

export function addFreePoolMember(pool: FreePoolPreferences, member: FavoriteModel): FreePoolPreferences {
  return parseFreePool({ ...pool, members: [...pool.members, member] });
}

export function removeFreePoolMember(pool: FreePoolPreferences, member: FavoriteModel): FreePoolPreferences {
  return parseFreePool({
    ...pool,
    members: pool.members.filter(item => item.providerId !== member.providerId || item.modelId !== member.modelId),
    receipts: pool.receipts.filter(item => item.member.providerId !== member.providerId || item.member.modelId !== member.modelId),
  });
}

/** Move a member to an absolute index (0-based). No-op when already there. */
export function moveFreePoolMemberTo(pool: FreePoolPreferences, member: FavoriteModel, toIndex: number): FreePoolPreferences {
  const from = pool.members.findIndex(item => item.providerId === member.providerId && item.modelId === member.modelId);
  if (from < 0) throw new Error('Model is not in the pool');
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= pool.members.length) throw new Error('Invalid priority change');
  if (from === toIndex) return pool;
  const members = [...pool.members];
  const [item] = members.splice(from, 1);
  members.splice(toIndex, 0, item!);
  return parseFreePool({ ...pool, members });
}
