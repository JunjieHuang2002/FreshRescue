import type { Id, QtyMilli, ValidQty, ValidUnit } from '@freshrescue/contract-primitives';

/** A single-level cuisine tag for recipes, with its own system `Other`. */
export type RecipeCategory = {
  readonly id: Id;
  readonly name: string;
  readonly isSystem: boolean;
};

/** A recipe: a name, a cuisine, and (in `RecipeIngredient` rows) its ingredients. A built-in recipe is no different. */
export type Recipe = {
  readonly id: Id;
  readonly name: string;
  readonly recipeCategoryId: Id;
};

/** One ingredient row. A recipe has at most one row per Food Type. */
export type RecipeIngredient = {
  readonly recipeId: Id;
  readonly foodTypeId: Id;
  readonly requiredQuantity: QtyMilli;
  readonly requiredUnit: string;
  /** Set only when the Food Type was deleted: the name it had, which makes the recipe blocked. */
  readonly deletedFoodTypeName: string | null;
};

/**
 * A recipe draft that RecipeDraftValidator has checked (blueprint 1.5). RecipeDraftValidator
 * makes it and RecipeUpsertDecider takes it, so it is shared by two modules, which cannot import
 * each other. It is written in the vocabulary of the entities: the cuisine is resolved (a draft
 * without one gets `Other`), and each row has a validated quantity and unit.
 */
export type ValidRecipeDraft = {
  readonly recipeCategoryId: Id;
  readonly rows: readonly {
    readonly foodTypeId: Id;
    readonly requiredQuantity: ValidQty;
    readonly requiredUnit: ValidUnit;
  }[];
};
