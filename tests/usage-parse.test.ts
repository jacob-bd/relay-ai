import { describe, expect, it } from 'vitest';
import {
  parseAntigravityUsage, parseChatGptUsage, parseClaudeUsage, parseCopilotUsage, parseXaiUsage, toIsoTime,
} from '../src/usage/parse.js';

describe('toIsoTime', () => {
  it('accepts ISO strings, epoch seconds, epoch milliseconds and { seconds }', () => {
    expect(toIsoTime('2026-11-08T01:20:00Z')).toBe('2026-11-08T01:20:00.000Z');
    expect(toIsoTime(1_794_000_000)).toBe(new Date(1_794_000_000_000).toISOString());
    expect(toIsoTime(1_794_000_000_000)).toBe(new Date(1_794_000_000_000).toISOString());
    expect(toIsoTime({ seconds: '1794000000' })).toBe(new Date(1_794_000_000_000).toISOString());
    expect(toIsoTime('not a date')).toBeNull();
    expect(toIsoTime(undefined)).toBeNull();
  });
});

describe('parseClaudeUsage', () => {
  it('maps the 5-hour and weekly windows, plus model-family weekly limits when present', () => {
    const windows = parseClaudeUsage({
      five_hour: { utilization: 7, resets_at: '2026-11-08T01:20:00.267Z' },
      seven_day: { utilization: 69, resets_at: '2026-11-10T01:00:00.284Z' },
      seven_day_opus: { utilization: 12.5, resets_at: '2026-11-10T01:00:00Z' },
      seven_day_sonnet: null,
      extra_usage: { is_enabled: false },
    });
    expect(windows).toEqual([
      { id: '5h', label: '5-hour limit', usedPercent: 7, resetsAt: '2026-11-08T01:20:00.267Z', windowSeconds: 18000, scope: { type: 'account' } },
      { id: '7d', label: 'Weekly limit', usedPercent: 69, resetsAt: '2026-11-10T01:00:00.284Z', windowSeconds: 604800, scope: { type: 'account' } },
      { id: '7d:opus', label: 'Weekly Opus limit', usedPercent: 12.5, resetsAt: '2026-11-10T01:00:00.000Z', windowSeconds: 604800, scope: { type: 'model-group', family: 'opus', modelIds: [] } },
    ]);
  });

  it('keeps a window whose reset time is missing', () => {
    expect(parseClaudeUsage({ five_hour: { utilization: 0, resets_at: null } })?.[0]?.resetsAt).toBeNull();
  });

  it('returns null for an unrecognised payload', () => {
    expect(parseClaudeUsage({ error: 'nope' })).toBeNull();
    expect(parseClaudeUsage(null)).toBeNull();
    expect(parseClaudeUsage({ five_hour: { utilization: 140 } })).toBeNull();
  });
});

describe('parseChatGptUsage', () => {
  it('names windows from their length and reads reset_at in epoch seconds', () => {
    const result = parseChatGptUsage({
      plan_type: 'plus',
      rate_limit: {
        allowed: true, limit_reached: false,
        primary_window: { used_percent: 28, limit_window_seconds: 18000, reset_after_seconds: 100, reset_at: 1_794_000_000 },
        secondary_window: { used_percent: 35, limit_window_seconds: 604800, reset_after_seconds: 200, reset_at: 1_794_100_000 },
      },
    });
    expect(result?.limitReached).toBe(false);
    expect(result?.windows.map(w => [w.id, w.label, w.usedPercent, w.windowSeconds])).toEqual([
      ['5h', '5-hour limit', 28, 18000],
      ['7d', 'Weekly limit', 35, 604800],
    ]);
    expect(result?.windows[0]?.resetsAt).toBe(new Date(1_794_000_000_000).toISOString());
  });

  it('recognises the 30-day window and a reached limit', () => {
    const result = parseChatGptUsage({
      rate_limit: {
        allowed: false, limit_reached: true,
        primary_window: { used_percent: 100, limit_window_seconds: 2592000, reset_after_seconds: 3600 },
        secondary_window: null,
      },
    });
    expect(result?.limitReached).toBe(true);
    expect(result?.windows).toHaveLength(1);
    expect(result?.windows[0]).toMatchObject({ id: '30d', label: '30-day limit', usedPercent: 100 });
    expect(result?.windows[0]?.resetsAt).not.toBeNull();
  });

  it('returns null without a rate_limit block', () => {
    expect(parseChatGptUsage({ plan_type: 'free' })).toBeNull();
  });
});

const quota = (remainingFraction: number, resetTime?: string) => ({ quotaInfo: { remainingFraction, ...(resetTime ? { resetTime } : {}) } });

describe('parseAntigravityUsage', () => {
  const daily = {
    models: {
      'gemini-4-argon-high': quota(0.9871, '2026-11-14T20:15:28Z'),
      'gemini-4-argon-low': quota(0.9871, '2026-11-14T20:15:28Z'),
      'gemini-3.8-flash-high': quota(0.9444, '2026-11-07T22:04:06Z'),
      'gemini-2.5-pro': quota(0.9444, '2026-11-07T22:04:06Z'),
      'claude-opus-5-5-high': quota(1, '2026-11-08T02:09:14Z'),
      'gpt-oss-120b-medium': quota(1, '2026-11-08T02:09:14Z'),
      'tab_flash_lite_preview': quota(1),
      'chat_20706': quota(1),
    },
  };

  it('keeps the Gemini 4 allowance as its own window, separate from Gemini and Claude/GPT', () => {
    const windows = parseAntigravityUsage([daily]);
    expect(windows?.map(w => [w.label, w.usedPercent, w.resetsAt])).toEqual([
      ['Gemini 4 models', 1.29, '2026-11-14T20:15:28.000Z'],
      ['Gemini models', 5.56, '2026-11-07T22:04:06.000Z'],
      ['Claude / GPT models', 0, '2026-11-08T02:09:14.000Z'],
    ]);
    expect(windows?.[0]?.scope).toEqual({ type: 'model-group', family: 'gemini-4', modelIds: ['gemini-4-argon-high', 'gemini-4-argon-low'] });
    expect(windows?.[2]?.scope).toEqual({ type: 'model-group', family: 'shared', modelIds: ['claude-opus-5-5-high', 'gpt-oss-120b-medium'] });
  });

  it('never merges Gemini 4 into the Gemini window even when the numbers match', () => {
    const windows = parseAntigravityUsage([{
      models: {
        'gemini-4-argon-high': quota(1, '2026-11-08T00:00:00Z'),
        'gemini-3-flash': quota(1, '2026-11-08T00:00:00Z'),
      },
    }]);
    expect(windows?.map(w => w.scope.type === 'model-group' && w.scope.family)).toEqual(['gemini-4', 'gemini']);
  });

  it('merges several endpoints per model, keeping the lower remaining fraction', () => {
    const main = { models: { 'gemini-2.5-pro': quota(0.5, '2026-11-07T22:04:06Z'), 'gemini-3.8-flash-high': quota(0.9444, '2026-11-07T22:04:06Z') } };
    const windows = parseAntigravityUsage([daily, main]);
    const gemini = windows?.filter(w => w.scope.type === 'model-group' && w.scope.family === 'gemini');
    expect(gemini?.map(w => [w.usedPercent, w.scope.type === 'model-group' && w.scope.modelIds])).toEqual([
      [5.56, ['gemini-3.8-flash-high']],
      [50, ['gemini-2.5-pro']],
    ]);
  });

  it('skips helper slots and models without a reset time, and labels a Claude-only pool', () => {
    const windows = parseAntigravityUsage([{ models: { 'claude-sonnet-4-6': quota(0.153, '2026-11-08T02:09:14Z'), 'chat_23310': quota(0.2, '2026-11-08T02:09:14Z'), 'mystery': quota(0.5) } }]);
    expect(windows).toHaveLength(1);
    expect(windows?.[0]).toMatchObject({ label: 'Claude models', usedPercent: 84.7 });
  });

  it('returns null when no response carries quota', () => {
    expect(parseAntigravityUsage([{ models: {} }, null, { error: {} }])).toBeNull();
  });
});

describe('parseCopilotUsage', () => {
  const snapshot = (entitlement: number, remaining: number, percent_remaining: number, unlimited = false) => ({
    entitlement, remaining, quota_remaining: remaining, percent_remaining, unlimited, overage_count: 0, overage_permitted: false,
  });

  it('reads monthly snapshots and skips allowances the plan does not include (free plan, live shape)', () => {
    const windows = parseCopilotUsage({
      copilot_plan: 'individual',
      access_type_sku: 'free_limited_copilot',
      quota_snapshots: {
        chat: snapshot(200, 150, 75),
        completions: snapshot(2000, 2000, 100),
        premium_interactions: snapshot(0, 0, 0),
      },
      quota_reset_date: '2026-12-01',
      quota_reset_date_utc: '2026-12-01T00:00:00.000Z',
    });
    expect(windows).toEqual([
      { id: 'monthly:chat', label: 'Chat messages (monthly)', usedPercent: 25, resetsAt: '2026-12-01T00:00:00.000Z', limit: 200, remaining: 150, scope: { type: 'account' } },
      { id: 'monthly:completions', label: 'Code completions (monthly)', usedPercent: 0, resetsAt: '2026-12-01T00:00:00.000Z', limit: 2000, remaining: 2000, scope: { type: 'account' } },
    ]);
  });

  it('reports premium requests on a paid plan and skips unlimited quotas', () => {
    const windows = parseCopilotUsage({
      quota_snapshots: {
        chat: snapshot(0, 0, 100, true),
        premium_interactions: snapshot(300, 12, 4),
      },
      quota_reset_date: '2026-12-01',
    });
    expect(windows).toEqual([
      { id: 'monthly:premium_interactions', label: 'Premium requests (monthly)', usedPercent: 96, resetsAt: '2026-12-01T00:00:00.000Z', limit: 300, remaining: 12, scope: { type: 'account' } },
    ]);
  });

  it('falls back to the older free-plan counts', () => {
    const windows = parseCopilotUsage({
      monthly_quotas: { chat: 50, completions: 2000 },
      limited_user_quotas: { chat: 40, completions: 2000 },
      limited_user_reset_date: '2026-12-01',
    });
    expect(windows?.map(w => [w.id, w.usedPercent, w.limit, w.remaining])).toEqual([
      ['monthly:chat', 20, 50, 40],
      ['monthly:completions', 0, 2000, 2000],
    ]);
  });

  it('returns null when nothing is metered', () => {
    expect(parseCopilotUsage({ quota_snapshots: { chat: snapshot(0, 0, 100, true) } })).toBeNull();
  });
});

describe('parseXaiUsage', () => {
  const period = { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-11-06T18:57:13.038+00:00', end: '2026-11-13T18:57:13.038+00:00' };

  it('reads a period without a percentage as 0% used (xAI omits zero values; Grok shows 0% used)', () => {
    const result = parseXaiUsage({
      config: {
        currentPeriod: period,
        isUnifiedBillingUser: true,
        prepaidBalance: { val: 0 },
        topUpMethod: 'TOP_UP_METHOD_SAVED_PAYMENT_METHOD',
        billingPeriodStart: period.start,
        billingPeriodEnd: period.end,
      },
    });
    expect(result?.windows).toEqual([
      { id: 'credits', label: 'Weekly limit', usedPercent: 0, resetsAt: '2026-11-13T18:57:13.038Z', windowSeconds: 604800, scope: { type: 'account' } },
    ]);
    expect(result?.balances).toEqual([{ id: 'extra-credits', label: 'Extra usage credits', amount: 0, currency: 'USD' }]);
  });

  it('uses the period from billingPeriodStart/End when currentPeriod is absent, still 0% without a percentage', () => {
    const result = parseXaiUsage({ config: { billingPeriodStart: period.start, billingPeriodEnd: period.end } });
    expect(result?.windows[0]).toMatchObject({ id: 'credits', label: 'Weekly limit', usedPercent: 0 });
    expect(result?.balances).toEqual([]);
  });

  it('keeps a reported percentage, and reads per-product percentages', () => {
    const result = parseXaiUsage({
      config: {
        currentPeriod: { ...period, type: 'USAGE_PERIOD_TYPE_MONTHLY', end: '2026-12-06T18:57:13Z' },
        creditUsagePercent: 42,
        productUsage: [{ product: 'GrokCli', usagePercent: 30 }, { product: 'GrokImagine', usagePercent: 12 }, { product: 'Bad' }],
      },
    });
    expect(result?.windows.map(w => [w.id, w.label, w.usedPercent])).toEqual([
      ['credits', 'Monthly limit', 42],
      ['product:GrokCli', 'Grok Cli', 30],
      ['product:GrokImagine', 'Grok Imagine', 12],
    ]);
  });

  it('reads the prepaid balance in cents as dollars, with no allowance total on the window', () => {
    const result = parseXaiUsage({ config: { currentPeriod: period, creditUsagePercent: 50, prepaidBalance: { val: '1250' } } });
    expect(result?.balances).toEqual([{ id: 'extra-credits', label: 'Extra usage credits', amount: 12.5, currency: 'USD' }]);
    expect(result?.windows[0]).not.toHaveProperty('limit');
    expect(result?.windows[0]).not.toHaveProperty('remaining');
  });

  it('accepts an unwrapped payload', () => {
    expect(parseXaiUsage({ creditUsagePercent: 5, currentPeriod: period })?.windows[0]).toMatchObject({ id: 'credits', usedPercent: 5 });
  });

  it('returns null without a period, a percentage or a balance', () => {
    expect(parseXaiUsage({ config: { isUnifiedBillingUser: true } })).toBeNull();
  });
});
