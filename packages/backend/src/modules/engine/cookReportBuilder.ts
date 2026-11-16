import type { FoodType, Snapshot } from '@freshrescue/contract-entities';
import type { Id } from '@freshrescue/contract-primitives';
import type { SkipReason } from '@freshrescue/contract-rules';
import type { Allocation, CookReportEntry, DeductedLine, MissingLine, RecipeMatch } from '@freshrescue/contract-views';

/**
 * BC-38 CookReportBuilder. Builds one queued recipe's entry of the execution summary (spec 4.5.4),
 * which reports, per recipe, the ingredients deducted (quantity and unit), the ingredients skipped as
 * Missing (needed against available), or "Nothing to deduct — skipped".
 *
 * - No match: the recipe is gone, for instance deleted while it was queued. It is skipped as
 *   `recipeNotFound`, a report entry and not an error (blueprint 3.4).
 * - A blocked recipe is skipped as `blocked` (exception row 21).
 * - A recipe with no available ingredient is skipped as `nothingAvailable` (exception row 16).
 * - Otherwise it was cooked. Each allocation is one deducted ingredient with the total it took, and
 *   each row that was not fulfilled is a Missing Ingredient with what was needed and what was
 *   available; it was deducted by 0 (spec 4.5.2).
 *
 * A skipped entry lists nothing as deducted or missing. Names and units are those of the snapshot the
 * recipe was cooked on, so they are read before the deductions are applied.
 */
export function cookReportBuilder(recipeId: Id, match: RecipeMatch | null, allocations: readonly Allocation[], snapshot: Snapshot): CookReportEntry {
  const recipeName = snapshot.recipes.find((recipe) => recipe.id === recipeId)?.name ?? '';
  const skipped = (reason: SkipReason): CookReportEntry => ({ recipeId, recipeName, outcome: 'skipped', reason, deducted: [], missing: [] });
  if (match === null) return skipped('recipeNotFound');
  if (match.status === 'blocked') return skipped('blocked');
  if (match.availableCount === 0) return skipped('nothingAvailable');

  const foodTypes = new Map(snapshot.foodTypes.map((foodType): [Id, FoodType] => [foodType.id, foodType]));
  const deducted = allocations.map((allocation): DeductedLine => ({
    foodTypeId: allocation.foodTypeId,
    name: foodTypes.get(allocation.foodTypeId)?.name ?? '',
    quantity: allocation.takes.reduce((sum, take) => sum + take.takeMilli, 0),
    unit: foodTypes.get(allocation.foodTypeId)?.unit ?? '',
  }));
  const missing = match.rows
    .filter((row) => !row.fulfilled)
    .map((row): MissingLine => ({
      foodTypeId: row.foodTypeId,
      name: foodTypes.get(row.foodTypeId)?.name ?? '',
      needed: row.qReq,
      available: row.avail,
      unit: foodTypes.get(row.foodTypeId)?.unit ?? '',
    }));
  return { recipeId, recipeName, outcome: 'cooked', reason: null, deducted, missing };
}
