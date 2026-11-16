import type { FoodType, RecipeIngredient, Snapshot } from '@freshrescue/contract-entities';
import type { Id } from '@freshrescue/contract-primitives';
import type { RecipeErrorRow, RecipeErrors } from '@freshrescue/contract-views';

/** The error of one ingredient row (spec 4.4.A), or null when the row is fine. */
function errorOf(row: RecipeIngredient, foodTypes: ReadonlyMap<Id, FoodType>): RecipeErrorRow | null {
  const foodType = foodTypes.get(row.foodTypeId);
  if (foodType === undefined || row.deletedFoodTypeName !== null) {
    return { reason: 'missingFoodType', foodTypeId: row.foodTypeId, deletedFoodTypeName: row.deletedFoodTypeName };
  }
  if (row.requiredUnit !== foodType.unit) {
    return { reason: 'unitConflict', foodTypeId: row.foodTypeId, requiredUnit: row.requiredUnit, foodTypeUnit: foodType.unit };
  }
  return null;
}

/**
 * BC-12 RecipeErrorEvaluator. Finds the error rows of every recipe (spec 4.4.A). A row can have one
 * of two errors, and a recipe with either is a Blocked Error recipe: it is shown red with a message
 * for each affected row, it cannot be cooked, and it is never a Full or a Partial Match.
 *
 * - Missing Food Type: the row's Food Type has been deleted (spec 4.2.4). The row keeps the name the
 *   Food Type had, `deletedFoodTypeName`, for the message "Missing food type: {name}". Rows name a
 *   Food Type by id and ids are never reused, so re-creating a Food Type with the same name does not
 *   repair the row. Either sign makes a row missing: its Food Type is not in the snapshot, or it carries
 *   a deleted name. SnapshotInvariantChecker keeps the two in step, and if they ever disagreed the
 *   recipe would stay blocked, which is the safe side.
 * - Unit Conflict: the row's Required Unit is not the Food Type's unit. Units match by exact equality
 *   with no conversion, and the check ignores the stock, so a Food Type without a batch can conflict.
 *
 * A recipe can show both errors, on different rows. The result has an entry for each recipe with at
 * least one error row, those rows in the recipe's order, and no entry for a recipe without one. A row
 * whose recipe is not in the snapshot belongs to no recipe and is left out.
 */
export function recipeErrorEvaluator(snapshot: Snapshot): RecipeErrors {
  const foodTypes = new Map(snapshot.foodTypes.map((foodType): [Id, FoodType] => [foodType.id, foodType]));
  const recipes = new Set(snapshot.recipes.map((recipe) => recipe.id));
  const errors: Record<Id, RecipeErrorRow[]> = {};
  for (const row of snapshot.recipeIngredients) {
    if (!recipes.has(row.recipeId)) continue;
    const error = errorOf(row, foodTypes);
    if (error !== null) (errors[row.recipeId] ??= []).push(error);
  }
  return errors;
}
