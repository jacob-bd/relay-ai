// src/usage/parse.ts — turn each provider's usage response into Relay usage windows (pure, no I/O).

import { isAntigravityCloudCodeHelperSlot } from '../model-compatibility.js';
import type { RelayUsageBalance, RelayUsageWindow } from '../core/types.js';

type Json = Record<string, unknown>;

const FIVE_HOURS = 5 * 3600;
const SEVEN_DAYS = 7 * 86400;
const THIRTY_DAYS = 30 * 86400;

function obj(value: unknown): Json | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Json : undefined;
}

function percent(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** ISO string, epoch seconds, epoch milliseconds, or `{ seconds }` → ISO string. */
export function toIsoTime(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return new Date(value < 1e12 ? value * 1000 : value).toISOString();
  }
  const seconds = obj(value)?.['seconds'];
  if (seconds !== undefined) return toIsoTime(typeof seconds === 'string' ? Number(seconds) : seconds);
  return null;
}

function durationLabel(seconds: number): { id: string; label: string } {
  if (seconds === FIVE_HOURS) return { id: '5h', label: '5-hour limit' };
  if (seconds === SEVEN_DAYS) return { id: '7d', label: 'Weekly limit' };
  if (seconds === THIRTY_DAYS) return { id: '30d', label: '30-day limit' };
  const hours = Math.round(seconds / 3600);
  return hours % 24 === 0 ? { id: `${hours / 24}d`, label: `${hours / 24}-day limit` } : { id: `${hours}h`, label: `${hours}-hour limit` };
}

/** Claude Code OAuth: `GET api.anthropic.com/api/oauth/usage` (utilization is already 0–100). */
export function parseClaudeUsage(payload: unknown): RelayUsageWindow[] | null {
  const data = obj(payload);
  if (!data) return null;
  const windows: RelayUsageWindow[] = [];
  const add = (key: string, id: string, label: string, windowSeconds: number, family?: string) => {
    const raw = obj(data[key]);
    const used = percent(raw?.['utilization']);
    if (used === null) return;
    windows.push({
      id, label, usedPercent: used, resetsAt: toIsoTime(raw?.['resets_at']), windowSeconds,
      scope: family ? { type: 'model-group', family, modelIds: [] } : { type: 'account' },
    });
  };
  add('five_hour', '5h', '5-hour limit', FIVE_HOURS);
  add('seven_day', '7d', 'Weekly limit', SEVEN_DAYS);
  add('seven_day_opus', '7d:opus', 'Weekly Opus limit', SEVEN_DAYS, 'opus');
  add('seven_day_sonnet', '7d:sonnet', 'Weekly Sonnet limit', SEVEN_DAYS, 'sonnet');
  return windows.length ? windows : null;
}

/** ChatGPT / Codex OAuth: `GET chatgpt.com/backend-api/wham/usage`. */
export function parseChatGptUsage(payload: unknown): { windows: RelayUsageWindow[]; limitReached: boolean } | null {
  const rate = obj(obj(payload)?.['rate_limit']);
  if (!rate) return null;
  const windows: RelayUsageWindow[] = [];
  for (const key of ['primary_window', 'secondary_window']) {
    const w = obj(rate[key]);
    const used = percent(w?.['used_percent']);
    const seconds = w?.['limit_window_seconds'];
    if (used === null || typeof seconds !== 'number' || seconds <= 0) continue;
    const resetAfter = w?.['reset_after_seconds'];
    const resetsAt = toIsoTime(w?.['reset_at'])
      ?? (typeof resetAfter === 'number' && resetAfter >= 0 ? new Date(Date.now() + resetAfter * 1000).toISOString() : null);
    windows.push({ ...durationLabel(seconds), usedPercent: used, resetsAt, windowSeconds: seconds, scope: { type: 'account' } });
  }
  if (!windows.length) return null;
  return { windows, limitReached: rate['limit_reached'] === true || rate['allowed'] === false };
}

type AntigravityPool = 'gemini-4' | 'gemini' | 'shared';

/** Gemini 4 has its own allowance on pro accounts, so it never merges with another bucket. */
function antigravityPool(modelId: string): AntigravityPool {
  if (/^gemini-4(?:[.-]|$)/.test(modelId)) return 'gemini-4';
  if (modelId.startsWith('gemini')) return 'gemini';
  return 'shared';
}

function antigravityGroupLabel(pool: AntigravityPool, modelIds: string[]): string {
  if (pool === 'gemini-4') return 'Gemini 4 models';
  if (pool === 'gemini') return 'Gemini models';
  const brands = new Set(modelIds.map(id => id.startsWith('claude') ? 'Claude' : id.startsWith('gpt') ? 'GPT' : 'Other'));
  return `${[...brands].join(' / ')} models`;
}

/**
 * Antigravity: one or more `fetchAvailableModels` responses for the same account. Each model reports
 * `quotaInfo.remainingFraction` (0–1) and `resetTime`; models that share a pool report the same pair.
 * Responses from several Cloud Code endpoints are merged per model, keeping the lower remaining fraction.
 */
export function parseAntigravityUsage(responses: unknown[]): RelayUsageWindow[] | null {
  const perModel = new Map<string, { remaining: number; resetTime: string }>();
  for (const response of responses) {
    const models = obj(obj(response)?.['models']);
    if (!models) continue;
    for (const [id, raw] of Object.entries(models)) {
      if (isAntigravityCloudCodeHelperSlot(id)) continue;
      const quota = obj(obj(raw)?.['quotaInfo']);
      const remaining = quota?.['remainingFraction'];
      const resetTime = toIsoTime(quota?.['resetTime']);
      // Entries without a reset time are internal helpers (tab completion, chat slots), not usage pools.
      if (typeof remaining !== 'number' || !Number.isFinite(remaining) || !resetTime) continue;
      const clamped = Math.min(1, Math.max(0, remaining));
      const existing = perModel.get(id);
      if (!existing || clamped < existing.remaining) perModel.set(id, { remaining: clamped, resetTime });
    }
  }
  if (!perModel.size) return null;

  const groups = new Map<string, { pool: AntigravityPool; remaining: number; resetTime: string; modelIds: string[] }>();
  for (const [id, { remaining, resetTime }] of perModel) {
    const pool = antigravityPool(id);
    const key = `${pool}|${remaining}|${resetTime}`;
    const group = groups.get(key) ?? { pool, remaining, resetTime, modelIds: [] };
    group.modelIds.push(id);
    groups.set(key, group);
  }

  const order: AntigravityPool[] = ['gemini-4', 'gemini', 'shared'];
  return [...groups.values()]
    .sort((a, b) => order.indexOf(a.pool) - order.indexOf(b.pool) || a.resetTime.localeCompare(b.resetTime))
    .map(group => {
      group.modelIds.sort();
      return {
        id: `models:${group.pool}:${group.resetTime}`,
        label: antigravityGroupLabel(group.pool, group.modelIds),
        usedPercent: round((1 - group.remaining) * 100),
        resetsAt: group.resetTime,
        scope: { type: 'model-group', family: group.pool, modelIds: group.modelIds },
      };
    });
}

const COPILOT_QUOTA_LABELS: Record<string, string> = {
  premium_interactions: 'Premium requests',
  chat: 'Chat messages',
  completions: 'Code completions',
};

/** GitHub Copilot: `GET api.github.com/copilot_internal/user` (monthly quotas). */
export function parseCopilotUsage(payload: unknown): RelayUsageWindow[] | null {
  const data = obj(payload);
  if (!data) return null;
  const resetsAt = toIsoTime(data['quota_reset_date_utc']) ?? toIsoTime(data['quota_reset_date'])
    ?? toIsoTime(data['limited_user_reset_date']);
  const windows: RelayUsageWindow[] = [];

  const snapshots = obj(data['quota_snapshots']);
  if (snapshots) {
    for (const [key, raw] of Object.entries(snapshots)) {
      const snap = obj(raw);
      if (!snap || snap['unlimited'] === true) continue;
      const entitlement = snap['entitlement'];
      // Free plans list premium requests with a zero allowance: not part of the plan, not "100% used".
      if (entitlement === 0) continue;
      let used: number | null = null;
      const remainingPct = percent(snap['percent_remaining']);
      const remaining = snap['remaining'];
      if (remainingPct !== null) used = round(100 - remainingPct);
      else if (typeof entitlement === 'number' && entitlement > 0 && typeof remaining === 'number') {
        used = round(Math.min(100, Math.max(0, (1 - remaining / entitlement) * 100)));
      }
      if (used === null) continue;
      windows.push({
        id: `monthly:${key}`, label: `${COPILOT_QUOTA_LABELS[key] ?? key} (monthly)`, usedPercent: used, resetsAt,
        ...(typeof entitlement === 'number' && entitlement > 0 ? { limit: entitlement } : {}),
        ...(typeof remaining === 'number' ? { remaining } : {}),
        scope: { type: 'account' },
      });
    }
  }

  // Free plans report counts instead of snapshots: `monthly_quotas` (allowance) and `limited_user_quotas` (left).
  const monthly = obj(data['monthly_quotas']);
  const left = obj(data['limited_user_quotas']);
  if (!windows.length && monthly && left) {
    for (const [key, total] of Object.entries(monthly)) {
      const remaining = left[key];
      if (typeof total !== 'number' || total <= 0 || typeof remaining !== 'number') continue;
      windows.push({
        id: `monthly:${key}`, label: `${COPILOT_QUOTA_LABELS[key] ?? key} (monthly)`,
        usedPercent: round(Math.min(100, Math.max(0, (1 - remaining / total) * 100))), resetsAt,
        limit: total, remaining, scope: { type: 'account' },
      });
    }
  }
  return windows.length ? windows : null;
}

/**
 * xAI SuperGrok: `GET cli-chat-proxy.grok.com/v1/billing?format=credits` (what the Grok CLI's `/usage` reads;
 * not a documented xAI API). One pool shared across Grok products, with optional per-product slices.
 */
export function parseXaiUsage(payload: unknown): { windows: RelayUsageWindow[]; balances: RelayUsageBalance[] } | null {
  const outer = obj(payload);
  const data = obj(outer?.['config']) ?? outer;
  if (!data) return null;
  const period = obj(data['currentPeriod']) ?? obj(data['current_period']);
  const start = toIsoTime(period?.['start'] ?? period?.['startTime'] ?? data['billingPeriodStart']);
  const end = toIsoTime(period?.['end'] ?? period?.['endTime'] ?? data['billingPeriodEnd']);
  const windowSeconds = start && end ? Math.round((Date.parse(end) - Date.parse(start)) / 1000) : undefined;
  const periodType = typeof period?.['type'] === 'string' ? period['type'] : '';
  const windows: RelayUsageWindow[] = [];

  const reported = percent(data['creditUsagePercent'] ?? data['credit_usage_percent']);
  if (reported !== null || end) {
    // xAI leaves zero-valued fields out: a period without a percentage is 0% used (Grok's own Usage page agrees).
    const used = reported ?? 0;
    const label = periodType.endsWith('WEEKLY') || (windowSeconds && Math.abs(windowSeconds - SEVEN_DAYS) < 3600) ? 'Weekly limit'
      : periodType.endsWith('MONTHLY') || (windowSeconds && windowSeconds > 27 * 86400) ? 'Monthly limit' : 'Usage limit';
    windows.push({
      id: 'credits', label, usedPercent: used, resetsAt: end,
      ...(windowSeconds && windowSeconds > 0 ? { windowSeconds } : {}), scope: { type: 'account' },
    });
  }

  const products = data['productUsage'] ?? data['product_usage'];
  if (Array.isArray(products)) {
    for (const raw of products) {
      const item = obj(raw);
      const product = typeof item?.['product'] === 'string' ? item['product'] : undefined;
      const used = percent(item?.['usagePercent'] ?? item?.['usage_percent']);
      if (!product || used === null) continue;
      windows.push({
        id: `product:${product}`, label: product.replace(/([a-z])([A-Z])/g, '$1 $2'), usedPercent: used, resetsAt: end,
        ...(windowSeconds && windowSeconds > 0 ? { windowSeconds } : {}), scope: { type: 'account' },
      });
    }
  }

  // Extra usage credits, in US cents (same `{ val }` money shape as xAI's billing API).
  const balances: RelayUsageBalance[] = [];
  const prepaid = obj(data['prepaidBalance'] ?? data['prepaid_balance']);
  if (prepaid) {
    const raw = prepaid['val'] ?? 0;
    const cents = typeof raw === 'string' ? Number(raw) : raw;
    if (typeof cents === 'number' && Number.isFinite(cents)) {
      balances.push({ id: 'extra-credits', label: 'Extra usage credits', amount: cents / 100, currency: 'USD' });
    }
  }
  return windows.length || balances.length ? { windows, balances } : null;
}
