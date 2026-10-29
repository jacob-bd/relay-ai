import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  extractOpenAiAccountId,
  refreshOpenAiAccessToken,
  runOpenAiDeviceCodeFlow,
} from '../src/oauth/openai.js';

describe('oauth/openai', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('extractOpenAiAccountId', () => {
    function buildJwt(claims: unknown): string {
      return `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
    }

    it('returns undefined if no token provided', () => {
      expect(extractOpenAiAccountId({})).toBeUndefined();
    });

    it('extracts from chatgpt_account_id', () => {
      const token = buildJwt({ chatgpt_account_id: 'acc_123' });
      expect(extractOpenAiAccountId({ id_token: token, access_token: '' })).toBe('acc_123');
    });

    it('extracts from api.openai.com/auth', () => {
      const token = buildJwt({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acc_456' } });
      expect(extractOpenAiAccountId({ access_token: token })).toBe('acc_456');
    });

    it('extracts from organizations array', () => {
      const token = buildJwt({ organizations: [{ id: 'org_789' }] });
      expect(extractOpenAiAccountId({ id_token: token, access_token: '' })).toBe('org_789');
    });

    it('returns undefined for invalid JWT', () => {
      expect(extractOpenAiAccountId({ id_token: 'invalid.jwt.token' })).toBeUndefined();
      expect(extractOpenAiAccountId({ id_token: 'not-even-three-parts' })).toBeUndefined();
    });
  });

  describe('refreshOpenAiAccessToken', () => {
    it('returns tokens on success', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'new_token' }),
      } as Response);

      const res = await refreshOpenAiAccessToken('refresh_123');
      expect(res.access_token).toBe('new_token');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://auth.openai.com/oauth/token',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('throws on non-ok response', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => '',
      } as Response);

      await expect(refreshOpenAiAccessToken('refresh_123')).rejects.toThrow(/OpenAI token refresh failed \(401\)/);
    });
  });

  describe('runOpenAiDeviceCodeFlow', () => {
    it('handles successful polling loop', async () => {
      // 1. Device initiation response
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          device_auth_id: 'auth_id',
          user_code: 'user_code',
          interval: '1',
          expires_in: 60,
        }),
      } as Response);

      // 2. First polling attempt: authorization pending (403)
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 403,
      } as Response);

      // 3. Second polling attempt: user authorized (200 OK)
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ authorization_code: 'auth_code', code_verifier: 'verifier' }),
      } as Response);

      // 4. Token exchange response
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'final_access_token' }),
      } as Response);

      const onDeviceCode = vi.fn();
      const sleep = vi.fn().mockResolvedValue(undefined);
      let time = 1000;
      const now = vi.fn(() => time);

      const promise = runOpenAiDeviceCodeFlow(onDeviceCode, { sleep, now });
      
      // Advance time for the loop
      time = 2000;
      
      const result = await promise;

      expect(onDeviceCode).toHaveBeenCalledWith({
        url: 'https://auth.openai.com/codex/device',
        userCode: 'user_code',
      });
      expect(sleep).toHaveBeenCalledWith(expect.any(Number)); // Called after the 403
      expect(result.tokens.access_token).toBe('final_access_token');
    });

    it('throws if device initiation fails', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      await expect(runOpenAiDeviceCodeFlow(vi.fn())).rejects.toThrow('Failed to initiate OpenAI device authorization');
    });

    it('throws if polling hits an unexpected error (e.g. 500)', async () => {
      // 1. Device initiation
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ device_auth_id: 'auth_id', user_code: 'user_code', interval: '1', expires_in: 60 }),
      } as Response);

      // 2. Polling fails with 500
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      await expect(runOpenAiDeviceCodeFlow(vi.fn())).rejects.toThrow('OpenAI device authorization failed (500)');
    });

    it('throws if device authorization times out', async () => {
      // 1. Device initiation (succeeds)
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ device_auth_id: 'auth_id', user_code: 'user_code', interval: '1', expires_in: 0 }),
      } as Response);
      
      // 2. Polling loop (fails with 403 authorization pending, but we time out)
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 403,
      } as Response);

      let time = 1000;
      const now = vi.fn(() => time);
      const sleep = vi.fn(async (ms) => {
        time += ms;
      });

      await expect(runOpenAiDeviceCodeFlow(vi.fn(), { sleep, now })).rejects.toThrow('OpenAI device authorization timed out');
    });
  });
});
