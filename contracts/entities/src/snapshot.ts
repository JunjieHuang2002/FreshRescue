import { FIRST_FREE_ID } from '@freshrescue/contract-rules';
import type { Batch, FoodCategory, FoodType } from './food';
import type { Recipe, RecipeCategory, RecipeIngredient } from './recipe';
import type { Counters, Settings } from './settings';

/**
 * Everything that is stored, as one value. Each request loads the whole snapshot, decides, and
 * writes once. Every list is kept in creation order: that order is the tie-break of the A to Z sort.
 */
export type Snapshot = {
  readonly foodCategories: readonly FoodCategory[];
  readonly foodTypes: readonly FoodType[];
  readonly batches: readonly Batch[];
  readonly recipeCategories: readonly RecipeCategory[];
  readonly recipes: readonly Recipe[];
  readonly recipeIngredients: readonly RecipeIngredient[];
  readonly settings: Settings;
  readonly counters: Counters;
};

/** The keys of the six lists of a `Snapshot`, as the compiler checks them against `Snapshot`. */
export const SNAPSHOT_LISTS = [
  'foodCategories',
  'foodTypes',
  'batches',
  'recipeCategories',
  'recipes',
  'recipeIngredients',
] as const;

export type SnapshotList = (typeof SNAPSHOT_LISTS)[number];

/** What an empty store reads as: no records, not bootstrapped, and the counters at their start. */
export const EMPTY_SNAPSHOT: Snapshot = {
  foodCategories: [],
  foodTypes: [],
  batches: [],
  recipeCategories: [],
  recipes: [],
  recipeIngredients: [],
  settings: { simulatedToday: null, bootstrapped: false },
  counters: { nextId: FIRST_FREE_ID, nextSeq: 1 },
};
