export interface ModelSearchField {
  value?: string;
  weight: number;
}

export function normalizeModelSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/([a-z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([a-z])/g, '$1 $2')
    .replace(/[\s\-._/:]+/g, ' ')
    .trim();
}

export function compactModelSearchText(value: string): string {
  return normalizeModelSearchText(value).replace(/\s+/g, '');
}

export function scoreModelSearch(query: string, fields: ModelSearchField[]): number {
  const normalizedQuery = normalizeModelSearchText(query);
  const compactQuery = normalizedQuery.replace(/\s+/g, '');
  if (!normalizedQuery || !compactQuery) return 0;

  const searchableFields = fields
    .filter(field => field.value)
    .map(field => {
      const normalized = normalizeModelSearchText(field.value!);
      return { normalized, compact: normalized.replace(/\s+/g, ''), weight: field.weight };
    });
  const tokens = normalizedQuery.split(' ').filter(Boolean);

  if (!tokens.every(token => searchableFields.some(field => field.normalized.includes(token) || field.compact.includes(token)))) {
    return 0;
  }

  let score = 1;
  for (const field of searchableFields) {
    if (field.normalized === normalizedQuery) score = Math.max(score, field.weight + 300);
    else if (field.compact === compactQuery) score = Math.max(score, field.weight + 260);
    else if (field.normalized.startsWith(normalizedQuery)) score = Math.max(score, field.weight + 180);
    else if (field.compact.startsWith(compactQuery)) score = Math.max(score, field.weight + 150);
    else if (field.normalized.includes(normalizedQuery)) score = Math.max(score, field.weight + 90);
    else if (field.compact.includes(compactQuery)) score = Math.max(score, field.weight + 70);
  }

  return score + tokens.reduce((sum, token) => (
    sum + searchableFields.reduce((best, field) => {
      if (field.normalized.split(' ').includes(token)) return Math.max(best, 30);
      if (field.normalized.includes(token) || field.compact.includes(token)) return Math.max(best, 12);
      return best;
    }, 0)
  ), 0);
}
