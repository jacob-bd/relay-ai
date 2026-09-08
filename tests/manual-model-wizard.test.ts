import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as p from '@clack/prompts';
import { runManualModelAddFlow, runManualModelRemoveFlow } from '../src/manual-model-wizard.js';
import { addManualModel, removeManualModel } from '../src/registry/manual-models.js';
vi.mock('@clack/prompts', () => ({ text: vi.fn(), confirm: vi.fn(), select: vi.fn(), isCancel: (v: unknown) => typeof v === 'symbol',
  spinner: () => ({ start: vi.fn(), stop: vi.fn() }), log: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('../src/registry/manual-models.js', () => ({ addManualModel: vi.fn(), removeManualModel: vi.fn() }));
const provider = { id: 'deepseek', manualModels: [{ id: 'beta', name: 'Beta' }] } as any;
beforeEach(() => vi.resetAllMocks());
describe('manual model wizard', () => {
  it('uses the shared test and save operation with optional context', async () => {
    vi.mocked(p.text).mockResolvedValueOnce('beta').mockResolvedValueOnce('Beta').mockResolvedValueOnce('128000');
    vi.mocked(p.confirm).mockResolvedValue(true);
    vi.mocked(addManualModel).mockResolvedValue({ ok: true, model: { name: 'Beta' } as any });
    expect(await runManualModelAddFlow(provider)).toBe(0);
    expect(addManualModel).toHaveBeenCalledWith({ providerId: 'deepseek', modelId: 'beta', displayName: 'Beta', contextWindow: 128000 });
  });
  it('keeps missing context unknown and shows failed validation', async () => {
    vi.mocked(p.text).mockResolvedValueOnce('beta').mockResolvedValueOnce('').mockResolvedValueOnce(undefined as never);
    vi.mocked(p.confirm).mockResolvedValue(true);
    vi.mocked(addManualModel).mockResolvedValue({ ok: false, error: 'Model rejected' });
    expect(await runManualModelAddFlow(provider)).toBe(1);
    expect(addManualModel).toHaveBeenCalledWith({ providerId: 'deepseek', modelId: 'beta', displayName: '' });
    expect(p.log.error).toHaveBeenCalledWith('Model rejected');
  });
  it.each([0, 1, 2, 3])('cancellation at step %i sends no requests', async step => {
    const values: any[] = ['beta', '', '', true]; values[step] = Symbol('cancel');
    vi.mocked(p.text).mockResolvedValueOnce(values[0]).mockResolvedValueOnce(values[1]).mockResolvedValueOnce(values[2]);
    vi.mocked(p.confirm).mockResolvedValue(values[3]);
    expect(await runManualModelAddFlow(provider)).toBe(0);
    expect(addManualModel).not.toHaveBeenCalled();
  });
  it('only removes the selected manual entry after confirmation', async () => {
    vi.mocked(p.select).mockResolvedValue('beta'); vi.mocked(p.confirm).mockResolvedValue(true);
    vi.mocked(removeManualModel).mockReturnValue({ ok: true });
    expect(await runManualModelRemoveFlow(provider)).toBe(0);
    expect(removeManualModel).toHaveBeenCalledWith('deepseek', 'beta');
  });
});
