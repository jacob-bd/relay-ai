// tests/core-usage.test.ts — on-demand usage checks through Relay Core (fake credentials, scripted upstream).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TOKENS: Record<string, string> = {
  'keyring:oauth:provider:claude-code': 'claude-access-canary',
  'keyring:oauth:provider:openai-oauth': 'chatgpt-access-canary',
  'keyring:oauth:provider:antigravity': 'agy-access-canary',
  'keyring:oauth:provider:xai-oauth': 'xai-access-canary',
  'keyring:oauth:provider:github-copilot': 'copilot-session-canary',
  'keyring:oauth:provider:cline-pass': 'cline-canary',
};

vi.mock('../src/env.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/env.js')>()),
  resolveProviderCredential: vi.fn(async (_id: string, authRef: string) => TOKENS[authRef] ?? null),
  resolveProviderOAuthAccountId: vi.fn(async () => 'acct-123'),
  readStoredOAuthCredential: vi.fn(async (authRef: string) =>
    authRef.endsWith('github-copilot') ? { type: 'oauth', access: 'copilot-session-canary', refresh: 'ghu_canary', expires: 0 } : undefined),
}));

const { checkUsageAfterSignIn, getRelayAccountUsage, readRelayAccountUsage } = await import('../src/core/usage.js');
const { formatAccountUsage } = await import('../src/usage/format.js');
const { parseProvidersArgs } = await import('../src/providers-command.js');

function oauthProvider(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, templateId: id, name: `${id} account`, enabled: true,
    authRef: `keyring:oauth:provider:${id}`, authType: 'oauth',
    api: { npm: '@ai-sdk/anthropic', url: '' }, addedAt: '2026-11-01T00:00:00Z', ...extra,
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const PAYLOADS: Record<string, unknown> = {
  'api.anthropic.com': { five_hour: { utilization: 7, resets_at: '2026-11-08T01:20:00Z' }, seven_day: { utilization: 69, resets_at: '2026-11-10T01:00:00Z' } },
  'chatgpt.com': { rate_limit: { allowed: true, limit_reached: false, primary_window: { used_percent: 28, limit_window_seconds: 18000, reset_at: 1_794_000_000 } } },
  'cloudcode-pa.googleapis.com': { models: { 'gemini-4-argon-high': { quotaInfo: { remainingFraction: 0.9, resetTime: '2026-11-14T20:15:28Z' } }, 'claude-sonnet-4-6': { quotaInfo: { remainingFraction: 1, resetTime: '2026-11-08T02:09:14Z' } } } },
  'cli-chat-proxy.grok.com': { config: { creditUsagePercent: 12, prepaidBalance: { val: 0 }, currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-11-06T18:57:13Z', end: '2026-11-13T18:57:13Z' } } },
  'api.github.com': { quota_snapshots: { premium_interactions: { entitlement: 300, remaining: 150, percent_remaining: 50, unlimited: false } }, quota_reset_date_utc: '2026-12-01T00:00:00Z' },
};

function scriptedFetch(override: (host: string) => Response | undefined = () => undefined) {
  const calls: Array<{ url: string; headers: Record<string, string>; method: string }> = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const host = new URL(url).hostname.replace(/^(daily-)?/, '').replace(/\.sandbox/, '');
    calls.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()), method: init?.method ?? 'GET' });
    const forced = override(new URL(url).hostname);
    if (forced) return forced;
    const payload = Object.entries(PAYLOADS).find(([key]) => host.endsWith(key))?.[1];
    return payload ? json(payload) : json({ error: 'not found' }, 404);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('Relay Core on-demand usage', () => {
  let home: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'relay-core-usage-'));
    prevHome = process.env.RELAY_AI_HOME;
    process.env.RELAY_AI_HOME = home;
    writeRegistry([
      oauthProvider('claude-code'),
      oauthProvider('openai-oauth'),
      oauthProvider('antigravity'),
      oauthProvider('xai-oauth'),
      oauthProvider('github-copilot'),
      oauthProvider('cline-pass'),
      { ...oauthProvider('groq'), authType: 'api', authRef: 'keyring:provider:groq' },
      oauthProvider('claude-code-2', { enabled: false, templateId: 'claude-code' }),
    ]);
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.RELAY_AI_HOME;
    else process.env.RELAY_AI_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  });

  function writeRegistry(providers: unknown[]) {
    writeFileSync(join(home, 'providers.json'), JSON.stringify({ schemaVersion: 1, providers }));
  }

  const byId = (accounts: Array<{ providerId: string }>) => Object.fromEntries(accounts.map(a => [a.providerId, a])) as Record<string, any>;

  it('checks every enabled OAuth account with each provider’s own request, and saves the readings', async () => {
    const { fetchImpl, calls } = scriptedFetch();
    const accounts = byId(await getRelayAccountUsage({ fetchImpl }));

    expect(Object.keys(accounts).sort()).toEqual(['antigravity', 'claude-code', 'cline-pass', 'github-copilot', 'openai-oauth', 'xai-oauth']);
    expect(accounts['claude-code'].windows.map((w: any) => [w.id, w.usedPercent])).toEqual([['5h', 7], ['7d', 69]]);
    expect(accounts['openai-oauth'].windows[0]).toMatchObject({ id: '5h', usedPercent: 28 });
    expect(accounts['antigravity'].windows.map((w: any) => w.label)).toEqual(['Gemini 4 models', 'Claude models']);
    expect(accounts['xai-oauth'].windows[0]).toMatchObject({ id: 'credits', label: 'Weekly limit', usedPercent: 12 });
    expect(accounts['xai-oauth'].balances).toEqual([{ id: 'extra-credits', label: 'Extra usage credits', amount: 0, currency: 'USD' }]);
    expect(accounts['github-copilot'].windows[0]).toMatchObject({ id: 'monthly:premium_interactions', usedPercent: 50, limit: 300, remaining: 150 });
    expect(accounts['cline-pass']).toMatchObject({ status: 'unsupported', windows: [], fetchedAt: null });
    for (const id of ['claude-code', 'openai-oauth', 'antigravity', 'xai-oauth', 'github-copilot']) {
      expect(accounts[id].status).toBe('ok');
      expect(accounts[id].fetchedAt).toEqual(expect.any(String));
    }

    const header = (host: string, name: string) => calls.find(c => c.url.includes(host))?.headers[name];
    expect(header('api.anthropic.com', 'authorization')).toBe('Bearer claude-access-canary');
    expect(header('api.anthropic.com', 'anthropic-beta')).toBe('oauth-2025-04-20');
    expect(header('chatgpt.com', 'chatgpt-account-id')).toBe('acct-123');
    expect(header('grok.com', 'x-xai-token-auth')).toBe('xai-grok-cli');
    // Copilot's user endpoint takes the GitHub token, not the short-lived Copilot session token.
    expect(header('api.github.com', 'authorization')).toBe('Bearer ghu_canary');
    expect(calls.filter(c => c.url.includes('fetchAvailableModels')).every(c => c.method === 'POST')).toBe(true);

    const saved = readFileSync(join(home, 'usage.json'), 'utf8');
    expect(Object.keys(JSON.parse(saved).accounts).sort()).toEqual(['antigravity', 'claude-code', 'github-copilot', 'openai-oauth', 'xai-oauth']);
    expect(saved).not.toMatch(/canary/);
  });

  it('checks only the requested account', async () => {
    const { fetchImpl, calls } = scriptedFetch();
    const accounts = await getRelayAccountUsage({ providerIds: ['claude-code'], fetchImpl });
    expect(accounts.map(a => a.providerId)).toEqual(['claude-code']);
    expect(calls).toHaveLength(1);
  });

  it('reads saved usage without any network request, marking never-checked accounts', async () => {
    const { fetchImpl } = scriptedFetch();
    await getRelayAccountUsage({ providerIds: ['claude-code'], fetchImpl });

    const offline = scriptedFetch();
    const accounts = byId(await readRelayAccountUsage({ fetchImpl: offline.fetchImpl }));
    expect(offline.calls).toHaveLength(0);
    expect(accounts['claude-code']).toMatchObject({ status: 'ok', providerName: 'claude-code account' });
    expect(accounts['openai-oauth']).toMatchObject({ status: 'unchecked', windows: [], fetchedAt: null });
    expect(accounts['cline-pass'].status).toBe('unsupported');
  });

  it('fetchMissing checks only accounts that were never checked', async () => {
    const first = scriptedFetch();
    await getRelayAccountUsage({ providerIds: ['claude-code'], fetchImpl: first.fetchImpl });

    const { fetchImpl, calls } = scriptedFetch();
    const accounts = byId(await readRelayAccountUsage({ fetchMissing: true, fetchImpl }));
    expect(calls.some(c => c.url.includes('api.anthropic.com'))).toBe(false);
    expect(calls.some(c => c.url.includes('chatgpt.com'))).toBe(true);
    expect(accounts['openai-oauth'].status).toBe('ok');

    const again = scriptedFetch();
    await readRelayAccountUsage({ fetchMissing: true, fetchImpl: again.fetchImpl });
    expect(again.calls).toHaveLength(0);
  });

  it('keeps the last good reading when a later check fails, and reports why', async () => {
    const ok = scriptedFetch();
    const [first] = await getRelayAccountUsage({ providerIds: ['claude-code'], fetchImpl: ok.fetchImpl });

    const limited = scriptedFetch(() => json({ error: 'slow down' }, 429));
    const [failed] = await getRelayAccountUsage({ providerIds: ['claude-code'], fetchImpl: limited.fetchImpl });
    expect(failed).toMatchObject({ status: 'error', error: { code: 'rate_limited' }, fetchedAt: first!.fetchedAt });
    expect(failed!.windows).toEqual(first!.windows);

    const [stored] = await readRelayAccountUsage({ providerIds: ['claude-code'] });
    expect(stored).toMatchObject({ status: 'error', windows: first!.windows });
  });

  it('maps sign-in and payload failures to stable codes without leaking upstream text', async () => {
    const { fetchImpl } = scriptedFetch(host => {
      if (host === 'api.anthropic.com') return json({ error: 'secret upstream detail' }, 401);
      if (host === 'chatgpt.com') return json({ unexpected: true });
      if (host === 'api.github.com') return json({}, 403);
      return undefined;
    });
    const accounts = byId(await getRelayAccountUsage({ fetchImpl }));
    expect(accounts['claude-code'].error.code).toBe('reauth_required');
    expect(accounts['openai-oauth'].error.code).toBe('unsupported_payload');
    expect(accounts['github-copilot'].error.code).toBe('access_denied');
    expect(JSON.stringify(accounts)).not.toMatch(/secret upstream detail|canary/);
  });

  it('reports a missing credential without making a request', async () => {
    writeRegistry([oauthProvider('claude-code', { authRef: 'keyring:oauth:provider:unknown' })]);
    const { fetchImpl, calls } = scriptedFetch();
    const [account] = await getRelayAccountUsage({ fetchImpl });
    expect(account).toMatchObject({ status: 'error', error: { code: 'credential_unavailable' } });
    expect(calls).toHaveLength(0);
  });

  it('reads Antigravity from the endpoints that answer', async () => {
    const { fetchImpl, calls } = scriptedFetch(host => (host.startsWith('daily-') ? json({}, 503) : undefined));
    const [account] = await getRelayAccountUsage({ providerIds: ['antigravity'], fetchImpl });
    expect(calls.length).toBeGreaterThan(1);
    expect(account).toMatchObject({ status: 'ok' });
    expect(account!.windows[0]).toMatchObject({ label: 'Gemini 4 models', usedPercent: 10 });
  });

  it('shares one request between overlapping checks of the same account', async () => {
    const { fetchImpl, calls } = scriptedFetch();
    await Promise.all([
      getRelayAccountUsage({ providerIds: ['claude-code'], fetchImpl }),
      checkUsageAfterSignIn('claude-code', { fetchImpl }),
    ]);
    expect(calls).toHaveLength(1);
  });

  it('checks a newly signed-in account once and ignores providers without a usage source', async () => {
    const { fetchImpl, calls } = scriptedFetch();
    await checkUsageAfterSignIn('openai-oauth', { fetchImpl });
    await checkUsageAfterSignIn('cline-pass', { fetchImpl });
    expect(calls.map(c => new URL(c.url).hostname)).toEqual(['chatgpt.com']);
    const [stored] = await readRelayAccountUsage({ providerIds: ['openai-oauth'] });
    expect(stored!.status).toBe('ok');
  });
});

describe('providers usage command', () => {
  it('parses the account id and flags', () => {
    expect(parseProvidersArgs(['usage'])).toMatchObject({ subcommand: 'usage', usageJson: false, usageSaved: false });
    expect(parseProvidersArgs(['usage', 'claude-code', '--json', '--saved'])).toMatchObject({ subcommand: 'usage', removeId: 'claude-code', usageJson: true, usageSaved: true });
    expect(parseProvidersArgs(['usage', '--bogus']).error).toMatch(/Unknown usage option/);
    expect(parseProvidersArgs(['usage', 'a', 'b']).error).toMatch(/Usage:/);
  });

  it('formats windows, treating a passed reset as unused', () => {
    const now = Date.parse('2026-11-07T12:00:00Z');
    const lines = formatAccountUsage({
      providerId: 'claude-code', providerKind: 'claude-code', providerName: 'Claude', status: 'ok', fetchedAt: '2026-11-07T11:00:00Z',
      windows: [
        { id: '5h', label: '5-hour limit', usedPercent: 80, resetsAt: '2026-11-07T11:30:00Z', scope: { type: 'account' } },
        { id: '7d', label: 'Weekly limit', usedPercent: 40, resetsAt: '2026-11-07T14:30:00Z', scope: { type: 'account' } },
      ],
    }, now);
    expect(lines).toEqual(['Claude (claude-code)', '  5-hour limit: 0% used · reset', '  Weekly limit: 40% used · resets in 2h 30m']);
    expect(formatAccountUsage({ providerId: 'x', providerKind: 'x', providerName: 'X', status: 'unchecked', windows: [], fetchedAt: null })).toEqual(['X (x): not checked yet']);
    expect(formatAccountUsage({
      providerId: 'xai-oauth', providerKind: 'xai-oauth', providerName: 'xAI', status: 'ok', fetchedAt: '2026-11-07T11:00:00Z',
      windows: [{ id: 'credits', label: 'Weekly limit', usedPercent: 0, resetsAt: '2026-11-13T18:57:13Z', scope: { type: 'account' } }],
      balances: [{ id: 'extra-credits', label: 'Extra usage credits', amount: 0, currency: 'USD' }],
    }, now)).toEqual(['xAI (xai-oauth)', '  Weekly limit: 0% used · resets in 6d', '  Extra usage credits: US$0.00']);
  });
});
