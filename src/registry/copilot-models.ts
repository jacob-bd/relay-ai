import type { CachedModel } from './types.js';
import { resolveContextWindow } from '../context-window.js';
import { deriveBrand } from '../models.js';

export type CopilotPlanTier = 'free' | 'paid' | 'unknown';

const FREE_MODEL_IDS = new Set([
  'gpt-4.1',
  'gpt-4o',
  'gpt-4o-mini',
  'raptor-mini',
  'goldeneye',
]);
const FREE_CHAT_BLOCKLIST = new Set(['gpt-5-mini']);

export function copilotPlanTier(providerData?: Record<string, unknown>): CopilotPlanTier {
  const copilot = providerData?.['copilot'];
  if (!copilot || typeof copilot !== 'object' || Array.isArray(copilot)) return 'unknown';
  const summary = copilot as Record<string, unknown>;
  if (summary['lookup_status'] === 'unknown') return 'unknown';
  if (summary['is_free_plan'] === true) return 'free';
  if (summary['is_free_plan'] === false) return 'paid';
  return 'unknown';
}

export function normalizeCopilotModels(
  rows: unknown[],
  tier: CopilotPlanTier,
): CachedModel[] {
  const models: CachedModel[] = [];
  for (const value of rows) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const row = value as Record<string, unknown>;
    const id = typeof row['id'] === 'string' ? row['id'].trim() : '';
    if (!id || !copilotModelAllowed(row, tier)) continue;
    const lowerId = id.toLowerCase();
    const isFree = tier !== 'paid' || copilotModelIsIncluded(row);
    const family = lowerId.split(/[-/:]/)[0] ?? lowerId;
    const contextWindow = numericValue(row['context_length'])
      ?? numericValue(row['contextWindow'])
      ?? numericValue(row['context_window'])
      ?? resolveContextWindow(id);
    models.push({
      id,
      name: `${id} [Copilot]`,
      upstreamModelId: id,
      family,
      brand: deriveBrand(family),
      contextWindow,
      isFree,
      freeStatus: isFree ? 'verified_free' : 'unknown',
      modelFormat: 'openai',
      npm: '@ai-sdk/openai-compatible',
      apiUrl: 'https://api.githubcopilot.com',
    });
  }
  return models;
}

export function filterCachedCopilotModels(
  models: CachedModel[],
  tier: CopilotPlanTier,
): CachedModel[] {
  return models.flatMap(model => {
    const id = model.id.toLowerCase();
    if (!copilotIdIsCallable(id)) return [];
    if (tier !== 'paid' && (!FREE_MODEL_IDS.has(id) || FREE_CHAT_BLOCKLIST.has(id))) return [];
    if (tier === 'paid') return [model];
    return [{ ...model, isFree: true, freeStatus: 'verified_free' as const }];
  });
}

function copilotModelAllowed(row: Record<string, unknown>, tier: CopilotPlanTier): boolean {
  const id = String(row['id'] ?? '').toLowerCase();
  if (!copilotIdIsCallable(id)) return false;
  if (row['model_picker_enabled'] === false) return false;
  const policy = row['policy'];
  if (policy && typeof policy === 'object' && !Array.isArray(policy)) {
    if (String((policy as Record<string, unknown>)['state'] ?? '').toLowerCase() === 'disabled') return false;
  }
  const capabilities = row['capabilities'];
  if (capabilities && typeof capabilities === 'object' && !Array.isArray(capabilities)) {
    const family = String((capabilities as Record<string, unknown>)['family'] ?? '').toLowerCase();
    if (family.includes('embedding')) return false;
  }
  const endpoints = row['supported_endpoints'];
  if (Array.isArray(endpoints) && endpoints.length > 0) {
    const supportsChat = endpoints.some(endpoint => {
      const normalized = String(endpoint).toLowerCase().replace(/\/$/, '');
      return normalized.endsWith('/chat/completions') || normalized === 'chat/completions';
    });
    if (!supportsChat) return false;
  }
  if (tier !== 'paid' && (!FREE_MODEL_IDS.has(id) || FREE_CHAT_BLOCKLIST.has(id))) return false;
  return true;
}

function copilotIdIsCallable(id: string): boolean {
  return id !== 'auto'
    && !id.endsWith('-auto')
    && !id.includes('embedding');
}

function copilotModelIsIncluded(row: Record<string, unknown>): boolean {
  const id = String(row['id'] ?? '').toLowerCase();
  if (FREE_CHAT_BLOCKLIST.has(id) || !copilotIdIsCallable(id)) return false;
  const billing = row['billing'];
  if (billing && typeof billing === 'object' && !Array.isArray(billing)) {
    const multiplier = numericValue((billing as Record<string, unknown>)['multiplier']);
    if (multiplier !== undefined) return multiplier === 0;
  }
  return FREE_MODEL_IDS.has(id);
}

function numericValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return undefined;
}
