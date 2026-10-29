// src/registry/builtins.ts — Zen/Go registry stub entries (models fetched live)

import type { RegistryProvider, RegistrySubscriptionFilter } from './types.js';
import { localIsoTimestamp } from '../trace-log.js';

/** A numbered account (`zen-2`) has its own id, name and key; the first account uses the defaults. */
export interface OpencodeAccountSlot {
  id: string;
  name: string;
  authRef: string;
  nameCustomized?: boolean;
}

export function zenRegistryStub(subscriptionFilter?: RegistrySubscriptionFilter, account?: OpencodeAccountSlot): RegistryProvider {
  return {
    id: account?.id ?? 'zen',
    templateId: 'zen',
    name: account?.name ?? 'OpenCode Zen',
    ...(account?.nameCustomized ? { nameCustomized: true } : {}),
    enabled: true,
    authRef: account?.authRef ?? 'keyring:global:opencode',
    api: {},
    ...(subscriptionFilter ? { subscriptionFilter } : {}),
    addedAt: localIsoTimestamp(),
  };
}

export function goRegistryStub(account?: OpencodeAccountSlot): RegistryProvider {
  return {
    id: account?.id ?? 'go',
    templateId: 'go',
    name: account?.name ?? 'OpenCode Go',
    ...(account?.nameCustomized ? { nameCustomized: true } : {}),
    enabled: true,
    authRef: account?.authRef ?? 'keyring:global:opencode',
    api: {},
    addedAt: localIsoTimestamp(),
  };
}
