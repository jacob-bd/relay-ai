import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  pollClinePassDeviceCode,
  refreshClinePassAccessToken,
  registerClinePassTokens,
  requestClinePassDeviceCode,
} from '../src/oauth/cline-pass.js';

const fetchMock = vi.fn();

describe('ClinePass OAuth', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('requests a WorkOS device code with the Cline client id', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        device_code: 'device-code',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://auth.workos.com/device',
        verification_uri_complete: 'https://auth.workos.com/device?code=ABCD',
        expires_in: 600,
        interval: 5,
      }),
    });

    const result = await requestClinePassDeviceCode();

    expect(result.user_code).toBe('ABCD-EFGH');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.workos.com/user_management/authorize/device',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('client_id='),
      }),
    );
  });

  it('polls pending authorization, honors slow_down, and converts the Cline registration response', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    let now = 0;
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'authorization_pending' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'slow_down' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'workos-access', refresh_token: 'workos-refresh' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            accessToken: 'cline-access',
            refreshToken: 'cline-refresh',
            expiresAt: '2026-08-06T18:00:00.000Z',
            userInfo: { clineUserId: 'cline-user', email: 'jacob@example.com' },
          },
        }),
      });

    const result = await pollClinePassDeviceCode(
      {
        device_code: 'device-code',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://auth.workos.com/device',
        expires_in: 600,
        interval: 5,
      },
      { sleep, now: () => now },
    );

    expect(result.tokens).toMatchObject({
      access_token: 'cline-access',
      refresh_token: 'cline-refresh',
    });
    expect(result.accountId).toBe('cline-user');
    expect(result.providerData).toMatchObject({ email: 'jacob@example.com' });
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls[1]?.[0]).toBeGreaterThan(sleep.mock.calls[0]?.[0] ?? 0);
    now = 601_000;
  });

  it('throws terminal WorkOS authorization errors', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'access_denied' }),
    });

    await expect(pollClinePassDeviceCode({
      device_code: 'device-code',
      user_code: 'ABCD-EFGH',
      verification_uri: 'https://auth.workos.com/device',
      expires_in: 600,
      interval: 5,
    }, { sleep: vi.fn(), now: () => 0 })).rejects.toThrow(/access_denied/);
  });

  it('refreshes with Cline JSON and preserves the old refresh token when omitted', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          accessToken: 'new-access',
          expiresAt: '2026-08-06T18:30:00.000Z',
          userInfo: { clineUserId: 'cline-user' },
        },
      }),
    });

    const tokens = await refreshClinePassAccessToken('old-refresh');

    expect(tokens.access_token).toBe('new-access');
    expect(tokens.refresh_token).toBeUndefined();
    expect(tokens.providerData).toEqual({ clineUserId: 'cline-user' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.cline.bot/api/v1/auth/refresh',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ refreshToken: 'old-refresh', grantType: 'refresh_token' }),
      }),
    );
  });

  it('rejects malformed or unsuccessful Cline responses', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => '<html>server error</html>',
    });
    await expect(registerClinePassTokens('access', 'refresh')).rejects.toThrow(/registration/);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: false, error: 'invalid token' }),
    });
    await expect(registerClinePassTokens('access', 'refresh')).rejects.toThrow(/invalid token/);
  });
});
