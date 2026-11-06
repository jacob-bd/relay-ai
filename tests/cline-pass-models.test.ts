import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  CLINE_PASS_CATALOG_URL,
  CLINE_PASS_REFRESH_URL,
  CLINE_PASS_REGISTER_URL,
  CLINE_PASS_SDK_BASE_URL,
  CLINE_PASS_VALIDATION_URL,
} from '../src/cline-pass.js';
import {
  applyClineCatalogContextWindows,
  classifyClineProbeResponse,
  fetchClinePassModels,
  parseClinePassModels,
  validateClinePassApiKey,
} from '../src/registry/fetch-cline-pass-models.js';

describe('ClinePass model catalog', () => {
  const previousHome = process.env.RELAY_AI_HOME;
  const previousTrace = process.env.RELAY_AI_TRACE;

  afterEach(() => {
    vi.unstubAllGlobals();
    if (previousHome === undefined) delete process.env.RELAY_AI_HOME;
    else process.env.RELAY_AI_HOME = previousHome;
    if (previousTrace === undefined) delete process.env.RELAY_AI_TRACE;
    else process.env.RELAY_AI_TRACE = previousTrace;
  });

  it('defines exact host-root and SDK endpoint URLs', () => {
    expect(CLINE_PASS_SDK_BASE_URL).toBe('https://api.cline.bot/api/v1');
    expect(CLINE_PASS_CATALOG_URL).toBe('https://api.cline.bot/api/v1/ai/cline/recommended-models');
    expect(CLINE_PASS_VALIDATION_URL).toBe('https://api.cline.bot/api/v1/users/me');
    expect(CLINE_PASS_REGISTER_URL).toBe('https://api.cline.bot/api/v1/auth/register');
    expect(CLINE_PASS_REFRESH_URL).toBe('https://api.cline.bot/api/v1/auth/refresh');
  });

  it('parses only ClinePass and free models while preserving full model slugs', () => {
    const models = parseClinePassModels({
      clinePass: [
        { id: 'cline-pass/qwen3.8-max', name: 'Qwen 3.8 Max', context_window: 262144, tags: ['reasoning'] },
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
      contextWindow: 262144,
      contextWindowSource: 'provider',
    });
    expect(models[1]).toMatchObject({
      name: 'Kimi K3',
      contextWindow: undefined,
    });
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

  it('validates an API key against the authenticated account endpoint', async () => {
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

  it('traces ClinePass validation status and response body without logging the API key', async () => {
    const home = mkdtempSync(join(tmpdir(), 'relay-ai-cline-trace-'));
    process.env.RELAY_AI_HOME = home;
    process.env.RELAY_AI_TRACE = '1';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      clone: () => ({ text: async () => '{"error":"Invalid API key"}' }),
    }));

    await expect(validateClinePassApiKey('secret-cline-api-key')).rejects.toThrow('API key was rejected');

    const trace = readFileSync(join(home, 'logs', 'provider-debug.log'), 'utf8');
    expect(trace).toContain('ClinePass response status=401');
    expect(trace).toContain('Invalid API key');
    expect(trace).not.toContain('secret-cline-api-key');
    rmSync(home, { recursive: true, force: true });
  });

  it('classifies free-model probe verdicts', () => {
    expect(classifyClineProbeResponse(403, {
      error: {
        message: 'Error 403: cline-free/deepseek-v4.1-flash is only available via Cline product '
          + 'surfaces. If you are using an old version of Cline, please update to the latest version',
      },
    })).toBe('unavailable');
    expect(classifyClineProbeResponse(401, { error: 'Unauthorized' })).toBe('abort');
    expect(classifyClineProbeResponse(402, { error: { message: 'Payment required' } })).toBe('abort');
    expect(classifyClineProbeResponse(403, { error: { message: 'An active subscription is required' } })).toBe('abort');
    expect(classifyClineProbeResponse(403, { error: { message: 'Forbidden' } })).toBe('unknown');
    expect(classifyClineProbeResponse(429, { error: { message: 'Daily free limit reached' } })).toBe('unknown');
    expect(classifyClineProbeResponse(500, {})).toBe('unknown');
    expect(classifyClineProbeResponse(200, { choices: [] })).toBe('available');
  });

  it('drops only free models that answer with the product-surfaces rejection', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: { body?: string }) => {
      if (url === CLINE_PASS_CATALOG_URL) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            clinePass: [{ id: 'cline-pass/qwen3.8-max', name: 'Qwen 3.8 Max' }],
            free: [
              { id: 'cline-free/deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' },
              { id: 'stealth/space-bunny-alpha', name: 'Space Bunny Alpha' },
            ],
          }),
        };
      }
      const probed = JSON.parse(init?.body ?? '{}').model as string;
      if (probed === 'cline-free/deepseek-v4.1-flash') {
        return {
          ok: false,
          status: 403,
          json: async () => ({
            error: { message: `Error 403: ${probed} is only available via Cline product surfaces.` },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const models = await fetchClinePassModels({ credential: 'cline-api-key', authType: 'api' });

    expect(models.map(model => model.id)).toEqual(['cline-pass/qwen3.8-max', 'stealth/space-bunny-alpha']);
    const probedModels = fetchMock.mock.calls
      .filter(([url]) => url === `${CLINE_PASS_SDK_BASE_URL}/chat/completions`)
      .map(([, init]) => JSON.parse((init as { body: string }).body).model as string);
    // Only free-bucket models are probed; the paid model is never touched.
    expect(probedModels).toEqual(['cline-free/deepseek-v4.1-flash', 'stealth/space-bunny-alpha']);
  });

  it('pauses the probe pass on account-level rejections and keeps the whole catalog', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url === CLINE_PASS_CATALOG_URL) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            clinePass: [{ id: 'cline-pass/qwen3.8-max', name: 'Qwen 3.8 Max' }],
            free: [
              { id: 'cline-free/one', name: 'One' },
              { id: 'cline-free/two', name: 'Two' },
            ],
          }),
        };
      }
      return { ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const models = await fetchClinePassModels({ credential: 'stale-token', authType: 'oauth' });

    expect(models.map(model => model.id)).toEqual([
      'cline-pass/qwen3.8-max',
      'cline-free/one',
      'cline-free/two',
    ]);
    const probeCalls = fetchMock.mock.calls
      .filter(([url]) => url === `${CLINE_PASS_SDK_BASE_URL}/chat/completions`);
    // The first account-level rejection pauses the pass; the second model is never probed.
    expect(probeCalls).toHaveLength(1);
    expect((probeCalls[0]![1] as { headers: Record<string, string> }).headers.Authorization)
      .toBe('Bearer workos:stale-token');
  });

  it('skips probing when no credential is supplied', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ clinePass: [{ id: 'cline-pass/qwen3.8-max', name: 'Qwen 3.8 Max' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await fetchClinePassModels();

    // The model list plus the (public) full catalog read for context sizes; no probe request.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes('chat/completions'))).toBe(false);
  });
});

describe('ClinePass context sizes from the full Cline catalog', () => {
  const model = (id: string, contextWindow?: number) => ({ id, name: id, upstreamModelId: id, modelFormat: 'openai' as const, contextWindow });
  const payload = { data: [
    { id: 'xiaomi/mimo-v2.6-pro', context_length: 1_050_000 },
    { id: 'xiaomi/mimo-v2.6-pro-ultraspeed', context_length: 64_000 },
    { id: 'nvidia/nemotron-3.5-lightning', context_length: 262_144 },
    { id: 'nvidia/nemotron-3.5-lightning:free', context_length: 1_000_000 },
  ] };

  it('matches by exact model name, never by prefix, and keeps free variants apart', () => {
    const out = applyClineCatalogContextWindows([
      model('cline-pass/mimo-v2.6-pro'), model('nvidia/nemotron-3.5-lightning-free'), model('cline-pass/glm-5.3'),
    ], payload);
    expect(out.map(m => m.contextWindow)).toEqual([1_050_000, 1_000_000, undefined]);
    expect(out[0]!.contextWindowSource).toBeUndefined();
  });

  it('keeps a size the provider already reported and ignores a bad payload', () => {
    expect(applyClineCatalogContextWindows([model('cline-pass/mimo-v2.6-pro', 8)], payload)[0]!.contextWindow).toBe(8);
    expect(applyClineCatalogContextWindows([model('a')], null)[0]!.contextWindow).toBeUndefined();
  });
});
