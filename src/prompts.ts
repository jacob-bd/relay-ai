// src/prompts.ts
import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { UserPreferences, ConflictInfo, LocalProvider, LocalProviderModel } from './types.js';
import {
  confirmLaunchMessage,
  fmtModel,
  modelSelectOption,
  navOption,
  printEnvConflictPanel,
  providerSelectOption,
  relayIntro,
  relayOutro,
  formatModelLabel,
} from './ui.js';
import { scoreModelSearch } from './model-search.js';

export function claudeTransparentModeOptions(modelLabel: string): Array<{
  value: boolean;
  label: string;
}> {
  return [
    { value: true, label: `Yes — Use ${modelLabel} alongside Anthropic models` },
    { value: false, label: `No — Use only ${modelLabel} through Relay AI` },
  ];
}

const BROWSE_ALL = '__browse_all__';
const REFRESH = '__refresh__';

function refreshOption() {
  return navOption(REFRESH, '↻ Refresh models', 'Fetch the latest list from the provider');
}
const MAX_RECENT = 3;
/** Providers with more models than this offer search or paginated browse. */
export const MODEL_SEARCH_THRESHOLD = 25;
/** Models shown per page when browsing large catalogs. */
export const MODEL_PAGE_SIZE = 15;

const PAGE_PREV = '__page_prev__';
const PAGE_NEXT = '__page_next__';
const SWITCH_SEARCH = '__switch_search__';
const SWITCH_BROWSE = '__switch_browse__';
const MODE_SEARCH = 'search';
const MODE_BROWSE = 'browse';

type ModelSearchable = { id: string; name: string; brand: string };
type ModelSelectOption = { value: string; label: string; hint: string };
type LargeCatalogMode = 'choose' | 'search' | 'browse';

function sortModelsByBrand<T extends ModelSearchable>(models: T[]): T[] {
  return [...models].sort((a, b) => {
    const brandCmp = a.brand.localeCompare(b.brand, undefined, { sensitivity: 'base' });
    if (brandCmp !== 0) return brandCmp;
    const nameA = a.name || a.id;
    const nameB = b.name || b.id;
    return nameA.localeCompare(nameB, undefined, { sensitivity: 'base', numeric: true });
  });
}

export function filterModelsBySearch<T extends ModelSearchable>(models: T[], query: string): T[] {
  if (!query.trim()) return [];
  return models
    .map((model, index) => ({
      model,
      index,
      score: scoreModelSearch(query, [
        { value: model.name, weight: 800 },
        { value: model.id, weight: 700 },
        { value: model.brand, weight: 350 },
      ]),
    }))
    .filter(result => result.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    })
    .map(result => result.model);
}

/** Slice a model list for paginated browse UI. */
export function sliceModelPage<T>(
  items: T[],
  page: number,
  pageSize = MODEL_PAGE_SIZE,
): { items: T[]; page: number; totalPages: number } {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const clampedPage = Math.min(Math.max(0, page), totalPages - 1);
  const start = clampedPage * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page: clampedPage,
    totalPages,
  };
}

type PagedPickResult<T> = T | 'search' | 'browse' | 'menu';

function isSelectedModel<T extends { id: string }>(value: PagedPickResult<T>): value is T {
  return value !== 'search' && value !== 'browse' && value !== 'menu';
}

/** Paginated model picker — exported for global favorites search. */
export async function pickModelFromPagedList<T extends { id: string }>(
  list: T[],
  toOption: (m: T) => ModelSelectOption,
  messagePrefix: string,
  initialModelId?: string,
  links?: { search?: boolean; browse?: boolean; newSearch?: boolean },
): Promise<PagedPickResult<T>> {
  let page = 0;

  if (initialModelId) {
    const idx = list.findIndex(m => m.id === initialModelId);
    if (idx >= 0) page = Math.floor(idx / MODEL_PAGE_SIZE);
  }

  while (true) {
    const { items: pageItems, page: currentPage, totalPages } = sliceModelPage(list, page);
    const options: ModelSelectOption[] = [];

    if (currentPage > 0) {
      options.push(navOption(PAGE_PREV, '← Previous page', `Page ${currentPage} of ${totalPages}`));
    }

    options.push(...pageItems.map(toOption));

    if (currentPage < totalPages - 1) {
      options.push(navOption(PAGE_NEXT, 'Next page →', `Page ${currentPage + 2} of ${totalPages}`));
    }

    if (links?.search) {
      options.push(navOption(SWITCH_SEARCH, 'Search instead →', ''));
    }
    if (links?.browse) {
      options.push(navOption(SWITCH_BROWSE, 'Browse all instead →', ''));
    }
    if (links?.newSearch) {
      options.push(navOption(SWITCH_SEARCH, '← New search', ''));
    }

    const initialValue =
      (initialModelId && pageItems.some(m => m.id === initialModelId) ? initialModelId : pageItems[0]?.id)
      ?? options[0]?.value;

    const picked = await p.select({
      message: `${messagePrefix} (page ${currentPage + 1} of ${totalPages})`,
      options,
      initialValue,
    });

    if (p.isCancel(picked)) return 'menu';

    const choice = String(picked);
    if (choice === PAGE_PREV) {
      page = currentPage - 1;
      continue;
    }
    if (choice === PAGE_NEXT) {
      page = currentPage + 1;
      continue;
    }
    if (choice === SWITCH_SEARCH) return 'search';
    if (choice === SWITCH_BROWSE) return 'browse';

    const selected = list.find(m => m.id === choice);
    if (selected) return selected;
    continue;
  }
}

async function selectLargeCatalog<T extends ModelSearchable & { id: string }>(
  models: T[],
  browseList: T[],
  toOption: (m: T) => ModelSelectOption,
  message: string,
  initialModelId?: string,
  refreshable = false,
): Promise<T | 'back' | 'refresh' | null> {
  let mode: LargeCatalogMode = 'choose';

  while (true) {
    if (mode === 'choose') {
      const method = await p.select({
        message: `${message} (${models.length} available)`,
        options: [
          { value: MODE_SEARCH, label: pc.cyan('Search models'), hint: 'Filter by name, id, or brand' },
          {
            value: MODE_BROWSE,
            label: pc.cyan('Browse all models'),
            hint: `${MODEL_PAGE_SIZE} per page · ${Math.ceil(browseList.length / MODEL_PAGE_SIZE)} pages`,
          },
          ...(refreshable ? [refreshOption()] : []),
          navOption('__back__', '← Go back', 'Select a different provider'),
        ],
      });

      if (p.isCancel(method) || String(method) === '__back__') {
        return 'back';
      }
      if (String(method) === REFRESH) return 'refresh';

      mode = method === MODE_BROWSE ? 'browse' : 'search';
      continue;
    }

    if (mode === 'browse') {
      const picked = await pickModelFromPagedList(
        browseList,
        toOption,
        message,
        initialModelId,
        { search: true },
      );

      if (picked === 'search') {
        mode = 'search';
        continue;
      }
      if (picked === 'menu') {
        mode = 'choose';
        continue;
      }
      if (isSelectedModel(picked)) return picked;

      continue;
    }

    const searchInput = await p.text({
      message: `Search models (${models.length} available):`,
      placeholder: 'e.g. claude, sonnet, llama',
    });

    if (p.isCancel(searchInput)) {
      mode = 'choose';
      continue;
    }

    const matched = filterModelsBySearch(browseList, String(searchInput));
    if (matched.length === 0) {
      p.log.warn('No models match — try a different search');
      continue;
    }

    const result = await pickModelFromPagedList(
      matched,
      toOption,
      matched.length === 1 ? 'Match found' : `Select model (${matched.length} matches)`,
      initialModelId,
      { browse: true, newSearch: true },
    );

    if (result === 'search') continue;
    if (result === 'browse') {
      mode = 'browse';
      continue;
    }
    if (result === 'menu') {
      mode = 'choose';
      continue;
    }
    if (isSelectedModel(result)) return result;
  }
}

async function selectModelWithSearch<T extends ModelSearchable & { id: string }>(
  models: T[],
  toOption: (m: T) => ModelSelectOption,
  message: string,
  initialModelId?: string,
  browseList?: T[],
  refreshable = false,
): Promise<T | 'back' | 'refresh' | null> {
  if (models.length === 0) return null;

  const orderedBrowse = browseList ?? sortModelsByBrand(models);

  if (models.length <= MODEL_SEARCH_THRESHOLD) {
    const options = [
      ...models.map(toOption),
      ...(refreshable ? [refreshOption()] : []),
      navOption('__back__', '← Go back', ''),
    ];
    const initialValue =
      initialModelId && options.some(o => o.value === initialModelId)
        ? initialModelId
        : options[0]?.value;

    const picked = await p.select({
      message,
      options,
      initialValue,
    });

    if (p.isCancel(picked) || String(picked) === '__back__') {
      return 'back';
    }
    if (String(picked) === REFRESH) return 'refresh';

    const selected = models.find(m => m.id === String(picked));
    if (!selected) return null;
    return selected;
  }

  return selectLargeCatalog(models, orderedBrowse, toOption, message, initialModelId, refreshable);
}

function noteEnvConflicts(conflicts: ConflictInfo[]): void {
  printEnvConflictPanel(conflicts);
}

function modelToOption(model: LocalProviderModel, hint?: string) {
  return modelSelectOption(model, hint);
}

export async function browseAllModels(
  provider: LocalProvider,
  prefs: UserPreferences,
  refreshable = false,
): Promise<LocalProviderModel | 'back' | 'refresh' | null> {
  return selectModelWithSearch(
    provider.models,
    m => modelToOption(m),
    'Which model?',
    prefs.lastModel,
    undefined,
    refreshable,
  );
}

/**
 * Recently used models first (plus Browse all / Go back), or the full list when
 * there are none. With `refresh`, a "↻ Refresh models" row re-fetches the
 * provider's models (updating `provider.models`) and reopens the list.
 */
export async function pickProviderModel(
  provider: LocalProvider,
  prefs: UserPreferences,
  opts: { message: string; maxRecent: number; refresh?: () => Promise<void> },
): Promise<LocalProviderModel | 'back' | null> {
  const refreshable = Boolean(opts.refresh);
  while (true) {
    const recentModels = (prefs.recentModelsByProvider?.[provider.id] ?? [])
      .slice(0, opts.maxRecent)
      .map(id => provider.models.find(m => m.id === id))
      .filter((m): m is LocalProviderModel => m !== undefined);

    let picked: LocalProviderModel | 'back' | 'refresh' | null;
    if (recentModels.length > 0) {
      const choice = await p.select({
        message: opts.message,
        options: [
          ...recentModels.map(m => modelToOption(m, 'recent')),
          navOption(BROWSE_ALL, 'Browse all models →', `${provider.models.length} available`),
          ...(refreshable ? [refreshOption()] : []),
          navOption('__back__', '← Go back', 'Select a different provider'),
        ],
        initialValue: recentModels[0]!.id,
      });

      if (p.isCancel(choice) || String(choice) === '__back__') return 'back';
      if (String(choice) === REFRESH) {
        picked = 'refresh';
      } else if (String(choice) === BROWSE_ALL) {
        picked = await browseAllModels(provider, prefs, refreshable);
        if (picked === 'back') continue;
      } else {
        picked = recentModels.find(m => m.id === String(choice))!;
      }
    } else {
      picked = await browseAllModels(provider, prefs, refreshable);
      if (picked === 'back') return 'back';
    }

    if (picked === 'refresh') {
      await opts.refresh!();
      continue;
    }
    return picked;
  }
}

export async function pickLocalModel(
  provider: LocalProvider,
  conflicts: ConflictInfo[],
  prefs: UserPreferences,
  refresh?: () => Promise<void>,
): Promise<LocalProviderModel | 'back' | null> {
  const selectedModel = await pickProviderModel(provider, prefs, { message: 'Which model?', maxRecent: MAX_RECENT, refresh });
  if (selectedModel === 'back' || !selectedModel) return selectedModel;

  noteEnvConflicts(conflicts);

  const modelLabel = formatModelLabel(selectedModel);
  const confirmed = await p.confirm({
    message: confirmLaunchMessage('Claude Code', modelLabel, selectedModel.id, provider.name),
    initialValue: true,
  });

  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel('Cancelled.');
    return null;
  }

  relayOutro('Launching', fmtModel(modelLabel, selectedModel.id));
  return selectedModel;
}
