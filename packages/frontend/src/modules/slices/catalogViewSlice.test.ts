import { describe, expect, it } from 'vitest';
import type { CatalogViewAction, CatalogViewState } from '@freshrescue/contract-ui';
import { catalogViewSlice } from './catalogViewSlice';

const ALL: CatalogViewState = { cuisineId: null, highlightId: null };

describe('FS-05 CatalogViewSlice', () => {
  it('sets the cuisine filter and clears it with null', () => {
    const french = catalogViewSlice(ALL, { type: 'cuisine', cuisineId: 5 });

    expect(french).toEqual({ cuisineId: 5, highlightId: null });
    expect(catalogViewSlice(french, { type: 'cuisine', cuisineId: null })).toEqual(ALL);
  });

  it('highlights a recipe and clears the highlight with null', () => {
    const marked = catalogViewSlice(ALL, { type: 'highlight', recipeId: 12 });

    expect(marked).toEqual({ cuisineId: null, highlightId: 12 });
    expect(catalogViewSlice(marked, { type: 'highlight', recipeId: null })).toEqual(ALL);
  });

  it('keeps the two fields apart: a cuisine leaves the highlight and a highlight leaves the cuisine', () => {
    const both = catalogViewSlice(catalogViewSlice(ALL, { type: 'highlight', recipeId: 12 }), { type: 'cuisine', cuisineId: 5 });

    expect(both).toEqual({ cuisineId: 5, highlightId: 12 });
  });

  it('returns the very same state when a field is set to what it already is', () => {
    expect(catalogViewSlice(ALL, { type: 'cuisine', cuisineId: null })).toBe(ALL);
    expect(catalogViewSlice(ALL, { type: 'highlight', recipeId: null })).toBe(ALL);
  });

  it('refuses a value that is neither an id nor null, and an action that it does not know', () => {
    const illegal = [
      { type: 'cuisine', cuisineId: 0 },
      { type: 'cuisine', cuisineId: -1 },
      { type: 'cuisine', cuisineId: 2.5 },
      { type: 'cuisine', cuisineId: '5' },
      { type: 'highlight', recipeId: 0 },
      { type: 'highlight', recipeId: undefined },
      { type: 'sort' },
    ] as unknown as CatalogViewAction[];

    for (const action of illegal) expect(catalogViewSlice(ALL, action)).toBe(ALL);
  });

  it('does not change the state that it is given', () => {
    const state = Object.freeze({ cuisineId: 5, highlightId: 12 });

    expect(catalogViewSlice(state, { type: 'cuisine', cuisineId: 6 })).toEqual({ cuisineId: 6, highlightId: 12 });
    expect(state).toEqual({ cuisineId: 5, highlightId: 12 });
  });
});
