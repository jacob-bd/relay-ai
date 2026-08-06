import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CLINE_PASS_CATALOG_URL,
  CLINE_PASS_REFRESH_URL,
  CLINE_PASS_REGISTER_URL,
  CLINE_PASS_SDK_BASE_URL,
  CLINE_PASS_VALIDATION_URL,
} from '../src/cline-pass.js';
import {
  fetchClinePassModels,
  parseClinePassModels,
  validateClinePassApiKey,
} from '../src/registry/fetch-cline-pass-models.js';

describe('ClinePass model catalog', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defines exact host-root and SDK endpoint URLs', () => {
    expect(CLINE_PASS_SDK_BASE_URL).toBe('https://api.cline.bot/api/v1');
    expect(CLINE_PASS_CATALOG_URL).toBe('https://api.cline.bot/api/v1/ai/cline/recommended-models');
    expect(CLINE_PASS_VALIDATION_URL).toBe('https://api.cline.bot/api/v1/models');
    expect(CLINE_PASS_REGISTER_URL).toBe('https://api.cline.bot/api/v1/auth/register');
    expect(CLINE_PASS_REFRESH_URL).toBe('https://api.cline.bot/api/v1/auth/refresh');
  });

  it('parses only ClinePass and free models while preserving full model slugs', () => {
    const models = parseClinePassModels({
      clinePass: [
        { id: 'cline-pass/qwen3.8-max', name: 'Qwen 3.8 Max', tags: ['reasoning'] },
        { id: 'cline-pass/kimi-k3', name: 'Kimi K3' },
      ],
      free: [
        { id: 'poolside/laguna-s-2.1:free', name: 'Laguna S 2.1 Free' },
        { id: 'cline-pass/kimi-k3', name: 'Duplicate Free Kimi' },
      ],
      recommended: [
        { id: 'anthropic/claude-sonnet-4-6', name: 'Usage Billed Claude' },
      ],
    });

    expect(models).toHaveLength(3);
    expect(models.map(model => model.id)).toEqual([
      'cline-pass/qwen3.8-max',
      'cline-pass/kimi-k3',
      'poolside/laguna-s-2.1:free',
    ]);
    expect(models[0]).toMatchObject({
      id: 'cline-pass/qwen3.8-max',
      upstreamModelId: 'cline-pass/qwen3.8-max',
      contextWindow: 131072,
    });
    expect(models[1]?.name).toBe('Kimi K3');
    expect(models[2]).toMatchObject({
      upstreamModelId: 'poolside/laguna-s-2.1:free',
      isFree: true,
    });
  });

  it('fetches the public catalog without an Authorization header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ clinePass: [{ id: 'cline-pass/qwen3.8-max', name: 'Qwen 3.8 Max' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await fetchClinePassModels();

    expect(fetchMock).toHaveBeenCalledWith(
      CLINE_PASS_CATALOG_URL,
      expect.objectContaining({
        headers: expect.not.objectContaining({ Authorization: expect.any(String) }),
      }),
    );
  });

  it('validates an API key against the authenticated models endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    await validateClinePassApiKey('cline-api-key');

    expect(fetchMock).toHaveBeenCalledWith(
      CLINE_PASS_VALIDATION_URL,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer cline-api-key' }),
      }),
    );
  });

  it('rejects an API key when authenticated validation returns 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));

    await expect(validateClinePassApiKey('bad-key')).rejects.toThrow('API key was rejected');
  });
});
