import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import {
  classifyCopilotAccount,
  requestGithubDeviceCode,
  exchangeForCopilotToken,
  refreshGithubCopilotToken,
  pollGithubDeviceCodeToken,
} from '../src/oauth/github.js';
import { oauthCredentialShouldRefresh, refreshStoredOAuthCredential } from '../src/oauth/refresh.js';
import { positiveSecondsToMs } from '../src/oauth/pkce.js';
import type { StoredOAuthCredential } from '../src/oauth/types.js';

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe('GitHub Copilot OAuth', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('requestGithubDeviceCode', () => {
    it('returns device code info on success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          device_code: 'dc_123',
          user_code: 'UC-456',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 5,
        }),
      });

      const res = await requestGithubDeviceCode();
      expect(res.device_code).toBe('dc_123');
      expect(res.user_code).toBe('UC-456');
    });

    it('throws on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Bad Request',
      });

      await expect(requestGithubDeviceCode()).rejects.toThrow(/device code request failed \(400\): Bad Request/);
    });

    it('throws on missing fields', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          user_code: 'UC-456',
        }), // missing device_code
      });

      await expect(requestGithubDeviceCode()).rejects.toThrow(/missing required fields/);
    });
  });

  describe('exchangeForCopilotToken', () => {
    it('stores a normalized paid Copilot plan summary with the session token', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ token: 'tidv2_paid' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            login: 'alice',
            access_type_sku: 'copilot_individual_pro',
            copilot_plan: 'individual_pro',
          }),
        });

      const res = await exchangeForCopilotToken('ghu_paid');

      expect(res.providerData).toEqual({
        copilot: {
          login: 'alice',
          access_type_sku: 'copilot_individual_pro',
          copilot_plan: 'individual_pro',
          is_free_plan: false,
          lookup_status: 'known',
        },
      });
      expect(mockFetch).toHaveBeenNthCalledWith(2, 'https://api.github.com/copilot_internal/user', expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer ghu_paid',
          'Editor-Version': 'vscode/1.85.1',
        }),
      }));
    });

    it('keeps the session token but marks the plan unknown when account lookup fails', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ token: 'tidv2_unknown' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          text: async () => 'temporarily unavailable',
        });

      const res = await exchangeForCopilotToken('ghu_unknown');

      expect(res.access_token).toBe('tidv2_unknown');
      expect(res.providerData).toEqual({
        copilot: { lookup_status: 'unknown' },
      });
    });

    it('returns short-lived token on success', async () => {
      const expiresAt = new Date(Date.now() + 1800 * 1000).toISOString();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: 'tidv2_789',
          expires_at: expiresAt,
        }),
      });

      const res = await exchangeForCopilotToken('ghu_123');
      expect(res.access_token).toBe('tidv2_789');
      // ~1800 seconds
      expect(res.expires_in).toBeGreaterThan(1700);
      expect(res.expires_in).toBeLessThanOrEqual(1800);
    });

    it('throws if response is missing token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      await expect(exchangeForCopilotToken('ghu_123')).rejects.toThrow(/missing token field/);
    });
  });

  describe('classifyCopilotAccount', () => {
    it.each([
      'free_limited_copilot',
      'free_educational_quota',
      'no_auth_limited_copilot',
    ])('classifies %s as a Free plan', (accessTypeSku) => {
      expect(classifyCopilotAccount({ access_type_sku: accessTypeSku })).toMatchObject({
        is_free_plan: true,
        lookup_status: 'known',
      });
    });

    it('classifies copilot_plan=free as Free even without a Free SKU', () => {
      expect(classifyCopilotAccount({ copilot_plan: 'free' }).is_free_plan).toBe(true);
    });

    it('classifies a paid plan as paid', () => {
      expect(classifyCopilotAccount({
        access_type_sku: 'copilot_individual_pro',
        copilot_plan: 'individual_pro',
      }).is_free_plan).toBe(false);
    });

    it('keeps the plan unverified when GitHub omits both plan fields', () => {
      expect(classifyCopilotAccount({ login: 'alice' })).toEqual({
        login: 'alice',
        lookup_status: 'unknown',
      });
    });
  });

  describe('refreshGithubCopilotToken', () => {
    it('wraps exchangeForCopilotToken and returns the same refresh token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: 'tidv2_new',
        }),
      });

      const res = await refreshGithubCopilotToken('ghu_123');
      expect(res.access_token).toBe('tidv2_new');
      expect(res.refresh_token).toBe('ghu_123');
      expect(res.expires_in).toBe(1800); // default when no expires_at
    });
  });

  describe('pollGithubDeviceCodeToken', () => {
    it('polls until access token is returned, then exchanges it for copilot token', async () => {
      const device = {
        device_code: 'dc_123',
        user_code: 'UC-456',
        verification_uri: 'url',
        expires_in: 900,
        interval: 1,
      };

      // 1. First poll: authorization_pending
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error: 'authorization_pending' }),
      });
      // 2. Second poll: success
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'ghu_123' }),
      });
      // 3. Exchange call inside pollGithubDeviceCodeToken
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'tidv2_456' }),
      });
      // 4. Account plan lookup inside the Copilot exchange
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_type_sku: 'free_limited_copilot',
          copilot_plan: 'individual',
        }),
      });

      const sleep = vi.fn().mockResolvedValue(undefined);
      let time = 0;
      const now = () => time; // fixed time

      const resPromise = pollGithubDeviceCodeToken(device, { sleep, now });
      
      const res = await resPromise;
      expect(res.access_token).toBe('tidv2_456');
      expect(res.refresh_token).toBe('ghu_123');
      expect(res.providerData).toEqual({
        copilot: expect.objectContaining({
          is_free_plan: true,
          lookup_status: 'known',
        }),
      });
      expect(sleep).toHaveBeenCalledTimes(1); // slept once for auth_pending
    });

    it('handles slow_down and expired_token', async () => {
      const device = {
        device_code: 'dc_123',
        user_code: 'UC-456',
        verification_uri: 'url',
        expires_in: 900,
        interval: 1,
      };

      // 1. slow_down
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error: 'slow_down' }),
      });
      // 2. expired_token
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error: 'expired_token' }),
      });

      const sleep = vi.fn().mockResolvedValue(undefined);
      const resPromise = pollGithubDeviceCodeToken(device, { sleep, now: () => 0 });
      await expect(resPromise).rejects.toThrow(/device code expired/);
      expect(sleep).toHaveBeenCalledTimes(1); // slept once for slow_down
    });
  });
});

describe('OAuth Refresh Logic (GitHub)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('refreshes Copilot plan metadata while preserving unrelated provider data', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'tidv2_new' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          login: 'alice',
          access_type_sku: 'free_limited_copilot',
          copilot_plan: 'individual',
        }),
      });

    const refreshed = await refreshStoredOAuthCredential('github-copilot', {
      type: 'oauth',
      access: 'tidv2_old',
      refresh: 'ghu_123',
      expires: 0,
      providerData: {
        retained: 'yes',
        copilot: { lookup_status: 'unknown' },
      },
    });

    expect(refreshed.providerData).toEqual({
      retained: 'yes',
      copilot: {
        login: 'alice',
        access_type_sku: 'free_limited_copilot',
        copilot_plan: 'individual',
        is_free_plan: true,
        lookup_status: 'known',
      },
    });
  });

  it('oauthCredentialShouldRefresh returns true if expiring for github-copilot', () => {
    const cred: any = {
      access: 'tidv2',
      refresh: 'ghu',
      expires: Date.now() + 10000, // < 5 minutes
    };
    expect(oauthCredentialShouldRefresh(cred, 'github-copilot')).toBe(true);
  });

  it('oauthCredentialShouldRefresh returns false if not expiring for github-copilot', () => {
    const cred: any = {
      access: 'tidv2',
      refresh: 'ghu',
      expires: Date.now() + 600000, // > 5 minutes
    };
    expect(oauthCredentialShouldRefresh(cred, 'github-copilot')).toBe(false);
  });
});
