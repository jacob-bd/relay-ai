import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleUiApiRequest } from '../src/ui/api.js';
import { createMockRequest, createMockResponse } from './helpers/ui-api-test-utils.js';

vi.mock('../src/registry/custom-endpoint.js', () => ({
  addCustomEndpointProvider: vi.fn(),
  updateCustomEndpointProvider: vi.fn(),
}));

async function post(body: unknown) {
  const response = createMockResponse();
  handleUiApiRequest(
    createMockRequest('POST', '/api/providers/edit-custom', JSON.stringify(body)),
    response.res,
  );
  await vi.waitFor(() => expect(response.result.data).not.toBe(''));
  return response.result;
}

describe('POST /api/providers/edit-custom', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects a request with no providerId', async () => {
    const { updateCustomEndpointProvider } = await import('../src/registry/custom-endpoint.js');
    const result = await post({ displayName: 'x' });

    expect(result.code).toBe(400);
    expect(updateCustomEndpointProvider).not.toHaveBeenCalled();
  });

  it('forwards a valid request and returns the model count', async () => {
    const { updateCustomEndpointProvider } = await import('../src/registry/custom-endpoint.js');
    vi.mocked(updateCustomEndpointProvider).mockResolvedValue({
      updated: true,
      provider: { name: 'Acme Prod' } as any,
      modelCount: 4,
    });

    const result = await post({ providerId: 'custom-acme', displayName: 'Acme Prod' });

    expect(result.code).toBe(200);
    expect(JSON.parse(result.data)).toMatchObject({ ok: true, name: 'Acme Prod', count: 4 });
    expect(updateCustomEndpointProvider).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'custom-acme', displayName: 'Acme Prod' }),
    );
  });

  it('passes canSaveAnyway through on a connection failure', async () => {
    const { updateCustomEndpointProvider } = await import('../src/registry/custom-endpoint.js');
    vi.mocked(updateCustomEndpointProvider).mockResolvedValue({
      updated: false,
      error: 'API key was rejected.',
      hint: 'Check your key.',
      canSaveAnyway: true,
    });

    const result = await post({ providerId: 'custom-acme', apiKey: 'bad' });

    expect(JSON.parse(result.data)).toMatchObject({
      ok: false,
      error: 'API key was rejected.',
      hint: 'Check your key.',
      canSaveAnyway: true,
    });
  });

  it('omits canSaveAnyway on a refusal', async () => {
    const { updateCustomEndpointProvider } = await import('../src/registry/custom-endpoint.js');
    vi.mocked(updateCustomEndpointProvider).mockResolvedValue({
      updated: false,
      error: 'Edit is only available for custom backends.',
    });

    const result = await post({ providerId: 'groq', displayName: 'Groq Fast' });

    expect(JSON.parse(result.data).canSaveAnyway).toBeUndefined();
  });
});
