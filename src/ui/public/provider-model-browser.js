export const PROVIDER_MODEL_PAGE_SIZE = 25;

export function isFreeModel(model) {
  return Boolean(
    model?.isFree
    || model?.freeStatus === 'verified_free'
    || model?.freeStatus === 'free_provider'
    || (model?.cost && model?.cost.input === 0 && model?.cost.output === 0),
  );
}

export function filterProviderModels(models, query, opts = {}) {
  const needle = query.trim().toLowerCase();
  const minCtx = opts.minContextWindow ?? 0;
  const freeOnly = Boolean(opts.freeOnly);

  return models.filter(model => {
    if (needle && !model.id.toLowerCase().includes(needle) && !(model.name ?? '').toLowerCase().includes(needle)) {
      return false;
    }
    if (minCtx > 0 && (model.contextWindow ?? 0) < minCtx) {
      return false;
    }
    if (freeOnly && !isFreeModel(model)) {
      return false;
    }
    return true;
  });
}

export function getProviderModelPage(models, query, requestedPage, opts = {}) {
  const filtered = filterProviderModels(models, query, opts);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PROVIDER_MODEL_PAGE_SIZE));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const start = (page - 1) * PROVIDER_MODEL_PAGE_SIZE;
  return {
    items: filtered.slice(start, start + PROVIDER_MODEL_PAGE_SIZE),
    page,
    total: filtered.length,
    totalPages,
  };
}

export function formatModelPrice(cost, isFree = false, label = 'FREE') {
  if (isFree || (cost && cost.input === 0 && cost.output === 0)) {
    return `<span class="free-badge">${label}</span>`;
  }
  if (!cost || !Number.isFinite(cost.input) || !Number.isFinite(cost.output)) return '—';
  const format = value => `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
  return `${format(cost.input)} / ${format(cost.output)}`;
}
