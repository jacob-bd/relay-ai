// src/prompts.ts
import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { UserPreferences, ConflictInfo, LocalProvider, LocalProviderModel } from './types.js';

const BROWSE_ALL = '__browse_all__';
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
    const brandCmp = a.brand.localeCompare(b.brand);
    return brandCmp !== 0 ? brandCmp : a.id.localeCompare(b.id);
  });
}

export function filterModelsBySearch<T extends ModelSearchable>(models: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return models.filter(
    m =>
      m.id.toLowerCase().includes(q) ||
      m.name.toLowerCase().includes(q) ||
      m.brand.toLowerCase().includes(q),
  );
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

async function pickModelFromPagedList<T extends { id: string }>(
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
      options.push({
        value: PAGE_PREV,
        label: '← Previous page',
        hint: `Page ${currentPage} of ${totalPages}`,
      });
    }

    options.push(...pageItems.map(toOption));

    if (currentPage < totalPages - 1) {
      options.push({
        value: PAGE_NEXT,
        label: 'Next page →',
        hint: `Page ${currentPage + 2} of ${totalPages}`,
      });
    }

    if (links?.search) {
      options.push({ value: SWITCH_SEARCH, label: 'Search instead →', hint: '' });
    }
    if (links?.browse) {
      options.push({ value: SWITCH_BROWSE, label: 'Browse all instead →', hint: '' });
    }
    if (links?.newSearch) {
      options.push({ value: SWITCH_SEARCH, label: '← New search', hint: '' });
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
): Promise<T | null> {
  let mode: LargeCatalogMode = 'choose';

  while (true) {
    if (mode === 'choose') {
      const method = await p.select({
        message: `${message} (${models.length} available)`,
        options: [
          { value: MODE_SEARCH, label: 'Search models', hint: 'Filter by name, id, or brand' },
          {
            value: MODE_BROWSE,
            label: 'Browse all models',
            hint: `${MODEL_PAGE_SIZE} per page · ${Math.ceil(browseList.length / MODEL_PAGE_SIZE)} pages`,
          },
        ],
      });

      if (p.isCancel(method)) {
        p.cancel('Cancelled.');
        return null;
      }

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
): Promise<T | null> {
  if (models.length === 0) return null;

  const orderedBrowse = browseList ?? sortModelsByBrand(models);

  if (models.length <= MODEL_SEARCH_THRESHOLD) {
    const options = models.map(toOption);
    const initialValue =
      initialModelId && options.some(o => o.value === initialModelId)
        ? initialModelId
        : options[0]?.value;

    const picked = await p.select({
      message,
      options,
      initialValue,
    });

    if (p.isCancel(picked)) {
      p.cancel('Cancelled.');
      return null;
    }

    const selected = models.find(m => m.id === String(picked));
    if (!selected) return null;
    return selected;
  }

  return selectLargeCatalog(models, orderedBrowse, toOption, message, initialModelId);
}

function noteEnvConflicts(conflicts: ConflictInfo[]): void {
  if (conflicts.length === 0) return;
  const lines = conflicts.map(c => `  ${pc.dim(c.name)}=${pc.dim(c.value)}`).join('\n');
  p.note(lines, pc.yellow('Env vars that will be temporarily overridden:'));
}

function modelToOption(model: LocalProviderModel, hint?: string) {
  return {
    value: model.id,
    label: model.name !== model.id ? model.name : model.id,
    hint: hint ?? (model.name !== model.id ? model.id : model.brand),
  };
}

export async function browseAllModels(
  provider: LocalProvider,
  prefs: UserPreferences,
): Promise<LocalProviderModel | null> {
  return selectModelWithSearch(
    provider.models,
    m => modelToOption(m),
    'Which model?',
    prefs.lastModel,
  );
}

export async function pickLocalModel(
  provider: LocalProvider,
  conflicts: ConflictInfo[],
  prefs: UserPreferences,
): Promise<LocalProviderModel | null> {
  // Show recently used models for this provider if we have any.
  const recentIds = (prefs.recentModelsByProvider?.[provider.id] ?? []).slice(0, MAX_RECENT);
  const recentModels = recentIds
    .map(id => provider.models.find(m => m.id === id))
    .filter((m): m is LocalProviderModel => m !== undefined);

  let selectedModel: LocalProviderModel;

  if (recentModels.length > 0) {
    const options = [
      ...recentModels.map(m => modelToOption(m, 'recent')),
      { value: BROWSE_ALL, label: 'Browse all models →', hint: `${provider.models.length} available` },
    ];

    const picked = await p.select({
      message: 'Which model?',
      options,
      initialValue: recentModels[0].id,
    });

    if (p.isCancel(picked)) {
      p.cancel('Cancelled.');
      return null;
    }

    if (String(picked) === BROWSE_ALL) {
      const browsed = await browseAllModels(provider, prefs);
      if (!browsed) return null;
      selectedModel = browsed;
    } else {
      selectedModel = recentModels.find(m => m.id === String(picked))!;
    }
  } else {
    const browsed = await browseAllModels(provider, prefs);
    if (!browsed) return null;
    selectedModel = browsed;
  }

  noteEnvConflicts(conflicts);

  const confirmed = await p.confirm({
    message: `Launch Claude Code · ${pc.bold(selectedModel.id)} via ${pc.bold(provider.name)}?`,
    initialValue: true,
  });

  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel('Cancelled.');
    return null;
  }

  p.outro(pc.green('Launching...'));
  return selectedModel;
}
