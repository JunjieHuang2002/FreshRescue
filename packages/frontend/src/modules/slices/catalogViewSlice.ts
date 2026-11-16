import type { CatalogViewAction, CatalogViewState } from '@freshrescue/contract-ui';

const isIdOrNull = (value: unknown): boolean =>
  value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 1);

/**
 * FS-05 CatalogViewSlice. Tracks the cuisine filter and the recipe that is highlighted after "Open in
 * Cook" (blueprint 1.7). The two fields change independently: choosing a cuisine leaves the
 * highlight alone, and `null` clears either one. A value that is neither an id nor `null` is illegal
 * and changes nothing, and so does setting a field to what it already is.
 */
export function catalogViewSlice(state: CatalogViewState, action: CatalogViewAction): CatalogViewState {
  switch (action.type) {
    case 'cuisine':
      if (!isIdOrNull(action.cuisineId) || action.cuisineId === state.cuisineId) return state;
      return { ...state, cuisineId: action.cuisineId };
    case 'highlight':
      if (!isIdOrNull(action.recipeId) || action.recipeId === state.highlightId) return state;
      return { ...state, highlightId: action.recipeId };
    default:
      return state;
  }
}
