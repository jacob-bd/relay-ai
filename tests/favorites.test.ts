// tests/favorites.test.ts
import { describe, it, expect } from 'vitest';
import { MAX_MODEL_CATALOG } from '../src/constants.js';
import { addFavorite, removeFavorite, isFavorite, normalizeFavoriteModels } from '../src/favorites.js';
import type { FavoriteModel } from '../src/types.js';

const fav = (providerId: string, modelId: string): FavoriteModel => ({ providerId, modelId });

describe('isFavorite', () => {
  it('returns false for an empty list', () => {
    expect(isFavorite([], fav('groq', 'llama-3.3-70b'))).toBe(false);
  });

  it('returns true when matching entry exists', () => {
    const list = [fav('groq', 'llama-3.3-70b')];
    expect(isFavorite(list, fav('groq', 'llama-3.3-70b'))).toBe(true);
  });

  it('returns false when providerId differs', () => {
    const list = [fav('groq', 'llama-3.3-70b')];
    expect(isFavorite(list, fav('deepseek', 'llama-3.3-70b'))).toBe(false);
  });

  it('returns false when modelId differs', () => {
    const list = [fav('groq', 'llama-3.3-70b')];
    expect(isFavorite(list, fav('groq', 'llama-3.1-8b'))).toBe(false);
  });
});

describe('addFavorite', () => {
  it('adds a new entry and returns ok', () => {
    const result = addFavorite([], fav('groq', 'llama-3.3-70b'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.list).toEqual([fav('groq', 'llama-3.3-70b')]);
    }
  });

  it('returns duplicate when the same entry is added twice', () => {
    const list = [fav('groq', 'llama-3.3-70b')];
    const result = addFavorite(list, fav('groq', 'llama-3.3-70b'));
    expect(result).toEqual({ ok: false, reason: 'duplicate' });
  });

  it('returns cap when the list is full', () => {
    const list: FavoriteModel[] = Array.from({ length: MAX_MODEL_CATALOG }, (_, i) =>
      fav('provider', `model-${i}`),
    );
    const result = addFavorite(list, fav('provider', 'model-new'));
    expect(result).toEqual({ ok: false, reason: 'cap' });
  });

  it('respects a custom cap argument', () => {
    const list = [fav('groq', 'a'), fav('groq', 'b')];
    expect(addFavorite(list, fav('groq', 'c'), 2)).toEqual({ ok: false, reason: 'cap' });
    expect(addFavorite(list, fav('groq', 'c'), 3).ok).toBe(true);
  });

  it('does not mutate the input list', () => {
    const list: FavoriteModel[] = [];
    addFavorite(list, fav('groq', 'llama'));
    expect(list).toHaveLength(0);
  });

  it('appends to the end of the list', () => {
    const list = [fav('groq', 'a'), fav('deepseek', 'b')];
    const result = addFavorite(list, fav('google', 'c'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.list).toEqual([fav('groq', 'a'), fav('deepseek', 'b'), fav('google', 'c')]);
    }
  });
});

describe('removeFavorite', () => {
  it('removes the matching entry', () => {
    const list = [fav('groq', 'a'), fav('deepseek', 'b'), fav('google', 'c')];
    expect(removeFavorite(list, fav('deepseek', 'b'))).toEqual([fav('groq', 'a'), fav('google', 'c')]);
  });

  it('returns the list unchanged when entry not present', () => {
    const list = [fav('groq', 'a')];
    expect(removeFavorite(list, fav('groq', 'z'))).toEqual(list);
  });

  it('handles an empty list gracefully', () => {
    expect(removeFavorite([], fav('groq', 'a'))).toEqual([]);
  });

  it('does not mutate the input list', () => {
    const list = [fav('groq', 'a'), fav('deepseek', 'b')];
    removeFavorite(list, fav('groq', 'a'));
    expect(list).toHaveLength(2);
  });

  it('removes only the first matching entry if provider+model is unique', () => {
    // By design each provider:model pair is unique; double-check remove leaves others intact
    const list = [fav('groq', 'a'), fav('groq', 'b'), fav('groq', 'a')];
    // Note: addFavorite prevents duplicates, but removeFavorite still removes all matches
    expect(removeFavorite(list, fav('groq', 'a'))).toEqual([fav('groq', 'b')]);
  });
});

describe('MAX_MODEL_CATALOG', () => {
  it('is 20', () => {
    expect(MAX_MODEL_CATALOG).toBe(20);
  });
});

describe('normalizeFavoriteModels', () => {
  it('returns an empty list for malformed input', () => {
    expect(normalizeFavoriteModels(undefined, 20)).toEqual([]);
    expect(normalizeFavoriteModels({ providerId: 'kilo' }, 20)).toEqual([]);
  });

  it('keeps valid entries in order, removes duplicates, and keeps provider boundaries', () => {
    expect(normalizeFavoriteModels([
      { providerId: 'kilo', modelId: 'same' },
      { providerId: 'kilo', modelId: 'same' },
      { providerId: 'google', modelId: 'same' },
      { providerId: '  openai  ', modelId: '  gpt-5.5  ' },
      { providerId: '', modelId: 'missing-provider' },
      { providerId: 'missing-model', modelId: '' },
    ], 20)).toEqual([
      { providerId: 'kilo', modelId: 'same' },
      { providerId: 'google', modelId: 'same' },
      { providerId: 'openai', modelId: 'gpt-5.5' },
    ]);
  });

  it('enforces the requested capacity after normalization', () => {
    expect(normalizeFavoriteModels([
      { providerId: 'a', modelId: '1' },
      { providerId: 'b', modelId: '2' },
      { providerId: 'c', modelId: '3' },
    ], 2)).toEqual([
      { providerId: 'a', modelId: '1' },
      { providerId: 'b', modelId: '2' },
    ]);
  });
});
