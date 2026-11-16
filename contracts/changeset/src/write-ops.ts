import type {
  Batch,
  Counters,
  FoodCategory,
  FoodType,
  Recipe,
  RecipeCategory,
  RecipeIngredient,
  Settings,
} from '@freshrescue/contract-entities';

// Storage speaks in WriteOps: logical table names and the same field names as the entities. Only
// the MySQL gateway knows the real table and column names, so replacing the store touches nothing
// else (blueprint 1.9, "Replacement test").

/**
 * The logical tables of the store. They are the six lists of a `Snapshot` plus `settings` and
 * `counters`, so there are two more tables than `SNAPSHOT_LISTS`.
 */
export const STORE_TABLES = [
  'foodCategories',
  'foodTypes',
  'batches',
  'recipeCategories',
  'recipes',
  'recipeIngredients',
  'settings',
  'counters',
] as const;

export type StoreTable = (typeof STORE_TABLES)[number];

/** The row of each table: the entity itself. */
export type StoreRows = {
  readonly foodCategories: FoodCategory;
  readonly foodTypes: FoodType;
  readonly batches: Batch;
  readonly recipeCategories: RecipeCategory;
  readonly recipes: Recipe;
  readonly recipeIngredients: RecipeIngredient;
  readonly settings: Settings;
  readonly counters: Counters;
};

/**
 * The fields that identify a row, which is what a put replaces by and a delete matches on. An
 * ingredient row is named by its recipe and its Food Type. `settings` and `counters` hold one row.
 */
export const STORE_KEYS = {
  foodCategories: ['id'],
  foodTypes: ['id'],
  batches: ['id'],
  recipeCategories: ['id'],
  recipes: ['id'],
  recipeIngredients: ['recipeId', 'foodTypeId'],
  settings: [],
  counters: [],
} as const satisfies { readonly [T in StoreTable]: readonly (keyof StoreRows[T])[] };

/** Insert the row, or replace the row that has the same key. */
export type PutOp<T extends StoreTable> = {
  readonly op: 'put';
  readonly table: T;
  readonly row: StoreRows[T];
};

/**
 * Delete every row that matches the key. The key may be partial, so a delete that names only a
 * recipe removes all of that recipe's ingredient rows.
 */
export type DeleteOp<T extends StoreTable> = {
  readonly op: 'delete';
  readonly table: T;
  readonly key: Partial<StoreRows[T]>;
};

export type WriteOp = { [T in StoreTable]: PutOp<T> | DeleteOp<T> }[StoreTable];

/** One batch for StoreWriteGateway: all of it is applied, or none of it. */
export type WriteOps = readonly WriteOp[];
