import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleUiApiRequest } from '../src/ui/api.js';
import { createMockRequest, createMockResponse } from './helpers/ui-api-test-utils.js';

vi.mock('../src/registry/crud.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/registry/crud.js')>()),
  renameProvider: vi.fn(),
}));

async function post(body: unknown) {
  const response = createMockResponse();
  handleUiApiRequest(
    createMockRequest('POST', '/api/providers/rename', JSON.stringify(body)),
    response.res,
  );
  await vi.waitFor(() => expect(response.result.data).not.toBe(''));
  return response.result;
}

describe('POST /api/providers/rename', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects a request with no providerId or no name', async () => {
    const { renameProvider } = await import('../src/registry/crud.js');
    expect((await post({ name: 'x' })).code).toBe(400);
    expect((await post({ providerId: 'groq' })).code).toBe(400);
    expect(renameProvider).not.toHaveBeenCalled();
  });

  it('renames and returns the new name', async () => {
    const { renameProvider } = await import('../src/registry/crud.js');
    vi.mocked(renameProvider).mockReturnValue({ renamed: true, id: 'groq', name: 'Work Groq' });

    const result = await post({ providerId: ' groq ', name: 'Work Groq' });

    expect(result.code).toBe(200);
    expect(JSON.parse(result.data)).toEqual({ ok: true, name: 'Work Groq' });
    expect(renameProvider).toHaveBeenCalledWith('groq', 'Work Groq');
  });

  it('returns the reason when the name is refused', async () => {
    const { renameProvider } = await import('../src/registry/crud.js');
    vi.mocked(renameProvider).mockReturnValue({ renamed: false, id: 'groq', error: 'The name "Mistral" is already used by another provider.' });

    const result = await post({ providerId: 'groq', name: 'Mistral' });

    expect(JSON.parse(result.data)).toMatchObject({ ok: false, error: expect.stringContaining('already used') });
  });
});
