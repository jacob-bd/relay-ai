import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalProvider, LocalProviderModel, UserPreferences } from '../src/types.js';

const ui = vi.hoisted(() => ({
  answers: [] as string[],
  shown: [] as Array<Array<{ value: string; label: string }>>,
}));

vi.mock('@clack/prompts', () => ({
  select: vi.fn(async ({ options }: { options: Array<{ value: string; label: string }> }) => {
    ui.shown.push(options);
    return ui.answers.shift();
  }),
  isCancel: () => false,
}));

const refreshState = vi.hoisted(() => ({ refreshed: [] as string[] }));
vi.mock('../src/providers-command.js', () => ({
  runProvidersRefreshModels: vi.fn(async (id: string) => {
    refreshState.refreshed.push(id);
    return 0;
  }),
}));

const { pickProviderModel } = await import('../src/prompts.js');
const { pickerRefresh } = await import('../src/picker-refresh.js');

function model(id: string): LocalProviderModel {
  return { id, name: id, family: 'test', brand: 'Test', modelFormat: 'openai' } as LocalProviderModel;
}

describe('model picker refresh', () => {
  let provider: LocalProvider;

  beforeEach(() => {
    ui.answers = [];
    ui.shown = [];
    refreshState.refreshed = [];
    provider = { id: 'openai', name: 'OpenAI', apiKey: 'k', models: [model('gpt-6-sol')] } as LocalProvider;
  });

  it('refreshes the provider and reopens the list with the new models', async () => {
    const reload = vi.fn(async () => ({ ...provider, models: [model('gpt-6-sol'), model('gpt-6-luna')] }));
    ui.answers = ['__refresh__', 'gpt-6-luna'];

    const picked = await pickProviderModel(provider, {} as UserPreferences, {
      message: 'Which model?',
      maxRecent: 3,
      refresh: pickerRefresh(provider, reload),
    });

    expect(refreshState.refreshed).toEqual(['openai']);
    expect(ui.shown[0]!.map(option => option.value)).toEqual(['gpt-6-sol', '__refresh__', '__back__']);
    expect(ui.shown[1]!.map(option => option.value)).toContain('gpt-6-luna');
    expect(picked).toMatchObject({ id: 'gpt-6-luna' });
    expect(provider.models.map(m => m.id)).toEqual(['gpt-6-sol', 'gpt-6-luna']);
  });

  it('offers refresh next to recent models too', async () => {
    ui.answers = ['gpt-6-sol'];
    const prefs = { recentModelsByProvider: { openai: ['gpt-6-sol'] } } as unknown as UserPreferences;

    await pickProviderModel(provider, prefs, { message: 'Which model?', maxRecent: 3, refresh: async () => {} });

    expect(ui.shown[0]!.map(option => option.value)).toEqual(['gpt-6-sol', '__browse_all__', '__refresh__', '__back__']);
  });

  it('offers refresh on the search/browse menu of a large catalog', async () => {
    provider.models = Array.from({ length: 30 }, (_, i) => model(`m-${i}`));
    const refresh = vi.fn(async () => { provider.models = [model('only')]; });
    ui.answers = ['__refresh__', 'only'];

    const picked = await pickProviderModel(provider, {} as UserPreferences, { message: 'Which model?', maxRecent: 3, refresh });

    expect(ui.shown[0]!.map(option => option.value)).toContain('__refresh__');
    expect(refresh).toHaveBeenCalledOnce();
    expect(picked).toMatchObject({ id: 'only' });
  });

  it('keeps the old list when the reload finds nothing', async () => {
    await pickerRefresh(provider, async () => undefined)();
    expect(provider.models.map(m => m.id)).toEqual(['gpt-6-sol']);
  });

  it('shows no refresh row when the caller does not offer one', async () => {
    ui.answers = ['gpt-6-sol'];
    await pickProviderModel(provider, {} as UserPreferences, { message: 'Which model?', maxRecent: 3 });
    expect(ui.shown[0]!.map(option => option.value)).toEqual(['gpt-6-sol', '__back__']);
  });
});
