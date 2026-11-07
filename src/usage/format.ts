// src/usage/format.ts — plain-text usage lines for the CLI (pure).

import type { RelayAccountUsage, RelayUsageWindow } from '../core/types.js';

function resetText(resetsAt: string | null, now: number): string {
  if (!resetsAt) return '';
  const ms = Date.parse(resetsAt) - now;
  if (!Number.isFinite(ms)) return '';
  if (ms <= 0) return 'reset';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `resets in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `resets in ${hours}h ${minutes % 60}m`;
  return `resets in ${Math.round(hours / 24)}d`;
}

export function formatUsd(amount: number): string {
  return `US$${amount.toFixed(2)}`;
}

/** A window whose reset time has passed counts as unused until the next check. */
export function effectiveUsedPercent(window: RelayUsageWindow, now = Date.now()): number | null {
  if (window.resetsAt && Date.parse(window.resetsAt) <= now) return 0;
  return window.usedPercent;
}

export function formatUsageWindow(window: RelayUsageWindow, now = Date.now()): string {
  const used = effectiveUsedPercent(window, now);
  const pct = used === null ? 'unknown' : `${Math.round(used)}% used`;
  const counts = window.limit !== undefined && window.remaining !== undefined ? ` (${window.remaining}/${window.limit} left)` : '';
  const reset = resetText(window.resetsAt, now);
  return `${window.label}: ${pct}${counts}${reset ? ` · ${reset}` : ''}`;
}

export function formatAccountUsage(account: RelayAccountUsage, now = Date.now()): string[] {
  const head = `${account.providerName} (${account.providerId})`;
  if (account.status === 'unsupported') return [`${head}: usage not available for this provider`];
  if (account.status === 'unchecked') return [`${head}: not checked yet`];
  const lines = [head];
  if (account.error) lines.push(`  ! ${account.error.message}${account.windows.length ? ' Showing the last reading.' : ''}`);
  if (account.limitReached) lines.push('  ! Limit reached');
  for (const window of account.windows) lines.push(`  ${formatUsageWindow(window, now)}`);
  for (const balance of account.balances ?? []) lines.push(`  ${balance.label}: ${formatUsd(balance.amount)}`);
  if (account.status === 'ok' && !account.windows.length && !account.balances?.length) lines.push('  No usage limits reported');
  return lines;
}
