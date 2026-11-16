import type { QtyMilli } from '@freshrescue/contract-primitives';

// The seed document (spec 4.4.E and Appendix A). It names things by key and holds no ids: an id
// does not exist until SeedPlanner takes one from the reserved block. Quantities are thousandths,
// as everywhere. The system categories `Other` are not in the seed: they have the ids of SYSTEM_IDS
// and SystemDataInitializer adds them, and a null key below means `Other`.

/** A food category. A top-level one has `parentKey: null`, and a Child names its Parent's key. */
export type SeedFoodCategory = {
  readonly key: string;
  readonly name: string;
  readonly parentKey: string | null;
};

/** A recipe cuisine category. */
export type SeedCuisine = {
  readonly key: string;
  readonly name: string;
};

/** A Food Type. `categoryKey: null` puts it in the system category `Other`. */
export type SeedFoodType = {
  readonly key: string;
  readonly name: string;
  readonly categoryKey: string | null;
  readonly unit: string;
};

/** One ingredient row of a seed recipe. Its unit must equal its Food Type's unit, or the recipe would start red. */
export type SeedIngredient = {
  readonly foodTypeKey: string;
  readonly quantity: QtyMilli;
  readonly unit: string;
};

/** A built-in recipe: the same as any recipe. `cuisineKey: null` puts it in the system cuisine `Other`. */
export type SeedRecipe = {
  readonly key: string;
  readonly name: string;
  readonly cuisineKey: string | null;
  readonly ingredients: readonly SeedIngredient[];
};

/** The seed document once its shape is known. */
export type SeedBundle = {
  readonly foodCategories: readonly SeedFoodCategory[];
  readonly cuisines: readonly SeedCuisine[];
  readonly foodTypes: readonly SeedFoodType[];
  readonly recipes: readonly SeedRecipe[];
};

/** The seed document as the source gateway reads it, before SeedBundleParser checks it. */
export type RawSeed = unknown;
