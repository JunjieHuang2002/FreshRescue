import type { Id, QtyMilli } from '@freshrescue/contract-primitives';
import type { IngredientState, RecipeStatus } from '@freshrescue/contract-rules';

/** One ingredient row of a recipe as a screen shows it. Feature 3 and Feature 4 both use it. */
export type RecipeLine = {
  readonly foodTypeId: Id;
  /** The Food Type's name, or the name it had when it was deleted. */
  readonly name: string;
  readonly requiredQuantity: QtyMilli;
  readonly requiredUnit: string;
  /** `Q_avail` of the Food Type. null when it was not evaluated, which is true of every row of a blocked recipe. */
  readonly available: QtyMilli | null;
  readonly state: IngredientState;
  /** A Rescued Ingredient: available near-expiry stock (spec 1.2). */
  readonly rescued: boolean;
  /** The Food Type's own unit. Set for a unit conflict, so the screen can name both units. */
  readonly foodTypeUnit: string | null;
};

/** One recipe in the Feature 4 catalog (spec 4.4.C). */
export type CatalogRow = {
  readonly recipeId: Id;
  readonly name: string;
  readonly cuisineId: Id;
  readonly cuisineName: string;
  /** `blocked` is shown red, and `nothing` and `blocked` cannot be cooked. */
  readonly status: RecipeStatus;
  /** How many ingredients are available in full, as in "2 of 3 ingredients available". */
  readonly availableCount: number;
  readonly totalCount: number;
  readonly ingredients: readonly RecipeLine[];
};

/** The Feature 4 catalog: every recipe A to Z, optionally for one cuisine. */
export type CatalogDto = {
  /** The cuisine filter that was applied, or null for all. */
  readonly cuisineId: Id | null;
  readonly rows: readonly CatalogRow[];
};
