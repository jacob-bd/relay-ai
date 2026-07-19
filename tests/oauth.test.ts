import { describe, expect, it, vi, afterEach } from 'vitest';
import { accessTokenIsExpiring, oauthCredentialNeedsRefresh, tokensToStoredCredential } from '../src/oauth/types.js';
import { pollXaiDeviceCodeToken, requestXaiDeviceCode } from '../src/oauth/xai.js';
import { extractOpenAiAccountId } from '../src/oauth/openai.js';
import { completeAntigravityExchange, resolveAntigravityOnboardTierId } from '../src/oauth/antigravity-oauth.js';
import { postOAuthRefresh } from '../src/oauth/refresh-http.js';
import { oauthCredentialShouldRefresh, refreshStoredOAuthCredential } from '../src/oauth/refresh.js';
import { codexCompatibleProviders } from '../src/codex/routing.js';
import type { LocalProvider } from '../src/types.js';

describe('oauth types', () => {
  it('detects expiring oauth credentials', () => {
    expect(oauthCredentialNeedsRefresh({
      type: 'oauth',
      access: 'tok',
      refresh: 'ref',
      expires: Date.now() + 30_000,
    })).toBe(true);
  });

  it('maps token response to stored credential', () => {
    const cred = tokensToStoredCredential({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }, undefined, 'acct');
    expect(cred.access).toBe('a');
    expect(cred.refresh).toBe('r');
    expect(cred.accountId).toBe('acct');
    expect(cred.expires).toBeGreaterThan(Date.now());
  });

  it('merges token provider metadata over existing metadata', () => {
    const cred = tokensToStoredCredential({
      access_token: 'a',
      refresh_token: 'r',
      expires_in: 3600,
      providerData: { copilot: { is_free_plan: true, lookup_status: 'known' } },
    }, undefined, undefined, {
      retained: 'yes',
      copilot: { lookup_status: 'unknown' },
    });

    expect(cred.providerData).toEqual({
      retained: 'yes',
      copilot: { is_free_plan: true, lookup_status: 'known' },
    });
  });

  it('reads JWT exp for proactive refresh hint', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 10 })).toString('base64url');
    expect(accessTokenIsExpiring(`${header}.${payload}.sig`)).toBe(true);
  });
});

describe('oauth refresh http', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('posts form refresh requests and includes response text in the error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => 'bad refresh',
    })));

    await expect(postOAuthRefresh(
      'https://auth/token',
      new URLSearchParams({ grant_type: 'refresh_token' }),
      {
        contentType: 'form',
        errorPrefix: 'xAI token refresh failed',
        includeStatus: true,
        includeBody: true,
      },
    )).rejects.toThrow('xAI token refresh failed (401): bad refresh');
  });
});

describe('xai device code', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requests and polls device code tokens', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        device_code: 'dc',
        user_code: 'ABCD-1234',
        verification_uri: 'https://x.ai/device',
        expires_in: 60,
        interval: 1,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'access',
        refresh_token: 'refresh',
        expires_in: 3600,
      }), { status: 200 })));

    const device = await requestXaiDeviceCode();
    expect(device.user_code).toBe('ABCD-1234');
    const tokens = await pollXaiDeviceCodeToken(device, { sleep: async () => {}, now: () => 0 });
    expect(tokens.access_token).toBe('access');
  });
});

describe('openai oauth helpers', () => {
  it('extracts account id from jwt', () => {
    const header = Buffer.from('{}').toString('base64url');
    const payload = Buffer.from(JSON.stringify({ chatgpt_account_id: 'user-123' })).toString('base64url');
    const id = extractOpenAiAccountId({ access_token: `${header}.${payload}.x`, refresh_token: 'r' });
    expect(id).toBe('user-123');
  });
});

describe('antigravity oauth helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prefers the current tier over paidTier for onboardUser', () => {
    expect(resolveAntigravityOnboardTierId({
      currentTier: { id: 'free-tier' },
      paidTier: { id: 'g1-pro-tier' },
      allowedTiers: [{ id: 'free-tier' }, { id: 'standard-tier' }],
    })).toBe('free-tier');
  });

  it('uses the default allowed tier when current tier is ineligible', () => {
    expect(resolveAntigravityOnboardTierId({
      currentTier: { id: 'legacy-tier' },
      ineligibleTiers: [{ id: 'legacy-tier' }],
      allowedTiers: [{ id: 'free-tier', isDefault: true }],
      paidTier: { id: 'g1-pro-tier' },
    })).toBe('free-tier');
  });

  it('onboards with the current tier when loadCodeAssist returns no project', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === 'https://oauth2.googleapis.com/token') {
        return new Response(JSON.stringify({
          access_token: 'access',
          refresh_token: 'refresh',
          expires_in: 3600,
        }), { status: 200 });
      }
      if (String(url).startsWith('https://www.googleapis.com/oauth2/v1/userinfo')) {
        return new Response(JSON.stringify({ email: 'user@example.com' }), { status: 200 });
      }
      if (String(url).endsWith('/v1internal:loadCodeAssist')) {
        return new Response(JSON.stringify({
          currentTier: { id: 'free-tier' },
          paidTier: { id: 'g1-pro-tier' },
          allowedTiers: [{ id: 'free-tier' }, { id: 'standard-tier' }],
        }), { status: 200 });
      }
      if (String(url).endsWith('/v1internal:onboardUser')) {
        return new Response(JSON.stringify({
          done: true,
          response: { cloudaicompanionProject: { id: 'project-from-onboard' } },
        }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }));

    const result = await completeAntigravityExchange('code', 'verifier', 'http://localhost/callback');
    const onboardCall = calls.find(call => call.url.endsWith('/v1internal:onboardUser'));
    const onboardBody = JSON.parse(String(onboardCall?.init?.body));

    expect(result.projectId).toBe('project-from-onboard');
    expect(result.tierId).toBe('free-tier');
    expect(onboardBody.tier_id).toBe('free-tier');
  });
});

describe('oauth refresh', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refreshes xai tokens', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      expires_in: 3600,
    }), { status: 200 })));

    const cred = await refreshStoredOAuthCredential('xai', {
      type: 'oauth',
      access: 'old',
      refresh: 'rt',
      expires: 0,
    });
    expect(cred.access).toBe('new-access');
    expect(oauthCredentialShouldRefresh(cred, 'xai')).toBe(false);
  });
});

describe('codexCompatibleProviders', () => {
  it('includes anthropic, zen/go, and groq', () => {
    const providers: LocalProvider[] = [
      { id: 'zen', name: 'Zen', apiKey: 'k', models: [{ id: 'm', name: 'M', family: '', brand: '', modelFormat: 'openai', upstreamModelId: 'm' }] },
      { id: 'groq', name: 'Groq', apiKey: 'k', models: [{ id: 'm', name: 'M', family: '', brand: '', modelFormat: 'openai', upstreamModelId: 'm', npm: '@ai-sdk/groq' }] },
      { id: 'anthropic', name: 'A', apiKey: 'k', models: [{ id: 'm', name: 'M', family: '', brand: '', modelFormat: 'anthropic', upstreamModelId: 'm' }] },
    ];
    expect(codexCompatibleProviders(providers).map(p => p.id).sort()).toEqual(['anthropic', 'groq', 'zen']);
  });
});
