export const PROVIDER_MODEL_PAGE_SIZE = 25;

export function filterProviderModels(models, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return models;
  return models.filter(model =>
    model.id.toLowerCase().includes(needle)
    || (model.name ?? '').toLowerCase().includes(needle),
  );
}

export function getProviderModelPage(models, query, requestedPage) {
  const filtered = filterProviderModels(models, query);
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

export function formatModelPrice(cost) {
  if (!cost || !Number.isFinite(cost.input) || !Number.isFinite(cost.output)) return '—';
  const format = value => `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
  return `${format(cost.input)} / ${format(cost.output)}`;
}
