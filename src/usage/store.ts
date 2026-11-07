// src/usage/store.ts — last usage reading per account in <RELAY_AI_HOME>/usage.json (no credentials).

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getAppHome } from '../paths.js';
import type { RelayAccountUsage } from '../core/types.js';

const STORE_VERSION = 1;

interface UsageStore {
  version: number;
  accounts: Record<string, RelayAccountUsage>;
}

export function usageStorePath(): string {
  return join(getAppHome(), 'usage.json');
}

function readStore(path: string): UsageStore {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as UsageStore;
    if (parsed?.version === STORE_VERSION && parsed.accounts && typeof parsed.accounts === 'object') return parsed;
  } catch { /* missing or unreadable: start empty */ }
  return { version: STORE_VERSION, accounts: {} };
}

/** Stored readings, keyed by provider id. */
export function loadStoredUsage(path = usageStorePath()): Record<string, RelayAccountUsage> {
  return readStore(path).accounts;
}

/**
 * Merge fresh results into the store. A failed check keeps the account's last good windows
 * (and their `fetchedAt`) and only records the error.
 */
export function saveUsageResults(results: RelayAccountUsage[], path = usageStorePath()): Record<string, RelayAccountUsage> {
  const store = readStore(path);
  for (const result of results) {
    const previous = store.accounts[result.providerId];
    store.accounts[result.providerId] = result.status === 'error' && previous?.windows.length
      ? { ...result, windows: previous.windows, ...(previous.balances ? { balances: previous.balances } : {}), fetchedAt: previous.fetchedAt, ...(previous.limitReached !== undefined ? { limitReached: previous.limitReached } : {}) }
      : result;
  }
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
  try { chmodSync(path, 0o600); } catch { /* best effort */ }
  return store.accounts;
}
