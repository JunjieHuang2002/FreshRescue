import type { Id, QtyMilli } from '@freshrescue/contract-primitives';
import type { BatchStatus } from '@freshrescue/contract-rules';
import type { BatchView, StatusQuantities, ThresholdEntry } from './derived';

/** A recipe that references the Food Type. Deleting the Food Type would make it blocked. */
export type RecipeRef = {
  readonly recipeId: Id;
  readonly name: string;
};

/** One Food Type with its batches (spec 4.7.2). */
export type FoodTypeDetailDto = {
  readonly foodTypeId: Id;
  readonly name: string;
  readonly categoryId: Id;
  readonly categoryPath: readonly string[];
  readonly unit: string;
  /** The Food Type's own threshold in days, or null when it inherits one. */
  readonly customThresholdDays: number | null;
  /** The effective threshold `T_eff` and the level that decided it. */
  readonly threshold: ThresholdEntry;
  /** Every batch, Expired ones included. */
  readonly total: QtyMilli;
  readonly byStatus: StatusQuantities;
  readonly overall: BatchStatus | null;
  /** Every batch with its status and days left, by `D_exp` and then `createdSeq`. */
  readonly batches: readonly BatchView[];
  /** The recipes that use this Food Type, for the delete confirmation. */
  readonly referencingRecipes: readonly RecipeRef[];
};
