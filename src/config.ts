// src/config.ts
import Conf from 'conf';
import type { UserPreferences, ModelInfo } from './types.js';
import { MODELS_CACHE_TTL_MS } from './constants.js';

const store = new Conf<UserPreferences>({
  projectName: 'opencode-starter',
  defaults: {},
});

export function loadPreferences(): UserPreferences {
  return {
    lastBackend: store.get('lastBackend'),
    lastModel: store.get('lastModel'),
    modelListCache: store.get('modelListCache'),
  };
}

export function savePreferences(prefs: Partial<Pick<UserPreferences, 'lastBackend' | 'lastModel'>>): void {
  if (prefs.lastBackend !== undefined) store.set('lastBackend', prefs.lastBackend);
  if (prefs.lastModel !== undefined) store.set('lastModel', prefs.lastModel);
}

export function getCachedModels(backendId: 'zen' | 'go'): ModelInfo[] | null {
  const modelListCache = store.get('modelListCache');
  const entry = modelListCache?.[backendId];
  if (!entry) return null;
  const age = Date.now() - new Date(entry.fetchedAt).getTime();
  if (age > MODELS_CACHE_TTL_MS) return null;
  return entry.models;
}

export function setCachedModels(backendId: 'zen' | 'go', models: ModelInfo[]): void {
  const existing = store.get('modelListCache') ?? {};
  store.set('modelListCache', {
    ...existing,
    [backendId]: { models, fetchedAt: new Date().toISOString() },
  });
}

export function getSubscriptionTier(): 'free' | 'zen' | 'go' | 'both' | null {
  return store.get('subscriptionTier') ?? null;
}

export function setSubscriptionTier(tier: 'free' | 'zen' | 'go' | 'both'): void {
  store.set('subscriptionTier', tier);
}
