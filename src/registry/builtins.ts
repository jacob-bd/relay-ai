// src/registry/builtins.ts — Zen/Go registry stub entries (models fetched live)

import type { RegistryProvider, RegistrySubscriptionFilter } from './types.js';

export function zenRegistryStub(subscriptionFilter?: RegistrySubscriptionFilter): RegistryProvider {
  return {
    id: 'zen',
    templateId: 'zen',
    name: 'OpenCode Zen',
    enabled: true,
    authRef: 'keyring:global:opencode',
    api: {},
    ...(subscriptionFilter ? { subscriptionFilter } : {}),
    addedAt: new Date().toISOString(),
  };
}

export function goRegistryStub(): RegistryProvider {
  return {
    id: 'go',
    templateId: 'go',
    name: 'OpenCode Go',
    enabled: true,
    authRef: 'keyring:global:opencode',
    api: {},
    addedAt: new Date().toISOString(),
  };
}
